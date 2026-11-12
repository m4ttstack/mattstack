import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { runStart, type RunStartOpts } from "../start.ts";
import { seedRun } from "./fixtures.ts";
import { git, homeWithOrgClone, installedSkill, moveToTrial, seedPack } from "./installed-fixtures.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "rt-runs-write-"));
}

function userVersion(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
}

afterEach(() => { delete process.env.RT_RUNS_ROOT; });

describe("runStart", () => {
  test("creates the DB under root/repo/runId, records ticket under producer work, stamps v3", () => {
    const root = tmp();
    const r = runStart(root, { repo: "demo", workType: "feature", pipeline: "default", spawnedBy: "test", ticket: "ABC-1", env: {}, now: 5000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.runDb).toBe(join(root, "demo", r.runId, "state.db"));
    const db = new Database(r.runDb, { readonly: true });
    const run = db.query("SELECT * FROM runs").get() as Record<string, unknown>;
    expect(run).toMatchObject({ id: r.runId, repo: "demo", work_type: "feature", pipeline: "default", status: "running", spawned_by: "test", started_at: 5000, pack_commits: null, pack_dirty: 0 });
    expect(db.query("SELECT value, produced_by FROM fields WHERE key='ticket'").get()).toEqual({ value: "ABC-1", produced_by: "work" });
    expect(userVersion(db)).toBe(3);
    db.close();
  });

  test("generates a run id of the form YYYYMMDD-HHMMSS-xxxx-pid when none is given", () => {
    const r = runStart(tmp(), { repo: "demo", workType: "fix", pipeline: "default", env: {} });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.runId).toMatch(new RegExp(`^\\d{8}-\\d{6}-[0-9a-f]{4}-${process.pid}$`));
  });

  test("no ticket flag writes no ticket field", () => {
    const r = runStart(tmp(), { repo: "demo", workType: "fix", pipeline: "default", env: {} });
    if (!r.ok) throw new Error(r.error);
    const db = new Database(r.runDb, { readonly: true });
    expect(db.query("SELECT COUNT(*) AS n FROM fields WHERE key='ticket'").get()).toEqual({ n: 0 });
    db.close();
  });

  test("mattstack sha and dirty flag and raw pack sha land in pack_commits and pack_dirty in order", () => {
    const r = runStart(tmp(), { repo: "demo", workType: "fix", pipeline: "default", mattstackSha: "deadbee", mattstackDirty: true, packSha: "acme=abc1234", packDirs: [""], env: {} });
    if (!r.ok) throw new Error(r.error);
    const db = new Database(r.runDb, { readonly: true });
    expect(db.query("SELECT pack_commits, pack_dirty FROM runs").get()).toEqual({ pack_commits: "mattstack=deadbee,acme=abc1234", pack_dirty: 1 });
    db.close();
  });

  test("a duplicate run id is exit 1; a v1 directory is migrated first", () => {
    const root = tmp();
    seedRun(root, "demo", "20260901-000000-abcd-1", 1000, 1);
    const dup = runStart(root, { repo: "demo", workType: "fix", pipeline: "default", runId: "20260901-000000-abcd-1", env: {} });
    expect(dup).toMatchObject({ ok: false, code: 1 });
    const db = new Database(join(root, "demo", "20260901-000000-abcd-1", "state.db"), { readonly: true });
    expect(userVersion(db)).toBe(3);
    db.close();
  });

  test("a repo that is not a plain path component is exit 2", () => {
    expect(runStart(tmp(), { repo: "../x", workType: "fix", pipeline: "default", env: {} })).toMatchObject({ ok: false, code: 2 });
  });

  test("records identity from env", () => {
    const r = runStart(tmp(), { repo: "demo", workType: "fix", pipeline: "default", env: { CLAUDE_CODE_SESSION_ID: "s1", HERDR_PANE_ID: "w1:p1" } });
    if (!r.ok) throw new Error(r.error);
    const db = new Database(r.runDb, { readonly: true });
    expect(db.query("SELECT value FROM fields WHERE key='claude-session'").get()).toEqual({ value: "s1" });
    expect(db.query("SELECT produced_by FROM fields WHERE key='herdr-pane'").get()).toEqual({ produced_by: "run" });
    db.close();
  });
});

describe("runStart provenance from the skill folder", () => {
  function recorded(r: ReturnType<typeof runStart>): { pack_commits: string | null; pack_dirty: number } {
    if (!r.ok) throw new Error(r.error);
    const db = new Database(r.runDb, { readonly: true });
    try {
      return db.query("SELECT pack_commits, pack_dirty FROM runs").get() as { pack_commits: string | null; pack_dirty: number };
    } finally {
      db.close();
    }
  }

  const start = (skillDir: string, home: string, extra: Partial<RunStartOpts> = {}) =>
    runStart(tmp(), { repo: "demo", workType: "feature", pipeline: "work", packDirs: [dirname(dirname(skillDir))], skillDir, env: { HOME: home }, ...extra });

  test("an org clone on a trial branch: run start still finds the bump commit on the data branch", () => {
    const { home, clone, sync11 } = homeWithOrgClone();
    moveToTrial(clone, sync11);
    const skillDir = installedSkill("0.4.11", { mattstack: "0.32.56" }, join(home, ".claude", "plugins", "cache"));
    expect(recorded(start(skillDir, home))).toEqual({ pack_commits: `acme=${sync11},mattstack=0.32.56`, pack_dirty: 0 });
  });

  test("a pack installed with no org clone records its version", () => {
    const home = tmp();
    const skillDir = installedSkill("0.4.11", { mattstack: "0.32.56" }, join(home, ".claude", "plugins", "cache"));
    expect(recorded(start(skillDir, home))).toEqual({ pack_commits: "acme=0.4.11,mattstack=0.32.56", pack_dirty: 0 });
  });

  test("a cache-installed pack inside an enclosing work tree skips the checkout path", () => {
    const home = tmp();
    git(home, "init", "-q");
    git(home, "commit", "-q", "--allow-empty", "-m", "dotfiles");
    const skillDir = installedSkill("0.4.11", { mattstack: "0.32.56" }, join(home, ".claude", "plugins", "cache"));
    expect(recorded(start(skillDir, home))).toEqual({ pack_commits: "acme=0.4.11,mattstack=0.32.56", pack_dirty: 0 });
  });

  test("a pack in CLAUDE_CONFIG_DIR's plugin cache inside an enclosing work tree skips the checkout path too", () => {
    const home = tmp();
    git(home, "init", "-q");
    git(home, "commit", "-q", "--allow-empty", "-m", "dotfiles");
    const configDir = join(home, ".claude-account");
    const skillDir = installedSkill("0.4.11", { mattstack: "0.32.56" }, join(configDir, "plugins", "cache"));
    expect(recorded(start(skillDir, home, { env: { HOME: home, CLAUDE_CONFIG_DIR: configDir } }))).toEqual({ pack_commits: "acme=0.4.11,mattstack=0.32.56", pack_dirty: 0 });
  });

  test("old baked flags still record provenance", () => {
    const { home } = homeWithOrgClone();
    const skillDir = installedSkill("0.4.11", { mattstack: "0.32.56", sha: "abc1234", dirty: 1 }, join(home, ".claude", "plugins", "cache"));
    const r = start(skillDir, home, { mattstackSha: "0.32.55", mattstackDirty: false, packSha: "acme=deadbee" });
    expect(recorded(r)).toEqual({ pack_commits: "mattstack=0.32.55,acme=deadbee", pack_dirty: 0 });
  });

  test("a pack run from a checkout outside the plugin cache keeps its sha and dirty bit, and takes mattstack from the lock", () => {
    const packRoot = join(tmp(), "acme");
    const skillDir = seedPack(packRoot, "0.4.11", { mattstack: "0.32.56", sha: "abc1234", dirty: 1 });
    git(packRoot, "init", "-q");
    git(packRoot, "add", "-A");
    git(packRoot, "commit", "-qm", "compile");
    const sha = git(packRoot, "rev-parse", "--short", "HEAD");
    expect(recorded(start(skillDir, tmp()))).toEqual({ pack_commits: `acme=${sha},mattstack=abc1234`, pack_dirty: 1 });
  });
});
