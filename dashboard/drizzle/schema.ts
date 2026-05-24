import {
  bigint,
  float,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Execuções do processo de download
export const executions = mysqlTable("executions", {
  id: int("id").autoincrement().primaryKey(),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  finishedAt: timestamp("finishedAt"),
  status: mysqlEnum("status", ["running", "paused", "stopped", "completed", "error"])
    .default("running")
    .notNull(),
  totalFound: int("totalFound").default(0).notNull(),
  totalCompleted: int("totalCompleted").default(0).notNull(),
  totalErrors: int("totalErrors").default(0).notNull(),
  manifestKey: varchar("manifestKey", { length: 512 }),
  manifestUrl: varchar("manifestUrl", { length: 1024 }),
});

export type Execution = typeof executions.$inferSelect;
export type InsertExecution = typeof executions.$inferInsert;

// Downloads individuais
export const downloads = mysqlTable("downloads", {
  id: int("id").autoincrement().primaryKey(),
  executionId: int("executionId").notNull(),
  filename: varchar("filename", { length: 512 }).notNull(),
  url: text("url").notNull(),
  status: mysqlEnum("status", ["aguardando", "baixando", "enviando para B2", "concluído", "erro"])
    .default("aguardando")
    .notNull(),
  progress: float("progress").default(0).notNull(),
  sizeBytes: bigint("sizeBytes", { mode: "number" }).default(0).notNull(),
  b2Key: varchar("b2Key", { length: 512 }),
  errorMessage: text("errorMessage"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Download = typeof downloads.$inferSelect;
export type InsertDownload = typeof downloads.$inferInsert;

// Logs do processo
export const logs = mysqlTable("logs", {
  id: int("id").autoincrement().primaryKey(),
  executionId: int("executionId"),
  level: mysqlEnum("level", ["INFO", "WARNING", "ERROR"]).default("INFO").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Log = typeof logs.$inferSelect;
export type InsertLog = typeof logs.$inferInsert;

// Configurações do sistema
export const settings = mysqlTable("settings", {
  id: int("id").autoincrement().primaryKey(),
  maxFiles: int("maxFiles").default(100).notNull(),
  maxWorkers: int("maxWorkers").default(4).notNull(),
  cronExpression: varchar("cronExpression", { length: 128 }).default("0 2 1 * *").notNull(),
  b2BucketName: varchar("b2BucketName", { length: 256 }).default("anvisa-manuais").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Settings = typeof settings.$inferSelect;
export type InsertSettings = typeof settings.$inferInsert;
