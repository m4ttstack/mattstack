import { describe, expect, test } from "bun:test";
import { agentCatalog } from "../src/index.ts";

describe("agentCatalog", () => {
  test("claude suggests its curated models and effort levels", async () => {
    const c = await agentCatalog("claude");
    expect(c?.model.map((m) => m.value)).toEqual(["sonnet", "opus", "haiku", "fable"]);
    expect(c?.effort.map((e) => e.value)).toEqual(["low", "medium", "high", "max"]);
  });

  test("codex suggests its live catalog, and nothing when that fails", async () => {
    expect(await agentCatalog("codex", { codexModels: async () => [{ value: "gpt-5", label: "GPT-5" }] }))
      .toEqual({ model: [{ value: "gpt-5", label: "GPT-5" }], effort: [] });
    expect(await agentCatalog("codex", { codexModels: async () => { throw new Error("gone"); } }))
      .toEqual({ model: [], effort: [] });
  });

  test("a harness with no catalog has none", async () => {
    expect(await agentCatalog("pilot")).toBeUndefined();
  });
});
