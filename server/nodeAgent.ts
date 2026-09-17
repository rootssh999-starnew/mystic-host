import { ENV } from "./_core/env";

function config() {
  if (!ENV.nodeAgentUrl || !ENV.nodeAgentToken) throw new Error("Node agent is not configured");
  return { url: ENV.nodeAgentUrl.replace(/\/+$/, ""), token: ENV.nodeAgentToken };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, token } = config();
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Node agent request failed (${response.status})`);
  return body as T;
}

export type NodeServer = { name: string; status: string; running: boolean; image?: string };

export function nodeHealth() {
  return request<{ ok: boolean; service: string; version: string }>("/health");
}
export function listNodeServers() {
  return request<{ servers: NodeServer[] }>("/v1/servers");
}
export function createNodeServer(input: { name: string; runtime: string; memoryMb: number; cpu: number }) {
  return request<NodeServer>(`/v1/servers/${encodeURIComponent(input.name)}`, { method: "POST", body: JSON.stringify(input) });
}
export function createManagedNodeServer(input: { name: string; runtime: string; image: string; startup: string; installScript?: string; memoryMb: number; cpu: number; port?: number }) {
  return request<NodeServer>(`/v1/servers/${encodeURIComponent(input.name)}`, { method: "POST", body: JSON.stringify(input) });
}
export function nodeReinstallServer(input: { name: string; runtime: string; image: string; startup: string; installScript?: string; memoryMb: number; cpu: number; port?: number }) {
  return request<NodeServer & { rebuilt?: boolean }>(`/v1/servers/${encodeURIComponent(input.name)}/reinstall`, { method: "POST", body: JSON.stringify(input) });
}
export function nodeAction(name: string, action: "start" | "stop" | "restart") {
  return request<NodeServer>(`/v1/servers/${encodeURIComponent(name)}/${action}`, { method: "POST" });
}
export function nodeLogs(name: string) {
  return request<{ logs: string; name?: string; status?: string }>(`/v1/servers/${encodeURIComponent(name)}/logs`);
}
export function nodeCommand(name: string, command: string) {
  return request<{ output: string }>(`/v1/servers/${encodeURIComponent(name)}/command`, { method: "POST", body: JSON.stringify({ command }) });
}
export function nodeStats(name: string) {
  return request<Record<string, unknown> & { name?: string; status?: string }>(`/v1/servers/${encodeURIComponent(name)}/stats`);
}
export function nodeInstallStatus(name: string) {
  return request<{ name: string; status: string; progress: number; logs: string; container: NodeServer }>(`/v1/servers/${encodeURIComponent(name)}/install-status`);
}
export function nodeCancelInstall(name: string) { return request<{ name: string; status: string; preservedVolume: boolean }>(`/v1/servers/${encodeURIComponent(name)}/cancel-install`, { method: "POST" }); }
export function nodeBackups(name: string) {
  return request<{ backups: Array<{ name: string; bytes: number; checksum: string; createdAt: string }> }>(`/v1/servers/${encodeURIComponent(name)}/backups`);
}
export function nodeCreateBackup(name: string) {
  return request<{ name: string; bytes: number; checksum: string; createdAt: string }>(`/v1/servers/${encodeURIComponent(name)}/backups`, { method: "POST" });
}
export function nodeDeleteBackup(name: string, backupName: string) {
  return request<{ success: boolean; name: string }>(`/v1/servers/${encodeURIComponent(name)}/backups/${backupName.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" });
}
export function nodeRestoreBackup(name: string, backupName: string, checksum?: string) {
  return request<{ success: boolean; name: string; checksum: string }>(`/v1/servers/${encodeURIComponent(name)}/restore`, { method: "POST", body: JSON.stringify({ name: backupName, checksum }) });
}
export function nodeListFiles(name: string, relativePath?: string) {
  const query = relativePath ? `?path=${encodeURIComponent(relativePath)}` : "";
  return request<{ files: Array<{ name: string; path: string; directory: boolean; bytes: number; modifiedAt: string }> }>(`/v1/servers/${encodeURIComponent(name)}/files${query}`);
}
export function nodeDownloadFile(name: string, relativePath: string) {
  return request<{ path: string; bytes: number; dataBase64: string }>(`/v1/servers/${encodeURIComponent(name)}/files/${relativePath.split("/").map(encodeURIComponent).join("/")}`);
}
export function nodeCreateDatabase(name: string, database: string, username: string, password: string) {
  return request<{ name: string; username: string; host: string; port: number }>(`/v1/servers/${encodeURIComponent(name)}/databases`, { method: "POST", body: JSON.stringify({ name: database, username, password }) });
}
export function nodeUploadFile(name: string, filePath: string, data: Buffer) {
  return request<{ success: boolean; path: string; size: number }>(`/v1/servers/${encodeURIComponent(name)}/files`, {
    method: "POST",
    body: JSON.stringify({ path: filePath, dataBase64: data.toString("base64") }),
  });
}
export function nodeCreateFolder(name: string, folderPath: string) {
  return request<{ success: boolean; path: string; directory: boolean }>(`/v1/servers/${encodeURIComponent(name)}/files`, { method: "POST", body: JSON.stringify({ action: "create-folder", path: folderPath }) });
}
export function nodeInitUpload(name: string, filePath: string) { return request<{ uploadId: string; path: string; chunkSize: number }>(`/v1/servers/${encodeURIComponent(name)}/files`, { method: "POST", body: JSON.stringify({ action: "init-upload", path: filePath }) }); }
export function nodeUploadChunk(name: string, uploadId: string, index: number, data: Buffer) { return request<{ uploadId: string; index: number; bytes: number }>(`/v1/servers/${encodeURIComponent(name)}/files`, { method: "POST", body: JSON.stringify({ action: "upload-chunk", uploadId, index, dataBase64: data.toString("base64") }) }); }
export function nodeCompleteUpload(name: string, uploadId: string, filePath: string) { return request<{ success: boolean; path: string; size: number; chunks: number }>(`/v1/servers/${encodeURIComponent(name)}/files`, { method: "POST", body: JSON.stringify({ action: "complete-upload", uploadId, path: filePath }) }); }
export function nodeDeleteFile(name: string, filePath: string) {
  return request<{ success: boolean; path: string }>(`/v1/servers/${encodeURIComponent(name)}/files/${filePath.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" });
}
export function nodeExtractZip(name: string, archive: string) {
  return request<{ success: boolean }>(`/v1/servers/${encodeURIComponent(name)}/extract`, {
    method: "POST",
    body: JSON.stringify({ archive }),
  });
}
export function nodeCreateArchive(name: string, source: string, output?: string) { return request<{ success: boolean; path: string; bytes: number }>(`/v1/servers/${encodeURIComponent(name)}/archive`, { method: "POST", body: JSON.stringify({ path: source, output }) }); }
export function deleteNodeServer(name: string) {
  return request<{ success: boolean }>(`/v1/servers/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export function nodeSftpCredentials(name: string) { return request<{ host: string; port: number; username: string; password: string }>(`/v1/servers/${encodeURIComponent(name)}/sftp-credentials`); }
