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

  test("a built-in advertises session capabilities only with its session adapter, and peer delivery only with messaging", async () => {
    for (const integration of builtinRegistry().list()) {
      const report = await integration.capabilities("herdr");
      const peer = integration.loadMessaging ? ["peer-idle", "peer-working"] as const : [];
      if (integration.loadSessions) expect(report.supported).toEqual(["launch", "resume", "observe", ...peer]);
      else expect(report).toMatchObject({ supported: [], readiness: { ready: false } });
    }
    expect(typeof builtinRegistry().get("claude")!.loadSessions).toBe("function");
    expect(typeof builtinRegistry().get("codex")!.loadSessions).toBe("function");
  });
});
