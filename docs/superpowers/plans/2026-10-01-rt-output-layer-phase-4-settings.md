# rt Output Layer, Phase 4 (Settings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every human line the settings verbs print (`get`, `set`, `unset`, `list`, `explain`, `check`, `migrate`, `source-path`, `test-push`, `schema lock|diff`, the `sdm set-email` function that shares their file) and the settings share tip onto `lib/ui/out.ts`, with `--json` frozen byte for byte and `get`'s value treated as a payload.

**Architecture:** The three command files under `commands/settings*.ts` stop importing colors and printing by hand: each verb builds blocks (`line`, `kv`, `table`, `tree`, `summary`, `callout`) and prints them in one `out.print` call, fails through `out.fail`, and writes `--json` through `out.json`. The share tip that `setSetting`/`unsetSetting` emit becomes a structured `SettingsNotice` (a sentence plus an optional command) so the CLI can draw it as a `tip` callout with a `next` callout under the confirmation line; the library default stays a stderr line, and the sink signature keeps phase 3's `lib/setup/apply.ts` compiling untouched.

**Tech Stack:** Bun + TypeScript (`commands/`, `lib/settings/`, `packages/rt-client/src/settings/write.ts`), `bun:test`, termwright for the pty gate (`e2e/pty/`).

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (ticket RT-369), phase 4 of its "Phases" list. Phase 1 (`docs/superpowers/plans/2026-09-30-rt-output-layer-phase-1-foundation.md`, PR #630) built the API this plan consumes.

**Order:** Phase 2 (errors) lands before this plan starts. This plan edits neither `cli.ts` nor `lib/errors.ts`; it consumes `out.fail` for every failure and keeps every exit code at today's value. It does not throw `UserActionableError` from the settings verbs, because the dispatch seam renders an expected failure at exit 2 and these verbs exit 1 today (the Global Constraints freeze that). Landing after phase 2 means the one `cli.ts` line this phase depends on (`await routeSettingsNotices(args)`, which stays by name and signature) is already settled there, and anything a settings verb throws by accident is rendered by the seam instead of as a stack.

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
- Phase 4's own: `rt settings get` and the bare-path form of `rt settings source-path` and `rt settings schema lock` are payload verbs. Their stdout carries only the value or path, written through `out.payload`, and their human lines go to stderr through `out.payloadOnStdout()`. Every other settings verb's stdout is human text, except under `--json`.
- Phase 4's own: `out.print` under `--json` writes plain text to stdout, so a verb that may print an incidental note (the repo-identity warning, the missing-lock warning) calls `out.payloadOnStdout()` as soon as it knows `--json` was passed. `rt_verb` parses stdout as one JSON value for the agent-safe verbs (`get`, `list`, `explain`), and the `--json` fixtures assert an empty stderr.
- Phase 4's own: every exit code stays: the settings verbs exit 1 on a refusal or usage error, `source-path` exits 2 on a folder that is not a checkout, and `check`, `migrate`, `schema lock` and `schema diff` set `process.exitCode = 1` exactly where they do today.
- Phase 4's own: `packages/rt-client` is a workspace package whose `dist/` goes stale. After editing `packages/rt-client/src/settings/write.ts`, run `bun run build` in `packages/rt-client` before any other test, and again after any merge that touches it (`packages/rt-client/test/dist-freshness.test.ts` is the guard).
- Phase 4's own: `lib/settings/notice-channel.ts` is imported on every `rt` dispatch (`cli.ts`), so it keeps its `import("./write.ts")` dynamic; a static import of the rt-client write path there is a startup regression.
- Phase 4's own: every command named in a `next` callout exists in `lib/command-tree-def.ts`. The ones this plan names: `rt settings get <key>`, `rt settings explain <key>`, `rt settings set <key> <value> --scope user|team|machine`, `rt settings set <key> <value> --scope team --team <name>`, `rt settings list`, `rt settings source-path <path>`, `rt settings migrate --write`, `rt repos status`, `rt intercept install`, `rt hooks status` (a positional of the `hooks` leaf), `rt home remote set`, `rt team publish --team <team> --remote <url>`, `rt team publish --team <team>`, `rt sdm set-email <email>`, `bun run cli.ts settings schema lock`, `bun run cli.ts settings schema diff`.

## Review Focus

1. **A string value carrying an escape sequence or a newline.** `rt settings get` must write it to stdout byte for byte (a script reads it), while `list` and `explain` must print it cleaned so it cannot repaint the terminal or forge a row. Pinned in Task 3 (`the value is written raw on stdout and cleaned in the list`).
2. **`--json` plus `--repo` naming a repo whose identity cannot derive, on an agent-safe verb.** `rt_verb` parses stdout as one JSON value, so the "repo settings out of reach" note must land on stderr and stdout must stay a single envelope. Pinned in Task 3 (`list --json keeps stdout to one JSON value when the repo has no identity`).
3. **A key the registry does not know.** `get` and `explain` fail with one plain sentence, exit 1, no stack and no doubled `rt:` prefix, and point at `rt settings list`. Pinned in Task 3 (`an unknown key fails plainly`).
4. **A bare word given to `set` where JSON was expected** (`debug` instead of `'"debug"'`, the most common onboarding mistake). Refused with the quoting tip, exit 1, nothing written. Pinned in Task 4 (`a bare word is refused with the quoting tip and nothing is written`).
5. **`unset` of a key that is not in the store.** Exit 0, a `skipped` line, and no share tip (nothing was removed, so nothing needs sharing). Pinned in Task 4 (`unset of an absent key is skipped, not failed, and prints no tip`).

## File Structure

| File | Responsibility |
|---|---|
| `lib/ui/__tests__/capture-out.ts` (create) | Test helper: captures what a command writes through `out` (and through `console.*` on unconverted code), forcing the plain renderer |
| `commands/__tests__/settings-json-frozen.test.ts` (create), `commands/__tests__/fixtures/settings-json/*.txt` (create) | The `--json` byte-identity characterization, fixtures captured before conversion |
| `packages/rt-client/src/settings/write.ts` (modify) | `SettingsNotice`, the two-argument sink, the plain-language share tips |
| `packages/rt-client/src/index.ts` (modify) | Export the `SettingsNotice` type |
| `packages/rt-client/src/settings/__tests__/write.test.ts` (modify) | The new tip wording and the structured notice |
| `lib/settings/notice-channel.ts` (modify) | `noticeBlocks`, the TTY routing through `out.print` |
| `lib/settings/__tests__/notice-channel.test.ts` (modify) | Routing and block tests |
| `commands/settings-keys.ts` (modify) | `get` (payload), `set`, `unset`, `list`, `explain`, `check`, `migrate` |
| `commands/settings.ts` (modify) | `source-path` (payload), `test-push`, `sdm set-email` |
| `commands/settings-schema.ts` (modify) | `schema lock` (payload), `schema diff` |
| `commands/__tests__/settings-*.test.ts` (modify), `settings-get.test.ts`, `settings-set.test.ts`, `settings-misc.test.ts` (create) | Plain-output assertions and the Review Focus pins |
| `lib/__tests__/raw-output-allowlist.json` (modify) | Four lines deleted, one per converted file |
| `e2e/tests/settings.test.ts` (modify) | The three assertions that scrape human text |
| `e2e/pty/settings.test.ts` (create), `.github/workflows/e2e.yml` (modify) | The settings pty gate and its path filter |
| `AGENTS.md` (modify) | One sentence on `--json` and `out.payloadOnStdout()` |

---

### Task 1: Audit, the capture helper, and the frozen `--json` fixtures

**Files:**
- Create: `lib/ui/__tests__/capture-out.ts`
- Create: `commands/__tests__/settings-json-frozen.test.ts`
- Create: `commands/__tests__/fixtures/settings-json/` (nine `.txt` files, written by the test in update mode)

**Interfaces:**
- Consumes: `out.__test__.setHuman`, `out.__test__.reset` (phase 1, `lib/ui/out.ts`); the unconverted verbs `settingsGet`, `settingsList`, `settingsExplain`, `settingsCheck`, `settingsMigrate` (`commands/settings-keys.ts`), `sourcePathCommand` (`commands/settings.ts`), `settingsSchemaDiff` (`commands/settings-schema.ts`); `machineSettingsPath`, `userSettingsPath` (`lib/rt-paths.ts`); `buildLock` (`lib/settings/schema-lock.ts`); `closeStateDb` (`lib/state/index.ts`).
- Produces: `captureOut(): Captured` with `Captured = { stdout: string[]; stderr: string[]; text(): string; err(): string; restore(): void }`, used by every later task's tests. Nine fixture files that Tasks 3 to 7 must keep passing.

#### The audit

Every print site in the files this phase owns, the block it becomes and the new copy. Later tasks implement exactly this table.

**`commands/settings-keys.ts`**

| Today | Block | New copy |
|---|---|---|
| `fail(msg)`: `console.error("rt settings: " + msg)`, exit 1 | `out.fail`, exit 1 | Per call site below |
| `failWithError(err)`: the resolver's message on stderr, exit 1 | `out.fail({ title })`, exit 1 | The message with its leading `rt: ` removed |
| `get` without a key: usage line | failure | title `Name the setting to read`, next `rt settings get <key>` |
| `explain` without a key | failure | title `Name the setting to explain`, next `rt settings explain <key>` |
| `--repo X` not in the index | failure | title `X is not a repo rt knows`, next `rt repos status` |
| `--repo X` resolves but no identity derives (dim stderr note) | `line warn` | `Repo settings for X are out of reach`, hint `its remote is not one rt can key on`. stderr for `get` and under `--json`, stdout otherwise |
| unknown key (resolver throws) | failure | title `No setting is called <key>`, next `rt settings list` |
| `get` human: blank, bold key, value, dim provenance, yellow legacy note, blank | `kv(key, undefined, source)` and a `note` callout on stderr; the value as `out.payload` | source `from your user settings` (see `describeProvenance`); note `still reads its legacy file` or `not writable through settings yet` |
| `set` without key or value | failure | title `Give the setting a key and a value`, next `rt settings set <key> <value> --scope user\|team\|machine` |
| `set`/`unset` without `--scope` | failure | title `Say which settings to write` (`...to remove it from` for unset), why `A value lives in exactly one of your user, team or machine settings.`, next as above |
| bad `--scope` | failure | title `<scope> is not a scope`, why `The scopes are user, team and machine.`, next as above |
| `--team` with a non-team scope | failure | title `A team name only goes with the team scope`, why `You asked for the <scope> scope.`, next `rt settings set <key> <value> --scope team --team <name>` |
| `--team` with no name | failure | title `Name the team`, same next |
| value is not JSON | failure | title `The value is not valid JSON`, hint the raw value, why `A string needs its own quotes, so the shell does not eat them: '"debug"'.` |
| `--repo X` whose remote does not normalize (set/unset) | failure | title `Repo settings for X have nowhere to live`, why `Its remote is not one rt can key settings on, so nothing would read a value written for it.` |
| `✓ key set (where)` | `line done` | `Saved <key>`, hint `your user settings` / `this Mac's settings` / `the <team> team's settings` / `the team's settings`, with ` for <repo>` when `--repo` |
| share tip (from the sink) | `callout tip` + `callout next` under the confirmation, same print call | Task 2's wording |
| `intercepts.json regenerated (N rules)` | `line done` | `Intercepts updated`, hint `N rule(s)` |
| `could not regenerate intercepts.json (...) — run rt intercept install` | `line warn` + `callout next` | `Intercepts not updated`, hint the error; next `rt intercept install` |
| `hooks.json regenerated (repo)` | `line done` | `Hooks updated`, hint the repo name |
| `could not regenerate hooks.json for repo — run rt hooks status` | `line warn` + `callout next` | `Hooks not updated for <repo>`; next `rt hooks status` ` in that repo` |
| `✓ key removed (where)` | `line done` | `Removed <key>`, hint `from <where>` |
| `key was not set in where — nothing to remove` | `line skipped` | `<key> was not set`, hint `nothing to remove from <where>` |
| `list`: blank, `key = value (labels)` per row, blank | one `table`, rows `[key, value + warn labels]` | labels keep their words; `reads legacy: <file>` becomes `still reads its legacy file` |
| `explain`: blank, bold key, a row per rung, blank | one `tree(key, rows)` | `—` for an absent rung becomes `not set`; `(registry default)` becomes `built-in default`; `(no file)` becomes `no file`; marks keep their bracketed words |
| `check`: a line per finding with issue lines, then `N failing, M unregistered, K stale or leftover` | `table` + `summary` | summary `Your stored settings check out` (done) or `Some stored settings need fixing` (failed), counts `N failing`, `M unregistered`, `K stale or leftover` |
| `migrate`: `--write` with `--prune` | failure, exitCode 1 | title `Write and prune are separate runs`, why `Prune only once every reader of the store knows the new names.`, next `rt settings migrate --write` |
| `--force` without a key | failure, exitCode 1 | title `--force needs a key`, hint `for example --force rt.notify.eventBridges` |
| `--force X matches no older store name in this plan` (stderr) | `line warn` on stdout | same words |
| dry-run rows | `table` | `would write <new> from <old>: <value>`; `cannot migrate <old>: <message>` (failed); `<older>: <label>` (needs-you for diverged, dim otherwise) with two value rows under a diverged one |
| `every stored key is under its current store name` | `line done` | `Every stored setting is under its current name` |
| `--write` rows, `nothing to write` | `table`; `line skipped` | `wrote <new> from <old>`; errors as failed cells; `Nothing to write` |
| `--prune` per-store header, names, `every reader of this store must know: ...` | `section(<scope> store, <file>, table, paragraph)` | `Every reader of this store must know: <key> (storeVersion N), ...` |
| `deleting diverged X; its value was: V` | `line warn` | `Deleting diverged X`, hint `its value was: V` |
| refused rows, `pruned N, refused M` | `table` (refused cells) + `summary` | `Pruned N older name(s)`, counts `N pruned`, `M refused`; warn when any refused |

**`commands/settings.ts`**

| Today | Block | New copy |
|---|---|---|
| `sdm set-email`: `✗ no email given and no terminal to prompt in` + usage, exitCode 1 | failure | title `No email given and no terminal to ask in`, next `rt sdm set-email <email>` |
| `keeping existing StrongDM email` | `line skipped` | `Kept your StrongDM email` |
| `no email entered` | `line skipped` | `No email entered` |
| `✗ failed to save StrongDM email: ...`, exit 1 | failure, exit 1 | title `Could not save your StrongDM email`, why the error |
| `✓ StrongDM email saved` | `line done` | `StrongDM email saved` |
| `test-push`: `⚠ rt tray is not running` + socket path | `line off` | `The mattstack app is not running`, hint `open it, then try again` |
| `✓ Test push sent to rt tray` | `line done` | `Test notification sent` |
| `✗ rt tray returned HTTP N` | failure | title `The app did not accept the test notification`, hint `HTTP N` |
| `✗ Failed to reach rt tray: ...` | failure | title `Could not reach the mattstack app`, why the error |
| `source-path` read: the path, or `no source checkout set` | `out.payload`; `line pending` + `callout next` on stderr | `No source checkout set yet`; next `rt settings source-path <path>` |
| `rt settings source-path: <path> is not an rt checkout (no cli.ts)`, exit 2 | failure, exit 2 | title `That folder is not an rt checkout`, hint the path, why `It has no cli.ts.` |
| `source checkout: <path> (<wrapper> rewritten)` | `line done` (+ a second) | `Source checkout set`, hint the path; `Dev wrapper rewritten`, hint the wrapper path |

**`commands/settings-schema.ts`**

| Today | Block | New copy |
|---|---|---|
| `lock`: `run from source (...)`, exitCode 1 | failure | title `This has to run from source`, why `The compiled rt has no checkout to write the lock into.`, next `bun run cli.ts settings schema lock` |
| `lock`: the written path | `out.payload` | the path |
| `diff`: `rt settings schema diff: <message>`, exitCode 1 | failure | the message as title (the compiled-binary one gets why `The compiled rt has no checkout to diff.` and next `bun run cli.ts settings schema diff`) |
| `<path> does not exist; diffing against an empty lock` (stderr) | `line warn` | `No lock file there, so diffing against an empty lock`, hint the path (stderr under `--json`) |
| `no schema changes` | `line done` | `No schema changes` |
| `<kind> <key>  <detail>` rows | `table` | same cells; `breaking` is a warn cell |
| `problem: <p>` | `line failed` | the problem |
| `drafted <key> ...`, `note: ...`, final `next: ...` | `line done` + `callout note`; `callout next` | `Drafted <key>`, hint `migrateFrom version N` or `renamedFrom <old>`; next `review the drafts, add real examples, set storeVersion, then run ` + `bun run cli.ts settings schema lock` |

**`lib/settings/notice-channel.ts`**: `console.log(line)` becomes `out.print(...noticeBlocks(notice))` (Task 2).

**`packages/rt-client/src/settings/write.ts`** (the write path, this phase's): the four share tips, each in a saved and a removed form, get the wording in Task 2. The library default sink stays a `console.error` line (rt-client is outside the guard's scan roots).

- [ ] **Step 1: Write the capture helper**

Create `lib/ui/__tests__/capture-out.ts`:

```ts
import { spyOn } from "bun:test";
import * as out from "../out.ts";

export interface Captured {
  stdout: string[];
  stderr: string[];
  text(): string;
  err(): string;
  restore(): void;
}

/**
 * Captures what a command writes through lib/ui/out.ts, with the plain
 * renderer forced so a test never spawns rt-ui. console.log and
 * console.error are captured too, so a fixture can be taken from a command
 * that has not been converted yet.
 */
export function captureOut(): Captured {
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    c.stdout.push(args.map(String).join(" ") + "\n");
  });
  const errSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    c.stderr.push(args.map(String).join(" ") + "\n");
  });
  const c: Captured = {
    stdout: [],
    stderr: [],
    text: () => c.stdout.join(""),
    err: () => c.stderr.join(""),
    restore() {
      process.stdout.write = realOut;
      process.stderr.write = realErr;
      logSpy.mockRestore();
      errSpy.mockRestore();
      out.__test__.reset();
    },
  };
  out.__test__.setHuman(() => false);
  process.stdout.write = ((chunk: string | Uint8Array) => (c.stdout.push(String(chunk)), true)) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => (c.stderr.push(String(chunk)), true)) as typeof process.stderr.write;
  return c;
}
```

- [ ] **Step 2: Write the frozen test**

Create `commands/__tests__/settings-json-frozen.test.ts`:

```ts
/**
 * The --json envelopes of the settings verbs are frozen byte for byte. The
 * fixtures were captured before these verbs moved onto lib/ui/out.ts. Run
 * with RT_UPDATE_SETTINGS_JSON_FIXTURES=1 only to add a case, never to make
 * a diff go away.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { settingsCheck, settingsExplain, settingsGet, settingsList, settingsMigrate } from "../settings-keys.ts";
import { sourcePathCommand } from "../settings.ts";
import { settingsSchemaDiff } from "../settings-schema.ts";
import { machineSettingsPath, userSettingsPath } from "../../lib/rt-paths.ts";
import { buildLock } from "../../lib/settings/schema-lock.ts";
import { closeStateDb } from "../../lib/state/index.ts";
import { captureOut, type Captured } from "../../lib/ui/__tests__/capture-out.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "settings-json");
const UPDATE = process.env.RT_UPDATE_SETTINGS_JSON_FIXTURES === "1";
const noPrompt = { interactive: false, confirm: async () => { throw new Error("must not prompt"); } };

describe("settings --json is frozen", () => {
  const origHome = process.env.HOME;
  let home: string;
  let cap: Captured;

  function write(file: string, obj: unknown): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(obj, null, 2));
  }

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-json-")));
    process.env.HOME = home;
    closeStateDb();
    process.exitCode = 0;
    write(userSettingsPath(), { "rt.worktrees": { onDeck: 3 }, "rt.logLevel": "debug" });
    write(machineSettingsPath(), { "rt.repoRoots": "nope" });
    cap = captureOut();
  });

  afterEach(() => {
    cap.restore();
    process.env.HOME = origHome;
    process.exitCode = 0;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  /** Paths and clocks differ per run; everything else is the contract. */
  function normalize(text: string): string {
    return text
      .replaceAll(machineSettingsPath(), "<MACHINE_STORE>")
      .replaceAll(home, "<HOME>")
      .replace(/"at":"[^"]+"/g, '"at":"<AT>"');
  }

  function frozen(name: string): void {
    const file = join(FIXTURES, `${name}.txt`);
    const got = normalize(cap.text());
    if (UPDATE) {
      mkdirSync(FIXTURES, { recursive: true });
      writeFileSync(file, got);
    }
    expect(existsSync(file)).toBe(true);
    expect(got).toBe(readFileSync(file, "utf8"));
    expect(cap.err()).toBe("");
  }

  test("get", async () => {
    await settingsGet(["rt.worktrees", "--json"]);
    frozen("get");
  });

  test("list", async () => {
    await settingsList(["--json"]);
    frozen("list");
  });

  test("explain", async () => {
    await settingsExplain(["rt.worktrees", "--json"]);
    frozen("explain");
  });

  test("check", async () => {
    await settingsCheck(["--json"]);
    frozen("check");
    expect(process.exitCode).toBe(1);
  });

  test("migrate dry run", async () => {
    await settingsMigrate(["--json"], noPrompt);
    frozen("migrate");
  });

  test("migrate --write", async () => {
    await settingsMigrate(["--write", "--json"], noPrompt);
    frozen("migrate-write");
  });

  test("migrate --prune --yes", async () => {
    await settingsMigrate(["--prune", "--yes", "--json"], noPrompt);
    frozen("migrate-prune");
  });

  test("source-path", async () => {
    await sourcePathCommand(["--json"]);
    frozen("source-path");
  });

  test("schema diff", async () => {
    const lock = join(home, "lock.json");
    writeFileSync(lock, JSON.stringify(buildLock()));
    await settingsSchemaDiff(["--against", lock, "--json"], { shippedLock: null });
    frozen("schema-diff");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run (repo root): `bun test commands/__tests__/settings-json-frozen.test.ts`
Expected: FAIL on every case at `expect(existsSync(file)).toBe(true)`. No fixtures exist yet.

- [ ] **Step 4: Capture the fixtures from the unconverted code**

This is the one step that must run before any conversion in Tasks 3 to 7.

Run: `RT_UPDATE_SETTINGS_JSON_FIXTURES=1 bun test commands/__tests__/settings-json-frozen.test.ts`
Expected: PASS, and `ls commands/__tests__/fixtures/settings-json/` lists `get.txt`, `list.txt`, `explain.txt`, `check.txt`, `migrate.txt`, `migrate-write.txt`, `migrate-prune.txt`, `source-path.txt`, `schema-diff.txt`.

Open each file. Every one but `schema-diff.txt` is a single line ending in a newline; `schema-diff.txt` is indented JSON. `get.txt` starts with `{"ok":true,"key":"rt.worktrees"`. `source-path.txt` contains `"at":"<AT>"` and `"sourcePath":null`. If any fixture contains a path that is not `<HOME>` or `<MACHINE_STORE>`, add that path's replacement to `normalize` and recapture; do not commit a fixture with a machine-specific path.

- [ ] **Step 5: Run it again without the flag**

Run: `bun test commands/__tests__/settings-json-frozen.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/ui/__tests__/capture-out.ts commands/__tests__/settings-json-frozen.test.ts commands/__tests__/fixtures/settings-json/
git commit -m "settings: freeze every --json envelope before the output conversion

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The share tip as a structured notice

**Files:**
- Modify: `packages/rt-client/src/settings/write.ts` (the block from `export type SettingsNoticeSink` through the end of `shareTip`, lines 199 to 245 today)
- Modify: `packages/rt-client/src/index.ts:181`
- Modify: `packages/rt-client/src/settings/__tests__/write.test.ts` (the share-tip cases, lines 300 to 410 today)
- Modify: `lib/settings/notice-channel.ts` (whole file)
- Modify: `lib/settings/__tests__/notice-channel.test.ts` (append)
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete the `lib/settings/notice-channel.ts` line)

**Interfaces:**
- Consumes: `out.print`, `out.callout`, `out.cmd` (phase 1); `setSettingsNoticeSink` (existing, `packages/rt-client/src/settings/write.ts`); `captureOut` (Task 1).
- Produces (rt-client): `interface SettingsNotice { text: string; next?: string }`; `type SettingsNoticeSink = (line: string, notice: SettingsNotice) => void`; `noticeLine(notice: SettingsNotice): string`. A one-argument sink such as phase 3's `(line) => ctx.log(step.id, line)` in `lib/setup/apply.ts` still type-checks and still receives the full sentence.
- Produces (lib): `noticeBlocks(notice: SettingsNotice): Block[]` and the existing `settingsNoticeChannel(args, stdoutIsTTY)`, `routeSettingsNotices(args)` by name, from `lib/settings/notice-channel.ts`.

- [ ] **Step 1: Write the failing rt-client tests**

In `packages/rt-client/src/settings/__tests__/write.test.ts`, replace the expected strings in the share-tip tests with the new wording. The exact replacements, keeping each test's name and setup:

| Test | New expected line |
|---|---|
| "a user write with home sync off says to commit and push" | `` `Saved rt.worktrees in your user settings, but automatic home sync is off. Commit and push your home repo to share it with your other Macs.` `` |
| "a team write with no team remote points at rt team publish --remote" | `` `Saved rt.roles in the ${TEAM} team's settings on this Mac only. The team repo has no remote yet. Run: rt team publish --team ${TEAM} --remote <url>` `` |
| "a team write with team sync off points at rt team publish" | `` `Saved rt.roles in the ${TEAM} team's settings, but automatic team sync is off. Run: rt team publish --team ${TEAM}` `` |
| "removals follow the same rules", team removal | `` `Removed rt.roles from the ${TEAM} team's settings on this Mac only. The team repo has no remote yet. Run: rt team publish --team ${TEAM} --remote <url>` `` |
| "removals follow the same rules", user removal | `` `Removed rt.roles on this Mac only. Your home repo has no remote yet, so the change will not reach your other Macs. Run: rt home remote set` `` |

Replace the sink test wholesale:

```ts
    test("a notice sink receives the sentence and the command apart, and the previous sink comes back on restore", () => {
      const seen: { line: string; notice: SettingsNotice }[] = [];
      const previous = setSettingsNoticeSink((line, notice) => seen.push({ line, notice }));
      let stderr: string[];
      try {
        stderr = captureStderr(() => setSetting("rt.worktrees", { onDeck: 3 }, "user", { repoIdentity: IDENTITY }));
      } finally {
        setSettingsNoticeSink(previous);
      }
      expect(stderr).toEqual([]);
      expect(seen).toEqual([
        {
          line: "Saved rt.worktrees on this Mac only. Your home repo has no remote yet, so it will not reach your other Macs. Run: rt home remote set",
          notice: { text: "Saved rt.worktrees on this Mac only. Your home repo has no remote yet, so it will not reach your other Macs.", next: "rt home remote set" },
        },
      ]);
      expect(captureStderr(() => setSetting("rt.worktrees", { onDeck: 4 }, "user", { repoIdentity: IDENTITY }))).toHaveLength(1);
    });
```

Add `type SettingsNotice` to the file's import from `../write.ts`. Any other test in the file that asserted the old `rt: saved "..."` wording for the user-no-remote case takes the user line from the table's last row with `Saved rt.worktrees` in place of `Removed rt.roles` and `it` in place of `the change`.

- [ ] **Step 2: Run them to verify they fail**

Run (repo root): `bun test packages/rt-client/src/settings/__tests__/write.test.ts`
Expected: FAIL on every share-tip test (old wording) and a type error on `SettingsNotice`.

- [ ] **Step 3: Rewrite the notice in `write.ts`**

Replace the block from `export type SettingsNoticeSink = (line: string) => void;` through the closing brace of `shareTip` with:

```ts
export interface SettingsNotice {
  /** One plain sentence: what was saved or removed, where, and why it stays on this Mac. */
  text: string;
  /** The command that shares it, when one exists. */
  next?: string;
}

/** `line` is the sentence and the command joined for a plain log; `notice` carries them apart for a renderer. */
export type SettingsNoticeSink = (line: string, notice: SettingsNotice) => void;

export function noticeLine(notice: SettingsNotice): string {
  return notice.next ? `${notice.text} Run: ${notice.next}` : notice.text;
}

const stderrSink: SettingsNoticeSink = (line) => console.error(line);
let noticeSink: SettingsNoticeSink = stderrSink;

/**
 * Where a write's share tip goes, returning the sink it replaces so a caller
 * can restore it; null restores the default. The default is stderr because a
 * library caller may own stdout as a JSON channel. A tip is informational, so
 * a caller that has a neutral channel (a TTY's stdout, a setup step's log)
 * routes it there instead of letting it read as an error.
 */
export function setSettingsNoticeSink(sink: SettingsNoticeSink | null): SettingsNoticeSink {
  const previous = noticeSink;
  noticeSink = sink ?? stderrSink;
  return previous;
}

function notify(notice: SettingsNotice): void {
  noticeSink(noticeLine(notice), notice);
}

/**
 * The daemon's snapshot engines commit and push the user and team repos on
 * their own, so a write normally needs no follow-up and prints nothing. A tip
 * prints only when that sync cannot happen: the repo has no origin, or
 * rt.homeSnapshot / rt.teamSnapshot is disabled (a read failure counts as
 * enabled, as the daemon treats it). A pull-only (joined) team clone never
 * gets here: resolveStorePath refuses the write. It assumes the daemon is
 * running; nothing here checks.
 */
function shareTip(verb: "saved" | "removed", key: string, scope: SettingScope, storePath: string): void {
  if (scope === "machine") return;
  const did = verb === "saved" ? `Saved ${key}` : `Removed ${key}`;
  const prep = verb === "saved" ? "in" : "from";
  const it = verb === "saved" ? "it" : "the change";
  if (scope === "user") {
    const repo = dirname(storePath);
    if (!hasOrigin(repo)) {
      notify({ text: `${did} on this Mac only. Your home repo has no remote yet, so ${it} will not reach your other Macs.`, next: "rt home remote set" });
    } else if (!snapshotEnabled("rt.homeSnapshot")) {
      notify({ text: `${did} ${prep} your user settings, but automatic home sync is off. Commit and push your home repo to share ${it} with your other Macs.` });
    }
    return;
  }
  const repo = dirname(dirname(storePath));
  const team = basename(repo);
  if (!hasOrigin(repo)) {
    notify({ text: `${did} ${prep} the ${team} team's settings on this Mac only. The team repo has no remote yet.`, next: `rt team publish --team ${team} --remote <url>` });
  } else if (!snapshotEnabled("rt.teamSnapshot")) {
    notify({ text: `${did} ${prep} the ${team} team's settings, but automatic team sync is off.`, next: `rt team publish --team ${team}` });
  }
}
```

In `packages/rt-client/src/index.ts`, change line 181 to:

```ts
export type { SetSettingOpts, PruneOpts, SettingsNoticeSink, SettingsNotice } from "./settings/write.ts";
```

- [ ] **Step 4: Rebuild rt-client and run its tests**

Run: `cd packages/rt-client && bun run build && cd ../..` then `bun test packages/rt-client`
Expected: PASS, including `packages/rt-client/test/dist-freshness.test.ts`.

- [ ] **Step 5: Write the failing notice-channel tests**

Append to `lib/settings/__tests__/notice-channel.test.ts`, and extend its import to `import { noticeBlocks, routeSettingsNotices, settingsNoticeChannel } from "../notice-channel.ts";` plus `import { setSettingsNoticeSink } from "../write.ts";`, `import { renderPlain } from "../../ui/out-plain.ts";` and `import { captureOut } from "../../ui/__tests__/capture-out.ts";`:

```ts
describe("noticeBlocks", () => {
  test("a tip with a command is a tip callout and a next callout", () => {
    expect(renderPlain(noticeBlocks({ text: "Saved rt.logLevel on this Mac only.", next: "rt home remote set" }))).toBe(
      "  tip: Saved rt.logLevel on this Mac only.\n  next: rt home remote set\n",
    );
  });

  test("a tip without a command is one callout", () => {
    expect(renderPlain(noticeBlocks({ text: "Saved rt.logLevel in your user settings, but automatic home sync is off." }))).toBe(
      "  tip: Saved rt.logLevel in your user settings, but automatic home sync is off.\n",
    );
  });
});

describe("routeSettingsNotices", () => {
  test("at a terminal the installed sink prints the tip on stdout through out", async () => {
    const isTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    const cap = captureOut();
    try {
      await routeSettingsNotices(["settings", "set", "rt.logLevel", '"debug"', "--scope", "user"]);
      const installed = setSettingsNoticeSink(null);
      installed("ignored", { text: "Saved rt.logLevel on this Mac only.", next: "rt home remote set" });
      expect(cap.text()).toBe("  tip: Saved rt.logLevel on this Mac only.\n  next: rt home remote set\n");
      expect(cap.err()).toBe("");
    } finally {
      cap.restore();
      setSettingsNoticeSink(null);
      if (isTTY) Object.defineProperty(process.stdout, "isTTY", isTTY);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  });

  test("off a terminal nothing is installed, so the library's stderr default stays", async () => {
    const isTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    try {
      const before = setSettingsNoticeSink(null);
      setSettingsNoticeSink(before);
      await routeSettingsNotices(["settings", "set", "rt.logLevel", '"debug"', "--scope", "user"]);
      expect(setSettingsNoticeSink(null)).toBe(before);
    } finally {
      if (isTTY) Object.defineProperty(process.stdout, "isTTY", isTTY);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `bun test lib/settings/__tests__/notice-channel.test.ts`
Expected: FAIL, `noticeBlocks` is not exported.

- [ ] **Step 7: Rewrite `notice-channel.ts`**

Replace the whole file:

```ts
/**
 * A settings share tip is information, so a person at a terminal gets it on
 * stdout, drawn as a tip. Anything else reading stdout (a --json envelope, a
 * pipe, the app) owns that channel, so the tip stays on the library's stderr
 * default there.
 */
import * as out from "../ui/out.ts";
import type { Block } from "../ui/protocol.ts";
import type { SettingsNotice } from "./write.ts";

export function settingsNoticeChannel(args: string[], stdoutIsTTY: boolean): "stdout" | "stderr" {
  return stdoutIsTTY && !args.includes("--json") ? "stdout" : "stderr";
}

/** The sentence as a tip, the command as a next; both attach under whatever printed before them in the same call. */
export function noticeBlocks(notice: SettingsNotice): Block[] {
  return [out.callout("tip", notice.text), ...(notice.next ? [out.callout("next", out.cmd(notice.next))] : [])];
}

// Runs on every rt dispatch, so the write path stays a dynamic import.
export async function routeSettingsNotices(args: string[]): Promise<void> {
  if (settingsNoticeChannel(args, process.stdout.isTTY === true) !== "stdout") return;
  const { setSettingsNoticeSink } = await import("./write.ts");
  setSettingsNoticeSink((_line, notice) => out.print(...noticeBlocks(notice)));
}
```

Delete the line `"lib/settings/notice-channel.ts",` from `lib/__tests__/raw-output-allowlist.json`.

- [ ] **Step 8: Run the tests**

Run: `bun test lib/settings/__tests__/notice-channel.test.ts lib/__tests__/no-raw-output.test.ts && bun run typecheck`
Expected: PASS. The typecheck covers `lib/setup/apply.ts`'s one-argument sink against the new two-argument type.

- [ ] **Step 9: Commit**

```bash
git add packages/rt-client/src/settings/write.ts packages/rt-client/src/index.ts packages/rt-client/src/settings/__tests__/write.test.ts lib/settings/notice-channel.ts lib/settings/__tests__/notice-channel.test.ts lib/__tests__/raw-output-allowlist.json
git commit -m "settings: the share tip is a sentence plus a command, drawn as tip and next callouts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `get` as a payload, `list` and `explain`

**Files:**
- Modify: `commands/settings-keys.ts` (imports, `positionals`, `fail`, `failWithError`, `resolveRepoContext`, the formatting helpers, `settingsGet`, `settingsList`, `renderListRow`, `settingsExplain`, `renderExplainRow`)
- Create: `commands/__tests__/settings-get.test.ts`
- Modify: `commands/__tests__/settings-explain.test.ts`, `commands/__tests__/settings-keys-render.test.ts`

**Interfaces:**
- Consumes: `out.print`, `out.fail`, `out.json`, `out.payload`, `out.payloadOnStdout`, `out.kv`, `out.callout`, `out.line`, `out.table`, `out.tree`, `out.key`, `out.faint`, `out.cmd`, `type CellInput`, `type FailureInput` (phase 1); `type Segment`, `type Block` (`lib/ui/protocol.ts`); `type Scope`, `type Provenance` (`lib/settings/resolve.ts`); `captureOut` (Task 1).
- Produces: `fail(f: string | FailureInput): never`, `failWithError(err: unknown): never`, `describeProvenance(provenance: Provenance[]): string`, `migratedNote(def): string | null`, `renderListRow(s: ListedSetting): CellInput[]`, `renderExplainRow(row: ExplainRow, currentName?: string): CellInput[][]`. Tasks 4 and 5 use `fail` and `failWithError` as declared here. `formatValueInline` and `formatValuePretty` keep their signatures; `formatProvenance` is deleted (it has no caller outside this file).

- [ ] **Step 1: Write the failing tests**

Create `commands/__tests__/settings-get.test.ts`:

```ts
/**
 * `rt settings get` prints a payload: the value alone on stdout, every note
 * on stderr. `list` and `explain` print for a person on stdout, and under
 * --json keep stdout to the one envelope rt_verb parses.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { settingsExplain, settingsGet, settingsList } from "../settings-keys.ts";
import { setSetting } from "../../lib/settings/write.ts";
import { closeStateDb, setKvValue } from "../../lib/state/index.ts";
import { captureOut, type Captured } from "../../lib/ui/__tests__/capture-out.ts";

describe("rt settings get / list / explain", () => {
  const origHome = process.env.HOME;
  let home: string;
  let cap: Captured;
  let exits: number[];
  const origExit = process.exit;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-get-")));
    process.env.HOME = home;
    closeStateDb();
    exits = [];
    (process as any).exit = (code?: number) => { exits.push(code ?? 0); throw new Error(`__exit_${code}`); };
    cap = captureOut();
  });

  afterEach(() => {
    cap.restore();
    (process as any).exit = origExit;
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("the value is the payload on stdout and the notes go to stderr", async () => {
    setSetting("rt.logLevel", "debug", "user");
    await settingsGet(["rt.logLevel"]);
    expect(cap.text()).toBe("debug\n");
    expect(cap.err()).toBe("rt.logLevel:\n  from your user settings\n");
  });

  test("an object value is pretty JSON, and provenance names every layer weakest first", async () => {
    setSetting("rt.worktrees", { onDeck: 3 }, "user");
    await settingsGet(["rt.worktrees"]);
    expect(cap.text()).toBe('{\n  "onDeck": 3\n}\n');
    expect(cap.err()).toBe("rt.worktrees:\n  from the built-in default, then your user settings\n");
  });

  test("the value is written raw on stdout and cleaned in the list", async () => {
    setSetting("rt.logLevel", "a\u001b[2Jb\nc", "user");
    await settingsGet(["rt.logLevel"]);
    expect(cap.text()).toBe("a\u001b[2Jb\nc\n");
    cap.stdout.length = 0;
    await settingsList([]);
    expect(cap.text()).toContain("rt.logLevel  ab c");
    expect(cap.text()).not.toContain("\u001b");
  });

  test("an unknown key fails plainly", async () => {
    await expect(settingsGet(["rt.nope"])).rejects.toThrow("__exit_1");
    expect(cap.text()).toBe("");
    expect(cap.err()).toBe("[failed] No setting is called rt.nope\n  next: rt settings list\n");
    await expect(settingsExplain(["rt.nope"])).rejects.toThrow("__exit_1");
    expect(exits).toEqual([1, 1]);
  });

  test("get without a key says what to type", async () => {
    await expect(settingsGet([])).rejects.toThrow("__exit_1");
    expect(cap.err()).toBe("[failed] Name the setting to read\n  next: rt settings get <key>\n");
  });

  test("list --json keeps stdout to one JSON value when the repo has no identity", async () => {
    const repoPath = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-local-repo-")));
    try {
      execSync("git init -q", { cwd: repoPath });
      setKvValue("repo-index", "local-only", repoPath);
      await settingsList(["--repo", "local-only", "--json"]);
      expect(cap.stdout).toHaveLength(1);
      expect(JSON.parse(cap.text()).ok).toBe(true);
      expect(cap.err()).toBe("[warning] Repo settings for local-only are out of reach  its remote is not one rt can key on\n");
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
    }
  });

  test("explain draws the key as a tree with one child per rung, weakest first", async () => {
    setSetting("rt.worktrees", { onDeck: 3 }, "user");
    await settingsExplain(["rt.worktrees"]);
    const lines = cap.text().split("\n");
    expect(lines[0]).toBe("rt.worktrees");
    expect(lines[1]).toMatch(/^  - default\s+built-in default\s+\{"onDeck":0\}$/);
    expect(lines[2]).toMatch(/^  - team\s+no file\s+not set$/);
    expect(lines[3]).toMatch(/^  - user\s+.*settings\.user\.jsonc\s+\{"onDeck":3\}$/);
    expect(cap.err()).toBe("");
  });
});
```

Rewrite `commands/__tests__/settings-explain.test.ts` to capture with the helper instead of a `console.log` spy, keeping both assertions:

```ts
/**
 * `rt settings explain` is agent-safe through rt_verb, which always appends
 * --json and parses stdout as one JSON value: the --json branch must print
 * exactly one envelope and no tree.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { settingsExplain } from "../settings-keys.ts";
import { captureOut, type Captured } from "../../lib/ui/__tests__/capture-out.ts";

describe("rt settings explain", () => {
  const origHome = process.env.HOME;
  let home: string;
  let cap: Captured;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-explain-cli-")));
    process.env.HOME = home;
    cap = captureOut();
  });

  afterEach(() => {
    cap.restore();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("--json prints exactly one parseable envelope with every scope rung", async () => {
    await settingsExplain(["rt.worktrees", "--json"]);

    expect(cap.stdout).toHaveLength(1);
    const payload = JSON.parse(cap.text());
    expect(payload.ok).toBe(true);
    expect(payload.key).toBe("rt.worktrees");
    expect(payload.rows.map((r: { scope: string }) => r.scope)).toEqual(["default", "team", "user", "machine"]);
    expect(payload.rows[0]).toMatchObject({ scope: "default", present: true, value: { onDeck: 0 } });
  });

  test("without --json prints the human tree instead", async () => {
    await settingsExplain(["rt.worktrees"]);

    const lines = cap.text().split("\n");
    expect(lines.some((l) => l.includes("rt.worktrees"))).toBe(true);
    expect(lines.some((l) => l.startsWith("{"))).toBe(false);
  });
});
```

In `commands/__tests__/settings-keys-render.test.ts`, replace the two `plain`/`strip` helpers and every `plain(renderListRow(...))` / `strip(renderExplainRow(...))` call with renders through the plain renderer. Add imports `import * as out from "../../lib/ui/out.ts";` and `import { renderPlain } from "../../lib/ui/out-plain.ts";` and define, in place of `plain` and both `strip`s:

```ts
const listText = (s: ListedSetting) => renderPlain(out.table([renderListRow(s)]));
const explainText = (r: ExplainRow, current?: string) => renderPlain(out.tree(out.key("k"), renderExplainRow(r, current)));
```

Then: every `plain(renderListRow(row(X)))` becomes `listText(row(X))`; every `strip(renderExplainRow(X, Y))` and `plain(renderExplainRow(X))` becomes `explainText(X, Y)`. The one exact-match assertion changes from `toBe("  rt.roles = {\"a\":1}")` to `toBe('rt.roles  {"a":1}\n')`. Every other assertion in the file (`toContain("(unregistered)")` becomes `toContain("unregistered")`; the rest are unchanged substrings) stays.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/settings-get.test.ts commands/__tests__/settings-explain.test.ts commands/__tests__/settings-keys-render.test.ts`
Expected: FAIL. `settings-get` fails on the payload split (today the value is wrapped in blank lines and bold on stdout); the render tests fail because `renderListRow` returns a string.

- [ ] **Step 3: Convert the read side of `settings-keys.ts`**

Replace the import block (lines 26 to 47) with:

```ts
import { parse, type ParseError } from "jsonc-parser";
import { bold, dim, green, red, reset, yellow } from "../lib/tui.ts";
import * as out from "../lib/ui/out.ts";
import type { CellInput, FailureInput } from "../lib/ui/out.ts";
import type { Block, Segment } from "../lib/ui/protocol.ts";
import { loadRepoIndex } from "../lib/repo-index.ts";
import { resolveRepoArg } from "../lib/repo-arg.ts";
import { repoDataDir } from "../lib/rt-paths.ts";
import { deriveRepoIdentity } from "../lib/settings/identity.ts";
import {
  explainSetting,
  getSetting,
  listSettings,
  type ExplainRow,
  type ListedSetting,
  type Provenance,
  type Resolved,
  type Scope,
} from "../lib/settings/resolve.ts";
import { pruneStoreName, setSetting, setSettingsNoticeSink, unsetSetting, type SettingsNotice } from "../lib/settings/write.ts";
import { noticeBlocks } from "../lib/settings/notice-channel.ts";
import { currentStoreName } from "../lib/settings/migrate.ts";
import { getDef, isMigrated, type SettingDef, type SettingScope } from "../lib/settings/registry.ts";
import { firstIssueText, formatIssuePath } from "../lib/settings/schema.ts";
import { checkStores, type CheckFinding } from "../lib/settings/check.ts";
import { planStoreMigrations, type MigrationPlan, type OlderName } from "../lib/settings/migrate-stores.ts";
import { buildInterceptRules, writeInterceptRules } from "../lib/endpoint/shim.ts";
```

(The `tui.ts` import stays until Task 5 removes the last color use. `setSettingsNoticeSink`, `SettingsNotice`, `noticeBlocks` and `Block` are used by Task 4; importing them now is fine, `verbatimModuleSyntax` erases unused type imports and the value imports are used two tasks later.)

In `positionals`, rename the local `out` array to `found` (three occurrences) so it does not shadow the module.

Replace `fail` and `failWithError`:

```ts
function fail(f: string | FailureInput): never {
  out.fail(typeof f === "string" ? { title: f } : f);
  process.exit(1);
}

/** The resolver and writer prefix their messages with "rt: "; the failure block already says who is talking. */
function failWithError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  out.fail({ title: message.replace(/^rt: /, "") });
  process.exit(1);
}
```

In `resolveRepoContext`, replace the `fail(...)` for an unregistered repo and the `console.error(...)` note:

```ts
  if (!repoPath) fail({ title: `${repoName} is not a repo rt knows`, next: out.cmd("rt repos status") });
  const derived = await deriveRepoIdentity(repoPath);
  const identity = derived.kind === "remote" ? derived.id : null;
  if (!identity) {
    out.print(out.line("warn", `Repo settings for ${repoName} are out of reach`, "its remote is not one rt can key on"));
  }
```

Replace `formatProvenance` and `migratedNote` (keep `formatValueInline` and `formatValuePretty` as they are):

```ts
const SCOPE_WORDS: Record<Scope, string> = {
  default: "the built-in default",
  team: "the team's settings",
  user: "your user settings",
  "team.repo": "the team's settings for this repo",
  "user.repo": "your user settings for this repo",
  machine: "this Mac's settings",
  "machine.repo": "this Mac's settings for this repo",
};

/** Weakest first, the order the resolver merges them in. */
export function describeProvenance(provenance: Provenance[]): string {
  if (provenance.length === 0) return "not set anywhere";
  return `from ${provenance.map((p) => SCOPE_WORDS[p.scope]).join(", then ")}`;
}

/** The `migrated:false` note; null for a migrated key. */
export function migratedNote(def: SettingDef): string | null {
  if (isMigrated(def)) return null;
  return def.legacyFile ? "still reads its legacy file" : "not writable through settings yet";
}
```

Replace `settingsGet`:

```ts
export async function settingsGet(args: string[]): Promise<void> {
  const [key] = positionals(args);
  if (!key) fail({ title: "Name the setting to read", next: out.cmd("rt settings get <key>") });
  const json = args.includes("--json");
  // The value is the payload: a script reads it from stdout, so every human line goes to stderr.
  out.payloadOnStdout();
  const repoCtx = await resolveRepoContext(flagValue(args, "--repo"));

  const def = getDef(key);
  if (!def) fail({ title: `No setting is called ${key}`, next: out.cmd("rt settings list") });

  let resolved: Resolved<unknown>;
  try {
    resolved = getSetting(key, {
      repoIdentity: repoCtx.repoIdentity,
      expandCtx: repoCtx.expandCtx,
    });
  } catch (err) {
    failWithError(err);
  }

  if (json) {
    out.json({
      ok: true,
      key,
      value: resolved.value,
      provenance: resolved.provenance,
      migrated: isMigrated(def),
      ...(isMigrated(def) ? {} : { legacyFile: def.legacyFile ?? null }),
    });
    return;
  }

  const note = migratedNote(def);
  out.print(out.kv(key, undefined, describeProvenance(resolved.provenance)), ...(note ? [out.callout("note", note)] : []));
  out.payload(`${formatValuePretty(resolved.value)}\n`);
}
```

Replace `settingsList` and `renderListRow`:

```ts
export async function settingsList(args: string[]): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const repoCtx = await resolveRepoContext(flagValue(args, "--repo"));

  const settings = listSettings({
    repoIdentity: repoCtx.repoIdentity,
    expandCtx: repoCtx.expandCtx,
  });

  if (json) {
    out.json({ ok: true, settings });
    return;
  }

  out.print(out.table(settings.map(renderListRow)));
}

/** One table row: the key, then the value with any caveats beside it. */
export function renderListRow(s: ListedSetting): CellInput[] {
  const labels: string[] = [];
  if (s.unregistered) labels.push("unregistered");
  // `migrated` is a registry fact, so an UNREGISTERED row has none: it comes
  // back false by default, and labelling it "legacy" would name a migration
  // window that does not exist for a key rt has never heard of.
  if (!s.migrated && !s.unregistered) {
    const def = getDef(s.key);
    labels.push(def ? (migratedNote(def) as string) : "reads legacy");
  }
  if (s.expandError) labels.push(`expandError: ${s.expandError}`);
  for (const inv of s.invalid ?? []) labels.push(`invalid[${inv.scope}]: ${inv.reason}`);
  for (const nc of s.nonconforming ?? []) labels.push(`nonconforming[${nc.scope}]: ${firstIssueText(nc.issues)}`);
  if (s.mergedIssues && s.mergedIssues.length > 0) labels.push(`merged: ${firstIssueText(s.mergedIssues)}`);
  for (const d of s.diverged ?? []) labels.push(`diverged[${d.scope}]: ${d.storeNames.join(", ")}`);
  if (s.newer) labels.push("from a newer rt");

  const value: Array<string | Segment> = [formatValueInline(s.value)];
  if (labels.length > 0) value.push({ text: `  ${labels.join("; ")}`, role: "warn" });
  return [out.key(s.key), value];
}
```

Replace `settingsExplain` and `renderExplainRow`:

```ts
export async function settingsExplain(args: string[]): Promise<void> {
  const [key] = positionals(args);
  if (!key) fail({ title: "Name the setting to explain", next: out.cmd("rt settings explain <key>") });
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const repoCtx = await resolveRepoContext(flagValue(args, "--repo"));

  const def = getDef(key);
  if (!def) fail({ title: `No setting is called ${key}`, next: out.cmd("rt settings list") });

  let rows: ExplainRow[];
  try {
    rows = explainSetting(key, { repoIdentity: repoCtx.repoIdentity });
  } catch (err) {
    failWithError(err);
  }

  const currentName = currentStoreName(def);

  if (json) {
    out.json({ ok: true, key, rows, currentStore: currentName ?? null });
    return;
  }

  out.print(out.tree(out.key(key), rows.flatMap((row) => renderExplainRow(row, currentName))));
}

/**
 * One child row per reachable rung, weakest first (the order explainSetting
 * returns them in), plus a row per older store name beside it. A shadowed or
 * invalid value is marked, not applied.
 */
export function renderExplainRow(row: ExplainRow, currentName?: string): CellInput[][] {
  const where = row.file ?? (row.scope === "default" ? "built-in default" : "no file");
  if (!row.present) return [[out.faint(row.scope), out.faint(where), out.faint("not set")]];

  const marks: string[] = [];
  let role: Segment["role"] = "done";
  if (row.shadowed) {
    marks.push(`[shadowed: ${row.shadowed}]`);
    role = "warn";
  }
  if (row.nonconforming) {
    marks.push(`[nonconforming: ${firstIssueText(row.nonconforming)}]`);
    role = "warn";
  }
  if (row.invalid) {
    marks.push(`[invalid: ${row.invalid}]`);
    role = "failed";
  }
  if (currentName !== undefined && row.storeName !== undefined && row.storeName !== currentName) {
    marks.push(`[read from ${row.storeName}, version ${row.storedVersion}]`);
  }

  const main: CellInput[] = [{ text: row.scope, role }, out.faint(where), formatValueInline(row.value)];
  if (marks.length > 0) main.push({ text: marks.join("  "), role: role === "done" ? "dim" : role });

  const older = (row.olderNames ?? []).map((o): CellInput[] => [
    "",
    [
      { text: `older ${o.storeName}: ${o.label}`, role: o.label === "diverged" ? "needs-you" : "dim" },
      ...(o.label === "diverged" ? [`  ${formatValueInline(o.value)}`] : []),
    ],
  ]);
  return [main, ...older];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test commands/__tests__/settings-get.test.ts commands/__tests__/settings-explain.test.ts commands/__tests__/settings-keys-render.test.ts commands/__tests__/settings-json-frozen.test.ts && bun run typecheck`
Expected: PASS. The frozen fixtures `get.txt`, `list.txt` and `explain.txt` are byte-identical.

If the "out of reach" test fails because `deriveRepoIdentity` on a remote-less repo answers `kind: "remote"`, read `packages/rt-client/src/settings/identity.ts` and give the repo a local-path remote instead (`git remote add origin /tmp/elsewhere`), which that module cannot normalize. Do not drop the test.

- [ ] **Step 5: Commit**

```bash
git add commands/settings-keys.ts commands/__tests__/settings-get.test.ts commands/__tests__/settings-explain.test.ts commands/__tests__/settings-keys-render.test.ts
git commit -m "settings get/list/explain: the value is a payload, the rest draws through out

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `set` and `unset`, with the share tip under the confirmation

**Files:**
- Modify: `commands/settings-keys.ts` (`resolveRepoTarget`, `teamFlag`, `settingsSet`, `settingsUnset`; new `whereText`, `requireScope`, `collectSettingsNotices`, `regenBlocks`)
- Create: `commands/__tests__/settings-set.test.ts`
- Modify: `commands/__tests__/settings-keys-unset.test.ts`, `commands/__tests__/settings-keys-hooks-regen.test.ts`

**Interfaces:**
- Consumes: `fail`, `failWithError` (Task 3); `noticeBlocks` (Task 2); `setSettingsNoticeSink`, `type SettingsNotice` (Task 2, two-argument sink); `regenerateInterceptsCache` (existing, unchanged); `regenerateHooksCache(repoRoot, dataDir, repoIdentity)` (`commands/hooks.ts`, existing).
- Produces: `collectSettingsNotices<T>(fn: () => T): { result: T; notices: SettingsNotice[] }` (module-private), `whereText(scope, team, repoName): string`, `regenBlocks(key, target): Promise<Block[]>`.

- [ ] **Step 1: Write the failing tests**

Create `commands/__tests__/settings-set.test.ts`:

```ts
/**
 * `rt settings set` and `unset` confirm in one line and hang the share tip
 * under it in the same print call, so the tip reads as part of the answer
 * and never as an error.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { settingsSet, settingsUnset } from "../settings-keys.ts";
import { userSettingsPath } from "../../lib/rt-paths.ts";
import { closeStateDb } from "../../lib/state/index.ts";
import { captureOut, type Captured } from "../../lib/ui/__tests__/capture-out.ts";

const TIP = "  tip: Saved rt.logLevel on this Mac only. Your home repo has no remote yet, so it will not reach your other Macs.\n  next: rt home remote set\n";

describe("rt settings set / unset output", () => {
  const origHome = process.env.HOME;
  let home: string;
  let cap: Captured;
  let exits: number[];
  const origExit = process.exit;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-set-")));
    process.env.HOME = home;
    closeStateDb();
    exits = [];
    (process as any).exit = (code?: number) => { exits.push(code ?? 0); throw new Error(`__exit_${code}`); };
    cap = captureOut();
  });

  afterEach(() => {
    cap.restore();
    (process as any).exit = origExit;
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("a user write with no home remote prints the confirmation and the tip under it, nothing on stderr", async () => {
    await settingsSet(["rt.logLevel", '"debug"', "--scope", "user"]);
    expect(cap.text()).toBe(`[ok] Saved rt.logLevel  your user settings\n${TIP}`);
    expect(cap.err()).toBe("");
    expect(readFileSync(userSettingsPath(), "utf8")).toContain('"rt.logLevel"');
  });

  test("a machine write prints only the confirmation", async () => {
    await settingsSet(["rt.logLevel", '"debug"', "--scope", "machine"]);
    expect(cap.text()).toBe("[ok] Saved rt.logLevel  this Mac's settings\n");
  });

  test("a bare word is refused with the quoting tip and nothing is written", async () => {
    await expect(settingsSet(["rt.logLevel", "debug", "--scope", "user"])).rejects.toThrow("__exit_1");
    expect(cap.err()).toBe("[failed] The value is not valid JSON  debug\n  why: A string needs its own quotes, so the shell does not eat them: '\"debug\"'.\n");
    expect(cap.text()).toBe("");
    expect(existsSync(userSettingsPath())).toBe(false);
  });

  test("a missing scope names the three scopes and the command to type", async () => {
    await expect(settingsSet(["rt.logLevel", '"debug"'])).rejects.toThrow("__exit_1");
    expect(cap.err()).toBe(
      "[failed] Say which settings to write\n  why: A value lives in exactly one of your user, team or machine settings.\n  next: rt settings set <key> <value> --scope user|team|machine\n",
    );
  });

  test("a team name with the user scope is refused", async () => {
    await expect(settingsSet(["rt.logLevel", '"debug"', "--scope", "user", "--team", "acme"])).rejects.toThrow("__exit_1");
    expect(cap.err()).toContain("[failed] A team name only goes with the team scope");
    expect(cap.err()).toContain("why: You asked for the user scope.");
  });

  test("unset of an absent key is skipped, not failed, and prints no tip", async () => {
    await settingsUnset(["rt.logLevel", "--scope", "user"]);
    expect(cap.text()).toBe("[skipped] rt.logLevel was not set  nothing to remove from your user settings\n");
    expect(cap.err()).toBe("");
    expect(exits).toEqual([]);
  });

  test("unset of a present key prints Removed and the removal tip", async () => {
    await settingsSet(["rt.logLevel", '"debug"', "--scope", "user"]);
    cap.stdout.length = 0;
    await settingsUnset(["rt.logLevel", "--scope", "user"]);
    expect(cap.text()).toBe(
      "[ok] Removed rt.logLevel  from your user settings\n" +
        "  tip: Removed rt.logLevel on this Mac only. Your home repo has no remote yet, so the change will not reach your other Macs.\n" +
        "  next: rt home remote set\n",
    );
    expect(readFileSync(userSettingsPath(), "utf8")).not.toContain('"rt.logLevel"');
  });
});
```

In `commands/__tests__/settings-keys-hooks-regen.test.ts`, the refusal test spies `console.error`; change it to the helper. Replace the body of "a write with no --repo is refused..." with:

```ts
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit sentinel");
    });
    const cap = captureOut();
    try {
      await expect(settingsSet(["rt.hooks", '{"enabled":false,"hooks":{}}', "--scope", "user"])).rejects.toThrow("process.exit sentinel");
      expect(cap.err()).toMatch(/repo-only/);
      expect(cap.err()).toMatch(/^\[failed\] /);
    } finally {
      exitSpy.mockRestore();
      cap.restore();
    }
    expect(() => readFileSync(hooksConfigPath(repoDataDir("hooks-regen-repo")), "utf8")).toThrow();
```

and add `import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";`. In `commands/__tests__/settings-keys-unset.test.ts`, add the same import, call `cap = captureOut()` at the end of `beforeEach` and `cap.restore()` at the start of `afterEach` (declare `let cap: ReturnType<typeof captureOut>;`), so the suite stops printing to the runner's terminal; its assertions do not change.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/settings-set.test.ts commands/__tests__/settings-keys-hooks-regen.test.ts`
Expected: FAIL. `settings-set` sees the old `✓ rt.logLevel set (user)` wording and the tip on stderr; the hooks-regen refusal sees `rt settings: ...` without the `[failed]` tag.

- [ ] **Step 3: Convert `set` and `unset`**

Add after `failWithError`:

```ts
/** Holds the share tips a write emits so the verb can print them under its own confirmation line. */
function collectSettingsNotices<T>(fn: () => T): { result: T; notices: SettingsNotice[] } {
  const notices: SettingsNotice[] = [];
  const previous = setSettingsNoticeSink((_line, notice) => notices.push(notice));
  try {
    return { result: fn(), notices };
  } finally {
    setSettingsNoticeSink(previous);
  }
}

function whereText(scope: SettingScope, team: string | undefined, repoName: string | undefined): string {
  const store = scope === "user" ? "your user settings" : scope === "machine" ? "this Mac's settings" : team ? `the ${team} team's settings` : "the team's settings";
  return repoName ? `${store} for ${repoName}` : store;
}
```

Replace the `VALID_SCOPES` line, `resolveRepoTarget`'s two `fail` calls, and `teamFlag`:

```ts
const VALID_SCOPES: SettingScope[] = ["user", "team", "machine"];

function requireScope(scope: string | undefined, title: string, usage: string): SettingScope {
  if (!scope) fail({ title, why: "A value lives in exactly one of your user, team or machine settings.", next: out.cmd(usage) });
  if (!VALID_SCOPES.includes(scope as SettingScope)) fail({ title: `${scope} is not a scope`, why: "The scopes are user, team and machine.", next: out.cmd(usage) });
  return scope as SettingScope;
}
```

Inside `resolveRepoTarget`:

```ts
  if (!repoPath) fail({ title: `${repoName} is not a repo rt knows`, next: out.cmd("rt repos status") });
  const derived = await deriveRepoIdentity(repoPath);
  if (derived.kind !== "remote") {
    fail({ title: `Repo settings for ${repoName} have nowhere to live`, why: "Its remote is not one rt can key settings on, so nothing would read a value written for it." });
  }
```

```ts
/** Shared by set and unset: `--team` only means anything at team scope. */
function teamFlag(args: string[], scope: SettingScope): string | undefined {
  const team = flagValue(args, "--team");
  if (args.includes("--team")) {
    const usage = "rt settings set <key> <value> --scope team --team <name>";
    if (scope !== "team") fail({ title: "A team name only goes with the team scope", why: `You asked for the ${scope} scope.`, next: out.cmd(usage) });
    if (team === undefined || team.startsWith("--") || team.trim() === "") fail({ title: "Name the team", next: out.cmd(usage) });
  }
  return team;
}
```

Replace `settingsSet`:

```ts
const SET_USAGE = "rt settings set <key> <value> --scope user|team|machine";

export async function settingsSet(args: string[]): Promise<void> {
  const [key, rawValue] = positionals(args);
  if (!key || rawValue === undefined) fail({ title: "Give the setting a key and a value", next: out.cmd(SET_USAGE) });
  const scope = requireScope(flagValue(args, "--scope"), "Say which settings to write", SET_USAGE);

  // `--team` is the CLI surface for `setSetting`'s team selection (see
  // write.ts's "Team selection"). Taking it silently at user/machine scope
  // would let a `--scope user --team acme` write look like it targeted a team
  // store while writing the user one.
  const team = teamFlag(args, scope);

  const trimmed = rawValue.trim();
  const errors: ParseError[] = [];
  const value = trimmed === "" ? undefined : parse(trimmed, errors, { allowTrailingComma: true });
  if (trimmed === "" || errors.length > 0) {
    fail({ title: "The value is not valid JSON", hint: rawValue, why: "A string needs its own quotes, so the shell does not eat them: '\"debug\"'." });
  }

  const target = await resolveRepoTarget(args);

  const { notices } = collectSettingsNotices(() => {
    try {
      setSetting(key, value, scope, { repoIdentity: target.repoIdentity, team });
    } catch (err) {
      failWithError(err);
    }
  });

  out.print(
    out.line("done", `Saved ${key}`, whereText(scope, team, target.repoName)),
    ...notices.flatMap(noticeBlocks),
    ...(await regenBlocks(key, target)),
  );
}
```

Replace `settingsUnset`:

```ts
const UNSET_USAGE = "rt settings unset <key> --scope user|team|machine";

/**
 * Removes a key from one authored store. The counterpart to `set`, and the
 * only supported way to take a key back out: hand-editing a store `.jsonc` is
 * banned (it silently corrupts a store into reading as empty).
 *
 * Runs the same derived-cache regeneration as `set`, because removing a value
 * changes what the resolver returns exactly as writing one does... a stale
 * intercepts cache after an unset would keep matching the removed rules.
 */
export async function settingsUnset(args: string[]): Promise<void> {
  const [key] = positionals(args);
  if (!key) fail({ title: "Name the setting to remove", next: out.cmd(UNSET_USAGE) });
  const scope = requireScope(flagValue(args, "--scope"), "Say which settings to remove it from", UNSET_USAGE);
  const team = teamFlag(args, scope);
  const target = await resolveRepoTarget(args);

  const removed = collectSettingsNotices(() => {
    try {
      return unsetSetting(key, scope, { repoIdentity: target.repoIdentity, team });
    } catch (err) {
      failWithError(err);
    }
  });

  const where = whereText(scope, team, target.repoName);
  // A key that was not there is success, not a failure: `unset` is how a
  // script makes sure a key is absent, so it has to be safe to run twice.
  if (!removed.result) {
    out.print(out.line("skipped", `${key} was not set`, `nothing to remove from ${where}`));
    return;
  }

  out.print(
    out.line("done", `Removed ${key}`, `from ${where}`),
    ...removed.notices.flatMap(noticeBlocks),
    ...(await regenBlocks(key, target)),
  );
}
```

Add, above the `// ─── the intercepts.json regeneration seam` comment block (keep that block and `regenerateInterceptsCache` as they are):

```ts
/**
 * The derived caches a write may have invalidated, as lines under the
 * confirmation. hooks.json is rebuilt only for a `--repo` write: a global
 * write can change the resolved value for every other repo too, and
 * deriving every repo's identity (a git spawn each) on one `set` is out of
 * scope; `rt hooks status` in an affected repo refreshes its cache.
 */
async function regenBlocks(key: string, target: { repoName?: string; repoPath?: string; repoIdentity?: string; repoKey?: string }): Promise<Block[]> {
  const blocks: Block[] = [];
  const regen = await regenerateInterceptsCache(key);
  if (regen.regenerated) {
    blocks.push(out.line("done", "Intercepts updated", `${regen.rules} rule${regen.rules === 1 ? "" : "s"}`));
  } else if (regen.error) {
    blocks.push(out.line("warn", "Intercepts not updated", regen.error), out.callout("next", out.cmd("rt intercept install")));
  }
  if (key === "rt.hooks" && target.repoPath && target.repoIdentity && target.repoKey) {
    const { regenerateHooksCache } = await import("./hooks.ts");
    if (regenerateHooksCache(target.repoPath, repoDataDir(target.repoKey), target.repoIdentity)) {
      blocks.push(out.line("done", "Hooks updated", target.repoName));
    } else {
      blocks.push(out.line("warn", `Hooks not updated for ${target.repoName}`), out.callout("next", [out.cmd("rt hooks status"), " in that repo"]));
    }
  }
  return blocks;
}
```

Delete the two older comment paragraphs about hooks.json and the intercepts seam that sat inside `settingsSet` (their content now lives on `regenBlocks` and the seam block).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test commands/__tests__/settings-set.test.ts commands/__tests__/settings-keys-unset.test.ts commands/__tests__/settings-keys-hooks-regen.test.ts commands/__tests__/settings-json-frozen.test.ts lib/endpoint/__tests__/settings-regen.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/settings-keys.ts commands/__tests__/settings-set.test.ts commands/__tests__/settings-keys-unset.test.ts commands/__tests__/settings-keys-hooks-regen.test.ts
git commit -m "settings set/unset: one confirmation line with the share tip under it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `check` and `migrate`, and the file leaves the allowlist

**Files:**
- Modify: `commands/settings-keys.ts` (`renderCheckFinding`, `settingsCheck`, the migrate section; delete the `tui.ts` import)
- Modify: `commands/__tests__/settings-check.test.ts`, `commands/__tests__/settings-migrate.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete the `commands/settings-keys.ts` line)

**Interfaces:**
- Consumes: `fail` (Task 3), `out.table`, `out.summary`, `out.section`, `out.paragraph`, `out.line`, `out.key`, `out.faint` (phase 1); `CheckFinding`, `MigrationPlan`, `OlderName` (existing types, `lib/settings/check.ts`, `lib/settings/migrate-stores.ts`).
- Produces: `renderCheckFinding(f: CheckFinding): CellInput[][]`, `trimRow(cells: CellInput[]): CellInput[]` (module-private). `settingsMigrate(args, deps)` keeps its `MigrateDeps` signature.

- [ ] **Step 1: Rewrite the two test files' capture and the assertions that read exact lines**

In `commands/__tests__/settings-check.test.ts`: replace the `logSpy` field and its `beforeEach`/`afterEach` lines with `let cap: Captured;`, `cap = captureOut();` (after `process.exitCode = 0;`) and `cap.restore();` (first line of `afterEach`); add `import { captureOut, type Captured } from "../../lib/ui/__tests__/capture-out.ts";`; delete `stripAnsi`. Then:

- In every `--json` test, `const printed = logSpy.mock.calls.map(...).find(...)` becomes `const printed = cap.text();`.
- Replace the human test's body after `await settingsCheck([]);` with:

```ts
    const lines = cap.text().split("\n");
    const layer = lines.findIndex((l) => l.includes("rt.homeSnapshot") && l.includes("nonconforming"));
    expect(lines[layer]).toContain("machine");
    expect(lines[layer]).toContain(machineSettingsPath());
    expect(lines[layer + 1]).toMatch(/^\s+enabled: expected boolean, got string$/);
    expect(lines[layer + 2]).toMatch(/^\s+debounceSec: expected number, got string$/);

    const merged = lines.findIndex((l) => l.includes("rt.homeSnapshot") && l.includes("merged"));
    expect(lines[merged]).toMatch(/^rt\.homeSnapshot\s+merged$/);
    expect(lines[merged + 1]).toMatch(/^\s+enabled: expected boolean, got string$/);
    expect(lines[merged + 2]).toMatch(/^\s+debounceSec: expected number, got string$/);
    expect(cap.text()).toMatch(/\n\[failed\] Some stored settings need fixing  \d+ failing, 0 unregistered, 0 stale or leftover\n$/);
    expect(process.exitCode).toBe(1);
```

- In "a diverged older name exits 1 and prints both values", `const out = stripAnsi(...)` becomes `const text = cap.text();` and the three `expect(out)` become `expect(text)`.
- Add one test:

```ts
  test("clean stores print one done summary and nothing else", async () => {
    write(machineSettingsPath(), { "rt.repoRoots": ["~/Documents/GitHub"] });
    await settingsCheck([]);
    expect(cap.text()).toBe("[ok] Your stored settings check out  0 failing, 0 unregistered, 0 stale or leftover\n");
    expect(process.exitCode).toBe(0);
  });
```

In `commands/__tests__/settings-migrate.test.ts`: replace `logSpy` and `errSpy` with `cap` the same way (keep `warnSpy`, rt-client still warns through `console.warn` for an unregistered key). Then:

- `printed()` becomes `() => cap.text()`; `allJsonBodies()` becomes `() => cap.stdout.filter((l) => l.startsWith("{")).map((l) => JSON.parse(l))`.
- `const body = JSON.parse(logSpy.mock.calls...find((l) => l.startsWith("{"))!)` becomes `const body = JSON.parse(cap.stdout.find((l) => l.startsWith("{"))!)`.
- The two `--force needs a key` assertions read `cap.err()` instead of `errSpy...`.
- The `--force rt.roles matches no older store name in this plan` assertion reads `cap.text()` (the line is a warning on stdout now, not an error).
- The two `deleting diverged` assertions become `expect(printed()).toContain(`Deleting diverged ${EB}`)` plus `expect(printed()).toContain(`its value was: ${JSON.stringify(EB_V1)}`)`, and in the secret test `expect(printed()).toContain("its value was: (secret)")`.
- Add to the "a dry run" test: `expect(printed()).toMatch(/^rt\.notify\.eventBridges\s+user\s+.*settings\.user\.jsonc\s+would write/);`.
- Add one test:

```ts
  test("a dry run with nothing to do is one done line", async () => {
    await settingsMigrate([], noPrompt);
    expect(printed()).toBe("[ok] Every stored setting is under its current name\n");
    expect(process.exitCode).toBe(0);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/settings-check.test.ts commands/__tests__/settings-migrate.test.ts`
Expected: FAIL on the human-output assertions (old line shapes); the `--json` cases still pass.

- [ ] **Step 3: Convert `check`**

Replace `renderCheckFinding` and `settingsCheck`:

```ts
/** Drops empty trailing cells so a row without a store name or file does not end in padding. */
function trimRow(cells: CellInput[]): CellInput[] {
  const text = (c: CellInput): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((s) => (typeof s === "string" ? s : s.text)).join("") : c.text);
  while (cells.length > 1 && text(cells[cells.length - 1]!) === "") cells.pop();
  return cells;
}

/**
 * A row per finding, then a row per value or issue under it. A `merged`
 * finding carries no scope or file, so its row names only the repo, if any.
 */
export function renderCheckFinding(f: CheckFinding): CellInput[][] {
  const where = [f.scope, f.repo].filter(Boolean).join("/");
  const kindText = f.newer ? "unregistered (from a newer rt)" : f.kind;
  const role: Segment["role"] = f.kind === "stale" || f.kind === "leftover" ? "dim" : f.kind === "unregistered" ? "warn" : "failed";
  const rows: CellInput[][] = [trimRow([out.key(f.key), where, { text: kindText, role }, f.storeName ?? "", out.faint(f.file ?? "")])];
  if (f.kind === "diverged" && "olderValue" in f) {
    rows.push(["", `${f.storeName}: ${formatValueInline(f.olderValue)}`], ["", `current: ${formatValueInline(f.currentValue)}`]);
  }
  for (const i of f.issues) rows.push(["", `${formatIssuePath(i.path)}: ${i.message}`]);
  return rows;
}

export async function settingsCheck(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const report = checkStores();

  if (json) {
    out.json({ ok: report.failing === 0, findings: report.findings });
  } else {
    const unregistered = report.findings.filter((f) => f.kind === "unregistered").length;
    const older = report.findings.filter((f) => f.kind === "stale" || f.kind === "leftover").length;
    out.print(
      out.table(report.findings.flatMap(renderCheckFinding)),
      out.summary(
        report.failing > 0 ? "failed" : "done",
        report.failing > 0 ? "Some stored settings need fixing" : "Your stored settings check out",
        [`${report.failing} failing`, `${unregistered} unregistered`, `${older} stale or leftover`],
      ),
    );
  }

  if (report.failing > 0) process.exitCode = 1;
}
```

- [ ] **Step 4: Convert `migrate`**

Replace everything from `const whereOf = ...` through the end of the file:

```ts
const whereCells = (x: { scope: string; repo?: string; file: string }): CellInput[] => [[x.scope, x.repo].filter(Boolean).join("/"), out.faint(x.file)];
const isSecret = (key: string) => getDef(key)?.secret === true;
const shown = (key: string, value: unknown) => (isSecret(key) ? "(secret)" : formatValueInline(value));
/** `undefined` rather than a placeholder string: JSON.stringify drops the property entirely, matching check.ts's own secret handling. */
const redacted = (key: string, value: unknown): unknown => (isSecret(key) ? undefined : value);
const redactOlder = <T extends OlderName>(o: T): T => ({
  ...o,
  olderValue: redacted(o.key, o.olderValue),
  currentValue: redacted(o.key, o.currentValue),
  authored: redacted(o.key, o.authored),
});

function olderRows(o: OlderName): CellInput[][] {
  const row: CellInput[] = [out.key(o.key), ...whereCells(o), { text: `${o.storeName}: ${o.label}`, role: o.label === "diverged" ? "needs-you" : "dim" }];
  if (o.label !== "diverged") return [row];
  return [row, ["", "", "", `${o.storeName}: ${shown(o.key, o.olderValue)}`], ["", "", "", `current: ${shown(o.key, o.currentValue)}`]];
}

const failureRow = (f: MigrationPlan["failures"][number]): CellInput[] => [out.key(f.key), ...whereCells(f), { text: `cannot migrate ${f.fromName}: ${f.message}`, role: "failed" }];

/**
 * rt settings migrate [--write | --prune [--team] [--force <key>]... [--yes]] [--json]
 * Dry run by default. --write is additive (current names from migrated
 * values, baselines recorded by the ordinary write path); --prune deletes
 * leftover and stale older names through pruneStoreName after confirmation.
 */
export async function settingsMigrate(args: string[], deps: MigrateDeps = {}): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const write = args.includes("--write");
  const prune = args.includes("--prune");
  if (write && prune) {
    out.fail({ title: "Write and prune are separate runs", why: "Prune only once every reader of the store knows the new names.", next: out.cmd("rt settings migrate --write") });
    process.exitCode = 1;
    return;
  }
  const plan = planStoreMigrations();
  if (write) return migrateWrite(plan, json);
  if (prune) {
    const forced = new Set<string>();
    let forceUsageError = false;
    args.forEach((a, i) => {
      if (a !== "--force") return;
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) forceUsageError = true;
      else forced.add(value);
    });
    if (forceUsageError) {
      out.fail({ title: "--force needs a key", hint: "for example --force rt.notify.eventBridges" });
      process.exitCode = 1;
      return;
    }
    const unmatched = [...forced].filter((key) => !plan.older.some((o) => o.key === key));
    if (unmatched.length > 0) out.print(...unmatched.map((key) => out.line("warn", `--force ${key} matches no older store name in this plan`)));
    const interactive = deps.interactive ?? (process.stdin.isTTY === true && !json && !process.env.RT_BATCH);
    const ask = deps.confirm ?? (async (message: string) => (await import("../lib/ui/prompts.ts")).confirm({ message, destructive: true }));
    return migratePrune(plan, { json, team: args.includes("--team"), yes: args.includes("--yes"), forced, interactive, ask });
  }
  if (json) {
    out.json({
      ok: plan.failures.length === 0,
      writes: plan.writes.map((w) => ({ ...w, value: redacted(w.key, w.value) })),
      failures: plan.failures,
      older: plan.older.map((o) => redactOlder(o)),
    });
  } else {
    const rows: CellInput[][] = [
      ...plan.writes.map((w): CellInput[] => [out.key(w.key), ...whereCells(w), `would write ${w.storeName} from ${w.fromName}: ${shown(w.key, w.value)}`]),
      ...plan.failures.map(failureRow),
      ...plan.older.flatMap(olderRows),
    ];
    out.print(rows.length > 0 ? out.table(rows) : out.line("done", "Every stored setting is under its current name"));
  }
  if (plan.failures.length > 0) process.exitCode = 1;
}

function migrateWrite(plan: MigrationPlan, json: boolean): void {
  const written: MigrationPlan["writes"] = [];
  const errors: { key: string; file: string; repo?: string; error: string }[] = [];
  for (const w of plan.writes) {
    try {
      setSetting(w.key, w.value, w.scope, { ...(w.repo ? { repoIdentity: w.repo } : {}), ...(w.team ? { team: w.team } : {}) });
      written.push(w);
    } catch (err) {
      errors.push({ key: w.key, file: w.file, ...(w.repo ? { repo: w.repo } : {}), error: (err as Error).message });
    }
  }
  const ok = errors.length === 0 && plan.failures.length === 0;
  if (json) {
    out.json({ ok, written: written.map((w) => ({ ...w, value: redacted(w.key, w.value) })), errors, failures: plan.failures });
  } else {
    const rows: CellInput[][] = [
      ...written.map((w): CellInput[] => [out.key(w.key), ...whereCells(w), `wrote ${w.storeName} from ${w.fromName}`]),
      ...errors.map((e): CellInput[] => [out.key(e.key), { text: e.error, role: "failed" }]),
      ...plan.failures.map(failureRow),
    ];
    out.print(rows.length > 0 ? out.table(rows) : out.line("skipped", "Nothing to write"));
  }
  if (!ok) process.exitCode = 1;
}

async function migratePrune(
  plan: MigrationPlan,
  o: { json: boolean; team: boolean; yes: boolean; forced: Set<string>; interactive: boolean; ask: (message: string) => Promise<boolean> },
): Promise<void> {
  const refused: (OlderName & { reason: string })[] = [];
  const pruned: OlderName[] = [];
  const byFile = new Map<string, OlderName[]>();
  for (const n of plan.older) {
    if (n.scope === "team" && !o.team) refused.push({ ...n, reason: "team store: pass --team to prune it" });
    else if (n.label === "diverged" && !o.forced.has(n.key)) refused.push({ ...n, reason: `diverged: pass --force ${n.key} to delete it` });
    else byFile.set(n.file, [...(byFile.get(n.file) ?? []), n]);
  }
  for (const [file, names] of byFile) {
    const scope = names[0]!.scope;
    if (!o.json) {
      const versions = [...new Map(names.map((n) => [n.key, n.storeVersion])).entries()].map(([k, v]) => `${k} (storeVersion ${v})`);
      out.print(
        out.section(
          `${scope} store`,
          file,
          out.table(names.map((n): CellInput[] => [n.storeName, n.repo ?? "", n.label])),
          out.paragraph(`Every reader of this store must know: ${versions.join(", ")}`),
        ),
      );
    }
    const noun = names.length === 1 ? "name" : "names";
    const approved = o.yes || (o.interactive && (await o.ask(`Delete ${names.length} older store ${noun} from the ${scope} store (${file})?`)));
    if (!approved) {
      const reason = o.interactive ? "not confirmed" : "confirmation needed: run on a terminal, or pass --yes";
      for (const n of names) refused.push({ ...n, reason });
      continue;
    }
    for (const n of names) {
      if (n.label === "diverged" && !o.json) out.print(out.line("warn", `Deleting diverged ${n.storeName}`, `its value was: ${shown(n.key, n.authored)}`));
      try {
        pruneStoreName(n.key, n.storeName, n.scope, { ...(n.repo ? { repoIdentity: n.repo } : {}), ...(n.team ? { team: n.team } : {}), force: n.label === "diverged" });
        pruned.push(n);
      } catch (err) {
        refused.push({ ...n, reason: (err as Error).message });
      }
    }
  }
  if (o.json) {
    out.json({ ok: refused.length === 0, pruned: pruned.map((n) => redactOlder(n)), refused: refused.map((r) => redactOlder(r)) });
  } else {
    out.print(
      out.table(refused.map((r): CellInput[] => [out.key(r.key), ...whereCells(r), { text: `${r.storeName}: ${r.reason}`, role: "refused" }])),
      out.summary(refused.length > 0 ? "warn" : "done", `Pruned ${pruned.length} older ${pruned.length === 1 ? "name" : "names"}`, [`${pruned.length} pruned`, `${refused.length} refused`]),
    );
  }
  if (refused.length > 0) process.exitCode = 1;
}
```

Delete the line `import { bold, dim, green, red, reset, yellow } from "../lib/tui.ts";`. Delete the line `"commands/settings-keys.ts",` from `lib/__tests__/raw-output-allowlist.json`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test commands/__tests__/ lib/__tests__/no-raw-output.test.ts lib/endpoint/__tests__/settings-regen.test.ts && bun run typecheck`
Expected: PASS. `grep -n 'console\.\|tui\.ts\|\\x1b' commands/settings-keys.ts` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add commands/settings-keys.ts commands/__tests__/settings-check.test.ts commands/__tests__/settings-migrate.test.ts lib/__tests__/raw-output-allowlist.json
git commit -m "settings check/migrate: tables and a summary; settings-keys.ts leaves the raw-output allowlist

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `commands/settings.ts` (`source-path` as a payload, `test-push`, `sdm set-email`)

**Files:**
- Modify: `commands/settings.ts` (imports; `setSdmEmail`, `sendTestPushNotification`, `SourcePathSeams`, `sourcePathCommand`)
- Modify: `commands/__tests__/settings-source-path.test.ts`
- Create: `commands/__tests__/settings-misc.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete the `commands/settings.ts` line)

**Interfaces:**
- Consumes: `out.print`, `out.fail`, `out.json`, `out.payload`, `out.payloadOnStdout`, `out.line`, `out.callout`, `out.cmd`, `type FailureInput` (phase 1); `type Block` (`lib/ui/protocol.ts`); `renderPlain` (`lib/ui/out-plain.ts`, in the test); `envelope` (existing, `lib/setup/contract.ts`).
- Produces: `interface SourcePathSeams { print(...blocks: Block[]): void; fail(f: FailureInput): void; json(value: unknown): void; payload(text: string): void; exit(code: number): never }`. `rt sdm set-email` is converted here because it lives in this file; the `sdm` family otherwise belongs to phase 5.

- [ ] **Step 1: Rewrite the source-path test harness and add the output tests**

In `commands/__tests__/settings-source-path.test.ts`, replace `run` with:

```ts
import * as out from "../../lib/ui/out.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";

async function run(args: string[]): Promise<{ out: string[]; human: string[]; err: string[]; exitCode: number | null }> {
  const r = { out: [] as string[], human: [] as string[], err: [] as string[], exitCode: null as number | null };
  await sourcePathCommand(args, {}, {
    print: (...blocks) => r.human.push(renderPlain(blocks)),
    fail: (f) => r.err.push(renderPlain([out.failure(f)])),
    json: (v) => r.out.push(JSON.stringify(v) + "\n"),
    payload: (text) => r.out.push(text),
    exit: ((code: number) => { r.exitCode = code; }) as unknown as (code: number) => never,
  });
  out.__test__.reset();
  return r;
}
```

(`out.__test__.reset()` undoes the `payloadOnStdout()` the read branch calls.) Keep every existing test; `JSON.parse(r.out.join("\n"))` still parses a single entry. Add three tests inside the `describe`:

```ts
  test("the stored path is the payload, bare and alone on stdout", async () => {
    const src = checkout();
    await run([src]);
    const r = await run([]);
    expect(r.out).toEqual([`${src}\n`]);
    expect(r.human).toEqual([]);
  });

  test("with no checkout stored, stdout stays empty and the hint is human text", async () => {
    const r = await run([]);
    expect(r.out).toEqual([]);
    expect(r.human).toEqual(["[not yet] No source checkout set yet\n  next: rt settings source-path <path>\n"]);
  });

  test("a folder that is not a checkout fails with the path as the hint and exits 2", async () => {
    const notRt = mkdtempSync(join(tmpdir(), "rt-source-path-bad-"));
    dirs.push(notRt);
    const r = await run([notRt]);
    expect(r.err).toEqual([`[failed] That folder is not an rt checkout  ${notRt}\n  why: It has no cli.ts.\n`]);
    expect(r.exitCode).toBe(2);
  });
```

Create `commands/__tests__/settings-misc.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { sendTestPushNotification } from "../settings.ts";
import { captureOut, type Captured } from "../../lib/ui/__tests__/capture-out.ts";

const origHome = process.env.HOME;
let home: string;
let cap: Captured;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-misc-")));
  process.env.HOME = home;
  cap = captureOut();
});

afterEach(() => {
  cap.restore();
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

test("test-push with no app running is an off line, not a failure", async () => {
  await sendTestPushNotification();
  expect(cap.text()).toBe("[off] The mattstack app is not running  open it, then try again\n");
  expect(cap.err()).toBe("");
  expect(process.exitCode ?? 0).toBe(0);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/settings-source-path.test.ts commands/__tests__/settings-misc.test.ts`
Expected: FAIL. The source-path harness's seams no longer match `SourcePathSeams` (type error), and test-push prints the old `⚠ rt tray is not running` lines.

- [ ] **Step 3: Convert `settings.ts`**

Replace the import `import { dim, green, red, reset, yellow } from "../lib/tui.ts";` with:

```ts
import * as out from "../lib/ui/out.ts";
import type { FailureInput } from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
```

Replace `setSdmEmail`:

```ts
export async function setSdmEmail(args: string[]): Promise<void> {
  const secrets = await loadSecrets();
  const fromArgs = args.find(a => !a.startsWith("--"))?.trim();

  let email: string;
  if (fromArgs) {
    email = fromArgs;
  } else if (!process.stdin.isTTY) {
    out.fail({ title: "No email given and no terminal to ask in", next: out.cmd("rt sdm set-email <email>") });
    process.exitCode = 1;
    return;
  } else {
    const { textInput } = await import("../lib/rt-render.ts");
    try {
      email = await textInput({
        message: "StrongDM account email",
        placeholder: secrets.sdmEmail
          ? "••• (already set, leave empty to keep)"
          : "you@example.com",
      });
    } catch {
      if (secrets.sdmEmail) out.print(out.line("skipped", "Kept your StrongDM email"));
      return;
    }
  }

  if (!email.trim()) {
    out.print(secrets.sdmEmail ? out.line("skipped", "Kept your StrongDM email") : out.line("skipped", "No email entered"));
    return;
  }

  try {
    await saveSecret("sdmEmail", email.trim());
  } catch (err) {
    out.fail({ title: "Could not save your StrongDM email", why: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
  out.print(out.line("done", "StrongDM email saved"));
}
```

Replace `sendTestPushNotification`:

```ts
export async function sendTestPushNotification(): Promise<void> {
  const { TRAY_SOCK_PATH } = await import("../lib/daemon-config.ts");

  if (!existsSync(TRAY_SOCK_PATH)) {
    out.print(out.line("off", "The mattstack app is not running", "open it, then try again"));
    return;
  }

  const event = {
    id: crypto.randomUUID(),
    title: "rt test notification",
    message: "If you see this, the tray is wired up correctly.",
    category: "test",
    timestamp: Date.now(),
  };

  try {
    const response = await fetch("http://localhost/notify", {
      unix: TRAY_SOCK_PATH,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(2000),
    } as any);

    if (response.ok) {
      out.print(out.line("done", "Test notification sent"));
    } else {
      out.fail({ title: "The app did not accept the test notification", hint: `HTTP ${response.status}` });
    }
  } catch (e) {
    out.fail({ title: "Could not reach the mattstack app", why: (e as Error).message });
  }
}
```

Replace `SourcePathSeams` and `sourcePathCommand`:

```ts
export interface SourcePathSeams {
  print: (...blocks: Block[]) => void;
  fail: (f: FailureInput) => void;
  json: (value: unknown) => void;
  payload: (text: string) => void;
  exit: (code: number) => never;
}

const realSeams: SourcePathSeams = { print: out.print, fail: out.fail, json: out.json, payload: out.payload, exit: (c) => process.exit(c) };

/**
 * `rt settings source-path [<path>]`: reads or sets the rt checkout the dev
 * app runs. Setting it while the dev wrapper owns ~/.local/bin/rt rewrites
 * the wrapper too, so the CLI and the next dev daemon boot agree.
 */
export async function sourcePathCommand(
  args: string[],
  _ctx: CommandContext = {},
  seams: SourcePathSeams = realSeams,
): Promise<void> {
  const json = args.includes("--json");
  const given = args.find((a) => !a.startsWith("--"));

  if (given === undefined) {
    const current = readDevModeConfig().sourcePath ?? null;
    if (json) {
      seams.json(envelope({ sourcePath: current }));
      return;
    }
    // The path is the payload: a script reads it from stdout, so the hint goes to stderr.
    out.payloadOnStdout();
    if (current) seams.payload(`${current}\n`);
    else seams.print(out.line("pending", "No source checkout set yet"), out.callout("next", out.cmd("rt settings source-path <path>")));
    return;
  }

  const sourcePath = resolvePath(given);
  if (!existsSync(join(sourcePath, "cli.ts"))) {
    if (json) seams.json(envelope({ ok: false, error: { code: "not-rt-source", message: `${sourcePath} is not an rt checkout (no cli.ts)` } }));
    else seams.fail({ title: "That folder is not an rt checkout", hint: sourcePath, why: "It has no cli.ts." });
    seams.exit(2);
    return;
  }

  const wrapperOwnsRt = devWrapperOwnsRt();
  if (wrapperOwnsRt) enableDevMode(sourcePath);
  else saveSourcePath(sourcePath, detectBunPath());

  if (json) seams.json(envelope({ ok: true, sourcePath, wrapperRewritten: wrapperOwnsRt }));
  else seams.print(out.line("done", "Source checkout set", sourcePath), ...(wrapperOwnsRt ? [out.line("done", "Dev wrapper rewritten", rtBinaryPath())] : []));
}
```

Delete the line `"commands/settings.ts",` from `lib/__tests__/raw-output-allowlist.json`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test commands/__tests__/settings-source-path.test.ts commands/__tests__/settings-misc.test.ts commands/__tests__/settings-dev-mode-store.test.ts commands/__tests__/settings-json-frozen.test.ts lib/__tests__/no-raw-output.test.ts && bun run typecheck`
Expected: PASS. `source-path.txt` is byte-identical.

- [ ] **Step 5: Commit**

```bash
git add commands/settings.ts commands/__tests__/settings-source-path.test.ts commands/__tests__/settings-misc.test.ts lib/__tests__/raw-output-allowlist.json
git commit -m "settings source-path/test-push, sdm set-email: payload path, plain lines, out.fail

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `schema lock` and `schema diff`

**Files:**
- Modify: `commands/settings-schema.ts`
- Modify: `commands/__tests__/settings-schema.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete the `commands/settings-schema.ts` line)

**Interfaces:**
- Consumes: `out.print`, `out.fail`, `out.json`, `out.payload`, `out.payloadOnStdout`, `out.line`, `out.table`, `out.callout`, `out.key`, `out.cmd`, `type CellInput`, `type FailureInput` (phase 1); `classifyLockDiff`, `checkLockAgainst`, `draftMigrations` (existing).
- Produces: nothing new; both verbs keep their signatures and `deps`.

- [ ] **Step 1: Rewrite the test file's capture and the exact-line assertions**

In `commands/__tests__/settings-schema.test.ts`, both `describe`s override `console.log`/`console.error` by hand. Replace that with the helper in each: `let cap: Captured;`, `cap = captureOut();` as the last line of `beforeEach`, `cap.restore();` as the first line of `afterEach`; delete `logs`, `errors`, `origLog`, `origError` and `captureErrors` (every `await captureErrors(() => X)` becomes `await X` followed by reading `cap.err()`). Add `import { captureOut, type Captured } from "../../lib/ui/__tests__/capture-out.ts";`. Then:

- `expect(logs).toEqual([out]);` becomes `expect(cap.text()).toBe(`${out}\n`);`
- `expect(errors.some((e) => e.includes("run from source"))).toBe(true);` becomes `expect(cap.err()).toContain("run from source");` (both places)
- `JSON.parse(logs.join("\n"))` becomes `JSON.parse(cap.text())` everywhere
- `expect(logs).toEqual([]);` becomes `expect(cap.text()).toBe("");`
- `expect(errors.some((e) => e.includes(X))).toBe(true);` becomes `expect(cap.err()).toContain(X);` (the `--against` and `--against-ref` case checks both substrings)
- `expect(logs).toEqual(["no schema changes"]);` becomes `expect(cap.text()).toBe("[ok] No schema changes\n");`
- In "a ref whose tree has no lock reads as an empty lock", `logs = [];` becomes `cap.stdout.length = 0;`
- In "a malformed lock...", `process.exitCode = 0;` between the two halves gains `cap.stdout.length = 0; cap.stderr.length = 0;`

Add one test to the `settingsSchemaDiff` describe:

```ts
  test("a breaking change prints a table row, the problem as a failed line, and exits 1", async () => {
    const built = buildLock();
    const key = Object.keys(built)[0]!;
    const prev = { ...built, [key]: { ...built[key]!, schema: { ...built[key]!.schema, type: "boolean" } } };

    await settingsSchemaDiff(["--against", writeLock(prev)], { shippedLock: null });

    expect(cap.text()).toMatch(new RegExp(`^breaking  ${key.replace(/\./g, "\\.")}  `));
    expect(cap.text()).toContain(`\n[failed] `);
    expect(process.exitCode).toBe(1);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/settings-schema.test.ts`
Expected: FAIL on the human-output and stderr assertions (old wording, `console.*` routes).

- [ ] **Step 3: Convert `settings-schema.ts`**

Add `import * as out from "../lib/ui/out.ts";` and `import type { CellInput, FailureInput } from "../lib/ui/out.ts";` after the `url` import. Replace `settingsSchemaLock`:

```ts
export async function settingsSchemaLock(args: string[], deps: { lockPath?: string } = {}): Promise<void> {
  const LOCK_PATH = deps.lockPath ?? DEFAULT_LOCK_PATH;
  const target = flagValue(args, "--out") ?? LOCK_PATH;
  // A compiled rt resolves LOCK_PATH inside its own bundle (/$bunfs/...), where the lock
  // file is absent and nothing can be written; from source the committed file exists.
  if (target === LOCK_PATH && (LOCK_PATH.startsWith("/$bunfs/") || !existsSync(LOCK_PATH))) {
    out.fail({ title: "This has to run from source", why: "The compiled rt has no checkout to write the lock into.", next: out.cmd("bun run cli.ts settings schema lock") });
    process.exitCode = 1;
    return;
  }
  writeFileSync(target, `${JSON.stringify(buildLock(), null, 2)}\n`);
  out.payload(`${target}\n`);
}
```

Replace `lockAtPath`:

```ts
function lockAtPath(path: string): Lock | Error {
  if (existsSync(path)) return parseLock(readFileSync(path, "utf8"), path);
  out.print(out.line("warn", "No lock file there, so diffing against an empty lock", path));
  return {};
}
```

In `settingsSchemaDiff`, replace the `fail` closure and the compiled-binary check, and move `json` above them:

```ts
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const fail = (message: string, more: Partial<FailureInput> = {}) => {
    out.fail({ title: message, ...more });
    process.exitCode = 1;
  };
  // A compiled rt diffs its own bundled registry and has no checkout for git to read.
  if (repoRoot.startsWith("/$bunfs/")) return fail("This has to run from source", { why: "The compiled rt has no checkout to diff.", next: out.cmd("bun run cli.ts settings schema diff") });
  const against = flagValue(args, "--against");
  const againstRef = flagValue(args, "--against-ref");
  if (against !== undefined && againstRef !== undefined) return fail("Pass --against <file> or --against-ref <ref>, not both");
```

(Delete the original `const json = args.includes("--json");` line that followed.) Replace the output block at the end:

```ts
  if (json) {
    out.json({ ok, shipped: shippedRef, changes, problems, drafts }, 2);
  } else if (changes.length === 0) {
    out.print(out.line("done", "No schema changes"));
  } else {
    out.print(
      out.table(changes.map((c): CellInput[] => [{ text: c.kind, role: c.kind === "breaking" ? "warn" : "done" }, out.key(c.key), c.detail])),
      ...problems.map((p) => out.line("failed", p)),
      ...drafts.flatMap((d) => [
        out.line("done", `Drafted ${d.key}`, d.kind === "step" ? `migrateFrom version ${d.version}` : `renamedFrom ${d.from}`),
        ...d.notes.map((n) => out.callout("note", n)),
      ]),
      ...(drafts.length > 0 ? [out.callout("next", ["review the drafts, add real examples, set storeVersion, then run ", out.cmd("bun run cli.ts settings schema lock")])] : []),
    );
  }
  if (!ok) process.exitCode = 1;
```

Delete the line `"commands/settings-schema.ts",` from `lib/__tests__/raw-output-allowlist.json`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test commands/__tests__/settings-schema.test.ts commands/__tests__/settings-json-frozen.test.ts lib/__tests__/no-raw-output.test.ts && bun run typecheck`
Expected: PASS. `schema-diff.txt` is byte-identical (`out.json(v, 2)` writes what `console.log(JSON.stringify(v, null, 2))` wrote).

- [ ] **Step 5: Commit**

```bash
git add commands/settings-schema.ts commands/__tests__/settings-schema.test.ts lib/__tests__/raw-output-allowlist.json
git commit -m "settings schema lock/diff: payload path, a table for changes, out.fail

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The e2e readers and the settings pty gate

**Files:**
- Modify: `e2e/tests/settings.test.ts:452,470,493`
- Create: `e2e/pty/settings.test.ts`
- Modify: `.github/workflows/e2e.yml:38`

**Interfaces:**
- Consumes: `createTestHome` (`e2e/harness.ts`), `startInteractive`, `TermwrightSession` (`e2e/interactive.ts`); the compiled binary at `RT_BINARY` or `dist/rt` (the `e2e/setup.ts` preload rebuilds a stale one); `ui/dist/rt-ui` (built by the test's `beforeAll`).
- Produces: the one settings pty test the spec names for this phase.

- [ ] **Step 1: Fix the three e2e assertions that scrape human text**

In `e2e/tests/settings.test.ts`:

- line 452: `expect(out).toContain("(registry default)");` becomes `expect(out).toContain("built-in default");`
- line 470: `expect(stripAnsi(res.stdout)).toContain("rt.worktrees set (user, settings-repo)");` becomes `expect(stripAnsi(res.stdout)).toContain("[ok] Saved rt.worktrees  your user settings for settings-repo");`
- line 493: `expect(stripAnsi(res.stdout)).toContain("deck.access set (user)");` becomes `expect(stripAnsi(res.stdout)).toContain("[ok] Saved deck.access  your user settings");`

The regexes on lines 453 to 455 (`team\.repo\s+<file>\s+{"onDeck":3` and the two like it) already match the tree's `scope  file  value` cells and stay. Also update the test name on line 446 from `explain (human output — the verb has no --json)` to `explain (human output) shows every reachable rung`, since the dash is banned and `explain` does take `--json`.

- [ ] **Step 2: Write the pty test**

Create `e2e/pty/settings.test.ts`:

```ts
/**
 * The whole-binary gate for one settings verb: the compiled rt at a real
 * terminal, drawing its confirmation and share tip through the real rt-ui.
 * Here the screen is the evidence on purpose: what this gate protects is
 * that the styled path runs at a TTY (the plain fallback paints `[ok]`,
 * never a glyph or a rail).
 */
import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createTestHome } from "../harness.ts";
import { startInteractive, type TermwrightSession } from "../interactive.ts";

const REPO_ROOT = import.meta.dir.replace("/e2e/pty", "");
const RT_UI_BIN = join(REPO_ROOT, "ui", "dist", "rt-ui");
const PAINT_TIMEOUT = 15_000;

beforeAll(() => {
  // HOME is the run's throwaway dir, so the module cache lands in it and
  // must stay deletable.
  execFileSync("bun", ["run", "ui:build"], {
    cwd: REPO_ROOT,
    stdio: "pipe",
    env: { ...process.env, GOFLAGS: [process.env.GOFLAGS, "-modcacherw"].filter(Boolean).join(" ") },
  });
  if (!existsSync(RT_UI_BIN)) throw new Error(`ui:build produced no binary at ${RT_UI_BIN}`);
});

let open: { session: TermwrightSession; cleanup: () => void } | null = null;

afterEach(async () => {
  if (!open) return;
  await open.session.stop();
  open.cleanup();
  open = null;
});

describe("rt settings set through a pty", () => {
  test("draws the confirmation and the share tip in the rt-ui theme", async () => {
    const home = createTestHome();
    const session = await startInteractive({
      args: ["settings", "set", "rt.logLevel", '"debug"', "--scope", "user"],
      home: home.path,
      cols: 120,
      rows: 20,
      env: { RT_UI_BIN, RT_SKIP_SETUP: "1", CI: "true" },
    });
    open = { session, cleanup: home.cleanup };

    await session.waitForText("Saved rt.logLevel", PAINT_TIMEOUT);
    const screen = await session.screen();
    expect(screen).toContain("✓ Saved rt.logLevel  your user settings");
    expect(screen).toContain("▌ tip Saved rt.logLevel on this Mac only.");
    expect(screen).toContain("▌ next rt home remote set");
    expect(screen).not.toContain("[ok]");
    expect(await session.exitCode).toBe(0);
    expect(readFileSync(join(home.path, ".mattstack", "user", "settings.user.jsonc"), "utf8")).toContain('"rt.logLevel"');
  });
});
```

- [ ] **Step 3: Widen the pty filter**

In `.github/workflows/e2e.yml` line 38, the `grep -qE` pattern gains the settings paths. Replace `commands/glitter\.ts|` with `commands/glitter\.ts|commands/settings[^/]*\.ts|lib/settings/|packages/rt-client/src/settings/write\.ts|` so the alternation reads:

```
'^(ui/|lib/mission/|lib/ui/|commands/glitter\.ts|commands/settings[^/]*\.ts|lib/settings/|packages/rt-client/src/settings/write\.ts|packages/git-core/|e2e/(pty/|glitter-repo\.ts|interactive\.ts|harness\.ts|setup\.ts|socket-path\.ts)|test-setup\.ts|\.github/workflows/e2e\.yml|package\.json)'
```

Rename the job output's meaning in the comment above the filter from "the glitter board" to "the glitter board or the settings pty gate" (two comment lines, no other change).

- [ ] **Step 4: Run both e2e suites**

Run (repo root): `bun run test:e2e` then `bun run test:pty`
Expected: both PASS. The preload builds `dist/rt` if it is older than the sources, which it will be after Tasks 2 to 7; expect `e2e: building rt binary...` once. `test:e2e` needs `termwright` only for the pty half; if `cargo install termwright` has never run on this machine, run it first (CI caches it).

If `session.screen()` comes back empty because the process exited before the read, move the three screen assertions above `waitForText` into a `screen` read taken immediately after `waitForText` resolves and before `session.exitCode` is awaited (the order above already does this); if it is still empty, pass `holdMs`-style padding by appending `"&&", "sleep", "2"` is not possible through the harness, so instead assert the same three strings through `session.waitForText` one at a time, which reads the terminal's scrollback. Do not drop the glyph assertions: they are the only proof the styled path ran.

- [ ] **Step 5: Commit**

```bash
git add e2e/tests/settings.test.ts e2e/pty/settings.test.ts .github/workflows/e2e.yml
git commit -m "e2e: settings readers take the new wording; a settings pty gate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Document the `--json` note rule and run every gate

**Files:**
- Modify: `AGENTS.md` (the `## Output layer` section, after the paragraph that begins "Plain output collapses newlines")

**Interfaces:**
- Consumes: everything above.
- Produces: the one rule this phase found that phase 1's section does not state.

- [ ] **Step 1: Add the sentence to AGENTS.md**

Insert as its own paragraph after the paragraph ending "stay beneath it when it fails." in the `## Output layer` section:

```markdown
`out.print` writes plain text to stdout under `--json` too, so a verb whose
`--json` branch can still print a note (a repo whose identity cannot derive,
a lock file that is missing) calls `out.payloadOnStdout()` as soon as it
knows `--json` was passed; otherwise the note lands inside the envelope a
program is parsing. A verb that prints a payload (`rt settings get`'s value,
a bare path) calls it unconditionally. The `--json` byte-identity tests
(`commands/__tests__/settings-json-frozen.test.ts` is the model) assert an
empty stderr as well as the frozen stdout.
```

- [ ] **Step 2: Run every gate**

Run from the repo root, in order, and record each result in your report:

```bash
cd packages/rt-client && bun run build && cd ../..
bun run ui:build
bun run ui:test
bun run typecheck
bun run test
bun run test:e2e
bun run test:pty
bun run picker:check
bun run format:check
```

Expected: all pass. No command description changed, so `bun run docs:gen` is not needed. `bun run test` may show a failure in a file this branch does not touch; if so, re-run that one file alone and on a clean checkout of the base commit before calling it pre-existing, and say which it was.

- [ ] **Step 3: Check the text rules and the allowlist**

```bash
CHANGED=$(git diff --name-only $(git merge-base HEAD origin/main)..HEAD -- commands lib packages/rt-client/src e2e AGENTS.md .github/workflows/e2e.yml)
LC_ALL=C grep -n $'\xe2\x80\x94\|\xe2\x80\x93' $CHANGED || echo "no banned dashes"
git diff $(git merge-base HEAD origin/main)..HEAD -- commands lib packages e2e AGENTS.md | grep -E '^\+' | grep -ciE '[l]oad.bearing'
grep -c 'settings' lib/__tests__/raw-output-allowlist.json
```

Expected: `no banned dashes`, a count of `0` added lines carrying the banned phrase, and `0` lines mentioning settings left in the allowlist. (The rt-client resolver's own unknown-key message carries a dash that predates this phase and is not in the diff.)

- [ ] **Step 4: Look at it**

In a real terminal (a subagent usually has none; if so, say so and leave this for the final review), under an isolated HOME so nothing touches the real stores:

```bash
export HOME=$(mktemp -d) && mkdir -p "$HOME/.mattstack"
bun run cli.ts settings set rt.logLevel '"debug"' --scope user
bun run cli.ts settings get rt.logLevel
bun run cli.ts settings get rt.worktrees | cat
bun run cli.ts settings list
bun run cli.ts settings explain rt.worktrees
bun run cli.ts settings check
bun run cli.ts settings migrate
bun run cli.ts settings unset rt.logLevel --scope user
bun run cli.ts settings unset rt.logLevel --scope user
bun run cli.ts settings get rt.nope
bun run cli.ts settings set rt.logLevel debug --scope user
```

Look for: the tip and next callouts hanging under the `✓ Saved` line with the same rail; `get`'s value at column 0 with the key and source above it in the terminal's foreground; the piped `get` printing only the JSON; `list`'s keys in lavender and any caveat in peach; the second `unset` as a faint `-` skipped line, not coral; the two failures as coral `✗` with their `next`/`why`. Take the screenshots in the terminal's dark and light schemes for the PR.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "docs: notes under --json go through payloadOnStdout

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## After this plan

- Open the PR against `m4ttstack/mattstack` with the Task 9 screenshots in both schemes. In the light-scheme screenshot, look at the faint `not set` cells in `explain` and the `skipped` line specifically: they are fixed theme tones and are where low contrast would show.
- Phase 3's `lib/setup/apply.ts` sink (`(line) => ctx.log(step.id, line)`) keeps compiling against the two-argument `SettingsNoticeSink`; when phase 3 attaches the tip as a callout under the step, it reads the second argument (`notice.text`, `notice.next`) and `noticeBlocks` from `lib/settings/notice-channel.ts` already builds the two callouts.
- Phase 5 owns the `sdm` family; `rt sdm set-email` was converted here because it lives in `commands/settings.ts`. Its wording is in this plan's audit table if phase 5 wants to align it with the other sdm verbs.
- `lib/ui/__tests__/capture-out.ts` is the capture helper for any later conversion phase's tests; it also captures `console.*` so a fixture can be taken from unconverted code.
