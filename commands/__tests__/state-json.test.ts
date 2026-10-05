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
  test(`encrypted restore pins its pull notice, result and exit code with ${errors.length} errors`, async () => {
    const result = { restored: [{ app: "rt", targetPath: "/t/state.db" }], skipped: [], errors };
    const pull = spyOn(restore, "pullHomeRepo").mockResolvedValue(undefined);
    spies.push(pull, spyOn(restore, "restoreFromBackup").mockResolvedValue(result));
    await stateRestore(["--from-backup", "--identity", identity(), "--force", "--json"]);
    expect(pull).toHaveBeenCalledTimes(1);
    expect(io.stdout()).toBe(`Pulling latest backups from home repo...\n${JSON.stringify({ ok: errors.length === 0, dryRun: false, ...result })}\n`);
    expect(io.stderr()).toBe("");
    expect(process.exitCode).toBe(errors.length ? 1 : 0);
    process.exitCode = 0;
  });
}

test("unconfigured status pins today's sentence", async () => {
  await stateBackupStatus(["--json"], {});
  expect(io.stdout()).toBe("State backup is not configured. Run `rt state backup init` to set up.\n");
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
    "Backup not configured. Run `rt state backup init` to set up encrypted backup.\nUse --local for a local-only unencrypted backup.\n");
});

test("restore without a copy has no JSON payload and exits 1", async () => {
  await expectExit(() => stateRestore(["--force", "--json"]),
    "rt state: usage: rt state restore <copy> [--json]\n");
});

test("restore of a missing copy has no JSON payload and exits 1", async () => {
  await expectExit(() => stateRestore(["missing.db", "--force", "--json"]),
    "rt state: backup not found: missing.db\n");
});

test("local restore while daemon runs has no JSON payload and exits 1", async () => {
  spies.push(spyOn(daemon, "isDaemonRunning").mockResolvedValue(true));
  await expectExit(() => stateRestore(["copy.db", "--json"]),
    "rt state: the daemon is running; state.db is shared with it. Stop it first (rt daemon stop) or pass --force to override\n");
});

test("encrypted restore while daemon runs has no JSON payload and exits 1", async () => {
  spies.push(spyOn(daemon, "isDaemonRunning").mockResolvedValue(true));
  await expectExit(() => stateRestore(["--from-backup", "--json"]),
    "rt state: the daemon appears to be running (or its socket exists). Stop it first (rt daemon stop) or pass --force to override\n");
});

test("encrypted restore without a key has no JSON payload and exits 1", async () => {
  spies.push(spyOn(ageKey, "createRealAgeKeySeam").mockReturnValue({} as never));
  spies.push(spyOn(ageKey, "readAgeKey").mockResolvedValue({ kind: "missing" } as never));
  await expectExit(() => stateRestore(["--from-backup", "--force", "--json"]),
    "rt state restore: no age key found in the keychain.\nOn a new machine, pass --identity <path-to-team-key> to decrypt with the team key.\n");
});

test("local restore failing integrity has no JSON payload and exits 1", async () => {
  await stateBackup(["--local", "--json"]);
  const source = JSON.parse(io.stdout()).path;
  io.clear();
  spies.push(spyOn(state, "quickCheck").mockReturnValue(["damaged"]));
  await expectExit(() => stateRestore([source, "--force", "--json"]),
    `rt state: ${source} fails integrity check: damaged\n`);
});
