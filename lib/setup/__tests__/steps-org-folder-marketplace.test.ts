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

function claudeFake(opts: { registeredAt: string | null; plugins: { id: string; scope?: string; enabled: boolean; projectPath?: string }[]; fail?: string }) {
  const calls: string[][] = [];
  const exec: ExecScript = (argv) => {
    calls.push(argv);
    const [, , verb, sub] = argv;
    const sliced = argv.slice(1).join(" ");
    if (opts.fail && sliced.startsWith(opts.fail)) return { code: 1, stdout: "", stderr: `boom: ${sliced}` };
    if (verb === "marketplace" && sub === "list") return ok(JSON.stringify(opts.registeredAt === null ? [] : [{ name: "acme", source: "directory", path: opts.registeredAt, installLocation: opts.registeredAt }]));
    if (verb === "list") return ok(JSON.stringify(opts.plugins.map((pl) => ({ id: pl.id, version: "1.0.0", scope: pl.scope ?? "user", enabled: pl.enabled, ...(pl.projectPath ? { projectPath: pl.projectPath } : {}) }))));
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

  test("a stale path is removed, re-added and its user plugins reinstalled; a disabled plugin is reinstalled, then disabled again", async () => {
    const claude = claudeFake({ registeredAt: old(), plugins: [{ id: "widgets@acme", enabled: true }, { id: "gizmos@acme", enabled: false }, { id: "other@mattstack", enabled: true }] });
    const p = probes(claude.exec);
    updateSetupState(p, (s) => ({ ...s, marketplaces: [...s.marketplaces, old(), "https://github.com/acme/mattstack-marketplace.git"] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [old()] });
    expect(out.state).toBe("done");
    expect(out.detail).toContain("2 plugins reinstalled");
    expect(claude.commands()).toEqual([
      "plugin marketplace list --json",
      "plugin list --json",
      "plugin marketplace remove acme",
      `plugin marketplace add ${clone()}`,
      "plugin install widgets@acme --scope user",
      "plugin install gizmos@acme --scope user",
      "plugin disable gizmos@acme",
    ]);
    expect(readSetupState(p).orgMarketplaceMoves ?? []).toEqual([]);
  });

  test("a plugin installed for one project is handed back as an install only, never installed or disabled by rt", async () => {
    const claude = claudeFake({ registeredAt: old(), plugins: [{ id: "widgets@acme", enabled: true }, { id: "gadgets@acme", scope: "local", enabled: false }, { id: "other@mattstack", enabled: true }] });
    const p = probes(claude.exec);
    updateSetupState(p, (s) => ({ ...s, marketplaces: [...s.marketplaces, old(), "https://github.com/acme/mattstack-marketplace.git"] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [old()] });
    expect(out.state).toBe("partial");
    expect(out.detail).toContain("gadgets@acme must be reinstalled from the project that used it");
    expect(out.commands).toEqual(["claude plugin install gadgets@acme --scope local"]);
    expect(claude.commands()).toEqual([
      "plugin marketplace list --json",
      "plugin list --json",
      "plugin marketplace remove acme",
      `plugin marketplace add ${clone()}`,
      "plugin install widgets@acme --scope user",
    ]);
    expect(claude.commands().some((c) => c.includes("--scope local") || c.includes("disable gadgets"))).toBe(false);
    const state = readSetupState(p);
    expect(state.marketplaces).toEqual([clone(), "https://github.com/acme/mattstack-marketplace.git"]);
    expect(state.orgMarketplaceMoves ?? []).toEqual([]);
  });

  test("a project plugin whose project claude names is handed back as an install run in that project", async () => {
    const project = join(home, "src", "widgets-app");
    const claude = claudeFake({ registeredAt: old(), plugins: [{ id: "gadgets@acme", scope: "project", enabled: false, projectPath: project }] });
    const p = probes(claude.exec);
    p.env.CLAUDE_CONFIG_DIR = join(home, "cfg2");
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [old()] });
    expect(out.state).toBe("partial");
    expect(out.detail).toContain("gadgets@acme must be reinstalled from the project that used it");
    expect(out.commands).toEqual([`cd ${project} && CLAUDE_CONFIG_DIR=${join(home, "cfg2")} claude plugin install gadgets@acme --scope project`]);
    expect(claude.commands().some((c) => c.includes("disable"))).toBe(false);
  });

  test("the pending record carries a project plugin's project path", async () => {
    const project = join(home, "src", "widgets-app");
    const claude = claudeFake({ registeredAt: old(), plugins: [{ id: "gadgets@acme", scope: "local", enabled: true, projectPath: project }], fail: "plugin marketplace add" });
    const p = probes(claude.exec);
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [old()] });
    expect(out.state).toBe("partial");
    expect(out.commands).toEqual([`claude plugin marketplace add ${clone()}`, `cd ${project} && claude plugin install gadgets@acme --scope local`]);
    expect(readSetupState(p).orgMarketplaceMoves).toEqual([
      { marketplace: "acme", dir: clone(), configDir: defaultCfg(), plugins: [{ id: "gadgets@acme", scope: "local", enabled: true, projectPath: project }] },
    ]);
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
    expect(out.detail).toContain("finished reinstalling 1 plugin from acme");
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

  test("claude missing after a move ends partial with no commands and writes no pending record", async () => {
    const p = probes(undefined);
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [old()] });
    expect(out.state).toBe("partial");
    expect(out.commands).toBeUndefined();
    expect(out.detail).toContain("Install Claude Code and run the update again");
    expect(readSetupState(p).orgMarketplaceMoves ?? []).toEqual([]);
  });

  test("claude missing with nothing moved is skipped", async () => {
    const out = await convergeMarketplace(ctxFor(probes(undefined)), { dir: clone(), stalePaths: [] });
    expect(out).toEqual({ state: "skipped", detail: "Claude Code is not installed, so there is no marketplace to re-point" });
  });

  test("an unreadable marketplace list ends partial with no commands and touches nothing", async () => {
    const claude = claudeFake({ registeredAt: old(), plugins: [], fail: "plugin marketplace list" });
    const p = probes(claude.exec);
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [old()] });
    expect(out.state).toBe("partial");
    expect(out.commands).toBeUndefined();
    expect(out.detail).toContain("marketplace list could not be read");
    expect(out.detail).toContain("Running the update again retries");
    expect(claude.commands()).toEqual(["plugin marketplace list --json"]);
  });

  test("an unreadable plugin list before a re-point ends partial with no commands and leaves the pending record alone", async () => {
    const claude = claudeFake({ registeredAt: old(), plugins: [], fail: "plugin list" });
    const p = probes(claude.exec);
    const record = { marketplace: "acme", dir: clone(), configDir: defaultCfg(), plugins: [{ id: "widgets@acme", scope: "user", enabled: true }] };
    updateSetupState(p, (s) => ({ ...s, orgMarketplaceMoves: [record] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [old()] });
    expect(out.state).toBe("partial");
    expect(out.commands).toBeUndefined();
    expect(out.detail).toContain("plugin list could not be read");
    expect(claude.commands()).toEqual(["plugin marketplace list --json", "plugin list --json"]);
    expect(readSetupState(p).orgMarketplaceMoves).toEqual([record]);
  });

  test("a pending record's project plugins are handed back when the run finishes after the remove", async () => {
    const claude = claudeFake({ registeredAt: null, plugins: [] });
    const p = probes(claude.exec);
    updateSetupState(p, (s) => ({ ...s, orgMarketplaceMoves: [{ marketplace: "acme", dir: clone(), configDir: defaultCfg(), plugins: [{ id: "widgets@acme", scope: "user", enabled: true }, { id: "gadgets@acme", scope: "project", enabled: true }] }] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("partial");
    expect(out.commands).toEqual(["claude plugin install gadgets@acme --scope project"]);
    expect(claude.commands()).toEqual(["plugin marketplace list --json", `plugin marketplace add ${clone()}`, "plugin install widgets@acme --scope user"]);
    expect(readSetupState(p).orgMarketplaceMoves ?? []).toEqual([]);
  });

  test("a pending record at the clone hands back a missing local plugin and installs the missing user one", async () => {
    const claude = claudeFake({ registeredAt: clone(), plugins: [] });
    const p = probes(claude.exec);
    updateSetupState(p, (s) => ({ ...s, orgMarketplaceMoves: [{ marketplace: "acme", dir: clone(), configDir: defaultCfg(), plugins: [{ id: "widgets@acme", scope: "user", enabled: true }, { id: "gadgets@acme", scope: "local", enabled: false }] }] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("partial");
    expect(out.commands).toEqual(["claude plugin install gadgets@acme --scope local"]);
    expect(claude.commands()).toEqual(["plugin marketplace list --json", "plugin list --json", "plugin install widgets@acme --scope user"]);
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

  describe("cswap accounts", () => {
    const sessions = () => join(home, ".claude-swap-backup", "sessions");
    const dev1 = () => join(sessions(), "1-dev1_acme.test");
    const dev2 = () => join(sessions(), "2-dev2_acme.test");

    /** One claude per config dir: each keeps its own registration, so a re-point in one leaves the others as they were. */
    function perDir(registered: Record<string, string | null>, opts: { failIn?: string; fail?: string } = {}) {
      const seen: string[] = [];
      const exec: ExecScript = (argv, o) => {
        const cfg = o?.env?.CLAUDE_CONFIG_DIR ?? "";
        const sliced = argv.slice(1).join(" ");
        seen.push(`${cfg}: ${sliced}`);
        if (cfg === opts.failIn && opts.fail && sliced.startsWith(opts.fail)) return { code: 1, stdout: "", stderr: `boom: ${sliced}` };
        const [, , verb, sub] = argv;
        if (verb === "marketplace" && sub === "list") {
          const at = registered[cfg] ?? null;
          return ok(JSON.stringify(at === null ? [] : [{ name: "acme", source: "directory", path: at, installLocation: at }]));
        }
        if (verb === "marketplace" && sub === "remove") registered[cfg] = null;
        if (verb === "marketplace" && sub === "add") registered[cfg] = argv.at(-1)!;
        if (verb === "list") return ok(JSON.stringify([{ id: "widgets@acme", version: "1.0.0", scope: "user", enabled: true }]));
        return ok("");
      };
      const p = fakeProbes({
        home,
        env: { PATH: "/usr/local/bin" },
        files: { [CLAUDE]: "bin", [join(clone(), ".claude-plugin", "marketplace.json")]: '{ "name": "acme", "plugins": [] }', [join(sessions(), "notes.txt")]: "x" },
        dirs: { [sessions()]: ["2-dev2_acme.test", "1-dev1_acme.test", "notes.txt"], [dev1()]: [], [dev2()]: [] },
      });
      p.exec = (argv, o) => Promise.resolve(exec(argv, o));
      return { p, seen };
    }

    test("every account's config dir is re-pointed, each driven with its own CLAUDE_CONFIG_DIR", async () => {
      const { p, seen } = perDir({ [defaultCfg()]: old(), [dev1()]: old(), [dev2()]: null });
      const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [old()] });
      expect(out.state).toBe("done");
      expect(out.detail).toContain(`acme re-pointed in ${defaultCfg()}`);
      expect(out.detail).toContain(`acme re-pointed in ${dev1()}`);
      expect(out.detail).toContain(`acme is not registered in ${dev2()}`);
      expect(seen.filter((line) => line.startsWith(`${dev1()}: `))).toEqual([
        `${dev1()}: plugin marketplace list --json`,
        `${dev1()}: plugin list --json`,
        `${dev1()}: plugin marketplace remove acme`,
        `${dev1()}: plugin marketplace add ${clone()}`,
        `${dev1()}: plugin install widgets@acme --scope user`,
      ]);
      expect(seen.some((line) => line.startsWith(join(sessions(), "notes.txt")))).toBe(false);
      expect(readSetupState(p).orgMarketplaceMoves ?? []).toEqual([]);
    });

    test("a re-point that stops in one account keeps that account's pending record and hands back its own commands", async () => {
      const { p } = perDir({ [defaultCfg()]: old(), [dev1()]: old() }, { failIn: dev1(), fail: "plugin install" });
      const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [old()] });
      expect(out.state).toBe("partial");
      expect(out.commands).toEqual([`CLAUDE_CONFIG_DIR=${dev1()} claude plugin install widgets@acme --scope user`]);
      expect((readSetupState(p).orgMarketplaceMoves ?? []).map((m) => m.configDir)).toEqual([dev1()]);
    });
  });
});
