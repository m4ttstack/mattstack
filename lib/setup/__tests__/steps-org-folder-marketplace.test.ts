import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import type { ApplyContext } from "../apply.ts";
import type { ExecResult, Probes } from "../probes.ts";
import { readSetupState, updateSetupState } from "../state.ts";
import { convergeMarketplace, marketplaceName } from "../steps/org-folder-marketplace.ts";
import { fakeProbes, gitShowFromFiles, ok, type ExecScript } from "./fakes.ts";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "rt-org-mkt-")); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

const CLAUDE = "/usr/local/bin/claude";
const clone = () => join(home, ".mattstack", "orgs", "acme");
const old = () => join(home, ".mattstack", "teams", "acme");
const generated = () => join(home, ".mattstack", "rt", "marketplaces", "acme");
const generatedFile = () => join(generated(), ".claude-plugin", "marketplace.json");
const defaultCfg = () => join(home, ".claude");
const EMPTY_ORG = '{ "name": "acme", "plugins": [] }';
const ORG_FILE = JSON.stringify({ name: "acme", plugins: ["widgets", "gadgets", "gizmos"].map((name) => ({ name, source: `./mattstack/teams/${name}/plugin` })) });

function ctxFor(p: Probes, logs: string[] = []): ApplyContext {
  return { p, emit: () => {}, log: (_id: string, line: string) => { logs.push(line); }, intent: null, team: { slug: "", name: "", mode: "none" }, snapshot: null, reqs: [], nonInteractive: true, teamOfOne: false, appPath: null, ci: false, secrets: {} as never, teamSecrets: () => ({}) as never, relay: {} as never, secretPresence: { has: async () => null }, redact: () => {}, need: async () => "no-app" } as ApplyContext;
}

/** The org file `git show <ref>:` hands back, or a missing ref when null. */
function gitShow(orgFile: string | null): ExecResult {
  return orgFile === null ? { code: 128, stdout: "", stderr: "fatal: invalid object name 'main'" } : ok(orgFile);
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

/** git answers with the clone's org file as committed (or a missing ref), every other command goes to the claude fake. */
function probes(exec: ExecScript | undefined, files: Record<string, string> = {}, opts: { missingRef?: boolean } = {}) {
  const orgPath = join(clone(), ".claude-plugin", "marketplace.json");
  const committed = files[orgPath] ?? ORG_FILE;
  const p = fakeProbes({
    home,
    env: exec ? { PATH: "/usr/local/bin" } : {},
    files: { ...(exec ? { [CLAUDE]: "bin" } : {}), [orgPath]: ORG_FILE, ...files },
  });
  const served = (argv: string[]) => argv[4]?.endsWith(":.claude-plugin/marketplace.json") ? gitShow(opts.missingRef ? null : committed) : gitShowFromFiles(files, argv) ?? ok("");
  p.exec = (argv, o) => Promise.resolve(argv[0] === "git" ? served(argv) : exec ? exec(argv, o) : ok(""));
  return p;
}

describe("marketplaceName", () => {
  test("reads the clone's marketplace name and returns null without one", () => {
    expect(marketplaceName(probes(undefined), clone())).toBe("acme");
    expect(marketplaceName(fakeProbes({ home }), clone())).toBeNull();
  });
});

describe("convergeMarketplace: the generated folder", () => {
  test("is written before claude is asked anything, with a git-subdir entry per pack on this clone", async () => {
    const orgFile = JSON.stringify({ name: "acme", plugins: [{ name: "widgets", source: "./mattstack/teams/widgets/plugin" }] });
    const claude = claudeFake({ registeredAt: generated(), plugins: [] });
    const p = probes(claude.exec, { [join(clone(), ".claude-plugin", "marketplace.json")]: orgFile });
    const order: string[] = [];
    const exec = p.exec.bind(p);
    p.exec = (argv, o) => { order.push(argv[0] === "git" ? "git" : "claude"); return exec(argv, o); };
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("done");
    expect(order[0]).toBe("git");
    expect(JSON.parse(p.readFile(generatedFile())!).plugins).toEqual([
      { name: "widgets", source: { source: "git-subdir", url: pathToFileURL(clone()).href, path: "mattstack/teams/widgets/plugin", ref: "main" } },
    ]);
  });

  test("a clone with no marketplace on its ref serves no packs: a quiet skip, and claude is never asked", async () => {
    const claude = claudeFake({ registeredAt: clone(), plugins: [] });
    const p = probes(claude.exec, {}, { missingRef: true });
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("skipped");
    expect(out.note).toBeUndefined();
    expect(claude.calls).toEqual([]);
    expect(p.readFile(generatedFile())).toBeNull();
  });

  test("a marketplace file the ref cannot serve is skipped with a note for the row", async () => {
    const claude = claudeFake({ registeredAt: clone(), plugins: [] });
    const p = probes(claude.exec, { [join(clone(), ".claude-plugin", "marketplace.json")]: "{ broken" });
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("skipped");
    expect(out.note).toBe(out.detail);
    expect(out.detail).toContain("rt could not write this Mac's copy of the acme marketplace");
    expect(out.detail).toContain("did not parse");
    expect(claude.calls).toEqual([]);
  });

  test("the gate is the committed file alone: a working tree with no marketplace file still converges", async () => {
    const claude = claudeFake({ registeredAt: clone(), plugins: [] });
    const p = probes(claude.exec);
    p.removeFile(join(clone(), ".claude-plugin", "marketplace.json"));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("done");
    expect(claude.commands()).toEqual(["plugin marketplace list --json", `plugin marketplace add ${generated()}`]);
  });

  test("a clone with nothing committed to generate from is skipped with the note, and claude is never asked", async () => {
    const p = fakeProbes({ home });
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("skipped");
    expect(out.note).toBe(out.detail);
    expect(p.calls.exec.every((argv) => argv[0] === "git")).toBe(true);
  });

  test("an org entry the generated folder leaves out is logged", async () => {
    const orgFile = JSON.stringify({ name: "acme", plugins: [{ name: "remote", source: { source: "github", repo: "x/y" } }] });
    const claude = claudeFake({ registeredAt: generated(), plugins: [] });
    const logs: string[] = [];
    await convergeMarketplace(ctxFor(probes(claude.exec, { [join(clone(), ".claude-plugin", "marketplace.json")]: orgFile }), logs), { dir: clone(), stalePaths: [] });
    expect(logs.some((l) => l.includes("generated marketplace left out remote"))).toBe(true);
  });
});

describe("convergeMarketplace: the registration", () => {
  test("done when the registration already points at the generated folder", async () => {
    const claude = claudeFake({ registeredAt: generated(), plugins: [] });
    const p = probes(claude.exec);
    updateSetupState(p, (s) => ({ ...s, marketplaces: [clone()] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("done");
    expect(out.detail).toBe(`acme already points at ${generated()} in ${defaultCfg()}`);
    expect(claude.commands()).toEqual(["plugin marketplace list --json"]);
    expect(readSetupState(p).marketplaces).toEqual([generated()]);
  });

  /** An org marker at `layout` beside the org store, listed under orgs/ the way orgLayoutState reads it. */
  const atLayout = (layout: number): Record<string, string> => ({
    [join(clone(), ".git", "config")]: "[core]\n",
    [join(clone(), "mattstack", "mattstack.jsonc")]: JSON.stringify({ role: "org", org: "acme", layout }),
    [join(clone(), "mattstack", "org", "settings.org.jsonc")]: "{}",
  });

  for (const layout of [2, 6]) {
    test(`a clone on layout ${layout}, which this rt does not read, leaves the registration and the generated folder as they are`, async () => {
      const claude = claudeFake({ registeredAt: clone(), plugins: [{ id: "widgets@acme", enabled: true }] });
      const p = probes(claude.exec, atLayout(layout));
      p.mkdirp(clone());
      updateSetupState(p, (s) => ({ ...s, marketplaces: [clone()] }));
      const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
      expect(out.state).toBe("skipped");
      expect(out.note).toBeUndefined();
      expect(claude.calls).toEqual([]);
      expect(p.readFile(generatedFile())).toBeNull();
      expect(readSetupState(p).marketplaces).toEqual([clone()]);
    });
  }

  test("a clone on a readable layout is re-pointed as usual", async () => {
    const claude = claudeFake({ registeredAt: clone(), plugins: [] });
    const p = probes(claude.exec, atLayout(5));
    p.mkdirp(clone());
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("done");
    expect(claude.commands()).toEqual(["plugin marketplace list --json", `plugin marketplace add ${generated()}`]);
  });

  test("skipped when the marketplace is not registered and nothing is pending", async () => {
    const claude = claudeFake({ registeredAt: null, plugins: [] });
    const p = probes(claude.exec);
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("skipped");
    expect(claude.commands()).toEqual(["plugin marketplace list --json"]);
    expect(p.readFile(generatedFile())).not.toBeNull();
  });

  test("a registration at the org clone is re-pointed with one bare add of the generated folder: no remove, no reinstall", async () => {
    const claude = claudeFake({ registeredAt: clone(), plugins: [{ id: "widgets@acme", enabled: true }, { id: "gizmos@acme", enabled: false }] });
    const p = probes(claude.exec);
    updateSetupState(p, (s) => ({ ...s, marketplaces: [...s.marketplaces, clone(), "https://github.com/acme/mattstack-marketplace.git"] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("done");
    expect(out.detail).toBe(`acme re-pointed at ${generated()} in ${defaultCfg()}`);
    expect(claude.commands()).toEqual(["plugin marketplace list --json", `plugin marketplace add ${generated()}`]);
    const state = readSetupState(p);
    expect(state.marketplaces).toEqual([generated(), "https://github.com/acme/mattstack-marketplace.git"]);
    expect(state.orgMarketplaceMoves ?? []).toEqual([]);
  });

  test("a registration at a moved clone's old folder is re-pointed the same way, and both old spellings follow it in setup-state", async () => {
    const claude = claudeFake({ registeredAt: old(), plugins: [{ id: "widgets@acme", enabled: true }] });
    const p = probes(claude.exec);
    updateSetupState(p, (s) => ({ ...s, marketplaces: [old(), clone()] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [old()] });
    expect(out.state).toBe("done");
    expect(claude.commands()).toEqual(["plugin marketplace list --json", `plugin marketplace add ${generated()}`]);
    expect(readSetupState(p).marketplaces).toEqual([generated()]);
  });

  test("a failed add ends partial with the add to run by hand, and setup-state keeps the source still registered", async () => {
    const claude = claudeFake({ registeredAt: clone(), plugins: [], fail: "plugin marketplace add" });
    const p = probes(claude.exec);
    updateSetupState(p, (s) => ({ ...s, marketplaces: [clone()] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("partial");
    expect(out.detail).toContain(`stopped at claude plugin marketplace add ${generated()}: boom`);
    expect(out.commands).toEqual([`claude plugin marketplace add ${generated()}`]);
    expect(readSetupState(p).marketplaces).toEqual([clone()]);
    expect(readSetupState(p).orgMarketplaceMoves ?? []).toEqual([]);
  });

  test("a second config dir is driven with CLAUDE_CONFIG_DIR and named in its commands", async () => {
    const claude = claudeFake({ registeredAt: old(), plugins: [], fail: "plugin marketplace add" });
    const p = probes(claude.exec);
    const envs: (string | undefined)[] = [];
    const exec = p.exec.bind(p);
    p.exec = (argv, o) => { if (argv[0] !== "git") envs.push(o?.env?.CLAUDE_CONFIG_DIR); return exec(argv, o); };
    p.env.CLAUDE_CONFIG_DIR = join(home, "cfg2");
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("partial");
    expect(new Set(envs)).toEqual(new Set([join(home, "cfg2")]));
    expect(out.commands).toEqual([`CLAUDE_CONFIG_DIR=${join(home, "cfg2")} claude plugin marketplace add ${generated()}`]);
  });

  test("claude missing after a move ends partial with no commands and touches no record", async () => {
    const p = probes(undefined);
    updateSetupState(p, (s) => ({ ...s, marketplaces: [old()] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [old()] });
    expect(out.state).toBe("partial");
    expect(out.commands).toBeUndefined();
    expect(out.detail).toContain("Install Claude Code and run the update again");
    expect(readSetupState(p).marketplaces).toEqual([old()]);
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

  test("an org's generated folder from before a rename is deleted once the registration points away from it", async () => {
    const before = join(home, ".mattstack", "rt", "marketplaces", "acme-old");
    const claude = claudeFake({ registeredAt: before, plugins: [] });
    const p = probes(claude.exec, { [join(before, ".claude-plugin", "marketplace.json")]: EMPTY_ORG });
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("done");
    expect(claude.commands()).toEqual(["plugin marketplace list --json", `plugin marketplace add ${generated()}`]);
    expect(p.calls.removed).toContain(before);
    expect(p.readFile(join(before, ".claude-plugin", "marketplace.json"))).toBeNull();
  });

  test("another clone's generated folder is never deleted, and a failed re-point deletes nothing", async () => {
    const other = join(home, ".mattstack", "rt", "marketplaces", "beta");
    const claude = claudeFake({ registeredAt: other, plugins: [] });
    const p = probes(claude.exec);
    p.mkdirp(join(home, ".mattstack", "orgs", "beta"));
    p.mkdirp(join(home, ".mattstack", "orgs", "beta", ".git"));
    p.writeFile(join(home, ".mattstack", "orgs", "beta", ".git", "config"), "[core]\n");
    await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(p.calls.removed).not.toContain(other);

    const old = join(home, ".mattstack", "rt", "marketplaces", "acme-old");
    const failing = claudeFake({ registeredAt: old, plugins: [], fail: "plugin marketplace add" });
    const q = probes(failing.exec);
    expect((await convergeMarketplace(ctxFor(q), { dir: clone(), stalePaths: [] })).state).toBe("partial");
    expect(q.calls.removed).not.toContain(old);
  });

  test("a held pack takes the same bare add as any other and is not reported as waiting", async () => {
    const files = {
      [join(clone(), ".claude-plugin", "marketplace.json")]: '{ "name": "acme", "plugins": [{ "name": "widgets", "source": "./widgets" }] }',
      [join(clone(), "widgets", "pack", "requires.json")]: '{ "minEngine": "0.31.0" }',
      [join(clone(), "widgets", ".claude-plugin", "plugin.json")]: '{ "name": "widgets", "version": "2.0.0" }',
    };
    const claude = claudeFake({ registeredAt: clone(), plugins: [{ id: "widgets@acme", enabled: true }] });
    const out = await convergeMarketplace({ ...ctxFor(probes(claude.exec, files)), engine: () => "0.30.28" } as ApplyContext, { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("done");
    expect(claude.commands()).toEqual(["plugin marketplace list --json", `plugin marketplace add ${generated()}`]);
  });
});

describe("convergeMarketplace: a pending record an older rt left", () => {
  test("a run that stopped between remove and add is finished: add the generated folder, reinstall, disable what was off", async () => {
    const claude = claudeFake({ registeredAt: null, plugins: [] });
    const p = probes(claude.exec);
    updateSetupState(p, (s) => ({ ...s, orgMarketplaceMoves: [{ marketplace: "acme", dir: clone(), configDir: defaultCfg(), plugins: [{ id: "widgets@acme", scope: "user", enabled: true }, { id: "gadgets@acme", scope: "user", enabled: false }] }] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("done");
    expect(out.detail).toContain("2 plugins reinstalled");
    expect(claude.commands()).toEqual([
      "plugin marketplace list --json",
      `plugin marketplace add ${generated()}`,
      "plugin install widgets@acme --scope user",
      "plugin install gadgets@acme --scope user",
      "plugin disable gadgets@acme",
    ]);
    expect(readSetupState(p).orgMarketplaceMoves ?? []).toEqual([]);
  });

  test("a run that stopped after its add reinstalls only what the record names and is missing", async () => {
    const claude = claudeFake({ registeredAt: generated(), plugins: [{ id: "widgets@acme", enabled: true }] });
    const p = probes(claude.exec);
    updateSetupState(p, (s) => ({ ...s, orgMarketplaceMoves: [{ marketplace: "acme", dir: clone(), configDir: defaultCfg(), plugins: [{ id: "widgets@acme", scope: "user", enabled: true }, { id: "gadgets@acme", scope: "user", enabled: false }] }] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("done");
    expect(out.detail).toContain("finished reinstalling 1 plugin from acme");
    expect(claude.commands()).toEqual(["plugin marketplace list --json", "plugin list --json", "plugin install gadgets@acme --scope user", "plugin disable gadgets@acme"]);
    expect(readSetupState(p).orgMarketplaceMoves ?? []).toEqual([]);
  });

  test("a run whose remove failed part way is re-pointed with a bare add and the uninstalled plugins come back, never another remove", async () => {
    const claude = claudeFake({ registeredAt: clone(), plugins: [{ id: "widgets@acme", enabled: true }] });
    const p = probes(claude.exec);
    updateSetupState(p, (s) => ({ ...s, marketplaces: [clone()], orgMarketplaceMoves: [{ marketplace: "acme", dir: clone(), configDir: defaultCfg(), plugins: [{ id: "widgets@acme", scope: "user", enabled: true }, { id: "gadgets@acme", scope: "user", enabled: false }] }] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("done");
    expect(claude.commands()).toEqual([
      "plugin marketplace list --json",
      "plugin list --json",
      `plugin marketplace add ${generated()}`,
      "plugin install gadgets@acme --scope user",
      "plugin disable gadgets@acme",
    ]);
    expect(readSetupState(p).marketplaces).toEqual([generated()]);
    expect(readSetupState(p).orgMarketplaceMoves ?? []).toEqual([]);
  });

  test("the record is kept when the reinstall from it fails, and the rest is handed back", async () => {
    const claude = claudeFake({ registeredAt: generated(), plugins: [], fail: "plugin install gadgets@acme" });
    const p = probes(claude.exec);
    const record = { marketplace: "acme", dir: clone(), configDir: defaultCfg(), plugins: [{ id: "gadgets@acme", scope: "user", enabled: false }] };
    updateSetupState(p, (s) => ({ ...s, orgMarketplaceMoves: [record] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("partial");
    expect(out.commands).toEqual(["claude plugin install gadgets@acme --scope user", "claude plugin disable gadgets@acme"]);
    expect(readSetupState(p).orgMarketplaceMoves).toEqual([record]);
  });

  test("an unreadable plugin list ends partial with the commands left and keeps the record", async () => {
    const claude = claudeFake({ registeredAt: old(), plugins: [], fail: "plugin list" });
    const p = probes(claude.exec);
    const record = { marketplace: "acme", dir: clone(), configDir: defaultCfg(), plugins: [{ id: "widgets@acme", scope: "user", enabled: true }] };
    updateSetupState(p, (s) => ({ ...s, orgMarketplaceMoves: [record] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [old()] });
    expect(out.state).toBe("partial");
    expect(out.detail).toContain("plugin list could not be read");
    expect(out.commands).toEqual([`claude plugin marketplace add ${generated()}`, "claude plugin install widgets@acme --scope user"]);
    expect(claude.commands()).toEqual(["plugin marketplace list --json", "plugin list --json"]);
    expect(readSetupState(p).orgMarketplaceMoves).toEqual([record]);
  });

  test("a recorded project plugin is handed back as an install run in its project, never installed or disabled by rt", async () => {
    const project = join(home, "src", "widgets-app");
    const claude = claudeFake({ registeredAt: null, plugins: [] });
    const p = probes(claude.exec);
    updateSetupState(p, (s) => ({ ...s, orgMarketplaceMoves: [{ marketplace: "acme", dir: clone(), configDir: defaultCfg(), plugins: [{ id: "widgets@acme", scope: "user", enabled: true }, { id: "gadgets@acme", scope: "project", enabled: false, projectPath: project }] }] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("partial");
    expect(out.detail).toContain("gadgets@acme must be reinstalled from the project that used it");
    expect(out.commands).toEqual([`cd ${project} && claude plugin install gadgets@acme --scope project`]);
    expect(claude.commands()).toEqual(["plugin marketplace list --json", `plugin marketplace add ${generated()}`, "plugin install widgets@acme --scope user"]);
    expect(readSetupState(p).orgMarketplaceMoves ?? []).toEqual([]);
  });

  test("a recorded plugin the catalog no longer lists is dropped from the record and named once, never installed", async () => {
    const claude = claudeFake({ registeredAt: generated(), plugins: [] });
    const p = probes(claude.exec);
    updateSetupState(p, (s) => ({ ...s, orgMarketplaceMoves: [{ marketplace: "acme", dir: clone(), configDir: defaultCfg(), plugins: [{ id: "retired@acme", scope: "user", enabled: true }, { id: "gadgets@acme", scope: "user", enabled: true }] }] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("done");
    expect(out.detail).toContain("retired@acme is not in the acme marketplace any more, so rt cannot reinstall it");
    expect(claude.commands()).toEqual(["plugin marketplace list --json", "plugin list --json", "plugin install gadgets@acme --scope user"]);
    expect(readSetupState(p).orgMarketplaceMoves ?? []).toEqual([]);
  });

  test("a record that names only retired plugins is cleared without a plugin call", async () => {
    const claude = claudeFake({ registeredAt: generated(), plugins: [] });
    const p = probes(claude.exec);
    updateSetupState(p, (s) => ({ ...s, orgMarketplaceMoves: [{ marketplace: "acme", dir: clone(), configDir: defaultCfg(), plugins: [{ id: "retired@acme", scope: "user", enabled: true }] }] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("done");
    expect(out.detail).toContain("retired@acme is not in the acme marketplace any more");
    expect(claude.commands()).toEqual(["plugin marketplace list --json"]);
    expect(readSetupState(p).orgMarketplaceMoves ?? []).toEqual([]);
  });

  describe("with a pack held by its engine floor", () => {
    const heldFiles = () => ({
      [join(clone(), ".claude-plugin", "marketplace.json")]: '{ "name": "acme", "plugins": [{ "name": "widgets", "source": "./widgets" }, { "name": "gadgets", "source": "./gadgets" }, { "name": "gizmos", "source": "./gizmos" }] }',
      [join(clone(), "widgets", "pack", "requires.json")]: '{ "minEngine": "0.31.0" }',
      [join(clone(), "widgets", ".claude-plugin", "plugin.json")]: '{ "name": "widgets", "version": "2.0.0" }',
    });
    const recordOf = (dir: string, plugins: { id: string; scope: string; enabled: boolean }[]) => ({ marketplace: "acme", dir, configDir: defaultCfg(), plugins });
    const widgets = { id: "widgets@acme", scope: "user", enabled: true };
    const gadgets = { id: "gadgets@acme", scope: "user", enabled: false };

    test("reinstalls what fits, keeps only the held plugin pending, and finishes it once the engine meets the floor", async () => {
      const claude = claudeFake({ registeredAt: null, plugins: [] });
      const p = probes(claude.exec, heldFiles());
      updateSetupState(p, (s) => ({ ...s, orgMarketplaceMoves: [recordOf(clone(), [widgets, gadgets])] }));
      const out = await convergeMarketplace({ ...ctxFor(p), engine: () => "0.30.28" } as ApplyContext, { dir: clone(), stalePaths: [] });
      expect(claude.commands()).toEqual(["plugin marketplace list --json", `plugin marketplace add ${generated()}`, "plugin install gadgets@acme --scope user", "plugin disable gadgets@acme"]);
      expect(out.state).toBe("partial");
      expect(out.detail).toBe(
        `widgets 2.0.0 needs a newer mattstack app (engine 0.31.0 or later). Update the app when it's offered. acme re-pointed at ${generated()} in ${defaultCfg()}, 1 plugin reinstalled. The held plugins wait for the app to update.`,
      );
      expect(readSetupState(p).orgMarketplaceMoves).toEqual([recordOf(generated(), [widgets])]);

      const next = claudeFake({ registeredAt: generated(), plugins: [{ id: "gadgets@acme", enabled: false }] });
      p.exec = (argv, o) => Promise.resolve(argv[0] === "git" ? gitShow(heldFiles()[join(clone(), ".claude-plugin", "marketplace.json")]!) : next.exec(argv, o));
      const after = await convergeMarketplace({ ...ctxFor(p), engine: () => "0.31.0" } as ApplyContext, { dir: clone(), stalePaths: [] });
      expect(after.state).toBe("done");
      expect(next.commands()).toEqual(["plugin marketplace list --json", "plugin list --json", "plugin install widgets@acme --scope user"]);
      expect(readSetupState(p).orgMarketplaceMoves ?? []).toEqual([]);
    });
  });
});

describe("convergeMarketplace: cswap accounts", () => {
  const sessions = () => join(home, ".claude-swap-backup", "sessions");
  const dev1 = () => join(sessions(), "1-dev1_acme.test");
  const dev2 = () => join(sessions(), "2-dev2_acme.test");

  /** One claude per config dir: each keeps its own registration, so a re-point in one leaves the others as they were. */
  function perDir(registered: Record<string, string | null>, opts: { failIn?: string; fail?: string } = {}) {
    const seen: string[] = [];
    const exec: ExecScript = (argv, o) => {
      if (argv[0] === "git") return gitShow(EMPTY_ORG);
      const cfg = o?.env?.CLAUDE_CONFIG_DIR ?? "";
      const sliced = argv.slice(1).join(" ");
      seen.push(`${cfg}: ${sliced}`);
      if (cfg === opts.failIn && opts.fail && sliced.startsWith(opts.fail)) return { code: 1, stdout: "", stderr: `boom: ${sliced}` };
      const [, , verb, sub] = argv;
      if (verb === "marketplace" && sub === "list") {
        const at = registered[cfg] ?? null;
        return ok(JSON.stringify(at === null ? [] : [{ name: "acme", source: "directory", path: at, installLocation: at }]));
      }
      if (verb === "marketplace" && sub === "add") registered[cfg] = argv.at(-1)!;
      return ok("");
    };
    const p = fakeProbes({
      home,
      env: { PATH: "/usr/local/bin" },
      files: { [CLAUDE]: "bin", [join(clone(), ".claude-plugin", "marketplace.json")]: EMPTY_ORG, [join(sessions(), "notes.txt")]: "x" },
      dirs: { [sessions()]: ["2-dev2_acme.test", "1-dev1_acme.test", "notes.txt"], [dev1()]: [], [dev2()]: [] },
    });
    p.exec = (argv, o) => Promise.resolve(exec(argv, o));
    return { p, seen };
  }

  test("every account's config dir is re-pointed, each driven with its own CLAUDE_CONFIG_DIR", async () => {
    const { p, seen } = perDir({ [defaultCfg()]: clone(), [dev1()]: old(), [dev2()]: null });
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("done");
    expect(out.detail).toBe(`acme re-pointed at ${generated()} in ${defaultCfg()}; acme re-pointed at ${generated()} in ${dev1()}; acme is not registered in ${dev2()}`);
    expect(seen.filter((line) => line.startsWith(`${dev1()}: `))).toEqual([`${dev1()}: plugin marketplace list --json`, `${dev1()}: plugin marketplace add ${generated()}`]);
    expect(seen.some((line) => line.startsWith(join(sessions(), "notes.txt")))).toBe(false);
  });

  test("an account whose plugins folder is the default one's, through a symlink, is driven once", async () => {
    mkdirSync(join(defaultCfg(), "plugins"), { recursive: true });
    mkdirSync(dev1(), { recursive: true });
    symlinkSync(join(defaultCfg(), "plugins"), join(dev1(), "plugins"));
    const { p, seen } = perDir({ [defaultCfg()]: clone(), [dev1()]: clone(), [dev2()]: clone() });
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("done");
    expect(seen.some((line) => line.startsWith(`${dev1()}: `))).toBe(false);
    expect(seen.filter((line) => line.endsWith(`add ${generated()}`))).toEqual([`${defaultCfg()}: plugin marketplace add ${generated()}`, `${dev2()}: plugin marketplace add ${generated()}`]);
  });

  test("a re-point that stops in one account hands back that account's own command", async () => {
    const { p } = perDir({ [defaultCfg()]: clone(), [dev1()]: clone() }, { failIn: dev1(), fail: "plugin marketplace add" });
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("partial");
    expect(out.commands).toEqual([`CLAUDE_CONFIG_DIR=${dev1()} claude plugin marketplace add ${generated()}`]);
  });
});
