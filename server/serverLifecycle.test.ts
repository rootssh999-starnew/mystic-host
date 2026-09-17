import { describe, expect, it } from "vitest";
import { assertServerStatusTransition, canTransitionServerStatus } from "@shared/serverLifecycle";

describe("server lifecycle policy", () => {
  it("allows normal installation and runtime transitions", () => {
    expect(canTransitionServerStatus("installing", "offline")).toBe(true);
    expect(canTransitionServerStatus("offline", "running")).toBe(true);
    expect(canTransitionServerStatus("running", "stopping")).toBe(true);
    expect(canTransitionServerStatus("stopping", "offline")).toBe(true);
  });

  it("allows retrying a failed installation", () => {
    expect(canTransitionServerStatus("failed", "installing")).toBe(true);
  });

  it("rejects skipping lifecycle states", () => {
    expect(canTransitionServerStatus("installing", "running")).toBe(false);
    expect(() => assertServerStatusTransition("installing", "running")).toThrow("Invalid server status transition");
  });
});
