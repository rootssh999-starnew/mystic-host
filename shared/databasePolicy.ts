export function assertDatabaseName(value: string) {
  const name = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(name)) throw new Error("Database name must use 1-48 letters, numbers, underscores, or hyphens");
  return name;
}

export function assertDatabasePassword(value: string) {
  if (value.length < 12) throw new Error("Database password must be at least 12 characters");
  return value;
}

export function databaseIdentity(serverId: number, name: string) {
  return `${serverId}:${name.trim().toLowerCase()}`;
}
