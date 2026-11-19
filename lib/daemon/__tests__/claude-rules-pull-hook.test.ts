import { describe, expect, test } from "bun:test";
import type { ClaudeRulesResult } from "../../claude-rules/reconcile.ts";
import { createClaudeRulesPullHook } from "../claude-rules-pull-hook.ts";

function fakeLog() {
  const calls: { level: string; args: unknown[] }[] = [];
  const mk = (level: string) => (...args: unknown[]) => { calls.push({ level, args }); };
  return { calls, debug: mk("debug"), info: mk("info"), warn: mk("warn") };
}

const unchanged: ClaudeRulesResult = { mattstack: "ok", packs: [{ entry: "acme-widgets", state: "ok" }], links: [{ configDir: "/h/.claude", state: "ok" }] };
const changed: ClaudeRulesResult = { ...unchanged, packs: [{ entry: "acme-widgets", state: "written" }] };

describe("createClaudeRulesPullHook", () => {
  test("reconciles once per call and logs at debug when nothing changed", async () => {
    const log = fakeLog();
    let runs = 0;
    const hook = createClaudeRulesPullHook({ log, probes: {} as never, reconcile: async () => { runs++; return unchanged; } });
    await hook("acme");
    await hook("acme");
    expect(runs).toBe(2);
    expect(log.calls.map((c) => c.level)).toEqual(["debug", "debug"]);
  });

  test("a written or removed pack logs at info", async () => {
    const log = fakeLog();
    const hook = createClaudeRulesPullHook({ log, probes: {} as never, reconcile: async () => changed });
    await hook("acme");
    expect(log.calls.map((c) => c.level)).toEqual(["info"]);
  });

  test("never throws: a failed reconcile is logged at warn", async () => {
    const log = fakeLog();
    const hook = createClaudeRulesPullHook({ log, probes: {} as never, reconcile: async () => { throw new Error("disk full"); } });
    await expect(hook("acme")).resolves.toBeUndefined();
    expect(log.calls.map((c) => c.level)).toEqual(["warn"]);
    expect((log.calls[0]!.args[0] as { err: Error }).err.message).toBe("disk full");
  });
});
