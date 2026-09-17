import type { Express, Request, Response } from "express";
import { authenticateApiToken, getDb } from "./db";
import { serverDatabases, serverUsers, servers } from "../drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { nodeAction, nodeBackups, nodeCompleteUpload, nodeCreateArchive, nodeCreateBackup, nodeCreateDatabase, nodeCreateFolder, nodeDeleteBackup, nodeDeleteDatabase, nodeDeleteFile, nodeDownloadFile, nodeInitUpload, nodeListFiles, nodeLogs, nodeRestoreBackup, nodeRotateDatabasePassword, nodeStats, nodeUploadChunk, nodeUploadFile } from "./nodeAgent";
import { createManagedNodeServer, deleteNodeServer } from "./nodeAgent";
import { createJob, createPersistentServer, createServerDatabase, deletePersistentServer, deleteServerDatabase, deleteServerUser, listServerMembers, updateJob, updatePersistentServer, updateServerDatabase, updateServerUser } from "./controlPlane";
import { hasApiScope } from "@shared/apiScopes";

const requestBuckets = new Map<string, { started: number; count: number }>();

function error(res: Response, status: number, title: string, detail: string) {
  return res.status(status).json({ errors: [{ code: `HTTP_${status}`, status: String(status), title, detail }] });
}

function hasScope(scopes: string[], required: string) {
  try { return hasApiScope(scopes, required); } catch { return false; }
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

  app.get(["/api/client/servers/:identifier/backups", "/api/client/v1/servers/:identifier/backups", "/api/application/servers/:identifier/backups", "/api/application/v1/servers/:identifier/backups"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth;
    if (!auth || !hasScope(auth.scopes, "backups.read")) return error(res, 403, "Forbidden", "The API token lacks the backups.read scope.");
    const db = await getDb(); if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1); const server = rows[0];
    if (!server || (!req.path.startsWith("/api/application") && server.ownerId !== auth.user.id)) return error(res, 404, "Not Found", "Server not found.");
    try { const result = await nodeBackups(server.identifier); return res.json({ object: "list", data: result.backups.map((backup) => ({ object: "backup", attributes: backup })) }); } catch (e) { return error(res, 502, "Node Error", e instanceof Error ? e.message : "Backup listing failed."); }
  });

  app.post(["/api/client/servers/:identifier/backups", "/api/client/v1/servers/:identifier/backups", "/api/application/servers/:identifier/backups", "/api/application/v1/servers/:identifier/backups"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth;
    if (!auth || !hasScope(auth.scopes, "backups.create")) return error(res, 403, "Forbidden", "The API token lacks the backups.create scope.");
    const db = await getDb(); if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1); const server = rows[0];
    if (!server || (!req.path.startsWith("/api/application") && server.ownerId !== auth.user.id)) return error(res, 404, "Not Found", "Server not found.");
    const job = await createJob({ serverId: server.id, type: "backup.create", payload: {} }); await updateJob(job.id, { status: "running", progress: 10, message: "Creating backup" });
    try { const result = await nodeCreateBackup(server.identifier); await updateJob(job.id, { status: "completed", progress: 100, message: "Backup created", result }); return res.status(202).json({ job: job.id, ...result }); } catch (e) { await updateJob(job.id, { status: "failed", progress: 100, message: "Backup failed", error: e instanceof Error ? e.message : "Backup failed" }); return error(res, 502, "Node Error", e instanceof Error ? e.message : "Backup failed"); }
  });

  app.delete(["/api/client/servers/:identifier/backups", "/api/client/v1/servers/:identifier/backups", "/api/application/servers/:identifier/backups", "/api/application/v1/servers/:identifier/backups"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth;
    if (!auth || !hasScope(auth.scopes, "backups.delete")) return error(res, 403, "Forbidden", "The API token lacks the backups.delete scope.");
    const db = await getDb(); if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1); const server = rows[0];
    if (!server || (!req.path.startsWith("/api/application") && server.ownerId !== auth.user.id)) return error(res, 404, "Not Found", "Server not found.");
    const name = typeof req.body?.name === "string" ? req.body.name : ""; if (!name) return error(res, 422, "Validation Error", "name is required.");
    try { return res.json(await nodeDeleteBackup(server.identifier, name)); } catch (e) { return error(res, 502, "Node Error", e instanceof Error ? e.message : "Backup deletion failed."); }
  });

  app.post(["/api/client/servers/:identifier/backups/restore", "/api/client/v1/servers/:identifier/backups/restore", "/api/application/servers/:identifier/backups/restore", "/api/application/v1/servers/:identifier/backups/restore"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth;
    if (!auth || !hasScope(auth.scopes, "backups.restore")) return error(res, 403, "Forbidden", "The API token lacks the backups.restore scope.");
    const db = await getDb(); if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1); const server = rows[0];
    if (!server || (!req.path.startsWith("/api/application") && server.ownerId !== auth.user.id)) return error(res, 404, "Not Found", "Server not found.");
    const name = typeof req.body?.name === "string" ? req.body.name : ""; if (!name) return error(res, 422, "Validation Error", "name is required.");
    const job = await createJob({ serverId: server.id, type: "backup.restore", payload: { name } }); await updateJob(job.id, { status: "running", progress: 10, message: "Restoring backup" });
    try { const result = await nodeRestoreBackup(server.identifier, name, typeof req.body?.checksum === "string" ? req.body.checksum : undefined); await updateJob(job.id, { status: "completed", progress: 100, message: "Backup restored", result }); return res.status(202).json({ job: job.id, ...result }); } catch (e) { await updateJob(job.id, { status: "failed", progress: 100, message: "Restore failed", error: e instanceof Error ? e.message : "Restore failed" }); return error(res, 502, "Node Error", e instanceof Error ? e.message : "Restore failed"); }
  });

  app.get(["/api/client/servers/:identifier/databases", "/api/client/v1/servers/:identifier/databases", "/api/application/servers/:identifier/databases", "/api/application/v1/servers/:identifier/databases"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth; if (!auth || !hasScope(auth.scopes, "databases.read")) return error(res, 403, "Forbidden", "The API token lacks the databases.read scope.");
    const db = await getDb(); if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1); const server = rows[0];
    if (!server || (!req.path.startsWith("/api/application") && server.ownerId !== auth.user.id)) return error(res, 404, "Not Found", "Server not found.");
    const databases = await db.select({ id: serverDatabases.id, name: serverDatabases.name, username: serverDatabases.username, hostId: serverDatabases.hostId, createdAt: serverDatabases.createdAt }).from(serverDatabases).where(eq(serverDatabases.serverId, server.id));
    return res.json({ object: "list", data: databases.map((database) => ({ object: "database", attributes: database })) });
  });

  app.post(["/api/client/servers/:identifier/databases", "/api/client/v1/servers/:identifier/databases", "/api/application/servers/:identifier/databases", "/api/application/v1/servers/:identifier/databases"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth; if (!auth || !hasScope(auth.scopes, "databases.create")) return error(res, 403, "Forbidden", "The API token lacks the databases.create scope.");
    const db = await getDb(); if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1); const server = rows[0];
    if (!server || (!req.path.startsWith("/api/application") && server.ownerId !== auth.user.id)) return error(res, 404, "Not Found", "Server not found.");
    const name = typeof req.body?.name === "string" ? req.body.name : ""; const username = typeof req.body?.username === "string" ? req.body.username : "app"; const password = typeof req.body?.password === "string" ? req.body.password : ""; const hostId = Number(req.body?.host_id || 0);
    if (!name || !password || !hostId) return error(res, 422, "Validation Error", "name, password, and host_id are required.");
    try { const result = await nodeCreateDatabase(server.identifier, name, username, password); const record = await createServerDatabase({ serverId: server.id, hostId, name, username, password }); return res.status(201).json({ object: "database", attributes: { id: record.id, name: record.name, username: record.username, host: result.host, port: result.port } }); } catch (e) { return error(res, 502, "Node Error", e instanceof Error ? e.message : "Database creation failed."); }
  });

  app.delete(["/api/client/servers/:identifier/databases/:database", "/api/client/v1/servers/:identifier/databases/:database", "/api/application/servers/:identifier/databases/:database", "/api/application/v1/servers/:identifier/databases/:database"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth; if (!auth || !hasScope(auth.scopes, "databases.delete")) return error(res, 403, "Forbidden", "The API token lacks the databases.delete scope.");
    const db = await getDb(); if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1); const server = rows[0];
    if (!server || (!req.path.startsWith("/api/application") && server.ownerId !== auth.user.id)) return error(res, 404, "Not Found", "Server not found.");
    const records = await db.select().from(serverDatabases).where(eq(serverDatabases.serverId, server.id)); const record = records.find((item) => item.name === req.params.database); if (!record) return error(res, 404, "Not Found", "Database not found.");
    try { await nodeDeleteDatabase(server.identifier, record.name); await deleteServerDatabase(record.id); return res.json({ success: true }); } catch (e) { return error(res, 502, "Node Error", e instanceof Error ? e.message : "Database deletion failed."); }
  });

  app.post(["/api/client/servers/:identifier/databases/:database/rotate-password", "/api/client/v1/servers/:identifier/databases/:database/rotate-password", "/api/application/servers/:identifier/databases/:database/rotate-password", "/api/application/v1/servers/:identifier/databases/:database/rotate-password"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth; if (!auth || !hasScope(auth.scopes, "databases.update")) return error(res, 403, "Forbidden", "The API token lacks the databases.update scope.");
    const db = await getDb(); if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1); const server = rows[0];
    if (!server || (!req.path.startsWith("/api/application") && server.ownerId !== auth.user.id)) return error(res, 404, "Not Found", "Server not found.");
    const records = await db.select().from(serverDatabases).where(eq(serverDatabases.serverId, server.id)); const record = records.find((item) => item.name === req.params.database); if (!record) return error(res, 404, "Not Found", "Database not found.");
    const oldPassword = String(req.body?.old_password || ""); const newPassword = String(req.body?.new_password || ""); if (!oldPassword || newPassword.length < 12) return error(res, 422, "Validation Error", "Valid old_password and new_password are required.");
    try { const result = await nodeRotateDatabasePassword(server.identifier, record.name, record.username, oldPassword, newPassword); await updateServerDatabase(record.id, { password: newPassword }); return res.json(result); } catch (e) { return error(res, 502, "Node Error", e instanceof Error ? e.message : "Password rotation failed."); }
  });

  app.get(["/api/application/servers/:identifier/members", "/api/application/v1/servers/:identifier/members"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth; if (!auth || !hasScope(auth.scopes, "members.read")) return error(res, 403, "Forbidden", "The API token lacks the members.read scope.");
    const db = await getDb(); if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const rows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1); if (!rows[0]) return error(res, 404, "Not Found", "Server not found.");
    const members = await listServerMembers(rows[0].id); return res.json({ object: "list", data: members.map((member) => ({ object: "member", attributes: member })) });
  });

  app.patch(["/api/application/servers/:identifier/members/:memberId", "/api/application/v1/servers/:identifier/members/:memberId"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth; if (!auth || !hasScope(auth.scopes, "members.update")) return error(res, 403, "Forbidden", "The API token lacks the members.update scope.");
    const db = await getDb(); if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const serverRows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1); const server = serverRows[0]; if (!server) return error(res, 404, "Not Found", "Server not found.");
    const memberId = Number(req.params.memberId); const rows = await db.select().from(serverUsers).where(eq(serverUsers.id, memberId)).limit(1); if (!rows[0] || rows[0].serverId !== server.id) return error(res, 404, "Not Found", "Member not found.");
    const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions.filter((value: unknown): value is string => typeof value === "string").slice(0, 50) : []; if (!permissions.length) return error(res, 422, "Validation Error", "permissions must contain at least one value.");
    return res.json({ object: "member", attributes: await updateServerUser(memberId, permissions) });
  });

  app.delete(["/api/application/servers/:identifier/members/:memberId", "/api/application/v1/servers/:identifier/members/:memberId"], async (req: ApiRequest, res) => {
    const auth = req.apiAuth; if (!auth || !hasScope(auth.scopes, "members.delete")) return error(res, 403, "Forbidden", "The API token lacks the members.delete scope.");
    const db = await getDb(); if (!db) return error(res, 503, "Unavailable", "The database is unavailable.");
    const serverRows = await db.select().from(servers).where(eq(servers.identifier, req.params.identifier)).limit(1); const server = serverRows[0]; if (!server) return error(res, 404, "Not Found", "Server not found.");
    const memberId = Number(req.params.memberId); if (!Number.isInteger(memberId) || memberId < 1) return error(res, 422, "Validation Error", "Invalid member id.");
    const memberRows = await db.select().from(serverUsers).where(eq(serverUsers.id, memberId)).limit(1); if (!memberRows[0] || memberRows[0].serverId !== server.id) return error(res, 404, "Not Found", "Member not found.");
    return res.json(await deleteServerUser(memberId));
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
