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
export function createManagedNodeServer(input: { name: string; runtime: string; image: string; startup: string; memoryMb: number; cpu: number; port?: number }) {
  return request<NodeServer>(`/v1/servers/${encodeURIComponent(input.name)}`, { method: "POST", body: JSON.stringify(input) });
}
export function nodeAction(name: string, action: "start" | "stop" | "restart") {
  return request<NodeServer>(`/v1/servers/${encodeURIComponent(name)}/${action}`, { method: "POST" });
}
export function nodeLogs(name: string) {
  return request<{ logs: string }>(`/v1/servers/${encodeURIComponent(name)}/logs`);
}
export function nodeStats(name: string) {
  return request<Record<string, unknown>>(`/v1/servers/${encodeURIComponent(name)}/stats`);
}
export function nodeUploadFile(name: string, filePath: string, data: Buffer) {
  return request<{ success: boolean; path: string; size: number }>(`/v1/servers/${encodeURIComponent(name)}/files`, {
    method: "POST",
    body: JSON.stringify({ path: filePath, dataBase64: data.toString("base64") }),
  });
}
export function nodeExtractZip(name: string, archive: string) {
  return request<{ success: boolean }>(`/v1/servers/${encodeURIComponent(name)}/extract`, {
    method: "POST",
    body: JSON.stringify({ archive }),
  });
}
export function deleteNodeServer(name: string) {
  return request<{ success: boolean }>(`/v1/servers/${encodeURIComponent(name)}`, { method: "DELETE" });
}
