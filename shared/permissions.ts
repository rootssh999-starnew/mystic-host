export const SERVER_PERMISSIONS = [
  "control",
  "console",
  "file.read",
  "file.write",
  "backup.read",
  "backup.create",
  "backup.restore",
  "backup.delete",
  "database.read",
  "database.create",
  "database.update",
  "database.delete",
  "schedule.read",
  "schedule.update",
  "member.read",
  "member.update",
] as const;

export type ServerPermission = (typeof SERVER_PERMISSIONS)[number];

const ALIASES: Record<string, ServerPermission> = {
  "backups.read": "backup.read",
  "backups.create": "backup.create",
  "backups.restore": "backup.restore",
  "backups.delete": "backup.delete",
  "databases.read": "database.read",
  "databases.create": "database.create",
  "databases.update": "database.update",
  "databases.delete": "database.delete",
  "members.read": "member.read",
  "members.update": "member.update",
  "members.delete": "member.update",
};

export function normalizePermission(value: string) {
  return ALIASES[value] || value;
}

export function normalizePermissions(values: string[]) {
  return Array.from(new Set(values.map(normalizePermission)));
}

export function hasPermission(values: string[], required: string) {
  const permissions = normalizePermissions(values);
  return values.includes("*") || permissions.includes(normalizePermission(required));
}
