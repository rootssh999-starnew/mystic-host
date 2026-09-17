import type { Express, Request, Response } from "express";
import { authenticateApiToken, getDb } from "./db";
import { servers } from "../drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { nodeAction, nodeCompleteUpload, nodeCreateArchive, nodeCreateFolder, nodeDeleteFile, nodeDownloadFile, nodeInitUpload, nodeListFiles, nodeLogs, nodeStats, nodeUploadChunk, nodeUploadFile } from "./nodeAgent";
import { createManagedNodeServer, deleteNodeServer } from "./nodeAgent";
import { createJob, createPersistentServer, deletePersistentServer, updateJob, updatePersistentServer } from "./controlPlane";

const requestBuckets = new Map<string, { started: number; count: number }>();

function error(res: Response, status: number, title: string, detail: string) {
  return res.status(status).json({ errors: [{ code: `HTTP_${status}`, status: String(status), title, detail }] });
}

function hasScope(scopes: string[], required: string) {
  return scopes.includes("*") || scopes.includes(required);
}

function rateLimit(res: Response, tokenIdentity: string) {
  const now = Date.now();
  const bucket = requestBuckets.get(tokenIdentity);
  if (!bucket || now - bucket.started >= 60_000) { requestBuckets.set(tokenIdentity, { started: now, count: 1 }); return true; }
  bucket.count += 1;
  if (bucket.count > 120) { res.setHeader("Retry-After", "60"); error(res, 429, "Too Many Requests", "API rate limit exceeded."); return false; }
  return true;
}

function page(req: Request) {
  const current = Math.max(1, Number(req.query.page || 1) || 1);
  const perPage = Math.min(100, Math.max(1, Number(req.query.per_page || 20) || 20));
  return { current, perPage };
}

function resource(server: typeof servers.$inferSelect) {
  return { object: "server", attributes: { id: String(server.id), external_id: server.identifier, identifier: server.identifier, name: server.name, description: "", status: server.status, suspended: false, limits: { memory: server.memoryMb, disk: server.diskMb, cpu: server.cpu / 100 }, feature_limits: { databases: 0, allocations: 1, backups: 0 }, container: { image: server.image, startup: server.startup } } };
}

type ApiRequest = Request & { apiAuth?: Awaited<ReturnType<typeof authenticateApiToken>> };

export function registerApiRoutes(app: Express) {
  app.use(async (req, res, next) => {
    if (!req.path.startsWith("/api/application") && !req.path.startsWith("/api/client")) return next();
    const header = req.header("authorization") || "";
    if (!header.startsWith("Bearer ")) return error(res, 401, "Unauthorized", "A Bearer API token is required.");
    const token = header.slice(7).trim();
    const auth = await authenticateApiToken(token);
    if (!auth) return error(res, 401, "Unauthorized", "The API token is invalid or revoked.");
    if (!rateLimit(res, token)) return;
    const isApplication = req.path.startsWith("/api/application");
    if (isApplication && auth.user.role !== "admin") return error(res, 403, "Forbidden", "Application API access requires an administrator token.");
    (req as ApiRequest).apiAuth = auth;
    return next();
  });

  app.get(["/api/application/servers", "/api/application/v1/servers", "/api/client/servers", "/api/client/v1/servers"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth;
    if (!auth) return error(res, 401, "Unauthorized", "A Bearer API token is required.");
    if (!hasScope(auth.scopes, "servers.read")) return error(res, 403, "Forbidden", "The API token lacks the servers.read scope.");
    const db = await getDb();
    if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).orderBy(desc(servers.id));
    const isApplication = req.path.startsWith("/api/application");
    const visible = isApplication ? rows : rows.filter((server) => server.ownerId === auth.user.id);
    const search = typeof req.query.filter === "string" ? req.query.filter.toLowerCase() : typeof req.query.search === "string" ? req.query.search.toLowerCase() : "";
    const filtered = search ? visible.filter((server) => `${server.name} ${server.identifier}`.toLowerCase().includes(search)) : visible;
    const { current, perPage } = page(req);
    const offset = (current - 1) * perPage;
    const data = filtered.slice(offset, offset + perPage).map(resource);
    return res.json({ object: "list", data, meta: { pagination: { total: filtered.length, count: data.length, per_page: perPage, current_page: current, total_pages: Math.max(1, Math.ceil(filtered.length / perPage)) } } });
  });

  app.post(["/api/client/servers/:identifier/power", "/api/client/v1/servers/:identifier/power", "/api/application/servers/:identifier/power", "/api/application/v1/servers/:identifier/power"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth;
    if (!auth) return error(res, 401, "Unauthorized", "A Bearer API token is required.");
    if (!hasScope(auth.scopes, "servers.control")) return error(res, 403, "Forbidden", "The API token lacks the servers.control scope.");
    const signal = req.body?.signal;
    if (!(signal === "start" || signal === "stop" || signal === "restart")) return error(res, 422, "Validation Error", "signal must be start, stop, or restart.");
    const db = await getDb();
    if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1);
    const server = rows[0];
    const isApplication = req.path.startsWith("/api/application");
    if (!server || (!isApplication && server.ownerId !== auth.user.id)) return error(res, 404, "Not Found", "Server not found.");
    try { const result = await nodeAction(server.identifier, signal); return res.json({ object: "server", attributes: result }); }
    catch (e) { return error(res, 502, "Node Error", e instanceof Error ? e.message : "Node action failed."); }
  });

  app.post(["/api/application/servers", "/api/application/v1/servers"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth;
    if (!auth || !hasScope(auth.scopes, "servers.create")) return error(res, 403, "Forbidden", "The API token lacks the servers.create scope.");
    const input = req.body || {};
    if (typeof input.name !== "string" || typeof input.node_id !== "number" || typeof input.image !== "string" || typeof input.startup !== "string") return error(res, 422, "Validation Error", "name, node_id, image, and startup are required.");
    try {
      const server = await createPersistentServer({ ownerId: Number(input.owner_id || auth.user.id), nodeId: input.node_id, allocationId: typeof input.allocation_id === "number" ? input.allocation_id : undefined, eggId: typeof input.egg_id === "number" ? input.egg_id : undefined, name: input.name, runtime: String(input.runtime || "nodejs"), image: input.image, startup: input.startup, installScript: String(input.install_script || ""), variablesJson: typeof input.variables === "object" ? JSON.stringify(input.variables) : "{}", memoryMb: Number(input.memory || 512), diskMb: Number(input.disk || 5120), cpu: Math.round(Number(input.cpu || 100)) });
      await createManagedNodeServer({ name: server.identifier, runtime: server.runtime, image: server.image, startup: server.startup, installScript: server.installScript, memoryMb: server.memoryMb, cpu: server.cpu / 100 });
      return res.status(201).json(resource(server));
    } catch (e) { return error(res, 502, "Provisioning Error", e instanceof Error ? e.message : "Server creation failed."); }
  });

  app.patch(["/api/application/servers/:identifier", "/api/application/v1/servers/:identifier"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth;
    if (!auth || !hasScope(auth.scopes, "servers.update")) return error(res, 403, "Forbidden", "The API token lacks the servers.update scope.");
    const db = await getDb();
    if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1);
    if (!rows[0]) return error(res, 404, "Not Found", "Server not found.");
    const updated = await updatePersistentServer(rows[0].id, { name: typeof req.body?.name === "string" ? req.body.name : undefined, startup: typeof req.body?.startup === "string" ? req.body.startup : undefined, image: typeof req.body?.image === "string" ? req.body.image : undefined, memoryMb: typeof req.body?.memory === "number" ? req.body.memory : undefined, diskMb: typeof req.body?.disk === "number" ? req.body.disk : undefined, cpu: typeof req.body?.cpu === "number" ? Math.round(req.body.cpu) : undefined });
    return res.json(resource(updated));
  });

  app.delete(["/api/application/servers/:identifier", "/api/application/v1/servers/:identifier"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth;
    if (!auth || !hasScope(auth.scopes, "servers.delete")) return error(res, 403, "Forbidden", "The API token lacks the servers.delete scope.");
    const db = await getDb();
    if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1);
    if (!rows[0]) return error(res, 404, "Not Found", "Server not found.");
    await deleteNodeServer(rows[0].identifier).catch(() => {});
    await deletePersistentServer(rows[0].id);
    return res.status(204).end();
  });

  app.get(["/api/client/servers/:identifier/files", "/api/client/v1/servers/:identifier/files", "/api/application/servers/:identifier/files", "/api/application/v1/servers/:identifier/files"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth;
    if (!auth || !hasScope(auth.scopes, "files.read")) return error(res, 403, "Forbidden", "The API token lacks the files.read scope.");
    const db = await getDb();
    if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1);
    const server = rows[0];
    if (!server || (!req.path.startsWith("/api/application") && server.ownerId !== auth.user.id)) return error(res, 404, "Not Found", "Server not found.");
    try { const result = await nodeListFiles(server.identifier, typeof req.query.path === "string" ? req.query.path : undefined); return res.json({ object: "list", data: result.files.map((file) => ({ object: "file", attributes: file })) }); }
    catch (e) { return error(res, 502, "Node Error", e instanceof Error ? e.message : "File listing failed."); }
  });

  app.get(["/api/client/servers/:identifier/files/download", "/api/client/v1/servers/:identifier/files/download", "/api/application/servers/:identifier/files/download", "/api/application/v1/servers/:identifier/files/download"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth;
    if (!auth || !hasScope(auth.scopes, "files.read")) return error(res, 403, "Forbidden", "The API token lacks the files.read scope.");
    const db = await getDb();
    if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1);
    const server = rows[0];
    if (!server || (!req.path.startsWith("/api/application") && server.ownerId !== auth.user.id)) return error(res, 404, "Not Found", "Server not found.");
    const filePath = typeof req.query.file === "string" ? req.query.file : "";
    if (!filePath) return error(res, 422, "Validation Error", "file is required.");
    try { const result = await nodeDownloadFile(server.identifier, filePath); res.type("application/octet-stream").setHeader("Content-Disposition", `attachment; filename="${filePath.split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "_") || "download"}"`); return res.send(Buffer.from(result.dataBase64, "base64")); }
    catch (e) { return error(res, 502, "Node Error", e instanceof Error ? e.message : "File download failed."); }
  });

  app.post(["/api/client/servers/:identifier/files", "/api/client/v1/servers/:identifier/files", "/api/application/servers/:identifier/files", "/api/application/v1/servers/:identifier/files"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth;
    if (!auth || !hasScope(auth.scopes, "files.write")) return error(res, 403, "Forbidden", "The API token lacks the files.write scope.");
    const db = await getDb();
    if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1);
    const server = rows[0];
    if (!server || (!req.path.startsWith("/api/application") && server.ownerId !== auth.user.id)) return error(res, 404, "Not Found", "Server not found.");
    const filePath = typeof req.body?.path === "string" ? req.body.path : "";
    if (!filePath) return error(res, 422, "Validation Error", "path is required.");
    try {
      let result;
      if (req.body?.action === "create-folder") result = await nodeCreateFolder(server.identifier, filePath);
      else if (req.body?.action === "init-upload") result = await nodeInitUpload(server.identifier, filePath);
      else if (req.body?.action === "upload-chunk") result = await nodeUploadChunk(server.identifier, String(req.body.uploadId || ""), Number(req.body.index), Buffer.from(String(req.body.dataBase64 || ""), "base64"));
      else if (req.body?.action === "complete-upload") result = await nodeCompleteUpload(server.identifier, String(req.body.uploadId || ""), filePath);
      else result = await nodeUploadFile(server.identifier, filePath, Buffer.from(String(req.body?.dataBase64 || ""), "base64"));
      return res.status(201).json(result);
    }
    catch (e) { return error(res, 502, "Node Error", e instanceof Error ? e.message : "File write failed."); }
  });

  app.delete(["/api/client/servers/:identifier/files", "/api/client/v1/servers/:identifier/files", "/api/application/servers/:identifier/files", "/api/application/v1/servers/:identifier/files"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth;
    if (!auth || !hasScope(auth.scopes, "files.write")) return error(res, 403, "Forbidden", "The API token lacks the files.write scope.");
    const db = await getDb();
    if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1);
    const server = rows[0];
    if (!server || (!req.path.startsWith("/api/application") && server.ownerId !== auth.user.id)) return error(res, 404, "Not Found", "Server not found.");
    const filePath = typeof req.body?.path === "string" ? req.body.path : typeof req.query.path === "string" ? req.query.path : "";
    if (!filePath) return error(res, 422, "Validation Error", "path is required.");
    try { return res.json(await nodeDeleteFile(server.identifier, filePath)); } catch (e) { return error(res, 502, "Node Error", e instanceof Error ? e.message : "File deletion failed."); }
  });

  app.post(["/api/client/servers/:identifier/archive", "/api/client/v1/servers/:identifier/archive", "/api/application/servers/:identifier/archive", "/api/application/v1/servers/:identifier/archive"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth;
    if (!auth || !hasScope(auth.scopes, "archives.write")) return error(res, 403, "Forbidden", "The API token lacks the archives.write scope.");
    const db = await getDb();
    if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1);
    const server = rows[0];
    if (!server || (!req.path.startsWith("/api/application") && server.ownerId !== auth.user.id)) return error(res, 404, "Not Found", "Server not found.");
    const source = typeof req.body?.path === "string" ? req.body.path : "";
    if (!source) return error(res, 422, "Validation Error", "path is required.");
    const job = await createJob({ serverId: server.id, type: "file.archive", payload: { path: source } });
    await updateJob(job.id, { status: "running", progress: 10, message: "Creating archive" });
    try { const result = await nodeCreateArchive(server.identifier, source, typeof req.body?.output === "string" ? req.body.output : undefined); await updateJob(job.id, { status: "completed", progress: 100, message: "Archive created", result }); return res.status(202).json({ job: job.id, ...result }); }
    catch (e) { await updateJob(job.id, { status: "failed", progress: 100, message: "Archive failed", error: e instanceof Error ? e.message : "Archive failed" }); return error(res, 502, "Node Error", e instanceof Error ? e.message : "Archive failed"); }
  });

  app.get(["/api/client/servers/:identifier/resources", "/api/client/v1/servers/:identifier/resources", "/api/application/servers/:identifier/resources", "/api/application/v1/servers/:identifier/resources"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth;
    if (!auth || !hasScope(auth.scopes, "resources.read")) return error(res, 403, "Forbidden", "The API token lacks the resources.read scope.");
    const db = await getDb();
    if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1);
    if (!rows[0] || (!req.path.startsWith("/api/application") && rows[0].ownerId !== auth.user.id)) return error(res, 404, "Not Found", "Server not found.");
    try { return res.json({ object: "resources", attributes: await nodeStats(rows[0].identifier) }); } catch (e) { return error(res, 502, "Node Error", e instanceof Error ? e.message : "Resource query failed."); }
  });

  app.get(["/api/client/servers/:identifier/console", "/api/client/v1/servers/:identifier/console", "/api/application/servers/:identifier/console", "/api/application/v1/servers/:identifier/console"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth;
    if (!auth || !hasScope(auth.scopes, "console.read")) return error(res, 403, "Forbidden", "The API token lacks the console.read scope.");
    const db = await getDb();
    if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1);
    if (!rows[0] || (!req.path.startsWith("/api/application") && rows[0].ownerId !== auth.user.id)) return error(res, 404, "Not Found", "Server not found.");
    res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    let previous = "";
    const push = async () => { try { const result = await nodeLogs(rows[0].identifier); if (result.logs !== previous) { previous = result.logs; res.write(`event: console\ndata: ${JSON.stringify({ logs: result.logs })}\n\n`); } } catch (e) { res.write(`event: error\ndata: ${JSON.stringify({ error: e instanceof Error ? e.message : "Console stream failed" })}\n\n`); } };
    await push();
    const timer = setInterval(push, 2000);
    const close = () => { clearInterval(timer); res.end(); };
    req.on("close", close);
    setTimeout(close, 30_000);
  });
}
