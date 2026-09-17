import type { Express, Request, Response } from "express";
import { authenticateApiToken, getDb } from "./db";
import { servers } from "../drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { nodeAction } from "./nodeAgent";

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
}
