import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { updateRepoIndex } from "../../repo-index.ts";
import { setSetting } from "../../settings/write.ts";
import { UserActionableError } from "../errors.ts";
import { createRealProbes } from "../probes.ts";
import { ENGINE_PACK_MISSING_CODE, findEnginePackDir, materializeSkills } from "../skills-materialize.ts";
import { fakeProbes } from "./fakes.ts";

const CACHE = "/fake-home/.claude/plugins/cache/mattstack/mattstack";

describe("findEnginePackDir", () => {
  test("RT_ENGINE_PACK_DIR wins when it exists", () => {
    const p = fakeProbes({ home: "/fake-home", env: { RT_ENGINE_PACK_DIR: "/src/plugins/mattstack" }, dirs: { "/src/plugins/mattstack": [], [CACHE]: ["0.29.0"], [`${CACHE}/0.29.0`]: [] } });
    expect(findEnginePackDir(p)).toBe("/src/plugins/mattstack");
  });
  test("a missing RT_ENGINE_PACK_DIR falls through to the installed plugin", () => {
    const p = fakeProbes({ home: "/fake-home", env: { RT_ENGINE_PACK_DIR: "/gone" }, dirs: { [CACHE]: ["0.29.0"], [`${CACHE}/0.29.0`]: [] } });
    expect(findEnginePackDir(p)).toBe(`${CACHE}/0.29.0`);
  });
  test("a missing RT_ENGINE_PACK_DIR with nothing installed is null", () => {
    expect(findEnginePackDir(fakeProbes({ home: "/fake-home", env: { RT_ENGINE_PACK_DIR: "/gone" } }))).toBeNull();
  });
  test("else the highest installed mattstack version", () => {
    const p = fakeProbes({ home: "/fake-home", dirs: { [CACHE]: ["0.28.0", "0.29.0"], [`${CACHE}/0.28.0`]: [], [`${CACHE}/0.29.0`]: [] } });
    expect(findEnginePackDir(p)).toBe(`${CACHE}/0.29.0`);
  });
  test("null when nothing is installed", () => {
    expect(findEnginePackDir(fakeProbes({ home: "/fake-home" }))).toBeNull();
  });
});

describe("materializeSkills", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-materialize-home-")));
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  function write(p: string, t: string): void { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, t); }

  function seedRepo(remote: string | null): { dir: string; name: string } {
    const dir = mkdtempSync(join(home, "repo-"));
    execFileSync("git", ["init", "-q", dir]);
    if (remote) execFileSync("git", ["-C", dir, "remote", "add", "origin", remote]);
    updateRepoIndex(basename(dir), dir);
    return { dir, name: basename(dir) };
  }

  function seedZone(): void {
    const zone = join(home, ".mattstack", "teams", "acme", "mattstack");
    write(join(zone, "mattstack.jsonc"), JSON.stringify({ role: "team", namespace: "acme" }));
    write(join(zone, "team.jsonc"), JSON.stringify({ gitlabHost: "https://gitlab.example.com", projects: ["acme/widgets"] }));
    write(join(zone, "packs", "widgets", "pack", "skills.jsonc"), JSON.stringify({ bindings: { "mattstack:stage-gates": { domain: "widgets:gates" } } }));
  }

  function engine(): string {
    const dir = join(home, "engine");
    write(join(dir, "pack", "skills.jsonc"), "{}");
    return dir;
  }

  test("skips with the engine-pack code when the mattstack plugin is not installed", async () => {
    const result = await materializeSkills(createRealProbes(), {});
    expect(result.skipped).toBe(true);
    if (result.skipped) expect(result.reason).toStartWith(`${ENGINE_PACK_MISSING_CODE}:`);
  });

  test("writes the pack file for a registered repo a zone declares", async () => {
    const { name } = seedRepo("https://gitlab.example.com/acme/widgets.git");
    seedZone();
    const p = { ...createRealProbes(), env: { ...process.env, RT_ENGINE_PACK_DIR: engine() } };
    const result = await materializeSkills(p, {});
    expect(result.skipped).toBe(false);
    if (result.skipped) return;
    const row = result.repos.find((r) => r.name === name)!;
    expect(row.ok).toBe(true);
    expect(row.packs?.[0]).toMatchObject({ pack: "widgets", ok: true, path: join(home, ".mattstack", "repos", "gitlab.example.com-acme-widgets", "packs", "widgets", "skills.jsonc") });
    expect(row.detail).toBe("wrote 1 pack file: widgets");
  });

  test("a repo with no remote is noManifest, not a failure", async () => {
    seedRepo(null);
    const p = { ...createRealProbes(), env: { ...process.env, RT_ENGINE_PACK_DIR: engine() } };
    const result = await materializeSkills(p, {});
    if (result.skipped) throw new Error("skipped");
    expect(result.repos[0]).toMatchObject({ ok: false, noManifest: true, noRemote: true });
  });

  test("a repo no zone declares is noManifest with the repo named", async () => {
    seedRepo("https://gitlab.example.com/acme/other.git");
    seedZone();
    const p = { ...createRealProbes(), env: { ...process.env, RT_ENGINE_PACK_DIR: engine() } };
    const result = await materializeSkills(p, {});
    if (result.skipped) throw new Error("skipped");
    expect(result.repos[0]).toMatchObject({ ok: false, noManifest: true, detail: "no team declares gitlab.example.com/acme/other" });
  });

  test("a declaring zone that holds no pack is noManifest, not a success", async () => {
    seedRepo("https://gitlab.example.com/acme/widgets.git");
    seedZone();
    rmSync(join(home, ".mattstack", "teams", "acme", "mattstack", "packs"), { recursive: true });
    const p = { ...createRealProbes(), env: { ...process.env, RT_ENGINE_PACK_DIR: engine() } };
    const result = await materializeSkills(p, {});
    if (result.skipped) throw new Error("skipped");
    expect(result.repos[0]).toMatchObject({ ok: false, noManifest: true, detail: "no team declares a pack for gitlab.example.com/acme/widgets" });
  });

  test("a declaring zone that holds no pack still reports a stale file it could not set aside", async () => {
    seedRepo("https://gitlab.example.com/acme/widgets.git");
    seedZone();
    rmSync(join(home, ".mattstack", "teams", "acme", "mattstack", "packs"), { recursive: true });
    const packs = join(home, ".mattstack", "repos", "gitlab.example.com-acme-widgets", "packs");
    write(join(packs, "gadgets", "skills.jsonc"), "// zone: acme\n{}");
    chmodSync(join(packs, "gadgets"), 0o555);
    try {
      const p = { ...createRealProbes(), env: { ...process.env, RT_ENGINE_PACK_DIR: engine() } };
      const result = await materializeSkills(p, {});
      if (result.skipped) throw new Error("skipped");
      expect(result.repos[0]).toMatchObject({ ok: false, noManifest: true });
      expect(result.repos[0]!.detail).toStartWith("no team declares a pack for gitlab.example.com/acme/widgets; ");
      expect(result.repos[0]!.detail).toContain(`could not set aside ${join(packs, "gadgets", "skills.jsonc")}`);
    } finally {
      chmodSync(join(packs, "gadgets"), 0o755);
    }
  });

  test("a failed pack marks the repo not ok and names the pack and fix", async () => {
    seedRepo("https://gitlab.example.com/acme/widgets.git");
    seedZone();
    write(join(home, ".mattstack", "teams", "acme", "mattstack", "packs", "widgets", "pack", "skills.jsonc"), JSON.stringify({ extends: "acme-base@acme" }));
    const p = { ...createRealProbes(), env: { ...process.env, RT_ENGINE_PACK_DIR: engine() } };
    const result = await materializeSkills(p, {});
    if (result.skipped) throw new Error("skipped");
    expect(result.repos[0]!.ok).toBe(false);
    expect(result.repos[0]!.detail).toBe("widgets: widgets extends acme-base@acme, which is not installed; add it to the team's claude.plugins");
  });

  test("--repo naming no registered repo throws repo-not-registered", async () => {
    const eng = engine();
    const p = fakeProbes({ home, env: { RT_ENGINE_PACK_DIR: eng }, dirs: { [eng]: [] } });
    const err = await materializeSkills(p, { repo: "no-such-widgets" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserActionableError);
    expect((err as UserActionableError).code).toBe("repo-not-registered");
  });

  test("--repo naming two registered repos throws repo-ambiguous listing both", async () => {
    const first = join(home, "a", "widgets");
    const second = join(home, "b", "widgets");
    mkdirSync(first, { recursive: true });
    mkdirSync(second, { recursive: true });
    updateRepoIndex("remote:gitlab.example.com%2Facme%2Fwidgets", first);
    updateRepoIndex("remote:gitlab.example.com%2Facme%2Fgadgets%2Fwidgets", second);
    const eng = engine();
    const p = fakeProbes({ home, env: { RT_ENGINE_PACK_DIR: eng }, dirs: { [eng]: [] } });
    const err = await materializeSkills(p, { repo: "widgets" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserActionableError);
    expect((err as UserActionableError).code).toBe("repo-ambiguous");
    expect((err as Error).message).toContain("remote:gitlab.example.com%2Facme%2Fwidgets");
    expect((err as Error).message).toContain("remote:gitlab.example.com%2Facme%2Fgadgets%2Fwidgets");
    expect(p.calls.exec).toEqual([]);
  });

  test("targets only registered repos, never checkouts a repo-root scan discovered", async () => {
    const { name } = seedRepo("https://gitlab.example.com/acme/widgets.git");
    const scanned = mkdtempSync(join(home, "scanned-"));
    execFileSync("git", ["init", "-q", scanned]);
    setSetting("rt.repoRoots", [home], "machine");
    seedZone();
    const p = { ...createRealProbes(), env: { ...process.env, RT_ENGINE_PACK_DIR: engine() } };
    const result = await materializeSkills(p, {});
    if (result.skipped) throw new Error("skipped");
    expect(result.repos.map((r) => r.name)).toEqual([name]);
  });

  test("--repo and --dir together are refused", async () => {
    const p = fakeProbes({ home, env: { RT_ENGINE_PACK_DIR: engine() } });
    const err = await materializeSkills(p, { repo: "widgets", dir: home }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserActionableError);
    expect((err as UserActionableError).code).toBe("flags-conflict");
    expect((err as Error).message).toBe("pass --repo or --dir, not both");
  });

  test("a relative --dir resolves to an absolute row path and name", async () => {
    const dir = mkdtempSync(join(home, "loose-"));
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "remote", "add", "origin", "https://gitlab.example.com/acme/widgets.git"]);
    seedZone();
    const p = { ...createRealProbes(), env: { ...process.env, RT_ENGINE_PACK_DIR: engine() } };
    const result = await materializeSkills(p, { dir: relative(process.cwd(), dir) });
    if (result.skipped) throw new Error("skipped");
    expect(result.repos[0]).toMatchObject({ name: basename(dir), path: dir, ok: true });
  });

  test("a write that throws fails only its own repo; the others still run", async () => {
    const declared = seedRepo("https://gitlab.example.com/acme/widgets.git");
    const other = seedRepo("https://gitlab.example.com/acme/other.git");
    seedZone();
    const real = createRealProbes();
    const p = {
      ...real,
      env: { ...process.env, RT_ENGINE_PACK_DIR: engine() },
      writeFile: () => { throw new Error("EACCES: permission denied"); },
    };
    const result = await materializeSkills(p, {});
    if (result.skipped) throw new Error("skipped");
    expect(result.repos.find((r) => r.name === declared.name)).toMatchObject({ ok: false, detail: "EACCES: permission denied" });
    expect(result.repos.find((r) => r.name === other.name)).toMatchObject({ ok: false, noManifest: true });
  });

  test("--dir materializes an unregistered checkout by path", async () => {
    const dir = mkdtempSync(join(home, "loose-"));
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "remote", "add", "origin", "https://gitlab.example.com/acme/widgets.git"]);
    seedZone();
    const p = { ...createRealProbes(), env: { ...process.env, RT_ENGINE_PACK_DIR: engine() } };
    const result = await materializeSkills(p, { dir });
    if (result.skipped) throw new Error("skipped");
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]!.ok).toBe(true);
  });
});
