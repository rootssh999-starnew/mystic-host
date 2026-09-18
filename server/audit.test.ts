import { describe, expect, it } from "vitest";
import { sanitizeAuditMetadata } from "./db";

describe("audit metadata safety", () => {
  it("removes secrets from nested objects and arrays", () => {
    const sanitized = sanitizeAuditMetadata({
      serverName: "demo",
      password: "not-recorded",
      nested: { apiToken: "not-recorded", action: "restart" },
      items: [{ privateKey: "not-recorded", id: 7 }],
    });

    expect(sanitized).toEqual({
      serverName: "demo",
      nested: { action: "restart" },
      items: [{ id: 7 }],
    });
    expect(JSON.stringify(sanitized)).not.toMatch(/not-recorded/);
  });

  it("preserves safe primitive values", () => {
    expect(sanitizeAuditMetadata({ action: "file.uploaded", bytes: 42, success: true })).toEqual({ action: "file.uploaded", bytes: 42, success: true });
  });
});
