import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { PERSONAL_MARK } from "../../skills/disable-model-invocation-line.ts";
import { setSetting, setSettingsNoticeSink } from "../../settings/write.ts";
import type { ApplyContext } from "../apply.ts";
import { MIGRATIONS } from "../migrations/index.ts";
import { teamPacksFromGitMigration } from "../migrations/team-packs-from-git.ts";
import { readSetupState, updateSetupState, type PendingMarketplaceMove } from "../state.ts";
import type { ExecResult } from "../probes.ts";
import { fakeProbes, gitShowFromFiles, ok } from "./fakes.ts";

type Listed = { id: string; scope?: string; enabled: boolean; projectPath?: string };
type Call = { argv: string[]; dir?: string };

const MARKET = "acme-market";
const ORG_FILE = JSON.stringify({ name: MARKET, plugins: [{ name: "widgets", source: "./mattstack/teams/widgets/plugin" }, { name: "gadgets", source: "./mattstack/teams/gadgets/plugin" }] });

describe("2026-11-02-team-packs-from-git", () => {
  const origHome = process.env.HOME;
  let home: string;
  let previousSink: ReturnType<typeof setSettingsNoticeSink>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-mig-packs-git-")));
    process.env.HOME = home;
    previousSink = setSettingsNoticeSink(() => {});
  });

  afterEach(() => {
    setSettingsNoticeSink(previousSink);
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  const clone = () => join(home, ".mattstack", "orgs", "acme");
  const generated = () => join(home, ".mattstack", "rt", "marketplaces", "acme");
  const defaultDir = () => join(home, ".claude");

  /** An org clone `acme` whose claude lists `installed` per config dir and records every argv; `fail` answers a call instead of ok. */
  function harness(opts: {
    installed?: Record<string, Listed[]>;
    clone?: boolean;
    floors?: Record<string, string>;
    sessions?: string[];
    fail?: (argv: string[], dir: string | undefined) => ExecResult | null;
    onExec?: (argv: string[], dir: string | undefined) => void;
  } = {}) {
    const calls: Call[] = [];
    const files: Record<string, string> = { "/usr/local/bin/claude": "bin" };
    const dirs: Record<string, string[]> = {};
    const statPaths: Record<string, { isDirectory: boolean; writable: boolean }> = {};
    if (opts.clone !== false) {
      files[join(clone(), ".git", "config")] = "[core]\n";
      files[join(clone(), ".claude-plugin", "marketplace.json")] = ORG_FILE;
      dirs[join(home, ".mattstack", "orgs")] = ["acme"];
    }
    for (const [team, floor] of Object.entries(opts.floors ?? {})) {
      files[join(clone(), "mattstack", "teams", team, "plugin", "pack", "requires.json")] = JSON.stringify({ minEngine: floor });
    }
    const sessionsRoot = join(home, ".claude-swap-backup", "sessions");
    if (opts.sessions) {
      dirs[sessionsRoot] = opts.sessions;
      for (const s of opts.sessions) statPaths[join(sessionsRoot, s)] = { isDirectory: true, writable: true };
    }
    const p = fakeProbes({
      home,
      env: { PATH: "/usr/local/bin" },
      files,
      dirs,
      statPaths,
      exec: async (argv, execOpts) => {
        const dir = execOpts?.env?.CLAUDE_CONFIG_DIR;
        if (argv[0] === "git") return argv[4]?.endsWith(":.claude-plugin/marketplace.json") ? ok(ORG_FILE) : gitShowFromFiles(files, argv) ?? ok("");
        calls.push({ argv: argv.slice(1), dir });
        opts.onExec?.(argv.slice(1), dir);
        const failed = opts.fail?.(argv.slice(1), dir);
        if (failed) return failed;
        if (argv[2] === "list") return ok(JSON.stringify((opts.installed?.[dir ?? ""] ?? []).map((e) => ({ scope: "user", version: "1.0.0", ...e }))));
        return ok("");
      },
    });
    const ctx = { p, log: () => {}, engine: () => "2.0.0" } as Partial<ApplyContext> as ApplyContext;
    return { ctx, p, calls };
  }

  const changes = (calls: Call[]) => calls.filter((c) => c.argv[1] !== "list" && !(c.argv[1] === "marketplace" && c.argv[2] === "list"));

  test("is registered last with its dated id", () => {
    expect(MIGRATIONS.at(-1)).toBe(teamPacksFromGitMigration);
    expect(teamPacksFromGitMigration.id).toBe("2026-11-02-team-packs-from-git");
  });

  test("a Mac with no org clone is skipped", async () => {
    const { ctx, calls } = harness({ clone: false });
    expect(await teamPacksFromGitMigration.run(ctx)).toEqual({ state: "skipped", detail: "This Mac has no org clone" });
    expect(calls).toEqual([]);
  });

  test("a Mac with no team pack installed is skipped and registers nothing", async () => {
    const { ctx, calls, p } = harness({ installed: { [defaultDir()]: [{ id: "other@elsewhere", enabled: true }] } });
    expect(await teamPacksFromGitMigration.run(ctx)).toEqual({ state: "skipped", detail: "No team plugins are installed on this Mac" });
    expect(changes(calls)).toEqual([]);
    expect(p.readFile(join(generated(), ".claude-plugin", "marketplace.json"))).toContain('"git-subdir"');
  });

  test("re-points the marketplace, then uninstalls and reinstalls each pack keeping scope and enabled state", async () => {
    const { ctx, calls, p } = harness({
      installed: { [defaultDir()]: [{ id: `widgets@${MARKET}`, enabled: true }, { id: `gadgets@${MARKET}`, enabled: false }] },
    });

    const outcome = await teamPacksFromGitMigration.run(ctx);

    expect(outcome).toEqual({ state: "done", detail: `Reinstalled widgets@${MARKET}, gadgets@${MARKET} from the org repo.` });
    expect(changes(calls).map((c) => c.argv)).toEqual([
      ["plugin", "marketplace", "add", generated()],
      ["plugin", "uninstall", `widgets@${MARKET}`, "--scope", "user", "--keep-data"],
      ["plugin", "install", `widgets@${MARKET}`, "--scope", "user"],
      ["plugin", "uninstall", `gadgets@${MARKET}`, "--scope", "user", "--keep-data"],
      ["plugin", "install", `gadgets@${MARKET}`, "--scope", "user"],
      ["plugin", "disable", `gadgets@${MARKET}`],
    ]);
    expect(changes(calls).every((c) => c.dir === defaultDir())).toBe(true);
    expect(calls.some((c) => c.argv.includes("remove"))).toBe(false);
    expect(readSetupState(p).orgMarketplaceMoves).toBeUndefined();
  });

  test("the pending record is written before the first uninstall", async () => {
    let atUninstall: PendingMarketplaceMove[] | undefined;
    const { ctx, p } = harness({
      installed: { [defaultDir()]: [{ id: `widgets@${MARKET}`, enabled: false }] },
      onExec: (argv) => {
        if (argv[1] === "uninstall" && atUninstall === undefined) atUninstall = readSetupState(p).orgMarketplaceMoves;
      },
    });

    await teamPacksFromGitMigration.run(ctx);

    expect(atUninstall).toEqual([{ marketplace: MARKET, dir: generated(), configDir: defaultDir(), plugins: [{ id: `widgets@${MARKET}`, scope: "user", enabled: false }] }]);
  });

  test("a pack an earlier run uninstalled is reinstalled from the record, with no uninstall", async () => {
    const { ctx, calls, p } = harness({ installed: { [defaultDir()]: [] } });
    updateSetupState(p, (s) => ({
      ...s,
      orgMarketplaceMoves: [{ marketplace: MARKET, dir: generated(), configDir: defaultDir(), plugins: [{ id: `gadgets@${MARKET}`, scope: "user", enabled: false }] }],
    }));

    expect((await teamPacksFromGitMigration.run(ctx)).state).toBe("done");
    expect(changes(calls).map((c) => c.argv)).toEqual([
      ["plugin", "marketplace", "add", generated()],
      ["plugin", "install", `gadgets@${MARKET}`, "--scope", "user"],
      ["plugin", "disable", `gadgets@${MARKET}`],
    ]);
    expect(readSetupState(p).orgMarketplaceMoves).toBeUndefined();
  });

  test("a failed reinstall is reported, keeps its record and does not stop the next pack", async () => {
    const { ctx, calls, p } = harness({
      installed: { [defaultDir()]: [{ id: `widgets@${MARKET}`, enabled: true }, { id: `gadgets@${MARKET}`, enabled: true }] },
      fail: (argv) => (argv[1] === "install" && argv[2] === `widgets@${MARKET}` ? { code: 1, stdout: "", stderr: "clone failed" } : null),
    });

    const outcome = await teamPacksFromGitMigration.run(ctx);

    expect(outcome.state).toBe("done");
    expect(outcome.detail).toContain(`Reinstalled gadgets@${MARKET} from the org repo.`);
    expect(outcome.detail).toContain(`widgets@${MARKET} in ${defaultDir()} could not be reinstalled: clone failed`);
    expect(calls.some((c) => c.argv[1] === "install" && c.argv[2] === `gadgets@${MARKET}`)).toBe(true);
    expect(readSetupState(p).orgMarketplaceMoves).toEqual([{ marketplace: MARKET, dir: generated(), configDir: defaultDir(), plugins: [{ id: `widgets@${MARKET}`, scope: "user", enabled: true }] }]);
  });

  test("a pack whose uninstall fails keeps its copy and is not installed over", async () => {
    const { ctx, calls, p } = harness({
      installed: { [defaultDir()]: [{ id: `widgets@${MARKET}`, enabled: true }] },
      fail: (argv) => (argv[1] === "uninstall" ? { code: 1, stdout: "", stderr: "settings.json is not writable" } : null),
    });

    const outcome = await teamPacksFromGitMigration.run(ctx);

    expect(outcome.detail).toContain(`widgets@${MARKET} in ${defaultDir()} kept its old copy: settings.json is not writable`);
    expect(calls.some((c) => c.argv[1] === "install")).toBe(false);
    expect(readSetupState(p).orgMarketplaceMoves).toBeUndefined();
  });

  test("a pack held by its engine floor is only re-pointed, with the held note", async () => {
    const { ctx, calls } = harness({
      installed: { [defaultDir()]: [{ id: `widgets@${MARKET}`, enabled: true }, { id: `gadgets@${MARKET}`, enabled: true }] },
      floors: { widgets: "9.0.0" },
    });

    const outcome = await teamPacksFromGitMigration.run(ctx);

    expect(changes(calls).some((c) => c.argv.includes(`widgets@${MARKET}`))).toBe(false);
    expect(changes(calls).some((c) => c.argv[1] === "install" && c.argv[2] === `gadgets@${MARKET}`)).toBe(true);
    expect(outcome.detail).toContain("widgets needs a newer mattstack app (engine 9.0.0 or later).");
  });

  test("a project install is left on its copy and named", async () => {
    const { ctx, calls } = harness({
      installed: { [defaultDir()]: [{ id: `widgets@${MARKET}`, scope: "project", enabled: true, projectPath: "/work/app" }] },
    });

    const outcome = await teamPacksFromGitMigration.run(ctx);

    expect(changes(calls).map((c) => c.argv)).toEqual([["plugin", "marketplace", "add", generated()]]);
    expect(outcome).toEqual({ state: "done", detail: `widgets@${MARKET} is installed for a project, so it keeps its copy until the next version.` });
  });

  test("a cswap session sharing the default plugins folder is reinstalled once", async () => {
    mkdirSync(join(defaultDir(), "plugins"), { recursive: true });
    const shared = join(home, ".claude-swap-backup", "sessions", "shared");
    const own = join(home, ".claude-swap-backup", "sessions", "own");
    mkdirSync(shared, { recursive: true });
    symlinkSync(join(defaultDir(), "plugins"), join(shared, "plugins"));
    mkdirSync(join(own, "plugins"), { recursive: true });
    const pack = [{ id: `widgets@${MARKET}`, enabled: true }];
    const { ctx, calls } = harness({ sessions: ["own", "shared"], installed: { [defaultDir()]: pack, [own]: pack, [shared]: pack } });

    await teamPacksFromGitMigration.run(ctx);

    expect(calls.filter((c) => c.argv[1] === "install").map((c) => c.dir)).toEqual([defaultDir(), own]);
  });

  test("the member's disabled skills land on the reinstalled copy", async () => {
    setSetting("rt.skills.disableModelInvocation", { [`widgets@${MARKET}`]: ["alpha"] }, "user");
    const skill = join(defaultDir(), "plugins", "cache", MARKET, "widgets", "1.0.0", "skills", "alpha", "SKILL.md");
    const { ctx } = harness({
      installed: { [defaultDir()]: [{ id: `widgets@${MARKET}`, enabled: true }] },
      onExec: (argv) => {
        if (argv[1] !== "install") return;
        mkdirSync(dirname(skill), { recursive: true });
        writeFileSync(skill, "---\nname: alpha\ndescription: d\n---\nbody\n");
      },
    });

    expect((await teamPacksFromGitMigration.run(ctx)).state).toBe("done");
    expect(readFileSync(skill, "utf8")).toContain(PERSONAL_MARK);
  });
});
