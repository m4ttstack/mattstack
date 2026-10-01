# rt Output Layer, Phase 2 (Errors) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every failure that reaches the top of the rt CLI is drawn as one `failure` block on stderr: an expected failure (`UserActionableError`) with its `why` and `next`, exit 2; anything else as one line with the stack in the CLI log, exit 1. `exitUserError` stops printing `rt <verb>:` on stdout, and the first known expected failure (a sops decrypt a Mac's age key cannot open) is converted.

**Architecture:** `UserActionableError` moves from `lib/setup/errors.ts` to `lib/errors.ts` and gains optional `why`, `next` and `log`. `lib/errors.ts` also owns the two exits the seam uses (`exitFromDispatch`, `exitUnexpected`) and the stream change in `exitUserError`; `cli.ts`'s dispatch catch and `__main().catch` route every error through it. `lib/ui/out.ts` grows two small things the seam needs: `fail(f, ...after)` so a stack can ride under the failure in one stderr write, and one warn line per process in the CLI log when `rt-ui render` cannot be spawned or dies. `lib/secrets/store.ts` types the sops decrypt failure and `lib/secrets/team-store.ts` turns it into the expected failure. The test helper every later phase captures `out` with, `lib/ui/__tests__/capture-out.ts`, is created here.

**Tech Stack:** Bun + TypeScript (`lib/`, `commands/`, `cli.ts`), `bun:test`, termwright (`e2e/pty/`). No Go change in this phase.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (ticket RT-369), sections "Error seam", "Copy style", "Guard", "Testing" and phase 2 of "Phases". Phase 1's plan (`docs/superpowers/plans/2026-09-30-rt-output-layer-phase-1-foundation.md`) built the API this plan calls.

## Global Constraints

- Never use em dashes or en dashes in any file, comment, test name or commit message. Use "..." or rephrase.
- Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show. No narration, no task numbers, no decision history.
- `--json` output of every existing command must not change, byte for byte. Plain text off a TTY takes the new wording.
- Human text goes to stdout except in payload verbs; failures go to stderr through `out.fail`; never style a payload.
- Coral only for failures. A state that is not done is pending, off, refused, needs-you, stale, skipped or warn.
- Run `bun test` only from the repo root. Run Go from `ui/` (`go -C ui ...`). `bun run ui:build` after any change under `ui/`.
- Every converted file: delete its line from `lib/__tests__/raw-output-allowlist.json` in the same commit.
- Every commit message ends with the trailer line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Sample data in tests is invented. No real team, person or host names.
- Every leaf picker and every human branch gates on TTY, `--json` and `RT_BATCH` exactly as today; the non-TTY and `--json` paths keep their exit codes.
- Phase 2 only: exit codes are unchanged. An `ExecFailure` exits with the plugin's code, an expected failure exits 2, anything else exits 1.
- Phase 2 only: `exitUserError`'s `--json` line is the same `JSON.stringify(userErrorPayload(err))` on stdout as today; when a caller passes `print`, that `print` still receives it. An expected failure that escapes to the seam with `--json` on argv gets that same envelope through `out.json`; an unexpected error under `--json` writes nothing to stdout.
- Phase 2 only: the spec's "frozen" (ruled 2026-10-01) means the shape, and lets a human string inside the JSON change wording. This plan is stricter than it needs to be and stays so: the only `--json` this phase touches is the exit-2 envelope, whose `message` is the error's own text and does not change.
- Phase 2 only: the dispatch catch in `lib/command-tree.ts` keeps writing every command's outcome record (AGENTS.md "Logging architecture"). The seam adds no second `CommandLog` record and never edits dispatch's; for an unexpected error it writes one event line carrying the stack, so an error thrown before dispatch starts still leaves one.
- Phase 2 only: the `rt-ui render` failure warn line is written once per process; a run that prints many block sets on a broken machine leaves one line, not one per set.
- Phase 2 only: `lib/errors.ts`, `lib/secrets/*.ts` and `lib/ui/out.ts` never import `lib/ansi.ts`, `lib/tui.ts` or `lib/tui/palette.ts`, and `lib/errors.ts` never calls `console.*` or writes to `process.stdout`/`process.stderr` directly; the guard scans it.
- Phase 2 only: every call site of `UserActionableError`, `userErrorPayload` and `exitUserError` compiles unchanged. The signatures stay `new UserActionableError(code, message, extra?)` plus an optional fourth `options` argument, and `exitUserError(err, json, verb, print?)`.
- Phase 2 only: files owned by phase 3 (`commands/setup.ts`, `commands/verify.ts`, `commands/uninstall.ts`, `commands/accounts.ts`, `commands/logins.ts`, `commands/secrets.ts`, everything under `lib/setup/`) and phase 4 (`commands/settings*.ts`, `lib/settings/`, the settings write path in `packages/rt-client`) are not edited, apart from `lib/setup/errors.ts` becoming a re-export of `lib/errors.ts`.

## Review Focus

1. **An error thrown before dispatch starts** (plugin tree load, settings notice routing, the first-run hint's `existsSync`). Today it surfaces as a bare Bun stack; after this plan the same `__main().catch` route must give one line and keep the stack in the CLI log, with no command record to lean on. Pinned in Task 4 (`exitUnexpected writes the message and stack to the cli log`), which runs with no `logCommand` call having happened.
2. **`--json` on argv when an error escapes to the seam.** An expected failure must give the one envelope line `exitUserError` gives, so an agent parses the same shape whichever route the error took; an unexpected error must leave stdout empty (no half envelope) and print plainly on stderr. Pinned in Task 4 (`exitFromDispatch: an expected failure under --json is the envelope on stdout, nothing on stderr, exit 2`, `exitFromDispatch: an unexpected error under --json still writes nothing to stdout`, and in `e2e/tests/errors.test.ts`, `--json: an unexpected error leaves stdout empty and exits 1`).
3. **An error message carrying escape sequences** (git or sops stderr with `\x1b[2J`). The failure block and the stack excerpt must print as plain characters. Pinned in Task 4 (`escape sequences in a message or stack never reach the terminal`).
4. **A multi-line error message** (sops stderr is fifteen lines). The title and hint are single-line fields; the person must see the first line, not a mashed paragraph. Pinned in Task 3 (`a multi-line message collapses to one title line in plain output`) and Task 4 (`a multi-line message gives a one-line hint`).
5. **A machine whose rt-ui helper is missing or broken.** The person must still get the words, the install fault must be findable afterwards, and a long run must not fill the log with the same line. Pinned in Task 2 (`a missing helper leaves a warn line naming what was tried`, `a helper that exits non-zero leaves a warn line in the cli log`, `the helper-failure warn line is written once per process`).

## File Structure

| File | Responsibility |
|---|---|
| `lib/errors.ts` (create) | `UserActionableError` with `why`, `next`, `log`; `userErrorPayload`; `failureFor`; `exitUserError`; `exitFromDispatch`; `exitUnexpected` |
| `lib/setup/errors.ts` (modify) | A one-line re-export of `lib/errors.ts`, kept for phase 3's importers |
| `lib/__tests__/errors.test.ts` (create) | Fields, payload parity, shim identity, both exits, stream choice, log lines |
| `lib/ui/__tests__/capture-out.ts` (create) | Test helper every phase imports: captures stdout and stderr writes; the human gate stays the caller's |
| `lib/ui/out.ts` (modify) | `fail(f, ...after)`, `isHuman(stream)`, exported `Stream`, one warn line per process when the helper fails |
| `lib/ui/__tests__/out.test.ts` (modify) | Trailing blocks under a failure, `isHuman`, the helper-failure log lines and their latch |
| `lib/cli-logger.ts` (modify) | `logCliEvent(level, module, message, context)` on the cli surface |
| `cli.ts` (modify) | The dispatch catch and `__main().catch` call `exitFromDispatch`; `--version` through `out.payload`; `--grant-fda` through `out` |
| `lib/secrets/store.ts` (modify) | `SopsDecryptError`, `sopsKeyMismatch` |
| `lib/secrets/team-store.ts` (modify) | `teamSecretsUnreadable`; `readTeamSecret`, `listTeamSecretNames`, `writeTeamSecret` throw it |
| `lib/secrets/__tests__/store.test.ts`, `team-store.test.ts` (modify) | The typed decrypt failure and its conversion |
| `e2e/tests/errors.test.ts` (create) | The seam through the real binary off a TTY |
| `e2e/pty/errors.test.ts` (create) | The seam through the real binary and the real rt-ui in a pty |
| `.github/workflows/e2e.yml` (modify) | The pty gate's path filter learns this phase's files |
| `lib/__tests__/no-raw-output.test.ts`, `raw-output-allowlist.json` (modify) | The guard scans `cli.ts`; `cli.ts` joins the allowlist for its two pre-dispatch notices |
| The seven `commands/__tests__/*.test.ts` files Task 1 names (modify) | Tests that read `exitUserError`'s human line through `print` or a `console.log` spy now read stderr |
| Importers of `lib/setup/errors.ts` outside phase 3's files, `lib/release/__tests__/*.test.ts` and `lib/team/__tests__/*.test.ts` included (modify) | Import path becomes `lib/errors.ts`; nothing else changes in them |
| `AGENTS.md` (modify) | The error seam paragraph in "Output layer"; the guard now names `cli.ts` |

---

### Task 1: Audit of the print sites this phase owns

No code. This is the inventory every later task implements; it stays in the plan.

**Files read:** `cli.ts`, `lib/command-tree.ts` (`dispatch`, lines 405 to 483), `lib/cli-logger.ts`, `lib/setup/errors.ts`, `lib/secrets/store.ts`, `lib/secrets/team-store.ts`, `lib/ui/out.ts`, every `exitUserError` call site under `commands/`.

| Site | Today | Becomes | Task |
|---|---|---|---|
| `cli.ts:171-177` dispatch catch | `ExecFailure` exits with its code; everything else rethrows to `__main().catch`, which rethrows: Bun prints the bundled stack, exit 1 | `ExecFailure` unchanged; `UserActionableError` becomes a `failure` block (title = message, `why`, `next`, details pointer when `log` is set) on stderr, exit 2, or with `--json` on argv the same envelope `exitUserError` writes, through `out.json` on stdout; anything else becomes `failure` with title `rt hit an unexpected error`, hint = the message's first line, `next` = `rt daemon logs`, exit 1, the stack in the CLI log, and a `verbatim` stack under the block off a TTY or with `RT_LOG_LEVEL=debug`; under `--json` an unexpected error writes nothing to stdout | 4 |
| `cli.ts:184-186` `__main().catch` | rethrows | calls the same `exitFromDispatch`, so an error thrown before dispatch (plugin tree load, notice routing) gets the same treatment | 4 |
| `cli.ts:95` `--version` | `console.log(versionBanner(...))` | `out.payload(banner + "\n")`: scripts read it (`e2e/tests/smoke.test.ts` matches `^rt `) | 7 |
| `cli.ts:123-131` `--grant-fda` | four `console.log` lines with raw `\x1b[1m`, a `console.error` on failure | `out.print(line("needs-you", ...), callout("note", ...), callout("next", cmd("rt daemon restart")))`; failure through `out.fail` | 7 |
| `cli.ts:50-59` legacy migration notices, `cli.ts:152` first-run hint | `console.error` | Unchanged this phase. They print before the verb is known, so stdout is not safe (`rt cd`'s stdout is a payload) and the layer has no stderr note except `fail`. `cli.ts` joins the guard's allowlist so phase 6 settles them | 7 |
| `lib/setup/errors.ts:18-21` `exitUserError` | `print(json ? envelope : "rt <verb>: " + message)` with `print` defaulting to `console.log`, exit 2 | JSON: the same line, through `print` when given, else `out.json`. Human: `out.fail(failureFor(err))` on stderr, no prefix. `log` detail goes to the CLI log. Exit 2 | 3 |
| `lib/secrets/store.ts:184-194` `sopsDecrypt` | throws `new Error("sops -d <path>: <stderr>")` (fifteen lines of sops output in the message) | throws `SopsDecryptError` with the same message plus `filePath` and `stderr` fields; `sopsKeyMismatch(stderr)` recognises the no-matching-recipient case | 5 |
| `lib/secrets/team-store.ts:201-211,213-231` `readTeamSecret`, `listTeamSecretNames`, `writeTeamSecret` | let the `Error` through | convert `SopsDecryptError` to `UserActionableError("team-secrets-unreadable", "This Mac cannot read the <slug> team's secrets yet", { team }, { why, next: "rt team pull", log })` | 5 |
| `lib/ui/out.ts:122-136` `renderStyled` | a missing, dying or hanging helper returns `null` silently (the 2 s render timeout stays) | same, plus one `warn` line on the cli surface (module `rt-ui`) naming the binary, exit code, signal and stderr tail, or the resolver's message; written once per process | 2 |
| `lib/cli-logger.ts:294-310` crash handlers | `console.error(err)` then exit 1 | Unchanged: it covers an uncaught exception outside `__main`, and `cli-logger` is a logging seam the spec sends to a permanent exemption in phase 6 | none |
| `lib/command-tree.ts:423-436` dispatch's own catch | logs the outcome with stack, rethrows | Unchanged: this is the logging seam AGENTS.md names | none |

Copy fixed by this audit (every later task uses these strings verbatim):

- Unexpected error title: `rt hit an unexpected error`. Hint: the first line of the error's message. Next: `rt daemon logs`. No details pointer: the `next` callout already says where the rest is.
- Expected failure with a `log` detail: details `the full output is in the rt log`.
- Team secrets: title `This Mac cannot read the <slug> team's secrets yet`; why (key mismatch) `No age key on this Mac matches the team's recipients. The team owner adds your key, then you pull the team again.`; why (other sops failure) `The team's secrets file could not be decrypted on this Mac.`; next `rt team pull`. Both `rt team pull` and `rt daemon logs` exist in `lib/command-tree-def.ts` (`team.pull`, `daemon.logs`).
- Helper failure log lines (module `rt-ui`, level `warn`, the first one per process only): `rt-ui was not found; printed plain text instead`, `rt-ui render exited non-zero; printed plain text instead` (a helper killed by the render timeout lands here too, with `exitCode: null` and `signalCode: "SIGTERM"`), `rt-ui render did not spawn; printed plain text instead`.

Tests that read `exitUserError`'s human line today through `deps.print` or a `console.log` spy, and which Task 3 retargets to stderr: `commands/__tests__/repos-reidentify.test.ts` (2 tests), `commands/__tests__/repos-locate.test.ts` (3), `commands/__tests__/release-apps.test.ts` (harness + 2), `commands/__tests__/team-join.test.ts` (2), `commands/__tests__/team.test.ts` (2), `commands/__tests__/deps.test.ts` (harness + 1), `commands/__tests__/release-update-machine.test.ts` (harness + 3). Every other test of an `exitUserError` caller either runs `--json` with an explicit `print` or asserts only the exit code.

---

### Task 2: `out.fail` takes trailing blocks, `isHuman`, and the helper-failure log line

**Files:**
- Modify: `lib/cli-logger.ts` (around line 235, `writeCliLogLine`)
- Modify: `lib/ui/out.ts`
- Modify: `lib/ui/__tests__/out.test.ts`

**Interfaces:**
- Consumes: `renderPlain` (`lib/ui/out-plain.ts`), `resolveRtUi` (`lib/ui/resolve.ts`), `logsDir` (`lib/rt-paths.ts`), the fake helper's `render` verb (`lib/ui/__tests__/fake-rt-ui.ts`, honours `cfg.exit`).
- Produces:
  - `lib/cli-logger.ts`: `export type CliLogLevel = "debug" | "warn" | "error"`; `export function logCliEvent(level: CliLogLevel, module: string, message: string, context?: Record<string, unknown>): void` (one JSON line `{ time, level, module, msg, ...context }` appended to `~/.mattstack/rt/logs/cli.YYYY-MM-DD.log`; never throws).
  - `lib/ui/out.ts`: `export type Stream = "stdout" | "stderr"`; `export function isHuman(stream?: Stream): boolean` (the gate `print` and `fail` apply, test-swappable through `__test__.setHuman`); `export function fail(f: FailureInput, ...after: Block[]): void` (the failure block and `after` in one stderr write); the helper-failure warn line latched once per process, with `__test__.reset()` clearing the latch.

- [ ] **Step 1: Write the failing tests**

In `lib/ui/__tests__/out.test.ts`, add to the imports:

```ts
import { readdirSync } from "fs";
import { logsDir } from "../../rt-paths.ts";
```

(`existsSync`, `mkdtempSync`, `readFileSync`, `rmSync` are already imported from `fs`; merge `readdirSync` into that line.)

Add these helpers after `const sent = ...`:

```ts
/** Every line on the newest cli log file of the test HOME the preload set; empty when none was written. */
function cliLogLines(): Record<string, unknown>[] {
  const dir = logsDir();
  if (!existsSync(dir)) return [];
  const file = readdirSync(dir).filter((f) => f.startsWith("cli.") && f.endsWith(".log")).sort().at(-1);
  if (!file) return [];
  return readFileSync(join(dir, file), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

function lastCliLogLine(): Record<string, unknown> {
  const entry = cliLogLines().at(-1);
  if (!entry) throw new Error("no cli log was written");
  return entry;
}
```

Extend the existing test `falls back to plain when the helper hangs past the render timeout` (keep its `15000` timeout) so its body ends with:

```ts
  expect(stdout.join("")).toBe("[ok] Skills linked\n");
  const entry = lastCliLogLine();
  expect(entry.msg).toBe("rt-ui render exited non-zero; printed plain text instead");
  expect(entry.exitCode).toBeNull();
  expect(entry.signalCode).toBe("SIGTERM");
```

Append these tests at the end of the file:

```ts
test("fail renders trailing blocks under the failure in the same stderr write", () => {
  out.__test__.setHuman(() => false);
  out.fail({ title: "rt hit an unexpected error", hint: "kaboom" }, out.verbatim(["Error: kaboom", "    at run (boom.ts:1:7)"], "stack"));
  expect(stdout.join("")).toBe("");
  expect(stderr).toEqual(["[failed] rt hit an unexpected error  kaboom\nstack:\n  Error: kaboom\n      at run (boom.ts:1:7)\n"]);
});

test("at a terminal the trailing blocks ride in the same render call as the failure", () => {
  out.fail({ title: "x" }, out.verbatim(["Error: x"], "stack"));
  const [, ...lines] = sent();
  expect(lines.map((l) => l.t)).toEqual(["hello", "failure", "verbatim"]);
});

test("isHuman asks the gate about the named stream and defaults to stdout", () => {
  out.__test__.setHuman((stream) => stream === "stderr");
  expect(out.isHuman("stderr")).toBe(true);
  expect(out.isHuman("stdout")).toBe(false);
  expect(out.isHuman()).toBe(false);
});

test("a helper that exits non-zero leaves a warn line in the cli log", () => {
  process.env.RT_UI_FAKE = JSON.stringify({ record, exit: 2 });
  out.print(out.line("done", "Skills linked"));
  expect(stdout.join("")).toBe("[ok] Skills linked\n");
  const entry = lastCliLogLine();
  expect(entry.level).toBe("warn");
  expect(entry.module).toBe("rt-ui");
  expect(entry.msg).toBe("rt-ui render exited non-zero; printed plain text instead");
  expect(entry.exitCode).toBe(2);
  expect(entry.bin).toBe(FAKE);
});

test("a missing helper leaves a warn line naming what was tried", () => {
  const missing = join(dir, "no-such-binary");
  process.env.RT_UI_BIN = missing;
  out.print(out.line("done", "Skills linked"));
  expect(stdout.join("")).toBe("[ok] Skills linked\n");
  const entry = lastCliLogLine();
  expect(entry.level).toBe("warn");
  expect(entry.module).toBe("rt-ui");
  expect(entry.msg).toBe("rt-ui was not found; printed plain text instead");
  expect(String(entry.error)).toContain(missing);
});

test("the helper-failure warn line is written once per process", () => {
  process.env.RT_UI_FAKE = JSON.stringify({ record, exit: 2 });
  const before = cliLogLines().filter((e) => e.module === "rt-ui").length;
  out.print(out.line("done", "one"));
  out.print(out.line("done", "two"));
  expect(stdout.join("")).toBe("[ok] one\n[ok] two\n");
  expect(cliLogLines().filter((e) => e.module === "rt-ui").length).toBe(before + 1);
});

test("off a terminal no helper runs and nothing is logged about it", () => {
  out.__test__.setHuman(() => false);
  const before = cliLogLines().length;
  out.print(out.line("done", "x"));
  expect(cliLogLines().length).toBe(before);
});
```

The latch is module state in `out.ts`, so `__test__.reset()` (already in this file's `afterEach`) must clear it, or the second log test in a run finds no line; Step 4 does that.

- [ ] **Step 2: Run them to verify they fail**

Run (repo root): `bun test lib/ui/__tests__/out.test.ts`
Expected: FAIL. `out.isHuman` is not a function; the trailing-blocks test gets only the failure line; the log tests throw `no cli log was written` or read an unrelated line; the once-per-process test finds no new line at all.

- [ ] **Step 3: Export the event writer from `lib/cli-logger.ts`**

Replace the `writeCliLogLine` function (its doc comment through its closing brace, lines 229 to 247) with:

```ts
export type CliLogLevel = "debug" | "warn" | "error";

function writeCliLogLine(level: CliLogLevel, module: string, message: string, context: Record<string, unknown>): void {
  try {
    const dir = logsDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ time: new Date().toISOString(), level, module, msg: message, ...context }) + "\n";
    const fd = openSync(logPath(), "a");
    try {
      writeSync(fd, line);
    } finally {
      closeSync(fd);
    }
  } catch { /* logging must never break a command */ }
}

/**
 * One structured line on the cli surface outside the per-command record:
 * a failure's raw detail, a stack with no command record to carry it, a
 * helper that would not spawn. Never throws.
 */
export function logCliEvent(level: CliLogLevel, module: string, message: string, context: Record<string, unknown> = {}): void {
  writeCliLogLine(level, module, message, context);
}
```

The `setBusyLogSink` call inside `installCliLogging` keeps calling `writeCliLogLine` as it does today.

- [ ] **Step 4: Extend `lib/ui/out.ts`**

Add the import after the `resolveRtUi` import:

```ts
import { logCliEvent } from "../cli-logger.ts";
```

Change `type Stream = "stdout" | "stderr";` to `export type Stream = "stdout" | "stderr";`.

Replace `renderStyled` (the whole function, keeping the `const RENDER_TIMEOUT_MS = 2000;` line above it) with:

```ts
let helperWarned = false;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// The plain fallback keeps the person's words; the log keeps the reason they
// were plain, which is otherwise invisible on an installed machine. One line
// per process: every later block set on that machine fails the same way.
function helperFailed(what: string, context: Record<string, unknown>): void {
  if (helperWarned) return;
  helperWarned = true;
  logCliEvent("warn", "rt-ui", `${what}; printed plain text instead`, context);
}

function renderStyled(blocks: Block[], stream: Stream): string | null {
  let bin: string;
  try {
    bin = resolveRtUi();
  } catch (err) {
    helperFailed("rt-ui was not found", { error: errorText(err) });
    return null;
  }
  try {
    const columns = (stream === "stdout" ? process.stdout : process.stderr).columns ?? 80;
    const args = [bin, "render", "--width", String(columns)];
    if (process.env.NO_COLOR) args.push("--no-color");
    const input = encodeLine({ t: "hello", protocol: PROTOCOL_VERSION }) + blocks.map(encodeLine).join("");
    const r = Bun.spawnSync(args, { stdin: Buffer.from(input), stdout: "pipe", stderr: "pipe", env: { ...process.env }, timeout: RENDER_TIMEOUT_MS });
    if (r.exitCode === 0 && r.success) return r.stdout.toString();
    // A helper killed by the timeout has exitCode null and signalCode SIGTERM.
    helperFailed("rt-ui render exited non-zero", { bin, exitCode: r.exitCode, signalCode: r.signalCode, stderr: r.stderr.toString().trim().slice(-500) });
    return null;
  } catch (err) {
    helperFailed("rt-ui render did not spawn", { bin, error: errorText(err) });
    return null;
  }
}
```

In `__test__.reset()`, add `helperWarned = false;` as its first line, so it reads:

```ts
  reset(): void {
    helperWarned = false;
    human = realHuman;
    humanStream = "stdout";
  },
```

Replace `fail` with:

```ts
/** A failure, on stderr, with any blocks that belong under it (a stack, an excerpt) in the same write. */
export function fail(f: FailureInput, ...after: Block[]): void {
  emit([failure(f), ...after], "stderr");
}
```

Add after `payloadOnStdout`:

```ts
/** Whether a person is reading `stream` right now: the gate print and fail apply. */
export function isHuman(stream: Stream = "stdout"): boolean {
  return human(stream);
}
```

- [ ] **Step 5: Run the tests and the guards**

Run (repo root): `bun test lib/ui/__tests__/ lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-spawn-without-env.test.ts && bun run typecheck`
Expected: all pass, the hang test included: it still ends inside 5 s because the `timeout: RENDER_TIMEOUT_MS` stays on the spawn. `no-eager-tui` matters because `lib/errors.ts` (Task 3) puts `out.ts`, and through it `cli-logger.ts`, on the daemon's import graph; `cli-logger.ts` imports `rt-paths.ts`, `state/busy.ts` (a value import of `setBusyLogSink`; `busy.ts` itself imports only a type from `daemon-logger.ts` and loads it dynamically) and `team/redact.ts`, none of which that test bans, and it runs nothing at import time (`pruneOldLogs` runs from `logCommand`).

- [ ] **Step 6: Commit**

```bash
git add lib/cli-logger.ts lib/ui/out.ts lib/ui/__tests__/out.test.ts
git commit -m "lib/ui: fail takes trailing blocks, and a dead helper leaves a warn line in the cli log

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `lib/errors.ts`: the error type moves and `exitUserError` fails on stderr

**Files:**
- Create: `lib/errors.ts`
- Modify: `lib/setup/errors.ts` (becomes a re-export)
- Create: `lib/__tests__/errors.test.ts`
- Create: `lib/ui/__tests__/capture-out.ts`
- Modify (import path only): the 40 files listed in Step 6
- Modify: `commands/__tests__/repos-reidentify.test.ts`, `commands/__tests__/repos-locate.test.ts`, `commands/__tests__/release-apps.test.ts`, `commands/__tests__/team-join.test.ts`, `commands/__tests__/team.test.ts`, `commands/__tests__/deps.test.ts`, `commands/__tests__/release-update-machine.test.ts`

**Interfaces:**
- Consumes: `envelope` (`lib/setup/contract.ts`, no imports of its own); `out.fail`, `out.json`, `out.cmd`, `out.FailureInput` (`lib/ui/out.ts`, Task 2 and phase 1); `logCliEvent` (Task 2).
- Produces, all exported from `lib/errors.ts` and re-exported by `lib/setup/errors.ts`:
  - `interface UserActionableErrorOptions { why?: string; next?: string; log?: string }`
  - `class UserActionableError extends Error { constructor(code: string, message: string, extra?: Record<string, unknown>, options?: UserActionableErrorOptions); readonly code; readonly extra; readonly why?; readonly next?; readonly log? }`
  - `userErrorPayload(err, now?)` unchanged.
  - `failureFor(err: UserActionableError): FailureInput`
  - `exitUserError(err, json: boolean, verb: string, print?: (s: string) => void): never`
  - Test helper `lib/ui/__tests__/capture-out.ts`, the one capture helper for phases 2, 3 and 4 (they import it from here and create no copy): `captureOut()` returns `{ stdout(): string; stderr(): string; lines(): string[]; errLines(): string[]; reset(): void; restore(): void }`, where `reset()` calls `out.__test__.reset()` (so a test that runs a payload verb then a human verb can put `humanStream` back) and `restore()` undoes the stream patch and resets. `out.__test__.setHuman` is left to the caller: every test in this plan calls `out.__test__.setHuman(() => false)` right after `captureOut()`.

- [ ] **Step 1: Write the test helper**

Create `lib/ui/__tests__/capture-out.ts`:

```ts
import * as out from "../out.ts";

export interface CapturedOut {
  stdout(): string;
  stderr(): string;
  /** stdout split on newlines, without the trailing empty line. */
  lines(): string[];
  errLines(): string[];
  /** out.__test__.reset(): the gate and humanStream go back to their defaults; set the gate again after it. */
  reset(): void;
  /** Puts the real stream writers back, then reset(). Call it in a finally or afterEach. */
  restore(): void;
}

/**
 * Captures every write to process.stdout and process.stderr until restore().
 * The human gate is the caller's: call out.__test__.setHuman(() => false)
 * after this to read plain text, or set a fake helper to read what it sends.
 */
export function captureOut(): CapturedOut {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  const text = (chunk: string | Uint8Array) => (typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
  const split = (joined: string) => (joined === "" ? [] : joined.replace(/\n$/, "").split("\n"));
  process.stdout.write = ((chunk: string | Uint8Array) => {
    outChunks.push(text(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    errChunks.push(text(chunk));
    return true;
  }) as typeof process.stderr.write;
  return {
    stdout: () => outChunks.join(""),
    stderr: () => errChunks.join(""),
    lines: () => split(outChunks.join("")),
    errLines: () => split(errChunks.join("")),
    reset: () => out.__test__.reset(),
    restore: () => {
      process.stdout.write = realOut;
      process.stderr.write = realErr;
      out.__test__.reset();
    },
  };
}
```

- [ ] **Step 2: Write the failing tests**

Create `lib/__tests__/errors.test.ts`:

```ts
import { test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { UserActionableError, exitUserError, failureFor, userErrorPayload } from "../errors.ts";
import { UserActionableError as ViaShim, exitUserError as exitViaShim, userErrorPayload as payloadViaShim } from "../setup/errors.ts";
import { logsDir } from "../rt-paths.ts";
import * as out from "../ui/out.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";

let captured: ReturnType<typeof captureOut>;
let exitSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  captured = captureOut();
  out.__test__.setHuman(() => false);
  exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`);
  }) as never);
});
afterEach(() => {
  captured.restore();
  exitSpy.mockRestore();
});

function lastCliLogLine(): Record<string, unknown> {
  const dir = logsDir();
  const file = readdirSync(dir).filter((f) => f.startsWith("cli.") && f.endsWith(".log")).sort().at(-1);
  if (!file) throw new Error("no cli log was written");
  const lines = readFileSync(join(dir, file), "utf8").trim().split("\n");
  return JSON.parse(lines.at(-1)!) as Record<string, unknown>;
}

const teamError = () =>
  new UserActionableError("team-secrets-unreadable", "This Mac cannot read the acme team's secrets yet", { team: "acme" }, {
    why: "No age key on this Mac matches the team's recipients.",
    next: "rt team pull",
    log: "sops -d /x/board.json: Failed to get the data key required to decrypt the SOPS file.",
  });

test("carries why, next and log beside the contract fields, all optional", () => {
  const err = teamError();
  expect(err).toBeInstanceOf(Error);
  expect(err.code).toBe("team-secrets-unreadable");
  expect(err.message).toBe("This Mac cannot read the acme team's secrets yet");
  expect(err.extra).toEqual({ team: "acme" });
  expect(err.why).toBe("No age key on this Mac matches the team's recipients.");
  expect(err.next).toBe("rt team pull");
  expect(err.log).toContain("sops -d");
  const bare = new UserActionableError("usage", "usage: rt tools install <tool> [--json]");
  expect(bare.extra).toEqual({});
  expect(bare.why).toBeUndefined();
  expect(bare.next).toBeUndefined();
  expect(bare.log).toBeUndefined();
});

test("the --json payload is unchanged: contract, at, and error with code, message and extra only", () => {
  const payload = userErrorPayload(teamError(), new Date("2026-10-01T12:00:00.000Z"));
  expect(payload).toEqual({
    contract: 1,
    at: "2026-10-01T12:00:00.000Z",
    error: { code: "team-secrets-unreadable", message: "This Mac cannot read the acme team's secrets yet", team: "acme" },
  });
});

test("lib/setup/errors.ts re-exports the same bindings", () => {
  expect(ViaShim).toBe(UserActionableError);
  expect(exitViaShim).toBe(exitUserError);
  expect(payloadViaShim).toBe(userErrorPayload);
});

test("failureFor maps the error onto a failure block", () => {
  expect(failureFor(teamError())).toEqual({
    title: "This Mac cannot read the acme team's secrets yet",
    why: "No age key on this Mac matches the team's recipients.",
    next: { text: "rt team pull", role: "command" },
    details: "the full output is in the rt log",
  });
  expect(failureFor(new UserActionableError("usage", "usage: rt tools install <tool> [--json]"))).toEqual({ title: "usage: rt tools install <tool> [--json]" });
});

test("exitUserError --json hands the envelope line to print when given", () => {
  const lines: string[] = [];
  expect(() => exitUserError(teamError(), true, "team pull", (s) => lines.push(s))).toThrow("exit 2");
  expect(lines).toHaveLength(1);
  const { at, ...body } = JSON.parse(lines[0]!);
  expect(typeof at).toBe("string");
  expect(body).toEqual({ contract: 1, error: { code: "team-secrets-unreadable", message: "This Mac cannot read the acme team's secrets yet", team: "acme" } });
  expect(captured.stdout()).toBe("");
  expect(captured.stderr()).toBe("");
});

test("exitUserError --json without print writes the same line on stdout", () => {
  expect(() => exitUserError(teamError(), true, "team pull")).toThrow("exit 2");
  const written = captured.stdout();
  expect(written.endsWith("\n")).toBe(true);
  expect(JSON.parse(written).error.code).toBe("team-secrets-unreadable");
  expect(written.split("\n")).toHaveLength(2);
  expect(captured.stderr()).toBe("");
});

test("exitUserError without --json draws the failure on stderr with no verb prefix and exits 2", () => {
  expect(() => exitUserError(teamError(), false, "team pull", () => { throw new Error("print must not be used for a human failure"); })).toThrow("exit 2");
  expect(captured.stdout()).toBe("");
  expect(captured.stderr()).toBe(
    "[failed] This Mac cannot read the acme team's secrets yet\n" +
      "  why: No age key on this Mac matches the team's recipients.\n" +
      "  next: rt team pull\n" +
      "  the full output is in the rt log\n",
  );
  expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(2);
});

test("a log detail lands in the cli log, never on screen", () => {
  expect(() => exitUserError(teamError(), false, "team pull")).toThrow("exit 2");
  expect(captured.stderr()).not.toContain("sops -d");
  const entry = lastCliLogLine();
  expect(entry.level).toBe("warn");
  expect(entry.module).toBe("errors");
  expect(entry.code).toBe("team-secrets-unreadable");
  expect(String(entry.detail)).toContain("sops -d /x/board.json");
});

test("an error with no why or next is one line", () => {
  expect(() => exitUserError(new UserActionableError("usage", "usage: rt tools install <tool> [--json]"), false, "tools install")).toThrow("exit 2");
  expect(captured.stderr()).toBe("[failed] usage: rt tools install <tool> [--json]\n");
});

test("a multi-line message collapses to one title line in plain output", () => {
  const err = new UserActionableError("members-error", "first line\nsecond line");
  expect(() => exitUserError(err, false, "team members sync")).toThrow("exit 2");
  expect(captured.stderr()).toBe("[failed] first line second line\n");
});
```

- [ ] **Step 3: Run them to verify they fail**

Run (repo root): `bun test lib/__tests__/errors.test.ts`
Expected: FAIL, cannot find module `../errors.ts`.

- [ ] **Step 4: Create `lib/errors.ts`**

```ts
/**
 * Expected failures. A command that cannot continue throws one of these
 * with what happened in plain words; the dispatch seam in cli.ts, the
 * exitUserError helper and a --json envelope all read the same object, so
 * the words are written once.
 */
import { logCliEvent } from "./cli-logger.ts";
import { envelope } from "./setup/contract.ts";
import * as out from "./ui/out.ts";

export interface UserActionableErrorOptions {
  /** Why it happened, one plain sentence: the failure block's `why` callout. */
  why?: string;
  /** The command to run, as the person would type it: the `next` callout. */
  next?: string;
  /** Technical detail (raw child output, paths) for the rt log; never shown. */
  log?: string;
}

export class UserActionableError extends Error {
  readonly why?: string;
  readonly next?: string;
  readonly log?: string;

  constructor(
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {},
    options: UserActionableErrorOptions = {},
  ) {
    super(message);
    this.why = options.why;
    this.next = options.next;
    this.log = options.log;
  }
}

export function userErrorPayload(err: UserActionableError, now = new Date()) {
  return envelope({ error: { code: err.code, message: err.message, ...err.extra } }, now);
}

const LOG_DETAILS = "the full output is in the rt log";

export function failureFor(err: UserActionableError): out.FailureInput {
  return {
    title: err.message,
    ...(err.why ? { why: err.why } : {}),
    ...(err.next ? { next: out.cmd(err.next) } : {}),
    ...(err.log ? { details: LOG_DETAILS } : {}),
  };
}

function noteDetail(err: UserActionableError): void {
  if (err.log) logCliEvent("warn", "errors", err.message, { code: err.code, detail: err.log });
}

/**
 * Prints the contract's exit-2 payload (--json, on stdout, through `print`
 * when the caller has one) or the failure block on stderr, then exits 2.
 * `verb` is kept for the callers; the block carries no prefix.
 */
export function exitUserError(err: UserActionableError, json: boolean, _verb: string, print?: (s: string) => void): never {
  noteDetail(err);
  if (json) {
    const payload = userErrorPayload(err);
    if (print) print(JSON.stringify(payload));
    else out.json(payload);
  } else {
    out.fail(failureFor(err));
  }
  process.exit(2);
}
```

Replace the whole of `lib/setup/errors.ts` with:

```ts
export { UserActionableError, exitUserError, failureFor, userErrorPayload, type UserActionableErrorOptions } from "../errors.ts";
```

- [ ] **Step 5: Run the new tests and the guard**

Run (repo root): `bun test lib/__tests__/errors.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts && bun run typecheck`
Expected: PASS. `no-raw-output` must pass with `lib/errors.ts` absent from the allowlist (it prints only through `out`).

- [ ] **Step 6: Point every importer outside phase 3's files at `lib/errors.ts`**

Run from the repo root, exactly this list (every importer of `lib/setup/errors.ts` that phase 3 does not own):

```bash
sed -i '' 's#setup/errors\.ts#errors.ts#' \
  commands/apps.ts commands/cron.ts commands/deps.ts commands/release.ts commands/repos-reidentify.ts \
  commands/repos.ts commands/services.ts commands/skills-init.ts commands/skills-writing-style.ts \
  commands/skills.ts commands/team.ts commands/tools.ts commands/__tests__/skills-init.test.ts \
  lib/daemon/handlers/team-snapshot.ts lib/daemon/team-snapshots.ts lib/daemon/__tests__/handlers-team-snapshot.test.ts \
  lib/release/dev-app-stage.ts lib/release/update-machine.ts \
  lib/release/__tests__/dev-app-stage.test.ts lib/release/__tests__/update-machine.test.ts \
  lib/team/create.ts lib/team/invite-crypto.ts lib/team/invite-records.ts lib/team/invite.ts lib/team/join.ts \
  lib/team/members.ts lib/team/publish.ts lib/team/relay-client.ts lib/team/slug.ts lib/team/team-local.ts \
  lib/team/__tests__/create.test.ts lib/team/__tests__/invite-crypto.test.ts lib/team/__tests__/invite-records.test.ts \
  lib/team/__tests__/invite.test.ts lib/team/__tests__/join.test.ts lib/team/__tests__/members.test.ts \
  lib/team/__tests__/publish.test.ts lib/team/__tests__/relay-client.test.ts lib/team/__tests__/slug.test.ts \
  scripts/build-dev-app.ts
rg -n "setup/errors" commands lib scripts cli.ts
```

The substitution keeps each file's relative prefix (`../setup/errors.ts` becomes `../errors.ts`, `../../lib/setup/errors.ts` becomes `../../lib/errors.ts`). The `rg` must print exactly four files, phase 3's importers, which stay on the shim: `commands/setup.ts:36`, `commands/logins.ts:16`, `commands/uninstall.ts:14` and `commands/__tests__/setup-apply.test.ts:19`. The files under `lib/setup/` import the shim as `./errors.ts` or `../errors.ts`, so they never match this pattern and stay as they are. `commands/team.ts:14` is a doc comment the `sed` rewrote from `lib/setup/errors.ts` to `lib/errors.ts`, which is now the true path; it no longer matches either.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit the move**

```bash
git add lib/errors.ts lib/setup/errors.ts lib/__tests__/errors.test.ts lib/ui/__tests__/capture-out.ts commands lib/daemon lib/release lib/team scripts/build-dev-app.ts
git commit -m "lib/errors: UserActionableError moves up with why, next and log; exitUserError fails on stderr

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(`bun run test` is red at this commit for the seven test files below; the next steps fix them and the second commit of this task lands within the same task.)

- [ ] **Step 8: Retarget `commands/__tests__/repos-reidentify.test.ts`**

Add the imports (`ui`, not `out`: this file already has a `let out: string[]`):

```ts
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
```

Every retargeted test in Steps 8 to 14 follows `captureOut()` with `ui.__test__.setHuman(() => false)`: the helper leaves the gate to the caller, and a `bun test` run from a terminal has a TTY on stdout. `io.restore()` resets the gate again.

Replace the test `usage error on a missing positional` with:

```ts
  test("usage error on a missing positional", async () => {
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => reposReidentify(["github.com/acme/old"], {}, { print: (s) => out.push(s) }));
      expect(code).toBe(2);
      expect(out).toEqual([]);
      expect(io.stderr()).toContain("[failed] reidentify takes two identities, got 1; usage: rt repos reidentify");
      expect(io.stderr()).not.toContain("rt repos reidentify:");
    } finally {
      io.restore();
    }
  });
```

Replace the test `an identity that is not a remote is a refusal with no table` with:

```ts
  test("an identity that is not a remote is a refusal with no table", async () => {
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => reposReidentify(["/tmp/x", "github.com/acme/new"], {}, { print: (s) => out.push(s) }));
      expect(code).toBe(2);
      expect(out).toEqual([]);
      expect(io.stderr()).toContain("remote-kind");
    } finally {
      io.restore();
    }
  });
```

- [ ] **Step 9: Retarget `commands/__tests__/repos-locate.test.ts`**

Add the imports `import * as ui from "../../lib/ui/out.ts";` and `import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";`. Replace the three tests `a refusal exits 2 with the typed message`, `an unknown flag is a usage error` and `--repo without a value is a usage error` with:

```ts
  test("a refusal exits 2 with the typed message", async () => {
    const plain = join(scratch, "plain");
    mkdirSync(plain);
    const deps = testDeps();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => reposLocate([plain], {}, deps));
      expect(code).toBe(2);
      expect(deps.lines).toEqual([]);
      expect(io.stderr()).toContain("not a git repository");
    } finally {
      io.restore();
    }
  });

  test("an unknown flag is a usage error", async () => {
    const deps = testDeps();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => reposLocate(["--nope"], {}, deps));
      expect(code).toBe(2);
      expect(io.stderr()).toContain("usage: rt repos locate");
    } finally {
      io.restore();
    }
  });

  test("--repo without a value is a usage error", async () => {
    const deps = testDeps();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => reposLocate(["--repo"], {}, deps));
      expect(code).toBe(2);
      expect(io.stderr()).toContain("--repo needs a value");
    } finally {
      io.restore();
    }
  });
```

- [ ] **Step 10: Retarget `commands/__tests__/release-apps.test.ts`**

Add the imports `import * as ui from "../../lib/ui/out.ts";` and `import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";`. Change the `Harness` interface and `invoke` to:

```ts
interface Harness {
  runs: ReleaseAppOptions[];
  logs: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
  exitCalled: number | undefined;
}

async function invoke(args: string[], o: { result?: ReleaseAppReport } = {}): Promise<Harness> {
  const h: Harness = { runs: [], logs: [], stdout: "", stderr: "", exitCode: 0, exitCalled: undefined };
  const io = captureOut();
  ui.__test__.setHuman(() => false);
  const logSpy = spyOn(console, "log").mockImplementation((...a: unknown[]) => { h.logs.push(a.map(String).join(" ")); });
  const exitSpy = spyOn(process, "exit").mockImplementation((code?: number) => {
    h.exitCalled = code;
    throw new Error("process.exit sentinel");
  });
  process.exitCode = 0;
  try {
    await releaseApps(args, {}, {
      seams: seams(),
      run: async (_s, opts) => { h.runs.push(opts); return o.result ?? report("released"); },
    });
  } catch (err) {
    if (!String(err).includes("process.exit sentinel")) throw err;
  } finally {
    h.stdout = io.stdout();
    h.stderr = io.stderr();
    io.restore();
    h.exitCode = Number(process.exitCode ?? 0);
    process.exitCode = 0;
    exitSpy.mockRestore();
    logSpy.mockRestore();
  }
  return h;
}
```

Change the test `an app name is a usage error that says the verb takes none` so its last line reads:

```ts
    expect(h.logs).toEqual([]);
    expect(h.stderr).toContain("[failed] usage: rt release apps [--dry-run]");
```

Change the test `--json usage errors come back as a JSON envelope` so the body line reads:

```ts
    const body = JSON.parse(h.stdout.trim()) as { error: { code: string } };
```

(`releaseApps`'s `usage` calls `exitUserError` with no `print`, so the envelope now comes through `out.json` on stdout rather than `console.log`.)

- [ ] **Step 11: Retarget `commands/__tests__/team-join.test.ts`**

Add the imports `import * as ui from "../../lib/ui/out.ts";` and `import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";`. Replace the test `human mode: code-on-argv prints the message and exits 2` with:

```ts
  test("human mode: code-on-argv prints the message and exits 2", async () => {
    const deps = baseDeps();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => teamJoin(["ABC"], {}, deps));
      expect(code).toBe(2);
      expect(deps.lines).toEqual([]);
      expect(io.stderr()).toContain("[failed] pass the invite code on stdin, never as an argument");
    } finally {
      io.restore();
    }
  });
```

Replace the test `a keychain failure in human mode prints a clean one-liner, not a raw stack` with:

```ts
  test("a keychain failure in human mode prints a clean one-liner, not a raw stack", async () => {
    const probes = fakeProbes({ home: HOME, fetch: relayFetch(), exec: () => ({ code: 0, stdout: "", stderr: "" }) });
    const deps = baseDeps({ probes, ageKeySeam: new FakeAgeKeySeamLocked() });
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => teamJoin([], {}, deps));
      expect(code).toBe(2);
      expect(deps.lines).toEqual([]);
      expect(io.stderr()).toStartWith("[failed] ");
      expect(io.stderr()).toContain("keychain");
      expect(io.stderr()).not.toContain("\n    at ");
    } finally {
      io.restore();
    }
  });
```

- [ ] **Step 12: Retarget `commands/__tests__/team.test.ts`**

Add the imports `import * as ui from "../../lib/ui/out.ts";` and `import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";`. Replace the test `missing name, human mode: prints usage and exits 2` with:

```ts
  test("missing name, human mode: prints usage and exits 2", async () => {
    const deps = baseDeps();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => teamCreate(["--remote", "https://github.com/acme/repo.git"], {}, deps));
      expect(code).toBe(2);
      expect(deps.lines).toEqual([]);
      expect(io.stderr()).toContain("[failed] usage:");
    } finally {
      io.restore();
    }
  });
```

Replace the test `missing --handle, human mode: prints usage and exits 2` with:

```ts
  test("missing --handle, human mode: prints usage and exits 2", async () => {
    const deps = baseDeps();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => teamInvite([], {}, deps));
      expect(code).toBe(2);
      expect(deps.lines).toEqual([]);
      expect(io.stderr()).toContain("[failed] usage:");
    } finally {
      io.restore();
    }
  });
```

- [ ] **Step 13: Retarget `commands/__tests__/deps.test.ts`**

Add the imports `import * as ui from "../../lib/ui/out.ts";` and `import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";`. Replace `runCapturingExit` with:

```ts
async function runCapturingExit(fn: () => Promise<void>): Promise<{ exitCode: number | undefined; logs: string[]; errors: string[]; stderr: string }> {
  const logs: string[] = [];
  const errors: string[] = [];
  const io = captureOut();
  ui.__test__.setHuman(() => false);
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  const errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  try {
    await fn();
    return { exitCode: undefined, logs, errors, stderr: io.stderr() };
  } catch {
    const exitCode = exitSpy.mock.calls.at(-1)?.[0] as number | undefined;
    return { exitCode, logs, errors, stderr: io.stderr() };
  } finally {
    io.restore();
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }
}
```

Replace the test `depsLink exits 2 on a user-actionable refusal in human mode (F13: occupied)` with:

```ts
  test("depsLink exits 2 on a user-actionable refusal in human mode (F13: occupied)", async () => {
    const path = linkPath(home, "gh");
    const p = bundleProbe({ files: { [path]: "#!/bin/sh\necho unrelated\n" } });
    const { exitCode, logs, stderr } = await runCapturingExit(() => depsLink(["gh"], {}, p));
    expect(exitCode).toBe(2);
    expect(logs).toEqual([]);
    expect(stderr).toContain("[failed] ");
    expect(stderr).toContain("exists and is not a mattstack-managed link");
  });
```

The `--json` sibling test is unchanged: `depsLink` passes `console.log` as `print`, so its envelope still arrives through the `console.log` spy.

- [ ] **Step 14: Retarget `commands/__tests__/release-update-machine.test.ts`**

Add the imports `import * as ui from "../../lib/ui/out.ts";` and `import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";`. Replace `runExpectingProcessExit` with:

```ts
/** exitUserError always calls the real process.exit, never a seam... spy on it to catch the code without killing the test process. */
async function runExpectingProcessExit(fn: () => Promise<void>): Promise<{ code: number | undefined; logs: string[]; stdout: string; stderr: string }> {
  const logs: string[] = [];
  const io = captureOut();
  ui.__test__.setHuman(() => false);
  const logSpy = spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  });
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  try {
    await fn();
    return { code: undefined, logs, stdout: io.stdout(), stderr: io.stderr() };
  } catch {
    return { code: exitSpy.mock.calls.at(-1)?.[0] as number | undefined, logs, stdout: io.stdout(), stderr: io.stderr() };
  } finally {
    io.restore();
    exitSpy.mockRestore();
    logSpy.mockRestore();
  }
}
```

Replace the three tests that use it:

```ts
  test("non-interactive without --yes refuses via the real process.exit(2) and the contract error envelope", async () => {
    const seams = fakeSeams({ isTTY: false });
    const { code, stdout } = await runExpectingProcessExit(() => releaseUpdateMachine(["--json"], {}, seams));
    expect(code).toBe(2);
    const body = JSON.parse(stdout.trim());
    expect(body.contract).toBe(1);
    expect(body.error.code).toBe("update-machine-noninteractive");
  });

  test("non-interactive without --yes, human mode, also exits 2", async () => {
    const seams = fakeSeams({ isTTY: false });
    const { code, logs, stderr } = await runExpectingProcessExit(() => releaseUpdateMachine([], {}, seams));
    expect(code).toBe(2);
    expect(logs).toEqual([]);
    expect(stderr).toContain("[failed] refuses to run state-changing legs on a non-interactive terminal without --yes");
  });
```

and

```ts
  test("--plan and --verify-only together are refused via the real process.exit(2), not a silent pick-one", async () => {
    const seams = fakeSeams();
    const { code, stdout } = await runExpectingProcessExit(() => releaseUpdateMachine(["--plan", "--verify-only", "--json"], {}, seams));
    expect(code).toBe(2);
    const body = JSON.parse(stdout.trim());
    expect(body.error.code).toBe("update-machine-plan-verify-only");
  });
```

- [ ] **Step 15: Run the retargeted files and the whole unit suite**

Run (repo root):

```bash
bun test commands/__tests__/repos-reidentify.test.ts commands/__tests__/repos-locate.test.ts commands/__tests__/release-apps.test.ts commands/__tests__/team-join.test.ts commands/__tests__/team.test.ts commands/__tests__/deps.test.ts commands/__tests__/release-update-machine.test.ts
bun run test
```

Expected: both green. If `bun run test` shows a failure in a file this task did not touch, re-run that file alone and against `origin/main` before calling it pre-existing, and name it in your report.

- [ ] **Step 16: Commit**

```bash
git add commands/__tests__/repos-reidentify.test.ts commands/__tests__/repos-locate.test.ts commands/__tests__/release-apps.test.ts commands/__tests__/team-join.test.ts commands/__tests__/team.test.ts commands/__tests__/deps.test.ts commands/__tests__/release-update-machine.test.ts
git commit -m "tests: read exitUserError's human line from stderr, and its --json line from stdout

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The dispatch seam in `cli.ts`

**Files:**
- Modify: `lib/errors.ts` (append `exitFromDispatch`, `exitUnexpected`)
- Modify: `cli.ts` (lines 166 to 186)
- Modify: `lib/__tests__/errors.test.ts` (append)
- Create: `e2e/tests/errors.test.ts`

**Interfaces:**
- Consumes: `out.fail(f, ...after)`, `out.isHuman("stderr")`, `out.verbatim`, `out.cmd` (Task 2, phase 1); `logCliEvent` (Task 2); `ExecFailure` (`lib/plugins.ts`); the e2e harness `rt`, `createTestHome` (`e2e/harness.ts`).
- Produces, exported from `lib/errors.ts`:
  - `exitFromDispatch(err: unknown): never`: a `UserActionableError` goes through `exitUserError(err, process.argv.includes("--json"), "")`, so it is drawn with `failureFor` on stderr, or under `--json` written as the one envelope line through `out.json`, its `log` noted either way, exit 2; anything else goes to `exitUnexpected`.
  - `exitUnexpected(err: unknown): never`: writes `{ level: "error", module: "cli", msg: <message>, stack }` to the cli log; draws `failure` with title `rt hit an unexpected error`, hint = first line of the message, `next` = `rt daemon logs`, no details pointer; appends a `verbatim` block captioned `stack` when `!out.isHuman("stderr") || process.env.RT_LOG_LEVEL === "debug"`; never writes to stdout; exit 1.

- [ ] **Step 1: Write the failing unit tests**

Append to `lib/__tests__/errors.test.ts`. First change three existing import lines and add one:

```ts
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { UserActionableError, exitFromDispatch, exitUnexpected, exitUserError, failureFor, userErrorPayload } from "../errors.ts";
```

(the `fs`, `path` and `../errors.ts` lines replace the ones Task 3 wrote; `os` is new; `../ui/out.ts` is already imported as `out`). Then append:

```ts
const UNEXPECTED_HEAD = "[failed] rt hit an unexpected error  kaboom\n  next: rt daemon logs\n";

/** Runs fn with --json on argv, the way the real gate and the seam see it. */
function withJsonArgv(fn: () => void): void {
  const argv = process.argv;
  process.argv = [...argv, "--json"];
  try {
    fn();
  } finally {
    process.argv = argv;
  }
}

test("exitFromDispatch: an expected failure is the same block as exitUserError, exit 2", () => {
  expect(() => exitFromDispatch(teamError())).toThrow("exit 2");
  expect(captured.stdout()).toBe("");
  expect(captured.stderr()).toBe(
    "[failed] This Mac cannot read the acme team's secrets yet\n" +
      "  why: No age key on this Mac matches the team's recipients.\n" +
      "  next: rt team pull\n" +
      "  the full output is in the rt log\n",
  );
  expect(lastCliLogLine().module).toBe("errors");
});

test("exitFromDispatch: an expected failure under --json is the envelope on stdout, nothing on stderr, exit 2", () => {
  withJsonArgv(() => expect(() => exitFromDispatch(teamError())).toThrow("exit 2"));
  expect(captured.stderr()).toBe("");
  expect(captured.lines()).toHaveLength(1);
  const { at, ...body } = JSON.parse(captured.stdout());
  expect(typeof at).toBe("string");
  expect(body).toEqual({ contract: 1, error: { code: "team-secrets-unreadable", message: "This Mac cannot read the acme team's secrets yet", team: "acme" } });
  expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(2);
});

test("exitFromDispatch: an unexpected error under --json still writes nothing to stdout", () => {
  withJsonArgv(() => expect(() => exitFromDispatch(new Error("kaboom"))).toThrow("exit 1"));
  expect(captured.stdout()).toBe("");
  expect(captured.stderr().startsWith(UNEXPECTED_HEAD)).toBe(true);
});

test("exitFromDispatch: anything else is one line with the message as hint and the stack shown off a terminal, exit 1", () => {
  expect(() => exitFromDispatch(new Error("kaboom"))).toThrow("exit 1");
  expect(captured.stdout()).toBe("");
  const text = captured.stderr();
  expect(text.startsWith(UNEXPECTED_HEAD + "stack:\n  Error: kaboom\n")).toBe(true);
  expect(text).toContain("      at ");
  expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
});

test("exitUnexpected writes the message and stack to the cli log", () => {
  expect(() => exitUnexpected(new Error("kaboom in the log"))).toThrow("exit 1");
  const entry = lastCliLogLine();
  expect(entry.level).toBe("error");
  expect(entry.module).toBe("cli");
  expect(entry.msg).toBe("kaboom in the log");
  expect(String(entry.stack)).toContain("Error: kaboom in the log");
  expect(String(entry.stack)).toContain("    at ");
});

test("a thrown non-Error has no stack: the hint is its text and the excerpt repeats it", () => {
  expect(() => exitUnexpected("boom")).toThrow("exit 1");
  expect(captured.stderr()).toBe("[failed] rt hit an unexpected error  boom\n  next: rt daemon logs\nstack:\n  boom\n");
});

test("a multi-line message gives a one-line hint", () => {
  expect(() => exitUnexpected(new Error("sops -d /x/rt.json: Failed to get the data key required to decrypt the SOPS file.\n\nGroup 0: FAILED"))).toThrow("exit 1");
  expect(captured.stderr().split("\n")[0]).toBe("[failed] rt hit an unexpected error  sops -d /x/rt.json: Failed to get the data key required to decrypt the SOPS file.");
});

test("escape sequences in a message or stack never reach the terminal", () => {
  const err = new Error("evil\x1b[2Jname");
  err.stack = "Error: evil\x1b[2Jname\n    at run (\x1b[31mboom.ts\x1b[0m:1:7)";
  expect(() => exitUnexpected(err)).toThrow("exit 1");
  expect(captured.stderr()).not.toContain("\x1b[");
  expect(captured.stderr()).toContain("[failed] rt hit an unexpected error  evilname");
  expect(captured.stderr()).toContain("      at run (boom.ts:1:7)");
});

test("at a terminal the stack stays in the log unless RT_LOG_LEVEL=debug", () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-errors-"));
  const record = join(dir, "record.ndjson");
  const savedBin = process.env.RT_UI_BIN;
  const savedFake = process.env.RT_UI_FAKE;
  const savedLevel = process.env.RT_LOG_LEVEL;
  process.env.RT_UI_BIN = resolve(import.meta.dir, "..", "ui", "__tests__", "fake-rt-ui.ts");
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  out.__test__.setHuman(() => true);
  const sentTypes = () => readFileSync(record, "utf8").trim().split("\n").slice(1).map((l) => (JSON.parse(l) as { t: string }).t);
  try {
    delete process.env.RT_LOG_LEVEL;
    expect(() => exitUnexpected(new Error("kaboom"))).toThrow("exit 1");
    expect(sentTypes()).toEqual(["hello", "failure"]);
    expect(captured.stderr()).toBe("STYLED\n");

    rmSync(record, { force: true });
    process.env.RT_LOG_LEVEL = "debug";
    expect(() => exitUnexpected(new Error("kaboom"))).toThrow("exit 1");
    expect(sentTypes()).toEqual(["hello", "failure", "verbatim"]);
  } finally {
    if (savedBin === undefined) delete process.env.RT_UI_BIN;
    else process.env.RT_UI_BIN = savedBin;
    if (savedFake === undefined) delete process.env.RT_UI_FAKE;
    else process.env.RT_UI_FAKE = savedFake;
    if (savedLevel === undefined) delete process.env.RT_LOG_LEVEL;
    else process.env.RT_LOG_LEVEL = savedLevel;
    rmSync(dir, { recursive: true, force: true });
  }
  expect(existsSync(record)).toBe(false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run (repo root): `bun test lib/__tests__/errors.test.ts`
Expected: FAIL, `exitFromDispatch` and `exitUnexpected` are not exported.

- [ ] **Step 3: Append the two exits to `lib/errors.ts`**

```ts
const UNEXPECTED_TITLE = "rt hit an unexpected error";
const LOG_VIEWER = "rt daemon logs";

/**
 * The top of the CLI: an expected failure takes exitUserError's route, so
 * the seam and a verb that handles its own --json write the same envelope;
 * anything else is one line for the person and a stack for the log.
 * ExecFailure is sorted out by the caller first, since its exit code is the
 * plugin's own.
 */
export function exitFromDispatch(err: unknown): never {
  if (err instanceof UserActionableError) return exitUserError(err, process.argv.includes("--json"), "");
  return exitUnexpected(err);
}

export function exitUnexpected(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? err.stack : String(err);
  logCliEvent("error", "cli", message, { stack });
  // The screen gets the stack only where a person is not reading it live, or
  // asked for it; the log always has it. Nothing here touches stdout, so an
  // agent that passed --json reads an empty stdout, never a half envelope.
  const showStack = !out.isHuman("stderr") || process.env.RT_LOG_LEVEL === "debug";
  out.fail(
    { title: UNEXPECTED_TITLE, hint: message.split("\n")[0] ?? message, next: out.cmd(LOG_VIEWER) },
    ...(showStack ? [out.verbatim(stack.split("\n"), "stack")] : []),
  );
  process.exit(1);
}
```

- [ ] **Step 4: Run the unit tests**

Run (repo root): `bun test lib/__tests__/errors.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Route `cli.ts` through the seam**

In `cli.ts`, replace lines 166 to 177 (the comment block starting `// User plugins merge into the tree at the root` through the closing brace of the `catch`) with:

```ts
  // User plugins merge into the tree at the root; built-ins always win.
  // ExecFailure propagates a plugin exec target's exit code as rt's own
  // (dispatch has already logged the error outcome by the time it rethrows);
  // every other error is sorted by lib/errors.ts.
  const { loadPluginTree, ExecFailure } = await import("./lib/plugins.ts");
  const fullTree = loadPluginTree(TREE);
  try {
    // --help/-h at any depth is intercepted by dispatch itself.
    await dispatch(fullTree, args, ["rt"], baseDir);
  } catch (err) {
    if (err instanceof ExecFailure) process.exit(err.code);
    const { exitFromDispatch } = await import("./lib/errors.ts");
    exitFromDispatch(err);
  }
```

Replace the tail of the file (the comment starting `// Rethrowing here reproduces exactly what a top-level await throw used to` through `__main().catch(...)`) with:

```ts
// An error from before dispatch (the plugin tree, notice routing) takes the
// same exit as one from a command, so no path prints a bare stack.
__main().catch(async (err) => {
  const { exitFromDispatch } = await import("./lib/errors.ts");
  exitFromDispatch(err);
});
```

Run: `bun run typecheck && bun test lib/__tests__/no-top-level-await.test.ts lib/__tests__/no-eager-tui.test.ts`
Expected: pass.

- [ ] **Step 6: Write the e2e test off a TTY**

Create `e2e/tests/errors.test.ts`:

```ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createTestHome, rt } from "../harness.ts";

/**
 * The error seam through the real binary with stdout and stderr piped: the
 * failure block prints plainly, the stack prints under it, and the exit
 * codes are the contract's.
 */
function installThrowingPlugin(home: string): void {
  const dir = join(home, ".mattstack", "user", "plugins", "e2e-seam");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "plugin.json"),
    JSON.stringify({ name: "e2e-seam", apiVersion: 1, commands: { "e2e-seam-boom": { description: "throws", module: "./boom.ts", hidden: true } } }, null, 2),
  );
  writeFileSync(join(dir, "boom.ts"), 'export async function run() { throw new Error("kaboom from the seam test"); }\n');
}

function cliLog(home: string): string {
  const dir = join(home, ".mattstack", "rt", "logs");
  return readdirSync(dir)
    .filter((f) => f.startsWith("cli.") && f.endsWith(".log"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("");
}

describe("the error seam off a terminal", () => {
  let home: string;
  let cleanup: () => void;

  beforeAll(() => {
    ({ path: home, cleanup } = createTestHome());
    installThrowingPlugin(home);
  });

  afterAll(() => cleanup());

  test("an unexpected error prints one line, the stack under it, exits 1, and the log has the stack", async () => {
    const result = await rt(["e2e-seam-boom"], { home });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("[failed] rt hit an unexpected error  kaboom from the seam test\n  next: rt daemon logs\nstack:\n  Error: kaboom from the seam test\n");
    expect(result.stderr).toContain("      at ");
    expect(cliLog(home)).toContain("kaboom from the seam test");
  }, 30_000);

  test("--json: an unexpected error leaves stdout empty and exits 1", async () => {
    const result = await rt(["e2e-seam-boom", "--json"], { home });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("[failed] rt hit an unexpected error");
  }, 30_000);

  test("an expected failure prints the failure block without the verb prefix and exits 2", async () => {
    const result = await rt(["repos", "reidentify", "github.com/acme/only-one"], { home });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("[failed] reidentify takes two identities, got 1; usage: rt repos reidentify");
    expect(result.stderr).not.toContain("rt repos reidentify:");
    expect(result.stderr).not.toContain("    at ");
  }, 30_000);

  test("an expected failure under --json keeps stdout for the envelope", async () => {
    const result = await rt(["repos", "reidentify", "github.com/acme/only-one", "--json"], { home });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).not.toContain("[failed]");
    const body = JSON.parse(result.stdout.trim());
    expect(body.contract).toBe(1);
    expect(body.error.code).toBe("usage");
  }, 30_000);
});
```

- [ ] **Step 7: Run the e2e file**

Run (repo root): `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/errors.test.ts e2e/tests/plugins.test.ts e2e/tests/smoke.test.ts`
Expected: PASS. `e2e/setup.ts` builds `dist/rt` when it is stale; `plugins.test.ts`'s `throwing plugin: exit 1 + error outcome in cli log` still passes because the exit code and the dispatch record are unchanged.

- [ ] **Step 8: Commit**

```bash
git add lib/errors.ts lib/__tests__/errors.test.ts cli.ts e2e/tests/errors.test.ts
git commit -m "cli: the dispatch seam draws expected failures and one line for everything else

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The sops failure a Mac's age key cannot open

**Files:**
- Modify: `lib/secrets/store.ts` (around `sopsDecrypt`, lines 184 to 194)
- Modify: `lib/secrets/team-store.ts` (imports, `readTeamSecret`, `listTeamSecretNames`, `writeTeamSecret`)
- Modify: `lib/secrets/__tests__/store.test.ts` (append)
- Modify: `lib/secrets/__tests__/team-store.test.ts` (the fake seam's constructor and `run`; append tests)

**Interfaces:**
- Consumes: `UserActionableError` (Task 3, from `../errors.ts`); the existing `decryptAtLocation`, `writeAtLocation`, `SecretsExecSeam`.
- Produces:
  - `lib/secrets/store.ts`: `class SopsDecryptError extends Error { readonly filePath: string; readonly stderr: string }` (message stays `sops -d <filePath>: <stderr>`); `sopsKeyMismatch(stderr: string): boolean`.
  - `lib/secrets/team-store.ts`: `teamSecretsUnreadable(slug: string, cause: SopsDecryptError): UserActionableError` (code `team-secrets-unreadable`, `extra = { team: slug }`, `log = cause.message`).

- [ ] **Step 1: Write the failing store test**

In `lib/secrets/__tests__/store.test.ts`, add `SopsDecryptError` and `sopsKeyMismatch` to the import from `../store.ts`. Append:

```ts
const SOPS_WRONG_KEY_STDERR = [
  "Failed to get the data key required to decrypt the SOPS file.",
  "",
  "Group 0: FAILED",
  "  age1examplerecipientqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq: FAILED",
  "    - | failed to create reader for decrypting sops data key with",
  "      | age: identity did not match any of the recipients: incorrect",
  "      | identity for recipient block.",
  "",
  "Recovery failed because no master key was able to decrypt the file.",
].join("\n");

describe("a sops decrypt failure is typed", () => {
  test("sopsDecrypt throws SopsDecryptError carrying the path and the raw stderr, with the message callers already match", async () => {
    const domain = "rt";
    const path = secretsFilePath(domain);
    const execSeam = new FakeSecretsExecSeam({ decrypt: () => ({ code: 128, stdout: "", stderr: SOPS_WRONG_KEY_STDERR }) });
    execSeam.writeFile(path, "ciphertext");
    const seams: SecretsSeams = { ageKeySeam: fakeAgeKeySeamWithKey("AGE-X"), execSeam };

    const err = await readSecret(domain, "key", seams).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SopsDecryptError);
    expect((err as SopsDecryptError).filePath).toBe(path);
    expect((err as SopsDecryptError).stderr).toBe(SOPS_WRONG_KEY_STDERR);
    expect((err as Error).message).toBe(`sops -d ${path}: ${SOPS_WRONG_KEY_STDERR}`);
  });

  test("sopsKeyMismatch recognises the no-matching-recipient output and nothing else", () => {
    expect(sopsKeyMismatch(SOPS_WRONG_KEY_STDERR)).toBe(true);
    expect(sopsKeyMismatch("age: identity did not match any of the recipients")).toBe(true);
    expect(sopsKeyMismatch("sops: no matching creation rule")).toBe(false);
    expect(sopsKeyMismatch("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (repo root): `bun test lib/secrets/__tests__/store.test.ts`
Expected: FAIL, `SopsDecryptError` is not exported.

- [ ] **Step 3: Type the failure in `lib/secrets/store.ts`**

Replace the `sopsDecrypt` function with:

```ts
/** `sops -d` exited non-zero. The stderr rides apart from the message so a caller can read it without parsing. */
export class SopsDecryptError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly stderr: string,
  ) {
    super(`sops -d ${filePath}: ${stderr}`);
    this.name = "SopsDecryptError";
  }
}

/** sops could not unwrap the file's data key with the identity it was handed: none of the file's recipients is this Mac's key. */
export function sopsKeyMismatch(stderr: string): boolean {
  return /Failed to get the data key|did not match any of the recipients/i.test(stderr);
}

async function sopsDecrypt(filePath: string, env: Record<string, string>, execSeam: SecretsExecSeam): Promise<Record<string, string>> {
  const result = await execSeam.run(["sops", "-d", filePath], { env, sensitive: true });
  if (result.code !== 0) {
    throw new SopsDecryptError(filePath, result.stderr);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`sops -d ${filePath}: decrypted output was not valid JSON`);
  }
}
```

Run: `bun test lib/secrets/__tests__/store.test.ts`
Expected: PASS, including the pre-existing `a sops decrypt failure propagates as a real error` (it matches `/sops -d/` on the message, which is unchanged).

- [ ] **Step 4: Write the failing team-store tests**

In `lib/secrets/__tests__/team-store.test.ts`:

Add to the imports:

```ts
import { UserActionableError } from "../../errors.ts";
```

and add `SopsDecryptError` to the named imports from `../store.ts`.

Change `FakeTeamExecSeam`'s fields and constructor so a test can make `sops -d` fail. Replace:

```ts
  private updatekeysResult: SecretsExecResult;
  private failUpdatekeysOnCall?: number;
  private updatekeysCallCount = 0;

  constructor(opts: { updatekeys?: SecretsExecResult; failUpdatekeysOnCall?: number } = {}) {
    this.updatekeysResult = opts.updatekeys ?? { code: 0, stdout: "", stderr: "" };
    this.failUpdatekeysOnCall = opts.failUpdatekeysOnCall;
  }
```

with:

```ts
  private updatekeysResult: SecretsExecResult;
  private failUpdatekeysOnCall?: number;
  private updatekeysCallCount = 0;
  private decryptResult?: SecretsExecResult;

  constructor(opts: { updatekeys?: SecretsExecResult; failUpdatekeysOnCall?: number; decrypt?: SecretsExecResult } = {}) {
    this.updatekeysResult = opts.updatekeys ?? { code: 0, stdout: "", stderr: "" };
    this.failUpdatekeysOnCall = opts.failUpdatekeysOnCall;
    this.decryptResult = opts.decrypt;
  }
```

In `run`, replace the `sops -d` branch:

```ts
    if (cmd[0] === "sops" && cmd[1] === "-d") {
      const target = cmd[cmd.length - 1]!;
      const staged = this.roundTrippablePlaintext.get(target);
      return { code: 0, stdout: staged ?? "{}", stderr: "" };
    }
```

with:

```ts
    if (cmd[0] === "sops" && cmd[1] === "-d") {
      if (this.decryptResult) return this.decryptResult;
      const target = cmd[cmd.length - 1]!;
      const staged = this.roundTrippablePlaintext.get(target);
      return { code: 0, stdout: staged ?? "{}", stderr: "" };
    }
```

Append at the end of the file:

```ts
const SOPS_WRONG_KEY_STDERR = [
  "Failed to get the data key required to decrypt the SOPS file.",
  "",
  "Group 0: FAILED",
  "  age1examplerecipientqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq: FAILED",
  "    - | failed to create reader for decrypting sops data key with",
  "      | age: identity did not match any of the recipients: incorrect",
  "      | identity for recipient block.",
  "",
  "Recovery failed because no master key was able to decrypt the file.",
].join("\n");

/** A cloned team whose board.json this Mac's key cannot open. */
function unreadableTeam(stderr = SOPS_WRONG_KEY_STDERR): { execSeam: FakeTeamExecSeam; seams: SecretsSeams } {
  const execSeam = new FakeTeamExecSeam({ decrypt: { code: 128, stdout: "", stderr } });
  execSeam.files.set(teamCloneRootFor("acme"), "");
  execSeam.writeFile(teamSopsYamlPath("acme"), "creation_rules:\n  - path_regex: mattstack/secrets/.*\n    age: age1aaa\n");
  execSeam.writeFile(teamSecretsFile("acme", "board"), "ciphertext");
  return { execSeam, seams: { ageKeySeam: fakeAgeKeySeamWithKey("AGE-TEAM-KEY"), execSeam } };
}

describe("a team file this Mac's key cannot decrypt", () => {
  test("readTeamSecret throws the expected failure, with the raw sops output kept for the log", async () => {
    const { seams } = unreadableTeam();

    const err = await readTeamSecret("acme", "board", "slackClientSecret", seams).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UserActionableError);
    const failure = err as UserActionableError;
    expect(failure.code).toBe("team-secrets-unreadable");
    expect(failure.message).toBe("This Mac cannot read the acme team's secrets yet");
    expect(failure.why).toBe("No age key on this Mac matches the team's recipients. The team owner adds your key, then you pull the team again.");
    expect(failure.next).toBe("rt team pull");
    expect(failure.extra).toEqual({ team: "acme" });
    expect(failure.log).toContain(`sops -d ${teamSecretsFile("acme", "board")}`);
    expect(failure.log).toContain("did not match any of the recipients");
    expect(failure.message).not.toContain("sops");
    expect(failure.why).not.toContain("sops");
  });

  test("listTeamSecretNames and writeTeamSecret convert the same failure", async () => {
    const { seams } = unreadableTeam();

    await expect(listTeamSecretNames("acme", "board", seams)).rejects.toBeInstanceOf(UserActionableError);
    const write = await writeTeamSecret("acme", "board", "slackClientSecret", "shh", seams, fakeProbes({ home: "/home/x" })).catch((e: unknown) => e);
    expect(write).toBeInstanceOf(UserActionableError);
    expect((write as UserActionableError).code).toBe("team-secrets-unreadable");
  });

  test("a sops failure that is not a key mismatch keeps the title and says less in why", async () => {
    const { seams } = unreadableTeam("sops: no matching creation rule");

    const err = (await readTeamSecret("acme", "board", "slackClientSecret", seams).catch((e: unknown) => e)) as UserActionableError;

    expect(err.code).toBe("team-secrets-unreadable");
    expect(err.message).toBe("This Mac cannot read the acme team's secrets yet");
    expect(err.why).toBe("The team's secrets file could not be decrypted on this Mac.");
    expect(err.next).toBe("rt team pull");
    expect(err.log).toContain("no matching creation rule");
  });

  test("a personal-store decrypt failure is not converted: the team is the one the person can act on", async () => {
    const { seams } = unreadableTeam();
    const { decryptAtLocation } = await import("../store.ts");

    await expect(decryptAtLocation({ filePath: teamSecretsFile("acme", "board"), filenameOverride: "mattstack/secrets/board.json", cwd: teamCloneRootFor("acme") }, seams)).rejects.toBeInstanceOf(SopsDecryptError);
  });
});
```

`fakeProbes` is already imported in this file.

- [ ] **Step 5: Run them to verify they fail**

Run (repo root): `bun test lib/secrets/__tests__/team-store.test.ts`
Expected: FAIL. `readTeamSecret` rejects with a `SopsDecryptError`, not a `UserActionableError`.

- [ ] **Step 6: Convert the failure in `lib/secrets/team-store.ts`**

Add to the imports:

```ts
import { UserActionableError } from "../errors.ts";
```

and add `SopsDecryptError` and `sopsKeyMismatch` to the named imports from `./store.ts`.

Insert before `export async function readTeamSecret`:

```ts
/** The failure a person hits on a Mac whose age key is not yet one of the team's recipients. The sops output goes to the log through `log`. */
export function teamSecretsUnreadable(slug: string, cause: SopsDecryptError): UserActionableError {
  return new UserActionableError("team-secrets-unreadable", `This Mac cannot read the ${slug} team's secrets yet`, { team: slug }, {
    why: sopsKeyMismatch(cause.stderr)
      ? "No age key on this Mac matches the team's recipients. The team owner adds your key, then you pull the team again."
      : "The team's secrets file could not be decrypted on this Mac.",
    next: "rt team pull",
    log: cause.message,
  });
}

async function readableBy<T>(slug: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof SopsDecryptError) throw teamSecretsUnreadable(slug, err);
    throw err;
  }
}
```

Replace `readTeamSecret` and `listTeamSecretNames` (their signatures are unchanged) with:

```ts
export async function readTeamSecret(slug: string, domain: string, key: string, seams: SecretsSeams): Promise<string | null> {
  validateKey(key);
  const payload = await readableBy(slug, () => decryptAtLocation(teamLocation(slug, domain), seams));
  return payload === null ? null : payload[key] ?? null;
}

/** Names only for one team domain, mirroring `store.ts`'s `listSecretNames`; never call this to expose values. */
export async function listTeamSecretNames(slug: string, domain: string, seams: SecretsSeams): Promise<string[]> {
  const payload = await readableBy(slug, () => decryptAtLocation(teamLocation(slug, domain), seams));
  return payload === null ? [] : Object.keys(payload);
}
```

In `writeTeamSecret`, replace the last line `await writeAtLocation(location, \`team-${slug}-${domain}\`, key, value, seams);` with:

```ts
  await readableBy(slug, () => writeAtLocation(location, `team-${slug}-${domain}`, key, value, seams));
```

(`writeAtLocation` decrypts the existing file before merging; a failed post-encrypt read-back throws a plain `Error`, not a `SopsDecryptError`, so only the read is converted.)

- [ ] **Step 7: Run the secrets suites, the guard and typecheck**

Run (repo root): `bun test lib/secrets/ lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts && bun run typecheck`
Expected: PASS. `team-store.real-sops.test.ts` skips when `sops` is not on PATH and must still pass where it is.

- [ ] **Step 8: Check the message against the command tree**

Run: `rg -n "^\s+pull: \{" -A 3 lib/command-tree-def.ts | rg -n "team|description"` and confirm a `pull` node under `team` exists with a description. The `next` callout names `rt team pull` and nothing else.

- [ ] **Step 9: Commit**

```bash
git add lib/secrets/store.ts lib/secrets/team-store.ts lib/secrets/__tests__/store.test.ts lib/secrets/__tests__/team-store.test.ts
git commit -m "secrets: a team file this Mac cannot decrypt is an expected failure, the sops output goes to the log

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The pty gate for one failure

**Files:**
- Create: `e2e/pty/errors.test.ts`
- Modify: `.github/workflows/e2e.yml` (the `grep -qE` path filter in the `changes` job)

**Interfaces:**
- Consumes: `startInteractive`, `TermwrightSession` (`e2e/interactive.ts`); `createTestHome` (`e2e/harness.ts`); the built `ui/dist/rt-ui`; the seam (Task 4).
- Produces: the spec's "one failure" pty test.

- [ ] **Step 1: Write the pty test**

Create `e2e/pty/errors.test.ts`:

```ts
/**
 * The error seam with a real terminal in front of it: the compiled rt
 * spawning the real rt-ui over a pty. Every assertion reads the screen or
 * the log, because the screen is the only thing this gate adds over
 * e2e/tests/errors.test.ts, which already pins the exit codes; the session's
 * exitCode is the termwright daemon's, not rt's.
 */
import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createTestHome } from "../harness.ts";
import { startInteractive, type TermwrightSession } from "../interactive.ts";

const REPO_ROOT = import.meta.dir.replace("/e2e/pty", "");
const RT_UI_BIN = join(REPO_ROOT, "ui", "dist", "rt-ui");
const PAINT_TIMEOUT = 15_000;

beforeAll(() => {
  // The helper draws the failure; a run against a stale or missing one would
  // gate nothing. HOME is the run's throwaway dir, so the module cache lands
  // in it and must stay deletable.
  execFileSync("bun", ["run", "ui:build"], {
    cwd: REPO_ROOT,
    stdio: "pipe",
    env: { ...process.env, GOFLAGS: [process.env.GOFLAGS, "-modcacherw"].filter(Boolean).join(" ") },
  });
  if (!existsSync(RT_UI_BIN)) throw new Error(`ui:build produced no binary at ${RT_UI_BIN}`);
});

let open: { session: TermwrightSession; cleanupHome: () => void } | null = null;

afterEach(async () => {
  if (!open) return;
  await open.session.stop();
  open.cleanupHome();
  open = null;
});

function installThrowingPlugin(home: string): void {
  const dir = join(home, ".mattstack", "user", "plugins", "pty-seam");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "plugin.json"),
    JSON.stringify({ name: "pty-seam", apiVersion: 1, commands: { "pty-seam-boom": { description: "throws", module: "./boom.ts", hidden: true } } }, null, 2),
  );
  writeFileSync(join(dir, "boom.ts"), 'export async function run() { throw new Error("kaboom from the pty gate"); }\n');
}

function cliLog(home: string): string {
  const dir = join(home, ".mattstack", "rt", "logs");
  return readdirSync(dir)
    .filter((f) => f.startsWith("cli.") && f.endsWith(".log"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("");
}

// startInteractive spreads the developer's environment; an RT_LOG_LEVEL=debug
// shell would paint the stack and fail the unexpected-error test.
async function start(home: string, args: string[]): Promise<TermwrightSession> {
  return startInteractive({ args, home, cols: 100, rows: 24, env: { RT_UI_BIN, RT_LOG_LEVEL: "" } });
}

describe("the error seam through a pty", () => {
  test("an expected failure paints one failure block with no verb prefix and exits 2", async () => {
    const home = createTestHome();
    const session = await start(home.path, ["repos", "reidentify", "github.com/acme/only-one"]);
    open = { session, cleanupHome: home.cleanup };

    await session.waitForText("takes two identities", PAINT_TIMEOUT);
    const screen = await session.screen();
    expect(screen).toContain("✗");
    expect(screen).not.toContain("rt repos reidentify:");
    expect(screen).not.toContain("    at ");
  });

  test("an unexpected error paints one line, points at the log, and keeps the stack there", async () => {
    const home = createTestHome();
    installThrowingPlugin(home.path);
    const session = await start(home.path, ["pty-seam-boom"]);
    open = { session, cleanupHome: home.cleanup };

    await session.waitForText("rt hit an unexpected error", PAINT_TIMEOUT);
    const screen = await session.screen();
    expect(screen).toContain("kaboom from the pty gate");
    expect(screen).toContain("rt daemon logs");
    expect(screen).not.toContain("    at ");

    const log = cliLog(home.path);
    expect(log).toContain("kaboom from the pty gate");
    expect(log).toContain("    at ");
  });
});
```

The tests do not await `session.exitCode`: `TermwrightSession.exitCode` (`e2e/interactive.ts`) is the termwright daemon's `proc.exited`, not rt's, and nothing in the harness says the daemon exits when the wrapped `bash -c` ends, so an await there can hang to the 120 s timeout. The exit codes are pinned by `e2e/tests/errors.test.ts`. If termwright drops the screen the moment the child exits (`screen()` rejects after `waitForText` resolved), read the screen through `waitForText`'s match only: keep the `waitForText` lines, drop the `screen()` assertions that follow, and say so in your report. Do not add a sleep. The second test's log read happens after `waitForText`, by which time `exitUnexpected` has written the line (it logs before it prints).

- [ ] **Step 2: Run the pty gate**

Run (repo root): `bun test --preload ./e2e/setup.ts --timeout 120000 e2e/pty/errors.test.ts`
Expected: PASS. It needs `termwright` on PATH or at `~/.cargo/bin/termwright` (`cargo install termwright`), a built `dist/rt` (the preload builds it) and Go for `ui:build`.

- [ ] **Step 3: Teach the workflow's filter this phase's files**

In `.github/workflows/e2e.yml`, inside the `changes` job's `run:` script, replace the regular expression

```
'^(ui/|lib/mission/|lib/ui/|commands/glitter\.ts|packages/git-core/|e2e/(pty/|glitter-repo\.ts|interactive\.ts|harness\.ts|setup\.ts|socket-path\.ts)|test-setup\.ts|\.github/workflows/e2e\.yml|package\.json)'
```

with

```
'^(cli\.ts|ui/|lib/mission/|lib/ui/|lib/errors\.ts|lib/setup/errors\.ts|lib/cli-logger\.ts|lib/secrets/|commands/glitter\.ts|packages/git-core/|e2e/(pty/|glitter-repo\.ts|interactive\.ts|harness\.ts|setup\.ts|socket-path\.ts)|test-setup\.ts|\.github/workflows/e2e\.yml|package\.json)'
```

Run: `rg -n "cli\\\\.ts\|" .github/workflows/e2e.yml` to confirm the edit landed, and if `actionlint` is installed locally, `actionlint .github/workflows/e2e.yml` (CI's `checks.yml` runs it).

- [ ] **Step 4: Commit**

```bash
git add e2e/pty/errors.test.ts .github/workflows/e2e.yml
git commit -m "e2e: the error seam through a pty, and the gate runs for the seam's files

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `cli.ts`'s own prints, the guard scans `cli.ts`, docs, every gate

**Files:**
- Modify: `cli.ts` (`--version`, `--grant-fda`)
- Modify: `lib/__tests__/no-raw-output.test.ts`, `lib/__tests__/raw-output-allowlist.json`
- Modify: `AGENTS.md` ("Output layer" section)

**Interfaces:**
- Consumes: `out.payload`, `out.print`, `out.fail`, `out.line`, `out.callout`, `out.cmd`, `out.strong` (phase 1).
- Produces: `cli.ts` in the guard's scan set and on the allowlist for its two pre-dispatch notices; the AGENTS.md paragraph later phases follow when they throw.

- [ ] **Step 1: Extend the guard to scan `cli.ts`**

In `lib/__tests__/no-raw-output.test.ts`, change the `fs` import to `import { readFileSync, readdirSync, statSync, writeFileSync } from "fs";`, change `SCAN_ROOTS` to:

```ts
const SCAN_ROOTS = ["cli.ts", "commands", "lib"];
```

and replace `collect` with:

```ts
function collect(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(path, entry.name);
    if (entry.name === "node_modules" || entry.name === "__tests__") return [];
    if (entry.isDirectory()) return collect(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}
```

Add `"cli.ts",` as the first entry of `lib/__tests__/raw-output-allowlist.json` (it sorts before `commands/accounts.ts`).

Run: `bun test lib/__tests__/no-raw-output.test.ts`
Expected: PASS (`cli.ts` still prints raw and is listed).

- [ ] **Step 2: Convert `--version` and `--grant-fda`**

In `cli.ts`, replace the `--version` branch body:

```ts
  console.log(versionBanner(_RT_VERSION, processFlavor(), buildFlavor(), { execPath: process.execPath, sourceDir: import.meta.dir }));
```

with:

```ts
  const { payload } = await import("./lib/ui/out.ts");
  payload(versionBanner(_RT_VERSION, processFlavor(), buildFlavor(), { execPath: process.execPath, sourceDir: import.meta.dir }) + "\n");
```

Replace the `--grant-fda` branch body (from `const { execSync } = await import("child_process");` through the closing brace of its `catch`) with:

```ts
  const { execSync } = await import("child_process");
  const out = await import("./lib/ui/out.ts");
  const trayPath = trayAppPath();
  out.print(
    out.line("needs-you", "Grant Full Disk Access to mattstack.app", "System Settings is opening"),
    out.callout("note", ["Click + under Full Disk Access and add ", out.strong(trayPath)], "The rt daemon takes the grant from the app."),
    out.callout("next", out.cmd("rt daemon restart")),
  );
  try {
    execSync('open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"');
  } catch {
    out.fail({ title: "System Settings did not open", why: "Open it yourself: Privacy & Security, then Full Disk Access." });
    process.exit(1);
  }
```

The migration notices and the first-run hint stay as they are: they print before the verb is known, so stdout is not safe for them, and the layer has no stderr note (`cd` and `nav` move their notes in phase 5).

Run: `bun run typecheck && bun test lib/__tests__/no-raw-output.test.ts lib/__tests__/no-top-level-await.test.ts && bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/smoke.test.ts e2e/tests/first-run.test.ts`
Expected: all pass. `smoke.test.ts` still matches `^rt ` on `--version`'s stdout; `first-run.test.ts` still finds `rt is not set up yet`.

- [ ] **Step 3: Document the seam in `AGENTS.md`**

In the `## Output layer` section, after the paragraph that begins `Plain output collapses newlines and tabs`, insert:

```markdown
Failures have one shape. A command that cannot continue throws
`UserActionableError` (`lib/errors.ts`) with what happened in a short plain
sentence, an optional `why`, the command to run as `next`, and any raw
child output as `log`; the dispatch seam in `cli.ts` draws it as a `failure`
block on stderr and exits 2, and `exitUserError` does the same for a verb
that handles its own `--json` (the envelope stays on stdout, byte for byte).
Anything else that reaches the seam prints one line, "rt hit an unexpected
error", with the message as the hint and the stack in the CLI log; the stack
also prints off a TTY or under `RT_LOG_LEVEL=debug`. Do not catch an error
only to print it: throw the typed one, or let it reach the seam. The first
converted failure is the team secrets file a Mac's age key cannot open
(`teamSecretsUnreadable` in `lib/secrets/team-store.ts`); its sops output
goes to the log, never the screen.
```

In the guard paragraph of the same section, change `import under \`commands/\` or \`lib/\`.` to `import in \`cli.ts\` or under \`commands/\` or \`lib/\`.`, and change the last sentence, `names the files not yet converted and only shrinks: converting a file means deleting its line.` (in AGENTS.md it wraps across two lines after `only`; match it as the file has it), to `names the files not yet converted and only shrinks: converting a file means deleting its line. (\`cli.ts\` joined the scan with the error seam, the one time the list grew; its own line goes when its pre-dispatch notices move onto the layer.)`

- [ ] **Step 4: Check the readers of the old text**

Run from the repo root:

```bash
rg -n "rt [a-z-]+( [a-z-]+)*: " plugins/mattstack skills apps/board/skills --glob '*.md' | rg -v "rt-ui|rt chat|rt gate|rt daemon logs" | head -40
```

Read each hit. A skill that tells an agent to look for `rt <verb>: <message>` on stderr must be changed to read the `--json` envelope or the plain `[failed] <message>` line. Expected on this branch: no skill scrapes `exitUserError`'s human line (the skills read `--json`); if one does, fix it in the same commit and name it in your report.

- [ ] **Step 5: Run every gate**

Run from the repo root, in order, and record each result in your report:

```bash
bun run ui:build
bun run ui:test
bun run typecheck
bun run test
bun run test:e2e
bun scripts/bench-startup.ts
bun run test:pty
bun run picker:check
bun run format:check
```

Expected: all pass. `bun run test:pty` runs `e2e/pty/glitter.test.ts` and `e2e/pty/errors.test.ts`; `test:e2e` includes `e2e/tests/errors.test.ts` and the plugin and smoke tests this phase touched. `bench-startup.ts` times `dist/rt --version` (the e2e preload has just built that binary) under a 60 ms threshold: `--version` now dynamically imports `lib/ui/out.ts`, and this run is what says the import cost nothing a person feels; record the median in your report, and if it fails, say so rather than raising the threshold. A failure in a file this branch did not touch: re-run it alone and on `origin/main` before calling it pre-existing, and name it.

- [ ] **Step 6: Check the text rules**

```bash
CHANGED=$(git diff --name-only $(git merge-base HEAD origin/main)..HEAD -- cli.ts lib commands e2e scripts AGENTS.md .github)
LC_ALL=C grep -n $'\xe2\x80\x94\|\xe2\x80\x93' $CHANGED || echo "no banned dashes"
git diff $(git merge-base HEAD origin/main)..HEAD -- cli.ts lib commands e2e scripts AGENTS.md .github | grep -E '^\+' | grep -ciE '[l]oad.bearing'
```

Expected: `no banned dashes` (the import sweep touches files that already contain dashes in untouched lines; only lines this branch added count, so if the first command prints hits, check each is an unchanged line with `git blame` and name it in the report), and `0`.

- [ ] **Step 7: Look at it**

In a real terminal (not a subagent's pipe), from the repo root with the built helper:

```bash
bun cli.ts repos reidentify github.com/acme/only-one
bun cli.ts repos reidentify github.com/acme/only-one | cat
RT_LOG_LEVEL=debug bun cli.ts repos reidentify github.com/acme/only-one
```

and, with the Task 4 plugin installed under a throwaway `HOME`:

```bash
HOME=/tmp/rt-seam-home bun cli.ts pty-seam-boom
HOME=/tmp/rt-seam-home bun cli.ts pty-seam-boom 2>&1 | cat
HOME=/tmp/rt-seam-home RT_LOG_LEVEL=debug bun cli.ts pty-seam-boom
```

Take a screenshot of the first and fourth in the terminal's dark and light schemes for the PR. The coral cross and the peach `next` label are the two accents; the title, hint and command take the terminal's foreground. If you have no real terminal, say so in the report and leave the screenshots to the reviewer.

- [ ] **Step 8: Commit**

```bash
git add cli.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/raw-output-allowlist.json AGENTS.md
git commit -m "cli: version is a payload, grant-fda prints through out, the guard scans cli.ts; docs: the error seam

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## After this plan

- Open the PR against `m4ttstack/mattstack` after phase 1's PR #630 merges (this branch builds on it), with the Task 7 screenshots.
- For the phase 3 planner: `lib/setup/errors.ts` is a one-line re-export kept only for the files phase 3 owns (`commands/setup.ts`, `commands/logins.ts`, `commands/uninstall.ts`, `lib/setup/**`, `commands/__tests__/setup-apply.test.ts`). Phase 3 points those at `lib/errors.ts` and deletes the shim. `commands/setup.ts`'s `exitWithUserError` and the four inline `rt setup <verb>: ${err.message}` prints are phase 3's to replace with `exitUserError` or `failureFor`. `realTeamSecrets.read` in `commands/setup.ts` now sees a `UserActionableError` from `readTeamSecret` and already exits 2 with its message through `exitWithUserError`; converting that print finishes the sops story.
- For the phase 3 planner: `commands/secrets.ts`'s `reportSecretsError` rethrows anything it does not know, so `rt secrets list --team` on an unreadable team now reaches the seam and exits 2 with the failure block (or the envelope, under `--json`); nothing in that file needs to catch the new error.
- For the phase 3 and 4 planners: `lib/ui/__tests__/capture-out.ts` is the one capture helper; import it, do not copy it. Its gate is the caller's (`out.__test__.setHuman(() => false)` after `captureOut()`), and `logCliEvent(level, module, message, context?)` in `lib/cli-logger.ts` is the one way a sub-line or a warning reaches the CLI log outside the command record.
- `exitUserError`'s third argument (`verb`) is unused; a later phase that touches every caller may drop it.
- `lib/cli-logger.ts`'s crash handler still prints with `console.error` for an uncaught exception outside `__main`; phase 6 decides between routing it through `exitUnexpected` (a cycle today: `cli-logger` is imported by `out.ts`) and a permanent exemption.
- The migration notices and the first-run hint in `cli.ts` need a stderr note in the layer before they can move; phase 5 settles `cd` and `nav`'s notes and is the natural place for that primitive, after which `cli.ts` leaves the allowlist.
