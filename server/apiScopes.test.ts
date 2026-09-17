import { describe, expect, it } from "vitest";
import { hasApiScope, normalizeApiScopes } from "@shared/apiScopes";

describe("API scope policy", () => {
  it("deduplicates and trims supported scopes", () => {
    expect(normalizeApiScopes([" servers.read ", "servers.read", "files.write"])).toEqual(["servers.read", "files.write"]);
  });

  it("supports wildcard scopes for explicitly trusted tokens", () => {
    expect(hasApiScope(["*"], "servers.delete")).toBe(true);
  });

  it("rejects unsupported scopes instead of silently storing them", () => {
    expect(() => normalizeApiScopes(["servers.read", "root.shell"])).toThrow("Unsupported API scope");
  });
});
