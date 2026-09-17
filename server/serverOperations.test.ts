import { describe, expect, it } from "vitest";
import { acquireServerOperation, releaseServerOperation } from "./controlPlane";

describe("server operation locks", () => {
  it("rejects overlapping operations for one server", () => {
    acquireServerOperation(901, "backup-create");
    expect(() => acquireServerOperation(901, "reinstall")).toThrow("Server is busy with backup-create");
    releaseServerOperation(901);
  });

  it("allows another operation after release", () => {
    acquireServerOperation(902, "backup-restore");
    releaseServerOperation(902);
    expect(() => acquireServerOperation(902, "reinstall")).not.toThrow();
    releaseServerOperation(902);
  });
});
