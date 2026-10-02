import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { PackInfo } from "../../lib/skills/packs.ts";
import type { MaterializeSkillsResult } from "../../lib/setup/skills-materialize.ts";
import type { SyncReport } from "../../lib/skills/sync.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as out from "../../lib/ui/out.ts";
import { deriveEngine, manifestTarget, syncBlocks, syncFailure, syncMaterializeVerdict, syncRefusal } from "../skills-sync.ts";

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
