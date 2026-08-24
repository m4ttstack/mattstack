// tests/pipeline-state.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const SCRIPT = join(import.meta.dir, "..", "attachments", "pipeline", "work", "scripts", "pipeline-state.sh");

export function runState(args: string[], env: Record<string, string> = {}): { out: any; code: number; raw: string } {
  const proc = Bun.spawnSync(["/bin/sh", SCRIPT, ...args], {
    env: { ...process.env, ...env },
  });
  const raw = proc.stdout.toString().trim();
  let out: any = null;
  try { out = JSON.parse(raw); } catch { /* non-JSON subcommands return raw */ }
  return { out, code: proc.exitCode, raw };
}

export function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), "rt-runs-"));
}

function sqlite(dbPath: string, sql: string): string {
  const p = Bun.spawnSync(["sqlite3", dbPath, sql]);
  return new TextDecoder().decode(p.stdout).trim();
}

// Start a run and return the env every later call needs, matching the shape
// the existing tests build by hand.
function startRun(extra: string[] = []): { root: string; env: Record<string, string>; dbPath: string } {
  const root = freshRoot();
  const start = runState(
    ["run-start", "--repo", "demo", "--work-type", "fix", "--pipeline", "default", ...extra],
    { RT_RUNS_ROOT: root, RT_RUN_EMIT: "0" },
  );
  const dbPath = start.out.runDb as string;
  return { root, env: { RT_RUN_DB: dbPath, RT_RUN_EMIT: "0" }, dbPath };
}

describe("run-start", () => {
  test("creates the DB, stamps current schema version, returns runId + runDb", () => {
    const root = freshRoot();
    const r = runState(
      ["run-start", "--repo", "demo", "--work-type", "feature", "--pipeline", "default", "--spawned-by", "test"],
      { RT_RUNS_ROOT: root, RT_RUN_EMIT: "0" },
    );
    expect(r.code).toBe(0);
    expect(r.out.ok).toBe(true);
    expect(r.out.runDb).toContain(join(root, "demo"));
    const ver = Bun.spawnSync(["sqlite3", r.out.runDb, "PRAGMA user_version;"]).stdout.toString().trim();
    expect(ver).toBe("2");
    const row = Bun.spawnSync(["sqlite3", "-json", r.out.runDb, "SELECT * FROM runs;"]).stdout.toString();
    const runs = JSON.parse(row);
    expect(runs).toHaveLength(1);
    expect(runs[0].repo).toBe("demo");
    expect(runs[0].status).toBe("running");
    expect(runs[0].spawned_by).toBe("test");
  });

  test("run-status closes the run; snapshot returns the full document", () => {
    const root = freshRoot();
    const start = runState(["run-start", "--repo", "demo", "--work-type", "fix", "--pipeline", "default"], { RT_RUNS_ROOT: root, RT_RUN_EMIT: "0" });
    const env = { RT_RUN_DB: start.out.runDb, RT_RUN_EMIT: "0" };
    expect(runState(["run-status", "--status", "done"], env).out.ok).toBe(true);
    const snap = runState(["snapshot"], env);
    expect(snap.out.ok).toBe(true);
    expect(snap.out.run.status).toBe("done");
    expect(snap.out.run.ended_at).toBeGreaterThan(0);
    expect(snap.out.stages).toEqual([]);
    expect(snap.out.fields).toEqual([]);
    expect(snap.out.decisions).toEqual([]);
  });

  test("subcommands without RT_RUN_DB fail with a JSON error, exit 2", () => {
    const r = runState(["run-status", "--status", "done"], { RT_RUN_EMIT: "0" });
    expect(r.code).toBe(2);
    expect(r.out.ok).toBe(false);
  });
});

describe("stages, fields, decisions", () => {
  function started(): { env: Record<string, string> } {
    const root = freshRoot();
    const r = runState(["run-start", "--repo", "demo", "--work-type", "feature", "--pipeline", "default"], { RT_RUNS_ROOT: root, RT_RUN_EMIT: "0" });
    return { env: { RT_RUN_DB: r.out.runDb, RT_RUN_EMIT: "0" } };
  }

  test("stage lifecycle updates current_stage and bumps attempt on re-entry", () => {
    const { env } = started();
    expect(runState(["stage-start", "--stage", "plan"], env).out.ok).toBe(true);
    expect(runState(["stage-done", "--stage", "plan"], env).out.ok).toBe(true);
    expect(runState(["stage-start", "--stage", "plan"], env).out.ok).toBe(true);
    const snap = runState(["snapshot"], env).out;
    expect(snap.run.current_stage).toBe("plan");
    expect(snap.stages.map((s: any) => [s.attempt, s.status])).toEqual([[1, "done"], [2, "running"]]);
  });

  test("field set/get round-trips values with single quotes; missing key exits 3", () => {
    const { env } = started();
    expect(runState(["field", "set", "mr-url", "https://x/1?a='b'", "--stage", "ship"], env).out.ok).toBe(true);
    const got = runState(["field", "get", "mr-url"], env);
    expect(got.raw).toBe("https://x/1?a='b'");
    expect(runState(["field", "get", "nope"], env).code).toBe(3);
  });

  test("decision record upserts on (contract, scope)", () => {
    const { env } = started();
    const rec = (sel: string) => runState(["decision", "record", "--contract", "execution-strategy@1", "--scope", "run", "--selection", sel, "--decided-by", "stage-plan"], env);
    expect(rec('{"tier":"direct-tdd"}').out.ok).toBe(true);
    expect(rec('{"tier":"superpowers"}').out.ok).toBe(true);
    const snap = runState(["snapshot"], env).out;
    expect(snap.decisions).toHaveLength(1);
    expect(JSON.parse(snap.decisions[0].selection).tier).toBe("superpowers");
  });
});

describe("genesis: ticket field", () => {
  test("field set ticket ... --stage work lands with the right value and producer", () => {
    const { env, dbPath } = startRun();
    expect(runState(["field", "set", "ticket", "ACME-1234", "--stage", "work"], env).out.ok).toBe(true);
    expect(runState(["field", "get", "ticket"], env).raw).toBe("ACME-1234");
    expect(sqlite(dbPath, "SELECT produced_by FROM fields WHERE key='ticket';")).toBe("work");
  });
});

describe("event emission", () => {
  function fakeRt(dir: string): string {
    // The fake appends its argv to rt-calls.log so the test can assert on it.
    const bin = join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "rt"), `#!/bin/sh\necho "$@" >> "${dir}/rt-calls.log"\n`, { mode: 0o755 });
    return bin;
  }

  /**
   * Polls the detached emitter's log until it contains `needle`, rather than
   * sleeping a fixed interval and reading once. The emission is a detached
   * subshell, so on a loaded machine the write lands after any fixed wait would
   * -- the original `Bun.sleep(300)` failed exactly that way under CI. Returns
   * the log so callers assert on the full contents; on timeout it returns the
   * last read so the assertion reports what actually landed.
   */
  async function waitForLog(path: string, needle: string, timeoutMs = 5_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const log = existsSync(path) ? readFileSync(path, "utf8") : "";
      if (log.includes(needle)) return log;
      if (Date.now() >= deadline) return log;
      await Bun.sleep(20);
    }
  }

  test("writes emit run-updated through rt, detached", async () => {
    const root = freshRoot();
    const bin = fakeRt(root);
    const env = { RT_RUNS_ROOT: root, PATH: `${bin}:${process.env.PATH}` };
    const r = runState(["run-start", "--repo", "demo", "--work-type", "feature", "--pipeline", "default"], env);
    runState(["stage-start", "--stage", "plan"], { ...env, RT_RUN_DB: r.out.runDb });
    const log = await waitForLog(join(root, "rt-calls.log"), "events emit run-updated");
    expect(log).toContain("events emit run-updated");
    expect(log).toContain('"kind":"stage-start"');
    expect(log).toContain('"runId":"' + r.out.runId + '"');
  });

  test("no rt on PATH: writes still succeed, no log appears", () => {
    const root = freshRoot();
    const env = { RT_RUNS_ROOT: root, PATH: "/usr/bin:/bin" };
    const r = runState(["run-start", "--repo", "demo", "--work-type", "feature", "--pipeline", "default"], env);
    expect(r.out.ok).toBe(true);
    expect(existsSync(join(root, "rt-calls.log"))).toBe(false);
  });

  function slowFakeRt(dir: string): string {
    const bin = join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "rt"), `#!/bin/sh\nsleep 3\necho "$@" >> "${dir}/rt-calls.log"\n`, { mode: 0o755 });
    return bin;
  }

  test("a slow rt does not block the caller: spawnSync returns long before the emitter's sleep completes", () => {
    const root = freshRoot();
    const bin = slowFakeRt(root);
    const env = { RT_RUNS_ROOT: root, PATH: `${bin}:${process.env.PATH}` };
    const start = Date.now();
    const r = runState(["run-start", "--repo", "demo", "--work-type", "feature", "--pipeline", "default"], env);
    const elapsedMs = Date.now() - start;
    expect(r.out.ok).toBe(true);
    expect(elapsedMs).toBeLessThan(1500);
  });
});

describe("schema v2: failure reasons and pack provenance", () => {
  test("schema v2: a fresh run DB carries the new columns", () => {
    const { dbPath } = startRun();
    expect(sqlite(dbPath, "PRAGMA user_version;")).toBe("2");
    const stageCols = sqlite(dbPath, "SELECT name FROM pragma_table_info('stages');").split("\n");
    expect(stageCols).toContain("reason");
    expect(stageCols).toContain("detail_path");
    const runCols = sqlite(dbPath, "SELECT name FROM pragma_table_info('runs');").split("\n");
    expect(runCols).toContain("pack_commits");
    expect(runCols).toContain("pack_dirty");
  });

  test("stage-fail records reason and detail path", () => {
    const { env, dbPath } = startRun();
    expect(runState(["stage-start", "--stage", "gates"], env).out.ok).toBe(true);
    expect(runState(["stage-fail", "--stage", "gates", "--reason", "ui-islands assertion failed", "--detail-path", "/tmp/gates.log"], env).out.ok).toBe(true);
    expect(sqlite(dbPath, "SELECT reason FROM stages WHERE name='gates';")).toBe("ui-islands assertion failed");
    expect(sqlite(dbPath, "SELECT detail_path FROM stages WHERE name='gates';")).toBe("/tmp/gates.log");
  });

  test("a reason containing a quote is escaped, not injected", () => {
    const { env, dbPath } = startRun();
    runState(["stage-start", "--stage", "gates"], env);
    expect(runState(["stage-fail", "--stage", "gates", "--reason", "expected '/c/1' got '/x'"], env).out.ok).toBe(true);
    expect(sqlite(dbPath, "SELECT reason FROM stages WHERE name='gates';")).toBe("expected '/c/1' got '/x'");
  });

  test("stage-fail without a reason still works and stores NULL", () => {
    const { env, dbPath } = startRun();
    runState(["stage-start", "--stage", "gates"], env);
    expect(runState(["stage-fail", "--stage", "gates"], env).out.ok).toBe(true);
    expect(sqlite(dbPath, "SELECT COUNT(*) FROM stages WHERE name='gates' AND reason IS NULL;")).toBe("1");
  });

  test("a v1 DB is migrated in place on the next helper call", () => {
    const { env, dbPath } = startRun();
    // Rewind to v1 exactly as a pre-migration DB looks.
    Bun.spawnSync(["sqlite3", dbPath,
      "ALTER TABLE stages DROP COLUMN reason; ALTER TABLE stages DROP COLUMN detail_path; PRAGMA user_version=1;"]);
    expect(sqlite(dbPath, "PRAGMA user_version;")).toBe("1");

    expect(runState(["stage-start", "--stage", "plan"], env).out.ok).toBe(true);

    expect(sqlite(dbPath, "PRAGMA user_version;")).toBe("2");
    expect(sqlite(dbPath, "SELECT name FROM pragma_table_info('stages');").split("\n")).toContain("reason");
  });

  test("run-start onto an existing v1 directory migrates it and refuses the duplicate id", () => {
    // --run-id can point at a directory that already holds a v1 DB. Schema
    // statements must run, then the migration, and only then the INSERT — so a
    // refused duplicate cannot leave a DB stamped v2 with v1 columns.
    const { dbPath, root } = startRun(["--run-id", "fixed-id"]);
    Bun.spawnSync(["sqlite3", dbPath,
      "ALTER TABLE stages DROP COLUMN reason; ALTER TABLE stages DROP COLUMN detail_path; PRAGMA user_version=1;"]);

    const second = runState(
      ["run-start", "--repo", "demo", "--work-type", "fix", "--pipeline", "default", "--run-id", "fixed-id"],
      { RT_RUNS_ROOT: root, RT_RUN_EMIT: "0" });

    // The duplicate is refused, loudly.
    expect(second.out.ok).toBe(false);
    expect(String(second.out.error)).toContain("fixed-id");

    // And the DB it touched is coherent: v2 stamp AND v2 columns, never one without the other.
    expect(sqlite(dbPath, "PRAGMA user_version;")).toBe("2");
    expect(sqlite(dbPath, "SELECT name FROM pragma_table_info('stages');").split("\n")).toContain("reason");
  });
});

describe("pack provenance capture", () => {
  function makeGitRepo(name: string): string {
    const dir = join(freshRoot(), name);
    mkdirSync(dir, { recursive: true });
    Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
    writeFileSync(join(dir, "f.txt"), "one");
    Bun.spawnSync(["git", "add", "."], { cwd: dir });
    Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: dir });
    return dir;
  }
  function headOf(dir: string): string {
    return new TextDecoder().decode(Bun.spawnSync(["git", "-C", dir, "rev-parse", "--short", "HEAD"]).stdout).trim();
  }

  test("run-start records a commit per pack dir", () => {
    const a = makeGitRepo("mattstack");
    const b = makeGitRepo("acme");
    const { dbPath } = startRun(["--pack-dirs", `${a}:${b}`]);
    expect(sqlite(dbPath, "SELECT pack_commits FROM runs;")).toBe(`mattstack=${headOf(a)},acme=${headOf(b)}`);
    expect(sqlite(dbPath, "SELECT pack_dirty FROM runs;")).toBe("0");
  });

  test("an uncommitted change in any pack marks the run dirty", () => {
    // A dirty tree means the instructions this run followed may exist in no
    // commit at all, so a later trail must say "unprovable" rather than showing
    // the nearest commit as if it were the truth.
    const a = makeGitRepo("mattstack");
    writeFileSync(join(a, "f.txt"), "changed");
    const { dbPath } = startRun(["--pack-dirs", a]);
    expect(sqlite(dbPath, "SELECT pack_dirty FROM runs;")).toBe("1");
    expect(sqlite(dbPath, "SELECT pack_commits FROM runs;")).toContain("mattstack=");
  });

  test("a staged-but-uncommitted change in any pack marks the run dirty", () => {
    // git add without a commit is the routine state right after an agent
    // stages its work; `git diff` alone is blind to it.
    const a = makeGitRepo("mattstack");
    writeFileSync(join(a, "f.txt"), "staged-change");
    Bun.spawnSync(["git", "add", "."], { cwd: a });
    const { dbPath } = startRun(["--pack-dirs", a]);
    expect(sqlite(dbPath, "SELECT pack_dirty FROM runs;")).toBe("1");
  });

  test("an untracked file in any pack marks the run dirty", () => {
    // New source files are an expected way a pack grows; an untracked file
    // must dirty the run just like a tracked edit does.
    const a = makeGitRepo("mattstack");
    writeFileSync(join(a, "new-file.txt"), "brand new");
    const { dbPath } = startRun(["--pack-dirs", a]);
    expect(sqlite(dbPath, "SELECT pack_dirty FROM runs;")).toBe("1");
  });

  test("a non-git directory is skipped rather than recorded as unknown", () => {
    const plain = join(freshRoot(), "plain");
    mkdirSync(plain, { recursive: true });
    const { dbPath } = startRun(["--pack-dirs", plain]);
    expect(sqlite(dbPath, "SELECT COUNT(*) FROM runs WHERE pack_commits IS NULL;")).toBe("1");
  });

  test("omitting --pack-dirs leaves the columns empty and the run still starts", () => {
    const { dbPath } = startRun();
    expect(sqlite(dbPath, "SELECT COUNT(*) FROM runs WHERE pack_commits IS NULL;")).toBe("1");
    expect(sqlite(dbPath, "SELECT pack_dirty FROM runs;")).toBe("0");
  });

  test("the work verb passes pack dirs to run-start", () => {
    const skill = readFileSync(join(import.meta.dir, "../attachments/pipeline/work/SKILL.md"), "utf8");
    expect(skill).toContain("--pack-dirs");
  });
});
