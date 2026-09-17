export type RetentionBackup = {
  id: number;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  createdAt: Date;
};

export function selectBackupsForCleanup(backups: RetentionBackup[], now: Date, retentionDays = 30, keepLatest = 5) {
  const cutoff = now.getTime() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
  return [...backups]
    .filter((backup) => backup.status === "completed" && backup.createdAt.getTime() < cutoff)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
    .slice(Math.max(0, keepLatest));
}
