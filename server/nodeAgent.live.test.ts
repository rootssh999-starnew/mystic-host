import { describe, expect, it } from "vitest";
import { nodeHealth } from "./nodeAgent";

describe("live node agent", () => {
  it("accepts the configured server-side token and reports healthy", async () => {
    if (!process.env.MYSTIC_HOST_NODE_AGENT_URL || !process.env.MYSTIC_HOST_NODE_AGENT_TOKEN) return;
    const result = await nodeHealth();
    expect(result.ok).toBe(true);
    expect(result.service).toBe("mystic-host-node-agent");
  });
});
