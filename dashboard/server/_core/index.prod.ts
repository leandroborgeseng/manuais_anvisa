import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./static";
import { processManager } from "../processManager";
import { initScheduler } from "../scheduler";

async function startServer() {
  console.log("=== ANVISA Dashboard Server Starting ===");
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`PORT env: ${process.env.PORT}`);
  console.log(`DATABASE_URL set: ${!!process.env.DATABASE_URL}`);
  console.log(`JWT_SECRET set: ${!!process.env.JWT_SECRET}`);

  const app = express();
  const server = createServer(app);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true, service: "anvisa-dashboard" });
  });

  app.get("/api/sse/updates", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    const initial = processManager.getStats();
    res.write(`data: ${JSON.stringify(initial)}\n\n`);

    const onUpdate = (stats: unknown) => {
      res.write(`data: ${JSON.stringify(stats)}\n\n`);
    };
    processManager.on("update", onUpdate);

    const heartbeat = setInterval(() => {
      res.write(`: heartbeat\n\n`);
    }, 15000);

    req.on("close", () => {
      processManager.off("update", onUpdate);
      clearInterval(heartbeat);
    });
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  serveStatic(app);

  const port = parseInt(process.env.PORT || "3000", 10);
  const host = "0.0.0.0";

  server.listen(port, host, () => {
    console.log(`=== Server listening on ${host}:${port} ===`);
    initScheduler();
  });

  server.on("error", (err) => {
    console.error("=== Server error ===", err);
    process.exit(1);
  });
}

startServer().catch((err) => {
  console.error("=== Failed to start server ===", err);
  process.exit(1);
});
