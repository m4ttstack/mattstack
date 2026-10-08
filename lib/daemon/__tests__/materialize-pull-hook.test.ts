import { describe, expect, test } from "bun:test";
import { createMaterializePullHook } from "../materialize-pull-hook.ts";
import type { MaterializeSkillsResult } from "../../setup/skills-materialize.ts";

function fakeLog() {
  const calls: { level: string; args: unknown[] }[] = [];
  const mk = (level: string) => (...args: unknown[]) => { calls.push({ level, args }); };
  return { calls, debug: mk("debug"), info: mk("info"), warn: mk("warn") };
}
const written: MaterializeSkillsResult = {
  skipped: false,
  repos: [{ name: "widgets", path: "/r", ok: true, detail: "Wrote 1 pack file: widgets", packs: [{ pack: "widgets", zone: "z", ok: true, path: "/x", layers: [] }] }],
};

describe("createMaterializePullHook", () => {
  test("materializes every repo and logs the tally at info when something was written", async () => {
    const log = fakeLog();
    const hook = createMaterializePullHook({ log, probes: {} as never, materialize: async () => written });
    await hook("acme");
    expect(log.calls.some((c) => c.level === "info" && JSON.stringify(c.args).includes("Materialized 1 pack file"))).toBe(true);
  });
  test("a waiting or engine-pack-missing skip logs at debug and writes nothing", async () => {
    const log = fakeLog();
    const hook = createMaterializePullHook({ log, probes: {} as never, materialize: async () => ({ skipped: true, reason: "engine-pack-missing: install the mattstack plugin first, then run this again", repos: [] }) });
    await hook("acme");
    expect(log.calls.map((c) => c.level)).toEqual(["debug"]);
  });
  test("never throws", async () => {
    const log = fakeLog();
    const hook = createMaterializePullHook({ log, probes: {} as never, materialize: async () => { throw new Error("disk full"); } });
    await expect(hook("acme")).resolves.toBeUndefined();
    expect(log.calls.some((c) => c.level === "warn")).toBe(true);
  });
  test("a repo-level failure is logged at warn with the repo name", async () => {
    const log = fakeLog();
    const hook = createMaterializePullHook({ log, probes: {} as never, materialize: async () => ({ skipped: false, repos: [{ name: "widgets", path: "/r", ok: false, detail: "bad fragment" }] }) });
    await hook("acme");
    expect(log.calls.some((c) => c.level === "warn" && JSON.stringify(c.args).includes("widgets"))).toBe(true);
  });
});
