import { getSettings, insertLog, listRecentLogs } from "./db";
import { processManager } from "./processManager";

const BOOT_DELAY_MS = 45_000;
const TICK_MS = 60_000;
const STORAGE_CAP_COOLDOWN_MS = 6 * 60 * 60 * 1000;

let started = false;
let nextRunTimer: NodeJS.Timeout | null = null;
let storageCapPausedUntil = 0;
let lastScheduledMessage = "";

function envAutoRunDefault(): boolean {
  const v = process.env.ANVISA_AUTO_RUN?.trim().toLowerCase();
  if (v === "false" || v === "0") return false;
  return true;
}

export async function isAutoRunEnabled(): Promise<boolean> {
  const cfg = await getSettings();
  if (cfg?.autoRunEnabled !== undefined) return cfg.autoRunEnabled;
  return envAutoRunDefault();
}

function clearNextRunTimer() {
  if (nextRunTimer) {
    clearTimeout(nextRunTimer);
    nextRunTimer = null;
  }
}

async function recentStorageCapError(): Promise<boolean> {
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const logs = await listRecentLogs(since);
  return logs.some((l) =>
    l.message.toLowerCase().includes("storage cap exceeded")
  );
}

export function cancelScheduledBatch() {
  clearNextRunTimer();
  lastScheduledMessage = "Agendamento cancelado.";
}

export function getSchedulerStatus() {
  return {
    enabled: started,
    nextRunAt: nextRunTimer ? new Date(Date.now() + getRemainingMs()).toISOString() : null,
    storageCapPausedUntil:
      storageCapPausedUntil > Date.now()
        ? new Date(storageCapPausedUntil).toISOString()
        : null,
    lastMessage: lastScheduledMessage,
    processStatus: processManager.getStatus(),
  };
}

let remainingMs = 0;
function getRemainingMs() {
  return remainingMs;
}

async function scheduleNextBatch(reason: string, delayMinutes?: number) {
  clearNextRunTimer();

  const enabled = await isAutoRunEnabled();
  if (!enabled) {
    lastScheduledMessage = "Execução automática desativada nas configurações.";
    return;
  }

  if (storageCapPausedUntil > Date.now()) {
    lastScheduledMessage = `Pausado até ${new Date(storageCapPausedUntil).toLocaleString("pt-BR")} (limite B2).`;
    return;
  }

  const cfg = await getSettings();
  const delayMin = delayMinutes ?? cfg?.autoRunDelayMinutes ?? 10;
  remainingMs = Math.max(1, delayMin) * 60 * 1000;

  lastScheduledMessage = `Próximo lote em ${delayMin} min (${reason}).`;
  console.log(`[scheduler] ${lastScheduledMessage}`);

  nextRunTimer = setTimeout(() => {
    void tryStartBatch("timer");
  }, remainingMs);
}

async function tryStartBatch(trigger: string) {
  clearNextRunTimer();
  const status = processManager.getStatus();

  if (status === "stopped") {
    lastScheduledMessage = "Parado manualmente — automação suspensa até novo início.";
    return;
  }

  if (status === "running" || status === "paused") {
    lastScheduledMessage = "Download já em execução.";
    return;
  }

  const enabled = await isAutoRunEnabled();
  if (!enabled) return;

  if (storageCapPausedUntil > Date.now()) return;

  if (await recentStorageCapError()) {
    storageCapPausedUntil = Date.now() + STORAGE_CAP_COOLDOWN_MS;
    lastScheduledMessage =
      "Limite de armazenamento B2 detectado — pausa automática de 6 horas.";
    await insertLog({
      level: "WARNING",
      message: lastScheduledMessage,
    });
    return;
  }

  const result = await processManager.start();
  lastScheduledMessage = `[${trigger}] ${result.message}`;
  console.log(`[scheduler] ${lastScheduledMessage}`);

  if (!result.success) {
    await scheduleNextBatch("retry após falha ao iniciar", 30);
  }
}

export function initScheduler() {
  if (started) return;
  started = true;

  processManager.on("batchFinished", (payload: { code: number | null }) => {
    const delay =
      payload.code === 0
        ? undefined
        : 30;
    void scheduleNextBatch(
      payload.code === 0 ? "lote concluído" : "lote com erro",
      delay
    );
  });

  setTimeout(() => {
    void tryStartBatch("boot");
  }, BOOT_DELAY_MS);

  setInterval(() => {
    const status = processManager.getStatus();
    if (
      (status === "idle" || status === "completed" || status === "error") &&
      !nextRunTimer
    ) {
      void tryStartBatch("watchdog");
    }
  }, TICK_MS);

  console.log("[scheduler] Modo autônomo ativo (Railway 24/7).");
}
