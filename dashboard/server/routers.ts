import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getSettings, insertLog, listEquipamentos, getEquipamentosStats, getDownloadsStorageStats, listExecutions, listLogs, upsertSettings, listRegistrosAnvisa, getRegistrosStats, listCatalogSyncs, countRegistrosAnvisa } from "./db";
import { processManager } from "./processManager";
import { catalogManager } from "./catalogManager";
import { getB2BucketStats, resolveB2BucketName } from "./b2Storage";
import { getOverallProgress } from "./progress";
import { getSchedulerStatus } from "./scheduler";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Dashboard ─────────────────────────────────────────────────────────────
  dashboard: router({
    stats: publicProcedure.query(async () => {
      return processManager.getStats();
    }),

    overallProgress: publicProcedure.query(async () => {
      return getOverallProgress();
    }),

    scheduler: publicProcedure.query(() => {
      return getSchedulerStatus();
    }),
  }),

  // ─── Process Controls ──────────────────────────────────────────────────────
  process: router({
    start: publicProcedure.mutation(async () => {
      return processManager.start();
    }),

    pause: publicProcedure.mutation(async () => {
      return processManager.pause();
    }),

    resume: publicProcedure.mutation(async () => {
      return processManager.resume();
    }),

    stop: publicProcedure.mutation(async () => {
      return processManager.stop();
    }),

    retryDownload: publicProcedure
      .input(z.object({ downloadId: z.number() }))
      .mutation(async ({ input }) => {
        return processManager.retryDownload(input.downloadId);
      }),

    status: publicProcedure.query(() => {
      return { status: processManager.getStatus() };
    }),
  }),

  // ─── Logs ──────────────────────────────────────────────────────────────────
  logs: router({
    list: publicProcedure
      .input(
        z.object({
          executionId: z.number().optional(),
          level: z.enum(["INFO", "WARNING", "ERROR"]).optional(),
          limit: z.number().default(200),
        })
      )
      .query(async ({ input }) => {
        return listLogs(input.executionId, input.level, input.limit);
      }),
  }),

  // ─── Armazenamento B2 ──────────────────────────────────────────────────────
  storage: router({
    stats: publicProcedure.query(async () => {
      const settings = await getSettings();
      const settingsBucket = settings?.b2BucketName;
      const resolved = await resolveB2BucketName(settingsBucket);
      const bucketName = resolved.bucketName;

      if (settingsBucket && settingsBucket !== bucketName) {
        await upsertSettings({ b2BucketName: bucketName }).catch(() => undefined);
      }

      const [dbStats, b2Stats] = await Promise.all([
        getDownloadsStorageStats(),
        getB2BucketStats(bucketName),
      ]);

      return {
        bucketName,
        bucketSource: resolved.source,
        settingsBucketName: settingsBucket ?? null,
        availableBuckets: resolved.availableBuckets,
        db: dbStats,
        b2: {
          configured: b2Stats.configured,
          ok: b2Stats.ok,
          totalBytes: b2Stats.totalBytes,
          fileCount: b2Stats.fileCount,
          prefix: b2Stats.prefix,
          scannedAt: b2Stats.scannedAt,
          error: b2Stats.error,
        },
      };
    }),
  }),

  // ─── Settings ──────────────────────────────────────────────────────────────
  settings: router({
    get: publicProcedure.query(async () => {
      const s = await getSettings();
      return (
        s ?? {
          id: 1,
          maxFiles: 10000,
          maxWorkers: 4,
          cronExpression: "0 2 1 * *",
          b2BucketName: "discorailway",
          autoRunEnabled: true,
          autoRunDelayMinutes: 10,
          updatedAt: new Date(),
        }
      );
    }),

    update: publicProcedure
      .input(
        z.object({
          maxFiles: z.number().min(1).max(10000).optional(),
          maxWorkers: z.number().min(1).max(32).optional(),
          cronExpression: z.string().optional(),
          b2BucketName: z.string().optional(),
          autoRunEnabled: z.boolean().optional(),
          autoRunDelayMinutes: z.number().min(1).max(1440).optional(),
        })
      )
      .mutation(async ({ input }) => {
        await upsertSettings(input);
        await insertLog({
          level: "INFO",
          message: `Configurações atualizadas: ${JSON.stringify(input)}`,
        });
        return { success: true };
      }),
  }),

  // ─── History ───────────────────────────────────────────────────────────────
  history: router({
    list: publicProcedure
      .input(z.object({ limit: z.number().default(20) }))
      .query(async ({ input }) => {
        return listExecutions(input.limit);
      }),
  }),

  // ─── Equipamentos (metadados ANVISA) ───────────────────────────────────────
  equipamentos: router({
    stats: publicProcedure
      .input(z.object({ executionId: z.number().optional() }).nullish())
      .query(async ({ input }) => {
        return getEquipamentosStats(input?.executionId);
      }),

    list: publicProcedure
      .input(
        z.object({
          executionId: z.number().optional(),
          search: z.string().optional(),
          limit: z.number().min(1).max(500).default(100),
          offset: z.number().min(0).default(0),
        })
      )
      .query(async ({ input }) => {
        return listEquipamentos(input);
      }),
  }),

  // ─── Catálogo ANVISA (inventário completo) ───────────────────────────────────
  catalog: router({
    stats: publicProcedure.query(async () => {
      const live = catalogManager.getStats();
      const inDb = await countRegistrosAnvisa();
      return { ...live, recordsInDb: inDb };
    }),

    registrosStats: publicProcedure.query(async () => {
      return getRegistrosStats();
    }),

    list: publicProcedure
      .input(
        z.object({
          search: z.string().optional(),
          situacao: z.string().optional(),
          limit: z.number().default(100),
          offset: z.number().default(0),
        })
      )
      .query(async ({ input }) => {
        return listRegistrosAnvisa(input);
      }),

    syncHistory: publicProcedure
      .input(z.object({ limit: z.number().default(10) }))
      .query(async ({ input }) => {
        return listCatalogSyncs(input.limit);
      }),

    startSync: publicProcedure
      .input(
        z
          .object({
            startPage: z.number().min(0).optional(),
            queryTerm: z.string().optional(),
            pageSize: z.number().min(10).max(100).optional(),
          })
          .optional()
      )
      .mutation(async ({ input }) => {
        return catalogManager.start(input ?? undefined);
      }),

    stopSync: publicProcedure.mutation(async () => {
      return catalogManager.stop();
    }),
  }),
});

export type AppRouter = typeof appRouter;
