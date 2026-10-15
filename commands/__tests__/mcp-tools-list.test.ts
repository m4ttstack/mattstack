import { describe, expect, test } from "bun:test";
import { mcpToolsPayload, progressReporter } from "../mcp.ts";
import { mcpTools } from "../../lib/mcp/tools.ts";

describe("mcpToolsPayload", () => {
  test("carries every roster tool with its description and schema, in roster order", () => {
    const roster = mcpTools();
    const payload = mcpToolsPayload(roster);
    expect(payload.tools.map((t) => t.name)).toEqual(roster.map((t) => t.name));
    for (const [i, t] of payload.tools.entries()) {
      expect(t.description).toBe(roster[i]!.description);
      expect(t.inputSchema).toEqual(roster[i]!.inputSchema);
      expect(Object.keys(t)).toEqual(["name", "description", "inputSchema"]);
    }
  });
  test("is plain JSON (no handlers, no functions)", () => {
    const text = JSON.stringify(mcpToolsPayload());
    expect(JSON.parse(text).tools.length).toBe(mcpTools().length);
    expect(text).not.toContain("handler");
  });
});

describe("progressReporter", () => {
  test("sends notifications/progress with the request's token and a rising count", async () => {
    const sent: unknown[] = [];
    const report = progressReporter("tok", async (n) => { sent.push(n); });
    report!();
    report!();
    expect(sent).toEqual([
      { method: "notifications/progress", params: { progressToken: "tok", progress: 1 } },
      { method: "notifications/progress", params: { progressToken: "tok", progress: 2 } },
    ]);
  });
  test("is undefined when the request carries no progress token", () => {
    expect(progressReporter(undefined, async () => {})).toBeUndefined();
  });
  test("swallows a failed send", async () => {
    const report = progressReporter(7, async () => { throw new Error("closed"); });
    expect(() => report!()).not.toThrow();
    await Bun.sleep(0);
  });
});
