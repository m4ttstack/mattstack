/**
 * An existing member's Mac, set up the way an older rt left it (the org clone
 * registered as a directory marketplace, its team packs installed from it),
 * taken through the real update pieces in the order `rt setup update` runs
 * them, against the real claude binary: org.folder's marketplace converge,
 * the team-packs-from-git migration, then plugins.install. Opt-in for the
 * same reason as claude-plugin-contract.test.ts: RT_CLAUDE_PLUGIN_E2E=1.
 *
 * The baseline marketplaces and plugins are recorded in setup-state as rt's
 * and then absent, which an update reads as "the member removed them": that
 * keeps plugins.install off the network while it still runs every team-pack
 * branch a real update takes.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, realpathSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { createTestHome } from "../harness.ts";
import { childEnv } from "../../lib/subprocess.ts";
import { createRealProbes, type ExecOpts, type Probes } from "../../lib/setup/probes.ts";
import { runUpdateWith, type ApplyContext, type StepDef, type UpdateRunResult } from "../../lib/setup/apply.ts";
import { convergeMarketplace } from "../../lib/setup/steps/org-folder-marketplace.ts";
import { pluginsInstallStep, mattstackMarketplaceSource, OFFICIAL_MARKETPLACE_SOURCE } from "../../lib/setup/steps/plugins.ts";
import { teamPacksFromGitMigration } from "../../lib/setup/migrations/team-packs-from-git.ts";
import { BASE_PLUGINS } from "../../lib/setup/base-plugins.ts";
import { convergePackCache } from "../../lib/setup/pack-cache.ts";
import { readSetupState, updateSetupState } from "../../lib/setup/state.ts";
import { setSetting, setSettingsNoticeSink } from "../../lib/settings/write.ts";
import { PERSONAL_MARK } from "../../lib/skills/disable-model-invocation-line.ts";

const enabled = process.env.RT_CLAUDE_PLUGIN_E2E === "1" && Bun.which("claude") !== null;

// describe.skipIf prints no reason, so a placeholder carries it.
if (!enabled) {
  test.skip("team pack upgrade: needs RT_CLAUDE_PLUGIN_E2E=1 and claude on PATH", () => {});
}

const ORG = "acme";
const DATA_BRANCH = "mattstack";
const WIDGETS = `widgets@${ORG}`;
const GADGETS = `gadgets@${ORG}`;
const MIGRATION_ID = teamPacksFromGitMigration.id;

describe.skipIf(!enabled)("team pack upgrade: directory-source member to the generated git marketplace", () => {
  let home: string;
  let config: string;
  let clone: string;
  let generated: string;
  let cleanup: () => void;
  const saved: { HOME?: string; CLAUDE_CONFIG_DIR?: string } = {};
  let previousSink: ReturnType<typeof setSettingsNoticeSink> | undefined;

  function claude(args: string[]): { code: number; stdout: string; output: string } {
    const env = { ...childEnv(), HOME: home, CLAUDE_CONFIG_DIR: config } as NodeJS.ProcessEnv;
    try {
      const stdout = execFileSync("claude", args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
      return { code: 0, stdout, output: stdout };
    } catch (err) {
      const e = err as { status: number; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, stdout: e.stdout ?? "", output: `${e.stdout ?? ""}\n${e.stderr ?? ""}` };
    }
  }

  function git(args: string[]): string {
    const env = { ...childEnv(), HOME: home, GIT_CONFIG_GLOBAL: "/dev/null" } as NodeJS.ProcessEnv;
    return execFileSync("git", ["-C", clone, "-c", "user.name=probe", "-c", "user.email=probe@example.test", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  }

  function writeJson(path: string, value: unknown): void {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  function writePack(team: string, version: string, skill: string, description: string): void {
    const dir = join(clone, "mattstack/teams", team, "plugin");
    writeJson(join(dir, ".claude-plugin/plugin.json"), { name: team, version });
    mkdirSync(join(dir, "skills", skill), { recursive: true });
    writeFileSync(join(dir, "skills", skill, "SKILL.md"), `---\nname: ${skill}\ndescription: ${description}\n---\n${skill} body\n`);
  }

  /** Real probes on the test's HOME; every child gets this HOME and config dir unless the caller names its own, and no app bundle's helpers are visible. */
  function probes(): Probes {
    const real = createRealProbes();
    const pinned = <T extends ExecOpts>(opts: T | undefined): T => ({ ...opts, env: { HOME: home, CLAUDE_CONFIG_DIR: config, ...opts?.env } }) as T;
    return {
      ...real,
      home,
      env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: config },
      exists: (path) => !path.startsWith("/Applications/") && real.exists(path),
      exec: (argv, opts) => real.exec(argv, pinned(opts)),
      execStreaming: (argv, opts) => real.execStreaming(argv, pinned(opts)),
    };
  }

  function context(logs: string[]): ApplyContext {
    return {
      p: probes(),
      emit: () => {},
      log: (id: string, line: string) => logs.push(`${id}: ${line}`),
      engine: () => null,
      activeTeam: () => "widgets",
      team: { slug: ORG, name: ORG, mode: "join" },
      update: true,
      nonInteractive: true,
    } as Partial<ApplyContext> as ApplyContext;
  }

  /** org.folder's marketplace piece standing in for the whole org.folder step: the folder itself is already where it belongs. */
  const orgFolderMarketplace: StepDef = {
    id: "org.folder",
    title: "Org folder",
    kind: "rt",
    updateSafe: true,
    applies: () => true,
    run: (ctx) => convergeMarketplace(ctx, { dir: clone, stalePaths: [] }),
  };

  /** One `rt setup update`'s worth of the pieces under test, in its order: org.folder, pending migrations, plugins.install. */
  async function update(): Promise<{ result: UpdateRunResult; logs: string[] }> {
    const logs: string[] = [];
    const result = await runUpdateWith([orgFolderMarketplace, pluginsInstallStep], [teamPacksFromGitMigration], context(logs));
    return { result, logs };
  }

  function outcome(result: UpdateRunResult, id: string): { state: string; detail?: string } | undefined {
    return result.outcomes.find((o) => o.id === id);
  }

  function marketplaces(): { name: string; source?: string; path?: string }[] {
    const res = claude(["plugin", "marketplace", "list", "--json"]);
    expect(res.code).toBe(0);
    return JSON.parse(res.stdout);
  }

  function acmeSource(): string | undefined {
    const m = marketplaces().find((x) => x.name === ORG);
    return m?.path;
  }

  function registry(): Record<string, { scope: string; installPath: string; version: string }[]> {
    const file = join(config, "plugins/installed_plugins.json");
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).plugins : {};
  }

  function enabledPlugins(): Record<string, boolean> {
    return JSON.parse(readFileSync(join(config, "settings.json"), "utf8")).enabledPlugins ?? {};
  }

  function cachedSkill(team: string, version: string, skill: string): string {
    return readFileSync(join(config, "plugins/cache", ORG, team, version, "skills", skill, "SKILL.md"), "utf8");
  }

  /** Claude's own record of marketplaces and plugins, and every file under the acme cache, for a byte-for-byte compare. */
  function claudeSnapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const rel of ["plugins/installed_plugins.json", "plugins/known_marketplaces.json", "settings.json"]) {
      const file = join(config, rel);
      out[rel] = existsSync(file) ? readFileSync(file, "utf8") : "<absent>";
    }
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else out[path.slice(config.length + 1)] = readFileSync(path, "utf8");
      }
    };
    const cache = join(config, "plugins/cache", ORG);
    if (existsSync(cache)) walk(cache);
    return out;
  }

  const same = (a: string | undefined, b: string): boolean => a !== undefined && (a === b || (existsSync(a) && realpathSync(a) === realpathSync(b)));

  beforeAll(() => {
    ({ path: home, cleanup } = createTestHome());
    home = realpathSync(home);
    config = join(home, ".claude");
    clone = join(home, ".mattstack/orgs", ORG);
    generated = join(home, ".mattstack/rt/marketplaces", ORG);
    saved.HOME = process.env.HOME;
    saved.CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
    // The settings resolver and the disable-model-invocation reconcile read process.env, not the probes.
    process.env.HOME = home;
    process.env.CLAUDE_CONFIG_DIR = config;
    previousSink = setSettingsNoticeSink(() => {});
    mkdirSync(config, { recursive: true });

    // The org clone as a member has it today: the data branch checked out, layout 5, the team record naming the branch.
    mkdirSync(clone, { recursive: true });
    git(["init", "-q", "-b", DATA_BRANCH]);
    writeJson(join(clone, "mattstack/mattstack.jsonc"), { role: "org", org: ORG, layout: 5, dataBranch: DATA_BRANCH });
    writeJson(join(clone, ".claude-plugin/marketplace.json"), {
      name: ORG,
      owner: { name: ORG },
      plugins: [
        { name: "widgets", source: "./mattstack/teams/widgets/plugin" },
        { name: "gadgets", source: "./mattstack/teams/gadgets/plugin" },
      ],
    });
    writePack("widgets", "1.0.0", "alpha", "widgets alpha v1");
    writePack("gadgets", "1.0.0", "beta", "gadgets beta v1");
    git(["add", "-A"]);
    git(["commit", "-qm", "org data"]);
    writeJson(join(home, ".mattstack/rt/teams", `${ORG}.json`), { createdByRt: false, joinedByRt: true, rtMayManageMembership: false, dataBranch: DATA_BRANCH });

    // What an older rt did: register the clone itself and install both packs from it, at user scope; the member turned gadgets off.
    expect(claude(["plugin", "marketplace", "add", clone]).code).toBe(0);
    expect(claude(["plugin", "install", WIDGETS, "--scope", "user"]).code).toBe(0);
    expect(claude(["plugin", "install", GADGETS, "--scope", "user"]).code).toBe(0);
    expect(claude(["plugin", "disable", GADGETS]).code).toBe(0);

    // That rt's own record: what it added. The baseline set reads as removed by the member, which keeps the run offline.
    updateSetupState(probes(), (s) => ({
      ...s,
      marketplaces: [mattstackMarketplaceSource({}), OFFICIAL_MARKETPLACE_SOURCE, clone],
      plugins: [...BASE_PLUGINS, WIDGETS],
    }));

    setSetting("rt.skills.disableModelInvocation", { [WIDGETS]: ["alpha"] }, "user");
  });

  afterAll(() => {
    if (previousSink !== undefined) setSettingsNoticeSink(previousSink);
    if (saved.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = saved.HOME;
    if (saved.CLAUDE_CONFIG_DIR === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved.CLAUDE_CONFIG_DIR;
    cleanup?.();
  });

  test("fixture: the old directory-source install is what claude reports", () => {
    expect(same(acmeSource(), clone)).toBe(true);
    const reg = registry();
    expect(reg[WIDGETS]?.[0]?.scope).toBe("user");
    expect(reg[GADGETS]?.[0]?.scope).toBe("user");
    expect(enabledPlugins()[WIDGETS]).toBe(true);
    expect(enabledPlugins()[GADGETS]).toBe(false);
    console.log(`[fixture] old installPaths: widgets=${reg[WIDGETS]?.[0]?.installPath} gadgets=${reg[GADGETS]?.[0]?.installPath}`);
  });

  test("first update: converge, migration and plugins.install run clean", async () => {
    const { result, logs } = await update();
    console.log(`[first update] outcomes: ${JSON.stringify(result.outcomes, null, 2)}`);
    if (logs.length > 0) console.log(`[first update] logs:\n${logs.join("\n")}`);
    expect(outcome(result, "org.folder")?.state).toBe("done");
    expect(outcome(result, `migration.${MIGRATION_ID}`)?.state).toBe("done");
    expect(outcome(result, "plugins.install")?.state).toBe("done");
    expect(result.ok).toBe(true);
    expect(readSetupState(probes()).migrations).toContain(MIGRATION_ID);
  });

  test("acme points at the generated marketplace", () => {
    expect(same(acmeSource(), generated)).toBe(true);
    const file = JSON.parse(readFileSync(join(generated, ".claude-plugin/marketplace.json"), "utf8"));
    expect(file.name).toBe(ORG);
    for (const entry of file.plugins) {
      expect(entry.source.source).toBe("git-subdir");
      expect(entry.source.ref).toBe(DATA_BRANCH);
    }
  });

  test("setup-state follows the registration to the generated folder", () => {
    const recorded = readSetupState(probes()).marketplaces;
    expect(recorded.some((m) => same(m, generated))).toBe(true);
    expect(recorded).not.toContain(clone);
    expect(readSetupState(probes()).orgMarketplaceMoves ?? []).toEqual([]);
  });

  test("both packs are installed from the cache; gadgets stays off, widgets on", () => {
    const reg = registry();
    for (const id of [WIDGETS, GADGETS]) {
      const entries = reg[id] ?? [];
      expect(entries).toHaveLength(1);
      expect(entries[0]!.scope).toBe("user");
      expect(entries[0]!.installPath.startsWith(join(config, "plugins/cache", ORG) + "/")).toBe(true);
    }
    expect(enabledPlugins()[WIDGETS]).toBe(true);
    expect(enabledPlugins()[GADGETS]).toBe(false);
  });

  test("the cached widgets skill carries the personal disable-model-invocation line; gadgets does not", () => {
    const version = registry()[WIDGETS]![0]!.version;
    expect(cachedSkill("widgets", version, "alpha")).toContain(`disable-model-invocation: true ${PERSONAL_MARK}`);
    expect(cachedSkill("gadgets", registry()[GADGETS]![0]!.version, "beta")).not.toContain("disable-model-invocation");
  });

  test("a second update changes nothing claude owns and skips the recorded migration", async () => {
    const before = claudeSnapshot();
    const { result, logs } = await update();
    console.log(`[second update] outcomes: ${JSON.stringify(result.outcomes, null, 2)}`);
    if (logs.length > 0) console.log(`[second update] logs:\n${logs.join("\n")}`);
    expect(result.ok).toBe(true);
    expect(outcome(result, `migration.${MIGRATION_ID}`)).toBeUndefined();
    expect(outcome(result, "org.folder")?.detail ?? "").toContain("already points at");
    expect(claudeSnapshot()).toEqual(before);
    expect(readSetupState(probes()).migrations.filter((m) => m === MIGRATION_ID)).toHaveLength(1);
  });

  test("a forced rerun of the migration lands the same end state", async () => {
    const logs: string[] = [];
    const res = await teamPacksFromGitMigration.run(context(logs));
    console.log(`[migration rerun] ${JSON.stringify(res)}`);
    if (logs.length > 0) console.log(`[migration rerun] logs:\n${logs.join("\n")}`);
    expect(res.state).toBe("done");
    expect(same(acmeSource(), generated)).toBe(true);
    expect(enabledPlugins()[WIDGETS]).toBe(true);
    expect(enabledPlugins()[GADGETS]).toBe(false);
    expect(cachedSkill("widgets", registry()[WIDGETS]![0]!.version, "alpha")).toContain(`disable-model-invocation: true ${PERSONAL_MARK}`);
  });

  test("an uncommitted edit in the org clone never reaches the cache", async () => {
    writePack("widgets", "1.0.9", "alpha", "widgets alpha uncommitted");
    try {
      const before = claudeSnapshot();
      const { result } = await update();
      expect(result.ok).toBe(true);
      expect(registry()[WIDGETS]![0]!.version).toBe("1.0.0");
      expect(existsSync(join(config, "plugins/cache", ORG, "widgets", "1.0.9"))).toBe(false);
      expect(cachedSkill("widgets", "1.0.0", "alpha")).toContain("widgets alpha v1");
      expect(claudeSnapshot()).toEqual(before);
    } finally {
      git(["checkout", "--", "."]);
    }
  });

  test("a committed version bump on the data branch lands for the active team's pack, personal line included", async () => {
    writePack("widgets", "1.1.0", "alpha", "widgets alpha v1.1");
    git(["add", "-A"]);
    git(["commit", "-qm", "widgets 1.1.0"]);
    const { result, logs } = await update();
    console.log(`[bump] outcomes: ${JSON.stringify(result.outcomes, null, 2)}`);
    if (logs.length > 0) console.log(`[bump] logs:\n${logs.join("\n")}`);
    expect(result.ok).toBe(true);
    const entry = registry()[WIDGETS]![0]!;
    expect(entry.version).toBe("1.1.0");
    expect(entry.installPath).toBe(join(config, "plugins/cache", ORG, "widgets", "1.1.0"));
    const skill = cachedSkill("widgets", "1.1.0", "alpha");
    expect(skill).toContain("widgets alpha v1.1");
    expect(skill).toContain(`disable-model-invocation: true ${PERSONAL_MARK}`);
    expect(enabledPlugins()[WIDGETS]).toBe(true);
  });

  test("the daemon's pack converge lands a later committed bump of the active team's pack", async () => {
    writePack("widgets", "1.2.0", "alpha", "widgets alpha v1.2");
    git(["add", "-A"]);
    git(["commit", "-qm", "widgets 1.2.0"]);
    const quiet = { info: () => {}, warn: () => {}, error: () => {} } as never;
    const res = await convergePackCache(probes(), ORG, quiet, { activeTeam: () => "widgets", engine: () => null });
    expect(res.failed).toEqual([]);
    expect(res.updated).toEqual([{ id: WIDGETS, to: "1.2.0" }]);
    expect(registry()[WIDGETS]![0]!.version).toBe("1.2.0");
    expect(cachedSkill("widgets", "1.2.0", "alpha")).toContain("widgets alpha v1.2");
    expect(enabledPlugins()[WIDGETS]).toBe(true);
  });

  // Fails today: only the active team's pack is ever updated (plugins.install's
  // computePlugins, convergePackCache's `only: team`). Under the directory
  // source a session read every installed pack from the clone, so this pack
  // tracked the data branch; on the cache it stays at the version the
  // migration reinstalled.
  test.todo("a committed version bump on an installed pack that is not the active team's lands too", async () => {
    writePack("gadgets", "1.1.0", "beta", "gadgets beta v1.1");
    git(["add", "-A"]);
    git(["commit", "-qm", "gadgets 1.1.0"]);
    const { result } = await update();
    expect(result.ok).toBe(true);
    expect(registry()[GADGETS]![0]!.version).toBe("1.1.0");
    expect(enabledPlugins()[GADGETS]).toBe(false);
  });

  test("downgrade then upgrade: an older rt's directory add is undone by the next converge, packs kept", async () => {
    expect(claude(["plugin", "marketplace", "add", clone]).code).toBe(0);
    expect(same(acmeSource(), clone)).toBe(true);
    const ids = Object.keys(registry()).filter((id) => id.endsWith(`@${ORG}`)).sort();
    expect(ids).toEqual([GADGETS, WIDGETS]);

    const { result, logs } = await update();
    console.log(`[re-upgrade] outcomes: ${JSON.stringify(result.outcomes, null, 2)}`);
    if (logs.length > 0) console.log(`[re-upgrade] logs:\n${logs.join("\n")}`);
    expect(result.ok).toBe(true);
    expect(outcome(result, "org.folder")?.state).toBe("done");
    expect(same(acmeSource(), generated)).toBe(true);
    const reg = registry();
    for (const id of [WIDGETS, GADGETS]) {
      expect(reg[id]).toHaveLength(1);
      expect(reg[id]![0]!.installPath.startsWith(join(config, "plugins/cache", ORG) + "/")).toBe(true);
    }
    expect(enabledPlugins()[WIDGETS]).toBe(true);
    expect(enabledPlugins()[GADGETS]).toBe(false);
    expect(cachedSkill("widgets", reg[WIDGETS]![0]!.version, "alpha")).toContain(`disable-model-invocation: true ${PERSONAL_MARK}`);
  });
});
