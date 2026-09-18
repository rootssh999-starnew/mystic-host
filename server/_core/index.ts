import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { startScheduler } from "../scheduler";
import { nodeLogs } from "../nodeAgent";
import { sdk } from "./sdk";
import { registerLocalAuthRoutes } from "../localAuth";
import { registerApiRoutes } from "../api";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { getServerAccess } from "../controlPlane";
import { hasPermission } from "@shared/permissions";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

const apiRateWindowMs = 60_000;
const apiRateLimit = 120;
const apiRateBuckets = new Map<string, { startedAt: number; count: number }>();
function enforceApiRateLimit(req: Request, res: Response, next: NextFunction) { const key = req.ip || req.socket.remoteAddress || "unknown"; const now = Date.now(); const current = apiRateBuckets.get(key); if (!current || now - current.startedAt >= apiRateWindowMs) { apiRateBuckets.set(key, { startedAt: now, count: 1 }); return next(); } current.count += 1; if (current.count > apiRateLimit) { res.setHeader("Retry-After", "60"); return res.status(429).json({ error: "API rate limit exceeded; try again shortly" }); } return next(); }

async function startServer() {
  startScheduler();
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerLocalAuthRoutes(app);
  registerApiRoutes(app);
  app.get("/api/servers/:name/events", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user) return res.status(401).end();
      const access = await getServerAccess(req.params.name, user.id, user.role);
      if (!hasPermission(access.permissions, "console")) return res.status(403).end();
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(`event: ready\ndata: ${JSON.stringify({ server: access.server.identifier })}\n\n`);
      let polling = false;
      const send = async () => {
        if (polling || res.writableEnded) return;
        polling = true;
        try { const result = await nodeLogs(req.params.name); res.write(`event: logs\ndata: ${JSON.stringify(result)}\n\n`); } catch (error) { res.write(`event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : "Stream failed" })}\n\n`); }
        finally { polling = false; }
      };
      await send();
      const timer = setInterval(() => void send(), 2000);
      const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(": heartbeat\n\n"); }, 15000);
      req.on("close", () => { clearInterval(timer); clearInterval(heartbeat); });
    } catch { res.status(401).end(); }
  });
  // tRPC API
  app.use("/api/trpc", enforceApiRateLimit);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
