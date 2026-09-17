import type { Express, Request, Response } from "express";
import { authenticateApiToken, getDb } from "./db";
import { servers } from "../drizzle/schema";
import { desc } from "drizzle-orm";

function error(res: Response, status: number, title: string, detail: string) {
  return res.status(status).json({ errors: [{ code: `HTTP_${status}`, status: String(status), title, detail }] });
}

function page(req: Request) {
  const current = Math.max(1, Number(req.query.page || 1) || 1);
  const perPage = Math.min(100, Math.max(1, Number(req.query.per_page || 20) || 20));
  return { current, perPage };
}

function resource(server: typeof servers.$inferSelect) {
  return { object: "server", attributes: { id: String(server.id), external_id: server.identifier, identifier: server.identifier, name: server.name, description: "", status: server.status, suspended: false, limits: { memory: server.memoryMb, disk: server.diskMb, cpu: server.cpu / 100 }, feature_limits: { databases: 0, allocations: 1, backups: 0 }, container: { image: server.image, startup: server.startup } } };
}

export function registerApiRoutes(app: Express) {
  app.use(async (req, res, next) => {
    if (!req.path.startsWith("/api/application") && !req.path.startsWith("/api/client")) return next();
    const header = req.header("authorization") || "";
    if (!header.startsWith("Bearer ")) return error(res, 401, "Unauthorized", "A Bearer API token is required.");
    const auth = await authenticateApiToken(header.slice(7).trim());
    if (!auth) return error(res, 401, "Unauthorized", "The API token is invalid or revoked.");
    const isApplication = req.path.startsWith("/api/application");
    if (isApplication && auth.user.role !== "admin") return error(res, 403, "Forbidden", "Application API access requires an administrator token.");
    (req as Request & { apiAuth?: typeof auth }).apiAuth = auth;
    return next();
  });

  app.get(["/api/application/servers", "/api/application/v1/servers", "/api/client/servers", "/api/client/v1/servers"], async (req, res) => {
    const auth = (req as Request & { apiAuth?: Awaited<ReturnType<typeof authenticateApiToken>> }).apiAuth;
    if (!auth) return error(res, 401, "Unauthorized", "A Bearer API token is required.");
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
}
