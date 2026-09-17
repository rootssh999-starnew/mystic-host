import { and, count, desc, eq, isNull, sql, sum } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/mysql2";
import { apiKeys, InsertStoredFile, InsertUser, invitations, passwordResets, storedFiles, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod", "passwordHash"] as const;
  for (const field of textFields) {
    if (user[field] !== undefined) {
      const value = user[field] ?? null;
      values[field] = value;
      updateSet[field] = value;
    }
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  values.lastSignedIn ??= new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0];
}

export async function createApiKey(userId: number, name: string, scopes: string[]) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const token = `mh_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const result = await db.insert(apiKeys).values({ userId, name, tokenHash, scopesJson: JSON.stringify(Array.from(new Set(scopes))) });
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.id, Number(result[0].insertId))).limit(1);
  return { key: rows[0], token };
}

export async function authenticateApiToken(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const rows = await db.select({ key: apiKeys, user: users }).from(apiKeys).innerJoin(users, eq(apiKeys.userId, users.id)).where(and(eq(apiKeys.tokenHash, tokenHash), isNull(apiKeys.revokedAt))).limit(1);
  if (!rows[0]) return undefined;
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, rows[0].key.id));
  let scopes: string[] = [];
  try { scopes = JSON.parse(rows[0].key.scopesJson) as string[]; } catch {}
  return { user: rows[0].user, scopes };
}

export async function listApiKeys(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: apiKeys.id, name: apiKeys.name, scopesJson: apiKeys.scopesJson, lastUsedAt: apiKeys.lastUsedAt, createdAt: apiKeys.createdAt, revokedAt: apiKeys.revokedAt }).from(apiKeys).where(eq(apiKeys.userId, userId)).orderBy(desc(apiKeys.id));
}

export async function revokeApiKey(userId: number, id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)));
  return { success: true } as const;
}

export async function createInvitation(input: { email: string; role: "user" | "admin"; createdBy: number; expiresAt: Date }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const token = `invite_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const result = await db.insert(invitations).values({ email: input.email.toLowerCase(), role: input.role, createdBy: input.createdBy, expiresAt: input.expiresAt, tokenHash });
  const rows = await db.select().from(invitations).where(eq(invitations.id, Number(result[0].insertId))).limit(1);
  return { invitation: rows[0], token };
}

export async function listInvitations() {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt, acceptedAt: invitations.acceptedAt, revokedAt: invitations.revokedAt, createdAt: invitations.createdAt }).from(invitations).orderBy(desc(invitations.id));
}

export async function revokeInvitation(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(invitations).set({ revokedAt: new Date() }).where(eq(invitations.id, id));
  return { success: true } as const;
}

export async function consumeInvitation(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const rows = await db.select().from(invitations).where(and(eq(invitations.tokenHash, tokenHash), isNull(invitations.acceptedAt), isNull(invitations.revokedAt))).limit(1);
  const invitation = rows[0];
  if (!invitation || invitation.expiresAt.getTime() <= Date.now()) return undefined;
  await db.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invitation.id));
  return invitation;
}

export async function createPasswordReset(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const user = await getUserByEmail(email.toLowerCase());
  if (!user) return undefined;
  const token = `reset_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.insert(passwordResets).values({ userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 30 * 60 * 1000) });
  return token;
}

export async function consumePasswordReset(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const rows = await db.select({ reset: passwordResets, user: users }).from(passwordResets).innerJoin(users, eq(passwordResets.userId, users.id)).where(and(eq(passwordResets.tokenHash, tokenHash), isNull(passwordResets.usedAt))).limit(1);
  const row = rows[0];
  if (!row || row.reset.expiresAt.getTime() <= Date.now()) return undefined;
  await db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, row.reset.id));
  return row.user;
}

export async function updateUserPassword(userId: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(users).set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, userId));
}

export async function updateUserTwoFactor(userId: number, input: { secret?: string | null; enabled?: number; recoveryCodesHash?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(users).set({ totpSecretEncrypted: input.secret, totpEnabled: input.enabled, recoveryCodesHash: input.recoveryCodesHash, sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, userId));
}

export async function listStoredFiles(userId: number, serverName: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(storedFiles)
    .where(and(eq(storedFiles.userId, userId), eq(storedFiles.serverName, serverName)))
    .orderBy(desc(storedFiles.createdAt));
}

export async function createStoredFile(file: InsertStoredFile) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.insert(storedFiles).values(file);
  const insertedId = Number(result[0].insertId);
  const created = await db.select().from(storedFiles).where(eq(storedFiles.id, insertedId)).limit(1);
  return created[0];
}

export async function deleteStoredFile(userId: number, id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.delete(storedFiles).where(and(eq(storedFiles.id, id), eq(storedFiles.userId, userId)));
  return { success: true } as const;
}

export async function getAdminOverview() {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const [userCount] = await db.select({ value: count() }).from(users);
  const [fileCount] = await db.select({ value: count() }).from(storedFiles);
  const [storage] = await db.select({ value: sum(storedFiles.size) }).from(storedFiles);
  const recentUsers = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, lastSignedIn: users.lastSignedIn }).from(users).orderBy(desc(users.lastSignedIn)).limit(8);
  return {
    users: userCount?.value ?? 0,
    files: fileCount?.value ?? 0,
    storageBytes: Number(storage?.value ?? 0),
    recentUsers,
  };
}
