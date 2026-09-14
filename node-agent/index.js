#!/usr/bin/env node
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const exec = promisify(execFile);
const PORT = Number(process.env.MYSTIC_HOST_AGENT_PORT || 8787);
const TOKEN = process.env.MYSTIC_HOST_AGENT_TOKEN || (await readFile(process.env.MYSTIC_HOST_AGENT_TOKEN_FILE || "/opt/mystic-host-node/agent.token", "utf8").catch(() => "")).trim();
const ROOT = process.env.MYSTIC_HOST_DATA_ROOT || "/opt/mystic-host-node/data";
const MAX_BODY = 30 * 1024 * 1024;

if (!TOKEN) {
  console.error("MYSTIC_HOST_AGENT_TOKEN is required");
  process.exit(1);
}

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
async function handle(req, res) {
  if (req.url === "/health" && req.method === "GET") return send(res, 200, { ok: true, service: "mystic-host-node-agent", version: "1.1.0" });
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
    const args = ["run", "-d", "--name", container, "--restart", "unless-stopped", "--memory", `${memory}m`, "--cpus", String(cpus), "-v", `${serverRoot}:/workspace"];
    if (Number.isInteger(port) && port > 0 && port < 65536) args.push("-p", `${port}:${port}`);
    args.push(image, "sh", "-c", startup);
    await docker(args);
    return send(res, 201, { ...(await containerInfo(name)), runtime, image, startup, memoryMb: memory, cpu: cpus, port: port || null });
  }
  if (req.method === "POST" && parts[3] === "start") { await docker(["start", container]); return send(res, 200, await containerInfo(name)); }
  if (req.method === "POST" && parts[3] === "stop") { await docker(["stop", "-t", "10", container]); return send(res, 200, await containerInfo(name)); }
  if (req.method === "POST" && parts[3] === "restart") { await docker(["restart", "-t", "10", container]); return send(res, 200, await containerInfo(name)); }
  if (req.method === "GET" && parts[3] === "stats") {
    const output = await docker(["stats", "--no-stream", "--format", "{{json .}}", container]);
    return send(res, 200, JSON.parse(output || "{}"));
  }
  if (req.method === "GET" && parts[3] === "logs") {
    const output = await docker(["logs", "--tail", "200", container]);
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
