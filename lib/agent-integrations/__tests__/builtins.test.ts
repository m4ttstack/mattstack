import { describe, expect, test } from "bun:test";
import { builtinRegistry } from "../builtins.ts";

const CODEX_ACCOUNT = "codex does not support --account in this version (see spec's Non-goals)";

describe("builtinRegistry", () => {
  test("registers claude then codex and nothing else", () => {
    const registry = builtinRegistry();
    expect(registry.list().map((item) => item.id)).toEqual(["claude", "codex"]);
    expect(registry.get("cursor")).toBeUndefined();
    expect(registry.get("toString")).toBeUndefined();
  });

  test("codex refuses an account and keeps today's wording", () => {
    const codex = builtinRegistry().get("codex")!;
    expect(codex.validateOptions({ account: "a@b.c" }))
      .toEqual({ ok: false, error: { code: "unsupported", message: CODEX_ACCOUNT } });
    expect(codex.validateOptions({ model: "gpt", yolo: true }))
      .toEqual({ ok: true, data: { model: "gpt", yolo: true } });
  });

  test("claude accepts every shared option", () => {
    const options = { model: "opus", effort: "high", account: "a@b.c", extraArgs: "--verbose", yolo: false };
    expect(builtinRegistry().get("claude")!.validateOptions(options)).toEqual({ ok: true, data: options });
  });

  test("only claude describes an account option", async () => {
    const registry = builtinRegistry();
    const names = async (id: string) => (await registry.get(id)!.options()).map((option) => option.name);
    expect(await names("claude")).toContain("account");
    expect(await names("codex")).not.toContain("account");
  });

  test("no built-in advertises session capabilities before its session adapter exists", async () => {
    for (const integration of builtinRegistry().list()) {
      expect("loadSessions" in integration).toBe(false);
      const report = await integration.capabilities("herdr");
      expect(report.supported).toEqual([]);
      expect(report.readiness.ready).toBe(false);
    }
  });
});
