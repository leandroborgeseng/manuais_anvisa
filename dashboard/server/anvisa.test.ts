import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the database helpers
vi.mock("./db", () => ({
  getSettings: vi.fn().mockResolvedValue({
    id: 1,
    maxFiles: 100,
    maxWorkers: 4,
    cronExpression: "0 2 1 * *",
    b2BucketName: "anvisa-manuais",
    updatedAt: new Date(),
  }),
  upsertSettings: vi.fn().mockResolvedValue(undefined),
  listExecutions: vi.fn().mockResolvedValue([
    {
      id: 1,
      startedAt: new Date("2026-01-01T02:00:00Z"),
      finishedAt: new Date("2026-01-01T03:00:00Z"),
      status: "completed",
      totalFound: 100,
      totalCompleted: 95,
      totalErrors: 5,
      manifestKey: null,
      manifestUrl: null,
    },
  ]),
  listLogs: vi.fn().mockResolvedValue([
    {
      id: 1,
      executionId: 1,
      level: "INFO",
      message: "Processo iniciado",
      createdAt: new Date(),
    },
  ]),
  insertLog: vi.fn().mockResolvedValue(undefined),
  upsertUser: vi.fn().mockResolvedValue(undefined),
  getUserByOpenId: vi.fn().mockResolvedValue(undefined),
}));

// Mock processManager
vi.mock("./processManager", () => ({
  processManager: {
    getStats: vi.fn().mockReturnValue({
      status: "idle",
      executionId: null,
      totalFound: 0,
      totalCompleted: 0,
      totalErrors: 0,
      percentComplete: 0,
      currentSpeed: 0,
      b2SpaceUsed: 0,
      downloads: [],
    }),
    getStatus: vi.fn().mockReturnValue("idle"),
    start: vi.fn().mockResolvedValue({ success: true, message: "Processo iniciado com sucesso." }),
    pause: vi.fn().mockResolvedValue({ success: false, message: "Processo não está em execução." }),
    resume: vi.fn().mockResolvedValue({ success: false, message: "Processo não está pausado." }),
    stop: vi.fn().mockResolvedValue({ success: false, message: "Processo não está ativo." }),
    retryDownload: vi.fn().mockResolvedValue({ success: false, message: "Download não encontrado." }),
  },
}));

function createCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("settings.get", () => {
  it("retorna as configurações padrão", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.settings.get();
    expect(result.maxFiles).toBe(100);
    expect(result.maxWorkers).toBe(4);
    expect(result.cronExpression).toBe("0 2 1 * *");
    expect(result.b2BucketName).toBe("anvisa-manuais");
  });
});

describe("settings.update", () => {
  it("atualiza configurações com valores válidos", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.settings.update({ maxFiles: 500, maxWorkers: 8 });
    expect(result.success).toBe(true);
  });

  it("rejeita maxFiles inválido (0)", async () => {
    const caller = appRouter.createCaller(createCtx());
    await expect(caller.settings.update({ maxFiles: 0 })).rejects.toThrow();
  });

  it("rejeita maxWorkers inválido (acima de 32)", async () => {
    const caller = appRouter.createCaller(createCtx());
    await expect(caller.settings.update({ maxWorkers: 100 })).rejects.toThrow();
  });
});

describe("history.list", () => {
  it("retorna lista de execuções", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.history.list({ limit: 10 });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].status).toBe("completed");
    expect(result[0].totalFound).toBe(100);
    expect(result[0].totalCompleted).toBe(95);
  });
});

describe("logs.list", () => {
  it("retorna logs sem filtros", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.logs.list({ limit: 50 });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].level).toBe("INFO");
  });

  it("aceita filtro por nível INFO", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.logs.list({ level: "INFO", limit: 50 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("aceita filtro por nível ERROR", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.logs.list({ level: "ERROR", limit: 50 });
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("dashboard.stats", () => {
  it("retorna estatísticas do dashboard", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.dashboard.stats();
    expect(result.status).toBe("idle");
    expect(result.totalFound).toBe(0);
    expect(result.downloads).toEqual([]);
  });
});

describe("process controls", () => {
  it("start retorna sucesso quando idle", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.process.start();
    expect(result.success).toBe(true);
    expect(result.message).toContain("iniciado");
  });

  it("pause retorna falha quando não está rodando", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.process.pause();
    expect(result.success).toBe(false);
  });

  it("resume retorna falha quando não está pausado", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.process.resume();
    expect(result.success).toBe(false);
  });

  it("stop retorna falha quando idle", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.process.stop();
    expect(result.success).toBe(false);
  });

  it("retryDownload retorna falha para id inexistente", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.process.retryDownload({ downloadId: 99999 });
    expect(result.success).toBe(false);
  });
});

describe("auth.logout", () => {
  it("limpa o cookie de sessão e retorna sucesso", async () => {
    const clearedCookies: string[] = [];
    const ctx: TrpcContext = {
      user: {
        id: 1,
        openId: "test-user",
        email: "test@example.com",
        name: "Test User",
        loginMethod: "manus",
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {
        clearCookie: (name: string) => clearedCookies.push(name),
      } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);
    expect(clearedCookies.length).toBe(1);
  });
});
