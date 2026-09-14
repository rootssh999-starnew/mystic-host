import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const locations = mysqlTable("locations", {
  id: int("id").autoincrement().primaryKey(),
  shortCode: varchar("shortCode", { length: 60 }).notNull().unique(),
  description: varchar("description", { length: 191 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const nodes = mysqlTable("nodes", {
  id: int("id").autoincrement().primaryKey(),
  locationId: int("locationId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  description: varchar("description", { length: 191 }).notNull(),
  fqdn: varchar("fqdn", { length: 255 }).notNull().unique(),
  scheme: mysqlEnum("scheme", ["http", "https"]).default("https").notNull(),
  behindProxy: int("behindProxy").default(0).notNull(),
  public: int("public").default(1).notNull(),
  memoryMb: int("memoryMb").notNull(),
  diskMb: int("diskMb").notNull(),
  memoryOverallocate: int("memoryOverallocate").default(0).notNull(),
  diskOverallocate: int("diskOverallocate").default(0).notNull(),
  daemonPort: int("daemonPort").default(8080).notNull(),
  sftpPort: int("sftpPort").default(2022).notNull(),
  daemonToken: varchar("daemonToken", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["offline", "online", "maintenance"]).default("offline").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const allocations = mysqlTable("allocations", {
  id: int("id").autoincrement().primaryKey(),
  nodeId: int("nodeId").notNull(),
  ip: varchar("ip", { length: 64 }).notNull(),
  alias: varchar("alias", { length: 255 }),
  port: int("port").notNull(),
  serverId: int("serverId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const nests = mysqlTable("nests", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const eggs = mysqlTable("eggs", {
  id: int("id").autoincrement().primaryKey(),
  nestId: int("nestId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  image: varchar("image", { length: 255 }).notNull(),
  startup: varchar("startup", { length: 500 }).notNull(),
  installScript: text("installScript").notNull(),
  environmentJson: text("environmentJson").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const servers = mysqlTable("servers", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  nodeId: int("nodeId").notNull(),
  allocationId: int("allocationId"),
  eggId: int("eggId"),
  name: varchar("name", { length: 100 }).notNull(),
  identifier: varchar("identifier", { length: 48 }).notNull().unique(),
  runtime: varchar("runtime", { length: 64 }).notNull(),
  image: varchar("image", { length: 255 }).notNull(),
  startup: varchar("startup", { length: 500 }).notNull(),
  memoryMb: int("memoryMb").notNull(),
  diskMb: int("diskMb").notNull(),
  cpu: int("cpu").notNull(),
  status: mysqlEnum("status", ["installing", "offline", "running", "stopping", "failed"]).default("offline").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const schedules = mysqlTable("schedules", {
  id: int("id").autoincrement().primaryKey(),
  serverId: int("serverId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  cron: varchar("cron", { length: 100 }).notNull(),
  action: mysqlEnum("action", ["start", "stop", "restart", "command"]).default("restart").notNull(),
  payload: text("payload"),
  enabled: int("enabled").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const backups = mysqlTable("backups", {
  id: int("id").autoincrement().primaryKey(),
  serverId: int("serverId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  archivePath: varchar("archivePath", { length: 500 }).notNull(),
  checksum: varchar("checksum", { length: 128 }),
  bytes: int("bytes").default(0).notNull(),
  status: mysqlEnum("status", ["pending", "running", "completed", "failed"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const storedFiles = mysqlTable("stored_files", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  serverName: varchar("serverName", { length: 100 }).notNull(),
  originalName: varchar("originalName", { length: 255 }).notNull(),
  storageKey: varchar("storageKey", { length: 512 }).notNull().unique(),
  storageUrl: varchar("storageUrl", { length: 768 }).notNull(),
  mimeType: varchar("mimeType", { length: 150 }).notNull(),
  size: int("size").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type StoredFile = typeof storedFiles.$inferSelect;
export type InsertStoredFile = typeof storedFiles.$inferInsert;
export type Location = typeof locations.$inferSelect;
export type Node = typeof nodes.$inferSelect;
export type Allocation = typeof allocations.$inferSelect;
export type Nest = typeof nests.$inferSelect;
export type Egg = typeof eggs.$inferSelect;
export type Server = typeof servers.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type Backup = typeof backups.$inferSelect;
