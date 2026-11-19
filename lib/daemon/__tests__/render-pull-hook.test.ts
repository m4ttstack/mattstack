import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { rtDir } from "../../rt-paths.ts";
import type { Probes } from "../../setup/probes.ts";
import { createRenderPullHook, renderChildArgv, renderInChild, type RenderChild, type RenderSpawn } from "../render-pull-hook.ts";
import { teamPullHooks } from "../team-pull-hooks.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");

function fakeChild(exitCode: number | "hang", stdout = "", stderr = "") {
  const calls: { argv: string[]; opts: Parameters<RenderSpawn>[1] }[] = [];
  const killed: string[] = [];
  const spawn: RenderSpawn = (argv, opts) => {
    calls.push({ argv, opts });
    let finish!: (code: number) => void;
    const exited = new Promise<number>((resolve) => { finish = resolve; });
    if (exitCode !== "hang") finish(exitCode);
    const child: RenderChild = {
      exited,
      stdout: new Response(stdout).body!,
      stderr: new Response(stderr).body!,
      kill: (signal) => { killed.push(String(signal)); finish(137); },
    };
    return child;
  };
  return { calls, killed, spawn };
}

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
  test("with no husk pack on this Mac, no render runs", async () => {
    let renders = 0;
    const hook = createRenderPullHook({
      log: fakeLog(),
      probes: fakeProbes({ [`${TEAMS}/widgets/plugin/pack/skills.jsonc`]: "{}" }),
      render: async () => {
        renders++;
        return [];
      },
    });
    await hook("acme");
    expect(renders).toBe(0);
  });

  test("renders the pulled org's husk packs and logs each failure at warn with pack and reason", async () => {
    const log = fakeLog();
    const orgs: string[] = [];
    const hook = createRenderPullHook({
      log,
      probes: fakeProbes(HUSKS),
      render: async (org) => {
        orgs.push(org);
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

  test("a child that times out warns and does not throw", async () => {
    const log = fakeLog();
    const child = fakeChild("hang");
    const hook = createRenderPullHook({ log, probes: fakeProbes(HUSKS), render: (org) => renderInChild(org, { argv: ["rt"], spawn: child.spawn, timeoutMs: 20 }) });
    await expect(hook("acme")).resolves.toBeUndefined();
    expect(child.killed).toEqual(["SIGKILL"]);
    expect(log.calls.some((c) => c.level === "warn")).toBe(true);
  });
});

describe("renderChildArgv", () => {
  test("from source it runs cli.ts, never the daemon entry", () => {
    expect(renderChildArgv("acme", { compiled: false, execPath: "/bin/bun" })).toEqual([
      "/bin/bun", "--no-env-file", `--config=${join(ROOT, "bunfig.toml")}`, join(ROOT, "cli.ts"),
      "skills", "render", "--husk-packs", "--org", "acme", "--json",
    ]);
    expect(existsSync(join(ROOT, "cli.ts"))).toBe(true);
  });

  test("compiled, it runs the binary itself", () => {
    expect(renderChildArgv("acme", { compiled: true, execPath: "/App/rt" })).toEqual(["/App/rt", "skills", "render", "--husk-packs", "--org", "acme", "--json"]);
  });
});

describe("renderInChild", () => {
  const SUMMARY = JSON.stringify({ ok: true, results: [{ pack: "widgets", ok: false, detail: "no mattstack" }] });

  test("reads the child's JSON summary, run from rt's own folder in batch mode", async () => {
    const child = fakeChild(0, SUMMARY);
    expect(await renderInChild("acme", { argv: ["rt"], spawn: child.spawn })).toEqual([{ pack: "widgets", ok: false, detail: "no mattstack" }]);
    expect(child.calls[0]!.opts.cwd).toBe(rtDir());
    expect(child.calls[0]!.opts.env.RT_BATCH).toBe("1");
  });

  test("a child with no summary throws with its stderr", async () => {
    const child = fakeChild(2, "", "rt hit an unexpected error");
    await expect(renderInChild("acme", { argv: ["rt"], spawn: child.spawn })).rejects.toThrow("exited 2 with no summary: rt hit an unexpected error");
  });

  test("a child past its deadline is killed", async () => {
    const child = fakeChild("hang");
    await expect(renderInChild("acme", { argv: ["rt"], spawn: child.spawn, timeoutMs: 20 })).rejects.toThrow("timed out");
    expect(child.killed).toEqual(["SIGKILL"]);
  });
});

describe("teamPullHooks", () => {
  test("runs after materialize, with the Claude rules before tool notices", () => {
    const tagged = (name: string) => Object.assign(async () => {}, { tag: name });
    const hooks = teamPullHooks(() => fakeLog(), tagged("tool-notices"), {
      intercepts: () => tagged("intercepts"),
      materialize: () => tagged("materialize"),
      render: () => tagged("render"),
      claudeRules: () => tagged("claude-rules"),
    });
    expect(hooks.map((h) => (h as unknown as { tag: string }).tag)).toEqual(["intercepts", "materialize", "render", "claude-rules", "tool-notices"]);
  });
});
