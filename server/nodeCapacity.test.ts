import { describe, expect, it } from "vitest";
import { allocationKey, assertCapacityAvailable, capacityUsage } from "@shared/nodeCapacity";

describe("node capacity policy", () => {
  const node = { memoryMb: 1024, diskMb: 10000, memoryOverallocate: 50, diskOverallocate: 0 };

  it("calculates usage and over-allocation limits", () => {
    expect(capacityUsage(node, [{ memoryMb: 512, diskMb: 2000 }])).toMatchObject({ memoryUsedMb: 512, memoryLimitMb: 1536, diskLimitMb: 10000 });
  });

  it("rejects reservations beyond effective capacity", () => {
    expect(() => assertCapacityAvailable(node, [{ memoryMb: 1400, diskMb: 2000 }], { memoryMb: 200, diskMb: 100 })).toThrow("Node memory capacity exceeded");
    expect(() => assertCapacityAvailable(node, [], { memoryMb: 1, diskMb: 10001 })).toThrow("Node disk capacity exceeded");
  });

  it("normalizes allocation identity", () => {
    expect(allocationKey(" 127.0.0.1 ", 25565)).toBe("127.0.0.1:25565");
  });
});
