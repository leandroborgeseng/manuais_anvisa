import { ChildProcess, spawn } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import {
  countRegistrosAnvisa,
  createCatalogSync,
  insertLog,
  updateCatalogSync,
  upsertRegistrosBatch,
} from "./db";
import { processManager } from "./processManager";

export type CatalogStatus = "idle" | "running" | "paused" | "stopped" | "completed" | "error";

export interface CatalogStats {
  status: CatalogStatus;
  syncId: number | null;
  queryTerm: string;
  currentPage: number;
  totalPages: number;
  totalElements: number;
  recordsUpserted: number;
  recordsInDb: number;
  recordsErrors: number;
  percentComplete: number;
}

class CatalogManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private status: CatalogStatus = "idle";
  private syncId: number | null = null;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private stats: CatalogStats = {
    status: "idle",
    syncId: null,
    queryTerm: "a",
    currentPage: 0,
    totalPages: 0,
    totalElements: 0,
    recordsUpserted: 0,
    recordsInDb: 0,
    recordsErrors: 0,
    percentComplete: 0,
  };

  getStats(): CatalogStats {
    return { ...this.stats };
  }

  getStatus(): CatalogStatus {
    return this.status;
  }

  private resolveScriptPath(): string {
    const envPath = process.env.ANVISA_CATALOG_SCRIPT_PATH;
    if (envPath && fs.existsSync(envPath)) return envPath;
    const candidates = [
      path.resolve(process.cwd(), "scripts", "anvisa_catalog_sync.py"),
      path.resolve(process.cwd(), "..", "anvisa_catalog_sync.py"),
      path.resolve(process.cwd(), "anvisa_catalog_sync.py"),
      "/app/scripts/anvisa_catalog_sync.py",
    ];
    return candidates.find((c) => fs.existsSync(c)) ?? candidates[0]!;
  }

  async start(options?: {
    startPage?: number;
    queryTerm?: string;
    pageSize?: number;
  }): Promise<{ success: boolean; message: string }> {
    if (this.status === "running") {
      return { success: false, message: "Sincronização do catálogo já está em execução." };
    }
    if (processManager.getStatus() === "running") {
      return {
        success: false,
        message: "Pare o download de manuais antes de sincronizar o catálogo.",
      };
    }

    const queryTerm = options?.queryTerm ?? process.env.ANVISA_CATALOG_QUERY ?? "a";
    const pageSize = options?.pageSize ?? Number(process.env.ANVISA_CATALOG_PAGE_SIZE ?? 50);
    const startPage = options?.startPage ?? 0;

    const syncId = await createCatalogSync({ queryTerm, pageSize, startPage });
    this.syncId = syncId;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.status = "running";
    this.stats = {
      status: "running",
      syncId,
      queryTerm,
      currentPage: startPage,
      totalPages: 0,
      totalElements: 0,
      recordsUpserted: 0,
      recordsInDb: await countRegistrosAnvisa(),
      recordsErrors: 0,
      percentComplete: 0,
    };

    const scriptPath = this.resolveScriptPath();
    await insertLog({
      level: "INFO",
      message: `Iniciando sync catálogo ANVISA. syncId=${syncId}, termo=${queryTerm}, página=${startPage}, script=${scriptPath}`,
    });

    const args = [
      scriptPath,
      "--sync-id",
      String(syncId),
      "--start-page",
      String(startPage),
      "--query-term",
      queryTerm,
      "--page-size",
      String(pageSize),
    ];

    this.process = spawn("python3", args, {
      env: { ...process.env, PYTHONUNBUFFERED: "1", LOG_LEVEL: "INFO" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      void this.feedOutput(data.toString(), "stdout");
    });
    this.process.stderr?.on("data", (data: Buffer) => {
      void this.feedOutput(data.toString(), "stderr");
    });
    this.process.on("close", (code) => {
      void this.handleClose(code);
    });
    this.process.on("error", async (err) => {
      this.status = "error";
      await updateCatalogSync(syncId, {
        status: "error",
        finishedAt: new Date(),
        lastError: String(err),
      });
      this.emitUpdate();
    });

    this.emitUpdate();
    return { success: true, message: "Sincronização do catálogo iniciada." };
  }

  async stop(): Promise<{ success: boolean; message: string }> {
    if (this.status !== "running" && this.status !== "paused") {
      return { success: false, message: "Nenhuma sincronização ativa." };
    }
    this.status = "stopped";
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
    if (this.syncId) {
      await updateCatalogSync(this.syncId, { status: "stopped", finishedAt: new Date() });
      await insertLog({
        level: "WARNING",
        message: `Sync catálogo ${this.syncId} interrompido pelo usuário.`,
      });
    }
    this.emitUpdate();
    return { success: true, message: "Sincronização interrompida." };
  }

  private async feedOutput(chunk: string, stream: "stdout" | "stderr") {
    if (stream === "stdout") {
      this.stdoutBuffer += chunk;
      const lines = this.stdoutBuffer.split(/\r?\n/);
      this.stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) await this.handleLine(line);
      return;
    }
    this.stderrBuffer += chunk;
    const lines = this.stderrBuffer.split(/\r?\n/);
    this.stderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        await insertLog({ level: "INFO", message: trimmed });
      }
    }
  }

  private async handleLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.includes(" - INFO - ") || trimmed.includes(" - WARNING - ") || trimmed.includes(" - ERROR - ")) {
      await insertLog({
        level: trimmed.includes(" - ERROR - ") ? "ERROR" : trimmed.includes(" - WARNING - ") ? "WARNING" : "INFO",
        message: trimmed,
      });
    }

    if (trimmed.startsWith("CATALOG_META ")) {
      try {
        const meta = JSON.parse(trimmed.slice("CATALOG_META ".length)) as {
          totalElements?: number;
          totalPages?: number;
          queryTerm?: string;
        };
        this.stats.totalElements = meta.totalElements ?? 0;
        this.stats.totalPages = meta.totalPages ?? 0;
        if (meta.queryTerm) this.stats.queryTerm = meta.queryTerm;
        if (this.syncId) {
          await updateCatalogSync(this.syncId, {
            totalElements: this.stats.totalElements,
            totalPages: this.stats.totalPages,
            queryTerm: this.stats.queryTerm,
          });
        }
      } catch {
        /* ignore */
      }
      this.emitUpdate();
      return;
    }

    if (trimmed.startsWith("REGISTRO_BATCH ")) {
      try {
        const batch = JSON.parse(trimmed.slice("REGISTRO_BATCH ".length)) as Record<
          string,
          unknown
        >[];
        const n = await upsertRegistrosBatch(batch);
        this.stats.recordsUpserted += n;
        this.stats.recordsInDb = await countRegistrosAnvisa();
        if (this.syncId) {
          await updateCatalogSync(this.syncId, {
            recordsUpserted: this.stats.recordsUpserted,
          });
        }
      } catch (err) {
        this.stats.recordsErrors += 1;
        if (this.syncId) {
          await updateCatalogSync(this.syncId, {
            recordsErrors: this.stats.recordsErrors,
            lastError: String(err),
          });
        }
      }
      this.recalcProgress();
      this.emitUpdate();
      return;
    }

    if (trimmed.startsWith("CATALOG_PAGE ")) {
      try {
        const page = JSON.parse(trimmed.slice("CATALOG_PAGE ".length)) as { page?: number };
        if (page.page != null) {
          this.stats.currentPage = page.page;
          if (this.syncId) {
            await updateCatalogSync(this.syncId, { currentPage: page.page });
          }
        }
      } catch {
        /* ignore */
      }
      this.recalcProgress();
      this.emitUpdate();
      return;
    }

    if (trimmed.startsWith("CATALOG_ERROR ")) {
      this.stats.recordsErrors += 1;
      if (this.syncId) {
        await updateCatalogSync(this.syncId, {
          recordsErrors: this.stats.recordsErrors,
          lastError: trimmed,
        });
      }
      this.emitUpdate();
      return;
    }

    if (trimmed.startsWith("CATALOG_DONE ")) {
      this.recalcProgress();
      this.emitUpdate();
    }
  }

  private recalcProgress() {
    if (this.stats.totalPages > 0) {
      this.stats.percentComplete = Math.min(
        100,
        Math.round(((this.stats.currentPage + 1) / this.stats.totalPages) * 100)
      );
    }
  }

  private async handleClose(code: number | null) {
    this.process = null;
    const finalStatus = code === 0 ? "completed" : "error";
    this.status = finalStatus;
    this.stats.recordsInDb = await countRegistrosAnvisa();
    if (this.syncId) {
      await updateCatalogSync(this.syncId, {
        status: finalStatus,
        finishedAt: new Date(),
        recordsUpserted: this.stats.recordsUpserted,
        recordsErrors: this.stats.recordsErrors,
        currentPage: this.stats.currentPage,
      });
      await insertLog({
        level: code === 0 ? "INFO" : "ERROR",
        message: `Sync catálogo ${this.syncId} finalizado (código ${code}). Registros: ${this.stats.recordsUpserted}`,
      });
    }
    if (finalStatus === "completed") {
      this.stats.percentComplete = 100;
    }
    this.emitUpdate();
  }

  private emitUpdate() {
    this.stats.status = this.status;
    this.stats.syncId = this.syncId;
    this.emit("update", this.stats);
  }
}

export const catalogManager = new CatalogManager();
