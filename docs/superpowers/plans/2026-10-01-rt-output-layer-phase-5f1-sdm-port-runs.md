# rt Output Layer, Phase 5f1 (sdm, port and runs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt sdm`, `rt port` and `rt runs` print through the output layer; the human sentences that ride in sdm's `--json` envelopes and reach a screen are reworded under the copy rules with every envelope's shape kept; and the six files this plan owns leave the raw-output allowlist.

**Architecture:** Three conversions that share nothing but the layer, and one copy pass. `port` and `runs` become blocks (`section`, `tree`, `table`, `line`) built by pure functions and printed once. `sdm` gets one small helper, `withProgress`, that runs a child-streaming task under a Go step whose sub-lines are the child's output: the step is erased when the task settles, every line goes to the CLI log at `debug`, and a failure prints its last five lines under a `failure` block on stderr. Before sdm is converted, the strings `lib/sdm/flow.ts`, `lib/sdm/core.ts` and `lib/sdm/app.ts` put into sdm's envelopes are reworded, and a failed connect gains a `next` field that carries the command its hint used to quote mid-sentence. The production connect from a script is a `refused` note, not a failure. `lib/sdm/enrichment.ts` moves its warnings onto 5a's `warn`, and `lib/sdm/picker.ts` and `lib/navigate.ts` lose their raw escapes without changing a pixel of the picker.

**Tech Stack:** Bun + TypeScript (`commands/`, `lib/`), `bun:test`, the compiled-binary e2e suite (`e2e/tests/`). No Go change: every file under `ui/` is 5a's.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (ticket RT-369), phase 5 of "Phases", plus "Rules", "Steps", "Copy style", "Block vocabulary", "Status set" and "Guard". The slice is defined by `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5-scoping.md` (section 1 "What rt-ui already draws", section 2 items 1, 2 and 8, section 3 "5f", section 5, and rulings 1, 2, 5 and 11). The controller's rulings on this slice, `.superpowers/sdd/phase-5f-rulings-r1.md` (eight items), bind it; this document cites them as "5f ruling N". Shared item 12 ("the picker wrappers take a stream") was withdrawn on 2026-10-01: `rt-ui pick` paints on `/dev/tty`, so nothing takes a stream, and this plan adds no stream option anywhere. The twelve rulings in `.superpowers/sdd/cross-phase-rulings.md` bind this plan. The API this plan calls from 5a is fixed by `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5a-layer-additions.md`, section "API for slices 5b to 5f"; this plan cites it and never redefines it.

**The split (5f ruling 7).** Slice 5f is two plans along the scoping document's second cut, each shippable alone: this one (sdm, port, runs, the sdm picker and `lib/sdm/*`) and `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5f2-chat.md` (`rt chat` and `lib/chat-viewer-url.ts`). They share no source file. Both delete lines from `lib/__tests__/raw-output-allowlist.json` and append to the AGENTS.md "Output layer" section and `docs/design/output-layer/README.md`, which the second to merge resolves by hand (cross-phase ruling 7). `runs` rides here, not with chat: it shares nothing with either half, and this half is the smaller. The single plan this replaced was superseded and is not in the repo.

**Size:** about 2,700 changed lines (additions and deletions; the captured sdm fixture included), of which Task 8 (sdm) is about 1,450. That is at the 2,500 line of 5f ruling 7 rather than well past it, so this half is not cut again unless Task 10 measures past about 2,800 (decision 16); slice 5f as one plan would have been about 3,800. Task 10 measures the real diff before the PR.

**What was run while writing this plan:** nothing was compiled. The TypeScript below was written against the files at `5bc69f231` (line numbers are that commit's) and against 5a's API as its plan states it, because 5a was not on main yet. Main has since moved to `19ceaa403` (phase 4), which changed none of this plan's source files; `git diff --stat 5bc69f231 origin/main` over them shows only `lib/ui/__tests__/capture-out.ts`. Task 1 checks that 5a is on main before any code is written.

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
- 5f1 only, copy inside envelopes (5f ruling 5): "byte for byte" above means the envelope's shape for the strings Task 2's copy table rewords. Frozen: keys, structure, types, exit codes and every value a program reads (`ok`, `stage`, `health`, `appRunning`, `verified`, addresses, urls, keys, durations, `defaultReason`). A human sentence that rides in an envelope and is also what a person reads on screen is reworded; a string only a program reads stays. Tests compare shape and pin the human strings separately.
- 5f1 only, refusals (5f ruling 6): rt declining by policy is `out.note(out.line("refused", ...), ...callouts)` on stderr, never `out.fail`. In this plan that is the production connect from a script. Its exit code and its `--json` envelope do not change.
- 5f1 only: exit codes do not change. `rt runs` exits 1 on a failure and 2 on an unknown subcommand. Every `rt sdm` failure and refusal sets `process.exitCode = 1` and returns, as today. `rt port` always exits 0.
- 5f1 only: `rt sdm`'s human text goes to stdout and its failures and refusals to stderr. Under `--json`, stdout is exactly one envelope and child progress never reaches stderr: it goes to the CLI log. A note for the person (5a's daemon-down note, an enrichment warning) may still land on stderr; that is why the skill parses stdout only.
- 5f1 only: the sdm resource picker is already drawn by rt-ui and is not converted. The pick request it sends is identical before and after; Task 3 pins it.
- 5f1 only: files this plan must not edit: `commands/settings.ts` (`sdm set-email`, phase 4), `commands/runs-find.ts`, `commands/runs-write.ts`, `lib/daemon-client.ts` (5a), `lib/pick-wrappers.ts`, `lib/ui/pick.ts`, `lib/pickers.ts` (5c), `lib/rt-render.ts` (5b), `lib/sdm/browser-login.ts`, `lib/sdm/agent-json.ts`, `lib/daemon/handlers/sdm.ts`, `lib/ui/__tests__/capture-out.ts` (phase 4's), every file under `ui/`, everything 5a creates (`lib/ui/warn.ts`, `usage.ts`, `transient-step.ts`, `screen.ts`), and every file 5f2 owns (`commands/chat.ts`, `lib/chat-viewer-url.ts`, their tests and fixture). `lib/sdm/flow.ts`, `lib/sdm/core.ts` and `lib/sdm/app.ts` are this plan's for Task 7 only: the string literals its copy table names and the failed result's new `next` field, nothing else.
- 5f1 only: git commands are run plain and alone from the worktree root, never joined with `cd`, `&&`, pipes or heredocs. Never `git add -A`, `git add .` or `git add -u`.
- 5f1 only: where today's text holds a long dash, this plan writes `--` when quoting it. New code never carries one.

## Review Focus

1. **A helper that is missing or dies while sdm streams a child.** `rt sdm connect` and `rt sdm login` must still finish and report; a step is never worth a failed connect. Pinned in Task 8 (`a missing helper costs the step, never the task`, `a task that throws still clears its step`).
2. **A child line carrying escape sequences or a forged status row.** A line such as an erase-screen escape followed by `[ok] forged` must print as indented text under the failure, never as a row at column 0. The one-time token in a StrongDM auth url never reaches the CLI log, an excerpt or a failure's `why:` line. Pinned in Task 8 (`a failure's excerpt is the last five child lines, indented`, `a StrongDM auth url reaches the step, the tail and the log with its token redacted`, `a failure's excerpt never shows an auth url's token`, `a failed browser login never shows the auth url's token, in the why or anywhere on stderr`).
3. **`--json` on argv when a verb fails, and the reworded envelope strings.** stdout must hold the envelope the verb wrote before, or nothing; keys and every machine-read value are unchanged and only the human sentences moved. Pinned in Task 6 (`an unknown --repo under --json writes the same envelope and nothing on stderr`), Task 7 (`a failed connect's envelope keeps its keys and types, and its words are the new ones`) and Task 8 (`connect with --json and no key writes the same envelope`, plus the e2e fixture captured before `commands/sdm.ts` changes).
4. **A script or an agent reaching a production connection, or a login that needs a person.** The production connect from a script is a `refused` note on stderr with stdout empty and exit code 1. A login that cannot run unattended names `rt sdm login --manual` on its `next:` line, which the sdm skill hands to the person. A silent login that failed for any other reason puts `rt sdm login --visible` on its `next:` line and the manual login in a `tip`, so a person is never stuck and the skill's routing (it reads the `next:` line, and never runs `--visible`) is unchanged. Pinned in Task 8 (`a production connect from a script is refused on stderr and stdout stays empty`, `only a login that needs a person names the manual login on its next: line`).
5. **`rt port` when the daemon does not answer.** The list still prints on stdout and one plain warning says the scan ran without the daemon. Pinned in Task 5 (`when the daemon does not answer, rt port scans by itself and says so on stderr`).

## What this plan takes from 5a (cited, never redefined)

From `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5a-layer-additions.md`, "API for slices 5b to 5f":

```ts
// lib/ui/out.ts
export function note(...blocks: Block[]): void;            // stderr, never follows payloadOnStdout

// lib/ui/warn.ts
export type WarningLog = (module: string, message: string, context: Record<string, unknown>) => void;
export interface ShownWarning { title: string; hint?: string; next?: CellInput }
export interface WarnOptions { context?: Record<string, unknown>; show?: ShownWarning }
export function warn(module: string, message: string, opts?: WarnOptions): void;
export function setWarningLog(log: WarningLog | null, opts?: { quiet?: boolean }): void;
export const __test__: { reset(): void };

// lib/ui/transient-step.ts
export async function withTransientStep<T>(label: string, task: () => Promise<T>): Promise<T>;

// lib/ui/usage.ts
export function usageFailure(title: string, usage: string, why?: string): FailureInput;

// lib/ui/spawn.ts, on StepHandle
clear(): Promise<boolean>;                                  // sends { t: "done", title: <label>, clear: true }
```

Four behaviors of 5a this plan leans on:

- **The plain failure rule.** A `failure` block that opens a plain render has no `[failed]` tag: its first line is the title. Every `out.fail(...)` in this plan is such a render, so every expected stderr string below starts with the title.
- **`withTransientStep` leaves nothing on screen** and just runs the task off a terminal or when rt-ui cannot start. `port` and `sdm` keep no "scanned" line (ruling 1).
- **The daemon-down note.** `lib/daemon-client.ts`'s `warnDaemonDown` becomes `out.note(out.line("warn", "The rt daemon is not running"), out.callout("next", out.cmd("rt daemon start")))`, once per process (5a Task 12). It fires on one path only: the daemon is installed, its socket is gone and the restart failed (`lib/daemon-client.ts:302-304`). Task 5 relies on that.
- **The breadcrumb header.** The dispatcher draws it before the handler, on stderr, only when a person is reading stderr. Nothing in this plan calls it, and with `out.__test__.setHuman(() => false)` it never appears in a test's expected strings.

From 5a's warnings table (ruling 2), this plan applies rows 40 and 41 (row 42, `lib/chat-viewer-url.ts`, is 5f2's):

| Row | File:line | Decision | Log message (module) | Shown copy |
|---|---|---|---|---|
| 40 | `lib/sdm/enrichment.ts:51` | Show | `ignoring "rt.sdmEnrichment" -- <err>` (`sdm`) | `Your sdm enrichment setting is being ignored` / first line of the error / `rt settings check` |
| 41 | `lib/sdm/enrichment.ts:65` | Show | `failed to parse <path>, ignoring enrichment file: <err>` (`sdm`), context `{ path }` | `Your sdm enrichment file could not be read` / `rt is ignoring it` / no next |

## File Structure

| File | Responsibility |
|---|---|
| `lib/navigate.ts` (modify) | `NavOption.tone` replaces `color` and its quoted escape (guard-only) |
| `lib/sdm/picker.ts` (modify) | Tier and connected colors become tone names |
| `lib/sdm/enrichment.ts` (modify) | Two warnings move onto `warn` |
| `lib/sdm/flow.ts`, `lib/sdm/core.ts`, `lib/sdm/app.ts` (modify) | The copy pass: reworded human strings; a failed connect's `next` |
| `commands/port.ts` (modify) | `portBlocks`, kill results as `line` blocks, the spinner on `withTransientStep`, one note when the daemon does not answer |
| `commands/runs.ts` (modify) | `runRow`, `runDetailBlocks`, failures through `out.fail`, envelopes through `out.json` |
| `commands/sdm.ts` (rewrite below the header comment) | `withProgress`, pure block builders, every verb on the layer, the production `banner` and refusal |
| `commands/__tests__/port.test.ts`, `commands/__tests__/sdm.test.ts` (create) | The new builders, the progress step, the gates |
| `commands/__tests__/runs.test.ts` (modify) | Harness reads `captureOut()`; new block and failure tests |
| `lib/sdm/__tests__/flow.test.ts`, `core-parsers.test.ts`, `core-runner.test.ts`, `app.test.ts` (modify) | The envelope copy, pinned apart from the shape |
| `e2e/tests/sdm-json.test.ts`, `e2e/tests/fixtures/sdm-json.json` (create, captured) | sdm's envelopes through the real binary |
| `e2e/tests/sdm-enrichment.test.ts`, `lib/sdm/__tests__/picker.test.ts`, `enrichment.test.ts`, `enrichment-cmd.test.ts` (modify) | Assertions follow the new wording and field names |
| `skills/rt-sdm-connect/SKILL.md` (modify) | Two call notes (progress is no longer on stderr; where the manual login is named) and two digraph edge labels |
| `lib/__tests__/raw-output-allowlist.json` (modify) | Six lines deleted |
| `AGENTS.md`, `docs/design/output-layer/` (modify) | One appended paragraph; four renders |

---

### Task 1: Confirm 5a is on main

No code. This plan calls five things 5a builds. If they are not on main, stop.

Phase 4 is already on main (`19ceaa403`). It extended the shared capture helper, `lib/ui/__tests__/capture-out.ts`, which this plan imports and never edits: `captureOut(opts?: { console?: boolean })` (with `console: true`, `console.log` and `console.error` land in the same buffers as the stream writes) and `clear()`, which empties both buffers between two runs in one test (`reset()` does not; it only resets the human gate and `humanStream`). Every test below creates one capture per run, so neither is needed here; use `clear()` if a test ever reuses a capture.

**Files:** none.

**Interfaces:**
- Consumes: nothing.
- Produces: a go or a stop for every later task.

- [ ] **Step 1: Bring main in**

Run: `git fetch origin`
Run: `git rebase origin/main`

- [ ] **Step 2: Check each name this plan calls**

Run each alone, from the repo root:

- `grep -n "export function note" lib/ui/out.ts`
- `grep -n "export function warn\|export function setWarningLog\|export const __test__" lib/ui/warn.ts`
- `grep -n "export async function withTransientStep" lib/ui/transient-step.ts`
- `grep -n "export function usageFailure" lib/ui/usage.ts`
- `grep -n "clear" lib/ui/spawn.ts`
- `grep -n "console?: boolean\|clear: ()" lib/ui/__tests__/capture-out.ts`

Expected: every command prints at least one line, and the signatures match the block in "What this plan takes from 5a". `lib/ui/spawn.ts` shows a `clear(): Promise<boolean>` member on `StepHandle`. The last grep shows phase 4's two additions.

If any file is missing or any of the first five greps is empty: **stop. Do not start Task 2.** Report "5a is not on main" with the output of the five commands. Nothing in this plan may be stubbed to get past this.

If a signature differs from the block above, main wins: note the difference in the task ledger, and use main's signature wherever a later task calls that name.

- [ ] **Step 3: Check the plain failure rule landed with it**

Run: `bun test lib/ui/__tests__/out-plain.test.ts`
Expected: PASS. Then run this one-liner from the repo root:

`bun -e 'import { renderPlain } from "./lib/ui/out-plain.ts"; import * as o from "./lib/ui/out.ts"; process.stdout.write(renderPlain([o.failure({ title: "x", next: o.cmd("rt y") })]));'`

Expected output, exactly:

```
x
  next: rt y
```

If the first line reads `[failed] x`, 5a's Task 2 is not on main: stop and report, as in Step 2.

- [ ] **Step 4: Build the helper and record a baseline**

Run: `bun run ui:build`
Run: `bun test commands/__tests__/runs.test.ts lib/sdm lib/__tests__/nav-picker.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS. A failure here is not this plan's: stop and report it with the output.

Nothing to commit.

---

### Task 2: Audit of the print sites this plan owns

No code. This is the inventory every later task implements; it stays in the plan. Line numbers are `5bc69f231`'s.

**Files read:** `commands/sdm.ts`, `commands/port.ts`, `commands/runs.ts`, `lib/sdm/enrichment.ts`, `lib/sdm/picker.ts`, `lib/sdm/flow.ts`, `lib/sdm/app.ts`, `lib/sdm/agent-json.ts`, `lib/sdm/core.ts` (the `onLine` callers and every human string it returns), `lib/sdm/browser-login.ts` (the outcome type and its reasons), `lib/daemon/handlers/sdm.ts` (the tray reconnect's use of `runGuidedConnect`), `lib/daemon-client.ts` (`daemonQueryAttributed`, `warnDaemonDown`), `lib/navigate.ts`, `lib/pick-wrappers.ts` (`navOptionsToRows`, `runNavPicker`), `skills/rt-sdm-connect/SKILL.md`, and the tests named below.

#### Already on rt-ui (confirming the scoping document)

| Verb | Scoping call | Confirmed | What 5f1 touches |
|---|---|---|---|
| `sdm` | partly | Yes. The resource picker (`runNavPicker`, `commands/sdm.ts:231`) and the duration, reason, production and login prompts (`select`, `textInput`, `confirm` from `lib/rt-render.ts`) are rt-ui and are not changed. | 49 visible lines, the inline spinner, `streamLine` |
| `lib/sdm/picker.ts`, `lib/navigate.ts` | guard-only | Yes, and more than the scoping document says: `navOptionsToRows` (`lib/pick-wrappers.ts:140`) never reads `NavOption.color`, so the five SGR constants paint nothing today. The rows carry a bold label and a dim hint and nothing else. | The constants become tone names; the pick request is byte-identical (Task 3 pins it) |
| `port` | partly | Yes. The kill picker (`filterableMultiselect` with segment rows, `commands/port.ts:170`) is rt-ui and is not changed. At a terminal `rt port` is that picker; `displayPorts` only ever runs off a terminal. | 18 visible lines, the inline spinner |
| `runs` | partly | Yes. The run picker (`pickRunId`, `commands/runs.ts:153`) is rt-ui and is not changed. | 8 visible lines, 3 `--json` lines, the `fail` sites |

#### `lib/navigate.ts`, `lib/sdm/picker.ts` (Task 3)

| Site | Today | Becomes |
|---|---|---|
| `lib/navigate.ts:17-18` | `color?: string`, documented with a quoted SGR escape | `tone?: string`, a picker tone name |
| `lib/sdm/picker.ts:21-26` `TIER_COLOR` | four SGR escapes (green, magenta, yellow, red) | `TIER_TONE`: `mint`, `pink`, `peach`, `coral` |
| `lib/sdm/picker.ts:32` `CONNECTED_COLOR` | bright blue SGR | `CONNECTED_TONE = "blue"` |
| `lib/sdm/picker.ts:50` | `color: ...` | `tone: ...` |

Tone names are the picker's own (`toneColor`, `ui/internal/views/picker/render.go:737`).

#### Lib warnings (Task 4)

Rows 40 and 41 in "What this plan takes from 5a". No test spies `console.warn` for these lines today (checked: `lib/sdm/__tests__/enrichment.test.ts`).

#### `commands/port.ts` (Task 5)

| Site | Today | Becomes |
|---|---|---|
| `:14-15` | color import, `withInlineSpinner` import | `out`, `withTransientStep` |
| `:27, 38` spinner `scanning ports…` | `withInlineSpinner` | `withTransientStep("Scanning ports", ...)` |
| `:36` | dim `(daemon not available, scanning directly...)` on stdout | `out.note(out.line("warn", "Scanned your ports without the rt daemon"))` on stderr (5f ruling 4; see below) |
| `:78, 210, 224` | green `✓ no listening ports for known repos` | `out.line("done", "Nothing is listening in your repos")` |
| `:93-112` `displayPorts` | repo name, branch, padded port rows, hand-colored | one `section` per repo, one `tree` per worktree: root is the branch (`key` role) or the folder name, each child `:port`, folder, command, uptime |
| `:126, 143` | dim `no processes on port <n>` | `out.line("skipped", "Nothing is listening on port <n>")` |
| `:137, 186` | green `killed`, pid, port | `out.line("done", "Stopped pid <pid>", "port <n>")`; from the picker `out.line("done", "Stopped <command>", "pid <pid>, port <n>")` |
| `:139, 188` | red `failed to kill pid <pid>` | `out.line("failed", "Could not stop pid <pid>")` (a real failure of that kill; the verb still exits 0, as today) |
| `:176` | dim `nothing selected` | `out.line("skipped", "Nothing selected")` |
| `:93, 111, 180, 191` | blank lines | removed (rule 8: blocks never print trailing blank lines) |

**The daemon-down line (5f ruling 4).** `getPortData` falls back to its own scan whenever `daemonQuery` returns null or a not-ok reply. `daemonQuery` (`lib/daemon-client.ts:314`, over `daemonQueryAttributed` at `:271`) emits 5a's daemon-down note on one of those paths only: the daemon is installed, its socket is gone, and the restart it tries fails (`:302-304`, `warnDaemonDown`). It returns null silently when the daemon is not installed (`:281`) and when a live socket timed out (`:286`), and a daemon that answers `ok: false` is never a null at all. So 5a's note does not cover the path, and `rt port` prints one note of its own whenever it falls back. On the one path where both fire, stderr holds two lines that say different things: the daemon is not running (with `rt daemon start`), and the ports were scanned without it. `lib/daemon-client.ts` is 5a's and is not edited here.

#### `commands/runs.ts` (Task 6)

| Site | Today | Becomes |
|---|---|---|
| `:16-19` `fail(msg)` | `rt runs: <msg>` on stderr, exit 1 | `fail(f: FailureInput)`: `out.fail(f)`, exit 1 |
| `:28` dangling flag | `<flag> requires a value` | `--repo`: `usageFailure("Which repo?", "rt runs --repo <repo>")`; `--reason`: `usageFailure("What is the reason?", "rt runs abandon <run> --reason <text>")` |
| `:47-70` `STATUS_ICON`, `formatRunLine`, `formatRunDetail` | glyph strings | `runRow(r)` (table cells) and `runDetailBlocks(d)` (`table`, `section`, `line`, `callout`) |
| `:139` | `console.log(JSON.stringify({ ok: false, error }))` | `out.json({ ok: false, error: err.message })` (same bytes) |
| `:142` unknown or ambiguous `--repo` | the error's message | unknown: `{ title: "rt does not know a repo called <arg>" }`; ambiguous: `{ title: "More than one repo is called <arg>", why: "It could be <a> or <b>. Use the full name of the one you mean." }`, each candidate through `repoLabelQualified` (`lib/repo-label.ts:41`, as 5a does for the dispatcher's ambiguous repo), so a person reads `one/widgets`, never a serialized id |
| `:167` stray positional | `rt runs: unknown subcommand "<x>"` and a usage line, exit 2 | `out.fail({ title: "rt runs has no command called <x>", next: cmd("rt runs --help") })`, exit 2 |
| `:172, 194, 218` no daemon | `daemon unavailable -- the run DB needs the rt daemon (rt daemon start)` | `{ title: "The rt daemon is not running", why: "It keeps the record of your runs.", next: cmd("rt daemon start") }` |
| `:173, 195, 219` daemon error | `<error>` or `list failed` / `get failed` / `abandon failed` | `{ title: "Could not list your runs" \| "Could not read that run" \| "Could not abandon that run", why: <error> }` |
| `:175, 197` | `console.log(JSON.stringify(data))` | `out.json(data)` (same bytes) |
| `:176` | `no runs` | `out.line("skipped", "No runs yet")` |
| `:177` | one `formatRunLine` per run | one `table` with headers `STATUS RUN REPO TYPE STAGE STARTED` |
| `:187` | `usage: rt runs show <runId> [--repo <name>] [--json]` | `usageFailure("Which run?", "rt runs show <run>")` |
| `:198` | `formatRunDetail` | `out.print(...runDetailBlocks(data))` |
| `:210` | `abandon needs a run id` | `usageFailure("Which run?", "rt runs abandon <run>")` |
| `:220` | `abandoned <id>` | `out.line("done", "Marked <id> abandoned")` |

`rt runs abandon --json` writes no envelope today (it prints `abandoned <id>` whatever the flags) and is not given one.

#### `commands/sdm.ts` (Task 8)

| Site | Today | Becomes |
|---|---|---|
| `:18` | color import | removed |
| `:61-63` `streamLine` | every child line, dim, on stderr | removed. `withProgress` gives each streaming task an `onLine` that logs at `debug` (module `sdm`), keeps the last five, and feeds a step's sub-lines at a terminal |
| `:76` | a needs-person login with no terminal folds `` Run `rt sdm login --manual` in a terminal first. `` into the error | removed: the error is the reason alone, and the connect failure's `next` names the login (`next` for the `login` stage) |
| `:92` | yellow `StrongDM session expired` dim `logging in…` (stderr) | the step label `Your StrongDM session expired, logging in` |
| `:95, 367, 397` | green `✓ logged in` | `out.line("done", "Logged in to StrongDM")` |
| `:98` | red `✗ login failed:` and a hint (stderr); the picker then shows recents | `out.print(line("warn", "Could not log in to StrongDM", "showing your recent connections only"), callout("why", <error>), callout("next", cmd("rt sdm login --manual")))`: the verb goes on, so it is a warning, on stdout |
| `:109, 155, 270, 278, 289, 309, 316, 323, 343` | `console.log(JSON.stringify(x, null, 2))` | `out.json(x, 2)` (same bytes) |
| `:110` production refusal | red on stderr, exit 1 | a refusal, not a failure (5f ruling 6): `out.note(line("refused", "<label> is a production connection"), callout("why", "A person has to say yes to a production connection."), callout("next", cmd("rt sdm connect <key> --confirm-production")))` on stderr, exit 1 |
| `:140` production confirm | red bold `PRODUCTION <label>` on stderr | `out.print(out.banner("PRODUCTION", <label>, "type its name to connect"))`: the spec's one `banner` |
| `:161-166` connected | check, label, address, db, then verified or unverified lines | `line("done", "<label> is ready", "<address> (<db>/<schema>)")`, then `line("done", "A test query worked", "<n>ms, <k> attempts")`, or `line("warn", "The tunnel is up, but a test query did not confirm it", <error>)` with `callout("note", "It is likely usable. Try your query again, and reconnect if it keeps failing.")` |
| `:171` aborted | yellow `aborted: <reason>` on stdout, exit 1 | `line("skipped", "Not connected", <reason in plain words>)`, exit 1 |
| `:175-176` failed | red `✗ <stage> failed: <error>` and a dim hint (stderr) | `out.fail(connectFailure(target, result), verbatim(<last five child lines>))`, exit 1. Titles by stage below |
| `:192` | `rt sdm connect needs a terminal. Use ... for scripts.` | `out.fail({ title: "Picking a connection needs a terminal", why: "A script names the connection it wants.", next: cmd("rt sdm connect <key>") })` |
| `:198, 279, 388` app did not start | red `✗ <error>` | `out.fail({ title: "The StrongDM app did not start", why: <error> })` |
| `:207` spinner `scanning StrongDM…` | `withInlineSpinner` | `withTransientStep("Scanning StrongDM", ...)` |
| `:210` | yellow scan error on stderr | `line("warn", "The StrongDM scan had a problem", <error>)` on stdout |
| `:212-218` nothing found | a bold line and four lines of advice | `line("skipped", "No StrongDM connections found")`, a `paragraph`, `callout("tip", ["Nicer names for your connections: ", cmd("rt sdm enrichment init")])`, `callout("note", ["The StrongDM CLI comes from ", link])` |
| `:243` | red `unknown selection:` | `out.fail({ title: "That connection is no longer in the list", next: cmd("rt sdm refresh") })` |
| `:290` | red `unknown connection key: <key>` dim `(rt sdm refresh to re-discover)` | `out.fail({ title: "rt does not know a connection called <key>", why: "The list may be out of date.", next: cmd("rt sdm refresh") })` |
| `:310` health not ok (`connections`) | red `sdm:` status and message | `out.fail(healthFailure(health))`: not logged in (`next: rt sdm login`), CLI not installed (details: the install link), or `StrongDM is not answering` with the message as `why` |
| `:317` | red `scan failed: <error>` | `out.fail({ title: "Could not read your StrongDM connections", why: <error> })` |
| `:327` | dim `no StrongDM resources visible; ...` | `line("skipped", "No StrongDM connections to show")`, `callout("next", cmd("rt sdm refresh"))` |
| `:330-335` | gutter glyph, label, key, tier per row | one `table`: a state cell (`connected` as `running`, `standing access` as `done`, `on request` dim), the label, the tier, the key |
| `:347` | yellow `StrongDM app: not running` | `line("off", "The StrongDM app is not running", "rt starts it when you connect")` |
| `:349` health not ok (`status`) | red on **stdout**, exit 1 | a status row on stdout, exit 1: `needs-you` "You are not logged in to StrongDM" with `next`, `pending` "The StrongDM CLI is not installed" with a note, or `failed` "StrongDM is not answering" with the message as its hint |
| `:353` | green `sdm: authenticated` | `line("done", "Logged in to StrongDM")` |
| `:356` | dim `no tunnels connected` | `line("off", "No tunnels open")` |
| `:361` | dot, name, address, expiry | `line("running", <name>, "<address>, until <expiry>")` |
| `:368` | red `✗ <error>` | `out.fail({ title: "Could not log in to StrongDM", why: <error> })` |
| `:377` | `sdm login --manual is interactive; run it from a terminal.` | `out.fail({ title: "This login needs a terminal", why: "It asks questions and opens your browser, so a script cannot run it." })` |
| `:381` | dim `running sdm login (answer its prompts here; ...)` | `line("running", "Starting the StrongDM login", "answer its questions here; your browser opens to finish")` |
| `:393` | dim `logging in to StrongDM (silent)...` | the step label `Logging in to StrongDM` (with `--visible`: `Logging in to StrongDM, a browser window will show`) |
| `:405-406` needs a person, no terminal | the reason, then `Run rt sdm login --manual in a terminal.` | `out.fail({ title: "StrongDM needs you to log in by hand", why: <reason>, next: cmd("rt sdm login --manual") })` |
| `:410` needs a person, at a terminal | yellow reason and `Falling back to terminal login.` | `line("warn", "The browser login could not run", <reason>)`, `callout("note", "Logging in here instead. Answer its questions; your browser opens to finish.")` |
| `:414-415` | red `✗ login failed:` and a hint naming `--visible` and `--manual` | After a silent login: `out.fail({ title: "Could not log in to StrongDM", why: <error>, next: cmd("rt sdm login --visible") }, verbatim(<last five lines>), callout("tip", ["If the browser login keeps failing, log in by hand: ", cmd("rt sdm login --manual")]))`. After a `--visible` login: the same failure with `next: cmd("rt sdm login --manual")` and no tip. A person always meets the manual login; the sdm skill reads only the `next:` line and never runs `--visible`, so its hand-off still comes only from the needs-a-person failure above |
| `:421-425` `refresh` | a red cross line, a bold count, a dim note | `line("warn", "The scan had a problem", <error>)` when there is one, then `line("done" \| "skipped", "Found <n> StrongDM connections", <"check your StrongDM access" when none>)` |
| `:456` | yellow `enrichment now lives in the team store (rt.sdmEnrichment)` | `line("skipped", "Your team's settings already label these connections")`, `callout("note", ["rt would otherwise create ", strong(<path>)])` |
| `:460` | yellow `<path> already exists` (stderr), exit 1 | `out.fail({ title: "Your labels file already exists", why: "It is at <path>." })`, exit 1 |
| `:467` | green check `wrote <path> (<n> resources; fill in labels)` | `line("done", "Created your labels file", "<n> connections")`, `kv("file", <path>)`, `callout("next", "Give a label to each connection you use")` |
| `:473-474` | bold `enrichment:` path, then `<a>/<b> resources enriched` | `kv("labels file", <path>)`, `line("done" \| "pending", "<a> of <b> connections have a label", "the rest show their StrongDM names")` |

Failure titles by stage (`connectFailure`): `health` "StrongDM is not available on this Mac"; `login` "You are not logged in to StrongDM"; `access` "Could not get access to <label>"; `connect` "Could not connect to <label>"; `verify` "<label> did not come up". `why` is the result's `error`. `next` is the result's own `next` (Task 7 adds it: `rt sdm login` when StrongDM says the session ended, `rt sdm connect <key>` when the tunnel did not answer), or `rt sdm login` for the `login` stage; with no `next`, the result's `hint` is the `details` line. No text is matched to choose. Aborted reasons: `login declined` reads "you chose not to log in"; `production connect declined` reads "the name you typed did not match".

Every verb named in a `next` exists in `lib/command-tree-def.ts`: `rt sdm login` (`--manual`, `--visible`), `rt sdm connect` (`--confirm-production`), `rt sdm refresh`, `rt sdm enrichment`, `rt settings check`, `rt daemon start`.

#### Copy inside envelopes (Task 7; 5f ruling 5)

`lib/sdm/flow.ts` is this plan's now, and the same pass runs over every other string in the plan's verbs that rides in a `--json` envelope. For each: where it rides, whether a person reads it on screen, and what it becomes. Shape stays: keys, structure, types, exit codes and every machine-read value. "Stays" means a program is its only reader, or the string never reaches a screen. For Matt to skim.

| # | File:line | Today | Becomes | Where it is read |
|---|---|---|---|---|
| 1 | `lib/sdm/flow.ts:59` `hintFor` | ``Run `rt sdm login`, then retry.`` | `hint`: `Log in to StrongDM again, then connect.`; `next`: `rt sdm login` | `hint` in `rt sdm connect --json` (the sdm skill relays `error` and `hint` to the person); on screen as the failure's `next:` line |
| 2 | `lib/sdm/flow.ts:60` `hintFor` | `Check the resource name, or request access with a reason.` | `Check the connection name, or ask for access with a reason.` (no `next`) | the envelope's `hint`; on screen as the failure's details line |
| 3 | `lib/sdm/flow.ts:71` | `StrongDM CLI unavailable.` (when the health check gives no message) | `StrongDM did not answer.` | `error` in the connect envelope (stage `health`); the failure's `why:` |
| 4 | `lib/sdm/flow.ts:75` | `Not authenticated.` (same fallback) | `StrongDM says you are not logged in.` | `error` (stage `login`), the skill routes on the stage; `why:`; the tray reconnect's `error` (no consumer reads it) |
| 5 | `lib/sdm/flow.ts:79` | `Login failed.` | `The login did not finish.` | `why:` (an interactive connect only; `--json` never logs in) |
| 6 | `lib/sdm/flow.ts:82` | `Still not authenticated.` | `StrongDM still says you are not logged in.` | `why:` (interactive only) |
| 7 | `lib/sdm/flow.ts:100` | `Access request failed.` | `StrongDM did not grant access.` | `error` (stage `access`); `why:` |
| 8 | `lib/sdm/flow.ts:108` | `Connect failed.` | `StrongDM did not open the tunnel.` | `error` (stage `connect`); `why:`; the tray reconnect's `error` |
| 9 | `lib/sdm/flow.ts:117` | `sdm reports no local address for <resource> after connect.` | `StrongDM did not report a local address for it.` | `error` (stage `verify`); `why:` under "<label> did not come up" |
| 10 | `lib/sdm/flow.ts:136` | `Tunnel is not reachable: <error>` | `The tunnel did not answer: <error>` (`<error>` stays the driver's own words) | `error` (stage `verify`); `why:` |
| 11 | `lib/sdm/flow.ts:137` | ``Reconnect with `rt sdm`, or check the resource in the StrongDM app.`` | `hint`: `Connect again, or check this connection in the StrongDM app.`; `next`: `rt sdm connect <key>` | the envelope's `hint`; on screen as `next:` |
| 12 | `lib/sdm/flow.ts:77, 88` aborted reasons | `login declined`, `production connect declined` | stay | programs only: the CLI maps each through `ABORTED` to plain words, `--json` never prompts so never aborts, and the tray reconnect never prompts |
| 13 | `lib/sdm/core.ts:93` `NOT_AUTHENTICATED` | ``StrongDM CLI is not authenticated: run `sdm login` and try again.`` | `Your StrongDM login has expired, or this Mac has not logged in yet.` | `message` in `rt sdm status --json`, `error` in the `connections --json` refusal and the connect envelope (stage `login`); `why:` under "You are not logged in to StrongDM". The skill branches on `health` and `stage`, never on this text. It told a person to run the raw `sdm` CLI, which the skill forbids |
| 14 | `lib/sdm/core.ts:102` | `StrongDM CLI not found. Install it from <url>.` | `The StrongDM CLI is not installed. Install it from <url>.` | `message` in `status --json`, which the skill relays as "the install message", so the url stays in the sentence; `why:` at the `health` stage |
| 15 | `lib/sdm/core.ts:105` | `StrongDM CLI did not respond in time.` | `StrongDM did not answer in time.` | `message` / `error`; the hint of "StrongDM is not answering" in `rt sdm status`, `why:` elsewhere |
| 16 | `lib/sdm/core.ts:108` | `Error running sdm (<code>).` | `The StrongDM CLI could not start (<code>).` | same as 15 |
| 17 | `lib/sdm/core.ts:117` | `<sdm's own output>` or `sdm status exited with code <n>.` | StrongDM's own output stays; the fallback becomes `The StrongDM CLI stopped with exit code <n>.` | same as 15 |
| 18 | `lib/sdm/core.ts:326` | `Access request failed: <sdm's output>` | `<sdm's output>`, or `StrongDM gave no reason.` | `error` (stage `access`); `why:` under "Could not get access to <label>", which already says what failed |
| 19 | `lib/sdm/core.ts:362` | `Connect failed: <sdm's output>` | `<sdm's output>`, or `StrongDM gave no reason.` | `error` (stage `connect`); `why:` under "Could not connect to <label>" |
| 20 | `lib/sdm/core.ts:437` | ``Login timed out. Complete the SAML flow in your browser, or run `sdm login` in a terminal.`` | `The login timed out before your browser finished it.` | not an envelope (`rt sdm login` has no `--json`, and `--json` connects never log in), but `why:` on screen under "Could not log in to StrongDM", and it named the raw `sdm` CLI. Reworded because the file is in this pass |
| 21 | `lib/sdm/core.ts:440` | `Login failed: <sdm's output>` or `... the sdm CLI reported the details above` | `<sdm's output>`, or `StrongDM printed the reason above.` | as 20: `why:` only. Its `<sdm's output>` includes `core.ts:410`, the two spawn-error outputs of `runSdmLoginInteractive` (`StrongDM CLI not found. Install it from <url>.`, `Error running sdm (<code>).`), which become `The StrongDM CLI is not installed. Install it from <url>.` and `The StrongDM CLI could not start (<code>).`, the same words as rows 14 and 16 |
| 22 | `lib/sdm/app.ts:53` | ``Could not launch the StrongDM app (`open -ga SDM` failed).`` | `macOS could not open the StrongDM app.` | `error` in the connect envelope (stage `health`); `why:` under "The StrongDM app did not start" |
| 23 | `lib/sdm/app.ts:59` | `StrongDM app did not become ready within 15s of launching.` | `The StrongDM app opened but was not ready after 15 seconds.` | same as 22 |
| 24 | `lib/sdm/app.ts:51` (progress) | `StrongDM app is not running; launching it` | stays | not an envelope: a step sub-line and a log line. Under `--json` it leaves stderr (Task 8 Step 6) |
| 25 | `commands/sdm.ts:270` | `error`: `a connection key is required with --json`, `hint`: `rt sdm connections --json lists valid keys` | stay | only under `--json`, read by the skill; a person at a terminal gets the picker |
| 26 | `commands/sdm.ts:289` | `error`: `unknown connection key: <key>`, `hint`: `rt sdm connections --json lists valid keys; rt sdm refresh re-discovers` | stay | only under `--json`; the human path prints its own failure (`rt does not know a connection called <key>`) |
| 27 | `lib/sdm/agent-json.ts:79` | `<label> is a production resource; a human must approve. Re-run with --confirm-production.` | stays | only under `--json`; the skill routes on `stage: confirm`; the human path prints its own refusal |
| 28 | `lib/sdm/agent-json.ts:32`, `lib/sdm/flow.ts:94, 97` | `investigating <label> data` | stays | a value, not copy: the skill passes `defaultReason` back as `--reason`, and it is the org-visible access reason (the invariant at the top of `flow.ts`) |
| 29 | `commands/runs.ts:139` | `{"ok":false,"error":"unknown repo: <arg>"}` | stays | only under `--json`; the human path prints its own failure |
| 30 | `commands/runs.ts:173, 195, 219` | the daemon's `error` | stays | the daemon's handlers' words, shown as `why:`; not this plan's file |

Readers of rows 1 to 23 checked: nothing under `skills/`, `plugins/mattstack`, `apps/board/skills`, `rt-tray/Sources`, `apps/*/src` or `packages/rt-client/src` matches any of these strings (searched each phrase). The tests that do are moved in Task 7: `lib/sdm/__tests__/core-parsers.test.ts:85` (`did not respond`), `core-runner.test.ts:83, 88, 166` (`SAML`, `Login failed: sso rejected`, `strongdm.com`), `app.test.ts:71, 81` (`launch`, `did not become ready`). `lib/sdm/__tests__/agent-json.test.ts:123-127` builds a result by hand with the old hint and tests that the builder passes it through; it is left as it is, since `agent-json.ts` does not change. `lib/daemon/handlers/sdm.ts:123-126` returns the flow's `error` from `sdm:reconnect`; no tray, console or package code reads that reply's text.

Not in this pass: `lib/sdm/browser-login.ts` reasons and errors (lines 117, 127, 185, 206, 220). They reach the screen as `why:` but ride in no envelope (`rt sdm login` has no `--json`), and line 127 names `rt sdm set-email`, phase 4's verb. Decision 13 carries it as a follow-up.

#### Who reads this plan's output (spec: each conversion PR greps `plugins/mattstack`, `skills/` and `apps/board/skills`)

| Reader | What it reads | After this plan |
|---|---|---|
| `skills/rt-sdm-connect/SKILL.md` | `rt sdm status\|connections\|connect --json` on stdout; exit codes; `rt sdm login` by exit code, and on a non-zero exit whether the output "names the manual login". Line 203 says "progress lines are on stderr" | Envelope shapes and exit codes unchanged (Task 7 pins them through the real binary, logged in and out, before any sdm file changes, and pins the reworded strings apart from the shape). The needs-a-person failure names `rt sdm login --manual` on its `next:` line, on stderr; a failed silent login's `next:` line is `rt sdm login --visible`, with the manual login only in a `tip` (pinned). The skill reads the `next:` line and never runs `--visible`, so its routing is unchanged. Line 203 is edited, and the login call note names the `next:` line (Task 8 Step 5) |
| `e2e/tests/sdm-browser-login.test.ts:123, 126` | waits for and asserts `logged in` on the screen of an interactive `rt sdm login` (opt-in: `RT_SDM_BROWSER_E2E=1` with Chrome present) | now `Logged in to StrongDM`; edited in Task 8 Step 4 and run opted in at Task 8 Step 6 |
| `runs`, `runs show` | the board and skills use the MCP run tools; `plugins/mattstack/hooks/pipeline-gate-stop.sh` uses `runs find` and `runs snapshot` (non-goals). Nothing reads `rt runs` text | `--json` unchanged |
| `port` | nothing (searched `rt port` under the three trees) | n/a |

#### Tests this plan moves

| File | What changes | Task |
|---|---|---|
| `lib/sdm/__tests__/picker.test.ts` | line 102 `q.color` contains `94` becomes `q.tone` is `blue`; one new pin of the pick request | 3 |
| `lib/sdm/__tests__/enrichment.test.ts` | new tests of the two warnings | 4 |
| `commands/__tests__/runs.test.ts` | `runExpectingCleanExit` reads `captureOut()`; the formatting tests assert blocks; six failure strings | 6 |
| `e2e/tests/sdm-json.test.ts`, `e2e/tests/fixtures/sdm-json.json` (new) | captured before any sdm envelope string or verb changes; two values (row 13's sentence) edited by hand after the copy pass | 7 |
| `lib/sdm/__tests__/flow.test.ts`, `core-parsers.test.ts`, `core-runner.test.ts`, `app.test.ts` | new pins of the envelope copy and its shape; five assertions follow the new words | 7 |
| `lib/sdm/__tests__/enrichment-cmd.test.ts` | the `console.log` patch becomes `captureOut()`; "team store" becomes "team's settings" | 8 |
| `e2e/tests/sdm-enrichment.test.ts` | `0/2 resources enriched` becomes `0 of 2 connections have a label` | 8 |
| `e2e/tests/sdm-browser-login.test.ts` | `logged in` becomes `Logged in to StrongDM` (two lines) | 8 |
| `e2e/tests/runs.test.ts`, `lib/sdm/__tests__/agent-json.test.ts`, `lib/daemon/__tests__/sdm-handlers.test.ts` | no edit; each must pass untouched | 8, 9 |

The spec names no pty test for these verbs, so this plan adds none and does not edit `.github/workflows/e2e.yml`.

Counts against the scoping document: `commands/sdm.ts` 59 guard lines, `lib/sdm/enrichment.ts` 2, `lib/sdm/picker.ts` 5, `lib/navigate.ts` 1, `commands/port.ts` 19, `commands/runs.ts` 9 and 2 seam lines. Six allowlist lines. (5f2 carries `commands/chat.ts` and `lib/chat-viewer-url.ts`, the slice's other two.)

---

### Task 3: The sdm picker's colors become tones

Guard hygiene. The picker a person sees does not change; the first test below proves the pick request is the same before and after.

**Files:**
- Modify: `lib/navigate.ts:13-21` (`NavOption`)
- Modify: `lib/sdm/picker.ts:21-52`
- Modify: `lib/sdm/__tests__/picker.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `lib/navigate.ts` and `lib/sdm/picker.ts`)

**Interfaces:**
- Consumes: `installFakePick(script)` from `lib/ui/pick-fake.ts` (returns `{ calls, restore }`; `calls[0].request.rows` is what `runPick` was sent); `runNavPicker(opts: NavPickerOpts)` re-exported by `lib/navigate.ts`.
- Produces: `NavOption.tone?: string` (replaces `color?: string`): a picker tone name. `lib/pick-wrappers.ts` does not read it today, and nothing else in `lib/navigate.ts` changes (shared item 12 was withdrawn, so `NavPickerOpts` gains no stream option).

- [ ] **Step 1: Pin the pick request (passes before and after)**

In `lib/sdm/__tests__/picker.test.ts`, change the first import line and add two imports:

```ts
import { afterEach, describe, test, expect } from "bun:test";
import { installFakePick } from "../../ui/pick-fake.ts";
import { runNavPicker } from "../../navigate.ts";
```

Append at the end of the file:

```ts
describe("the pick request", () => {
  let fake: ReturnType<typeof installFakePick> | undefined;
  afterEach(() => {
    fake?.restore();
    fake = undefined;
  });

  test("an sdm row reaches rt-ui as a bold label and a dim hint, and nothing else", async () => {
    fake = installFakePick([{ kind: "result", result: { action: "cancel", value: null, query: "" } }]);
    const options = buildPickerOptions(
      [{ ...conn("q", "qa"), standingAccess: true }, conn("d", "development")],
      [],
      new Set(["example-q"]),
    );
    await runNavPicker({ options, message: "sdm connections", breadcrumb: ["rt", "sdm", "connections"] });
    expect(fake.calls[0]!.request.rows).toEqual([
      { value: "demo:d", match: "  d", left: [{ text: "  d", bold: true, column: true }, { text: "  example-d  development", tone: "dim" }], group: "Development" },
      { value: "demo:q", match: "● q", left: [{ text: "● q", bold: true, column: true }, { text: "  example-q  qa", tone: "dim" }], group: "QA" },
    ]);
  });
});
```

Run (repo root): `bun test lib/sdm/__tests__/picker.test.ts`
Expected: PASS, on the unedited source. This is the picker's look, pinned: the row carries no color today, so it must carry none after.

- [ ] **Step 2: Write the failing tests**

In the same file, in the test `gutter marks state: filled dot connected (blue), check standing, blank on-demand`, replace its last line

```ts
    expect(q.color).toContain("94");              // connected row rendered blue
```

with

```ts
    expect(q.tone).toBe("blue");
    expect(s.tone).toBe("peach");
    expect(d.tone).toBe("mint");
```

and add this test after it, inside `describe("buildPickerOptions", ...)`:

```ts
  test("a row names its tier's tone, and no option carries an escape sequence", () => {
    const options = buildPickerOptions([conn("p", "production"), conn("q", "qa"), conn("x")], []);
    const rows = options.filter(o => !o.separator);
    expect(rows.find(o => o.value === "demo:p")!.tone).toBe("coral");
    expect(rows.find(o => o.value === "demo:q")!.tone).toBe("pink");
    expect(rows.find(o => o.value === "demo:x")!.tone).toBeUndefined();
    expect(JSON.stringify(options)).not.toContain("\\u001b");
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run (repo root): `bun test lib/sdm/__tests__/picker.test.ts`
Expected: FAIL. `q.tone` is undefined, and `bunx tsc --noEmit` would report that `tone` does not exist on `NavOption`.

- [ ] **Step 4: Edit `lib/navigate.ts`**

Replace

```ts
  /** Optional ANSI SGR color escape (e.g. "\x1b[36m") applied to label + hint. */
  color?: string;
```

with

```ts
  /** A picker tone for the row, by name (PickSegment's tone vocabulary). */
  tone?: string;
```

That is the file's only edit.

- [ ] **Step 5: Edit `lib/sdm/picker.ts`**

Replace the `TIER_COLOR` constant, `MAX_RECENT_ROWS`, the comment above `CONNECTED_COLOR` and `CONNECTED_COLOR` itself (lines 21 to 32) with:

```ts
const TIER_TONE: Record<string, string> = {
  development: "mint",
  qa: "pink",
  staging: "peach",
  production: "coral",
};

const MAX_RECENT_ROWS = 3;

// Distinct from every tier tone, so a live tunnel reads as its own state.
const CONNECTED_TONE = "blue";
```

In the doc comment above `row`, replace the last sentence, `Kept as plain text (no inline ANSI) so the picker's column alignment stays correct; the blue comes from the row color.`, with `Kept as plain text so the picker's column alignment stays correct; the row's tone carries the state.`

In `row`, replace

```ts
    color: connected ? CONNECTED_COLOR : (tier ? TIER_COLOR[tier] : undefined),
```

with

```ts
    tone: connected ? CONNECTED_TONE : (tier ? TIER_TONE[tier] : undefined),
```

- [ ] **Step 6: Delete the two allowlist lines**

In `lib/__tests__/raw-output-allowlist.json`, delete the lines `"lib/navigate.ts",` and `"lib/sdm/picker.ts",`.

- [ ] **Step 7: Run the tests and the guards**

Run (repo root): `bun test lib/sdm/__tests__/picker.test.ts lib/__tests__/nav-picker.test.ts lib/__tests__/pick-wrappers.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS, the Step 1 pin included.
Run: `bun run typecheck`
Expected: no errors. If `commands/nav.ts` or `commands/run.ts` reports `color` on a `NavOption`, something outside this slice began setting it: rename that use to `tone` only if the file is not another slice's, otherwise stop and report.

- [ ] **Step 8: Commit**

```bash
git add lib/navigate.ts lib/sdm/picker.ts lib/sdm/__tests__/picker.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "sdm picker: row colors are tone names, not escape sequences

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The sdm enrichment warnings go through `warn`

**Files:**
- Modify: `lib/sdm/enrichment.ts:20-27, 47-69`
- Modify: `lib/sdm/__tests__/enrichment.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `lib/sdm/enrichment.ts`)

**Interfaces:**
- Consumes (5a): `warn(module, message, opts?)`, `setWarningLog(log, opts?)`, `__test__.reset()` from `lib/ui/warn.ts`; `out.cmd` from `lib/ui/out.ts`; `captureOut()` from `lib/ui/__tests__/capture-out.ts` (phase 2).
- Produces: nothing new; `loadEnrichment` and `probeEnrichmentStore` keep their signatures.

- [ ] **Step 1: Write the failing tests**

In `lib/sdm/__tests__/enrichment.test.ts`, change the first import to `import { describe, test, expect, beforeEach, afterEach } from "bun:test";` and add:

```ts
import * as out from "../../ui/out.ts";
import { captureOut } from "../../ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnings } from "../../ui/warn.ts";
```

Append at the end of the file:

```ts
describe("enrichment warnings", () => {
  let logged: Array<{ module: string; message: string; context: Record<string, unknown> }>;
  let io: ReturnType<typeof captureOut>;

  beforeEach(() => {
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "enr-warn-home-")));
    warnings.reset();
    logged = [];
    setWarningLog((module, message, context) => logged.push({ module, message, context }));
    io = captureOut();
    out.__test__.setHuman(() => false);
  });
  afterEach(() => {
    io.restore();
    warnings.reset();
  });

  test("a file that will not parse is logged with its path and shown once, without the path", () => {
    const dir = mkdtempSync(join(tmpdir(), "enr-warn-"));
    const p = join(dir, "e.jsonc");
    writeFileSync(p, "{ not json");

    expect(loadEnrichment(p)).toEqual({});
    expect(loadEnrichment(p)).toEqual({});

    expect(logged).toHaveLength(2);
    expect(logged[0]!.module).toBe("sdm");
    expect(logged[0]!.message.startsWith(`failed to parse ${p}, ignoring enrichment file: `)).toBe(true);
    expect(logged[0]!.context).toMatchObject({ path: p });
    expect(io.stderr()).toBe("[warning] Your sdm enrichment file could not be read  rt is ignoring it\n");
    expect(io.stdout()).toBe("");
  });

  test("a setting the store refuses is logged and shown with the command that finds it", () => {
    writeStore(teamSettingsPath("acme"), { "rt.sdmEnrichment": ["nope"] });

    expect(loadEnrichment(join(tmpdir(), "no-such-enrichment.jsonc"))).toEqual({});

    expect(logged[0]!.module).toBe("sdm");
    expect(logged[0]!.message.startsWith('ignoring "rt.sdmEnrichment" -- ')).toBe(true);
    const shown = io.stderr();
    expect(shown.startsWith("[warning] Your sdm enrichment setting is being ignored  ")).toBe(true);
    expect(shown.endsWith("\n  next: rt settings check\n")).toBe(true);
    expect(shown.split("\n")).toHaveLength(3);
    expect(io.stdout()).toBe("");
  });

  test("a missing file is no warning at all", () => {
    expect(loadEnrichment(join(tmpdir(), "no-such-enrichment.jsonc"))).toEqual({});
    expect(logged).toEqual([]);
    expect(io.stderr()).toBe("");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run (repo root): `bun test lib/sdm/__tests__/enrichment.test.ts`
Expected: FAIL. `logged` is empty in the first two tests: the lines still go to `console.warn`.

- [ ] **Step 3: Edit `lib/sdm/enrichment.ts`**

Add two imports after the `getSetting` import:

```ts
import * as out from "../ui/out.ts";
import { warn } from "../ui/warn.ts";
```

Replace the body of `probeEnrichmentStore` with:

```ts
  try {
    return getSetting<Record<string, EnrichmentEntry>>(SETTING_KEY).value;
  } catch (err) {
    const message = (err as Error).message;
    warn("sdm", `ignoring "${SETTING_KEY}" -- ${message}`, {
      show: { title: "Your sdm enrichment setting is being ignored", hint: message.split("\n")[0], next: out.cmd("rt settings check") },
    });
    return undefined;
  }
```

In `loadEnrichment`, replace the `console.warn` call (the three lines of the `if (existsSync(path))` block) with:

```ts
    if (existsSync(path)) {
      warn("sdm", `failed to parse ${path}, ignoring enrichment file: ${(err as Error).message}`, {
        context: { path },
        show: { title: "Your sdm enrichment file could not be read", hint: "rt is ignoring it" },
      });
    }
```

- [ ] **Step 4: Delete the allowlist line**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `"lib/sdm/enrichment.ts",`.

- [ ] **Step 5: Run the tests and the guards**

Run (repo root): `bun test lib/sdm lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-daemon-sync-exec.test.ts`
Expected: PASS. The daemon loads this file (the sdm catalog handler), which is why the last two guards are in the run: `lib/ui/warn.ts` and `lib/ui/out.ts` are both safe to import from a file the daemon reaches (5a's constraint and phase 2's allowlist entry).

If the second enrichment test fails because the store's refusal is not a throw on this machine (the warning never fires), keep the assertion on `loadEnrichment`'s return value, and drive `probeEnrichmentStore`'s catch another way: write a team settings file that is not JSON (`writeFileSync(teamSettingsPath("acme"), "{ not json")` after `mkdirSync(dirname(...), { recursive: true })`). Say which one you used in the report.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/sdm/enrichment.ts lib/sdm/__tests__/enrichment.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "sdm: enrichment warnings go through warn

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `rt port`

**Files:**
- Modify: `commands/port.ts` (everything but `formatUptime` and the picker rows)
- Create: `commands/__tests__/port.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `commands/port.ts`)

**Interfaces:**
- Consumes: `withTransientStep(label, task)` and `out.note(...blocks)` (5a); `out.print`, `out.line`, `out.section`, `out.tree`, `out.key`, `out.dim` (phase 1); `renderPlain` (`lib/ui/out-plain.ts`); `captureOut()` (phase 2); `scanListeningPorts(): Promise<PortEntry[]>` (`lib/port-scanner.ts:234`).
- Produces: `export function portBlocks(entries: PortEntry[]): Block[]` in `commands/port.ts`, and `export const __test__ = { formatUptime }`.

- [ ] **Step 1: Write the failing tests**

Create `commands/__tests__/port.test.ts`:

```ts
import { afterEach, expect, mock, test } from "bun:test";
import type { PortEntry } from "../../lib/port-scanner.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

// mock.module mutates the live namespace object in place, so the real one is
// captured before any mock is installed.
const realDaemonClient = await import("../../lib/daemon-client.ts");
const realDaemonQuery = realDaemonClient.daemonQuery;
const realPortScanner = await import("../../lib/port-scanner.ts");
const realScan = realPortScanner.scanListeningPorts;
const { portBlocks, portScanner, __test__ } = await import("../port.ts");

function fakeDaemon(ports: PortEntry[]): void {
  mock.module("../../lib/daemon-client.ts", () => ({
    ...realDaemonClient,
    daemonQuery: async () => ({ ok: true, data: { ports } }),
  }));
}

/** No daemon reply at all, and a direct scan that finds `ports` without running lsof. */
function noDaemon(ports: PortEntry[]): void {
  mock.module("../../lib/daemon-client.ts", () => ({ ...realDaemonClient, daemonQuery: async () => null }));
  mock.module("../../lib/port-scanner.ts", () => ({ ...realPortScanner, scanListeningPorts: async () => ports }));
}

afterEach(() => {
  mock.module("../../lib/daemon-client.ts", () => ({ ...realDaemonClient, daemonQuery: realDaemonQuery }));
  mock.module("../../lib/port-scanner.ts", () => ({ ...realPortScanner, scanListeningPorts: realScan }));
});

const entry = (over: Partial<PortEntry>): PortEntry => ({
  port: 3000,
  pid: 101,
  command: "node",
  cwd: "/code/sample-app",
  repo: "sample-app",
  worktree: "/code/sample-app",
  branch: "feature/login",
  relativeDir: ".",
  uptime: "05:12",
  ...over,
});

const ENTRIES: PortEntry[] = [
  entry({ relativeDir: "apps/web" }),
  entry({ port: 5432, pid: 102, command: "postgres", uptime: "01:02:03" }),
  entry({ port: 8080, pid: 103, command: "bun", repo: "other-tool", worktree: "/code/other", branch: null, uptime: "00:09" }),
];

const row = (cells: string[], widths: number[]): string => "  - " + cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!))).join("  ");

const LISTED =
  "sample-app\n" +
  "feature/login\n" +
  row([":3000", "sample-app/apps/web", "node", "5m"], [5, 19, 8]) + "\n" +
  row([":5432", "sample-app", "postgres", "1h2m"], [5, 19, 8]) + "\n" +
  "\n" +
  "other-tool\n" +
  "other\n" +
  "  - :8080  other  bun  09s\n";

test("ports are grouped by repo, then by branch, one row per port", () => {
  expect(renderPlain(portBlocks(ENTRIES))).toBe(LISTED);
});

test("no ports is one done line", () => {
  expect(renderPlain(portBlocks([]))).toBe("[ok] Nothing is listening in your repos\n");
});

test("uptime reads as the largest unit that fits", () => {
  expect(__test__.formatUptime("05:12")).toBe("5m");
  expect(__test__.formatUptime("00:09")).toBe("09s");
  expect(__test__.formatUptime("01:02:03")).toBe("1h2m");
  expect(__test__.formatUptime("2-01:02:03")).toBe("2d");
  expect(__test__.formatUptime("")).toBe("?");
});

test("off a terminal rt port prints the list once, on stdout, with no scan line", async () => {
  fakeDaemon(ENTRIES);
  const io = captureOut();
  out.__test__.setHuman(() => false);
  try {
    await portScanner([]);
    expect(io.stdout()).toBe(LISTED);
    expect(io.stderr()).toBe("");
  } finally {
    io.restore();
  }
});

test("rt port kill off a terminal lists instead of opening a picker", async () => {
  fakeDaemon(ENTRIES);
  const io = captureOut();
  out.__test__.setHuman(() => false);
  try {
    await portScanner(["kill"]);
    expect(io.stdout()).toBe(LISTED);
    expect(io.stderr()).toBe("");
  } finally {
    io.restore();
  }
});

test("rt port kill with no ports is the one done line", async () => {
  fakeDaemon([]);
  const io = captureOut();
  out.__test__.setHuman(() => false);
  try {
    await portScanner(["kill"]);
    expect(io.stdout()).toBe("[ok] Nothing is listening in your repos\n");
  } finally {
    io.restore();
  }
});

test("when the daemon does not answer, rt port scans by itself and says so on stderr", async () => {
  noDaemon(ENTRIES);
  const io = captureOut();
  out.__test__.setHuman(() => false);
  try {
    await portScanner([]);
    expect(io.stdout()).toBe(LISTED);
    expect(io.stderr()).toBe("[warning] Scanned your ports without the rt daemon\n");
  } finally {
    io.restore();
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run (repo root): `bun test commands/__tests__/port.test.ts`
Expected: FAIL. `portBlocks` and `__test__` are not exported by `commands/port.ts`, so the file fails to load.

- [ ] **Step 3: Convert `commands/port.ts`**

Replace the import block (lines 13 to 18) with:

```ts
import { execSync } from "child_process";
import { basename } from "path";
import { scanListeningPorts, type PortEntry } from "../lib/port-scanner.ts";
import { repoLabel } from "../lib/repo-label.ts";
import * as out from "../lib/ui/out.ts";
import type { Block, PickRow, PickSegment } from "../lib/ui/protocol.ts";
import { withTransientStep } from "../lib/ui/transient-step.ts";
```

Replace `getPortData` with:

```ts
async function getPortData(): Promise<{ entries: PortEntry[]; source: "daemon" | "direct" }> {
  const { daemonQuery } = await import("../lib/daemon-client.ts");
  // refresh: true → daemon re-scans before returning, so we never serve the
  // 30s-stale cache on a direct CLI invocation. A fresh scan does an lsof per
  // listening PID, so allow more than the default 2s.
  const result = await withTransientStep("Scanning ports", () => daemonQuery("ports", { refresh: true }, 15_000));

  if (result?.ok && result.data?.ports) {
    return { entries: result.data.ports as PortEntry[], source: "daemon" };
  }

  // daemonQuery's own daemon-down note fires only after a failed restart; a
  // missing daemon or a timed-out one falls back here with nothing said.
  out.note(out.line("warn", "Scanned your ports without the rt daemon"));
  return {
    entries: await withTransientStep("Scanning ports", async () => scanListeningPorts()),
    source: "direct",
  };
}
```

In `folderPath`, delete the line `const { basename } = require("path") as typeof import("path");` (the static import above replaces it).

Replace `displayPorts` (the whole function) with:

```ts
const NOTHING_LISTENING = "Nothing is listening in your repos";

export function portBlocks(entries: PortEntry[]): Block[] {
  if (entries.length === 0) return [out.line("done", NOTHING_LISTENING)];

  const grouped = new Map<string, Map<string, PortEntry[]>>();
  for (const entry of entries) {
    const repoKey = entry.repo || "unknown";
    if (!grouped.has(repoKey)) grouped.set(repoKey, new Map());
    const wtKey = entry.worktree || "unknown";
    const wtMap = grouped.get(repoKey)!;
    if (!wtMap.has(wtKey)) wtMap.set(wtKey, []);
    wtMap.get(wtKey)!.push(entry);
  }

  const blocks: Block[] = [];
  for (const [repoName, worktrees] of grouped) {
    const trees: Block[] = [];
    for (const [wtPath, ports] of worktrees) {
      const branch = ports[0]?.branch;
      const root = branch ? out.key(branch) : out.dim(wtPath === "unknown" ? "unknown folder" : basename(wtPath));
      trees.push(out.tree(root, ports.map((p) => [`:${p.port}`, folderPath(p), out.dim(p.command), out.dim(formatUptime(p.uptime))])));
    }
    blocks.push(out.section(repoLabel(repoName), undefined, ...trees));
  }
  return blocks;
}
```

Replace `killByPort` with:

```ts
function killByPort(port: number): void {
  const nothing = (): void => out.print(out.line("skipped", `Nothing is listening on port ${port}`));
  let output: string;
  try {
    // -sTCP:LISTEN: only the listener. Plain `-i :port` also matches clients
    // connected to the port (browser tabs, curl, etc.).
    output = execSync(`lsof -iTCP:${port} -sTCP:LISTEN -P -n 2>/dev/null`, { encoding: "utf8", stdio: "pipe" });
  } catch {
    nothing();
    return;
  }
  const lines = output.trim().split("\n").filter(Boolean);
  if (lines.length <= 1) {
    nothing();
    return;
  }
  const pids = new Set<string>();
  for (const line of lines.slice(1)) {
    const pid = line.split(/\s+/)[1];
    if (pid) pids.add(pid);
  }
  const results: Block[] = [];
  for (const pid of pids) {
    try {
      execSync(`kill -9 ${pid}`);
      results.push(out.line("done", `Stopped pid ${pid}`, `port ${port}`));
    } catch {
      results.push(out.line("failed", `Could not stop pid ${pid}`));
    }
  }
  out.print(...results);
}
```

The comment inside it is retyped because today's line holds a long dash; the edited lines carry none.

In `showKillPicker`, replace everything after the `filterableMultiselect` call (from `if (!selectedPids || selectedPids.length === 0) {` to the end of the function) with:

```ts
  if (!selectedPids || selectedPids.length === 0) {
    out.print(out.line("skipped", "Nothing selected"));
    return;
  }

  const results: Block[] = [];
  for (const pid of selectedPids) {
    const entry = entries.find((p) => String(p.pid) === pid);
    if (!entry) continue;
    try {
      execSync(`kill -9 ${pid}`);
      results.push(out.line("done", `Stopped ${entry.command}`, `pid ${pid}, port ${entry.port}`));
    } catch {
      results.push(out.line("failed", `Could not stop pid ${pid}`));
    }
  }
  out.print(...results);
}
```

Replace `portScanner` (the whole function) with:

```ts
export async function portScanner(args: string[]): Promise<void> {
  // Ad-hoc kill mode: rt port 8080
  if (args.length > 0 && /^\d+$/.test(args[0] || "")) {
    return killByPort(parseInt(args[0]!, 10));
  }

  if (args[0] === "kill") {
    const killArgs = args.slice(1);
    if (killArgs.length > 0 && /^\d+$/.test(killArgs[0] || "")) {
      return killByPort(parseInt(killArgs[0]!, 10));
    }
  }

  const { entries } = await getPortData();

  // The kill picker already shows every port, so a terminal gets the picker
  // and everything else gets the list.
  if (entries.length === 0 || !process.stdin.isTTY) {
    out.print(...portBlocks(entries));
    return;
  }
  await showKillPicker(entries);
}

export const __test__ = { formatUptime };
```

(`rt port` and `rt port kill` ran the same three steps in two copies; the function above is the same behavior once.)

- [ ] **Step 4: Delete the allowlist line**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `"commands/port.ts",`.

- [ ] **Step 5: Run the tests and the guards**

Run (repo root): `bun test commands/__tests__/port.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/port-scanner.test.ts lib/__tests__/picker-conformance.test.ts`
Expected: PASS.
Run: `bun run typecheck`
Expected: no errors.
Run: `grep -n "console\.\|inline-spinner\|tui.ts" commands/port.ts`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add commands/port.ts commands/__tests__/port.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "port: the list, the kill results and the scan spinner go through the output layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `rt runs`, `rt runs show`, `rt runs abandon`

**Files:**
- Modify: `commands/runs.ts` (lines 9 to 70, 89, 114 to 144, 164 to 221)
- Modify: `commands/__tests__/runs.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `commands/runs.ts`)

**Interfaces:**
- Consumes: `usageFailure(title, usage, why?)` (5a); `repoLabelQualified(serialized: string): string` (`lib/repo-label.ts:41`); `out.fail`, `out.json`, `out.print`, `out.table`, `out.section`, `out.line`, `out.callout`, `out.key`, `out.strong`, `out.dim`, `out.cmd`, `out.FailureInput`, `out.CellInput` (phases 1 and 2); `captureOut()`.
- Produces, exported from `commands/runs.ts`:
  - `runRow(r: RunSummary): out.CellInput[]` (replaces `formatRunLine`)
  - `runDetailBlocks(d: RunDetail): Block[]` (replaces `formatRunDetail`)
  - `class AmbiguousRunsRepo` gains `constructor(readonly arg: string, readonly matches: string[])`; its `message` is the string it carries today.

- [ ] **Step 1: Move the harness onto the stream capture**

In `commands/__tests__/runs.test.ts`, add two imports after the `DaemonResponse` import:

```ts
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
```

Change the import from `../runs.ts` to:

```ts
import { runRow, runDetailBlocks, runDisplayKey, runsList, runsShow, runsAbandon, resolveRunsRepoArg, AmbiguousRunsRepo } from "../runs.ts";
```

Replace `runExpectingCleanExit` (the function, keeping the doc comment above it) with:

```ts
async function runExpectingCleanExit(fn: () => Promise<void>): Promise<{ exitCode: number | undefined; errors: string[]; logs: string[] }> {
  const io = captureOut();
  out.__test__.setHuman(() => false);
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  try {
    await fn();
    return { exitCode: undefined, errors: io.errLines(), logs: io.lines() };
  } catch {
    const exitCode = exitSpy.mock.calls.at(-1)?.[0] as number | undefined;
    return { exitCode, errors: io.errLines(), logs: io.lines() };
  } finally {
    exitSpy.mockRestore();
    io.restore();
  }
}
```

- [ ] **Step 2: Write the failing tests**

Replace the whole `describe("rt runs formatting", ...)` block with:

```ts
describe("rt runs blocks", () => {
  const run = { id: "20260821-010101-aaaa", repo: "alpha", work_type: "feature", pipeline: "default", status: "running", current_stage: "plan", spawned_by: null, started_at: 1755750000000, ended_at: null };

  test("a run is one table row: status, id, repo, type, stage, start", () => {
    const text = renderPlain([out.table([runRow(run as any)])]);
    expect(text).toBe("running  20260821-010101-aaaa  alpha  feature  plan  2025-08-21 04:20\n");
  });

  test("a finished run shows no stage", () => {
    const text = renderPlain([out.table([runRow({ ...run, status: "done" } as any)])]);
    expect(text).toBe("done  20260821-010101-aaaa  alpha  feature    2025-08-21 04:20\n");
  });

  test("the detail has a section each for stages, fields and decisions", () => {
    const text = renderPlain(runDetailBlocks({
      run: run as any,
      stages: [{ name: "plan", status: "done", attempt: 1, started_at: 1, ended_at: 2, reason: null, detail_path: null }],
      fields: [{ key: "ticket", value: "ACME-1", produced_by: "plan", at: 1 }],
      decisions: [{ contract: "execution-strategy@1", scope: "run", selection: '{"tier":"direct-tdd"}', decided_by: "stage-plan", decided_at: 1 }],
      schemaAhead: false,
    } as any));
    expect(text).toContain("STATUS   RUN");
    expect(text).toContain("\n\nStages\n[ok] plan  attempt 1\n");
    expect(text).toContain("\n\nFields\nticket  ACME-1  plan\n");
    expect(text).toContain('\n\nDecisions\nexecution-strategy@1  run  {"tier":"direct-tdd"}  stage-plan\n');
  });

  test("a failed stage carries its reason and where its detail is", () => {
    const text = renderPlain(runDetailBlocks({
      run: run as any,
      stages: [{ name: "gates", status: "failed", attempt: 1, started_at: 1, ended_at: 2, reason: "qa-islands assertion failed", detail_path: "/tmp/gates.log" }],
      fields: [],
      decisions: [],
      schemaAhead: false,
    } as any));
    expect(text).toContain("[failed] gates  attempt 1\n  why: qa-islands assertion failed\n  note: /tmp/gates.log\n");
    expect(text).not.toContain("Fields");
    expect(text).not.toContain("Decisions");
  });

  test("a redirected stage reads as skipped and says so, never as an unknown state", () => {
    const text = renderPlain(runDetailBlocks({
      run: run as any,
      stages: [{ name: "implement", status: "redirected", attempt: 1, started_at: 1, ended_at: 2, reason: "redirected to plan", detail_path: null }],
      fields: [],
      decisions: [],
      schemaAhead: false,
    } as any));
    expect(text).toContain("[skipped] implement  attempt 1, redirected\n  why: redirected to plan\n");
    expect(text).not.toContain("[not yet] implement");
  });

  test("a run written by a newer rt says so", () => {
    const text = renderPlain(runDetailBlocks({ run: run as any, stages: [], fields: [], decisions: [], schemaAhead: true } as any));
    expect(text).toContain("[warning] A newer rt wrote this run  some of it may be missing here\n");
  });
});
```

In `describe("rt runs --repo flag validation", ...)`, replace the three `expect(errors.join("\n")).toContain("--repo requires a value");` lines with:

```ts
    expect(errors).toEqual(["Which repo?", "  next: rt runs --repo <repo>"]);
```

In `describe("rt runs abandon argument validation", ...)`, replace `expect(errors.join("\n")).toContain("abandon needs a run id");` with:

```ts
    expect(errors).toEqual(["Which run?", "  next: rt runs abandon <run>"]);
```

and `expect(errors.join("\n")).toContain("--reason requires a value");` with:

```ts
    expect(errors).toEqual(["What is the reason?", "  next: rt runs abandon <run> --reason <text>"]);
```

In `describe("rt runs --repo identity resolution", ...)`, in the test `the same unknown --repo fails on stderr, exit 1, without --json`, replace its last line with:

```ts
    expect(errors).toEqual(["rt does not know a repo called definitely-not-a-repo"]);
```

and add these tests at the end of that `describe` block (they use its `installFakeDaemon`):

```ts
  test("an unknown --repo under --json writes the same envelope and nothing on stderr", async () => {
    installFakeDaemon({ ok: true, data: { runs: [] } });
    const { exitCode, logs, errors } = await runExpectingCleanExit(() => runsList(["--repo", "definitely-not-a-repo", "--json"]));
    expect(exitCode).toBe(1);
    expect(logs).toEqual(['{"ok":false,"error":"unknown repo: definitely-not-a-repo"}']);
    expect(errors).toEqual([]);
  });

  test("an ambiguous --repo without --json names both repos", async () => {
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Fone%2Fwidgets", "/repos/a/widgets");
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Ftwo%2Fwidgets", "/repos/b/widgets");
    installFakeDaemon({ ok: true, data: { runs: [] } });
    const { exitCode, errors } = await runExpectingCleanExit(() => runsList(["--repo", "widgets"]));
    expect(exitCode).toBe(1);
    expect(errors[0]).toBe("More than one repo is called widgets");
    // Short labels, never the serialized ids; the resolver decides the order.
    expect([
      "  why: It could be one/widgets or two/widgets. Use the full name of the one you mean.",
      "  why: It could be two/widgets or one/widgets. Use the full name of the one you mean.",
    ]).toContain(errors[1]!);
  });

  test("--json list and show write the daemon's data on one line, as before", async () => {
    installFakeDaemon({ ok: true, data: { runs: [] } });
    const list = await runExpectingCleanExit(() => runsList(["--json"]));
    expect(list.logs).toEqual(['{"runs":[]}']);
    installFakeDaemon({ ok: true, data: { run: { id: "x" } } });
    const show = await runExpectingCleanExit(() => runsShow(["x", "--json"]));
    expect(show.logs).toEqual(['{"run":{"id":"x"}}']);
  });

  test("the list is one table, and no runs is one skipped line", async () => {
    const run = { id: "20260821-010101-aaaa", repo: "alpha", work_type: "feature", pipeline: "default", status: "failed", current_stage: null, spawned_by: null, started_at: 1755750000000, ended_at: null };
    installFakeDaemon({ ok: true, data: { runs: [run] } });
    const listed = await runExpectingCleanExit(() => runsList([]));
    // The plain table pads every cell but the last to its column and joins with two spaces.
    const cols = (cells: string[]): string => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd([6, 20, 5, 7, 5][i]!))).join("  ");
    expect(listed.logs).toEqual([
      cols(["STATUS", "RUN", "REPO", "TYPE", "STAGE", "STARTED"]),
      cols(["failed", "20260821-010101-aaaa", "alpha", "feature", "", "2025-08-21 04:20"]),
    ]);
    installFakeDaemon({ ok: true, data: { runs: [] } });
    const none = await runExpectingCleanExit(() => runsList([]));
    expect(none.logs).toEqual(["[skipped] No runs yet"]);
  });

  test("a daemon that is not running, a daemon error, a stray word and a done abandon each read plainly", async () => {
    installFakeDaemon(null as unknown as DaemonResponse);
    const down = await runExpectingCleanExit(() => runsList([]));
    expect(down.exitCode).toBe(1);
    expect(down.errors).toEqual(["The rt daemon is not running", "  why: It keeps the record of your runs.", "  next: rt daemon start"]);

    installFakeDaemon({ ok: false, error: "no such run: x" });
    const missing = await runExpectingCleanExit(() => runsShow(["x"]));
    expect(missing.exitCode).toBe(1);
    expect(missing.errors).toEqual(["Could not read that run", "  why: no such run: x"]);

    const stray = await runExpectingCleanExit(() => runsList(["bogus"]));
    expect(stray.exitCode).toBe(2);
    expect(stray.errors).toEqual(["rt runs has no command called bogus", "  next: rt runs --help"]);

    installFakeDaemon({ ok: true, data: {} });
    const done = await runExpectingCleanExit(() => runsAbandon(["20260821-010101-aaaa"]));
    expect(done.exitCode).toBeUndefined();
    expect(done.logs).toEqual(["[ok] Marked 20260821-010101-aaaa abandoned"]);
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run (repo root): `bun test commands/__tests__/runs.test.ts`
Expected: FAIL. `runRow` and `runDetailBlocks` are not exported; with the harness on the stream capture, `errors` and `logs` are empty because `commands/runs.ts` still prints through `console`.

- [ ] **Step 4: Convert `commands/runs.ts`**

Replace the import block and everything through `formatRunDetail` (lines 9 to 70) with:

```ts
import { daemonQuery } from "../lib/daemon-client.ts";
import { tryResolveRepoArg } from "../lib/repo-arg.ts";
import { repoLabel, repoLabelQualified } from "../lib/repo-label.ts";
import { parseIdentity, repoIdentitySlug } from "../lib/settings/identity.ts";
import { listRunRepoDirs } from "../lib/runs/store.ts";
import * as out from "../lib/ui/out.ts";
import type { Block, RenderStatus } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import type { RunDetail, RunSummary } from "../packages/rt-client/src/commands.ts";

function fail(f: out.FailureInput): never {
  out.fail(f);
  process.exit(1);
}

const NO_DAEMON: out.FailureInput = {
  title: "The rt daemon is not running",
  why: "It keeps the record of your runs.",
  next: out.cmd("rt daemon start"),
};

const FLAG_QUESTION: Record<"--repo" | "--reason", [title: string, usage: string]> = {
  "--repo": ["Which repo?", "rt runs --repo <repo>"],
  "--reason": ["What is the reason?", "rt runs abandon <run> --reason <text>"],
};

function flagValue(args: string[], flag: "--repo" | "--reason"): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const v = args[i + 1];
  // A dangling flag (nothing after it, or the next token is itself a flag)
  // must fail loudly: falling back to "no value" would turn `rt runs --repo`
  // into an unscoped list instead of an error.
  if (v === undefined || v.startsWith("--")) fail(usageFailure(...FLAG_QUESTION[flag]));
  return v;
}

// Index-based scan, not value comparison: a positional that EQUALS a flag's
// value, e.g. `rt runs show abc --repo abc`, must still parse.
const FLAGS_WITH_VALUES = new Set(["--repo", "--reason"]);
function positional(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      if (FLAGS_WITH_VALUES.has(a)) i++; // skip the flag's value slot
      continue;
    }
    return a;
  }
  return undefined;
}

const RUN_STATUS: Record<string, RenderStatus> = { running: "running", done: "done", failed: "failed", abandoned: "off", redirected: "skipped" };
const RUN_HEADERS = ["STATUS", "RUN", "REPO", "TYPE", "STAGE", "STARTED"];

export function runRow(r: RunSummary): out.CellInput[] {
  const status = RUN_STATUS[r.status];
  const stage = r.status === "running" && r.current_stage ? r.current_stage : "";
  const when = new Date(r.started_at).toISOString().slice(0, 16).replace("T", " ");
  return [status ? { text: r.status, role: status } : r.status, out.strong(r.id), repoLabel(r.repo), r.work_type, out.dim(stage), out.dim(when)];
}

export function runDetailBlocks(d: RunDetail): Block[] {
  const blocks: Block[] = [out.table([runRow(d.run)], RUN_HEADERS)];
  if (d.schemaAhead) blocks.push(out.line("warn", "A newer rt wrote this run", "some of it may be missing here"));
  if (d.stages.length > 0) {
    const stages: Block[] = [];
    for (const s of d.stages) {
      stages.push(out.line(RUN_STATUS[s.status] ?? "pending", s.name, `attempt ${s.attempt}${s.status === "redirected" ? ", redirected" : ""}`));
      if (s.reason) stages.push(out.callout("why", s.reason));
      if (s.detail_path) stages.push(out.callout("note", s.detail_path));
    }
    blocks.push(out.section("Stages", undefined, ...stages));
  }
  if (d.fields.length > 0) blocks.push(out.section("Fields", undefined, out.table(d.fields.map((f) => [out.key(f.key), f.value, out.dim(f.produced_by)]))));
  if (d.decisions.length > 0) blocks.push(out.section("Decisions", undefined, out.table(d.decisions.map((x) => [out.key(x.contract), x.scope, x.selection, out.dim(x.decided_by)]))));
  return blocks;
}
```

Replace the `AmbiguousRunsRepo` class line (`export class AmbiguousRunsRepo extends RunsRepoArgError {}`) with:

```ts
export class AmbiguousRunsRepo extends RunsRepoArgError {
  constructor(readonly arg: string, readonly matches: string[]) {
    super(`--repo "${arg}" matches more than one repo: ${matches.join(", ")} (pass the full identity)`);
  }
}
```

In `resolveRunsRepoArg`, replace the `throw new AmbiguousRunsRepo(...)` statement (three lines) with:

```ts
    throw new AmbiguousRunsRepo(arg, resolution.matches);
```

Replace `resolveRepoFilter` (the function; its doc comment stays) with:

```ts
function repoArgFailure(err: RunsRepoArgError): out.FailureInput {
  if (err instanceof AmbiguousRunsRepo) {
    return { title: `More than one repo is called ${err.arg}`, why: `It could be ${err.matches.map(repoLabelQualified).join(" or ")}. Use the full name of the one you mean.` };
  }
  if (err instanceof UnknownRunsRepo) return { title: `rt does not know a repo called ${err.arg}` };
  return { title: err.message };
}

async function resolveRepoFilter(args: string[]): Promise<string | undefined> {
  const repoArg = flagValue(args, "--repo");
  if (!repoArg) return undefined;
  try {
    return await resolveRunsRepoArg(repoArg);
  } catch (err) {
    if (!(err instanceof RunsRepoArgError)) throw err;
    if (args.includes("--json")) {
      out.json({ ok: false, error: err.message });
      process.exit(1);
    }
    fail(repoArgFailure(err));
  }
}
```

Replace `runsList`, `runsShow` and `runsAbandon` (lines 164 to 221) with:

```ts
export async function runsList(args: string[]): Promise<void> {
  const stray = positional(args);
  if (stray) {
    out.fail({ title: `rt runs has no command called ${stray}`, next: out.cmd("rt runs --help") });
    process.exit(2);
  }
  const repo = await resolveRepoFilter(args);
  const res = await daemonQuery("runs:list", { repo }, 10_000);
  if (!res) fail(NO_DAEMON);
  if (!res.ok) fail({ title: "Could not list your runs", why: res.error });
  const data = res.data as { runs: RunSummary[] };
  if (args.includes("--json")) {
    out.json(data);
    return;
  }
  if (data.runs.length === 0) {
    out.print(out.line("skipped", "No runs yet"));
    return;
  }
  out.print(out.table(data.runs.map(runRow), RUN_HEADERS));
}

export async function runsShow(args: string[]): Promise<void> {
  let runId = positional(args);
  const json = args.includes("--json");
  if (!runId) {
    const runs = process.stdin.isTTY && !json && !process.env.RT_BATCH
      ? await fetchRunsForPicker(args)
      : [];
    if (runs.length === 0) fail(usageFailure("Which run?", "rt runs show <run>"));
    const picked = await pickRunId(runs, "pick a run to show");
    if (!picked) process.exit(0);
    runId = picked;
  }
  const repo = await resolveRepoFilter(args);
  const res = await daemonQuery("runs:get", { runId, repo }, 10_000);
  if (!res) fail(NO_DAEMON);
  if (!res.ok) fail({ title: "Could not read that run", why: res.error });
  const data = res.data as RunDetail;
  if (json) {
    out.json(data);
    return;
  }
  out.print(...runDetailBlocks(data));
}

export async function runsAbandon(args: string[]): Promise<void> {
  let runId = positional(args);
  const json = args.includes("--json");
  if (!runId) {
    const runs = process.stdin.isTTY && !json && !process.env.RT_BATCH
      ? await fetchRunsForPicker(args)
      : [];
    const targets = runs.filter((r) => r.status === "running");
    const pick = targets.length > 0 ? targets : runs;
    if (pick.length === 0) fail(usageFailure("Which run?", "rt runs abandon <run>"));
    const picked = await pickRunId(pick, "pick a run to abandon");
    if (!picked) process.exit(0);
    runId = picked;
  }
  const repo = await resolveRepoFilter(args);
  const reason = flagValue(args, "--reason") ?? "reconciled by hand";
  const res = await daemonQuery("runs:abandon", { runId, repo, reason });
  if (!res) fail(NO_DAEMON);
  if (!res.ok) fail({ title: "Could not abandon that run", why: res.error });
  out.print(out.line("done", `Marked ${runId} abandoned`));
}
```

`res.error` may be `undefined`; `FailureInput.why` is optional and `out.failure` drops an undefined member, so the title then stands alone.

- [ ] **Step 5: Delete the allowlist line**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `"commands/runs.ts",`.

- [ ] **Step 6: Run the tests and the guards**

Run (repo root): `bun test commands/__tests__/runs.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/picker-conformance.test.ts lib/__tests__/agent-safe.test.ts`
Expected: PASS.
Run: `bun run typecheck`
Expected: no errors.
Run: `grep -n "console\." commands/runs.ts`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add commands/runs.ts commands/__tests__/runs.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "runs: the list, the detail and every failure go through the output layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The words in sdm's envelopes (`lib/sdm/flow.ts`, `core.ts`, `app.ts`)

5f ruling 5. Every row of Task 2's "Copy inside envelopes" table that changes (rows 1 to 11 and 13 to 23), and the failed connect's new `next` field. No envelope gains, loses or renames a key; no exit code, stage, health value or other machine-read value changes. This task lands before Task 8 so that Task 8's `connectFailure` can read `next` instead of matching hint text.

Two commits. The first pins sdm's three `--json` verbs through the real binary before any sdm envelope string or verb changes, logged in and logged out, so the refusal shapes the skill reads (`status` and `connections` when StrongDM is not logged in) are captured from today's code. The second rewords the strings; the only fixture values it touches are the two that carry row 13's sentence, edited by hand, and the e2e test then proves every other byte is unchanged. The unit tests pin this task's words apart from the shape.

**Files:**
- Create: `e2e/tests/sdm-json.test.ts`, `e2e/tests/fixtures/sdm-json.json` (captured, then two values edited by hand)
- Modify: `lib/sdm/flow.ts:53-62, 71-82, 100, 108, 113-138` (string literals, the `GuidedResult` failed member, `hintFor`)
- Modify: `lib/sdm/core.ts:93, 102, 105, 108, 117, 326, 362, 410, 437, 440` (string literals only)
- Modify: `lib/sdm/app.ts:53, 59` (string literals only)
- Modify: `lib/sdm/__tests__/flow.test.ts`, `lib/sdm/__tests__/core-parsers.test.ts`, `lib/sdm/__tests__/core-runner.test.ts`, `lib/sdm/__tests__/app.test.ts`

None of the three files is on the raw-output allowlist; nothing to delete there.

**Interfaces:**
- Consumes: `runGuidedConnect(target, opts, deps): Promise<GuidedResult>` and `GuidedDeps` (`lib/sdm/flow.ts`); `buildConnectJson(target, result): { json: unknown; exitCode: number }` and `buildStatusJson(snapshot, appRunning)` (`lib/sdm/agent-json.ts`, unchanged); `interpretSdmStatus(spawnErrorCode, exitCode, output): SdmHealth`, `loginSdmWith(run, onLine)`, `connectResourceWith(run, resource, onLine, opts?)`, `SDM_INSTALL_URL` (`lib/sdm/core.ts`); `ensureSdmApp(onLine, deps?)` (`lib/sdm/app.ts`).
- Produces: `GuidedResult`'s failed member becomes `{ outcome: "failed"; stage: "health" | "login" | "access" | "connect" | "verify"; error: string; hint?: string; next?: string }`. `hint` is a plain sentence a person reads (it is what `buildConnectJson` puts in the envelope's `hint`, unchanged); `next` is the one command it points at, never part of the sentence. `buildConnectJson` does not read `next`, so the envelope keeps exactly the keys `ok`, `stage`, `error`, `hint`. Task 8's `connectFailure` reads `next`. `lib/daemon/handlers/sdm.ts` reads only `outcome`, `error` and `reason` and needs no change.

- [ ] **Step 1: Write the envelope pin**

Create `e2e/tests/sdm-json.test.ts`:

```ts
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { createTestHome, rt } from "../harness.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "sdm-json.json");

function writeFake(home: string, name: string, script: string): string {
  const binDir = join(home, "fakebin");
  mkdirSync(binDir, { recursive: true });
  const path = join(binDir, name);
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

/** The same fake `sdm` the enrichment e2e uses: a status header and a two-row catalog. */
const LOGGED_IN = `#!/bin/bash
if [ "$1" = "status" ]; then
  echo "DATASOURCE             STATUS       ADDRESS"
  exit 0
fi
if [ "$1" = "access" ] && [ "$2" = "catalog" ]; then
  echo "rs-abc123def0  acme-alpha-staging  cluster-x  postgres  env=staging"
  echo "rs-def456abc1  acme-beta-qa-prod  cluster-y  postgres  env=prod"
  exit 0
fi
exit 0
`;

/** A logged-out CLI: every call fails with the login text interpretSdmStatus reads as not-authenticated. */
const LOGGED_OUT = `#!/bin/bash
echo "You are not authenticated. Please run: sdm login"
exit 1
`;

describe("sdm --json envelopes (read by the sdm skill)", () => {
  const { path: home, cleanup } = createTestHome();
  const loggedIn = writeFake(home, "sdm", LOGGED_IN);
  const loggedOut = writeFake(home, "sdm-logged-out", LOGGED_OUT);
  afterAll(() => cleanup());

  test("status, connections and connect write the bytes they wrote before the output layer", async () => {
    const got: Record<string, { exitCode: number; stdout: string; stderr: string }> = {};
    const run = async (name: string, args: string[], bin: string): Promise<void> => {
      const r = await rt(args, { home, env: { RT_SDM_BIN: bin } });
      // Whether the StrongDM app is running is this machine's business, not the envelope's shape.
      got[name] = { exitCode: r.exitCode, stdout: r.stdout.replace(/"appRunning": (true|false)/, '"appRunning": "<machine>"'), stderr: r.stderr };
    };
    await run("status", ["sdm", "status", "--json"], loggedIn);
    await run("connections", ["sdm", "connections", "--json"], loggedIn);
    await run("connect-no-key", ["sdm", "connect", "--json"], loggedIn);
    await run("connect-unknown-key", ["sdm", "connect", "no-such-key", "--json"], loggedIn);
    await run("status-logged-out", ["sdm", "status", "--json"], loggedOut);
    await run("connections-logged-out", ["sdm", "connections", "--json"], loggedOut);

    if (process.env.RT_UPDATE_SDM_JSON) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, JSON.stringify(got, null, 2) + "\n");
    }
    expect(got).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  });
});
```

- [ ] **Step 2: Capture the fixture before any sdm envelope string or verb changes, and read it**

Run (repo root): `RT_UPDATE_SDM_JSON=1 bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/sdm-json.test.ts`
Expected: PASS, and `e2e/tests/fixtures/sdm-json.json` now exists with six entries.

Open the fixture and check it by eye before trusting it:

- `status`: `exitCode` 0, `stdout` a five-key object (`ok`, `health`, `message`, `appRunning`, `tunnels`) indented two spaces and ending in a newline, `stderr` empty.
- `connections`: `exitCode` 0, `ok: true`, two entries under `connections`, `stderr` empty.
- `connect-no-key`: `exitCode` 1 and `"error": "a connection key is required with --json"`.
- `connect-unknown-key`: `exitCode` 1 and `"error": "unknown connection key: no-such-key"`.
- `status-logged-out`: `exitCode` 1, `"ok": false`, `"health": "not-authenticated"`, `"tunnels": []`, and `"message"` the old login sentence (it quotes `sdm login` in backticks).
- `connections-logged-out`: `exitCode` 1 and exactly the three keys `ok` (`false`), `health` (`"not-authenticated"`) and `error` (the same old sentence).

If a `stderr` is not empty here (a daemon-down note, for one), that is today's behavior: leave it in the fixture. Task 8 Step 6 says what to do when the conversion changes it. If `status-logged-out` does not come back `not-authenticated`, the fake's text no longer matches `interpretSdmStatus` (`lib/sdm/core.ts:110-123`): fix the fake script, never the fixture, and capture again.

Run it once more without the variable: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/sdm-json.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit the pin**

```bash
git add e2e/tests/sdm-json.test.ts e2e/tests/fixtures/sdm-json.json
```

```bash
git commit -m "sdm: pin the status, connections and connect envelopes through the real binary, logged in and out

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: Write the failing tests**

In `lib/sdm/__tests__/flow.test.ts`, add after the `SdmSnapshot` import:

```ts
import { buildConnectJson } from "../agent-json.ts";
```

Append at the end of the file:

```ts
describe("what a failed connect says (the --json envelope and the failure on screen)", () => {
  test("a session that ended mid-connect says what to do in words, and names the command apart", async () => {
    const { deps } = makeDeps({ connect: async () => ({ ok: false, error: "You are not authenticated.", code: "not-authenticated" }) });
    const r = await runGuidedConnect(target, { interactive: false }, deps);
    expect(r).toEqual({ outcome: "failed", stage: "connect", error: "You are not authenticated.", hint: "Log in to StrongDM again, then connect.", next: "rt sdm login" });
  });

  test("an access refusal has a hint and no command", async () => {
    const { deps } = makeDeps({
      needsAccessRequest: async () => true,
      requestAccess: async () => ({ ok: false, error: "denied", code: "no-access" }),
    });
    const r = await runGuidedConnect(target, { interactive: false }, deps);
    expect(r).toEqual({ outcome: "failed", stage: "access", error: "denied", hint: "Check the connection name, or ask for access with a reason." });
  });

  test("an error StrongDM gave no words for reads plainly", async () => {
    const { deps } = makeDeps({ connect: async () => ({ ok: false }) });
    const r = await runGuidedConnect(target, { interactive: false }, deps);
    expect(r).toEqual({ outcome: "failed", stage: "connect", error: "StrongDM did not open the tunnel." });
  });

  test("a tunnel that does not answer names the connect command for this key", async () => {
    const { deps } = makeDeps({
      verify: async () => ({ ok: false, attempts: 5, latencyMs: null, lastError: new Error("handshake refused") }),
      probeTunnel: async () => ({ ok: false, error: new Error("ECONNREFUSED") }),
    });
    const r = await runGuidedConnect(target, { interactive: true }, deps);
    expect(r).toEqual({
      outcome: "failed",
      stage: "verify",
      error: "The tunnel did not answer: handshake refused",
      hint: "Connect again, or check this connection in the StrongDM app.",
      next: "rt sdm connect demo:alpha-staging",
    });
  });

  test("a connect with no local address says so without naming the resource", async () => {
    const { deps } = makeDeps({ getSnapshot: async (force?: boolean) => (force ? snapshot("ok", null) : snapshot("ok")) });
    const r = await runGuidedConnect(target, { interactive: true }, deps);
    expect(r).toEqual({ outcome: "failed", stage: "verify", error: "StrongDM did not report a local address for it." });
  });

  test("a failed connect's envelope keeps its keys and types, and its words are the new ones", async () => {
    const { deps } = makeDeps({ connect: async () => ({ ok: false, error: "You are not authenticated.", code: "not-authenticated" }) });
    const r = await runGuidedConnect(target, { interactive: false }, deps);
    const { json, exitCode } = buildConnectJson(target, r);
    // Shape, as the sdm skill reads it.
    expect(exitCode).toBe(1);
    expect(Object.keys(json as object)).toEqual(["ok", "stage", "error", "hint"]);
    expect(Object.values(json as object).map((v) => typeof v)).toEqual(["boolean", "string", "string", "string"]);
    expect((json as { ok: boolean; stage: string }).stage).toBe("connect");
    // Words, pinned on their own.
    expect((json as { hint: string }).hint).toBe("Log in to StrongDM again, then connect.");
    expect((json as { hint: string }).hint).not.toMatch(/`|rt sdm/);
  });
});
```

In `lib/sdm/__tests__/core-parsers.test.ts`, in `describe("interpretSdmStatus", ...)`, replace `expect(h.message).toContain("did not respond");` with `expect(h.message).toBe("StrongDM did not answer in time.");`, and add these tests at the end of that `describe`:

```ts
  test("each health message is a plain sentence that names no command", () => {
    expect(interpretSdmStatus("ENOENT", null, "").message).toBe("The StrongDM CLI is not installed. Install it from https://www.strongdm.com/docs/cli/.");
    expect(interpretSdmStatus("EACCES", null, "").message).toBe("The StrongDM CLI could not start (EACCES).");
    expect(interpretSdmStatus(null, 3, "").message).toBe("The StrongDM CLI stopped with exit code 3.");
    expect(interpretSdmStatus(null, 3, "  gateway unreachable \n").message).toBe("gateway unreachable");
    const loggedOut = interpretSdmStatus(null, 1, "You are not authenticated. please run: sdm login");
    expect(loggedOut).toEqual({ status: "not-authenticated", message: "Your StrongDM login has expired, or this Mac has not logged in yet." });
  });
```

In `lib/sdm/__tests__/core-runner.test.ts`, replace the two login tests' names and assertions:

| Today | Becomes |
|---|---|
| `test("timeout maps to SAML remediation text", ...)` with `expect(r.error).toContain("SAML");` | `test("a timeout says the login ran out of time in the browser", ...)` with `expect(r.error).toBe("The login timed out before your browser finished it.");` |
| `expect(r).toEqual({ ok: false, error: "Login failed: sso rejected" });` | `expect(r).toEqual({ ok: false, error: "sso rejected" });` |

and add one test at the end of `describe("connectResourceWith", ...)` (its `mkRun(outputs: Array<{ ok: boolean; output: string }>)` returns `{ run, calls }`, and `noSleep` is in scope):

```ts
  test("a failed connect is StrongDM's own words, or says it gave none", async () => {
    const said = await connectResourceWith(mkRun([{ ok: false, output: "  no route to gateway \n" }]).run, "res", () => {}, { waitsMs: [], sleep: noSleep });
    expect(said.error).toBe("no route to gateway");
    const silent = await connectResourceWith(mkRun([{ ok: false, output: "" }]).run, "res", () => {}, { waitsMs: [], sleep: noSleep });
    expect(silent.error).toBe("StrongDM gave no reason.");
  });
```

In the same file's `describe("runSdmLoginInteractive", ...)`, in the test `missing binary maps to ENOENT with install message`, replace `expect(r.output).toContain("strongdm.com");` with `expect(r.output).toBe("The StrongDM CLI is not installed. Install it from https://www.strongdm.com/docs/cli/.");` (this output becomes the manual login's `why:` through `loginSdmWith`).

In `lib/sdm/__tests__/app.test.ts`, replace `expect(r.error).toContain("launch");` with `expect(r.error).toBe("macOS could not open the StrongDM app.");` and `expect(r.error).toContain("did not become ready");` with `expect(r.error).toBe("The StrongDM app opened but was not ready after 15 seconds.");`.

- [ ] **Step 5: Run them to verify they fail**

Run (repo root): `bun test lib/sdm/__tests__/flow.test.ts lib/sdm/__tests__/core-parsers.test.ts lib/sdm/__tests__/core-runner.test.ts lib/sdm/__tests__/app.test.ts`
Expected: FAIL, each on the old words: the flow results carry `Run \`rt sdm login\`, then retry.` and no `next`, the health messages are the old sentences, the login errors keep their `Login failed: ` prefix, and the app errors are the old two.

- [ ] **Step 6: Edit `lib/sdm/flow.ts`**

Replace the `GuidedResult` type and `hintFor` (lines 53 to 62) with:

```ts
export type GuidedResult =
  | { outcome: "connected"; address: string; verify: VerifyOutcome; unverified?: boolean }
  | { outcome: "aborted"; reason: string }
  | { outcome: "failed"; stage: "health" | "login" | "access" | "connect" | "verify"; error: string; hint?: string; next?: string };

// `hint` is read by a person (the --json envelope's hint, a failure's details),
// so it never quotes a command; `next` carries the command, for the CLI to show.
function adviceFor(code?: SdmFailureCode): { hint?: string; next?: string } {
  if (code === "not-authenticated") return { hint: "Log in to StrongDM again, then connect.", next: "rt sdm login" };
  if (code === "no-access") return { hint: "Check the connection name, or ask for access with a reason." };
  return {};
}
```

Then change these lines, each found by its text:

| Line | Today | Becomes |
|---|---|---|
| 71 | `error: snapshot.health.message ?? "StrongDM CLI unavailable."` | `error: snapshot.health.message ?? "StrongDM did not answer."` |
| 75 | `error: snapshot.health.message ?? "Not authenticated."` | `error: snapshot.health.message ?? "StrongDM says you are not logged in."` |
| 79 | `error: login.error ?? "Login failed."` | `error: login.error ?? "The login did not finish."` |
| 82 | `error: snapshot.health.message ?? "Still not authenticated."` | `error: snapshot.health.message ?? "StrongDM still says you are not logged in."` |
| 100 | `return { outcome: "failed", stage: "access", error: access.error ?? "Access request failed.", hint: hintFor(access.code) };` | `return { outcome: "failed", stage: "access", error: access.error ?? "StrongDM did not grant access.", ...adviceFor(access.code) };` |
| 108 | `return { outcome: "failed", stage: "connect", error: conn.error ?? "Connect failed.", hint: hintFor(conn.code) };` | `return { outcome: "failed", stage: "connect", error: conn.error ?? "StrongDM did not open the tunnel.", ...adviceFor(conn.code) };` |
| 117 | `` error: `sdm reports no local address for ${target.sdmResource} after connect.`, `` | `error: "StrongDM did not report a local address for it.",` |

Replace the hard verify failure's `return` (lines 133 to 138) with:

```ts
    return {
      outcome: "failed",
      stage: "verify",
      error: `The tunnel did not answer: ${verify.lastError?.message ?? "no reason given"}`,
      hint: "Connect again, or check this connection in the StrongDM app.",
      next: `rt sdm connect ${target.key}`,
    };
```

The aborted reasons (`login declined`, `production connect declined`) and the reason template (`investigating ${target.label} data`) are not edited: Task 2's table, rows 12 and 28.

- [ ] **Step 7: Edit `lib/sdm/core.ts`**

String literals only, each found by its text:

| Line | Today | Becomes |
|---|---|---|
| 93 | ``message: "StrongDM CLI is not authenticated: run `sdm login` and try again.",`` | `message: "Your StrongDM login has expired, or this Mac has not logged in yet.",` |
| 102 | `` message: `StrongDM CLI not found. Install it from ${SDM_INSTALL_URL}.` `` | `` message: `The StrongDM CLI is not installed. Install it from ${SDM_INSTALL_URL}.` `` |
| 105 | `message: "StrongDM CLI did not respond in time."` | `message: "StrongDM did not answer in time."` |
| 108 | `` message: `Error running sdm (${spawnErrorCode}).` `` | `` message: `The StrongDM CLI could not start (${spawnErrorCode}).` `` |
| 117 | `` message: output.trim().slice(0, 200) \|\| `sdm status exited with code ${exitCode}.`, `` | `` message: output.trim().slice(0, 200) \|\| `The StrongDM CLI stopped with exit code ${exitCode}.`, `` |
| 326 | `` error: `Access request failed: ${r.output.trim() \|\| "unknown error"}`, `` | `error: r.output.trim() \|\| "StrongDM gave no reason.",` |
| 362 | `` error: `Connect failed: ${r.output.trim() \|\| "unknown error"}`, `` | `error: r.output.trim() \|\| "StrongDM gave no reason.",` |
| 410 (`runSdmLoginInteractive`) | `` output: code === "ENOENT" ? `StrongDM CLI not found. Install it from ${SDM_INSTALL_URL}.` : `Error running sdm (${code}).`, `` | `` output: code === "ENOENT" ? `The StrongDM CLI is not installed. Install it from ${SDM_INSTALL_URL}.` : `The StrongDM CLI could not start (${code}).`, `` |
| 437 | ``error: "Login timed out. Complete the SAML flow in your browser, or run `sdm login` in a terminal.",`` | `error: "The login timed out before your browser finished it.",` |
| 440 | `` return { ok: false, error: `Login failed: ${result.output.trim() \|\| "the sdm CLI reported the details above"}` }; `` | `return { ok: false, error: result.output.trim() \|\| "StrongDM printed the reason above." };` |

`classifySdmFailure` reads `r.output`, never `error`, so dropping the prefixes changes no code path. (The `\|` in the table is a markdown escape; the source has a plain `||`.)

- [ ] **Step 8: Edit `lib/sdm/app.ts`**

| Line | Today | Becomes |
|---|---|---|
| 53 | ``if (launched.code !== 0) return { ok: false, error: "Could not launch the StrongDM app (`open -ga SDM` failed)." };`` | `if (launched.code !== 0) return { ok: false, error: "macOS could not open the StrongDM app." };` |
| 59 | `` return { ok: false, error: `StrongDM app did not become ready within ${APP_WAIT_ATTEMPTS}s of launching.` }; `` | `` return { ok: false, error: `The StrongDM app opened but was not ready after ${APP_WAIT_ATTEMPTS} seconds.` }; `` |

The progress line at 51 (`StrongDM app is not running; launching it`) is not an envelope string and stays (Task 2's table, row 24).

- [ ] **Step 9: Run the tests and the readers**

Run (repo root): `bun test lib/sdm lib/daemon/__tests__/sdm-handlers.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS: the new pins, the moved assertions, and every test that was there, `agent-json.test.ts` and the tray reconnect's handler tests included, untouched.
Run: `grep -rn "sdm login\` and try\|Access request failed\|Connect failed:\|Login failed:\|Login timed out\|open -ga SDM\|did not become ready\|Tunnel is not reachable\|no local address for" lib/sdm`
Expected: no output.
Run: `bun run typecheck`
Expected: no errors. The `next` member is optional, so `lib/daemon/handlers/sdm.ts` and `lib/sdm/agent-json.ts` compile unchanged.

Now the e2e pin. Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/sdm-json.test.ts`
Expected: FAIL on exactly two values, both row 13's sentence: `status-logged-out`'s `stdout` (its `"message"`) and `connections-logged-out`'s `stdout` (its `"error"`). In `e2e/tests/fixtures/sdm-json.json`, edit those two by hand: inside each `stdout` string, replace ``StrongDM CLI is not authenticated: run `sdm login` and try again.`` with `Your StrongDM login has expired, or this Mac has not logged in yet.` and touch nothing else (no key, no exit code, no other entry). Never re-run with `RT_UPDATE_SDM_JSON`. Run the test again.
Expected: PASS. Any other difference means this task changed something it must not: fix the code, never the fixture.

- [ ] **Step 10: Commit**

```bash
git add lib/sdm/flow.ts lib/sdm/core.ts lib/sdm/app.ts lib/sdm/__tests__/flow.test.ts lib/sdm/__tests__/core-parsers.test.ts lib/sdm/__tests__/core-runner.test.ts lib/sdm/__tests__/app.test.ts e2e/tests/fixtures/sdm-json.json
```

```bash
git commit -m "sdm: plain words in the connect, status and connections envelopes, with the command apart from the hint

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `rt sdm`

One commit. The envelopes it must keep were pinned through the real binary in Task 7, before any sdm envelope string or verb changed.

**Files:**
- Modify: `commands/sdm.ts` (everything below the header comment except `getScan`, `toTarget` and `enrichmentSkeleton`)
- Create: `commands/__tests__/sdm.test.ts`
- Modify: `lib/sdm/__tests__/enrichment-cmd.test.ts`, `e2e/tests/sdm-enrichment.test.ts`, `e2e/tests/sdm-browser-login.test.ts:123, 126`
- Modify: `skills/rt-sdm-connect/SKILL.md:89, 149, 203, 206-211` (two digraph edge labels, two call notes)
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `commands/sdm.ts`)

**Interfaces:**
- Consumes: `withTransientStep(label, task)`, `StepHandle.clear()` and `out.note(...blocks)` (5a); `GuidedResult`'s failed member with `hint?` and `next?`, and the e2e pin `e2e/tests/sdm-json.test.ts` with its fixture (Task 7); `openStep(title): StepHandle` with `sub(text)` (`lib/ui/spawn.ts`); `interactive()` (imported as `atTerminal`, because `connectCmd` already has a local named `interactive`) and `__test__.setInteractive` (`lib/ui/gate.ts`); `logCliEvent(level, module, message, context?)` (`lib/cli-logger.ts`, phase 2); `out.print`, `out.fail(f, ...after)`, `out.json(value, indent)`, `out.banner`, `out.line`, `out.callout`, `out.kv`, `out.table`, `out.paragraph`, `out.verbatim`, `out.cmd`, `out.key`, `out.strong`, `out.dim`, `out.link`; the fake helper `lib/ui/__tests__/fake-rt-ui.ts` (its `steps` verb records every line it is sent, and `dieOn: "start"` makes it exit at the start event).
- Produces, all in `commands/sdm.ts` and reachable by tests through `export const __test__`:
  - `withProgress<T>(label: string, draw: boolean, task: (onLine: (line: string) => void) => Promise<T>): Promise<{ value: T; tail: string[] }>`
  - `excerpt(tail: string[]): Block[]`
  - `connectedBlocks(target, result)`, `statusBlocks(snapshot, appRunning)`, `connectionsBlocks(connections, resources)`, `refreshBlocks(count, error?)`, `enrichmentBlocks(path, enriched, total)`: each returns `Block[]`
  - `connectFailure(target, result)`, `healthFailure(health)`, `loginFailure(error, visible: boolean)`, `manualLoginFailure(reason)`, `appFailure(error)`: each returns `out.FailureInput`
  - `loginTip(visible: boolean): Block[]` (after a failed browser login that was not `--visible`, a `tip` naming the manual login; nothing after a `--visible` one)
  - `productionRefusal(target): Block[]` (a `refused` line and its two callouts, printed with `out.note`)
  - `redact(line: string): string` (the token in a StrongDM auth url becomes `<redacted>`)
  - `guidedConnect(target, opts)`

- [ ] **Step 1: Write the failing unit tests**

Create `commands/__tests__/sdm.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { logsDir } from "../../lib/rt-paths.ts";
import type { SdmConnection } from "../../lib/sdm/browse.ts";
import type { SdmHealth, SdmResourceState, SdmSnapshot } from "../../lib/sdm/core.ts";
import type { GuidedTarget } from "../../lib/sdm/flow.ts";
import { __test__ as gate } from "../../lib/ui/gate.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { connectCmd, loginCmd, __test__ } from "../sdm.ts";

// mock.module mutates the live namespace in place, so the real functions are kept before any mock.
const realApp = await import("../../lib/sdm/app.ts");
const realEnsureSdmApp = realApp.ensureSdmApp;
const realBrowserLogin = await import("../../lib/sdm/browser-login.ts");
const realRunBrowserLogin = realBrowserLogin.runBrowserLogin;

const FAKE = resolve(import.meta.dir, "..", "..", "lib", "ui", "__tests__", "fake-rt-ui.ts");
const target: GuidedTarget = { key: "demo:q", label: "Acme QA", sdmResource: "example-q", tier: "qa", db: { database: "acme", schema: "app" } };
const failed = (f: out.FailureInput): string => renderPlain([out.failure(f)]);

function cliLogLines(): Record<string, unknown>[] {
  const dir = logsDir();
  if (!existsSync(dir)) return [];
  const file = readdirSync(dir).filter((f) => f.startsWith("cli.") && f.endsWith(".log")).sort().at(-1);
  if (!file) return [];
  return readFileSync(join(dir, file), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("withProgress", () => {
  let dir: string;
  let record: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rt-sdm-progress-"));
    record = join(dir, "record.ndjson");
    process.env.RT_UI_BIN = FAKE;
    process.env.RT_UI_FAKE = JSON.stringify({ record });
    // bun test's stdin is never a TTY; each test says whether a person is there.
    gate.setInteractive(() => true);
  });
  afterEach(() => {
    gate.setInteractive(undefined);
    delete process.env.RT_UI_BIN;
    delete process.env.RT_UI_FAKE;
    rmSync(dir, { recursive: true, force: true });
  });

  const sent = () => readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));

  test("at a terminal the child's lines are sub-lines of a step that is cleared, and each reaches the log", async () => {
    const r = await __test__.withProgress("Connecting to Acme QA", true, async (onLine) => {
      onLine("dialing");
      onLine("tunnel up");
      return 7;
    });
    expect(r).toEqual({ value: 7, tail: ["dialing", "tunnel up"] });
    expect(sent()).toEqual([
      { t: "hello", protocol: 1 },
      { t: "start", title: "Connecting to Acme QA" },
      { t: "sub", text: "dialing" },
      { t: "sub", text: "tunnel up" },
      { t: "done", title: "Connecting to Acme QA", clear: true },
    ]);
    const logged = cliLogLines().filter((l) => l.module === "sdm").map((l) => [l.level, l.msg]);
    expect(logged.slice(-2)).toEqual([["debug", "dialing"], ["debug", "tunnel up"]]);
  });

  test("off a terminal no step is drawn, and the lines still come back and reach the log", async () => {
    gate.setInteractive(() => false);
    const r = await __test__.withProgress("Connecting to Acme QA", true, async (onLine) => {
      onLine("quiet line");
      return "ok";
    });
    expect(r).toEqual({ value: "ok", tail: ["quiet line"] });
    expect(existsSync(record)).toBe(false);
    expect(cliLogLines().filter((l) => l.module === "sdm").at(-1)?.msg).toBe("quiet line");
  });

  test("a caller that must stay quiet draws nothing even at a terminal", async () => {
    const r = await __test__.withProgress("Connecting to Acme QA", false, async () => 1);
    expect(r.value).toBe(1);
    expect(existsSync(record)).toBe(false);
  });

  test("a StrongDM auth url reaches the step, the tail and the log with its token redacted", async () => {
    const r = await __test__.withProgress("Logging in to StrongDM", true, async (onLine) => {
      onLine("open https://sdm.example/auth-confirm-native/tok123secret to finish");
      return null;
    });
    const redacted = "open https://sdm.example/auth-confirm-native/<redacted> to finish";
    expect(r.tail).toEqual([redacted]);
    expect(sent()).toContainEqual({ t: "sub", text: redacted });
    expect(cliLogLines().filter((l) => l.module === "sdm").at(-1)?.msg).toBe(redacted);
    expect(JSON.stringify(cliLogLines())).not.toContain("tok123secret");
  });

  test("logLine, which the terminal login calls directly, redacts the token too", () => {
    __test__.logLine("visit https://sdm.example/auth-confirm-native/tok456secret");
    expect(cliLogLines().filter((l) => l.module === "sdm").at(-1)?.msg).toBe("visit https://sdm.example/auth-confirm-native/<redacted>");
  });

  test("only the last five lines come back", async () => {
    gate.setInteractive(() => false);
    const r = await __test__.withProgress("x", true, async (onLine) => {
      for (const n of [1, 2, 3, 4, 5, 6, 7]) onLine(`line ${n}`);
      return null;
    });
    expect(r.tail).toEqual(["line 3", "line 4", "line 5", "line 6", "line 7"]);
  });

  test("a missing helper costs the step, never the task", async () => {
    process.env.RT_UI_BIN = join(dir, "no-such-binary");
    const r = await __test__.withProgress("Connecting to Acme QA", true, async (onLine) => {
      onLine("still works");
      return 3;
    });
    expect(r).toEqual({ value: 3, tail: ["still works"] });
  });

  test("a helper that dies mid-step does not fail the task", async () => {
    process.env.RT_UI_FAKE = JSON.stringify({ record, dieOn: "start" });
    const r = await __test__.withProgress("Connecting to Acme QA", true, async (onLine) => {
      await Bun.sleep(50);
      onLine("after the helper died");
      return 4;
    });
    expect(r).toEqual({ value: 4, tail: ["after the helper died"] });
  });

  test("a task that throws still clears its step", async () => {
    await expect(
      __test__.withProgress("Connecting to Acme QA", true, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(sent().at(-1)).toEqual({ t: "done", title: "Connecting to Acme QA", clear: true });
  });
});

describe("sdm blocks", () => {
  const verified = { ok: true, attempts: 1, latencyMs: 42, lastError: null };

  test("a verified connect is two done lines", () => {
    const text = renderPlain(__test__.connectedBlocks(target, { outcome: "connected", address: "127.0.0.1:15432", verify: verified }));
    expect(text).toBe("[ok] Acme QA is ready  127.0.0.1:15432 (acme/app)\n[ok] A test query worked  42ms, 1 attempt\n");
  });

  test("an unconfirmed tunnel is a warning with what to do, never a failure", () => {
    const text = renderPlain(
      __test__.connectedBlocks({ ...target, db: undefined }, { outcome: "connected", address: "127.0.0.1:15432", unverified: true, verify: { ok: false, attempts: 5, latencyMs: null, lastError: new Error("Connection closed") } }),
    );
    expect(text).toBe(
      "[ok] Acme QA is ready  127.0.0.1:15432\n" +
        "[warning] The tunnel is up, but a test query did not confirm it  Connection closed\n" +
        "  note: It is likely usable. Try your query again, and reconnect if it keeps failing.\n",
    );
  });

  test("a failed connect names the stage in plain words and the command the flow gave", () => {
    expect(failed(__test__.connectFailure(target, { outcome: "failed", stage: "health", error: "StrongDM did not answer." }))).toBe(
      "StrongDM is not available on this Mac\n  why: StrongDM did not answer.\n",
    );
    expect(failed(__test__.connectFailure(target, { outcome: "failed", stage: "login", error: "StrongDM says you are not logged in." }))).toBe(
      "You are not logged in to StrongDM\n  why: StrongDM says you are not logged in.\n  next: rt sdm login\n",
    );
    expect(failed(__test__.connectFailure(target, { outcome: "failed", stage: "connect", error: "no route to gateway", hint: "Log in to StrongDM again, then connect.", next: "rt sdm login" }))).toBe(
      "Could not connect to Acme QA\n  why: no route to gateway\n  next: rt sdm login\n",
    );
    expect(failed(__test__.connectFailure(target, { outcome: "failed", stage: "access", error: "denied", hint: "Check the connection name, or ask for access with a reason." }))).toBe(
      "Could not get access to Acme QA\n  why: denied\n  Check the connection name, or ask for access with a reason.\n",
    );
    expect(
      failed(__test__.connectFailure(target, { outcome: "failed", stage: "verify", error: "The tunnel did not answer: timeout", hint: "Connect again, or check this connection in the StrongDM app.", next: "rt sdm connect demo:q" })),
    ).toBe("Acme QA did not come up\n  why: The tunnel did not answer: timeout\n  next: rt sdm connect demo:q\n");
  });

  test("only a login that needs a person names the manual login on its next: line", () => {
    expect(failed(__test__.manualLoginFailure("No Chrome or Chromium browser found."))).toBe(
      "StrongDM needs you to log in by hand\n  why: No Chrome or Chromium browser found.\n  next: rt sdm login --manual\n",
    );
    // A silent login that failed: watch it next, with the manual login as a tip, never on the next: line.
    const silent = renderPlain([out.failure(__test__.loginFailure("The login did not finish.", false)), ...__test__.loginTip(false)]);
    expect(silent).toBe(
      "Could not log in to StrongDM\n  why: The login did not finish.\n  next: rt sdm login --visible\n  tip: If the browser login keeps failing, log in by hand: rt sdm login --manual\n",
    );
    expect(silent).not.toContain("next: rt sdm login --manual");
    // A watched login that failed: the manual login is what is left.
    expect(failed(__test__.loginFailure("The login did not finish.", true))).toBe(
      "Could not log in to StrongDM\n  why: The login did not finish.\n  next: rt sdm login --manual\n",
    );
    expect(__test__.loginTip(true)).toEqual([]);
  });

  const snapshot = (status: SdmHealth["status"], resources: Array<[string, SdmResourceState]> = []): SdmSnapshot => ({
    health: { status, message: status === "ok" ? null : "boom" },
    resources: new Map(resources),
  });

  test("status: a tunnel is a running row, a stopped app is off, and nothing is coral", () => {
    const text = renderPlain(
      __test__.statusBlocks(
        snapshot("ok", [
          ["example-q", { connected: true, address: "127.0.0.1:15432", expiry: "5h" }],
          ["example-d", { connected: false, address: null, expiry: null }],
        ]),
        false,
      ),
    );
    expect(text).toBe(
      "[off] The StrongDM app is not running  rt starts it when you connect\n" +
        "[ok] Logged in to StrongDM\n" +
        "[running] example-q  127.0.0.1:15432, until 5h\n",
    );
    expect(renderPlain(__test__.statusBlocks(snapshot("ok"), true))).toBe("[ok] Logged in to StrongDM\n[off] No tunnels open\n");
  });

  test("status: not logged in waits on the person, a missing CLI is not yet, only a dead CLI is a failure", () => {
    expect(renderPlain(__test__.statusBlocks(snapshot("not-authenticated"), true))).toBe("[needs you] You are not logged in to StrongDM\n  next: rt sdm login\n");
    expect(renderPlain(__test__.statusBlocks(snapshot("not-installed"), true))).toBe(
      "[not yet] The StrongDM CLI is not installed\n  note: Install it from strongdm.com/docs/cli (https://www.strongdm.com/docs/cli/)\n",
    );
    expect(renderPlain(__test__.statusBlocks(snapshot("error"), true))).toBe("[failed] StrongDM is not answering  boom\n");
  });

  test("connections is one table: state, label, tier, key", () => {
    const conn = (key: string, label: string, tier?: string, standingAccess = false): SdmConnection => ({ key, label, sdmResource: `example-${key}`, tier, standingAccess });
    const text = renderPlain(
      __test__.connectionsBlocks(
        [conn("demo:q", "Acme QA", "qa"), conn("demo:s", "Acme Staging", "staging", true), conn("demo:d", "Dev")],
        new Map([["example-demo:q", { connected: true, address: "127.0.0.1:15432", expiry: null }]]),
      ),
    );
    const cols = (cells: string[]): string => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd([15, 12, 7][i]!))).join("  ");
    expect(text).toBe(
      cols(["connected", "Acme QA", "qa", "demo:q"]) + "\n" + cols(["standing access", "Acme Staging", "staging", "demo:s"]) + "\n" + cols(["on request", "Dev", "", "demo:d"]) + "\n",
    );
    expect(renderPlain(__test__.connectionsBlocks([], new Map()))).toBe("[skipped] No StrongDM connections to show\n  next: rt sdm refresh\n");
  });

  test("refresh says how many it found, and a scan problem is a warning above the count", () => {
    expect(renderPlain(__test__.refreshBlocks(3))).toBe("[ok] Found 3 StrongDM connections\n");
    expect(renderPlain(__test__.refreshBlocks(0))).toBe("[skipped] Found 0 StrongDM connections  check your StrongDM access\n");
    expect(renderPlain(__test__.refreshBlocks(1, "timed out"))).toBe("[warning] The scan had a problem  timed out\n[ok] Found 1 StrongDM connection\n");
  });

  test("enrichment shows the file and how many connections have a label", () => {
    expect(renderPlain(__test__.enrichmentBlocks("/x/enrichment.jsonc", 0, 2))).toBe(
      "labels file: /x/enrichment.jsonc\n[not yet] 0 of 2 connections have a label  the rest show their StrongDM names\n",
    );
    expect(renderPlain(__test__.enrichmentBlocks("/x/enrichment.jsonc", 2, 2))).toBe("labels file: /x/enrichment.jsonc\n[ok] 2 of 2 connections have a label\n");
    expect(renderPlain(__test__.enrichmentBlocks("/x/enrichment.jsonc", 0, 0))).toBe("labels file: /x/enrichment.jsonc\n[skipped] StrongDM shows no connections to label\n");
  });
});

describe("sdm verbs", () => {
  let io: ReturnType<typeof captureOut>;

  beforeEach(() => {
    io = captureOut();
    out.__test__.setHuman(() => false);
  });
  afterEach(() => {
    io.restore();
    // The verbs report through process.exitCode; a value left behind would fail the whole run.
    process.exitCode = 0;
  });

  test("connect with --json and no key writes the same envelope", async () => {
    await connectCmd(["--json"]);
    expect(io.stdout()).toBe(
      '{\n  "ok": false,\n  "stage": "health",\n  "error": "a connection key is required with --json",\n  "hint": "rt sdm connections --json lists valid keys"\n}\n',
    );
    expect(io.stderr()).toBe("");
    expect(process.exitCode).toBe(1);
  });

  test("a production connect from a script is refused on stderr and stdout stays empty", async () => {
    await __test__.guidedConnect({ ...target, production: true }, { interactive: false });
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe(
      "[refused] Acme QA is a production connection\n  why: A person has to say yes to a production connection.\n  next: rt sdm connect demo:q --confirm-production\n",
    );
    expect(process.exitCode).toBe(1);
  });

  test("the same refusal under --json is the envelope on stdout and nothing on stderr", async () => {
    await __test__.guidedConnect({ ...target, production: true }, { interactive: false, json: true });
    expect(io.stdout()).toBe(
      '{\n  "ok": false,\n  "stage": "confirm",\n  "error": "Acme QA is a production resource; a human must approve. Re-run with --confirm-production.",\n  "hint": null\n}\n',
    );
    expect(io.stderr()).toBe("");
    expect(process.exitCode).toBe(1);
  });

  test("a failure's excerpt is the last five child lines, indented", () => {
    out.fail(__test__.connectFailure(target, { outcome: "failed", stage: "connect", error: "exit 1" }), ...__test__.excerpt(["dialing", "\x1b[2J[ok] forged", "gave up"]));
    expect(io.stderr()).toBe("Could not connect to Acme QA\n  why: exit 1\n  dialing\n  [ok] forged\n  gave up\n");
    expect(__test__.excerpt([])).toEqual([]);
  });

  test("a failed browser login never shows the auth url's token, in the why or anywhere on stderr", async () => {
    mock.module("../../lib/sdm/app.ts", () => ({ ...realApp, ensureSdmApp: async () => ({ ok: true }) }));
    mock.module("../../lib/sdm/browser-login.ts", () => ({
      ...realBrowserLogin,
      runBrowserLogin: async () => ({ outcome: "failed", error: "sdm login exited unsuccessfully: open https://sdm.example/auth-confirm-native/tok999secret to finish" }),
    }));
    try {
      await loginCmd([]);
      expect(io.stderr()).toContain("  why: sdm login exited unsuccessfully: open https://sdm.example/auth-confirm-native/<redacted> to finish\n");
      expect(io.stderr()).not.toContain("tok999secret");
      expect(io.stdout()).not.toContain("tok999secret");
      expect(process.exitCode).toBe(1);
    } finally {
      mock.module("../../lib/sdm/app.ts", () => ({ ...realApp, ensureSdmApp: realEnsureSdmApp }));
      mock.module("../../lib/sdm/browser-login.ts", () => ({ ...realBrowserLogin, runBrowserLogin: realRunBrowserLogin }));
    }
  });

  test("redact covers the upper-case and url-encoded forms and stops at a quote", () => {
    expect(__test__.redact("https://sdm.example/AUTH-CONFIRM-NATIVE/Tok1")).toBe("https://sdm.example/AUTH-CONFIRM-NATIVE/<redacted>");
    expect(__test__.redact("next=https%3A%2F%2Fsdm.example%2Fauth-confirm-native%2Ftok2&x=1")).toBe("next=https%3A%2F%2Fsdm.example%2Fauth-confirm-native%2F<redacted>");
    expect(__test__.redact("next=https%3a%2f%2fsdm.example%2fAuth-Confirm-Native%2ftok3")).toBe("next=https%3a%2f%2fsdm.example%2fAuth-Confirm-Native%2f<redacted>");
    expect(__test__.redact('href="https://sdm.example/auth-confirm-native/tok4">')).toBe('href="https://sdm.example/auth-confirm-native/<redacted>">');
  });

  test("a failure's excerpt never shows an auth url's token", () => {
    expect(renderPlain(__test__.excerpt(["https://sdm.example/auth-confirm-native/tok789secret"]))).toBe("  https://sdm.example/auth-confirm-native/<redacted>\n");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run (repo root): `bun test commands/__tests__/sdm.test.ts`
Expected: FAIL. `__test__` is not exported by `commands/sdm.ts`.

- [ ] **Step 3: Convert `commands/sdm.ts`**

Keep the header comment (lines 1 to 13). Replace the import block (lines 15 to 37) with:

```ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { logCliEvent } from "../lib/cli-logger.ts";
import type { CommandContext } from "../lib/command-tree.ts";
import {
  connectResource,
  fetchAccessCatalog,
  getSdmSnapshot,
  loginSdm,
  requestAccess,
  resourceNeedsAccessRequest,
  SDM_DURATIONS,
  SDM_INSTALL_URL,
  type SdmHealth,
  type SdmResourceState,
  type SdmSnapshot,
} from "../lib/sdm/core.ts";
import { scanSdmResources, type SdmResource } from "../lib/sdm/scan.ts";
import { buildSdmConnections, type SdmConnection } from "../lib/sdm/browse.ts";
import { loadEnrichment, probeEnrichmentStore } from "../lib/sdm/enrichment.ts";
import { buildConnectionsJson, buildConnectionsRefusal, buildConnectJson, buildProductionRefusal, buildStatusJson, shouldRefuseProduction } from "../lib/sdm/agent-json.ts";
import { loadSdmState, recordRecent, type RecentEntry } from "../lib/sdm/state.ts";
import { runGuidedConnect, type GuidedResult, type GuidedTarget } from "../lib/sdm/flow.ts";
import { probeQuery, probeTunnel, verifyWithRetries, VERIFY_ATTEMPT_TIMEOUT_MS } from "../lib/sdm/verify.ts";
import { buildPickerOptions } from "../lib/sdm/picker.ts";
import { ensureSdmApp, isSdmAppRunning } from "../lib/sdm/app.ts";
import { interactive as atTerminal } from "../lib/ui/gate.ts";
import * as out from "../lib/ui/out.ts";
import type { Block, Segment } from "../lib/ui/protocol.ts";
import { openStep, type StepHandle } from "../lib/ui/spawn.ts";
import { withTransientStep } from "../lib/ui/transient-step.ts";
```

`getScan` (lines 42 to 57) stays as it is.

Replace everything from the `// ── Guided flow wiring` banner (line 59) through the end of `guidedConnect` (line 178) with:

```ts
// ── Progress: child output under a step, kept in the log ─────────────────────

const TAIL_KEPT = 5;

// `sdm login` prints a one-time auth url; the log, a failure's excerpt and its why outlive the login.
const AUTH_TOKEN = /(auth-confirm-native(?:\/|%2F))[^\s"'<>]+/gi;

function redact(line: string): string {
  return line.replace(AUTH_TOKEN, "$1<redacted>");
}

function logLine(line: string): void {
  logCliEvent("debug", "sdm", redact(line));
}

// The step only narrates; a helper that cannot start leaves the task to run unwatched.
function tryOpenStep(label: string): StepHandle | null {
  try {
    return openStep(label);
  } catch {
    return null;
  }
}

/**
 * Runs a task that streams child output. At a terminal the lines sit under a
 * step that is erased when the task settles; every line reaches the rt log,
 * and the last few come back so a failure can show them. No prompt and no
 * child that owns the terminal may run inside the task: the step is drawing.
 */
async function withProgress<T>(label: string, draw: boolean, task: (onLine: (line: string) => void) => Promise<T>): Promise<{ value: T; tail: string[] }> {
  const tail: string[] = [];
  const step = draw && atTerminal() ? tryOpenStep(label) : null;
  const onLine = (raw: string): void => {
    const line = redact(raw);
    logLine(line);
    tail.push(line);
    if (tail.length > TAIL_KEPT) tail.shift();
    step?.sub(line);
  };
  try {
    return { value: await task(onLine), tail };
  } finally {
    await step?.clear();
  }
}

function excerpt(tail: string[]): Block[] {
  return tail.length > 0 ? [out.verbatim(tail.map(redact))] : [];
}

// ── What each outcome reads as ───────────────────────────────────────────────

const MANUAL_NOTE = "Logging in here instead. Answer its questions; your browser opens to finish.";
const INSTALL_LINK = out.link("strongdm.com/docs/cli", SDM_INSTALL_URL);

function appFailure(error: string | undefined): out.FailureInput {
  return { title: "The StrongDM app did not start", why: error };
}

// The sdm skill hands the manual login to the person when a `next:` line
// names it, and never runs --visible; a silent failure keeps it in a tip.
function loginFailure(error: string | undefined, visible: boolean): out.FailureInput {
  return { title: "Could not log in to StrongDM", why: error, next: out.cmd(visible ? "rt sdm login --manual" : "rt sdm login --visible") };
}

function loginTip(visible: boolean): Block[] {
  return visible ? [] : [out.callout("tip", ["If the browser login keeps failing, log in by hand: ", out.cmd("rt sdm login --manual")])];
}

function manualLoginFailure(reason: string): out.FailureInput {
  return { title: "StrongDM needs you to log in by hand", why: reason, next: out.cmd("rt sdm login --manual") };
}

function productionRefusal(target: GuidedTarget): Block[] {
  return [
    out.line("refused", `${target.label} is a production connection`),
    out.callout("why", "A person has to say yes to a production connection."),
    out.callout("next", out.cmd(`rt sdm connect ${target.key} --confirm-production`)),
  ];
}

function healthFailure(health: SdmHealth): out.FailureInput {
  if (health.status === "not-authenticated") return { title: "You are not logged in to StrongDM", next: out.cmd("rt sdm login") };
  if (health.status === "not-installed") return { title: "The StrongDM CLI is not installed", details: `Install it from ${SDM_INSTALL_URL}` };
  return { title: "StrongDM is not answering", why: health.message ?? undefined };
}

type FailedConnect = Extract<GuidedResult, { outcome: "failed" }>;

const STAGE_TITLE: Record<FailedConnect["stage"], (label: string) => string> = {
  health: () => "StrongDM is not available on this Mac",
  login: () => "You are not logged in to StrongDM",
  access: (label) => `Could not get access to ${label}`,
  connect: (label) => `Could not connect to ${label}`,
  verify: (label) => `${label} did not come up`,
};

function connectFailure(target: GuidedTarget, result: FailedConnect): out.FailureInput {
  const next = result.next ?? (result.stage === "login" ? "rt sdm login" : undefined);
  return {
    title: STAGE_TITLE[result.stage](target.label),
    why: result.error,
    next: next ? out.cmd(next) : undefined,
    details: next ? undefined : result.hint,
  };
}

const ABORTED: Record<string, string> = {
  "login declined": "you chose not to log in",
  "production connect declined": "the name you typed did not match",
};

function connectedBlocks(target: GuidedTarget, result: Extract<GuidedResult, { outcome: "connected" }>): Block[] {
  const db = target.db ? ` (${target.db.database ?? "postgres"}/${target.db.schema ?? "public"})` : "";
  const blocks: Block[] = [out.line("done", `${target.label} is ready`, `${result.address}${db}`)];
  if (result.unverified) {
    blocks.push(out.line("warn", "The tunnel is up, but a test query did not confirm it", result.verify.lastError?.message ?? "unknown"));
    blocks.push(out.callout("note", "It is likely usable. Try your query again, and reconnect if it keeps failing."));
  } else {
    blocks.push(out.line("done", "A test query worked", `${result.verify.latencyMs}ms, ${result.verify.attempts} attempt${result.verify.attempts === 1 ? "" : "s"}`));
  }
  return blocks;
}

function healthBlocks(health: SdmHealth): Block[] {
  if (health.status === "not-authenticated") return [out.line("needs-you", "You are not logged in to StrongDM"), out.callout("next", out.cmd("rt sdm login"))];
  if (health.status === "not-installed") return [out.line("pending", "The StrongDM CLI is not installed"), out.callout("note", ["Install it from ", INSTALL_LINK])];
  return [out.line("failed", "StrongDM is not answering", health.message ?? undefined)];
}

function statusBlocks(snapshot: SdmSnapshot, appRunning: boolean): Block[] {
  const blocks: Block[] = [];
  if (!appRunning) blocks.push(out.line("off", "The StrongDM app is not running", "rt starts it when you connect"));
  if (snapshot.health.status !== "ok") return [...blocks, ...healthBlocks(snapshot.health)];
  blocks.push(out.line("done", "Logged in to StrongDM"));
  const connected = [...snapshot.resources.entries()].filter(([, s]) => s.connected);
  if (connected.length === 0) return [...blocks, out.line("off", "No tunnels open")];
  for (const [name, s] of connected) {
    const where = [s.address, s.expiry ? `until ${s.expiry}` : null].filter((part): part is string => Boolean(part)).join(", ");
    blocks.push(out.line("running", name, where || undefined));
  }
  return blocks;
}

function connectionsBlocks(connections: SdmConnection[], resources: Map<string, SdmResourceState>): Block[] {
  if (connections.length === 0) return [out.line("skipped", "No StrongDM connections to show"), out.callout("next", out.cmd("rt sdm refresh"))];
  return [
    out.table(
      connections.map((c) => {
        const state: Segment = resources.get(c.sdmResource)?.connected
          ? { text: "connected", role: "running" }
          : c.standingAccess
            ? { text: "standing access", role: "done" }
            : out.dim("on request");
        return [state, out.strong(c.label), out.dim(c.tier ?? ""), out.key(c.key)];
      }),
    ),
  ];
}

function refreshBlocks(count: number, error?: string): Block[] {
  const blocks: Block[] = [];
  if (error) blocks.push(out.line("warn", "The scan had a problem", error));
  blocks.push(out.line(count > 0 ? "done" : "skipped", `Found ${count} StrongDM connection${count === 1 ? "" : "s"}`, count === 0 && !error ? "check your StrongDM access" : undefined));
  return blocks;
}

function enrichmentBlocks(path: string, enriched: number, total: number): Block[] {
  if (total === 0) return [out.kv("labels file", path), out.line("skipped", "StrongDM shows no connections to label")];
  const all = enriched === total;
  return [out.kv("labels file", path), out.line(all ? "done" : "pending", `${enriched} of ${total} connections have a label`, all ? undefined : "the rest show their StrongDM names")];
}

// ── Guided flow wiring (real prompts, real sdm) ──────────────────────────────

interface LoginResult {
  ok: boolean;
  error?: string;
  tail: string[];
}

/**
 * Log in to StrongDM: the browser popup first, then the terminal login when
 * the popup cannot run. The terminal login owns the terminal, so the step is
 * closed before it starts.
 */
async function sdmBrowserLogin(label: string): Promise<LoginResult> {
  const { runBrowserLogin } = await import("../lib/sdm/browser-login.ts");
  const { value: r, tail } = await withProgress(label, true, (onLine) => runBrowserLogin({ onLine }));
  if (r.outcome === "authenticated") return { ok: true, tail };
  if (r.outcome === "needs-manual") {
    if (!process.stdin.isTTY) return { ok: false, error: redact(r.reason), tail };
    out.print(out.line("warn", "The browser login could not run", redact(r.reason)), out.callout("note", MANUAL_NOTE));
    return { ...(await loginSdm(logLine)), tail };
  }
  return { ok: false, error: r.error && redact(r.error), tail };
}

/**
 * Auth-first guard for the picker. An expired StrongDM session means the
 * scan cannot list resources (you would see only recents), so log in
 * before scanning, with no confirm. Returns true when a login happened, so
 * the caller can bust the stale cache.
 */
async function ensureSdmAuth(): Promise<boolean> {
  const snapshot = await getSdmSnapshot();
  if (snapshot.health.status !== "not-authenticated") return false;
  const r = await sdmBrowserLogin("Your StrongDM session expired, logging in");
  if (r.ok) {
    out.print(out.line("done", "Logged in to StrongDM"));
    return true;
  }
  out.print(
    out.line("warn", "Could not log in to StrongDM", "showing your recent connections only"),
    out.callout("why", redact(r.error ?? "unknown")),
    out.callout("next", out.cmd("rt sdm login --manual")),
  );
  return false;
}

async function guidedConnect(
  target: GuidedTarget,
  opts: { duration?: string; reason?: string; interactive: boolean; json?: boolean; confirmProduction?: boolean },
): Promise<void> {
  // The guard lives here, not in runGuidedConnect: the daemon's tray-driven
  // reconnect is also non-interactive but a tray click is a human action.
  if (shouldRefuseProduction(target, opts)) {
    if (opts.json) out.json(buildProductionRefusal(target), 2);
    else out.note(...productionRefusal(target));
    process.exitCode = 1;
    return;
  }
  const { select, textInput, confirm } = await import("../lib/rt-render.ts");
  let tail: string[] = [];
  const streamed = async <T>(label: string, task: (onLine: (line: string) => void) => Promise<T>): Promise<T> => {
    const r = await withProgress(label, !opts.json, task);
    tail = r.tail;
    return r.value;
  };
  const result = await runGuidedConnect(target, opts, {
    getSnapshot: f => getSdmSnapshot(f),
    needsAccessRequest: async resource => {
      const catalog = await fetchAccessCatalog();
      return catalog.ok ? resourceNeedsAccessRequest(catalog.output, resource) : false;
    },
    requestAccess: (resource, duration, reason) => streamed(`Asking for access to ${target.label}`, onLine => requestAccess(resource, duration, reason, onLine)),
    connect: resource => streamed(`Connecting to ${target.label}`, onLine => connectResource(resource, onLine)),
    verify: url => verifyWithRetries(() => probeQuery(url, VERIFY_ATTEMPT_TIMEOUT_MS)),
    probeTunnel: address => {
      const i = address.lastIndexOf(":");
      return probeTunnel(address.slice(0, i), Number(address.slice(i + 1)));
    },
    login: async () => {
      const r = await sdmBrowserLogin("Logging in to StrongDM");
      tail = r.tail;
      return { ok: r.ok, error: r.error };
    },
    promptDuration: async def => {
      const all = SDM_DURATIONS.map(value => {
        const hours = Number.parseInt(value, 10);
        return { value, label: `${hours} hour${hours === 1 ? "" : "s"}` };
      });
      // select() has no initialValue option; ordering puts the default first.
      const options = [...all.filter(o => o.value === def), ...all.filter(o => o.value !== def)];
      return select({ message: "Access duration", options });
    },
    promptReason: async def => textInput({ message: "Reason (org-visible)", defaultValue: def }),
    confirmProduction: async t => {
      out.print(out.banner("PRODUCTION", t.label, "type its name to connect"));
      const input = await textInput({ message: `Type "${t.label}" to confirm` });
      return input.trim() === t.label;
    },
    confirmLogin: async () => confirm({ message: "StrongDM is not authenticated. Run sdm login now?", initialValue: true }),
    onLine: logLine,
    recordRecent: t =>
      void recordRecent({
        key: t.key, label: t.label, sdmResource: t.sdmResource,
        tier: t.tier, production: t.production, reasonSuggestion: t.reasonSuggestion, db: t.db,
      }),
  });

  if (opts.json) {
    const { json, exitCode } = buildConnectJson(target, result);
    out.json(json, 2);
    process.exitCode = exitCode;
    return;
  }
  if (result.outcome === "connected") {
    out.print(...connectedBlocks(target, result));
    return;
  }
  if (result.outcome === "aborted") {
    out.print(out.line("skipped", "Not connected", ABORTED[result.reason] ?? result.reason));
    process.exitCode = 1;
    return;
  }
  out.fail(connectFailure(target, result), ...excerpt(tail));
  process.exitCode = 1;
}
```

`toTarget` (lines 180 to 186) stays as it is.

Replace everything from the `// ── Subcommands` banner (line 188) through the end of `refreshCmd` (line 426) with:

```ts
// ── Subcommands ──────────────────────────────────────────────────────────────

async function pickAndConnect(): Promise<void> {
  if (!process.stdin.isTTY) {
    out.fail({ title: "Picking a connection needs a terminal", why: "A script names the connection it wants.", next: out.cmd("rt sdm connect <key>") });
    process.exitCode = 1;
    return;
  }
  const app = await withProgress("Checking the StrongDM app", true, onLine => ensureSdmApp(onLine));
  if (!app.value.ok) {
    out.fail(appFailure(app.value.error), ...excerpt(app.tail));
    process.exitCode = 1;
    return;
  }
  // Auth-first: an expired session lists nothing (only recents), so log in
  // before scanning. Refresh the scan when we just logged in, since a stale
  // cache from the logged-out run would still be empty.
  const loggedIn = await ensureSdmAuth();
  const { resources, error } = await withTransientStep("Scanning StrongDM", () => getScan(loggedIn));
  const recents = loadSdmState().recents;

  if (error) out.print(out.line("warn", "The StrongDM scan had a problem", error));
  if (resources.length === 0 && recents.length === 0) {
    out.print(
      out.line("skipped", "No StrongDM connections found"),
      out.paragraph("rt reads your StrongDM catalog directly, so there is nothing to set up. Check that you are logged in and can reach at least one database."),
      out.callout("tip", ["Nicer names for your connections: ", out.cmd("rt sdm enrichment init")]),
      out.callout("note", ["The StrongDM CLI comes from ", INSTALL_LINK]),
    );
    return;
  }

  const connections = buildSdmConnections(resources, loadEnrichment());
  // Live connection state for the "● connected" badge: a fresh sdm status
  // snapshot (not the cached scan), so the picker reflects active tunnels now.
  const snapshot = await getSdmSnapshot();
  const connected = new Set(
    [...snapshot.resources].filter(([, s]) => s.connected).map(([name]) => name),
  );
  const { runNavPicker } = await import("../lib/navigate.ts");
  const options = buildPickerOptions(connections, recents, connected);
  const picked = await runNavPicker({
    options,
    message: "sdm connections",
    breadcrumb: ["rt", "sdm", "connections"],
    crumbSuffix: "  ● connected   ✓ standing access",
  });
  if (!picked || !picked.value) return;

  const target =
    connections.find(c => c.key === picked.value) ??
    recents.find(r => r.key === picked.value);
  if (!target) {
    out.fail({ title: "That connection is no longer in the list", next: out.cmd("rt sdm refresh") });
    process.exitCode = 1;
    return;
  }
  await guidedConnect(toTarget(target), { interactive: true });
}

/**
 * `rt sdm connect` with no key opens the connection picker; `rt sdm connect
 * <key> [--duration 8h] [--reason "..."]` connects directly (scriptable).
 */
export async function connectCmd(rest: string[], _ctx?: CommandContext): Promise<void> {
  const flags: { duration?: string; reason?: string; json?: boolean; confirmProduction?: boolean } = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--duration") flags.duration = rest[++i];
    else if (arg === "--reason") flags.reason = rest[++i];
    else if (arg.startsWith("--duration=")) flags.duration = arg.slice("--duration=".length);
    else if (arg.startsWith("--reason=")) flags.reason = arg.slice("--reason=".length);
    else if (arg === "--json") flags.json = true;
    else if (arg === "--confirm-production") flags.confirmProduction = true;
    else positional.push(arg);
  }
  const key = positional[0];
  if (!key) {
    if (flags.json) {
      out.json({ ok: false, stage: "health", error: "a connection key is required with --json", hint: "rt sdm connections --json lists valid keys" }, 2);
      process.exitCode = 1;
      return;
    }
    return pickAndConnect();
  }
  const app = await withProgress("Checking the StrongDM app", !flags.json, onLine => ensureSdmApp(onLine));
  if (!app.value.ok) {
    if (flags.json) out.json({ ok: false, stage: "health", error: app.value.error, hint: null }, 2);
    else out.fail(appFailure(app.value.error), ...excerpt(app.tail));
    process.exitCode = 1;
    return;
  }
  const { resources } = await getScan();
  const connections = buildSdmConnections(resources, loadEnrichment());
  const target =
    connections.find(c => c.key === key) ??
    loadSdmState().recents.find(r => r.key === key);
  if (!target) {
    if (flags.json) out.json({ ok: false, stage: "health", error: `unknown connection key: ${key}`, hint: "rt sdm connections --json lists valid keys; rt sdm refresh re-discovers" }, 2);
    else out.fail({ title: `rt does not know a connection called ${key}`, why: "The list may be out of date.", next: out.cmd("rt sdm refresh") });
    process.exitCode = 1;
    return;
  }
  // --json is an agent calling: never prompt. Otherwise a TTY with both
  // flags provided still short-circuits the prompts, as before.
  const interactive = !flags.json && process.stdin.isTTY && !(flags.duration && flags.reason);
  await guidedConnect(toTarget(target), { ...flags, interactive });
}

/**
 * `rt sdm connections [--json]`: the discovery half of the agent contract.
 * Refuses (ok:false, exit 1) when the scan cannot run; an empty list must
 * mean "you truly have no resources", never "we could not look".
 */
export async function connectionsCmd(rest: string[]): Promise<void> {
  const json = rest.includes("--json");
  const snapshot = await getSdmSnapshot();
  if (snapshot.health.status !== "ok") {
    if (json) out.json(buildConnectionsRefusal(snapshot.health), 2);
    else out.fail(healthFailure(snapshot.health));
    process.exitCode = 1;
    return;
  }
  const { resources, error } = await getScan();
  if (error) {
    if (json) out.json(buildConnectionsRefusal(snapshot.health, error), 2);
    else out.fail({ title: "Could not read your StrongDM connections", why: error });
    process.exitCode = 1;
    return;
  }
  const connections = buildSdmConnections(resources, loadEnrichment());
  if (json) {
    out.json(buildConnectionsJson(connections, snapshot.resources), 2);
    return;
  }
  out.print(...connectionsBlocks(connections, snapshot.resources));
}

export async function statusCmd(rest: string[] = []): Promise<void> {
  const json = rest.includes("--json");
  const [snapshot, appRunning] = await Promise.all([getSdmSnapshot(true), isSdmAppRunning()]);
  if (json) {
    const { json: body, exitCode } = buildStatusJson(snapshot, appRunning);
    out.json(body, 2);
    process.exitCode = exitCode;
    return;
  }
  out.print(...statusBlocks(snapshot, appRunning));
  if (snapshot.health.status !== "ok") process.exitCode = 1;
}

async function runManualLogin(): Promise<void> {
  const r = await loginSdm(logLine);
  if (r.ok) {
    out.print(out.line("done", "Logged in to StrongDM"));
    return;
  }
  out.fail({ title: "Could not log in to StrongDM", why: r.error });
  process.exitCode = 1;
}

export async function loginCmd(args: string[]): Promise<void> {
  const manual = args.includes("--manual");
  const visible = args.includes("--visible");

  if (manual) {
    if (!process.stdin.isTTY) {
      out.fail({ title: "This login needs a terminal", why: "It asks questions and opens your browser, so a script cannot run it." });
      process.exitCode = 1;
      return;
    }
    out.print(out.line("running", "Starting the StrongDM login", "answer its questions here; your browser opens to finish"));
    await runManualLogin();
    return;
  }

  const app = await withProgress("Checking the StrongDM app", true, onLine => ensureSdmApp(onLine));
  if (!app.value.ok) {
    out.fail(appFailure(app.value.error), ...excerpt(app.tail));
    process.exitCode = 1;
    return;
  }

  const { runBrowserLogin } = await import("../lib/sdm/browser-login.ts");
  const label = visible ? "Logging in to StrongDM, a browser window will show" : "Logging in to StrongDM";
  const login = await withProgress(label, true, onLine => runBrowserLogin({ visible, onLine }));
  const outcome = login.value;
  if (outcome.outcome === "authenticated") {
    out.print(out.line("done", "Logged in to StrongDM"));
    return;
  }
  if (outcome.outcome === "needs-manual") {
    if (!process.stdin.isTTY) {
      // With no terminal the terminal login cannot run, so this names the
      // command for the person instead of claiming a fallback.
      out.fail(manualLoginFailure(redact(outcome.reason)));
      process.exitCode = 1;
      return;
    }
    out.print(out.line("warn", "The browser login could not run", redact(outcome.reason)), out.callout("note", MANUAL_NOTE));
    await runManualLogin();
    return;
  }
  out.fail(loginFailure(redact(outcome.error), visible), ...excerpt(login.tail), ...loginTip(visible));
  process.exitCode = 1;
}

export async function refreshCmd(): Promise<void> {
  const { resources, error } = await getScan(true);
  out.print(...refreshBlocks(resources.length, error));
}
```

`enrichmentSkeleton` and its doc comment stay as they are. Replace the body of `enrichmentCmd` (its doc comment stays) and add the test seam at the end of the file:

```ts
export async function enrichmentCmd(rest: string[]): Promise<void> {
  const { enrichmentPath, loadEnrichment } = await import("../lib/sdm/enrichment.ts");
  const path = enrichmentPath();
  if (rest[0] === "init") {
    if (probeEnrichmentStore() !== undefined) {
      out.print(out.line("skipped", "Your team's settings already label these connections"), out.callout("note", ["rt would otherwise create ", out.strong(path)]));
      return;
    }
    if (existsSync(path)) {
      out.fail({ title: "Your labels file already exists", why: `It is at ${path}.` });
      process.exitCode = 1;
      return;
    }
    const { resources } = await getScan(true);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, enrichmentSkeleton(resources.map(r => r.name)));
    out.print(
      out.line("done", "Created your labels file", `${resources.length} connection${resources.length === 1 ? "" : "s"}`),
      out.kv("file", path),
      out.callout("next", "Give a label to each connection you use"),
    );
    return;
  }
  const enr = loadEnrichment(path);
  const { resources } = await getScan();
  const enriched = resources.filter(r => enr[r.name]).length;
  out.print(...enrichmentBlocks(path, enriched, resources.length));
}

export const __test__ = {
  withProgress,
  excerpt,
  redact,
  logLine,
  loginTip,
  guidedConnect,
  connectedBlocks,
  connectFailure,
  healthFailure,
  loginFailure,
  manualLoginFailure,
  productionRefusal,
  appFailure,
  statusBlocks,
  connectionsBlocks,
  refreshBlocks,
  enrichmentBlocks,
};
```

Three things the code above depends on, each checked against the source:

- A prompt (`select`, `textInput`, `confirm`) and the terminal login (`loginSdm`, which gives `sdm login` the terminal through `runSdmLoginInteractive`) never run inside a `withProgress` task. That is why the guided flow wraps `requestAccess`, `connect` and the browser login one at a time, each in its own step, and why `sdmBrowserLogin` lets its step end before it calls `loginSdm`.
- `runGuidedConnect` hands `deps.onLine` to `login`, `requestAccess` and `connect` as their last argument. The wrappers above ignore it and use the step's own `onLine`; `onLine: logLine` is there for the type and for any line the flow itself emits.
- With `--json`, `withProgress` is called with `draw: false`: nothing is spawned, no child line reaches stderr, and the lines are in the log.

- [ ] **Step 4: Move the three existing tests**

In `lib/sdm/__tests__/enrichment-cmd.test.ts`, add two imports:

```ts
import * as out from "../../ui/out.ts";
import { captureOut } from "../../ui/__tests__/capture-out.ts";
```

Replace the body of `describe("enrichmentCmd init: scaffold refusal when the team store owns rt.sdmEnrichment", ...)` with:

```ts
  let io: ReturnType<typeof captureOut>;

  beforeEach(() => {
    // Store-owned returns before ever reaching the network scan, so this
    // needs no daemon or StrongDM stubbing, just an isolated HOME.
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "enr-cmd-home-")));
    io = captureOut();
    out.__test__.setHuman(() => false);
  });

  afterEach(() => {
    io.restore();
  });

  test("says the team already labels them, names the file it would otherwise write, and never scaffolds it", async () => {
    writeStore(teamSettingsPath("acme"), { "rt.sdmEnrichment": { "res-a": { label: "A" } } });
    const path = enrichmentPath();

    await enrichmentCmd(["init"]);

    expect(existsSync(path)).toBe(false);
    expect(io.stdout()).toBe(`[skipped] Your team's settings already label these connections\n  note: rt would otherwise create ${path}\n`);
    expect(io.stderr()).toBe("");
  });
```

In `e2e/tests/sdm-enrichment.test.ts`, replace

```ts
    expect(res.stdout).toContain("0/2 resources enriched");
```

with

```ts
    expect(res.stdout).toContain("0 of 2 connections have a label");
```

In `e2e/tests/sdm-browser-login.test.ts`, in the test `silent path drives the fake SAML flow to completion`, replace

```ts
    await session.waitForText("logged in", 45_000);
    const screen = await session.screen();
    expect(screen).toContain("logged in");
```

with

```ts
    await session.waitForText("Logged in to StrongDM", 45_000);
    const screen = await session.screen();
    expect(screen).toContain("Logged in to StrongDM");
```

The old text waits for `logged in`, which the new output never prints in lower case (the done line is `Logged in to StrongDM`, the step label `Logging in to StrongDM`). The file skips unless `RT_SDM_BROWSER_E2E=1`, so the default e2e run never shows the break; Step 6 runs it opted in.

- [ ] **Step 5: Edit the sdm skill's two call notes and two digraph edges**

Before touching the file, load the `superpowers:writing-skills` skill and the `mattstack:editing-skills` skill and follow them; these are wording changes to current mechanics (two call notes, two digraph edge labels), not a new rule.

Where this skill lives, and what checks it (found while writing this plan; this step re-checks the first point). `skills/rt-sdm-connect/` is rt's own skill directory. It is not mirrored or compiled anywhere: there is no copy under `plugins/mattstack`, `apps/board/skills`, `apps/board/skills-src` or a team pack, and no `surface.jsonc` names it. It reaches a Claude config dir through `rt skills link`, which symlinks each `skills/<dir>/SKILL.md` under its frontmatter name (`lib/skills/link.ts`), so a merged edit is live on a machine once its shared checkout syncs: nothing to compile, no `plugin.json` version to bump. The `plugin-mattstack` CI job (certify, `rt skills check --strict`, the version-bump check, `check-dot.py` over every digraph) covers `plugins/mattstack` only, so none of it runs on this file; `scripts/ci/test-scope.ts` counts a Markdown file under `skills/` as code (`isDocs`), so the PR runs the full unit suite.

Run (repo root): `grep -rln "rt:sdm-connect\|rt-sdm-connect" plugins apps/board/skills apps/board/skills-src`
Expected: no output. If it prints a path, a copy of the skill exists that this plan did not know about: stop and report it rather than editing one copy.

In `skills/rt-sdm-connect/SKILL.md`, under "Call notes", replace the first bullet

```markdown
- JSON is on stdout; progress lines are on stderr. Parse stdout only.
```

with

```markdown
- JSON is on stdout and is the only thing there. rt keeps its progress in
  its own log; anything on stderr is a note for the person. Parse stdout
  only.
```

and in the third bullet (the `rt sdm login` note), replace its last three lines

```markdown
  user a browser window may appear. When it exits non-zero naming the
  manual login, give the user that exact command to run in a terminal; the
  SAML hop is theirs.
```

with

```markdown
  user a browser window may appear. When it exits non-zero with a `next:`
  line on stderr naming `rt sdm login --manual`, give the user that exact
  command to run in a terminal; the SAML hop is theirs.
```

The command did not move out of reach: it moved from a sentence (`Run rt sdm login --manual in a terminal.`) to the failure's `next:` line, which is the field the note now names. On a `next:` line it appears only in the needs-a-person failure and after a failed `--visible` login, which the skill never runs; a failed silent login names it only in a `tip:` line (Step 1's tests pin all three). So the digraph's two hand-off edges still split as they did, and they say which line counts. In the ```dot block, the two edges into `Hand off: the user runs the manual login in a terminal` (one from `Preflight login result?`, one from `Mid-connect login result?`) carry `[label="non-zero, names the manual login"]`; change both labels to

```dot
[label="non-zero, a next: line names the manual login (a tip: naming it is not a hand-off)"]
```

and change nothing else in the block: no node, no other edge.

Run: `git diff -- skills/rt-sdm-connect/SKILL.md`
Expected: the two bullets inside "## Call notes" and the two edge labels, nothing else.
Run: `python3 plugins/mattstack/plugin/skills/process-digraphs/check-dot.py skills/rt-sdm-connect/SKILL.md`
Expected: exit 0 (CI never runs it on this file, so this is the only check the digraph gets). It needs graphviz's `dot` on the PATH; if `dot` is missing, say so in the report. A finding on either edited edge is this step's to fix by rewording the label; any other finding predates this plan: report it and do not fix it here.

- [ ] **Step 6: Delete the allowlist line, then run everything sdm**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `"commands/sdm.ts",`.

Run (repo root): `bun test commands/__tests__/sdm.test.ts lib/sdm lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/picker-conformance.test.ts`
Expected: PASS.
Run: `bun run typecheck`
Expected: no errors.
Run: `grep -n "console\.\|process\.std\(out\|err\)\.write\|streamLine\|inline-spinner\|tui.ts" commands/sdm.ts`
Expected: no output.
Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/sdm-json.test.ts e2e/tests/sdm-enrichment.test.ts e2e/tests/sdm-browser-login.test.ts`
Expected: PASS, with the fixture from Task 7 untouched (its two hand-edited values included). Each `stdout` and `exitCode` must match exactly. If only a `stderr` differs, read the two values: a dim progress line that was there before (`StrongDM app is not running; launching it`) and is gone now is this plan's intended change (the constraint "under `--json` child progress never reaches stderr"); edit that one `stderr` value in the fixture by hand to the new text and say so in the report. Any other difference is a bug in the conversion: fix the code, never the fixture.

The browser-login e2e skips unless it is opted in and Chrome is present (`e2e/tests/sdm-browser-login.test.ts:28`). Opted in, it drives a real Chrome window on Matt's machine, so never run it unannounced: ask Matt first (through the shepherd), and run it only on his yes. The command to give him is `RT_SDM_BROWSER_E2E=1 bun test --preload ./e2e/setup.ts --timeout 120000 e2e/tests/sdm-browser-login.test.ts`
Expected, when he agrees: PASS, the silent path finding `Logged in to StrongDM` on the screen. If he declines, or the machine has no Chrome and it skips, say so in the report rather than claiming it passed; the edit to the file still ships, checked by reading it against the new done line.

- [ ] **Step 7: Commit**

```bash
git add commands/sdm.ts commands/__tests__/sdm.test.ts lib/sdm/__tests__/enrichment-cmd.test.ts e2e/tests/sdm-enrichment.test.ts e2e/tests/sdm-browser-login.test.ts skills/rt-sdm-connect/SKILL.md lib/__tests__/raw-output-allowlist.json
```

If Step 6 edited a `stderr` value, add `e2e/tests/fixtures/sdm-json.json` to the same `git add`.

```bash
git commit -m "sdm: every verb prints through the output layer, with child output under a step

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Renders, AGENTS.md and every gate

**Files:**
- Modify: `AGENTS.md` ("Output layer" section: append; never rewrite what is there)
- Modify: `docs/design/output-layer/README.md`
- Create under `docs/design/output-layer/`: `sdm-dark.png`, `sdm-light.png`, `port-runs-dark.png`, `port-runs-light.png`

**Interfaces:**
- Consumes: every builder above; `ui/dist/rt-ui` built by `bun run ui:build`.
- Produces: the renders the PR carries.

- [ ] **Step 1: Write the render inputs**

Run: `bun run ui:build`

In the session scratchpad (not the repo), write `blocks.ts`. Replace `<repo>` with the worktree's absolute path. All sample names are invented.

```ts
// usage: bun blocks.ts <sdm|port-runs> > in.ndjson
import { portBlocks } from "<repo>/commands/port.ts";
import { runDetailBlocks, runRow } from "<repo>/commands/runs.ts";
import { __test__ as sdm } from "<repo>/commands/sdm.ts";
import * as out from "<repo>/lib/ui/out.ts";
import { encodeLine } from "<repo>/lib/ui/protocol.ts";
import { usageFailure } from "<repo>/lib/ui/usage.ts";

const target = { key: "acme:qa", label: "Acme QA", sdmResource: "acme-db-qa", tier: "qa", db: { database: "acme", schema: "app" } };
const run = { id: "20260821-010101-aaaa", repo: "sample-app", work_type: "feature", pipeline: "default", status: "running", current_stage: "plan", spawned_by: null, started_at: 1755750000000, ended_at: null };
const port = (over: object) => ({ port: 3000, pid: 101, command: "node", cwd: "/code/sample-app", repo: "sample-app", worktree: "/code/sample-app", branch: "feature/login", relativeDir: ".", uptime: "05:12", ...over });

const sets: Record<string, object[]> = {
  sdm: [
    out.banner("PRODUCTION", "Acme Production", "type its name to connect"),
    ...sdm.connectedBlocks(target, { outcome: "connected", address: "127.0.0.1:15432", verify: { ok: true, attempts: 1, latencyMs: 42, lastError: null } }),
    ...sdm.connectedBlocks(target, { outcome: "connected", address: "127.0.0.1:15432", unverified: true, verify: { ok: false, attempts: 5, latencyMs: null, lastError: new Error("Connection closed") } }),
    out.line("skipped", "Not connected", "you chose not to log in"),
    out.failure(sdm.connectFailure(target, { outcome: "failed", stage: "connect", error: "no route to gateway", hint: "Log in to StrongDM again, then connect.", next: "rt sdm login" })),
    out.verbatim(["dialing gateway", "datasource list still refreshing", "gave up after 30s"]),
    out.failure(sdm.connectFailure(target, { outcome: "failed", stage: "access", error: "denied", hint: "Check the connection name, or ask for access with a reason." })),
    out.failure(sdm.manualLoginFailure("No Chrome or Chromium browser found.")),
    ...sdm.productionRefusal({ ...target, label: "Acme Production", key: "acme:prod" }),
    ...sdm.statusBlocks({ health: { status: "ok", message: null }, resources: new Map([["acme-db-qa", { connected: true, address: "127.0.0.1:15432", expiry: "5h" }]]) }, false),
    ...sdm.statusBlocks({ health: { status: "not-authenticated", message: "Your StrongDM login has expired, or this Mac has not logged in yet." }, resources: new Map() }, true),
    ...sdm.connectionsBlocks(
      [
        { key: "acme:qa", label: "Acme QA", sdmResource: "acme-db-qa", tier: "qa" },
        { key: "acme:staging", label: "Acme Staging", sdmResource: "acme-db-staging", tier: "staging", standingAccess: true },
        { key: "acme:dev", label: "Acme Dev", sdmResource: "acme-db-dev" },
      ],
      new Map([["acme-db-qa", { connected: true, address: "127.0.0.1:15432", expiry: null }]]),
    ),
    ...sdm.refreshBlocks(3),
    ...sdm.enrichmentBlocks("~/.mattstack/rt/sdm/enrichment.jsonc", 1, 3),
  ],
  "port-runs": [
    out.line("warn", "Scanned your ports without the rt daemon"),
    ...portBlocks([port({ relativeDir: "apps/web" }), port({ port: 5432, pid: 102, command: "postgres", uptime: "01:02:03" }), port({ port: 8080, pid: 103, command: "bun", repo: "other-tool", worktree: "/code/other", branch: null, uptime: "00:09" })] as never),
    out.line("done", "Stopped node", "pid 101, port 3000"),
    out.line("failed", "Could not stop pid 102"),
    out.line("skipped", "Nothing is listening on port 9999"),
    out.table([runRow(run as never), runRow({ ...run, id: "20260820-090909-bbbb", status: "failed", current_stage: null } as never), runRow({ ...run, id: "20260819-080808-cccc", status: "abandoned", current_stage: null } as never)], ["STATUS", "RUN", "REPO", "TYPE", "STAGE", "STARTED"]),
    ...runDetailBlocks({
      run,
      stages: [
        { name: "plan", status: "done", attempt: 1, started_at: 1, ended_at: 2, reason: null, detail_path: null },
        { name: "implement", status: "redirected", attempt: 1, started_at: 2, ended_at: 3, reason: "redirected to plan", detail_path: null },
        { name: "gates", status: "failed", attempt: 2, started_at: 3, ended_at: 4, reason: "one assertion failed", detail_path: "/tmp/gates.log" },
      ],
      fields: [{ key: "ticket", value: "ACME-1", produced_by: "plan", at: 1 }],
      decisions: [{ contract: "execution-strategy@1", scope: "run", selection: '{"tier":"direct-tdd"}', decided_by: "stage-plan", decided_at: 1 }],
      schemaAhead: false,
    } as never),
    out.failure({ title: "The rt daemon is not running", why: "It keeps the record of your runs.", next: out.cmd("rt daemon start") }),
    out.failure(usageFailure("Which run?", "rt runs show <run>")),
  ],
};
process.stdout.write(encodeLine({ t: "hello", protocol: 1 }) + sets[process.argv[2] ?? "sdm"]!.map(encodeLine).join(""));
```

Also write `ansi-page.ts` in the scratchpad. It turns the helper's ANSI into one HTML page on a dark or a light ground:

```ts
// usage: bun ansi-page.ts <dark|light> <title> < ansi.txt > page.html
const [mode, title] = [process.argv[2] ?? "dark", process.argv[3] ?? "render"];
const page = mode === "light" ? { bg: "#FFFFFF", fg: "#1F1F1F" } : { bg: "#161224", fg: "#E6E0FF" };
const input = await new Response(Bun.stdin.stream()).text();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
let html = "";
let open = false;
let style: Record<string, string> = {};
const flush = () => {
  if (open) html += "</span>";
  const css = Object.entries(style).map(([k, v]) => `${k}:${v}`).join(";");
  open = css !== "";
  if (open) html += `<span style="${css}">`;
};
const tokens = input.replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "").split(/(\x1b\[[0-9;]*m)/);
for (const token of tokens) {
  const sgr = token.match(/^\x1b\[([0-9;]*)m$/);
  if (!sgr) {
    html += esc(token);
    continue;
  }
  const codes = sgr[1] === "" ? [0] : sgr[1]!.split(";").map(Number);
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]!;
    if (c === 0) style = {};
    else if (c === 1) style["font-weight"] = "bold";
    else if (c === 4) style["text-decoration"] = "underline";
    else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
      style[c === 38 ? "color" : "background"] = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
      i += 4;
    }
  }
  flush();
}
if (open) html += "</span>";
process.stdout.write(
  `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="margin:24px;background:${page.bg};color:${page.fg}"><pre style="font:14px/1.45 Menlo,monospace">${html}</pre></body>\n`,
);
```

- [ ] **Step 2: Render four pages**

For each of `sdm` and `port-runs`, at width 100, run these five commands one at a time from the scratchpad (shown for `sdm`; the light page sets `COLORFGBG=0;15`, which is how 5a's renderer learns the background is light):

```bash
bun blocks.ts sdm > sdm.ndjson
COLORTERM=truecolor TERM=xterm-256color <repo>/ui/dist/rt-ui render --width 100 < sdm.ndjson > sdm-dark.ansi
COLORTERM=truecolor TERM=xterm-256color COLORFGBG="0;15" <repo>/ui/dist/rt-ui render --width 100 < sdm.ndjson > sdm-light.ansi
bun ansi-page.ts dark sdm < sdm-dark.ansi > sdm-dark.html
bun ansi-page.ts light sdm < sdm-light.ansi > sdm-light.html
```

- [ ] **Step 3: Screenshot both schemes and look**

Serve the scratchpad over http on 127.0.0.1 (`python3 -m http.server 4173 --bind 127.0.0.1`; `file:` is blocked) and screenshot each of the four pages with Fast Browser (the `fast-browser:browser-driver` agent, or the Fast Browser MCP tools directly). Save the four PNGs into `docs/design/output-layer/` under the names in this task's Files list.

Then read each PNG and write down plainly what reads wrong. Check these in particular, on both backgrounds:

- **sdm:** the `PRODUCTION` banner is the only coral that is not a failure, and it reads as a warning, not as an error that already happened. The production refusal reads as rt declining, in the refused color, never coral, and is visibly different from the two failures above it. The unconfirmed tunnel is peach, not coral. The child excerpt under the failed connect is dim and clearly belongs to the failure above it; the access failure's hint reads as a sentence with no command in it. In the connections table the three states (`connected`, `standing access`, `on request`) can be told apart without reading the words, and the key column lines up.
- **port and runs:** the daemon warning at the top reads as a note, not as a failure of the list under it. The branch name is lavender and the ports under it read as its children. The run list's status column is colored by state (a failed run coral, an abandoned one dim) and the header row does not outweigh the rows. In the detail, the redirected stage does not look like a failure.
- **everywhere:** body text is the terminal's own foreground on both backgrounds; nothing is unreadably faint on light.

A fault found here is fixed in the task that owns the code, re-rendered, and named in the report. Do not declare success from the tests.

The sdm picker has no screenshot: Task 3's test proves the request rt-ui receives is the same before and after, so there is nothing new to look at.

- [ ] **Step 4: Update `docs/design/output-layer/README.md`**

Add two rows to its table:

```markdown
| `sdm-dark.png`, `sdm-light.png` | `rt sdm` at 100 columns: the production banner, a verified and an unconfirmed connect, a declined one, a failed connect with its child excerpt, an access failure, the manual-login failure, the production refusal, status, the connections table, refresh and enrichment |
| `port-runs-dark.png`, `port-runs-light.png` | `rt port` (the no-daemon note, repos, branches, ports, kill results) and `rt runs` (the list, one run's detail, two failures) |
```

- [ ] **Step 5: Append to `AGENTS.md`**

At the end of the "Output layer" section (after its last paragraph, before the next `##` heading), append:

```markdown
A verb that streams a child's output (`rt sdm connect`, `rt sdm login`) runs
the child under `withProgress` in `commands/sdm.ts`: at a terminal the lines
are a step's sub-lines, every line goes to the CLI log at `debug`, the step
is erased when the task settles, and a failure prints the last five lines
under its `failure` block. Every line passes through `redact` first, which
replaces the one-time token in a StrongDM auth url, so neither the log nor
an excerpt keeps it. No prompt and no child that owns the terminal may run
inside it. Under `--json` nothing is drawn and child output stays off
stderr. A sentence inside an sdm envelope that a person also reads (a
connect's `hint`, a health `message`) never quotes a command: the command
rides apart, in the failed result's `next`, and the CLI shows it as the
`next:` line.
```

Wrap at about 78 columns like the paragraphs above it.

- [ ] **Step 6: Run every gate**

Run each from the repo root, one at a time:

- `bun run ui:build`
- `bun run ui:test`
- `bun run typecheck`
- `bun run test`
- `bun run test:e2e`
- `bun run test:pty`
- `bun run picker:check`
- `bun run format:check`
- `bun run check`

Expected: all pass. `bun run docs:gen` is not needed: no command description changed. Known noise, per the herd notes: about ten rotating load flakes in the unit suite (flavor-takeover, sync-stack-guard, git reset, setup-connect oauth, daemon-logdy-config) and the `rt plugin new` e2e on this machine. A failure in a file this plan did not touch that passes when its file runs alone is a flake; say so in the report with both results.

Then confirm the allowlist lost exactly this plan's six lines. Run: `git diff origin/main -- lib/__tests__/raw-output-allowlist.json`
Expected: six deleted lines and nothing added: `commands/port.ts`, `commands/runs.ts`, `commands/sdm.ts`, `lib/navigate.ts`, `lib/sdm/enrichment.ts`, `lib/sdm/picker.ts`. (If 5f2 merged first, its two lines are already gone on main and do not show here.)

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md docs/design/output-layer/README.md docs/design/output-layer/sdm-dark.png docs/design/output-layer/sdm-light.png docs/design/output-layer/port-runs-dark.png docs/design/output-layer/port-runs-light.png
```

```bash
git commit -m "docs: output layer rule for streamed child output and envelope hints, with sdm, port and runs renders

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Ship

**Files:** none beyond what a rebase touches.

**Interfaces:**
- Consumes: the finished branch.
- Produces: one PR against `m4ttstack/mattstack`.

- [ ] **Step 1: Rebase and re-check what other slices added**

Run: `git fetch origin`
Run: `git rebase origin/main`

Other phases and slices may have merged, 5f2 among them. Merge by hand, per cross-phase ruling 7:

- `lib/__tests__/raw-output-allowlist.json`: keep every deletion from both sides.
- `AGENTS.md` "Output layer": keep their paragraphs, then this plan's.
- `docs/design/output-layer/README.md`: keep their rows, then this plan's.

If 5c has merged, run: `bun test lib/sdm/__tests__/picker.test.ts`
Expected: PASS. Task 3's pin of the pick request is the check that 5c's work on `lib/pick-wrappers.ts` left the sdm picker's rows alone. If it fails, do not change 5c's files: report the difference to the shepherd before pushing.

- [ ] **Step 2: Re-run the gates after the rebase**

Run, one at a time: `bun run ui:build`, `bun run ui:test`, `bun run typecheck`, `bun run test`, `bun run test:e2e`, `bun run test:pty`, `bun run picker:check`, `bun run format:check`, `bun run check`.
Expected: all pass, with the same known noise as Task 9 Step 6. `e2e/tests/fixtures/sdm-json.json` must pass as committed.

- [ ] **Step 3: Measure the diff**

Run: `git diff --shortstat origin/main...HEAD`
Expected: about 2,700 changed lines (insertions plus deletions). Put the number in the report. If it passes about 2,800, stop before Step 4 and say so: the cut is Tasks 5 and 6 (port and runs, which share no source file with sdm) into their own PR (decision 16), and making it is the shepherd's call, not this task's.

- [ ] **Step 4: Push**

Push the branch with the `git_push` MCP tool (it pushes one explicit refspec to the branch's same-named upstream).

- [ ] **Step 5: Open the PR**

Write the body to `<scratchpad>/pr-body-5f1.md`, then run:

`gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 5f1, sdm, port and runs" --body-file <scratchpad>/pr-body-5f1.md`

The body, in the style of PR 639: one framing paragraph; bold-labelled bullet groups (**sdm**: every verb on the layer, child output under a step and in the log, the production banner, the production refusal as a refused note, the login url's token redacted from the log and every excerpt, human text on stdout and failures on stderr; **envelope copy**: the reworded hints, health messages and errors, shapes unchanged, with a link to Task 2's copy table in the plan; **port and runs**: sections, trees and tables, the scan spinner on the transient step, the no-daemon note; **Also**: the sdm picker's colors are tone names with the pick request pinned, two lib warnings on `warn`, the sdm skill's two call notes; **Follow-up**: any item from "Decisions" below that Matt has not ruled on, and decision 13); the four renders; a verification line with the gate results and the fixture; and the last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 6: Report**

Report the PR url, the gate results, the flakes seen with both results, the measured diff size, what the renders showed, and whether Task 8 Step 6 edited a `stderr` value in the sdm fixture. Do not merge: the shepherd watches CI and CodeRabbit and merges.

---

## Decisions this plan made that the scoping document and the spec do not settle

Each is the plan's best reading unless it says it was ruled; Matt or the reviewer may overrule one before execution. (Decisions on `rt chat` live in the 5f2 plan.)

1. **sdm's streamed child output: one step per streaming call, erased on both endings, and the last five lines printed under the failure** (ruled, 5f ruling 2). This stands in for spec rule 5, which keeps a failed step's sub-lines under it. Why not rule 5 here: a step and its sub-lines exist only at a terminal, so keeping them would give an sdm failure two renderings (a styled step at a terminal, nothing in a pipe or a log an agent reads), while the failure itself belongs on stderr as Matt ruled for sdm; a step kept on the terminal would sit apart from the failure that explains it. Printing the last five child lines under the `failure` block gives one rendering everywhere, on stderr, beside the failure, and the full output is in the CLI log at `debug`. A helper that predates 5a's `clear` flag leaves one plain done row above the failure.
2. **Under `--json`, sdm's child progress no longer reaches stderr at all;** it goes to the CLI log (ruled, 5f ruling 3). The sdm skill said "progress lines are on stderr" and is edited in the same PR, with the mirror and checks found in Task 8 Step 5. `e2e/tests/fixtures/sdm-json.json` records stderr so the change is visible.
3. **`sdm status` with StrongDM not healthy prints a status row on stdout and exits 1,** not a `failure` block (ruled, 5f ruling 3): the verb did its job (it reported), and "not logged in" is `needs-you`, not coral. `sdm connections` in the same state is a failure on stderr, because it could not do what was asked.
4. **`NavOption.color` was dead data** (ruled, 5f ruling 3). `navOptionsToRows` never read it, so the sdm picker has painted no tier or connected color since it moved onto rt-ui. The colors become tone names (`mint`, `pink`, `peach`, `coral`, `blue`) and stay unread, which is what "must look the same" requires. If a later change makes the wrapper paint them, production's `coral` needs a ruling against "coral only for failures".
5. **`lib/navigate.ts` gets no stream option.** The scoping document's shared item 12 gave 5f a pass-through there; it was withdrawn on 2026-10-01 (`rt-ui pick` paints on `/dev/tty`, so the stdout swap in `cd` and `nav` is inert and nothing takes a stream). The file is in this plan only for its guard-only line, and 5c does not wait on it.
6. **`rt port` prints its own note when the daemon does not answer** (ruled, 5f ruling 4: not dropped silently). 5a's daemon-down note does not cover the path: `daemonQuery` emits it only after a failed restart, and falls back silently when the daemon is not installed, when a live socket timed out, and never on an `ok: false` reply (Task 2's port section). So `rt port` adds `out.note(out.line("warn", "Scanned your ports without the rt daemon"))` on every fallback, on stderr where the old dim line was on stdout. It says what rt did, not what state the daemon is in, so on the failed-restart path, where 5a's note already says the daemon is not running, the two lines do not repeat each other. `rt sdm refresh` gets no spinner, since it has none today.
7. **`formatRunLine` and `formatRunDetail` are replaced, not kept,** by `runRow` and `runDetailBlocks`. Nothing outside `commands/runs.ts` and its test imports them.
8. **The copy pass reaches `lib/sdm/core.ts` and `lib/sdm/app.ts` as well as `lib/sdm/flow.ts`.** 5f ruling 5 hands this plan `flow.ts` and says to apply the same pass to any other envelope string in the slice that a person reads on screen. The health messages in `core.ts` ride in all three sdm envelopes and show as `why:` lines, and one told a person to run the raw `sdm` CLI; `app.ts`'s two errors ride in the connect envelope and show under "The StrongDM app did not start". No other slice or phase names either file, and the edits are string literals only. While `core.ts` is open, its two `loginSdm` errors (rows 20 and 21) are reworded too, though they ride in no envelope, because they reach the screen and one named the raw `sdm` CLI. If Matt wants the pass held to `flow.ts`, drop rows 13 to 23 from Task 7, with their test moves and the fixture's two hand edits.
9. **A failed connect carries the command apart from its hint.** `GuidedResult`'s failed member gains an optional `next`. The envelope keeps `hint` (now a sentence with no command in it) and never shows `next`, so an agent relays a plain sentence and still routes on `stage`; the CLI shows `next` as the failure's `next:` line. This replaces the old plan's match on the hint's text (`includes("rt sdm login")`), which would have broken the moment the hint was reworded.
10. **Where a failed login points next** (ruled, 5f1 review round 1, issue 1). The needs-a-person failure's `next:` line is `rt sdm login --manual`. A failed silent login's `next:` line is `rt sdm login --visible`, with the manual login in a `tip` callout under the failure; a failed `--visible` login's `next:` line is `rt sdm login --manual`. So a person retrying by hand always meets the manual login, and never loops on generic browser failures that repeat on every retry. The sdm skill's routing is unchanged: it hands the manual login to the person when the `next:` line names it (the call note Task 8 Step 5 edits), and it never runs `--visible`, so the only `next:` line it can see naming `--manual` is the needs-a-person one. Pinned in Task 8 (`only a login that needs a person names the manual login on its next: line`).
11. **The production connect from a script is a refusal, not a failure** (ruled, 5f ruling 6): `out.note(out.line("refused", ...), callout("why", ...), callout("next", ...))` on stderr, exit 1, its `--json` envelope unchanged. Nothing else in this plan declines by policy: "Picking a connection needs a terminal" and "This login needs a terminal" are things rt cannot do without a terminal, not things it chooses not to do, so they stay failures.
12. **Envelope strings that never reach a screen stay** (rows 25 to 30 of Task 2's copy table): `commands/sdm.ts`'s two `--json`-only errors, `agent-json.ts`'s production refusal and reason template, and `rt runs`' `--json` error. Each has its own human rendering on the non-`--json` path, which this plan rewrites.
13. **Follow-up, not in this plan: `lib/sdm/browser-login.ts`'s reasons.** They show as `why:` (one is ``StrongDM email not set. Run `rt sdm set-email` (or use `rt sdm login --manual`).``) but ride in no envelope, so 5f ruling 5 does not reach them, and the one that names a command names `rt sdm set-email`, phase 4's verb. Rewording them is a small change for whoever next owns that file.
14. **Every sdm child line is redacted before it is kept** (ruled, 5f1 review round 1). `sdm login` prints a one-time auth url (`.../auth-confirm-native/<token>`), and `startLoginCapture` hands every output line to `onLine`. `withProgress` passes each line through `redact` before it reaches the CLI log, the tail and the step's sub-line, `logLine` redacts on its own for the callers that use it directly (the terminal login), and `excerpt` redacts again, so neither `cli.*.log` nor a failure's excerpt carries the token. The failure's `why:` line is redacted too (ruled, 5f1 review round 2): `lib/sdm/browser-login.ts:220` folds up to 200 characters of `sdm login`'s output into its `error`, which can hold the auth url, and that `error` (or a `needs-manual` reason) becomes `why:` under `loginFailure`, `manualLoginFailure`, the connect flow's login stage (through `sdmBrowserLogin`) and `ensureSdmAuth`. `browser-login.ts` is not this plan's, so `commands/sdm.ts` redacts every `error` and `reason` it takes from `runBrowserLogin` before it prints or returns one. The skill runs `rt sdm login` in Bash, so stderr lands in an agent's transcript. The pattern matches `auth-confirm-native` followed by `/` or `%2F` in any case, up to whitespace, a quote or an angle bracket. Pinned in Task 8 (five tests, the `loginCmd` failure path with a stubbed outcome among them).
15. **The e2e envelope pin moved to Task 7 and gained a logged-out CLI** (5f1 review round 1). It is captured before any sdm envelope string or verb changes, so the `status --json` and `connections --json` refusal shapes the skill reads when StrongDM is not logged in are pinned through the real binary; Task 7 then edits exactly two values by hand (row 13's sentence) and nothing else.
16. **If 5f1 measures well past its estimate, cut port and runs out** (5f1 review round 1). Tasks 5 and 6 share no source file with the sdm tasks, so if Task 10 measures past about 2,800 changed lines, they ship as their own PR (Tasks 1 to 6: the confirmation and audit, the sdm picker's tones, the enrichment warnings, port and runs, with Task 9's port and runs renders), and Tasks 7 to 10 as the other. That call is the shepherd's.

## Self-Review

**Spec coverage.** Phase 5 names `port`, `sdm` and `runs` for this half of 5f: Tasks 5, 8 and 6. Rule 1 (never style a payload): every envelope goes through `out.json` (Tasks 6 and 8). Rule 2 and ruling 5 (human text on stdout): sdm's 23 stderr lines move (Task 8). Rule 3 (failures on stderr as a `failure` block): Tasks 6 and 8; the one policy refusal is a `refused` note instead (5f ruling 6, Task 8). Rule 4 (one spinner) and ruling 1: `port` and `sdm` on `withTransientStep` (Tasks 5 and 8). Rule 5 and "Steps" (`sdm connect` and `sdm login` use sub-lines, always in the log): `withProgress` (Task 8), with decision 1 on the ending. The `banner` block: Task 8. `tree` for `port`, `section` for `runs show`: Tasks 5 and 6. "Each conversion PR greps ... for text scraped from the verbs it converts": Task 2's readers table and copy table, Task 8 Step 5. Characterization of `--json`: Tasks 6 and 8, plus Task 7's shape-and-words test. The copy pass on envelope strings (5f ruling 5): Task 2's table (30 rows) and Task 7. Scoping items: 1 (rows 40 and 41, Task 4), 2 (Tasks 5 and 8), 8 (Task 6); item 12 was withdrawn and has no task. Ruling 11 (a verb on rt-ui is not converted): Task 2's table and Task 3's pin. Six allowlist lines: Tasks 3, 4, 5, 6, 8, checked in Task 9 Step 6. Screenshots: Task 9. No pty test is named by the spec for these verbs, so none is added. Each of the eight 5f rulings: 1 is 5f2's; 2 is decision 1; 3 is decisions 2, 3 and 4 and Task 8 Step 5; 4 is decision 6 and Task 5; 5 is Task 2's copy table, Task 7 and decisions 8, 9 and 12; 6 is decision 11; 7 is the split; 8 is Task 1's note. The round-1 review of this plan (`.superpowers/sdd/phase-5f1-review-r1.md`): issue 1 is decision 10 and Task 8's login tests and code; issue 2 is Task 8 Steps 4 and 6 and the readers table; issue 3 is Task 6's `repoArgFailure` and its test. Its recommendations: the port note's title (Task 5, decision 6), the stderr wording (Global Constraints, Task 8 Step 5, Task 9's AGENTS paragraph), redaction (decision 14, Task 8), row 21's spawn errors (Task 7 Step 7), the logged-out pin before Task 7 (decision 15, Task 7 Steps 1 to 3 and 9), the empty enrichment line and the port kill test with entries (Tasks 8 and 5), and the size cut (decision 16, Task 10 Step 3).

**Placeholders.** None. `<repo>` and `<scratchpad>` in Tasks 9 and 10 are the implementer's own absolute paths, named as such. The fixture is captured from the real binary by commands this plan gives, with what it must contain.

**Type consistency.** `withProgress(label, draw, task)` returns `{ value, tail }` in its definition, its tests and every call. `GuidedResult`'s failed member `{ stage, error, hint?, next? }` is the same in Task 7's code and tests, Task 8's `connectFailure` and its tests, and Task 9's render input. `excerpt(tail)`, `redact(line)`, `logLine(line)`, `connectFailure(target, result)`, `loginFailure(error, visible)`, `loginTip(visible): Block[]`, `manualLoginFailure(reason)`, `productionRefusal(target): Block[]`, `statusBlocks(snapshot, appRunning)`, `connectionsBlocks(connections, resources)`, `refreshBlocks(count, error?)`, `enrichmentBlocks(path, enriched, total)`, `portBlocks(entries)`, `runRow(r)` and `runDetailBlocks(d)` are spelled the same in the Interfaces blocks, the code, the tests and the render input. 5a's names (`out.note`, `warn`, `setWarningLog`, `withTransientStep`, `usageFailure`, `StepHandle.clear`) are used with the signatures its plan states.

**Review Focus.** Five lines, each pinned to a named test in Tasks 5 to 8.
