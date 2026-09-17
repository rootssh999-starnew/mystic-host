import { and, desc, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "./db";
import { normalizePermissions } from "@shared/permissions";
import { allocations, backups, databaseHosts, eggs, jobs, locations, nests, nodes, scheduleRuns, schedules, serverDatabases, serverUsers, servers, teamMembers, teams, users } from "../drizzle/schema";
import { assertServerStatusTransition, type ServerStatus } from "@shared/serverLifecycle";

const identifier = () => randomBytes(12).toString("hex");
const token = () => randomBytes(32).toString("hex");
const activeOperations = new Map<number, string>();

export function acquireServerOperation(serverId: number, operation: string) {
  const active = activeOperations.get(serverId);
  if (active) throw new Error(`Server is busy with ${active}`);
  activeOperations.set(serverId, operation);
}

export function releaseServerOperation(serverId: number) {
  activeOperations.delete(serverId);
}

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

export async function createNest(input: { name: string; description: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.insert(nests).values(input);
  const rows = await db.select().from(nests).where(eq(nests.id, Number(result[0].insertId))).limit(1);
  return rows[0];
}

export async function updateNest(id: number, input: { name?: string; description?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(nests).set(input).where(eq(nests.id, id));
  const rows = await db.select().from(nests).where(eq(nests.id, id)).limit(1);
  return rows[0];
}

export async function deleteNest(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const linked = await db.select({ id: eggs.id }).from(eggs).where(eq(eggs.nestId, id)).limit(1);
  if (linked.length) throw new Error("Cannot delete a nest that still contains eggs");
  await db.delete(nests).where(eq(nests.id, id));
  return { success: true } as const;
}

export async function createEgg(input: typeof eggs.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.insert(eggs).values(input);
  const rows = await db.select().from(eggs).where(eq(eggs.id, Number(result[0].insertId))).limit(1);
  return rows[0];
}

export async function updateEgg(id: number, input: Partial<Pick<typeof eggs.$inferInsert, "nestId" | "name" | "slug" | "image" | "startup" | "installScript" | "environmentJson">>) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(eggs).set(input).where(eq(eggs.id, id));
  const rows = await db.select().from(eggs).where(eq(eggs.id, id)).limit(1);
  return rows[0];
}

export async function deleteEgg(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.delete(eggs).where(eq(eggs.id, id));
  return { success: true } as const;
}

export async function seedCatalog() {
  const db = await getDb();
  if (!db) return;
  const nestSeeds = [
    { name: "Minecraft", description: "Minecraft Java and Bedrock dedicated server templates." },
    { name: "Source Engine", description: "Source and Source 2 dedicated server templates." },
    { name: "Voice Servers", description: "TeamSpeak, Mumble, and voice server templates." },
    { name: "Rust", description: "Rust dedicated server templates." },
    { name: "Terraria", description: "Terraria and tModLoader server templates." },
    { name: "Steam Games", description: "Generic SteamCMD dedicated server templates." },
  ];
  const existingNests = await db.select().from(nests);
  const existingNestNames = new Set(existingNests.map((row) => row.name));
  const missingNests = nestSeeds.filter((nest) => !existingNestNames.has(nest.name));
  if (missingNests.length) await db.insert(nests).values(missingNests);
  const created = await db.select().from(nests);
  const byName = new Map(created.map((row) => [row.name, row.id]));
  const eggSeeds = [
    { nest: "Minecraft", name: "Vanilla Minecraft Java", slug: "minecraft-vanilla-java", image: "itzg/minecraft-server:java21", startup: "java -Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M -jar server.jar nogui", installScript: "mkdir -p /workspace && if [ ! -f /workspace/server.jar ]; then curl -fsSL https://piston-meta.mojang.com/mc/game/version_manifest_v2.json -o /tmp/manifest.json; VERSION=$(printf '%s' \"{{MINECRAFT_VERSION}}\" ); URL=$(node -e \"const m=require('/tmp/manifest.json'); console.log(m.versions.find(v=>v.id===process.argv[1])?.url||'')\" \"$VERSION\"); curl -fsSL \"$URL\" -o /tmp/version.json; curl -fsSL \"$(node -e \"console.log(require('/tmp/version.json').downloads.server.url)\")\" -o /workspace/server.jar; fi; printf 'eula=true\\n' > /workspace/eula.txt", environment: { MINECRAFT_VERSION: "1.21.8", SERVER_MEMORY: "2048" } },
    { nest: "Minecraft", name: "Minecraft Bedrock", slug: "minecraft-bedrock", image: "itzg/minecraft-bedrock-server", startup: "LD_LIBRARY_PATH=. ./bedrock_server", installScript: "mkdir -p /workspace", environment: { VERSION: "LATEST", SERVER_MEMORY: "2048" } },
    { nest: "Source Engine", name: "Counter-Strike 2", slug: "source-2-cs2", image: "cm2network/steamcmd:root", startup: "./game/bin/linuxsteamrt64/cs2 -dedicated -port {{SERVER_PORT}} +map {{MAP}}", installScript: "steamcmd +force_install_dir /workspace +login anonymous +app_update 730 validate +quit", environment: { MAP: "de_dust2", SERVER_PORT: "27015" } },
    { nest: "Rust", name: "Rust Dedicated", slug: "rust-dedicated", image: "didstopia/rust-server:latest", startup: "./RustDedicated -batchmode +server.port {{SERVER_PORT}} +server.identity {{SERVER_IDENTITY}}", installScript: "mkdir -p /workspace", environment: { SERVER_PORT: "28015", SERVER_IDENTITY: "mystic" } },
    { nest: "Terraria", name: "Terraria Vanilla", slug: "terraria-vanilla", image: "ryshe/terraria:latest", startup: "./TerrariaServer.bin.x86_64 -config /workspace/serverconfig.txt", installScript: "mkdir -p /workspace; test -f /workspace/serverconfig.txt || printf 'world=/workspace/world.wld\\nautocreate=2\\n' > /workspace/serverconfig.txt", environment: { MAX_PLAYERS: "16" } },
    { nest: "Voice Servers", name: "Mumble", slug: "mumble", image: "mumblevoip/mumble-server:latest", startup: "./mumble-server -fg", installScript: "mkdir -p /workspace", environment: { MUMBLE_SUPERUSER_PASSWORD: "change-me" } },
    { nest: "Steam Games", name: "Generic SteamCMD", slug: "steamcmd-generic", image: "cm2network/steamcmd:root", startup: "{{STARTUP_COMMAND}}", installScript: "steamcmd +force_install_dir /workspace +login anonymous +app_update {{STEAM_APP_ID}} validate +quit", environment: { STEAM_APP_ID: "90", STARTUP_COMMAND: "./hlds_run -game cstrike -port {{SERVER_PORT}}", SERVER_PORT: "27015" } },
  ];
  const existingEggs = await db.select({ slug: eggs.slug }).from(eggs);
  const existingSlugs = new Set(existingEggs.map((row) => row.slug));
  const missingEggs = eggSeeds.filter((egg) => !existingSlugs.has(egg.slug)).map((egg) => ({ nestId: byName.get(egg.nest)!, name: egg.name, slug: egg.slug, image: egg.image, startup: egg.startup, installScript: egg.installScript, environmentJson: JSON.stringify(egg.environment) }));
  if (missingEggs.length) await db.insert(eggs).values(missingEggs);
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

export async function updatePersistentServer(id: number, input: Partial<Pick<typeof servers.$inferInsert, "name" | "startup" | "image" | "memoryMb" | "diskMb" | "cpu">>) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(servers).set(input).where(eq(servers.id, id));
  const rows = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
  return rows[0];
}

export async function deletePersistentServer(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.delete(servers).where(eq(servers.id, id));
  return { success: true } as const;
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
  try { permissions = normalizePermissions(JSON.parse(memberships[0].permissionsJson) as string[]); } catch { permissions = []; }
  return { server, permissions };
}

export async function updateServerStatus(id: number, status: typeof servers.$inferInsert.status) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const rows = await db.select({ status: servers.status }).from(servers).where(eq(servers.id, id)).limit(1);
  const current = rows[0]?.status;
  if (!current) throw new Error("Server not found");
  assertServerStatusTransition(current as ServerStatus, status as ServerStatus);
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
export async function createScheduleRun(scheduleId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.insert(scheduleRuns).values({ scheduleId, status: "running" });
  return Number(result[0].insertId);
}
export async function finishScheduleRun(id: number, status: "completed" | "failed", error?: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(scheduleRuns).set({ status, error: error || null, finishedAt: new Date() }).where(eq(scheduleRuns.id, id));
}
export async function listScheduleRuns(scheduleId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(scheduleRuns).where(eq(scheduleRuns.scheduleId, scheduleId)).orderBy(desc(scheduleRuns.id)).limit(100);
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
    try { permissions = normalizePermissions(JSON.parse(membership.permissionsJson) as string[]); } catch { permissions = []; }
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
  const result = await db.insert(serverUsers).values({ serverId: input.serverId, userId: input.userId, permissionsJson: JSON.stringify(normalizePermissions(input.permissions)) });
  const rows = await db.select().from(serverUsers).where(eq(serverUsers.id, Number(result[0].insertId))).limit(1);
  return rows[0];
}

export async function updateServerUser(id: number, permissions: string[]) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(serverUsers).set({ permissionsJson: JSON.stringify(normalizePermissions(permissions)) }).where(eq(serverUsers.id, id));
  const rows = await db.select().from(serverUsers).where(eq(serverUsers.id, id)).limit(1);
  return rows[0];
}

export async function deleteServerUser(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.delete(serverUsers).where(eq(serverUsers.id, id));
  return { success: true } as const;
}

export async function listTeams(ownerId: number) { const db = await getDb(); if (!db) return []; return db.select().from(teams).where(eq(teams.ownerId, ownerId)).orderBy(desc(teams.id)); }
export async function createTeam(input: { ownerId: number; name: string; description: string }) { const db = await getDb(); if (!db) throw new Error("Database is not available"); const result = await db.insert(teams).values(input); await db.insert(teamMembers).values({ teamId: Number(result[0].insertId), userId: input.ownerId, role: "owner" }); const rows = await db.select().from(teams).where(eq(teams.id, Number(result[0].insertId))).limit(1); return rows[0]; }
export async function listTeamMembers(teamId: number) { const db = await getDb(); if (!db) return []; return db.select({ membership: teamMembers, user: users }).from(teamMembers).innerJoin(users, eq(teamMembers.userId, users.id)).where(eq(teamMembers.teamId, teamId)).orderBy(desc(teamMembers.id)); }
export async function addTeamMember(input: { teamId: number; userId: number; role: "manager" | "member" }) { const db = await getDb(); if (!db) throw new Error("Database is not available"); const result = await db.insert(teamMembers).values(input); const rows = await db.select().from(teamMembers).where(eq(teamMembers.id, Number(result[0].insertId))).limit(1); return rows[0]; }
export async function updateTeamMember(id: number, role: "manager" | "member") { const db = await getDb(); if (!db) throw new Error("Database is not available"); await db.update(teamMembers).set({ role }).where(eq(teamMembers.id, id)); const rows = await db.select().from(teamMembers).where(eq(teamMembers.id, id)).limit(1); return rows[0]; }
export async function deleteTeamMember(id: number) { const db = await getDb(); if (!db) throw new Error("Database is not available"); await db.delete(teamMembers).where(eq(teamMembers.id, id)); return { success: true } as const; }

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

export async function updateServerDatabase(id: number, input: Partial<Pick<typeof serverDatabases.$inferInsert, "username" | "password">>) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(serverDatabases).set(input).where(eq(serverDatabases.id, id));
  const rows = await db.select().from(serverDatabases).where(eq(serverDatabases.id, id)).limit(1);
  return rows[0];
}
export async function deleteServerDatabase(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.delete(serverDatabases).where(eq(serverDatabases.id, id));
  return { success: true } as const;
}
