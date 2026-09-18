import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { billingPlans, runtimeTemplates } from "@shared/catalog";
import { createApiKey, createInvitation, createStoredFile, recordAuditEvent, listAuditEvents, deleteStoredFile, getAdminOverview, getStoredFile, invalidateUserSessions, listApiKeys, listInvitations, listStoredFiles, listUsers, renameStoredFile, revokeApiKey, revokeInvitation, updateUserAdmin } from "./db";
import { storagePut } from "./storage";
import { createManagedNodeServer, createNodeServer, listNodeServers, nodeAction, nodeBackups, nodeCancelInstall, nodeCommand, nodeCreateBackup, nodeCreateDatabase, nodeCreateFolder, nodeDeleteBackup, nodeDeleteDatabase, nodeDeleteFile, nodeDownloadFile, nodeRenameFile, nodeExtractZip, nodeHealth, nodeInstallStatus, nodeListFiles, nodeListDatabases, nodeLogs, nodeReinstallServer, nodeResources, nodeRestoreBackup, nodeRotateDatabasePassword, nodeStats, nodeUploadFile, nodeSftpCredentials } from "./nodeAgent";
import { acquireServerOperation, addTeamMember, createAllocation, createBackupRecord, createDatabaseHost, createEgg, createJob, createLocation, createNest, createNode, createPersistentServer, createSchedule, createScheduleRun, createServerDatabase, createServerUser, createTeam, deleteSchedule, finishScheduleRun, listAccessibleServers, updateSchedule, deleteEgg, deleteNest, deleteServerDatabase, deleteServerUser, deleteTeamMember, getNode, getNodeCapacity, getServerDatabase, listAllocations, listBackups, listDatabaseHosts, listEggs, listJobs, listLocations, listNests, listNodeCapacities, listNodes, listScheduleRuns, listSchedules, listServerDatabases, listServerMembers, listServerUsers, listServers, listTeamMembers, listTeams, releaseServerOperation, seedCatalog, updateBackupRecord, updateEgg, updateJob, updateNest, updatePersistentServer, updateScheduleEnabled, updateNodeStatus, updateServerDatabase, updateServerStatus, updateServerUser, updateTeamMember, getServerAccess } from "./controlPlane";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { missingEggVariables, parseEggVariables, renderEggTemplate } from "@shared/eggEngine";
import { hasPermission } from "@shared/permissions";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

async function requireServerPermission(ctx: { user: { id: number; role: string } }, name: string, permission: string) { const access = await getServerAccess(name, ctx.user.id, ctx.user.role); if (!hasPermission(access.permissions, permission)) throw new TRPCError({ code: "FORBIDDEN", message: `Missing server permission: ${permission}` }); return access.server; }
function safeRelativeFilePath(value: string) { const parts = value.split("/").filter(Boolean); if (!parts.length || parts.some((part) => part === "." || part === "..")) throw new Error("Invalid file path"); return parts.map(safeFileName).join("/"); }
function safeFileName(value: string) {
  const trimmed = value.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  return trimmed.slice(0, 180) || "uploaded-file";
}

function decodeDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("File payload must be a base64 data URL");
  const [, mimeType, encoded] = match;
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length) throw new Error("File payload is empty");
  if (buffer.byteLength > MAX_UPLOAD_BYTES) throw new Error("Files must be 10 MB or smaller");
  return { mimeType, buffer };
}

export const appRouter = router({
  system: systemRouter,
  catalog: router({
    runtimes: publicProcedure.query(() => runtimeTemplates),
    plans: publicProcedure.query(() => billingPlans),
  }),
  servers: router({
    mine: protectedProcedure.query(({ ctx }) => listAccessibleServers(ctx.user.id, ctx.user.role)),
  }),
  auth: router({
    me: publicProcedure.query(opts => {
      if (!opts.ctx.user) return null;
      const user = opts.ctx.user;
      return { id: user.id, openId: user.openId, name: user.name, email: user.email, loginMethod: user.loginMethod, role: user.role, createdAt: user.createdAt, updatedAt: user.updatedAt, lastSignedIn: user.lastSignedIn };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    logoutAllSessions: protectedProcedure.mutation(async ({ ctx }) => { await invalidateUserSessions(ctx.user.id); await recordAuditEvent({ userId: ctx.user.id, action: "auth.logout_all", detail: "All user sessions invalidated" }); const cookieOptions = getSessionCookieOptions(ctx.req); ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 }); return { success: true } as const; }),
    apiKeys: router({
      list: protectedProcedure.query(({ ctx }) => listApiKeys(ctx.user.id)),
      create: protectedProcedure.input(z.object({ name: z.string().min(1).max(100), scopes: z.array(z.string().min(1).max(100)).min(1).max(50) })).mutation(async ({ ctx, input }) => { const result = await createApiKey(ctx.user.id, input.name, input.scopes); await recordAuditEvent({ userId: ctx.user.id, action: "api_key.created", detail: `API key created: ${input.name}`, metadata: { scopes: input.scopes } }); return result; }),
      revoke: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const result = await revokeApiKey(ctx.user.id, input.id); await recordAuditEvent({ userId: ctx.user.id, action: "api_key.revoked", detail: `API key revoked: ${input.id}`, metadata: { keyId: input.id } }); return result; }),
    }),
    invitations: router({
      list: adminProcedure.query(() => listInvitations()),
      create: adminProcedure.input(z.object({ email: z.string().email().max(320), role: z.enum(["user", "admin"]).default("user"), expiresInHours: z.number().int().min(1).max(720).default(72) })).mutation(async ({ ctx, input }) => { const result = await createInvitation({ email: input.email, role: input.role, createdBy: ctx.user.id, expiresAt: new Date(Date.now() + input.expiresInHours * 3600000) }); await recordAuditEvent({ userId: ctx.user.id, action: "invitation.created", detail: `Invitation created for ${input.email.toLowerCase()}`, metadata: { role: input.role, expiresInHours: input.expiresInHours } }); return result; }),
      revoke: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const result = await revokeInvitation(input.id); await recordAuditEvent({ userId: ctx.user.id, action: "invitation.revoked", detail: `Invitation revoked: ${input.id}`, metadata: { invitationId: input.id } }); return result; }),
    }),
  }),
  admin: router({
    overview: adminProcedure.query(() => getAdminOverview()),
    users: adminProcedure.query(() => listUsers()),
    updateUser: adminProcedure.input(z.object({ userId: z.number().int().positive(), role: z.enum(["user", "admin"]).optional(), disabled: z.boolean().optional() })).mutation(async ({ ctx, input }) => { const result = await updateUserAdmin(input.userId, { role: input.role, disabled: input.disabled === undefined ? undefined : (input.disabled ? 1 : 0) }); await recordAuditEvent({ userId: ctx.user.id, action: input.role ? "user.role_changed" : "user.status_changed", detail: `User ${input.userId} updated`, metadata: { targetUserId: input.userId, role: input.role, disabled: input.disabled } }); return result; }),
    teams: adminProcedure.query(({ ctx }) => listTeams(ctx.user.id)),
    createTeam: adminProcedure.input(z.object({ name: z.string().min(1).max(100), description: z.string().max(500).default("") })).mutation(({ ctx, input }) => createTeam({ ownerId: ctx.user.id, name: input.name, description: input.description })),
    teamMembers: adminProcedure.input(z.object({ teamId: z.number().int().positive() })).query(({ input }) => listTeamMembers(input.teamId)),
    addTeamMember: adminProcedure.input(z.object({ teamId: z.number().int().positive(), userId: z.number().int().positive(), role: z.enum(["manager", "member"]).default("member") })).mutation(async ({ ctx, input }) => { const result = await addTeamMember(input); await recordAuditEvent({ userId: ctx.user.id, action: "team.member_added", detail: `Team member ${input.userId} added`, metadata: { teamId: input.teamId, memberUserId: input.userId, role: input.role } }); return result; }),
    updateTeamMember: adminProcedure.input(z.object({ id: z.number().int().positive(), role: z.enum(["manager", "member"]) })).mutation(async ({ ctx, input }) => { const result = await updateTeamMember(input.id, input.role); await recordAuditEvent({ userId: ctx.user.id, action: "team.member_role_changed", detail: `Team member ${input.id} role changed`, metadata: { membershipId: input.id, role: input.role } }); return result; }),
    deleteTeamMember: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const result = await deleteTeamMember(input.id); await recordAuditEvent({ userId: ctx.user.id, action: "team.member_removed", detail: `Team member ${input.id} removed`, metadata: { membershipId: input.id } }); return result; }),
    nodeHealth: adminProcedure.query(() => nodeHealth()),
    nodeResources: adminProcedure.query(() => nodeResources()),
    nodeServers: adminProcedure.query(() => listNodeServers()),
    locations: adminProcedure.query(() => listLocations()),
    createLocation: adminProcedure.input(z.object({ shortCode: z.string().min(1).max(60), description: z.string().min(1).max(191) })).mutation(({ input }) => createLocation(input)),
    nodes: adminProcedure.query(() => listNodes()),
    nodeCapacity: adminProcedure.input(z.object({ nodeId: z.number().int().positive() })).query(({ input }) => getNodeCapacity(input.nodeId)),
    nodeCapacities: adminProcedure.query(() => listNodeCapacities()),
    createNode: adminProcedure.input(z.object({ locationId: z.number().int().positive(), name: z.string().min(1).max(100), description: z.string().max(191), fqdn: z.string().min(1).max(255), scheme: z.enum(["http", "https"]), behindProxy: z.boolean(), public: z.boolean(), memoryMb: z.number().int().positive(), diskMb: z.number().int().positive(), memoryOverallocate: z.number().int(), diskOverallocate: z.number().int(), daemonPort: z.number().int().positive(), sftpPort: z.number().int().positive() })).mutation(({ input }) => createNode({ ...input, behindProxy: input.behindProxy ? 1 : 0, public: input.public ? 1 : 0 })),
    allocations: adminProcedure.input(z.object({ nodeId: z.number().int().positive() })).query(({ input }) => listAllocations(input.nodeId)),
    createAllocation: adminProcedure.input(z.object({ nodeId: z.number().int().positive(), ip: z.string().min(1).max(64), alias: z.string().max(255).optional(), port: z.number().int().min(1).max(65535) })).mutation(({ input }) => createAllocation(input)),
    nests: adminProcedure.query(async () => { await seedCatalog(); return listNests(); }),
    eggs: adminProcedure.input(z.object({ nestId: z.number().int().positive().optional() }).optional()).query(async ({ input }) => { await seedCatalog(); return listEggs(input?.nestId); }),
    createNest: adminProcedure.input(z.object({ name: z.string().min(1).max(100), description: z.string().min(1).max(500) })).mutation(({ input }) => createNest(input)),
    updateNest: adminProcedure.input(z.object({ id: z.number().int().positive(), name: z.string().min(1).max(100).optional(), description: z.string().min(1).max(500).optional() })).mutation(({ input }) => updateNest(input.id, { name: input.name, description: input.description })),
    deleteNest: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => deleteNest(input.id)),
    createEgg: adminProcedure.input(z.object({ nestId: z.number().int().positive(), name: z.string().min(1).max(100), slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,99}$/), image: z.string().min(1).max(255), startup: z.string().min(1).max(500), installScript: z.string().max(100000), environmentJson: z.string().max(20000) })).mutation(({ input }) => createEgg(input)),
    updateEgg: adminProcedure.input(z.object({ id: z.number().int().positive(), nestId: z.number().int().positive().optional(), name: z.string().min(1).max(100).optional(), slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,99}$/).optional(), image: z.string().min(1).max(255).optional(), startup: z.string().min(1).max(500).optional(), installScript: z.string().max(100000).optional(), environmentJson: z.string().max(20000).optional() })).mutation(({ input }) => updateEgg(input.id, { nestId: input.nestId, name: input.name, slug: input.slug, image: input.image, startup: input.startup, installScript: input.installScript, environmentJson: input.environmentJson })),
    deleteEgg: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => deleteEgg(input.id)),
    exportEgg: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => { const row = (await listEggs()).find((egg) => egg.id === input.id); if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Egg not found" }); return { version: 1, egg: row }; }),
    importEgg: adminProcedure.input(z.object({ nestId: z.number().int().positive(), egg: z.object({ name: z.string().min(1).max(100), slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,99}$/), image: z.string().min(1).max(255), startup: z.string().min(1).max(500), installScript: z.string().max(100000), environmentJson: z.string().max(20000) }) })).mutation(({ input }) => createEgg({ ...input.egg, nestId: input.nestId })),
    servers: adminProcedure.query(() => listServers()),
    backups: adminProcedure.query(async () => { const servers = await listServers(); const rows = await Promise.all(servers.map(async (server) => (await listBackups(server.id)).map((backup) => ({ ...backup, serverId: server.id, serverName: server.name, identifier: server.identifier })))); return rows.flat(); }),
    scheduleInventory: adminProcedure.query(async () => { const servers = await listServers(); const rows = await Promise.all(servers.map(async (server) => { const schedules = await listSchedules(server.id); return Promise.all(schedules.map(async (schedule) => ({ ...schedule, serverId: server.id, serverName: server.name, runs: await listScheduleRuns(schedule.id) }))); })); return rows.flat(); }),
    auditTimeline: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(500).default(100), offset: z.number().int().min(0).default(0), action: z.string().min(1).max(120).optional(), serverId: z.number().int().positive().optional(), userId: z.number().int().positive().optional() }).default({ limit: 100, offset: 0 })).query(async ({ input }) => { const persistent = await listAuditEvents(input); const [servers, jobs] = await Promise.all([listServers(), listJobs()]); const serverById = new Map(servers.map((server) => [server.id, server])); const events = jobs.map((job) => ({ id: `job-${job.id}`, kind: job.status === "failed" ? "error" : "operation", title: job.type, detail: job.message || job.error || job.status, serverName: job.serverId ? serverById.get(job.serverId)?.name ?? "Unknown server" : "Platform", at: job.updatedAt ?? job.createdAt })); for (const server of servers) events.push({ id: `server-${server.id}`, kind: "lifecycle", title: "server.updated", detail: `${server.status} · ${server.identifier}`, serverName: server.name, at: server.updatedAt }); return [...persistent.map((event) => ({ id: `audit-${event.id}`, kind: "audit", title: event.action, detail: event.detail, serverName: event.serverId ? serverById.get(event.serverId)?.name ?? "Unknown server" : "Platform", at: event.createdAt })), ...events].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(input.offset, input.offset + input.limit); }),
    serverAction: adminProcedure.input(z.object({ id: z.number().int().positive(), action: z.enum(["start", "stop", "restart", "kill"]) })).mutation(async ({ ctx, input }) => {
      const server = (await listServers()).find((item) => item.id === input.id);
      if (!server) throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
      if (!["offline", "running"].includes(server.status)) throw new TRPCError({ code: "CONFLICT", message: `Server is ${server.status} and cannot be controlled now` });
      acquireServerOperation(server.id, `server-${input.action}`);
      try {
        await nodeAction(server.identifier, input.action);
        await updateServerStatus(server.id, input.action === "stop" ? "offline" : "running"); await recordAuditEvent({ userId: ctx.user.id, serverId: server.id, action: "server." + input.action, detail: "Server power action executed" });
        return { success: true, status: input.action === "stop" ? "offline" : "running" } as const;
      } finally { releaseServerOperation(server.id); }
    }),
    reinstallPreview: adminProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ input }) => {
      const server = (await listServers()).find((item) => item.id === input.id);
      if (!server) throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
      return { serverId: server.id, name: server.name, identifier: server.identifier, currentStatus: server.status, runtime: server.runtime, image: server.image, startup: server.startup, memoryMb: server.memoryMb, cpu: server.cpu, preservedVolume: `/opt/mystic-host/servers/${server.identifier}:/workspace`, preservedData: ["uploaded files", "server databases", "workspace contents"], changedOnReinstall: ["Docker container", "runtime image", "startup process"], confirmationToken: "REINSTALL_PRESERVE_VOLUME" };
    }),
    createPersistentServer: adminProcedure
      .input(z.object({ ownerId: z.number().int().positive(), nodeId: z.number().int().positive(), allocationId: z.number().int().positive().optional(), eggId: z.number().int().positive().optional(), name: z.string().min(2).max(48), runtime: z.string().min(1), image: z.string().min(1), startup: z.string().min(1), installScript: z.string().max(100000).optional(), variablesJson: z.string().max(20000).optional(), memoryMb: z.number().int().min(128).max(65536), diskMb: z.number().int().min(128).max(1048576), cpu: z.number().min(0.1).max(64) }))
      .mutation(async ({ input }) => {
        const variables = parseEggVariables(input.variablesJson || "{}");
        const template = `${input.startup}\n${input.installScript || ""}`;
        const missing = missingEggVariables(template, variables);
        if (missing.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Missing egg variables: ${missing.join(", ")}` });
        const startup = renderEggTemplate(input.startup, variables);
        const installScript = renderEggTemplate(input.installScript || "", variables);
        const created = await createPersistentServer({ ...input, startup, installScript, variablesJson: JSON.stringify(variables), cpu: Math.round(input.cpu * 100) });
        const job = await createJob({ serverId: created.id, type: "server.create", payload: { identifier: created.identifier, name: created.name, image: created.image } });
        await updateJob(job.id, { status: "running" });
        try {
          await createManagedNodeServer({ name: created.identifier, runtime: created.runtime, image: created.image, startup: created.startup, installScript: created.installScript, memoryMb: created.memoryMb, cpu: created.cpu / 100 });
          await updateServerStatus(created.id, "offline");
          await updateJob(job.id, { status: "completed", result: { serverId: created.id, identifier: created.identifier } });
        } catch (error) {
          await updateServerStatus(created.id, "failed");
          await updateJob(job.id, { status: "failed", error: error instanceof Error ? error.message : "Server creation failed" });
          throw error;
        }
        return created;
      }),
    createServer: adminProcedure
      .input(z.object({ nodeId: z.number().int().positive(), allocationId: z.number().int().positive().optional(), ownerId: z.number().int().positive().optional(), name: z.string().min(2).max(48), runtime: z.enum(["nodejs", "python", "polyglot", "bun"]), memoryMb: z.number().int().min(128).max(8192), diskMb: z.number().int().min(512).max(1048576).default(5120), cpu: z.number().min(0.1).max(4), startup: z.string().min(1).max(500).optional() }))
      .mutation(async ({ ctx, input }) => {
        const image = { nodejs: "node:22-bookworm", python: "python:3.12-slim", polyglot: "python:3.12-slim", bun: "oven/bun:1" }[input.runtime];
        const node = (await listNodes()).find((item) => item.id === input.nodeId);
        if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "Node not found" });
        const ownerId = input.ownerId ?? ctx.user.id;
        const owner = (await listUsers()).find((item) => item.id === ownerId);
        if (!owner) throw new TRPCError({ code: "NOT_FOUND", message: "Owner not found" });
        acquireServerOperation(input.nodeId, "server-create");
        try {
          const created = await createPersistentServer({ ownerId, nodeId: input.nodeId, allocationId: input.allocationId, name: input.name, runtime: input.runtime, image, startup: input.startup || (input.runtime === "nodejs" ? "node server.js" : input.runtime === "bun" ? "bun run start" : "python app.py"), installScript: "", variablesJson: "{}", memoryMb: input.memoryMb, diskMb: input.diskMb, cpu: Math.round(input.cpu * 100) });
          const job = await createJob({ serverId: created.id, type: "server.create", payload: { identifier: created.identifier, name: created.name, image: created.image } });
          await updateJob(job.id, { status: "running" });
          try {
            await createManagedNodeServer({ name: created.identifier, runtime: created.runtime, image: created.image, startup: created.startup, installScript: created.installScript, memoryMb: created.memoryMb, cpu: created.cpu / 100 });
            await updateServerStatus(created.id, "offline");
            await createServerUser({ serverId: created.id, userId: ownerId, permissions: ["control", "console", "file.read", "file.write", "backup.read", "backup.create"] });
            await updateJob(job.id, { status: "completed", result: { serverId: created.id, identifier: created.identifier } });
          } catch (error) {
            await updateServerStatus(created.id, "failed");
            await updateJob(job.id, { status: "failed", error: error instanceof Error ? error.message : "Server creation failed" });
            throw error;
          }
          return created;
        } finally { releaseServerOperation(input.nodeId); }
      }),
    serverStatus: adminProcedure.input(z.object({ id: z.number().int().positive(), status: z.enum(["installing", "offline", "running", "stopping", "failed"]) })).mutation(({ input }) => updateServerStatus(input.id, input.status)),
    nodeStatus: adminProcedure.input(z.object({ id: z.number().int().positive(), status: z.enum(["offline", "online", "maintenance"]) })).mutation(({ input }) => updateNodeStatus(input.id, input.status)),
    schedules: adminProcedure.input(z.object({ serverId: z.number().int().positive() })).query(({ input }) => listSchedules(input.serverId)),
    scheduleRuns: adminProcedure.input(z.object({ scheduleId: z.number().int().positive() })).query(({ input }) => listScheduleRuns(input.scheduleId)),
    jobs: adminProcedure.input(z.object({ serverId: z.number().int().positive().optional() }).optional()).query(({ input }) => listJobs(input?.serverId)),
    createSchedule: adminProcedure.input(z.object({ serverId: z.number().int().positive(), name: z.string().min(1).max(100), cron: z.string().regex(/^\S+(\s+\S+){4}$/, "Cron must contain five fields"), timezone: z.string().min(1).max(64).default("UTC").refine((value) => { try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return true; } catch { return false; } }, "Invalid timezone"), action: z.enum(["start", "stop", "restart", "command"]), payload: z.string().max(2000).optional() })).mutation(({ input }) => createSchedule(input)),
    serverUsers: adminProcedure.input(z.object({ serverId: z.number().int().positive() })).query(({ input }) => listServerUsers(input.serverId)),
    createServerUser: adminProcedure.input(z.object({ serverId: z.number().int().positive(), userId: z.number().int().positive(), permissions: z.array(z.string().min(1)).min(1).max(50) })).mutation(({ input }) => createServerUser(input)),
    updateServerUser: adminProcedure.input(z.object({ id: z.number().int().positive(), permissions: z.array(z.string().min(1)).min(1).max(50) })).mutation(({ input }) => updateServerUser(input.id, input.permissions)),
    deleteServerUser: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => deleteServerUser(input.id)),
    databaseHosts: adminProcedure.query(() => listDatabaseHosts()),
    createDatabaseHost: adminProcedure.input(z.object({ nodeId: z.number().int().positive(), name: z.string().min(1).max(100), hostname: z.string().min(1).max(255), port: z.number().int().min(1).max(65535), username: z.string().min(1).max(100), password: z.string().min(12).max(255) })).mutation(({ input }) => createDatabaseHost(input)),
    serverDatabases: adminProcedure.input(z.object({ serverId: z.number().int().positive() })).query(({ input }) => listServerDatabases(input.serverId)),
    createServerDatabase: adminProcedure.input(z.object({ serverId: z.number().int().positive(), hostId: z.number().int().positive(), name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/), username: z.string().min(1).max(100), password: z.string().min(12).max(255) })).mutation(async ({ input }) => {
      const server = (await listServers()).find((item) => item.id === input.serverId);
      if (!server) throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
      acquireServerOperation(server.id, "database-create");
      let created = false;
      try {
        await nodeCreateDatabase(server.identifier, input.name, input.username, input.password);
        created = true;
        return await createServerDatabase(input);
      } catch (error) {
        if (created) await nodeDeleteDatabase(server.identifier, input.name).catch(() => {});
        throw error;
      } finally { releaseServerOperation(server.id); }
    }),
    deleteServerDatabase: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
      const database = await getServerDatabase(input.id);
      const server = (await listServers()).find((item) => item.id === database.serverId);
      if (!server) throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
      acquireServerOperation(server.id, "database-delete");
      try { await nodeDeleteDatabase(server.identifier, database.name); await deleteServerDatabase(database.id); return { success: true } as const; }
      finally { releaseServerOperation(server.id); }
    }),
    rotateServerDatabasePassword: adminProcedure.input(z.object({ id: z.number().int().positive(), oldPassword: z.string().min(1).max(255), newPassword: z.string().min(12).max(255) })).mutation(async ({ input }) => {
      const database = await getServerDatabase(input.id);
      const server = (await listServers()).find((item) => item.id === database.serverId);
      if (!server) throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
      acquireServerOperation(server.id, "database-rotate-password");
      try { const result = await nodeRotateDatabasePassword(server.identifier, database.name, database.username, input.oldPassword, input.newPassword); await updateServerDatabase(database.id, { password: input.newPassword }); return result; }
      finally { releaseServerOperation(server.id); }
    }),
    nodeConfig: adminProcedure.input(z.object({ nodeId: z.number().int().positive() })).query(async ({ input }) => { const node = await getNode(input.nodeId); return { debug: false, uuid: String(node.id), token: node.daemonToken, api: { host: "0.0.0.0", port: node.daemonPort, ssl: { enabled: node.scheme === "https", cert: `/etc/letsencrypt/live/${node.fqdn}/fullchain.pem`, key: `/etc/letsencrypt/live/${node.fqdn}/privkey.pem` }, upload_limit: 100 }, system: { data: "/var/lib/mystic-host/volumes", sftp: { bind_port: node.sftpPort } }, remote: `${node.scheme}://${node.fqdn}` }; }),
  }),
  node: router({
    updateSettings: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48), serverName: z.string().min(2).max(100).optional(), startup: z.string().min(1).max(500).optional(), variablesJson: z.string().max(20000).optional() }))
      .mutation(async ({ ctx, input }) => {
        const server = await requireServerPermission(ctx, input.name, "settings.update");
        if (input.variablesJson !== undefined) { parseEggVariables(input.variablesJson); }
        const updated = await updatePersistentServer(server.id, { name: input.serverName, startup: input.startup, variablesJson: input.variablesJson });
        return { success: true, server: updated };
      }),
    action: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48), action: z.enum(["start", "stop", "restart", "kill"]) }))
      .mutation(async ({ ctx, input }) => { await requireServerPermission(ctx, input.name, "control"); return nodeAction(input.name, input.action); }),
    logs: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48) }))
      .query(async ({ ctx, input }) => { await requireServerPermission(ctx, input.name, "control"); return nodeLogs(input.name); }),
    command: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48), command: z.string().min(1).max(2000) }))
      .mutation(async ({ ctx, input }) => { await requireServerPermission(ctx, input.name, "console"); return nodeCommand(input.name, input.command); }),
    stats: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48) }))
      .query(async ({ ctx, input }) => { await requireServerPermission(ctx, input.name, "control"); return nodeStats(input.name); }),
    installStatus: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48) }))
      .query(async ({ ctx, input }) => { await requireServerPermission(ctx, input.name, "control"); return nodeInstallStatus(input.name); }),
    reinstall: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48) }))
      .mutation(async ({ ctx, input }) => {
        const server = await requireServerPermission(ctx, input.name, "control");
        acquireServerOperation(server.id, "reinstall");
        try {
        const job = await createJob({ serverId: server.id, type: "server.reinstall", payload: { identifier: server.identifier } });
        await updateJob(job.id, { status: "running", progress: 5, message: "Recreating server container" });
        await updateServerStatus(server.id, "installing");
        try {
          const result = await nodeReinstallServer({ name: server.identifier, runtime: server.runtime, image: server.image, startup: server.startup, installScript: server.installScript, memoryMb: server.memoryMb, cpu: server.cpu / 100 });
          await updateJob(job.id, { status: "completed", progress: 50, message: "Container rebuilt; installation is running", result });
          return result;
        } catch (error) {
          await updateServerStatus(server.id, "failed");
          await updateJob(job.id, { status: "failed", progress: 100, message: "Reinstall failed", error: error instanceof Error ? error.message : "Reinstall failed" });
          throw error;
        }
        } finally { releaseServerOperation(server.id); }
      }),
    cancelInstall: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48) }))
      .mutation(async ({ ctx, input }) => {
        const server = await requireServerPermission(ctx, input.name, "control");
        acquireServerOperation(server.id, "cancel-install");
        try {
        const result = await nodeCancelInstall(server.identifier);
        await updateServerStatus(server.id, "failed");
        return result;
        } finally { releaseServerOperation(server.id); }
      }),
    backups: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48) }))
      .query(async ({ ctx, input }) => { const server = await requireServerPermission(ctx, input.name, "backup.read"); const [live, persisted] = await Promise.all([nodeBackups(input.name), listBackups(server.id)]); return { backups: live.backups.map((backup) => ({ ...backup, record: persisted.find((record) => record.name === backup.name) ?? null })) }; }),
    createBackup: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48) }))
      .mutation(async ({ ctx, input }) => { const server = await requireServerPermission(ctx, input.name, "backup.create"); acquireServerOperation(server.id, "backup-create"); const record = await createBackupRecord(server.id); await updateBackupRecord(record.id, { status: "running" }); try { const result = await nodeCreateBackup(input.name); await updateBackupRecord(record.id, { name: result.name, archivePath: `.backups/${result.name}`, checksum: result.checksum, bytes: result.bytes, status: "completed" }); await recordAuditEvent({ userId: ctx.user.id, serverId: server.id, action: "backup.created", detail: `Backup created: ${result.name}`, metadata: { backupId: record.id, backupName: result.name, bytes: result.bytes } }); return { ...result, id: record.id }; } catch (error) { await updateBackupRecord(record.id, { status: "failed" }); throw error; } finally { releaseServerOperation(server.id); } }),
    restoreBackup: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48), backupName: z.string().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => { const server = await requireServerPermission(ctx, input.name, "backup.restore"); const record = (await listBackups(server.id)).find((item) => item.name === input.backupName); acquireServerOperation(server.id, "backup-restore"); try { const result = await nodeRestoreBackup(input.name, input.backupName, record?.checksum ?? undefined); await recordAuditEvent({ userId: ctx.user.id, serverId: server.id, action: "backup.restored", detail: `Backup restored: ${input.backupName}`, metadata: { backupName: input.backupName } }); return result; } finally { releaseServerOperation(server.id); } }),
    deleteBackup: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48), backupName: z.string().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => { const server = await requireServerPermission(ctx, input.name, "backup.delete"); acquireServerOperation(server.id, "backup-delete"); try { const result = await nodeDeleteBackup(input.name, input.backupName); await recordAuditEvent({ userId: ctx.user.id, serverId: server.id, action: "backup.deleted", detail: `Backup deleted: ${input.backupName}`, metadata: { backupName: input.backupName } }); return result; } finally { releaseServerOperation(server.id); } }),
    listFiles: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48), path: z.string().max(500).optional() }))
      .query(async ({ ctx, input }) => { await requireServerPermission(ctx, input.name, "file.read"); return nodeListFiles(input.name, input.path); }),
    downloadFile: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48), path: z.string().min(1).max(500) }))
      .query(async ({ ctx, input }) => { await requireServerPermission(ctx, input.name, "file.read"); return nodeDownloadFile(input.name, input.path); }),
    members: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48) }))
      .query(async ({ ctx, input }) => { const server = await requireServerPermission(ctx, input.name, "member.read"); return listServerMembers(server.id); }),
    schedules: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48) }))
      .query(async ({ ctx, input }) => { const server = await requireServerPermission(ctx, input.name, "schedule.read"); return listSchedules(server.id); }),
    createSchedule: protectedProcedure
      .input(z.object({ name: z.string().min(1).max(100), scheduleName: z.string().min(1).max(100), cron: z.string().regex(/^(\S+\s+){4}\S+$/), action: z.enum(["start", "stop", "restart", "command"]), payload: z.string().max(2000).optional() }))
      .mutation(async ({ ctx, input }) => { const server = await requireServerPermission(ctx, input.name, "schedule.update"); const created = await createSchedule({ serverId: server.id, name: input.scheduleName, cron: input.cron, action: input.action, payload: input.payload || null, enabled: 1 }); await recordAuditEvent({ userId: ctx.user.id, serverId: server.id, action: "schedule.created", detail: input.scheduleName, metadata: { cron: input.cron, action: input.action } }); return created; }),
    toggleSchedule: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48), scheduleId: z.number().int().positive(), enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => { const server = await requireServerPermission(ctx, input.name, "schedule.update"); const rows = await listSchedules(server.id); if (!rows.some(row => row.id === input.scheduleId)) throw new TRPCError({ code: "NOT_FOUND", message: "Schedule not found" }); await updateScheduleEnabled(input.scheduleId, input.enabled ? 1 : 0); await recordAuditEvent({ userId: ctx.user.id, serverId: server.id, action: input.enabled ? "schedule.enabled" : "schedule.paused", detail: `Schedule ${input.scheduleId} ${input.enabled ? "enabled" : "paused"}`, metadata: { scheduleId: input.scheduleId } }); return { success: true }; }),
    updateSchedule: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48), scheduleId: z.number().int().positive(), scheduleName: z.string().min(1).max(100), cron: z.string().regex(/^(\S+\s+){4}\S+$/), action: z.enum(["start", "stop", "restart", "command"]), payload: z.string().max(2000).optional() }))
      .mutation(async ({ ctx, input }) => { const server = await requireServerPermission(ctx, input.name, "schedule.update"); const rows = await listSchedules(server.id); if (!rows.some(row => row.id === input.scheduleId)) throw new TRPCError({ code: "NOT_FOUND", message: "Schedule not found" }); const result = await updateSchedule(input.scheduleId, { name: input.scheduleName, cron: input.cron, action: input.action, payload: input.payload }); await recordAuditEvent({ userId: ctx.user.id, serverId: server.id, action: "schedule.updated", detail: `Schedule updated: ${input.scheduleName}`, metadata: { scheduleId: input.scheduleId, cron: input.cron, action: input.action } }); return result; }),
    deleteSchedule: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48), scheduleId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => { const server = await requireServerPermission(ctx, input.name, "schedule.update"); const rows = await listSchedules(server.id); if (!rows.some(row => row.id === input.scheduleId)) throw new TRPCError({ code: "NOT_FOUND", message: "Schedule not found" }); await deleteSchedule(input.scheduleId); await recordAuditEvent({ userId: ctx.user.id, serverId: server.id, action: "schedule.deleted", detail: `Schedule deleted: ${input.scheduleId}`, metadata: { scheduleId: input.scheduleId } }); return { success: true }; }),
    runSchedule: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48), scheduleId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => { const server = await requireServerPermission(ctx, input.name, "schedule.update"); const schedule = (await listSchedules(server.id)).find(row => row.id === input.scheduleId); if (!schedule) throw new TRPCError({ code: "NOT_FOUND", message: "Schedule not found" }); const runId = await createScheduleRun(schedule.id); try { const result = schedule.action === "command" ? await nodeCommand(input.name, schedule.payload || "") : await nodeAction(input.name, schedule.action); await finishScheduleRun(runId, "completed"); return result; } catch (error) { await finishScheduleRun(runId, "failed", error instanceof Error ? error.message : "Schedule failed"); throw error; } }),
    activity: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48) }))
      .query(async ({ ctx, input }) => { const server = await requireServerPermission(ctx, input.name, "activity.read"); const [jobs, schedules] = await Promise.all([listJobs(server.id), listSchedules(server.id)]); const runs = (await Promise.all(schedules.map((schedule) => listScheduleRuns(schedule.id).then((items) => items.map((run) => ({ ...run, scheduleName: schedule.name })))))).flat(); return { jobs: jobs.slice(0, 50), runs: runs.slice(0, 50) }; }),
    network: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48) }))
      .query(async ({ ctx, input }) => { const server = await requireServerPermission(ctx, input.name, "network.read"); const allocations = await listAllocations(server.nodeId); return { serverId: server.id, nodeId: server.nodeId, assigned: allocations.filter((item) => item.serverId === server.id), available: allocations.filter((item) => item.serverId === null) }; }),
    sftpCredentials: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48) }))
      .query(async ({ ctx, input }) => { await requireServerPermission(ctx, input.name, "file.read"); return nodeSftpCredentials(input.name); }),
    listDatabases: protectedProcedure
      .input(z.object({ serverName: z.string().min(2).max(48) }))
      .query(async ({ ctx, input }) => { await requireServerPermission(ctx, input.serverName, "database.read"); return nodeListDatabases(input.serverName); }),
    deleteDatabase: protectedProcedure
      .input(z.object({ serverName: z.string().min(2).max(48), database: z.string().min(1).max(48) }))
      .mutation(async ({ ctx, input }) => { await requireServerPermission(ctx, input.serverName, "database.delete"); const result = await nodeDeleteDatabase(input.serverName, input.database); await recordAuditEvent({ userId: ctx.user.id, action: "database.deleted", detail: input.database, metadata: { serverName: input.serverName, database: input.database } }); return result; }),
    rotateDatabasePassword: protectedProcedure
      .input(z.object({ serverName: z.string().min(2).max(48), database: z.string().min(1).max(48), username: z.string().min(1).max(48), oldPassword: z.string().min(1).max(255), newPassword: z.string().min(12).max(255) }))
      .mutation(async ({ ctx, input }) => { await requireServerPermission(ctx, input.serverName, "database.rotate"); const result = await nodeRotateDatabasePassword(input.serverName, input.database, input.username, input.oldPassword, input.newPassword); await recordAuditEvent({ userId: ctx.user.id, action: "database.password_rotated", detail: input.database, metadata: { serverName: input.serverName, database: input.database, username: input.username } }); return result; }),
    createDatabase: protectedProcedure
      .input(z.object({ serverName: z.string().min(2).max(48), name: z.string().min(1).max(48), username: z.string().min(1).max(48), password: z.string().min(12).max(255) }))
      .mutation(async ({ ctx, input }) => { await requireServerPermission(ctx, input.serverName, "database.create"); const result = await nodeCreateDatabase(input.serverName, input.name, input.username, input.password); await recordAuditEvent({ userId: ctx.user.id, action: "database.created", detail: input.name, metadata: { serverName: input.serverName, database: input.name, username: input.username } }); return result; }),
  }),
  files: router({
    list: protectedProcedure
      .input(z.object({ serverName: z.string().min(1).max(100) }))
      .query(async ({ ctx, input }) => { await requireServerPermission(ctx, input.serverName, "file.read"); return listStoredFiles(ctx.user.id, input.serverName); }),
    upload: protectedProcedure
      .input(z.object({ serverName: z.string().min(1).max(100), fileName: z.string().min(1).max(500), mimeType: z.string().min(1).max(150), size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES), dataUrl: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const { mimeType, buffer } = decodeDataUrl(input.dataUrl);
        if (input.size !== buffer.byteLength) throw new Error("File size did not match the uploaded payload");
        await requireServerPermission(ctx, input.serverName, "file.write");
        const name = safeRelativeFilePath(input.fileName);
        const upload = await storagePut(`${ctx.user.id}/servers/${input.serverName}/${name}`, buffer, mimeType);
        await nodeUploadFile(input.serverName, name, buffer);
        const created = await createStoredFile({ userId: ctx.user.id, serverName: input.serverName, originalName: input.fileName, storageKey: upload.key, storageUrl: upload.url, mimeType, size: buffer.byteLength });
        await recordAuditEvent({ userId: ctx.user.id, action: "file.uploaded", detail: `File uploaded: ${input.fileName}`, metadata: { serverName: input.serverName, fileName: input.fileName, size: buffer.byteLength, mimeType } });
        return created;
      }),
    readText: protectedProcedure
      .input(z.object({ serverName: z.string().min(1).max(100), fileName: z.string().min(1).max(500) }))
      .mutation(async ({ ctx, input }) => { await requireServerPermission(ctx, input.serverName, "file.read"); const result = await nodeDownloadFile(input.serverName, safeRelativeFilePath(input.fileName)); if (result.bytes > 256 * 1024) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Only text files up to 256 KB can be edited" }); return { fileName: input.fileName, content: Buffer.from(result.dataBase64, "base64").toString("utf8") }; }),
    writeText: protectedProcedure
      .input(z.object({ serverName: z.string().min(1).max(100), fileName: z.string().min(1).max(500), content: z.string().max(262144) }))
      .mutation(async ({ ctx, input }) => { await requireServerPermission(ctx, input.serverName, "file.write"); await nodeUploadFile(input.serverName, safeRelativeFilePath(input.fileName), Buffer.from(input.content, "utf8")); await recordAuditEvent({ userId: ctx.user.id, action: "file.written", detail: `File written: ${input.fileName}`, metadata: { serverName: input.serverName, fileName: input.fileName, bytes: Buffer.byteLength(input.content, "utf8") } }); return { success: true, fileName: input.fileName }; }),
    renameLive: protectedProcedure
      .input(z.object({ serverName: z.string().min(1).max(100), fileName: z.string().min(1).max(500), newName: z.string().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => { await requireServerPermission(ctx, input.serverName, "file.write"); const source = safeRelativeFilePath(input.fileName); const destination = [...source.split("/").slice(0, -1), safeFileName(input.newName)].filter(Boolean).join("/"); const result = await nodeRenameFile(input.serverName, source, destination); await recordAuditEvent({ userId: ctx.user.id, action: "file.renamed", detail: `File renamed: ${input.fileName}`, metadata: { serverName: input.serverName, source, destination } }); return result; }),
    deleteLive: protectedProcedure
      .input(z.object({ serverName: z.string().min(1).max(100), fileName: z.string().min(1).max(500) }))
      .mutation(async ({ ctx, input }) => { await requireServerPermission(ctx, input.serverName, "file.write"); const fileName = safeRelativeFilePath(input.fileName); const result = await nodeDeleteFile(input.serverName, fileName); await recordAuditEvent({ userId: ctx.user.id, action: "file.deleted", detail: `File deleted: ${input.fileName}`, metadata: { serverName: input.serverName, fileName } }); return result; }),
    createFolder: protectedProcedure
      .input(z.object({ serverName: z.string().min(1).max(100), folderName: z.string().min(1).max(500) }))
      .mutation(async ({ ctx, input }) => { await requireServerPermission(ctx, input.serverName, "file.write"); return nodeCreateFolder(input.serverName, safeRelativeFilePath(input.folderName)); }),
    extract: protectedProcedure
      .input(z.object({ serverName: z.string().min(1).max(100), fileName: z.string().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => { await requireServerPermission(ctx, input.serverName, "file.write"); const fileName = safeFileName(input.fileName); const result = await nodeExtractZip(input.serverName, fileName); await recordAuditEvent({ userId: ctx.user.id, action: "file.extracted", detail: `Archive extracted: ${input.fileName}`, metadata: { serverName: input.serverName, fileName } }); return result; }),
    rename: protectedProcedure
      .input(z.object({ id: z.number().int().positive(), newName: z.string().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => { const file = await getStoredFile(input.id); if (!file || file.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "File not found" }); await requireServerPermission(ctx, file.serverName, "file.write"); const safeName = safeFileName(input.newName); await nodeRenameFile(file.serverName, safeFileName(file.originalName), safeName); return renameStoredFile(ctx.user.id, input.id, input.newName.trim()); }),
    delete: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => { const file = await getStoredFile(input.id); if (!file || file.userId !== ctx.user.id) return { success: true } as const; await requireServerPermission(ctx, file.serverName, "file.write"); await nodeDeleteFile(file.serverName, safeFileName(file.originalName)); return deleteStoredFile(ctx.user.id, input.id); }),
  }),
});

export type AppRouter = typeof appRouter;
