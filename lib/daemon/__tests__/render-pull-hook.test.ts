import { describe, expect, test } from "bun:test";
import { createRenderPullHook } from "../render-pull-hook.ts";
import { teamPullHooks } from "../team-pull-hooks.ts";

function fakeLog() {
  const calls: { level: string; args: unknown[] }[] = [];
  const mk = (level: string) => (...args: unknown[]) => { calls.push({ level, args }); };
  return { calls, debug: mk("debug"), info: mk("info"), warn: mk("warn") };
}

describe("createRenderPullHook", () => {
  test("renders the pulled org's husk packs and logs each failure at warn with pack and reason", async () => {
    const log = fakeLog();
    const orgs: (string | undefined)[] = [];
    const hook = createRenderPullHook({
      log,
      render: async (_p, opts) => {
        orgs.push(opts.org);
        return [{ pack: "widgets", ok: true, detail: "rendered acme 0.1.0 for mattstack 1.0.0" }, { pack: "gadgets", ok: false, detail: "no mattstack" }];
      },
    });
    await hook("acme");
    expect(orgs).toEqual(["acme"]);
    const warns = log.calls.filter((c) => c.level === "warn");
    expect(warns).toHaveLength(1);
    expect(warns[0]!.args[0]).toEqual({ team: "acme", pack: "gadgets", reason: "no mattstack" });
  });

  test("never throws", async () => {
    const log = fakeLog();
    const hook = createRenderPullHook({ log, render: async () => { throw new Error("disk full"); } });
    await expect(hook("acme")).resolves.toBeUndefined();
    expect(log.calls.some((c) => c.level === "warn")).toBe(true);
  });
});

describe("teamPullHooks", () => {
  test("runs after materialize", () => {
    const tagged = (name: string) => Object.assign(async () => {}, { tag: name });
    const hooks = teamPullHooks(() => fakeLog(), tagged("tool-notices"), {
      intercepts: () => tagged("intercepts"),
      materialize: () => tagged("materialize"),
      render: () => tagged("render"),
    });
    expect(hooks.map((h) => (h as unknown as { tag: string }).tag)).toEqual(["intercepts", "materialize", "render", "tool-notices"]);
  });
});
