import { and, desc, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "./db";
import { allocations, backups, databaseHosts, eggs, jobs, locations, nests, nodes, schedules, serverDatabases, serverUsers, servers, users } from "../drizzle/schema";

const identifier = () => randomBytes(12).toString("hex");
const token = () => randomBytes(32).toString("hex");

export async function listLocations() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(locations).orderBy(desc(locations.id));
}

export async function createLocation(input: { shortCode: string; description: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.insert(locations).values(input);
  const rows = await db.select().from(locations).where(eq(locations.id, Number(result[0].insertId))).limit(1);
  return rows[0];
}

export async function listNodes() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(nodes).orderBy(desc(nodes.id));
}

export async function createNode(input: Omit<typeof nodes.$inferInsert, "daemonToken">) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.insert(nodes).values({ ...input, daemonToken: token() });
  const rows = await db.select().from(nodes).where(eq(nodes.id, Number(result[0].insertId))).limit(1);
  return rows[0];
}

export async function getNode(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const rows = await db.select().from(nodes).where(eq(nodes.id, id)).limit(1);
  if (!rows[0]) throw new Error("Node not found");
  return rows[0];
}

export async function updateNodeStatus(id: number, status: "offline" | "online" | "maintenance") {
  const db = await getDb();
  if (!db) return;
  await db.update(nodes).set({ status }).where(eq(nodes.id, id));
}

export async function listAllocations(nodeId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(allocations).where(eq(allocations.nodeId, nodeId)).orderBy(allocations.port);
}

export async function createAllocation(input: typeof allocations.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.insert(allocations).values(input);
  const rows = await db.select().from(allocations).where(eq(allocations.id, Number(result[0].insertId))).limit(1);
  return rows[0];
}

export async function listNests() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(nests).orderBy(nests.name);
}

export async function listEggs(nestId?: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(eggs).where(nestId ? eq(eggs.nestId, nestId) : undefined).orderBy(eggs.name);
}

export async function seedCatalog() {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(nests).limit(1);
  if (existing.length) return;
  const nestRows = await db.insert(nests).values([
    { name: "Minecraft", description: "Minecraft server templates." },
    { name: "Source Engine", description: "Source engine dedicated server templates." },
    { name: "Voice Servers", description: "Voice server templates." },
    { name: "Rust", description: "Rust dedicated server template." },
  ]);
  const created = await db.select().from(nests).orderBy(nests.id);
  const byName = new Map(created.map((row) => [row.name, row.id]));
  await db.insert(eggs).values([
    { nestId: byName.get("Minecraft")!, name: "Vanilla Minecraft", slug: "minecraft-vanilla", image: "itzg/minecraft-server:java21", startup: "java -Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M -jar server.jar nogui", installScript: "", environmentJson: JSON.stringify({ EULA: "TRUE", TYPE: "VANILLA" }) },
    { nestId: byName.get("Source Engine")!, name: "Generic Source", slug: "source-generic", image: "cm2network/steamcmd:latest", startup: "./srcds_run -game {{GAME}} +map {{MAP}}", installScript: "", environmentJson: JSON.stringify({ GAME: "cstrike", MAP: "de_dust2" }) },
    { nestId: byName.get("Rust")!, name: "Rust", slug: "rust", image: "didstopia/rust-server:latest", startup: "./RustDedicated -batchmode +server.port {{SERVER_PORT}}", installScript: "", environmentJson: JSON.stringify({ WORLD: "Procedural Map" }) },
  ]);
}

export async function listServers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(servers).orderBy(desc(servers.createdAt));
}

export async function createPersistentServer(input: Omit<typeof servers.$inferInsert, "identifier" | "status">) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.insert(servers).values({ ...input, identifier: identifier(), status: "installing" });
  const rows = await db.select().from(servers).where(eq(servers.id, Number(result[0].insertId))).limit(1);
  return rows[0];
}

export async function getServerAccess(identifierValue: string, userId: number, role: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const rows = await db.select().from(servers).where(eq(servers.identifier, identifierValue)).limit(1);
  const server = rows[0];
  if (!server) throw new Error("Server not found");
  if (role === "admin" || server.ownerId === userId) return { server, permissions: ["*" ] };
  const memberships = await db.select().from(serverUsers).where(and(eq(serverUsers.serverId, server.id), eq(serverUsers.userId, userId))).limit(1);
  if (!memberships[0]) throw new Error("You do not have access to this server");
  let permissions: string[] = [];
  try { permissions = JSON.parse(memberships[0].permissionsJson) as string[]; } catch { permissions = []; }
  return { server, permissions };
}

export async function updateServerStatus(id: number, status: typeof servers.$inferInsert.status) {
  const db = await getDb();
  if (!db) return;
  await db.update(servers).set({ status }).where(eq(servers.id, id));
}

export async function createJob(input: { serverId?: number; type: string; payload?: unknown }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.insert(jobs).values({ serverId: input.serverId, type: input.type, status: "queued", payloadJson: JSON.stringify(input.payload ?? {}) });
  const rows = await db.select().from(jobs).where(eq(jobs.id, Number(result[0].insertId))).limit(1);
  return rows[0];
}

export async function listJobs(serverId?: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(jobs).where(serverId ? eq(jobs.serverId, serverId) : undefined).orderBy(desc(jobs.id));
}

export async function updateJob(id: number, input: { status: "queued" | "running" | "completed" | "failed" | "cancelled"; progress?: number; message?: string | null; result?: unknown; error?: string | null }) {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  await db.update(jobs).set({ status: input.status, progress: input.progress === undefined ? undefined : Math.max(0, Math.min(100, Math.round(input.progress))), message: input.message === undefined ? undefined : input.message, resultJson: input.result === undefined ? undefined : JSON.stringify(input.result), error: input.error ?? null, startedAt: input.status === "running" ? now : undefined, finishedAt: ["completed", "failed", "cancelled"].includes(input.status) ? now : undefined }).where(eq(jobs.id, id));
}

export async function listSchedules(serverId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(schedules).where(eq(schedules.serverId, serverId)).orderBy(desc(schedules.id));
}

export async function createSchedule(input: typeof schedules.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.insert(schedules).values(input);
  const rows = await db.select().from(schedules).where(eq(schedules.id, Number(result[0].insertId))).limit(1);
  return rows[0];
}

export async function listEnabledSchedules() {
  const db = await getDb();
  if (!db) return [];
  return db.select({ schedule: schedules, server: servers }).from(schedules).innerJoin(servers, eq(schedules.serverId, servers.id)).where(eq(schedules.enabled, 1));
}

export async function markScheduleRun(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(schedules).set({ lastRunAt: new Date() }).where(eq(schedules.id, id));
}

export async function updateScheduleEnabled(id: number, enabled: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(schedules).set({ enabled }).where(eq(schedules.id, id));
}
export async function listBackups(serverId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(backups).where(eq(backups.serverId, serverId)).orderBy(desc(backups.id));
}

export async function listServerMembers(serverId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ membership: serverUsers, user: users }).from(serverUsers).innerJoin(users, eq(serverUsers.userId, users.id)).where(eq(serverUsers.serverId, serverId)).orderBy(desc(serverUsers.id));
  return rows.map(({ membership, user }) => {
    let permissions: string[] = [];
    try { permissions = JSON.parse(membership.permissionsJson) as string[]; } catch { permissions = []; }
    return { id: membership.id, userId: user.id, name: user.name, email: user.email, role: user.role, permissions, createdAt: membership.createdAt };
  });
}
export async function listServerUsers(serverId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(serverUsers).where(eq(serverUsers.serverId, serverId)).orderBy(desc(serverUsers.id));
}

export async function createServerUser(input: { serverId: number; userId: number; permissions: string[] }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.insert(serverUsers).values({ serverId: input.serverId, userId: input.userId, permissionsJson: JSON.stringify(Array.from(new Set(input.permissions))) });
  const rows = await db.select().from(serverUsers).where(eq(serverUsers.id, Number(result[0].insertId))).limit(1);
  return rows[0];
}

export async function listDatabaseHosts() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(databaseHosts).orderBy(desc(databaseHosts.id));
}

export async function createDatabaseHost(input: typeof databaseHosts.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.insert(databaseHosts).values(input);
  const rows = await db.select().from(databaseHosts).where(eq(databaseHosts.id, Number(result[0].insertId))).limit(1);
  return rows[0];
}

export async function listServerDatabases(serverId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(serverDatabases).where(eq(serverDatabases.serverId, serverId)).orderBy(desc(serverDatabases.id));
}

export async function createServerDatabase(input: typeof serverDatabases.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.insert(serverDatabases).values(input);
  const rows = await db.select().from(serverDatabases).where(eq(serverDatabases.id, Number(result[0].insertId))).limit(1);
  return rows[0];
}
