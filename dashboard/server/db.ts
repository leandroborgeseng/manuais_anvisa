import { and, desc, eq, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  Download,
  Execution,
  InsertDownload,
  InsertExecution,
  InsertLog,
  InsertUser,
  Log,
  Settings,
  downloads,
  equipamentos,
  executions,
  InsertEquipamento,
  Equipamento,
  logs,
  settings,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _pool: pg.Pool | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

function pgSslConfig(connectionString: string) {
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  return isLocal ? undefined : { rejectUnauthorized: false as const };
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: pgSslConfig(process.env.DATABASE_URL),
      });
      _db = drizzle(_pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
      _pool = null;
    }
  }
  return _db;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onConflictDoUpdate({
    target: users.openId,
    set: updateSet,
  });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Executions ───────────────────────────────────────────────────────────────

export async function createExecution(): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db
    .insert(executions)
    .values({ status: "running" })
    .returning({ id: executions.id });
  return result[0]!.id;
}

export async function getExecution(id: number): Promise<Execution | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(executions).where(eq(executions.id, id)).limit(1);
  return result[0];
}

export async function getActiveExecution(): Promise<Execution | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(executions)
    .where(and(eq(executions.status, "running")))
    .orderBy(desc(executions.startedAt))
    .limit(1);
  return result[0];
}

export async function updateExecution(
  id: number,
  data: Partial<Omit<Execution, "id">>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(executions).set(data).where(eq(executions.id, id));
}

export async function listExecutions(limit = 20): Promise<Execution[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(executions).orderBy(desc(executions.startedAt)).limit(limit);
}

// ─── Downloads ────────────────────────────────────────────────────────────────

export async function createDownload(data: InsertDownload): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(downloads).values(data).returning({ id: downloads.id });
  return result[0]!.id;
}

export async function updateDownload(
  id: number,
  data: Partial<Omit<Download, "id">>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(downloads).set(data).where(eq(downloads.id, id));
}

export async function listDownloadsByExecution(executionId: number): Promise<Download[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(downloads)
    .where(eq(downloads.executionId, executionId))
    .orderBy(desc(downloads.createdAt))
    .limit(500);
}

export async function getDownload(id: number): Promise<Download | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(downloads).where(eq(downloads.id, id)).limit(1);
  return result[0];
}

function parseOptionalDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─── Equipamentos (metadados ANVISA) ──────────────────────────────────────────

export async function upsertEquipamento(
  data: InsertEquipamento & {
    pdfFilename?: string;
  }
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const values: InsertEquipamento = {
    executionId: data.executionId,
    downloadId: data.downloadId,
    processo: data.processo,
    numeroRegistro: data.numeroRegistro,
    nomeProduto: data.nomeProduto,
    nomeTecnico: data.nomeTecnico,
    situacao: data.situacao,
    cnpjEmpresa: data.cnpjEmpresa,
    razaoSocial: data.razaoSocial,
    autorizacaoEmpresa: data.autorizacaoEmpresa,
    riscoSigla: data.riscoSigla,
    riscoDescricao: data.riscoDescricao,
    vencimentoDescricao: data.vencimentoDescricao,
    vencimentoVencido: data.vencimentoVencido,
    dataInicioVigencia: data.dataInicioVigencia,
    dataVencimento: data.dataVencimento,
    dataCancelamento: data.dataCancelamento,
    cancelado: data.cancelado,
    tipoAnexo: data.tipoAnexo,
    nomeArquivo: data.nomeArquivo,
    dataEnvioAnexo: data.dataEnvioAnexo,
    pdfUrl: data.pdfUrl,
    b2MetaKey: data.b2MetaKey,
    fabricantesJson: data.fabricantesJson,
    metadataJson: data.metadataJson,
  };

  const conditions = [eq(equipamentos.processo, data.processo)];
  if (data.executionId != null) {
    conditions.push(eq(equipamentos.executionId, data.executionId));
  }
  if (data.pdfUrl) {
    conditions.push(eq(equipamentos.pdfUrl, data.pdfUrl));
  }

  const existing = await db
    .select()
    .from(equipamentos)
    .where(and(...conditions))
    .limit(1);

  if (existing[0]) {
    await db.update(equipamentos).set(values).where(eq(equipamentos.id, existing[0].id));
    return existing[0].id;
  }

  const result = await db.insert(equipamentos).values(values).returning({ id: equipamentos.id });
  return result[0]!.id;
}

export async function upsertEquipamentoFromPayload(
  executionId: number,
  payload: Record<string, unknown>
): Promise<number> {
  const id = await upsertEquipamento({
    executionId,
    downloadId: typeof payload.downloadId === "number" ? payload.downloadId : undefined,
    processo: String(payload.processo ?? ""),
    numeroRegistro: payload.numeroRegistro ? String(payload.numeroRegistro) : undefined,
    nomeProduto: payload.nomeProduto ? String(payload.nomeProduto) : undefined,
    nomeTecnico: payload.nomeTecnico ? String(payload.nomeTecnico) : undefined,
    situacao: payload.situacao ? String(payload.situacao) : undefined,
    cnpjEmpresa: payload.cnpjEmpresa ? String(payload.cnpjEmpresa) : undefined,
    razaoSocial: payload.razaoSocial ? String(payload.razaoSocial) : undefined,
    autorizacaoEmpresa: payload.autorizacaoEmpresa ? String(payload.autorizacaoEmpresa) : undefined,
    riscoSigla: payload.riscoSigla ? String(payload.riscoSigla) : undefined,
    riscoDescricao: payload.riscoDescricao ? String(payload.riscoDescricao) : undefined,
    vencimentoDescricao: payload.vencimentoDescricao ? String(payload.vencimentoDescricao) : undefined,
    vencimentoVencido:
      payload.vencimentoVencido != null ? String(payload.vencimentoVencido) : undefined,
    dataInicioVigencia: parseOptionalDate(payload.dataInicioVigencia as string | undefined),
    dataVencimento: parseOptionalDate(payload.dataVencimento as string | undefined),
    dataCancelamento: parseOptionalDate(payload.dataCancelamento as string | undefined),
    cancelado: payload.cancelado != null ? String(payload.cancelado) : undefined,
    tipoAnexo: payload.tipoAnexo ? String(payload.tipoAnexo) : undefined,
    nomeArquivo: payload.nomeArquivo ? String(payload.nomeArquivo) : undefined,
    dataEnvioAnexo: parseOptionalDate(payload.dataEnvioAnexo as string | undefined),
    pdfUrl: payload.pdfUrl ? String(payload.pdfUrl) : undefined,
    b2MetaKey: payload.b2MetaKey ? String(payload.b2MetaKey) : undefined,
    fabricantesJson: payload.fabricantes
      ? JSON.stringify(payload.fabricantes)
      : payload.fabricantesJson
        ? String(payload.fabricantesJson)
        : undefined,
    metadataJson: JSON.stringify(payload),
  });

  const pdfFilename = payload.pdfFilename ? String(payload.pdfFilename) : undefined;
  if (pdfFilename && executionId) {
    const dl = await dbGetDownloadByFilename(executionId, pdfFilename);
    if (dl) {
      await linkEquipamentoToDownload(id, dl.id);
    }
  }

  return id;
}

async function dbGetDownloadByFilename(executionId: number, filename: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(downloads)
    .where(and(eq(downloads.executionId, executionId), eq(downloads.filename, filename)))
    .limit(1);
  return result[0];
}

export async function linkEquipamentoToDownload(
  equipamentoId: number,
  downloadId: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(equipamentos)
    .set({ downloadId })
    .where(eq(equipamentos.id, equipamentoId));
}

export async function linkEquipamentoToDownloadByFilename(
  executionId: number,
  pdfFilename: string,
  downloadId: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const rows = await db
    .select()
    .from(equipamentos)
    .where(eq(equipamentos.executionId, executionId));

  for (const row of rows) {
    if (!row.metadataJson) continue;
    try {
      const meta = JSON.parse(row.metadataJson) as { pdfFilename?: string };
      if (meta.pdfFilename === pdfFilename) {
        await linkEquipamentoToDownload(row.id, downloadId);
        return;
      }
    } catch {
      /* ignore invalid json */
    }
  }
}

export async function listEquipamentos(
  executionId?: number,
  limit = 200
): Promise<Equipamento[]> {
  const db = await getDb();
  if (!db) return [];
  const query = db.select().from(equipamentos).orderBy(desc(equipamentos.createdAt)).limit(limit);
  if (executionId !== undefined) {
    return query.where(eq(equipamentos.executionId, executionId));
  }
  return query;
}

export async function getEquipamentoByDownload(downloadId: number): Promise<Equipamento | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(equipamentos)
    .where(eq(equipamentos.downloadId, downloadId))
    .limit(1);
  return result[0];
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

export async function insertLog(data: InsertLog): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(logs).values(data);
}

export async function listLogs(
  executionId?: number,
  level?: "INFO" | "WARNING" | "ERROR",
  limit = 200
): Promise<Log[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (executionId !== undefined) conditions.push(eq(logs.executionId, executionId));
  if (level) conditions.push(eq(logs.level, level));

  const query = db
    .select()
    .from(logs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(logs.createdAt))
    .limit(limit);

  const result = await query;
  return result.reverse();
}

export async function listRecentLogs(since: Date, executionId?: number): Promise<Log[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [gte(logs.createdAt, since)];
  if (executionId !== undefined) conditions.push(eq(logs.executionId, executionId));
  return db
    .select()
    .from(logs)
    .where(and(...conditions))
    .orderBy(desc(logs.createdAt))
    .limit(100);
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<Settings | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(settings).limit(1);
  return result[0];
}

export async function upsertSettings(
  data: Partial<Omit<Settings, "id" | "updatedAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await getSettings();
  if (existing) {
    await db.update(settings).set(data).where(eq(settings.id, existing.id));
  } else {
    await db.insert(settings).values({
      maxFiles: data.maxFiles ?? 100,
      maxWorkers: data.maxWorkers ?? 4,
      cronExpression: data.cronExpression ?? "0 2 1 * *",
      b2BucketName: data.b2BucketName ?? "anvisa-manuais",
    });
  }
}
