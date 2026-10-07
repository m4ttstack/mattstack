import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ApplyContext } from "../apply.ts";
import type { Probes } from "../probes.ts";
import { readSetupState, updateSetupState } from "../state.ts";
import { convergeMarketplace, marketplaceName } from "../steps/org-folder-marketplace.ts";
import { fakeProbes, ok, type ExecScript } from "./fakes.ts";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "rt-org-mkt-")); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

const CLAUDE = "/usr/local/bin/claude";
const clone = () => join(home, ".mattstack", "orgs", "acme");
const old = () => join(home, ".mattstack", "teams", "acme");
const defaultCfg = () => join(home, ".claude");

function ctxFor(p: Probes): ApplyContext {
  return { p, emit: () => {}, log: () => {}, intent: null, team: { slug: "", name: "", mode: "none" }, snapshot: null, reqs: [], nonInteractive: true, teamOfOne: false, appPath: null, ci: false, secrets: {} as never, teamSecrets: () => ({}) as never, relay: {} as never, secretPresence: { has: async () => null }, redact: () => {}, need: async () => "no-app" } as ApplyContext;
}

function claudeFake(opts: { registeredAt: string | null; plugins: { id: string; scope?: string; enabled: boolean }[]; fail?: string }) {
  const calls: string[][] = [];
  const exec: ExecScript = (argv) => {
    calls.push(argv);
    const [, , verb, sub] = argv;
    const sliced = argv.slice(1).join(" ");
    if (opts.fail && sliced.startsWith(opts.fail)) return { code: 1, stdout: "", stderr: `boom: ${sliced}` };
    if (verb === "marketplace" && sub === "list") return ok(JSON.stringify(opts.registeredAt === null ? [] : [{ name: "acme", source: "directory", path: opts.registeredAt, installLocation: opts.registeredAt }]));
    if (verb === "list") return ok(JSON.stringify(opts.plugins.map((pl) => ({ id: pl.id, version: "1.0.0", scope: pl.scope ?? "user", enabled: pl.enabled }))));
    return ok("");
  };
  return { calls, exec, commands: () => calls.map((c) => c.slice(1).join(" ")) };
}

function probes(exec: ExecScript | undefined, files: Record<string, string> = {}) {
  const p = fakeProbes({
    home,
    env: exec ? { PATH: "/usr/local/bin" } : {},
    files: { ...(exec ? { [CLAUDE]: "bin" } : {}), [join(clone(), ".claude-plugin", "marketplace.json")]: '{ "name": "acme", "plugins": [] }', ...files },
  });
  if (exec) p.exec = (argv, o) => Promise.resolve(exec(argv, o));
  return p;
}

describe("marketplaceName", () => {
  test("reads the clone's marketplace name and returns null without one", () => {
    expect(marketplaceName(probes(undefined), clone())).toBe("acme");
    expect(marketplaceName(fakeProbes({ home }), clone())).toBeNull();
  });
});

describe("convergeMarketplace", () => {
  test("done when the registered path is already the clone", async () => {
    const claude = claudeFake({ registeredAt: clone(), plugins: [] });
    const out = await convergeMarketplace(ctxFor(probes(claude.exec)), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("done");
    expect(claude.commands()).toEqual(["plugin marketplace list --json"]);
  });

  test("skipped when the marketplace is not registered and nothing is pending", async () => {
    const claude = claudeFake({ registeredAt: null, plugins: [] });
    const out = await convergeMarketplace(ctxFor(probes(claude.exec)), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("skipped");
  });

  test("a stale path is removed, re-added and its plugins reinstalled; a disabled plugin is reinstalled, then disabled again", async () => {
    const claude = claudeFake({ registeredAt: old(), plugins: [{ id: "widgets@acme", enabled: true }, { id: "gadgets@acme", scope: "local", enabled: false }, { id: "other@mattstack", enabled: true }] });
    const p = probes(claude.exec);
    updateSetupState(p, (s) => ({ ...s, marketplaces: [...s.marketplaces, old(), "https://github.com/acme/mattstack-marketplace.git"] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [old()] });
    expect(out.state).toBe("done");
    expect(claude.commands()).toEqual([
      "plugin marketplace list --json",
      "plugin list --json",
      "plugin marketplace remove acme",
      `plugin marketplace add ${clone()}`,
      "plugin install widgets@acme --scope user",
      "plugin install gadgets@acme --scope local",
      "plugin disable gadgets@acme",
    ]);
    const state = readSetupState(p);
    expect(state.marketplaces).toEqual([clone(), "https://github.com/acme/mattstack-marketplace.git"]);
    expect(state.orgMarketplaceMoves ?? []).toEqual([]);
  });

  test("the pending record is written before the remove and kept when a reinstall fails", async () => {
    const claude = claudeFake({ registeredAt: old(), plugins: [{ id: "widgets@acme", enabled: true }, { id: "gadgets@acme", enabled: false }], fail: "plugin install widgets@acme" });
    const p = probes(claude.exec);
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [old()] });
    expect(out.state).toBe("partial");
    expect(out.commands).toEqual([
      "claude plugin install widgets@acme --scope user",
      "claude plugin install gadgets@acme --scope user",
      "claude plugin disable gadgets@acme",
    ]);
    expect(out.detail).toContain("boom");
    expect(readSetupState(p).orgMarketplaceMoves).toEqual([
      { marketplace: "acme", dir: clone(), configDir: defaultCfg(), plugins: [{ id: "widgets@acme", scope: "user", enabled: true }, { id: "gadgets@acme", scope: "user", enabled: false }] },
    ]);
  });

  test("a rerun after a failure between remove and add finishes from the pending record", async () => {
    const claude = claudeFake({ registeredAt: null, plugins: [] });
    const p = probes(claude.exec);
    updateSetupState(p, (s) => ({ ...s, orgMarketplaceMoves: [{ marketplace: "acme", dir: clone(), configDir: defaultCfg(), plugins: [{ id: "widgets@acme", scope: "user", enabled: true }, { id: "gadgets@acme", scope: "user", enabled: false }] }] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("done");
    expect(claude.commands()).toEqual([
      "plugin marketplace list --json",
      `plugin marketplace add ${clone()}`,
      "plugin install widgets@acme --scope user",
      "plugin install gadgets@acme --scope user",
      "plugin disable gadgets@acme",
    ]);
    expect(readSetupState(p).orgMarketplaceMoves ?? []).toEqual([]);
  });

  test("a rerun after a failure between add and install reinstalls from the record", async () => {
    const claude = claudeFake({ registeredAt: clone(), plugins: [{ id: "widgets@acme", enabled: true }] });
    const p = probes(claude.exec);
    updateSetupState(p, (s) => ({ ...s, orgMarketplaceMoves: [{ marketplace: "acme", dir: clone(), configDir: defaultCfg(), plugins: [{ id: "widgets@acme", scope: "user", enabled: true }, { id: "gadgets@acme", scope: "user", enabled: false }] }] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("done");
    expect(claude.commands()).toEqual([
      "plugin marketplace list --json",
      "plugin list --json",
      "plugin install gadgets@acme --scope user",
      "plugin disable gadgets@acme",
    ]);
    expect(readSetupState(p).orgMarketplaceMoves ?? []).toEqual([]);
  });

  test("a pending record is kept when the reinstall from it fails", async () => {
    const claude = claudeFake({ registeredAt: clone(), plugins: [], fail: "plugin install gadgets@acme" });
    const p = probes(claude.exec);
    const record = { marketplace: "acme", dir: clone(), configDir: defaultCfg(), plugins: [{ id: "gadgets@acme", scope: "user", enabled: false }] };
    updateSetupState(p, (s) => ({ ...s, orgMarketplaceMoves: [record] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("partial");
    expect(out.commands).toEqual(["claude plugin install gadgets@acme --scope user", "claude plugin disable gadgets@acme"]);
    expect(readSetupState(p).orgMarketplaceMoves).toEqual([record]);
  });

  test("a rerun after a remove that failed part way keeps the recorded plugins the remove already uninstalled", async () => {
    const claude = claudeFake({ registeredAt: old(), plugins: [{ id: "widgets@acme", enabled: true }] });
    const p = probes(claude.exec);
    updateSetupState(p, (s) => ({ ...s, orgMarketplaceMoves: [{ marketplace: "acme", dir: clone(), configDir: defaultCfg(), plugins: [{ id: "widgets@acme", scope: "user", enabled: true }, { id: "gadgets@acme", scope: "user", enabled: false }] }] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("done");
    expect(claude.commands()).toEqual([
      "plugin marketplace list --json",
      "plugin list --json",
      "plugin marketplace remove acme",
      `plugin marketplace add ${clone()}`,
      "plugin install widgets@acme --scope user",
      "plugin install gadgets@acme --scope user",
      "plugin disable gadgets@acme",
    ]);
    expect(readSetupState(p).orgMarketplaceMoves ?? []).toEqual([]);
  });

  test("claude missing ends partial with the remove and add commands and writes no pending record", async () => {
    const p = probes(undefined);
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [old()] });
    expect(out.state).toBe("partial");
    expect(out.commands).toEqual([
      "claude plugin marketplace remove acme",
      `claude plugin marketplace add ${clone()}`,
    ]);
    expect(out.detail).toContain("Claude Code");
    expect(readSetupState(p).orgMarketplaceMoves ?? []).toEqual([]);
  });

  test("a second config dir is driven with CLAUDE_CONFIG_DIR and named in its commands", async () => {
    const claude = claudeFake({ registeredAt: old(), plugins: [], fail: "plugin marketplace add" });
    const p = probes(claude.exec);
    const envs: (string | undefined)[] = [];
    const exec = p.exec.bind(p);
    p.exec = (argv, o) => { envs.push(o?.env?.CLAUDE_CONFIG_DIR); return exec(argv, o); };
    p.env.CLAUDE_CONFIG_DIR = join(home, "cfg2");
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("partial");
    expect(new Set(envs)).toEqual(new Set([join(home, "cfg2")]));
    expect(out.commands?.[0]).toBe(`CLAUDE_CONFIG_DIR=${join(home, "cfg2")} claude plugin marketplace add ${clone()}`);
  });
});
