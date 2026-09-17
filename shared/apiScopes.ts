export const API_SCOPES = [
  "servers.read",
  "servers.create",
  "servers.update",
  "servers.delete",
  "servers.control",
  "console.read",
  "resources.read",
  "files.read",
  "files.write",
  "archives.write",
  "backups.read",
  "backups.create",
  "backups.delete",
  "backups.restore",
  "databases.read",
  "databases.create",
  "databases.delete",
  "databases.update",
  "members.read",
  "members.update",
  "members.delete",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function normalizeApiScopes(values: string[]) {
  const normalized = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  const invalid = normalized.filter((value) => value !== "*" && !API_SCOPES.includes(value as ApiScope));
  if (invalid.length) throw new Error(`Unsupported API scope: ${invalid[0]}`);
  return normalized;
}

export function hasApiScope(scopes: string[], required: string) {
  return normalizeApiScopes(scopes).includes("*") || normalizeApiScopes(scopes).includes(required as ApiScope);
}
