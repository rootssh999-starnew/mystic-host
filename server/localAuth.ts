import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import * as db from "./db";
import { sdk } from "./_core/sdk";
import { getSessionCookieOptions } from "./_core/cookies";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ENV } from "./_core/env";

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, encoded: string) {
  const [scheme, salt, expected] = encoded.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

const loginAttempts = new Map<string, { started: number; count: number }>();
function allowedLogin(key: string) {
  const now = Date.now(); const current = loginAttempts.get(key);
  if (!current || now - current.started >= 15 * 60 * 1000) { loginAttempts.set(key, { started: now, count: 1 }); return true; }
  current.count += 1; return current.count <= 10;
}
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(value: Buffer) { let bits = 0; let buffer = 0; let output = ""; for (let index = 0; index < value.length; index += 1) { const byte = value[index]; buffer = (buffer << 8) | byte; bits += 8; while (bits >= 5) { output += BASE32[(buffer >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) output += BASE32[(buffer << (5 - bits)) & 31]; return output; }
function base32Decode(value: string) { let bits = 0; let buffer = 0; const bytes: number[] = []; for (const char of value.replace(/=+$/, "").toUpperCase()) { const index = BASE32.indexOf(char); if (index < 0) throw new Error("Invalid TOTP secret"); buffer = (buffer << 5) | index; bits += 5; if (bits >= 8) { bytes.push((buffer >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(bytes); }
function totp(secret: string, timestamp = Date.now()) { const counter = Math.floor(timestamp / 30000); const counterBuffer = Buffer.alloc(8); counterBuffer.writeBigUInt64BE(BigInt(counter)); const digest = createHmac("sha1", base32Decode(secret)).update(counterBuffer).digest(); const offset = digest[digest.length - 1] & 15; const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000; return String(code).padStart(6, "0"); }
function validTotp(secret: string, code: string) { return [-1, 0, 1].some((step) => totp(secret, Date.now() + step * 30000) === code); }
function encryptionKey() { return createHash("sha256").update(ENV.cookieSecret || "mystic-host-totp-key").digest(); }
function encryptSecret(secret: string) { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv); const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]); return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`; }
function decryptSecret(value: string) { const [iv, tag, encrypted] = value.split("."); const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url")); return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8"); }
function recoveryHash(code: string) { return createHash("sha256").update(code).digest("hex"); }
async function requestUser(req: Request) { try { return await sdk.authenticateRequest(req); } catch { return undefined; } }

export function registerLocalAuthRoutes(app: Express) {
  app.post("/api/local/2fa/setup", async (req: Request, res: Response) => { const user = await requestUser(req); if (!user) return res.status(401).json({ error: "Authentication required" }); const secret = base32Encode(randomBytes(20)); return res.json({ secret, issuer: "Mystic Host", account: user.email || user.openId, otpauth: `otpauth://totp/Mystic%20Host:${encodeURIComponent(user.email || user.openId)}?secret=${secret}&issuer=Mystic%20Host` }); });
  app.post("/api/local/2fa/enable", async (req: Request, res: Response) => { const user = await requestUser(req); if (!user) return res.status(401).json({ error: "Authentication required" }); const secret = String(req.body?.secret || ""); const code = String(req.body?.code || ""); if (!secret || !/^\d{6}$/.test(code) || !validTotp(secret, code)) return res.status(400).json({ error: "Invalid authenticator code" }); const recoveryCodes = Array.from({ length: 8 }, () => randomBytes(5).toString("hex")); await db.updateUserTwoFactor(user.id, { secret: encryptSecret(secret), enabled: 1, recoveryCodesHash: JSON.stringify(recoveryCodes.map(recoveryHash)) }); return res.json({ enabled: true, recoveryCodes }); });
  app.post("/api/local/2fa/disable", async (req: Request, res: Response) => { const user = await requestUser(req); if (!user) return res.status(401).json({ error: "Authentication required" }); if (!user.totpEnabled || !user.totpSecretEncrypted) return res.json({ enabled: false }); const code = String(req.body?.code || ""); if (!/^\d{6}$/.test(code) || !validTotp(decryptSecret(user.totpSecretEncrypted), code)) return res.status(400).json({ error: "Invalid authenticator code" }); await db.updateUserTwoFactor(user.id, { secret: null, enabled: 0, recoveryCodesHash: null }); return res.json({ enabled: false }); });
  app.post("/api/local/password-reset/request", async (req: Request, res: Response) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (email && email.length <= 320) { const token = await db.createPasswordReset(email); if (token) console.info(`[Auth] Password reset requested for ${email}; deliver token through the configured mail provider.`); }
    return res.json({ success: true, message: "If an account exists, reset instructions will be sent." });
  });
  app.post("/api/local/password-reset/complete", async (req: Request, res: Response) => {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!token || password.length < 12 || password.length > 256) return res.status(400).json({ error: "A valid reset token and password of at least 12 characters are required" });
    const user = await db.consumePasswordReset(token); if (!user) return res.status(400).json({ error: "Reset token is invalid or expired" });
    await db.updateUserPassword(user.id, hashPassword(password));
    res.clearCookie(COOKIE_NAME, getSessionCookieOptions(req));
    return res.json({ success: true });
  });
  app.post("/api/local/logout", async (req: Request, res: Response) => { const user = await requestUser(req); if (user) await db.recordAuditEvent({ userId: user.id, action: "auth.logout", detail: "User logged out" }); res.clearCookie(COOKIE_NAME, getSessionCookieOptions(req)); return res.json({ success: true }); });
  app.post("/api/local/invitations/accept", async (req: Request, res: Response) => {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 120) : "";
    if (!token || password.length < 12 || password.length > 256) return res.status(400).json({ error: "A valid invitation token and password of at least 12 characters are required" });
    const invitation = await db.consumeInvitation(token);
    if (!invitation) { await db.recordAuditEvent({ action: "invitation.accept_failed", detail: "Invitation acceptance failed" }); return res.status(400).json({ error: "Invitation is invalid, expired, used, or revoked" }); }
    if (await db.getUserByEmail(invitation.email)) { await db.recordAuditEvent({ action: "invitation.accept_failed", detail: "Invitation acceptance rejected because the account already exists", metadata: { role: invitation.role } }); return res.status(409).json({ error: "An account already exists for this email" }); }
    const openId = `local:${invitation.email}`;
    await db.upsertUser({ openId, email: invitation.email, name: name || invitation.email.split("@")[0], passwordHash: hashPassword(password), loginMethod: "invitation", role: invitation.role });
    const createdUser = await db.getUserByOpenId(openId);
    const sessionToken = await sdk.createSessionToken(openId, { name: name || invitation.email, expiresInMs: ONE_YEAR_MS, sessionVersion: createdUser?.sessionVersion ?? 0 });
    await db.recordAuditEvent({ userId: createdUser?.id, action: "invitation.accepted", detail: "Invitation accepted", metadata: { role: invitation.role } });
    res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
    return res.json({ success: true });
  });
  app.post("/api/local/login", async (req: Request, res: Response) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || !password || email.length > 320 || password.length > 256) return res.status(400).json({ error: "Email and password are required" });
    const key = `${req.ip}:${email}`; if (!allowedLogin(key)) return res.status(429).json({ error: "Too many login attempts; try again later" });
    const user = await db.getUserByEmail(email);
    if (!user?.passwordHash || !verifyPassword(password, user.passwordHash)) { await db.recordAuditEvent({ userId: user?.id, action: "auth.login_failed", detail: "Invalid local login credentials" }); return res.status(401).json({ error: "Invalid email or password" }); }
    if (user.disabled) { await db.recordAuditEvent({ userId: user.id, action: "auth.login_failed", detail: "Login rejected for disabled account" }); return res.status(403).json({ error: "Account disabled" }); }
    if (user.totpEnabled && user.totpSecretEncrypted) { const code = String(req.body?.code || ""); let valid = /^\d{6}$/.test(code) && validTotp(decryptSecret(user.totpSecretEncrypted), code); if (!valid && code) { try { const hashes = JSON.parse(user.recoveryCodesHash || "[]") as string[]; const hash = recoveryHash(code); const index = hashes.indexOf(hash); if (index >= 0) { hashes.splice(index, 1); await db.updateUserTwoFactor(user.id, { recoveryCodesHash: JSON.stringify(hashes) }); valid = true; } } catch {} } if (!valid) { await db.recordAuditEvent({ userId: user.id, action: "auth.login_failed", detail: "Login rejected because two-factor authentication failed" }); return res.status(401).json({ error: "Two-factor authentication code required" }); } }
    await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
    const sessionToken = await sdk.createSessionToken(user.openId, { name: user.name || email, expiresInMs: ONE_YEAR_MS, sessionVersion: user.sessionVersion });
    await db.recordAuditEvent({ userId: user.id, action: "auth.login_succeeded", detail: "Local login succeeded" });
    res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
    return res.json({ success: true });
  });
}
