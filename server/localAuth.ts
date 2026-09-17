import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import * as db from "./db";
import { sdk } from "./_core/sdk";
import { getSessionCookieOptions } from "./_core/cookies";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

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

export function registerLocalAuthRoutes(app: Express) {
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
  app.post("/api/local/logout", async (req: Request, res: Response) => { res.clearCookie(COOKIE_NAME, getSessionCookieOptions(req)); return res.json({ success: true }); });
  app.post("/api/local/invitations/accept", async (req: Request, res: Response) => {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 120) : "";
    if (!token || password.length < 12 || password.length > 256) return res.status(400).json({ error: "A valid invitation token and password of at least 12 characters are required" });
    const invitation = await db.consumeInvitation(token);
    if (!invitation) return res.status(400).json({ error: "Invitation is invalid, expired, used, or revoked" });
    if (await db.getUserByEmail(invitation.email)) return res.status(409).json({ error: "An account already exists for this email" });
    const openId = `local:${invitation.email}`;
    await db.upsertUser({ openId, email: invitation.email, name: name || invitation.email.split("@")[0], passwordHash: hashPassword(password), loginMethod: "invitation", role: invitation.role });
    const sessionToken = await sdk.createSessionToken(openId, { name: name || invitation.email, expiresInMs: ONE_YEAR_MS });
    res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
    return res.json({ success: true });
  });
  app.post("/api/local/login", async (req: Request, res: Response) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || !password || email.length > 320 || password.length > 256) return res.status(400).json({ error: "Email and password are required" });
    const key = `${req.ip}:${email}`; if (!allowedLogin(key)) return res.status(429).json({ error: "Too many login attempts; try again later" });
    const user = await db.getUserByEmail(email);
    if (!user?.passwordHash || !verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: "Invalid email or password" });
    await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
    const sessionToken = await sdk.createSessionToken(user.openId, { name: user.name || email, expiresInMs: ONE_YEAR_MS });
    res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
    return res.json({ success: true });
  });
}
