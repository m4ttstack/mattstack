import { seedOrg } from "../../packages/rt-client/test/org-fixture.ts";
import { captureSkills, runExpectingCleanExit } from "../../lib/skills/__tests__/helpers.ts";
import * as packsModule from "../../lib/skills/packs.ts";
import * as syncModule from "../../lib/skills/sync.ts";
import { describe, expect, test, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { PackInfo } from "../../lib/skills/packs.ts";
import type { MaterializeSkillsResult } from "../../lib/setup/skills-materialize.ts";
import { TREE } from "../../lib/command-tree-def.ts";
import type { SyncDeps, SyncReport } from "../../lib/skills/sync.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as out from "../../lib/ui/out.ts";
import { deriveEngine, skillsSync, manifestTarget, syncBlocks, syncFailure, syncMaterializeVerdict, syncOptions, syncRefusal } from "../skills-sync.ts";
import * as syncCommand from "../skills-sync.ts";

function pack(name: string): PackInfo {
  return { name, dir: `/fake/${name}`, layout: "flat", surfacePath: `/fake/${name}/surface.jsonc`, marketplace: "local" };
}

describe("deriveEngine", () => {
  test("uses the discovered mattstack pack as the engine", () => {
    const mattstack = pack("mattstack");
    const acme = pack("acme");
    const result = deriveEngine([acme, mattstack], acme);
    expect("engine" in result && result.engine).toBe(mattstack);
  });

  test("the mattstack pack is its own engine", () => {
    const mattstack = pack("mattstack");
    const result = deriveEngine([mattstack], mattstack);
    expect("engine" in result && result.engine).toBe(mattstack);
  });

  test("with no directory-marketplace engine, reads the engine from its installed cache", () => {
    const cache = realpathSync(mkdtempSync(join(tmpdir(), "rt-sync-engine-cache-")));
    mkdirSync(join(cache, ".claude-plugin"), { recursive: true });
    writeFileSync(join(cache, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "mattstack", version: "0.28.9" }));
    writeFileSync(join(cache, "surface.jsonc"), `{ "public": [] }\n`);
    const acme = pack("acme");

    const result = deriveEngine([acme], acme, [
      { id: "superpowers@claude-plugins-official", installPath: "/nowhere" },
      { id: "mattstack@mattstack", installPath: cache },
    ]);

    expect("engine" in result).toBe(true);
    if ("engine" in result) {
      expect(result.engine).toMatchObject({ name: "mattstack", dir: cache, marketplace: "mattstack", installedCache: true });
    }
  });

  test("picks the installed engine the way compile does (last entry wins) and skips a disabled one", () => {
    const cacheAt = (version: string) => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-sync-engine-cache-")));
      mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
      writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "mattstack", version }));
      writeFileSync(join(dir, "surface.jsonc"), `{ "public": [] }\n`);
      return dir;
    };
    const userScope = cacheAt("0.28.8");
    const projectScope = cacheAt("0.28.9");
    const disabled = cacheAt("0.29.0");
    const acme = pack("acme");

    const result = deriveEngine([acme], acme, [
      { id: "mattstack@mattstack", installPath: userScope, enabled: true, scope: "user" },
      { id: "mattstack@mirror", installPath: projectScope, enabled: true, scope: "project" },
      { id: "mattstack@other", installPath: disabled, enabled: false, scope: "local" },
    ]);

    expect("engine" in result && result.engine).toMatchObject({ dir: projectScope, marketplace: "mirror", installedCache: true, scope: "project" });
  });

  test("a directory-marketplace engine wins over the installed cache", () => {
    const mattstack = pack("mattstack");
    const acme = pack("acme");
    const result = deriveEngine([acme, mattstack], acme, [{ id: "mattstack@mattstack", installPath: "/elsewhere" }]);
    expect("engine" in result && result.engine).toBe(mattstack);
  });

  test("refuses naming the pack and the marketplace registration when no mattstack pack is discovered", () => {
    const acme = pack("acme");
    const result = deriveEngine([acme], acme, [{ id: "mattstack@mattstack", installPath: "/gone" }]);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain('"acme"');
      expect(result.error).toContain("mattstack");
      expect(result.error).toContain("extraKnownMarketplaces");
    }
  });
});

describe("manifestTarget", () => {
  test("carries --manifest and --repo to the compile and check calls", () => {
    expect(manifestTarget(["--pack", "acme", "--repo", "gitlab.example.com/acme/widgets", "--manifest", "/tmp/skills.jsonc"]))
      .toEqual({ manifest: "/tmp/skills.jsonc", repo: "gitlab.example.com/acme/widgets" });
  });

  test("omits what was not passed", () => {
    expect(manifestTarget(["--pack", "acme", "--json"])).toEqual({});
  });
});

describe("syncOptions", () => {
  test("--commit-pending reaches syncPack as commitPending", () => {
    expect(syncOptions(["--pack", "acme", "--commit-pending", "--json"])).toEqual({ commitPending: true });
  });

  test("without the flag nothing is committed", () => {
    expect(syncOptions(["--pack", "acme"])).toEqual({ commitPending: false });
  });

  test("the sync command lists the flag", () => {
    const sync = TREE.skills?.subcommands?.sync;
    expect(sync?.args?.some((a) => a.flag === "--commit-pending")).toBe(true);
  });

  test("--expect reaches syncPack as the signature to match", () => {
    const signature = "a".repeat(64);
    expect(syncOptions(["--pack", "acme", "--commit-pending", "--expect", signature, "--json"])).toEqual({ commitPending: true, expect: signature });
  });

  test("an --expect that is not a signature is refused before anything runs", () => {
    expect(() => syncOptions(["--pack", "acme", "--expect"])).toThrow("signature");
    expect(() => syncOptions(["--pack", "acme", "--expect", "--json"])).toThrow("signature");
    expect(() => syncOptions(["--pack", "acme", "--expect", "abc"])).toThrow("signature");
  });

  test("sync and discard list --expect, and agents may pass it to sync while --commit-pending stays theirs to refuse", () => {
    const sync = TREE.skills?.subcommands?.sync;
    const discard = TREE.skills?.subcommands?.discard;
    expect(sync?.args?.some((a) => a.flag === "--expect")).toBe(true);
    expect(discard?.args?.some((a) => a.flag === "--expect")).toBe(true);
    expect(sync?.agentSafe).toBe(true);
    expect(sync?.agentDeniedFlags).toContain("--commit-pending");
    expect(sync?.agentDeniedFlags).not.toContain("--expect");
  });
});

describe("syncMaterializeVerdict", () => {
  const result = (repos: Extract<MaterializeSkillsResult, { skipped: false }>["repos"]): MaterializeSkillsResult => ({ skipped: false, repos });
  const written = (pack: string) => ({ pack, zone: "acme", ok: true as const, path: `/h/${pack}/skills.jsonc`, layers: ["pack"] });
  const broken = (pack: string, detail: string) => ({ pack, zone: "acme-gadgets", ok: false as const, detail });

  test("a sibling pack's failure is a note, not a failure", () => {
    const r = result([{ name: "repo-a", path: "/r/a", ok: false, detail: "", packs: [written("widgets"), broken("gadgets", "gadgets extends acme-base@acme, which is not installed")] }]);
    const verdict = syncMaterializeVerdict(r, "widgets");
    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toContain("gadgets (repo-a)");
  });

  test("this pack's own failure fails, naming the pack and repo", () => {
    const r = result([{ name: "repo-a", path: "/r/a", ok: false, detail: "", packs: [written("widgets"), broken("gadgets", "gadgets extends acme-base@acme, which is not installed")] }]);
    expect(syncMaterializeVerdict(r, "gadgets")).toEqual({ ok: false, detail: "gadgets (repo-a): gadgets extends acme-base@acme, which is not installed", warnings: [] });
  });

  test("a repo-level error with no packs fails; no-remote and undeclared rows do not", () => {
    const r = result([
      { name: "repo-a", path: "/r/a", ok: false, detail: "EACCES: permission denied" },
      { name: "repo-b", path: "/r/b", ok: false, noManifest: true, detail: "no remote in /r/b" },
    ]);
    expect(syncMaterializeVerdict(r, "widgets")).toEqual({ ok: false, detail: "repo-a: EACCES: permission denied", warnings: [] });
    expect(syncMaterializeVerdict(result([r.repos[1]!]), "widgets").ok).toBe(true);
  });

  test("a written pack file reads as plain words", () => {
    const r = result([{ name: "repo-a", path: "/r/a", ok: true, detail: "", packs: [written("widgets")] }]);
    expect(syncMaterializeVerdict(r, "widgets").detail).toBe("wrote 1 widgets bindings file");
  });

  test("a skipped run is not a failure", () => {
    expect(syncMaterializeVerdict({ skipped: true, reason: "engine-pack-missing", repos: [] }, "widgets")).toEqual({ ok: true, detail: "nothing was written: engine-pack-missing", warnings: [] });
  });

  test("a stale file that could not be set aside is a warning line, not a failure", () => {
    const r = result([
      { name: "repo-a", path: "/r/a", ok: true, detail: "", packs: [written("widgets")], pruneWarnings: ["could not set aside /h/gadgets/skills.jsonc: EACCES"] },
      { name: "repo-b", path: "/r/b", ok: false, noManifest: true, detail: "", pruneWarnings: ["could not set aside /h/other/skills.jsonc: EACCES"] },
    ]);
    const verdict = syncMaterializeVerdict(r, "widgets");
    expect(verdict.ok).toBe(true);
    expect(verdict.warnings).toEqual([
      "repo-a: could not set aside /h/gadgets/skills.jsonc: EACCES",
      "repo-b: could not set aside /h/other/skills.jsonc: EACCES",
    ]);
  });
});

describe("syncBlocks", () => {
  const report = (over: Partial<SyncReport>): SyncReport => ({
    ok: true,
    pack: "acme",
    steps: [],
    versions: { engine: { before: "1.0.0", after: "1.0.0" }, pack: { source: "0.5.3", installedBefore: "0.5.3", installedAfter: "0.5.3" } },
    warnings: [],
    restartNeeded: false,
    ...over,
  });

  test("each step is a line with a plain title, never a step id", () => {
    const text = renderPlain(
      syncBlocks(
        report({
          steps: [
            { name: "guards", status: "ran", detail: "engine and pack checkouts clean on main" },
            { name: "pull-engine", status: "skipped", detail: "The engine and the pack share a checkout, so it is pulled once, with the pack" },
            { name: "commit-push", status: "ran", detail: "committed and pushed v0.5.4" },
          ],
          versions: { engine: { before: "1.0.0", after: "1.1.0" }, pack: { source: "0.5.4", installedBefore: "0.5.3", installedAfter: "0.5.4" } },
          warnings: ["The beta cswap account's plugins folder (/s/beta/plugins) does not point at /c/plugins"],
          restartNeeded: true,
        }),
      ),
    );
    expect(text).toBe(
      [
        "[ok] Safety checks  engine and pack checkouts clean on main",
        "[skipped] Pull the engine  The engine and the pack share a checkout, so it is pulled once, with the pack",
        "[ok] Commit and push  committed and pushed v0.5.4",
        "Engine: 1.0.0 -> 1.1.0",
        "Installed pack: 0.5.3 -> 0.5.4",
        "[warning] The beta cswap account's plugins folder (/s/beta/plugins) does not point at /c/plugins",
        "",
        "[ok] Synced",
        "  next: Run /reload-plugins in any Claude session that is already running",
        "",
      ].join("\n"),
    );
    expect(text).not.toContain("pull-engine");
  });

  test("nothing to do is one summary", () => {
    expect(renderPlain(syncBlocks(report({})))).toBe("[ok] Already current\n");
  });

  test("staging pending pack edits has its own plain title", () => {
    const text = renderPlain(syncBlocks(report({ steps: [{ name: "commit-pending", status: "ran", detail: "staged 2 files" }] })));
    expect(text).toContain("[ok] Stage your pack edits  staged 2 files");
    expect(text).not.toContain("commit-pending");
  });

  test("changes outside the pack refuse the sync as policy, never as a failure", () => {
    const detail = "The pack checkout at /z/packs/acme has changes outside the pack: README.md. Commit or stash those, then run this again";
    const refused = report({ ok: false, steps: [{ name: "guards", status: "refused", detail }] });
    expect(renderPlain(syncRefusal(refused)!)).toBe(`[refused] rt did not sync acme  it stopped at: Safety checks\n  why: ${detail}\n`);
    expect(syncFailure(refused)).toBeNull();
  });

  test("a refusal is not a failure: the steps before it on stdout, then a refused note", () => {
    const refused = report({
      ok: false,
      steps: [
        { name: "guards", status: "ran", detail: "engine and pack checkouts clean on main" },
        { name: "bump", status: "refused", detail: "This pack is in the shared checkout at /z/mono/packs/acme, and its compiled skills are out of date" },
      ],
    });
    expect(renderPlain(syncBlocks(refused))).toBe("[ok] Safety checks  engine and pack checkouts clean on main\n");
    expect(renderPlain(syncRefusal(refused)!)).toBe(
      "[refused] rt did not sync acme  it stopped at: Bump the pack's version\n  why: This pack is in the shared checkout at /z/mono/packs/acme, and its compiled skills are out of date\n",
    );
    expect(syncFailure(refused)).toBeNull();
  });

  test("a step sync marks refused because a command failed reads as a failure, and the report keeps refused", () => {
    const pulled = report({
      ok: false,
      steps: [{ name: "pull-pack", status: "refused", detail: "Pulling /z/packs/acme failed: not possible to fast-forward. Sort it out by hand, then run this again" }],
    });
    expect(syncRefusal(pulled)).toBeNull();
    expect(renderPlain([out.failure(syncFailure(pulled)!)])).toBe(
      "The sync stopped at: Pull the pack\n  why: Pulling /z/packs/acme failed: not possible to fast-forward. Sort it out by hand, then run this again\n",
    );
    expect(pulled.steps[0]!.status).toBe("refused");
  });

  test("a strict lint refusal names the check to run", () => {
    const refused = report({ ok: false, steps: [{ name: "check", status: "refused", detail: "This pack is strict, and mcp lint found 2 hits. Fix them before syncing" }] });
    expect(renderPlain(syncRefusal(refused)!)).toBe(
      "[refused] rt did not sync acme  it stopped at: Check for drift\n  why: This pack is strict, and mcp lint found 2 hits. Fix them before syncing\n  next: rt skills check --pack acme\n",
    );
  });

  test("a failed step is the failure, named in plain words, with nothing for it on stdout", () => {
    const failed = report({ ok: false, steps: [{ name: "compile", status: "failed", detail: 'verb "ship": engine not found' }] });
    expect(renderPlain([out.failure(syncFailure(failed)!)])).toBe('The sync stopped at: Recompile\n  why: verb "ship": engine not found\n');
    expect(syncBlocks(failed)).toEqual([]);
    expect(syncRefusal(failed)).toBeNull();
  });

  test("a multi-line compile refusal keeps every line, none of them in the title", () => {
    const compile = report({
      ok: false,
      steps: [{ name: "compile", status: "refused", detail: "skills/ship.md: unknown slot\nskills/plan.md: missing heading\nrt put the version back to 0.5.2, so the checkout stays clean" }],
    });
    const failure = syncFailure(compile)!;
    expect(failure.title).not.toContain("\n");
    expect(renderPlain([out.failure(failure)])).toBe(
      "The sync stopped at: Recompile\n  why: skills/ship.md: unknown slot\n  skills/plan.md: missing heading\n  rt put the version back to 0.5.2, so the checkout stays clean\n",
    );
  });

  test("a multi-line refusal detail keeps every line", () => {
    const dirty = report({
      ok: false,
      steps: [{ name: "guards", status: "refused", detail: "The pack checkout at /z/packs/acme has uncommitted changes (M a.md\n?? b.md). Commit or stash them, then run this again" }],
    });
    const text = renderPlain(syncRefusal(dirty)!);
    expect(text).toContain("  why: The pack checkout at /z/packs/acme has uncommitted changes (M a.md\n");
    expect(text).toContain("       ?? b.md). Commit or stash them, then run this again\n");
  });
});

test("no Claude Code is a needs-you note, the same one init prints", () => {
  expect(renderPlain(syncCommand.claudeMissingBlocks())).toBe("[needs you] Claude Code is not installed  rt installs and syncs packs through it\n  next: Install Claude Code, then run this again\n");
});

test("skillsSync sends the missing Claude Code note to stderr and keeps exit 1", async () => {
  const io = captureSkills();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-sync-missing-claude-")));
  const unexpected = async (): Promise<never> => { throw new Error("Missing Claude Code must stop before dependencies run"); };
  const deps: SyncDeps = {
    mayCompile: () => true, claudeBin: null, run: unexpected, checkPack: unexpected, compilePack: unexpected,
    materialize: unexpected, configDir: join(dir, "config"), cswapSessionsDir: join(dir, "sessions"), inTreeRoot: null,
  };
  try {
    await skillsSync([], { packs: [{ ...pack("mattstack"), dir }], deps });
    expect(io.stderr()).toBe(renderPlain(syncCommand.claudeMissingBlocks()));
    expect(io.stdout()).toBe("");
    expect(process.exitCode).toBe(1);
  } finally {
    io.restore();
    process.exitCode = 0;
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const target of ["root", "..pack"]) test(`member sync cannot commit ${target} source`, async () => {
  const savedHome = process.env.HOME;
  const savedExit = process.exitCode;
  const home = realpathSync(mkdtempSync(join(tmpdir(), "rt-sync-containment-")));
  process.env.HOME = home;
  const io = captureSkills();
  let permission: boolean | undefined;
  const calls: string[] = [];
  seedOrg({ org: "acme", username: "dev4", roles: { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } }, teams: { widgets: {} } });
  const root = join(home, ".mattstack", "teams", "acme");
  const dir = target === "root" ? root : join(root, target);
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  const manifest = join(dir, ".claude-plugin", "plugin.json");
  const before = '{"name":"widgets","version":"1.0.0"}\n';
  writeFileSync(manifest, before);
  const source = { ...pack("widgets"), dir, marketplace: "local" };
  const engine = { ...pack("mattstack"), installedCache: true, marketplace: "local" };
  const discovery = spyOn(packsModule, "discoverPacks").mockReturnValue([source, engine]);
  const realSync = syncModule.syncPack;
  const seam = spyOn(syncModule, "syncPack").mockImplementation(async (p, e, deps, options) => {
    permission = deps.mayCompile(p.name);
    return realSync(p, e, { ...deps, claudeBin: "/fake/claude", inTreeRoot: null, run: async (_cmd, args) => {
      calls.push(args[0]!);
      return { code: 0, stdout: args[0] === "status" ? " M .claude-plugin/plugin.json\n" : "", stderr: "" };
    } }, options);
  });
  try {
    await skillsSync(["--pack", "widgets", "--commit-pending", "--json"]);
    expect(permission).toBe(false);
    expect(process.exitCode).toBe(1);
    const result = JSON.parse(io.stdout());
    expect(result).toMatchObject({ ok: false, pack: "widgets", steps: [{ name: "guards", status: "refused", detail: "This pack has changes, but only its team's owners can commit them" }] });
    expect(Object.keys(result).sort()).toEqual(["ok", "pack", "restartNeeded", "steps", "versions", "warnings"]);
    expect(calls.some(c => ["add", "commit", "push", "pull"].includes(c))).toBe(false);
    expect(readFileSync(manifest, "utf8")).toBe(before);
  } finally {
    seam.mockRestore(); discovery.mockRestore(); io.restore();
    process.env.HOME = savedHome; process.exitCode = savedExit ?? 0;
    rmSync(home, { recursive: true, force: true });
  }
});

describe("a Mac with two org clones", () => {
  for (const json of [[], ["--json"]]) test(`a member's sync of the other org's pack is refused before any git step ${json.length ? "as JSON" : "for a person"}`, async () => {
    const savedHome = process.env.HOME;
    const savedExit = process.exitCode;
    const home = realpathSync(mkdtempSync(join(tmpdir(), "rt-sync-two-orgs-")));
    process.env.HOME = home;
    const io = captureSkills();
    const roles = { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } };
    seedOrg({ org: "acme", username: "dev4", roles, teams: { widgets: {} } });
    seedOrg({ org: "beta", username: "dev4", roles, teams: { widgets: {} } });
    const dir = join(home, ".mattstack", "teams", "beta", "mattstack", "teams", "widgets", "packs", "widgets");
    mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
    const manifest = join(dir, ".claude-plugin", "plugin.json");
    const before = '{"name":"widgets","version":"1.0.0"}\n';
    writeFileSync(manifest, before);
    const source = { ...pack("widgets"), dir, marketplace: "beta" };
    const engine = { ...pack("mattstack"), installedCache: true, marketplace: "local" };
    const discovery = spyOn(packsModule, "discoverPacks").mockReturnValue([source, engine]);
    const seam = spyOn(syncModule, "syncPack").mockImplementation(async () => { throw new Error("a sync of another org's pack must not start"); });
    try {
      const result = await runExpectingCleanExit(() => skillsSync(["--pack", "widgets", "--commit-pending", ...json]));
      expect(seam).not.toHaveBeenCalled();
      expect(result.exitCode).toBe(2);
      if (json.length) expect(JSON.parse(io.stdout())).toEqual({ ok: false, error: "This pack is in the beta org, not the one this Mac uses. rt works with one org per Mac, and this Mac uses acme" });
      else expect(io.stderr()).toBe("[refused] This pack is in the beta org, not the one this Mac uses\n  why: rt works with one org per Mac, and this Mac uses acme\n");
      expect(readFileSync(manifest, "utf8")).toBe(before);
    } finally {
      seam.mockRestore(); discovery.mockRestore(); io.restore();
      process.env.HOME = savedHome; process.exitCode = savedExit ?? 0;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("mayCompile counts a pack under any org clone as org-owned", async () => {
    const savedHome = process.env.HOME;
    const home = realpathSync(mkdtempSync(join(tmpdir(), "rt-sync-two-orgs-")));
    process.env.HOME = home;
    const io = captureSkills();
    const roles = { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } };
    seedOrg({ org: "acme", username: "dev2", roles, teams: { widgets: {} } });
    seedOrg({ org: "beta", username: "dev2", roles, teams: { widgets: {} } });
    const teamPack = (org: string) => join(home, ".mattstack", "teams", org, "mattstack", "teams", "widgets", "packs", "widgets");
    const packs = [{ ...pack("widgets"), dir: teamPack("acme") }, { ...pack("gadgets"), dir: teamPack("beta") }, { ...pack("mattstack"), dir: join(home, "elsewhere") }];
    for (const p of packs) mkdirSync(p.dir, { recursive: true });
    const discovery = spyOn(packsModule, "discoverPacks").mockReturnValue(packs);
    const verdicts: Record<string, boolean> = {};
    const seam = spyOn(syncModule, "syncPack").mockImplementation(async (p, _e, deps) => {
      for (const name of ["widgets", "gadgets", "mattstack"]) verdicts[name] = deps.mayCompile(name);
      return { ok: true, pack: p.name, steps: [], versions: {}, warnings: [], restartNeeded: false } as unknown as SyncReport;
    });
    try {
      await skillsSync(["--pack", "widgets", "--json"]);
      expect(verdicts).toEqual({ widgets: true, gadgets: false, mattstack: true });
    } finally {
      seam.mockRestore(); discovery.mockRestore(); io.restore();
      process.env.HOME = savedHome; process.exitCode = 0;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
