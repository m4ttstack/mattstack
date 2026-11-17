import { describe, expect, test } from "bun:test";
import type { Probes } from "../../setup/probes.ts";
import { createRenderPullHook } from "../render-pull-hook.ts";
import { teamPullHooks } from "../team-pull-hooks.ts";

function fakeLog() {
  const calls: { level: string; args: unknown[] }[] = [];
  const mk = (level: string) => (...args: unknown[]) => { calls.push({ level, args }); };
  return { calls, debug: mk("debug"), info: mk("info"), warn: mk("warn") };
}

const HOME = "/home/alex";
const TEAMS = `${HOME}/.mattstack/orgs/acme/mattstack/teams`;
const HUSKS = { [`${TEAMS}/widgets/plugin/pack/skills.jsonc`]: '{ "husks": true }' };

function fakeProbes(files: Record<string, string>): Probes {
  const dirs = new Map<string, Set<string>>();
  for (const path of Object.keys(files)) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/") || "/";
      if (!dirs.has(dir)) dirs.set(dir, new Set());
      dirs.get(dir)!.add(parts[i]!);
    }
  }
  return {
    home: HOME,
    readFile: (p: string) => files[p] ?? null,
    exists: (p: string) => p in files || dirs.has(p),
    readDir: (p: string) => [...(dirs.get(p) ?? [])],
  } as unknown as Probes;
}

describe("createRenderPullHook", () => {
  test("with no husk pack on this Mac, the compile is never loaded", async () => {
    let loaded = 0;
    const hook = createRenderPullHook({
      log: fakeLog(),
      probes: fakeProbes({ [`${TEAMS}/widgets/plugin/pack/skills.jsonc`]: "{}" }),
      load: async () => {
        loaded++;
        return async () => [];
      },
    });
    await hook("acme");
    expect(loaded).toBe(0);
  });

  test("a husk pack loads the compile and renders", async () => {
    const orgs: (string | undefined)[] = [];
    const hook = createRenderPullHook({
      log: fakeLog(),
      probes: fakeProbes(HUSKS),
      load: async () => async (_p, opts) => {
        orgs.push(opts.org);
        return [];
      },
    });
    await hook("acme");
    expect(orgs).toEqual(["acme"]);
  });

  test("renders the pulled org's husk packs and logs each failure at warn with pack and reason", async () => {
    const log = fakeLog();
    const orgs: (string | undefined)[] = [];
    const hook = createRenderPullHook({
      log,
      probes: fakeProbes(HUSKS),
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
    const hook = createRenderPullHook({ log, probes: fakeProbes(HUSKS), render: async () => { throw new Error("disk full"); } });
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
