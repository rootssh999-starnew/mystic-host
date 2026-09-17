import { describe, expect, it } from "vitest";
import { selectBackupsForCleanup } from "@shared/backupRetention";

const day = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-17T00:00:00Z");

describe("backup retention policy", () => {
  it("keeps the latest five old completed backups", () => {
    const backups = Array.from({ length: 7 }, (_, index) => ({ id: index + 1, name: `b${index + 1}`, status: "completed" as const, createdAt: new Date(now.getTime() - (40 + index) * day) }));
    expect(selectBackupsForCleanup(backups, now).map((backup) => backup.id)).toEqual([6, 7]);
  });

  it("never selects active, failed, or recent backups", () => {
    const backups = [
      { id: 1, name: "running", status: "running" as const, createdAt: new Date(now.getTime() - 90 * day) },
      { id: 2, name: "failed", status: "failed" as const, createdAt: new Date(now.getTime() - 90 * day) },
      { id: 3, name: "recent", status: "completed" as const, createdAt: new Date(now.getTime() - 2 * day) },
    ];
    expect(selectBackupsForCleanup(backups, now)).toEqual([]);
  });
});
