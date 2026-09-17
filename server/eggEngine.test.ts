import { describe, expect, it } from "vitest";
import { missingEggVariables, parseEggVariables, renderEggTemplate } from "@shared/eggEngine";

describe("egg engine", () => {
  it("renders startup and install variables", () => {
    expect(renderEggTemplate("java -Xmx{{ SERVER_MEMORY }}M --port {{SERVER_PORT}}", { SERVER_MEMORY: 2048, SERVER_PORT: 25565 })).toBe("java -Xmx2048M --port 25565");
  });

  it("reports missing variables once", () => {
    expect(missingEggVariables("{{A}} {{A}} {{B}}", { A: "ok" })).toEqual(["B"]);
  });

  it("rejects invalid variable payloads", () => {
    expect(() => parseEggVariables("[]")).toThrow("JSON object");
    expect(() => parseEggVariables("not-json")).toThrow("valid JSON");
  });
});
