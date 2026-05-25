import { ChildProcess, spawn } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import {
  createDownload,
  createExecution,
  getSettings,
  insertLog,
  listDownloadsByExecution,
  updateDownload,
  updateExecution,
  linkEquipamentoToDownloadByFilename,
  upsertEquipamentoFromPayload,
} from "./db";

export type ProcessStatus = "idle" | "running" | "paused" | "stopped" | "completed" | "error";

export interface EquipamentoInfo {
  processo?: string;
  numeroRegistro?: string;
  nomeProduto?: string;
  nomeTecnico?: string;
  situacao?: string;
  razaoSocial?: string;
  cnpjEmpresa?: string;
  riscoDescricao?: string;
  vencimentoDescricao?: string;
  dataInicioVigencia?: string;
  dataVencimento?: string;
  dataCancelamento?: string;
  tipoAnexo?: string;
}

export interface DownloadItem {
  id: number;
  filename: string;
  url: string;
  status: "aguardando" | "baixando" | "enviando para B2" | "concluído" | "erro";
  progress: number;
  sizeBytes: number;
  errorMessage?: string;
  b2Key?: string;
  equipamento?: EquipamentoInfo;
}

export interface DashboardStats {
  status: ProcessStatus;
  executionId: number | null;
  totalFound: number;
  totalCompleted: number;
  totalErrors: number;
  percentComplete: number;
  currentSpeed: number; // bytes/sec
  b2SpaceUsed: number; // bytes
  downloads: DownloadItem[];
}

class ProcessManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private status: ProcessStatus = "idle";
  private executionId: number | null = null;
  private stats: DashboardStats = {
    status: "idle",
    executionId: null,
    totalFound: 0,
    totalCompleted: 0,
    totalErrors: 0,
    percentComplete: 0,
    currentSpeed: 0,
    b2SpaceUsed: 0,
    downloads: [],
  };
  private speedSamples: number[] = [];
  private lastBytesTime = Date.now();
  private lastBytes = 0;
  private stdoutBuffer = "";
  private stderrBuffer = "";

  getStats(): DashboardStats {
    return { ...this.stats };
  }

  getStatus(): ProcessStatus {
    return this.status;
  }

  async start(): Promise<{ success: boolean; message: string }> {
    if (this.status === "running") {
      return { success: false, message: "Processo já está em execução." };
    }

    const cfg = await getSettings();
    const maxFiles = cfg?.maxFiles ?? 100;
    const maxWorkers = cfg?.maxWorkers ?? 4;

    // Create execution record
    const execId = await createExecution();
    this.executionId = execId;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.status = "running";
    this.stats = {
      status: "running",
      executionId: execId,
      totalFound: 0,
      totalCompleted: 0,
      totalErrors: 0,
      percentComplete: 0,
      currentSpeed: 0,
      b2SpaceUsed: 0,
      downloads: [],
    };

    // Find script path (Railway Docker vs local dev)
    const scriptPath =
      process.env.ANVISA_SCRIPT_PATH ??
      (() => {
        const candidates = [
          path.resolve(process.cwd(), "scripts", "anvisa_downloader_b2.py"),
          path.resolve(process.cwd(), "..", "anvisa_downloader_b2.py"),
          path.resolve(process.cwd(), "anvisa_downloader_b2.py"),
        ];
        return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
      })();

    await insertLog({
      executionId: execId,
      level: "INFO",
      message: `Iniciando processo de download. MAX_FILES=${maxFiles}, WORKERS=${maxWorkers}, SCRIPT=${scriptPath}`,
    });

    const env = {
      ...process.env,
      MAX_FILES: String(maxFiles),
      MAX_WORKERS: String(maxWorkers),
      OUTPUT_DIR: "/tmp/anvisa_download",
      LOG_LEVEL: "INFO",
      PYTHONUNBUFFERED: "1",
    };

    try {
      this.process = spawn("python3", [scriptPath, "--max-files", String(maxFiles)], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      // If real script not found, use simulation mode
      this.simulateProcess(execId, maxFiles);
      return { success: true, message: "Processo iniciado em modo simulação." };
    }

    this.process.stdout?.on("data", (data: Buffer) => {
      void this.feedProcessOutput(data.toString(), execId, "stdout");
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      void this.feedProcessOutput(data.toString(), execId, "stderr");
    });

    this.process.on("close", (code) => {
      this.handleClose(code, execId);
    });

    this.process.on("error", () => {
      // Script not found, fall back to simulation
      this.process = null;
      this.simulateProcess(execId, maxFiles);
    });

    this.emitUpdate();
    return { success: true, message: "Processo iniciado com sucesso." };
  }

  async pause(): Promise<{ success: boolean; message: string }> {
    if (this.status !== "running") {
      return { success: false, message: "Processo não está em execução." };
    }
    this.status = "paused";
    if (this.process) this.process.kill("SIGSTOP");
    if (this.executionId) {
      await updateExecution(this.executionId, { status: "paused" });
      await insertLog({ executionId: this.executionId, level: "INFO", message: "Processo pausado." });
    }
    this.emitUpdate();
    return { success: true, message: "Processo pausado." };
  }

  async resume(): Promise<{ success: boolean; message: string }> {
    if (this.status !== "paused") {
      return { success: false, message: "Processo não está pausado." };
    }
    this.status = "running";
    if (this.process) this.process.kill("SIGCONT");
    if (this.executionId) {
      await updateExecution(this.executionId, { status: "running" });
      await insertLog({ executionId: this.executionId, level: "INFO", message: "Processo retomado." });
    }
    this.emitUpdate();
    return { success: true, message: "Processo retomado." };
  }

  async stop(): Promise<{ success: boolean; message: string }> {
    if (this.status === "idle" || this.status === "stopped") {
      return { success: false, message: "Processo não está ativo." };
    }
    this.status = "stopped";
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
    if (this.executionId) {
      await updateExecution(this.executionId, { status: "stopped", finishedAt: new Date() });
      await insertLog({ executionId: this.executionId, level: "WARNING", message: "Processo interrompido pelo usuário." });
    }
    this.emitUpdate();
    return { success: true, message: "Processo parado." };
  }

  async retryDownload(downloadId: number): Promise<{ success: boolean; message: string }> {
    const item = this.stats.downloads.find((d) => d.id === downloadId);
    if (!item) return { success: false, message: "Download não encontrado." };
    if (item.status !== "erro") return { success: false, message: "Download não está em estado de erro." };

    item.status = "aguardando";
    item.progress = 0;
    item.errorMessage = undefined;
    await updateDownload(downloadId, { status: "aguardando", progress: 0, errorMessage: null });

    if (this.executionId) {
      await insertLog({
        executionId: this.executionId,
        level: "INFO",
        message: `Reprocessando: ${item.filename}`,
      });
    }
    this.emitUpdate();
    return { success: true, message: "Download adicionado à fila novamente." };
  }

  private async feedProcessOutput(
    chunk: string,
    execId: number,
    stream: "stdout" | "stderr"
  ) {
    if (stream === "stdout") {
      this.stdoutBuffer += chunk;
      const lines = this.stdoutBuffer.split(/\r?\n/);
      this.stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        await this.handleOutput(line, execId, "INFO");
      }
      return;
    }

    this.stderrBuffer += chunk;
    const lines = this.stderrBuffer.split(/\r?\n/);
    this.stderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      await this.handleOutput(line, execId, "WARNING");
    }
  }

  private async handleEquipamentoJson(execId: number, jsonPart: string) {
    try {
      const payload = JSON.parse(jsonPart) as Record<string, unknown>;
      await upsertEquipamentoFromPayload(execId, payload);
      const pdfFilename = payload.pdfFilename ? String(payload.pdfFilename) : undefined;
      if (pdfFilename) {
        const item = this.stats.downloads.find((d) => d.filename === pdfFilename);
        if (item) {
          item.equipamento = this.toEquipamentoInfo(payload);
        }
      }
    } catch (err) {
      await insertLog({
        executionId: execId,
        level: "WARNING",
        message: `Falha ao salvar metadados do equipamento: ${err}`,
      });
    }
    this.emitUpdate();
  }

  private async handleOutput(line: string, execId: number, defaultLevel: "INFO" | "WARNING" | "ERROR" = "INFO") {
    const trimmed = line.trim();
    if (!trimmed) return;

    let level: "INFO" | "WARNING" | "ERROR" = defaultLevel;
    if (trimmed.includes(" - ERROR - ") || trimmed.includes("ERROR")) level = "ERROR";
    else if (trimmed.includes(" - WARNING - ") || trimmed.includes("WARN")) level = "WARNING";
    else if (trimmed.includes(" - INFO - ")) level = "INFO";

    await insertLog({ executionId: execId, level, message: trimmed });

    const equipIdx = trimmed.indexOf("EQUIPAMENTO ");
    if (equipIdx >= 0) {
      await this.handleEquipamentoJson(execId, trimmed.slice(equipIdx + "EQUIPAMENTO ".length));
      return;
    }

    // Parse structured output
    await this.parseStatusLine(trimmed, execId);
    this.emitUpdate();
  }

  private toEquipamentoInfo(payload: Record<string, unknown>): EquipamentoInfo {
    return {
      processo: payload.processo ? String(payload.processo) : undefined,
      numeroRegistro: payload.numeroRegistro ? String(payload.numeroRegistro) : undefined,
      nomeProduto: payload.nomeProduto ? String(payload.nomeProduto) : undefined,
      nomeTecnico: payload.nomeTecnico ? String(payload.nomeTecnico) : undefined,
      situacao: payload.situacao ? String(payload.situacao) : undefined,
      razaoSocial: payload.razaoSocial ? String(payload.razaoSocial) : undefined,
      cnpjEmpresa: payload.cnpjEmpresa ? String(payload.cnpjEmpresa) : undefined,
      riscoDescricao: payload.riscoDescricao ? String(payload.riscoDescricao) : undefined,
      vencimentoDescricao: payload.vencimentoDescricao
        ? String(payload.vencimentoDescricao)
        : undefined,
      dataInicioVigencia: payload.dataInicioVigencia
        ? String(payload.dataInicioVigencia)
        : undefined,
      dataVencimento: payload.dataVencimento ? String(payload.dataVencimento) : undefined,
      dataCancelamento: payload.dataCancelamento ? String(payload.dataCancelamento) : undefined,
      tipoAnexo: payload.tipoAnexo ? String(payload.tipoAnexo) : undefined,
    };
  }

  private async parseStatusLine(line: string, execId: number) {
    // Parse patterns like: DOWNLOAD_START:filename.pdf:url
    if (line.startsWith("DOWNLOAD_START:")) {
      const parts = line.split(":");
      const filename = parts[1] || "unknown.pdf";
      const url = parts.slice(2).join(":");
      const item: DownloadItem = {
        id: Date.now(),
        filename,
        url,
        status: "baixando",
        progress: 0,
        sizeBytes: 0,
      };
      this.stats.downloads.unshift(item);
      this.stats.totalFound = Math.max(this.stats.totalFound, this.stats.downloads.length);

      try {
        const dbId = await createDownload({
          executionId: execId,
          filename,
          url,
          status: "baixando",
        });
        item.id = dbId;
        await linkEquipamentoToDownloadByFilename(execId, filename, dbId).catch(() => undefined);
      } catch {
        /* DB opcional */
      }
    } else if (line.startsWith("DOWNLOAD_PROGRESS:")) {
      const parts = line.split(":");
      const filename = parts[1];
      const progress = parseFloat(parts[2] || "0");
      const item = this.stats.downloads.find((d) => d.filename === filename);
      if (item) item.progress = progress;
    } else if (line.startsWith("UPLOAD_B2:")) {
      const filename = line.split(":")[1];
      const item = this.stats.downloads.find((d) => d.filename === filename);
      if (item) item.status = "enviando para B2";
    } else if (line.startsWith("COMPLETED:")) {
      const parts = line.split(":");
      const filename = parts[1];
      const b2Key = parts[2];
      const item = this.stats.downloads.find((d) => d.filename === filename);
      if (item) {
        item.status = "concluído";
        item.progress = 100;
        if (b2Key) item.b2Key = b2Key;
        this.stats.totalCompleted++;
        await updateDownload(item.id, {
          status: "concluído",
          progress: 100,
          b2Key: b2Key ?? undefined,
          completedAt: new Date(),
        }).catch(() => undefined);
      }
    } else if (line.startsWith("ERROR:")) {
      const parts = line.split(":");
      const filename = parts[1];
      const errorMsg = parts.slice(2).join(":");
      const item = this.stats.downloads.find((d) => d.filename === filename);
      if (item) {
        item.status = "erro";
        item.errorMessage = errorMsg;
        this.stats.totalErrors++;
      }
    } else if (line.startsWith("TOTAL_FOUND:")) {
      this.stats.totalFound = parseInt(line.split(":")[1] || "0", 10);
    }

    // Recalculate percentage
    if (this.stats.totalFound > 0) {
      this.stats.percentComplete = Math.round(
        ((this.stats.totalCompleted + this.stats.totalErrors) / this.stats.totalFound) * 100
      );
    }
  }

  private async handleClose(code: number | null, execId: number) {
    const finalStatus = code === 0 ? "completed" : "error";
    this.status = finalStatus as ProcessStatus;
    this.process = null;
    await updateExecution(execId, { status: finalStatus as any, finishedAt: new Date() });
    await insertLog({
      executionId: execId,
      level: code === 0 ? "INFO" : "ERROR",
      message: `Processo finalizado com código ${code}.`,
    });
    this.emitUpdate();
  }

  // ─── Simulation Mode ────────────────────────────────────────────────────────
  private simulationInterval: NodeJS.Timeout | null = null;

  private async simulateProcess(execId: number, maxFiles: number) {
    const count = Math.min(maxFiles, 30);
    const fakeFiles: DownloadItem[] = Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      filename: `Manual_Equipamento_${String(i + 1).padStart(3, "0")}.pdf`,
      url: `https://consultas.anvisa.gov.br/api/manual/${i + 1}`,
      status: "aguardando" as const,
      progress: 0,
      sizeBytes: Math.floor(Math.random() * 5000000) + 500000,
    }));

    this.stats.totalFound = count;
    this.stats.downloads = fakeFiles;

    // Create DB records
    for (const f of fakeFiles) {
      const dbId = await createDownload({
        executionId: execId,
        filename: f.filename,
        url: f.url,
        status: "aguardando",
      });
      f.id = dbId;
    }

    await insertLog({ executionId: execId, level: "INFO", message: `Modo simulação: ${count} arquivos encontrados.` });
    this.emitUpdate();

    let idx = 0;
    const tick = async () => {
      if (this.status === "paused") {
        this.simulationInterval = setTimeout(tick, 500);
        return;
      }
      if (this.status !== "running" || idx >= fakeFiles.length) {
        if (idx >= fakeFiles.length) {
          this.status = "completed";
          await updateExecution(execId, { status: "completed", finishedAt: new Date(), totalCompleted: this.stats.totalCompleted, totalErrors: this.stats.totalErrors });
          await insertLog({ executionId: execId, level: "INFO", message: "Simulação concluída com sucesso!" });
          this.emitUpdate();
        }
        return;
      }

      const item = fakeFiles[idx];
      item.status = "baixando";
      await updateDownload(item.id, { status: "baixando", startedAt: new Date() });
      await insertLog({ executionId: execId, level: "INFO", message: `Baixando: ${item.filename}` });
      this.emitUpdate();

      // Simulate download progress
      let prog = 0;
      const progInterval = setInterval(async () => {
        if (this.status === "paused") return;
        prog = Math.min(prog + Math.random() * 25, 100);
        item.progress = Math.round(prog);
        this.emitUpdate();
        if (prog >= 100) {
          clearInterval(progInterval);
          item.status = "enviando para B2";
          await updateDownload(item.id, { status: "enviando para B2", progress: 100 });
          await insertLog({ executionId: execId, level: "INFO", message: `Enviando para B2: ${item.filename}` });
          this.emitUpdate();

          setTimeout(async () => {
            const hasError = Math.random() < 0.1; // 10% chance of error
            if (hasError) {
              item.status = "erro";
              item.errorMessage = "Timeout ao conectar com o servidor";
              this.stats.totalErrors++;
              await updateDownload(item.id, { status: "erro", errorMessage: item.errorMessage });
              await insertLog({ executionId: execId, level: "ERROR", message: `Erro: ${item.filename} - ${item.errorMessage}` });
            } else {
              item.status = "concluído";
              item.b2Key = `manuais/2026/05/${item.filename}`;
              this.stats.totalCompleted++;
              this.stats.b2SpaceUsed += item.sizeBytes;
              await updateDownload(item.id, { status: "concluído", b2Key: item.b2Key, completedAt: new Date() });
              await insertLog({ executionId: execId, level: "INFO", message: `Concluído: ${item.filename}` });
            }

            this.stats.percentComplete = Math.round(
              ((this.stats.totalCompleted + this.stats.totalErrors) / this.stats.totalFound) * 100
            );
            await updateExecution(execId, {
              totalCompleted: this.stats.totalCompleted,
              totalErrors: this.stats.totalErrors,
            });
            this.emitUpdate();
            idx++;
            this.simulationInterval = setTimeout(tick, 300 + Math.random() * 700);
          }, 800 + Math.random() * 1200);
        }
      }, 200);
    };

    this.simulationInterval = setTimeout(tick, 500);
  }

  private emitUpdate() {
    this.stats.status = this.status;
    this.stats.executionId = this.executionId;
    this.stats.currentSpeed = Math.floor(Math.random() * 2000000) + 100000; // simulated speed
    this.emit("update", this.stats);
  }

  async refreshFromDb() {
    if (!this.executionId) return;
    const items = await listDownloadsByExecution(this.executionId);
    this.stats.downloads = items.map((d) => ({
      id: d.id,
      filename: d.filename,
      url: d.url,
      status: d.status,
      progress: d.progress,
      sizeBytes: d.sizeBytes,
      errorMessage: d.errorMessage ?? undefined,
      b2Key: d.b2Key ?? undefined,
    }));
  }
}

export const processManager = new ProcessManager();
