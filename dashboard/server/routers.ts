import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getSettings, insertLog, listExecutions, listLogs, upsertSettings } from "./db";
import { processManager } from "./processManager";

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

  // ─── Settings ──────────────────────────────────────────────────────────────
  settings: router({
    get: publicProcedure.query(async () => {
      const s = await getSettings();
      return (
        s ?? {
          id: 1,
          maxFiles: 100,
          maxWorkers: 4,
          cronExpression: "0 2 1 * *",
          b2BucketName: "anvisa-manuais",
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
});

export type AppRouter = typeof appRouter;
