# rt Output Layer, Phase 6e (state verbs and state warnings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt state backup`, `rt state restore`, `rt state backup init` and `rt state backup status` print through the output layer, with their `--json` and exit codes unchanged; `rt state backup init` shows its stages as steps; and every raw warning under `lib/state/`, `lib/run-history.ts` and `lib/secrets/store.ts` goes through `warn` (or `logCliEvent`) as 5a's warnings table and the scoping document's rows 46 to 49 decide. Twelve allowlist lines go.

**Architecture:** Verbs print blocks built in place (they are short); `state backup init` runs its six stages under the step runner (`createStepRunner` in `lib/ui/steps.ts`), so a person sees each stage settle and a failure keeps its line. Lib warnings call `warn(module, message, { show? })` from `lib/ui/warn.ts`, which logs every warning and shows only the rows marked Show, once per process; the daemon, which sets no warning log, still gets the plain `rt: <message>` stderr line its capture files.

**Tech Stack:** Bun + TypeScript, `bun:test` with a temp HOME, Fast Browser.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (RT-369), phase 6 (`state`, `state backup`), "Rules", "Steps". **Scoping:** `docs/superpowers/plans/2026-10-02-rt-output-layer-phase-6-scoping.md`, 6e and warnings rows 46 to 49. **5a's warnings table:** `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5a-layer-additions.md`, rows 1 to 5 and 24 to 38. House style: the 5f2 chat plan.

**Size:** about 1,600 changed lines. One PR.

**What was run while writing this plan:** nothing was compiled. Written against `origin/main` at `658e704b9`.

## Global Constraints

- Never use em dashes or en dashes anywhere. Several lib warnings hold one today; the new log messages carry none.
- Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show.
- `--json` keeps its shape, byte for byte: `state backup --json` (all four shapes: `--local`, the full backup, the two local fallbacks), `state restore --json`, `state restore --from-backup --json`, `state backup status --json`. One shape changes, by Matt's ruling (scoping, Ruling 3, 2026-10-02): `state backup status --json` on a Mac with no backup set up printed a plain sentence, not JSON; it now prints `{"configured":false}`. Nothing reads it (Readers below). Task 3 pins today's output first, and Task 6 makes the ruled change against that pin.
- Exit codes do not change (`state backup` with no backup set up exits 1; a restore with errors sets exit code 1; every `fail` exits 1).
- Human text on stdout; failures on stderr through `out.fail`; a refusal by policy (restore while the daemon runs) is a `refused` note.
- Copy to "you" and "this Mac", plainly; no paths, store names (`state.db`, `recipients.txt`, `.gitattributes`) or flags in sentences; commands in a `next` callout. A path may sit in a hint or a `kv` value where it is the thing the person asked about (the restored copy).
- Run `bun test` only from the repo root. Never run a built `rt` outside an isolated HOME. No test touches the real keychain, home repo or state db: the preload's temp HOME and the existing seams only.
- Git commands plain and alone from the worktree root. Never `git add -A`, `.` or `-u`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Files this slice must not edit: every file another phase 6 slice owns (`lib/state/presence-store.ts` is 6j's); `lib/ui/**`; `lib/state/backup-pipeline.ts`, `backup-sources.ts`, `backup-tools.ts`, `backup-lfs.ts`, `busy.ts`, `index.ts`; `lib/home/**`; `rt-tray/**`.
- `lib/state/*` loads in the daemon: `lib/ui/warn.ts` is daemon-safe (5a); every task that edits a `lib/state` file runs `lib/state/__tests__/barrel.test.ts`, `lib/__tests__/no-eager-tui.test.ts` and `lib/__tests__/no-daemon-sync-exec.test.ts`.
- UI validation is mandatory (Task 8).

## Review Focus

1. **A damaged state db at startup.** 5a row 33: the person sees once that rt's saved state was reset, with the damaged copy kept; the log has the paths. A second open in the same process does not show it again. Pinned in Task 6 (`a quarantined db is shown once and logged with both paths`).
2. **The daemon hitting a migration warning.** It sets no warning log, so the line must still reach its stderr capture as `rt: <message>`, never a styled block. Pinned in Task 6 (`with no warning log set, a state warning is the plain stderr line`).
3. **`rt state restore` while the daemon runs.** rt declines (the db is shared); it reads `refused` with `rt daemon stop` as the next step, still exits 1, and under `--json` stdout stays empty. Pinned in Task 4 (`restore while the daemon runs is a refusal with the stop command`).
4. **`rt state backup init` failing at the decrypt check.** The failed stage keeps its line and the failure says what to do; earlier stages show done. Pinned in Task 5 (`init stops at the stage that failed and says so`).
5. **A secrets command under `CLI_DEBUG`.** The trace goes to the CLI log at `debug` and never to the screen, and never carries a value (scoping row 49). Pinned in Task 7 (`a secrets debug trace is logged, not printed`).

## Readers

| Reader | Reads | After |
|---|---|---|
| `rt-tray/vm/run/guest/assert-installed.sh:239-242` | `rt state backup init` exit code; the last three log lines on failure, shown to a person | exit code unchanged; the tail reads the new plain lines |
| the daemon's backup sweep (`lib/daemon/*`) | calls `runFullBackup` and `pruneOldBackups` in `lib/state/backup-orchestrator.ts`, not the verb | row 46 is log only; the daemon's stderr capture keeps the line |
| `commands/__tests__/state-backup*.test.ts`, `state-restore-from-backup.test.ts` | the verbs' text and JSON | moved onto the capture; human expectations updated |
| `lib/state/__tests__/*.test.ts`, `lib/__tests__/run-history.test.ts` | spy `console.warn` | read `setWarningLog` instead |
| `rt state backup status --json` | nothing: the verb is not agent-safe, and no skill, plugin, MCP tool, tray model, VM script or e2e test runs it (searched `skills/`, `plugins/`, `apps/`, `marketplace/`, `rt-tray/`, `lib/mcp/`, `scripts/`, `e2e/`); its one test reads the human path | the not-set-up case becomes `{"configured":false}` (Matt's Ruling 3); the set-up envelope is unchanged |

## Copy table

### `rt state backup`, `rt state restore`

| Today | After |
|---|---|
| `rt state backup: wrote <path>` (`--local`) | print `line("done", "Saved a local copy of rt's state", <file name>)` |
| `rt state backup: pruned <n> old backup(s)` | `line("done", "Removed <n> older copy" / "copies")` |
| `Backup not configured. Run \`rt state backup init\`...` + `Use --local ...` (stderr, exit 1) | fail `{ title: "Encrypted backup is not set up on this Mac", next: cmd("rt state backup init") }`, then `out.note(out.callout("tip", ["For a copy on this Mac only: ", cmd("rt state backup --local")]))`, exit 1 |
| `All sources failed: <errors>` + `Falling back to local-only backup` | note `line("warn", "The encrypted backup failed, so rt saved a local copy instead")`, `verbatim(<errors>, "what failed")`; then the `--local` lines |
| `  <app>: <n> bytes` per source | print `table` of `[strong(app), "<size>"]` under `line("done", "Backed up rt's state", "<n> source(s)")`; size in KB or MB (`formatBytes` below) |
| `Errors: <errors>` (stderr) | note `line("warn", "Some sources were not backed up")`, `verbatim(<errors>)` |
| `Pruned <n> old backup(s)` | `line("done", "Removed <n> older backup(s)")` |
| `Encrypted backup failed: <err>` + fallback | note `line("warn", "The encrypted backup failed, so rt saved a local copy instead", <first line of err>)` |
| restore `rt state: the daemon appears to be running ... --force to override` / `the daemon is running; state.db is shared ...` (exit 1) | note `line("refused", "rt will not restore while the daemon is running", "it shares this data with rt")`, `callout("next", cmd("rt daemon stop"))`, `callout("note", "--force restores anyway.")`, exit 1 |
| `rt state restore: no age key found in the keychain.` + `On a new machine, pass --identity ...` | fail `{ title: "This Mac has no key to decrypt your backups", why: "On a new Mac, use the team key file.", next: cmd("rt state restore --from-backup --identity <key file>") }`, exit 1 |
| `Pulling latest backups from home repo...` | the pull runs under `withTransientStep("Pulling your latest backups", ...)` |
| `Dry run. Would restore:` + `  <app> -> <path>` | `section("Would restore", undefined, table([strong(app), dim(path)]))` |
| `  <app> -> <path>` | `section("Restored", undefined, table(...))` |
| `  skipped: <s>` | `line("skipped", <s>)` |
| `  error: <e>` (stderr) | fail `{ title: "Some backups were not restored", details: <errors joined> }` after the rest (exit code 1 as today) |
| `rt state: usage: rt state restore <copy> [--json]` | fail `usageFailure("Which backup?", "rt state restore <copy>")` |
| `rt state: backup not found: <copy>` | fail `{ title: "There is no backup called <copy>", next: cmd("rt state restore") }` |
| `rt state: <source> fails integrity check: <problems>` | fail `{ title: "That backup is damaged", why: <problems joined>, details: <source> }` |
| `rt state restore: restored state.db from <source>` | print `line("done", "Restored rt's state", <file name of source>)` |

`formatBytes(n)`: under 1 MB, `<n/1024 rounded> KB`; otherwise one decimal `MB`.

### `rt state backup init` (steps)

| Stage (pending, then done) | Today's lines it replaces | Failure |
|---|---|---|
| "Checking the backup tools" / "age, zstd and git-lfs are here" | `Dependencies: age, zstd, git-lfs found` | `<names> not found` + brew line: fail `{ title: "rt cannot find <names>", why: "They ship inside mattstack.app.", next: cmd("brew install <names>") }` |
| (no stage) | home repo missing: `Home repo not found at <path>` + `Run \`rt home init\` first` | fail `{ title: "Your home repo is not set up yet", next: cmd("rt home init") }` before any stage |
| "Setting up Git LFS in your home repo" / "Git LFS is set up" | `LFS filter paths set to: <path>`, `Added LFS tracking for *.age to .gitattributes` (folded into the done hint: "now tracks encrypted backups") | `git lfs install failed: <stderr>`: the stage fails, then fail `{ title: "Git LFS did not install in your home repo", details: <stderr> }` |
| "Adding this Mac's key" / "This Mac can decrypt your backups" | `Created recipients.txt ...` / `Added personal age key ...` | |
| "Backing up for the first time" / "Backed up <n> source(s)" | `Running initial backup...` and the size lines (the sizes become the done hint) | `Errors: <errors>`: the stage fails, then fail `{ title: "The first backup did not finish", details: <errors> }`, exit 1 |
| "Checking a backup can be decrypted" / "A backup decrypts" | `Verifying decrypt round-trip...`, `Decrypt round-trip passed` | `No sources found ...; skipping round-trip verification`: the stage ends `skipped`, hint "nothing to check yet" |
| "Checking Git LFS took the backup" / "Git LFS stores the encrypted files" | `LFS filter confirmed for .age files` | `Warning: .gitattributes LFS filter not applying ...` + `Push verification deferred ...`: the stage ends `warn`, then `callout("next", cmd("rt state backup status"))` |
| closing | `State backup initialized. The daemon will back up every 4 hours.` | `summary("done", "Encrypted backup is set up", ["the daemon backs up every 4 hours"])` |

### `rt state backup status`

| Today | After |
|---|---|
| `State backup is not configured. Run \`rt state backup init\` to set up.` | print `line("off", "Encrypted backup is not set up")`, `callout("next", cmd("rt state backup init"))`; under `--json`, `{"configured":false}` (Matt's Ruling 3) |
| `State backup: configured, <n> recipient(s)` + `Sweep: every 4 hours` + `Push: <x>` + `LFS: <y>` | `line("done", "Encrypted backup is set up", "<n> key(s) can decrypt it")`, then a `kv` run: `backups` `every 4 hours`, `pushed` `<push words>`, `Git LFS` `<lfs words>`; push "synced" as `up to date`, "<n> commit(s) ahead" as `<n> not pushed yet`, "no remote tracking ref" as `no remote`; LFS "filter active" as `on`, "filter not configured" as `off`, "git-lfs not found" as `not installed` |
| `  <app>: <n> backup(s), <k>K total, latest: <file>` / `  <app>: no backups` | `table` of `[strong(app), "<n> backup(s)", formatBytes(total), dim("latest <stamp>")]` or `[strong(app), dim("no backups")]` |

### Lib warnings

Every row's message is logged through `warn(module, message, { context })`; Show rows add `show`. Module names: `state` for `lib/state/*`, `run-history` for `lib/run-history.ts`.

| Row | File:line | Log message | Shown |
|---|---|---|---|
| 1 | `lib/run-history.ts:68` | `legacy run history could not be read, left in place: <err>` (context `{ path }`) | |
| 2 | `:82` | `legacy run history had no entries rt could read, left in place` | |
| 3 | `:91` | `imported legacy run history, but the write did not land; left in place to retry` | |
| 4 | `:98` | `imported legacy run history, but could not rename it: <err>` | |
| 5 | `:126` | `could not record run history for <repo>: <err>` | |
| 24 | `lib/state/legacy-import.ts:54` | `legacy state file is not valid JSON, left in place: <err>` | |
| 25 | `:88` | `imported a legacy state file, but the write did not land; left in place to retry` | |
| 26 | `:95` | `imported a legacy state file, but could not rename it: <err>` | |
| 27 | `lib/state/identity-migrate.ts:56` | `could not re-key <ns>/<key> to an identity; left in place` | |
| 28 | `:61` | `<ns>/<identity> already exists; legacy <key> left in place` | |
| 29 | `:67` | `<ns>/<identity> did not persist; legacy <key> left in place` | |
| 30 | `:100` | `could not re-key <table>.<col>=<k> to an identity; left in place` | |
| 31 | `:114` | `<table>.<col>=<k> (rowid <id>) collided with an existing <identity> row; dropped the stale legacy duplicate` | |
| 32 | `:125` | `<table>.<col> re-key to <identity> did not fully persist; <k> rows left` | |
| 33 | `lib/state/db.ts:534` | `state db could not be opened (corrupt); quarantined and recreated empty` (context `{ path, quarantinedPath }`) | title `rt's saved state was damaged and has been reset`, hint `the damaged file was kept beside it`, next `rt daemon logs` |
| 34 | `:582` | `legacy state file is not valid JSON, import skipped: <err>` | |
| 35 | `:592` | `legacy import failed, skipped (the file is still renamed): <err>` | |
| 36 | `:667` | `imported a legacy state file, but could not rename it: <err>` | |
| 37 | `lib/state/branch-cache.ts:93` | `branch_cache key <branch> collided with an existing <want> row; dropped the stale duplicate` | |
| 38 | `:99` | `branch_cache key repair <branch> to <want> did not persist; left in place` | |
| 46 | `lib/state/backup-orchestrator.ts:237` | `git lfs prune warned: <first 200 chars of stderr>` | |
| 47 | `lib/state/backup-restore.ts:159` | `git pull failed (exit <n>); restoring from local backups` | title `rt could not pull the latest backups`, hint `restoring from the copies on this Mac` |
| 48 | `:172` | `git lfs pull failed (exit <n>); restoring from local backups` | the same as row 47 (shown once: the two share a title and hint) |
| 49 | `lib/secrets/store.ts:503` | `logCliEvent("debug", "secrets", formatDebugLine(cmd, { sensitive }))` in place of `console.error`, still only under `CLI_DEBUG` | |

## File Structure

| File | Responsibility |
|---|---|
| `commands/state.ts`, `state-backup-init.ts`, `state-backup-status.ts` (modify) | the verbs on the layer |
| `commands/__tests__/state-json.test.ts` (create) | the `--json` pins |
| `commands/__tests__/state-backup.test.ts`, `state-backup-init.test.ts`, `state-backup-status.test.ts`, `state-restore-from-backup.test.ts` (modify) | the capture; new words |
| `lib/state/db.ts`, `identity-migrate.ts`, `legacy-import.ts`, `branch-cache.ts`, `backup-orchestrator.ts`, `backup-restore.ts`, `lib/run-history.ts`, `lib/secrets/store.ts` (modify) | the warnings |
| `lib/state/__tests__/db.test.ts`, `identity-migrate.test.ts`, `branch-cache.test.ts`, `legacy-import.test.ts` (if present), `lib/__tests__/run-history.test.ts`, `lib/secrets/__tests__/store*.test.ts` (modify) | `setWarningLog` in place of `console.warn` spies |
| `lib/__tests__/raw-output-allowlist.json` (modify) | twelve lines |

---

### Task 1: Confirm the base

- [ ] **Step 1:** `git fetch origin`; `git rebase origin/main`.
- [ ] **Step 2:** Run each alone: `grep -n "export function warn\|export function setWarningLog" lib/ui/warn.ts`; `grep -n "export function createStepRunner" lib/ui/steps.ts`; `grep -n "export async function withTransientStep" lib/ui/transient-step.ts`. One line each, or **stop**. Then `grep -c "commands/state\|lib/state/\|lib/run-history.ts\|lib/secrets/store.ts" lib/__tests__/raw-output-allowlist.json`: `12`, or stop.
- [ ] **Step 3:** Run `bun test commands/__tests__/state-backup.test.ts commands/__tests__/state-backup-init.test.ts commands/__tests__/state-backup-status.test.ts commands/__tests__/state-restore-from-backup.test.ts lib/state lib/__tests__/run-history.test.ts lib/secrets lib/__tests__/no-raw-output.test.ts`. PASS, or stop and report.

---

### Task 2: Audit (no code)

The copy table is the audit. Guard lines: `state.ts` 26, `state-backup-init.ts` 20, `state-backup-status.ts` 10, `db.ts` 4, `identity-migrate.ts` 6, `legacy-import.ts` 3, `branch-cache.ts` 2, `backup-orchestrator.ts` 1, `backup-restore.ts` 2, `run-history.ts` 5, `secrets/store.ts` 1 (80). Commands named in a `next` that exist in `lib/command-tree-def.ts`: `rt state backup init`, `rt state backup --local`, `rt state backup status`, `rt state restore`, `rt daemon stop`, `rt daemon logs`, `rt home init`.

---

### Task 3: Pin the `--json` output before converting

**Files:** Create `commands/__tests__/state-json.test.ts`.

- [ ] **Step 1: Write the tests**

```ts
/**
 * rt state's --json output, pinned before the output layer touches it.
 */
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";

import * as ui from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { closeStateDb, getStateDb, listStateBackups } from "../../lib/state/index.ts";
import { stateBackup, stateRestore } from "../state.ts";
import { stateBackupStatus } from "../state-backup-status.ts";

let io: CapturedOut;
beforeEach(() => {
  io = captureOut({ console: true });
  ui.__test__.setHuman(() => false);
  getStateDb();
});
afterEach(() => {
  io.restore();
  closeStateDb();
});

test("state backup --local --json is one line: ok, path, pruned", async () => {
  await stateBackup(["--local", "--json"]);
  const parsed = JSON.parse(io.stdout());
  expect(Object.keys(parsed)).toEqual(["ok", "path", "pruned"]);
  expect(parsed.ok).toBe(true);
  expect(io.stdout().split("\n")).toHaveLength(2);
});

test("state restore <copy> --json is one line: ok, restored, from", async () => {
  await stateBackup(["--local", "--json"]);
  io.clear();
  const copy = listStateBackups()[0]!;
  await stateRestore([copy, "--force", "--json"]);
  expect(Object.keys(JSON.parse(io.stdout()))).toEqual(["ok", "restored", "from"]);
});

test("state backup status --json with nothing set up prints its sentence today", async () => {
  await stateBackupStatus(["--json"], {});
  expect(io.stdout()).toBe("State backup is not configured. Run `rt state backup init` to set up.\n");
});

test("state backup status --json when set up is one line: configured, recipients, apps", async () => {
  mkdirSync(join(process.env.HOME!, ".mattstack", "user", "state-backups"), { recursive: true });
  writeFileSync(join(process.env.HOME!, ".mattstack", "user", "state-backups", "recipients.txt"), "age1key1\nage1key2\n");
  await stateBackupStatus(["--json"], {});
  const parsed = JSON.parse(io.stdout());
  expect(Object.keys(parsed)).toEqual(["configured", "recipients", "apps"]);
  expect(parsed).toMatchObject({ configured: true, recipients: 2 });
});
```

(`stateRestore` with `--force` skips the daemon check, so no daemon is needed; check `listStateBackups` returns names newest first, and adjust the pick if not. The set-up status case writes `recipients.txt` where `commands/__tests__/state-backup-status.test.ts` writes it; add `mkdirSync`, `writeFileSync` and `join` to the imports. The first status test pins today's sentence so that Task 6's ruled change is a deliberate edit of a pinned line.)

- [ ] **Step 2:** Run: PASS on today's code, twice more: PASS.
- [ ] **Step 3:** Commit, message `state: pin the --json output before the output layer touches it`.

---

### Task 4: `rt state backup` and `rt state restore`

**Files:** `commands/state.ts`, `commands/__tests__/state-backup.test.ts`, `commands/__tests__/state-restore-from-backup.test.ts`, the allowlist.

- [ ] **Step 1: Move the console harness onto the capture.** In `state-backup.test.ts`, replace the `console.log`/`console.error` spies with `captureOut({ console: true })` and `setHuman(() => false)`, so `result.errors` reads `io.stderr()` lines and `result.lines` reads `io.stdout()` lines. Run: PASS unchanged.
- [ ] **Step 2: Failing tests.** Change the expectations: `usage: rt state restore` becomes the failure title `Which backup?` with `next: rt state restore <copy>`; `not found` becomes `There is no backup called`; `daemon is running` becomes `[refused] rt will not restore while the daemon is running`. Add, inside `describe("rt state backup/restore")` (it sets `home`, and the file's existing `server` variable and its cleanup serve here too):

```ts
  test("restore while the daemon runs is a refusal with the stop command", async () => {
    getStateDb();
    await runCapturingExit(() => stateBackup(["--local"]));
    const [name] = listStateBackups();
    mkdirSync(dirname(DAEMON_SOCK_PATH), { recursive: true });
    server = Bun.serve({ unix: DAEMON_SOCK_PATH, fetch: () => Response.json({ ok: true }) });

    const io = captureOut();
    ui.__test__.setHuman(() => false);
    const exit = spyOn(process, "exit").mockImplementation(((c?: number) => {
      throw new Error(`exit ${c}`);
    }) as unknown as typeof process.exit);
    try {
      await expect(stateRestore([name!])).rejects.toThrow("exit 1");
      expect(io.stderr()).toContain("[refused] rt will not restore while the daemon is running  it shares this data with rt\n  next: rt daemon stop\n  note: --force restores anyway.");
      expect(io.stdout()).toBe("");
      io.clear();
      await expect(stateRestore([name!, "--json"])).rejects.toThrow("exit 1");
      expect(io.stdout()).toBe("");
    } finally {
      exit.mockRestore();
      io.restore();
    }
  });
```

(Add `import * as ui from "../../lib/ui/out.ts";` and `import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";` to the file.)

- [ ] **Step 3:** Run: FAIL.
- [ ] **Step 4: Implement** by the copy table. Add to `commands/state.ts`:

```ts
import { basename } from "path";
import * as out from "../lib/ui/out.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { withTransientStep } from "../lib/ui/transient-step.ts";

function formatBytes(n: number): string {
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function refuseWhileDaemonRuns(): never {
  out.note(
    out.line("refused", "rt will not restore while the daemon is running", "it shares this data with rt"),
    out.callout("next", out.cmd("rt daemon stop")),
    out.callout("note", "--force restores anyway."),
  );
  process.exit(1);
}

function localCopyBlocks(path: string, removed: string[]): out.Block[] {
  return [out.line("done", "Saved a local copy of rt's state", basename(path)), ...(removed.length > 0 ? [out.line("done", `Removed ${plural(removed.length, "older copy", "older copies")}`)] : [])];
}
```

(`Block` is `import type { Block } from "../lib/ui/protocol.ts"`; write the type that way.) Replace `fail(msg)` sites one by one with the copy table's failure (each keeps `process.exit(1)`); `requireCopy`'s usage branch `out.fail(usageFailure("Which backup?", "rt state restore <copy>")); process.exit(1);`. The full backup's human branch:

```ts
      out.print(
        out.line("done", "Backed up rt's state", plural(result.backed.length, "source", "sources")),
        out.table(result.backed.map((b) => [out.strong(b.app), formatBytes(b.sizeBytes)])),
        ...(removed.length > 0 ? [out.line("done", `Removed ${plural(removed.length, "older backup", "older backups")}`)] : []),
      );
      if (result.errors.length > 0) out.note(out.line("warn", "Some sources were not backed up"), out.verbatim(result.errors));
```

`stateRestoreFromBackup`'s pull: `if (!dryRun) { await withTransientStep("Pulling your latest backups", () => pullHomeRepo()); closeStateDb(); }`; its result:

```ts
  const rows = result.restored.map((r) => [out.strong(r.app), out.dim(r.targetPath)]);
  const blocks: out.Block[] = [];
  if (rows.length > 0) blocks.push(out.section(dryRun ? "Would restore" : "Restored", undefined, out.table(rows)));
  for (const s of result.skipped) blocks.push(out.line("skipped", s));
  if (blocks.length > 0) out.print(...blocks);
  if (result.errors.length > 0) {
    out.fail({ title: "Some backups were not restored", details: result.errors.join("\n") });
    process.exitCode = 1;
  }
```

Every `--json` line becomes `out.json(<the same object>)`. Delete `commands/state.ts` from the allowlist.

- [ ] **Step 5:** Run `bun test commands/__tests__/state-backup.test.ts commands/__tests__/state-restore-from-backup.test.ts commands/__tests__/state-json.test.ts`. PASS; `grep -n "console\." commands/state.ts` empty; `bun run typecheck` clean.
- [ ] **Step 6:** Commit, message `state backup, restore: result lines and tables; restore while the daemon runs is a refusal`.

---

### Task 5: `rt state backup init` as steps

**Files:** `commands/state-backup-init.ts`, `commands/__tests__/state-backup-init.test.ts`, the allowlist.

**Interfaces:**
- Consumes: `createStepRunner()` from `lib/ui/steps.ts` (`run(pending, task, { done, doneHint, error, errorHint })`); off a terminal each step prints its final line through `out.print`.

- [ ] **Step 1: Failing tests.** Move the file's `console.error` spy onto `captureOut({ console: true })` with `setHuman(() => false)`. Change the missing-tools expectation to the failure title `rt cannot find age, zstd, git-lfs` with `next: brew install age zstd git-lfs` on stderr. Add `init stops at the stage that failed and says so`: with the file's existing seams arranged so the first backup reports an error (copy the arrange of the file's test that exercises `runFullBackup`; if none does, stub `runFullBackup` by `spyOn` on the `backup-orchestrator.ts` module namespace import), expect stdout to contain `[ok] age, zstd and git-lfs are here` and stderr to contain `The first backup did not finish`, and the exit code 1.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.** Restructure `stateBackupInit` around one runner:

```ts
import * as out from "../lib/ui/out.ts";
import { createStepRunner } from "../lib/ui/steps.ts";

export async function stateBackupInit(_args: string[], _ctx: CommandContext = {}): Promise<void> {
  const resolved = new Map(BACKUP_TOOLS.map((name) => [name, findBackupTool(name)]));
  const absent = BACKUP_TOOLS.filter((name) => !resolved.get(name));
  if (absent.length > 0) {
    out.fail({ title: `rt cannot find ${absent.join(", ")}`, why: "They ship inside mattstack.app.", next: out.cmd(`brew install ${absent.join(" ")}`) });
    process.exit(1);
  }
  const gitLfs = resolved.get("git-lfs")!;
  const homeRepo = join(mattstackHome(), "user");
  if (!existsSync(join(homeRepo, ".git"))) {
    out.fail({ title: "Your home repo is not set up yet", next: out.cmd("rt home init") });
    process.exit(1);
  }
  const steps = createStepRunner();
  await steps.run("Checking the backup tools", async () => {}, { done: "age, zstd and git-lfs are here" });
  // ...each stage below as steps.run(<pending>, <the existing code>, { done, doneHint })
}
```

The stages, in order, by the copy table: Git LFS (the `lfsInit` spawn throws an `Error` carrying its stderr when it fails, the runner ends the step `failed`, and the catch around the whole run prints `out.fail({ title: "Git LFS did not install in your home repo", details: <stderr> })` and exits 1); this Mac's key; the first backup (throw when `result.errors.length > 0`, caught as `The first backup did not finish` with the errors as `details`); the decrypt check (when `result.backed` is empty, end with `done` and hint `nothing to check yet` by returning early from the task and passing `doneHint`; the runner has no skipped ending, so the hint carries it); the LFS check (on a miss, end the step `done` with hint `not confirmed yet`, then `out.print(out.line("warn", "Git LFS has not taken the encrypted files yet"), out.callout("next", out.cmd("rt state backup status")))`); then `out.print(out.summary("done", "Encrypted backup is set up", ["the daemon backs up every 4 hours"]))`.

If `StepRunner.run`'s options cannot end a step `warn` or `skipped`, keep the step `done` with the hint as above; do not add an option to `lib/ui/steps.ts` (not this slice's file).

Delete `commands/state-backup-init.ts` from the allowlist.

- [ ] **Step 4:** Run `bun test commands/__tests__/state-backup-init.test.ts`. PASS.
- [ ] **Step 5:** Commit, message `state backup init: six stages as steps, a failed stage keeps its line`.

---

### Task 6: `rt state backup status` and the state warnings

**Files:** `commands/state-backup-status.ts`, `commands/__tests__/state-backup-status.test.ts`, `commands/__tests__/state-json.test.ts`, `lib/state/db.ts`, `identity-migrate.ts`, `legacy-import.ts`, `branch-cache.ts`, `backup-orchestrator.ts`, `backup-restore.ts`, their tests, the allowlist.

- [ ] **Step 1: Failing tests.**

In `state-backup-status.test.ts` (moved onto the capture), the configured case expects stdout to start `[ok] Encrypted backup is set up  2 keys can decrypt it\n` and to contain `backups: every 4 hours`; the not-configured human case expects `[off] Encrypted backup is not set up\n  next: rt state backup init\n`. In `commands/__tests__/state-json.test.ts`, Matt's Ruling 3 replaces the first status test:

```ts
test("state backup status --json with nothing set up is {configured:false} (Matt's ruling)", async () => {
  await stateBackupStatus(["--json"], {});
  expect(io.stdout()).toBe('{"configured":false}\n');
  expect(io.stderr()).toBe("");
});
```

In `lib/state/__tests__/db.test.ts`, replace the `console.warn` spy at line 505 with:

```ts
import { setWarningLog, __test__ as warnings } from "../../ui/warn.ts";

// inside the test:
const logged: Array<{ module: string; message: string; context: Record<string, unknown> }> = [];
setWarningLog((module, message, context) => logged.push({ module, message, context }));
try {
  // the existing arrange and act
  expect(logged.some((l) => l.module === "state" && l.message.startsWith("state db could not be opened (corrupt)"))).toBe(true);
} finally {
  warnings.reset();
}
```

The existing `a throwing legacy importer is isolated ...` test asserts the warning names `project-mrs.json`; paths now ride in `context`, so its check becomes `logged.some((l) => String(l.context.path ?? "").includes("project-mrs.json"))`.

Add, inside `describe("corruption escape")` (its `dir` comes from the file's `beforeEach`; import `setWarningLog` and `__test__ as warnings` from `../../ui/warn.ts`, `captureOut` from `../../ui/__tests__/capture-out.ts`, and `* as ui` from `../../ui/out.ts`):

```ts
  test("a quarantined db is shown once and logged with both paths", () => {
    const logged: Array<{ message: string; context: Record<string, unknown> }> = [];
    setWarningLog((_module, message, context) => logged.push({ message, context }));
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      for (const name of ["a.db", "b.db"]) {
        const dbPath = join(dir, name);
        writeFileSync(dbPath, "definitely not a sqlite database, just bytes");
        openStateDb(dbPath, "cli").close();
      }
      expect(logged.filter((l) => l.message.startsWith("state db could not be opened (corrupt)"))).toHaveLength(2);
      expect(logged.every((l) => typeof l.context.path === "string" && typeof l.context.quarantinedPath === "string")).toBe(true);
      expect(io.stderr().match(/rt's saved state was damaged and has been reset/g)).toHaveLength(1);
    } finally {
      warnings.reset();
      io.restore();
    }
  });

  test("with no warning log set, a state warning is the plain stderr line", () => {
    warnings.reset();
    const io = captureOut();
    try {
      const dbPath = join(dir, "c.db");
      writeFileSync(dbPath, "definitely not a sqlite database, just bytes");
      openStateDb(dbPath, "cli").close();
      expect(io.stderr()).toStartWith("rt: state db could not be opened (corrupt)");
      expect(io.stderr()).not.toContain("\x1b");
    } finally {
      io.restore();
    }
  });
```

In `identity-migrate.test.ts`, `branch-cache.test.ts` and any test that spies `console.warn` for a file in this task, replace the spy with the same `setWarningLog` capture and assert on `logged` messages by the table's new wording (their starts: `could not re-key`, `already exists`, `did not persist`, `collided with`, `branch_cache key`).

- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.**

`commands/state-backup-status.ts`:

```ts
import * as out from "../lib/ui/out.ts";

const PUSH_WORDS: Record<string, string> = { synced: "up to date", "no remote tracking ref": "no remote", unknown: "unknown" };
const LFS_WORDS: Record<string, string> = { "filter active": "on", "filter not configured": "off", "git-lfs not found": "not installed", unknown: "unknown" };

function formatBytes(n: number): string {
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
```

The not-configured branch: `if (json) { out.json({ configured: false }); return; } out.print(out.line("off", "Encrypted backup is not set up"), out.callout("next", out.cmd("rt state backup init"))); return;`. The `--json` envelope through `out.json`. The human ending:

```ts
  const pushed = /^(\d+) commit\(s\) ahead$/.exec(pushState);
  out.print(
    out.line("done", "Encrypted backup is set up", `${recip.length} ${recip.length === 1 ? "key" : "keys"} can decrypt it`),
    out.kv("backups", "every 4 hours"),
    out.kv("pushed", pushed ? `${pushed[1]} not pushed yet` : (PUSH_WORDS[pushState] ?? pushState)),
    out.kv("Git LFS", LFS_WORDS[lfsState] ?? lfsState),
    out.table(status.map((s) => (s.lastBackup ? [out.strong(s.app), `${s.count} backup${s.count === 1 ? "" : "s"}`, formatBytes(s.totalBytes), out.dim(`latest ${s.lastBackup}`)] : [out.strong(s.app), out.dim("no backups")]))),
  );
```

Each lib file: add `import { warn } from "../ui/warn.ts";` (`"./ui/warn.ts"` from `lib/run-history.ts`) and replace each `console.warn` / `console.error` by the table's row, for example:

```ts
// lib/state/db.ts:534
warn("state", "state db could not be opened (corrupt); quarantined and recreated empty", {
  context: { path, quarantinedPath },
  show: { title: "rt's saved state was damaged and has been reset", hint: "the damaged file was kept beside it", next: cmd("rt daemon logs") },
});
// lib/state/backup-restore.ts:159
warn("state", `git pull failed (exit ${proc.exitCode}); restoring from local backups`, {
  show: { title: "rt could not pull the latest backups", hint: "restoring from the copies on this Mac" },
});
// lib/state/backup-orchestrator.ts:237
warn("state", `git lfs prune warned: ${stderr.slice(0, 200)}`);
```

(`cmd` from `../ui/out.ts`.) Paths that appear in today's message move into `context` (`{ path }`), never the message, so the log keeps them and nothing shows them. The other rows follow the same form with the table's message and no `show`.

Delete from the allowlist: `commands/state-backup-status.ts`, `lib/state/backup-orchestrator.ts`, `lib/state/backup-restore.ts`, `lib/state/branch-cache.ts`, `lib/state/db.ts`, `lib/state/identity-migrate.ts`, `lib/state/legacy-import.ts`.

- [ ] **Step 4:** Run `bun test commands/__tests__/state-backup-status.test.ts commands/__tests__/state-json.test.ts lib/state lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-daemon-sync-exec.test.ts`. PASS, including `lib/state/__tests__/barrel.test.ts`.
- [ ] **Step 5:** Commit, message `state backup status as states, and JSON when nothing is set up (Matt's ruling); lib/state warnings through warn (5a rows 24 to 38, rows 46 to 48)`.

---

### Task 7: `lib/run-history.ts` and `lib/secrets/store.ts`

**Files:** `lib/run-history.ts`, `lib/secrets/store.ts`, `lib/__tests__/run-history.test.ts`, the secrets store's test, the allowlist.

- [ ] **Step 1: Failing tests.** In `run-history.test.ts`, replace the three `console.warn` spies (lines 72, 117, 180 at `658e704b9`) with the `setWarningLog` capture; assert `logged` holds a `run-history` message starting `legacy run history` (or `could not record run history`) instead of `warnSpy` having been called. Add to the secrets store's test file (find it: `ls lib/secrets/__tests__/`):

```ts
import { readFileSync } from "fs";

test("a secrets debug trace is logged, not printed", () => {
  const src = readFileSync(join(import.meta.dir, "..", "store.ts"), "utf8");
  const body = src.slice(src.indexOf("function debugLog"), src.indexOf("}", src.indexOf("function debugLog")) + 1);
  expect(body).toContain('logCliEvent("debug", "secrets"');
  expect(body).not.toContain("console.");
});
```

(`CLI_DEBUG` is a module-load constant, so the trace cannot be switched on inside one test run; the source check is the pin.)

- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement** rows 1 to 5 in `lib/run-history.ts` (module `run-history`, paths in `context`), and row 49:

```ts
function debugLog(cmd: string[], sensitive: boolean | undefined): void {
  if (!CLI_DEBUG) return;
  logCliEvent("debug", "secrets", formatDebugLine(cmd, { sensitive }));
}
```

(`logCliEvent` from `../cli-logger.ts`; `formatDebugLine` already leaves values out.) Delete `lib/run-history.ts` and `lib/secrets/store.ts` from the allowlist.

- [ ] **Step 4:** Run `bun test lib/__tests__/run-history.test.ts lib/secrets lib/__tests__/no-raw-output.test.ts`. PASS. Then `git diff origin/main -- lib/__tests__/raw-output-allowlist.json`: twelve deletions, nothing added.
- [ ] **Step 5:** Commit, message `run history and secrets debug lines through warn and the CLI log`.

---

### Task 8: Renders, AGENTS.md and every gate

- [ ] **Step 1:** `bun run ui:build`. In the scratchpad, `blocks-6e.ts` builds (with `out` from the worktree): the full backup's done line and size table, the not-set-up failure with its tip, the local fallback warning with its excerpt, the restore refusal, the restore section with two rows and a skipped line, the init stages as their final `line("done", ...)` rows plus the closing summary, the LFS-not-confirmed warning with its `next`, the backup status (configured: line, three kv rows, the per-app table), and row 33's shown warning. Copy 5f2's `ansi-page.ts`.
- [ ] **Step 2:** Render at width 100, dark and light (6a Task 8 Step 2).
- [ ] **Step 3:** Screenshot both with Fast Browser into `docs/design/output-layer/6e-state-dark.png`, `6e-state-light.png`. Also run `rt state backup init` once through the real steps verb under termwright or a pty only if the repo's `e2e/pty` harness makes it cheap; otherwise say in the report that the live steps were not rendered. Write down plainly what reads wrong: nothing coral except "Some backups were not restored"; the refusal reads as declining; the kv rows align; sizes read as sizes. Fix and re-render.
- [ ] **Step 4:** README row: `| \`6e-state-dark.png\`, \`6e-state-light.png\` | \`rt state\` at 100 columns: a backup with sizes, the not-set-up failure and its tip, the local fallback, the restore refusal and a restore, \`state backup init\`'s stages and summary, \`state backup status\`, and the damaged-state warning |`.
- [ ] **Step 5:** AGENTS.md (append to "Output layer"):

```markdown
Warnings under `lib/state/` go through `warn`: logged always, shown only
where 5a's warnings table or the phase 6 scoping rows say so, and once per
process. The daemon sets no warning log, so it still files the plain
`rt: <message>` line from its stderr capture. Paths ride in the warning's
`context`, never its message.
```

- [ ] **Step 6:** The eight gates, one at a time (6a Task 8 Step 6). All pass.
- [ ] **Step 7:** Commit, message `docs: state renders and the rule for state warnings`.

---

### Task 9: Ship

- [ ] **Step 1:** `git fetch origin`; `git rebase origin/main`; merge the allowlist, `AGENTS.md`, README by hand.
- [ ] **Step 2:** The eight gates again.
- [ ] **Step 3:** `git diff --shortstat origin/main...HEAD`; about 1,600 lines.
- [ ] **Step 4:** Push with `git_push`; body in `<scratchpad>/pr-body-6e.md` (framing; **state verbs**, **backup init steps**, **warnings** with the row numbers applied; renders; gates; last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`); `gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 6e, state" --body-file <scratchpad>/pr-body-6e.md`.
- [ ] **Step 5:** Report URL, gates, size, renders (and whether the live steps were rendered). Do not merge.

---

## Decisions this plan made

1. **`state backup status --json` with nothing set up prints `{"configured":false}`** (Matt's Ruling 3, 2026-10-02): it printed a sentence; the object leads with the same `configured` key as the set-up case, and nothing reads it.
2. **`state backup init` uses the step runner, and a stage that ends with a caveat ends `done` with a hint** plus a `warn` line after, because `lib/ui/steps.ts`'s runner has no warn or skipped ending and that file is not this slice's.
3. **Restore while the daemon runs is a refusal,** exit 1 as today: the data is shared, and `--force` overrides it.
4. **Rows 47 and 48 share one shown line,** since `warn` shows a title and hint once per process.

## Self-Review

**Spec coverage.** Phase 6's `state` and `state backup`: Tasks 4 to 6. Steps for a multi-stage run: Task 5. 5a rows 1 to 5, 24 to 38 and scoping rows 46 to 49: Tasks 6 and 7. `--json` frozen: Task 3. Twelve allowlist lines: Tasks 4 to 7.

**Placeholders.** One test (init's failed stage) builds its arrange from the file's own seams or a namespace `spyOn`, named in Task 5; every other test is written out.

**Type consistency.** `formatBytes`, `plural`, `refuseWhileDaemonRuns`, `localCopyBlocks` and the warn calls match their uses.

**Review Focus.** Five lines, each pinned by a named test.
