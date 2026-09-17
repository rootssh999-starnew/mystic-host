import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { billingPlans, runtimeTemplates } from "@shared/catalog";
import { createApiKey, createInvitation, createStoredFile, deleteStoredFile, getAdminOverview, getStoredFile, invalidateUserSessions, listApiKeys, listInvitations, listStoredFiles, listUsers, revokeApiKey, revokeInvitation, updateUserAdmin } from "./db";
import { storagePut } from "./storage";
import { createManagedNodeServer, createNodeServer, listNodeServers, nodeAction, nodeBackups, nodeCancelInstall, nodeCommand, nodeCreateBackup, nodeCreateDatabase, nodeDeleteBackup, nodeDeleteDatabase, nodeDownloadFile, nodeExtractZip, nodeHealth, nodeInstallStatus, nodeListFiles, nodeLogs, nodeReinstallServer, nodeResources, nodeRestoreBackup, nodeRotateDatabasePassword, nodeStats, nodeUploadFile, nodeSftpCredentials } from "./nodeAgent";
import { acquireServerOperation, addTeamMember, createAllocation, createBackupRecord, createDatabaseHost, createEgg, createJob, createLocation, createNest, createNode, createPersistentServer, createSchedule, createServerDatabase, createServerUser, createTeam, deleteEgg, deleteNest, deleteServerDatabase, deleteServerUser, deleteTeamMember, getNode, getNodeCapacity, getServerDatabase, listAllocations, listBackups, listDatabaseHosts, listEggs, listJobs, listLocations, listNests, listNodeCapacities, listNodes, listScheduleRuns, listSchedules, listServerDatabases, listServerMembers, listServerUsers, listServers, listTeamMembers, listTeams, releaseServerOperation, seedCatalog, updateBackupRecord, updateEgg, updateJob, updateNest, updateScheduleEnabled, updateNodeStatus, updateServerDatabase, updateServerStatus, updateServerUser, updateTeamMember, getServerAccess } from "./controlPlane";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { missingEggVariables, parseEggVariables, renderEggTemplate } from "@shared/eggEngine";
import { hasPermission } from "@shared/permissions";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

async function requireServerPermission(ctx: { user: { id: number; role: string } }, name: string, permission: string) { const access = await getServerAccess(name, ctx.user.id, ctx.user.role); if (!hasPermission(access.permissions, permission)) throw new TRPCError({ code: "FORBIDDEN", message: `Missing server permission: ${permission}` }); return access.server; }
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
    logoutAllSessions: protectedProcedure.mutation(async ({ ctx }) => { await invalidateUserSessions(ctx.user.id); const cookieOptions = getSessionCookieOptions(ctx.req); ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 }); return { success: true } as const; }),
    apiKeys: router({
      list: protectedProcedure.query(({ ctx }) => listApiKeys(ctx.user.id)),
      create: protectedProcedure.input(z.object({ name: z.string().min(1).max(100), scopes: z.array(z.string().min(1).max(100)).min(1).max(50) })).mutation(({ ctx, input }) => createApiKey(ctx.user.id, input.name, input.scopes)),
      revoke: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ ctx, input }) => revokeApiKey(ctx.user.id, input.id)),
    }),
    invitations: router({
      list: adminProcedure.query(() => listInvitations()),
      create: adminProcedure.input(z.object({ email: z.string().email().max(320), role: z.enum(["user", "admin"]).default("user"), expiresInHours: z.number().int().min(1).max(720).default(72) })).mutation(({ ctx, input }) => createInvitation({ email: input.email, role: input.role, createdBy: ctx.user.id, expiresAt: new Date(Date.now() + input.expiresInHours * 3600000) })),
      revoke: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => revokeInvitation(input.id)),
    }),
  }),
  admin: router({
    overview: adminProcedure.query(() => getAdminOverview()),
    users: adminProcedure.query(() => listUsers()),
    updateUser: adminProcedure.input(z.object({ userId: z.number().int().positive(), role: z.enum(["user", "admin"]).optional(), disabled: z.boolean().optional() })).mutation(({ input }) => updateUserAdmin(input.userId, { role: input.role, disabled: input.disabled === undefined ? undefined : (input.disabled ? 1 : 0) })),
    teams: adminProcedure.query(({ ctx }) => listTeams(ctx.user.id)),
    createTeam: adminProcedure.input(z.object({ name: z.string().min(1).max(100), description: z.string().max(500).default("") })).mutation(({ ctx, input }) => createTeam({ ownerId: ctx.user.id, name: input.name, description: input.description })),
    teamMembers: adminProcedure.input(z.object({ teamId: z.number().int().positive() })).query(({ input }) => listTeamMembers(input.teamId)),
    addTeamMember: adminProcedure.input(z.object({ teamId: z.number().int().positive(), userId: z.number().int().positive(), role: z.enum(["manager", "member"]).default("member") })).mutation(({ input }) => addTeamMember(input)),
    updateTeamMember: adminProcedure.input(z.object({ id: z.number().int().positive(), role: z.enum(["manager", "member"]) })).mutation(({ input }) => updateTeamMember(input.id, input.role)),
    deleteTeamMember: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => deleteTeamMember(input.id)),
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
    serverAction: adminProcedure.input(z.object({ id: z.number().int().positive(), action: z.enum(["start", "stop", "restart"]) })).mutation(async ({ input }) => {
      const server = (await listServers()).find((item) => item.id === input.id);
      if (!server) throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
      if (!["offline", "running"].includes(server.status)) throw new TRPCError({ code: "CONFLICT", message: `Server is ${server.status} and cannot be controlled now` });
      acquireServerOperation(server.id, `server-${input.action}`);
      try {
        await nodeAction(server.identifier, input.action);
        await updateServerStatus(server.id, input.action === "stop" ? "offline" : "running");
        return { success: true, status: input.action === "stop" ? "offline" : "running" } as const;
      } finally { releaseServerOperation(server.id); }
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
      .input(z.object({ nodeId: z.number().int().positive(), allocationId: z.number().int().positive().optional(), name: z.string().min(2).max(48), runtime: z.enum(["nodejs", "python", "polyglot", "bun"]), memoryMb: z.number().int().min(128).max(8192), cpu: z.number().min(0.1).max(4) }))
      .mutation(async ({ ctx, input }) => {
        const image = { nodejs: "node:22-bookworm", python: "python:3.12-slim", polyglot: "python:3.12-slim", bun: "oven/bun:1" }[input.runtime];
        const node = (await listNodes()).find((item) => item.id === input.nodeId);
        if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "Node not found" });
        acquireServerOperation(input.nodeId, "server-create");
        try {
          const created = await createPersistentServer({ ownerId: ctx.user.id, nodeId: input.nodeId, allocationId: input.allocationId, name: input.name, runtime: input.runtime, image, startup: input.runtime === "nodejs" ? "node server.js" : input.runtime === "bun" ? "bun run start" : "python app.py", installScript: "", variablesJson: "{}", memoryMb: input.memoryMb, diskMb: 5120, cpu: Math.round(input.cpu * 100) });
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
    action: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48), action: z.enum(["start", "stop", "restart"]) }))
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
      .mutation(async ({ ctx, input }) => { const server = await requireServerPermission(ctx, input.name, "backup.create"); acquireServerOperation(server.id, "backup-create"); const record = await createBackupRecord(server.id); await updateBackupRecord(record.id, { status: "running" }); try { const result = await nodeCreateBackup(input.name); await updateBackupRecord(record.id, { name: result.name, archivePath: `.backups/${result.name}`, checksum: result.checksum, bytes: result.bytes, status: "completed" }); return { ...result, id: record.id }; } catch (error) { await updateBackupRecord(record.id, { status: "failed" }); throw error; } finally { releaseServerOperation(server.id); } }),
    restoreBackup: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48), backupName: z.string().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => { const server = await requireServerPermission(ctx, input.name, "backup.restore"); const record = (await listBackups(server.id)).find((item) => item.name === input.backupName); acquireServerOperation(server.id, "backup-restore"); try { return await nodeRestoreBackup(input.name, input.backupName, record?.checksum ?? undefined); } finally { releaseServerOperation(server.id); } }),
    deleteBackup: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48), backupName: z.string().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => { const server = await requireServerPermission(ctx, input.name, "backup.delete"); acquireServerOperation(server.id, "backup-delete"); try { return await nodeDeleteBackup(input.name, input.backupName); } finally { releaseServerOperation(server.id); } }),
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
      .mutation(async ({ ctx, input }) => { const server = await requireServerPermission(ctx, input.name, "schedule.update"); return createSchedule({ serverId: server.id, name: input.scheduleName, cron: input.cron, action: input.action, payload: input.payload || null, enabled: 1 }); }),
    toggleSchedule: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48), scheduleId: z.number().int().positive(), enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => { const server = await requireServerPermission(ctx, input.name, "schedule.update"); const rows = await listSchedules(server.id); if (!rows.some(row => row.id === input.scheduleId)) throw new TRPCError({ code: "NOT_FOUND", message: "Schedule not found" }); await updateScheduleEnabled(input.scheduleId, input.enabled ? 1 : 0); return { success: true }; }),
    sftpCredentials: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48) }))
      .query(async ({ ctx, input }) => { await requireServerPermission(ctx, input.name, "file.read"); return nodeSftpCredentials(input.name); }),
    createDatabase: protectedProcedure
      .input(z.object({ serverName: z.string().min(2).max(48), name: z.string().min(1).max(48), username: z.string().min(1).max(48), password: z.string().min(12).max(255) }))
      .mutation(async ({ ctx, input }) => { await requireServerPermission(ctx, input.serverName, "database.create"); return nodeCreateDatabase(input.serverName, input.name, input.username, input.password); }),
  }),
  files: router({
    list: protectedProcedure
      .input(z.object({ serverName: z.string().min(1).max(100) }))
      .query(async ({ ctx, input }) => { await requireServerPermission(ctx, input.serverName, "file.read"); return listStoredFiles(ctx.user.id, input.serverName); }),
    upload: protectedProcedure
      .input(z.object({ serverName: z.string().min(1).max(100), fileName: z.string().min(1).max(255), mimeType: z.string().min(1).max(150), size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES), dataUrl: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const { mimeType, buffer } = decodeDataUrl(input.dataUrl);
        if (input.size !== buffer.byteLength) throw new Error("File size did not match the uploaded payload");
        await requireServerPermission(ctx, input.serverName, "file.write");
        const name = safeFileName(input.fileName);
        const upload = await storagePut(`${ctx.user.id}/servers/${input.serverName}/${name}`, buffer, mimeType);
        await nodeUploadFile(input.serverName, name, buffer);
        return createStoredFile({ userId: ctx.user.id, serverName: input.serverName, originalName: input.fileName, storageKey: upload.key, storageUrl: upload.url, mimeType, size: buffer.byteLength });
      }),
    extract: protectedProcedure
      .input(z.object({ serverName: z.string().min(1).max(100), fileName: z.string().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => { await requireServerPermission(ctx, input.serverName, "file.write"); return nodeExtractZip(input.serverName, safeFileName(input.fileName)); }),
    delete: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => { const file = await getStoredFile(input.id); if (!file || file.userId !== ctx.user.id) return { success: true } as const; await requireServerPermission(ctx, file.serverName, "file.write"); return deleteStoredFile(ctx.user.id, input.id); }),
  }),
});

export type AppRouter = typeof appRouter;
