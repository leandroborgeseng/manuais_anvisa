import {
  bigint,
  integer,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["user", "admin"]);
export const executionStatusEnum = pgEnum("execution_status", [
  "running",
  "paused",
  "stopped",
  "completed",
  "error",
]);
export const downloadStatusEnum = pgEnum("download_status", [
  "aguardando",
  "baixando",
  "enviando para B2",
  "concluído",
  "erro",
]);
export const logLevelEnum = pgEnum("log_level", ["INFO", "WARNING", "ERROR"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
  lastSignedIn: timestamp("lastSignedIn", { mode: "date" }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const executions = pgTable("executions", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("startedAt", { mode: "date" }).defaultNow().notNull(),
  finishedAt: timestamp("finishedAt", { mode: "date" }),
  status: executionStatusEnum("status").default("running").notNull(),
  totalFound: integer("totalFound").default(0).notNull(),
  totalCompleted: integer("totalCompleted").default(0).notNull(),
  totalErrors: integer("totalErrors").default(0).notNull(),
  manifestKey: varchar("manifestKey", { length: 512 }),
  manifestUrl: varchar("manifestUrl", { length: 1024 }),
});

export type Execution = typeof executions.$inferSelect;
export type InsertExecution = typeof executions.$inferInsert;

export const downloads = pgTable("downloads", {
  id: serial("id").primaryKey(),
  executionId: integer("executionId").notNull(),
  filename: varchar("filename", { length: 512 }).notNull(),
  url: text("url").notNull(),
  status: downloadStatusEnum("status").default("aguardando").notNull(),
  progress: real("progress").default(0).notNull(),
  sizeBytes: bigint("sizeBytes", { mode: "number" }).default(0).notNull(),
  b2Key: varchar("b2Key", { length: 512 }),
  errorMessage: text("errorMessage"),
  startedAt: timestamp("startedAt", { mode: "date" }),
  completedAt: timestamp("completedAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
});

export type Download = typeof downloads.$inferSelect;
export type InsertDownload = typeof downloads.$inferInsert;

// Metadados do equipamento (API ANVISA) vinculados ao manual/PDF
export const equipamentos = pgTable("equipamentos", {
  id: serial("id").primaryKey(),
  executionId: integer("executionId"),
  downloadId: integer("downloadId"),
  processo: varchar("processo", { length: 32 }).notNull(),
  numeroRegistro: varchar("numeroRegistro", { length: 64 }),
  nomeProduto: varchar("nomeProduto", { length: 512 }),
  nomeTecnico: text("nomeTecnico"),
  situacao: varchar("situacao", { length: 128 }),
  cnpjEmpresa: varchar("cnpjEmpresa", { length: 18 }),
  razaoSocial: text("razaoSocial"),
  autorizacaoEmpresa: varchar("autorizacaoEmpresa", { length: 32 }),
  riscoSigla: varchar("riscoSigla", { length: 16 }),
  riscoDescricao: varchar("riscoDescricao", { length: 128 }),
  vencimentoDescricao: varchar("vencimentoDescricao", { length: 128 }),
  vencimentoVencido: varchar("vencimentoVencido", { length: 8 }),
  dataInicioVigencia: timestamp("dataInicioVigencia", { mode: "date" }),
  dataVencimento: timestamp("dataVencimento", { mode: "date" }),
  dataCancelamento: timestamp("dataCancelamento", { mode: "date" }),
  cancelado: varchar("cancelado", { length: 8 }),
  tipoAnexo: varchar("tipoAnexo", { length: 256 }),
  nomeArquivo: varchar("nomeArquivo", { length: 512 }),
  dataEnvioAnexo: timestamp("dataEnvioAnexo", { mode: "date" }),
  pdfUrl: text("pdfUrl"),
  b2MetaKey: varchar("b2MetaKey", { length: 512 }),
  fabricantesJson: text("fabricantesJson"),
  metadataJson: text("metadataJson"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
});

export type Equipamento = typeof equipamentos.$inferSelect;
export type InsertEquipamento = typeof equipamentos.$inferInsert;

// Catálogo completo ANVISA (fase 1 — inventário)
export const catalogSyncs = pgTable("catalog_syncs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("startedAt", { mode: "date" }).defaultNow().notNull(),
  finishedAt: timestamp("finishedAt", { mode: "date" }),
  status: executionStatusEnum("status").default("running").notNull(),
  queryTerm: varchar("queryTerm", { length: 64 }).default("a").notNull(),
  pageSize: integer("pageSize").default(50).notNull(),
  startPage: integer("startPage").default(0).notNull(),
  currentPage: integer("currentPage").default(0).notNull(),
  totalElements: integer("totalElements").default(0).notNull(),
  totalPages: integer("totalPages").default(0).notNull(),
  recordsUpserted: integer("recordsUpserted").default(0).notNull(),
  recordsErrors: integer("recordsErrors").default(0).notNull(),
  lastError: text("lastError"),
});

export type CatalogSync = typeof catalogSyncs.$inferSelect;
export type InsertCatalogSync = typeof catalogSyncs.$inferInsert;

export const registrosAnvisa = pgTable("registros_anvisa", {
  id: serial("id").primaryKey(),
  processo: varchar("processo", { length: 32 }).notNull().unique(),
  numeroRegistro: varchar("numeroRegistro", { length: 64 }),
  nomeProduto: varchar("nomeProduto", { length: 512 }),
  nomeTecnico: text("nomeTecnico"),
  situacao: varchar("situacao", { length: 128 }),
  cnpjEmpresa: varchar("cnpjEmpresa", { length: 18 }),
  razaoSocial: text("razaoSocial"),
  autorizacaoEmpresa: varchar("autorizacaoEmpresa", { length: 32 }),
  riscoSigla: varchar("riscoSigla", { length: 16 }),
  riscoDescricao: varchar("riscoDescricao", { length: 128 }),
  vencimentoDescricao: varchar("vencimentoDescricao", { length: 128 }),
  dataInicioVigencia: timestamp("dataInicioVigencia", { mode: "date" }),
  dataVencimento: timestamp("dataVencimento", { mode: "date" }),
  dataCancelamento: timestamp("dataCancelamento", { mode: "date" }),
  cancelado: varchar("cancelado", { length: 8 }),
  catalogSyncId: integer("catalogSyncId"),
  metadataJson: text("metadataJson"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
});

export type RegistroAnvisa = typeof registrosAnvisa.$inferSelect;
export type InsertRegistroAnvisa = typeof registrosAnvisa.$inferInsert;

export const logs = pgTable("logs", {
  id: serial("id").primaryKey(),
  executionId: integer("executionId"),
  level: logLevelEnum("level").default("INFO").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

export type Log = typeof logs.$inferSelect;
export type InsertLog = typeof logs.$inferInsert;

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  maxFiles: integer("maxFiles").default(10000).notNull(),
  maxWorkers: integer("maxWorkers").default(4).notNull(),
  cronExpression: varchar("cronExpression", { length: 128 }).default("0 2 1 * *").notNull(),
  b2BucketName: varchar("b2BucketName", { length: 256 }).default("anvisa-manuais").notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
});

export type Settings = typeof settings.$inferSelect;
export type InsertSettings = typeof settings.$inferInsert;
