import { and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
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
  CatalogSync,
  InsertCatalogSync,
  InsertRegistroAnvisa,
  RegistroAnvisa,
  catalogSyncs,
  downloads,
  equipamentos,
  executions,
  InsertEquipamento,
  Equipamento,
  logs,
  registrosAnvisa,
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
  if (data.nomeArquivo) {
    conditions.push(eq(equipamentos.nomeArquivo, data.nomeArquivo));
  } else if (data.pdfUrl) {
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

export async function listEquipamentos(options: {
  executionId?: number;
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ items: Equipamento[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  const conditions = [];

  if (options.executionId !== undefined) {
    conditions.push(eq(equipamentos.executionId, options.executionId));
  }
  if (options.search?.trim()) {
    const q = `%${options.search.trim()}%`;
    conditions.push(
      or(
        ilike(equipamentos.nomeProduto, q),
        ilike(equipamentos.numeroRegistro, q),
        ilike(equipamentos.processo, q),
        ilike(equipamentos.razaoSocial, q),
        ilike(equipamentos.nomeTecnico, q),
        ilike(equipamentos.nomeArquivo, q)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(equipamentos)
    .where(whereClause);

  let query = db
    .select()
    .from(equipamentos)
    .orderBy(desc(equipamentos.createdAt))
    .limit(limit)
    .offset(offset);

  if (whereClause) {
    query = query.where(whereClause) as typeof query;
  }

  const items = await query;
  return { items, total: countRow?.count ?? 0 };
}

async function getCatalogTotalEstimate(): Promise<number> {
  const envTotal = parseInt(process.env.ANVISA_CATALOG_TOTAL ?? "188764", 10);
  const db = await getDb();
  if (!db) return envTotal;

  const syncs = await db
    .select({ totalElements: catalogSyncs.totalElements })
    .from(catalogSyncs)
    .where(sql`${catalogSyncs.totalElements} > 0`)
    .orderBy(desc(catalogSyncs.startedAt))
    .limit(1);

  if (syncs[0]?.totalElements && syncs[0].totalElements > 0) {
    return syncs[0].totalElements;
  }

  const registrosCount = await countRegistrosAnvisa();
  if (registrosCount > 0) return registrosCount;

  return envTotal;
}

export async function getEquipamentosStats(executionId?: number): Promise<{
  equipamentosUnicos: number;
  totalArquivos: number;
  totalBytes: number;
  catalogTotal: number;
  percentCatalog: number;
  loteAtualEquipamentos: number;
  loteAtualArquivos: number;
  totalExecucoes: number;
}> {
  const db = await getDb();
  const catalogTotal = await getCatalogTotalEstimate();

  if (!db) {
    return {
      equipamentosUnicos: 0,
      totalArquivos: 0,
      totalBytes: 0,
      catalogTotal,
      percentCatalog: 0,
      loteAtualEquipamentos: 0,
      loteAtualArquivos: 0,
      totalExecucoes: 0,
    };
  }

  const [globalRow] = await db
    .select({
      equipamentosUnicos: sql<number>`count(distinct ${equipamentos.processo})::int`,
      totalArquivos: sql<number>`count(*)::int`,
    })
    .from(equipamentos);

  const [bytesRow] = await db
    .select({
      totalBytes: sql<number>`coalesce(sum(${downloads.sizeBytes}), 0)::bigint`,
    })
    .from(downloads)
    .where(eq(downloads.status, "concluído"));

  const [execRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(executions);

  let loteAtualEquipamentos = 0;
  let loteAtualArquivos = 0;

  if (executionId !== undefined) {
    const [batchRow] = await db
      .select({
        equipamentosUnicos: sql<number>`count(distinct ${equipamentos.processo})::int`,
        totalArquivos: sql<number>`count(*)::int`,
      })
      .from(equipamentos)
      .where(eq(equipamentos.executionId, executionId));
    loteAtualEquipamentos = batchRow?.equipamentosUnicos ?? 0;
    loteAtualArquivos = batchRow?.totalArquivos ?? 0;
  }

  const equipamentosUnicos = globalRow?.equipamentosUnicos ?? 0;
  const totalArquivos = globalRow?.totalArquivos ?? 0;
  const totalBytes = Number(bytesRow?.totalBytes ?? 0);

  return {
    equipamentosUnicos,
    totalArquivos,
    totalBytes,
    catalogTotal,
    percentCatalog: catalogTotal > 0 ? (equipamentosUnicos / catalogTotal) * 100 : 0,
    loteAtualEquipamentos,
    loteAtualArquivos,
    totalExecucoes: execRow?.total ?? 0,
  };
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

// ─── Catálogo ANVISA ──────────────────────────────────────────────────────────

function mapRegistroPayload(raw: Record<string, unknown>): InsertRegistroAnvisa {
  const meta = raw.metadataJson;
  return {
    processo: String(raw.processo ?? ""),
    numeroRegistro: raw.numeroRegistro != null ? String(raw.numeroRegistro) : undefined,
    nomeProduto: raw.nomeProduto != null ? String(raw.nomeProduto) : undefined,
    nomeTecnico: raw.nomeTecnico != null ? String(raw.nomeTecnico) : undefined,
    situacao: raw.situacao != null ? String(raw.situacao) : undefined,
    cnpjEmpresa: raw.cnpjEmpresa != null ? String(raw.cnpjEmpresa) : undefined,
    razaoSocial: raw.razaoSocial != null ? String(raw.razaoSocial) : undefined,
    autorizacaoEmpresa:
      raw.autorizacaoEmpresa != null ? String(raw.autorizacaoEmpresa) : undefined,
    riscoSigla: raw.riscoSigla != null ? String(raw.riscoSigla) : undefined,
    riscoDescricao: raw.riscoDescricao != null ? String(raw.riscoDescricao) : undefined,
    vencimentoDescricao:
      raw.vencimentoDescricao != null ? String(raw.vencimentoDescricao) : undefined,
    dataInicioVigencia: parseOptionalDate(raw.dataInicioVigencia as string | undefined),
    dataVencimento: parseOptionalDate(raw.dataVencimento as string | undefined),
    dataCancelamento: parseOptionalDate(raw.dataCancelamento as string | undefined),
    cancelado: raw.cancelado != null ? String(raw.cancelado) : undefined,
    catalogSyncId: typeof raw.catalogSyncId === "number" ? raw.catalogSyncId : undefined,
    metadataJson:
      typeof meta === "string"
        ? meta
        : meta != null
          ? JSON.stringify(meta)
          : JSON.stringify(raw),
  };
}

export async function createCatalogSync(
  data: Pick<InsertCatalogSync, "queryTerm" | "pageSize" | "startPage">
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db
    .insert(catalogSyncs)
    .values({
      queryTerm: data.queryTerm ?? "a",
      pageSize: data.pageSize ?? 50,
      startPage: data.startPage ?? 0,
      status: "running",
    })
    .returning({ id: catalogSyncs.id });
  return result[0]!.id;
}

export async function updateCatalogSync(
  id: number,
  data: Partial<Omit<CatalogSync, "id" | "startedAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(catalogSyncs).set(data).where(eq(catalogSyncs.id, id));
}

export async function getCatalogSync(id: number): Promise<CatalogSync | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(catalogSyncs).where(eq(catalogSyncs.id, id)).limit(1);
  return result[0];
}

export async function listCatalogSyncs(limit = 20): Promise<CatalogSync[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(catalogSyncs).orderBy(desc(catalogSyncs.startedAt)).limit(limit);
}

export async function upsertRegistrosBatch(
  records: Record<string, unknown>[]
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  let count = 0;
  for (const raw of records) {
    if (!raw.processo) continue;
    const values = mapRegistroPayload(raw);
    await db
      .insert(registrosAnvisa)
      .values(values)
      .onConflictDoUpdate({
        target: registrosAnvisa.processo,
        set: {
          ...values,
          updatedAt: new Date(),
        },
      });
    count += 1;
  }
  return count;
}

export async function countRegistrosAnvisa(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: sql<number>`count(*)::int` }).from(registrosAnvisa);
  return result[0]?.count ?? 0;
}

export async function listRegistrosAnvisa(options: {
  search?: string;
  situacao?: string;
  limit?: number;
  offset?: number;
}): Promise<RegistroAnvisa[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (options.situacao) {
    conditions.push(eq(registrosAnvisa.situacao, options.situacao));
  }
  if (options.search) {
    const q = `%${options.search}%`;
    conditions.push(
      or(
        ilike(registrosAnvisa.nomeProduto, q),
        ilike(registrosAnvisa.numeroRegistro, q),
        ilike(registrosAnvisa.processo, q),
        ilike(registrosAnvisa.razaoSocial, q),
        ilike(registrosAnvisa.nomeTecnico, q)
      )
    );
  }

  let query = db
    .select()
    .from(registrosAnvisa)
    .orderBy(desc(registrosAnvisa.updatedAt))
    .limit(options.limit ?? 100)
    .offset(options.offset ?? 0);

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  return query;
}

export async function getRegistrosStats(): Promise<{
  total: number;
  bySituacao: { situacao: string | null; count: number }[];
}> {
  const db = await getDb();
  if (!db) return { total: 0, bySituacao: [] };

  const total = await countRegistrosAnvisa();
  const bySituacao = await db
    .select({
      situacao: registrosAnvisa.situacao,
      count: sql<number>`count(*)::int`,
    })
    .from(registrosAnvisa)
    .groupBy(registrosAnvisa.situacao)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  return { total, bySituacao };
}
