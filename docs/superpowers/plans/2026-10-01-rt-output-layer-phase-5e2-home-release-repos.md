# rt Output Layer, Phase 5e2 (Home, Release and Repos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every human line printed by `rt home` (init, key export, key import, snapshot, claim, release), `rt release` and `rt repos` comes from the output layer; every human sentence `lib/home`, `lib/release`, `rt repos` and the repo locate and reidentify libraries put on a screen follows the copy rules while each `--json` envelope keeps its shape; `home init` shows one step per stage, and the setup step that runs it still reads its result; and seven files leave the raw-output allowlist: `commands/home.ts`, `lib/home/age-key.ts`, `lib/prompt-secret.ts`, `commands/release.ts`, `commands/repos.ts`, `lib/repo-index.ts`, `lib/repo-tracking.ts`. `commands/repos-reidentify.ts` (not on the allowlist, prints through a seam) is converted with them.

**Architecture:** Each command file keeps its `--json` branch and swaps its human branch for `out.print` blocks; failures go through `out.fail`, usage errors through 5a's `usageFailure`, and a policy refusal through `out.note(out.line("refused", ...))` with today's exit code and envelope. `home init` runs each stage (each plan step, each refresh step) as its own rt-ui step through `openStep`, ending in its own line, with plain lines off a terminal. The injected `print` seams (`RegisterDeps.print`, `ReidentifyDeps.print`) stay and after this plan carry only the `--json` envelope line. The fifteen `console.warn` lines in `lib/repo-index.ts` and `lib/repo-tracking.ts` move onto 5a's `warn`. `rt release apps` gets a structured progress seam in place of preformatted strings, and the release skills move to `--json` for the two verbs they read as text today. The `lib/home`, `lib/release` and `repos` copy passes reword the strings Task 2's tables name; keys, types, codes and statuses stay. `lib/setup/steps/home.ts`, which runs `rt home init` for the setup app and reads its output, moves onto the new output in the same slice (Task 7), keyed on a title constant `lib/home/init-exec.ts` exports rather than on copied prose.

**Tech Stack:** Bun + TypeScript (`commands/`, `lib/`), `bun:test`, termwright for the one existing pty test this plan edits (`e2e/pty/errors.test.ts`). No Go change: every file under `ui/` is 5a's.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (ticket RT-369), phase 5 of "Phases", plus "Rules", "Block vocabulary", "Status set", "Copy style", "Error seam", "Plain output off a TTY" (its 2026-10-01 amendment: frozen means shape), "Guard" and "Testing". The slice is defined by `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5-scoping.md` (section 2 items 1, 5, 8 and 11; section 3 "5e", second cut (ii); section 5's rows for the tray and the release skills; rulings 2, 8, 9 and 11). The thirteen cross-phase rulings in `.superpowers/sdd/cross-phase-rulings.md` bind this plan, and so do the controller's rulings on this slice in `.superpowers/sdd/phase-5e-rulings-r1.md` and the round 1 review's rulings in `.superpowers/sdd/phase-5e2-review-r1.md`. The API it builds on is fixed by the 5a plan, `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5a-layer-additions.md`, sections "API for slices 5b to 5f", "The breadcrumb header (nothing to call)" and the warnings table in its Task 1.

**What was run while writing this plan:** nothing was compiled. Every snippet was written against the files at `5bc69f231` (the line numbers are from that commit and shift once 5a and phase 3 land; `lib/setup/steps/home.ts` and its tests are cited by function and test name only, because phase 3 rewrites strings in them first), against 5a's signatures as its plan states them, and against phase 4's `lib/ui/__tests__/capture-out.ts` as it is on `origin/main` at `19ceaa403`.

**One of two plans, and most likely two PRs itself:** the slice ships as two PRs along the scoping document's second cut, because the copy pass pushes it past 2,500 changed lines. This plan is (ii), `home`, `release`, `repos` and their lib files. If it is on track past about 2,800 lines, `repos` (Tasks 11 to 13 and its part of Tasks 14 and 15) ships as its own PR, `RT-369: output layer phase 5e3, repos`, along the part lists in Task 10 Step 9. `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5e1-team.md` is (i). Neither depends on the other and either may merge first; both delete allowlist lines and append to AGENTS.md "Output layer", which ruling 7 merges by hand. The single plan this replaced was superseded and is not in the repo.

**Size:** "changed lines" means insertions plus deletions as `git diff --shortstat origin/main...HEAD` counts them (the PNG renders count as binary files, not lines). About 3,300 in all: about 1,400 for `home` (its stages and their terminal tests, the refusals, the `lib/home` copy and the setup step's reader), about 800 for `release` (its reports, the `apps` progress seam, the `lib/release` copy, the qualify stops and the two skills), about 950 for `repos` (five verbs, its copy pass across `commands/repos.ts` and the locate and reidentify libraries, the envelope pins, and the repo index warnings), and about 150 for docs. That is past the review's 2,800 mark, so the cut is the expected path: Task 10 Step 9 measures once `home` and `release` are in (about 2,200 of the 3,300) and, past 1,850, ships them as 5e2 (about 2,300 with its docs) and `repos` as 5e3 (about 1,000).

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
- 5e2 only: what "byte for byte" means here, per Matt's setup ruling (cross-phase ruling 1 and the spec's 2026-10-01 amendment, applied to this slice by the controller): the shape is frozen (keys, structure, types, exit codes, and every value a program reads: `id`, `status`, `code`, `ok`, `clean`, counts, tags, shas, paths, `resume`, `command`). A human sentence that rides in an envelope and is what a person reads (a `lib/release` row, leg or step `detail` written as a sentence, a `UserActionableError` message) is reworded exactly as Task 2's copy tables say, and nowhere else. A detail that is data (a version pair, a sha, a run id, a count, a file or asset list, a tool's output tail, a caught error's own message) stays. The existing `--json` tests stay as the shape and machine-value pins; only their assertions on a reworded string change.
- 5e2 only: the words the release skills match in verify's details stay in the reworded text: `draft`, `missing` and `still propagating` (`skills/rt-release/publish-and-finish.md:9-16`, `skills/mattstack-release/SKILL.md:201`). The qualify step's detail keeps the gate's reason (`e2e/tests/release-apps.test.ts:136` reads it).
- 5e2 only: a policy refusal (rt declining by a guard, an ownership rule or a key it already holds) is drawn as `out.note(out.line("refused", ...), callouts)` on stderr, never a coral failure block, with today's exit code and envelope. A report row for a leg rt declined by a guard (`aborted`) is a `refused` row, still in the report on stdout.
- 5e2 only: exit codes do not change. `home` verbs exit 1 on an expected failure or refusal (`home key import` exits 2 on a recipient mismatch); `repos` setup-contract verbs exit 2, a `repos locate` or `repos reidentify` refusal included; `repos status` exits 1; `release` verbs set `process.exitCode = 1` on a stale, pending, declined or failed report and exit 2 on a usage error or an expected failure.
- 5e2 only: files this plan must not edit: anything under `ui/`; `lib/ui/out.ts`, `lib/ui/out-plain.ts`, `lib/ui/warn.ts`, `lib/ui/usage.ts`, `lib/ui/transient-step.ts` (5a); `lib/ui/steps.ts` and `lib/rt-render.ts` (5b); `lib/ui/spawn.ts` and `lib/ui/gate.ts` (phase 1; called, not edited); `lib/pick-wrappers.ts`, `lib/ui/pick.ts`, `lib/pickers.ts` (5c); `commands/setup.ts` (`home remote set` lives there) and everything under `lib/setup/` (phase 3), with one exception: once phase 3 is on main (Task 1 checks), Task 7 makes the minimal edit to `lib/setup/steps/home.ts` (`failureDetail`, `homeInitRemedy` and the success detail in `homeInitRun`) and to the two test files that pin those readers, `lib/setup/__tests__/home-failure-detail.test.ts` and `lib/setup/__tests__/steps-a.test.ts`, and to no other `lib/setup` file; `lib/secrets/store.ts` (phase 6); `lib/errors.ts` (phase 2); `lib/ui/__tests__/capture-out.ts` (phase 4 extended it on main); `lib/command-tree-def.ts` (no description changes, so no `docs:gen`); `lib/state/reidentify.ts` (not in this slice's copy audit); `lib/repo-arg.ts` (shared by other verbs: `repos locate` calls its `tryResolveRepoArg` and words its own errors); `lib/daemon/handlers/repos.ts` (it already sends a locate refusal as `<code>: <message>`, which Task 12 reads); `lib/team/redact.ts` (5e1's; Task 6 imports `withoutUrls` from it).
- 5e2 only: no source file holds a literal bidi or zero-width character. A test that needs one builds it with `String.fromCodePoint(0x202e)`.
- 5e2 only: git commands are run plain and alone from the worktree root, never joined with `cd`, `&&`, pipes or heredocs. Never `git add -A`, `git add .` or `git add -u`.
- 5e2 only: the pickers, prompts and confirms these verbs already draw through rt-ui (the machine profile picker, the claim and release pickers, the register and locate pickers, the claim text prompt, the secret prompt, the confirms) are not changed.

## Review Focus

1. **The tray shows the first 200 bytes of stderr when `rt home init --dry-run --json` fails.** `--json` on argv closes the human gate, so the tray reads the plain failure: its first line must be the title alone, with no leading blank line and no tag. Pinned in Task 6 by the tray's own invocation (`the tray's dry run with no terminal to pick a profile leads with the question, and nothing before it`, which runs `["--dry-run", "--json"]` and reads the first 200 bytes the way `homeInitCheck` does) and by `a failed clone leads with one plain title, and what git said follows with escapes stripped`.
2. **`home init`'s stages.** One rt-ui step per stage at a terminal; off a terminal one plain line per stage (`[ok] Clone your home repo  <url>`, `[failed] ...`), the refresh steps' guidance kept under their line, and a failure still the first thing on stderr. The terminal path is tested against the scripted helper (`lib/ui/__tests__/fake-rt-ui.ts`, which records every line `openStep` sends) with the gate forced open; every `homeInit` test runs on `FakeAgeKeySeam`, so the keychain is never touched. Pinned in Task 6's `describe("homeInit at a terminal")`: `each refresh stage is its own rt-ui step, ended in its own state, and nothing it painted reaches stdout` (start and done per stage, `status` for skipped and needs-you, no `status` for done), `a refresh step rt does not own that fails ends warn, with what it said printed after it`, `a failed stage keeps its progress line and ends failing` (`sub` then `fail`) and `a helper that dies leaves one plain line per stage, each with its guidance after it`; off a terminal by `each stage ends in its own line, and the run ends with one line when the Mac is set up`.
3. **A refusal is not a failure, and a fault is not a refusal.** A key passed on argv, a key that is already there, a path someone else claimed, a machine profile on a Mac that has one, a skills file rt will not overwrite, a `release update-machine` with no terminal and no `--yes`, a shared checkout off main or an announcement that did not land (each an aborted leg), a fast path that does not qualify, a locate rt declines, a reidentify a store refused: each is a `[refused]` line with today's exit code. A download whose checksum does not match is aborted too, but it is a fault, so it is `[failed]`; an origin with no release tag is a failure, not a fast path refusal. Pinned in Task 5 (`a key already on this Mac is refused, not failed`, `a path someone else claimed is refused, not failed`), Task 6 (the `[refused]` assertions added to the profile flag test and the two live skills-link tests), Task 9 (`no terminal and no --yes is refused, not failed`, the halted run's `[failed]` checksum leg and summary, and `a shared checkout off main is a refused leg and stops the run refused`), Task 10 (`a fast path refusal is refused, not failed` and the endings test's three no-resume cases), Task 12 (`a refusal from locate is a refused line on stderr, and its envelope keeps code refused`) and Task 13 (`a refused store is a refused line, not a failure`).
4. **The release skills still find what they read.** They move to `--json` for `apps --dry-run` and `update-machine`, and verify's reworded details keep `draft`, `missing` and `still propagating`. Pinned in Task 8 (`the words the release skills read are still there`) and Task 10 Step 5's grep.
5. **A warning that fires while a program reads stdout.** `repos status --json` is agent-safe: `rt_verb` parses stdout as one JSON value. A skipped `rt.repoRoots` entry must print on stderr only. Pinned in Task 11 (`a skipped rt.repoRoots entry is shown once in plain words, with the command that looks into it`).
6. **A branch name carrying a right-to-left override in `rt repos status`.** The plain renderer must drop it. Pinned in Task 13 (`a branch name with a right-to-left override prints without it`).
7. **`rt home key export` at a terminal.** The key is a payload: stdout must be the same bytes whether or not a person is watching. Pinned in Task 5 (`key export writes the same bytes at a terminal and in a pipe, and nothing else on stdout`).
8. **The setup app still reads `rt home init`.** `lib/setup/steps/home.ts` runs it with no terminal and reads three things: the last stdout line as the step's detail, the stderr line `failureDetail` picks, and whether `homeInitRemedy` sends you to `gh auth login`, which today keys on the old `failed at step "cloneUserRepo"` header. A clone failure now leads with `INIT_STEP_FAILED.cloneUserRepo`, a constant both sides import, so rewording that title cannot silently drop the remedy. Pinned in Task 7 (`a bare permission denial from the clone step IS auth-shaped`, now fed the new stderr, and `the done detail is home init's ending line without its tag`).
9. **A credential in a clone url.** `--url` and `RT_HOME_URL` are not checked for credentials, and a stage's progress goes to the CLI log. Pinned in Task 6 (`a credential in the clone url never reaches the CLI log`).

## What 5e2 consumes from 5a (fixed contracts, cited from the 5a plan)

```ts
// lib/ui/out.ts
export function note(...blocks: Block[]): void;            // stderr, never follows payloadOnStdout

// lib/ui/warn.ts
export interface ShownWarning { title: string; hint?: string; next?: CellInput }
export interface WarnOptions { context?: Record<string, unknown>; show?: ShownWarning }
export function warn(module: string, message: string, opts?: WarnOptions): void;
export function setWarningLog(log: WarningLog | null, opts?: { quiet?: boolean }): void;
export const __test__: { reset(): void };

// lib/ui/usage.ts
export function usageFailure(title: string, usage: string, why?: string): FailureInput;
```

- `warn` with no log set (a unit test, the daemon) writes `rt: <message>\n` to stderr and shows nothing. With a log set (`cli.ts` sets it), the message is logged and, when `show` is given, one `warn` line is printed on stderr once per process for a given title and hint.
- A plain `out.fail(...)` prints its title with no `[failed]` tag as the first line. A `line` with any status keeps its tag, so a refusal through `out.note(out.line("refused", ...))` prints `[refused] <title>`.
- The dispatcher draws the breadcrumb on stderr before the handler runs; with `out.__test__.setHuman(() => false)` no header appears in any expected string.
- Both renderers drop bidi controls and zero-width characters.

`withTransientStep` (5a) is not used: `home init` is a multi-step run a person watches, so it takes real steps (the controller's ruling 2). From phase 1, already on main: `openStep(title): StepHandle` (`lib/ui/spawn.ts`), whose `sub(text)` line clears when the step ends with `done` and stays when it ends with `fail`, and whose `done(title?, hint?, status?)` and `fail(title?, hint?)` resolve false when the helper died; `interactive()` (`lib/ui/gate.ts`). From phase 2: `logCliEvent(level, module, message, context?)` (`lib/cli-logger.ts`). From 5e1's lane, read only: `withoutUrls(message)` (`lib/team/redact.ts`). For the terminal-path tests, from phase 1: `lib/ui/__tests__/fake-rt-ui.ts` (driven by `RT_UI_BIN` and `RT_UI_FAKE`, `{ record }` to append every line a `steps` helper receives, `{ dieOn: "start" }` to die after `start`) and `__test__.setInteractive(fn)` in `lib/ui/gate.ts`. From phase 4, on main at `19ceaa403`: `captureOut(opts?: { console?: boolean })` in `lib/ui/__tests__/capture-out.ts`, whose result has `clear()` (empties both buffers between two runs in one test; `reset()` does not).

## File Structure

| File | Responsibility after this plan |
|---|---|
| `lib/ui/prompt-secret.ts` (create, by moving `lib/prompt-secret.ts`) | The no-echo prompt, beside the other prompts |
| `lib/prompt-secret.ts` (modify) | A re-export, so `home`, `team` and phase 3's callers keep their import |
| `lib/home/age-key.ts` (modify) | The debug trace through `out.note` |
| `lib/home/init-plan.ts`, `lib/home/snapshot-owners.ts`, `lib/home/materialize.ts`, `lib/home/init-exec.ts` (modify) | Reworded error messages, notes and progress lines; `UnknownProfileFlagError` keeps its profile; `init-exec.ts` exports `INIT_STEP_FAILED`, the failure title per init step |
| `commands/home.ts` (modify) | All six verbs on `out`; the key through `out.payload`; `stage()` for `init`, its progress logged with credentials stripped; refusals through `refuse()` |
| `lib/setup/steps/home.ts` (modify, after phase 3) | `failureDetail`, `homeInitRemedy` and the done detail read `home init`'s new output; the clone check keys on `INIT_STEP_FAILED.cloneUserRepo` |
| `lib/release/preflight.ts`, `verify.ts`, `update-machine.ts`, `release-app.ts` (modify) | Reworded details and error messages; `ReleaseAppSeams.progress(event)` replaces `log(line)`; `formatStep` and `STEP_MARK` go; `qualifyStop(step)` tells the three no-resume qualify stops apart |
| `commands/release.ts` (modify) | Four verbs on `out`; `out.json` for the envelopes; refused rows, a failed checksum leg, and one refusal |
| `skills/rt-release/fast-path.md`, `skills/rt-release/publish-and-finish.md` (modify) | Read `release apps --dry-run` and `release update-machine` through `--json` |
| `lib/repo-index.ts`, `lib/repo-tracking.ts` (modify) | Fifteen warnings through `warn`; the unused picker `color` goes; the missing row's hint loses its dash |
| `commands/repos.ts`, `commands/repos-reidentify.ts` (modify) | Human branches on `out`; one `failPlain` replaced; usage through `usageFailure`; reworded errors; a locate or reidentify refusal as `refused` |
| `lib/repo-locate.ts`, `lib/repo-locate-dispatch.ts`, `lib/repo-reidentify-dispatch.ts` (modify) | Reworded refusal messages; `parseRefusalText` reads a refusal back from `<code>: <message>`; a daemon that does not answer carries a `why` and a `next` |
| `lib/__tests__/raw-output-allowlist.json` (modify) | Seven lines deleted |
| The tests named in each task, `e2e/tests/errors.test.ts`, `e2e/pty/errors.test.ts` (modify) | New copy; captures move from console spies to `captureOut()` |
| `AGENTS.md`, `docs/design/output-layer/` (modify) | Two appended paragraphs; six renders and two real captures of the steps helper |

---

### Task 1: Check that 5a and phase 3 are on main

No code. 5a (`RT-369: output layer phase 5a, layer additions and dispatcher`) must be merged before any task below runs: every task calls its API, and Task 11's copy for the lib warnings is 5a's table. Phase 3 (`RT-369: output layer phase 3, setup`, PR 643) must be merged too: Task 7 edits `lib/setup/steps/home.ts`, which phase 3 rewrites first, and the controller's ruling lets this slice touch it only after that.

**Files:** none.

**Interfaces:**
- Consumes: `origin/main`.
- Produces: a branch rebased on a main that holds 5a, phase 3 and phase 4.

- [ ] **Step 1: Fetch**

Run: `git fetch origin`

- [ ] **Step 2: Look for 5a's files on main**

Run each alone:

- `git cat-file -e origin/main:lib/ui/warn.ts`
- `git cat-file -e origin/main:lib/ui/usage.ts`

Expected: each exits 0 and prints nothing. If either prints `fatal: path ... does not exist`, **stop here and report "5a is not on main"** to whoever dispatched this plan. Do not start Task 2.

- [ ] **Step 3: Look for phase 3 on main**

Run: `git log origin/main --oneline --grep "output layer phase 3"`
Expected: one line, the merge of PR 643. If it prints nothing, **stop here and report "phase 3 is not on main"**. Do not start Task 2: Task 7 may not edit `lib/setup/steps/home.ts` before phase 3 has landed its own copy in it.

- [ ] **Step 4: Rebase onto main**

Run: `git rebase origin/main`

- [ ] **Step 5: Confirm the APIs match what this plan cites**

Read `lib/ui/warn.ts`, `lib/ui/usage.ts`, the `note` function in `lib/ui/out.ts`, `openStep` and `StepHandle` in `lib/ui/spawn.ts`, and `lib/ui/__tests__/capture-out.ts`. Compare with "What 5e2 consumes from 5a" above. Phase 4 merged at `19ceaa403`, so `captureOut` takes `opts?: { console?: boolean }` and its result has `clear()`; this plan's tests call `clear()` where one capture serves several runs. If a name or a parameter differs, main wins: note the difference in your report and use main's form everywhere this plan uses the cited one.

Run: `bun test lib/ui/__tests__/warn.test.ts lib/ui/__tests__/usage.test.ts lib/ui/__tests__/out-plain.test.ts`
Expected: PASS.

Run: `grep -n "commands/home.ts\|lib/home/age-key.ts\|lib/prompt-secret.ts\|commands/release.ts\|commands/repos.ts\|lib/repo-index.ts\|lib/repo-tracking.ts" lib/__tests__/raw-output-allowlist.json`
Expected: seven lines.

Run: `grep -n "export function failureDetail\|export function homeInitRemedy\|CLONE_STEP_STDERR\|async function homeInitRun\|stdout.trim().split" lib/setup/steps/home.ts`
Expected: the two exported readers, the clone-step pattern and its use, `homeInitRun`, and the success detail's last-line read. Phase 3 rewords strings in this file but keeps these five; if one is gone or renamed, Task 7 applies the same edit to what took its place, and the report names it.

---

### Task 2: Audit of the print sites and the copy this plan owns

No code. This is the inventory every later task implements; it stays in the plan. Line numbers are at `5bc69f231`.

**Files read:** `commands/home.ts`, `lib/home/*.ts`, `lib/prompt-secret.ts`, `commands/release.ts`, `lib/release/release-app.ts`, `lib/release/update-machine.ts`, `lib/release/preflight.ts`, `lib/release/verify.ts`, `commands/repos.ts`, `commands/repos-reidentify.ts`, `lib/repo-index.ts`, `lib/repo-tracking.ts`, the tests beside each, `rt-tray/Sources-core/Rt/RtClient.swift`, `rt-tray/Sources-core/Setup/TeamChoiceModel.swift`, `skills/rt-release/*.md`, `skills/mattstack-release/SKILL.md`, `skills/.skillsignore`, `e2e/tests/release-apps.test.ts`.

#### Already on rt-ui (confirming the scoping document)

| Verb | Scoping call | Confirmed | Left for this plan |
|---|---|---|---|
| `home` | partly | Yes. rt-ui draws the machine profile picker, the release picker and the claim text prompt; `promptSecret` reads the key. None changes. | Every result line in six verbs; `init`'s progress becomes rt-ui steps |
| `release` | partly | Yes. rt-ui draws the two confirms (`update-machine` legs, `apps` notes). | Four reports and the `apps` progress lines |
| `repos` | partly | Yes. rt-ui draws the register and locate pickers and the locate confirm. | Result lines in five verbs, fifteen lib warnings |

#### Rule for strings that live under `lib/`

The spec's "Known gaps" says the `lib/` printers behind these verbs are unaudited. They were read for this plan. Four kinds:

1. **A human sentence a person reads, in an envelope or not** (a `lib/release` detail written as a sentence, a `UserActionableError` message, a `lib/home` error message shown as a `why`, a materialize note or failure, an `init-exec` progress line, now a step's sub-line). Reworded in the copy tables below. A command the sentence named moves to `next`, to the step's `command` or to the envelope's `resume` where one of them already carries it; otherwise it stays as the sentence's last words.
2. **Data.** A version pair, a sha, a run id, a count, a file or asset list, a tool's output tail, a caught error's own message (`String(err.message)`) and the `lib/home/snapshot-owners.ts` file-parse errors (the daemon reads them into `ownersError`). Unchanged: a row's hint is where data belongs.
3. **A string only a program reads.** Unchanged: every `code`, `id`, `status`, `resume` and `command`.
4. **A string only a log reads after this plan** (the log `message` of every repo index warning). Unchanged.

#### `commands/home.ts` (69 guard lines)

| Site | Today | Becomes | Task |
|---|---|---|---|
| `:40` | `import { bold, dim, green, red, reset, yellow } from "../lib/ansi.ts"` | removed | 6 |
| `:176-197` `describeStep` | lower-case technical labels | `{ title, hint }` per step kind (Task 6): a plain name with the url, dirs or key as the hint | 6 |
| `:313-340` `ensureHomeAgeKey` mismatches | two long `message` strings | two `FailureInput`s: `This Mac's key cannot open your secrets`, `This Mac's key does not match your secrets`, each with a `why` and `next rt home key import --force` (a key that does not match is a fault, not a refusal) | 6 |
| `:344-347` wrote `.sops.yaml` | two lines with the commit command inline | `line done "Set up secrets for your home repo" "this adds one tracked file"`, `callout next "Commit it:"`, `copy` holding the two git commands | 6 |
| `:350-353` key ready | two lines | `line done "This Mac's secrets key is ready" <truncated recipient>`, `callout next` with `rt home key export` | 6 |
| `:208`, `:245` `InvalidUrlArgError`, `InvalidProfileArgError` messages | `--url requires a value, e.g. --url https://...`, `--profile requires a value, e.g. --profile mbp-14` | `Give it the address of your home repo.`, `Give it the name of a machine profile.`: the `why` under a usage failure, with no flag and no example; the flag is in the failure's `next` (`rt home init --url <remote>`, `rt home init --profile <key>`) | 6 |
| `:364, :589, :672` argument and profile errors | `console.error("rt home init: " + message)`, exit 1 | `out.fail` with a plain title, the lib message (reworded in Task 4) as `why`, and a `next` per error, exit 1 | 6 |
| `:372-373` `printPlan` | `rt home init plan for <home>:` and numbered rows | `section "Setting up your home folder" <home>` of `line pending` rows | 6 |
| `:377-380` skills file in the way, dry run | a paragraph on stderr | `line needs-you "A file is in the way of your skills link" <path>`, `callout fix "Move it aside, then run this again"`, on stdout | 6 |
| `:491-502` materialize results | a header, `✓` or `✗` rows, dim indented text | one stage per refresh step (Task 6), each ending done, skipped, needs-you (mr-board's manual setup, tracked repos not on this Mac yet), warn, or failed for a step rt owns, with its guidance in a `verbatim` under its line | 6 |
| `:523` Claude plugins pointer | one dim line | `paragraph` with the same sentence | 6 |
| `:610-623` dry run on a fresh Mac | the plan and two paragraphs | the plan section and two `note` callouts | 6 |
| `:641, :752` step progress | `console.log("  " + message)` per step | one rt-ui step per plan step through `stage()`; each progress message is the step's sub-line and goes to the CLI log at `debug` through `withoutUrls`, since `Cloning <url>` can carry a token | 6 |
| `:643, :755` step failed | `failed at step "<kind>":` and the stderr | the stage ends `failed`, then `out.fail({ title: INIT_STEP_FAILED[kind] }, verbatim(<stderr lines>, "what it said"))`, exit 1; `INIT_STEP_FAILED` is exported by `lib/home/init-exec.ts` so `lib/setup/steps/home.ts` keys on the same title (Task 7) | 6 |
| `:680-683` profile needed, dry run | one paragraph | `line needs-you "This Mac needs a machine profile" "existing: a, b"`, `callout note` | 6 |
| `:688-690` no profile picked | stderr line, exit 1 | `out.fail({ title: "No machine profile was chosen", next: rt home init --profile <key> })` | 6 |
| `:705-708` profile flags on a keyed Mac (refusal) | stderr paragraph, exit 1 | `refuse("This Mac already has a machine profile", why)`: a `refused` line on stderr, exit 1 | 6 |
| `:729, :791, :798` non-fatal trouble | `console.error`, the run continues | `line warn` on stdout | 6 |
| `:739` nothing to do | `... is already fully provisioned ...` | `line skipped "Nothing to set up" "your home folder is already in place"` | 6 |
| `:746-747` materialize preview | a header and numbered rows | `section "rt would also refresh what it generates from your settings"` of one row per step (pending; skipped for a healthy deck or one the app's helper owns; needs-you for mr-board) | 6 |
| `:764, :769` fatal endings | `console.error`, exit 1 | `out.fail`, exit 1 | 6 |
| `:782` materialize skipped | one dim line | `line skipped "Skipped the refresh of what rt generates from your settings"` | 6 |
| `:806` skills link in the way, live run (refusal) | `console.error`, exit 1 | `refuse("Your home folder is set up, apart from your skills link", why, fix)`, exit 1 | 6 |
| `:810` success | `rt home init: <home> is provisioned.` | `line done "This Mac is set up" <home>` | 6 |
| `:819` key export | `console.log(text)` | `out.payload(text + "\n")`, the same bytes | 5 |
| `:822` no key | stderr line, exit 1 | `out.fail({ title: "This Mac has no secrets key yet", next: rt home init })` | 5 |
| `:889-936` key import (5) | stderr paragraphs, exit 1 or 2 | a key on argv and a key already there are refusals (`refuse(...)`, exit 1); a malformed key and an unreadable input are failures (exit 1); a recipient mismatch is a failure (exit 2) | 5 |
| `:939-940` key import success | `✓ imported` and a dim line | `line done "Imported your secrets key" <truncated>`, `callout note "Secrets locked to this key can now be opened on this Mac"` | 5 |
| `:955` daemon down | yellow line, exit 1 | `out.fail({ title: "The rt daemon is not running", next: rt daemon start })` | 5 |
| `:966-974` snapshot result | dim or green lines | `line skipped "Nothing was saved" <reason>`, `line skipped "Nothing has changed since the last save"`, or `line done "Saved your home repo" <sha>` and `kv paths` | 5 |
| `:978-1002` snapshot status | an icon line and ten dim, yellow or red lines | `line running` or `off`, five `kv`, and a `line warn` per error field | 5 |
| `:1014, :1024` daemon error | stderr line, exit 1 | `out.fail`, hint is the daemon's error | 5 |
| `:1064, :1083, :1106, :1110, :1138, :1150` claim and release | stderr lines, exit 1 | usage through `usageFailure`; an invalid path is a failure; a path someone else claimed is a refusal (`refuse(...)`); exit 1 throughout | 5 |
| `:1116-1117, :1157-1162` claim and release results | `✓ claimed`, `✓ released`, dim lines | `line done "Claimed <zone>" "for <owner>"`, `line done "Released <zone>" "was claimed by <owner>"`, `line skipped "Nothing to release" "<zone> is not claimed"`, each with a `note` callout | 5 |

Every command named in a `next` exists in `lib/command-tree-def.ts`: `rt home init`, `rt home key import`, `rt home key export`, `rt home claim`, `rt home release`, `rt daemon start`, `rt daemon status`, `rt repos locate`, `rt repos prune`, `rt repos status`, `rt repos register`, `rt repos reidentify`, `rt settings check`, `rt settings get`, `rt release apps`, `rt release verify`, `rt release update-machine`.

#### `lib/home/age-key.ts` and `lib/prompt-secret.ts` (1 guard line each)

| Site | Today | Becomes | Task |
|---|---|---|---|
| `lib/home/age-key.ts:295` | `if (CLI_DEBUG) console.error("[age-key] " + argv)` | `if (CLI_DEBUG) out.note(out.kv("age-key", argv))`: still stderr, still only under `RT_LOG_LEVEL=debug`, still redacted first | 3 |
| `lib/prompt-secret.ts:29` | the default writer is `process.stdout.write` | the file moves to `lib/ui/prompt-secret.ts`, unchanged; `lib/prompt-secret.ts` re-exports it (decision 4) | 3 |

#### `commands/release.ts` (14 guard lines) and `lib/release/release-app.ts`

| Site | Today | Becomes | Task |
|---|---|---|---|
| `:98, :118, :199, :296` envelopes | `console.log(JSON.stringify(envelope(...)))` | `out.json(envelope(...))`, the same bytes | 9, 10 |
| `:103-109` preflight | mark rows, `gate:`, a counts line | `line` per row (ok done, stale stale, error warn), `kv gate`, `summary` with the three counts | 9 |
| `:123-129` verify | a header, mark rows, a counts line | `section "Release <tag>"` of `line` rows (pending rows pending), `summary` with the four counts | 9 |
| `:189-191` update-machine expected failure | `exitUserError` for every code | unchanged, except `update-machine-noninteractive`, which a person reads as a `refused` line (exit 2, same envelope) | 9 |
| `:204-208` update-machine | mark rows and `tag <t>: <summary>` | `line` per leg (ok done, skipped skipped, aborted refused, error failed, planned pending; the prod app's aborted leg, a checksum that does not match, is failed: bad bytes are a fault), `summary "tag <t>"` whose count text is `clean`, `plan only, nothing changed`, `stopped at <leg>` or `problems above`, refused only when the leg that stopped it is drawn refused | 9 |
| `:234` `log` seam | writes a preformatted line to stdout, or stderr under `--json` | `progress(event)` prints blocks through `out.print`; `--json` calls `out.payloadOnStdout()` first, so progress lands on stderr | 10 |
| `:244, :278` apps usage | `usage: rt release apps ...` as the failure title | `--json`: unchanged. Human: `usageFailure("This command takes no app name", ...)` or `usageFailure("The notes hash is the 12 characters a stopped run printed", ...)` | 10 |
| `:246-263, :297` apps summary | one sentence per status | `summary` per status, the resume command as a `next` callout; a `declined` report with no resume is one of three qualify stops, told apart by `qualifyStop`: main does not qualify (a refused line through `out.note`), nothing has moved (a skipped line on stdout), origin has no release tag (a failure on stderr: an environment problem, not a refusal) | 10 |
| `release-app.ts:123-126` `STEP_MARK`, `formatStep` | glyph strings built in lib | deleted; the command maps `StepStatus` to a status (a stopped qualify step is refused) | 10 |
| `release-app.ts:381, :408, :504, :509` | `seams.log(<string>)` | `seams.progress({ kind: "watching" | "step" | "notes", ... })` | 10 |

#### `commands/repos.ts` (8 guard lines, 21 seam calls) and `commands/repos-reidentify.ts` (6 seam calls)

| Site | Today | Becomes | Task |
|---|---|---|---|
| `repos.ts:37` | `print: (s) => console.log(s)` | `(s) => out.payload(s + "\n")` | 12 |
| `:89, :95, :103, :241, :300, :306, :316` usage refusals | `exitUserError(usage ...)` in both modes | `--json`: unchanged. Human: `usageFailure` with a plain title (Task 12 lists the seven) | 12 |
| `:118, :121, :146` register errors | `"<path>" does not exist`, `... is not a git repository`, and `locate-failed` with a long dash | reworded per rows P1 to P3 of the repos copy table, through `exitUserError` as today; codes kept | 12 |
| `:308-311` `--repo` resolution (`repo-unknown`) | `resolveRepoArg`'s two messages, which name the flag and carry a long dash | the command calls `tryResolveRepoArg` (same file, no exit) and words its own two errors, P4 and P5; `lib/repo-arg.ts` is shared with other verbs and is not edited | 12 |
| `:326-328` a locate that did not go through | every `!outcome.ok` through `exitUserError("refused", ...)`: a coral failure | `--json`: unchanged (code `refused`, the outcome's error as `message`, reworded by rows L1 to L10). Human: a refusal from `planLocate` (`parseRefusalText` finds its code) is `out.note(out.line("refused", ...))`, exit 2; a daemon that does not answer (D1) and an apply that did not finish stay failures, with the outcome's `why` and `next` | 12 |
| `:168-173` register | `registered <name> (<path>)` | `line done "Registered <name>" <path, plus tracking>` | 12 |
| `:251-265` prune | `repo index is clean ...` or one sentence per row | `line skipped "Nothing to prune"`, or per row `line done "Removed <label>"`, `line pending "Would remove <label>"`, `line warn` or `needs-you "Kept <label>"` with a `next` callout holding the command | 12 |
| `:336-340` locate, dry run | five lines | `line pending "Would move <label>" "<old> → <new>"` and four `kv` | 12 |
| `:349-356` locate | a line, a counts line, stale and legacy lines | `line done "Moved <label>"`, `kv updated`, `line stale` per stale record, `line done` or `warn` per legacy row | 12 |
| `:366` nothing lost, exit 1 | stdout line | `out.fail({ title: "No repo is missing", why: ... })`, exit 1 | 12 |
| `:375-379` lost rows, no path, exit 1 | `missing repos:` list and a usage hint on stdout | `out.fail(usageFailure("Which folder did it move to?", ...), section "Missing repos" with a table)`, exit 1 | 12 |
| `:404-408` `failPlain` | the third copy (shared item 11) | deleted; `repos status` builds its own two failures | 13 |
| `:430` status envelope | `console.log(JSON.stringify({ ok: true, ... }))` | `out.json({ ok: true, ... })` | 13 |
| `:434-453` status | a label line, `sweep error`, one row per worktree | `tree` per repo (branch as `key`, dirt, position, path dim), `line warn` for a sweep error; empty: `line pending "No repo status yet"` and `next rt repos status --refresh` | 13 |
| `repos-reidentify.ts:28` | `deps = { print: console.log }` | `{ print: (line) => out.payload(line + "\n") }` | 13 |
| `:43-45` no report (a daemon that does not answer, a bad identity) | `exitUserError("refused", outcome.error)` | the same, now carrying the outcome's `why` and `next` (D2) | 13 |
| `:33, :37` usage | usage inside the failure title | `usageFailure`; `e2e/tests/errors.test.ts` and `e2e/pty/errors.test.ts` assert this text and move with it | 13 |
| `:42-54` a store refused (refusal) | `refused, partly moved ...` lines on stdout, then a failure block | `--json`: unchanged. Human: `out.note(out.line("refused", ...), storeTable)` on stderr, exit 2, no failure block | 13 |
| `:23-26, :62-66` report | hand-padded table and two sentences | `line` (skipped, pending or done) and a `table` of stores | 13 |

Usage sites: 7 in `repos.ts` (the scoping document counted 3 lines containing `usage:`) and 2 in `repos-reidentify.ts`.

#### `lib/repo-index.ts` (10 guard lines) and `lib/repo-tracking.ts` (6)

Rows 6 to 20 of 5a's warnings table, applied as written there. Nine are log only; six are shown:

| 5a row | Site | Decision | Shown copy |
|---|---|---|---|
| 6 to 11 | `repo-index.ts:122, 572, 576, 660, 687, 736` | log only | |
| 12 | `repo-index.ts:825` | show | `Your repo folders setting could not be read` / `rt is looking in its usual places only` / `rt settings check` |
| 13 | `repo-index.ts:836` | show | `A repo folder in your settings is not a path` / `<json> was skipped` / `rt settings get rt.repoRoots` |
| 14 | `repo-index.ts:841` | show | `A repo folder in your settings does not exist` / `<entry> was skipped` / `rt settings get rt.repoRoots` |
| 15 | `repo-tracking.ts:145` | show | `The team's repo tracking setting could not be read` / `only your own tracking applies` / `rt settings check` |
| 16 | `repo-tracking.ts:173` | show | `Your repo tracking setting could not be read` / `no repo is tracked until it is fixed` / `rt settings check` |
| 17 | `repo-tracking.ts:187` | show | `Your repo tracking setting is in an old shape` / `rt is reading the repos inside it for now` / `rt settings get rt.repoTracking` |
| 18 to 20 | `repo-tracking.ts:367, 372, 397` | log only | |

The tenth guard line in `lib/repo-index.ts` is not a warning: line 33 imports `dim` from `lib/ansi.ts` for the `color` field `repoOption` puts on a picker row. `lib/pick-wrappers.ts` documents that field as unused and never reads it, so dropping it changes nothing a person sees (decision 5). The same function's missing-row hint (`repo-index.ts:1364`) carries a long dash a picker shows; it is row P6 of the repos copy table.

Tests that spy on `console.warn` for these lines and go silent once they move: `lib/__tests__/repo-index.test.ts` (three assertions), `lib/daemon/__tests__/repo-tracking.test.ts` (two tests). `lib/__tests__/repo-index-rename.test.ts:627`, `lib/daemon/__tests__/project-mrs-store.test.ts`, `discussions-file-store.test.ts`, `worktree-reconciler.test.ts` and `lib/worktree/__tests__/registry.test.ts` spy on phase 6's lines and are not touched.

#### Copy table: `lib/home`

For Matt to skim, the way phase 3 laid out its setup copy. "Today" quotes the string, shortened with "..." where it runs long or holds a long dash this document may not contain. `<x>` marks a value the code fills in. "Read by" names who sees it: "terminal" is the line or failure `rt home` prints, "tray" is the setup screen's `home init --dry-run` check (`TeamChoiceModel.homeInitCheck`, the first 200 bytes of stderr on a nonzero exit).

| # | Site | Today | Becomes | Read by |
|---|---|---|---|---|
| H1 | `init-plan.ts:73` `InvalidMachineKeyError` | `"<key>" is not a safe machine-key segment (empty, ".", "..", or containing "/" or "\")` | `"<key>" cannot name a Mac: a name cannot be empty, ".", "..", or hold a slash or a backslash.` | terminal `why`, tray |
| H2 | `init-plan.ts:99-102` `UnknownProfileFlagError` | `--profile <p> isn't one of the existing profiles (<list>) ... pass --new-profile as well to create it.` | `There is no machine profile called <p> yet (the profiles are <list>). Name it as a new profile to create it.` (with no profiles: `(there are none yet)`); the class keeps `readonly profile` so the command's `next` is `rt home init --profile <p> --new-profile` | terminal `why`, tray |
| H3 | `init-plan.ts:109-112` `ProfileChoiceRequiredError` | `<n> existing machine profile(s) (<list>) and no terminal to prompt on ... pass --profile <key> to adopt one, or --new-profile to start a new one.` | `This Mac could use any of <n> machine profiles (<list>), and there is no terminal to ask which.` | terminal `why`, tray |
| H4 | `init-plan.ts:119` `InvalidProfileKeyError` | `"<key>" is not a safe machine-profile key (...)` | `"<key>" cannot name a machine profile: a name cannot be empty, ".", "..", or hold a slash or a backslash.` | terminal `why`, tray |
| H5 | `init-plan.ts:132-136` `ProfileNameCollisionError` | `--new-profile's default name ("<slug>") is already an existing profile ... Pass --profile <name> --new-profile with a distinct name.` | `This Mac's default profile name, <slug>, already belongs to another Mac's profile. Give the new profile a name of its own.` | terminal `why`, tray |
| H6 | `snapshot-owners.ts:37` `InvalidZoneError` | `"<zone>" is not a valid snapshot zone (must be non-empty, no leading "/", no backslash, no "." or ".." segment)` | `"<zone>" is not a path rt can track: a path must not be empty, start with a slash, hold a backslash, or have a "." or ".." part.` (claim and release both throw it, so it names neither) | terminal `why` |
| H7 | `snapshot-owners.ts:44` `ZoneOwnedByOthersError` | `"<zone>" is already claimed by <owner> ... pass force to reassign it` | `"<zone>" is already claimed by <owner>` (the command's refusal names the command) | terminal |
| H8 | `snapshot-owners.ts:107, :113, :117, :226` | the owners file's parse errors, each naming its path | unchanged: data the daemon puts in `ownersError`, shown as a hint | terminal hint |
| H9 | `materialize.ts:103-110` `failureMessage` | ``could not run `<bin>` `` then a long dash and `not found` or `is it on PATH?` | `rt could not find <bin> to run it` (an absolute path) or `rt could not run <bin>: is it installed and on your PATH?` (a bare command) | terminal `verbatim` |
| H10 | `materialize.ts:141` note | `deck healthy` then a long dash and `setup skipped` | `deck is already running well, so rt left it alone` | terminal `verbatim` |
| H11 | `materialize.ts:146` stderr | `deck is unhealthy and <label> (the app's deck helper) owns it, so deck setup was not run (...); if the helper is not registered run rt services register, else inspect it with launchctl print gui/$(id -u)/<label>` | three lines: `The app's deck helper owns deck, and deck is not healthy, so rt did not run deck setup: it would add a second copy.`, `If the helper is not registered: rt services register`, `To look at it: launchctl print gui/$(id -u)/<label>` | terminal `verbatim` |
| H12 | `materialize.ts:151` note | `run manually (interactive): cd "<repo>" && bun run scripts/setup.ts` | `Run this yourself, it asks questions: cd "<repo>" && bun run scripts/setup.ts` | terminal `verbatim` |
| H13 | `init-exec.ts:57` | `<label> already present` then a long dash and `leaving it` | `<label> is already there, so rt left it` | terminal sub-line, CLI log |
| H14 | `init-exec.ts:60` | `seeding <label>` | `Adding <label>` | same |
| H15 | `init-exec.ts:68` | `creating <dir>/` | `Creating <dir>/` | same |
| H16 | `init-exec.ts:74` | `cloning <url> into user/` | `Cloning <url>` | same |
| H17 | `init-exec.ts:79` | `initialising user/ as a local repo (no remote)` | `Starting a repo with no remote` | same |
| H18 | `init-exec.ts:84` | `committing the initial user/ tree` | `Committing the first version` | same |
| H19 | `init-exec.ts:116` | `writing machine-key (<key>)` | `Naming this Mac <key>` | same |
| H20 | `init-exec.ts:121` | `creating user/local/<key>/` | `Creating the profile folder for <key>` | same |
| H21 | `init-exec.ts:133` | `linking skills.jsonc -> user/skills.jsonc` | `Linking your skills list` | same |
| H24 | `init-exec.ts:128` `StepFailed` | `a real file already exists at skills.jsonc` then a long dash and `refusing to overwrite it` | `A real file is already at skills.jsonc, and rt will not overwrite it` | terminal `verbatim` under a failure |
| H22 | `age-key.ts:94, :103, :113, :138, :145, :151, :199, :209` | `security` and `age-keygen` failures with the tool's stderr | unchanged: tool output, shown as a hint under a title `commands/home.ts` writes | terminal hint |
| H23 | `age-key.ts:237` `AgeKeyAbsentError` | no message | unchanged; the command writes the title | |

Count: 24 rows, 21 reworded (H1 to H7, H9 to H21, H24); H8, H22 and H23 stay. H24 sits before H22 because it belongs with the other `init-exec.ts` rows. `commands/home.ts`'s own strings are new copy throughout and are listed in the table above with the task that writes them.

#### Copy table: `lib/release`

A row's `detail` is its hint under the row's label. The rule: data stays (kind 2 above); a detail written as a sentence telling the person what happened or what to do is reworded, and a command it names moves to the step's `command` or the envelope's `resume` where one already carries it, or stays as its last words. `<x>` marks a value the code fills in. "Read by": "terminal" is the row `rt release` prints, "skill" is the release skills reading `--json`, which quote details to Matt and classify verify's stale rows by them.

| # | Site | Today | Becomes | Read by |
|---|---|---|---|---|
| R1 | `verify.ts:91` | `resolved <tag> as the latest local v* tag` | `<tag> is the newest release tag on this Mac` | terminal, skill |
| R2 | `verify.ts:98` | `resolved <tag> via the newest GitHub release (no local v* tag found)` | `<tag> is the newest release on GitHub; this Mac has no release tag` | terminal, skill |
| R3 | `verify.ts:100` | `could not resolve a default tag: <err>` | `rt could not tell which tag to check: <err>` | terminal, skill |
| R4 | `verify.ts:102` | `could not resolve a default tag: no local v* tag and the GitHub API found nothing` | `rt could not tell which tag to check: there is no release tag on this Mac or on GitHub` | terminal, skill |
| R5 | `verify.ts:165` | `run <id> completed with conclusion "<c>"; recovery: gh release delete <tag> (the git tag survives) then gh run rerun <id> --failed` | `Run <id> ended "<c>". To recover, delete the GitHub release (the tag stays), then rerun its failed jobs: gh release delete <tag>, then gh run rerun <id> --failed` (no other field carries the two commands, so they stay as the last words) | terminal, skill |
| R6 | `verify.ts:171` | `could not reach gh to check run <id> in <n> attempt(s); rerun rt release verify to recheck` | `rt could not reach GitHub to check run <id> after <n> tries. Check again with: rt release verify` | terminal, skill (an error row reruns verify) |
| R7 | `verify.ts:174-176` | `run <id> still <status> after <n> check(s)<note>; rerun rt release verify to recheck`, the note ` (<k> transient poll error(s) tolerated)` | `Run <id> is still <status> after <n> checks<note>. Check again with: rt release verify`, the note ` (<k> of them could not reach GitHub)` | terminal, skill |
| R8 | `verify.ts:218` | `release body does not match the committed RELEASE_NOTES.md at <tag>; recompare git show ... against gh release view ... If the notes commit was wrong, the fix is a new tag; never gh release edit.` | `The release's notes do not match the committed RELEASE_NOTES.md at <tag>. If the committed notes were wrong, the fix is a new tag: never edit the release by hand. To compare them: git show <tag>:RELEASE_NOTES.md and gh release view <tag> --json body` | terminal, skill |
| R9 | `verify.ts:232` | `missing asset(s): <list>; hand-completion recipe lives in the rt:mattstack-release skill` | `missing assets: <list>. The rt:mattstack-release skill finishes them by hand.` (keeps `missing`) | terminal, skill |
| R10 | `verify.ts:274` | `release is still a draft; releases/latest will not resolve to it until it is flipped public` | `The release is still a draft, so the latest-release link will not point at it until it is public.` (keeps `draft`) | terminal, skill |
| R10b | `verify.ts:239` state problem | `still a draft (recovery: gh release edit <tag> --draft=false)` | `still a draft. To publish it: gh release edit <tag> --draft=false` (keeps `draft`; the command stays, as nothing else carries it) | terminal, skill |
| R11 | `verify.ts:286` | `still propagating (published <m>m ago; the endpoint can lag up to ~20m behind the flip)` | `still propagating: published <m> minutes ago, and the latest-release link can lag about 20 minutes behind` (keeps `still propagating`) | terminal, skill |
| R12 | `update-machine.ts:120` `update-machine-bad-tag` | `--tag must look like a released tag (v<major>.<minor>.<patch>), got "<x>"` | message `"<x>" is not a release tag`; why `A release tag looks like v2.19.0.` | terminal |
| R13 | `update-machine.ts:126` | `could not resolve the latest released tag: <tail>` | message `rt could not find the latest release: <tail>` (gh's output tail is data and stays at the end of the envelope's message, which the skill now reads) | terminal, skill |
| R14 | `update-machine.ts:129` | `gh api returned no tag_name for the latest release` | message `GitHub did not name the latest release` | terminal |
| R15 | `update-machine.ts:136` | `could not resolve the commit for <tag>: <tail>` | message `rt could not find the commit for <tag>: <tail>` (the tail stays, as in R13) | terminal, skill |
| R16 | `update-machine.ts:139` | `gh api returned no sha for <tag>` | message `GitHub did not give the commit for <tag>` | terminal |
| R17 | `update-machine.ts:532` `dev-app-bad-ref` | `the ref must be a branch, tag, or sha of <repo> (for a PR, its branch name), got "<ref>"` | message `"<ref>" is not a branch, tag or commit of the release repo`; why `For a pull request, use its branch name.` | terminal |
| R18 | `update-machine.ts:769` `update-machine-plan-verify-only` | `--plan and --verify-only are mutually exclusive; pick one` | message `A run can plan or check, not both` | terminal |
| R19 | `update-machine.ts:800-803` `update-machine-noninteractive` (refusal) | `refuses to run state-changing legs on a non-interactive terminal without --yes` | message `rt will not change this Mac without a terminal to confirm each step`; why `Approve every step up front to run it anyway.`; next `rt release update-machine --yes` | terminal |
| R20 | `update-machine.ts:227` leg `aborted` | `<path> is on branch "<b>", not main; refusing to touch a shared checkout` | `The shared checkout is on <b>, not main, so rt left it alone` | terminal (a refused row), skill |
| R21 | `update-machine.ts:597` leg `aborted` | `chat announce in #<room> failed after <n> attempts; refusing to restart the daemon` | `The announcement in #<room> failed <n> times, so rt did not restart the daemon` | terminal (a refused row), skill |
| R22 | `update-machine.ts:745-760` `describePlannedLeg` | six plans naming flags and paths, such as `download and sha256-verify the <tag> dmg, then move-aside-replace <path> (never launched)` | prod-app `Download the <tag> app, check its checksum, and swap it in for the installed one without opening it`; dev-bundle `Build the dev app at <tag> in a scratch folder, quit the running copy, swap the new one in and open it`; checkout-sync `Pull main into the shared checkout and install its packages`; daemon `Announce in #<room>, then restart the rt daemon and check that it runs <tag>`; served-suite `Register any app whose entry does not match the shared checkout, then restart every managed app`; verify `Check the app version, the dev app, the daemon, deck and every managed app` | terminal, skill (shows them at its approval gate) |
| R23 | `update-machine.ts:813` leg `skipped` | `not run: halted after <label> failed` | `Not run: the run stopped at <label>` | terminal, skill |
| R24 | `update-machine.ts:817` leg `skipped` | `declined at the confirmation prompt` | `You said no at the prompt` | terminal, skill |
| R25 | `release-app.ts:180` qualify | `origin has no vX.Y.Z tag; run this from an rt checkout` | `origin has no release tag. Run this from an rt checkout.`, held in the constant `NO_RELEASE_TAG` so `qualifyStop` can tell this stop from a fast path refusal: it is an environment problem, drawn as a failure | terminal, skill |
| R25b | `release-app.ts:239` qualify | `nothing has moved since <tag>` | unchanged (`release-app-run.test.ts:495, :551` read it); its prefix becomes the constant `NOTHING_MOVED`, and `qualifyStop` reads it as nothing to release, drawn skipped | terminal, skill |
| R26 | `release-app.ts:247` qualify | `<tag> has not verified yet (<summary>); run rt release verify <tag> first` | `<tag> has not verified yet (<summary>), so check it first` (the `resume` carries `rt release verify <tag>`) | terminal, skill |
| R27 | `release-app.ts:251` qualify | `not a fast-path diff since <tag>: <reason>` | `Main does not qualify for the fast path since <tag>: <reason>` (keeps the reason) | terminal, skill, `e2e/tests/release-apps.test.ts:136` |
| R28 | `release-app.ts:330` | `not allowed to update main (<reason>); check the gh token's scopes and the branch protection. Nothing changed` | `rt is not allowed to update main (<reason>). Check the GitHub token's scopes and the branch protection. Nothing changed.` | terminal, skill |
| R29 | `release-app.ts:332` | `could not update main (<reason>); it is still at <sha>, so a rerun retries. Nothing changed` | `rt could not update main (<reason>). It is still at <sha>, so running again retries. Nothing changed.` | terminal, skill |
| R30 | `release-app.ts:480` notes, planned | `generate RELEASE_NOTES.md for <a>..origin/main, approve them (--yes-notes <hash> off a terminal), commit them on main` | `Write the release notes for <a>..origin/main, get them approved, and commit them on main` | terminal, skill |
| R31 | `release-app.ts:505` notes, stopped | `--yes-notes <h> does not match these notes (hash <h2> for <tag>): these notes need approval, nothing committed` | `The approved hash <h> does not match these notes (<h2> for <tag>). They need approval again; nothing was committed.` | terminal, skill |
| R32 | `release-app.ts:511` notes, stopped | `the notes for <tag> (hash <h>) need approval; nothing committed` | `The notes for <tag> (hash <h>) need your approval. Nothing was committed.` | terminal, skill |
| R33 | `release-app.ts:523` notes, stopped | `declined at the prompt; nothing committed` | `You said no at the prompt. Nothing was committed.` | terminal, skill |
| R34 | the rest of `preflight.ts`, `verify.ts`, `update-machine.ts`, `release-app.ts` details and `dev-app-stage.ts` messages | pins, versions, shas, run ids, counts, asset lists, tool tails, `String(err.message)` | unchanged: data (kind 2) | terminal hint, skill |

Count: 36 rows, 34 reworded; R25b and R34 stay.

#### Copy table: `repos`

The strings `rt repos` shows that its own code or the locate and reidentify libraries write. Every one rides in a `--json` envelope as an error `message` whose `code` stays (`bad-path`, `not-a-git-repo`, `locate-failed`, `repo-unknown`, `refused`); a locate refusal keeps its `<code>: ` prefix, which `lib/__tests__/repo-locate-heal.test.ts:132` and the daemon handler's wire form carry. A command the sentence named moves to `next` where the error can carry one; otherwise it stays as the last words. `<x>` marks a value the code fills in.

| # | Site | Today | Becomes | Read by |
|---|---|---|---|---|
| P1 | `commands/repos.ts:118` `bad-path` | `"<path>" does not exist` | `There is no folder at <path>` | terminal title, envelope |
| P2 | `commands/repos.ts:121` `not-a-git-repo` | `"<path>" is not a git repository` | message `<path> is not a git repo`; why `rt can only register a folder that git tracks.` | terminal, envelope |
| P3 | `commands/repos.ts:146` `locate-failed` | `"<name>" is indexed at a path that no longer exists, and moving it to <real> failed` then a long dash and the error | message `rt could not move <name> to <real>: <error>` (the error is data, kept at the end); why `rt knows it at a folder that is gone, and moving its records did not finish.` | terminal, envelope |
| P4 | `commands/repos.ts:310` `repo-unknown`, more than one match (from `lib/repo-arg.ts:88`) | `--repo "<arg>" matches more than one repo: <list>` then a long dash and `pass the full identity` | message `"<arg>" could be more than one repo`; why `It matches <list>.`; next `rt repos locate <new-path> --repo <identity>` | terminal, envelope |
| P5 | `commands/repos.ts:310` `repo-unknown`, no match (from `lib/repo-arg.ts:90`) | `--repo "<arg>" did not match a known repo` then a long dash and `pass --repo <name> or run from inside a registered repo` | message `rt does not know a repo called "<arg>"`; why `Name a repo rt has registered, or run this from inside one.` | terminal, envelope |
| P6 | `lib/repo-index.ts:1364` `repoOption`, a missing row's picker hint | `missing` then a long dash and `rt repos locate` | `missing, rt repos locate finds it` | picker row |
| L1 | `lib/repo-locate.ts:181` `not-a-git-repo` | `<path> is not a git repository` | `<path> is not a git repo` | terminal, envelope |
| L2 | `lib/repo-locate.ts:184-187` `not-main-worktree` | `<path> is a linked worktree, not the repo's main worktree` then a long dash and why | `<path> is one of a repo's worktrees, not the repo's own folder. rt moves every record onto the folder you name, so name the main one.` | terminal, envelope |
| L3 | `lib/repo-locate.ts:196` `nothing-lost` | `--repo <name> is not in the repo index` | `rt does not know a repo called <name>` | terminal, envelope |
| L4 | `lib/repo-locate.ts:199` `old-path-exists` | `<name> is indexed at <path>, which still exists` then a long dash and `that is a second clone, not a move` | `<name> is still at <path>, so this folder is a second copy, not a move` | terminal, envelope |
| L5 | `lib/repo-locate.ts:205` `nothing-lost` | `<identity> is already indexed at <path>` | `rt already knows <label> at <path>` (`<label>` is `repoLabel(identity)`) | terminal, envelope |
| L6 | `lib/repo-locate.ts:206` `old-path-exists` | `<identity> is already indexed at <path>, which still exists` then a long dash and the same clause as L4 | `<label> is still at <path>, so this folder is a second copy, not a move` | terminal, envelope |
| L7 | `lib/repo-locate.ts:211` `nothing-lost` | `no indexed repo is missing from disk, so <path> has nothing to be located as` | `No repo rt knows is missing, so there is nothing for <path> to be` | terminal, envelope |
| L8 | `lib/repo-locate.ts:214-217` `identity-changed` | three sentences on path identities, a long dash, and `Register the new path instead: rt repos register <path>` | `<path> has no remote, so rt knows a repo like this by its folder, and moving it makes it a new repo. Register the new folder instead: rt repos register <path>` (nothing else carries the command, so it stays as the last words) | terminal, envelope |
| L9 | `lib/repo-locate.ts:219-222` `identity-mismatch` | `<path> derives <identity>, which matches no indexed repo whose path is missing (lost rows: <list>)` | `<path> holds <label>, and no missing repo rt knows is <label>. The missing ones are <list>.` | terminal, envelope |
| L10 | `lib/repo-locate.ts:225-228` `identity-mismatch` | `<path> derives <identity> (indexed at <old>), but --repo names <name> at <path2>` then a long dash and `locate matches by identity, never by name` | `<path> holds <label>, but the repo you named is <name>. rt matches a move by what a repo is, not by its name.` | terminal, envelope |
| D1 | `lib/repo-locate-dispatch.ts:53` | `the rt daemon is present but did not answer repos:locate; not applying locally (would race the worktree reconciler)` then a long dash and `check rt daemon status and retry` | error `The rt daemon is running but did not answer`; why `rt will not move the repo itself while the daemon holds its records: the two would race.`; next `rt daemon status` | terminal, envelope |
| D2 | `lib/repo-reidentify-dispatch.ts:28` | the same sentence for `repos:reidentify` | error `The rt daemon is running but did not answer`; why `rt will not move this repo's data itself while the daemon holds it: the two would race.`; next `rt daemon status` | terminal, envelope |

Count: 18 rows, all reworded. The `<code>: ` prefix on L1 to L10 is not copy: the dispatcher and the daemon handler both add it, and `parseRefusalText` strips it for a person. `lib/repo-locate.ts`'s apply errors (`verifyLocate`, `repairGit`: git's own output and paths) are data and stay. The `usage` messages in `--json` stay as today (Task 12's `refuseUsage` keeps them); a person gets `usageFailure` instead.

#### Readers of the reworded strings and of the text this plan changes

| Reader | What it reads | How this plan keeps it working |
|---|---|---|
| `rt-tray/Sources-core/Setup/TeamChoiceModel.swift:260-264` (`homeInitCheck`) | `home init --dry-run --json`: the exit code, and on failure the first 200 bytes of stderr with newlines turned into spaces | exit codes unchanged; stderr's first line is the failure title (Review Focus 1). H1 to H5 read right there |
| `lib/setup/steps/home.ts` (`homeInitRun`, `failureDetail`, `homeInitRemedy`) | `rt home init` with no terminal: the last stdout line as the done detail; on failure the stderr line that names an error, carrying a header that ends in `:`; the `failed at step "cloneUserRepo"` header to send a bare permission denial to `gh auth login` | Task 7, after phase 3: the done detail drops the plain tag; `failureDetail` joins a known init failure title to the line under it; the clone check keys on `INIT_STEP_FAILED.cloneUserRepo`, imported from `lib/home/init-exec.ts` (Review Focus 8) |
| `lib/__tests__/repo-locate-dispatch.test.ts:78, :113`, `lib/__tests__/repo-reidentify-dispatch.test.ts:69` | the daemon-did-not-answer outcome, whole or by substring | Tasks 12 and 13 update each to D1 and D2, with the new `why` and `next` |
| `lib/__tests__/repo-locate-heal.test.ts:132` | a locate outcome's error contains `identity-changed` | the `<code>: ` prefix stays (L8 changes only the message after it) |
| `skills/rt-release/fast-path.md` | `rt release apps --dry-run` as text ("Dry run qualifies?") | moves to `--json` (Task 10) |
| `skills/rt-release/publish-and-finish.md` | `rt release update-machine --plan` and `--yes` as text; verify `--json` rows, classifying stale rows by `draft`, `missing` and the run's label | update-machine moves to `--json` (Task 10); R9, R10 and R11 keep the words |
| `skills/mattstack-release/SKILL.md:201`, `:239` | verify `--json`, `pending` rows `still propagating` | R11 keeps the phrase |
| `e2e/tests/release-apps.test.ts:136` | the qualify step's `detail` contains the gate reason | R27 keeps the reason |
| `e2e/tests/errors.test.ts`, `e2e/pty/errors.test.ts` | the reidentify usage text | move with the copy in Task 13 |
| `lib/mcp/rt-verb.ts` (`rt_verb`) | `repos status --json` as one JSON value | unchanged envelope; warnings on stderr (Review Focus 5) |
| `lib/home/__tests__/*.test.ts`, `lib/release/__tests__/*.test.ts`, `commands/__tests__/home.test.ts`, `commands/__tests__/release-*.test.ts`, `commands/__tests__/repos*.test.ts`, `lib/__tests__/repo-index-missing.test.ts` | the old strings, in assertions | Tasks 4, 5, 6, 8, 9, 10, 11, 12 and 13 update each assertion on a reworded string |

---

### Task 3: The secret prompt moves beside the other prompts; the age-key trace goes through `out.note`

**Files:**
- Create: `lib/ui/prompt-secret.ts` (by moving `lib/prompt-secret.ts`)
- Modify: `lib/prompt-secret.ts` (becomes a re-export)
- Modify: `lib/home/age-key.ts:289-296`
- Modify: `lib/__tests__/raw-output-allowlist.json`

**Interfaces:**
- Consumes: `out.note`, `out.kv` (`lib/ui/out.ts`).
- Produces: `lib/prompt-secret.ts` still exports `promptSecret(message, io?, opts?)`, `PromptIO`, `PromptStdin` and `PromptSecretOptions`, unchanged, so `commands/home.ts`, `commands/team.ts` and phase 3's `commands/secrets.ts`, `commands/logins.ts` and `commands/setup.ts` need no edit.

rt-ui has no masked prompt, and Go is 5a's alone, so the prompt cannot move onto the helper in this slice. It writes one mask character per keystroke to a terminal it holds in raw mode, which is a prompt's job and not output. It belongs with the other prompts under `lib/ui/`, which the guard exempts as the output layer.

- [ ] **Step 1: Move the file**

Run: `git mv lib/prompt-secret.ts lib/ui/prompt-secret.ts`

In `lib/ui/prompt-secret.ts`, change nothing but the first comment line, from `Shared no-echo prompt for ...` to:

```ts
/**
 * The no-echo prompt for `rt secrets set/rotate`, `rt home key import`,
 * `rt team join` and `rt logins add`: raw mode so keystrokes never reach the
 * terminal. By default nothing is echoed back; `mask` echoes one mask
 * character per keystroke instead, never the value. `io` is injectable so
 * tests drive a fake stdin instead of a real TTY.
 */
```

- [ ] **Step 2: Leave a re-export at the old path**

Create `lib/prompt-secret.ts`:

```ts
export * from "./ui/prompt-secret.ts";
```

- [ ] **Step 3: Run the prompt's tests through the old path**

Run: `bun test lib/__tests__/prompt-secret.test.ts`
Expected: PASS. The test imports `../prompt-secret.ts`, so this proves the re-export carries every name.

- [ ] **Step 4: Send the age-key trace through the layer**

In `lib/home/age-key.ts`, add `import * as out from "../ui/out.ts";` to the imports and replace `debugLog` (lines 294 to 296) with:

```ts
function debugLog(cmd: string[]): void {
  if (CLI_DEBUG) out.note(out.kv("age-key", cmd.join(" ")));
}
```

The comment above it (lines 289 to 293) stays. `withArgvRedaction` still redacts before `debugLog` sees the argv, and `lib/home/__tests__/age-key.test.ts` already pins that.

- [ ] **Step 5: Delete two allowlist lines**

In `lib/__tests__/raw-output-allowlist.json`, delete the lines `"lib/home/age-key.ts",` and `"lib/prompt-secret.ts",`.

- [ ] **Step 6: Run the tests and the guards**

Run: `bun test lib/home/__tests__/age-key.test.ts lib/__tests__/prompt-secret.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-daemon-sync-exec.test.ts lib/__tests__/no-ui-in-cli.test.ts`
Expected: PASS. `lib/home/age-key.ts` is loaded by the daemon; `lib/ui/out.ts` is on `no-daemon-sync-exec`'s allowlist.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/ui/prompt-secret.ts lib/prompt-secret.ts lib/home/age-key.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "lib: the secret prompt lives with the other prompts, and the age-key trace goes through out.note

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The copy pass on `lib/home`'s human strings

Applies the `lib/home` copy table in Task 2 (rows H1 to H7, H9 to H21 and H24). No envelope is involved: `home` declares no `--json`. The tray reads `home init --dry-run`'s stderr, and H1 to H5 are what it shows.

**Files:**
- Modify: `lib/home/init-plan.ts:71-75, :96-104, :106-114, :116-121, :129-138`
- Modify: `lib/home/snapshot-owners.ts:35-46`
- Modify: `lib/home/materialize.ts:103-110, :141, :146, :151`
- Modify: `lib/home/init-exec.ts:57, :60, :68, :74, :79, :84, :116, :121, :128, :133`
- Create: `lib/home/__tests__/copy.test.ts`
- Modify: `lib/home/__tests__/materialize.test.ts:150, :193, :205, :229`, `lib/home/__tests__/init-plan.test.ts:249, :284, :316, :317`, `lib/home/__tests__/init-exec.test.ts:236, :386`, `commands/__tests__/home.test.ts:574, :685, :707, :1169, :2005, :2090`

**Interfaces:**
- Consumes: nothing new.
- Produces: `UnknownProfileFlagError` has `readonly profile: string` (its first constructor argument); Task 6 reads it to build the `next` command. Every class keeps its name and constructor arguments.

- [ ] **Step 1: Write the failing tests**

Create `lib/home/__tests__/copy.test.ts`:

```ts
import { test, expect } from "bun:test";
import { executeInitPlan, type ExecSeam } from "../init-exec.ts";
import { InvalidMachineKeyError, InvalidProfileKeyError, ProfileChoiceRequiredError, ProfileNameCollisionError, UnknownProfileFlagError } from "../init-plan.ts";
import { InvalidZoneError, ZoneOwnedByOthersError } from "../snapshot-owners.ts";

const DASH = new RegExp(`[${String.fromCodePoint(0x2013)}${String.fromCodePoint(0x2014)}]`);

test("the machine profile and machine name errors read as plain sentences", () => {
  const messages = [
    new InvalidMachineKeyError("a/b").message,
    new UnknownProfileFlagError("ghost", ["desktop", "laptop"]).message,
    new UnknownProfileFlagError("ghost", []).message,
    new ProfileChoiceRequiredError(["desktop", "laptop"]).message,
    new InvalidProfileKeyError("..").message,
    new ProfileNameCollisionError("sample-mbp").message,
  ];
  expect(messages).toEqual([
    '"a/b" cannot name a Mac: a name cannot be empty, ".", "..", or hold a slash or a backslash.',
    "There is no machine profile called ghost yet (the profiles are desktop, laptop). Name it as a new profile to create it.",
    "There is no machine profile called ghost yet (there are none yet). Name it as a new profile to create it.",
    "This Mac could use any of 2 machine profiles (desktop, laptop), and there is no terminal to ask which.",
    '".." cannot name a machine profile: a name cannot be empty, ".", "..", or hold a slash or a backslash.',
    "This Mac's default profile name, sample-mbp, already belongs to another Mac's profile. Give the new profile a name of its own.",
  ]);
  expect(new UnknownProfileFlagError("ghost", []).profile).toBe("ghost");
  for (const message of messages) expect(message).not.toMatch(DASH);
});

test("the claim errors name the path and the owner, with no flag in the sentence", () => {
  expect(new InvalidZoneError("/abs").message).toBe('"/abs" is not a path rt can track: a path must not be empty, start with a slash, hold a backslash, or have a "." or ".." part.');
  expect(new ZoneOwnedByOthersError("prefs/", "sample@sample-mbp").message).toBe('"prefs/" is already claimed by sample@sample-mbp');
});

test("each init step's progress reads as a plain sub-line", async () => {
  const lines: string[] = [];
  const seam: ExecSeam = {
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
    writeFile: async () => {},
    mkdirp: async () => {},
    exists: async (path) => path === "user/snapshot-owners.jsonc",
    blocksSymlink: async () => false,
    writeSymlink: async () => {},
  };
  await executeInitPlan(
    [
      { kind: "ensureStateDirs", dirs: ["rt"] },
      { kind: "cloneUserRepo", url: "https://forge.example.test/sample/home.git" },
      { kind: "initUserRepo" },
      { kind: "commitInitialUserRepo" },
      { kind: "writeGitignore", content: "" },
      { kind: "writeOwners", content: "" },
      { kind: "writeMachineKey", key: "sample-mbp" },
      { kind: "ensureProfileDir", key: "sample-mbp" },
      { kind: "writeSkillsSymlink" },
    ],
    seam,
    (line) => lines.push(line),
  );
  expect(lines).toEqual([
    "Creating rt/",
    "Cloning https://forge.example.test/sample/home.git",
    "Starting a repo with no remote",
    "Committing the first version",
    "Adding user/.gitignore",
    "user/snapshot-owners.jsonc is already there, so rt left it",
    "Naming this Mac sample-mbp",
    "Creating the profile folder for sample-mbp",
    "Linking your skills list",
  ]);
});

test("a real file in the way of the skills link says so plainly", async () => {
  const seam: ExecSeam = {
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
    writeFile: async () => {},
    mkdirp: async () => {},
    exists: async () => false,
    blocksSymlink: async () => true,
    writeSymlink: async () => {},
  };
  expect(await executeInitPlan([{ kind: "writeSkillsSymlink" }], seam, () => {})).toEqual({
    ok: false,
    failedStep: "writeSkillsSymlink",
    stderr: "A real file is already at skills.jsonc, and rt will not overwrite it",
  });
});
```

In `lib/home/__tests__/materialize.test.ts`:

| Line | Today's expected value | New expected value |
|---|---|---|
| 150 | the absolute-path not-found message | `"rt could not find /fake/rt-binary to run it"` |
| 193 (inside the expected result) | the healthy-deck note | `note: "deck is already running well, so rt left it alone",` |
| 205 (inside the expected result) | `note: 'run manually (interactive): cd "/repos/mr-board" && bun run scripts/setup.ts',` | `note: 'Run this yourself, it asks questions: cd "/repos/mr-board" && bun run scripts/setup.ts',` |
| 229 | the bare-command message | `"rt could not run deck: is it installed and on your PATH?"` |

The unhealthy-deck test (`:174-181`) asserts the helper label, `deck setup` and `rt services register`, all of which H11 keeps; it does not change.

The two other `lib/home` test files pin flags and a dash clause that leave the messages. Where a flag leaves a message, Task 6 asserts it in the failure's `next` instead; here each assertion moves to the new words:

| File and line | Today's assertion | New assertion |
|---|---|---|
| `init-plan.test.ts:249` (H2, in `--profile naming a non-existent profile without --new-profile: ...`) | `toContain("--new-profile")` | `toContain("as a new profile")` |
| `init-plan.test.ts:284` (H5, in the collision test) | `toContain("--profile")` | `toContain("a name of its own")` |
| `init-plan.test.ts:316` (H3, in `existing profiles, no flags, non-interactive: ...`) | `toContain("--profile")` | `toContain("no terminal to ask which")` |
| `init-plan.test.ts:317` (H3, the same test) | `toContain("--new-profile")` | `toContain("2 machine profiles")` |
| `init-exec.test.ts:236` (H24, the fake seam's blocked symlink) | `toContain("refusing to overwrite")` | `toContain("rt will not overwrite it")` |
| `init-exec.test.ts:386` (H24, the real seam's blocked symlink) | `toContain("refusing to overwrite")` | `toContain("rt will not overwrite it")` |

The `"new-box"`, `"desktop"` and `"mbp-14"` assertions beside them keep their values and still pass.

In `commands/__tests__/home.test.ts` (still on its console spies until Tasks 5 and 6): line 574 `"not a safe machine-key segment"` becomes `"cannot name a Mac"`; line 685's `e.includes("ghost") && e.includes("--new-profile")` becomes `e.includes("ghost") && e.includes("as a new profile")` (Task 6 adds the `next` line that carries the flag); line 707's `e.includes("--profile") && e.includes("--new-profile")` becomes `e.includes("no terminal to ask which")`; line 1169's healthy-deck phrase becomes `"deck is already running well"`; lines 2005 and 2090 `"not a valid snapshot zone"` become `"is not a path rt can track"`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/home/__tests__/copy.test.ts lib/home/__tests__/materialize.test.ts lib/home/__tests__/init-plan.test.ts lib/home/__tests__/init-exec.test.ts commands/__tests__/home.test.ts`
Expected: FAIL. `copy.test.ts` finds today's messages (and no `profile` on the error); the changed assertions find today's wording.

- [ ] **Step 3: Reword `lib/home`**

`lib/home/init-plan.ts`, each class keeping its doc comment:

```ts
export class InvalidMachineKeyError extends Error {
  constructor(key: string) {
    super(`"${key}" cannot name a Mac: a name cannot be empty, ".", "..", or hold a slash or a backslash.`);
  }
}
```

```ts
export class UnknownProfileFlagError extends Error {
  constructor(
    readonly profile: string,
    profiles: string[],
  ) {
    super(
      `There is no machine profile called ${profile} yet (${profiles.length > 0 ? `the profiles are ${profiles.join(", ")}` : "there are none yet"}). ` +
        "Name it as a new profile to create it.",
    );
  }
}
```

```ts
export class ProfileChoiceRequiredError extends Error {
  constructor(profiles: string[]) {
    super(`This Mac could use any of ${profiles.length} machine profiles (${profiles.join(", ")}), and there is no terminal to ask which.`);
  }
}
```

```ts
export class InvalidProfileKeyError extends Error {
  constructor(key: string) {
    super(`"${key}" cannot name a machine profile: a name cannot be empty, ".", "..", or hold a slash or a backslash.`);
  }
}
```

```ts
export class ProfileNameCollisionError extends Error {
  constructor(hostnameSlug: string) {
    super(`This Mac's default profile name, ${hostnameSlug}, already belongs to another Mac's profile. Give the new profile a name of its own.`);
  }
}
```

`lib/home/snapshot-owners.ts`:

```ts
export class InvalidZoneError extends Error {
  constructor(zone: string) {
    super(`"${zone}" is not a path rt can track: a path must not be empty, start with a slash, hold a backslash, or have a "." or ".." part.`);
  }
}
```

and in `ZoneOwnedByOthersError`, `super(`"${zone}" is already claimed by ${existingOwner}`);`.

`lib/home/materialize.ts`: `failureMessage`'s first `return` becomes

```ts
    return bin.includes("/") ? `rt could not find ${bin} to run it` : `rt could not run ${bin}: is it installed and on your PATH?`;
```

(the comment above it stays); the `reportDeckHealthy` note becomes `"deck is already running well, so rt left it alone"`; the `reportDeckUnhealthy` `stderr` becomes

```ts
        stderr: [
          "The app's deck helper owns deck, and deck is not healthy, so rt did not run deck setup: it would add a second copy.",
          "If the helper is not registered: rt services register",
          `To look at it: launchctl print gui/$(id -u)/${step.helperLabel}`,
        ].join("\n"),
```

and the `boardSetup` note becomes `` `Run this yourself, it asks questions: ${boardSetupCommand(step.repoPath)}` ``.

`lib/home/init-exec.ts`, rows H13 to H21 and H24, each a string swap:

```ts
    log(`${label} is already there, so rt left it`);
```

```ts
  log(`Adding ${label}`);
```

```ts
        log(`Creating ${dir}/`);
```

```ts
      log(`Cloning ${step.url}`);
```

```ts
      log("Starting a repo with no remote");
```

```ts
      log("Committing the first version");
```

```ts
      log(`Naming this Mac ${step.key}`);
```

```ts
      log(`Creating the profile folder for ${step.key}`);
```

```ts
        throw new StepFailed("A real file is already at skills.jsonc, and rt will not overwrite it");
```

```ts
      log("Linking your skills list");
```

- [ ] **Step 4: Run the tests**

Run: `bun test lib/home/__tests__ commands/__tests__/home.test.ts lib/daemon/__tests__/home-snapshot.test.ts lib/daemon/__tests__/home-snapshot-plan.test.ts`
Expected: PASS. The two daemon tests import `lib/home` and must not notice: the owners file's parse errors (H8) did not change.

Run: `grep -rn "safe machine-key\|safe machine-profile\|isn't one of\|valid snapshot zone\|pass force\|run manually\|is it on PATH\|initialising\|seeding \|refusing to overwrite" lib/home/*.ts`
Expected: only comment lines.

Run: `bun run typecheck`
Expected: no errors (the one `new UnknownProfileFlagError(...)` call in `init-plan.ts` passes the profile first already).

- [ ] **Step 5: Commit**

```bash
git add lib/home/init-plan.ts lib/home/snapshot-owners.ts lib/home/materialize.ts lib/home/init-exec.ts lib/home/__tests__/copy.test.ts lib/home/__tests__/materialize.test.ts lib/home/__tests__/init-plan.test.ts lib/home/__tests__/init-exec.test.ts commands/__tests__/home.test.ts
```

```bash
git commit -m "lib/home: plain copy for its errors, notes and progress lines

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `rt home` key export, key import, snapshot, claim and release

**Files:**
- Modify: `commands/home.ts:813-1163`
- Modify: `commands/__tests__/home.test.ts`

**Interfaces:**
- Consumes: Task 4's `lib/home` messages; `out.print`, `out.fail`, `out.note`, `out.payload`, `out.line`, `out.kv`, `out.callout`, `out.cmd` (`lib/ui/out.ts`); `usageFailure` (5a); `type Block` (`lib/ui/protocol.ts`); `captureOut()`.
- Produces, inside `commands/home.ts` (Task 6 calls it): `refuse(title: string, ...callouts: Block[]): never`, which prints `out.note(out.line("refused", title), ...callouts)` and exits 1. `commands/home.ts` stays on the allowlist until Task 6 (its `init` half still prints raw and still imports `lib/ansi.ts`).

- [ ] **Step 1: Move the second capture helper onto `captureOut` and write the failing tests**

In `commands/__tests__/home.test.ts`, add to the imports:

```ts
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { keyExport } from "../../lib/home/age-key.ts";
```

and add `homeKeyExport` to the import list from `"../home.ts"`.

Replace the whole `runCatchingExit` function (it starts at the comment `Runs an async CLI function, catching the process.exit call the failure paths make`) with:

```ts
/** Runs an async CLI function, catching the `process.exit` call the failure paths make. `logs` is stdout by line, `errors` is stderr by line, both as plain text. */
async function runCatchingExit(
  fn: () => Promise<void>,
): Promise<{ exitCode: number | undefined; logs: string[]; errors: string[] }> {
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  const io = captureOut();
  ui.__test__.setHuman(() => false);
  try {
    await fn();
    return { exitCode: undefined, logs: io.lines(), errors: io.errLines() };
  } catch {
    const code = exitSpy.mock.calls.at(-1)?.[0] as number | undefined;
    return { exitCode: code, logs: io.lines(), errors: io.errLines() };
  } finally {
    exitSpy.mockRestore();
    io.restore();
  }
}
```

Then update the assertions below `runCatchingExit` (everything from `describe("homeSnapshot", ...)` to the end of the file). Each row is a substring inside an `includes(...)` call; replace every occurrence in that range:

| Old substring | New substring | Where |
|---|---|---|
| `"decryptable on this machine"` | `"can now be opened on this Mac"` | key import, 3 places |
| `"claimed"` | `"Claimed"` | `claim writes the zone with the default owner ...` |
| `"zone is required"` | `"Which path should rt leave"` | the claim test `claim with no zone argument ...` |
| `"zone is required"` | `"Which claimed path should rt take back"` | the release test with no zone argument |
| `"released"` | `"Released"` | `release removes a previously claimed zone and names who owned it` |
| `"nothing to release"` | `"Nothing to release"` | `release on a never-claimed zone ...` |

Every other assertion in that range keeps its substring and must still pass: `"abc123de"`, `"prefs/settings.json"`, `"no-changes"`, `"enabled"`, `"watching: yes"`, `"prefs/"`, `"malformed jsonc"`, `"push failed: non-fast-forward"`, `"fatal: unable to create index.lock"`, `"rt daemon start"`, `"git commit failed"`, `"not a valid age private key"`, `"positional argument"`, `"shell history"`, `"rotate"`, `"--force"`, `"rt home key import --force"`, the truncated keys, `"daemon"` with `"snapshot"`, `"is not a path rt can track"` (Task 4's wording), `"rt home init"`, `"scripts/deploy.sh"`, `"matt@laptop"`. The three refusals among them (a key on argv, a key already there, a path someone else claimed) now arrive on stderr as a `[refused]` line from `out.note`, which `errors` reads like any other stderr line.

In `describe("homeKeyImport", ...)`, directly after the test `existing key, no --force: refused, exits 1, names the existing recipient, never overwrites`, add:

```ts
  test("a key already on this Mac is refused, not failed", async () => {
    const seam = new FakeImportSeam({ existingPrivateKey: OTHER_PRIVATE_KEY, existingPublicKey: OTHER_PUBLIC_KEY });
    const { exitCode, errors } = await runImport([], seam);
    expect(exitCode).toBe(1);
    expect(errors[0]).toBe("[refused] This Mac already has a secrets key");
    expect(errors[1]).toStartWith(`  why: Its recipient is ${OTHER_PUBLIC_KEY.slice(0, 12)}`);
    expect(errors[2]).toBe("  next: rt home key import --force");
  });
```

In `describe("homeClaim / homeRelease", ...)`, directly after the test `claim on a zone already claimed by a DIFFERENT owner refuses, naming the owner, unless --force`, add:

```ts
  test("a path someone else claimed is refused, not failed", async () => {
    await runCatchingExit(() => homeClaim(["prefs/", "--owner", "matt@laptop"], {}, ownersPath, provisioned));
    const { exitCode, errors } = await runCatchingExit(() => homeClaim(["prefs/", "--owner", "alice@desktop"], {}, ownersPath, provisioned));
    expect(exitCode).toBe(1);
    expect(errors).toEqual(["[refused] prefs/ is already claimed by matt@laptop", "  next: rt home claim prefs/ --force"]);
  });
```

Add a new `describe` after `describe("homeSnapshot", ...)`:

```ts
describe("homeKeyExport", () => {
  async function expectedBytes(): Promise<string> {
    let text = "";
    await keyExport(new FakeAgeKeySeamWithExistingKey(), (t) => {
      text = `${t}\n`;
    });
    return text;
  }

  test("key export writes the same bytes at a terminal and in a pipe, and nothing else on stdout", async () => {
    const expected = await expectedBytes();
    expect(expected).toContain(FAKE_PRIVATE_KEY);
    const io = captureOut();
    try {
      for (const human of [true, false]) {
        io.clear();
        ui.__test__.setHuman(() => human);
        await homeKeyExport([], {}, new FakeAgeKeySeamWithExistingKey());
        expect(io.stdout()).toBe(expected);
        expect(io.stderr()).toBe("");
      }
    } finally {
      io.restore();
    }
  });

  test("no key yet: a failure on stderr naming the command, nothing on stdout, exit 1", async () => {
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await expect(homeKeyExport([], {}, new FakeAgeKeySeam())).rejects.toThrow("process.exit");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe("This Mac has no secrets key yet\n  next: rt home init\n");
    } finally {
      exitSpy.mockRestore();
      io.restore();
    }
  });
});
```

and add these two tests to `describe("homeSnapshot", ...)`:

```ts
  test("status reads as a state line and five facts, with a warning per fault", async () => {
    const seam = new FakeDaemonSeam(() => ({ ok: true, data: { ...okStatus, enabled: false, lastCommitError: "fatal: unable to create index.lock" } }));
    const { logs } = await runCatchingExit(() => homeSnapshot(["--status"], {}, seam));
    expect(logs[0]).toBe("[off] Saving your home repo is disabled  /home/.mattstack");
    expect(logs).toContain("watching: yes");
    expect(logs).toContain("[warning] The last save did not commit  fatal: unable to create index.lock");
  });

  test("a daemon that is down is one failure with the command to start it", async () => {
    const seam = new FakeDaemonSeam(() => null);
    const { exitCode, logs, errors } = await runCatchingExit(() => homeSnapshot([], {}, seam));
    expect(exitCode).toBe(1);
    expect(logs).toEqual([]);
    expect(errors).toEqual(["The rt daemon is not running", "  next: rt daemon start"]);
  });
```

`FakeDaemonSeam` is the class already defined above `runCatchingExit` (its constructor takes the responder); if it has another name in the file, use that one. `okStatus` is the fixture already in that `describe`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/home.test.ts`
Expected: FAIL in the snapshot, key import, key export, claim and release tests: stdout and stderr are empty of the new words (the verbs still print through `console`, which the new capture does not see). The `homeInit` tests still pass: they use `runHomeInit`, which Task 6 changes.

- [ ] **Step 3: Convert the five verbs in `commands/home.ts`**

Add to the imports (the `lib/ansi.ts` import stays until Task 6):

```ts
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
```

Add, above `homeKeyExport`:

```ts
/** rt declining by policy rather than failing: a refused line on stderr, never a failure block; `home` exits 1 either way. */
function refuse(title: string, ...callouts: Block[]): never {
  out.note(out.line("refused", title), ...callouts);
  process.exit(1);
}
```

Replace `homeKeyExport`'s body:

```ts
  try {
    // The key and its header are a payload: a person pipes them to a
    // password manager, so they are never styled and nothing else joins them.
    await keyExport(seams, (text) => out.payload(`${text}\n`));
  } catch (err) {
    if (err instanceof AgeKeyAbsentError) {
      out.fail({ title: "This Mac has no secrets key yet", next: out.cmd("rt home init") });
      process.exit(1);
    }
    throw err;
  }
```

In `homeKeyImport`, replace each refusal and the success lines:

The positional-key refusal (`if (pastedKeyArg !== undefined) { console.error(...); process.exit(1); }`):

```ts
  if (pastedKeyArg !== undefined) {
    refuse(
      "rt will not import a key passed as a positional argument",
      out.callout("why", "It just landed in your shell history and in rt's own log, so treat it as leaked and rotate it before you use it for anything."),
      out.callout("next", out.cmd("rt home key import --stdin")),
    );
  }
```

The input catch (`console.error(`rt home key import: ${(err as Error).message}`)`):

```ts
    out.fail({ title: "rt could not read the key", hint: (err as Error).message });
    process.exit(1);
```

The `if (!result.ok) { ... }` block:

```ts
  if (!result.ok) {
    if (result.reason === "malformed") {
      out.fail({ title: "That is not a valid age private key", why: "A key starts with AGE-SECRET-KEY-1." });
      process.exit(1);
    }
    refuse(
      "This Mac already has a secrets key",
      out.callout("why", `Its recipient is ${truncateKey(result.existingPublicKey)}.`),
      out.callout("next", out.cmd("rt home key import --force")),
    );
  }
```

The recipient mismatch block (`if (existingRecipient !== null && existingRecipient !== publicKey) { ... }`):

```ts
  if (existingRecipient !== null && existingRecipient !== publicKey) {
    out.fail({
      title: "That key cannot open the secrets in your home repo",
      why: `It is ${truncateKey(publicKey)}, and they are locked to ${truncateKey(existingRecipient)}. The key you just imported is stored now, so import the right one over it.`,
      next: out.cmd("rt home key import --force"),
    });
    process.exit(2);
  }
```

The two success lines:

```ts
  out.print(out.line("done", "Imported your secrets key", truncateKey(publicKey)), out.callout("note", "Secrets locked to this key can now be opened on this Mac"));
```

Replace `daemonDownAndExit` with:

```ts
function daemonDownAndExit(command: string): never {
  out.fail({ title: "The rt daemon is not running", next: out.cmd("rt daemon start") });
  process.exit(1);
  throw new Error(`unreachable: process.exit did not stop ${command}`);
}
```

Replace `printSnapshotResult` and `printSnapshotStatus` with:

```ts
function snapshotResultBlocks(result: SnapshotResult): Block[] {
  if (result.skipped) return [out.line("skipped", "Nothing was saved", result.skipped)];
  if (!result.committed) return [out.line("skipped", "Nothing has changed since the last save")];
  return [
    out.line("done", "Saved your home repo", result.sha ? result.sha.slice(0, 8) : undefined),
    out.kv("paths", result.paths.length > 0 ? result.paths.join(", ") : "none"),
  ];
}

function snapshotStatusBlocks(status: SnapshotStatus): Block[] {
  const push = status.pushPending ? "waiting to push" : status.lastPushAt !== 0 ? `last pushed ${formatTimestamp(status.lastPushAt)}` : "never pushed";
  return [
    out.line(status.enabled ? "running" : "off", status.enabled ? "Saving your home repo is enabled" : "Saving your home repo is disabled", status.repoDir),
    out.kv("watching", status.watching ? "yes" : "no"),
    out.kv("last run", formatTimestamp(status.lastRunAt)),
    out.kv("last commit", status.lastCommit ? `${status.lastCommit.sha.slice(0, 8)} ${status.lastCommit.message}` : "none"),
    out.kv("push", push),
    out.kv("claimed zones", status.claimedZones.length > 0 ? status.claimedZones.join(", ") : "none"),
    ...(status.lastCommitError ? [out.line("warn", "The last save did not commit", status.lastCommitError)] : []),
    ...(status.lastPushError ? [out.line("warn", "The last push did not go through", status.lastPushError)] : []),
    ...(status.ownersError ? [out.line("warn", "The list of claimed paths could not be read", status.ownersError)] : []),
  ];
}
```

In `homeSnapshot`, replace the two `if (!res.ok) { console.error(...); process.exit(1); }` blocks and the two print calls:

```ts
    if (!res.ok) {
      out.fail({ title: "rt could not read the snapshot status", hint: res.error ?? "the daemon gave no reason" });
      process.exit(1);
    }
    out.print(...snapshotStatusBlocks(res.data as SnapshotStatus));
    return;
```

and

```ts
  if (!res.ok) {
    out.fail({ title: "rt could not save your home repo", hint: res.error ?? "the daemon gave no reason" });
    process.exit(1);
  }
  out.print(...snapshotResultBlocks(res.data as SnapshotResult));
```

Replace `refuseUnlessProvisioned`'s body (its `command` parameter is no longer read; rename it `_command` so the two callers stay as they are):

```ts
  if (!probes.isGitRepo(homeRepoRoot())) {
    out.fail({ title: "Your home repo is not set up yet", next: out.cmd("rt home init") });
    process.exit(1);
  }
```

In `homeClaim`:

The no-zone, no-terminal branch:

```ts
      out.fail(usageFailure("Which path should rt leave for you to commit?", "rt home claim <zone>", "A zone is a folder such as prefs/ or one file such as scripts/deploy.sh."));
      process.exit(1);
```

The catch around `claimZone`:

```ts
    if (err instanceof InvalidZoneError) {
      out.fail({ title: "That path cannot be claimed", why: err.message });
      process.exit(1);
    }
    if (err instanceof ZoneOwnedByOthersError) {
      refuse(`${err.zone} is already claimed by ${err.existingOwner}`, out.callout("next", out.cmd(`rt home claim ${err.zone} --force`)));
    }
    throw err;
```

The two success lines:

```ts
  out.print(out.line("done", `Claimed ${normalizeZone(zone, kind)}`, `for ${owner}`), out.callout("note", "The daemon picks this up the next time it takes a snapshot"));
```

In `homeRelease`:

The no-zone branch:

```ts
      out.fail(usageFailure("Which claimed path should rt take back?", "rt home release <zone>"));
      process.exit(1);
```

The `InvalidZoneError` catch:

```ts
      out.fail({ title: "That path cannot be released", why: err.message });
      process.exit(1);
```

The three closing statements (from `if (!result.released) {` to the end of the function):

```ts
  if (!result.released) {
    out.print(out.line("skipped", "Nothing to release", `${zone} is not claimed`));
    return;
  }

  out.print(out.line("done", `Released ${result.zone}`, `was claimed by ${result.owner}`), out.callout("note", "The daemon picks this up the next time it takes a snapshot"));
```

- [ ] **Step 4: Run the tests**

Run: `bun test commands/__tests__/home.test.ts`
Expected: PASS, the `homeInit` tests included (untouched so far apart from Task 4's three substrings).

Run: `bun test lib/__tests__/no-raw-output.test.ts`
Expected: PASS. `commands/home.ts` is still on the allowlist and still prints raw in `init`.

Run: `bun run typecheck`
Expected: no errors. `red`, `yellow`, `bold`, `green`, `dim` and `reset` are still used by the `init` half.

- [ ] **Step 5: Commit**

```bash
git add commands/home.ts commands/__tests__/home.test.ts
```

```bash
git commit -m "rt home: key, snapshot, claim and release print through the output layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `rt home init`, one step per stage

**Files:**
- Modify: `commands/home.ts:35-811`
- Modify: `lib/home/init-exec.ts` (export `INIT_STEP_FAILED`)
- Modify: `commands/__tests__/home.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json`

**Interfaces:**
- Consumes: Task 5's imports and `refuse(title, ...callouts)` in `commands/home.ts`; Task 4's `lib/home` messages and `UnknownProfileFlagError.profile`; `openStep(title): StepHandle` (`lib/ui/spawn.ts`, phase 1) and `interactive()` (`lib/ui/gate.ts`, phase 1); `logCliEvent(level, module, message, context?)` (`lib/cli-logger.ts`, phase 2); `withoutUrls(message: string): string` (`lib/team/redact.ts`, read only); `out.section`, `out.verbatim`, `out.copy`, `out.paragraph`, `type FailureInput` (`lib/ui/out.ts`); `type RenderStatus` (`lib/ui/protocol.ts`); `executeInitPlan`, `type InitResult` (`lib/home/init-exec.ts`); `runMaterialize`, `type MaterializeResult`, `RT_OWN_STEP_KINDS` (`lib/home/materialize.ts`). For the tests: `lib/ui/__tests__/fake-rt-ui.ts` and `__test__.setInteractive` (`lib/ui/gate.ts`), `logsDir()` (`lib/rt-paths.ts`).
- Produces:
  - in `lib/home/init-exec.ts`: `export const INIT_STEP_FAILED: Record<InitStep["kind"], string>`, the failure title per init step. Task 7 imports it into `lib/setup/steps/home.ts`.
  - inside `commands/home.ts`: `EnsureHomeAgeKeyResult = { ok: true } | { ok: false; failure: out.FailureInput }` (the exported type changes its failing arm; nothing outside this file reads it).
  - inside `commands/home.ts`: `stage(title: string, task: (sub: (text: string) => void) => Promise<StageEnding>): Promise<StageEnding>`, with `interface StageEnding { status: Exclude<RenderStatus, "running">; title: string; hint?: string }`.
  - inside `commands/home.ts`: `runInitSteps(steps: InitStep[], exec: ExecSeam): Promise<InitResult>` and `runRefreshSteps(steps: MaterializeStep[], exec: MaterializeExecSeam, rtBin: string): Promise<boolean>` (true when a step rt owns failed).
  - the last stdout line of a run that set the Mac up is `[ok] This Mac is set up  <home>` off a terminal; Task 7 reads it.

`home init` is a run a person watches, step by step, so each stage is its own rt-ui step (the controller's ruling 2): `stage()` opens one through `openStep` when `interactive()` holds, passes the stage's progress to `StepHandle.sub` (cleared when it ends done, kept when it fails) and, through `withoutUrls`, to the CLI log at `debug` (`--url` and `RT_HOME_URL` are not checked for credentials, so `Cloning <url>` can carry a token), and ends it with `done(title, hint, status)` or `fail(title, hint)`. Off a terminal, or when the helper cannot start or dies, the same ending prints as one plain line through `out.print` (`[ok] Clone your home repo  <url>`). `withTransientStep` is not used. Each plan step runs alone through `executeInitPlan([step], ...)`, which keeps today's stop-at-the-first-failure behavior; each refresh step runs alone through `runMaterialize([step], ...)`, which keeps today's run-every-step behavior. A refresh step's guidance (the daemon's approval text, mr-board's command, a failure's output) prints as a `verbatim` under its line after the step ends, because a sub-line would clear on success.

The tray runs `rt home init --dry-run --json` (`TeamChoiceModel.homeInitCheck`). `home init` declares no `--json` and never reads the flag, but `--json` on argv closes the human gate, so the tray always gets the plain text. A dry run runs no stage. The tray reads the exit code, and on a nonzero exit the first 200 bytes of stderr with newlines turned into spaces. Exit codes do not change; the first line of stderr is now the failure's title.

- [ ] **Step 1: Move `runHomeInit` onto `captureOut` and update the assertions**

In `commands/__tests__/home.test.ts`, inside `runHomeInit`, replace the lines from `const logs: string[] = [];` through the two `spyOn(console, ...)` calls with:

```ts
  const io = captureOut();
  ui.__test__.setHuman(() => false);
```

replace both `return { exitCode: ..., logs, errors };` statements with the same shape reading the capture (`logs: io.lines(), errors: io.errLines()`), and replace the two `(console.log as ...).mockRestore();` and `(console.error as ...).mockRestore();` lines in `finally` with `io.restore();`.

Then update the assertions in the `homeInit` tests (everything above `describe("homeSnapshot", ...)`). Replace every occurrence of each substring in that range:

| Old substring (inside `includes(...)` or `toContain(...)`) | New substring |
|---|---|
| `"age key ready"` | `"secrets key is ready"` |
| `"is provisioned"` | `"This Mac is set up"` |
| `"already fully provisioned"` | `"Nothing to set up"` |
| `"fully provisioned"` (the one `toBe(false)` check in the test about `--profile` on a keyed machine) | `"Nothing to set up"` |
| `"no machine profile selected"` | `"No machine profile was chosen"` |
| `"materialize will also run"` | `"rt will also refresh"` |
| `"materialize would run"` | `"rt would also refresh"` |
| `"materialize skipped"` | `"Skipped the refresh"` |
| `"materializing"` | `"Set up rt's git intercept"` (the first refresh step always runs) |
| `"rt-owned step"` | `"one of its own pieces"` |
| `"rt intercept install"` (lines 965 and 1036; line 1167 is an exec call list and stays) | `"Set up rt's git intercept"` |
| `"deck setup"` (lines 1037 and 1220) | `"Set up deck"` |
| `"skipped"` with `"already healthy"` (line 1056, a dry run) | `"[skipped] Set up deck"` with `"already running well"` |
| `"already healthy"` (line 1168, a live run) | `"already running well"` |
| `"mr-board setup"` (line 1144) | `"Set up mr-board"` |
| `"gitq"` with `"not present locally"` (line 1194) | `"gitq"` with `"not on this Mac yet"` |
| `"clone https://x/from-intent.git into user/"` | `"Clone your home repo  https://x/from-intent.git"` |
| `"--url requires a value"` (lines 543 and 552) | `"  next: rt home init --url <remote>"` |
| `"--profile requires a value"` (line 890) | `"  next: rt home init --profile <key>"` |

In the test at line 685 (`--profile` naming a profile that does not exist), after the assertion Task 4 left there, add `expect(errors).toContain("  next: rt home init --profile ghost --new-profile");`: the flag left the message, and this is where it went.

Four assertions on the skills-file refusal change stream as well as words, because the notice is now a `needs-you` line on stdout and only the final refusal of a live run reaches stderr, as a `refused` line:

- In the two `--dry-run` tests that assert `errors.some((e) => e.includes("refusing to overwrite"))`, destructure `logs` from `runHomeInit` (add it beside `errors` where it is missing) and replace the assertion with `expect(logs.some((l) => l.includes("A file is in the way of your skills link"))).toBe(true);`.
- In the two live-run tests with the same assertion (they expect exit code 1), replace it with `expect(errors[0]).toBe("[refused] Your home folder is set up, apart from your skills link");` and `expect(errors.some((e) => e.includes("will not overwrite it"))).toBe(true);`.

In the test that passes a profile flag on a machine that already has a machine-key file (the one whose `"fully provisioned"` check the table above changes), add after its exit-code assertion: `expect(errors[0]).toBe("[refused] This Mac already has a machine profile");`.

One more changes stream: in the test that throws `boom: env gathering exploded` from the materialize env, replace `expect(errors.some((e) => e.includes("boom: env gathering exploded"))).toBe(true);` with `expect(logs.some((l) => l.includes("boom: env gathering exploded"))).toBe(true);` (the run goes on, so it is a warning on stdout, not a failure).

Every other `homeInit` assertion keeps its substring and must still pass, among them `"age1stale"`, `"deliberate ceremony"`, `"rt secrets set"`, `"age1the-other-machines-recipient"`, the one that needs `"already"`, `"minted"` and `"stored"` on one line, `"git -C"`, `"cannot name a Mac"`, `"ghost"` with `"as a new profile"` and `"no terminal to ask which"` (Task 4's wording), `"desktop"` with `"laptop"`, `"machine-key"`, `"no machine-key file yet"`, `"owns deck"`, `"approve it in System Settings"`, `"line one"`, `"claude.marketplaces"` with `"installer"`.

Add these tests to `describe("homeInit", ...)`:

```ts
  test("a failed clone leads with one plain title, and what git said follows with escapes stripped", async () => {
    class FailingCloneSeam extends FakeSeam {
      override async run(cmd: string[]): Promise<ExecResult> {
        if (cmd[1] === "clone") return { code: 128, stdout: "", stderr: "\x1b[2Jfatal: repository not found\n\nline two" };
        return super.run(cmd);
      }
    }
    const { exitCode, logs, errors } = await runHomeInit(fakeProbes({}), new FailingCloneSeam(), new FakeAgeKeySeam(), ["--url", TEST_URL]);

    expect(exitCode).toBe(1);
    expect(errors).toEqual(["rt could not clone your home repo", "what it said:", "  fatal: repository not found", "  line two"]);
    expect(logs).toContain(`[failed] Clone your home repo  ${TEST_URL}`);
  });

  test("each stage ends in its own line, and the run ends with one line when the Mac is set up", async () => {
    const { exitCode, logs } = await runHomeInit(fakeProbes({}), new FakeSeam(), new FakeAgeKeySeam(), ["--url", TEST_URL, "--no-materialize"]);

    expect(exitCode).toBeUndefined();
    expect(logs[0]).toBe(`Setting up your home folder (${mattstackHome()})`);
    const plan = logs.indexOf(`[not yet] Clone your home repo  ${TEST_URL}`);
    const ran = logs.indexOf(`[ok] Clone your home repo  ${TEST_URL}`);
    expect(plan).toBeGreaterThan(0);
    expect(ran).toBeGreaterThan(plan);
    expect(logs).toContain("[skipped] Skipped the refresh of what rt generates from your settings");
    expect(logs.at(-1)).toBe(`[ok] This Mac is set up  ${mattstackHome()}`);
    expect(logs.join("\n")).not.toContain("\x1b[");
    expect(logs.join("\n")).not.toContain("Cloning ");
  });
```

The last assertion pins that a stage's progress (Task 4's `Cloning <url>`) is a sub-line only: off a terminal it reaches the CLI log, never stdout. In the existing test `rt-own steps' stdout is printed even on a clean exit ...`, add after its last assertion, so the guidance is pinned under its own line:

```ts
      const daemon = logs.indexOf("[ok] Set up the rt daemon");
      expect(daemon).toBeGreaterThanOrEqual(0);
      expect(logs.slice(daemon + 1).some((l) => l.includes("approve it in System Settings"))).toBe(true);
```

```ts

  test("a wrong key in the keychain is one failure with its why and the import command", async () => {
    const sopsYamlSeam = new FakeSopsYamlSeam({ path: SOPS_YAML_PATH, content: renderSopsYaml("age1stale-recipient-from-another-machine") });
    const { exitCode, errors } = await runHomeInit(FULLY_PROVISIONED_PROBES(), new FakeSeam(), new FakeAgeKeySeamWithExistingKey(), [], sopsYamlSeam);

    expect(exitCode).toBe(1);
    expect(errors[0]).toBe("This Mac's key does not match your secrets");
    expect(errors[1]).toStartWith("  why: They are locked to age1stale-re");
    expect(errors[2]).toBe("  next: rt home key import --force");
  });

  test("the tray's dry run with no terminal to pick a profile leads with the question, and nothing before it", async () => {
    const probes = fakeProbes({ isGitRepo: (dir) => dir.endsWith("/user"), exists: (path) => path.endsWith("/user"), listProfiles: () => ["desktop", "laptop"] });
    const { exitCode, logs, errors } = await runHomeInit(probes, new FakeSeam(), new FakeAgeKeySeam(), ["--dry-run", "--json"], new FakeSopsYamlSeam(), KEY, new UnreachablePickerSeam(), () => false);

    expect(exitCode).toBe(1);
    expect(logs).toEqual([]);
    expect(errors[0]).toBe("Which machine profile should this Mac use?");
    expect(errors[1]).toBe("  why: This Mac could use any of 2 machine profiles (desktop, laptop), and there is no terminal to ask which.");
    expect(errors).toContain("  next: rt home init --profile <key>");
    // TeamChoiceModel.homeInitCheck shows the first 200 bytes of stderr with its newlines turned into spaces.
    expect(errors.join("\n").slice(0, 200).replace(/\n/g, " ")).toStartWith("Which machine profile should this Mac use?   why: This Mac could use");
  });

  test("a credential in the clone url never reaches the CLI log", async () => {
    const secretUrl = "https://x-access-token:ghp_sample0token@forge.example.test/sample/home.git";
    const { exitCode } = await runHomeInit(fakeProbes({}), new FakeSeam(), new FakeAgeKeySeam(), ["--url", secretUrl, "--no-materialize"]);

    expect(exitCode).toBeUndefined();
    const log = readdirSync(logsDir())
      .filter((f) => f.startsWith("cli.") && f.endsWith(".log"))
      .map((f) => readFileSync(join(logsDir(), f), "utf8"))
      .join("");
    expect(log).toContain('"msg":"Cloning <remote>"');
    expect(log).not.toContain("ghp_sample0token");
  });
```

Add `readdirSync` and `readFileSync` to the file's `fs` import, `logsDir` beside `mattstackHome` in its `lib/rt-paths.ts` import, and `import { __test__ as gateTest } from "../../lib/ui/gate.ts";`. The unit suite's preload points `logsDir()` at the run's own temporary home, so the log read is never the developer's.

Then add a new `describe` directly after `describe("homeInit", ...)`. It runs the terminal path against the scripted helper: every `homeInit` test uses `FakeAgeKeySeam`, so nothing touches the keychain, and the fake records every line each stage's helper receives.

```ts
describe("homeInit at a terminal", () => {
  const FAKE_UI = join(import.meta.dir, "..", "..", "lib", "ui", "__tests__", "fake-rt-ui.ts");
  let dir: string;
  let record: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rt-home-steps-"));
    record = join(dir, "record.ndjson");
    process.env.RT_UI_BIN = FAKE_UI;
    process.env.RT_UI_FAKE = JSON.stringify({ record });
    gateTest.setInteractive(() => true);
  });
  afterEach(() => {
    gateTest.setInteractive(undefined);
    delete process.env.RT_UI_BIN;
    delete process.env.RT_UI_FAKE;
    rmSync(dir, { recursive: true, force: true });
  });

  type Sent = { t: string; title?: string; text?: string; hint?: string; status?: string };

  /** Each stage is its own helper process, which appends what it received when it ends: one list per stage, hello dropped. */
  function stages(): Sent[][] {
    const out: Sent[][] = [];
    for (const line of readFileSync(record, "utf8").trim().split("\n")) {
      const msg = JSON.parse(line) as Sent;
      if (msg.t === "hello") out.push([]);
      else out.at(-1)!.push(msg);
    }
    return out;
  }

  const REFRESH_ENV: MaterializeEnv = {
    ...NOOP_MATERIALIZE_ENV,
    daemonInstalled: false,
    deckOnPath: true,
    deckHealthy: true,
    boardRepoPath: "/repos/mr-board",
    trackedRepos: [{ name: "gitq", path: "/repos/gitq", present: false }],
  };

  function refreshExec(): FakeMaterializeExecSeam {
    const exec = new FakeMaterializeExecSeam();
    exec.script(["rt", "daemon", "install"], { stdout: "daemon not yet responding: approve it in System Settings", stderr: "", exitCode: 0 });
    return exec;
  }

  const refreshRun = (exec: FakeMaterializeExecSeam = refreshExec(), env: MaterializeEnv = REFRESH_ENV) =>
    runHomeInit(FULLY_PROVISIONED_PROBES(), new FakeSeam(), new FakeAgeKeySeam(), [], new FakeSopsYamlSeam(), KEY, new UnreachablePickerSeam(), () => false, async () => env, exec);

  test("each refresh stage is its own rt-ui step, ended in its own state, and nothing it painted reaches stdout", async () => {
    const { exitCode, logs } = await refreshRun();

    expect(exitCode).toBeUndefined();
    expect(stages()).toEqual([
      [{ t: "start", title: "Set up rt's git intercept" }, { t: "done", title: "Set up rt's git intercept" }],
      [{ t: "start", title: "Set up the rt daemon" }, { t: "done", title: "Set up the rt daemon" }],
      [
        { t: "start", title: "Some tracked repos are not on this Mac yet" },
        { t: "done", title: "Some tracked repos are not on this Mac yet", hint: "gitq", status: "needs-you" },
      ],
      [{ t: "start", title: "Set up deck" }, { t: "done", title: "Set up deck", hint: "deck is already running well", status: "skipped" }],
      [{ t: "start", title: "Set up mr-board" }, { t: "done", title: "Set up mr-board", hint: "you run this one yourself", status: "needs-you" }],
    ]);
    expect(logs.some((l) => /^\[[a-z ]+\] (Set up (rt's git intercept|the rt daemon|deck|mr-board)|Some tracked repos)/.test(l))).toBe(false);
    expect(logs.some((l) => l.includes("approve it in System Settings"))).toBe(true);
    expect(logs.at(-1)).toBe(`[ok] This Mac is set up  ${mattstackHome()}`);
  });

  test("a refresh step rt does not own that fails ends warn, with what it said printed after it", async () => {
    const exec = new FakeMaterializeExecSeam();
    exec.script(["deck", "setup"], { stdout: "", stderr: "deck exploded", exitCode: 1 });
    const { exitCode, logs } = await refreshRun(exec, { ...NOOP_MATERIALIZE_ENV, deckOnPath: true });

    expect(exitCode).toBeUndefined();
    expect(stages()[1]).toEqual([{ t: "start", title: "Set up deck" }, { t: "done", title: "Set up deck", status: "warn" }]);
    expect(logs.some((l) => l.includes("deck exploded"))).toBe(true);
  });

  test("a failed stage keeps its progress line and ends failing", async () => {
    const seam = new FakeSeam({ failRun: (cmd) => cmd[1] === "clone" });
    const { exitCode, logs, errors } = await runHomeInit(fakeProbes({}), seam, new FakeAgeKeySeam(), ["--url", TEST_URL]);

    expect(exitCode).toBe(1);
    expect(stages().find((s) => s[0]?.title === "Clone your home repo")).toEqual([
      { t: "start", title: "Clone your home repo" },
      { t: "sub", text: `Cloning ${TEST_URL}` },
      { t: "fail", title: "Clone your home repo", hint: TEST_URL },
    ]);
    expect(logs).not.toContain(`[failed] Clone your home repo  ${TEST_URL}`);
    expect(errors[0]).toBe("rt could not clone your home repo");
  });

  test("a helper that dies leaves one plain line per stage, each with its guidance after it", async () => {
    process.env.RT_UI_FAKE = JSON.stringify({ dieOn: "start" });
    const { exitCode, logs } = await refreshRun();

    expect(exitCode).toBeUndefined();
    expect(logs).toContain("[ok] Set up rt's git intercept");
    const daemon = logs.indexOf("[ok] Set up the rt daemon");
    expect(daemon).toBeGreaterThan(logs.indexOf("[ok] Set up rt's git intercept"));
    expect(logs[daemon + 1]).toContain("approve it in System Settings");
    expect(logs).toContain("[needs you] Some tracked repos are not on this Mac yet  gitq");
    expect(logs).toContain("[skipped] Set up deck  deck is already running well");
    expect(logs).toContain("[needs you] Set up mr-board  you run this one yourself");
  });
});
```

The record holds one batch per helper process because each stage ends its helper before the next opens, and a done stage sends no `status` (`stage()` passes one only for the other states). `{ dieOn: "start" }` makes each helper exit 70 after `start`, so `done` resolves false and `stage()` prints the plain line itself.

`ExecResult` is already imported in the test file. The first test builds its escape with `\x1b` inside a test file, which the raw-output guard does not scan.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/home.test.ts`
Expected: FAIL across the `homeInit` tests: `logs` and `errors` are empty, since `init` still prints through `console`.

- [ ] **Step 3: Replace the imports and the printing helpers in `commands/home.ts`**

Delete the line `import { bold, dim, green, red, reset, yellow } from "../lib/ansi.ts";`.

Add to the imports:

```ts
import { logCliEvent } from "../lib/cli-logger.ts";
import type { Block, RenderStatus } from "../lib/ui/protocol.ts";
import { openStep, type StepHandle } from "../lib/ui/spawn.ts";
import { interactive } from "../lib/ui/gate.ts";
import { withoutUrls } from "../lib/team/redact.ts";
```

and change the `init-exec.ts` import to `import { createRealExecSeam, executeInitPlan, INIT_STEP_FAILED, type ExecSeam, type InitResult } from "../lib/home/init-exec.ts";` (merge `Block` into the protocol import Task 5 added). The `materialize.ts` import already names `type MaterializeExecSeam` and `type MaterializeResult` (`commands/home.ts:71-79`); leave it as it is.

In `lib/home/init-exec.ts`, add below `export type InitResult = ...`:

```ts
/** The failure title per init step. `lib/setup/steps/home.ts` keys its clone remedy on the clone's entry, so the words here are the contract between the two. */
export const INIT_STEP_FAILED: Record<InitStep["kind"], string> = {
  ensureStateDirs: "rt could not create its state folders",
  cloneUserRepo: "rt could not clone your home repo",
  initUserRepo: "rt could not start your home repo",
  commitInitialUserRepo: "rt could not make the first commit in your home repo",
  writeGitignore: "rt could not write the home repo's ignore file",
  writeOwners: "rt could not write the list of paths you commit by hand",
  writeMachineKey: "rt could not name this Mac",
  ensureProfileDir: "rt could not create this Mac's profile",
  writeSkillsSymlink: "rt could not link your skills list",
};
```

In `commands/home.ts`, give the two argument errors plain messages with no flag and no example; the flag reaches the person as the usage failure's `next` (Step 4, item 1):

```ts
    throw new InvalidUrlArgError("Give it the address of your home repo.");
```

```ts
    throw new InvalidProfileArgError("Give it the name of a machine profile.");
```

Replace `describeStep` with a name and a hint per step, the same words for the plan row and for the stage:

```ts
function describeStep(step: InitStep): { title: string; hint?: string } {
  switch (step.kind) {
    case "ensureStateDirs":
      return { title: "Create the folders rt keeps its state in", hint: step.dirs.join(", ") };
    case "cloneUserRepo":
      return { title: "Clone your home repo", hint: step.url };
    case "initUserRepo":
      return { title: "Start a home repo on this Mac only", hint: "no remote" };
    case "commitInitialUserRepo":
      return { title: "Commit the first version of your home repo" };
    case "writeGitignore":
      return { title: "Add the home repo's ignore file" };
    case "writeOwners":
      return { title: "Add the list of paths you commit by hand" };
    case "writeMachineKey":
      return { title: "Name this Mac", hint: step.key };
    case "ensureProfileDir":
      return { title: "Create this Mac's profile", hint: step.key };
    case "writeSkillsSymlink":
      return { title: "Link your skills list into your home repo" };
  }
}

/** Where a stage ended. `failed` ends its rt-ui step failing; any other status ends it in place, in that state. */
interface StageEnding {
  status: Exclude<RenderStatus, "running">;
  title: string;
  hint?: string;
}

/**
 * One rt-ui step per stage a person watches: its progress is the step's
 * sub-line (cleared when the step ends done, kept when it fails) and goes to
 * the CLI log. Off a terminal, or when the helper cannot start or dies, the
 * same ending prints as one plain line.
 */
async function stage(title: string, task: (sub: (text: string) => void) => Promise<StageEnding>): Promise<StageEnding> {
  let step: StepHandle | null = null;
  if (interactive()) {
    try {
      step = openStep(title);
    } catch {
      step = null;
    }
  }
  const sub = (text: string) => {
    step?.sub(text);
    // A clone url can carry a token: neither --url nor RT_HOME_URL is checked for credentials.
    logCliEvent("debug", "home", withoutUrls(text));
  };
  let ending: StageEnding;
  try {
    ending = await task(sub);
  } catch (err) {
    if (step) await step.fail(title);
    throw err;
  }
  const painted =
    step === null
      ? false
      : ending.status === "failed"
        ? await step.fail(ending.title, ending.hint)
        : await step.done(ending.title, ending.hint, ending.status === "done" ? undefined : ending.status);
  if (!painted) out.print(out.line(ending.status, ending.title, ending.hint));
  return ending;
}

function failInit(failure: out.FailureInput, ...after: Block[]): never {
  out.fail(failure, ...after);
  process.exit(1);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** What a child process said, under the failure: the title stays one clean line and the renderer strips its escapes. */
function childOutput(text: string): Block[] {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  return lines.length > 0 ? [out.verbatim(lines, "what it said")] : [];
}

function planBlock(home: string, steps: InitStep[]): Block {
  return out.section(
    "Setting up your home folder",
    home,
    ...steps.map((step) => {
      const { title, hint } = describeStep(step);
      return out.line("pending", title, hint);
    }),
  );
}

function skillsLinkBlocked(home: string): Block[] {
  return [out.line("needs-you", "A file is in the way of your skills link", join(home, "skills.jsonc")), out.callout("fix", "Move it aside, then run this again")];
}

/** One stage per plan step, stopping at the first failure as executeInitPlan does. */
async function runInitSteps(steps: InitStep[], exec: ExecSeam): Promise<InitResult> {
  for (const step of steps) {
    const { title, hint } = describeStep(step);
    const outcome: { result?: InitResult } = {};
    await stage(title, async (sub) => {
      outcome.result = await executeInitPlan([step], exec, sub);
      return { status: outcome.result.ok ? "done" : "failed", title, hint };
    });
    if (outcome.result && !outcome.result.ok) return outcome.result;
  }
  return { ok: true };
}
```

Change the result type:

```ts
export type EnsureHomeAgeKeyResult = { ok: true } | { ok: false; failure: out.FailureInput };
```

In `ensureHomeAgeKey`, replace the `if (mismatched && minted) { return {...}; }` block's return value with:

```ts
    return {
      ok: false,
      failure: {
        title: "This Mac's key cannot open your secrets",
        why: `They are locked to ${existingRecipient ?? "a key rt does not recognise"}. A new key was already minted and stored for this Mac, and it is not the one they need.`,
        next: out.cmd("rt home key import --force"),
      },
    };
```

replace the `if (mismatched) { return {...}; }` block's return value with:

```ts
    return {
      ok: false,
      failure: {
        title: "This Mac's key does not match your secrets",
        why: `They are locked to ${truncateKey(existingRecipient ?? "a key rt does not recognise")}, and this Mac holds ${truncateKey(publicKey)}. rt will not change which key they are locked to by itself.`,
        next: out.cmd("rt home key import --force"),
        details: "To change the key on purpose is a deliberate ceremony: rewrite the recipient in your home repo by hand, then save each secret again with rt secrets set.",
      },
    };
```

(the two comments above those blocks stay), and replace the two `console.log(...)` statements at the end of the function with:

```ts
  if (existing === null) {
    sopsYamlSeam.write(sopsYamlPath, renderSopsYaml(publicKey));
    out.print(
      out.line("done", "Set up secrets for your home repo", "this adds one tracked file"),
      out.callout("next", "Commit it:"),
      out.copy(`git -C ${userDir} add .sops.yaml && git -C ${userDir} commit -m "home: sops recipient"`),
    );
  }

  out.print(out.line("done", "This Mac's secrets key is ready", truncateKey(publicKey)), out.callout("next", ["Save it to your password manager: ", out.cmd("rt home key export")]));
```

(`truncateKey` is defined further down the file as a function declaration, so it is in scope here.)

In `planOrExit`, replace the two statements inside `if (err instanceof InvalidMachineKeyError) { ... }` with:

```ts
      failInit({ title: "rt cannot use that name for this Mac", why: err.message });
```

Delete `printPlan` and `printSkillsSymlinkBlocked` (their callers are replaced in Step 4).

Replace `describeMaterializeStep`, `printIndented` and `printMaterializeResults` with:

```ts
/** The plan row for a refresh step: what it is, and how a dry run expects it to end. */
function describeMaterializeStep(step: MaterializeStep): { title: string; status: RenderStatus; hint?: string } {
  switch (step.kind) {
    case "rtInterceptInstall":
      return { title: "Set up rt's git intercept", status: "pending" };
    case "rtDaemonInstall":
      return { title: "Set up the rt daemon", status: "pending" };
    case "reportMissingRepos":
      return { title: "Some tracked repos are not on this Mac yet", status: "needs-you", hint: step.names.join(", ") };
    case "deckSetup":
      return { title: "Set up deck", status: "pending" };
    case "reportDeckHealthy":
      return { title: "Set up deck", status: "skipped", hint: "deck is already running well" };
    case "reportDeckUnhealthy":
      return { title: "Set up deck", status: "skipped", hint: "the app's deck helper owns deck" };
    case "boardSetup":
      return { title: "Set up mr-board", status: "needs-you", hint: "you run this one yourself" };
  }
}

/** A failed step is coral only when it is one rt owns: that is the only kind that fails the run. */
function refreshEnding(result: MaterializeResult): StageEnding {
  const { title, status, hint } = describeMaterializeStep(result.step);
  if (!result.ok) return { status: RT_OWN_STEP_KINDS.has(result.step.kind) ? "failed" : "warn", title };
  return { status: status === "pending" ? "done" : status, title, hint };
}

/** One stage per refresh step; every step runs whatever an earlier one did, as runMaterialize does. True when a step rt owns failed. */
async function runRefreshSteps(steps: MaterializeStep[], exec: MaterializeExecSeam, rtBin: string): Promise<boolean> {
  let rtOwnFailed = false;
  for (const step of steps) {
    const outcome: { result?: MaterializeResult } = {};
    await stage(describeMaterializeStep(step).title, async () => {
      [outcome.result] = await runMaterialize([step], exec, rtBin);
      return refreshEnding(outcome.result!);
    });
    const result = outcome.result!;
    // A sub-line clears when its step ends done, and this guidance must outlive the step.
    const detail = [result.ok ? "" : result.stderr, result.stdout, result.note].filter((text) => text !== "").flatMap((text) => text.split("\n"));
    if (detail.length > 0) out.print(out.verbatim(detail));
    if (!result.ok && RT_OWN_STEP_KINDS.has(step.kind)) rtOwnFailed = true;
  }
  return rtOwnFailed;
}
```

A step that only reports (`reportMissingRepos`, `reportDeckHealthy`, `reportDeckUnhealthy`, `boardSetup`) spawns nothing in `runMaterialize`, so its stage opens and ends at once; that is the line a person needs to see. `refreshEnding` keeps a report step's own state, so tracked repos missing from this Mac end `needs-you`, never `[ok]`: `runMaterialize` returns `ok` for that step, and only `pending` turns into `done`.

Replace `printClaudePluginsPointer` with:

```ts
function printClaudePluginsPointer(): void {
  const message = claudePluginsPointerMessage(getSetting<unknown>("claude.marketplaces").value, getSetting<unknown>("claude.plugins").value);
  if (message) out.print(out.paragraph(message));
}
```

- [ ] **Step 4: Replace each print site in `homeInit`**

Work down the function. Each item names the statement it replaces.

1. The `catch` after `resolveHomeUrl` and `parseProfileArg` (the `if (err instanceof InvalidUrlArgError || err instanceof InvalidProfileArgError) { ... }` block):

```ts
    if (err instanceof InvalidUrlArgError) failInit(usageFailure("Which repo should rt clone?", "rt home init --url <remote>", err.message));
    if (err instanceof InvalidProfileArgError) failInit(usageFailure("Which machine profile?", "rt home init --profile <key>", err.message));
    throw err;
```

2. The fresh-machine dry run (from `const previewPlan = ...` to its `return;`):

```ts
        const previewPlan = planOrExit(state, { url: resolvedUrl, machineKey: key });
        out.print(
          planBlock(home, previewPlan.steps),
          out.callout("note", `This Mac has no machine-key file yet, and its profiles are only known once the repo above is cloned, so "${key}" is a stand-in. Name the profile ahead of time to settle it.`),
          // The refresh depends on what the clone lands, so it cannot be previewed from here; staying silent would let a fresh Mac's dry run imply provisioning is the whole story.
          ...(noMaterialize ? [] : [out.callout("note", "rt will also refresh what it generates from your settings. That plan can only be shown once your home repo is cloned.")]),
        );
        if (previewPlan.blocked === "skills-symlink-real-file") out.print(...skillsLinkBlocked(home));
        return;
```

3. The clone phase (from `printPlan(home, clonePlan.steps);` through the `if (!cloneResult.ok) { ... }` block):

```ts
      out.print(planBlock(home, clonePlan.steps));

      const cloneResult = await runInitSteps(clonePlan.steps, exec);
      if (!cloneResult.ok) failInit({ title: INIT_STEP_FAILED[cloneResult.failedStep] }, ...childOutput(cloneResult.stderr));
```

4. The `catch` after `chooseMachineProfile` (the block that tests the four error classes):

```ts
      if (
        err instanceof UnknownProfileFlagError ||
        err instanceof ProfileChoiceRequiredError ||
        err instanceof ProfileNameCollisionError ||
        err instanceof InvalidProfileKeyError
      ) {
        const next =
          err instanceof UnknownProfileFlagError
            ? `rt home init --profile ${err.profile} --new-profile`
            : err instanceof ProfileNameCollisionError
              ? "rt home init --profile <name> --new-profile"
              : "rt home init --profile <key>";
        failInit({
          title: err instanceof ProfileChoiceRequiredError ? "Which machine profile should this Mac use?" : "That machine profile will not work",
          why: err.message,
          next: out.cmd(next),
        });
      }
      throw err;
```

5. The `prompt-needed` dry run (the `console.log(...)` and `return;`):

```ts
        out.print(
          out.line("needs-you", "This Mac needs a machine profile", `existing: ${profiles.join(", ")}`),
          out.callout("note", `A live run asks you to pick one, or to start a new one called ${key}.`),
        );
        return;
```

6. No profile picked (the `console.error(...)` and `process.exit(1)` after `pickerSeam.pick`):

```ts
        failInit({ title: "No machine profile was chosen", next: out.cmd("rt home init --profile <key>") });
```

7. Profile flags on a keyed Mac (the `else if (profileFlag !== undefined || newProfileFlag) { ... }` body; its comment stays). rt declines by rule here, so it is a refusal:

```ts
    refuse(
      "This Mac already has a machine profile",
      out.callout("why", `It is pinned to "${key}" in its machine-key file. Naming a profile only applies while a Mac is choosing its first one.`),
    );
```

8. The materialize preview's `catch`:

```ts
      out.print(out.line("warn", "rt could not preview what it would refresh", errorMessage(err)));
```

9. The plan print and the nothing-to-do line (the `if (plan.steps.length > 0) { ... } else if (...) { ... }` statement; its comment stays):

```ts
  if (plan.steps.length > 0) {
    out.print(planBlock(home, plan.steps));
  } else if (!plan.blocked && (dryRun ? materializeSteps.length === 0 : noMaterialize)) {
    out.print(out.line("skipped", "Nothing to set up", "your home folder is already in place"));
  }

  if (plan.blocked === "skills-symlink-real-file") out.print(...skillsLinkBlocked(home));
```

10. The dry run's materialize list (inside `if (dryRun) { ... }`):

```ts
    if (materializeSteps.length > 0) {
      const rows = materializeSteps.map((step) => {
        const { title, status, hint } = describeMaterializeStep(step);
        return out.line(status, title, hint);
      });
      out.print(out.section("rt would also refresh what it generates from your settings", undefined, ...rows));
    }
    return;
```

11. The plan run and its failure:

```ts
  const result = await runInitSteps(plan.steps, exec);
  if (!result.ok) failInit({ title: INIT_STEP_FAILED[result.failedStep] }, ...childOutput(result.stderr));
```

12. The age key refusal (its comment stays):

```ts
  const ageKeyResult = await ensureHomeAgeKey(ageKeySeam, sopsYamlSeam);
  if (!ageKeyResult.ok) failInit(ageKeyResult.failure);
```

13. The blocked ending. rt declines to overwrite a real file, so it is a refusal:

```ts
  if (plan.blocked === "skills-symlink-real-file") {
    refuse(
      "Your home folder is set up, apart from your skills link",
      out.callout("why", `${join(home, "skills.jsonc")} is a real file, and rt will not overwrite it.`),
      out.callout("fix", "Move it aside, then run this again"),
    );
  }
```

14. The materialize phase (the `if (noMaterialize) { ... } else { try { ... } catch { ... } }` statement; the comment above it stays):

```ts
  let materializeFailed = false;
  if (noMaterialize) {
    out.print(out.line("skipped", "Skipped the refresh of what rt generates from your settings"));
  } else {
    try {
      const env = await materializeEnv();
      materializeFailed = await runRefreshSteps(planMaterialize(env), materializeExec, rtSelfBin());
    } catch (err) {
      out.print(out.line("warn", "rt could not refresh what it generates from your settings", errorMessage(err)));
    }
  }
```

Then run: `grep -n "runMaterialize(\|materializeBlock\|withTransientStep" commands/home.ts`
Expected: only the one `runMaterialize([step], ...)` call inside `runRefreshSteps`.

15. The Claude plugins pointer's `catch`:

```ts
    out.print(out.line("warn", "rt could not check your Claude plugin settings", errorMessage(err)));
```

16. The rt-owned failure and the success line (the comment above the `if` stays):

```ts
  if (materializeFailed) {
    failInit({ title: "rt could not refresh one of its own pieces", why: "The step marked failed above is one rt needs.", next: out.cmd("rt home init") });
  }

  out.print(out.line("done", "This Mac is set up", home));
```

Then confirm nothing raw is left:

Run: `grep -n "console\.\|process\.stdout\|process\.stderr\|\${dim}\|\${reset}\|\${green}\|\${red}\|\${yellow}\|\${bold}" commands/home.ts`
Expected: no output.

- [ ] **Step 5: Delete the allowlist line**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `"commands/home.ts",`.

- [ ] **Step 6: Run the tests and the guards**

Run: `bun test commands/__tests__/home.test.ts lib/home/__tests__ lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts`
Expected: PASS. If a `homeInit` assertion not listed in Step 1 fails, it pins a string this task reworded: read the new output in the failure message and update the substring to the new words, never the code to the old ones.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add commands/home.ts commands/__tests__/home.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "rt home init: one rt-ui step per stage, the plan and every refusal through the output layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The setup step reads `home init`'s new output

`lib/setup/steps/home.ts` runs `rt home init` for the setup app, with no terminal, and reads three things from what it prints: the last stdout line becomes the step's done detail; `failureDetail` picks the stderr line that names the error, carrying a header that ends in `:` together with the line after it; and `homeInitRemedy` sends a bare "permission denied" to `gh auth login` only when the stderr also matches `CLONE_STEP_STDERR`, `/failed at step "cloneUserRepo"/`. After Task 6 that header is gone, so the remedy would silently fall back to "check the error above" for a clone that failed on auth. The controller's ruling: phase 3 merges first (Task 1 checked), then this slice makes the minimal edit to those three readers, with tests against the new output, and touches no other `lib/setup` file. Phase 3 rewrote strings in this file, so this task cites functions and tests by name, never by line.

The ruling prefers a stable machine signal over prose. Neither cheap one is open: the exit code is frozen (1 for every `home init` failure, a refusal included), and a `--json` mode would change what the tray reads, since `homeInitCheck` already passes `--json` and relies on it closing the human gate to get plain text. So the signal is a constant both sides import: `INIT_STEP_FAILED` (Task 6) is the title `home init` prints first on a failed step, and the setup step keys on `INIT_STEP_FAILED.cloneUserRepo` instead of a copy of its words. Rewording a title moves both together, and the tests below build their stderr from the constant.

**Files:**
- Modify: `lib/setup/steps/home.ts` (`failureDetail`, `CLONE_STEP_STDERR` and `homeInitRemedy`, the done detail in `homeInitRun`)
- Modify: `lib/setup/__tests__/home-failure-detail.test.ts`, `lib/setup/__tests__/steps-a.test.ts` (the `home.init` tests that feed it `rt home init`'s output)

**Interfaces:**
- Consumes: `INIT_STEP_FAILED` (`lib/home/init-exec.ts`, Task 6). The output Task 6 settled, off a terminal: a run that set the Mac up ends stdout with `[ok] This Mac is set up  <home>`; a failed plan step prints `INIT_STEP_FAILED[kind]` as stderr's first line, then `what it said:` and the child's lines indented two spaces; any other failure prints its title first, then `  why:`, `  next:` and `  fix:` lines; a refusal's first line is `[refused] <title>`.
- Produces: `failureDetail(stderr)` and `homeInitRemedy(stderr)` keep their signatures; `homeInitDoneDetail(stdout: string): string` is exported from `lib/setup/steps/home.ts`.

- [ ] **Step 1: Write the failing tests**

In `lib/setup/__tests__/home-failure-detail.test.ts`, add `import { INIT_STEP_FAILED } from "../../home/init-exec.ts";`, import `homeInitDoneDetail` beside the other two, and replace the two tests about the old header (`a header line ending in a colon carries the next line with it` and `a header line with no following line still reports itself`, with the comment above them) with:

```ts
  // rt home init leads with the failed step's title and puts what the child
  // said under "what it said:"; the title alone hides the cause.
  test("a home init failure title carries the line under it that names the error", () => {
    const stderr = [INIT_STEP_FAILED.commitInitialUserRepo, "what it said:", "  fatal: empty ident name not allowed"].join("\n");
    expect(failureDetail(stderr)).toBe(`${INIT_STEP_FAILED.commitInitialUserRepo}: fatal: empty ident name not allowed`);
  });

  test("a home init failure title with no error word under it carries the first line it said", () => {
    const stderr = [INIT_STEP_FAILED.cloneUserRepo, "what it said:", "  remote: Repository not found."].join("\n");
    expect(failureDetail(stderr)).toBe(`${INIT_STEP_FAILED.cloneUserRepo}: remote: Repository not found.`);
  });

  test("a home init failure title with nothing under it still reports itself", () => {
    expect(failureDetail(INIT_STEP_FAILED.cloneUserRepo)).toBe(INIT_STEP_FAILED.cloneUserRepo);
  });

  test("rt's own why and next lines are guidance, not the error", () => {
    const stderr = ["rt could not refresh one of its own pieces", "  why: The step marked failed above is one rt needs.", "  next: rt home init"].join("\n");
    expect(failureDetail(stderr)).toBe("rt could not refresh one of its own pieces");
  });

  test("a refusal reads without its plain tag", () => {
    const stderr = ["[refused] Your home folder is set up, apart from your skills link", "  why: /x/skills.jsonc is a real file, and rt will not overwrite it."].join("\n");
    expect(failureDetail(stderr)).toBe("Your home folder is set up, apart from your skills link");
  });
```

and add to the file:

```ts
describe("homeInitDoneDetail", () => {
  test("the done detail is home init's ending line without its tag", () => {
    expect(homeInitDoneDetail("[ok] Clone your home repo  https://forge.example.test/sample/home.git\n[ok] This Mac is set up  /fake-home/.mattstack\n")).toBe(
      "This Mac is set up  /fake-home/.mattstack",
    );
  });
});

describe("homeInitRemedy: the clone step", () => {
  test("a bare permission denial under the clone title is auth-shaped, and the same denial under another step is not", () => {
    const auth = homeInitRemedy("fatal: Authentication failed for 'https://forge.example.test/sample/home.git/'");
    expect(homeInitRemedy([INIT_STEP_FAILED.cloneUserRepo, "what it said:", "  remote: Permission denied"].join("\n"))).toBe(auth);
    expect(homeInitRemedy([INIT_STEP_FAILED.initUserRepo, "what it said:", "  fatal: cannot mkdir user: Permission denied"].join("\n"))).not.toBe(auth);
  });
});
```

The remedy tests compare against the remedy for an unambiguous auth failure rather than spelling it, so they hold whatever words phase 3 gave it.

In `lib/setup/__tests__/steps-a.test.ts`, add `import { INIT_STEP_FAILED } from "../../home/init-exec.ts";` and, in `describe("home.init", ...)`, change only the `rt home init` output each test feeds and what it expects back; every expected `remedy` keeps the words it has on main:

- ``missing clone -> runs `rt home init`; success reports the last stdout line``: rename it ``missing clone -> runs `rt home init`; the done detail is home init's ending line without its tag``; its fake returns `ok("[ok] Clone your home repo  https://forge.example.test/sample/home.git\n[ok] This Mac is set up  /fake-home/.mattstack")`, and the expected outcome's `detail` is `"This Mac is set up  /fake-home/.mattstack"`.
- ``a local-only `git init` failure contacts no host ...``: its stderr becomes `` `${INIT_STEP_FAILED.commitInitialUserRepo}\nwhat it said:\n  fatal: empty ident name not allowed` ``.
- `a LOCAL permission failure is not an auth failure ...`: its stderr becomes `` `${INIT_STEP_FAILED.initUserRepo}\nwhat it said:\n  fatal: cannot mkdir user: Permission denied` ``.
- `a bare permission denial from the clone step IS auth-shaped ...`: its stderr becomes `` `${INIT_STEP_FAILED.cloneUserRepo}\nwhat it said:\n  remote: Permission denied` ``, and add `` expect(outcome).toMatchObject({ detail: `${INIT_STEP_FAILED.cloneUserRepo}: remote: Permission denied` }); `` after its existing assertion.

The other `home.init` tests (`gh: not authenticated`, ssh's `Permission denied (publickey)`) feed stderr that names the remote on its own and do not change.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/setup/__tests__/home-failure-detail.test.ts lib/setup/__tests__/steps-a.test.ts`
Expected: FAIL. `homeInitDoneDetail` is not exported; `failureDetail` returns the child's line without the title, and the callout and tag cases return the `why:` line and the tagged title; the clone test gets the "check the error above" remedy, because `CLONE_STEP_STDERR` no longer matches.

- [ ] **Step 3: Read the new output in `lib/setup/steps/home.ts`**

Add `import { INIT_STEP_FAILED } from "../../home/init-exec.ts";` to the imports.

Replace `failureDetail` (keep its doc comment, and add the sentence the last bullet below names):

```ts
const ERROR_WORDS = /\b(error|Error|EACCES|ENOENT|denied|failed|fatal)\b/;
const INIT_FAILURE_TITLES = new Set<string>(Object.values(INIT_STEP_FAILED));

export function failureDetail(stderr: string): string {
  const lines = stderr
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return "";

  // `79828 |  code`, `      ^`, `    at fn (file:1:2)`: bun's crash frames.
  const isFrame = (l: string) => /^\d+\s*\|/.test(l) || /^\^+$/.test(l) || /^at\s/.test(l);

  // rt home init leads a failed step with its title and puts what the child said under "what it said:".
  const title = lines[0]!;
  if (INIT_FAILURE_TITLES.has(title)) {
    const said = lines.slice(1).filter((l) => l !== "what it said:" && !isFrame(l));
    const cause = said.find((l) => ERROR_WORDS.test(l)) ?? said[0];
    return cause === undefined ? title : `${title}: ${cause}`;
  }

  // rt's own why, next, fix and note lines are guidance under a title, never the error.
  const isCallout = (l: string) => /^(why|next|fix|note):/.test(l);
  const named = lines.find((l) => ERROR_WORDS.test(l) && !isFrame(l) && !isCallout(l));
  const chosen = named ?? lines.find((l) => !isFrame(l)) ?? lines[0]!;
  if (chosen.endsWith(":")) {
    const next = lines[lines.indexOf(chosen) + 1];
    if (next !== undefined && !isFrame(next)) return `${chosen} ${next}`;
  }
  // A plain status tag (`[refused] `) means nothing in the app's one-line detail.
  return chosen.replace(/^\[[a-z ]+\] /, "");
}
```

Carry over whatever phase 3 changed inside the old body (a reworded comment, a renamed local) where the same logic survives here; the behavior above is what the tests pin. In the doc comment, replace the sentence about a header ending in `:` that quotes `failed at step` with: `rt home init's own failures lead with a title from INIT_STEP_FAILED, and the cause sits under it.`

Replace `CLONE_STEP_STDERR` and its doc comment with:

```ts
/** `rt home init` leads a failed clone with this title; only the clone step ever contacts a host. */
const CLONE_FAILED_TITLE = INIT_STEP_FAILED.cloneUserRepo;
```

and in `homeInitRemedy`, replace `CLONE_STEP_STDERR.test(stderr)` with `stderr.split("\n").some((l) => l.trim() === CLONE_FAILED_TITLE)`. Nothing else in that function changes.

Add above `homeInitRun`:

```ts
/** `rt home init`'s last stdout line is its ending (`[ok] This Mac is set up  <home>` off a terminal); the app shows it without the tag. */
export function homeInitDoneDetail(stdout: string): string {
  const last = stdout.trim().split("\n").pop() ?? "";
  return last.replace(/^\[[a-z ]+\] /, "");
}
```

and in `homeInitRun`, replace the two lines that build the done outcome from the last stdout line with `return { state: "done", detail: homeInitDoneDetail(result.stdout) };`.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/setup/__tests__/home-failure-detail.test.ts lib/setup/__tests__/steps-a.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-daemon-sync-exec.test.ts`
Expected: PASS. `lib/home/init-exec.ts` spawns through `Bun.spawn` only, so the import adds no sync exec to anything the daemon loads.

Run: `grep -rn "failed at step" lib/setup lib/home commands/home.ts`
Expected: no output.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/steps/home.ts lib/setup/__tests__/home-failure-detail.test.ts lib/setup/__tests__/steps-a.test.ts
```

```bash
git commit -m "setup: the home step reads rt home init's new output, keyed on its shared failure titles

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The copy pass on `lib/release`'s human strings

Applies the `lib/release` copy table in Task 2 (rows R1 to R33 with R10b). Every row keeps its `id`, `label`, `status` and every value beside `detail`; every error keeps its `code`.

**Files:**
- Modify: `lib/release/verify.ts:91, :98, :100, :102, :165, :171, :174-176, :218, :232, :239, :274, :286`
- Modify: `lib/release/update-machine.ts:120, :126, :129, :136, :139, :227, :532, :597, :745-760, :769, :800-803, :813, :817`
- Modify: `lib/release/release-app.ts:180, :247, :251, :330, :332, :480, :505, :511, :523`
- Modify: `lib/release/__tests__/verify.test.ts`, `lib/release/__tests__/update-machine.test.ts`, `commands/__tests__/release-update-machine.test.ts:162`

**Interfaces:**
- Consumes: `UserActionableError(code, message, extra?, options?: { why?: string; next?: string; log?: string })` (`lib/errors.ts`, phase 2).
- Produces: nothing a later task calls by name. Task 9's update-machine tests read R19 (the refusal) and R23 (a leg the stop skipped).

- [ ] **Step 1: Write the failing tests**

In `lib/release/__tests__/verify.test.ts`:

| Line | Today's expected value | New expected value |
|---|---|---|
| 60 | `toContain("local v* tag")` | `toContain("the newest release tag on this Mac")` |
| 82 | `toContain("newest GitHub release")` | `toContain("the newest release on GitHub")` |
| 295 | `toContain("never gh release edit")` | `toContain("never edit the release by hand")` |

Lines 156 and 157 (`gh release delete`, `gh run rerun`), 293 and 294, 314 and 315, 328 and 329 (`gh release edit`, `--draft=false`), 367, 386 (`draft`) and 397 (`missing`) keep their phrase and do not change. In the test `pending within the propagation window when the endpoint lags` (line 345), add after its `status` assertion:

```ts
    expect(row.detail).toStartWith("still propagating: published ");
```

and add to `describe("checkReleaseAssets", ...)`:

```ts
  test("the words the release skills read are still there", () => {
    expect(checkReleaseAssets("v2.10.2", { ...RELEASE, assets: [] }).detail).toStartWith("missing assets: ");
    expect(checkReleaseState({ ...RELEASE, isDraft: true }).detail).toStartWith("still a draft. To publish it: ");
  });
```

In `lib/release/__tests__/update-machine.test.ts`: line 338 `toContain("declined")` becomes `toContain("You said no at the prompt")`; lines 363 and 777 `toContain("halted after")` become `toContain("the run stopped at")`.

Then find any assertion this list missed. Run each alone and read every hit:

- `grep -rn "latest local v\|via the newest\|could not resolve a default tag\|completed with conclusion\|could not reach gh\|to recheck\|hand-completion\|releases/latest will not\|endpoint can lag" lib/release/__tests__ commands/__tests__ e2e/tests`
- `grep -rn "must look like a released tag\|could not resolve the\|returned no tag_name\|returned no sha\|the ref must be\|mutually exclusive\|refusing to touch\|refusing to restart\|move-aside-replace\|sha256-verify\|declined at the" lib/release/__tests__ commands/__tests__ e2e/tests`
- `grep -rn "no vX.Y.Z tag\|run rt release verify\|not a fast-path diff\|not allowed to update main\|could not update main\|generate RELEASE_NOTES\|does not match these notes\|need approval; nothing" lib/release/__tests__ commands/__tests__ e2e/tests`

A hit inside an `expect(...)` on a value rt produced is an assertion on the old copy: change it to the row's new copy. A hit inside a fake (a fixture report, a scripted exec reply, a test name) stays. One of them is `commands/__tests__/release-update-machine.test.ts:162` (`toContain("[failed] refuses to run state-changing legs ...")`, without the tag after 5a): make it `toContain("rt will not change this Mac without a terminal to confirm each step")` here; Task 9 turns it into the refusal's full text.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/release/__tests__/verify.test.ts lib/release/__tests__/update-machine.test.ts`
Expected: FAIL on every changed assertion and on the new skill-words test (`missing asset(s):` and `still a draft (recovery:` today).

- [ ] **Step 3: Reword `lib/release`**

Work down the table. A row whose "Becomes" is a single string replaces the template literal or string at its site, keeping each `${...}` the row's `<x>` stands for. The rows that need more than that:

Rows R12 to R16, `lib/release/update-machine.ts:117-140`:

```ts
      throw new UserActionableError("update-machine-bad-tag", `"${explicit}" is not a release tag`, {}, { why: "A release tag looks like v2.19.0." });
```

```ts
    throw new UserActionableError("update-machine-resolve-tag-failed", `rt could not find the latest release: ${execTail(r)}`);
```

```ts
  if (!tag) throw new UserActionableError("update-machine-resolve-tag-failed", "GitHub did not name the latest release");
```

```ts
    throw new UserActionableError("update-machine-resolve-commit-failed", `rt could not find the commit for ${tag}: ${execTail(r)}`);
```

```ts
  if (!sha) throw new UserActionableError("update-machine-resolve-commit-failed", `GitHub did not give the commit for ${tag}`);
```

Row R17, `:532`:

```ts
    throw new UserActionableError("dev-app-bad-ref", `"${ref}" is not a branch, tag or commit of the release repo`, {}, { why: "For a pull request, use its branch name." });
```

Rows R18 and R19, `:769` and `:800-803`:

```ts
    throw new UserActionableError("update-machine-plan-verify-only", "A run can plan or check, not both");
```

```ts
    throw new UserActionableError("update-machine-noninteractive", "rt will not change this Mac without a terminal to confirm each step", {}, {
      why: "Approve every step up front to run it anyway.",
      next: "rt release update-machine --yes",
    });
```

Rows R20 and R21, `:227` and `:597`:

```ts
    return abortedLeg("checkout-sync", CHECKOUT_SYNC_LABEL, `The shared checkout is on ${branch}, not main, so rt left it alone`);
```

```ts
    return abortedLeg("daemon", DAEMON_LABEL, `The announcement in #${CHAT_ROOM} failed ${ANNOUNCE_ATTEMPTS} times, so rt did not restart the daemon`);
```

Row R22, `describePlannedLeg`'s `switch` body (its signature stays):

```ts
  switch (id) {
    case "prod-app":
      return `Download the ${tag} app, check its checksum, and swap it in for the installed one without opening it`;
    case "dev-bundle":
      return `Build the dev app at ${tag} in a scratch folder, quit the running copy, swap the new one in and open it`;
    case "checkout-sync":
      return "Pull main into the shared checkout and install its packages";
    case "daemon":
      return `Announce in #${CHAT_ROOM}, then restart the rt daemon and check that it runs ${tag}`;
    case "served-suite":
      return "Register any app whose entry does not match the shared checkout, then restart every managed app";
    case "verify":
      return "Check the app version, the dev app, the daemon, deck and every managed app";
  }
```

`PROD_APP_PATH` and `DEV_APP_PATH` keep their other uses; run `grep -n "PROD_APP_PATH\|DEV_APP_PATH" lib/release/update-machine.ts` and confirm each still has one.

Rows R23 and R24, `:813` and `:817`:

```ts
      legs.push(skippedLeg(id, label, `Not run: the run stopped at ${haltedAfter}`));
```

```ts
      legs.push(skippedLeg(id, label, "You said no at the prompt"));
```

Rows R5 to R8, `lib/release/verify.ts`:

```ts
      detail: `Run ${runId} ended "${poll.conclusion}". To recover, delete the GitHub release (the tag stays), then rerun its failed jobs: gh release delete <tag>, then gh run rerun ${runId} --failed`,
```

```ts
    return { id, label, status: "error", detail: `rt could not reach GitHub to check run ${runId} after ${poll.attempts} tries. Check again with: rt release verify` };
  }
  const errNote = poll.pollErrors > 0 ? ` (${poll.pollErrors} of them could not reach GitHub)` : "";
  return {
    id, label, status: "pending",
    detail: `Run ${runId} is still ${poll.status} after ${poll.attempts} checks${errNote}. Check again with: rt release verify`,
  };
```

```ts
      detail: `The release's notes do not match the committed RELEASE_NOTES.md at ${tag}. If the committed notes were wrong, the fix is a new tag: never edit the release by hand. To compare them: git show ${tag}:RELEASE_NOTES.md and gh release view ${tag} --json body`,
```

Rows R9, R10b, R10 and R11, the same file:

```ts
  return { id, label, status: "stale", detail: `missing assets: ${missing.join(", ")}. The rt:mattstack-release skill finishes them by hand.` };
```

```ts
  if (data.isDraft) problems.push("still a draft. To publish it: gh release edit <tag> --draft=false");
```

```ts
      detail: "The release is still a draft, so the latest-release link will not point at it until it is public.",
```

```ts
      detail: `still propagating: published ${Math.round(elapsed / 60_000)} minutes ago, and the latest-release link can lag about 20 minutes behind`,
```

Rows R25 to R33, `lib/release/release-app.ts`: each is the `StepFailure` message or the `rec(...)` detail at its line; the `resume` argument of each `StepFailure` and the `command` argument of each `rec` stay as they are. Row R27 keeps `${gate.reason}` at its end, which `e2e/tests/release-apps.test.ts:136` and `release-app-run.test.ts:272` read. Rows R25 and R25b go through two constants, which Task 10's `qualifyStop` reads; add them above `newestReleaseTag`:

```ts
/** Two of qualify's three stops with nothing to resume; `qualifyStop` tells them apart by these, since the report has no key for why it stopped. */
const NO_RELEASE_TAG = "origin has no release tag. Run this from an rt checkout.";
const NOTHING_MOVED = "nothing has moved since ";
```

and use them: `throw new StepFailure("qualify", NO_RELEASE_TAG, null);` in `newestReleaseTag`, and `` throw new StepFailure("qualify", `${NOTHING_MOVED}${lastTag}`, null); `` in `qualify` (R25b's words do not change).

- [ ] **Step 4: Run the tests**

Run: `bun test lib/release/__tests__ commands/__tests__/release-preflight.test.ts commands/__tests__/release-verify.test.ts commands/__tests__/release-update-machine.test.ts commands/__tests__/release-apps.test.ts`
Expected: PASS. Every `--json` test whose only change was a detail still matches its keys, ids and statuses: that is the shape check.

Run: `grep -rn "recovery:\|refusing to\|to recheck\|hand-completion\|move-aside-replace\|--yes-notes <hash> off\|mutually exclusive" lib/release/*.ts`
Expected: only comment lines.

Run: `bun run typecheck`
Expected: no errors.

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/release-apps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/release/verify.ts lib/release/update-machine.ts lib/release/release-app.ts lib/release/__tests__/verify.test.ts lib/release/__tests__/update-machine.test.ts commands/__tests__/release-update-machine.test.ts
```

```bash
git commit -m "lib/release: plain copy for the details and errors a person reads, envelope shape kept

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `rt release` preflight, verify and update-machine

**Files:**
- Modify: `commands/release.ts:91-210`
- Modify: `commands/__tests__/release-preflight.test.ts`, `commands/__tests__/release-verify.test.ts`, `commands/__tests__/release-update-machine.test.ts`

**Interfaces:**
- Consumes: Task 8's `lib/release` copy; `out.print`, `out.note`, `out.json`, `out.line`, `out.kv`, `out.section`, `out.summary`, `out.callout`, `out.cmd` (`lib/ui/out.ts`); `logFailureDetail` (`lib/errors.ts`); `type Block`, `type RenderStatus` (`lib/ui/protocol.ts`); `captureOut()`.
- Produces: exported from `commands/release.ts`, `updateMachineBlocks(report: UpdateMachineReport): Block[]` (Task 14's renders call it). `commands/release.ts` stays on the allowlist until Task 10 (`releaseApps` still prints raw).

The row, leg and step `detail` strings come from `lib/release` (reworded in Task 8 where they are sentences) and ride in the envelopes; this task shows them as hints and does not touch them.

- [ ] **Step 1: Move the three test harnesses onto `captureOut` and update the assertions**

In `commands/__tests__/release-preflight.test.ts` and `commands/__tests__/release-verify.test.ts`, add:

```ts
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
```

and replace each file's `run` helper body so it captures through the layer. For `release-preflight.test.ts`:

```ts
async function run(args: string[], seams: PreflightSeams): Promise<{ logs: string[]; exitCode: number | string | undefined }> {
  const io = captureOut();
  ui.__test__.setHuman(() => false);
  // Bun's process.exitCode setter ignores undefined once the value is truthy; 0 is the only value that clears it.
  const before = process.exitCode;
  process.exitCode = 0;
  try {
    await releasePreflight(args, {}, seams);
    return { logs: io.lines(), exitCode: process.exitCode };
  } finally {
    process.exitCode = before ?? 0;
    io.restore();
  }
}
```

For `release-verify.test.ts`, the same shape calling `releaseVerify` and resetting `process.exitCode = 0` in `finally` as it does today. Remove `spyOn` from each file's `bun:test` import if nothing else uses it.

In `release-preflight.test.ts`, replace the body of `human output renders a checklist and a summary line` after the `run` call with:

```ts
    const text = logs.join("\n");
    expect(text).toContain("git state");
    expect(logs.some((l) => l.startsWith("[out of date] picker:check"))).toBe(true);
    expect(text).toContain("gate: ");
    expect(logs.at(-1)).toMatch(/^\[out of date\] \d+ checks {2}\d+ ok, 1 stale, \d+ unverifiable$/);
    expect(exitCode).toBe(1);
```

In `release-verify.test.ts`, in `human output renders a checklist, the resolved tag, and a summary line`, replace the `toMatch` line with:

```ts
    expect(logs[0]).toBe("Release v2.10.2");
    expect(logs.at(-1)).toMatch(/^\[ok\] \d+ checks {2}\d+ ok, 0 stale, 0 pending, 0 unverifiable$/);
```

In `commands/__tests__/release-update-machine.test.ts`, replace `run` with:

```ts
async function run(args: string[], seams: UpdateMachineSeams): Promise<{ logs: string[]; exitCode: number }> {
  const io = captureOut();
  ui.__test__.setHuman(() => false);
  process.exitCode = 0;
  try {
    await releaseUpdateMachine(args, {}, seams);
    return { logs: io.lines(), exitCode: process.exitCode as number };
  } finally {
    process.exitCode = 0;
    io.restore();
  }
}
```

and in `runExpectingProcessExit`, delete the `logs` array and the `logSpy` (its creation and its `mockRestore`), and return `logs: io.lines()` in both `return` statements (read before `io.restore()` runs: build the return object inside the `try` and `catch` as today).

In `human output renders a leg-by-leg checklist and a summary line`, replace the `tag v2.11.0: clean` assertion with:

```ts
    expect(logs[0]).toStartWith("[ok] prod app update  ");
    expect(logs.at(-1)).toBe("[ok] tag v2.11.0  clean");
```

In `a halted run's human summary names the leg that halted it`, replace the assertion with the lines below. Its fake checksum does not match, so the prod app leg ends `aborted`. rt did decline to install it, but what stopped it is a download with the wrong bytes, a fault: it reads `failed`, and so does the summary. Drawing it calmer than a download that failed outright would invert the severity.

```ts
    expect(logs.at(-1)).toBe("[failed] tag v2.11.0  stopped at prod app update");
    expect(logs.some((l) => l.startsWith("[failed] prod app update  sha256 mismatch"))).toBe(true);
    expect(logs.some((l) => l.startsWith("[skipped] ") && l.includes("Not run: the run stopped at prod app update"))).toBe(true);
```

Add a test for the leg a guard declines, built on a report rather than a run, since no fake seam drives the shared checkout onto another branch. Add `updateMachineBlocks` to the file's import from `"../release.ts"`, and `import { renderPlain } from "../../lib/ui/out-plain.ts";`:

```ts
  test("a shared checkout off main is a refused leg and stops the run refused", () => {
    const report = {
      tag: "v2.11.0",
      ok: false,
      haltedAfter: "shared checkout sync",
      legs: [
        { id: "prod-app" as const, label: "prod app update", status: "ok" as const, detail: "replaced with v2.11.0" },
        { id: "checkout-sync" as const, label: "shared checkout sync", status: "aborted" as const, detail: "The shared checkout is on feature/sample, not main, so rt left it alone" },
        { id: "daemon" as const, label: "daemon restart", status: "skipped" as const, detail: "Not run: the run stopped at shared checkout sync" },
      ],
    };
    expect(renderPlain(updateMachineBlocks(report))).toBe(
      "[ok] prod app update  replaced with v2.11.0\n" +
        "[refused] shared checkout sync  The shared checkout is on feature/sample, not main, so rt left it alone\n" +
        "[skipped] daemon restart  Not run: the run stopped at shared checkout sync\n" +
        "[refused] tag v2.11.0  stopped at shared checkout sync\n",
    );
  });
```

The labels are the ones `commands/__tests__/release-update-machine.test.ts` already reads; if the checkout-sync or daemon label differs in `lib/release/update-machine.ts` (`CHECKOUT_SYNC_LABEL`, `DAEMON_LABEL`), use the real one in the report and the expected string.

Rename `non-interactive without --yes, human mode, also exits 2` to `no terminal and no --yes is refused, not failed`, and replace its `stderr` assertion (Task 8 left it as a `toContain` of the new message) with:

```ts
    expect(stderr).toBe(
      "[refused] rt will not change this Mac without a terminal to confirm each step\n  why: Approve every step up front to run it anyway.\n  next: rt release update-machine --yes\n",
    );
```

The `--json` test above it (`error.code` is `update-machine-noninteractive`, exit 2) does not change.

Add:

```ts
  test("--plan in human mode lists every leg as not yet run and says nothing changed", async () => {
    const { logs, exitCode } = await run(["--plan"], fakeSeams());
    expect(logs.slice(0, 6).every((l) => l.startsWith("[not yet] "))).toBe(true);
    expect(logs.at(-1)).toBe("[not yet] tag v2.11.0  plan only, nothing changed");
    expect(exitCode ?? 0).toBe(0);
  });
```

Every `--json` test in the three files is unchanged since Task 8. They now read the envelope from `io.lines()`, which is the shape check: `out.json` writes `JSON.stringify(value) + "\n"`, what `console.log(JSON.stringify(value))` wrote.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/release-preflight.test.ts commands/__tests__/release-verify.test.ts commands/__tests__/release-update-machine.test.ts`
Expected: FAIL in every human test: `logs` is empty, since the verbs still print through `console.log`, the refusal test finds a failure block where it expects a `[refused]` line, and `updateMachineBlocks` is not exported yet.

- [ ] **Step 3: Convert the three verbs in `commands/release.ts`**

Add to the imports (and `logFailureDetail` to the existing `lib/errors.ts` import):

```ts
import * as out from "../lib/ui/out.ts";
import type { Block, RenderStatus } from "../lib/ui/protocol.ts";
```

Replace the `MARK` and `VERIFY_MARK` constants with:

```ts
// A row rt could not check is not a failure: nothing is known to be wrong.
const ROW_STATUS: Record<VerifyRow["status"], RenderStatus> = { ok: "done", stale: "stale", error: "warn", pending: "pending" };

function rowLine(row: CheckRow | VerifyRow): Block {
  const versions = row.pinned && row.current && row.pinned !== row.current ? ` ${row.pinned} → ${row.current}` : "";
  return out.line(ROW_STATUS[row.status], `${row.label}${versions}`, row.detail ?? row.status);
}
```

In `releasePreflight`, replace `console.log(JSON.stringify(envelope(report)));` with `out.json(envelope(report));`, and replace the human half (the `for` loop, the `gate` line and the counts line) with:

```ts
  const okCount = report.rows.length - report.staleCount - report.errorCount;
  out.print(
    ...report.rows.map(rowLine),
    ...(report.gate ? [out.kv("gate", `${report.gate.path} (${report.gate.reason})`)] : []),
    out.summary(report.clean ? "done" : report.staleCount > 0 ? "stale" : "warn", `${report.rows.length} checks`, [
      `${okCount} ok`,
      `${report.staleCount} stale`,
      `${report.errorCount} unverifiable`,
    ]),
  );
  if (!report.clean) process.exitCode = 1;
```

In `releaseVerify`, replace `console.log(JSON.stringify(envelope(report)));` with `out.json(envelope(report));`, and replace the human half with:

```ts
  const okCount = report.rows.length - report.staleCount - report.errorCount - report.pendingCount;
  const status: RenderStatus = report.clean ? "done" : report.staleCount > 0 ? "stale" : report.errorCount > 0 ? "warn" : "pending";
  out.print(
    out.section(`Release ${report.tag ?? "(no tag resolved)"}`, undefined, ...report.rows.map(rowLine)),
    out.summary(status, `${report.rows.length} checks`, [`${okCount} ok`, `${report.staleCount} stale`, `${report.pendingCount} pending`, `${report.errorCount} unverifiable`]),
  );
  if (!report.clean) process.exitCode = 1;
```

Replace the `LEG_MARK` constant with:

```ts
const LEG_STATUS: Record<LegResult["status"], RenderStatus> = { ok: "done", skipped: "skipped", aborted: "refused", error: "failed", planned: "pending" };

/** An aborted leg is rt declining by a guard (a checkout off main, an announcement that did not land), except the prod app's: its only abort is a checksum that does not match, which is a fault. */
function legStatus(leg: LegResult): RenderStatus {
  return leg.status === "aborted" && leg.id === "prod-app" ? "failed" : LEG_STATUS[leg.status];
}
```

In `releaseUpdateMachine`, give the `catch` around `runUpdateMachine` the one refusal (`logFailureDetail` joins the existing `lib/errors.ts` import):

```ts
  } catch (err) {
    cleanupWorkDir();
    if (err instanceof UserActionableError && err.code === "update-machine-noninteractive" && !json) {
      logFailureDetail(err);
      out.note(
        out.line("refused", err.message),
        ...(err.why ? [out.callout("why", err.why)] : []),
        ...(err.next ? [out.callout("next", out.cmd(err.next))] : []),
      );
      process.exit(2);
    }
    if (err instanceof UserActionableError) exitUserError(err, json, "release update-machine");
    throw err;
  }
```

Then replace `console.log(JSON.stringify(envelope(report)));` with `out.json(envelope(report));`, and replace the human half (the `for` loop, `const summary = ...` and its `console.log`) with:

```ts
  out.print(...updateMachineBlocks(report));
  if (failed) process.exitCode = 1;
```

and add, beside `legStatus`:

```ts
export function updateMachineBlocks(report: UpdateMachineReport): Block[] {
  const planOnly = report.legs.length > 0 && report.legs.every((leg) => leg.status === "planned");
  const stoppedBy = report.haltedAfter ? report.legs.find((leg) => leg.label === report.haltedAfter) : undefined;
  const summary = planOnly ? "plan only, nothing changed" : report.ok ? "clean" : report.haltedAfter ? `stopped at ${report.haltedAfter}` : "problems above";
  const summaryStatus: RenderStatus = planOnly ? "pending" : report.ok ? "done" : stoppedBy && legStatus(stoppedBy) === "refused" ? "refused" : "failed";
  return [...report.legs.map((leg) => out.line(legStatus(leg), leg.label, leg.detail)), out.summary(summaryStatus, `tag ${report.tag}`, [summary])];
}
```

`UpdateMachineReport` is exported by `lib/release/update-machine.ts`; add `type UpdateMachineReport` to that import, which already names `type LegResult` (`commands/release.ts:37`).

- [ ] **Step 4: Run the tests**

Run: `bun test commands/__tests__/release-preflight.test.ts commands/__tests__/release-verify.test.ts commands/__tests__/release-update-machine.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add commands/release.ts commands/__tests__/release-preflight.test.ts commands/__tests__/release-verify.test.ts commands/__tests__/release-update-machine.test.ts
```

```bash
git commit -m "rt release: preflight, verify and update-machine print through the output layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `rt release apps`, its progress seam, and the release skills

**Files:**
- Modify: `lib/release/release-app.ts:104-126, :381, :408, :504, :509`
- Modify: `commands/release.ts:212-302`
- Modify: `commands/__tests__/release-apps.test.ts`, `lib/release/__tests__/release-app-run.test.ts:38, :223`
- Modify: `skills/rt-release/fast-path.md`, `skills/rt-release/publish-and-finish.md`
- Modify: `lib/__tests__/raw-output-allowlist.json`

**Interfaces:**
- Consumes: Task 9's `commands/release.ts`; Task 8's `lib/release` copy and its `NO_RELEASE_TAG` and `NOTHING_MOVED` constants; `usageFailure` (5a); `out.payloadOnStdout`, `out.note`, `out.failure`, `out.verbatim`, `out.callout`, `out.cmd`.
- Produces, exported from `lib/release/release-app.ts`:
  - `type ReleaseAppProgress = { kind: "step"; step: StepResult } | { kind: "watching"; tag: string } | { kind: "notes"; notes: string; hash: string }`
  - `ReleaseAppSeams.progress(event: ReleaseAppProgress): void`, replacing `log(line: string): void`
  - `type QualifyStop = "no-release-tag" | "nothing-moved" | "not-fast-path"` and `qualifyStop(step: StepResult | undefined): QualifyStop | null`, null for anything but a stopped qualify step
  - `formatStep` and `STEP_MARK` are removed.
- Produces, exported from `commands/release.ts`: `progressBlocks(event: ReleaseAppProgress): Block[]`, `releaseAppBlocks(report: ReleaseAppReport): Block[]`.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/release-apps.test.ts`:

Change the import from `"../release.ts"` to `import { progressBlocks, releaseAppBlocks, releaseApps } from "../release.ts";` and add `import { renderPlain } from "../../lib/ui/out-plain.ts";`.

In `seams()`, replace `log: () => {},` with `progress: () => {},`.

In `invoke`, delete the `logSpy` line and its `mockRestore`, and set `h.logs` from the capture: add `h.logs = io.lines();` directly above `h.stdout = io.stdout();`. Remove `spyOn` from the `bun:test` import only if `exitSpy` no longer needs it (it still does).

Replace the assertion in `an app name is a usage error that says the verb takes none` on `h.stderr` with:

```ts
    expect(h.stderr).toBe("This command takes no app name\n  why: It releases every app that changed.\n  next: rt release apps [--dry-run] [--json] [--yes-notes <notes hash>]\n");
```

In `--yes-notes takes only a notes hash: the tag form is a usage error`, add inside the loop after the existing `toContain("--yes-notes <notes hash>")` line:

```ts
      expect(h.stderr).toStartWith("The notes hash is the 12 characters a stopped run printed\n");
```

Replace the four human assertions in `describe("rt release apps: output", ...)`:

- `a dry run names every app it would ship and the tag`: `expect(h.logs).toEqual(["[not yet] Dry run: nothing changed  a real run releases boxscore, chat and console as v2.13.2"]);`
- `a pending publish exits 1 and names the recheck`: `expect(h.logs).toEqual(["[not yet] v2.13.2 is tagged, and its publish has not verified yet", "  next: rt release verify v2.13.2"]);`
- `a failed step exits 1 and names the step and the resume command`: `expect(h.logs).toEqual(["[failed] Stopped at tag", "  next: rt release apps"]);`
- `a released report prints the next tag and exits 0`: `expect(h.logs).toEqual(["[ok] Released v2.13.2"]);`

Add to the same `describe`:

```ts
  test("the other endings: approval, a no at the prompt, a fast path refusal, and a failure with nothing to rerun", () => {
    expect(renderPlain(releaseAppBlocks(report("awaiting-approval", { resume: "rt release apps --yes-notes 0123456789ab" })))).toBe(
      "[needs you] The notes need your approval\n  next: rt release apps --yes-notes 0123456789ab\n",
    );
    expect(renderPlain(releaseAppBlocks(report("declined", { resume: "rt release apps" })))).toBe(
      "[skipped] You said no: nothing was committed or tagged\n  next: rt release apps\n",
    );
    const qualify = { id: "qualify" as const, label: "qualify", status: "stopped" as const, detail: "Main does not qualify for the fast path since v2.13.1: lib/ changed" };
    expect(renderPlain(releaseAppBlocks(report("declined", { steps: [qualify] })))).toBe(
      "[refused] rt will not take the fast path for this release  Main does not qualify for the fast path since v2.13.1: lib/ changed\n",
    );
    const nothing = { ...qualify, detail: "nothing has moved since v2.13.1" };
    expect(renderPlain(releaseAppBlocks(report("declined", { steps: [nothing] })))).toBe("[skipped] Nothing to release  nothing has moved since v2.13.1\n");
    const noTag = { ...qualify, detail: "origin has no release tag. Run this from an rt checkout." };
    expect(renderPlain(releaseAppBlocks(report("declined", { steps: [noTag] })))).toBe(
      "rt cannot release from here\n  why: origin has no release tag. Run this from an rt checkout.\n",
    );
    expect(renderPlain(releaseAppBlocks(report("failed", { steps: [{ id: "qualify", label: "qualify", status: "failed", detail: "main moved" }] })))).toBe(
      "[failed] Stopped at qualify  this needs a decision, not a rerun\n",
    );
  });

  test("the three stops with nothing to resume each go where they belong: a refusal and a failure on stderr, nothing to release on stdout", async () => {
    const stopped = (detail: string) => report("declined", { steps: [{ id: "qualify" as const, label: "qualify", status: "stopped" as const, detail }] });

    const noTag = await invoke([], { result: stopped("origin has no release tag. Run this from an rt checkout.") });
    expect(noTag.exitCode).toBe(1);
    expect(noTag.stdout).toBe("");
    expect(noTag.stderr).toStartWith("rt cannot release from here\n");

    const nothing = await invoke([], { result: stopped("nothing has moved since v2.13.1") });
    expect(nothing.exitCode).toBe(1);
    expect(nothing.stderr).toBe("");
    expect(nothing.logs).toEqual(["[skipped] Nothing to release  nothing has moved since v2.13.1"]);
  });

  test("a fast path refusal is refused, not failed: on stderr, exit code 1 as today", async () => {
    const qualify = { id: "qualify" as const, label: "qualify", status: "stopped" as const, detail: "Main does not qualify for the fast path since v2.13.1: lib/ changed" };
    const h = await invoke([], { result: report("declined", { steps: [qualify] }) });
    expect(h.exitCode).toBe(1);
    expect(h.stdout).toBe("");
    expect(h.stderr).toBe("[refused] rt will not take the fast path for this release  Main does not qualify for the fast path since v2.13.1: lib/ changed\n");
  });

  test("progress: a step is a status line with its command under it, the watch is a running line, the notes are verbatim", () => {
    expect(renderPlain(progressBlocks({ kind: "step", step: { id: "tag", label: "tag", status: "planned", detail: "tag v2.13.2 at the notes commit and push it", command: "git tag -a v2.13.2 <notes commit> -m v2.13.2" } }))).toBe(
      "[not yet] tag  tag v2.13.2 at the notes commit and push it\n  next: git tag -a v2.13.2 <notes commit> -m v2.13.2\n",
    );
    expect(renderPlain(progressBlocks({ kind: "step", step: { id: "notes", label: "release notes", status: "stopped", detail: "the notes need approval" } }))).toBe("[needs you] release notes  the notes need approval\n");
    expect(renderPlain(progressBlocks({ kind: "step", step: { id: "qualify", label: "qualify", status: "stopped", detail: "Main does not qualify for the fast path since v2.13.1: lib/ changed" } }))).toBe(
      "[refused] qualify  Main does not qualify for the fast path since v2.13.1: lib/ changed\n",
    );
    expect(renderPlain(progressBlocks({ kind: "step", step: { id: "qualify", label: "qualify", status: "stopped", detail: "nothing has moved since v2.13.1" } }))).toBe("[skipped] qualify  nothing has moved since v2.13.1\n");
    expect(renderPlain(progressBlocks({ kind: "step", step: { id: "qualify", label: "qualify", status: "stopped", detail: "origin has no release tag. Run this from an rt checkout." } }))).toBe(
      "[failed] qualify  origin has no release tag. Run this from an rt checkout.\n",
    );
    expect(renderPlain(progressBlocks({ kind: "watching", tag: "v2.13.2" }))).toBe("[running] Watching the release build for v2.13.2  a real run takes 25 to 50 minutes\n");
    expect(renderPlain(progressBlocks({ kind: "notes", notes: "A patch release.\n\n### board", hash: "0123456789ab" }))).toBe(
      "release notes:\n  A patch release.\n  \n  ### board\nnotes hash: 0123456789ab\n",
    );
  });

  test("--json keeps stdout for the envelope: progress lands on stderr", async () => {
    const h: { stdout: string; stderr: string } = { stdout: "", stderr: "" };
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    process.exitCode = 0;
    try {
      await releaseApps(["--json", "--dry-run"], {}, {
        run: async (s) => {
          s.progress({ kind: "watching", tag: "v2.13.2" });
          return report("planned");
        },
      });
      h.stdout = io.stdout();
      h.stderr = io.stderr();
    } finally {
      io.restore();
      process.exitCode = 0;
    }
    expect(h.stdout.split("\n").filter(Boolean)).toHaveLength(1);
    expect(JSON.parse(h.stdout).status).toBe("planned");
    expect(h.stderr).toBe("[running] Watching the release build for v2.13.2  a real run takes 25 to 50 minutes\n");
  });
```

That last test passes no `seams`, so `releaseApps` builds its real ones; the fake `run` uses only `progress`, and `git rev-parse --show-toplevel` is the one command the real seams run on construction (read-only).

In `lib/release/__tests__/release-app-run.test.ts`, change line 38 from `logs: string[] = [];` to `events: ReleaseAppProgress[] = [];`, change line 223 from `log: (line) => { this.logs.push(line); },` to `progress: (event) => { this.events.push(event); },`, and add `type ReleaseAppProgress` to that file's import from `"../release-app.ts"`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/release-apps.test.ts lib/release/__tests__/release-app-run.test.ts`
Expected: FAIL. `progressBlocks` and `releaseAppBlocks` are not exported; `progress` is not a member of `ReleaseAppSeams`.

- [ ] **Step 3: Change the seam in `lib/release/release-app.ts`**

In `interface ReleaseAppSeams`, replace `log(line: string): void;` with:

```ts
  progress(event: ReleaseAppProgress): void;
```

Above the interface, add:

```ts
/** What a run reports as it goes; the command decides how it is drawn. */
export type ReleaseAppProgress = { kind: "step"; step: StepResult } | { kind: "watching"; tag: string } | { kind: "notes"; notes: string; hash: string };
```

Delete the `STEP_MARK` constant and the `formatStep` function (lines 123 to 127).

Replace the four call sites:

- line 381, `seams.log(`  watching release.yml for ${tag} ...`);` becomes `seams.progress({ kind: "watching", tag });`
- line 408, `seams.log(formatStep(step));` becomes `seams.progress({ kind: "step", step });`
- lines 504 and 509, both `if (!opts.json) seams.log(`\n${notes}\nnotes hash ${hash}`);`, become `if (!opts.json) seams.progress({ kind: "notes", notes, hash });`

Below Task 8's two constants, add:

```ts
export type QualifyStop = "no-release-tag" | "nothing-moved" | "not-fast-path";

/** Why a qualify step stopped with nothing to resume: an environment problem, nothing to release, or main does not qualify. */
export function qualifyStop(step: StepResult | undefined): QualifyStop | null {
  if (step?.id !== "qualify" || step.status !== "stopped") return null;
  if (step.detail === NO_RELEASE_TAG) return "no-release-tag";
  return step.detail.startsWith(NOTHING_MOVED) ? "nothing-moved" : "not-fast-path";
}
```

Run: `grep -n "seams.log\|formatStep\|STEP_MARK" lib/release/release-app.ts`
Expected: no output.

- [ ] **Step 4: Convert `releaseApps` in `commands/release.ts`**

Extend the `release-app.ts` import with `qualifyStop`, `type ReleaseAppProgress`, `type StepResult` and `type StepStatus`, and add `import { usageFailure } from "../lib/ui/usage.ts";`.

In `createRealReleaseAppSeams`, drop the `json` parameter (and the argument at its call site), and replace the `log` member and the comment above it with:

```ts
    progress: (event) => out.print(...progressBlocks(event)),
```

Replace `RELEASE_APPS_USAGE` and `releaseAppSummary` with:

```ts
const RELEASE_APPS_USAGE = "usage: rt release apps [--dry-run] [--json] [--yes-notes <notes hash>]";

const STEP_STATUS: Record<StepStatus, RenderStatus> = { ok: "done", done: "skipped", planned: "pending", failed: "failed", stopped: "needs-you", pending: "pending" };

const QUALIFY_STOP_STATUS: Record<QualifyStop, RenderStatus> = { "not-fast-path": "refused", "nothing-moved": "skipped", "no-release-tag": "failed" };

/** A stopped notes step waits on a person; a stopped qualify step is a refusal, nothing to do, or an environment problem. */
function stepStatus(step: StepResult): RenderStatus {
  const stop = qualifyStop(step);
  return stop ? QUALIFY_STOP_STATUS[stop] : STEP_STATUS[step.status];
}

export function progressBlocks(event: ReleaseAppProgress): Block[] {
  switch (event.kind) {
    case "step":
      return [out.line(stepStatus(event.step), event.step.label, event.step.detail), ...(event.step.command ? [out.callout("next", out.cmd(event.step.command))] : [])];
    case "watching":
      return [out.line("running", `Watching the release build for ${event.tag}`, "a real run takes 25 to 50 minutes")];
    case "notes":
      return [out.verbatim(event.notes.split("\n"), "release notes"), out.kv("notes hash", event.hash)];
  }
}

export function releaseAppBlocks(report: ReleaseAppReport): Block[] {
  const resume = report.resume ? [out.callout("next", out.cmd(report.resume))] : [];
  switch (report.status) {
    case "released":
      return [out.summary("done", `Released ${report.nextTag}`)];
    case "planned":
      return [out.summary("pending", "Dry run: nothing changed", [`a real run releases ${listJoin(report.apps)} as ${report.nextTag}`])];
    case "awaiting-approval":
      return [out.summary("needs-you", "The notes need your approval"), ...resume];
    case "declined": {
      if (report.resume) return [out.summary("skipped", "You said no: nothing was committed or tagged"), ...resume];
      const last = report.steps.at(-1);
      switch (qualifyStop(last)) {
        case "nothing-moved":
          return [out.line("skipped", "Nothing to release", last?.detail)];
        case "no-release-tag":
          return [out.failure({ title: "rt cannot release from here", why: last?.detail })];
        default:
          return [out.line("refused", "rt will not take the fast path for this release", last?.detail)];
      }
    }
    case "pending":
      return [out.summary("pending", `${report.nextTag} is tagged, and its publish has not verified yet`), ...resume];
    case "failed": {
      const step = report.steps.at(-1)?.label ?? "qualify";
      return [out.summary("failed", `Stopped at ${step}`, report.resume ? undefined : ["this needs a decision, not a rerun"]), ...resume];
    }
  }
}
```

In `releaseApps`:

Directly after `const json = args.includes("--json");`, add:

```ts
  // The envelope owns stdout, so progress moves to stderr for this run.
  if (json) out.payloadOnStdout();
```

Change `createRealReleaseAppSeams(json)` to `createRealReleaseAppSeams()`.

Replace the `usage` arrow with:

```ts
  const usage = (title: string, why?: string): never => {
    if (json) exitUserError(new UserActionableError("usage", RELEASE_APPS_USAGE), true, "release apps");
    out.fail(usageFailure(title, RELEASE_APPS_USAGE, why));
    return process.exit(2);
  };
  const badHash = () => usage("The notes hash is the 12 characters a stopped run printed");
```

and its three callers: the `catch` after `flagValue` returns `badHash()`; the hex check returns `badHash()`; the positional check returns `usage("This command takes no app name", "It releases every app that changed.")`.

Replace the two print statements (the fast path refusal and the no-release-tag failure go to stderr, every other ending to stdout; the exit code below them does not change):

```ts
    const stop = report.status === "declined" && !report.resume ? qualifyStop(report.steps.at(-1)) : null;
    if (json) out.json(envelope(report));
    else if (stop === "not-fast-path" || stop === "no-release-tag") out.note(...releaseAppBlocks(report));
    else out.print(...releaseAppBlocks(report));
```

Extend the `release-app.ts` import with `type QualifyStop` too, for `QUALIFY_STOP_STATUS`.

Run: `grep -n "console\.\|process\.stdout\|process\.stderr" commands/release.ts`
Expected: no output.

- [ ] **Step 5: Move the release skills to `--json`**

Before editing, load the `superpowers:writing-skills` skill (the repo owner's standing rule for any skill edit) and the `mattstack:process-digraphs` skill: both files hold digraphs whose node names are also their edge keys, so every occurrence of a node changes together.

First confirm where these two files live and what checks them, so nothing that copies them is missed. Run each alone:

- `cat skills/.skillsignore`
  Expected: `rt-release` is listed. The directory is maintainer-only: `rt skills link --from <dir>` (the installer's path) skips it, so it is never distributed to members.
- `grep -rln "release apps --dry-run\|update-machine --plan\|update-machine --yes" plugins marketplace apps/board/skills`
  Expected: no output. Nothing mirrors or compiles `skills/rt-release`: it is a plain directory that `rt skills link` symlinks into the author's Claude skills, so an edit is live there as soon as the checkout has it. It is not part of `plugins/mattstack`, so `.claude-plugin/plugin.json` needs no version bump and the `plugin-mattstack` job's `rt skills check --pack-dir plugins/mattstack --strict` does not read it.
- `grep -rn "skills/rt-release\|rt-release" lib/skills/__tests__/link.test.ts lib/setup/__tests__/skills-link-bundled.test.ts`
  Expected: hits that use `rt-release` only as a directory name in link and ignore-file fixtures; neither reads the files' text. These are the only tests that touch the directory, and Step 7 runs them.

If any of the three says otherwise (a mirror appeared, or the directory left `.skillsignore`), stop and report it before editing: a mirror must change in this same commit, and a distributed skill needs the plugin's own checks.

In `skills/rt-release/fast-path.md`:

- Replace every occurrence of `rt release apps --dry-run` with `rt release apps --dry-run --json` (four: the node at line 20 and the three edges at lines 40, 41 and 81).
- Replace the sentence `The dry run shows the qualify result, the next tag and the commands.` (line 88) with: `The dry run prints one envelope too: it qualifies when its \`status\` is \`planned\`, and its \`steps\` carry the qualify result, the next tag and each planned command.`

In `skills/rt-release/publish-and-finish.md`:

- Replace every occurrence of `rt release update-machine --plan` with `rt release update-machine --plan --json`.
- Replace every occurrence of `rt release update-machine --yes` with `rt release update-machine --yes --json` (this also renames the node `rt release update-machine --yes, rerun after the fix` consistently in all its edges).
- In the section `### Gate: approve the update-machine legs`, replace `Show the \`--plan\` output.` with `Show each leg's \`label\` and \`detail\` from the \`--plan\` envelope.`
- In the paragraph that begins `A leg that ends aborted or in error halts every later state-changing leg`, replace `the summary names the leg that halted` with `the envelope's \`haltedAfter\` names the leg that halted`.
- In the section `### Off-script gate: update-machine leg halted`, replace `Quote the summary's halted leg and its detail` with `Quote the \`haltedAfter\` leg and its \`detail\` from the envelope`.
- In the opening paragraph on verify rows (lines 14 and 15), replace the example `for example "could not reach gh"` with `for example "rt could not reach GitHub"`, R6's new words.

Then check that no node was left behind in either file:

Run: `grep -n "release apps --dry-run\"\|update-machine --plan\"\|update-machine --yes\"\|update-machine --yes," skills/rt-release/fast-path.md skills/rt-release/publish-and-finish.md`
Expected: no output (every node now ends in `--json"` or `--json,`).

- [ ] **Step 6: Delete the allowlist line**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `"commands/release.ts",`.

- [ ] **Step 7: Run the tests**

Run: `bun test commands/__tests__/release-apps.test.ts commands/__tests__/release-preflight.test.ts commands/__tests__/release-verify.test.ts commands/__tests__/release-update-machine.test.ts lib/release/__tests__ lib/__tests__/no-raw-output.test.ts lib/skills/__tests__/link.test.ts lib/setup/__tests__/skills-link-bundled.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/release-apps.test.ts`
Expected: PASS. It parses `result.stdout` as one JSON value in every test, which proves progress no longer shares stdout with the envelope.

- [ ] **Step 8: Commit**

```bash
git add lib/release/release-app.ts commands/release.ts commands/__tests__/release-apps.test.ts lib/release/__tests__/release-app-run.test.ts skills/rt-release/fast-path.md skills/rt-release/publish-and-finish.md lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "rt release apps: structured progress through the output layer, and the release skills read --json

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 9: Measure, and take the `repos` cut if the slice is on track past 2,800 lines**

This is Task 15's size check brought forward to the one point where the cut lands on a branch boundary: `home` and `release` are in, `repos` is not started.

Run: `git diff --shortstat origin/main...HEAD`
Expected: one line, `N files changed, I insertions(+), D deletions(-)` (the three-dot form counts only this branch's commits, whatever main gained since).

Tasks 3 to 10 are about two thirds of this slice's lines (about 2,200 of an estimated 3,300), so the cut is the expected path. If `I + D` is over 1,850 here, the slice is on track to pass the review's 2,800: take the cut below and say so in the report. If it is 1,850 or less, go on with Task 11 on this branch as one PR and skip both lists.

**5e2 (this branch): Tasks 1 to 10, then Tasks 14 and 15 adjusted as follows.**

- Task 14 Step 1: `blocks-5e2.ts` keeps the `home` and `release` sets; drop the `repos` set, the `worktree` fixture, and the imports of `pruneBlocks`, `statusBlocks` and `usageFailure`, which only the `repos` set uses. The steps capture (`steps-5e2.sh`) stays.
- Task 14 Steps 2 to 4: render four pages (`home` and `release`, dark and light) and the two steps captures, and add the `home`, `home-steps` and `release` README rows.
- Task 14 Step 5: append both paragraphs without the first one's opening two sentences (the `print` seam on `RegisterDeps` and `ReidentifyDeps`); 5e3 adds those.
- Task 14 Step 6: the second search may hit `registered ` or `repo index is clean` in a test of `commands/repos.ts`: expected, that is 5e3's.
- Task 14 Step 7: the allowlist search expects three lines still listed, `commands/repos.ts`, `lib/repo-index.ts` and `lib/repo-tracking.ts`.
- Task 14 Step 8: `git add` the six PNGs this PR made (`home`, `home-steps` and `release`, dark and light), not the `repos` pair.
- Task 15 Step 1: the `e2e/tests/errors.test.ts` and `e2e/pty/errors.test.ts` edits are 5e3's; skip that bullet. Run the `[failed]` search over the home and release tests only.
- Task 15 Step 5: title `RT-369: output layer phase 5e2, home and release`. The body keeps **Home**, **Release**, **Copy** (the `lib/home` and `lib/release` passes and the setup step's reader) and **Also** without the `repoOption` bullet, and adds a **Follow-up** naming 5e3 and what it carries.

**5e3 (a new branch from `origin/main`, cut with the same Task 1 checks; it does not need 5e2 merged): Tasks 11 to 13, then Tasks 14 and 15 adjusted as follows.**

- Task 14 Step 1: `blocks-5e3.ts` (the same file under the new name) keeps the `repos` set, the `worktree` fixture and the imports it uses (`out`, `encodeLine`, `usageFailure`, `pruneBlocks`, `statusBlocks`); drop the `home` and `release` sets and the import of `progressBlocks`, `releaseAppBlocks` and `updateMachineBlocks`. No steps capture.
- Task 14 Steps 2 to 4: render two pages (`repos`, dark and light) under the names `5e3-repos-dark.png` and `5e3-repos-light.png`, and add the `repos` README row with those names.
- Task 14 Step 5: append only the first paragraph's opening two sentences (the `print` seam), after 5e2's paragraphs if 5e2 merged first, or as a paragraph of their own if it did not.
- Task 14 Step 7: the allowlist search expects none of the three `repos` files; the other four lines are present or absent as 5e2's merge left them, which is expected either way.
- Task 14 Step 8: `git add` the two `5e3-repos` PNGs, the README and AGENTS.md; the commit message names 5e3.
- Task 15 Step 1: the `lib/prompt-secret.ts` and `lib/setup` bullets are 5e2's; skip them. Run the `[failed]` search over the three repos tests only (it expects none).
- Task 15 Step 5: title `RT-369: output layer phase 5e3, repos`. The body keeps **Repos**, a **Copy** bullet for the repos copy table, and **Also** with the `repoOption` bullet; it drops **Home** and **Release**.

---

### Task 11: The repo index and repo tracking warnings

**Files:**
- Modify: `lib/repo-index.ts:33, :122, :572, :576, :660, :687, :736, :825-827, :836, :841, :1362-1378`
- Modify: `lib/repo-tracking.ts:142-146, :173, :187-190, :367, :372, :397`
- Modify: `lib/__tests__/repo-index.test.ts`, `lib/__tests__/repo-index-missing.test.ts:88-89`, `lib/daemon/__tests__/repo-tracking.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json`

**Interfaces:**
- Consumes: `warn(module, message, { context?, show? })`, `setWarningLog`, `__test__.reset` (5a); `out.cmd`; `captureOut()`; rows 6 to 20 of 5a's warnings table.
- Produces: `repoOption(r, label?)` returns `{ value: string; label: string; hint: string }` (the `color` member is gone). `repoOptions` and every caller (`lib/pickers.ts`, `lib/repo.ts`, `commands/cd.ts`, `commands/glitter.ts`, `commands/run.ts`) pass the object to a picker that never read `color`; none of those files is edited.

Both files are loaded by the daemon. There, and in a unit test that sets no log, 5a's `warn` writes the plain line `rt: <message>` to stderr and shows nothing.

- [ ] **Step 1: Write the failing tests**

In `lib/__tests__/repo-index.test.ts`, add to the imports:

```ts
import * as ui from "../ui/out.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnTest } from "../ui/warn.ts";
```

and add `warnTest.reset();` as the first line of the suite's `beforeEach` (the one that creates `warnSpy`). The warning log is module state shared by every test file in the run; a log left set by another file would turn the `rt:` lines these tests read into log entries.

In `describe("11. fail-open", ...)`, replace the two existing tests with:

```ts
    test("an unexpandable ${repoRoot} entry warns and degrades to inference-only roots, no throw", () => {
      setRepoRoots(["${repoRoot}/whatever"]);
      const io = captureOut();
      try {
        expect(() => getKnownRepos()).not.toThrow();
        expect(io.stderr()).toContain("rt: rt.repoRoots could not be resolved");
        expect(io.stdout()).toBe("");
      } finally {
        io.restore();
      }
    });

    test("a non-string element and a nonexistent path each warn and are skipped; the rest of the scan is unaffected", () => {
      const root = mkdtempSync(join(tmpdir(), "rt-failopen-root-"));
      const repo = markerRepo(root, "survivor");
      handEditRepoRoots([42, join(tmpdir(), "rt-does-not-exist-xyz"), root]);
      const io = captureOut();
      try {
        const repos = getKnownRepos();
        expect(byName(repos, "survivor")?.worktrees[0]?.path).toBe(repo);
        expect(io.stderr()).toContain("rt: skipping non-string rt.repoRoots entry: 42\n");
        expect(io.stderr()).toContain('rt: skipping rt.repoRoots entry "');
      } finally {
        io.restore();
      }

      rmSync(root, { recursive: true, force: true });
    });

    test("a skipped rt.repoRoots entry is shown once in plain words, with the command that looks into it", () => {
      const missing = join(tmpdir(), "rt-does-not-exist-xyz");
      handEditRepoRoots([42, missing]);
      const logged: string[] = [];
      const io = captureOut();
      ui.__test__.setHuman(() => false);
      warnTest.reset();
      setWarningLog((_module, message) => {
        logged.push(message);
      });
      try {
        getKnownRepos();
        // Straight to the reader as well, so the second warning cannot be hidden by anything getKnownRepos skips on a repeat call.
        __test__.readConfiguredRepoRoots();
        const text = io.stderr();
        const notAPath = "[warning] A repo folder in your settings is not a path  42 was skipped\n  next: rt settings get rt.repoRoots\n";
        const notThere = `[warning] A repo folder in your settings does not exist  ${missing} was skipped\n  next: rt settings get rt.repoRoots\n`;
        expect(logged.filter((m) => m.startsWith("skipping non-string rt.repoRoots entry"))).toHaveLength(2);
        expect(text.split(notAPath).length - 1).toBe(1);
        expect(text.split(notThere).length - 1).toBe(1);
        expect(io.stdout()).toBe("");
      } finally {
        warnTest.reset();
        io.restore();
      }
    });
```

The shown-once test proves the dedupe, not just the copy: the log receives each skipped entry twice (once from `getKnownRepos`, once from `__test__.readConfiguredRepoRoots`, the file's existing test export, which reads the setting afresh), and stderr shows each line once.

In the test `corrupt repos.json warns and is left in place, index reads as empty`, replace `expect(warnSpy).toHaveBeenCalled();` with a capture around the call. The body becomes:

```ts
      const p = join(rtDir(), "repos.json");
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, "{ not valid json");
      const io = captureOut();
      try {
        expect(loadRepoIndex()).toEqual({});
        expect(io.stderr()).toContain("rt: legacy state file ");
        expect(io.stderr()).toContain("is corrupt JSON, leaving in place");
      } finally {
        io.restore();
      }
      expect(existsSync(p)).toBe(true);
      expect(existsSync(`${p}.migrated`)).toBe(false);
```

The file's `warnSpy` in `beforeEach` stays: phase 6's lines still go through `console.warn`.

In `lib/__tests__/repo-index-missing.test.ts`, in `the picker row says what to run`, delete the line `expect(opt.color).toBeDefined();` and change the expected hint on the line above it to `"missing, rt repos locate finds it"` (row P6). `lib/__tests__/pick-wrappers.test.ts:82` passes the old hint in as a fixture and does not change.

In `lib/daemon/__tests__/repo-tracking.test.ts`, add `import { captureOut } from "../../ui/__tests__/capture-out.ts";` and, in the two tests that swap `console.warn` (`a versioned {version, repos} envelope warns loudly and auto-unwraps to the inner repos map` and the one that asserts `mattstack.tracking could not be resolved`), replace the block from `const warnings: string[] = [];` through the `finally { console.warn = orig; }` with a capture, and the final assertion with a read of stderr. Also import `__test__ as warnTest` from `"../../ui/warn.ts"` there, for the same reason as above. For the first test:

```ts
    warnTest.reset();
    const io = captureOut();
    let t: ReturnType<typeof loadRepoTracking>;
    let stderr: string;
    try {
      t = loadRepoTracking();
      stderr = io.stderr();
    } finally {
      io.restore();
    }

    expect(t.a).toEqual({ mode: "live", caches: ["branches"] });
    expect(stderr).toContain("store the repos map, not the versioned envelope");
```

For the second, the same shape around its own `loadRepoTracking({ identityMap: ... })` call, ending with `expect(stderr).toContain("rt: mattstack.tracking could not be resolved");` and its existing `toEqual` on `t`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/__tests__/repo-index.test.ts lib/__tests__/repo-index-missing.test.ts lib/daemon/__tests__/repo-tracking.test.ts`
Expected: FAIL. The captures find an empty stderr (the lines go to `console.warn`, which `warnSpy` swallows or the capture does not see), and the shown-copy test finds no `[warning]` lines.

- [ ] **Step 3: Convert `lib/repo-index.ts`**

Replace the import `import { dim } from "./ansi.ts";` with:

```ts
import * as out from "./ui/out.ts";
import { warn } from "./ui/warn.ts";
```

On each of the nine `console.warn` calls, make the same three edits: change `console.warn(` to `warn("repo-index", `; delete the leading `rt: ` (the three characters and the space) from the start of the template string; and add the third argument below. Nothing else in the message changes.

| Line | Third argument |
|---|---|
| 122 | `{ context: { path } }` |
| 572 | `{ context: { from, to } }` |
| 576 | `{ context: { from, to } }` |
| 660 | `{ context: { from } }` |
| 687 | `{ context: { from, to } }` |
| 736 | `{ context: { repo: entry.repoName } }` |
| 825 to 827 | `{ show: { title: "Your repo folders setting could not be read", hint: "rt is looking in its usual places only", next: out.cmd("rt settings check") } }` |
| 836 | `{ show: { title: "A repo folder in your settings is not a path", hint: `${JSON.stringify(entry)} was skipped`, next: out.cmd("rt settings get rt.repoRoots") } }` |
| 841 | `{ show: { title: "A repo folder in your settings does not exist", hint: `${entry} was skipped`, next: out.cmd("rt settings get rt.repoRoots") } }` |

In `repoOption` (line 1362), change the return type to `{ value: string; label: string; hint: string }`, drop `, color: dim` from the missing row's return and make its hint `"missing, rt repos locate finds it"` (row P6), and delete the line `...(r.registered === false ? { color: dim } : {}),`. Update the doc comment above it: its first sentence says the mapping is "dimmed + labeled for unregistered repos"; make it "labeled for unregistered repos".

Run: `grep -n "console\.\|dim\b" lib/repo-index.ts`
Expected: no `console.` hit and no `dim` identifier (a hit inside a comment's prose is fine).

- [ ] **Step 4: Convert `lib/repo-tracking.ts`**

Add to the imports:

```ts
import * as out from "./ui/out.ts";
import { warn } from "./ui/warn.ts";
```

In `loadTeamTracking`, delete the leading `rt: ` from the `message` template string (line 142) and replace `console.warn(message);` (line 145) with:

```ts
      warn("repo-tracking", message, { show: { title: "The team's repo tracking setting could not be read", hint: "only your own tracking applies", next: out.cmd("rt settings check") } });
```

The dedupe on `lastTeamTrackingWarning` and the comment above it stay.

On the other five `console.warn` calls, make the same three edits as in Step 3 with the module `"repo-tracking"`:

| Line | Third argument |
|---|---|
| 173 | `{ show: { title: "Your repo tracking setting could not be read", hint: "no repo is tracked until it is fixed", next: out.cmd("rt settings check") } }` |
| 187 to 190 | `{ show: { title: "Your repo tracking setting is in an old shape", hint: "rt is reading the repos inside it for now", next: out.cmd("rt settings get rt.repoTracking") } }` |
| 367 | `{ context: { name } }` |
| 372 | `{ context: { name, identity } }` |
| 397 | `{ context: { name, identity } }` |

Run: `grep -n "console\." lib/repo-tracking.ts`
Expected: no output.

- [ ] **Step 5: Delete two allowlist lines**

In `lib/__tests__/raw-output-allowlist.json`, delete the lines `"lib/repo-index.ts",` and `"lib/repo-tracking.ts",`.

- [ ] **Step 6: Run the tests and the guards**

Run: `bun test lib/__tests__/repo-index.test.ts lib/__tests__/repo-index-missing.test.ts lib/__tests__/repo-index-rename.test.ts lib/__tests__/repo-index-async.test.ts lib/__tests__/repo-index-find.test.ts lib/__tests__/repo-index-trash.test.ts lib/__tests__/repo-tracking-move.test.ts lib/daemon/__tests__/repo-tracking.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-daemon-sync-exec.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors. If a caller of `repoOption` read `.color`, the compiler names it here; none does at `5bc69f231`.

- [ ] **Step 7: Commit**

```bash
git add lib/repo-index.ts lib/repo-tracking.ts lib/__tests__/repo-index.test.ts lib/__tests__/repo-index-missing.test.ts lib/daemon/__tests__/repo-tracking.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "lib: repo index and repo tracking warnings go through the warn seam

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: `rt repos` register, prune and locate, and the repos copy pass

Applies rows P1 to P5 and L1 to L10 and D1 of the repos copy table (Task 2), and draws a locate refusal as `refused`.

**Files:**
- Modify: `commands/repos.ts:20-400`
- Modify: `lib/repo-locate.ts:50-61, :118-120, :177-229` (refusal codes, `parseRefusalText`, the ten refusal messages)
- Modify: `lib/repo-locate-dispatch.ts:26-29, :49-55` (the failure arm's `why` and `next`, D1)
- Modify: `commands/__tests__/repos.test.ts`, `commands/__tests__/repos-locate.test.ts`, `lib/__tests__/repo-locate.test.ts` (`:64-103`, `:254`), `lib/__tests__/repo-locate-dispatch.test.ts:78, :113`

**Interfaces:**
- Consumes: `out.print`, `out.fail`, `out.note`, `out.payload`, `out.line`, `out.kv`, `out.section`, `out.table`, `out.callout`, `out.cmd`, `out.dim` (`lib/ui/out.ts`); `usageFailure` (5a); `type Block` (`lib/ui/protocol.ts`); `renderPlain`; `captureOut()`; `tryResolveRepoArg(arg): Promise<RepoArgResolution>` (`lib/repo-arg.ts`, not edited); `repoLabel(serialized)` (`lib/repo-label.ts`); `UserActionableError(code, message, extra?, { why?, next? })` (`lib/errors.ts`).
- Produces:
  - `RegisterDeps.print` carries only the `--json` envelope line. Exported from `commands/repos.ts`: `pruneBlocks(removed: PrunedEntry[], dryRun: boolean): Block[]`. `commands/repos.ts` stays on the allowlist until Task 13 (`reposStatus` still prints raw).
  - exported from `lib/repo-locate.ts`: `parseRefusalText(error: string): LocateRefusal | null`, which reads back the `<code>: <message>` form the dispatcher and the daemon handler send; `LocateRefusalCode` becomes the union of a `LOCATE_REFUSAL_CODES` tuple, same six members.
  - `LocateOutcome`'s failure arm (`lib/repo-locate-dispatch.ts`) gains optional `why?: string` and `next?: string`; nothing outside `commands/repos.ts` and its tests reads the type.

- [ ] **Step 1: Pin the envelopes before any change**

Every message this task rewords rides in a `--json` error envelope. Pin each envelope's shape and code from the real verb first, so the rewording can only touch the words. These tests pass at the start of the task and must still pass at its end.

In `commands/__tests__/repos.test.ts`, inside `describe("reposRegister", ...)`:

```ts
  test("the error envelopes the copy pass rewords keep their shape and codes", async () => {
    const plainDir = realpathSync(mkdtempSync(join(home, "notarepo-")));
    const cases: Array<[string[], string]> = [
      [["/no/such/path/here", "--json"], "bad-path"],
      [[plainDir, "--json"], "not-a-git-repo"],
    ];
    for (const [args, code] of cases) {
      const deps = testDeps();
      expect(await runExpectingProcessExit(() => reposRegister(args, {}, deps))).toBe(2);
      expect(deps.lines).toHaveLength(1);
      const body = JSON.parse(deps.lines[0]!);
      expect(Object.keys(body).sort()).toEqual(["at", "contract", "error"]);
      expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
      expect(body.error.code).toBe(code);
      expect(typeof body.error.message).toBe("string");
    }
  });
```

and in `--json reports a failed move as an error envelope, never a registered one`, add after its `code` assertion: `expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);`.

In `commands/__tests__/repos-locate.test.ts`, inside `describe("reposLocate", ...)`:

```ts
  test("the error envelopes the copy pass rewords keep their shape and codes", async () => {
    const plain = join(scratch, "plain");
    mkdirSync(plain);
    const { to } = await movedRepo("epsilon");
    const cases: Array<[string[], string, RegExp]> = [
      [[plain, "--json"], "refused", /^not-a-git-repo: /],
      [[to, "--repo", "no-such-repo", "--json"], "repo-unknown", /no-such-repo/],
    ];
    for (const [args, code, message] of cases) {
      const deps = testDeps();
      expect(await runExpectingProcessExit(() => reposLocate(args, {}, deps))).toBe(2);
      expect(deps.lines).toHaveLength(1);
      const body = JSON.parse(deps.lines[0]!);
      expect(Object.keys(body).sort()).toEqual(["at", "contract", "error"]);
      expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
      expect(body.error.code).toBe(code);
      expect(body.error.message).toMatch(message);
    }
  });
```

Run: `bun test commands/__tests__/repos.test.ts commands/__tests__/repos-locate.test.ts`
Expected: PASS, before any source change. The `<code>: ` head of a locate refusal is pinned here because `lib/__tests__/repo-locate-heal.test.ts:132` and the daemon handler both rely on it.

- [ ] **Step 2: Write the failing tests**

In `commands/__tests__/repos.test.ts`, add to the imports:

```ts
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
```

and add a helper under `runExpectingProcessExit`:

```ts
/** Runs a verb with plain output captured: stdout by line, and stderr whole. */
async function human(fn: () => Promise<void>): Promise<{ lines: string[]; stderr: string; code: number | undefined }> {
  const io = captureOut();
  ui.__test__.setHuman(() => false);
  try {
    const code = await runExpectingProcessExit(fn);
    return { lines: io.lines(), stderr: io.stderr(), code };
  } finally {
    io.restore();
  }
}
```

Update these tests (each keeps its setup lines; only the call and the assertions on text change):

`registers a repo path into the global index`: wrap the call and replace the last assertion:

```ts
    const { lines } = await human(() => reposRegister([repoPath], {}, deps));
    ...
    expect(lines).toEqual([`[ok] Registered ${name}  ${repoPath}`]);
    expect(deps.lines).toEqual([]);
```

`no paths exits 2 with a usage error`:

```ts
    const deps = testDeps();
    const { code, stderr } = await human(() => reposRegister([], {}, deps));
    expect(code).toBe(2);
    expect(stderr).toBe("Which repo?\n  next: rt repos register <path…> [--track live|poll] [--caches branches,project-mrs] [--json]\n");
```

`an unknown --track value exits 2`:

```ts
    const { code, stderr } = await human(() => reposRegister([repoPath, "--track", "bogus"], {}, deps));
    expect(code).toBe(2);
    expect(stderr).toStartWith('Tracking is live or poll\n  why: You passed "bogus".\n');
```

`reports a clean index as clean`: `const { lines } = await human(() => reposPrune([], {}, deps));` and `expect(lines).toEqual(["[skipped] Nothing to prune  every repo rt knows is still there"]);`

`removes a renamed repo's retired name and says which name kept the directory`: `const { lines } = await human(...)` and

```ts
    expect(lines).toEqual([`[ok] Removed local-apps  ${deck.replace(homedir(), "~")} · same folder as deck`]);
```

`--dry-run says what it would do and writes nothing`:

```ts
    expect(lines).toEqual([`[not yet] Would remove gone  ${join(home, "never-existed").replace(homedir(), "~")} · its folder is gone`]);
```

`a dropped dead registry is named in the removal line`:

```ts
    expect(lines).toEqual([`[ok] Removed deleted  ${join(home, "deleted-repo").replace(homedir(), "~")} · its folder is gone; dropped its worktree list, which only named folders that are gone`]);
```

`an unknown flag is a usage error, not a silent no-op prune`:

```ts
    const { code, stderr } = await human(() => reposPrune(["--force"], {}, deps));
    expect(code).toBe(2);
    expect(stderr).toBe("This command has no option called --force\n  next: rt repos prune [--dry-run] [--json]\n");
```

`a retained missing row tells the operator to locate it`:

```ts
    const { lines } = await human(() => reposPrune([], {}, deps));
    expect(lines[0]).toStartWith("[needs you] Kept moved-repo  ");
    expect(lines[0]).toEndWith("its folder is gone, but it still has worktrees on record");
    expect(lines[1]).toBe("  next: rt repos locate <new-path> --repo moved-repo");
```

In `commands/__tests__/repos-locate.test.ts` (it already imports `captureOut`; add `import * as ui from "../../lib/ui/out.ts";` if missing, and the same `human` helper):

- `locates a moved repo and says where it went`: run through `human`, then `expect(lines[0]).toStartWith("[ok] Moved ");`, `expect(lines[0]).toContain(`${from} → ${to}`);`.
- `--dry-run reports the plan and writes nothing`: run through `human`, then `expect(lines[0]).toStartWith("[not yet] Would move ");` in place of the `toContain("would move")` assertion.
- `an unknown flag is a usage error`: replace `toContain("usage: rt repos locate")` with `toContain("  next: rt repos locate [<new-path>] [--repo <id|name>] [--dry-run] [--json]\n")` and add `expect(io.stderr()).toStartWith("This command has no option called ");`.
- `--repo without a value is a usage error`: replace `toContain("--repo needs a value")` with `toStartWith("Which repo moved?\n")`.
- `a second positional is a usage error, not a silently ignored path`: replace `toContain("locate takes one path")` with `toStartWith("One folder at a time\n  why: You passed 2: ")`.
- `no path and no lost rows exits 1 saying so`: run through `human`, then `expect(code).toBe(1);`, `expect(stderr).toBe("No repo is missing\n  why: Every repo rt knows is where it should be.\n");`, `expect(lines).toEqual([]);`.
- `no path, a lost row and no candidate lists the lost row and exits 1`: run through `human`, then `expect(code).toBe(1);`, `expect(stderr).toStartWith("Which folder did it move to?\n");`, `expect(stderr).toContain("Missing repos\n");`, `expect(stderr).toContain("ghost");`, `expect(stderr).not.toContain("remote:gitlab.com");`.
- `a refusal exits 2 with the typed message`: rename it `a refusal from locate is a refused line on stderr, and its envelope keeps code refused` and replace its body after `mkdirSync(plain);` with:

```ts
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const forAPerson = testDeps();
      expect(await runExpectingProcessExit(() => reposLocate([plain], {}, forAPerson))).toBe(2);
      expect(forAPerson.lines).toEqual([]);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe(`[refused] ${plain} is not a git repo\n`);

      const forAProgram = testDeps();
      expect(await runExpectingProcessExit(() => reposLocate([plain, "--json"], {}, forAProgram))).toBe(2);
      expect(JSON.parse(forAProgram.lines[0]!).error).toEqual({ code: "refused", message: `not-a-git-repo: ${plain} is not a git repo` });
    } finally {
      io.restore();
    }
```

Add to the same file:

```ts
  test("a repo name rt does not know is one failure in plain words", async () => {
    const { to } = await movedRepo("zeta");
    const { code, stderr } = await human(() => reposLocate([to, "--repo", "no-such-repo"], {}, testDeps()));
    expect(code).toBe(2);
    expect(stderr).toBe('rt does not know a repo called "no-such-repo"\n  why: Name a repo rt has registered, or run this from inside one.\n');
  });
```

In `commands/__tests__/repos.test.ts`, three register failures move to the new words (rows P1 to P3), each run through `human`:

- `a nonexistent path exits 2 with a bad-path error`: `expect(stderr).toBe("There is no folder at /no/such/path/here\n");`
- `a directory that exists but isn't a git repo exits 2, not a claimed success`: `` expect(stderr).toBe(`${plainDir} is not a git repo\n  why: rt can only register a folder that git tracks.\n`); ``
- `a repo whose move cannot be applied exits 2 instead of reporting it registered`: `` expect(stderr).toStartWith(`rt could not move ${basename(repoPath)} to ${repoPath}: `); `` and `expect(stderr).toContain("  why: rt knows it at a folder that is gone, and moving its records did not finish.\n");`

In `lib/__tests__/repo-locate.test.ts`, add `parseRefusalText` to the import from `"../repo-locate.ts"` and, at the top of the file:

```ts
const LONG_DASH = new RegExp(`[${String.fromCodePoint(0x2013)}${String.fromCodePoint(0x2014)}]`);
/** A refusal a person reads: no long dash and no flag in the sentence. */
const plainWords = (message: string) => !LONG_DASH.test(message) && !message.includes("--");
```

In each of the six tests that assert a refusal code (`:64`, `:70`, `:79`, `:90`, `:103`, `:254`), add after that assertion: `expect(isRefusal(out) && plainWords(out.message)).toBe(true);`. The identity-mismatch test's two `toContain` lines (`:80`, `:81`) name the identities a person now reads as labels (L9): make them `toContain(repoLabel("remote:gitlab.com%2Fg%2Fbeta"))` and `toContain(repoLabel("remote:gitlab.com%2Fg%2Fsomething-else"))`, with `import { repoLabel } from "../repo-label.ts";`. Line 91's `toContain("rt repos register")` holds: L8 keeps the command as its last words. Then add:

```ts
test("a refusal sent as its code and message reads back; any other error does not", () => {
  expect(parseRefusalText("old-path-exists: widgets is still at /x, so this folder is a second copy, not a move")).toEqual({
    refusal: "old-path-exists",
    message: "widgets is still at /x, so this folder is a second copy, not a move",
  });
  expect(parseRefusalText("git worktree repair failed: exit 1")).toBeNull();
  expect(parseRefusalText("The rt daemon is running but did not answer")).toBeNull();
});
```

In `lib/__tests__/repo-locate-dispatch.test.ts`, the two hard-stop tests (`a live pid with an unresponsive daemon hard-stops ...` at `:78` and `a socket file with no live pid still hard-stops` at `:113`) expect D1:

```ts
    expect(outcome).toEqual({
      via: "daemon",
      ok: false,
      error: "The rt daemon is running but did not answer",
      why: "rt will not move the repo itself while the daemon holds its records: the two would race.",
      next: "rt daemon status",
    });
```

`a daemon refusal surfaces its error verbatim` (`:130-135`) keeps its fixture and expectation: the dispatcher passes a daemon's `<code>: <message>` through untouched.

The `--json` tests in both command files are untouched and must still pass, Step 1's pins among them.

- [ ] **Step 3: Run them to verify they fail**

Run: `bun test commands/__tests__/repos.test.ts commands/__tests__/repos-locate.test.ts lib/__tests__/repo-locate.test.ts lib/__tests__/repo-locate-dispatch.test.ts`
Expected: FAIL. The human lines are empty (the text goes to `deps.print`), the usage text is the old sentence, the register and locate failures carry today's words (with a long dash in three of them), a locate refusal is a failure block rather than a `[refused]` line, `parseRefusalText` is not exported, and the dispatcher's outcome has no `why` or `next`. Step 1's pins still pass.

- [ ] **Step 4: Convert register, prune and locate in `commands/repos.ts`, and reword the locate library**

Add to the imports:

```ts
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
```

Replace `interface RegisterDeps` and `realRegisterDeps`:

```ts
export interface RegisterDeps {
  /** The --json envelope line only; human text goes through lib/ui/out.ts. */
  print: (s: string) => void;
}

export function realRegisterDeps(): RegisterDeps {
  return { print: (s) => out.payload(`${s}\n`) };
}
```

Add under `flagValue`:

```ts
/** `jsonMessage` is the envelope's error text and never changes; a person gets the question and the command. */
function refuseUsage(deps: RegisterDeps, json: boolean, verb: string, jsonMessage: string, title: string, usage: string, why?: string): never {
  if (json) exitUserError(new UserActionableError("usage", jsonMessage), true, verb, deps.print);
  out.fail(usageFailure(title, usage, why));
  process.exit(2);
}
```

Replace the seven usage refusals. In each, the second line is today's message expression, moved unchanged into the `jsonMessage` argument:

- `reposRegister`, no paths (line 89): `refuseUsage(deps, json, "repos register", USAGE, "Which repo?", USAGE);`
- `reposRegister`, bad `--track` (line 95): `refuseUsage(deps, json, "repos register", <the existing template string>, "Tracking is live or poll", USAGE, `You passed "${track}".`);`
- `reposRegister`, unknown cache (lines 102 to 108): `refuseUsage(deps, json, "repos register", <the existing template string>, "rt does not know that cache", USAGE, `"${cachesArg}" is not one of ${CACHE_KINDS.join(", ")}.`);`
- `reposPrune`, unknown flag (line 241): `refuseUsage(deps, json, "repos prune", <the existing template string>, `This command has no option called ${a}`, PRUNE_USAGE);`
- `reposLocate`, unknown flag (line 300): `refuseUsage(deps, json, "repos locate", <the existing template string>, `This command has no option called ${a}`, LOCATE_USAGE);`
- `reposLocate`, `--repo` with no value (line 306): `refuseUsage(deps, json, "repos locate", <the existing template string>, "Which repo moved?", LOCATE_USAGE, "The repo option needs a name.");`
- `reposLocate`, more than one path (lines 315 to 320): `refuseUsage(deps, json, "repos locate", <the existing template string>, "One folder at a time", LOCATE_USAGE, `You passed ${positionals.length}: ${positionals.join(", ")}.`);`

In `reposRegister`, replace the closing `for (const r of registered) { deps.print(...); }` loop with:

```ts
  out.print(
    ...registered.map((r) => out.line("done", `Registered ${r.name}`, r.tracking ? `${r.path} · tracking ${r.tracking.mode} (${r.tracking.caches.join(", ")})` : r.path)),
  );
```

Replace `describeReason` and `describeDataMove` (and the comment above the second) with:

```ts
function describeReason(r: PrunedEntry): string {
  return r.reason === "duplicate" ? `same folder as ${r.keptAs}` : "its folder is gone";
}

/** What the retired name's data did, as a trailing clause. Refusals are named one by one: they are the only outcome that leaves the person something to do. */
function describeDataMove(r: PrunedEntry, dryRun: boolean): string {
  const d = r.data;
  if (!d) return "";
  const carried = d.moved.length + d.merged.length;
  const parts: string[] = [];
  if (carried > 0) parts.push(`${dryRun ? "would carry" : "carried"} ${carried} file${carried === 1 ? "" : "s"} to ${r.keptAs}`);
  if (d.merged.length > 0) parts.push(`merged ${d.merged.join(", ")}`);
  if (d.registry === "moved") parts.push(`${dryRun ? "would move" : "moved"} its worktrees to ${r.keptAs}`);
  if (d.registry === "merged") parts.push(`${dryRun ? "would merge" : "merged"} its worktrees into ${r.keptAs}'s`);
  if (d.registry === "refused") parts.push(`${r.keptAs}'s worktrees could not be written, so both were kept`);
  if (d.refused.length > 0) parts.push(`kept both copies of ${d.refused.join(", ")}`);
  return parts.length > 0 ? `; ${parts.join("; ")}` : "";
}

export function pruneBlocks(removed: PrunedEntry[], dryRun: boolean): Block[] {
  if (removed.length === 0) return [out.line("skipped", "Nothing to prune", "every repo rt knows is still there")];
  const blocks: Block[] = [];
  for (const r of removed) {
    const where = r.path.replace(homedir(), "~");
    const label = repoLabel(r.repoName);
    if (!r.retained) {
      const dropped = r.registry === "dropped" ? `; ${dryRun ? "would drop" : "dropped"} its worktree list, which only named folders that are gone` : "";
      blocks.push(out.line(dryRun ? "pending" : "done", `${dryRun ? "Would remove" : "Removed"} ${label}`, `${where} · ${describeReason(r)}${describeDataMove(r, dryRun)}${dropped}`));
    } else if (r.reason !== "missing") {
      blocks.push(out.line("warn", `Kept ${label}`, `${where} · ${describeReason(r)}, but not all of its data could move${describeDataMove(r, dryRun)}`));
    } else if (r.registry === "busy") {
      blocks.push(out.line("warn", `Kept ${label}`, `${where} · ${describeReason(r)}, and rt was busy and could not clear its worktree list`), out.callout("next", out.cmd("rt repos prune")));
    } else {
      blocks.push(
        out.line("needs-you", `Kept ${label}`, `${where} · ${describeReason(r)}, but it still has worktrees on record`),
        out.callout("next", out.cmd(`${r.hint ?? "rt repos locate"} <new-path> --repo ${r.repoName}`)),
      );
    }
  }
  return blocks;
}
```

In `reposPrune`, replace everything after the `if (json) { ... return; }` block with:

```ts
  out.print(...pruneBlocks(removed, dryRun));
```

In `reposLocate`, replace the five dry-run `deps.print(...)` lines with:

```ts
    out.print(
      out.line("pending", `Would move ${repoLabel(p.identity)}`, `${p.oldPath} → ${p.newPath}`),
      out.kv("index rows", p.indexKeys.join(", ")),
      out.kv("worktree records", String(p.registryRewrites.reduce((n, r) => n + r.movedPaths.length, 0))),
      out.kv("endpoint claims", String(p.claimRewrites.length)),
      out.kv("worktrees to repair", p.gitRepairPaths.length === 0 ? "the main one only" : p.gitRepairPaths.join(", ")),
    );
    return;
```

and the closing human statements (from `deps.print(`located ${r.identity}: ...`)` to the end of the function) with:

```ts
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  out.print(
    out.line("done", `Moved ${repoLabel(r.identity)}`, `${r.from} → ${r.to}`),
    out.kv("updated", `${count(r.treesRewritten, "worktree record")}, ${count(r.claimsRewritten, "endpoint claim")}, ${count(r.repaired.length, "tree")} repaired`),
    ...r.stalePaths.map((stale) => out.line("stale", "Left an old record for rt to clean up", stale)),
    ...r.legacyRows.map((row) =>
      row.outcome === "collapsed" ? out.line("done", `Folded in the old entry ${row.key}`) : out.line("warn", `Kept the old entry ${row.key}`, row.reason || "not all of its data could move"),
    ),
  );
```

In `pickLocateTarget`, replace the first `if (lost.length === 0) { ... }` block with:

```ts
  if (lost.length === 0) {
    if (json) deps.print(JSON.stringify(envelope({ lost: [], candidates: [] })));
    else out.fail({ title: "No repo is missing", why: "Every repo rt knows is where it should be." });
    process.exit(1);
  }
```

and the human `else` branch of the second block (the `deps.print("missing repos:")` lines) with:

```ts
    } else {
      out.fail(
        usageFailure(
          "Which folder did it move to?",
          LOCATE_USAGE,
          candidates.length === 0 ? "rt could not find it by itself." : "rt found folders it could be, and cannot ask which one without a terminal.",
        ),
        out.section("Missing repos", undefined, out.table(lost.map((r) => [repoLabel(r.repoName), out.dim(`last seen at ${r.worktrees[0]?.path ?? "an unknown folder"}`)]))),
      );
    }
```

The register errors (rows P1 to P3), each keeping its code, its `exitUserError` call and its arguments after the error:

```ts
      exitUserError(new UserActionableError("bad-path", `There is no folder at ${inputPath}`), json, "repos register", deps.print);
```

```ts
      exitUserError(
        new UserActionableError("not-a-git-repo", `${inputPath} is not a git repo`, {}, { why: "rt can only register a folder that git tracks." }),
        json,
        "repos register",
        deps.print,
      );
```

```ts
        new UserActionableError("locate-failed", `rt could not move ${name} to ${real}: ${indexed.error}`, {}, {
          why: "rt knows it at a folder that is gone, and moving its records did not finish.",
        }),
```

`--repo` (rows P4 and P5): change the import `resolveRepoArg` from `"../lib/repo-arg.ts"` to `tryResolveRepoArg` (the only use of `resolveRepoArg` in this file is the one replaced here), add `parseRefusalText` to a new import from `"../lib/repo-locate.ts"` beside `findLocateCandidates`, and add above `reposLocate`:

```ts
/** `--repo`'s value as an identity, or a failure worded for this verb; `resolveRepoArg`'s own messages name the flag and are shared with other verbs. */
async function resolveLocateRepo(arg: string, json: boolean, deps: RegisterDeps): Promise<string> {
  const resolution = await tryResolveRepoArg(arg);
  if (resolution.kind === "resolved") return resolution.identity;
  const err =
    resolution.kind === "ambiguous"
      ? new UserActionableError("repo-unknown", `"${arg}" could be more than one repo`, {}, {
          why: `It matches ${resolution.matches.join(", ")}.`,
          next: "rt repos locate <new-path> --repo <identity>",
        })
      : new UserActionableError("repo-unknown", `rt does not know a repo called "${arg}"`, {}, { why: "Name a repo rt has registered, or run this from inside one." });
  return exitUserError(err, json, "repos locate", deps.print);
}
```

and replace the `const repo = repoArg ? await resolveRepoArg(...) : undefined;` statement with `const repo = repoArg ? await resolveLocateRepo(repoArg, json, deps) : undefined;`.

The locate outcome (`if (!outcome.ok) { ... }` after `locateMovedRepo`). A refusal from `planLocate` is rt declining by rule, so a person gets a `refused` line; a daemon that does not answer and an apply that did not finish stay failures. `--json` keeps today's envelope:

```ts
  if (!outcome.ok) {
    const refusal = parseRefusalText(outcome.error);
    if (refusal && !json) {
      out.note(out.line("refused", refusal.message));
      process.exit(2);
    }
    exitUserError(new UserActionableError("refused", outcome.error, {}, { why: outcome.why, next: outcome.next }), json, "repos locate", deps.print);
  }
```

In `lib/repo-locate.ts`, replace the `LocateRefusalCode` union with a tuple it is read from, add `import { repoLabel } from "./repo-label.ts";`, and add `parseRefusalText` below `refuse`:

```ts
const LOCATE_REFUSAL_CODES = ["not-a-git-repo", "not-main-worktree", "nothing-lost", "old-path-exists", "identity-mismatch", "identity-changed"] as const;

export type LocateRefusalCode = (typeof LOCATE_REFUSAL_CODES)[number];
```

```ts
/** A refusal crosses the daemon socket as `<code>: <message>` (`lib/daemon/handlers/repos.ts`, and this file's dispatcher the same way); null when `error` is not one. */
export function parseRefusalText(error: string): LocateRefusal | null {
  const at = error.indexOf(": ");
  const code = error.slice(0, at);
  if (at <= 0 || !(LOCATE_REFUSAL_CODES as readonly string[]).includes(code)) return null;
  return { refusal: code as LocateRefusalCode, message: error.slice(at + 2) };
}
```

Then reword the ten `refuse(...)` messages in `planLocate` (rows L1 to L10), each keeping its code:

```ts
    return refuse("not-a-git-repo", `${newPath} is not a git repo`);
```

```ts
    return refuse(
      "not-main-worktree",
      `${newPath} is one of a repo's worktrees, not the repo's own folder. rt moves every record onto the folder you name, so name the main one.`,
    );
```

```ts
    return refuse("nothing-lost", `rt does not know a repo called ${opts.repo}`);
```

```ts
    return refuse("old-path-exists", `${opts.repo} is still at ${named.path}, so this folder is a second copy, not a move`);
```

```ts
    return canon(identityRow.path) === newPath
      ? refuse("nothing-lost", `rt already knows ${repoLabel(identity)} at ${newPath}`)
      : refuse("old-path-exists", `${repoLabel(identity)} is still at ${identityRow.path}, so this folder is a second copy, not a move`);
```

```ts
      return refuse("nothing-lost", `No repo rt knows is missing, so there is nothing for ${newPath} to be`);
```

```ts
      return refuse(
        "identity-changed",
        `${newPath} has no remote, so rt knows a repo like this by its folder, and moving it makes it a new repo. Register the new folder instead: rt repos register ${newPath}`,
      );
```

```ts
    return refuse(
      "identity-mismatch",
      `${newPath} holds ${repoLabel(identity)}, and no missing repo rt knows is ${repoLabel(identity)}. The missing ones are ${lost.map((e) => repoLabel(e.repoName)).join(", ")}.`,
    );
```

```ts
    return refuse(
      "identity-mismatch",
      `${newPath} holds ${repoLabel(identity)}, but the repo you named is ${named.repoName}. rt matches a move by what a repo is, not by its name.`,
    );
```

The comment above the `identity-changed` refusal, if any, stays. `verifyLocate` and `repairGit` messages are git's own output and paths (data) and stay.

In `lib/repo-locate-dispatch.ts`, widen the failure arm and word the hard stop (row D1); the module's header comment stays:

```ts
  | { via: "daemon" | "local"; ok: false; error: string; why?: string; next?: string };
```

```ts
    if (!res) {
      return {
        via: "daemon",
        ok: false,
        error: "The rt daemon is running but did not answer",
        why: "rt will not move the repo itself while the daemon holds its records: the two would race.",
        next: "rt daemon status",
      };
    }
```

Run: `grep -n "deps.print(" commands/repos.ts`
Expected: every hit is `deps.print(JSON.stringify(envelope(...)))` or is the `deps.print` passed to `exitUserError` or `refuseUsage`.

Run: `grep -n "resolveRepoArg(\|indexed at a path\|second clone\|derives " commands/repos.ts lib/repo-locate.ts lib/repo-locate-dispatch.ts`
Expected: only comment lines.

- [ ] **Step 5: Run the tests**

Run: `bun test commands/__tests__/repos.test.ts commands/__tests__/repos-locate.test.ts lib/__tests__/repo-locate.test.ts lib/__tests__/repo-locate-dispatch.test.ts lib/__tests__/repo-locate-heal.test.ts lib/__tests__/repo-locate-e2e.test.ts lib/__tests__/repo-reidentify-locate.test.ts lib/daemon/__tests__/repos-handlers.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-daemon-sync-exec.test.ts`
Expected: PASS. `repo-locate-heal.test.ts:132` still finds `identity-changed` at the head of the error, and the daemon handler's tests (`lib/daemon/__tests__/repos-handlers.test.ts`) assert codes and outcomes, not refusal wording.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add commands/repos.ts lib/repo-locate.ts lib/repo-locate-dispatch.ts commands/__tests__/repos.test.ts commands/__tests__/repos-locate.test.ts lib/__tests__/repo-locate.test.ts lib/__tests__/repo-locate-dispatch.test.ts
```

```bash
git commit -m "rt repos: register, prune and locate print through the output layer, with plain copy and refused locates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: `rt repos` status and reidentify

**Files:**
- Modify: `commands/repos.ts:402-456`
- Modify: `commands/repos-reidentify.ts`
- Modify: `lib/repo-reidentify-dispatch.ts:15-17, :27-29` (the failure arm's `why` and `next`, row D2)
- Modify: `lib/__tests__/repos-status.test.ts`, `commands/__tests__/repos-reidentify.test.ts`, `lib/__tests__/repo-reidentify-dispatch.test.ts:69`
- Modify: `e2e/tests/errors.test.ts`, `e2e/pty/errors.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json`

**Interfaces:**
- Consumes: Task 12's `commands/repos.ts`; `out.tree`, `out.table`, `out.key`, `out.strong`, `out.dim`, `out.json`, `out.note`; `usageFailure` (5a); 5a's bidi stripping in the plain renderer.
- Produces: exported from `commands/repos.ts`: `statusBlocks(repos: RepoStatusRow[]): Block[]`. `ReidentifyDeps.print` carries only the `--json` envelope line. `ReidentifyOutcome`'s failure arm gains optional `why?: string` and `next?: string`.

`e2e/pty/errors.test.ts` waits on the reidentify usage text through a real pty, and `e2e/tests/errors.test.ts` asserts it off a terminal. Both move with the copy in this task. `commands/repos-reidentify.ts` is already in the pty gate's path filter in `.github/workflows/e2e.yml`, so the gate runs on this PR with no filter edit.

- [ ] **Step 1: Write the failing tests**

Replace `lib/__tests__/repos-status.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { reposStatus, statusBlocks } from "../../commands/repos.ts";
import * as ui from "../ui/out.ts";
import { renderPlain } from "../ui/out-plain.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";

const origExit = process.exit;
let io: ReturnType<typeof captureOut>;

beforeEach(() => {
  io = captureOut();
  ui.__test__.setHuman(() => false);
  (process as any).exit = (code: number) => {
    throw new Error(`exit ${code}`);
  };
});

afterEach(() => {
  io.restore();
  (process as any).exit = origExit;
});

const worktree = {
  worktree: "/Users/sample/widgets", branch: "main", detached: false,
  staged: 0, unstaged: 3, untracked: 1, conflicted: 0, clean: false,
  ahead: 1, behind: 0, upstream: "origin/main",
  lastFetchedAt: "2026-09-17T00:00:00.000Z", updatedAt: "2026-09-17T00:01:00.000Z",
};
const row = { repo: "remote:forge.example.test%2Facme%2Fwidgets", worktrees: [worktree], error: null };

describe("rt repos status", () => {
  test("--json prints the daemon data verbatim in the plain envelope", async () => {
    await reposStatus(["--json"], {
      query: async () => ({ ok: true, data: { repos: [row], sweptAt: "2026-09-17T00:01:00.000Z" } }) as any,
    });
    expect(io.stdout()).toBe(`${JSON.stringify({ ok: true, repos: [row], sweptAt: "2026-09-17T00:01:00.000Z" })}\n`);
    expect(io.stderr()).toBe("");
  });

  test("--refresh forwards refresh: true with a generous timeout", async () => {
    let sent: any = null;
    let timeout: any = null;
    await reposStatus(["--json", "--refresh"], {
      query: async (_cmd, payload, timeoutMs) => {
        sent = payload;
        timeout = timeoutMs;
        return { ok: true, data: { repos: [], sweptAt: null } } as any;
      },
    });
    expect(sent).toEqual({ refresh: true });
    expect(timeout).toBe(120_000);
  });

  test("daemon down fails with the plain JSON error and exit 1", async () => {
    await expect(reposStatus(["--json"], { query: async () => null })).rejects.toThrow("exit 1");
    expect(io.stdout()).toBe(`${JSON.stringify({ ok: false, error: "daemon unavailable, the rt daemon must be running for repo status" })}\n`);
    expect(io.stderr()).toBe("");
  });

  test("daemon down, for a person: one failure with the command to start it, exit 1", async () => {
    await expect(reposStatus([], { query: async () => null })).rejects.toThrow("exit 1");
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("The rt daemon is not running\n  why: Repo status comes from the daemon.\n  next: rt daemon start\n");
  });

  test("a daemon error, for a person, carries the daemon's reason as the hint", async () => {
    await expect(reposStatus([], { query: async () => ({ ok: false, error: "sweep crashed" }) as any })).rejects.toThrow("exit 1");
    expect(io.stderr()).toBe("rt could not read your repos' status  sweep crashed\n");
  });

  test("each repo is a tree of its worktrees: branch, what changed, where it stands, where it lives", async () => {
    await reposStatus([], { query: async () => ({ ok: true, data: { repos: [row], sweptAt: null } }) as any });
    expect(io.stdout()).toBe("acme/widgets\n  - main  3 unstaged, 1 untracked  ahead 1  /Users/sample/widgets\n");
  });

  test("a clean worktree, a detached one and a repo the sweep could not read", () => {
    const text = renderPlain(
      statusBlocks([
        { repo: "remote:forge.example.test%2Facme%2Fwidgets", worktrees: [{ ...worktree, unstaged: 0, untracked: 0, clean: true, ahead: 0, branch: null as unknown as string, detached: true }], error: "git status timed out" },
      ]),
    );
    expect(text).toBe("acme/widgets\n  - (detached)  clean    /Users/sample/widgets\n[warning] rt could not check acme/widgets  git status timed out\n");
  });

  test("no rows yet says so and names the refresh", () => {
    expect(renderPlain(statusBlocks([]))).toBe("[not yet] No repo status yet  rt checks your repos shortly after it starts\n  next: rt repos status --refresh\n");
  });

  test("a branch name with a right-to-left override prints without it", () => {
    const hostile = `main${String.fromCodePoint(0x202e)}evil`;
    const text = renderPlain(statusBlocks([{ repo: "remote:forge.example.test%2Facme%2Fwidgets", worktrees: [{ ...worktree, branch: hostile, unstaged: 0, untracked: 0, clean: true, ahead: 0 }], error: null }]));
    expect(text).toContain("  - mainevil  clean");
    expect(text).not.toContain(String.fromCodePoint(0x202e));
  });
});
```

In `commands/__tests__/repos-reidentify.test.ts`:

`plain output lists one line per store with its status and count`: capture stdout and read the rows there:

```ts
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Facme%2Fold", "/x");
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await reposReidentify(["github.com/acme/old", "github.com/acme/new"], {}, { print: (s) => out.push(s) });
      expect(io.lines()[0]).toBe("[ok] Moved this repo's data  remote:github.com%2Facme%2Fold → remote:github.com%2Facme%2Fnew");
      expect(io.lines().some((l) => /kv:repo-index\s+moved\s+1/.test(l))).toBe(true);
      expect(io.lines().some((l) => /run_history\.repo\s+none/.test(l))).toBe(true);
      expect(out).toEqual([]);
    } finally {
      io.restore();
    }
```

`a refused store prints the whole table, then exits non-zero`: the refusal and its table now go to stderr through `out.note`, with no failure block after them. Replace the three assertions after `expect(code).toBe(2);` with:

```ts
      expect(out).toEqual([]);
      expect(io.stdout()).toBe("");
      const lines = io.errLines();
      expect(lines[0]).toStartWith("[refused] The move stopped partway  ");
      expect(lines.some((l) => /kv:repo-index\s+refused/.test(l))).toBe(true);
      expect(lines.some((l) => /run_history\.repo\s+none/.test(l))).toBe(true);
```

`nothing under the old identity says so instead of claiming a move`:

```ts
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await reposReidentify(["github.com/acme/typo", "github.com/acme/new"], {}, { print: (s) => out.push(s) });
      expect(io.lines()[0]).toBe("[skipped] Nothing to move  rt holds nothing under remote:github.com%2Facme%2Ftypo");
    } finally {
      io.restore();
    }
```

`a refused plain run does not claim it moved`: rename it `a refused store is a refused line, not a failure`, and replace its two assertions (`expect(out[0]).toStartWith("refused, partly moved ");` and the `io.stderr()` one) with:

```ts
      expect(io.errLines()[0]).toStartWith("[refused] The move stopped partway  ");
      expect(io.stderr()).not.toContain("refused: kv:repo-index\n");
      expect(io.stdout()).toBe("");
```

The second assertion pins that no failure block (whose title would be the outcome's `refused: <store>` message) follows the table. `an identity that is not a remote is a refusal with no table` keeps its assertions: with no report there is nothing to show but the error, so that path stays on `exitUserError`.

`usage error on a missing positional`: replace the `io.stderr()` assertions with:

```ts
      expect(io.stderr()).toBe(
        "This needs the repo's old identity and its new one\n  why: It got 1.\n  next: rt repos reidentify <old-identity> <new-identity> [--dry-run] [--json]\n",
      );
```

Add:

```ts
  test("an unknown flag asks nothing and names the command", async () => {
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => reposReidentify(["a", "b", "--force"], {}, { print: (s) => out.push(s) }));
      expect(code).toBe(2);
      expect(io.stderr()).toBe("This command has no option called --force\n  next: rt repos reidentify <old-identity> <new-identity> [--dry-run] [--json]\n");
    } finally {
      io.restore();
    }
  });

  test("a usage error under --json keeps today's message in the envelope", async () => {
    const code = await runExpectingProcessExit(() => reposReidentify(["github.com/acme/old", "--json"], {}, { print: (s) => out.push(s) }));
    expect(code).toBe(2);
    expect(JSON.parse(out.join("\n")).error).toMatchObject({ code: "usage", message: "reidentify takes two identities, got 1; usage: rt repos reidentify <old-identity> <new-identity> [--dry-run] [--json]" });
  });
```

In `lib/__tests__/repo-reidentify-dispatch.test.ts`, in `daemon present but silent is a hard stop, never a local apply`, replace `expect(!out.ok && out.error).toContain("did not answer repos:reidentify");` with (row D2):

```ts
    expect(!out.ok && out.error).toBe("The rt daemon is running but did not answer");
    expect(!out.ok && out.why).toBe("rt will not move this repo's data itself while the daemon holds it: the two would race.");
    expect(!out.ok && out.next).toBe("rt daemon status");
```

Its `via` and `ok` assertions stay: that pair is the shape a program reads.

In `e2e/tests/errors.test.ts`, in `an expected failure prints the failure block without the verb prefix and exits 2`, replace the assertion on the reidentify text (after 5a: `toContain("reidentify takes two identities, got 1; usage: rt repos reidentify")`) with:

```ts
    expect(result.stderr).toContain("This needs the repo's old identity and its new one\n  why: It got 1.\n  next: rt repos reidentify <old-identity> <new-identity> [--dry-run] [--json]\n");
```

The lines around it (`exitCode` 2, empty stdout, no `[failed]`, no `rt repos reidentify:`, no stack) stay.

In `e2e/pty/errors.test.ts`, in `an expected failure paints one failure block with no verb prefix and exits 2`, replace `expect(screen).toContain("takes two identities");` with:

```ts
    expect(screen).toContain("old identity and its new one");
    expect(screen).toContain("rt repos reidentify <old-identity> <new-identity>");
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/__tests__/repos-status.test.ts commands/__tests__/repos-reidentify.test.ts lib/__tests__/repo-reidentify-dispatch.test.ts`
Expected: FAIL. `statusBlocks` is not exported; the human assertions find the old text or an empty capture.

- [ ] **Step 3: Convert `reposStatus` in `commands/repos.ts`**

Delete `failPlain` (lines 404 to 408).

Replace everything from the `// ─── status` banner's doc comment's function to the end of the file with:

```ts
export function statusBlocks(repos: RepoStatusRow[]): Block[] {
  if (repos.length === 0) {
    return [out.line("pending", "No repo status yet", "rt checks your repos shortly after it starts"), out.callout("next", out.cmd("rt repos status --refresh"))];
  }
  const blocks: Block[] = [];
  for (const row of repos) {
    const label = repoLabelQualified(row.repo);
    blocks.push(
      out.tree(
        out.strong(label),
        row.worktrees.map((w) => {
          const dirt = w.clean
            ? "clean"
            : [w.staged ? `${w.staged} staged` : "", w.unstaged ? `${w.unstaged} unstaged` : "", w.untracked ? `${w.untracked} untracked` : "", w.conflicted ? `${w.conflicted} conflicted` : ""].filter(Boolean).join(", ");
          const position = [w.ahead ? `ahead ${w.ahead}` : "", w.behind ? `behind ${w.behind}` : ""].filter(Boolean).join(", ");
          return [out.key(w.branch ?? "(detached)"), dirt, position, out.dim(w.worktree)];
        }),
      ),
    );
    if (row.error) blocks.push(out.line("warn", `rt could not check ${label}`, row.error));
  }
  return blocks;
}

/**
 * rt repos status: the mission-control rail feed over the daemon's git
 * badge cache. Uses the plain daemon-RPC envelope ({ ok, repos, sweptAt }),
 * not the setup contract the other verbs in this file use: it is a cache
 * read the mission-control TUI consumes directly, not a mutating action.
 */
export async function reposStatus(
  args: string[],
  deps: { query?: typeof daemonQuery } = {},
): Promise<void> {
  const json = args.includes("--json");
  const refresh = args.includes("--refresh");
  const query = deps.query ?? daemonQuery;
  const res = refresh
    ? await query("repos:status", { refresh: true }, 120_000)
    : await query("repos:status", {});
  if (res === null) {
    if (json) out.json({ ok: false, error: "daemon unavailable, the rt daemon must be running for repo status" });
    else out.fail({ title: "The rt daemon is not running", why: "Repo status comes from the daemon.", next: out.cmd("rt daemon start") });
    process.exit(1);
  }
  if (!res.ok) {
    if (json) out.json({ ok: false, error: res.error ?? "repos:status failed" });
    else out.fail({ title: "rt could not read your repos' status", hint: res.error ?? "the daemon gave no reason" });
    process.exit(1);
  }
  const data = res.data as { repos: RepoStatusRow[]; sweptAt: string | null };
  if (json) {
    out.json({ ok: true, repos: data.repos, sweptAt: data.sweptAt });
    return;
  }
  out.print(...statusBlocks(data.repos));
}
```

(The `// ─── status ───` banner line above stays.) If TypeScript no longer narrows `res` after the `if (res === null) { ...; process.exit(1); }` block, the block's last statement is a `never` call and narrowing holds; no cast is needed.

Run: `grep -n "console\.\|process\.stdout\|process\.stderr" commands/repos.ts`
Expected: no output.

- [ ] **Step 4: Convert `commands/repos-reidentify.ts`**

Replace the file's body from the imports down with:

```ts
import type { CommandContext } from "../lib/command-tree.ts";
import { reidentifyRepo } from "../lib/repo-reidentify-dispatch.ts";
import { envelope } from "../lib/setup/contract.ts";
import { UserActionableError, exitUserError } from "../lib/errors.ts";
import type { StoreReport } from "../lib/state/reidentify.ts";
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";

const USAGE = "usage: rt repos reidentify <old-identity> <new-identity> [--dry-run] [--json]";
const FLAGS = ["--json", "--dry-run"];
const VERB = "repos reidentify";

export interface ReidentifyDeps {
  /** The --json envelope line only; human text goes through lib/ui/out.ts. */
  print: (line: string) => void;
}

function storeTable(stores: StoreReport[]): Block {
  return out.table(stores.map((s) => (s.detail ? [s.store, s.status, String(s.count), out.dim(s.detail)] : [s.store, s.status, String(s.count)])));
}

/** `jsonMessage` is the envelope's error text and never changes; a person gets the sentence and the command. */
function refuseUsage(deps: ReidentifyDeps, json: boolean, jsonMessage: string, title: string, why?: string): never {
  if (json) exitUserError(new UserActionableError("usage", jsonMessage), true, VERB, deps.print);
  out.fail(usageFailure(title, USAGE, why));
  process.exit(2);
}

export async function reposReidentify(args: string[], _ctx: CommandContext = {}, deps: ReidentifyDeps = { print: (line) => out.payload(`${line}\n`) }): Promise<void> {
  const json = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  for (const a of args) {
    if (a.startsWith("--") && !FLAGS.includes(a)) {
      refuseUsage(deps, json, `unknown flag "${a}"; ${USAGE}`, `This command has no option called ${a}`);
    }
  }
  const positionals = args.filter((a) => !a.startsWith("--"));
  if (positionals.length !== 2) {
    refuseUsage(deps, json, `reidentify takes two identities, got ${positionals.length}; ${USAGE}`, "This needs the repo's old identity and its new one", `It got ${positionals.length}.`);
  }
  const [from, to] = positionals as [string, string];

  const outcome = await reidentifyRepo({ from, to, dryRun });
  if (!outcome.ok && !outcome.report) {
    exitUserError(new UserActionableError("refused", outcome.error, {}, { why: outcome.why, next: outcome.next }), json, VERB, deps.print);
  }
  const report = outcome.report!;
  const route = `${report.from.serialized} → ${report.to.serialized}`;

  if (!outcome.ok) {
    // JSON mode must stay one parseable document, so the report rides in the error payload.
    if (json) exitUserError(new UserActionableError("refused", outcome.error, { via: outcome.via, report }), true, VERB, deps.print);
    out.note(out.line("refused", dryRun ? "This move would be refused" : "The move stopped partway", route), storeTable(report.stores));
    process.exit(2);
  }

  if (json) {
    deps.print(JSON.stringify(envelope({ ok: true, via: outcome.via, data: report })));
    return;
  }
  // A typo in <old> reads as an all-none report, which must not look like a move.
  const nothing = report.stores.every((s) => s.status === "none");
  out.print(
    nothing
      ? out.line("skipped", "Nothing to move", `rt holds nothing under ${report.from.serialized}`)
      : out.line(dryRun ? "pending" : "done", dryRun ? "Would move this repo's data" : "Moved this repo's data", route),
    storeTable(report.stores),
  );
}
```

The header comment at the top of the file stays as it is.

In `lib/repo-reidentify-dispatch.ts`, widen the failure arm and word the hard stop (row D2); the header comment stays:

```ts
  | { via: "daemon" | "local"; ok: false; error: string; report?: ReidentifyReport; why?: string; next?: string };
```

```ts
    if (!res) {
      return {
        via: "daemon",
        ok: false,
        error: "The rt daemon is running but did not answer",
        why: "rt will not move this repo's data itself while the daemon holds it: the two would race.",
        next: "rt daemon status",
      };
    }
```

- [ ] **Step 5: Delete the allowlist line**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `"commands/repos.ts",`.

- [ ] **Step 6: Run the tests**

Run: `bun test lib/__tests__/repos-status.test.ts commands/__tests__/repos-reidentify.test.ts commands/__tests__/repos.test.ts commands/__tests__/repos-locate.test.ts lib/__tests__/repo-reidentify-dispatch.test.ts lib/daemon/__tests__/repos-reidentify-handler.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/errors.test.ts`
Expected: PASS.

Run: `bun test --preload ./e2e/setup.ts --timeout 120000 e2e/pty/errors.test.ts`
Expected: PASS. It builds `ui/dist/rt-ui` itself in `beforeAll`.

- [ ] **Step 7: Commit**

```bash
git add commands/repos.ts commands/repos-reidentify.ts lib/repo-reidentify-dispatch.ts lib/__tests__/repos-status.test.ts commands/__tests__/repos-reidentify.test.ts lib/__tests__/repo-reidentify-dispatch.test.ts e2e/tests/errors.test.ts e2e/pty/errors.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "rt repos: status and reidentify print through the output layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Renders, AGENTS.md, and every gate

**Files:**
- Modify: `AGENTS.md` ("Output layer" section: append; never rewrite what is there)
- Modify: `docs/design/output-layer/README.md`
- Create under `docs/design/output-layer/`: `5e2-home-dark.png`, `5e2-home-light.png`, `5e2-home-steps-dark.png`, `5e2-home-steps-light.png`, `5e2-release-dark.png`, `5e2-release-light.png`, `5e2-repos-dark.png`, `5e2-repos-light.png`

**Interfaces:**
- Consumes: everything above (`updateMachineBlocks`, `progressBlocks`, `releaseAppBlocks`, `pruneBlocks`, `statusBlocks`); `ui/dist/rt-ui` built by `bun run ui:build` (no change under `ui/` is made here; the build only makes sure the helper is current); `termwright` (the pty driver `e2e/interactive.ts` uses) for the steps capture.
- Produces: the renders the PR carries.

If Task 10 Step 9 took the cut, this task runs once per PR with the sets and paragraphs its part list names.

- [ ] **Step 1: Build the helper and write the render inputs**

Run: `bun run ui:build`

In the session scratchpad (not the repo), write `blocks-5e2.ts`. It prints NDJSON for one named set, built with the real builders so the renders show what the verbs print. The `home` set draws each `init` stage as the line it ends with: `stage()` paints those endings through the rt-ui `steps` verb at a terminal, in the same theme `rt-ui render` uses for a `line`, and running `home init` for real here would write to the login keychain.

```ts
// usage: bun blocks-5e2.ts <home|release|repos> > in.ndjson
import * as out from "<repo>/lib/ui/out.ts";
import { encodeLine } from "<repo>/lib/ui/protocol.ts";
import { usageFailure } from "<repo>/lib/ui/usage.ts";
import { progressBlocks, releaseAppBlocks, updateMachineBlocks } from "<repo>/commands/release.ts";
import { pruneBlocks, statusBlocks } from "<repo>/commands/repos.ts";

const worktree = { worktree: "/Users/sample/widgets", branch: "main", detached: false, staged: 0, unstaged: 3, untracked: 1, conflicted: 0, clean: false, ahead: 1, behind: 0, upstream: "origin/main", lastFetchedAt: "", updatedAt: "" };

const sets: Record<string, object[]> = {
  home: [
    out.section("Setting up your home folder", "/Users/sample/.mattstack", out.line("pending", "Clone your home repo", "https://forge.example.test/sample/mattstack-home.git"), out.line("pending", "Name this Mac", "sample-mbp"), out.line("pending", "Link your skills list into your home repo")),
    out.line("done", "Clone your home repo", "https://forge.example.test/sample/mattstack-home.git"),
    out.line("done", "Name this Mac", "sample-mbp"),
    out.line("done", "This Mac's secrets key is ready", "age1qqqqqqqq…"),
    out.callout("next", ["Save it to your password manager: ", out.cmd("rt home key export")]),
    out.line("done", "Set up rt's git intercept"),
    out.line("warn", "Set up deck"),
    out.verbatim(["The app's deck helper owns deck, and deck is not healthy, so rt did not run deck setup: it would add a second copy.", "If the helper is not registered: rt services register"]),
    out.line("needs-you", "Set up mr-board", "you run this one yourself"),
    out.verbatim(['Run this yourself, it asks questions: cd "/Users/sample/code/mr-board" && bun run scripts/setup.ts']),
    out.line("done", "This Mac is set up", "/Users/sample/.mattstack"),
    out.line("running", "Saving your home repo is enabled", "/Users/sample/.mattstack/user"),
    out.kv("watching", "yes"),
    out.kv("push", "waiting to push"),
    out.line("warn", "The last push did not go through", "push failed: non-fast-forward"),
    out.line("done", "Claimed prefs/", "for sample@sample-mbp"),
    out.callout("note", "The daemon picks this up the next time it takes a snapshot"),
    out.line("refused", "prefs/ is already claimed by other@sample-mini"),
    out.callout("next", out.cmd("rt home claim prefs/ --force")),
    out.failure({ title: "This Mac's key does not match your secrets", why: "They are locked to age1stale-re…, and this Mac holds age1qqqqqqqq…. rt will not change which key they are locked to by itself.", next: out.cmd("rt home key import --force"), details: "To change the key on purpose is a deliberate ceremony: rewrite the recipient in your home repo by hand, then save each secret again with rt secrets set." }),
    out.line("failed", "Clone your home repo", "https://forge.example.test/sample/mattstack-home.git"),
    out.failure({ title: "rt could not clone your home repo" }),
    out.verbatim(["fatal: repository 'https://forge.example.test/sample/mattstack-home.git/' not found"], "what it said"),
  ],
  release: [
    out.line("done", "git state", "12 commit(s) since v9.9.8"),
    out.line("stale", "picker:check", "undeclared omitBehavior: sample verb"),
    out.line("warn", "plugin catalog", "marketplace/marketplace.json not readable"),
    out.kv("gate", "full (lib/ changed)"),
    out.summary("stale", "12 checks", ["10 ok", "1 stale", "1 unverifiable"]),
    ...updateMachineBlocks({
      tag: "v9.9.9",
      ok: false,
      haltedAfter: "shared checkout sync",
      legs: [
        { id: "prod-app", label: "prod app update", status: "ok", detail: "/Applications/mattstack.app replaced with v9.9.9 (sha256 verified)" },
        { id: "checkout-sync", label: "shared checkout sync", status: "aborted", detail: "The shared checkout is on feature/sample, not main, so rt left it alone" },
        { id: "daemon", label: "daemon restart", status: "skipped", detail: "Not run: the run stopped at shared checkout sync" },
      ],
    }),
    ...updateMachineBlocks({
      tag: "v9.9.9",
      ok: false,
      haltedAfter: "prod app update",
      legs: [
        { id: "prod-app", label: "prod app update", status: "aborted", detail: "sha256 mismatch for mattstack-v9.9.9.dmg: expected 0a1b2c3d, got 9f8e7d6c" },
        { id: "dev-bundle", label: "dev bundle rebuild", status: "skipped", detail: "Not run: the run stopped at prod app update" },
      ],
    }),
    ...progressBlocks({ kind: "step", step: { id: "qualify", label: "qualify", status: "ok", detail: "origin/main is on the fast path since v9.9.8; releasing board as v9.9.9" } }),
    ...progressBlocks({ kind: "notes", notes: "A patch release that ships board.\n\n### board\n\n- fix a sample bug", hash: "0123456789ab" }),
    ...progressBlocks({ kind: "watching", tag: "v9.9.9" }),
    ...releaseAppBlocks({ apps: ["board"], status: "awaiting-approval", lastTag: "v9.9.8", nextTag: "v9.9.9", steps: [], notes: null, notesHash: null, resume: "rt release apps --yes-notes 0123456789ab" }),
    ...releaseAppBlocks({ apps: [], status: "declined", lastTag: null, nextTag: null, steps: [{ id: "qualify", label: "qualify", status: "stopped", detail: "Main does not qualify for the fast path since v9.9.8: lib/ changed" }], notes: null, notesHash: null, resume: null }),
    ...releaseAppBlocks({ apps: [], status: "declined", lastTag: null, nextTag: null, steps: [{ id: "qualify", label: "qualify", status: "stopped", detail: "nothing has moved since v9.9.8" }], notes: null, notesHash: null, resume: null }),
  ],
  repos: [
    ...statusBlocks([{ repo: "remote:forge.example.test%2Facme%2Fwidgets", worktrees: [worktree, { ...worktree, branch: "feature/sample-change", worktree: "/Users/sample/.worktrees/widgets-1", unstaged: 0, untracked: 0, clean: true, ahead: 0, behind: 2 }], error: null }, { repo: "remote:forge.example.test%2Facme%2Fgadgets", worktrees: [{ ...worktree, worktree: "/Users/sample/gadgets", unstaged: 0, untracked: 0, clean: true, ahead: 0 }], error: "git status timed out" }]),
    out.line("done", "Registered widgets", "/Users/sample/widgets · tracking live (branches)"),
    ...pruneBlocks([{ repoName: "old-widgets", path: "/Users/sample/old-widgets", reason: "missing" }, { repoName: "moved-repo", path: "/Users/sample/gone", reason: "missing", retained: true, hint: "rt repos locate" }], false),
    out.line("pending", "Would move widgets", "/Users/sample/widgets → /Users/sample/code/widgets"),
    out.kv("index rows", "remote:forge.example.test%2Facme%2Fwidgets"),
    out.line("refused", "acme/widgets is still at /Users/sample/widgets, so this folder is a second copy, not a move"),
    out.failure({ title: 'rt does not know a repo called "widgetz"', why: "Name a repo rt has registered, or run this from inside one." }),
    out.line("done", "Moved this repo's data", "remote:forge.example.test%2Facme%2Fold → remote:forge.example.test%2Facme%2Fnew"),
    out.table([["kv:repo-index", "moved", "1"], ["run_history.repo", "none", "0"]]),
    out.line("refused", "The move stopped partway", "remote:forge.example.test%2Facme%2Fold → remote:forge.example.test%2Facme%2Fnew"),
    out.table([["kv:repo-index", "refused", "1", out.dim("both identities have a value")]]),
    out.failure(usageFailure("This needs the repo's old identity and its new one", "rt repos reidentify <old-identity> <new-identity> [--dry-run] [--json]", "It got 1.")),
    out.line("warn", "A repo folder in your settings does not exist", "~/code-old was skipped"),
    out.callout("next", out.cmd("rt settings get rt.repoRoots")),
  ],
};
process.stdout.write(encodeLine({ t: "hello", protocol: 1 }) + sets[process.argv[2] ?? "home"]!.map(encodeLine).join(""));
```

Replace `<repo>` with the worktree's absolute path. Every sample name is invented.

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

- [ ] **Step 2: Render six pages, and capture the live steps through a pty**

For each of `home`, `release` and `repos`, at width 100, render twice. Run these one at a time from the scratchpad (shown for `home`):

```bash
bun blocks-5e2.ts home > home.ndjson
COLORTERM=truecolor TERM=xterm-256color <repo>/ui/dist/rt-ui render --width 100 < home.ndjson > home-dark.ansi
COLORTERM=truecolor TERM=xterm-256color COLORFGBG="0;15" <repo>/ui/dist/rt-ui render --width 100 < home.ndjson > home-light.ansi
bun ansi-page.ts dark home < home-dark.ansi > home-dark.html
bun ansi-page.ts light home < home-light.ansi > home-light.html
```

The `home` set above draws each stage's ending with `rt-ui render`. The live stages are painted by a different verb, `rt-ui steps`, on `/dev/tty`, so capture that verb's own painting once through a real pty. Write `steps-5e2.sh` in the scratchpad: four stages, one helper each, as `stage()` drives them, ending skipped, needs-you, warn and failed (the failed one with its sub-line, which must stay):

```bash
#!/bin/bash
UI=<repo>/ui/dist/rt-ui
step() { printf '%s\n' '{"t":"hello","protocol":1}' "$@" | "$UI" steps; }
step '{"t":"start","title":"Set up deck"}' '{"t":"done","title":"Set up deck","hint":"deck is already running well","status":"skipped"}'
step '{"t":"start","title":"Set up mr-board"}' '{"t":"done","title":"Set up mr-board","hint":"you run this one yourself","status":"needs-you"}'
step '{"t":"start","title":"Set up deck"}' '{"t":"sub","text":"Running deck setup"}' '{"t":"done","title":"Set up deck","status":"warn"}'
step '{"t":"start","title":"Clone your home repo"}' '{"t":"sub","text":"Cloning https://forge.example.test/sample/mattstack-home.git"}' '{"t":"fail","title":"Clone your home repo","hint":"https://forge.example.test/sample/mattstack-home.git"}'
printf '\n__captured__\n'
sleep 30
```

Then capture it twice, one command at a time from the scratchpad:

```bash
termwright screenshot --cols 100 --rows 12 --wait-for __captured__ --delay 300 -o <repo>/docs/design/output-layer/5e2-home-steps-dark.png -- bash steps-5e2.sh
COLORFGBG="0;15" termwright screenshot --cols 100 --rows 12 --wait-for __captured__ --delay 300 -o <repo>/docs/design/output-layer/5e2-home-steps-light.png -- bash steps-5e2.sh
```

termwright draws its own dark ground in both; the light capture shows the colors `rt-ui` picks for a light terminal, so judge it for those (accents legible, body text in the terminal's own foreground), not for its ground. If `termwright screenshot` cannot run here, say so in the report and capture the same script under `script -q` instead; a step that cannot be looked at is a gap to name, never a pass.

- [ ] **Step 3: Screenshot both schemes and look**

Serve the scratchpad over http on 127.0.0.1 (`python3 -m http.server 4173 --bind 127.0.0.1`; `file:` is blocked) and screenshot each of the six pages with Fast Browser (the `fast-browser:browser-driver` agent, or the Fast Browser MCP tools directly). Save the six PNGs into `docs/design/output-layer/` under the names in this task's Files list. The two steps captures from Step 2 are already there.

Then read each PNG and write down plainly what reads wrong. Check these in particular, on both backgrounds:

- **Home:** the plan section of `pending` rows: does it read as "about to happen", not "stuck"? Then the stage lines, one per step: do they read as the same steps now done, and is a `verbatim` guidance block clearly under its stage? The key mismatch failure carries a title, a why, a next and a details paragraph: is that too much coral? A `failed` stage line followed by the failure block: one failure or two? The `refused` claim: clearly not a failure?
- **Home steps (the pty captures):** does each of the four stages end in its own line with its own glyph, the skipped and needs-you ones calm, the warn one amber, only the failed one coral? Did the failed stage keep its `Cloning ...` sub-line under it, and did the warn stage's sub-line clear? Does the steps verb's painting match the `render` lines in the `home` page closely enough that a person would not notice the switch?
- **Release:** `stale`, `warn`, `refused` and `failed` rows side by side: can each be told apart without reading the tag? A `refused` leg followed by a `refused` summary: one thing or two? The checksum leg and its summary in `failed` beside the refused checkout leg: does the fault read as the worse of the two? The approval stop, the fast path refusal and nothing to release: does each say what it is, and the first what to do?
- **Repos:** the status tree: do the branch (lavender), the change counts and the dim path separate into columns, and does an empty position cell leave a clean gap? Does the two-store table under a `done` line look attached to it, and the one under the `refused` line? The refused locate beside the unknown-repo failure: one calm, one coral?
- On light: every body word uses the terminal's own foreground; nothing is pale on white.

A fault found here is fixed in the task that owns the code, re-rendered, and named in the report. Do not declare success from the tests.

- [ ] **Step 4: Update `docs/design/output-layer/README.md`**

Add four rows to its table:

```markdown
| `5e2-home-dark.png`, `5e2-home-light.png` | `rt home`: the init plan, each stage's ending line with the refresh guidance under it, the key lines, snapshot status, a claim and a refused claim, and two failures (a key mismatch, a failed clone with what git said) |
| `5e2-home-steps-dark.png`, `5e2-home-steps-light.png` | `rt home init`'s live stages as `rt-ui steps` paints them through a pty: skipped, needs-you, warn, and a failed stage that keeps its sub-line (termwright's own dark ground in both; the light one shows the light theme's colors) |
| `5e2-release-dark.png`, `5e2-release-light.png` | `rt release`: preflight rows and summary, update-machine legs stopped by a refused leg and by a failed checksum, and `apps` progress (a step, the notes, the watch, the approval stop, a fast path refusal, nothing to release) |
| `5e2-repos-dark.png`, `5e2-repos-light.png` | `rt repos`: the status tree, register, prune, a locate plan, a refused locate and an unknown repo, a reidentify report and a refused one, a usage failure and a setting warning |
```

- [ ] **Step 5: Append to `AGENTS.md`**

At the end of the "Output layer" section (after its last paragraph, before the next `##` heading), append:

```markdown
A `print` seam on a command's deps (`RegisterDeps`, `ReidentifyDeps`)
carries the `--json` envelope line and nothing else; its default is
`out.payload`, so a test of a human branch reads `captureOut()` and a test
of the envelope reads the seam. A sentence that rides in an envelope and is
what a person reads (an error's message, a release row's `detail`) follows
the copy rules like any other: the envelope's shape is what is frozen, not
its words. Data in a `detail` (a version, a sha, a tool's output) stays as
it is. A refusal by policy is a `refused` line through `out.note`, never
`out.fail`.

A run a person watches step by step (`home init`) opens one rt-ui step per
stage through `openStep` and ends each in its own line, with the stage's
progress as sub-lines; off a terminal each ending prints as one plain line.
A sub-line also goes to the CLI log, through `withoutUrls` when it can hold
a url. A program that reads such a run's text (the setup app's `home.init`
step) keys on a constant both sides import, `INIT_STEP_FAILED`, never on a
copy of the words. `withTransientStep` is only for one short wait that
should leave nothing.
`lib/prompt-secret.ts` re-exports `lib/ui/prompt-secret.ts`: the no-echo
prompt holds the terminal in raw mode and lives with the other prompts.
```

Wrap the new paragraphs at about 78 columns like the ones above them; prettier ignores root Markdown files, so nothing reflows them. If 5e1 merged first and appended its own paragraphs, keep them and add these after them, dropping any sentence 5e1 already says.

- [ ] **Step 6: Look for readers of the old text**

The spec asks each conversion PR to grep the skills for text scraped from the verbs it converts. Run each alone:

- `grep -rn "rt home\|rt repos\|rt release" plugins/mattstack skills apps/board/skills --include="*.md"`
- `grep -rn "is provisioned\|already fully provisioned\|failed at step\|registered \|repo index is clean\|tag v.*: clean\|halted after\|recovery:\|transient poll\|second clone\|did not answer repos" plugins/mattstack skills apps/board/skills rt-tray/Sources rt-tray/Sources-core`

Expected for the first: commands being run (`rt repos prune` in `rt-repo-identity`, the release skills' `--json` nodes from Task 10), none reading output text. Expected for the second: no hit that matches a verb's printed text or a reworded detail. Any real reader found is fixed here, in this task's commit, by moving it to `--json`.

- [ ] **Step 7: Run every gate**

Run each from the repo root, one at a time:

- `bun run ui:build`
- `bun run typecheck`
- `bun run test`
- `bun run test:e2e`
- `bun run test:pty`
- `bun run picker:check`
- `bun run format:check`
- `bun run check` (what the `static` CI job runs)

Expected: all pass. `bun run ui:test` is not needed (nothing under `ui/` changed) and `bun run docs:gen` is not needed (no command description changed). Known noise, per the herd notes: about ten rotating load flakes in the unit suite (flavor-takeover, sync-stack-guard, git reset, setup-connect oauth, daemon-logdy-config) and the `rt plugin new` e2e on this machine. A failure in a file this plan did not touch that passes when its file runs alone is a flake; say so in the report with both results.

Then confirm the allowlist lost exactly this plan's seven lines:

Run: `grep -n "commands/home.ts\|lib/home/age-key.ts\|lib/prompt-secret.ts\|commands/release.ts\|commands/repos.ts\|lib/repo-index.ts\|lib/repo-tracking.ts" lib/__tests__/raw-output-allowlist.json`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add AGENTS.md docs/design/output-layer/README.md docs/design/output-layer/5e2-home-dark.png docs/design/output-layer/5e2-home-light.png docs/design/output-layer/5e2-home-steps-dark.png docs/design/output-layer/5e2-home-steps-light.png docs/design/output-layer/5e2-release-dark.png docs/design/output-layer/5e2-release-light.png docs/design/output-layer/5e2-repos-dark.png docs/design/output-layer/5e2-repos-light.png
```

```bash
git commit -m "docs: output layer rules for envelope seams, envelope copy and watched steps, with the 5e2 renders

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Ship

**Files:** none beyond what a rebase touches.

**Interfaces:**
- Consumes: the finished branch.
- Produces: one PR against `m4ttstack/mattstack`, or, when Task 10 Step 9 took the cut, one per branch (this task runs once for each, with its part list's changes).

- [ ] **Step 1: Rebase and re-check what other phases and slices added**

Run: `git fetch origin`
Run: `git rebase origin/main`

Phase 3, 5e1 and other phase 5 slices may have merged. Merge by hand, per ruling 7:

- `lib/__tests__/raw-output-allowlist.json`: keep every deletion from both sides.
- `AGENTS.md` "Output layer": keep their paragraphs, then this plan's (Task 14 Step 5 says what to drop if 5e1 said it first).
- `e2e/tests/errors.test.ts`, `e2e/pty/errors.test.ts`: keep their tests, then re-apply Task 13's two assertion edits.
- `lib/prompt-secret.ts`: if phase 3 edited the file after Task 3 moved it, carry its edit into `lib/ui/prompt-secret.ts` and keep the re-export.
- `lib/setup/steps/home.ts`, `lib/setup/__tests__/home-failure-detail.test.ts`, `lib/setup/__tests__/steps-a.test.ts`: if anything after phase 3 edited them, keep that edit and re-apply Task 7's three reader changes on top.

Then run: `grep -rn "\[failed\] " commands/__tests__/home.test.ts commands/__tests__/release-apps.test.ts commands/__tests__/release-update-machine.test.ts commands/__tests__/repos.test.ts commands/__tests__/repos-locate.test.ts commands/__tests__/repos-reidentify.test.ts`
Expected: only the `[failed]` rows this plan put there on purpose (a failed `summary` and two failed step lines, `Stopped at qualify` and the no-release-tag qualify step, in `release-apps.test.ts`; the checksum leg and its summary in `release-update-machine.test.ts`; and the failed stage line in `home.test.ts`). A `[failed] <title>` pinned as the first line of stderr is a leftover: drop the tag.

- [ ] **Step 2: Re-run the gates after the rebase**

Run, one at a time: `bun run ui:build`, `bun run typecheck`, `bun run test`, `bun run test:e2e`, `bun run test:pty`, `bun run picker:check`, `bun run format:check`, `bun run check`.
Expected: all pass, with the same known noise as Task 14 Step 7.

- [ ] **Step 3: Measure the diff**

Run: `git diff --shortstat origin/main...HEAD`
Expected: insertions plus deletions of about 2,300 for 5e2 and about 1,000 for 5e3 when Task 10 Step 9 took the cut, or under 2,800 on one branch when it did not. Report the number. A single branch past about 2,800 means Task 10 Step 9 was skipped or misread: say so, and ask before shipping it as one PR.

- [ ] **Step 4: Push**

Push the branch with the `git_push` MCP tool (it pushes one explicit refspec to the branch's same-named upstream).

- [ ] **Step 5: Open the PR**

Run: `gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 5e2, home, release and repos" --body-file <scratchpad>/pr-body-5e2.md` (when the slice was cut: `RT-369: output layer phase 5e2, home and release` on this branch, and `RT-369: output layer phase 5e3, repos` with `pr-body-5e3.md` on the other).

The body, in the style of PR 639: one framing paragraph; bold-labelled bullet groups (**Home**: six verbs, the key as a payload, `init` as one step per stage with its progress logged free of credentials, refusals as `refused` lines, child output under a failure, the setup app's `home.init` step reading the new output through shared titles; **Release**: four reports, structured `apps` progress, the two release skills reading `--json`, refused legs and a failed checksum leg, the three no-resume qualify stops told apart; **Repos**: five verbs, the status tree, fifteen lib warnings through `warn`, a refused locate and a refused reidentify; **Copy**: the `lib/home`, `lib/release` and `repos` copy passes, 73 strings reworded (21, 34 and 18) with every envelope's shape kept and the words the release skills read kept; **Also**: `lib/prompt-secret.ts` moved beside the other prompts, the unused picker `color` dropped from `repoOption`); the six renders and the two steps captures; a verification line with the gate results; and the last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Each part list in Task 10 Step 9 says which groups its PR keeps.

- [ ] **Step 6: Report**

Report the PR url, the gate results, the flakes seen with both results, the diff size, and what the renders showed. Do not merge: the shepherd watches CI and CodeRabbit and merges.

---

## Decisions this plan made that the scoping document and the spec do not settle

Each is the plan's best reading; Matt or the reviewer may overrule one before execution.

1. **Envelope copy is reworded, shape kept** (the controller's ruling 1 on this slice, carrying Matt's setup ruling over). In `lib/release`, a detail is the row's hint, so data stays and only sentences change; a recovery command stays as a detail's last words where nothing else in the envelope carries it.
2. **`home init` runs one rt-ui step per stage** (the controller's ruling 2): each plan step and each refresh step opens its own step through `openStep` and ends in its own line; the progress messages become its sub-lines and still reach the CLI log at `debug`. A refresh step's guidance (the daemon's approval text, mr-board's command) is printed under its line after it ends, since a sub-line clears on success. `stage()` lives in `commands/home.ts`, not `lib/ui/steps.ts`, which is 5b's file and cannot end a step in a status other than done or failed.
3. **Refusals by policy are `refused`, and a fault that a guard caught is still a fault** (the controller's ruling 3 and review issue 4): in `home`, a key on argv, a key already there, a path someone else claimed, a profile on a keyed Mac and a skills file rt will not overwrite; in `release`, `update-machine` with no terminal and no `--yes`, a shared checkout off main or an announcement that did not land (aborted legs), and a fast path qualify refusal; in `repos`, every refusal `planLocate` returns and a reidentify a store refused. A key that does not match the secrets, a failed clone, an rt-owned refresh failure, a prod app download whose checksum does not match (aborted, but bad bytes), an origin with no release tag, and a daemon that does not answer stay failures. Nothing has moved since the last tag is `skipped`: nothing to release is not a refusal.
4. **`lib/prompt-secret.ts` moves under `lib/ui/`.** rt-ui has no masked prompt and Go is 5a's, so the prompt cannot go onto the helper here. It is a prompt holding the terminal in raw mode, not output, so it sits with the other prompts, which the guard exempts.
5. **The tenth guard line in `lib/repo-index.ts` is a color import, not a warning.** `repoOption` set `color: dim` on a picker row; `lib/pick-wrappers.ts` never reads it. It is dropped, with the one test line that asserted it.
6. **The age-key debug trace stays on stderr, through `out.note`.** The file is loaded by the daemon, where a CLI log line would be written under the wrong process.
7. **`rt release apps` gets a structured `progress` seam** so the status glyphs leave `lib/release`.
8. **The release skills move to `--json`** for `apps --dry-run` and `update-machine`, in place of keeping the plain text stable for them. AGENTS.md already says a skill must read `--json`. `skills/rt-release` is a plain directory linked into the author's Claude skills by `rt skills link`, not mirrored into `plugins/mattstack` or a pack and not distributed (`skills/.skillsignore` names it), so no plugin version bump or `rt skills check` applies (Task 10 Step 5 confirms each).
9. **Rows with status `failed` print on stdout** in three reports (a refresh step rt owns, an update-machine leg, a release summary), as report rows. The run's failure itself still goes to stderr where there is one (`home init`), and exit codes are unchanged.
10. **A non-fatal problem in `home init` moves from stderr to a `warn` line on stdout** (a preview that could not be built, a refresh that threw, the skills file in the way during a dry run). Spec rule 3 keeps stderr for failures.
11. **`rt repos locate` with nothing to locate, and with a lost repo but no path, are failures on stderr** (they exit 1 today while printing on stdout).
12. **The setup app's `home.init` step keys on a shared constant, not on a machine signal** (review issue 2). The exit code is frozen and a `--json` mode would change what the tray reads, so `INIT_STEP_FAILED` in `lib/home/init-exec.ts` is the contract: `home init` prints its titles from it and `lib/setup/steps/home.ts` matches the clone's. The edit to `lib/setup` is the three readers and their two test files, nothing else, after phase 3 lands.
13. **The three no-resume qualify stops are told apart by the detail `lib/release/release-app.ts` wrote**, through its own constants and `qualifyStop`, because the report has no key for why qualify stopped and the envelope's shape is frozen.
14. **`rt repos locate` words its own `--repo` errors** through `tryResolveRepoArg`, because `lib/repo-arg.ts`'s messages are shared with other verbs; its locate refusals read back through `parseRefusalText` from the `<code>: <message>` form the daemon already sends, so the daemon handler is not edited.
15. **The refusal messages in `lib/repo-locate.ts` are all reworded, not only the three the review named** (`old-path-exists`, `nothing-lost`, `identity-mismatch`): `not-main-worktree` and `identity-changed` carry long dashes onto the same screen, and `not-a-git-repo` is the one the existing refusal test drives.
16. **`repos` ships as 5e3 if the slice measures past about 2,800 lines** (the review's ruling), decided at Task 10 Step 9, the one point where the cut lands on a branch boundary.

## Gaps and overlaps to know about

- **Other slices' files this plan relies on but does not edit:** `lib/rt-render.ts` (5b; `home claim` and `repos locate` call its `textInput` and `confirm`), `lib/pick-wrappers.ts` (5c; four pickers), `lib/ui/*` (5a), `lib/ui/spawn.ts` and `lib/ui/gate.ts` (phase 1), `lib/team/redact.ts` (5e1; `withoutUrls` is imported), `lib/repo-arg.ts` (`tryResolveRepoArg` is called), `lib/daemon/handlers/repos.ts` (its `<code>: <message>` refusal form is read).
- **One phase 3 file this plan edits, after phase 3:** `lib/setup/steps/home.ts` and its two test files (Task 7, by the controller's ruling). Task 1 stops if phase 3 is not on main.
- **Files more than one plan edits:** `lib/__tests__/raw-output-allowlist.json` and `AGENTS.md` (every slice; ruling 7); `e2e/tests/errors.test.ts` and `e2e/pty/errors.test.ts` (5a edits them first; this plan changes one assertion in each); the command tests 5a's Task 2 touches for the `[failed]` tag (`release-apps.test.ts`, `release-update-machine.test.ts`, `repos-reidentify.test.ts`), which is why 5a must land first.
- **`repoOption`'s return type loses `color`.** Its callers are 5c's (`commands/cd.ts`, `lib/pickers.ts`), 5a's (`lib/repo.ts`) and phase 6's (`commands/glitter.ts`, `commands/run.ts`). None reads the field, so none needs an edit; a slice that adds a read of it would not compile.
- **Phase 3 calls `promptSecret` from three files.** The re-export keeps their import path; if phase 3 edits `lib/prompt-secret.ts` itself, Task 15 Step 1 carries the edit over.
- **5e1 is independent.** It owns `commands/team.ts` and `lib/team`; it shares only the allowlist and AGENTS.md with this plan.

## Self-Review

**Spec coverage.** Scoping section 3 "5e", cut (ii): `home` six verbs (Tasks 5 and 6), `release` four verbs (Tasks 9 and 10), `repos` five verbs (Tasks 12 and 13); the seven allowlisted files leave in Tasks 3, 6, 10, 11 and 13, and `commands/repos-reidentify.ts` is converted in Task 13. Shared item 1 (lib warnings: Task 11 applies 5a's rows 6 to 20). Item 5 (a hostile branch name: Task 13). Item 8 (`usageFailure`: Tasks 5, 6, 10, 12, 13; the pty test moves in Task 13). Item 11 (`failPlain`: Task 13). Section 5 readers: the tray's `home init --dry-run --json` (Task 6, Review Focus 1), the release skills (Tasks 8 and 10), `home key export` (Task 5), `repos status --json` for `rt_verb` (Tasks 11 and 13), the e2e text assertions (`release-apps.test.ts` reads `--json` and one kept reason; `errors.test.ts` moves in Task 13). The controller's rulings: 1 (Task 2's three copy tables, Tasks 4, 8, 12 and 13), 2 (Task 6), 3 (Tasks 5, 6, 9, 10, 12 and 13), 5 (Task 10 Step 5), 6 (Task 1). Ruling 4 is 5e1's (the team warn sink). The round 1 review: issue 1 (Task 4's two extra test files), issue 2 (Task 1's phase 3 check, Task 7), issue 3 (Task 6's `withoutUrls` and its test), issue 4 (Task 9's `legStatus`), issue 5 (Task 2's repos copy table, Tasks 12 and 13), issue 6 (Task 6's `homeInit at a terminal`); every recommendation is applied (the tray's `--dry-run --json` test, the size measure and the 5e3 cut, R13 and R15, R25 with `qualifyStop`, `refreshEnding`, the imports, the argument errors and P6 and the skill example, Task 3's line numbers, Task 14's pty capture, Task 11's dedupe).

**Placeholders.** None. `<repo>` and `<scratchpad>` in Tasks 14 and 15 are the implementer's own absolute paths, named as such. "`<the existing template string>`" in Task 12 marks an expression that is moved without change; several of those strings hold a long dash this document may not contain. In Task 2's tables, `<x>` marks a value the code fills in and "..." shortens a quoted string; the code in Tasks 4 to 13 spells each new string out.

**Type consistency.** `refuse(title, ...callouts)` and `stage(title, task)` with `StageEnding` in `commands/home.ts`, `refuseUsage(deps, json, verb, jsonMessage, title, usage, why?)` in `repos.ts` and `refuseUsage(deps, json, jsonMessage, title, why?)` in `repos-reidentify.ts` (different files, different arity, each used only where it is defined), `ReleaseAppProgress`, `progress`, `progressBlocks`, `releaseAppBlocks`, `updateMachineBlocks`, `legStatus`, `QualifyStop`, `qualifyStop`, `pruneBlocks`, `statusBlocks`, `EnsureHomeAgeKeyResult`, `failInit`, `runInitSteps`, `runRefreshSteps`, `planBlock`, `snapshotResultBlocks`, `snapshotStatusBlocks`, `UnknownProfileFlagError.profile`, `INIT_STEP_FAILED`, `homeInitDoneDetail`, `parseRefusalText`, `LOCATE_REFUSAL_CODES`, `resolveLocateRepo` and the `why`/`next` on the two dispatch outcomes are spelled the same in the Interfaces blocks, the code and the tests.

**Review Focus.** Nine items, each pinned to a named test in Tasks 5 to 13.
