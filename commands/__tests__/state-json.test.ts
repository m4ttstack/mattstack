/** rt state's JSON contracts, characterized before the output conversion. */
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as daemon from "../../lib/daemon-client.ts";
import * as ageKey from "../../lib/home/age-key.ts";
import * as state from "../../lib/state/index.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import * as orchestrator from "../../lib/state/backup-orchestrator.ts";
import * as restore from "../../lib/state/backup-restore.ts";
import { closeStateDb, getStateDb, listStateBackups, stateDbPath } from "../../lib/state/index.ts";
import { stateBackup, stateRestore } from "../state.ts";
import { stateBackupStatus } from "../state-backup-status.ts";

const origHome = process.env.HOME;
const origExitCode = process.exitCode;
let home: string;
let io: CapturedOut;
const spies: Array<{ mockRestore(): void }> = [];

beforeEach(() => {
  closeStateDb();
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-state-json-")));
  process.env.HOME = home;
  process.exitCode = 0;
  io = captureOut({ console: true });
  ui.__test__.setHuman(() => false);
  getStateDb();
});
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  io.restore();
  closeStateDb();
  process.env.HOME = origHome;
  process.exitCode = origExitCode;
  rmSync(home, { recursive: true, force: true });
});

function expectJson(value: unknown, exitCode = 0) {
  expect(io.stdout()).toBe(`${JSON.stringify(value)}\n`);
  expect(io.stderr()).toBe("");
  expect(process.exitCode).toBe(exitCode);
}
function configured() {
  spies.push(spyOn(orchestrator, "isBackupConfigured").mockReturnValue(true));
}
function identity() {
  const key = join(home, "team-key.txt");
  writeFileSync(key, "AGE-SECRET-KEY-1SAMPLE\n");
  return key;
}

test("local backup pins ok, path and the pruned array", async () => {
  await stateBackup(["--local", "--json"]);
  const path = JSON.parse(io.stdout()).path;
  expect(path.startsWith(home)).toBe(true);
  expect(existsSync(path)).toBe(true);
  expectJson({ ok: true, path, pruned: [] });
});

test("full backup pins the result and a numeric prune count", async () => {
  configured();
  const result = { backed: [{ app: "rt", path: "/b/rt.age", sizeBytes: 2048, contentHash: "abc" }], skipped: ["chat"], errors: ["board: disk full"] };
  spies.push(spyOn(orchestrator, "runFullBackup").mockResolvedValue(result));
  spies.push(spyOn(orchestrator, "pruneOldBackups").mockResolvedValue({ removed: ["old.age"] } as never));
  await stateBackup(["--json"]);
  expectJson({ ...result, pruned: 1 });
});

test("skipped sources with errors still use the full backup envelope", async () => {
  configured();
  const result = { backed: [], skipped: ["rt"], errors: ["board: disk full"] };
  spies.push(spyOn(orchestrator, "runFullBackup").mockResolvedValue(result));
  spies.push(spyOn(orchestrator, "pruneOldBackups").mockResolvedValue({ removed: [] } as never));
  await stateBackup(["--json"]);
  expectJson({ ...result, pruned: 0 });
});

test("all sources failed pins the local fallback and errors array", async () => {
  configured();
  spies.push(spyOn(orchestrator, "runFullBackup").mockResolvedValue({ backed: [], skipped: [], errors: ["rt: disk full"] }));
  await stateBackup(["--json"]);
  const path = JSON.parse(io.stdout()).path;
  expect(existsSync(path)).toBe(true);
  expectJson({ ok: true, fallback: "local", path, pruned: [], errors: ["rt: disk full"] });
});

test("a thrown encrypted backup pins the local fallback and error string", async () => {
  configured();
  spies.push(spyOn(orchestrator, "runFullBackup").mockRejectedValue(new Error("age exploded")));
  await stateBackup(["--json"]);
  const path = JSON.parse(io.stdout()).path;
  expect(existsSync(path)).toBe(true);
  expectJson({ ok: true, fallback: "local", path, pruned: [], error: "Error: age exploded" });
});

test("local restore pins ok, restored and from", async () => {
  await stateBackup(["--local", "--json"]);
  const source = JSON.parse(io.stdout()).path;
  io.clear();
  expect(listStateBackups()).toContain(source.split("/").at(-1)!);
  await stateRestore([source, "--force", "--json"]);
  expectJson({ ok: true, restored: stateDbPath(), from: source });
});

for (const errors of [[], ["rt: damaged copy"]]) {
  test(`encrypted dry-run restore pins result and exit code with ${errors.length} errors`, async () => {
    const result = { restored: [{ app: "rt", targetPath: "/t/state.db" }], skipped: ["chat"], errors };
    spies.push(spyOn(restore, "restoreFromBackup").mockResolvedValue(result));
    await stateRestore(["--from-backup", "--identity", identity(), "--dry-run", "--force", "--json"]);
    expectJson({ ok: errors.length === 0, dryRun: true, ...result }, errors.length ? 1 : 0);
    process.exitCode = 0;
  });
  test(`encrypted restore pins result and exit code with ${errors.length} errors`, async () => {
    const result = { restored: [{ app: "rt", targetPath: "/t/state.db" }], skipped: [], errors };
    const pull = spyOn(restore, "pullHomeRepo").mockResolvedValue({ pullOk: true, lfsOk: true });
    spies.push(pull, spyOn(restore, "restoreFromBackup").mockResolvedValue(result));
    await stateRestore(["--from-backup", "--identity", identity(), "--force", "--json"]);
    expect(pull).toHaveBeenCalledTimes(1);
    expect(io.stdout()).toBe(`${JSON.stringify({ ok: errors.length === 0, dryRun: false, ...result })}\n`);
    expect(io.stderr()).toBe("");
    expect(process.exitCode).toBe(errors.length ? 1 : 0);
    process.exitCode = 0;
  });
}

test("state backup status --json with nothing set up is {configured:false} (Matt's ruling)", async () => {
  await stateBackupStatus(["--json"], {});
  expect(io.stdout()).toBe('{"configured":false}\n');
  expect(io.stderr()).toBe("");
  expect(process.exitCode).toBe(0);
});

test("configured status pins all reachable app fields and ordering", async () => {
  const base = join(home, ".mattstack", "user", "state-backups");
  mkdirSync(join(base, "rt"), { recursive: true });
  mkdirSync(join(base, "board"));
  writeFileSync(join(base, "recipients.txt"), "# team\nage1key1\n\nage1key2\n");
  writeFileSync(join(base, "rt", "2026-10-01.zst.age"), "old");
  writeFileSync(join(base, "rt", "2026-10-02.zst.age"), "newer");
  writeFileSync(join(base, "rt", "ignored.txt"), "ignored");
  await stateBackupStatus(["--json"], {});
  expectJson({ configured: true, recipients: 2, apps: [
    { app: "rt", lastBackup: "2026-10-02.zst.age", count: 2, totalBytes: 8 },
    { app: "board", lastBackup: null, count: 0, totalBytes: 0 },
    { app: "gitq", lastBackup: null, count: 0, totalBytes: 0 },
  ] });
});

async function expectExit(run: () => Promise<void>, stderr: string) {
  const sentinel = new Error("captured process.exit");
  const exit = spyOn(process, "exit").mockImplementation(() => { throw sentinel; });
  spies.push(exit);
  await expect(run()).rejects.toBe(sentinel);
  expect(exit).toHaveBeenCalledWith(1);
  expect(io.stdout()).toBe("");
  expect(io.stderr()).toBe(stderr);
}

test("unconfigured backup has no JSON payload and exits 1", async () => {
  await expectExit(() => stateBackup(["--json"]),
    "Encrypted backup is not set up on this Mac\n  next: rt state backup init\n  tip: For a copy on this Mac only: rt state backup --local\n");
});

test("restore without a copy has no JSON payload and exits 1", async () => {
  await expectExit(() => stateRestore(["--force", "--json"]),
    "Which backup?\n  next: rt state restore <copy>\n");
});

test("restore of a missing copy has no JSON payload and exits 1", async () => {
  await expectExit(() => stateRestore(["missing.db", "--force", "--json"]),
    "There is no backup called missing.db\n  next: rt state restore\n");
});

test("local restore while daemon runs has no JSON payload and exits 1", async () => {
  spies.push(spyOn(daemon, "isDaemonRunning").mockResolvedValue(true));
  await expectExit(() => stateRestore(["copy.db", "--json"]),
    "[refused] rt will not restore while the daemon is running  it shares this data with rt\n  next: rt daemon stop\n  note: To restore anyway: rt state restore copy.db --force\n");
});

for (const name of ["My backup.db", "Matt's.db", "$HOME.db", "$(printf harmless).db", "copy;printf harmless.db"]) {
  test(`forced restore remedy preserves literal copy ${name} as one shell argument`, async () => {
    spies.push(spyOn(daemon, "isDaemonRunning").mockResolvedValue(true));
    const copy = join(home, name);
    const sentinel = new Error("captured process.exit");
    const exit = spyOn(process, "exit").mockImplementation(() => { throw sentinel; });
    spies.push(exit);
    await expect(stateRestore([copy, "--json"])).rejects.toBe(sentinel);
    expect(exit).toHaveBeenCalledWith(1);
    expect(io.stdout()).toBe("");
    const command = io.stderr().split("To restore anyway: ")[1]?.trim();
    expect(command).toBeDefined();
    const shell = Bun.spawnSync(["/bin/sh", "-c", `rt() { printf '%s\\0' "$@"; }; ${command}`], {
      cwd: home, env: { HOME: home, PATH: "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe",
    });
    expect(shell.exitCode).toBe(0);
    expect(shell.stderr.toString()).toBe("");
    expect(shell.stdout.toString().split("\0")).toEqual(["state", "restore", copy, "--force", ""]);
  });
}

test("daemon refusal keeps the instructional copy placeholder unquoted", async () => {
  spies.push(spyOn(daemon, "isDaemonRunning").mockResolvedValue(true));
  await expectExit(() => stateRestore(["--json"]),
    "[refused] rt will not restore while the daemon is running  it shares this data with rt\n  next: rt daemon stop\n  note: To restore anyway: rt state restore <copy> --force\n");
});

test("encrypted restore while daemon runs has no JSON payload and exits 1", async () => {
  spies.push(spyOn(daemon, "isDaemonRunning").mockResolvedValue(true));
  await expectExit(() => stateRestore(["--from-backup", "--json"]),
    "[refused] rt will not restore while the daemon is running  it shares this data with rt\n  next: rt daemon stop\n  note: To restore anyway: rt state restore --from-backup --force\n");
});

test("encrypted restore without a key has no JSON payload and exits 1", async () => {
  spies.push(spyOn(ageKey, "createRealAgeKeySeam").mockReturnValue({} as never));
  spies.push(spyOn(ageKey, "readAgeKey").mockResolvedValue({ kind: "missing" } as never));
  await expectExit(() => stateRestore(["--from-backup", "--force", "--json"]),
    "This Mac has no key to decrypt your backups\n  why: On a new Mac, use the team key file.\n  next: rt state restore --from-backup --identity <key file>\n");
});

test("local restore failing integrity has no JSON payload and exits 1", async () => {
  await stateBackup(["--local", "--json"]);
  const source = JSON.parse(io.stdout()).path;
  io.clear();
  spies.push(spyOn(state, "quickCheck").mockReturnValue(["damaged"]));
  await expectExit(() => stateRestore([source, "--force", "--json"]),
    `That backup is damaged\n  why: damaged\n  ${source}\n`);
});

test("full backup shows source sizes, pruning and partial errors", async () => {
  configured();
  spies.push(spyOn(orchestrator, "runFullBackup").mockResolvedValue({ backed: [
    { app: "rt", path: "/b/rt.age", sizeBytes: 2048, contentHash: "abc" },
    { app: "board", path: "/b/board.age", sizeBytes: 1572864, contentHash: "def" },
  ], skipped: [], errors: ["chat: disk full"] }));
  spies.push(spyOn(orchestrator, "pruneOldBackups").mockResolvedValue({ removed: ["old.age"] } as never));
  await stateBackup([]);
  expect(io.stdout()).toContain("[ok] Backed up rt's state  2 sources\n");
  expect(io.stdout()).toContain("rt");
  expect(io.stdout()).toContain("2 KB");
  expect(io.stdout()).toContain("1.5 MB");
  expect(io.stdout()).toContain("[ok] Removed 1 older backup\n");
  expect(io.stderr()).toBe("[warning] Some sources were not backed up\n  chat: disk full\n");
});

for (const thrown of [false, true]) {
  test(`human local fallback confirms the copy after ${thrown ? "a thrown failure" : "all sources fail"}`, async () => {
    configured();
    const run = spyOn(orchestrator, "runFullBackup");
    spies.push(run);
    if (thrown) run.mockRejectedValue(new Error("age exploded\nraw details"));
    else run.mockResolvedValue({ backed: [], skipped: [], errors: ["rt: disk full"] });
    await stateBackup([]);
    expect(io.stdout()).toContain("[ok] Saved a local copy of rt's state");
    expect(listStateBackups()).toHaveLength(1);
    expect(io.stderr()).toContain("[warning] The encrypted backup failed, so rt saved a local copy instead");
    expect(io.stderr()).toContain(thrown ? "age exploded" : "rt: disk full");
    if (thrown) expect(io.stderr()).not.toContain("raw details");
  });
}

for (const dryRun of [false, true]) {
  test(`human encrypted restore shows ${dryRun ? "proposed" : "restored"} rows, skips and errors`, async () => {
    spies.push(spyOn(restore, "pullHomeRepo").mockResolvedValue({ pullOk: true, lfsOk: true }));
    spies.push(spyOn(restore, "restoreFromBackup").mockResolvedValue({ restored: [{ app: "rt", targetPath: "/t/state.db" }], skipped: ["chat: no backup"], errors: ["board: damaged", "console: busy"] }));
    await stateRestore(["--from-backup", "--identity", identity(), "--force", ...(dryRun ? ["--dry-run"] : [])]);
    expect(io.stdout()).toContain(dryRun ? "Would restore\n" : "Restored\n");
    expect(io.stdout()).toContain("/t/state.db");
    expect(io.stdout()).toContain("[skipped] chat: no backup\n");
    expect(io.stderr()).toBe("Some backups were not restored\n  board: damaged\n  console: busy\n");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
}
