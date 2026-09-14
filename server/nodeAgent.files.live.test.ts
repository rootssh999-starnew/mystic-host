import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createNodeServer, deleteNodeServer, nodeExtractZip, nodeUploadFile } from "./nodeAgent";

const exec = promisify(execFile);
const testServer = "ci-zip-test";

describe("live node file workflows", () => {
  afterAll(async () => {
    if (process.env.MYSTIC_HOST_NODE_AGENT_URL && process.env.MYSTIC_HOST_NODE_AGENT_TOKEN) await deleteNodeServer(testServer).catch(() => undefined);
  });

  it("creates a container, uploads a ZIP, and extracts it into the volume", async () => {
    if (!process.env.MYSTIC_HOST_NODE_AGENT_URL || !process.env.MYSTIC_HOST_NODE_AGENT_TOKEN) return;
    await deleteNodeServer(testServer).catch(() => undefined);
    await createNodeServer({ name: testServer, runtime: "nodejs", memoryMb: 256, cpu: 0.25 });
    const temp = await mkdtemp(path.join(tmpdir(), "mystic-host-test-"));
    try {
      await writeFile(path.join(temp, "hello.txt"), "hello from MYSTIC HOST\n");
      await exec("zip", ["-q", path.join(temp, "bundle.zip"), "hello.txt"], { cwd: temp });
      const archive = await readFile(path.join(temp, "bundle.zip"));
      const upload = await nodeUploadFile(testServer, "bundle.zip", archive);
      expect(upload.success).toBe(true);
      const extracted = await nodeExtractZip(testServer, "bundle.zip");
      expect(extracted.success).toBe(true);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }, 30_000);
});
