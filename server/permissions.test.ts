import { describe, expect, it } from "vitest";
import { hasPermission, normalizePermissions } from "@shared/permissions";

describe("server permission policy", () => {
  it("normalizes plural API aliases to canonical server permissions", () => {
    expect(normalizePermissions(["backups.read", "databases.create", "members.delete"])).toEqual(["backup.read", "database.create", "member.update"]);
  });
  it("allows wildcard administrators", () => {
    expect(hasPermission(["*"], "database.delete")).toBe(true);
  });
  it("denies permissions that are not granted", () => {
    expect(hasPermission(["file.read"], "file.write")).toBe(false);
  });
});
