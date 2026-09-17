import { describe, expect, it } from "vitest";
import { assertDatabaseName, assertDatabasePassword, databaseIdentity } from "@shared/databasePolicy";

describe("database policy", () => {
  it("accepts safe names and strong passwords", () => {
    expect(assertDatabaseName("app_db-1")).toBe("app_db-1");
    expect(assertDatabasePassword("long-enough-password")).toBe("long-enough-password");
  });

  it("rejects unsafe names and short passwords", () => {
    expect(() => assertDatabaseName("bad/name")).toThrow("Database name");
    expect(() => assertDatabasePassword("short")).toThrow("at least 12");
  });

  it("normalizes database identity", () => {
    expect(databaseIdentity(7, " App_DB ")).toBe("7:app_db");
  });
});
