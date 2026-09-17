#!/usr/bin/env node
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const { Server: SSHServer } = require("ssh2");
const SftpServer = require("./vendor/ssh2-sftp-server/index.js");
const PORT = Number(process.env.MYSTIC_HOST_AGENT_PORT || 8787);
const SFTP_PORT = Number(process.env.MYSTIC_HOST_SFTP_PORT || 2022);
const TOKEN = process.env.MYSTIC_HOST_AGENT_TOKEN || (await readFile(process.env.MYSTIC_HOST_AGENT_TOKEN_FILE || "/opt/mystic-host-node/agent.token", "utf8").catch(() => "")).trim();
const ROOT = process.env.MYSTIC_HOST_DATA_ROOT || "/opt/mystic-host-node/data";
const SFTP_ROOT = path.resolve(ROOT);
function sftpPassword(name) { return createHash("sha256").update(`${TOKEN}:${name}`).digest("hex"); }
const HOST_KEY = process.env.MYSTIC_HOST_SFTP_HOST_KEY || path.join(path.dirname(ROOT), "sftp-host-ed25519");
const MAX_BODY = 30 * 1024 * 1024;

async function ensureHostKey() {
  try { await stat(HOST_KEY); } catch { await exec("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", HOST_KEY]); }
}

async function startSftp() {
  await mkdir(SFTP_ROOT, { recursive: true });
  await ensureHostKey();
  const ssh = new SSHServer({ hostKeys: [await readFile(HOST_KEY)] }, (client) => {
    let username = "";
    client.on("authentication", (ctx) => {
      username = String(ctx.username || "");
      if (ctx.method === "password" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,48}$/.test(username) && ctx.password === sftpPassword(username)) ctx.accept();
      else ctx.reject();
    }).on("ready", () => {
      client.on("session", (accept) => {
        const session = accept();
        session.on("sftp", (acceptSftp) => {
          const stream = acceptSftp();
          const serverRoot = path.join(SFTP_ROOT, username);
          mkdir(serverRoot, { recursive: true }).then(() => new SftpServer(stream, serverRoot)).catch(() => stream.end());
        });
      });
    });
  });
  ssh.listen(SFTP_PORT, "0.0.0.0", () => console.log(`MYSTIC HOST SFTP listening on 0.0.0.0:${SFTP_PORT}`));
}

if (!TOKEN) {
  console.error("MYSTIC_HOST_AGENT_TOKEN is required");
  process.exit(1);
}
await startSftp();

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}
function safeName(value) {
  const name = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,48}$/.test(name)) throw new Error("Invalid server name");
  return name;
}
function safeRelativePath(value) {
  const normalized = path.posix.normalize(String(value || "").replaceAll("\\", "/")).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) throw new Error("Invalid file path");
  return normalized;
}
function imageForRuntime(runtime) {
  const images = { nodejs: "node:22-bookworm", python: "python:3.12-slim", polyglot: "python:3.12-slim", bun: "oven/bun:1" };
  return images[runtime] || images.nodejs;
}
async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY) throw new Error("Request too large");
  }
  return raw ? JSON.parse(raw) : {};
}
async function docker(args) {
  const result = await exec("docker", args, { maxBuffer: 2 * 1024 * 1024 });
  return result.stdout.trim();
}
async function containerInfo(name) {
  try {
    const output = await docker(["inspect", "--format", "{{.State.Status}}|{{.State.Running}}|{{.Config.Image}}", `mystic-host-${name}`]);
    const [status, running, image] = output.split("|");
    return { name, status, running: running === "true", image };
  } catch {
    return { name, status: "missing", running: false };
  }
}
function isMissingContainerError(error) {
  return String(error?.stderr || error?.message || error).includes("No such container");
}
async function handle(req, res) {
  if (req.url === "/health" && req.method === "GET") return send(res, 200, { ok: true, service: "mystic-host-node-agent", version: "1.2.0", sftp: { port: SFTP_PORT, username: "<server-name>" } });
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: "Unauthorized" });
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "v1") return send(res, 404, { error: "Not found" });
  const input = req.method === "GET" ? {} : await body(req);

  if (req.method === "GET" && parts[1] === "servers" && parts.length === 2) {
    const entries = await readdir(ROOT, { withFileTypes: true }).catch(() => []);
    const servers = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => containerInfo(entry.name)));
    return send(res, 200, { servers });
  }

  if (parts[1] !== "servers" || !parts[2]) return send(res, 404, { error: "Route not found" });
  const name = safeName(parts[2]);
  if (req.method === "GET" && parts[3] === "sftp-credentials") return send(res, 200, { host: req.headers.host?.split(":")[0] || "node.mystichost.qzz.io", port: SFTP_PORT, username: name, password: sftpPassword(name) });
  const serverRoot = path.join(ROOT, name);
  await mkdir(serverRoot, { recursive: true });
  const container = `mystic-host-${name}`;

  if (req.method === "POST" && parts.length === 3) {
    const runtime = input.runtime || "nodejs";
    const image = String(input.image || imageForRuntime(runtime));
    const startup = String(input.startup || "while true; do sleep 3600; done");
    const memory = Math.max(128, Math.min(Number(input.memoryMb || 512), 8192));
    const cpus = Math.max(0.1, Math.min(Number(input.cpu || 0.5), 4));
    const port = Number(input.port || 0);
    try { await docker(["inspect", container]); return send(res, 409, { error: "Server already exists" }); } catch {}
    const args = ["run", "-d", "--name", container, "--restart", "unless-stopped", "--memory", `${memory}m`, "--cpus", String(cpus), "-v", `${serverRoot}:/workspace`];
    if (Number.isInteger(port) && port > 0 && port < 65536) args.push("-p", `${port}:${port}`);
    args.push(image, "sh", "-c", startup);
    await docker(args);
    return send(res, 201, { ...(await containerInfo(name)), runtime, image, startup, memoryMb: memory, cpu: cpus, port: port || null });
  }
  if (req.method === "POST" && parts[3] === "start") { await docker(["start", container]); return send(res, 200, await containerInfo(name)); }
  if (req.method === "POST" && parts[3] === "stop") { await docker(["stop", "-t", "10", container]); return send(res, 200, await containerInfo(name)); }
  if (req.method === "POST" && parts[3] === "restart") { await docker(["restart", "-t", "10", container]); return send(res, 200, await containerInfo(name)); }
  if (req.method === "GET" && parts[3] === "stats") {
    let output;
    try { output = await docker(["stats", "--no-stream", "--format", "{{json .}}", container]); }
    catch (error) { if (isMissingContainerError(error)) return send(res, 200, { name, status: "missing" }); throw error; }
    return send(res, 200, JSON.parse(output || "{}"));
  }
  if (req.method === "GET" && parts[3] === "logs") {
    let output;
    try { output = await docker(["logs", "--tail", "200", container]); }
    catch (error) { if (isMissingContainerError(error)) return send(res, 200, { logs: "", name, status: "missing" }); throw error; }
    return send(res, 200, { logs: output });
  }
  if (req.method === "POST" && parts[3] === "command") {
    const command = String(input.command || "").trim();
    if (!command || command.length > 2000) throw new Error("Command must be between 1 and 2000 characters");
    const output = await docker(["exec", container, "sh", "-lc", command]);
    return send(res, 200, { output });
  }
  if (req.method === "GET" && parts[3] === "backups") {
    const backupDir = path.join(serverRoot, ".backups");
    const entries = await readdir(backupDir, { withFileTypes: true }).catch(() => []);
    const backups = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".tar.gz")).map(async (entry) => {
      const file = path.join(backupDir, entry.name);
      const details = await stat(file);
      return { name: entry.name, bytes: details.size, createdAt: details.mtime.toISOString() };
    }));
    return send(res, 200, { backups });
  }
  if (req.method === "POST" && parts[3] === "backups") {
    const backupDir = path.join(serverRoot, ".backups");
    await mkdir(backupDir, { recursive: true });
    const name = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`;
    await exec("tar", ["-czf", path.join(backupDir, name), "--exclude=.backups", "-C", serverRoot, "."]);
    const details = await stat(path.join(backupDir, name));
    return send(res, 201, { name, bytes: details.size, createdAt: details.mtime.toISOString() });
  }
  if (req.method === "POST" && parts[3] === "restore") {
    const backupName = safeRelativePath(input.name || "");
    if (!backupName.startsWith(".backups/") || !backupName.endsWith(".tar.gz")) throw new Error("Invalid backup name");
    const archive = path.join(serverRoot, backupName);
    await stat(archive);
    await exec("tar", ["-xzf", archive, "--strip-components=1", "-C", serverRoot, "--exclude=.backups"]);
    return send(res, 200, { success: true, name: backupName });
  }
  if (req.method === "GET" && parts[3] === "files" && parts.length === 4) {
    const rawPath = url.searchParams.get("path");
    const relative = rawPath ? safeRelativePath(rawPath) : ".";
    const directory = path.join(serverRoot, relative);
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      const details = await stat(entryPath);
      return { name: entry.name, path: path.posix.join(relative, entry.name), directory: entry.isDirectory(), bytes: details.size, modifiedAt: details.mtime.toISOString() };
    }));
    return send(res, 200, { files });
  }
  if (req.method === "POST" && parts[3] === "databases" && parts.length === 4) {
    const database = safeName(input.name);
    const username = safeName(input.username || "app");
    const password = String(input.password || "");
    if (password.length < 12) throw new Error("Database password must be at least 12 characters");
    const dbContainer = `mystic-host-db-${name}-${database}`;
    const volume = path.join(serverRoot, ".databases", database);
    await mkdir(volume, { recursive: true });
    try { await docker(["inspect", dbContainer]); return send(res, 409, { error: "Database already exists" }); } catch {}
    await docker(["run", "-d", "--name", dbContainer, "--restart", "unless-stopped", "-e", `MYSQL_DATABASE=${database}`, "-e", `MYSQL_USER=${username}`, "-e", `MYSQL_PASSWORD=${password}`, "-e", `MYSQL_ROOT_PASSWORD=${password}`, "-v", `${volume}:/var/lib/mysql`, "mysql:8.4"]);
    return send(res, 201, { name: database, username, host: dbContainer, port: 3306 });
  }
  if (req.method === "GET" && parts[3] === "files" && parts.length >= 5) {
    const relative = safeRelativePath(parts.slice(4).join("/"));
    const target = path.join(serverRoot, relative);
    const details = await stat(target);
    if (details.isDirectory()) throw new Error("Path is a directory");
    if (details.size > 20 * 1024 * 1024) throw new Error("File is too large to download through the API");
    const data = await readFile(target);
    return send(res, 200, { path: relative, bytes: details.size, dataBase64: data.toString("base64") });
  }
  if (req.method === "POST" && parts[3] === "files") {
    const relative = safeRelativePath(input.path);
    const target = path.join(serverRoot, relative);
    const data = Buffer.from(String(input.dataBase64 || ""), "base64");
    if (!data.length || data.byteLength > 20 * 1024 * 1024) throw new Error("File payload must be between 1 byte and 20 MB");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    return send(res, 201, { success: true, path: relative, size: data.byteLength });
  }
  if (req.method === "POST" && parts[3] === "extract") {
    const archive = path.join(serverRoot, safeRelativePath(input.archive));
    if (!archive.startsWith(serverRoot + path.sep) || !archive.toLowerCase().endsWith(".zip")) throw new Error("Only zip archives inside the server volume can be extracted");
    await exec("unzip", ["-o", archive, "-d", serverRoot]);
    return send(res, 200, { success: true });
  }
  if (req.method === "DELETE" && parts.length === 3) {
    await docker(["rm", "-f", container]).catch(() => {});
    await rm(serverRoot, { recursive: true, force: true });
    return send(res, 200, { success: true });
  }
  return send(res, 404, { error: "Route not found" });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error);
    send(res, 400, { error: error.message || "Request failed" });
  });
});
server.listen(PORT, "127.0.0.1", () => console.log(`MYSTIC HOST node agent listening on 127.0.0.1:${PORT}`));
