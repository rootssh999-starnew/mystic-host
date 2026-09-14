import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { billingPlans, runtimeTemplates } from "@shared/catalog";
import { createStoredFile, deleteStoredFile, getAdminOverview, listStoredFiles } from "./db";
import { storagePut } from "./storage";
import { createManagedNodeServer, createNodeServer, listNodeServers, nodeAction, nodeBackups, nodeCommand, nodeCreateBackup, nodeExtractZip, nodeHealth, nodeLogs, nodeRestoreBackup, nodeStats, nodeUploadFile } from "./nodeAgent";
import { createAllocation, createLocation, createNode, createPersistentServer, createSchedule, getNode, listAllocations, listEggs, listLocations, listNests, listNodes, listSchedules, listServers, seedCatalog, updateNodeStatus, updateServerStatus } from "./controlPlane";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  admin: router({
    overview: adminProcedure.query(() => getAdminOverview()),
    nodeHealth: adminProcedure.query(() => nodeHealth()),
    nodeServers: adminProcedure.query(() => listNodeServers()),
    locations: adminProcedure.query(() => listLocations()),
    createLocation: adminProcedure.input(z.object({ shortCode: z.string().min(1).max(60), description: z.string().min(1).max(191) })).mutation(({ input }) => createLocation(input)),
    nodes: adminProcedure.query(() => listNodes()),
    createNode: adminProcedure.input(z.object({ locationId: z.number().int().positive(), name: z.string().min(1).max(100), description: z.string().max(191), fqdn: z.string().min(1).max(255), scheme: z.enum(["http", "https"]), behindProxy: z.boolean(), public: z.boolean(), memoryMb: z.number().int().positive(), diskMb: z.number().int().positive(), memoryOverallocate: z.number().int(), diskOverallocate: z.number().int(), daemonPort: z.number().int().positive(), sftpPort: z.number().int().positive() })).mutation(({ input }) => createNode({ ...input, behindProxy: input.behindProxy ? 1 : 0, public: input.public ? 1 : 0 })),
    allocations: adminProcedure.input(z.object({ nodeId: z.number().int().positive() })).query(({ input }) => listAllocations(input.nodeId)),
    createAllocation: adminProcedure.input(z.object({ nodeId: z.number().int().positive(), ip: z.string().min(1).max(64), alias: z.string().max(255).optional(), port: z.number().int().min(1).max(65535) })).mutation(({ input }) => createAllocation(input)),
    nests: adminProcedure.query(async () => { await seedCatalog(); return listNests(); }),
    eggs: adminProcedure.input(z.object({ nestId: z.number().int().positive().optional() }).optional()).query(async ({ input }) => { await seedCatalog(); return listEggs(input?.nestId); }),
    servers: adminProcedure.query(() => listServers()),
    createPersistentServer: adminProcedure
      .input(z.object({ ownerId: z.number().int().positive(), nodeId: z.number().int().positive(), allocationId: z.number().int().positive().optional(), eggId: z.number().int().positive().optional(), name: z.string().min(2).max(48), runtime: z.string().min(1), image: z.string().min(1), startup: z.string().min(1), memoryMb: z.number().int().min(128).max(65536), diskMb: z.number().int().min(128).max(1048576), cpu: z.number().min(0.1).max(64) }))
      .mutation(async ({ input }) => {
        const created = await createPersistentServer({ ...input, cpu: Math.round(input.cpu * 100) });
        try {
          await createManagedNodeServer({ name: created.identifier, runtime: created.runtime, image: created.image, startup: created.startup, memoryMb: created.memoryMb, cpu: created.cpu / 100 });
          await updateServerStatus(created.id, "offline");
        } catch (error) {
          await updateServerStatus(created.id, "failed");
          throw error;
        }
        return created;
      }),
    createServer: adminProcedure
      .input(z.object({ name: z.string().min(2).max(48), runtime: z.string().min(1), memoryMb: z.number().int().min(128).max(8192), cpu: z.number().min(0.1).max(4) }))
      .mutation(({ input }) => createNodeServer(input)),
    serverStatus: adminProcedure.input(z.object({ id: z.number().int().positive(), status: z.enum(["installing", "offline", "running", "stopping", "failed"]) })).mutation(({ input }) => updateServerStatus(input.id, input.status)),
    nodeStatus: adminProcedure.input(z.object({ id: z.number().int().positive(), status: z.enum(["offline", "online", "maintenance"]) })).mutation(({ input }) => updateNodeStatus(input.id, input.status)),
    schedules: adminProcedure.input(z.object({ serverId: z.number().int().positive() })).query(({ input }) => listSchedules(input.serverId)),
    createSchedule: adminProcedure.input(z.object({ serverId: z.number().int().positive(), name: z.string().min(1).max(100), cron: z.string().min(1).max(100), action: z.enum(["start", "stop", "restart", "command"]), payload: z.string().optional() })).mutation(({ input }) => createSchedule(input)),
    nodeConfig: adminProcedure.input(z.object({ nodeId: z.number().int().positive() })).query(async ({ input }) => { const node = await getNode(input.nodeId); return { debug: false, uuid: String(node.id), token: node.daemonToken, api: { host: "0.0.0.0", port: node.daemonPort, ssl: { enabled: node.scheme === "https", cert: `/etc/letsencrypt/live/${node.fqdn}/fullchain.pem`, key: `/etc/letsencrypt/live/${node.fqdn}/privkey.pem` }, upload_limit: 100 }, system: { data: "/var/lib/mystic-host/volumes", sftp: { bind_port: node.sftpPort } }, remote: `${node.scheme}://${node.fqdn}` }; }),
  }),
  node: router({
    action: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48), action: z.enum(["start", "stop", "restart"]) }))
      .mutation(({ input }) => nodeAction(input.name, input.action)),
    logs: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48) }))
      .query(({ input }) => nodeLogs(input.name)),
    command: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48), command: z.string().min(1).max(2000) }))
      .mutation(({ input }) => nodeCommand(input.name, input.command)),
    stats: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48) }))
      .query(({ input }) => nodeStats(input.name)),
    backups: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48) }))
      .query(({ input }) => nodeBackups(input.name)),
    createBackup: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48) }))
      .mutation(({ input }) => nodeCreateBackup(input.name)),
    restoreBackup: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(48), backupName: z.string().min(1).max(255) }))
      .mutation(({ input }) => nodeRestoreBackup(input.name, input.backupName)),
  }),
  files: router({
    list: protectedProcedure
      .input(z.object({ serverName: z.string().min(1).max(100) }))
      .query(({ ctx, input }) => listStoredFiles(ctx.user.id, input.serverName)),
    upload: protectedProcedure
      .input(z.object({ serverName: z.string().min(1).max(100), fileName: z.string().min(1).max(255), mimeType: z.string().min(1).max(150), size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES), dataUrl: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const { mimeType, buffer } = decodeDataUrl(input.dataUrl);
        if (input.size !== buffer.byteLength) throw new Error("File size did not match the uploaded payload");
        const name = safeFileName(input.fileName);
        const upload = await storagePut(`${ctx.user.id}/servers/${input.serverName}/${name}`, buffer, mimeType);
        await nodeUploadFile(input.serverName, name, buffer);
        return createStoredFile({ userId: ctx.user.id, serverName: input.serverName, originalName: input.fileName, storageKey: upload.key, storageUrl: upload.url, mimeType, size: buffer.byteLength });
      }),
    extract: protectedProcedure
      .input(z.object({ serverName: z.string().min(1).max(100), fileName: z.string().min(1).max(255) }))
      .mutation(({ input }) => nodeExtractZip(input.serverName, safeFileName(input.fileName))),
    delete: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ ctx, input }) => deleteStoredFile(ctx.user.id, input.id)),
  }),
});

export type AppRouter = typeof appRouter;
