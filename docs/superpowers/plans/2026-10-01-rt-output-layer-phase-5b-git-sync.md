# rt Output Layer, Phase 5b (Git and Sync) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every line a person reads from `rt git ...`, `rt sync` and `rt sync all` comes from the output layer, in plain words, with coral only on real failures, so the ten git and sync files leave the raw-output allowlist and `lib/ui/steps.ts` stops printing with its own escapes.

**Architecture:** One small shared file, `commands/git/shared.ts`, holds the one exit a git verb fails through (`failWith`, `failPlain`, `failUsage`) and the two failures every verb repeats. The read verbs (`status`, `log`, `branches`, `diff`) get pure block builders that the handlers print and the tests render plainly. The programmatic API under `rt sync` (`rebaseOnto`, `resetToOrigin`, `syncBranch`) keeps its `error` string and gains a `failure` beside it, so the three CLI handlers and `sync all` draw the same failure block. Progress lines that went to stderr through a local `log()` move to stdout through `out.print`. `lib/ui/steps.ts` prints its fallback line through `out.print` and its helper warning through `out.note`; its `log()` goes, since its three callers print through the layer directly. Under `--json`, `rt sync` and `rt git rebase` call `out.payloadOnStdout()` so nothing but the envelope reaches stdout, and a failed `rt sync --json` leaves at most three lines on stderr, because the `branch_sync` MCP tool reads the last three.

**Tech Stack:** Bun + TypeScript (`commands/`, `lib/`), `bun:test`. No Go change, no pty test (the spec names none for this slice).

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (ticket RT-369), phase 5 of "Phases", plus "Rules", "Steps", "Copy style", "Guard" and "Testing". The slice is defined by `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5-scoping.md` (section 1 "git" and "sync", section 2 items 3, 4, 5, 8 and 11, section 3 "5b", the readers table in section 5, rulings 8 and 11). The twelve cross-phase rulings in `.superpowers/sdd/cross-phase-rulings.md` bind this plan. The 5a plan, `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5a-layer-additions.md`, is a fixed contract: this plan calls its API and redefines none of it.

**What was run while writing this plan:** every block builder below (`statusBlocks`, `logBlocks`, `branchesBlocks`, `diffBlocks`, `stashBlocks`, `tagBlocks`, `manualReport`, `syncAllBlocks`) and every `out.line`, `out.callout`, `out.copy` and `out.section` call whose plain text a test pins was run through the real `renderPlain` at `5bc69f231` in a scratch file; those expected strings are real output. Two things were applied by hand because 5a is not in this tree yet: a failure that opens the output has no `[failed]` tag, and a bidi control is dropped from a branch name. So every expected string that opens with a bare failure title, and the bidi test in Task 4, is unverified until 5a is in the tree: expect small string fixes at the first GREEN run of each task, and fix the expectation only when the difference is 5a's rule applied differently from this plan's reading, never the copy. The handler code is uncompiled and was written against the files at `5bc69f231`.

## Global Constraints

- Never use em dashes or en dashes in any file, comment, test name or commit message. Use "..." or rephrase.
- Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show. No narration, no task numbers, no decision history.
- `--json` output of every existing command must not change, byte for byte. Plain text off a TTY takes the new wording.
- Human text goes to stdout except in payload verbs; failures go to stderr through `out.fail`; never style a payload.
- Coral only for failures. A state that is not done is pending, off, refused, needs-you, stale, skipped or warn.
- 5b only: rt declining by policy (the ownership guard on amend and undo, the three undo refusals, a stack member under `rt sync`, and rt's own uncommitted-changes guard on pull, rebase, reset origin and sync) is a `refused` line on stderr through `out.note`, never `out.fail`; plain form `[refused] <title>` with its callouts under it. Exit codes and `--json` strings do not change. A result from the API under `rt sync` carries `refused: true` beside `failure` when its failure is such a refusal, and the caller draws it with `drawFailure`. A state the verb cannot get past (detached HEAD, a diverged push off a terminal, a rebase already in progress) stays a failure.
- 5b only: a human sentence that rides in a `--json` envelope and is also what a person reads on screen is reworded under the copy rules, shape kept (keys, structure, types, exit codes and machine-read values frozen). In this slice that is the stack refusal's `hint` (exit 4 of `rt sync --json`) and the ownership guard's `detail` inside `refused: <detail>`. Every reader of either is named and updated in Task 12.
- Run `bun test` only from the repo root. Run Go from `ui/` (`go -C ui ...`). `bun run ui:build` after any change under `ui/`.
- Every converted file: delete its line from `lib/__tests__/raw-output-allowlist.json` in the same commit.
- Every commit message ends with the executing session's own `Co-Authored-By` attribution line, as its system prompt gives it; no model name is hardcoded here. Each commit block below marks the place with `<the executing session's own Co-Authored-By line>`.
- Sample data in tests is invented. No real team, person or host names.
- Every leaf picker and every human branch gates on TTY, `--json` and `RT_BATCH` exactly as today; the non-TTY and `--json` paths keep their exit codes.
- 5b only: exit codes do not change. A git verb that fails exits 1. `rt sync` exits 0, 1, 3 (conflict bundle) or 4 (stack refusal). `rt git rebase` exits 0, 1, 3 or 130. `rt git pull` and `rt git push` exit with git's own code. `rt sync all` exits 0 even when a branch failed, as today.
- 5b only: a surface rt-ui already draws is not edited. Every `filterableSelect`, `select`, `confirm`, `withSpinner` and `steps.run` call keeps its options; picker and prompt `message` strings keep their words. The only step text that changes is the fetch and push labels in Task 2's copy table.
- 5b only: a child given the terminal keeps it. `git pull`, `git push` and a post-resolve step run with `stdio: "inherit"` and rt prints nothing between the child's lines.
- 5b only: a failed `rt sync --json` writes one failure to stderr, last, in at most three lines (title, `why`, `next`). `detail()` in `lib/mcp/git-tools.ts:59` reads the last three stderr lines.
- 5b only: lines this slice does not edit keep whatever dashes they hold. Every line it writes has none; where this plan quotes today's text, a long dash is written `--`.
- 5b only: no source or test file holds a literal bidi or zero-width character, and none uses a `\u` escape for one. Build the string with `String.fromCodePoint(0x202e)`.
- 5b only: `lib/stack-guard.ts` and `lib/branch-guard.ts` are edited for their `hint` and `detail` strings only (Task 12); `renderStackRefusal`, every type and every verdict stay as they are. `plugins/mattstack/attachments/forge/rebase-worktree/SKILL.md` is edited in two table rows that quote the hint, with the plugin's patch version bump (Task 12).
- 5b only: files this slice must not edit: `lib/repo.ts`, `lib/enrich.ts`, `lib/mcp/git-tools.ts`, `lib/pick-wrappers.ts`, `lib/rt-render.ts`, `lib/ui/out.ts`, `lib/ui/out-plain.ts`, `lib/ui/spawn.ts`, `lib/ui/protocol.ts`, `lib/ui/__tests__/capture-out.ts`, `lib/command-tree-def.ts`, anything under `ui/`, and every file another slice or phase owns.
- 5b only: git commands are run plain and alone from the worktree root, never joined with `cd`, `&&`, pipes or heredocs. Never `git add -A`, `git add .` or `git add -u`.

## Review Focus

1. **A failed `rt sync --json` whose failure is longer than three lines, or follows a warning.** `branch_sync` keeps only the last three stderr lines, so a five-line failure would reach the agent without its title. A warning printed first stays out of the error only when the ending fills all three lines (title, why, next); a shorter one lets the end of the warning in, as a `console.warn` line does today (Decision 3). Pinned in Task 13 (`under --json a failure is at most three lines, with git's own line beside the title`, `exit 1 with no envelope reads what rt sync left on stderr, whole`, `a warning printed before a three-line ending stays out of the error`).
2. **`--json` on argv while a step prints its plain line.** Off a terminal the fetch step prints `[ok] Fetched from origin`; under `rt git rebase --json` that line used to land on stdout ahead of the conflict bundle. Pinned in Task 8 (`under a payload verb the step's plain line goes to stderr`) and Task 9 (`rebase --json keeps stdout for the bundle alone`).
3. **A policy refusal drawn coral.** The ownership guard, the three undo refusals, the uncommitted-changes guard and a stack member under `rt sync` are `[refused]` notes on stderr with the exit code and `--json` string of today, and the API results carry `refused: true` so every caller draws them the same way. Pinned in Task 3 (`refuseWith keeps the --json error and shows a person a refused note`, `drawFailure draws a refusal as a note and anything else as a failure`), Task 5 (`every reason undo refuses is a refused note in plain words`), Tasks 7, 9 and 10 (the uncommitted-changes handler tests) and Task 13 (`a person reads a stack refusal as a refused note with the tool to run, code 4`).
4. **`sync all`'s per-branch ending.** A branch's failure or refusal must reach stderr under that branch, never vanish (the API under it prints no failure), and one blank line must separate one branch from the next heading. Pinned in Task 13 (`what sync all prints under a branch once its sync ends`, `the blank row between branches is one empty line`).
5. **A guard sentence reworded under a reader that matches it.** The stack hint reaches an agent through `branch_sync`, and the rebase-worktree skill reads that error. Pinned in Task 12 (`the hints a person reads`, and the skill rows rewritten in the same commit so the unverified row no longer depends on wording).

## API this plan consumes from 5a

Cited from the 5a plan's "API for slices 5b to 5f". None of it exists in this worktree until 5a merges; Task 1 checks.

```ts
// lib/ui/out.ts
export function note(...blocks: Block[]): void;   // stderr, whatever the verb; never follows payloadOnStdout

// lib/ui/usage.ts
export function usageFailure(title: string, usage: string, why?: string): FailureInput;   // a leading "usage:" on `usage` is dropped
```

- **The plain failure rule.** A `failure` block that is the first thing a plain render prints has no `[failed]` tag: its first line is `<title>` (and `  <hint>` when there is one). Every `out.fail(...)` is such a render. A test of a human failure asserts the title at the start of stderr.
- **The breadcrumb header.** The dispatcher draws `rt › git › pull` itself, on stderr, before the handler runs, when a person is reading stderr; none for a `hidden` leaf (`git credential`). So this slice deletes the hand-drawn `rt git pull (...)`, `rt git push (...)`, `rt git upstream (...)` and `rt sync all (...)` headers and calls nothing. With `out.__test__.setHuman(() => false)` no header is drawn, so none appears in an expected string.
- **Transparent renderer changes.** Bidi controls and zero-width characters are dropped by both renderers; `rt-ui render` paints the diff with pale tints when `COLORFGBG` says the background is light (render the light screenshot with `COLORFGBG=0;15`); a `line` hint wraps in its own column.
- **The warnings table** (5a Task 1): no row is 5b's. Every row's owner is 5c, 5d, 5e, 5f or phase 6, and no file this slice owns calls `console.warn`. `warn` from `lib/ui/warn.ts` is not called here.

From phases 1 and 2, as code on main: `out.print`, `out.fail(f, ...after)`, `out.json(value, indent?)`, `out.payload`, `out.payloadOnStdout`, the builders (`line`, `callout`, `table`, `section`, `summary`, `copy`, `verbatim`, `diff`, `failure`), the segments (`cmd`, `key`, `strong`, `dim`), `out.__test__.setHuman` and `reset`, `FailureInput`, `CellInput` (`lib/ui/out.ts`); `renderPlain` (`lib/ui/out-plain.ts`); `Block`, `RenderStatus` (`lib/ui/protocol.ts`); `captureOut()` (`lib/ui/__tests__/capture-out.ts`, which does not close the human gate). From phase 4 (19ceaa403, on main, not in this planning tree): `captureOut({ console: true })`, which also sends `console.log` and `console.error` into the stdout and stderr buffers, and `CapturedOut.clear()`, which empties both buffers; `logCliEvent` (`lib/cli-logger.ts`); `openStep`, `StepHandle` (`lib/ui/spawn.ts`).

---

## File Structure

| File | Responsibility |
|---|---|
| `commands/git/shared.ts` (create) | `failWith`, `failPlain`, `failUsage`, `refuseWith`, `readFlag`, `asError`, `asRefusal`, `refusalNote`, `drawFailure`, `NOT_ON_A_BRANCH`, `uncommittedChanges`, `plural`, `errText`: the one `failPlain` (scoping item 11), the one policy refusal, and the words every git verb repeats |
| `commands/git/__tests__/helpers.ts` (create) | Test helpers: `trapExit`, `Exit`, `exitCodeOf`, `makeRepo`, `git`, `ctxFor`, `inDir` |
| `commands/git/inspect.ts` (modify) | `statusBlocks`, `logBlocks`, `branchesBlocks`, `diffBlocks`; the four handlers print them |
| `commands/git/mutate.ts` (modify) | `stashBlocks`, `tagBlocks`, `UNDO_REFUSED`; amend, undo, stash and tag on the layer |
| `commands/git/backup.ts`, `credential.ts`, `pull.ts`, `push.ts` (modify) | Result lines on the layer; the credential reply through `out.payload` |
| `lib/ui/steps.ts` (modify) | The fallback line through `out.print`, the helper warning through `out.note` and the CLI log; no palette, no escapes, no `log()` |
| `commands/git/rebase.ts`, `reset.ts` (modify) | Progress on stdout through `out.print`; results carry `failure`; `conflictFailure` |
| `lib/rebase-escalation.ts` (modify) | `manualReport` (blocks), the bundle through `out.json`, every agent ending on the layer |
| `lib/stack-guard.ts`, `lib/branch-guard.ts` (modify, strings only) | The stack `hint` and the ownership `detail` in plain words |
| `plugins/mattstack/attachments/forge/rebase-worktree/SKILL.md`, `plugins/mattstack/.claude-plugin/plugin.json` (modify) | The two rows that quote the stack hint; the patch version bump the plugin job requires |
| `commands/sync.ts` (modify) | `reportSync`, `refusalBlocks`, `branchEnding`, `BRANCH_GAP`, `syncAllBlocks`, `compactFailure`; `sync` and `sync all` on the layer |
| `lib/__tests__/raw-output-allowlist.json` (modify) | Ten lines deleted |
| Tests beside each of the above; `lib/ui/__tests__/steps.test.ts`, `lib/__tests__/rebase-escalation.test.ts`, `commands/git/__tests__/reset.test.ts`, `lib/mcp/__tests__/git-tools.test.ts`, `lib/__tests__/stack-guard.test.ts`, `lib/__tests__/branch-guard.test.ts` (modify) | |
| `AGENTS.md`, `docs/design/output-layer/` (modify) | The new rules; six renders |

`lib/rt-render.ts` is listed for this slice in the scoping document and needs no edit: it holds no print and no color, and it is not on the allowlist. Its `createStepRunner`, `withSpinner` and `StepRunner` re-exports keep working.

---

### Task 1: Check that 5a is on main

No code. This slice calls `out.note` and `usageFailure` and asserts 5a's plain failure rule in nearly every test, so nothing here can pass before 5a.

**Files:** none.

**Interfaces:**
- Consumes: the 5a PR, merged.
- Produces: a branch for this slice cut from a main that holds 5a.

- [ ] **Step 1: Fetch and look for 5a**

Run: `git fetch origin`
Run: `git log origin/main --oneline -40`
Expected: a commit titled `RT-369: output layer phase 5a, layer additions and dispatcher`.

- [ ] **Step 2: Check the pieces this slice calls**

Run: `git ls-tree --name-only origin/main lib/ui/usage.ts lib/ui/warn.ts lib/ui/transient-step.ts lib/ui/screen.ts`
Expected: all four paths printed.

Run: `git grep -n "export function note" origin/main -- lib/ui/out.ts`
Expected: one hit.

Run: `git grep -n "trimStart().startsWith" origin/main -- lib/ui/out-plain.ts`
Expected: one hit (the plain failure rule).

Run: `git grep -c "commands/git/" origin/main -- lib/__tests__/raw-output-allowlist.json`
Expected: one line ending in `:8` (5a deletes none of this slice's lines).

Run: `git grep -n "console?: boolean" origin/main -- lib/ui/__tests__/capture-out.ts`
Expected: one hit (phase 4's `captureOut({ console: true })`, which every test file in this plan uses).

- [ ] **Step 3: Stop, or branch**

If any check in Step 1 or Step 2 fails, stop here and report that 5a is not on main, with the output of the failing command. Do not start Task 2 and do not stub the 5a API.

If all pass, make sure this slice's branch is cut from that `origin/main` (rebase it if it was cut earlier), then run `bun install --frozen-lockfile` and `bun run ui:build` so the tree holds 5a's helper.

Run: `bun test lib/ui/__tests__/usage.test.ts lib/ui/__tests__/out-plain.test.ts`
Expected: PASS.

---

### Task 2: Audit of the print sites this slice owns

No code. This is the inventory every later task implements; it stays in the plan. Line numbers are at `5bc69f231`; 5a edits none of these files.

**Files read:** the ten allowlisted files, `lib/ui/steps.ts`, `lib/rt-render.ts`, `lib/git-backup.ts`, `lib/commit-ops.ts`, `lib/git-ops.ts`, `lib/stack-guard.ts`, `lib/branch-guard.ts`, `lib/sync-log.ts`, `lib/mcp/git-tools.ts`, `packages/git-core/src/types.ts`, the `git` and `sync` nodes of `lib/command-tree-def.ts`, and every test that touches them.

#### Already on rt-ui (confirming the scoping document)

| Verb | Scoping call | Confirmed | What 5b touches |
|---|---|---|---|
| `git rebase`, `git rebase onto` | partly | Yes. The fetch step (`withSpinner`, `rebase.ts:178`), the branch picker (`rebase.ts:582`) and the conflict `select` (`lib/rebase-escalation.ts:225`) are rt-ui and keep their options. | 18 `log()` lines, 3 handler prints, the fetch labels |
| `git reset origin`, `soft`, `hard` | partly | Yes. The fetch step (`reset.ts:161`) and the confirm (`reset.ts:291`) are rt-ui. | 16 `log()` lines, 5 handler prints, the fetch labels |
| `sync`, `sync all` | partly | Yes. Two steps through `createStepRunner` (`sync.ts:214`, `:303`). | 25 guard lines, three `steps.log` calls, the step labels |
| `git backup`, `git restore` | partly | Yes. The backup picker and the confirm (`backup.ts:71`, `:90`). | 9 lines |
| `git diff`, `git stash drop`, `git tag delete`, `git tag push` | partly | Yes. Leaf pickers (`inspect.ts:110`, `mutate.ts:151`, `:225`). | result and failure lines |
| `git push`, `git push force` | partly | Yes. The diverged `select` (`push.ts:160`). | 17 lines |
| `git upstream`, `git status`, `git log`, `git branches`, `git pull`, `git amend`, `git undo`, `git stash push`, `list`, `pop`, `apply`, `git tag list`, `create` | no | Yes: none reaches rt-ui. | all of their human output |
| `git credential` | n/a (payload) | Yes. | one line, guard-only: `process.stdout.write` becomes `out.payload` |

Counts against the scoping document: `backup.ts` 9, `credential.ts` 1, `inspect.ts` 14, `mutate.ts` 28, `pull.ts` 7, `push.ts` 17, `rebase.ts` 6 + 18, `reset.ts` 7 + 16, `sync.ts` 25, `lib/rebase-escalation.ts` 21. Guard-only edits: the six color imports, the `credential` reply, and the nineteen `--json` envelopes that move to `out.json` or `out.payload`.

#### What a program reads (the scoping document's readers table, applied)

| Output | Reader | What is pinned, and where |
|---|---|---|
| `git credential` stdout | git | the reply byte for byte through `out.payload`, nothing on stderr (Task 6) |
| `git status`, `log`, `branches` with `--json` (agent-safe) | `rt_verb` (`lib/mcp/rt-verb.ts:59`) | stdout is one JSON value, byte for byte (Task 4) |
| every other `--json` git leaf | scripts, `e2e/tests/git-verbs.test.ts` | the `{ ok, ... }` envelope and the `{ ok: false, error }` envelope with its `usage:` and `refused:` strings (Tasks 3, 4, 5) |
| `sync --json --no-agent`, exit 3 | `branch_sync` (`lib/mcp/git-tools.ts:388`) | the conflict bundle, `JSON.stringify(bundle, null, 2)` (Task 11) |
| `sync --json --no-agent`, exit 4 | `branch_sync` (`:391`), which passes `hint` and `tool` through as `rt sync refused (exit 4): <hint>. Run: <tool>`, and `plugins/mattstack/attachments/forge/rebase-worktree/SKILL.md:257-258`, which matches the start of that text | `renderStackRefusal(refusal, "json")` untouched and pinned (Task 13); the `hint` words change in `lib/stack-guard.ts`, and the two skill rows change in the same commit so they key on structure, not wording (Task 12) |
| `git amend --json`, `git undo --json` refused by the ownership guard | scripts; `e2e/tests/git-verbs.test.ts` asserts only `refused: initial` | the `refused: ` prefix stays; the `detail` after it is `lib/branch-guard.ts`'s, reworded in Task 12 |
| `sync --json --no-agent`, exit 1 | `branch_sync` (`:392`): with no `error` and no `hint` key on stdout it reads the last three stderr lines | one failure, last on stderr, at most three lines; the exact tool error it produces (Task 13) |
| `sync --json`, exit 0 | `branch_sync` (`:387`) | stdout empty, as today (Task 13) |

Nothing under `plugins/mattstack`, `skills/` or `apps/board/skills` reads the human text of any git or sync verb: `rt git <verb>` appears in no skill, and `rt sync` only as the tool description and the `rt sync refused (exit N): ...` strings above, which `lib/mcp/git-tools.ts` builds around the hint from `lib/stack-guard.ts`; Task 12 rewords that hint and the two skill rows together. `e2e/tests/git-verbs.test.ts` asserts `--json` only. Task 14 Step 1 repeats the search.

#### Lib printers behind these verbs

`lib/git-backup.ts`, `lib/commit-ops.ts`, `lib/git-ops.ts`, `lib/sync-config.ts` and `lib/sync-log.ts` print nothing; they throw git's own message or write the sync log file. `lib/stack-guard.ts` (`StackRefusal.hint`) and `lib/branch-guard.ts` (`detail`) hold sentences a person reads on screen that also ride in a `--json` envelope; under Matt's ruling they join this slice for those strings only (Task 12). Their readers:

| String | Reader | What Task 12 does |
|---|---|---|
| `StackRefusal.hint` | `branch_sync` (`lib/mcp/git-tools.ts:394`) passes it through into its error | nothing to change: it matches no wording |
| `StackRefusal.hint` | the rebase-worktree skill (`plugins/mattstack/attachments/forge/rebase-worktree/SKILL.md:257-258`) matches the start of the tool's error | row 257 is rewritten to key on structure (an exit 4 error with no `Run:`) so it holds across a plugin and rt version skew, and row 258's example takes the new words; same commit, with the plugin's patch bump (one above main's, cross-phase ruling 13); the CERTIFICATION.md ledger row goes in the report for the shepherd. Team packs pick the rows up at their next compile |
| `StackRefusal.hint` for `reason: "stack"` | the `why` of an amend or undo refusal, and glitter's amend and branch notices | the gitq hint is neutral ("so changing it on its own would break the stack"), so it reads right for sync, amend, undo and checkout alike |
| `StackRefusal.hint` | `renderStackRefusal(..., "human")` into `SyncSummary.error` and the sync log file; `commands/__tests__/sync-stack-guard.test.ts:75` asserts `toContain("s1")` | carries the new words; the assertion still holds |
| `StackRefusal.hint` | `checkBranchGuard` hands it on as `detail` for `reason: "stack"` | carries the new words |
| `BranchGuardVerdict.detail` | `commands/git/mutate.ts`: `refused: <detail>` under `--json`, the `why` of the refused note on screen | the `refused: ` prefix stays |
| `BranchGuardVerdict.detail`, `buildWorktreeGuardMap`'s badge | glitter's notice and branch modal (`lib/mission/driver.ts:1050`, `:1163`, `commands/glitter.ts:68`) | new words on screen; `lib/mission/__tests__/driver.test.ts` uses its own strings |
| both | `lib/__tests__/stack-guard.test.ts`, `lib/__tests__/branch-guard.test.ts` (`toContain` on a branch, a path, a forge error, `default branch`, `stack s1`, `targets feat-parent`) | every `toContain` still holds; new tests pin the exact sentences |

#### Strings that ride in an envelope (the sweep)

| String | On screen? | Decision |
|---|---|---|
| git's own message, as `error` under `--json` and as `details` for a person | yes, under a plain title | stays: git's words, not rt's |
| `usage: rt git ...` as `error` | yes, as the `next` command | stays: command syntax, asserted by `e2e/tests/git-verbs.test.ts` |
| `refused: <reason>` from `git undo` | no: a person reads `UNDO_REFUSED` | stays: `pushed`, `initial`, `merge` are machine-read codes |
| `refused: <detail>` from the ownership guard | the detail is the `why` | reworded at its source, `lib/branch-guard.ts` (Task 12) |
| `hint` in `rt sync --json`'s exit 4 refusal | yes, as the refused note's `why` | reworded at its source, `lib/stack-guard.ts` (Task 12) |
| `hint` in the conflict bundle (`lib/rebase-escalation.ts:84`) | no: `manualReport` does not show it | stays: only an agent reads it |
| `--max requires a value` and the like, thrown by `flagValue` (`lib/cli-args.ts:43`) as `error` | yes, today under "Could not read this branch's commits" | the `--json` error stays (`lib/cli-args.ts` is shared by many verbs and is not this slice's); a person gets a usage failure instead through `readFlag` (Task 3) |

#### Copy

Every later task uses these strings verbatim. `<b>` is the branch, `<r>` the remote, `<t>` the target ref.

**Shared (`commands/git/shared.ts`, Task 3)**

| Today | Becomes |
|---|---|
| `rt <verb>: <message>` on stderr, `{ ok: false, error: <message> }` under `--json` (`inspect.ts:4`, `mutate.ts:9`) | `out.fail({ title: <plain sentence for the verb>, details: <message> })`; the `--json` envelope unchanged through `out.json` |
| a `usage: ...` string as the human message | `out.fail(usageFailure(<question>, <usage>))`; the `--json` `error` keeps the whole usage string |
| a value flag with nothing after it (`--max requires a value`) shown under the verb's failure title | `readFlag`: `usageFailure("That option needs a value after it", <usage>)`; the `--json` `error` keeps `flagValue`'s message |
| a refusal by policy printed as an error | `refuseWith`: `out.note(line("refused", <title>), <callouts>)` on stderr, exit 1; the `--json` `error` unchanged |
| `not on a branch (detached HEAD)` (`backup.ts:28`, `pull.ts:38`, `push.ts:79`, `:147`, `rebase.ts:150`, `reset.ts:135`, `sync.ts:146`) | title `You are not on a branch`, why `This needs a branch, and HEAD is detached right now.` |
| `uncommitted changes -- commit or stash before <verb>` (`pull.ts:43`, `rebase.ts:165`, `reset.ts:146`, `sync.ts:176`) | a refusal, not a failure (rt's own guard: a merge pull on a dirty tree can succeed in git): `[refused] You have uncommitted changes`, a why per verb, next `Commit them, or set them aside with rt git stash push`, drawn through `refusalNote`; the API results carry `refused: true` beside `failure` (`asRefusal`) and callers draw them with `drawFailure` |

**`inspect.ts` (Task 4)**

| Site | Today | Becomes |
|---|---|---|
| `:19`, `:51`, `:67`, `:126` | `console.log(JSON.stringify(...))` | `out.json(...)`, same value |
| `:27` status head | `main -> origin/main  [ahead 1, behind 2]` | a one-row `table`: `key(<b>)`, `dim("tracking origin/main, 1 ahead, 2 behind")`. Detached reads `detached HEAD`; a repo with no commit reads `no commits yet` |
| `:29` | `clean` | `line("done", "Nothing to commit")` |
| `:32-35` files | `  SW modified   a.txt (from old)` | a `table` with headers `FILE`, `CHANGE`, `STAGED`; staged reads `yes`, `no` or `partly`; a rename reads `b.txt (was old.txt)` |
| `:54-56` log | `<sha8>  <date>  <subject>` | a `table`: `dim(sha8)`, `dim(date)`, subject. No commits: `line("skipped", "No commits to show")` |
| `:70-77` branches | `* main -> origin/main  [ahead 1]` | a `table`: `key(name)`, `dim("current, tracking origin/main, 1 ahead, 2 behind, its upstream is gone")`. None: `line("skipped", "No branches yet")` |
| `:130` | `<path>: binary (no line diff)` | `line("skipped", "<path> is a binary file", "no line diff to show")`; a submodule reads `<path> is a submodule` |
| `:133-139` diff | the hunk header, then `+`, `-` or space and the line | one `diff` block. No hunks: `line("skipped", "No changes in <path>")` |
| `:37`, `:106` failure | `rt git status: <git>` | title `Could not read what has changed here` |
| `:58` | `rt git log: <git>` | title `Could not read this branch's commits` |
| `:44-45` | `rt git log: --max requires a value` | `readFlag` with `LOG_USAGE`, `usage: rt git log [--max <n>] [--file <path>] [--json]` |
| `:79` | `rt git branches: <git>` | title `Could not list the branches` |
| `:123` | `rt git diff: <git>` | title `Could not read that file's changes` |
| `:108` no changed file at the picker | `rt git diff: usage: ...` | `usageFailure("Which file?", DIFF_USAGE, "Nothing has changed here, so there is no file to pick from.")` |
| `:118` no path | `rt git diff: usage: ...` | `usageFailure("Which file?", DIFF_USAGE)` |

**`mutate.ts` (Task 5)**

| Site | Today | Becomes |
|---|---|---|
| `:28` | `rt <verb>: warning, could not determine the current branch; skipping the ownership guard` (stderr) | `out.note(line("warn", "rt could not tell which branch this is", "going ahead without the ownership check"))` |
| `:37` | `rt <verb>: refused: <detail>`; `--json` error `refused: <detail>` | `refuseWith`: `[refused] rt will not rewrite this branch's history`, `callout("why", <detail>)`; the `--json` string keeps its shape (`<detail>` takes Task 12's words) |
| `:39` | `rt <verb>: warning, could not verify branch ownership (<detail>)` (stderr) | `out.note(line("warn", "rt could not check who owns this branch", "going ahead"), callout("why", <detail>))` |
| `:56` amend | git's summary line | `line("done", "Amended the last commit", <summary>)` |
| `:69` undo refused | `rt git undo: refused: pushed` | `refuseWith` with `UNDO_REFUSED[reason]`, each a `refused` line: `pushed`: `The last commit is already pushed`, why `Undoing it here would leave this branch behind origin.`; `initial`: `This is the first commit, so there is nothing to go back to`; `merge`: `The last commit is a merge, and rt does not undo merges`. `--json` error `refused: <reason>` unchanged |
| `:79`, `:202-203`, `:262` | `rt git <verb>: --message requires a value` and the like | `readFlag` with `STASH_PUSH_USAGE` (`usage: rt git stash push [--message <m>] [--include-untracked] [--json]`), `TAG_CREATE_USAGE`, `TAG_PUSH_USAGE` |
| `:71` undo | `undid <sha8>; its changes are back in the working tree` | `line("done", "Undid commit <sha8>", "its changes are back in your working tree")` |
| `:88` | `stashed` / `nothing to stash` | `line("done", "Stashed your changes")` / `line("skipped", "Nothing to stash")` |
| `:100-101` | `no stashes` / `stash@{0}  <branch>  <message>` | `line("skipped", "No stashes")` / a `table`: `dim("stash 0")`, `key(branch or "detached HEAD")`, message |
| `:108`, `:160` bad index | `rt git stash: usage: ...` | `usageFailure("That is not a stash number", <usage>, "A stash is named by its number in the list, starting at 0.")` |
| `:121` | `popped stash@{0}` | `line("done", "Brought back stash 0", "and removed it from the list")` |
| `:133` | `applied stash@{0}` | `line("done", "Brought back stash 0", "it is still in the list")` |
| `:149` no stash at the picker | usage | `usageFailure("Which stash?", STASH_DROP_USAGE, "There are no stashes to pick from.")` |
| `:158` | usage | `usageFailure("Which stash?", STASH_DROP_USAGE)` |
| `:167` | `dropped stash@{0}` | `line("done", "Deleted stash 0")` |
| `:189-190` | `no tags` / `<name>  <sha8>  (annotated)` | `line("skipped", "No tags")` / a `table`: `strong(name)`, `dim(sha8)`, `dim("annotated")` |
| `:199` | usage | `usageFailure("What should the tag be called?", TAG_CREATE_USAGE)` |
| `:212` | `created tag <n> and pushed to origin` | `line("done", "Created tag <n>", "and pushed it to origin")` (no hint when not pushed) |
| `:223` no tag at the picker | usage | `usageFailure("Which tag?", <usage>, "There are no tags to pick from.")` |
| `:241`, `:259` | usage | `usageFailure("Which tag?", <usage>)` |
| `:248` | `deleted tag <n> (local only)` | `line("done", "Deleted tag <n>", "on this Mac only")` |
| `:268` | `pushed tag <n> to <r>` | `line("done", "Pushed tag <n>", "to <r>")` |
| failure titles | `rt git <verb>: <git>` | amend `Could not amend the last commit`; undo `Could not undo the last commit`; stash push `Could not stash your changes`; stash list `Could not list the stashes`; pop and apply `Could not bring that stash back`; drop `Could not delete that stash`; tag list and the tag picker `Could not list the tags`; create `Could not create that tag`; delete `Could not delete that tag`; push `Could not push that tag` |

**`backup.ts`, `credential.ts`, `pull.ts`, `push.ts` (Tasks 6 and 7)**

| Site | Today | Becomes |
|---|---|---|
| `backup.ts:33` | `✓ backed up <b> → <ref>` | `line("done", "Backed up <b>", <ref>)` |
| `backup.ts:64` | `no backup branches found` | `line("skipped", "There are no backups to restore")` |
| `backup.ts:81`, `:96` | `cancelled` | `line("skipped", "Nothing was restored")` |
| `backup.ts:87-88` | `restore <b> to backup <sha>` and `(<operation> from <age>)` | `line("pending", "Restore <b> to <sha>", "<operation> backup from <age>")`, `callout("note", "This throws away every change made since that backup.")` |
| `backup.ts:101` | `✓ restored to <ref>` | `line("done", "Restored <b>", <ref>)` |
| `credential.ts:38` | `process.stdout.write(reply)` | `out.payload(reply)` |
| `pull.ts:62-63` | `rt git pull (<b> ← <r>)` and the git command | `line("running", "Pulling <b> from <r>")`. The breadcrumb names the verb; the command is shown only on a dry run |
| `pull.ts:66` | `--dry-run -- not running` | `line("skipped", "Would pull <b> from <r>", "dry run")`, `copy(<the git command>, "the command")` |
| `pull.ts:72` | `✓ pulled <b> from <r>` | `line("done", "Pulled <b>", "from <r>")` |
| `push.ts:86-88` | `rt git upstream (<b>)`, `current:`, `desired:` | dropped; each ending below says both |
| `push.ts:91` | `✓ upstream already <r>/<b>` | `line("done", "<b> already tracks <r>/<b>")` |
| `push.ts:96` | `--dry-run -- not applying` | `line("skipped", "Would point <b> at <r>/<b>", "it tracks <old> now")` |
| `push.ts:101` | `✓ upstream set to <r>/<b>` | `line("done", "<b> now tracks <r>/<b>", "it tracked <old>")`; `<old>` reads `nothing` when unset |
| `push.ts:168` | `cancelled` | `line("skipped", "Nothing was pushed")` |
| `push.ts:173-174` | `local has diverged from <r>/<b> ...` and `use rt git push force ...` (stderr) | `out.fail({ title: "<b> and <r>/<b> have diverged", why: "This usually follows a rebase or an amend, and a plain push would be rejected.", next: cmd("rt git push force") })` |
| `push.ts:195-199` | `rt git push (<b> → <r>/<b>)`, `upstream: <old> → <new>`, the git command | `line("running", "Pushing <b> to <r>/<b>", "forcing, with a lease")` (no hint on a plain push), and when the upstream was wrong `callout("note", "This branch tracked <old>. It now tracks <r>/<b>.")` |
| `push.ts:202` | `--dry-run -- not running` | `line("skipped", "Would push <b> to <r>/<b>", "dry run")` (`"dry run, forcing with a lease"` when forced), the note as `This branch tracks <old>. A real push points it at <r>/<b>.`, `copy(<the git command>, "the command")` |
| `push.ts:208` | `✓ pushed <b> to <r>/<b>` | `line("done", "Pushed <b>", "to <r>/<b>")` |

**`lib/ui/steps.ts` (Task 8)**

| Site | Today | Becomes |
|---|---|---|
| `:40-43` `plainLine`, `:80`, `:89` | `  ✓ <title>  <hint>` with truecolor escapes, even off a TTY | `out.print(out.line("done" or "failed", title, hint))` |
| `:45-47` `warn` | `  ⚠ rt-ui <why>; printed plainly` on stderr | `logCliEvent("warn", "rt-ui", "rt-ui steps <why>; printed plain text instead")` and `out.note(out.line("warn", "rt could not draw a progress line", "results still print"))` |
| `:97-99` `log` | a glyph and the message, with escapes | removed; its three callers in `sync.ts` call `out.print` |
| `:8`, `:28-34` | the palette import, `RESET`, `GLYPH` | removed |

**Step labels (Tasks 8, 9, 10, 13)**

| Site | Today | Becomes |
|---|---|---|
| `rebase.ts:178`, `reset.ts:161`, `sync.ts:214` | `fetching origin…` / `origin fetched` | `Fetching from origin…` / `Fetched from origin`, failing as `Could not fetch from origin` |
| `sync.ts:303` | `pushing…` / `pushed` | `Pushing…` / `Pushed`, failing as `Could not push` |

**`rebase.ts` (Task 9).** Every `log()` line moves from stderr to stdout.

| Site | Today | Becomes |
|---|---|---|
| `:191` | `fetch failed: <err>` | failure: title `Could not fetch from origin`, details `<err>` |
| `:208` | `could not detect default branch (no origin/main or origin/master)` | title `rt could not tell which branch is the default`, why `origin has no main or master branch that it can see.` |
| `:215` | `<b> is the default branch -- nothing to rebase` | `line("skipped", "<b> is the default branch", "nothing to rebase")` |
| `:231` | `✓ <b> already up to date with <t>` | `line("done", "<b> is up to date with <t>")` |
| `:251-254` | `would rebase <b> onto <t> (N commits behind)`, `auto-resolve rules: ...` | `line("skipped", "Would rebase <b> onto <t>", "N commits behind")`, and with rules `callout("note", "Conflicts in these files resolve by themselves: <globs>")` |
| `:271` | `backup → <ref>` | `line("done", "Saved a backup", <ref>)` |
| `:282` | `could not create backup branch: <err>` | title `Could not save a backup, so nothing was changed`, details `<err>` |
| `:287` | `rebasing <b> onto <t> (N behind)…` | `line("running", "Rebasing <b> onto <t>", "N commits behind")` |
| `:334` | `rebase --continue failed unexpectedly` | title `The rebase stopped for a reason rt does not understand`, why `rt put the branch back the way it was.`, details `A backup is at <ref>` |
| `:345-350` paused | `✗ N unresolvable conflicts:`, the files, `rebase left paused for escalation` | `line("needs-you", "N files have conflicts rt cannot resolve", "the rebase is paused")` and a one-column `table` of the files |
| `:345-365` undone | the same list, then `backup at <ref>`; the handler then exits 1 in silence | nothing from `rebaseOnto`; the result carries `conflictFailure`: title `The rebase stopped on conflicts in N files`, why `rt put the branch back the way it was.`, details the files and `A backup is at <ref>`; the caller prints it |
| `:391` | `✓ auto-resolved <file> (ours)` | `line("done", "Resolved <file> for you", "rule: ours")` |
| `:404` | `auto-resolve failed: <err>` | title `A conflict rt was set to resolve by itself could not be resolved`, why `rt put the branch back the way it was.`, details `<err>` |
| `:442` | `running: <step>` | `line("running", "Running a follow-up step", <step>)` |
| `:448`, `:456`, `:466` | `✗ post-resolve step failed: <step>`, `halting -- working tree left as-is; ...` | no line from `rebaseOnto`; failure: title `A follow-up step failed after the rebase`, why `<step> exited with <status>.` (or `was stopped by <signal>.`), details `Your files are as that step left them.` and `A backup is at <ref>` |
| `:478` | `✓ committed regenerated files` | `line("done", "Committed the regenerated files")` |
| `:482-486` | `✓ <b> rebased onto <t> (N auto-resolved)` | `line("done", "Rebased <b> onto <t>", "N conflicts resolved for you")` (no hint when none) |
| `:528` | the error in red on stderr | `drawFailure(result.failure, result.refused)`: the uncommitted-changes guard as a refused note, anything else through `out.fail` |
| `:534` | exit 1 in silence | `out.fail(result.failure)`, exit 1 |
| `:548` | a blank line | removed (spec rule 8) |
| `:593` | `usage: rt git rebase onto <branch>` in yellow on stderr | `out.fail(usageFailure("Which branch?", "rt git rebase onto <branch>", "This needs the branch to rebase onto."))` |

**`reset.ts` (Task 10).** Every `log()` line moves from stderr to stdout.

| Site | Today | Becomes |
|---|---|---|
| `:184` | `remote branch origin/<b> does not exist` | title `<b> is not on origin yet`, why `There is nothing there to match.`, next `cmd("rt git push")` |
| `:194` | `✓ <b> already in sync with origin/<b>` | `line("done", "<b> already matches origin/<b>")` |
| `:203-205` | `fast-forwarding to ...…`, `✓ <b> fast-forwarded to ...` | one line after the merge: `line("done", "Caught <b> up to origin/<b>")` |
| `:229` | `✓ <b> is origin/<b> rebased onto a newer <default> base -- keeping local` | `line("done", "Kept <b> as it is", "it is origin/<b> rebased onto a newer <default>")` |
| `:261` | `backup → <ref>` | `line("done", "Saved a backup", <ref>)` |
| `:274-276` | `remote was rebased -- resetting ...…`, `✓ <b> reset to origin/<b>` | one line after the reset: `line("done", "Reset <b> to origin/<b>", "origin was rebased")` |
| `:281-287` | `⚠ <b> has N extra commits not on remote:`, the commits, `Will reset to ... and cherry-pick these on top.` | `line("warn", "<b> has N commits that origin does not")`, a one-column `table` of the commits, and before the confirm `callout("note", "rt will reset to origin/<b> and put these back on top.")` |
| `:297`, `:307` cancel | `aborted`, then the handler prints `cancelled by user` in red, exit 1 | the result carries `cancelled: true`; the handler prints `line("skipped", "Nothing was changed")`, exit 1 |
| `:314` | `reset to origin/<b>` | removed |
| `:329-338` | `✗ cherry-pick conflict on <commit>`, `restore with: rt git restore` | failure: title `One of your commits could not be put back on top`, why `<commit> conflicts with what is on origin now.`, next `Your branch as it was is in a backup. Bring it back with rt git restore` |
| `:343` | `✓ <commit>` | `line("done", "Put back <commit>")` |
| `:346` | `✓ <b> synced with remote, cherry-picked N commits` | `line("done", "<b> matches origin/<b>", "N commits of yours put back on top")` |
| `:363` | the error in red on stderr | `drawFailure(result.failure, result.refused)` |
| `:366` | a blank line | removed |
| `:378` | `✓ soft reset to HEAD (unstaged)` | `line("done", "Unstaged everything", "your edits are untouched")` |
| `:391`, `:395` | `backup → <ref>`, `✓ hard reset to HEAD` | one call after the reset: `line("done", "Saved a backup of the branch", <ref>)`, `line("done", "Threw away every uncommitted change")` |

**`lib/rebase-escalation.ts` (Task 11)**

| Site | Today | Becomes |
|---|---|---|
| `:202` | `console.log(JSON.stringify(bundle, null, 2))` | `out.json(bundle, 2)` |
| `:215` | `--agent requested but herdr is not reachable... falling back to the prompt` | `line("warn", "herdr is not reachable, so no agent can take this", "choose below")` |
| `:236` | `rebase aborted; backup at <ref>` (only with a backup) | `line("done", "Undid the rebase", "A backup is at <ref>")`, always |
| `:119-135`, `:242`, `:335` `renderHumanReport` | seven indented lines | `manualReport(bundle)`: `line("needs-you", "The rebase of <b> onto <t> is paused", "N files to resolve")`, a `table` of the files, `callout("next", "Fix the files, then run git add <files> and git rebase --continue")`, `callout("note", "To give up instead, run git rebase --abort", "Your branch as it was: <ref>", "rt did not push. When the rebase is done, run git push --force-with-lease origin <b>")` |
| `:265` | `herdr focused an existing agent tab already working on <b>; nothing new was started.` | `line("warn", "An agent is already working on <b>", "nothing new was started")` |
| `:273` | `agent resolving conflicts in pane <id>… (Ctrl+C to detach)` | `line("running", "An agent is resolving the conflicts", "pane <id>; Ctrl+C leaves it working")` |
| `:278` | `detached agent still working in pane <id>. when it finishes: git push ...` | `line("warn", "Stopped watching. The agent is still working", "pane <id>")`, `callout("next", "When it finishes, run git push --force-with-lease origin <b>")` |
| `:292-294` | `✗ agent did not finish within 10 minutes; nothing was pushed`, the pane text, `pane <id> is still open. backup: <ref>` | `out.fail({ title: "The agent did not finish in 10 minutes", why: "Nothing was pushed.", details: "Pane <id> is still open." and "A backup is at <ref>" }, verbatim(<the last 40 lines of the pane>, "the end of the pane"))` |
| `:311` | `✗ rebase completed but push failed: <git>` | `out.fail({ title: "The rebase finished, but the push failed", details: <git> })` |
| `:315` | `✓ agent resolved the conflicts; <b> rebased and pushed` | `line("done", "The agent resolved the conflicts", "<b> is rebased and pushed")` |
| `:320-322` | `agent aborted the rebase. last pane output:`, the pane text, `backup: <ref>` | `out.fail({ title: "The agent gave up and undid the rebase", details: "A backup is at <ref>" }, verbatim(...))` |
| `:326-328` | `✗ verification failed (<verdict>); nothing was pushed`, the pane text, `inspect pane <id>. backup: <ref>` | `out.fail({ title: "The agent stopped, but the rebase is not finished", why: <per verdict>, details: "Nothing was pushed. Look at pane <id>." and the backup }, verbatim(...))`; why: `The rebase is still paused.`, `The worktree has uncommitted changes.`, `The worktree is on a different branch now.` |
| `:334` | `could not hand off to an agent (<err>)` | `line("warn", "Could not hand this to an agent", <err>)`, then `manualReport` |

`renderAgentTask` writes a file an agent reads; it is not terminal output and does not change.

**The guard sentences (Task 12).** `lib/stack-guard.ts` and `lib/branch-guard.ts`, strings only. A hint takes no closing period: `renderStackRefusal` appends `. Run: <tool>`. A path sits after a colon at the end, never inside the sentence. Merge request ids (`!42`) leave the sentence; they stay in the refusal's `mrs` array.

| Site | Today | Becomes |
|---|---|---|
| `stack-guard.ts:131` | `<b> is a member of stack <name> (parent <parent>); rebasing it alone onto <default> would break the stack` | `<b> is in stack <name>, so changing it on its own would break the stack` (neutral, since it is also the `why` of an amend or undo refusal and of glitter's notices) |
| `stack-guard.ts:136` | `could not determine the default branch (no origin/main or origin/master), so open MRs cannot be classified as stacked` | `rt could not find the default branch, so it cannot tell whether this branch is in a stack` |
| `stack-guard.ts:140` | `could not list open MRs to rule out a stack: <error>` | `rt could not list the open merge requests, so it cannot tell whether this branch is in a stack (<error>)` |
| `stack-guard.ts:145-147`, `:157`, own MR | `<b> is part of an untracked stack (its open MR !42 targets <t>); track it, then sync the stack` | `<b> is in a stack gitq does not track yet: its open merge request targets <t>` |
| the same, dependents | `<b> is part of an untracked stack (open MRs !8 (<src>), !9 (<src2>) target it); track it, then sync the stack` | `<b> is in a stack gitq does not track yet: the open merge request from <src> targets it` (one), `...: the open merge requests from <src>, <src2> target it` (several) |
| `branch-guard.ts:67` | `could not list worktrees, so branch ownership is unknown` | `rt could not list the worktrees, so it cannot tell whether another one has this branch` |
| `branch-guard.ts:77` | `could not resolve cwd <cwd>, so branch ownership is unknown` | `rt could not open the folder it ran in, so it cannot tell whether another worktree has this branch: <cwd>` |
| `branch-guard.ts:81` | `could not resolve worktree path <path>, so branch ownership is unknown` | `rt could not open one of the worktrees, so it cannot tell whether another one has this branch: <path>` |
| `branch-guard.ts:88`, `:138` | `<b> is already checked out in another worktree at <path>` | `<b> is checked out in another worktree: <path>` (both sites, so the badge and the refusal never drift) |
| `rebase-worktree/SKILL.md:257` | `rt sync refused (exit 4): could not determine the default branch ...` or `... could not list open MRs to rule out a stack: ...` | independent of wording: an `rt sync refused (exit 4): ...` error with no `Run:` in it (`tool` is `""` for every unverified refusal, so `branch_sync` adds no `Run:`) |
| `rebase-worktree/SKILL.md:258` | `(e.g. <branch> is a member of stack <name> (parent <parent>); rebasing it alone onto <default> would break the stack. Run: <tool>)` | `(e.g. <branch> is in stack <name>, so changing it on its own would break the stack. Run: <tool>)`; the row already keys on the trailing `Run: <tool>`, so an older hint still matches it |

**`sync.ts` (Task 13)**

| Site | Today | Becomes |
|---|---|---|
| `:69-71` | `no origin remote -- nothing to sync` and two more lines | `line("skipped", "This repo has no origin, so there is nothing to sync")`, `callout("next", "Add one with git remote add origin <url>")` |
| `:133` | `rebase in progress -- run 'git rebase --abort' or '--continue' first` | failure: title `A rebase is already in progress here`, next `Finish it with git rebase --continue, or drop it with git rebase --abort` |
| `:157` | `<b> is the default branch -- skipping` | `line("skipped", "<b> is the default branch", "nothing to sync")` |
| `:202` | `<hint> -- proceeding; rerun with --json to fail closed` | `line("warn", "rt could not check whether this branch is part of a stack", "syncing anyway")`, `callout("why", <hint>)` (Task 8) |
| `:210`, `:224` | `fetch failed: <err>` | failure: title `Could not fetch from origin`, details `<err>` |
| `:231` | `diverged from origin/<b> -- syncing with remote first` | `line("warn", "<b> and origin/<b> have diverged", "matching origin first")` (Task 8) |
| `:234` | `would reset to origin/<b>` | `line("skipped", "Would reset <b> to origin/<b>")` (Task 8) |
| `:287` | `unresolvable conflicts` | the rebase result's `conflictFailure` |
| `:314` | `push failed: <err>` | failure: title `Could not push <b>`, details `<err>` |
| `:333-334` | `daemon not running -- start with: rt daemon start`, `--all requires the daemon ...` | `out.fail({ title: "The rt daemon is not running", why: "Syncing every worktree needs it to find them.", next: cmd("rt daemon start") })` |
| `:343` | `failed to get repos from daemon` | `out.fail({ title: "The rt daemon did not answer", next: cmd("rt daemon logs") })` |
| `:354` | `unexpected repos response from daemon` | `out.fail({ title: "The rt daemon gave an answer rt could not read", next: cmd("rt daemon logs") })` |
| `:360` | `repo "<label>" not known to daemon -- is it registered?` | `out.fail({ title: "The rt daemon does not know <label> yet", next: cmd("rt repos register") })` |
| `:386` | `no feature branches to sync` | `line("skipped", "There are no feature branches to sync")` |
| `:390` | `rt sync all (N branches)` | removed; the breadcrumb names the verb and the summary carries the count |
| `:397` | `<repo> (<b>)` in bold | `out.print(out.section(<b>, <repo>))` |
| `:414` | `⚠ could not resolve identity -- skipping` | the branch's ending (below), a failure titled `rt could not tell which repo this worktree belongs to` |
| `:426-433` | nothing after a branch's sync: a conflict's files and backup, printed inside `rebaseOnto` before this slice, would be lost | the branch's ending under its heading, on stderr: a stack refusal through `out.note(...refusalBlocks(refusal))`, any other error through `drawFailure(failure, refused)` (a refusal note or `out.fail`), nothing when it worked. `branchEnding(summary)` is the same blocks as a pure function, for the tests and the renders |
| `:423`, `:434` | blank lines | one blank line between branches, written by the loop as its own call (`BRANCH_GAP`, an empty table row: plain `\n`, nothing visible styled), since each heading is its own render call and rule 8's gap is otherwise lost |
| `:455` | a blank line | removed |
| `:445-454` | a rule, `✓ N synced (P pushed, U up to date)`, `✗ F failed:` and a list | `summary("done", "refused" or "failed", "N of M branches synced", ["P pushed", "U up to date", "R refused", "F failed"])` (the last two only when not zero) and a `table` of the branches not synced: `key(<b>)`, `dim("refused")` and `it is part of a stack` or the refusal's title, or `dim("failed")` and the failure's title |
| `:528` | `console.log(renderStackRefusal(refusal, "json"))` | `out.payload(renderStackRefusal(refusal, "json") + "\n")` |
| `:529` | the hint and `Run: <tool>` in red on stderr | `out.note(...refusalBlocks(refusal))`: `line("refused", "rt will not sync <b> on its own")`, `callout("why", <hint>)`, `callout("next", cmd(<tool>))` |
| `:534` | the error in red on stderr | `drawFailure(summary.failure, summary.refused)`; under `--json` the three-line form of either |

Every verb named in a `next` above exists in `lib/command-tree-def.ts`: `rt git stash push`, `rt git push`, `rt git push force`, `rt git restore`, `rt daemon start`, `rt daemon logs`, `rt repos register`. `gitq sync --stack <name>` and `gitq track` come from `lib/stack-guard.ts` as they are.

---

### Task 3: The shared failure exit and the test helpers

**Files:**
- Create: `commands/git/shared.ts`
- Create: `commands/git/__tests__/helpers.ts`
- Create: `commands/git/__tests__/shared.test.ts`

**Interfaces:**
- Consumes: `out.json`, `out.fail`, `out.note` (5a), `out.line`, `out.callout`, `out.cmd`, `FailureInput` (`lib/ui/out.ts`); `Block` (`lib/ui/protocol.ts`); `usageFailure(title, usage, why?)` (`lib/ui/usage.ts`, 5a); `flagValue(args, flag)`, which throws `Usage("<flag> requires a value")` (`lib/cli-args.ts:39`); `captureOut({ console: true })`, `CapturedOut.clear()` (`lib/ui/__tests__/capture-out.ts`, phase 4); `CommandContext` (`lib/command-tree.ts`).
- Produces, in `commands/git/shared.ts`:
  - `failWith(json: boolean, error: string, failure: out.FailureInput): never`
  - `failPlain(json: boolean, title: string, message: string): never`
  - `failUsage(json: boolean, title: string, usage: string, why?: string): never`
  - `refuseWith(json: boolean, error: string, ...blocks: Block[]): never`
  - `readFlag(json: boolean, args: string[], flag: string, usage: string): string | undefined`
  - `asError(failure: out.FailureInput): { error: string; failure: out.FailureInput }`
  - `asRefusal(failure: out.FailureInput): { error: string; failure: out.FailureInput; refused: true }` (a result's refusal: the same words, marked so a caller draws a note)
  - `refusalNote(f: out.FailureInput): Block[]` (a `refused` line with the title and hint, then `why` and `next` callouts)
  - `drawFailure(f: out.FailureInput, refused?: boolean): void` (`out.note(...refusalNote(f))` when `refused`, else `out.fail(f)`)
  - `NOT_ON_A_BRANCH: out.FailureInput`
  - `uncommittedChanges(why: string): out.FailureInput`
  - `plural(n: number, one: string, many?: string): string`
  - `errText(err: unknown): string`
- Produces, in `commands/git/__tests__/helpers.ts`: `Exit`, `trapExit()`, `exitCodeOf(fn)`, `git(repo, ...args)`, `makeRepo(root, name?)`, `ctxFor(repo)`, `inDir(dir, fn)`. Every test file in this plan captures with `captureOut({ console: true })`, so a `--json` pin reads the same bytes while a file still prints through `console.log` and after it moves to `out.json`.

- [ ] **Step 1: Write the test helpers**

Create `commands/git/__tests__/helpers.ts`:

```ts
import { spyOn } from "bun:test";
import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { CommandContext } from "../../../lib/command-tree.ts";

export class Exit extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`);
  }
}

/** process.exit throws Exit until restore(), so a test can read the code a handler left with. */
export function trapExit(): { restore(): void } {
  const spy = spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Exit(code ?? 0);
  }) as never);
  return { restore: () => spy.mockRestore() };
}

/** The code `fn` exited with, or null when it returned. Needs trapExit(). */
export async function exitCodeOf(fn: () => Promise<unknown>): Promise<number | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    if (err instanceof Exit) return err.code;
    throw err;
  }
}

export function git(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
}

/** A repo on `main` with one commit ("first commit", a.txt holding "one"), and its own identity so commits work under the test HOME. */
export function makeRepo(root: string, name = "repo"): string {
  const repo = join(root, name);
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", repo], { stdio: "pipe" });
  git(repo, "config", "user.email", "sam@example.test");
  git(repo, "config", "user.name", "Sam Sample");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "a.txt"), "one\n");
  git(repo, "add", "a.txt");
  git(repo, "commit", "-qm", "first commit");
  return repo;
}

export function ctxFor(repo: string): CommandContext {
  return { identity: { repoName: "sample-app", identity: "git.example.test/sample/sample-app", repoRoot: repo, dataDir: join(repo, ".rt-data"), remoteUrl: "", baseUrl: "" } };
}

/** Runs `fn` with the process inside `dir`: the inspect and mutate verbs read process.cwd(). */
export async function inDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const before = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(before);
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `commands/git/__tests__/shared.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import * as out from "../../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { asError, asRefusal, drawFailure, errText, failPlain, failUsage, failWith, NOT_ON_A_BRANCH, plural, readFlag, refuseWith, uncommittedChanges } from "../shared.ts";
import { exitCodeOf, trapExit } from "./helpers.ts";

let io: CapturedOut;
let exit: { restore(): void };

beforeEach(() => {
  io = captureOut({ console: true });
  out.__test__.setHuman(() => false);
  exit = trapExit();
});
afterEach(() => {
  exit.restore();
  io.restore();
});

test("failPlain under --json is the envelope on stdout, nothing on stderr, exit 1", async () => {
  expect(await exitCodeOf(async () => failPlain(true, "Could not read what has changed here", "fatal: not a git repository"))).toBe(1);
  expect(io.stdout()).toBe('{"ok":false,"error":"fatal: not a git repository"}\n');
  expect(io.stderr()).toBe("");
});

test("failPlain for a person is a plain title with git's own words under it, on stderr", async () => {
  expect(await exitCodeOf(async () => failPlain(false, "Could not read what has changed here", "fatal: not a git repository"))).toBe(1);
  expect(io.stderr()).toBe("Could not read what has changed here\n  fatal: not a git repository\n");
  expect(io.stdout()).toBe("");
});

test("git's own lines stay inside the block and lose their escapes", async () => {
  await exitCodeOf(async () => failPlain(false, "Could not push that tag", "fatal: bad \x1b[2Jref\nhint: try again"));
  expect(io.stderr()).toBe("Could not push that tag\n  fatal: bad ref\n  hint: try again\n");
});

test("failUsage keeps the usage string in the --json error, byte for byte", async () => {
  expect(await exitCodeOf(async () => failUsage(true, "Which file?", "usage: rt git diff <path> [--staged] [--json]"))).toBe(1);
  expect(io.stdout()).toBe('{"ok":false,"error":"usage: rt git diff <path> [--staged] [--json]"}\n');
  expect(io.stderr()).toBe("");
});

test("failUsage for a person asks for what is missing and names the command", async () => {
  await exitCodeOf(async () => failUsage(false, "Which file?", "usage: rt git diff <path> [--staged] [--json]", "Nothing has changed here, so there is no file to pick from."));
  expect(io.stderr()).toBe("Which file?\n  why: Nothing has changed here, so there is no file to pick from.\n  next: rt git diff <path> [--staged] [--json]\n");
});

test("failWith sends its own error string to --json and its own failure to a person", async () => {
  await exitCodeOf(async () => failWith(true, "Command failed: git fetch origin", { title: "Could not fetch from origin" }));
  expect(io.stdout()).toBe('{"ok":false,"error":"Command failed: git fetch origin"}\n');
  io.clear();
  await exitCodeOf(async () => failWith(false, "Command failed: git fetch origin", { title: "Could not fetch from origin" }));
  expect(io.stderr()).toBe("Could not fetch from origin\n");
  expect(io.stdout()).toBe("");
});

test("refuseWith keeps the --json error and shows a person a refused note, exit 1", async () => {
  const blocks = [out.line("refused", "The last commit is already pushed"), out.callout("why", "Undoing it here would leave this branch behind origin.")];
  expect(await exitCodeOf(async () => refuseWith(true, "refused: pushed", ...blocks))).toBe(1);
  expect(io.stdout()).toBe('{"ok":false,"error":"refused: pushed"}\n');
  expect(io.stderr()).toBe("");
  io.clear();
  expect(await exitCodeOf(async () => refuseWith(false, "refused: pushed", ...blocks))).toBe(1);
  expect(io.stderr()).toBe("[refused] The last commit is already pushed\n  why: Undoing it here would leave this branch behind origin.\n");
  expect(io.stdout()).toBe("");
});

test("readFlag returns the value, and a flag with nothing after it is a usage failure", async () => {
  const usage = "usage: rt git log [--max <n>] [--file <path>] [--json]";
  expect(readFlag(false, ["--max", "5"], "--max", usage)).toBe("5");
  expect(readFlag(false, [], "--max", usage)).toBeUndefined();
  expect(await exitCodeOf(async () => readFlag(true, ["--max", "--json"], "--max", usage))).toBe(1);
  expect(io.stdout()).toBe('{"ok":false,"error":"--max requires a value"}\n');
  io.clear();
  expect(await exitCodeOf(async () => readFlag(false, ["--max"], "--max", usage))).toBe(1);
  expect(io.stderr()).toBe("That option needs a value after it\n  next: rt git log [--max <n>] [--file <path>] [--json]\n");
});

test("drawFailure draws a refusal as a note and anything else as a failure", () => {
  drawFailure(NOT_ON_A_BRANCH);
  drawFailure(uncommittedChanges("A pull could overwrite them."), true);
  expect(io.stderr()).toBe(
    "You are not on a branch\n  why: This needs a branch, and HEAD is detached right now.\n" +
      "[refused] You have uncommitted changes\n  why: A pull could overwrite them.\n  next: Commit them, or set them aside with rt git stash push\n",
  );
  expect(io.stdout()).toBe("");
});

test("asError and asRefusal carry the title as the error string; only a refusal is marked", () => {
  expect(asError(NOT_ON_A_BRANCH)).toEqual({ error: "You are not on a branch", failure: NOT_ON_A_BRANCH });
  const dirty = uncommittedChanges("A pull could overwrite them.");
  expect(asRefusal(dirty)).toEqual({ error: "You have uncommitted changes", failure: dirty, refused: true });
});

test("plural and errText", () => {
  expect(plural(1, "file")).toBe("1 file");
  expect(plural(2, "file")).toBe("2 files");
  expect(plural(3, "branch", "branches")).toBe("3 branches");
  expect(errText(new Error("boom"))).toBe("boom");
  expect(errText("plain")).toBe("plain");
});
```

- [ ] **Step 3: Run it to verify it fails**

Run (repo root): `bun test commands/git/__tests__/shared.test.ts`
Expected: FAIL, cannot find module `../shared.ts`.

- [ ] **Step 4: Create `commands/git/shared.ts`**

```ts
import { flagValue } from "../../lib/cli-args.ts";
import * as out from "../../lib/ui/out.ts";
import type { Block } from "../../lib/ui/protocol.ts";
import { usageFailure } from "../../lib/ui/usage.ts";

/**
 * The one exit for a git verb that cannot go on. Under --json the envelope
 * is `{ ok: false, error }` on stdout, and `error` is a string scripts match
 * on, so it is passed in separately from what a person reads. Exit 1 either
 * way.
 */
export function failWith(json: boolean, error: string, failure: out.FailureInput): never {
  if (json) out.json({ ok: false, error });
  else out.fail(failure);
  process.exit(1);
}

/** A failure whose detail is the tool's own message, git's as a rule. */
export function failPlain(json: boolean, title: string, message: string): never {
  return failWith(json, message, { title, details: message });
}

/** A missing or malformed argument. `usage` is the --json error string, its "usage:" prefix included. */
export function failUsage(json: boolean, title: string, usage: string, why?: string): never {
  return failWith(json, usage, usageFailure(title, usage, why));
}

/**
 * rt declining by policy, which is never a failure: a `refused` note on
 * stderr for a person, the unchanged `{ ok: false, error }` under --json.
 * Exit 1 either way.
 */
export function refuseWith(json: boolean, error: string, ...blocks: Block[]): never {
  if (json) out.json({ ok: false, error });
  else out.note(...blocks);
  process.exit(1);
}

/** `flagValue`'s own message stays the --json error; lib/cli-args.ts is shared beyond this slice. */
export function readFlag(json: boolean, args: string[], flag: string, usage: string): string | undefined {
  try {
    return flagValue(args, flag);
  } catch (err) {
    return failWith(json, errText(err), usageFailure("That option needs a value after it", usage));
  }
}

/** The two members a result object spreads in when it ends in a failure a person will read. */
export function asError(failure: out.FailureInput): { error: string; failure: out.FailureInput } {
  return { error: failure.title, failure };
}

/** A refusal a result carries: `refused` tells the caller to draw a note, never a failure. */
export function asRefusal(failure: out.FailureInput): { error: string; failure: out.FailureInput; refused: true } {
  return { error: failure.title, failure, refused: true };
}

/** A refusal carries no `details`: those are for what went wrong, and here nothing did. */
export function refusalNote(f: out.FailureInput): Block[] {
  return [
    out.line("refused", f.title, f.hint),
    ...(f.why ? [out.callout("why", f.why)] : []),
    ...(f.next !== undefined ? [out.callout("next", f.next)] : []),
  ];
}

export function drawFailure(f: out.FailureInput, refused?: boolean): void {
  if (refused) out.note(...refusalNote(f));
  else out.fail(f);
}

export const NOT_ON_A_BRANCH: out.FailureInput = { title: "You are not on a branch", why: "This needs a branch, and HEAD is detached right now." };

export function uncommittedChanges(why: string): out.FailureInput {
  return { title: "You have uncommitted changes", why, next: ["Commit them, or set them aside with ", out.cmd("rt git stash push")] };
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
```

- [ ] **Step 5: Run the tests and the guard**

Run: `bun test commands/git/__tests__/shared.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS. The guard passes because `shared.ts` prints only through `out`, and it skips `__tests__`. The bare-title expectations here are 5a's plain failure rule as this plan reads it; if one differs by that rule alone, fix the expectation and say so in the report.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add commands/git/shared.ts commands/git/__tests__/helpers.ts commands/git/__tests__/shared.test.ts
```

```bash
git commit -m "git: one failure exit for the git verbs, and the test helpers they share

<the executing session's own Co-Authored-By line>"
```

---

### Task 4: `git status`, `log`, `branches` and `diff`

**Files:**
- Modify: `commands/git/inspect.ts` (whole file)
- Create: `commands/git/__tests__/inspect-json.test.ts`, `commands/git/__tests__/inspect.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `"commands/git/inspect.ts",`)

**Interfaces:**
- Consumes: `failPlain`, `failUsage`, `readFlag`, `errText` (`commands/git/shared.ts`, Task 3); the helpers of Task 3; `out.table`, `out.line`, `out.diff`, `out.key`, `out.dim`, `out.json`, `out.print`; `renderPlain`; `RepoSnapshot`, `LogEntry`, `BranchInfo`, `FileDiff`, `createGitClient` (`packages/git-core/src/index.ts`).
- Produces, exported from `commands/git/inspect.ts`: `statusBlocks(snap: RepoSnapshot): Block[]`, `logBlocks(entries: LogEntry[]): Block[]`, `branchesBlocks(branches: BranchInfo[]): Block[]`, `diffBlocks(diff: FileDiff): Block[]`. Task 14 renders them. `repoClient()` and the four handlers keep their names and signatures; the exported `failPlain` goes (nothing imports it).

- [ ] **Step 1: Pin `--json` before touching the file**

Create `commands/git/__tests__/inspect-json.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createGitClient } from "../../../packages/git-core/src/index.ts";
import * as out from "../../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { branchesCommand, diffCommand, logCommand, statusCommand } from "../inspect.ts";
import { exitCodeOf, inDir, makeRepo, trapExit } from "./helpers.ts";

let root: string;
let repo: string;
let io: CapturedOut;
let exit: { restore(): void };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-inspect-json-")));
  repo = makeRepo(root);
  writeFileSync(join(repo, "a.txt"), "two\n");
  writeFileSync(join(repo, "new.txt"), "hello\n");
  io = captureOut({ console: true });
  out.__test__.setHuman(() => false);
  exit = trapExit();
});
afterEach(() => {
  exit.restore();
  io.restore();
  rmSync(root, { recursive: true, force: true });
});

test("status --json is the snapshot under ok, one line", async () => {
  await inDir(repo, () => statusCommand(["--json"]));
  expect(io.stdout()).toBe(JSON.stringify({ ok: true, ...(await createGitClient(repo).snapshot()) }) + "\n");
  expect(io.stderr()).toBe("");
});

test("log --json is the entries under ok", async () => {
  await inDir(repo, () => logCommand(["--json"]));
  expect(io.stdout()).toBe(JSON.stringify({ ok: true, entries: await createGitClient(repo).log({ maxCount: 20 }) }) + "\n");
  expect(io.stderr()).toBe("");
});

test("branches --json is the branches under ok", async () => {
  await inDir(repo, () => branchesCommand(["--json"]));
  expect(io.stdout()).toBe(JSON.stringify({ ok: true, branches: await createGitClient(repo).branches() }) + "\n");
  expect(io.stderr()).toBe("");
});

test("diff --json is the file diff under ok", async () => {
  await inDir(repo, () => diffCommand(["a.txt", "--json"]));
  expect(io.stdout()).toBe(JSON.stringify({ ok: true, diff: await createGitClient(repo).diffFile("a.txt", { staged: false }) }) + "\n");
  expect(io.stderr()).toBe("");
});

test("diff --json with no path is the usage envelope, exit 1", async () => {
  expect(await exitCodeOf(() => inDir(repo, () => diffCommand(["--json"])))).toBe(1);
  expect(io.stdout()).toBe('{"ok":false,"error":"usage: rt git diff <path> [--staged] [--json]"}\n');
  expect(io.stderr()).toBe("");
});

test("log --max with no value is a JSON error, exit 1", async () => {
  expect(await exitCodeOf(() => inDir(repo, () => logCommand(["--max", "--json"])))).toBe(1);
  expect(io.stdout()).toBe('{"ok":false,"error":"--max requires a value"}\n');
});
```

- [ ] **Step 2: Run the pins against today's code**

Run: `bun test commands/git/__tests__/inspect-json.test.ts`
Expected: PASS, all six, with `inspect.ts` unedited. If one fails here, the expectation is wrong, not the code: fix the test before going on. These six must pass unchanged after Step 5.

- [ ] **Step 3: Write the failing human tests**

Create `commands/git/__tests__/inspect.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { BranchInfo, FileDiff, LogEntry, RepoSnapshot } from "../../../packages/git-core/src/index.ts";
import * as out from "../../../lib/ui/out.ts";
import { renderPlain } from "../../../lib/ui/out-plain.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { branchesBlocks, diffBlocks, diffCommand, logBlocks, logCommand, statusBlocks, statusCommand } from "../inspect.ts";
import { exitCodeOf, inDir, makeRepo, trapExit } from "./helpers.ts";

const snap = (over: Partial<RepoSnapshot>): RepoSnapshot => ({ branch: "main", detached: false, upstream: null, ahead: null, behind: null, files: [], clean: true, ...over });
const branch = (over: Partial<BranchInfo>): BranchInfo => ({ name: "main", current: false, sha: "0123456789abcdef", upstream: null, upstreamGone: false, ahead: null, behind: null, committedAt: "2026-09-30T10:00:00Z", ...over });
const entry = (sha: string, authorDate: string, subject: string): LogEntry => ({ sha, parents: [], authorName: "Sam Sample", authorEmail: "sam@example.test", authorDate, subject, body: "" });

test("status names the branch, where it stands, and each changed file", () => {
  const blocks = statusBlocks(
    snap({
      branch: "feature/login",
      upstream: "origin/feature/login",
      ahead: 1,
      behind: 2,
      clean: false,
      files: [
        { path: "a.txt", kind: "modified", staged: false, unstaged: true },
        { path: "new.txt", kind: "untracked", staged: false, unstaged: true },
        { path: "b.txt", kind: "renamed", staged: true, unstaged: true, originalPath: "old.txt" },
      ],
    }),
  );
  expect(renderPlain(blocks)).toBe(
    "feature/login  tracking origin/feature/login, 1 ahead, 2 behind\n" +
      "FILE                 CHANGE     STAGED\n" +
      "a.txt                modified   no\n" +
      "new.txt              untracked  no\n" +
      "b.txt (was old.txt)  renamed    partly\n",
  );
});

test("a clean tree, a detached HEAD and a repo with no commit each say so", () => {
  expect(renderPlain(statusBlocks(snap({})))).toBe("main\n[ok] Nothing to commit\n");
  expect(renderPlain(statusBlocks(snap({ branch: null, detached: true })))).toBe("detached HEAD\n[ok] Nothing to commit\n");
  expect(renderPlain(statusBlocks(snap({ branch: null })))).toBe("no commits yet\n[ok] Nothing to commit\n");
});

test("log lists short sha, day and subject, and says when there is nothing", () => {
  expect(renderPlain(logBlocks([entry("0123456789abcdef", "2026-09-30T10:00:00Z", "add the login form"), entry("fedcba9876543210", "2026-09-29T09:00:00Z", "first commit")]))).toBe(
    "01234567  2026-09-30  add the login form\nfedcba98  2026-09-29  first commit\n",
  );
  expect(renderPlain(logBlocks([]))).toBe("[skipped] No commits to show\n");
});

test("branches says which is current and how each stands against its upstream", () => {
  const blocks = branchesBlocks([
    branch({ name: "main", current: true, upstream: "origin/main", ahead: 0, behind: 0 }),
    branch({ name: "feature/login", upstream: "origin/feature/login", ahead: 2, behind: 1 }),
    branch({ name: "old-idea", upstream: "origin/old-idea", upstreamGone: true }),
    branch({ name: "scratch" }),
  ]);
  expect(renderPlain(blocks)).toBe(
    "main           current, tracking origin/main\n" +
      "feature/login  tracking origin/feature/login, 2 ahead, 1 behind\n" +
      "old-idea       tracking origin/old-idea, its upstream is gone\n" +
      "scratch\n",
  );
  expect(renderPlain(branchesBlocks([]))).toBe("[skipped] No branches yet\n");
});

test("a branch name with a right-to-left override prints without it", () => {
  const hostile = "main" + String.fromCodePoint(0x202e) + "txt";
  expect(renderPlain(branchesBlocks([branch({ name: hostile, current: true })]))).toBe("maintxt  current\n");
  expect(renderPlain(statusBlocks(snap({ branch: hostile })))).toBe("maintxt\n[ok] Nothing to commit\n");
});

test("diff is one diff block; a binary file, a submodule and an unchanged file each say so", () => {
  const text: FileDiff = {
    path: "a.txt",
    kind: "text",
    hunks: [
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        header: "@@ -1,2 +1,2 @@",
        lines: [
          { type: "context", content: "keep", oldLineNo: 1, newLineNo: 1 },
          { type: "del", content: "one", oldLineNo: 2, newLineNo: null },
          { type: "add", content: "two", oldLineNo: null, newLineNo: 2 },
        ],
      },
    ],
  };
  expect(diffBlocks(text).map((b) => b.t)).toEqual(["diff"]);
  expect(renderPlain(diffBlocks(text))).toBe("@@ -1,2 +1,2 @@\n  keep\n- one\n+ two\n");
  expect(renderPlain(diffBlocks({ path: "logo.png", kind: "binary", hunks: [] }))).toBe("[skipped] logo.png is a binary file  no line diff to show\n");
  expect(renderPlain(diffBlocks({ path: "vendor/kit", kind: "submodule", hunks: [] }))).toBe("[skipped] vendor/kit is a submodule  no line diff to show\n");
  expect(renderPlain(diffBlocks({ path: "a.txt", kind: "text", hunks: [] }))).toBe("[skipped] No changes in a.txt\n");
});

let root: string;
let io: CapturedOut;
let exit: { restore(): void };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-inspect-")));
  io = captureOut({ console: true });
  out.__test__.setHuman(() => false);
  exit = trapExit();
});
afterEach(() => {
  exit.restore();
  io.restore();
  rmSync(root, { recursive: true, force: true });
});

test("status prints on stdout and leaves stderr empty", async () => {
  const repo = makeRepo(root);
  writeFileSync(join(repo, "a.txt"), "two\n");
  await inDir(repo, () => statusCommand([]));
  expect(io.stdout()).toBe("main\nFILE   CHANGE    STAGED\na.txt  modified  no\n");
  expect(io.stderr()).toBe("");
});

test("diff with no path off a terminal asks which file, on stderr, exit 1", async () => {
  const repo = makeRepo(root);
  expect(await exitCodeOf(() => inDir(repo, () => diffCommand([])))).toBe(1);
  expect(io.stderr()).toBe("Which file?\n  next: rt git diff <path> [--staged] [--json]\n");
  expect(io.stdout()).toBe("");
});

test("log with a value flag and nothing after it asks for the value, not git", async () => {
  const repo = makeRepo(root);
  expect(await exitCodeOf(() => inDir(repo, () => logCommand(["--max"])))).toBe(1);
  expect(io.stderr()).toBe("That option needs a value after it\n  next: rt git log [--max <n>] [--file <path>] [--json]\n");
  expect(io.stdout()).toBe("");
});

test("outside a repo the failure opens with a plain title, exit 1", async () => {
  expect(await exitCodeOf(() => inDir(root, () => statusCommand([])))).toBe(1);
  expect(io.errLines()[0]).toBe("Could not read what has changed here");
  expect(io.errLines().length).toBeGreaterThan(1);
  expect(io.stdout()).toBe("");
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `bun test commands/git/__tests__/inspect.test.ts`
Expected: FAIL. `statusBlocks`, `logBlocks`, `branchesBlocks` and `diffBlocks` are not exported from `../inspect.ts`.

- [ ] **Step 5: Replace `commands/git/inspect.ts`**

The whole file becomes:

```ts
import { createGitClient, type BranchInfo, type FileDiff, type LogEntry, type RepoSnapshot } from "../../packages/git-core/src/index.ts";
import * as out from "../../lib/ui/out.ts";
import type { Block } from "../../lib/ui/protocol.ts";
import { errText, failPlain, failUsage, readFlag } from "./shared.ts";

export function repoClient() {
  return createGitClient(process.cwd());
}

function position(ahead: number | null, behind: number | null): string[] {
  return [ahead ? `${ahead} ahead` : "", behind ? `${behind} behind` : ""].filter(Boolean);
}

export function statusBlocks(snap: RepoSnapshot): Block[] {
  const head = snap.detached ? "detached HEAD" : (snap.branch ?? "no commits yet");
  const notes = [snap.upstream ? `tracking ${snap.upstream}` : "", ...position(snap.ahead, snap.behind)].filter(Boolean).join(", ");
  const headRow: out.CellInput[] = notes ? [out.key(head), out.dim(notes)] : [out.key(head)];
  if (snap.clean) return [out.table([headRow]), out.line("done", "Nothing to commit")];
  const rows: out.CellInput[][] = snap.files.map((f) => [
    f.originalPath ? [f.path, out.dim(` (was ${f.originalPath})`)] : f.path,
    out.dim(f.kind),
    out.dim(f.staged && f.unstaged ? "partly" : f.staged ? "yes" : "no"),
  ]);
  return [out.table([headRow]), out.table(rows, ["FILE", "CHANGE", "STAGED"])];
}

export function logBlocks(entries: LogEntry[]): Block[] {
  if (entries.length === 0) return [out.line("skipped", "No commits to show")];
  return [out.table(entries.map((e) => [out.dim(e.sha.slice(0, 8)), out.dim(e.authorDate.slice(0, 10)), e.subject]))];
}

export function branchesBlocks(branches: BranchInfo[]): Block[] {
  if (branches.length === 0) return [out.line("skipped", "No branches yet")];
  return [
    out.table(
      branches.map((b) => {
        const notes = [b.current ? "current" : "", b.upstream ? `tracking ${b.upstream}` : "", ...position(b.ahead, b.behind), b.upstreamGone ? "its upstream is gone" : ""].filter(Boolean).join(", ");
        return notes ? [out.key(b.name), out.dim(notes)] : [out.key(b.name)];
      }),
    ),
  ];
}

export function diffBlocks(diff: FileDiff): Block[] {
  if (diff.kind !== "text") return [out.line("skipped", `${diff.path} is ${diff.kind === "binary" ? "a binary file" : "a submodule"}`, "no line diff to show")];
  if (diff.hunks.length === 0) return [out.line("skipped", `No changes in ${diff.path}`)];
  return [out.diff(diff.hunks.map((h) => ({ header: h.header, lines: h.lines.map((l) => ({ kind: l.type, text: l.content })) })))];
}

const STATUS_FAILED = "Could not read what has changed here";

export async function statusCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  let snap: RepoSnapshot;
  try {
    snap = await repoClient().snapshot();
  } catch (err) {
    failPlain(json, STATUS_FAILED, errText(err));
  }
  if (json) out.json({ ok: true, ...snap });
  else out.print(...statusBlocks(snap));
}

const LOG_USAGE = "usage: rt git log [--max <n>] [--file <path>] [--json]";

export async function logCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const max = Number(readFlag(json, args, "--max", LOG_USAGE) ?? 20);
  const file = readFlag(json, args, "--file", LOG_USAGE);
  let entries: LogEntry[];
  try {
    entries = await repoClient().log({
      maxCount: Number.isFinite(max) && max > 0 ? max : 20,
      ...(file ? { file } : {}),
    });
  } catch (err) {
    failPlain(json, "Could not read this branch's commits", errText(err));
  }
  if (json) out.json({ ok: true, entries });
  else out.print(...logBlocks(entries));
}

export async function branchesCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  let branches: BranchInfo[];
  try {
    branches = await repoClient().branches();
  } catch (err) {
    failPlain(json, "Could not list the branches", errText(err));
  }
  if (json) out.json({ ok: true, branches });
  else out.print(...branchesBlocks(branches));
}

const DIFF_USAGE = "usage: rt git diff <path> [--staged] [--json]";

function positional(args: string[]): string | undefined {
  const flagsWithValue = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (flagsWithValue.has(a)) { i++; continue; }
    if (!a.startsWith("-")) return a;
  }
  return undefined;
}

export async function diffCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const staged = args.includes("--staged");
  const client = repoClient();
  let path = positional(args);
  let untracked = false;
  if (!path && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
    let files: RepoSnapshot["files"];
    try {
      files = (await client.snapshot()).files;
    } catch (err) {
      failPlain(json, STATUS_FAILED, errText(err));
    }
    if (files.length === 0) failUsage(json, "Which file?", DIFF_USAGE, "Nothing has changed here, so there is no file to pick from.");
    const { filterableSelect } = await import("../../lib/pick-wrappers.ts");
    const picked = await filterableSelect({
      message: "Diff which file?",
      options: files.map((f) => ({ label: f.path, value: f.path, hint: f.kind })),
    });
    if (picked === null) process.exit(0);
    path = picked;
    untracked = files.find((f) => f.path === picked)?.kind === "untracked";
  }
  if (!path) failUsage(json, "Which file?", DIFF_USAGE);
  let diff: FileDiff;
  try {
    diff = await client.diffFile(path, { staged, ...(untracked ? { untracked: true } : {}) });
  } catch (err) {
    failPlain(json, "Could not read that file's changes", errText(err));
  }
  if (json) out.json({ ok: true, diff });
  else out.print(...diffBlocks(diff));
}
```

The picker call, the gate in front of it and `positional` are today's, character for character.

- [ ] **Step 6: Delete the allowlist line**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `  "commands/git/inspect.ts",`.

- [ ] **Step 7: Run the tests**

Run: `bun test commands/git/__tests__/inspect.test.ts commands/git/__tests__/inspect-json.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS, the six pins of Step 1 unchanged.

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/git-verbs.test.ts`
Expected: PASS (the real binary's `--json`).

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add commands/git/inspect.ts commands/git/__tests__/inspect.test.ts commands/git/__tests__/inspect-json.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "git: status, log, branches and diff print through the output layer

<the executing session's own Co-Authored-By line>"
```

---

### Task 5: `git amend`, `undo`, `stash` and `tag`

**Files:**
- Modify: `commands/git/mutate.ts` (whole file)
- Create: `commands/git/__tests__/mutate-json.test.ts`, `commands/git/__tests__/mutate.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `"commands/git/mutate.ts",`)

**Interfaces:**
- Consumes: `failPlain`, `failUsage`, `refuseWith`, `readFlag`, `errText` (Task 3); `out.note` (5a); `out.line`, `out.callout`, `out.table`, `out.strong`, `out.key`, `out.dim`, `out.json`, `out.print`; `StashEntry`, `TagInfo`, `UndoRefusal`, `UndoResult` (`packages/git-core/src/index.ts`); `checkBranchGuard` (`lib/branch-guard.ts`, whose verdict is `{ verdict: "clear" } | { verdict: "refuse"; reason; detail: string } | { verdict: "unverified"; detail: string }`).
- Produces, exported from `commands/git/mutate.ts`: `stashBlocks(stashes: StashEntry[]): Block[]`, `tagBlocks(tags: TagInfo[]): Block[]`, `UNDO_REFUSED: Record<UndoRefusal, Block[]>` (each a `refused` line, with a `why` callout where there is one). The eleven handlers keep their names and signatures; the exported `failPlain` goes.

- [ ] **Step 1: Pin `--json` before touching the file**

Create `commands/git/__tests__/mutate-json.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createGitClient } from "../../../packages/git-core/src/index.ts";
import * as out from "../../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { stashDropCommand, stashListCommand, stashPopCommand, stashPushCommand, tagCreateCommand, tagDeleteCommand, tagListCommand } from "../mutate.ts";
import { exitCodeOf, inDir, makeRepo, trapExit } from "./helpers.ts";

let root: string;
let repo: string;
let io: CapturedOut;
let exit: { restore(): void };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-mutate-json-")));
  repo = makeRepo(root);
  io = captureOut({ console: true });
  out.__test__.setHuman(() => false);
  exit = trapExit();
});
afterEach(() => {
  exit.restore();
  io.restore();
  rmSync(root, { recursive: true, force: true });
});

test("stash push, list and pop keep their envelopes", async () => {
  writeFileSync(join(repo, "a.txt"), "stash me\n");
  await inDir(repo, () => stashPushCommand(["--message", "wip sample", "--json"]));
  const listed = JSON.stringify({ ok: true, stashes: await createGitClient(repo).stashes() }) + "\n";
  await inDir(repo, () => stashListCommand(["--json"]));
  await inDir(repo, () => stashPopCommand(["--json"]));
  expect(io.stdout()).toBe('{"ok":true,"created":true}\n' + listed + '{"ok":true,"index":0}\n');
  expect(io.stderr()).toBe("");
});

test("stash push with nothing to stash is created false", async () => {
  await inDir(repo, () => stashPushCommand(["--json"]));
  expect(io.stdout()).toBe('{"ok":true,"created":false}\n');
});

test("stash drop with no index is the usage envelope, exit 1", async () => {
  expect(await exitCodeOf(() => inDir(repo, () => stashDropCommand(["--json"])))).toBe(1);
  expect(io.stdout()).toBe('{"ok":false,"error":"usage: rt git stash drop <index> [--json]"}\n');
  expect(io.stderr()).toBe("");
});

test("stash pop with a bad index is the usage envelope, exit 1", async () => {
  expect(await exitCodeOf(() => inDir(repo, () => stashPopCommand(["x", "--json"])))).toBe(1);
  expect(io.stdout()).toBe('{"ok":false,"error":"usage: rt git stash pop [<index>] [--json]"}\n');
});

test("tag create, list and delete keep their envelopes", async () => {
  await inDir(repo, () => tagCreateCommand(["v0.0.1-sample", "--message", "sample tag", "--json"]));
  const listed = JSON.stringify({ ok: true, tags: await createGitClient(repo).tags() }) + "\n";
  await inDir(repo, () => tagListCommand(["--json"]));
  await inDir(repo, () => tagDeleteCommand(["v0.0.1-sample", "--json"]));
  expect(io.stdout()).toBe('{"ok":true,"name":"v0.0.1-sample","pushed":false}\n' + listed + '{"ok":true,"name":"v0.0.1-sample"}\n');
  expect(io.stderr()).toBe("");
});

test("a flag is never taken as a tag name", async () => {
  expect(await exitCodeOf(() => inDir(repo, () => tagCreateCommand(["-D", "--json"])))).toBe(1);
  expect(io.stdout()).toBe('{"ok":false,"error":"usage: rt git tag create <name> [--message <m>] [--at <sha>] [--push] [--json]"}\n');
});
```

`amend --json` and `undo --json` are pinned by `e2e/tests/git-verbs.test.ts` through the real binary (`amend --json amends staged content`, `undo --json on a single-commit repo refuses with initial`, `undo --json removes the last commit`); their ownership guard calls the forge and gitq, which a unit test must not. What a person reads when either is refused is pinned through `UNDO_REFUSED` (Step 3) and `refuseWith` (Task 3).

- [ ] **Step 2: Run the pins against today's code**

Run: `bun test commands/git/__tests__/mutate-json.test.ts`
Expected: PASS, all six, with `mutate.ts` unedited.

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/git-verbs.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing human tests**

Create `commands/git/__tests__/mutate.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as out from "../../../lib/ui/out.ts";
import { renderPlain } from "../../../lib/ui/out-plain.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { stashApplyCommand, stashBlocks, stashDropCommand, stashPopCommand, stashPushCommand, tagBlocks, tagCreateCommand, tagDeleteCommand, UNDO_REFUSED } from "../mutate.ts";
import { exitCodeOf, inDir, makeRepo, trapExit } from "./helpers.ts";

test("the stash list names each stash by its number, its branch and its message", () => {
  expect(
    renderPlain(
      stashBlocks([
        { index: 0, branch: "feature/login", message: "WIP on feature/login: wip sample" },
        { index: 1, branch: null, message: "older" },
      ]),
    ),
  ).toBe("stash 0  feature/login  WIP on feature/login: wip sample\nstash 1  detached HEAD  older\n");
  expect(renderPlain(stashBlocks([]))).toBe("[skipped] No stashes\n");
});

test("the tag list names each tag, its commit and whether it is annotated", () => {
  expect(
    renderPlain(
      tagBlocks([
        { name: "v1.2.3", sha: "aaaaaaaaaaaaaaaa", annotated: true, targetSha: "0123456789abcdef" },
        { name: "nightly", sha: "fedcba9876543210", annotated: false, targetSha: "fedcba9876543210" },
      ]),
    ),
  ).toBe("v1.2.3   01234567  annotated\nnightly  fedcba98\n");
  expect(renderPlain(tagBlocks([]))).toBe("[skipped] No tags\n");
});

test("every reason undo refuses is a refused note in plain words", () => {
  expect(renderPlain(UNDO_REFUSED.pushed)).toBe("[refused] The last commit is already pushed\n  why: Undoing it here would leave this branch behind origin.\n");
  expect(renderPlain(UNDO_REFUSED.initial)).toBe("[refused] This is the first commit, so there is nothing to go back to\n");
  expect(renderPlain(UNDO_REFUSED.merge)).toBe("[refused] The last commit is a merge, and rt does not undo merges\n");
});
let root: string;
let repo: string;
let io: CapturedOut;
let exit: { restore(): void };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-mutate-")));
  repo = makeRepo(root);
  io = captureOut({ console: true });
  out.__test__.setHuman(() => false);
  exit = trapExit();
});
afterEach(() => {
  exit.restore();
  io.restore();
  rmSync(root, { recursive: true, force: true });
});

test("stash push, apply, pop and drop each say what happened, on stdout", async () => {
  await inDir(repo, () => stashPushCommand([]));
  writeFileSync(join(repo, "a.txt"), "stash me\n");
  await inDir(repo, () => stashPushCommand([]));
  await inDir(repo, () => stashApplyCommand([]));
  await inDir(repo, () => stashDropCommand(["0"]));
  expect(io.stdout()).toBe(
    "[skipped] Nothing to stash\n" +
      "[ok] Stashed your changes\n" +
      "[ok] Brought back stash 0  it is still in the list\n" +
      "[ok] Deleted stash 0\n",
  );
  expect(io.stderr()).toBe("");
});

test("stash pop says the stash left the list", async () => {
  writeFileSync(join(repo, "a.txt"), "stash me\n");
  await inDir(repo, () => stashPushCommand([]));
  io.clear();
  await inDir(repo, () => stashPopCommand([]));
  expect(io.stdout()).toBe("[ok] Brought back stash 0  and removed it from the list\n");
});

test("a value flag with nothing after it asks for the value", async () => {
  expect(await exitCodeOf(() => inDir(repo, () => stashPushCommand(["--message"])))).toBe(1);
  expect(io.stderr()).toBe("That option needs a value after it\n  next: rt git stash push [--message <m>] [--include-untracked] [--json]\n");
  expect(io.stdout()).toBe("");
});

test("a stash index that is not a number is a usage failure on stderr, exit 1", async () => {
  expect(await exitCodeOf(() => inDir(repo, () => stashPopCommand(["x"])))).toBe(1);
  expect(io.stderr()).toBe("That is not a stash number\n  why: A stash is named by its number in the list, starting at 0.\n  next: rt git stash pop [<index>] [--json]\n");
  expect(io.stdout()).toBe("");
});

test("stash drop with no index off a terminal asks which stash", async () => {
  expect(await exitCodeOf(() => inDir(repo, () => stashDropCommand([])))).toBe(1);
  expect(io.stderr()).toBe("Which stash?\n  next: rt git stash drop <index> [--json]\n");
});

test("tag create and delete say what happened; a missing name asks for one", async () => {
  await inDir(repo, () => tagCreateCommand(["v0.0.1-sample"]));
  await inDir(repo, () => tagDeleteCommand(["v0.0.1-sample"]));
  expect(io.stdout()).toBe("[ok] Created tag v0.0.1-sample\n[ok] Deleted tag v0.0.1-sample  on this Mac only\n");
  expect(await exitCodeOf(() => inDir(repo, () => tagCreateCommand([])))).toBe(1);
  expect(io.stderr()).toBe("What should the tag be called?\n  next: rt git tag create <name> [--message <m>] [--at <sha>] [--push] [--json]\n");
});

test("a tag git will not delete fails with a plain title over git's words", async () => {
  expect(await exitCodeOf(() => inDir(repo, () => tagDeleteCommand(["no-such-tag"])))).toBe(1);
  expect(io.errLines()[0]).toBe("Could not delete that tag");
  expect(io.errLines().length).toBeGreaterThan(1);
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `bun test commands/git/__tests__/mutate.test.ts`
Expected: FAIL. `stashBlocks`, `tagBlocks` and `UNDO_REFUSED` are not exported from `../mutate.ts`.

- [ ] **Step 5: Replace `commands/git/mutate.ts`**

The whole file becomes:

```ts
import { createGitClient, type StashEntry, type TagInfo, type UndoRefusal, type UndoResult } from "../../packages/git-core/src/index.ts";
import { amendStaged } from "../../lib/commit-ops.ts";
import { checkBranchGuard } from "../../lib/branch-guard.ts";
import { createStackGuardRunners } from "../../lib/stack-guard.ts";
import { getRemoteDefaultBranch } from "../../lib/git-ops.ts";
import * as out from "../../lib/ui/out.ts";
import type { Block } from "../../lib/ui/protocol.ts";
import { execFileSync } from "node:child_process";
import { errText, failPlain, failUsage, readFlag, refuseWith } from "./shared.ts";

// Zero-commit repos have no HEAD for rev-parse to resolve; that's the
// mutation's own error to raise (git's real message), not the guard's.
function currentBranch(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

// The two warnings go through out.note: they fire under --json too, where
// stdout is the envelope.
async function guardHistoryRewrite(cwd: string, json: boolean): Promise<void> {
  const branch = currentBranch(cwd);
  if (branch === null) {
    out.note(out.line("warn", "rt could not tell which branch this is", "going ahead without the ownership check"));
    return;
  }
  const remoteDefault = getRemoteDefaultBranch(cwd, "origin", { preferRemote: true });
  const defaultBranch = remoteDefault ? remoteDefault.replace("origin/", "") : null;
  const runners = createStackGuardRunners(
    (await import("../../lib/setup/probes.ts")).createRealProbes(),
  );
  const verdict = await checkBranchGuard({ cwd, branch, defaultBranch, runners });
  if (verdict.verdict === "refuse") {
    refuseWith(json, `refused: ${verdict.detail}`, out.line("refused", "rt will not rewrite this branch's history"), out.callout("why", verdict.detail));
  }
  if (verdict.verdict === "unverified") {
    out.note(out.line("warn", "rt could not check who owns this branch", "going ahead"), out.callout("why", verdict.detail));
  }
}

export const UNDO_REFUSED: Record<UndoRefusal, Block[]> = {
  pushed: [out.line("refused", "The last commit is already pushed"), out.callout("why", "Undoing it here would leave this branch behind origin.")],
  initial: [out.line("refused", "This is the first commit, so there is nothing to go back to")],
  merge: [out.line("refused", "The last commit is a merge, and rt does not undo merges")],
};

export function stashBlocks(stashes: StashEntry[]): Block[] {
  if (stashes.length === 0) return [out.line("skipped", "No stashes")];
  return [out.table(stashes.map((s) => [out.dim(`stash ${s.index}`), out.key(s.branch ?? "detached HEAD"), s.message]))];
}

export function tagBlocks(tags: TagInfo[]): Block[] {
  if (tags.length === 0) return [out.line("skipped", "No tags")];
  return [out.table(tags.map((t) => (t.annotated ? [out.strong(t.name), out.dim(t.targetSha.slice(0, 8)), out.dim("annotated")] : [out.strong(t.name), out.dim(t.targetSha.slice(0, 8))])))];
}

export async function amendCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const noVerify = args.includes("--no-verify");
  const message = args.filter((a) => !a.startsWith("-")).join(" ") || undefined;
  const cwd = process.cwd();
  await guardHistoryRewrite(cwd, json);
  let summary: string;
  try {
    summary = amendStaged(cwd, { ...(message ? { message } : {}), noVerify });
  } catch (err) {
    failPlain(json, "Could not amend the last commit", errText(err));
  }
  if (json) out.json({ ok: true, summary });
  else out.print(out.line("done", "Amended the last commit", summary || undefined));
}

export async function undoCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const cwd = process.cwd();
  await guardHistoryRewrite(cwd, json);
  let result: UndoResult;
  try {
    result = await createGitClient(cwd).undoLastCommit();
  } catch (err) {
    failPlain(json, "Could not undo the last commit", errText(err));
  }
  if (!result.ok) refuseWith(json, `refused: ${result.reason}`, ...UNDO_REFUSED[result.reason]);
  if (json) out.json({ ok: true, undoneSha: result.undoneSha });
  else out.print(out.line("done", `Undid commit ${result.undoneSha.slice(0, 8)}`, "its changes are back in your working tree"));
}

const STASH_PUSH_USAGE = "usage: rt git stash push [--message <m>] [--include-untracked] [--json]";

export async function stashPushCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const includeUntracked = args.includes("--include-untracked");
  const message = readFlag(json, args, "--message", STASH_PUSH_USAGE);
  let created: boolean;
  try {
    ({ created } = await createGitClient(process.cwd()).stashPush({
      ...(message ? { message } : {}),
      ...(includeUntracked ? { includeUntracked: true } : {}),
    }));
  } catch (err) {
    failPlain(json, "Could not stash your changes", errText(err));
  }
  if (json) out.json({ ok: true, created });
  else out.print(created ? out.line("done", "Stashed your changes") : out.line("skipped", "Nothing to stash"));
}

export async function stashListCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  let stashes: StashEntry[];
  try {
    stashes = await createGitClient(process.cwd()).stashes();
  } catch (err) {
    failPlain(json, "Could not list the stashes", errText(err));
  }
  if (json) out.json({ ok: true, stashes });
  else out.print(...stashBlocks(stashes));
}

const NOT_A_STASH_NUMBER = "That is not a stash number";
const STASH_NUMBER_WHY = "A stash is named by its number in the list, starting at 0.";

function stashIndexArg(args: string[], json: boolean, usage: string): number {
  const raw = args.find((a) => !a.startsWith("-"));
  if (raw === undefined) return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) failUsage(json, NOT_A_STASH_NUMBER, usage, STASH_NUMBER_WHY);
  return n;
}

export async function stashPopCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const index = stashIndexArg(args, json, "usage: rt git stash pop [<index>] [--json]");
  try {
    await createGitClient(process.cwd()).stashPop(index);
  } catch (err) {
    failPlain(json, "Could not bring that stash back", errText(err));
  }
  if (json) out.json({ ok: true, index });
  else out.print(out.line("done", `Brought back stash ${index}`, "and removed it from the list"));
}

export async function stashApplyCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const index = stashIndexArg(args, json, "usage: rt git stash apply [<index>] [--json]");
  try {
    await createGitClient(process.cwd()).stashApply(index);
  } catch (err) {
    failPlain(json, "Could not bring that stash back", errText(err));
  }
  if (json) out.json({ ok: true, index });
  else out.print(out.line("done", `Brought back stash ${index}`, "it is still in the list"));
}

const STASH_DROP_USAGE = "usage: rt git stash drop <index> [--json]";

export async function stashDropCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const client = createGitClient(process.cwd());
  let raw = args.find((a) => !a.startsWith("-"));
  if (raw === undefined && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
    let stashes: StashEntry[];
    try {
      stashes = await client.stashes();
    } catch (err) {
      failPlain(json, "Could not list the stashes", errText(err));
    }
    if (stashes.length === 0) failUsage(json, "Which stash?", STASH_DROP_USAGE, "There are no stashes to pick from.");
    const { filterableSelect } = await import("../../lib/pick-wrappers.ts");
    const picked = await filterableSelect({
      message: "Drop which stash?",
      options: stashes.map((s) => ({ label: `stash@{${s.index}}: ${s.message}`, value: String(s.index) })),
    });
    if (picked === null) process.exit(0);
    raw = picked;
  }
  if (raw === undefined) failUsage(json, "Which stash?", STASH_DROP_USAGE);
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0) failUsage(json, NOT_A_STASH_NUMBER, STASH_DROP_USAGE, STASH_NUMBER_WHY);
  try {
    await client.stashDrop(index);
  } catch (err) {
    failPlain(json, "Could not delete that stash", errText(err));
  }
  if (json) out.json({ ok: true, index });
  else out.print(out.line("done", `Deleted stash ${index}`));
}

function firstPositional(args: string[], valueFlags: Set<string>): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (valueFlags.has(a)) { i++; continue; }
    if (a.startsWith("-")) continue;
    return a;
  }
  return undefined;
}

const TAGS_FAILED = "Could not list the tags";

export async function tagListCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  let tags: TagInfo[];
  try {
    tags = await createGitClient(process.cwd()).tags();
  } catch (err) {
    failPlain(json, TAGS_FAILED, errText(err));
  }
  if (json) out.json({ ok: true, tags });
  else out.print(...tagBlocks(tags));
}

const TAG_CREATE_USAGE = "usage: rt git tag create <name> [--message <m>] [--at <sha>] [--push] [--json]";

export async function tagCreateCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const push = args.includes("--push");
  const name = firstPositional(args, new Set(["--message", "--at"]));
  if (!name) failUsage(json, "What should the tag be called?", TAG_CREATE_USAGE);
  const message = readFlag(json, args, "--message", TAG_CREATE_USAGE);
  const at = readFlag(json, args, "--at", TAG_CREATE_USAGE);
  let pushed: boolean;
  try {
    const client = createGitClient(process.cwd());
    await client.createTag(name, { ...(message ? { message } : {}), ...(at ? { sha: at } : {}) });
    if (push) await client.pushTag(name);
    pushed = push;
  } catch (err) {
    failPlain(json, "Could not create that tag", errText(err));
  }
  if (json) out.json({ ok: true, name, pushed });
  else out.print(out.line("done", `Created tag ${name}`, pushed ? "and pushed it to origin" : undefined));
}

async function pickTagName(json: boolean, usage: string, action: "Delete" | "Push"): Promise<string> {
  const client = createGitClient(process.cwd());
  let tags: TagInfo[];
  try {
    tags = await client.tags();
  } catch (err) {
    failPlain(json, TAGS_FAILED, errText(err));
  }
  if (tags.length === 0) failUsage(json, "Which tag?", usage, "There are no tags to pick from.");
  const { filterableSelect } = await import("../../lib/pick-wrappers.ts");
  const picked = await filterableSelect({
    message: `${action} which tag?`,
    options: tags.map((t) => ({ label: t.name, value: t.name, hint: t.targetSha.slice(0, 8) })),
  });
  if (picked === null) process.exit(0);
  return picked;
}

const TAG_DELETE_USAGE = "usage: rt git tag delete <name> [--json]";

export async function tagDeleteCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  let name = firstPositional(args, new Set<string>());
  if (name === undefined && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
    name = await pickTagName(json, TAG_DELETE_USAGE, "Delete");
  }
  if (!name) failUsage(json, "Which tag?", TAG_DELETE_USAGE);
  try {
    await createGitClient(process.cwd()).deleteTag(name);
  } catch (err) {
    failPlain(json, "Could not delete that tag", errText(err));
  }
  if (json) out.json({ ok: true, name });
  else out.print(out.line("done", `Deleted tag ${name}`, "on this Mac only"));
}

const TAG_PUSH_USAGE = "usage: rt git tag push <name> [--remote <remote>] [--json]";

export async function tagPushCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  let name = firstPositional(args, new Set(["--remote"]));
  if (name === undefined && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
    name = await pickTagName(json, TAG_PUSH_USAGE, "Push");
  }
  if (!name) failUsage(json, "Which tag?", TAG_PUSH_USAGE);
  const remote = readFlag(json, args, "--remote", TAG_PUSH_USAGE) ?? "origin";
  try {
    await createGitClient(process.cwd()).pushTag(name, remote);
  } catch (err) {
    failPlain(json, "Could not push that tag", errText(err));
  }
  if (json) out.json({ ok: true, name, remote });
  else out.print(out.line("done", `Pushed tag ${name}`, `to ${remote}`));
}
```

What is unchanged on purpose: every picker call and its gate; the two picker messages (`Delete which tag?` and `Push which tag?` are what the old `verb.replace(...)` expression produced); every `--json` value, the `--message requires a value` style errors included (`readFlag` passes `flagValue`'s message through). `readFlag` now runs before the git client is made rather than inside the `try`, so a missing value is a usage failure for a person instead of sitting under `Could not stash your changes`.

The two refusals in this file (the ownership guard and the three undo reasons) go through `refuseWith`: a `[refused]` note on stderr, never `out.fail`, with exit 1 and the `refused: ...` `--json` string as before. The ownership guard's `detail` takes Task 12's words when that task lands; this task shows it as it is.

- [ ] **Step 6: Delete the allowlist line**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `  "commands/git/mutate.ts",`.

- [ ] **Step 7: Run the tests**

Run: `bun test commands/git/__tests__/mutate.test.ts commands/git/__tests__/mutate-json.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS, the six pins unchanged.

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/git-verbs.test.ts`
Expected: PASS. This is the `--json` check for `amend` and `undo`, the warning through `out.note` included: `amend --json on a zero-commit repo` passes only if that warning stays off stdout.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add commands/git/mutate.ts commands/git/__tests__/mutate.test.ts commands/git/__tests__/mutate-json.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "git: amend, undo, stash and tag print through the output layer

<the executing session's own Co-Authored-By line>"
```

---

### Task 6: `git backup`, `git restore` and `git credential`

**Files:**
- Modify: `commands/git/backup.ts`, `commands/git/credential.ts:35-39`
- Create: `commands/git/__tests__/backup.test.ts`
- Modify: `commands/git/__tests__/credential.test.ts` (append)
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `"commands/git/backup.ts",` and `"commands/git/credential.ts",`)

**Interfaces:**
- Consumes: `NOT_ON_A_BRANCH` (Task 3); `out.line`, `out.callout`, `out.print`, `out.fail`, `out.payload`; the helpers of Task 3.
- Produces: `gitCredentialCommand(args: string[], _ctx: unknown, deps?: GitCredentialDeps, readInput?: () => Promise<string>): Promise<void>` (two optional trailing parameters, so a test can answer without stdin or the real store). `backupCommand` and `restoreCommand` keep their signatures.

- [ ] **Step 1: Pin the credential payload before touching the file**

Append to `commands/git/__tests__/credential.test.ts`, after the last `describe` block, and add `import { gitCredentialCommand } from "../credential.ts";` (merge it into the existing import of `gitCredentialReply`) and `import { captureOut } from "../../../lib/ui/__tests__/capture-out.ts";`:

```ts
describe("rt git credential, as git reads it", () => {
  const deps = { confirmedHost: () => "git.example.test", lookupStored: async () => "tok_sample" };

  test("stdout is the reply byte for byte and stderr is empty", async () => {
    const io = captureOut();
    try {
      await gitCredentialCommand(["get"], {}, deps, async () => "protocol=https\nhost=git.example.test\n\n");
      expect(io.stdout()).toBe("username=x-access-token\npassword=tok_sample\n");
      expect(io.stderr()).toBe("");
    } finally {
      io.restore();
    }
  });

  test("an operation rt does not answer writes nothing at all", async () => {
    const io = captureOut();
    try {
      await gitCredentialCommand(["store"], {}, deps, async () => "protocol=https\nhost=git.example.test\n\n");
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe("");
    } finally {
      io.restore();
    }
  });
});
```

- [ ] **Step 2: Give the verb its two test seams, still writing raw**

In `commands/git/credential.ts`, replace `gitCredentialCommand` (lines 35 to 39) with:

```ts
export async function gitCredentialCommand(
  args: string[],
  _ctx: unknown,
  deps: GitCredentialDeps = REAL_DEPS,
  readInput: () => Promise<string> = () => Bun.stdin.text(),
): Promise<void> {
  const op = args.find((a) => !a.startsWith("--")) ?? "";
  const input = await readInput();
  process.stdout.write(await gitCredentialReply(op, input, deps));
}
```

Run: `bun test commands/git/__tests__/credential.test.ts`
Expected: PASS, the two new tests included. This is the pin: it passes while the file still writes to `process.stdout` itself.

- [ ] **Step 3: Write the failing backup tests**

Create `commands/git/__tests__/backup.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as out from "../../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { backupCommand, restoreCommand } from "../backup.ts";
import { ctxFor, exitCodeOf, git, makeRepo, trapExit } from "./helpers.ts";

let root: string;
let repo: string;
let io: CapturedOut;
let exit: { restore(): void };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-backup-")));
  repo = makeRepo(root);
  io = captureOut({ console: true });
  out.__test__.setHuman(() => false);
  exit = trapExit();
});
afterEach(() => {
  exit.restore();
  io.restore();
  rmSync(root, { recursive: true, force: true });
});

test("backup says which branch it saved and where, on stdout", async () => {
  await backupCommand([], ctxFor(repo));
  expect(io.stdout()).toMatch(/^\[ok\] Backed up main  rt-backup\/manual\/main\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\n$/);
  expect(io.stderr()).toBe("");
});

test("backup on a detached HEAD is a failure on stderr, exit 1", async () => {
  git(repo, "checkout", "-q", "--detach");
  expect(await exitCodeOf(() => backupCommand([], ctxFor(repo)))).toBe(1);
  expect(io.stderr()).toBe("You are not on a branch\n  why: This needs a branch, and HEAD is detached right now.\n");
  expect(io.stdout()).toBe("");
});

test("restore with no backups says there is nothing to restore, and that is not a failure", async () => {
  expect(await exitCodeOf(() => restoreCommand([], ctxFor(repo)))).toBeNull();
  expect(io.stdout()).toBe("[skipped] There are no backups to restore\n");
  expect(io.stderr()).toBe("");
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `bun test commands/git/__tests__/backup.test.ts`
Expected: FAIL. The first test receives the old line with its escapes and leading blank line; the second finds the old red text; the third the old dim text.

- [ ] **Step 5: Convert `commands/git/backup.ts`**

Replace the import block (lines 8 to 16) with:

```ts
import * as out from "../../lib/ui/out.ts";
import { getCurrentBranch } from "../../lib/git-ops.ts";
import { createBackup, listBackups, restoreFromBackup } from "../../lib/git-backup.ts";
import type { CommandContext } from "../../lib/command-tree.ts";
import { NOT_ON_A_BRANCH } from "./shared.ts";
```

Replace the body of `backupCommand` (from `const cwd` to its closing brace) with:

```ts
  const cwd = ctx.identity!.repoRoot;
  const branch = getCurrentBranch(cwd);

  if (!branch) {
    out.fail(NOT_ON_A_BRANCH);
    process.exit(1);
  }

  const backupRef = createBackup("manual", cwd);
  out.print(out.line("done", `Backed up ${branch}`, backupRef));
}
```

`formatAge` stays, apart from its first comment line, which holds a long dash: rewrite that one line as `// Timestamp is like "2026-04-09T00-27-40"; convert it back to a Date`.

Replace the body of `restoreCommand` (from `const cwd` to its closing brace) with:

```ts
  const cwd = ctx.identity!.repoRoot;
  const backups = listBackups(cwd);

  if (backups.length === 0) {
    out.print(out.line("skipped", "There are no backups to restore"));
    return;
  }

  const { filterableSelect } = await import("../../lib/pick-wrappers.ts");
  const { confirm: inkConfirm } = await import("../../lib/rt-render.ts");

  const selected = await filterableSelect({
    message: "Select a backup to restore",
    options: backups.map((b) => ({
      value: b.ref,
      label: `${b.originalBranch}`,
      hint: `${b.operation} · ${b.sha} · ${formatAge(b.timestamp)}`,
    })),
  });

  if (!selected) {
    out.print(out.line("skipped", "Nothing was restored"));
    return;
  }

  const backup = backups.find((b) => b.ref === selected)!;

  out.print(
    out.line("pending", `Restore ${backup.originalBranch} to ${backup.sha}`, `${backup.operation} backup from ${formatAge(backup.timestamp)}`),
    out.callout("note", "This throws away every change made since that backup."),
  );

  const ok = await inkConfirm({
    message: "Restore? (this does a hard reset)",
    initialValue: true,
  });

  if (!ok) {
    out.print(out.line("skipped", "Nothing was restored"));
    return;
  }

  restoreFromBackup(selected, cwd);
  out.print(out.line("done", `Restored ${backup.originalBranch}`, selected));
}
```

The picker and the confirm are today's calls, unchanged. Rewrite the two header comment lines at the top of the file (`rt git backup -- ...`, `rt git restore -- ...`) with a colon in place of each long dash, since the file is otherwise clean of them after this edit.

- [ ] **Step 6: Move the credential reply onto `out.payload`**

In `commands/git/credential.ts`, add after the last import:

```ts
import * as out from "../../lib/ui/out.ts";
```

and change the last line of `gitCredentialCommand` from `process.stdout.write(await gitCredentialReply(op, input, deps));` to:

```ts
  out.payload(await gitCredentialReply(op, input, deps));
```

- [ ] **Step 7: Delete the allowlist lines**

In `lib/__tests__/raw-output-allowlist.json`, delete the lines `  "commands/git/backup.ts",` and `  "commands/git/credential.ts",`.

- [ ] **Step 8: Run the tests**

Run: `bun test commands/git/__tests__/backup.test.ts commands/git/__tests__/credential.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS, the two credential pins of Step 1 unchanged.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add commands/git/backup.ts commands/git/credential.ts commands/git/__tests__/backup.test.ts commands/git/__tests__/credential.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "git: backup and restore print through the output layer; the credential reply is a payload

<the executing session's own Co-Authored-By line>"
```

---

### Task 7: `git pull`, `git push`, `git push force` and `git upstream`

None of these declares `--json`, so there is no envelope to pin. What must not change is what the child does with the terminal and the exit code rt leaves with.

**Files:**
- Modify: `commands/git/pull.ts`, `commands/git/push.ts`
- Create: `commands/git/__tests__/pull-push.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `"commands/git/pull.ts",` and `"commands/git/push.ts",`)

**Interfaces:**
- Consumes: `NOT_ON_A_BRANCH`, `uncommittedChanges`, `refusalNote` (Task 3); `out.note` (5a); `out.line`, `out.callout`, `out.copy`, `out.cmd`, `out.print`, `out.fail`; the helpers of Task 3.
- Produces: no new export. `pullCommand`, `pushCommand`, `forcePushCommand` and `upstreamCommand` keep their signatures and return values.

- [ ] **Step 1: Write the failing tests**

Create `commands/git/__tests__/pull-push.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as out from "../../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { pullCommand } from "../pull.ts";
import { pushCommand, forcePushCommand, upstreamCommand } from "../push.ts";
import { ctxFor, exitCodeOf, git, makeRepo, trapExit } from "./helpers.ts";

let root: string;
let repo: string;
let io: CapturedOut;
let exit: { restore(): void };

/** `repo` on a branch named feature, with a bare origin that has main only. */
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-pull-push-")));
  repo = makeRepo(root);
  const origin = join(root, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { stdio: "pipe" });
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "origin", "main");
  git(repo, "checkout", "-qb", "feature");
  io = captureOut({ console: true });
  out.__test__.setHuman(() => false);
  exit = trapExit();
});
afterEach(() => {
  exit.restore();
  io.restore();
  rmSync(root, { recursive: true, force: true });
});

test("a pull dry run names the branch and the remote, then the command to copy", async () => {
  await pullCommand(["--dry-run"], ctxFor(repo));
  expect(io.stdout()).toBe("[skipped] Would pull feature from origin  dry run\nthe command:\ngit -c rebase.backend=merge pull --ff --recurse-submodules --progress origin\n");
  expect(io.stderr()).toBe("");
});

test("a pull with uncommitted changes is refused on stderr, exit 1", async () => {
  writeFileSync(join(repo, "a.txt"), "edited\n");
  expect(await exitCodeOf(() => pullCommand([], ctxFor(repo)))).toBe(1);
  expect(io.stderr()).toBe("[refused] You have uncommitted changes\n  why: A pull could overwrite them.\n  next: Commit them, or set them aside with rt git stash push\n");
  expect(io.stdout()).toBe("");
});

test("a pull on a detached HEAD fails on stderr, exit 1", async () => {
  git(repo, "checkout", "-q", "--detach");
  expect(await exitCodeOf(() => pullCommand([], ctxFor(repo)))).toBe(1);
  expect(io.stderr()).toBe("You are not on a branch\n  why: This needs a branch, and HEAD is detached right now.\n");
});

test("upstream says what it would do, does it, then says it is already right", async () => {
  await upstreamCommand(["--dry-run"], ctxFor(repo));
  await upstreamCommand([], ctxFor(repo));
  await upstreamCommand([], ctxFor(repo));
  expect(io.stdout()).toBe(
    "[skipped] Would point feature at origin/feature  it tracks nothing now\n" +
      "[ok] feature now tracks origin/feature  it tracked nothing\n" +
      "[ok] feature already tracks origin/feature\n",
  );
  expect(io.stderr()).toBe("");
});

test("a push dry run names where it would go, the upstream it would fix, and the command", async () => {
  expect(await pushCommand(["--dry-run"], ctxFor(repo))).toBe(true);
  expect(io.stdout()).toBe(
    "[skipped] Would push feature to origin/feature  dry run\n" +
      "  note: This branch tracks nothing. A real push points it at origin/feature.\n" +
      "the command:\n" +
      "git push -u origin feature\n",
  );
});

test("a forced dry run says so and shows the lease flag in the command", async () => {
  await forcePushCommand(["--dry-run"], ctxFor(repo));
  expect(io.lines()[0]).toBe("[skipped] Would push feature to origin/feature  dry run, forcing with a lease");
  expect(io.lines().at(-1)).toBe("git push --force-with-lease -u origin feature");
});

test("off a terminal a diverged branch fails with the command to run, exit 1", async () => {
  git(repo, "push", "-q", "-u", "origin", "feature");
  git(repo, "commit", "-q", "--amend", "-m", "first commit, reworded");
  expect(await exitCodeOf(() => pushCommand([], ctxFor(repo)))).toBe(1);
  expect(io.stderr()).toBe(
    "feature and origin/feature have diverged\n" +
      "  why: This usually follows a rebase or an amend, and a plain push would be rejected.\n" +
      "  next: rt git push force\n",
  );
  expect(io.stdout()).toBe("");
});
```

No test runs a real pull or push: the child is given the terminal, so its output would land on the test runner's own.

The uncommitted-changes check is rt's own guard (git would run a merge pull on a dirty tree), so it is a refused note. A detached HEAD and a diverged branch off a terminal are states the verb cannot get past, so they stay failures through `out.fail` (Decision 12).

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/git/__tests__/pull-push.test.ts`
Expected: FAIL, every test: the old text carries escapes, leading blank lines and the old words.

- [ ] **Step 3: Convert `commands/git/pull.ts`**

Replace the tui import (line 13) with:

```ts
import * as out from "../../lib/ui/out.ts";
```

and add under the `CommandContext` import:

```ts
import { NOT_ON_A_BRANCH, refusalNote, uncommittedChanges } from "./shared.ts";
```

Replace the body of `pullCommand` from `const branch = getCurrentBranch(cwd);` to the function's closing brace with:

```ts
  const branch = getCurrentBranch(cwd);
  if (!branch) {
    out.fail(NOT_ON_A_BRANCH);
    process.exit(1);
  }

  if (hasUncommittedChanges(cwd)) {
    out.note(...refusalNote(uncommittedChanges("A pull could overwrite them.")));
    process.exit(1);
  }

  const remote = argValue(args, "--remote") ?? "origin";
  const dryRun = args.includes("--dry-run");
  const noVerify = args.includes("--no-verify");
  const forceRebase = args.includes("--rebase");
  const forceNoRebase = args.includes("--no-rebase");

  const gitArgs: string[] = ["-c", "rebase.backend=merge", "pull"];

  if (!hasPullFfConfig(cwd)) gitArgs.push("--ff");
  if (forceRebase) gitArgs.push("--rebase");
  if (forceNoRebase) gitArgs.push("--no-rebase");
  gitArgs.push("--recurse-submodules", "--progress");
  if (noVerify) gitArgs.push("--no-verify");
  gitArgs.push(remote);

  if (dryRun) {
    out.print(out.line("skipped", `Would pull ${branch} from ${remote}`, "dry run"), out.copy(`git ${gitArgs.join(" ")}`, "the command"));
    return;
  }

  out.print(out.line("running", `Pulling ${branch} from ${remote}`));
  const r = spawnSync("git", gitArgs, { cwd, stdio: "inherit" });
  if (r.status === 0) {
    out.print(out.line("done", `Pulled ${branch}`, `from ${remote}`));
    return;
  }

  process.exit(r.status ?? 1);
}
```

In the file's header comment, the first line holds a long dash: rewrite it as ` * rt git pull: mirror of GitHub Desktop's "Pull origin" button.`

- [ ] **Step 4: Convert `commands/git/push.ts`**

Replace the tui import (line 16) with `import * as out from "../../lib/ui/out.ts";` and add under the `CommandContext` import:

```ts
import { NOT_ON_A_BRANCH } from "./shared.ts";
```

Replace `labelUpstream` (lines 52 to 55) with:

```ts
function labelUpstream(u: UpstreamConfig | null): string {
  if (!u) return "nothing";
  return `${u.remote}/${u.merge.replace(/^refs\/heads\//, "")}`;
}
```

Replace the body of `upstreamCommand` from `const branch = getCurrentBranch(cwd);` to its closing brace with:

```ts
  const branch = getCurrentBranch(cwd);
  if (!branch) {
    out.fail(NOT_ON_A_BRANCH);
    process.exit(1);
  }

  const current = getUpstreamConfig(branch, cwd);
  const wanted = `${remote}/${branch}`;

  if (isUpstreamCorrect(current, branch, remote)) {
    out.print(out.line("done", `${branch} already tracks ${wanted}`));
    return;
  }

  if (dryRun) {
    out.print(out.line("skipped", `Would point ${branch} at ${wanted}`, `it tracks ${labelUpstream(current)} now`));
    return;
  }

  setUpstreamConfig(branch, remote, cwd);
  out.print(out.line("done", `${branch} now tracks ${wanted}`, `it tracked ${labelUpstream(current)}`));
}
```

In `runPush`, make four edits and leave the `select` call between them exactly as it is (its `message` and `options` are an rt-ui surface):

1. The detached check (lines 146 to 149) becomes:

```ts
  if (!branch) {
    out.fail(NOT_ON_A_BRANCH);
    process.exit(1);
  }
```

2. Inside `if (choice !== "force")` (line 168), `console.log(...)` becomes:

```ts
          out.print(out.line("skipped", "Nothing was pushed"));
```

3. The `else` branch for a diverged branch off a terminal (lines 172 to 176) becomes:

```ts
      } else {
        out.fail({
          title: `${branch} and ${remote}/${branch} have diverged`,
          why: "This usually follows a rebase or an amend, and a plain push would be rejected.",
          next: out.cmd("rt git push force"),
        });
        process.exit(1);
      }
```

4. Everything from `const label = opts.force ? ...` (line 188) to the end of the function becomes:

```ts
  const gitArgs: string[] = ["push"];
  if (force) gitArgs.push("--force-with-lease");
  if (noVerify) gitArgs.push("--no-verify");
  gitArgs.push("-u", remote, branch);

  const target = `${remote}/${branch}`;

  if (dryRun) {
    out.print(
      out.line("skipped", `Would push ${branch} to ${target}`, force ? "dry run, forcing with a lease" : "dry run"),
      ...(upstreamWasWrong ? [out.callout("note", `This branch tracks ${labelUpstream(current)}. A real push points it at ${target}.`)] : []),
      out.copy(`git ${gitArgs.join(" ")}`, "the command"),
    );
    return true;
  }

  out.print(
    out.line("running", `Pushing ${branch} to ${target}`, force ? "forcing, with a lease" : undefined),
    ...(upstreamWasWrong ? [out.callout("note", `This branch tracked ${labelUpstream(current)}. It now tracks ${target}.`)] : []),
  );

  const r = spawnSync("git", gitArgs, { cwd, stdio: "inherit" });
  if (r.status === 0) {
    out.print(out.line("done", `Pushed ${branch}`, `to ${target}`));
    return true;
  }
  process.exit(r.status ?? 1);
}
```

The file's header comment (lines 1 to 13) holds four long dashes. Rewrite those lines so `rg -n "\x{2014}|\x{2013}" commands/git/push.ts` shows only the `select` message at line 161, which this slice does not edit:

```ts
/**
 * rt git push         Push the current branch, guaranteeing upstream is
 *                     origin/<branch>. Detects post-rebase divergence and
 *                     points the user at `rt git push force`.
 * rt git push force   Same, with --force-with-lease (for rebased or amended
 *                     branches). Plain --force is intentionally unsupported.
 * rt git upstream     Fix branch.<name>.remote and .merge without pushing.
 *
 * Fixes the common "new feature branch tracks origin/master" issue by
 * rewriting the tracking config before the push and using an explicit
 * `git push -u origin <branch>` refspec, so a stale upstream cannot
 * misdirect the push.
 */
```

The two section-rule comments (`// ─── rt git upstream ───`, `// ─── rt git push ───`) use box-drawing characters, not dashes, and stay.

- [ ] **Step 5: Delete the allowlist lines**

In `lib/__tests__/raw-output-allowlist.json`, delete the lines `  "commands/git/pull.ts",` and `  "commands/git/push.ts",`.

- [ ] **Step 6: Run the tests**

Run: `bun test commands/git/__tests__/pull-push.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add commands/git/pull.ts commands/git/push.ts commands/git/__tests__/pull-push.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "git: pull, push and upstream print through the output layer

<the executing session's own Co-Authored-By line>"
```

- [ ] **Step 8: Measure, and take the second cut if this slice is on track past 2,500 lines**

Run: `git diff --shortstat origin/main...HEAD`
Expected: one line, `N files changed, I insertions(+), D deletions(-)` (the three-dot form counts only this branch's commits, whatever main gained since).

Tasks 3 to 7 are about 45 percent of this slice's code, and the whole slice is estimated at about 3,000 changed lines, so the split is the expected path. If `I + D` is over 1,100 here, the slice is on track to pass ruling 8's 2,500: take the scoping document's second cut and say so in the report. If it is 1,100 or less, go on with Task 8 on this branch as one PR and skip both lists below.

**5b part 1 (this branch): Tasks 3 to 7, then Tasks 14 and 15 adjusted as follows.**

- Task 14 Step 1: the first three searches expect what they say. The fourth (old guard wording) also hits `lib/stack-guard.ts`, `lib/branch-guard.ts` and the two rebase-worktree `SKILL.md` rows: expected, they are part 2's Task 12, not a missed reader.
- Task 14 Step 2: `blocks.ts` keeps the `git` and `diff` sets only. Drop the `sync` set, its fixtures (`backup`, `bundle`, `summary`, `stacked`, `searchFailure`, `search`) and the imports of `conflictFailure`, `manualReport`, `branchEnding`, `refusalBlocks` and `syncAllBlocks`; the module for each of those does not have it yet.
- Task 14 Steps 3 to 5: render four pages (`git` and `diff`, dark and light) and add the first two README rows.
- Task 14 Step 6: append only the first two sentences of the first paragraph (`failPlain` and `failUsage`, then the refusal sentence with "a stack member under `rt sync`" left out of its list).
- Task 15 Step 1: the allowlist search expects four lines still listed, `commands/git/rebase.ts`, `commands/git/reset.ts`, `commands/sync.ts` and `lib/rebase-escalation.ts`. The `steps.log` search expects the three calls in `commands/sync.ts` (lines 202, 231 and 234 at `5bc69f231`). Run the `[failed]` and `[refused]` greps over `commands/git` alone; the other test files are part 2's.
- Task 15 Step 4: title `RT-369: output layer phase 5b, git and sync (part 1)`. The body keeps the **Git verbs** group (without `git rebase` and `git reset`, which are part 2), an **Also** with the value-flag usage failure, and a **Follow-up** naming part 2 and what it carries. It drops the **Sync**, **Guards** and **Steps** groups, and the two `--json` stdout bullets.

**5b part 2 (a new branch from main once part 1 merges): Tasks 8 to 13, then Tasks 14 and 15 adjusted as follows.**

- Task 14 Step 1: all four searches as written.
- Task 14 Step 2: `blocks.ts` keeps the `sync` set only, with its fixtures and imports; drop the `git` and `diff` sets and the imports only they use (`branchesBlocks`, `diffBlocks`, `logBlocks`, `statusBlocks`, `stashBlocks`, `tagBlocks`, `UNDO_REFUSED`, `usageFailure`, `NOT_ON_A_BRANCH`).
- Task 14 Steps 3 to 5: render two pages (`sync`, dark and light) and add the third README row.
- Task 14 Step 6: add "a stack member under `rt sync`" back to the refusal sentence, then append the rest (the sentences about the API under `rt sync`, then the second and third paragraphs).
- Task 15 Step 1: the allowlist and `steps.log` searches expect nothing, as written.
- Task 15 Step 4: title `RT-369: output layer phase 5b, git and sync (part 2)`. The body keeps **Sync** (with `git rebase` and `git reset`), **Guards**, **Steps**, **Also** and **Follow-up**, and drops the **Git verbs** group.

Task 12 goes in part 2, beside `rt sync`, whose hint its skill rows read and whose Task 13 tests pin the new words; until it lands, part 1's amend and undo show the ownership detail in today's words under the new `refused` note.

---

### Task 8: `lib/ui/steps.ts` stops printing by hand

Scoping item 3. `lib/ui/` is exempt from the guard, so nothing but this task and its tests keeps the file honest.

**Files:**
- Modify: `lib/ui/steps.ts` (whole file)
- Modify: `lib/ui/__tests__/steps.test.ts`
- Modify: `commands/sync.ts:202`, `:231`, `:234` (the three `steps.log` callers; the file stays on the allowlist until Task 13)

**Interfaces:**
- Consumes: `out.print`, `out.note` (5a), `out.line`, `out.callout`, `out.payloadOnStdout`, `out.__test__`; `logCliEvent(level, module, message, context?)` (`lib/cli-logger.ts`); `openStep`, `StepHandle` (`lib/ui/spawn.ts`); `interactive` (`lib/ui/gate.ts`); `captureOut()`.
- Produces: `StepRunner` with one member, `run<T>(pending, task, opts?)`, unchanged in signature. `StepRunner.log` is removed. `createStepRunner()`, `withSpinner(label, task, opts?)` and the `__test__` re-export are unchanged. Off a terminal a step's ending is `out.print(out.line("done" | "failed", title, hint))`, so it follows `payloadOnStdout`.

- [ ] **Step 1: Rewrite the tests that pin the old lines**

In `lib/ui/__tests__/steps.test.ts`:

Replace the import lines 5 to 7 with:

```ts
import { createStepRunner, withSpinner, __test__ } from "../steps.ts";
import * as layer from "../out.ts";
import { captureOut, type CapturedOut } from "./capture-out.ts";
import { openStep, type StepHandle } from "../spawn.ts";
```

Replace the declarations `let out: string[];` and `const realWrite = process.stdout.write;` with `let io: CapturedOut;`.

In `beforeEach`, replace the two lines that set `out = [];` and patch `process.stdout.write` with:

```ts
  io = captureOut();
  layer.__test__.setHuman(() => false);
```

In `afterEach`, replace `process.stdout.write = realWrite;` with `io.restore();`.

Delete the test `log between steps prints a palette-colored line to stdout and spawns nothing`.

Replace the test `with the gate closed nothing is spawned and the plain final line is printed` with:

```ts
test("with the gate closed nothing is spawned and the final line prints through the layer", async () => {
  __test__.setInteractive(undefined);
  process.env.RT_BATCH = "1";
  try {
    const steps = createStepRunner();
    await steps.run("Fetching from origin…", async () => 1, { done: "Fetched from origin", doneHint: "3 new commits" });
  } finally {
    delete process.env.RT_BATCH;
  }
  expect(() => readFileSync(record)).toThrow();
  expect(io.stdout()).toBe("[ok] Fetched from origin  3 new commits\n");
  expect(io.stderr()).toBe("");
});

test("off a terminal a step that throws prints a failed line and rethrows", async () => {
  __test__.setInteractive(() => false);
  const steps = createStepRunner();
  await expect(steps.run("Pushing…", async () => { throw new Error("rejected\nby the remote"); }, { error: "Could not push" })).rejects.toThrow("rejected");
  expect(io.stdout()).toBe("[failed] Could not push  rejected by the remote\n");
});

test("under a payload verb the step's plain line goes to stderr", async () => {
  __test__.setInteractive(() => false);
  layer.payloadOnStdout();
  await createStepRunner().run("Fetching from origin…", async () => 1, { done: "Fetched from origin" });
  expect(io.stdout()).toBe("");
  expect(io.stderr()).toBe("[ok] Fetched from origin\n");
});

test("the step lines carry no escape of their own", async () => {
  __test__.setInteractive(() => false);
  await createStepRunner().run("Fetching from origin…", async () => 1, { done: "Fetched from origin" });
  expect(io.stdout()).not.toContain("\x1b[");
});
```

Replace the test `an unspawnable helper costs the spinner, not the work` with:

```ts
test("an unspawnable helper costs the spinner, not the work", async () => {
  process.env.RT_UI_BIN = join(dir, "does-not-exist", "rt-ui");
  let ran = false;
  const steps = createStepRunner();
  const r = await steps.run("Fetching from origin…", async () => { ran = true; return 42; }, { done: "Fetched from origin" });
  expect(r).toBe(42);
  expect(ran).toBe(true);
  expect(io.stdout()).toBe("[ok] Fetched from origin\n");
  expect(io.stderr()).toBe("[warning] rt could not draw a progress line  results still print\n");
});
```

Replace the test `when the child dies mid-step the plain final line is printed and a warning is shown` with:

```ts
test("when the child dies mid-step the final line still prints, with one warning", async () => {
  process.env.RT_UI_FAKE = JSON.stringify({ dieOn: "start" });
  const steps = createStepRunner();
  const r = await steps.run("Pushing…", async () => { await Bun.sleep(150); return "ok"; }, { done: "Pushed" });
  expect(r).toBe("ok");
  expect(io.stdout()).toBe("[ok] Pushed\n");
  expect(io.stderr()).toBe("[warning] rt could not draw a progress line  results still print\n");
});
```

In the test `off a terminal the sub callback is a no-op and the final line still prints`, replace its two `expect(out.join(""))` lines with:

```ts
  expect(io.stdout()).toBe("[ok] connected\n");
```

Add at the end of the file:

```ts
test("the runner has no log of its own: a line between steps is out.print", () => {
  expect(Object.keys(createStepRunner())).toEqual(["run"]);
});
```

The other tests (`run streams start/done ...`, `run streams fail ...`, `done title defaults ...`, `withSpinner maps ...`, `the real gate is closed ...`, `run hands the task a sub callback ...`, `a step can end in a status other than done`, `done takes every status but failed ...`) do not read `out` and stay as they are.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/ui/__tests__/steps.test.ts`
Expected: FAIL. The plain line is `  ✓ Fetched from origin  3 new commits` with escapes, the warning is the old `rt-ui ...; printed plainly` text, a step line under `payloadOnStdout` still lands on stdout, and the runner still has `log`.

- [ ] **Step 3: Replace `lib/ui/steps.ts`**

The whole file becomes:

```ts
/**
 * Step runner: one rt-ui spawn per step so nothing is alive between steps.
 * Off a TTY (agents, pipes, RT_BATCH) nothing is spawned and the step's
 * final line goes through out.print, so every non-interactive path keeps
 * its output and a payload verb keeps its stdout.
 */
import { logCliEvent } from "../cli-logger.ts";
import { interactive } from "./gate.ts";
import * as out from "./out.ts";
import { openStep, type StepHandle } from "./spawn.ts";

export { __test__ } from "./gate.ts";

export interface StepRunner {
  /** Run an async step with spinner then done/error transition. */
  run<T>(
    pending: string,
    task: (step: { sub(text: string): void }) => Promise<T>,
    opts?: { done?: string; doneHint?: string; error?: string; errorHint?: string },
  ): Promise<T>;
}

function stripEllipsis(s: string): string {
  return s.replace(/…$/, "");
}

function plain(status: "done" | "failed", title: string, hint?: string): void {
  out.print(out.line(status, title, hint));
}

// A dead helper must never cost the person the result line: the caller
// prints it through the layer, and this says once per step that the
// progress line was lost. The reason goes to the log, not the screen.
function helperFailed(why: string): void {
  logCliEvent("warn", "rt-ui", `rt-ui steps ${why}; printed plain text instead`);
  out.note(out.line("warn", "rt could not draw a progress line", "results still print"));
}

// The helper only narrates a step, so nothing about it may reach the caller as
// a failure: an unresolvable or unspawnable rt-ui leaves no handle, and the
// task then runs and reports itself on the plain path.
function tryOpenStep(pending: string): StepHandle | null {
  try {
    return openStep(pending);
  } catch (e) {
    helperFailed(`could not start: ${(e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").trim()}`);
    return null;
  }
}

export function createStepRunner(): StepRunner {
  return {
    async run<T>(
      pending: string,
      task: (step: { sub(text: string): void }) => Promise<T>,
      opts?: { done?: string; doneHint?: string; error?: string; errorHint?: string },
    ) {
      const step: StepHandle | null = interactive() ? tryOpenStep(pending) : null;
      try {
        const r = await task({ sub: (text) => step?.sub(text) });
        const title = opts?.done ?? stripEllipsis(pending);
        if (!step) {
          plain("done", title, opts?.doneHint);
        } else if (!(await step.done(title, opts?.doneHint))) {
          plain("done", title, opts?.doneHint);
          helperFailed("exited before the step finished");
        }
        return r;
      } catch (e) {
        const hint = opts?.errorHint ?? (e instanceof Error ? e.message : undefined);
        const title = opts?.error ?? `${stripEllipsis(pending)} failed`;
        if (!step) {
          plain("failed", title, hint);
        } else if (!(await step.fail(title, hint))) {
          plain("failed", title, hint);
          helperFailed("exited before the step finished");
        }
        throw e;
      }
    },
  };
}

/** Legacy wrapper; use createStepRunner() for new code. */
export async function withSpinner<T>(
  label: string,
  task: () => Promise<T>,
  opts?: { doneLabel?: string; failLabel?: string },
): Promise<T> {
  return createStepRunner().run(label, task, { done: opts?.doneLabel, error: opts?.failLabel });
}
```

- [ ] **Step 4: Move the three `steps.log` callers in `commands/sync.ts` onto `out.print`**

Add to the imports of `commands/sync.ts`, under the tui import (which stays until Task 13):

```ts
import * as out from "../lib/ui/out.ts";
```

Replace lines 201 to 203 (the `if (stack.verdict === "unverified" && !opts.quiet)` block) with:

```ts
  if (stack.verdict === "unverified" && !opts.quiet) {
    out.print(out.line("warn", "rt could not check whether this branch is part of a stack", "syncing anyway"), out.callout("why", stack.refusal.hint));
  }
```

Replace line 231 (`if (!opts.quiet) steps.log(...)`) with:

```ts
    if (!opts.quiet) out.print(out.line("warn", `${branch} and origin/${branch} have diverged`, "matching origin first"));
```

Replace line 234 (`steps.log(...)` under `if (opts.dryRun)`) with:

```ts
      out.print(out.line("skipped", `Would reset ${branch} to origin/${branch}`));
```

Do not delete `commands/sync.ts` from the allowlist: it still prints raw elsewhere, and the guard fails a listed file that has stopped.

- [ ] **Step 5: Run the tests and the guards**

Run: `bun test lib/ui/__tests__/steps.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts commands/__tests__/sync-stack-guard.test.ts`
Expected: PASS.

Run: `rg -n "tui/palette|x1b|process\.std" lib/ui/steps.ts`
Expected: no hits.

Run: `bun run typecheck`
Expected: no errors. A `steps.log` call left anywhere fails here.

- [ ] **Step 6: Commit**

```bash
git add lib/ui/steps.ts lib/ui/__tests__/steps.test.ts commands/sync.ts
```

```bash
git commit -m "lib/ui: the step runner prints its plain lines through the output layer

<the executing session's own Co-Authored-By line>"
```

---

### Task 9: `git rebase` and `git rebase onto`

**Files:**
- Modify: `commands/git/rebase.ts`
- Create: `commands/git/__tests__/rebase-output.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `"commands/git/rebase.ts",`)

**Interfaces:**
- Consumes: `asError`, `asRefusal`, `drawFailure`, `NOT_ON_A_BRANCH`, `uncommittedChanges`, `plural`, `errText` (Task 3); `usageFailure` (5a); the step runner of Task 8 through `withSpinner`; `out.print`, `out.fail`, `out.line`, `out.callout`, `out.table`, `out.payloadOnStdout`; `runEscalationFlow`, `resolveEscalationMode` (`lib/rebase-escalation.ts`, unchanged until Task 11).
- Produces, in `commands/git/rebase.ts`:
  - `RebaseResult` gains `failure?: out.FailureInput`: set with `error` when `status` is `"error"` (`error` is its title), and set alone when `status` is `"conflict"` and the rebase was undone. It also gains `refused?: boolean`, true only for the uncommitted-changes guard, so a caller draws that failure with `drawFailure(failure, refused)` as a refused note.
  - `export function conflictFailure(result: Pick<RebaseResult, "unresolvedFiles" | "backupBranch">): out.FailureInput`.
  - `rebaseOnto` prints on stdout through `out.print` when `quiet` is not set, and never prints a failure: the caller does.
  - Tasks 10 and 13 rely on `failure`; Task 13 on `conflictFailure`.

The `--json` output of this verb is the conflict bundle, which `lib/rebase-escalation.ts` writes; Task 11 pins it. What this task pins for `--json` is that stdout holds nothing else.

- [ ] **Step 1: Write the failing tests**

Create `commands/git/__tests__/rebase-output.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as out from "../../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { conflictFailure, ontoCommand, rebaseCommand, rebaseOnto } from "../rebase.ts";
import { ctxFor, exitCodeOf, git, makeRepo, trapExit } from "./helpers.ts";

let root: string;
let io: CapturedOut;
let exit: { restore(): void };
let savedSyncLogPath: string | undefined;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-rebase-out-")));
  savedSyncLogPath = process.env.RT_SYNC_LOG_PATH;
  process.env.RT_SYNC_LOG_PATH = join(root, "sync.log");
  io = captureOut({ console: true });
  out.__test__.setHuman(() => false);
  exit = trapExit();
});
afterEach(() => {
  exit.restore();
  io.restore();
  if (savedSyncLogPath === undefined) delete process.env.RT_SYNC_LOG_PATH;
  else process.env.RT_SYNC_LOG_PATH = savedSyncLogPath;
  rmSync(root, { recursive: true, force: true });
});

/** `feature` and `main` both rewrite a.txt, so the rebase cannot resolve by itself. */
function conflictRepo(): string {
  const repo = makeRepo(root);
  git(repo, "checkout", "-qb", "feature");
  writeFileSync(join(repo, "a.txt"), "feature change\n");
  git(repo, "commit", "-qam", "feature edit");
  git(repo, "checkout", "-q", "main");
  writeFileSync(join(repo, "a.txt"), "main change\n");
  git(repo, "commit", "-qam", "main edit");
  git(repo, "checkout", "-q", "feature");
  return repo;
}

/** `feature` adds its own file, so it rebases onto the moved `main` cleanly. */
function cleanRepo(): string {
  const repo = makeRepo(root);
  git(repo, "checkout", "-qb", "feature");
  writeFileSync(join(repo, "f.txt"), "feature\n");
  git(repo, "add", "f.txt");
  git(repo, "commit", "-qm", "feature file");
  git(repo, "checkout", "-q", "main");
  writeFileSync(join(repo, "m.txt"), "main\n");
  git(repo, "add", "m.txt");
  git(repo, "commit", "-qm", "main file");
  git(repo, "checkout", "-q", "feature");
  return repo;
}

test("a clean rebase says it saved a backup, what it is doing, and that it worked, on stdout", async () => {
  const repo = cleanRepo();
  const result = await rebaseOnto({ cwd: repo, target: "main", skipFetch: true, autoResolve: [] });
  expect(result.status).toBe("ok");
  expect(io.lines()[0]).toMatch(/^\[ok\] Saved a backup  rt-backup\/rebase\/feature\//);
  expect(io.lines().slice(1)).toEqual(["[running] Rebasing feature onto main  1 commit behind", "[ok] Rebased feature onto main"]);
  expect(io.stderr()).toBe("");
});

test("a paused conflict asks for the person and lists the files", async () => {
  const repo = conflictRepo();
  const result = await rebaseOnto({ cwd: repo, target: "main", skipFetch: true, autoResolve: [], onConflict: "pause" });
  expect(result.rebaseInProgress).toBe(true);
  expect(io.lines().slice(2)).toEqual(["[needs you] 1 file has conflicts rt cannot resolve  the rebase is paused", "a.txt"]);
  expect(io.stderr()).toBe("");
});

test("an undone conflict prints nothing of its own and hands the caller the failure", async () => {
  const repo = conflictRepo();
  const result = await rebaseOnto({ cwd: repo, target: "main", skipFetch: true, autoResolve: [] });
  expect(result.status).toBe("conflict");
  expect(result.error).toBeUndefined();
  expect(io.lines()).toHaveLength(2);
  expect(io.stderr()).toBe("");
  expect(result.failure?.title).toBe("The rebase stopped on conflicts in 1 file");
  expect(result.failure?.why).toBe("rt put the branch back the way it was.");
  expect(result.failure?.details).toMatch(/^a\.txt\nA backup is at rt-backup\/rebase\/feature\//);
});

test("conflictFailure counts the files and leaves the backup line out when there is none", () => {
  expect(conflictFailure({ unresolvedFiles: ["a.ts", "b.ts"], backupBranch: null })).toEqual({
    title: "The rebase stopped on conflicts in 2 files",
    why: "rt put the branch back the way it was.",
    details: "a.ts\nb.ts",
  });
});

test("quiet prints nothing on either stream", async () => {
  const repo = cleanRepo();
  await rebaseOnto({ cwd: repo, target: "main", skipFetch: true, autoResolve: [], quiet: true });
  expect(io.stdout()).toBe("");
  expect(io.stderr()).toBe("");
});

test("a dry run and an up-to-date branch each take one line", async () => {
  const repo = cleanRepo();
  git(repo, "branch", "old-main", "HEAD~1");
  await rebaseOnto({ cwd: repo, target: "main", skipFetch: true, autoResolve: [], dryRun: true });
  await rebaseOnto({ cwd: repo, target: "old-main", skipFetch: true, autoResolve: [] });
  expect(io.stdout()).toBe("[skipped] Would rebase feature onto main  1 commit behind\n[ok] feature is up to date with old-main\n");
});

test("rebasing the target branch onto itself is skipped in one line", async () => {
  const repo = cleanRepo();
  await rebaseOnto({ cwd: repo, target: "feature", skipFetch: true, autoResolve: [] });
  expect(io.stdout()).toBe("[skipped] feature is the default branch  nothing to rebase\n");
});

test("uncommitted changes come back as an error with a failure to print", async () => {
  const repo = cleanRepo();
  writeFileSync(join(repo, "f.txt"), "edited\n");
  const result = await rebaseOnto({ cwd: repo, target: "main", skipFetch: true });
  expect(result.status).toBe("error");
  expect(result.error).toBe("You have uncommitted changes");
  expect(result.failure?.why).toBe("A rebase that hits a conflict would lose them.");
  expect(result.refused).toBe(true);
  expect(io.stdout()).toBe("");
});

test("rebase onto with no branch off a terminal asks which branch, exit 1", async () => {
  const repo = cleanRepo();
  expect(await exitCodeOf(() => ontoCommand([], ctxFor(repo)))).toBe(1);
  expect(io.stderr()).toBe("Which branch?\n  why: This needs the branch to rebase onto.\n  next: rt git rebase onto <branch>\n");
  expect(io.stdout()).toBe("");
});

test("the handler draws the uncommitted-changes guard as a refused note on stderr, exit 1", async () => {
  const repo = cleanRepo();
  writeFileSync(join(repo, "f.txt"), "edited\n");
  expect(await exitCodeOf(() => ontoCommand(["main"], ctxFor(repo)))).toBe(1);
  expect(io.stderr()).toBe("[refused] You have uncommitted changes\n  why: A rebase that hits a conflict would lose them.\n  next: Commit them, or set them aside with rt git stash push\n");
});

test("the handler draws any other error result as a failure on stderr, exit 1", async () => {
  const repo = cleanRepo();
  git(repo, "checkout", "-q", "--detach");
  expect(await exitCodeOf(() => ontoCommand(["main"], ctxFor(repo)))).toBe(1);
  expect(io.stderr()).toBe("You are not on a branch\n  why: This needs a branch, and HEAD is detached right now.\n");
});

test("rebase --json keeps stdout for the bundle alone", async () => {
  const repo = makeRepo(root);
  const origin = join(root, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { stdio: "pipe" });
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "origin", "main");
  git(repo, "remote", "set-head", "origin", "main");
  git(repo, "checkout", "-qb", "feature");
  expect(await exitCodeOf(() => rebaseCommand(["--json"], ctxFor(repo)))).toBeNull();
  expect(io.stdout()).toBe("");
  expect(io.stderr()).toBe("[ok] Fetched from origin\n");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/git/__tests__/rebase-output.test.ts`
Expected: FAIL. `conflictFailure` is not exported; the progress lines are on stderr with escapes; `result.failure` is undefined; the last test finds the step line on stdout.

- [ ] **Step 3: Convert the helpers and the result type**

In `commands/git/rebase.ts`:

Replace the tui import (line 23) with:

```ts
import * as out from "../../lib/ui/out.ts";
import type { Block } from "../../lib/ui/protocol.ts";
import { usageFailure } from "../../lib/ui/usage.ts";
```

and add under the `CommandContext` import:

```ts
import { asError, asRefusal, drawFailure, errText, NOT_ON_A_BRANCH, plural, uncommittedChanges } from "./shared.ts";
```

In `RebaseResult`, replace the last member (`/** Error message if status is "error". */ error?: string;`) with:

```ts
  /** Error message if status is "error": the title of `failure`. */
  error?: string;
  /** What a person reads: set with `error`, and alone for a conflict that was undone. */
  failure?: out.FailureInput;
  /** `failure` is rt's own guard declining, drawn as a refused note. */
  refused?: boolean;
```

Replace the `log` function (lines 103 to 105) with:

```ts
function say(quiet: boolean | undefined, ...blocks: Block[]): void {
  if (!quiet) out.print(...blocks);
}

const PUT_BACK = "rt put the branch back the way it was.";

/** The failure for a rebase that stopped on conflicts and was undone. */
export function conflictFailure(result: Pick<RebaseResult, "unresolvedFiles" | "backupBranch">): out.FailureInput {
  return {
    title: `The rebase stopped on conflicts in ${plural(result.unresolvedFiles.length, "file")}`,
    why: PUT_BACK,
    details: [...result.unresolvedFiles, ...(result.backupBranch ? [`A backup is at ${result.backupBranch}`] : [])].join("\n"),
  };
}
```

- [ ] **Step 4: Convert `rebaseOnto`, site by site**

Line numbers are the file's before this task. Work from the bottom of the function up, or match on the quoted text. In every result literal, the edit replaces only the `error:` member.

1. Line 150, `error: "not on a branch (detached HEAD)",` becomes `...asError(NOT_ON_A_BRANCH),`.
2. Line 165, the `error:` member that begins `"uncommitted changes` becomes `...asRefusal(uncommittedChanges("A rebase that hits a conflict would lose them.")),`. The comment on line 154 keeps its words.
3. Lines 178 to 180, the `withSpinner` call, becomes:

```ts
      await withSpinner("Fetching from origin…", () => gitAsync("fetch origin"), {
        doneLabel: "Fetched from origin",
        failLabel: "Could not fetch from origin",
      });
```

4. Line 191, `error: \`fetch failed: ${err}\`,` becomes `...asError({ title: "Could not fetch from origin", details: errText(err) }),`.
5. Line 208, the `error:` member that begins `"could not detect default branch` becomes `...asError({ title: "rt could not tell which branch is the default", why: "origin has no main or master branch that it can see." }),`.
6. Line 215, the `log(` call, becomes `say(quiet, out.line("skipped", \`${branch} is the default branch\`, "nothing to rebase"));`.
7. Line 231, the `log(` call, becomes `say(quiet, out.line("done", \`${branch} is up to date with ${target}\`));`.
8. Lines 251 to 254, the two `log(` calls and the `if (rules.length > 0)` around the second, become:

```ts
    say(
      quiet,
      out.line("skipped", `Would rebase ${branch} onto ${target}`, `${plural(behind, "commit")} behind`),
      ...(rules.length > 0 ? [out.callout("note", `Conflicts in these files resolve by themselves: ${rules.flatMap(ruleGlobs).join(", ")}`)] : []),
    );
```

9. Line 267, the comment above the backup, becomes `// 6. Create backup. Mandatory: refuse to proceed without one.`
10. Line 271, the `log(` call, becomes `say(quiet, out.line("done", "Saved a backup", backupBranch));`.
11. Line 282, `error: \`could not create backup branch: ${err}\`,` becomes `...asError({ title: "Could not save a backup, so nothing was changed", details: errText(err) }),`.
12. Line 287, the `log(` call, becomes `say(quiet, out.line("running", \`Rebasing ${branch} onto ${target}\`, \`${plural(behind, "commit")} behind\`));`.
13. Line 302, the comment `// Clean rebase ...`, becomes `// Clean rebase: no conflicts`. Line 310's comment becomes `// No conflicts at this step: try to continue`.
14. Line 334, `error: \`rebase --continue failed unexpectedly\`,` becomes `...asError({ title: "The rebase stopped for a reason rt does not understand", why: PUT_BACK, ...(backupBranch ? { details: \`A backup is at ${backupBranch}\` } : {}) }),`.
15. Lines 344 to 377, the whole `if (unmatched.length > 0) { ... }` block, becomes:

```ts
    if (unmatched.length > 0) {
      if (opts.onConflict === "pause") {
        say(
          quiet,
          out.line("needs-you", `${plural(unmatched.length, "file")} ${unmatched.length === 1 ? "has" : "have"} conflicts rt cannot resolve`, "the rebase is paused"),
          out.table(unmatched.map((f) => [f])),
        );
        return {
          status: "conflict",
          branch,
          target,
          commitsBehind: behind,
          resolvedFiles: allResolvedFiles,
          unresolvedFiles: unmatched,
          postResolveSteps: [],
          backupBranch,
          rebaseInProgress: true,
        };
      }
      git("rebase --abort", cwd);
      return {
        status: "conflict",
        branch,
        target,
        commitsBehind: behind,
        resolvedFiles: allResolvedFiles,
        unresolvedFiles: unmatched,
        postResolveSteps: [],
        backupBranch,
        failure: conflictFailure({ unresolvedFiles: unmatched, backupBranch }),
      };
    }
```

16. Lines 379 to 382, the comment above the resolve loop, becomes:

```ts
    // All conflicts matched rules, so resolve them. A failing checkout (a
    // delete/modify conflict where the chosen side has no version of the
    // file, for one) must abort the rebase like every other unresolvable
    // case, not die mid-rebase with the repo left in a conflicted state.
```

17. Line 391, the `log(` call inside the loop, becomes `say(quiet, out.line("done", \`Resolved ${file} for you\`, \`rule: ${strategy}\`));`.
18. Line 404, the `error:` member that begins `` `auto-resolve failed: `` becomes `...asError({ title: "A conflict rt was set to resolve by itself could not be resolved", why: PUT_BACK, details: errText(err) }),`.
19. Line 420, the comment `// else: more conflicts ...`, becomes `// else: more conflicts on the next commit, so the loop continues`.
20. Lines 441 to 468, from `for (const step of postResolveSteps) {` through the closing brace of `if (failedStep) { ... }`, become:

```ts
  for (const step of postResolveSteps) {
    say(quiet, out.line("running", "Running a follow-up step", step));
    const result = spawnSync(userShell, ["-lc", step], {
      cwd,
      stdio: quiet ? "pipe" : "inherit",
    });
    if (result.status !== 0) {
      failedStep = { step, status: result.status, signal: result.signal };
      break;
    }
  }

  if (failedStep) {
    const how = failedStep.signal ? `was stopped by ${failedStep.signal}` : `exited with ${failedStep.status ?? "an unknown status"}`;
    return {
      status: "error",
      branch,
      target,
      commitsBehind: behind,
      resolvedFiles: allResolvedFiles,
      unresolvedFiles: [],
      postResolveSteps,
      backupBranch,
      ...asError({
        title: "A follow-up step failed after the rebase",
        why: `${failedStep.step} ${how}.`,
        details: ["Your files are as that step left them.", ...(backupBranch ? [`A backup is at ${backupBranch}`] : [])].join("\n"),
      }),
    };
  }
```

21. Lines 472 to 479, inside `if (postResolveSteps.length > 0)`, become:

```ts
    const { ok: hasDiff } = gitSafe("diff --quiet", cwd);
    if (!hasDiff) {
      // Tracked files only: an untracked file is never staged here.
      git("add -u", cwd);
      const stepNames = postResolveSteps.join(", ");
      git(`commit -m "chore: regenerate files after rebase (${stepNames})"`, cwd);
      say(quiet, out.line("done", "Committed the regenerated files"));
    }
```

22. Lines 482 to 486, the three `log(` calls and the `if` between them, become:

```ts
  say(quiet, out.line("done", `Rebased ${branch} onto ${target}`, allResolvedFiles.length > 0 ? `${plural(allResolvedFiles.length, "conflict")} resolved for you` : undefined));
```

- [ ] **Step 5: Convert the two handlers**

In `runRebaseWithEscalation`, add as the first statement after `const mode = resolveEscalationMode(args, isTTY);`:

```ts
  // Under --json stdout is the conflict bundle and nothing else: the fetch
  // step's plain line, printed off a terminal, moves to stderr with this.
  if (mode === "json") out.payloadOnStdout();
```

Replace everything from `if (result.status === "error") {` to the end of the function (lines 527 to 549) with:

```ts
  if (result.status === "error") {
    drawFailure(result.failure ?? { title: result.error ?? "The rebase failed" }, result.refused);
    process.exit(1);
  }

  if (result.status === "conflict") {
    if (mode === "off" || !result.rebaseInProgress) {
      if (result.failure) out.fail(result.failure);
      process.exit(1);
    }
    const exitCode = await runEscalationFlow({
      cwd,
      dataDir,
      repoName: ctx.identity!.repoName,
      result,
      mode,
      autoYes: args.includes("--agent"),
      push: false,
    });
    process.exit(exitCode);
  }
}
```

In `ontoCommand`, replace the last `if (!target) { ... }` block (lines 592 to 595) with:

```ts
  if (!target) {
    out.fail(usageFailure("Which branch?", "rt git rebase onto <branch>", "This needs the branch to rebase onto."));
    process.exit(1);
  }
```

The picker call above it, with `stderr: true`, is unchanged.

Rewrite the file's header comment so it holds no long dash: line 2 becomes ` * rt git rebase: smart rebase with auto-resolve rules and an escalation flow.`

- [ ] **Step 6: Delete the allowlist line and check for leftovers**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `  "commands/git/rebase.ts",`.

Run: `rg -n "log\(|console\.|process\.std|\\$\{(dim|red|green|bold|reset|yellow|cyan)\}" commands/git/rebase.ts`
Expected: only `syncLog.cmd(` lines.

- [ ] **Step 7: Run the tests**

Run: `bun test commands/git/__tests__/rebase-output.test.ts commands/git/__tests__/rebase.test.ts lib/__tests__/rebase-escalation.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS. `rebase.test.ts` and `rebase-escalation.test.ts` are unedited and read statuses only.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add commands/git/rebase.ts commands/git/__tests__/rebase-output.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "git: rebase prints through the output layer and hands its failures to the caller

<the executing session's own Co-Authored-By line>"
```

---

### Task 10: `git reset origin`, `soft` and `hard`

No reset verb declares `--json`.

**Files:**
- Modify: `commands/git/reset.ts`
- Modify: `commands/git/__tests__/reset.test.ts` (append a `describe`)
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `"commands/git/reset.ts",`)

**Interfaces:**
- Consumes: `asError`, `asRefusal`, `drawFailure`, `NOT_ON_A_BRANCH`, `uncommittedChanges`, `plural`, `errText` (Task 3); the step runner of Task 8 through `withSpinner`; `out.print`, `out.fail`, `out.line`, `out.callout`, `out.table`, `out.cmd`; the helpers of Task 3.
- Produces, in `commands/git/reset.ts`:
  - `ResetResult` gains `failure?: out.FailureInput` (set with `error`), `refused?: boolean` (true only for the uncommitted-changes guard; drawn with `drawFailure`) and `cancelled?: boolean` (the person said no at the confirm; `status` stays `"error"` and `error` stays `"cancelled by user"`, with no `failure`).
  - `resetToOrigin` prints on stdout through `out.print` when `quiet` is not set, and never prints a failure.
  - Task 13 relies on `failure`.

- [ ] **Step 1: Write the failing tests**

Append to `commands/git/__tests__/reset.test.ts`, and add these imports at the top of the file:

```ts
import * as out from "../../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { hardResetCommand, originCommand, softResetCommand } from "../reset.ts";
import { ctxFor, exitCodeOf, trapExit } from "./helpers.ts";
```

```ts
describe("what a reset prints", () => {
  let io: CapturedOut;
  let exit: { restore(): void };

  beforeEach(() => {
    io = captureOut({ console: true });
    out.__test__.setHuman(() => false);
    exit = trapExit();
  });
  afterEach(() => {
    exit.restore();
    io.restore();
  });

  test("in sync is one line on stdout", async () => {
    const { local } = makeFixture();
    await resetToOrigin({ cwd: local, autoConfirm: true, skipFetch: true });
    expect(io.stdout()).toBe("[ok] feature already matches origin/feature\n");
    expect(io.stderr()).toBe("");
  });

  test("a fast-forward is one line", async () => {
    const { origin, local } = makeFixture();
    rewriteRemoteFeature(origin, (helper) => {
      commit(helper, "f3.txt", "f3", "feature 3");
    });
    sh(`git fetch -q origin`, local);
    await resetToOrigin({ cwd: local, autoConfirm: true, skipFetch: true });
    expect(io.stdout()).toBe("[ok] Caught feature up to origin/feature\n");
  });

  test("a branch rebased here onto a newer base is kept, and says why", async () => {
    const { local } = makeFixture();
    sh(`git -c user.email=t@t -c user.name=t rebase -q origin/master`, local);
    await resetToOrigin({ cwd: local, autoConfirm: true, skipFetch: true });
    expect(io.stdout()).toBe("[ok] Kept feature as it is  it is origin/feature rebased onto a newer origin/master\n");
  });

  test("a reset to a rebased origin names the backup, then the reset", async () => {
    const { origin, local } = makeFixture();
    rewriteRemoteFeature(origin, (helper) => {
      sh(`git -c user.email=t@t -c user.name=t rebase -q origin/master`, helper);
    });
    sh(`git fetch -q origin`, local);
    await resetToOrigin({ cwd: local, autoConfirm: true, skipFetch: true });
    expect(io.lines()[0]).toMatch(/^\[ok\] Saved a backup  rt-backup\/reset\/feature\//);
    expect(io.lines()[1]).toBe("[ok] Reset feature to origin/feature  origin was rebased");
    expect(io.lines()).toHaveLength(2);
  });

  test("extra local commits are listed, put back one by one, and counted", async () => {
    const { origin, local } = makeFixture();
    rewriteRemoteFeature(origin, (helper) => {
      sh(`git -c user.email=t@t -c user.name=t commit -q --amend -m "feature 2 (reworded)"`, helper);
    });
    sh(`git config user.email t@t`, local);
    sh(`git config user.name t`, local);
    commit(local, "f3.txt", "f3", "feature 3 local only");
    sh(`git fetch -q origin`, local);
    await resetToOrigin({ cwd: local, autoConfirm: true, skipFetch: true });
    const lines = io.lines();
    expect(lines[1]).toBe("[warning] feature has 1 commit that origin does not");
    expect(lines[2]).toMatch(/^[0-9a-f]{7,} feature 3 local only$/);
    expect(lines[3]).toMatch(/^\[ok\] Put back [0-9a-f]{7,} feature 3 local only$/);
    expect(lines[4]).toBe("[ok] feature matches origin/feature  1 commit of yours put back on top");
    expect(lines).toHaveLength(5);
    expect(io.stderr()).toBe("");
  });

  test("quiet prints nothing on either stream", async () => {
    const { local } = makeFixture();
    await resetToOrigin({ cwd: local, quiet: true, autoConfirm: true, skipFetch: true });
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("");
  });

  test("a branch origin does not have comes back with a failure that names the next command", async () => {
    const { local } = makeFixture();
    sh(`git checkout -qb not-pushed`, local);
    const result = await resetToOrigin({ cwd: local, autoConfirm: true, skipFetch: true });
    expect(result.status).toBe("error");
    expect(result.error).toBe("not-pushed is not on origin yet");
    expect(result.failure).toEqual({ title: "not-pushed is not on origin yet", why: "There is nothing there to match.", next: { text: "rt git push", role: "command" } });
    expect(io.stdout()).toBe("");
  });

  test("reset origin draws the uncommitted-changes guard as a refused note on stderr, exit 1", async () => {
    const { local } = makeFixture();
    writeFileSync(join(local, "f1.txt"), "edited");
    expect(await exitCodeOf(() => originCommand([], ctxFor(local)))).toBe(1);
    expect(io.stderr()).toBe("[refused] You have uncommitted changes\n  why: Matching origin throws away local changes.\n  next: Commit them, or set them aside with rt git stash push\n");
    expect(io.stdout()).toBe("");
  });

  test("reset soft says the edits are kept", async () => {
    const { local } = makeFixture();
    writeFileSync(join(local, "f1.txt"), "edited");
    sh(`git add f1.txt`, local);
    await softResetCommand([], ctxFor(local));
    expect(io.stdout()).toBe("[ok] Unstaged everything  your edits are untouched\n");
  });

  test("reset hard names the backup of the branch, then what it threw away", async () => {
    const { local } = makeFixture();
    writeFileSync(join(local, "f1.txt"), "edited");
    await hardResetCommand([], ctxFor(local));
    expect(io.lines()[0]).toMatch(/^\[ok\] Saved a backup of the branch  rt-backup\/reset\/feature\//);
    expect(io.lines()[1]).toBe("[ok] Threw away every uncommitted change");
    expect(sh(`git status --porcelain`, local)).toBe("");
  });
});
```

The local `git config` in the cherry-pick test gives `git cherry-pick` an identity under the test HOME; the existing test of the same scenario passes `quiet: true` and relies on the same commits.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/git/__tests__/reset.test.ts`
Expected: FAIL in the new `describe` only: the progress lines are on stderr with escapes, `result.failure` is undefined, and the handlers print the old text. The five existing tests still pass.

- [ ] **Step 3: Convert the helpers and the result type**

In `commands/git/reset.ts`:

Replace the tui import (line 21) with:

```ts
import * as out from "../../lib/ui/out.ts";
import type { Block } from "../../lib/ui/protocol.ts";
```

and add under the `CommandContext` import:

```ts
import { asError, asRefusal, drawFailure, errText, NOT_ON_A_BRANCH, plural, uncommittedChanges } from "./shared.ts";
```

In `ResetResult`, replace the last member with:

```ts
  /** Error message if status is "error": the title of `failure`, or "cancelled by user". */
  error?: string;
  /** What a person reads when status is "error" and they did not cancel. */
  failure?: out.FailureInput;
  /** `failure` is rt's own guard declining, drawn as a refused note. */
  refused?: boolean;
  /** The person said no at the confirm; nothing was changed. */
  cancelled?: boolean;
```

In the `ResetStatus` union, the comment on `"local-newer"` holds a long dash: rewrite it as `// local is the branch rebased onto a newer base: keep local, push`.

Replace the `log` function (lines 76 to 78) with:

```ts
function say(quiet: boolean | undefined, ...blocks: Block[]): void {
  if (!quiet) out.print(...blocks);
}
```

In the doc comment of `getPatchIds`, the sentence `Patch-IDs are content-based hashes of the diff -- two commits ...` holds a long dash: put a colon in its place.

- [ ] **Step 4: Convert `resetToOrigin`, site by site**

Line numbers are the file's before this task. Work from the bottom up, or match on the quoted text.

1. Line 135, `error: "not on a branch (detached HEAD)",` becomes `...asError(NOT_ON_A_BRANCH),`.
2. Line 146, the `error:` member that begins `"uncommitted changes` becomes `...asRefusal(uncommittedChanges("Matching origin throws away local changes.")),`.
3. Lines 161 to 163, the `withSpinner` call, becomes:

```ts
      await withSpinner("Fetching from origin…", () => gitAsync("fetch origin"), {
        doneLabel: "Fetched from origin",
        failLabel: "Could not fetch from origin",
      });
```

4. Line 170, `error: \`fetch failed: ${err}\`,` becomes `...asError({ title: "Could not fetch from origin", details: errText(err) }),`.
5. Line 184, `error: \`remote branch ${remoteBranch} does not exist\`,` becomes `...asError({ title: \`${branch} is not on origin yet\`, why: "There is nothing there to match.", next: out.cmd("rt git push") }),`.
6. Line 194, the `log(` call, becomes `say(quiet, out.line("done", \`${branch} already matches ${remoteBranch}\`));`.
7. Lines 203 to 205 become:

```ts
    git(`merge --ff-only ${remoteBranch}`, cwd);
    say(quiet, out.line("done", `Caught ${branch} up to ${remoteBranch}`));
```

8. Lines 209 to 218, the comment above the divergence check, becomes:

```ts
  // Diverged: work out which side is the newer rewrite.
  //
  // Both a GitLab rebase (remote rewritten) and a local `git rebase
  // origin/master` (local rewritten) look identical topologically: same
  // branch content, different SHAs, neither tip an ancestor of the other.
  // "Reset to remote" is only correct in the first case. Disambiguate by
  // where each side forks from the default branch: the side sitting on the
  // newer base is the rewrite to keep. Resetting when LOCAL is the fresher
  // rewrite would discard the rebase and misclassify every intervening
  // default-branch commit as "extra local work" to cherry-pick.
```

9. Line 229, the `log(` call, becomes `say(quiet, out.line("done", \`Kept ${branch} as it is\`, \`it is ${remoteBranch} rebased onto a newer ${defaultBranch}\`));`.
10. Line 261, the `log(` call, becomes `say(quiet, out.line("done", "Saved a backup", backupBranch));`.
11. Line 268, `error: \`could not create backup branch: ${err}\`,` becomes `...asError({ title: "Could not save a backup, so nothing was changed", details: errText(err) }),`.
12. Lines 272 to 348, from `if (extraCommits.length === 0) {` to the closing brace of the function, become:

```ts
  if (extraCommits.length === 0) {
    // Case C: diverged but same content, so a plain reset.
    git(`reset --hard ${remoteBranch}`, cwd);
    say(quiet, out.line("done", `Reset ${branch} to ${remoteBranch}`, "origin was rebased"));
    return { status: "reset", branch, cherryPicked: [], backupBranch };
  }

  // Case D: diverged with extra local commits.
  say(
    quiet,
    out.line("warn", `${branch} has ${plural(extraCommits.length, "commit")} that origin does not`),
    out.table(extraCommits.map((sha) => [getCommitOneliner(sha, cwd)])),
    ...(autoConfirm ? [] : [out.callout("note", `rt will reset to ${remoteBranch} and put these back on top.`)]),
  );

  if (!autoConfirm) {
    const { confirm: inkConfirm } = await import("../../lib/rt-render.ts");
    const ok = await inkConfirm({
      message: "Reset + cherry-pick?",
      initialValue: true,
    });

    if (!ok) {
      // Nothing is going to change, so the backup made above is dropped.
      if (backupBranch) {
        try { git(`branch -D "${backupBranch}"`, cwd); } catch { /* */ }
      }
      return {
        status: "error",
        branch,
        cherryPicked: [],
        backupBranch: null,
        error: "cancelled by user",
        cancelled: true,
      };
    }
  }

  git(`reset --hard ${remoteBranch}`, cwd);

  const pickedShas: string[] = [];
  for (const sha of extraCommits) {
    const result = spawnSync("git", ["cherry-pick", sha], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });
    syncLog.cmd(["cherry-pick", sha], cwd, result.status, result.stdout ?? "", result.stderr ?? "");

    if (result.status !== 0) {
      spawnSync("git", ["cherry-pick", "--abort"], { cwd, stdio: "pipe" });
      return {
        status: "error",
        branch,
        cherryPicked: pickedShas,
        backupBranch,
        ...asError({
          title: "One of your commits could not be put back on top",
          why: `${getCommitOneliner(sha, cwd)} conflicts with what is on origin now.`,
          next: ["Your branch as it was is in a backup. Bring it back with ", out.cmd("rt git restore")],
        }),
      };
    }

    pickedShas.push(sha);
    say(quiet, out.line("done", `Put back ${getCommitOneliner(sha, cwd)}`));
  }

  say(quiet, out.line("done", `${branch} matches ${remoteBranch}`, `${plural(pickedShas.length, "commit")} of yours put back on top`));
  return { status: "cherry-picked", branch, cherryPicked: pickedShas, backupBranch };
}
```

The confirm call is today's, unchanged.

- [ ] **Step 5: Convert the three handlers**

Replace everything from the comment `// ─── CLI handler ───` (line 350) to the end of the file with:

```ts
// ─── CLI handlers ────────────────────────────────────────────────────────────

/** rt git reset origin: sync with the remote branch */
export async function originCommand(
  _args: string[],
  ctx: CommandContext,
): Promise<void> {
  const cwd = ctx.identity!.repoRoot;
  const result = await resetToOrigin({ cwd });

  if (result.cancelled) {
    out.print(out.line("skipped", "Nothing was changed"));
    process.exit(1);
  }
  if (result.status === "error") {
    drawFailure(result.failure ?? { title: result.error ?? "The reset failed" }, result.refused);
    process.exit(1);
  }
}

/** rt git reset soft: unstage everything */
export async function softResetCommand(
  _args: string[],
  ctx: CommandContext,
): Promise<void> {
  const cwd = ctx.identity!.repoRoot;
  // `reset --soft HEAD` is a no-op (--soft touches neither index nor
  // worktree); a mixed reset is what actually unstages.
  git("reset HEAD", cwd);
  out.print(out.line("done", "Unstaged everything", "your edits are untouched"));
}

/** rt git reset hard: discard every uncommitted change */
export async function hardResetCommand(
  _args: string[],
  ctx: CommandContext,
): Promise<void> {
  const cwd = ctx.identity!.repoRoot;

  let backupBranch: string | null = null;
  try {
    backupBranch = createBackup("reset", cwd);
  } catch { /* best-effort */ }

  git("reset --hard HEAD", cwd);
  out.print(
    ...(backupBranch ? [out.line("done", "Saved a backup of the branch", backupBranch)] : []),
    out.line("done", "Threw away every uncommitted change"),
  );
}
```

Rewrite the file's header comment (lines 1 to 18) so it holds no long dash: line 2 becomes ` * rt git reset: safe reset with divergence detection.`

- [ ] **Step 6: Delete the allowlist line and check for leftovers**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `  "commands/git/reset.ts",`.

Run: `rg -n "log\(|console\.|process\.std|\\$\{(dim|red|green|bold|reset|yellow|cyan)\}" commands/git/reset.ts`
Expected: only `syncLog.cmd(` lines.

- [ ] **Step 7: Run the tests**

Run: `bun test commands/git/__tests__/reset.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS, the five older tests included.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add commands/git/reset.ts commands/git/__tests__/reset.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "git: reset prints through the output layer and hands its failures to the caller

<the executing session's own Co-Authored-By line>"
```

---

### Task 11: The escalation flow in `lib/rebase-escalation.ts`

**Files:**
- Modify: `lib/rebase-escalation.ts`
- Modify: `lib/__tests__/rebase-escalation.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `"lib/rebase-escalation.ts",`)

**Interfaces:**
- Consumes: `out.json`, `out.print`, `out.fail(f, ...after)`, `out.line`, `out.callout`, `out.table`, `out.verbatim`, `out.cmd`, `out.strong`; `plural`, `errText` (`commands/git/shared.ts`, Task 3); `RebaseResult` (Task 9); the helpers of Task 3.
- Produces, in `lib/rebase-escalation.ts`:
  - `export function manualReport(bundle: ConflictBundle): Block[]`, replacing `renderHumanReport(bundle): string`.
  - `runEscalationFlow(opts)` keeps its signature and its return codes (3 for `mode: "json"`, 0 when the agent finished, 1 otherwise); it prints through the layer.
  - `buildConflictBundle`, `renderAgentTask`, `writeTaskFile`, `verifyRebaseCompleted`, `resolveEscalationMode` and `ConflictBundle` are unchanged.

- [ ] **Step 1: Pin the bundle before touching the file**

In `lib/__tests__/rebase-escalation.test.ts`, add these imports:

```ts
import * as out from "../ui/out.ts";
import { renderPlain } from "../ui/out-plain.ts";
import { captureOut, type CapturedOut } from "../ui/__tests__/capture-out.ts";
```

and append a `describe` at the end of the file:

```ts
describe("runEscalationFlow (--json)", () => {
  test("stdout is the conflict bundle, two-space indented, and the code is 3", async () => {
    const repo = makeConflictRepo();
    const result = await pausedConflict(repo);
    const io = captureOut({ console: true });
    out.__test__.setHuman(() => false);
    try {
      const code = await runEscalationFlow({ cwd: repo, dataDir: join(tmpRoot, "data"), repoName: "sample-app", result, mode: "json", autoYes: false, push: true });
      expect(code).toBe(3);
      expect(io.stdout()).toBe(JSON.stringify(buildConflictBundle(result, repo), null, 2) + "\n");
      expect(io.stderr()).toBe("");
    } finally {
      io.restore();
    }
  }, 20_000);
});
```

Run: `bun test lib/__tests__/rebase-escalation.test.ts -t "conflict bundle, two-space"`
Expected: PASS against today's code. It must pass unchanged after Step 4.

- [ ] **Step 2: Write the failing human tests**

In the same file, replace the `describe("renderHumanReport", ...)` block with:

```ts
describe("manualReport", () => {
  test("says the rebase is paused, lists the files, and names both ways out", async () => {
    const repo = makeConflictRepo();
    const bundle = buildConflictBundle(await pausedConflict(repo), repo);
    const lines = renderPlain(manualReport(bundle)).split("\n");
    expect(lines[0]).toBe("[needs you] The rebase of feature onto master is paused  1 file to resolve");
    expect(lines[1]).toBe("app.txt");
    expect(lines[2]).toBe("  next: Fix the files, then run git add <files> and git rebase --continue");
    expect(lines[3]).toBe("  note: To give up instead, run git rebase --abort");
    expect(lines[4]).toBe(`        Your branch as it was: ${bundle.backupBranch}`);
    expect(lines[5]).toBe("        rt did not push. When the rebase is done, run git push --force-with-lease origin feature");
  });

  test("with no backup the note leaves that line out", () => {
    const text = renderPlain(manualReport({ kind: "rebase-conflict", state: "mid-rebase", branch: "feature", target: "origin/main", commitsBehind: 2, unresolvedFiles: ["a.ts", "b.ts"], autoResolvedFiles: [], backupBranch: null, branchCommits: [], targetCommits: [], hint: "" }));
    expect(text).toContain("[needs you] The rebase of feature onto origin/main is paused  2 files to resolve\na.ts\nb.ts\n");
    expect(text).not.toContain("Your branch as it was");
  });
});
```

and change the import of `renderHumanReport` in the file's import list to `manualReport`.

In `describe("runEscalationFlow (agent path)", ...)`, add at the top of the block:

```ts
  let io: CapturedOut;
  beforeEach(() => {
    io = captureOut({ console: true });
    out.__test__.setHuman(() => false);
  });
  afterEach(() => {
    io.restore();
  });
```

Then add assertions to its three tests. At the end of `agent resolves the conflict: ...`:

```ts
    expect(io.lines()).toEqual(["[running] An agent is resolving the conflicts  pane p1; Ctrl+C leaves it working", "[ok] The agent resolved the conflicts  feature is rebased"]);
    expect(io.stderr()).toBe("");
```

At the end of `agent wait times out: ...`:

```ts
    expect(io.errLines()[0]).toBe("The agent did not finish in 10 minutes");
    expect(io.errLines()[1]).toBe("  why: Nothing was pushed.");
    expect(io.errLines()[2]).toBe("  Pane p1 is still open.");
    expect(io.stderr()).toEndWith("the end of the pane:\n  last pane output\n");
```

At the end of `an existing rebase tab is focused, ...`:

```ts
    expect(io.stdout()).toBe("[warning] An agent is already working on feature  nothing new was started\n");
```

And add two tests to that block:

```ts
  test("only the end of a long pane is shown", async () => {
    const repo = makeConflictRepo();
    const result = await pausedConflict(repo);
    const pane = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n") + "\n\x1b[2Jlast\n";
    const { runner } = scriptedHerdr({ "agent wait": { stdout: "", exitCode: 1 }, "pane read": { stdout: pane } });
    await runEscalationFlow({ cwd: repo, dataDir: join(tmpRoot, "data"), repoName: "sample-app", result, mode: "interactive", autoYes: true, push: false, herdrRunner: runner });
    const shown = io.errLines().slice(io.errLines().indexOf("the end of the pane:") + 1);
    expect(shown).toHaveLength(40);
    expect(shown[0]).toBe("  line 462");
    expect(shown.at(-1)).toBe("  last");
    expect(io.stderr()).not.toContain("\x1b");
  }, 20_000);

  test("a herdr that fails after the choice ends with the manual report, never an abort", async () => {
    const repo = makeConflictRepo();
    const result = await pausedConflict(repo);
    const runner: HerdrRunner = async (args) => {
      if (args[0] === "workspace" && args[1] === "list") return { stdout: JSON.stringify({ result: { workspaces: [] } }), exitCode: 0 };
      throw new Error("herdr socket closed");
    };
    const code = await runEscalationFlow({ cwd: repo, dataDir: join(tmpRoot, "data"), repoName: "sample-app", result, mode: "interactive", autoYes: true, push: false, herdrRunner: runner });
    expect(code).toBe(1);
    expect(io.lines()[0]).toBe("[warning] Could not hand this to an agent  herdr socket closed");
    expect(io.lines()[1]).toBe("[needs you] The rebase of feature onto master is paused  1 file to resolve");
    expect(verifyRebaseCompleted(repo, "feature", "master")).toBe("still-in-progress");
  }, 20_000);
```

The last test reads the runner's own message, unwrapped. That holds at `5bc69f231`: `herdrAvailable` (`lib/rebase-escalation.ts:177`) and `launchInWorkspace`'s first call (`lib/agent-herdr.ts:133`) both get `workspace list` answered with exit 0; the next call, `workspace create` (`:140`), goes through `herdrJson` and `runHerdr` (`:105-120`), which `await runner(args)` with no `try`, so the runner's `Error("herdr socket closed")` reaches `runEscalationFlow`'s `catch` as it was thrown. If `runHerdr` ever wraps a thrown runner error, loosen the assertion to `toStartWith("[warning] Could not hand this to an agent  ")`, never drop it.

- [ ] **Step 3: Run them to verify they fail**

Run: `bun test lib/__tests__/rebase-escalation.test.ts`
Expected: FAIL. `manualReport` is not exported, and the agent-path tests find the old text with escapes on stdout.

- [ ] **Step 4: Convert `lib/rebase-escalation.ts`**

Replace the tui import (line 20) with:

```ts
import { errText, plural } from "../commands/git/shared.ts";
import * as out from "./ui/out.ts";
import type { Block } from "./ui/protocol.ts";
```

Replace `renderHumanReport` (lines 119 to 135) with:

```ts
/** What a person reads when the rebase is left paused for them. */
export function manualReport(bundle: ConflictBundle): Block[] {
  return [
    out.line("needs-you", `The rebase of ${bundle.branch} onto ${bundle.target} is paused`, `${plural(bundle.unresolvedFiles.length, "file")} to resolve`),
    out.table(bundle.unresolvedFiles.map((f) => [f])),
    out.callout("next", ["Fix the files, then run ", out.cmd("git add <files>"), " and ", out.cmd("git rebase --continue")]),
    out.callout(
      "note",
      ["To give up instead, run ", out.cmd("git rebase --abort")],
      ...(bundle.backupBranch ? [["Your branch as it was: ", out.strong(bundle.backupBranch)]] : []),
      ["rt did not push. When the rebase is done, run ", out.cmd(`git push --force-with-lease origin ${bundle.branch}`)],
    ),
  ];
}
```

Add after `herdrAvailable` (line 180):

```ts
const PANE_TAIL = 40;

// A pane can hold thousands of lines; only its end goes under the failure,
// so the failure itself stays on screen.
async function paneTail(runner: HerdrRunner, paneId: string): Promise<Block[]> {
  const text = (await runner(["pane", "read", paneId, "--source", "recent"])).stdout.replace(/\s+$/, "");
  if (text === "") return [];
  return [out.verbatim(text.split("\n").slice(-PANE_TAIL), "the end of the pane")];
}

const UNFINISHED: Record<Exclude<RebaseVerdict, "completed" | "agent-aborted">, string> = {
  "still-in-progress": "The rebase is still paused.",
  dirty: "The worktree has uncommitted changes.",
  "wrong-branch": "The worktree is on a different branch now.",
};
```

Replace the body of `runEscalationFlow` from `const { cwd, result } = opts;` to the closing brace of the function (lines 197 to 338) with:

```ts
  const { cwd, result } = opts;
  const bundle = buildConflictBundle(result, cwd);
  const backupNote = bundle.backupBranch ? `A backup is at ${bundle.backupBranch}` : undefined;

  if (opts.mode === "json") {
    syncLog.phase("escalation", { mode: "json", files: bundle.unresolvedFiles });
    out.json(bundle, 2);
    return 3;
  }

  const runner: HerdrRunner = opts.herdrRunner ?? defaultHerdrRunner();
  const agentPossible = await herdrAvailable(runner);
  let choice: string;
  if (opts.autoYes && agentPossible) {
    choice = "agent";
  } else {
    if (opts.autoYes && !agentPossible) {
      out.print(out.line("warn", "herdr is not reachable, so no agent can take this", "choose below"));
    }
    const { select } = await import("./rt-render.ts");
    const options = [
      { value: "abort", label: "abort the rebase", hint: "default, same as before" },
      ...(agentPossible
        ? [{ value: "agent", label: "resolve with a Claude agent in a herdr pane" }]
        : []),
      { value: "manual", label: "leave the rebase paused and resolve manually" },
    ];
    choice = await select({
      message: `${bundle.unresolvedFiles.length} conflict${bundle.unresolvedFiles.length !== 1 ? "s" : ""} need${bundle.unresolvedFiles.length !== 1 ? "" : "s"} resolution`,
      options,
    });
  }

  syncLog.phase("escalation", { mode: "interactive", choice, files: bundle.unresolvedFiles });

  if (choice === "abort") {
    abortRebase(cwd);
    out.print(out.line("done", "Undid the rebase", backupNote));
    return 1;
  }

  if (choice === "manual") {
    out.print(...manualReport(bundle));
    return 1;
  }

  try {
    const taskPath = writeTaskFile(opts.dataDir, renderAgentTask(bundle, cwd));
    const sessionId = crypto.randomUUID();
    const paneCommand = buildPaneCommand(cwd, {
      session: { kind: "start", sessionId },
      headless: false,
      prompt: `Read ${taskPath} and complete the task it describes.`,
    });
    const launched = await launchInWorkspace(
      { workspaceLabel: opts.repoName, tabLabel: `rebase ${bundle.branch}`, paneCommand },
      runner,
    );

    // An existing "rebase <branch>" tab was focused, not launched: there is no
    // fresh pane id to wait on (herdrAgentWait against "" would wait on nothing).
    if (launched.focusedExisting) {
      syncLog.phase("escalation-agent", { focusedExisting: true, tab: launched.tabId });
      out.print(out.line("warn", `An agent is already working on ${bundle.branch}`, "nothing new was started"));
      return 1;
    }

    syncLog.phase("escalation-agent", { pane: launched.paneId, taskPath });

    out.print(out.line("running", "An agent is resolving the conflicts", `pane ${launched.paneId}; Ctrl+C leaves it working`));

    const onSigint = () => {
      out.print(
        out.line("warn", "Stopped watching. The agent is still working", `pane ${launched.paneId}`),
        out.callout("next", ["When it finishes, run ", out.cmd(`git push --force-with-lease origin ${bundle.branch}`)]),
      );
      process.exit(130);
    };
    process.on("SIGINT", onSigint);
    let settled: boolean;
    try {
      settled = await herdrAgentWait(launched.paneId, ["idle", "done"], AGENT_WAIT_TIMEOUT_MS, runner);
    } finally {
      process.removeListener("SIGINT", onSigint);
    }

    if (!settled) {
      out.fail(
        { title: "The agent did not finish in 10 minutes", why: "Nothing was pushed.", details: [`Pane ${launched.paneId} is still open.`, ...(backupNote ? [backupNote] : [])].join("\n") },
        ...(await paneTail(runner, launched.paneId)),
      );
      syncLog.phase("escalation-verdict", { verdict: "timeout" });
      return 1;
    }

    const verdict = verifyRebaseCompleted(cwd, bundle.branch, bundle.target);
    syncLog.phase("escalation-verdict", { verdict });

    if (verdict === "completed") {
      if (opts.push) {
        const pushRes = spawnSync(
          "git",
          ["push", "--force-with-lease", "origin", bundle.branch],
          { cwd, encoding: "utf8", stdio: "pipe" },
        );
        syncLog.cmd(`push --force-with-lease origin ${bundle.branch}`, cwd, pushRes.status ?? 1, pushRes.stdout ?? "", pushRes.stderr ?? "");
        if (pushRes.status !== 0) {
          const detail = (pushRes.stderr ?? "").trim();
          out.fail({ title: "The rebase finished, but the push failed", ...(detail ? { details: detail } : {}) });
          return 1;
        }
      }
      out.print(out.line("done", "The agent resolved the conflicts", `${bundle.branch} is rebased${opts.push ? " and pushed" : ""}`));
      return 0;
    }

    if (verdict === "agent-aborted") {
      out.fail({ title: "The agent gave up and undid the rebase", ...(backupNote ? { details: backupNote } : {}) }, ...(await paneTail(runner, launched.paneId)));
      return 1;
    }

    out.fail(
      {
        title: "The agent stopped, but the rebase is not finished",
        why: UNFINISHED[verdict],
        details: [`Nothing was pushed. Look at pane ${launched.paneId}.`, ...(backupNote ? [backupNote] : [])].join("\n"),
      },
      ...(await paneTail(runner, launched.paneId)),
    );
    return 1;
  } catch (err) {
    // Herdr tooling failed after the user chose escalation. Never abort their
    // paused rebase on a tooling failure; degrade to the manual ending.
    syncLog.phase("escalation-error", { error: String(err) });
    out.print(out.line("warn", "Could not hand this to an agent", errText(err)), ...manualReport(bundle));
    return 1;
  }
}
```

Three things to notice. The local that held `launchInWorkspace`'s result was named `out` and shadowed the output module; it is `launched` now. The `select` call, its `message` and its option labels are today's, unchanged. The `--agent` comment that sat above the first warning described what the line under it says and is gone with it.

- [ ] **Step 5: Delete the allowlist line and check for leftovers**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `  "lib/rebase-escalation.ts",`.

Run: `rg -n "console\.|process\.std|renderHumanReport|\\$\{(dim|red|green|bold|reset|yellow|cyan)\}" lib/rebase-escalation.ts commands lib --glob '!**/__tests__/**' --glob '!lib/tui/**' --glob '!lib/ansi.ts'`
Expected: no hit in `lib/rebase-escalation.ts`, and no `renderHumanReport` anywhere.

- [ ] **Step 6: Run the tests**

Run: `bun test lib/__tests__/rebase-escalation.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-daemon-sync-exec.test.ts`
Expected: PASS, the bundle pin of Step 1 unchanged.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/rebase-escalation.ts lib/__tests__/rebase-escalation.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "rebase escalation: every ending prints through the output layer

<the executing session's own Co-Authored-By line>"
```

---

### Task 12: The guard sentences and their readers

Matt's ruling: a sentence that rides in a `--json` envelope and is also what a person reads on screen is reworded, shape kept. `StackRefusal.hint` and `BranchGuardVerdict.detail` are both, so they join this slice for their strings only. Task 2 names every reader; the only one that matches wording is the rebase-worktree skill, and its two rows change in this commit.

**Files:**
- Modify: `lib/stack-guard.ts` (the `hint` strings at lines 131, 136, 140, 145 to 147 and 157; nothing else)
- Modify: `lib/branch-guard.ts` (the `detail` strings at lines 67, 77, 81 and 88, and the badge at 138; nothing else)
- Modify: `lib/__tests__/stack-guard.test.ts`, `lib/__tests__/branch-guard.test.ts` (append)
- Modify: `plugins/mattstack/attachments/forge/rebase-worktree/SKILL.md` (lines 257 and 258)
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (one patch above main's version at the time, never a literal written in this plan)
- Not edited: `plugins/mattstack/CERTIFICATION.md`. The ledger row text goes in the report for the shepherd to append (cross-phase ruling 13).

**Interfaces:**
- Consumes: `checkStackMembership`, `renderStackRefusal`, `StackGuardRunners` (`lib/stack-guard.ts`); `checkBranchGuard`, `buildWorktreeGuardMap` (`lib/branch-guard.ts`); the test helpers already in those two test files (`gitqStore`, `runners`, `makeRepo`, `git`, `unreachableRunners`).
- Produces: the new `hint` and `detail` words in Task 2's guard table. Every type, verdict, field and the `tool` string are unchanged. Task 13's tests pin the hint as `rt sync` shows it; Task 5's guard shows the detail as its `why`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/__tests__/stack-guard.test.ts`:

```ts
describe("the hints a person reads", () => {
  test("a gitq stack member", async () => {
    const store = gitqStore([{ stackName: "s1", root: "master", nodes: [{ branch: "feat", parent: "master" }] }]);
    const verdict = await checkStackMembership({ cwd: "/repo", branch: "feat", defaultBranch: "master", runners: runners({ gitqStacks: async () => store }) });
    if (verdict.verdict !== "refuse") throw new Error("expected refusal");
    expect(verdict.refusal.hint).toBe("feat is in stack s1, so changing it on its own would break the stack");
    expect(renderStackRefusal(verdict.refusal, "human")).toBe("feat is in stack s1, so changing it on its own would break the stack. Run: gitq sync --stack s1");
  });

  test("a stack gitq does not track, from either end, with no merge request id in the sentence", async () => {
    const forge = (mrs: { iid: number; source: string; target: string; url: string }[]) => runners({ forgeOpenMrs: async () => ({ ok: true, mrs }) });
    const own = await checkStackMembership({ cwd: "/repo", branch: "feat-child", defaultBranch: "master", runners: forge([{ iid: 42, source: "feat-child", target: "feat-parent", url: "u" }]) });
    const one = await checkStackMembership({ cwd: "/repo", branch: "feat-parent", defaultBranch: "master", runners: forge([{ iid: 8, source: "feat-child", target: "feat-parent", url: "u" }]) });
    const two = await checkStackMembership({
      cwd: "/repo",
      branch: "feat-parent",
      defaultBranch: "master",
      runners: forge([
        { iid: 8, source: "feat-child", target: "feat-parent", url: "u" },
        { iid: 9, source: "feat-other", target: "feat-parent", url: "u" },
      ]),
    });
    if (own.verdict !== "refuse" || one.verdict !== "refuse" || two.verdict !== "refuse") throw new Error("expected refusals");
    expect(own.refusal.hint).toBe("feat-child is in a stack gitq does not track yet: its open merge request targets feat-parent");
    expect(one.refusal.hint).toBe("feat-parent is in a stack gitq does not track yet: the open merge request from feat-child targets it");
    expect(two.refusal.hint).toBe("feat-parent is in a stack gitq does not track yet: the open merge requests from feat-child, feat-other target it");
    expect(two.refusal.mrs?.map((mr) => mr.iid)).toEqual([8, 9]);
  });

  test("the two checks that could not run", async () => {
    const noDefault = await checkStackMembership({ cwd: "/repo", branch: "feat", defaultBranch: null, runners: runners({}) });
    const forgeDown = await checkStackMembership({ cwd: "/repo", branch: "feat", defaultBranch: "master", runners: runners({ forgeOpenMrs: async () => ({ ok: false, error: "gh pr list failed: not logged in" }) }) });
    if (noDefault.verdict !== "unverified" || forgeDown.verdict !== "unverified") throw new Error("expected unverified");
    expect(noDefault.refusal.hint).toBe("rt could not find the default branch, so it cannot tell whether this branch is in a stack");
    expect(forgeDown.refusal.hint).toBe("rt could not list the open merge requests, so it cannot tell whether this branch is in a stack (gh pr list failed: not logged in)");
  });
});
```

Append to `lib/__tests__/branch-guard.test.ts`:

```ts
describe("the sentences a person reads", () => {
  test("worktrees that cannot be listed", async () => {
    const dir = makeRepo();
    const verdict = await checkBranchGuard({ cwd: dir, branch: "feature-x", defaultBranch: "main", runners: unreachableRunners, listWorktrees: async () => null });
    expect(verdict).toEqual({ verdict: "unverified", detail: "rt could not list the worktrees, so it cannot tell whether another one has this branch" });
    rmSync(dir, { recursive: true, force: true });
  });

  test("a branch another worktree holds: the path after a colon, the same for the refusal and the badge", async () => {
    const parent = mkdtempSync(join(tmpdir(), "rt-branch-guard-words-"));
    const dir = join(parent, "main");
    mkdirSync(dir);
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "test@test");
    git(dir, "config", "user.name", "test");
    git(dir, "commit", "-q", "--allow-empty", "-m", "init");
    git(dir, "branch", "feature-x");
    git(dir, "worktree", "add", join(parent, "wt"), "feature-x");
    const verdict = await checkBranchGuard({ cwd: dir, branch: "feature-x", defaultBranch: "main", runners: unreachableRunners });
    const guards = await buildWorktreeGuardMap(dir);
    const detail = verdict.verdict === "refuse" ? verdict.detail : "";
    expect(detail).toMatch(/^feature-x is checked out in another worktree: \/.*\/wt$/);
    expect(guards.get("feature-x")).toBe(detail);
    rmSync(parent, { recursive: true, force: true });
  });
});
```

The path is matched, not spelled out: git may report it under `/private/var` while `tmpdir()` says `/var`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/__tests__/stack-guard.test.ts lib/__tests__/branch-guard.test.ts`
Expected: FAIL in the two new `describe` blocks only, each on the old words (`is a member of stack`, `could not list worktrees`, `already checked out in another worktree at`). Every older test passes.

- [ ] **Step 3: Reword the hints in `lib/stack-guard.ts`**

Line 131 becomes:

```ts
        hint: `${opts.branch} is in stack ${membership.name}, so changing it on its own would break the stack`,
```

Line 136 becomes:

```ts
    return unavailable(opts.branch, "rt could not find the default branch, so it cannot tell whether this branch is in a stack");
```

Line 140 becomes:

```ts
    return unavailable(opts.branch, `rt could not list the open merge requests, so it cannot tell whether this branch is in a stack (${forge.error})`);
```

Lines 145 to 147 (`const detail = ...`) become:

```ts
    const detail = own.length > 0
      ? `its open merge request targets ${own[0]!.target}`
      : dependents.length === 1
        ? `the open merge request from ${dependents[0]!.source} targets it`
        : `the open merge requests from ${dependents.map((mr) => mr.source).join(", ")} target it`;
```

Line 157 becomes:

```ts
        hint: `${opts.branch} is in a stack gitq does not track yet: ${detail}`,
```

Nothing else in the file changes: `renderStackRefusal` still appends `. Run: <tool>`, and the `tool` values (`gitq sync --stack <name>`, `gitq track`) are a command a reader runs.

- [ ] **Step 4: Reword the details in `lib/branch-guard.ts`**

Line 67: `detail: "rt could not list the worktrees, so it cannot tell whether another one has this branch"`.
Line 77: ``detail: `rt could not open the folder it ran in, so it cannot tell whether another worktree has this branch: ${opts.cwd}` ``.
Line 81: ``detail: `rt could not open one of the worktrees, so it cannot tell whether another one has this branch: ${ownership.path}` ``.
Line 88: ``detail: `${opts.branch} is checked out in another worktree: ${owner.path}`,``.
Line 138: ``guards.set(branch, `${branch} is checked out in another worktree: ${owner.path}`);``.

Lines 88 and 138 must read the same: the doc comment above `resolveWorktreeOwnership` says the two never drift on what "owned" means, and the badge in glitter's branch modal is the refusal's sentence.

- [ ] **Step 5: Update the skill rows that quote the hint**

Before editing, load `superpowers:writing-skills` and `mattstack:editing-skills` (Matt's rule for any skill edit, a two-cell text change included). This is a reader update, not new guidance: change only the quoted text.

The skill and the rt binary ship apart (the plugin updates on its own schedule, and team packs compile `rebase-worktree` into their own verbs from the installed plugin), so an old row can meet a new hint and a new row an old one. Both rows therefore key on structure, not wording.

In `plugins/mattstack/attachments/forge/rebase-worktree/SKILL.md`, row 257's first cell becomes:

```markdown
| an `rt sync refused (exit 4): ...` error with no `Run:` in it (the stack check could not run) | error text only | The stack could not be verified either way. ...
```

(the rest of the row, its `next` cell and its `<!-- mcp-lint: allow -->` tail, unchanged). It holds for both the old and the new words: `tool` is `""` for every unverified refusal (`unavailable` in `lib/stack-guard.ts:101-106`), so `branch_sync` (`lib/mcp/git-tools.ts:394`) adds no `Run:`, while every stack refusal has a tool. Row 258 already keys on the trailing `Run: <tool>`; only its example changes:

```markdown
(e.g. `<branch> is in stack <name>, so changing it on its own would break the stack. Run: <tool>`)
```

Do not edit `plugins/mattstack/CERTIFICATION.md` (cross-phase ruling 13: the shepherd appends ledger rows, never a lane). Put this row, in the form of the rows already there, in the task report and in Task 15's report for the shepherd to append:

```markdown
| <today> | rebase-worktree | pure | pass | n/a (description unchanged) | RT-369 5b: the stack-unverified row matches an exit 4 error with no `Run:` instead of quoting the hint, so it holds across a plugin and rt version skew; the stack-member example quotes the new hint; certify re-run exit 0 |
```

Bump the plugin version without writing a literal one (cross-phase ruling 13: another slice, 5d1, bumps the same file, and two identical literal bumps merge silently into one).

Run: `git fetch origin`
Run: `git show origin/main:plugins/mattstack/.claude-plugin/plugin.json`
Expected: the manifest as main has it now; read its `"version"`.

In `plugins/mattstack/.claude-plugin/plugin.json`, set `"version"` to one patch above that value (for `x.y.z`, `x.y.(z+1)`), whatever this branch's copy says.

Team packs that compile `rebase-worktree` pick the new rows up at their next `rt skills compile` after the plugin update reaches the machine; nothing in this repo recompiles them. Say so in the PR body's Follow-up.

- [ ] **Step 6: Run the tests and the plugin checks**

Run: `bun test lib/__tests__/stack-guard.test.ts lib/__tests__/branch-guard.test.ts commands/__tests__/sync-stack-guard.test.ts lib/mcp/__tests__/git-tools.test.ts lib/mission/__tests__/driver.test.ts`
Expected: PASS. The older `toContain` checks hold under the new words (`stack s1`, `targets feat-parent`, `feat-child`, `gh: not logged in`, `default branch`, `glab not installed`, each path), and `sync-stack-guard.test.ts:75` still finds `s1` in `summary.error`.

Run, from `plugins/mattstack`: `sh tests/certify.sh attachments/forge/rebase-worktree/`
Expected: passes.

Run: `HOME=<scratchpad>/home bun cli.ts skills check --pack-dir <repo>/plugins/mattstack --mattstack-dir <scratchpad>/mattstack --strict` (both scratch folders made first with `mkdir -p`)
Expected: passes, as the `plugin-mattstack` CI job runs it.

- [ ] **Step 7: Commit**

```bash
git add lib/stack-guard.ts lib/branch-guard.ts lib/__tests__/stack-guard.test.ts lib/__tests__/branch-guard.test.ts plugins/mattstack/attachments/forge/rebase-worktree/SKILL.md plugins/mattstack/.claude-plugin/plugin.json
```

```bash
git commit -m "guards: the stack and ownership sentences in plain words, and the skill rows that read them

<the executing session's own Co-Authored-By line>"
```

- [ ] **Step 8: Check the version bump against the commit**

The check diffs `base..HEAD`, so it runs after the commit, never before.

Run: `bun scripts/ci/plugin-version-bumped.ts --base origin/main --plugin plugins/mattstack`
Expected: passes. On failure, main moved since Step 5: fetch, set the version to one patch above `git show origin/main:plugins/mattstack/.claude-plugin/plugin.json` again, commit that alone, and re-run.

---

### Task 13: `rt sync` and `rt sync all`

**Files:**
- Modify: `commands/sync.ts`
- Create: `commands/__tests__/sync-output.test.ts`
- Modify: `lib/mcp/__tests__/git-tools.test.ts` (two tests appended to `describe("branch_sync tool", ...)`; the source file `lib/mcp/git-tools.ts` is not edited)
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `"commands/sync.ts",`)

**Interfaces:**
- Consumes: `asError`, `asRefusal`, `drawFailure`, `refusalNote`, `NOT_ON_A_BRANCH`, `uncommittedChanges`, `plural`, `errText` (Task 3); `RebaseResult.failure`, `RebaseResult.refused`, `conflictFailure` (Task 9); `ResetResult.failure`, `ResetResult.refused` (Task 10); the step runner of Task 8; `runEscalationFlow` (Task 11); `renderStackRefusal`, `STACK_REFUSAL_EXIT`, `StackRefusal` (`lib/stack-guard.ts`, with Task 12's hints); `out.print`, `out.fail`, `out.note` (5a), `out.payload`, `out.payloadOnStdout`, `out.line`, `out.callout`, `out.failure`, `out.section`, `out.summary`, `out.table`, `out.key`, `out.dim`, `out.cmd`.
- Produces, exported from `commands/sync.ts`:
  - `interface SyncSummary` (now exported) with a new member `failure?: out.FailureInput`.
  - `compactFailure(f: out.FailureInput): out.FailureInput`.
  - `refusalBlocks(refusal: StackRefusal): Block[]` (a `refused` line, the hint as `why`, the tool as `next`).
  - `branchEnding(summary: SyncSummary): Block[]` (the blocks `sync all` writes to stderr under a branch's heading once its sync ends: the stack refusal, a refused note for the uncommitted-changes guard, one `failure` block, or nothing; pure, for the tests and the renders).
  - `BRANCH_GAP: Block` (the empty table row the loop prints alone before every heading but the first).
  - `SyncSummary.refused?: boolean`, passed through from `asRefusal`, `ResetResult.refused` and `RebaseResult.refused`.
  - `reportSync(summary: SyncSummary, json: boolean): number` (prints how a sync ended; returns 4, 1 or 0; a refusal is a note on stderr, never `out.fail`).
  - `syncAllBlocks(summaries: SyncSummary[]): Block[]`.
  - `syncBranch`, `syncCommand` and `syncAllCommand` keep their signatures.

- [ ] **Step 1: Extract `reportSync` with today's prints, and pin the refusal**

This step moves code and changes no output, so the `--json` pin can be written against it first.

In `commands/sync.ts`, change `interface SyncSummary {` to `export interface SyncSummary {`.

Replace the tail of `syncCommand`, from `if (summary.refusal) {` to the function's closing brace (lines 527 to 537), with:

```ts
  const code = reportSync(summary, mode === "json");
  if (code !== 0) process.exit(code);
}
```

and add above `syncCommand`:

```ts
/** Prints how a sync ended and returns the exit code: 4 for a stack refusal, 1 for a failure, 0 otherwise. */
export function reportSync(summary: SyncSummary, json: boolean): number {
  if (summary.refusal) {
    if (json) console.log(renderStackRefusal(summary.refusal, "json"));
    else console.error(`\n  ${red}${renderStackRefusal(summary.refusal, "human")}${reset}\n`);
    return STACK_REFUSAL_EXIT;
  }
  if (summary.error) {
    console.error(`\n  ${red}${summary.error}${reset}\n`);
    return 1;
  }
  return 0;
}
```

Create `commands/__tests__/sync-output.test.ts` with the pin alone:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as out from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import type { StackRefusal } from "../../lib/stack-guard.ts";
import { reportSync, type SyncSummary } from "../sync.ts";

const refusal: StackRefusal = {
  kind: "stack-refusal",
  branch: "feature",
  source: "gitq",
  stack: { name: "s1", root: "master", parent: "master", children: [] },
  mrs: null,
  tool: "gitq sync --stack s1",
  hint: "feature is in stack s1, so changing it on its own would break the stack",
};

const summary = (over: Partial<SyncSummary>): SyncSummary => ({ branch: "feature", worktree: "/tmp/sample-app", resetResult: null, rebaseResult: null, pushed: false, ...over });

let io: CapturedOut;

beforeEach(() => {
  io = captureOut({ console: true });
  out.__test__.setHuman(() => false);
});
afterEach(() => {
  io.restore();
});

describe("reportSync under --json", () => {
  test("a stack refusal is the refusal on stdout, two-space indented, and the code is 4", () => {
    expect(reportSync(summary({ error: "refused", refusal }), true)).toBe(4);
    expect(io.stdout()).toBe(JSON.stringify(refusal, null, 2) + "\n");
    expect(io.stderr()).toBe("");
  });

  test("a sync that worked prints nothing and the code is 0", () => {
    expect(reportSync(summary({ pushed: true }), true)).toBe(0);
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("");
  });
});
```

Run: `bun test commands/__tests__/sync-output.test.ts commands/__tests__/sync-stack-guard.test.ts`
Expected: PASS, with `reportSync` still printing through `console`. These two tests must pass unchanged at the end of the task.

- [ ] **Step 2: Write the failing tests**

Add to the imports of `commands/__tests__/sync-output.test.ts`:

```ts
import { execFileSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import type { StackGuardRunners } from "../../lib/stack-guard.ts";
import { conflictFailure } from "../git/rebase.ts";
import { BRANCH_GAP, branchEnding, compactFailure, syncAllBlocks, syncBranch, syncCommand } from "../sync.ts";
import { ctxFor, exitCodeOf, git, makeRepo, trapExit } from "../git/__tests__/helpers.ts";
```

(merge `reportSync` and `SyncSummary` into the `../sync.ts` import) and append:

```ts
// lib/mcp/__tests__/git-tools.test.ts feeds this same text to branch_sync and
// pins the error an agent reads; change one and the other must follow.
const REFUSED_STDERR =
  "[refused] You have uncommitted changes\n" +
  "  why: Syncing rewrites the branch, and a conflict would lose them.\n" +
  "  next: Commit them, or set them aside with rt git stash push\n";

const uncommitted = {
  title: "You have uncommitted changes",
  why: "Syncing rewrites the branch, and a conflict would lose them.",
  next: ["Commit them, or set them aside with ", out.cmd("rt git stash push")],
};

const fetchFailed = { title: "Could not fetch from origin", details: "fatal: unable to reach the remote" };

describe("how a sync ends", () => {
  test("under --json the uncommitted-changes guard is a refused note on stderr, stdout empty, code 1", () => {
    expect(reportSync(summary({ error: uncommitted.title, failure: uncommitted, refused: true }), true)).toBe(1);
    expect(io.stderr()).toBe(REFUSED_STDERR);
    expect(io.stdout()).toBe("");
  });

  test("a person reads the same refused note, never a failure block", () => {
    expect(reportSync(summary({ error: uncommitted.title, failure: uncommitted, refused: true }), false)).toBe(1);
    expect(io.stderr()).toBe(REFUSED_STDERR);
  });

  test("under --json a failure is at most three lines, with git's own line beside the title", () => {
    const failure = { title: "Could not fetch from origin", details: "Command failed: git fetch origin\nfatal: unable to reach the remote\nhint: check the network" };
    expect(compactFailure(failure)).toEqual({ title: "Could not fetch from origin", hint: "fatal: unable to reach the remote" });
    reportSync(summary({ error: failure.title, failure }), true);
    expect(io.stderr()).toBe("Could not fetch from origin  fatal: unable to reach the remote\n");
  });

  test("compactFailure takes the last detail line when git names no fatal or error line, and keeps why and next", () => {
    expect(compactFailure({ title: "The rebase stopped on conflicts in 2 files", why: "rt put the branch back the way it was.", details: "a.ts\nb.ts\nA backup is at rt-backup/rebase/feature/2026-09-30T10-00-00" })).toEqual({
      title: "The rebase stopped on conflicts in 2 files",
      hint: "A backup is at rt-backup/rebase/feature/2026-09-30T10-00-00",
      why: "rt put the branch back the way it was.",
    });
    expect(compactFailure(uncommitted)).toEqual(uncommitted);
  });

  test("a rejected push keeps git's line that says why, not the generic error under it", () => {
    const failure = {
      title: "Could not push feature",
      details: "Command failed: git push --force-with-lease origin feature\nTo /tmp/origin.git\n ! [rejected]        feature -> feature (stale info)\nerror: failed to push some refs to '/tmp/origin.git'",
    };
    expect(compactFailure(failure)).toEqual({ title: "Could not push feature", hint: "! [rejected] feature -> feature (stale info)" });
  });

  test("a person gets the whole failure, details included", () => {
    const failure = { title: "Could not fetch from origin", details: "Command failed: git fetch origin\nfatal: unable to reach the remote" };
    expect(reportSync(summary({ error: failure.title, failure }), false)).toBe(1);
    expect(io.stderr()).toBe("Could not fetch from origin\n  Command failed: git fetch origin\n  fatal: unable to reach the remote\n");
  });

  test("a person reads a stack refusal as a refused note with the tool to run, code 4", () => {
    expect(reportSync(summary({ error: "refused", refusal }), false)).toBe(4);
    expect(io.stderr()).toBe(
      "[refused] rt will not sync feature on its own\n" +
        "  why: feature is in stack s1, so changing it on its own would break the stack\n" +
        "  next: gitq sync --stack s1\n",
    );
    expect(io.stdout()).toBe("");
  });
});

describe("sync all's summary", () => {
  const ok = (branch: string, over: Partial<SyncSummary> = {}): SyncSummary => summary({ branch, ...over });
  const upToDate = { status: "up-to-date" as const, branch: "b", target: "origin/main", commitsBehind: 0, resolvedFiles: [], unresolvedFiles: [], postResolveSteps: [], backupBranch: null };
  const stacked = { ...refusal, branch: "feature/stacked" };

  test("counts what was pushed, what was current, and names each failure", () => {
    const blocks = syncAllBlocks([ok("feature/a", { pushed: true }), ok("feature/b", { rebaseResult: upToDate }), ok("feature/login", { error: fetchFailed.title, failure: fetchFailed })]);
    expect(renderPlain(blocks)).toBe("[failed] 2 of 3 branches synced  1 pushed, 1 up to date, 1 failed\nfeature/login  failed  Could not fetch from origin\n");
  });

  test("a stack member and the uncommitted-changes guard are counted as refused, not failed", () => {
    expect(renderPlain(syncAllBlocks([ok("feature/a", { pushed: true }), ok("feature/stacked", { error: "refused", refusal: stacked })]))).toBe(
      "[refused] 1 of 2 branches synced  1 pushed, 0 up to date, 1 refused\nfeature/stacked  refused  it is part of a stack\n",
    );
    expect(
      renderPlain(
        syncAllBlocks([
          ok("feature/a", { pushed: true }),
          ok("feature/stacked", { error: "refused", refusal: stacked }),
          ok("feature/dirty", { error: uncommitted.title, failure: uncommitted, refused: true }),
          ok("feature/login", { error: fetchFailed.title, failure: fetchFailed }),
        ]),
      ),
    ).toBe(
      "[failed] 1 of 4 branches synced  1 pushed, 0 up to date, 2 refused, 1 failed\n" +
        "feature/stacked  refused  it is part of a stack\n" +
        "feature/dirty    refused  You have uncommitted changes\n" +
        "feature/login    failed   Could not fetch from origin\n",
    );
  });

  test("with no failure it is one done line", () => {
    expect(renderPlain(syncAllBlocks([ok("feature/a", { pushed: true })]))).toBe("[ok] 1 of 1 branch synced  1 pushed, 0 up to date\n");
  });
});

describe("what sync all prints under a branch once its sync ends", () => {
  test("a conflict that was undone shows its files and its backup", () => {
    const failure = conflictFailure({ unresolvedFiles: ["a.txt"], backupBranch: "rt-backup/rebase/feature/2026-09-30T10-00-00" });
    expect(renderPlain(branchEnding(summary({ error: failure.title, failure })))).toBe(
      "The rebase stopped on conflicts in 1 file\n  why: rt put the branch back the way it was.\n  a.txt\n  A backup is at rt-backup/rebase/feature/2026-09-30T10-00-00\n",
    );
  });

  test("a stack member and the uncommitted-changes guard are refused notes; an error with no failure is its own title; a sync that worked prints nothing", () => {
    expect(renderPlain(branchEnding(summary({ error: "refused", refusal })))).toBe(
      "[refused] rt will not sync feature on its own\n  why: feature is in stack s1, so changing it on its own would break the stack\n  next: gitq sync --stack s1\n",
    );
    expect(renderPlain(branchEnding(summary({ error: uncommitted.title, failure: uncommitted, refused: true })))).toBe(REFUSED_STDERR);
    expect(renderPlain(branchEnding(summary({ error: "rt could not tell which repo this worktree belongs to" })))).toBe("rt could not tell which repo this worktree belongs to\n");
    expect(branchEnding(summary({ pushed: true }))).toEqual([]);
  });

  test("the blank row between branches is one empty line", () => {
    expect(renderPlain([BRANCH_GAP])).toBe("\n");
  });
});

describe("what a sync prints on the way", () => {
  let root: string;
  let exit: { restore(): void };
  let savedSyncLogPath: string | undefined;

  const forgeDown: StackGuardRunners = {
    gitqStacks: async () => null,
    forgeOpenMrs: async () => ({ ok: false, error: "forge: not logged in" }),
  };

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "rt-sync-out-")));
    savedSyncLogPath = process.env.RT_SYNC_LOG_PATH;
    process.env.RT_SYNC_LOG_PATH = join(root, "sync.log");
    exit = trapExit();
  });
  afterEach(() => {
    exit.restore();
    if (savedSyncLogPath === undefined) delete process.env.RT_SYNC_LOG_PATH;
    else process.env.RT_SYNC_LOG_PATH = savedSyncLogPath;
    rmSync(root, { recursive: true, force: true });
  });

  /** A clone on `feature`, pushed, whose origin/main has moved on by one commit. */
  function staleClone(): string {
    const seed = makeRepo(root, "seed");
    const origin = join(root, "origin.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { stdio: "pipe" });
    git(seed, "remote", "add", "origin", origin);
    git(seed, "push", "-q", "origin", "main");
    const clone = join(root, "clone");
    execFileSync("git", ["clone", "-q", origin, clone], { stdio: "pipe" });
    git(clone, "config", "user.email", "sam@example.test");
    git(clone, "config", "user.name", "Sam Sample");
    git(clone, "checkout", "-qb", "feature");
    writeFileSync(join(clone, "f.txt"), "feature\n");
    git(clone, "add", "f.txt");
    git(clone, "commit", "-qm", "feature file");
    git(clone, "push", "-q", "-u", "origin", "feature");
    writeFileSync(join(seed, "m.txt"), "main\n");
    git(seed, "add", "m.txt");
    git(seed, "commit", "-qm", "main file");
    git(seed, "push", "-q", "origin", "main");
    return clone;
  }

  test("an unverified stack warns, then the fetch and the dry run each take a line, all on stdout", async () => {
    const clone = staleClone();
    const result = await syncBranch(clone, { dryRun: true, stackRunners: forgeDown, strictStackCheck: false });
    expect(result.error).toBeUndefined();
    expect(io.lines().slice(0, 4)).toEqual([
      "[warning] rt could not check whether this branch is part of a stack  syncing anyway",
      "  why: rt could not list the open merge requests, so it cannot tell whether this branch is in a stack (forge: not logged in)",
      "[ok] Fetched from origin",
      "[skipped] Would rebase feature onto origin/main  1 commit behind",
    ]);
    expect(io.stderr()).toBe("");
  });

  test("quiet prints nothing on either stream", async () => {
    const clone = staleClone();
    await syncBranch(clone, { dryRun: true, quiet: true, stackRunners: forgeDown, strictStackCheck: false });
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("");
  });

  test("uncommitted changes come back as a refusal and print nothing", async () => {
    const clone = staleClone();
    writeFileSync(join(clone, "f.txt"), "edited\n");
    const result = await syncBranch(clone, { stackRunners: forgeDown });
    expect(result.error).toBe("You have uncommitted changes");
    expect(result.failure).toEqual(uncommitted);
    expect(result.refused).toBe(true);
    expect(io.stdout()).toBe("");
  });

  test("a repo with no origin says so on stdout, and that is not a failure", async () => {
    const repo = makeRepo(root);
    expect(await exitCodeOf(() => syncCommand([], ctxFor(repo)))).toBeNull();
    expect(io.stdout()).toBe("[skipped] This repo has no origin, so there is nothing to sync\n  next: Add one with git remote add origin <url>\n");
    expect(io.stderr()).toBe("");
  });

  test("under --json that note goes to stderr and stdout stays empty", async () => {
    const repo = makeRepo(root);
    expect(await exitCodeOf(() => syncCommand(["--json"], ctxFor(repo)))).toBeNull();
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("[skipped] This repo has no origin, so there is nothing to sync\n  next: Add one with git remote add origin <url>\n");
  });
});
```

In `lib/mcp/__tests__/git-tools.test.ts`, append inside `describe("branch_sync tool", ...)`, after the test `exit 4 is a refusal whose error carries the stack refusal's hint`:

```ts
  // commands/__tests__/sync-output.test.ts pins that rt sync --json writes
  // exactly this text for the same guard; change one and the other must follow.
  const REFUSED_STDERR =
    "[refused] You have uncommitted changes\n" +
    "  why: Syncing rewrites the branch, and a conflict would lose them.\n" +
    "  next: Commit them, or set them aside with rt git stash push\n";
  const REFUSED_ERROR =
    "rt sync refused (exit 1): [refused] You have uncommitted changes   why: Syncing rewrites the branch, and a conflict would lose them.   next: Commit them, or set them aside with rt git stash push";

  test("exit 1 with no envelope reads what rt sync left on stderr, whole", async () => {
    const tool = gitToolDefs({ git: fakeGit(clean), guard, sync: async () => ({ code: 1, stdout: "", stderr: REFUSED_STDERR }) }).find((t) => t.name === "branch_sync")!;
    const r = await tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(REFUSED_ERROR);
  });

  test("a warning printed before a three-line ending stays out of the error", async () => {
    const warning = "[warning] Your repo folders setting could not be read  rt is looking in its usual places only\n  next: rt settings check\n";
    const tool = gitToolDefs({ git: fakeGit(clean), guard, sync: async () => ({ code: 1, stdout: "", stderr: warning + REFUSED_STDERR }) }).find((t) => t.name === "branch_sync")!;
    const r = await tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
    expect(r.error).toBe(REFUSED_ERROR);
  });
```

The uncommitted-changes guard is the common exit 1 an agent meets, so it is the case pinned; a failure (`compactFailure`'s title, `why`, `next`) reaches the tool the same way, without the `[refused]` tag. The second test holds only because the ending fills all three lines `detail()` keeps. A one- or two-line ending (a title alone, or a title and a `why`) after a warning lets the warning's last line or two into the tool's error, as a `console.warn` line does today (Decision 3); no test claims otherwise. `rt sync refused (exit 1)` is the tool's own wording (`lib/mcp/git-tools.ts:395`), not this slice's.

- [ ] **Step 3: Run them to verify they fail**

Run: `bun test commands/__tests__/sync-output.test.ts`
Expected: FAIL. `compactFailure`, `branchEnding`, `BRANCH_GAP` and `syncAllBlocks` are not exported; the failure and refusal tests find the old red line; the no-origin tests find three old lines on stdout in both modes.

Run: `bun test lib/mcp/__tests__/git-tools.test.ts -t "branch_sync"`
Expected: PASS already. These two pin what the tool makes of the new stderr; they fail only if `detail()` changes.

- [ ] **Step 4: Convert the imports, the summary type and `ensureOriginRemote`**

In `commands/sync.ts`:

Delete the tui import (line 22). The `out` import added in Task 8 stays. Add:

```ts
import type { Block } from "../lib/ui/protocol.ts";
import { asError, asRefusal, drawFailure, errText, NOT_ON_A_BRANCH, plural, refusalNote, uncommittedChanges } from "./git/shared.ts";
```

The existing import from `../lib/stack-guard.ts` already brings `type StackRefusal` (line 36).

In `SyncSummary`, add after `error?: string;`:

```ts
  /** What a person reads when `error` is set and the stack guard did not refuse. */
  failure?: out.FailureInput;
  /** `failure` is rt's own guard declining (uncommitted changes), drawn as a refused note. */
  refused?: boolean;
```

Replace the doc comment and body of `ensureOriginRemote` (lines 59 to 73) with:

```ts
/**
 * rt sync only makes sense against a remote: it fetches origin, rebases onto
 * origin/master, and pushes. A local-only repo has nothing to sync, so say so
 * and stop cleanly instead of letting `git fetch origin` fail with git's own
 * "does not appear to be a git repository".
 */
function ensureOriginRemote(cwd: string): boolean {
  const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd, stdio: "pipe" });
  if (r.status === 0) return true;
  out.print(out.line("skipped", "This repo has no origin, so there is nothing to sync"), out.callout("next", ["Add one with ", out.cmd("git remote add origin <url>")]));
  return false;
}
```

Rewrite the comment above `gitAsync` (line 75) as `/** Non-blocking git command, so a spinner can animate. */`.

- [ ] **Step 5: Convert `syncBranch`, site by site**

Line numbers are the file's at `5bc69f231`. Match on the quoted text.

1. Lines 120 to 121, the comment above the rebase-in-progress guard, becomes:

```ts
  // Guard: a rebase in progress comes first. getCurrentBranch returns null
  // during a rebase, which would read as a detached HEAD further down.
```

2. Line 133, the `error:` member that begins `"rebase in progress` becomes:

```ts
        ...asError({ title: "A rebase is already in progress here", next: ["Finish it with ", out.cmd("git rebase --continue"), ", or drop it with ", out.cmd("git rebase --abort")] }),
```

3. Line 146, `error: "not on a branch (detached HEAD)",` becomes `...asError(NOT_ON_A_BRANCH),`.
4. Lines 156 to 158 become:

```ts
    if (!opts.quiet) out.print(out.line("skipped", `${branch} is the default branch`, "nothing to sync"));
```

5. Line 176, the `error:` member that begins `"uncommitted changes` becomes `...asRefusal(uncommittedChanges("Syncing rewrites the branch, and a conflict would lose them.")),`.
6. Line 210, inside the quiet fetch's `catch`, `error: \`fetch failed: ${err}\`` becomes `...asError({ title: "Could not fetch from origin", details: errText(err) })`.
7. Lines 214 to 216, the `steps.run` call for the fetch, becomes:

```ts
      await steps.run("Fetching from origin…", () => gitAsync("fetch origin", cwd), {
        done: "Fetched from origin",
        error: "Could not fetch from origin",
      });
```

8. Line 224, `error: \`fetch failed: ${err}\`,` becomes `...asError({ title: "Could not fetch from origin", details: errText(err) }),`.
9. Line 253, `error: resetResult.error,` becomes:

```ts
          error: resetResult.error,
          failure: resetResult.failure,
          refused: resetResult.refused,
```

10. Line 263, the comment `// 3. Check if behind origin/master ...`, becomes `// 3. Behind origin/master: rebase`.
11. Line 287, the `error:` member of the rebase failure return, becomes:

```ts
      error: rebaseResult.status === "error" ? rebaseResult.error : paused ? undefined : (rebaseResult.failure?.title ?? "The rebase stopped on conflicts"),
      failure: paused ? undefined : rebaseResult.failure,
      refused: rebaseResult.refused,
```

The `syncLog.worktreeEnd(...)` call above it writes the sync log file and keeps its strings.

12. Lines 296 to 319, from `let pushed = false;` to the function's closing brace, become:

```ts
  let pushed = false;
  let pushFailure: out.FailureInput | undefined;
  if (needsPush && !opts.dryRun) {
    try {
      if (opts.quiet) {
        await gitAsync(`push --force-with-lease origin ${branch}`, cwd);
      } else {
        await steps.run("Pushing…", () =>
          gitAsync(`push --force-with-lease origin ${branch}`, cwd),
          { done: "Pushed", error: "Could not push" },
        );
      }
      pushed = true;
      syncLog.cmd(`push --force-with-lease origin ${branch}`, cwd, 0, "", "");
    } catch (err: any) {
      syncLog.cmd(`push --force-with-lease origin ${branch}`, cwd, 1, "", String(err));
      // The step already painted its failed line; the summary must still
      // count this branch as failed, never as synced.
      pushFailure = { title: `Could not push ${branch}`, details: errText(err) };
    }
  }

  syncLog.worktreeEnd(branch, pushFailure?.title);
  return { branch, worktree: cwd, resetResult, rebaseResult, pushed, ...(pushFailure ? asError(pushFailure) : {}) };
}
```

- [ ] **Step 6: Replace `syncAll` and add `refusalBlocks`, `branchEnding` and `syncAllBlocks`**

Replace the whole `syncAll` function (lines 324 to 456) with:

```ts
/** rt declining to sync a stacked branch: never a failure. */
export function refusalBlocks(refusal: StackRefusal): Block[] {
  return [
    out.line("refused", `rt will not sync ${refusal.branch} on its own`),
    out.callout("why", refusal.hint),
    ...(refusal.tool ? [out.callout("next", out.cmd(refusal.tool))] : []),
  ];
}

/**
 * The blocks sync all writes to stderr under a branch's heading once its sync
 * ends; the loop draws the same ending through out.note and drawFailure. The
 * API under it never prints a failure, so without this a conflicted branch
 * would show its heading and nothing else.
 */
export function branchEnding(s: SyncSummary): Block[] {
  if (s.refusal) return refusalBlocks(s.refusal);
  if (!s.error) return [];
  const failure = s.failure ?? { title: s.error };
  return s.refused ? refusalNote(failure) : [out.failure(failure)];
}

/** Each branch heading is its own render call, so rule 8's blank line above it is this row, written alone. */
export const BRANCH_GAP: Block = out.table([[""]]);

export function syncAllBlocks(summaries: SyncSummary[]): Block[] {
  const refused = summaries.filter((s) => s.refusal || s.refused);
  const failed = summaries.filter((s) => s.error && !s.refusal && !s.refused);
  const pushed = summaries.filter((s) => s.pushed).length;
  const upToDate = summaries.filter((s) => !s.error && s.rebaseResult?.status === "up-to-date" && !s.resetResult).length;
  const synced = summaries.length - refused.length - failed.length;
  const status = failed.length > 0 ? "failed" : refused.length > 0 ? "refused" : "done";
  return [
    out.summary(status, `${synced} of ${plural(summaries.length, "branch", "branches")} synced`, [
      `${pushed} pushed`,
      `${upToDate} up to date`,
      ...(refused.length > 0 ? [`${refused.length} refused`] : []),
      ...(failed.length > 0 ? [`${failed.length} failed`] : []),
    ]),
    ...(refused.length + failed.length > 0
      ? [
          out.table([
            ...refused.map((s) => [out.key(s.branch), out.dim("refused"), s.refusal ? "it is part of a stack" : (s.failure?.title ?? s.error ?? "")]),
            ...failed.map((s) => [out.key(s.branch), out.dim("failed"), s.failure?.title ?? s.error ?? ""]),
          ]),
        ]
      : []),
  ];
}

async function syncAll(
  repoIdentity: string,
  opts: { dryRun?: boolean },
): Promise<void> {
  const { daemonQuery, isDaemonRunning } = await import("../lib/daemon-client.ts");
  const running = await isDaemonRunning();

  if (!running) {
    out.fail({ title: "The rt daemon is not running", why: "Syncing every worktree needs it to find them.", next: out.cmd("rt daemon start") });
    process.exit(1);
  }

  const reposResult = await daemonQuery("repos");

  if (!reposResult?.ok || !reposResult.data) {
    out.fail({ title: "The rt daemon did not answer", next: out.cmd("rt daemon logs") });
    process.exit(1);
  }

  // daemon "repos" response: { repos: { [name]: { path, worktrees } }, watched: [...] }
  const repoMap = (reposResult.data as any)?.repos as Record<
    string,
    { path: string; worktrees: { path: string; branch: string }[] }
  > | undefined;

  if (!repoMap) {
    out.fail({ title: "The rt daemon gave an answer rt could not read", next: out.cmd("rt daemon logs") });
    process.exit(1);
  }

  const repoEntry = repoMap[repoIdentity];
  if (!repoEntry) {
    out.fail({ title: `The rt daemon does not know ${repoLabel(repoIdentity)} yet`, next: out.cmd("rt repos register") });
    process.exit(1);
  }

  const repoName = repoLabel(repoIdentity);
  const defaultBranches = new Set(["main", "master", "develop"]);
  const syncable = repoEntry.worktrees.filter((wt) => !defaultBranches.has(wt.branch) && wt.branch !== "HEAD");

  if (syncable.length === 0) {
    out.print(out.line("skipped", "There are no feature branches to sync"));
    return;
  }

  const { createRealProbes } = await import("../lib/setup/probes.ts");
  const { getRepoIdentity } = await import("../lib/repo.ts");
  const stackRunners = createStackGuardRunners(createRealProbes());
  const summaries: SyncSummary[] = [];

  for (const [i, wt] of syncable.entries()) {
    if (i > 0) out.print(BRANCH_GAP);
    out.print(out.section(wt.branch, repoName));

    // The daemon's cached path may be gone from disk: a chdir that throws
    // must not end the loop, and the cwd must come back whatever happens.
    const origCwd = process.cwd();
    let identity: ReturnType<typeof getRepoIdentity> = null;
    try {
      process.chdir(wt.path);
      identity = getRepoIdentity();
    } catch { /* counted as a failure below */ }
    finally {
      process.chdir(origCwd);
    }

    const summary: SyncSummary = identity
      ? await syncBranch(wt.path, { dryRun: opts.dryRun, quiet: false, onConflict: "abort", stackRunners })
      : { branch: wt.branch, worktree: wt.path, resetResult: null, rebaseResult: null, pushed: false, ...asError({ title: "rt could not tell which repo this worktree belongs to" }) };
    summaries.push(summary);

    if (summary.refusal) out.note(...refusalBlocks(summary.refusal));
    else if (summary.error) drawFailure(summary.failure ?? { title: summary.error }, summary.refused);
  }

  out.print(...syncAllBlocks(summaries));
}
```

`sync all` draws each branch's ending on stderr, under that branch's heading on a terminal, as the spec's rule 3 and the refusal ruling say: a stack member through `out.note(...refusalBlocks(...))`, the uncommitted-changes guard as a refused note and any other error through `out.fail`, both by `drawFailure`. `branchEnding` is the same blocks as a pure function, which the tests and Task 14's renders use. The exit code stays 0, as today. The blank row is its own `out.print` call before every heading but the first: put in one call with the section, the styled renderer would add its own gap above the section as well.

- [ ] **Step 7: Convert `reportSync` and `syncCommand`**

Replace the `reportSync` of Step 1 with:

```ts
/**
 * branch_sync reads the last three stderr lines of a refused sync, so under
 * --json a failure is at most three: the title with git's own line beside
 * it, the why, the next.
 */
export function compactFailure(f: out.FailureInput): out.FailureInput {
  const lines = (f.details ?? "").split("\n").map((l) => l.trim().replace(/\s+/g, " ")).filter(Boolean);
  // A rejected push says why on its "! [rejected] ... (stale info)" line; the
  // "error: failed to push" under it says only that it failed.
  const gist = lines.find((l) => l.startsWith("! [")) ?? lines.find((l) => /^(fatal|error):/.test(l)) ?? lines.at(-1);
  return { title: f.title, ...(gist ? { hint: gist } : {}), ...(f.why ? { why: f.why } : {}), ...(f.next !== undefined ? { next: f.next } : {}) };
}

/** Prints how a sync ended and returns the exit code: 4 for a stack refusal, 1 for a failure, 0 otherwise. */
export function reportSync(summary: SyncSummary, json: boolean): number {
  if (summary.refusal) {
    if (json) out.payload(renderStackRefusal(summary.refusal, "json") + "\n");
    else out.note(...refusalBlocks(summary.refusal));
    return STACK_REFUSAL_EXIT;
  }
  if (summary.error) {
    const failure = summary.failure ?? { title: summary.error };
    drawFailure(json ? compactFailure(failure) : failure, summary.refused);
    return 1;
  }
  return 0;
}
```

In `syncCommand`, move the escalation import and the mode above the origin check, and add the payload call. The lines from `if (!ensureOriginRemote(cwd)) return;` through `const mode = resolveEscalationMode(args, isTTY);` become:

```ts
  const { resolveEscalationMode, runEscalationFlow } = await import("../lib/rebase-escalation.ts");
  const isTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  const mode = resolveEscalationMode(args, isTTY);

  // Under --json stdout is the bundle or the refusal and nothing else: every
  // note this verb prints moves to stderr with this.
  if (mode === "json") out.payloadOnStdout();

  if (!ensureOriginRemote(cwd)) return;
```

Rewrite the file's header comment so it holds no long dash: line 2 becomes ` * rt sync: daily workflow sync composer.` The comment above `syncAllCommand` becomes `/** rt sync all: syncs every worktree of the current repo (repo context only) */`.

- [ ] **Step 8: Delete the allowlist line and check for leftovers**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `  "commands/sync.ts",`.

Run: `rg -n "console\.|process\.std|steps\.log|\\$\{(dim|red|green|bold|reset|yellow|cyan)\}" commands/sync.ts`
Expected: no hits.

Run: `rg -c "commands/git/|commands/sync.ts|lib/rebase-escalation.ts" lib/__tests__/raw-output-allowlist.json`
Expected: no output (zero matches): all ten of this slice's lines are gone.

- [ ] **Step 9: Run the tests**

Run: `bun test commands/__tests__/sync-output.test.ts commands/__tests__/sync-stack-guard.test.ts lib/mcp/__tests__/git-tools.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS, the two pins of Step 1 unchanged. `sync-stack-guard.test.ts` is unedited: `summary.error` still contains `s1` for a stack refusal.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add commands/sync.ts commands/__tests__/sync-output.test.ts lib/mcp/__tests__/git-tools.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "sync: sync and sync all print through the output layer; a refused --json sync is three stderr lines

<the executing session's own Co-Authored-By line>"
```

---

### Task 14: Readers, renders, AGENTS.md and every gate

**Files:**
- Modify: `AGENTS.md` ("Output layer" section: append; never rewrite what is there)
- Modify: `docs/design/output-layer/README.md`
- Create under `docs/design/output-layer/`: `git-dark.png`, `git-light.png`, `diff-dark.png`, `diff-light.png`, `sync-dark.png`, `sync-light.png`

**Interfaces:**
- Consumes: `statusBlocks`, `logBlocks`, `branchesBlocks`, `diffBlocks` (Task 4); `stashBlocks`, `tagBlocks`, `UNDO_REFUSED` (Task 5); `conflictFailure` (Task 9); `manualReport` (Task 11); `refusalBlocks`, `branchEnding`, `syncAllBlocks` (Task 13); `uncommittedChanges`, `refusalNote`, `NOT_ON_A_BRANCH` (Task 3); `usageFailure` (5a); `ui/dist/rt-ui`. When the slice was cut in two at Task 7 Step 8, run this task once per half with the sets and paragraphs named there.
- Produces: the renders the PR carries and the rules the next reader finds in `AGENTS.md`.

- [ ] **Step 1: Look once more for a reader of the old text**

The spec asks each conversion PR to search for text scraped from the verbs it converts. Run each from the repo root:

- `rg -n "rt git (status|log|branches|diff|amend|undo|stash|tag|pull|push|rebase|reset|backup|restore|upstream)" plugins/mattstack skills apps/board/skills`
- `rg -n "origin fetched|already up to date with|nothing to sync|unresolvable conflict|backed up|auto-resolved" plugins/mattstack skills apps/board/skills rt-tray/Sources-core e2e`
- `rg -n "rt sync" plugins/mattstack skills apps/board/skills`
- `rg -n "is a member of stack|untracked stack|rule out a stack|could not determine the default branch|branch ownership is unknown|already checked out in another worktree" --glob '!docs/**' .`

Expected: the first two print nothing. The third prints the `branch_sync` tool description, `plugins/mattstack/CERTIFICATION.md`, and the `rt sync refused (exit N): ...` rows of `plugins/mattstack/attachments/forge/rebase-worktree/SKILL.md`, in Task 12's form. The fourth prints only fixtures that hold their own made-up hint or badge, which Task 12 leaves alone: `lib/mcp/__tests__/git-tools.test.ts:735` and `:738`, `lib/__tests__/stack-guard.test.ts:381` and `:392` (the `renderStackRefusal` fixture), `lib/mission/__tests__/driver.test.ts:927`, and a code comment at `lib/mcp/mr-read-tools.ts:98`. A hit outside those lists is a reader this plan missed: fix it in this PR and say so in the report.

- [ ] **Step 2: Write the render inputs**

Run: `bun run ui:build`

In the session scratchpad (not the repo), write `blocks.ts`. It prints NDJSON for one named set, using the real builders. Replace `<repo>` with the worktree's absolute path. All sample names are invented.

```ts
// usage: bun blocks.ts <git|diff|sync> > in.ndjson
import * as out from "<repo>/lib/ui/out.ts";
import { encodeLine } from "<repo>/lib/ui/protocol.ts";
import { usageFailure } from "<repo>/lib/ui/usage.ts";
import { branchesBlocks, diffBlocks, logBlocks, statusBlocks } from "<repo>/commands/git/inspect.ts";
import { stashBlocks, tagBlocks, UNDO_REFUSED } from "<repo>/commands/git/mutate.ts";
import { conflictFailure } from "<repo>/commands/git/rebase.ts";
import { NOT_ON_A_BRANCH, refusalNote, uncommittedChanges } from "<repo>/commands/git/shared.ts";
import { manualReport } from "<repo>/lib/rebase-escalation.ts";
import { branchEnding, refusalBlocks, syncAllBlocks } from "<repo>/commands/sync.ts";

const branch = (name: string, over: object) => ({ name, current: false, sha: "0123456789abcdef", upstream: null, upstreamGone: false, ahead: null, behind: null, committedAt: "2026-09-30T10:00:00Z", ...over });
const backup = "rt-backup/rebase/feature/login/2026-09-30T10-00-00";
const bundle = { kind: "rebase-conflict" as const, state: "mid-rebase" as const, branch: "feature/login", target: "origin/main", commitsBehind: 3, unresolvedFiles: ["src/app.ts", "README.md"], autoResolvedFiles: [], backupBranch: backup, branchCommits: [], targetCommits: [], hint: "" };
const summary = (b: string, over: object) => ({ branch: b, worktree: "/Users/sample/code/sample-app", resetResult: null, rebaseResult: null, pushed: false, ...over });
const stacked = { kind: "stack-refusal" as const, branch: "feature/stacked", source: "gitq" as const, stack: { name: "login", root: "main", parent: "feature/base", children: [] }, mrs: null, tool: "gitq sync --stack login", hint: "feature/stacked is in stack login, so changing it on its own would break the stack" };
const searchFailure = uncommittedChanges("Syncing rewrites the branch, and a conflict would lose them.");
const search = summary("feature/search", { error: searchFailure.title, failure: searchFailure, refused: true });
const pushFailed = { title: "Could not push feature/billing", details: "! [rejected] feature/billing -> feature/billing (stale info)" };
const billing = summary("feature/billing", { error: pushFailed.title, failure: pushFailed });

const sets: Record<string, object[]> = {
  git: [
    ...statusBlocks({ branch: "feature/login", detached: false, upstream: "origin/feature/login", ahead: 1, behind: 2, clean: false, files: [
      { path: "src/app.ts", kind: "modified", staged: true, unstaged: true },
      { path: "notes.md", kind: "untracked", staged: false, unstaged: true },
      { path: "src/login.ts", kind: "renamed", staged: true, unstaged: false, originalPath: "src/signin.ts" },
    ] }),
    ...statusBlocks({ branch: "main", detached: false, upstream: "origin/main", ahead: null, behind: null, clean: true, files: [] }),
    ...logBlocks([
      { sha: "0123456789abcdef", parents: [], authorName: "Sam Sample", authorEmail: "sam@example.test", authorDate: "2026-09-30T10:00:00Z", subject: "add the login form", body: "" },
      { sha: "fedcba9876543210", parents: [], authorName: "Sam Sample", authorEmail: "sam@example.test", authorDate: "2026-09-29T09:00:00Z", subject: "first commit", body: "" },
    ]),
    ...branchesBlocks([
      branch("main", { current: true, upstream: "origin/main", ahead: 0, behind: 0 }),
      branch("feature/login", { upstream: "origin/feature/login", ahead: 2, behind: 1 }),
      branch("old-idea", { upstream: "origin/old-idea", upstreamGone: true }),
    ]),
    ...stashBlocks([{ index: 0, branch: "feature/login", message: "WIP on feature/login: half a form" }]),
    ...tagBlocks([{ name: "v1.2.3", sha: "aaaaaaaaaaaaaaaa", annotated: true, targetSha: "0123456789abcdef" }, { name: "nightly", sha: "fedcba9876543210", annotated: false, targetSha: "fedcba9876543210" }]),
    out.line("done", "Undid commit 01234567", "its changes are back in your working tree"),
    out.line("done", "Backed up feature/login", "rt-backup/manual/feature/login/2026-09-30T10-00-00"),
    out.line("pending", "Restore feature/login to 0123456", "rebase backup from 2h ago"),
    out.callout("note", "This throws away every change made since that backup."),
    out.line("skipped", "Would push feature/login to origin/feature/login", "dry run, forcing with a lease"),
    out.callout("note", "This branch tracks origin/main. A real push points it at origin/feature/login."),
    out.copy("git push --force-with-lease -u origin feature/login", "the command"),
    out.line("running", "Pulling feature/login from origin"),
    out.line("done", "Pulled feature/login", "from origin"),
    out.failure(NOT_ON_A_BRANCH),
    ...refusalNote(uncommittedChanges("A pull could overwrite them.")),
    ...UNDO_REFUSED.pushed,
    out.line("refused", "rt will not rewrite this branch's history"),
    out.callout("why", "feature/login is checked out in another worktree: /Users/sample/code/sample-app-login"),
    out.failure(usageFailure("Which file?", "usage: rt git diff <path> [--staged] [--json]")),
    out.failure({ title: "Could not push that tag", details: "error: src refspec v9 does not match any\nerror: failed to push some refs to 'origin'" }),
    out.failure({ title: "feature/login and origin/feature/login have diverged", why: "This usually follows a rebase or an amend, and a plain push would be rejected.", next: out.cmd("rt git push force") }),
  ],
  diff: [
    ...diffBlocks({ path: "src/app.ts", kind: "text", hunks: [
      { oldStart: 10, oldLines: 5, newStart: 10, newLines: 6, header: "@@ -10,5 +10,6 @@ export function login(form: LoginForm) {", lines: [
        { type: "context", content: "  const user = form.user.trim();", oldLineNo: 10, newLineNo: 10 },
        { type: "del", content: "  if (!user) return null;", oldLineNo: 11, newLineNo: null },
        { type: "add", content: "  if (!user) return { ok: false, why: \"no user\" };", oldLineNo: null, newLineNo: 11 },
        { type: "add", content: "  remember(user);", oldLineNo: null, newLineNo: 12 },
        { type: "context", content: "  return signIn(user, form.password);", oldLineNo: 12, newLineNo: 13 },
      ] },
      { oldStart: 40, oldLines: 3, newStart: 41, newLines: 2, header: "@@ -40,3 +41,2 @@", lines: [
        { type: "context", content: "}", oldLineNo: 40, newLineNo: 41 },
        { type: "del", content: "// a comment long enough to pass the edge of a narrow pane and show how a deleted line wraps inside its band", oldLineNo: 41, newLineNo: null },
        { type: "context", content: "", oldLineNo: 42, newLineNo: 42 },
      ] },
    ] }),
    ...diffBlocks({ path: "logo.png", kind: "binary", hunks: [] }),
  ],
  sync: [
    out.line("warn", "rt could not check whether this branch is part of a stack", "syncing anyway"),
    out.callout("why", "rt could not list the open merge requests, so it cannot tell whether this branch is in a stack (gh pr list failed: not logged in)"),
    out.line("done", "Fetched from origin"),
    out.line("warn", "feature/login and origin/feature/login have diverged", "matching origin first"),
    out.line("done", "Saved a backup", "rt-backup/reset/feature/login/2026-09-30T10-00-00"),
    out.line("done", "Reset feature/login to origin/feature/login", "origin was rebased"),
    out.line("done", "Saved a backup", backup),
    out.line("running", "Rebasing feature/login onto origin/main", "3 commits behind"),
    out.line("done", "Resolved pnpm-lock.yaml for you", "rule: theirs"),
    out.line("running", "Running a follow-up step", "pnpm install"),
    out.line("done", "Rebased feature/login onto origin/main", "1 conflict resolved for you"),
    out.line("done", "Pushed"),
    out.line("needs-you", "2 files have conflicts rt cannot resolve", "the rebase is paused"),
    out.table([["src/app.ts"], ["README.md"]]),
    ...manualReport(bundle),
    out.failure(conflictFailure({ unresolvedFiles: ["src/app.ts", "README.md"], backupBranch: backup })),
    ...refusalBlocks(stacked),
    out.failure({ title: "The agent did not finish in 10 minutes", why: "Nothing was pushed.", details: `Pane p7 is still open.\nA backup is at ${backup}` }),
    out.verbatim(["Resolving src/app.ts ...", "I am not sure which side should win here."], "the end of the pane"),
    out.section("feature/login", "sample-app"),
    out.line("done", "Fetched from origin"),
    out.line("done", "feature/login is up to date with origin/main"),
    out.section("feature/search", "sample-app"),
    ...branchEnding(search),
    out.section("feature/stacked", "sample-app"),
    ...branchEnding(summary("feature/stacked", { error: "refused", refusal: stacked })),
    out.section("feature/billing", "sample-app"),
    out.line("done", "Fetched from origin"),
    out.line("done", "Rebased feature/billing onto origin/main"),
    out.line("failed", "Could not push", "rejected by the remote"),
    ...branchEnding(billing),
    ...syncAllBlocks([
      summary("feature/login", { rebaseResult: { status: "up-to-date", branch: "feature/login", target: "origin/main", commitsBehind: 0, resolvedFiles: [], unresolvedFiles: [], postResolveSteps: [], backupBranch: null } }),
      search,
      summary("feature/stacked", { error: "refused", refusal: stacked }),
      billing,
    ]),
  ],
};
process.stdout.write(encodeLine({ t: "hello", protocol: 1 }) + sets[process.argv[2] ?? "git"]!.map(encodeLine).join(""));
```

Reuse `ansi-page.ts` from the 5a plan's Task 14 Step 1 (it turns the helper's ANSI into one HTML page on a dark or a light ground); copy it into the scratchpad as it is written there.

- [ ] **Step 3: Render six pages**

For each of `git` (width 100), `diff` (width 80) and `sync` (width 100), render twice. The dark page uses no `COLORFGBG`; the light page sets `COLORFGBG=0;15`, which is how the light diff tints are reached. Run these one at a time from the scratchpad, then the same five lines for `diff` and `sync` with their widths:

```bash
bun blocks.ts git > git.ndjson
COLORTERM=truecolor TERM=xterm-256color <repo>/ui/dist/rt-ui render --width 100 < git.ndjson > git-dark.ansi
COLORTERM=truecolor TERM=xterm-256color COLORFGBG="0;15" <repo>/ui/dist/rt-ui render --width 100 < git.ndjson > git-light.ansi
bun ansi-page.ts dark git < git-dark.ansi > git-dark.html
bun ansi-page.ts light git < git-light.ansi > git-light.html
```

- [ ] **Step 4: Screenshot both schemes and look**

Serve the scratchpad over http on 127.0.0.1 (`python3 -m http.server 4173 --bind 127.0.0.1`; `file:` is blocked) and screenshot each of the six pages with Fast Browser (the `fast-browser:browser-driver` agent, or the Fast Browser MCP tools directly). Save the six PNGs into `docs/design/output-layer/` under the names in this task's Files list.

Then read each PNG and write down plainly what reads wrong. Check these in particular, on both backgrounds:

- The diff: added and deleted rows as bands with readable text on both grounds, the hunk header distinct from the lines, the long deleted line wrapped inside its band. This slice is the first caller of the `diff` block, so this is the first time it is seen with real content.
- Branch names in lavender, in `status`, `branches` and the `sync all` table, and readable on white.
- The `STAGED` column: do `yes`, `no` and `partly` read at a glance, or does the column need a glyph.
- A `running` line that stays on screen above a child's output (`Pulling ...`, `Rebasing ...`): does a mint dot on a line that has already finished read as still running.
- The `sync all` sections: in this one-call render the section block draws its own gap; on a real run each heading is its own call and `BRANCH_GAP` writes the blank row instead. Run the real verb once against a scratch repo with two worktrees (or read `out.table([[""]])` rendered alone) and say whether the styled blank row reads as exactly one empty line. `feature/search` was refused before it printed anything, so its refused note sits straight under its heading; `feature/billing` shows its failed push step and then its failure. On a terminal those endings come on stderr, between stdout lines: say whether they read as belonging to their branch.
- Every refusal (the undo, the ownership guard, the uncommitted-changes guard, the stack member): the refused glyph and color, never coral, with its `why` and `next` under it.
- The summary: `[failed]` coral, `1 of 4 branches synced` with four counts (`0 pushed, 1 up to date, 2 refused, 1 failed`; plain form `[failed] 1 of 4 branches synced  0 pushed, 1 up to date, 2 refused, 1 failed`, since `feature/login` is up to date and counts as synced), then the two refused branches and the failed one, each with its status word in the middle column.

A fault found here is fixed in the task that owns the code, re-rendered, and named in the report. Do not declare success from the tests.

- [ ] **Step 5: Update `docs/design/output-layer/README.md`**

Add three rows to the table:

```markdown
| `git-dark.png`, `git-light.png` | the git verbs at 100 columns: `status` dirty and clean, `log`, `branches`, `stash list`, `tag list`, the result lines of undo, backup, restore, push and pull, three refusals (an undo of a pushed commit, the ownership guard, uncommitted changes) and four failures (detached HEAD, a usage failure, a git error, a diverged push) |
| `diff-dark.png`, `diff-light.png` | `rt git diff` at 80 columns: two hunks with a long deleted line, and a binary file. The light page is rendered with `COLORFGBG=0;15` |
| `sync-dark.png`, `sync-light.png` | `rt sync` at 100 columns: the stack warning, a reset and a rebase with a resolved conflict, a paused conflict with the manual report, the conflict failure, the stack refusal, an agent that timed out, and `sync all` with four branches (two refused and one failed, each ending under its heading) and its summary |
```

- [ ] **Step 6: Append to `AGENTS.md`**

At the end of the "Output layer" section (after its last paragraph, before the next `##` heading), append, wrapped at about 78 columns like the paragraphs above it:

```markdown
The git verbs fail through `commands/git/shared.ts`: `failPlain(json, title,
message)` keeps git's own message as the `--json` error and prints it under a
plain title for a person, `failUsage` does the same for a usage string, and
both exit 1. A refusal by policy (the ownership guard, an undo rt will not
do, the uncommitted-changes guard, a stack member under `rt sync`) is never
a failure: `refuseWith`, `refusalNote` and `drawFailure` print a `refused`
note on stderr and keep the `--json` error and exit code. The API under
`rt sync` (`rebaseOnto`, `resetToOrigin`, `syncBranch`) never prints a
failure: a result that ends badly carries `failure` beside `error`, plus
`refused: true` when it is a refusal, and the caller draws it with
`drawFailure`, so `sync` and `git rebase` show one block for one cause on
stderr, and `sync all` writes each branch's ending to stderr under its
heading, with one blank row between branches. Their progress lines go to
stdout through `out.print` and stop under `quiet`.

`rt sync --json` and `rt git rebase --json` call `out.payloadOnStdout()`
first, so stdout is the conflict bundle or the stack refusal and nothing
else; a step's plain line and every note go to stderr. A failed
`rt sync --json` writes one failure, last on stderr, in at most three lines
(`compactFailure` in `commands/sync.ts`), because `branch_sync` builds its
error from the last three stderr lines (`detail` in `lib/mcp/git-tools.ts`).
A new sync failure with `details` needs no care; a new line printed to stderr
after the failure breaks the tool's error.

`lib/ui/steps.ts` prints nothing by hand: off a terminal a step's ending is
`out.print(out.line("done" or "failed", ...))`, and a helper that dies costs
one warning through `out.note` and a line in the CLI log. The runner has no
`log()`; a line between steps is an `out.print` at the call site.
```

- [ ] **Step 7: Run every gate**

Run each from the repo root, one at a time:

- `bun run ui:build`
- `bun run ui:test`
- `bun run typecheck`
- `bun run test`
- `bun run test:e2e`
- `bun run test:pty`
- `bun run picker:check`
- `bun run format:check`
- `bun run check` (what the `static` CI job runs)

Expected: all pass. Known noise, per the herd notes: about ten rotating load flakes in the unit suite (flavor-takeover, sync-stack-guard, git reset, setup-connect oauth, daemon-logdy-config) and the `rt plugin new` e2e on this machine. Two of those names are files this slice touches: a failure in `commands/__tests__/sync-stack-guard.test.ts` or `commands/git/__tests__/reset.test.ts` counts as a flake only if the file passes three times running alone (`bun test <file>`), and the report gives both results. `bun run docs:gen` is not needed: no command description changed. `.github/workflows/e2e.yml` is not edited: this slice adds no pty test.

- [ ] **Step 8: Commit**

```bash
git add AGENTS.md docs/design/output-layer/README.md docs/design/output-layer/git-dark.png docs/design/output-layer/git-light.png docs/design/output-layer/diff-dark.png docs/design/output-layer/diff-light.png docs/design/output-layer/sync-dark.png docs/design/output-layer/sync-light.png
```

```bash
git commit -m "docs: output layer rules for the git verbs and sync, with renders

<the executing session's own Co-Authored-By line>"
```

---

### Task 15: Ship

**Files:** none beyond what a rebase touches.

**Interfaces:**
- Consumes: the finished branch.
- Produces: one PR against `m4ttstack/mattstack`.

- [ ] **Step 1: Rebase and re-check what other work added**

Run: `git fetch origin`
Run: `git rebase origin/main`

Phases 3 and 4 and other phase 5 slices may have merged. Merge by hand, per ruling 7:

- `lib/__tests__/raw-output-allowlist.json`: keep every deletion from both sides. After the rebase, run `rg -c "commands/git/|commands/sync.ts|lib/rebase-escalation.ts" lib/__tests__/raw-output-allowlist.json`; expected: no output.
- `AGENTS.md` "Output layer": keep their paragraphs, then this slice's.
- `docs/design/output-layer/README.md`: keep their rows, then this slice's.
- `plugins/mattstack/.claude-plugin/plugin.json`: on a conflict, take main's version; the check below sets this PR's.

Then, after every rebase and in part 2 of a split (part 1 does not touch the plugin), always run: `bun scripts/ci/plugin-version-bumped.ts --base origin/main --plugin plugins/mattstack`
Expected: passes. On failure (another slice, 5d1 for one, bumped the same file and merged first, or git merged two identical bumps into one), set `"version"` to one patch above `git show origin/main:plugins/mattstack/.claude-plugin/plugin.json`, commit that file alone (`plugin: bump the version above main`), and run the check again until it passes.

Then run: `grep -rn "\[failed\] " commands/git commands/__tests__/sync-output.test.ts lib/__tests__/rebase-escalation.test.ts lib/ui/__tests__/steps.test.ts`
Expected: only lines where a `failed` status is a `line` or a `summary` (`[failed] Could not push  rejected by the remote`, `[failed] 2 of 3 branches synced ...`, `[failed] 1 of 4 branches synced ...`). A failure block that opens the output never carries the tag.

Then run: `grep -rn "\[refused\] " commands/git commands/__tests__/sync-output.test.ts`
Expected: only the undo reasons, the `refuseWith` and `drawFailure` tests, the uncommitted-changes guard (pull, rebase, reset origin, sync, sync all) and the stack refusal: every policy refusal, and nothing a verb cannot get past (no detached HEAD, no diverged push, no rebase in progress).

Then run: `rg -n "steps\.log\(|createStepRunner\(\)\.log" commands lib`
Expected: no hits. Another slice that started calling `StepRunner.log` after this plan was written must move that call to `out.print`; say so in the report rather than restoring `log`.

- [ ] **Step 2: Re-run the gates after the rebase**

Run, one at a time: `bun run ui:build`, `bun run ui:test`, `bun run typecheck`, `bun run test`, `bun run test:e2e`, `bun run test:pty`, `bun run picker:check`, `bun run format:check`, `bun run check`.
Expected: all pass, with the same known noise as Task 14 Step 7.

- [ ] **Step 3: Push**

Push the branch with the `git_push` MCP tool (it pushes one explicit refspec to the branch's same-named upstream).

- [ ] **Step 4: Open the PR**

Run: `gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 5b, git and sync" --body-file <scratchpad>/pr-body-5b.md` (with ` (part 1)` or ` (part 2)` at the end of the title when Task 7 Step 8 cut the slice in two).

The body, in the style of PR 639: one framing paragraph; bold-labelled bullet groups (**Git verbs**: `status`, `log`, `branches` and `diff` as blocks, the mutating verbs' result lines, one failure exit in `commands/git/shared.ts`, policy refusals as `refused` notes rather than failures, the credential reply as a payload; **Sync**: progress on stdout, failures as one block from `rebaseOnto`, `resetToOrigin` and `syncBranch`, the escalation endings, the uncommitted-changes guard as a refused note, `sync all` with sections, one blank row between branches, each branch's ending on stderr under its heading, and a summary; **Guards**: the stack hint and the ownership detail in plain words, with the rebase-worktree skill rows rewritten to key on structure and the plugin bump; **Steps**: `lib/ui/steps.ts` prints through the layer and loses `log()`; **Also**: `rt sync --json` and `rt git rebase --json` keep stdout for the envelope, where a fetch step's plain line and the no-origin note used to land on it; a failed or refused `rt sync --json` now ends in at most three stderr lines, so the error `branch_sync` returns on exit 1 changes wording: it was rt's old one-line red message, and it is now the title, the `why` and the `next` joined on one line (with a `[refused]` tag for the uncommitted-changes guard); **Follow-up**: `rt sync all` still exits 0 when a branch failed or was refused, which needs Matt's ruling on whether it should exit 1; team packs that compile `rebase-worktree` pick up the new rows at their next `rt skills compile`; and the other open questions in "Decisions this plan made"); the renders; a verification line with the gate results and what the renders showed; and the last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 5: Report**

Report the PR url, the gate results, the flakes seen with both results, and what the renders showed. Do not merge: the shepherd watches CI and CodeRabbit and merges.

For the PR that carries Task 12 (the only one if the slice was not cut; part 2 if it was), the report also tells the shepherd two things (cross-phase ruling 13):

- If any other PR touching `plugins/mattstack` merges before this one, this PR must rebase on main, set `"version"` to one patch above main's again, run `bun scripts/ci/plugin-version-bumped.ts --base origin/main --plugin plugins/mattstack`, and re-run CI before it merges.
- The `CERTIFICATION.md` ledger row to append, verbatim from Task 12 Step 5, with today's date filled in.

---

## Decisions this plan made that the scoping document and the spec do not settle

Each is the plan's best reading; Matt or the reviewer may overrule one before execution.

1. **`StepRunner.log` is removed, not moved.** The scoping document says `log()` moves onto `out.print`. Its only three callers are in `commands/sync.ts`, and none of them wanted a bare line: two needed a status and a hint, one a `why` callout. They call `out.print` themselves, and a runner method with no caller is not kept.
2. **Under `--json`, `rt sync` and `rt git rebase` call `out.payloadOnStdout()`** (cross-phase ruling 6). Two things that reached stdout under `--json` before now go to stderr: the fetch step's plain line under `rt git rebase --json` off a terminal, which sat in front of the conflict bundle, and `rt sync --json`'s three no-origin lines. Neither was JSON, and `branch_sync` never saw the first (it calls `sync`, which fetches in silence under `--json`). If "byte for byte" is read to cover those lines too, this is the one place the plan breaks it, on purpose.
3. **A failed `rt sync --json` is squeezed to three stderr lines** (`compactFailure`): title with one line of git's beside it as the hint (a `! [rejected] ...` line when there is one, since it says why; else the first `fatal:` or `error:` line; else the last), `why`, `next`. The alternative that needs no squeezing is an `{ "error": ... }` envelope on stdout for exit 1, which `lib/mcp/git-tools.ts:392` already reads before it looks at stderr; that adds bytes to a `--json` stdout that is empty today, so it needs Matt's ruling and is not taken here. A failure shorter than three lines that follows a shown warning still lets the end of the warning into the tool's error, as a `console.warn` line does today; the test pins only the three-line case.
4. **`rebaseOnto` no longer prints a conflict it undid.** The files, the reason and the backup are in the result's `failure`, and the caller draws one block on stderr. `rt git rebase --no-agent` and `rt sync` off a terminal used to print the file list from inside `rebaseOnto` and then exit 1 with nothing more; they now print one failure.
5. **A cancel at the reset confirm is not coral.** `rt git reset origin` printed `cancelled by user` in red; it now prints a `skipped` line on stdout. The exit code stays 1, because no phase changes an exit code.
6. **`rt sync all` keeps exiting 0 when a branch failed or was refused,** with a coral summary when one failed and a refused one when one was only refused. The exit code is today's; the mismatch is worth a ruling but is not this slice's to change, and the PR's Follow-up names it.
7. **The unit tests that pin `--json` by running a handler in a temp repo capture with phase 4's `captureOut({ console: true })`,** so one pin reads the same bytes while a file still prints through `console.log` and after it moves to `out.json`. Every test file in this plan uses it, and `clear()` where one test reads two runs in turn. No capture helper of this slice's own exists.
8. **`lib/mcp/__tests__/git-tools.test.ts` gains two tests.** The file belongs to no slice. They pin what `branch_sync` makes of the new stderr, which is the reader the scoping document says to pin; `lib/mcp/git-tools.ts` itself is not edited.
9. **The guard sentences are reworded at their source, under Matt's envelope ruling** (Task 12). `StackRefusal.hint` and `checkBranchGuard`'s `detail` are read on screen and ride in a `--json` envelope, so `lib/stack-guard.ts` and `lib/branch-guard.ts` join the slice for those strings only. The one reader that matches wording, the rebase-worktree skill, changes in the same commit; `branch_sync` passes the hint through and needs nothing. A path stays in a sentence only after a colon at the end, and merge request ids leave the sentence (they stay in `mrs`). `refused: <reason>` from `git undo` and the conflict bundle's `hint` stay: a program reads them and a person never sees them.
10. **`git reset hard` says "Saved a backup of the branch".** The backup is a branch at HEAD; it does not hold the uncommitted changes the verb is about to throw away, and "Saved a backup" beside "Threw away every uncommitted change" would read as if it did.
11. **Two PRs is the expected path.** Counted from this plan's own code, the slice is about 2,200 inserted and 900 deleted lines, about 3,100 in all, over ruling 8's 2,500. Task 7 Step 8 measures with `git diff --shortstat origin/main...HEAD` once Tasks 3 to 7 are in and takes the scoping document's second cut if they already pass 1,100, with a list for each half of what changes in Tasks 14 and 15: part 1 is Tasks 3 to 7 with the `git` and `diff` renders and the first AGENTS.md sentences, part 2 is Tasks 8 to 13 with the `sync` renders and the rest of the AGENTS.md text. The guard sentences (Task 12) go in part 2, beside `rt sync`, whose readers they share.
12. **Policy refusals are `refused`, not failures** (the ruling on refusals, and the controller's ruling that the uncommitted-changes guard is one). The ownership guard on amend and undo, the three undo reasons, a stack member under `rt sync`, and rt's own uncommitted-changes guard on pull, rebase, reset origin and sync print a `[refused] <title>` line with its `why` and `next` through `out.note` on stderr (`refuseWith`, `refusalNote`, `refusalBlocks`, `drawFailure`), with the exit code and `--json` string of today. The uncommitted-changes check is rt's policy, not git's limit: a merge pull on a dirty tree can succeed in git, and `reset.ts` and `sync.ts` call it a guard. Its results from the API under `rt sync` carry `refused: true` beside `failure` (`asRefusal`), so `rt git rebase`, `rt git reset origin`, `rt sync` and `rt sync all` all draw it the same way. A state the verb cannot get past (a detached HEAD, a diverged push off a terminal, a rebase already in progress) stays a failure through `out.fail`.
13. **`sync all` draws each branch's ending on stderr under its heading** (the spec's rule 3 and the refusal ruling): a stack member through `out.note(...refusalBlocks(...))`, any other error through `drawFailure` (a refused note for the uncommitted-changes guard, `out.fail` for the rest). `branchEnding` is the same blocks as a pure function for the tests and the renders. The exit code stays 0. Each heading is its own render call, so the loop writes one blank row (`BRANCH_GAP`, an empty table row, the device the 5a dispatcher uses under its header) as its own call before every heading but the first, which keeps rule 8's gap. A failure block printed alone opens its render, so under 5a's plain rule it carries no `[failed]` tag off a terminal; the summary after it does.
14. **A value flag with nothing after it is a usage failure for a person** (`readFlag`), not the verb's failure title over `--max requires a value`. The `--json` error keeps that message: it comes from `lib/cli-args.ts`, which many verbs share and this slice does not own.

## Self-Review

**Spec coverage.** Scoping section 3 "5b": every `git` leaf and both `sync` verbs have a task (`status`, `log`, `branches`, `diff` in Task 4; `amend`, `undo`, the five `stash` and four `tag` leaves in Task 5; `backup`, `restore`, `credential` in Task 6; `pull`, `push`, `push force`, `upstream` in Task 7; `rebase`, `rebase onto` in Task 9; `reset origin`, `soft`, `hard` in Task 10; `sync`, `sync all` in Task 13), and `lib/rebase-escalation.ts` in Task 11. Shared items: 3 (`lib/ui/steps.ts`, Task 8); 8 (`usageFailure` at `git/mutate`'s eight sites, `git/inspect`'s and `git/rebase`'s one each, Tasks 4, 5, 9, plus `readFlag`'s value-flag sites); 4 (first caller of the `diff` block with light and dark renders, Tasks 4 and 14); 5 (a hostile branch name, Task 4); 11 (one `failPlain`, Task 3). Readers table: `git credential` (Task 6), the agent-safe leaves (Task 4), `sync --json --no-agent` on exit 0, 1, 3 and 4 with its stderr (Tasks 11 and 13), the stack hint's readers, the skill rows among them (Task 12), `e2e/tests/git-verbs.test.ts` (run in Tasks 4 and 5). Matt's added rulings: envelope sentences (Task 2's sweep table, Task 12), policy refusals as `refused` (Tasks 3, 5, 7, 9, 10, 13), steps versus the transient spinner (no transient spinner here: every wait is a real step with a done line). Spec rules: payload (Task 6), human text on stdout (Tasks 9, 10, 13 move the `log()` lines off stderr), failures on stderr (every task; `sync all`'s per-branch ending is Decision 13), a child keeps the terminal (Task 7, Task 9 item 20), no trailing blank lines (Tasks 9, 10, 13). The ten allowlist lines leave in Tasks 4, 5, 6, 7, 9, 10, 11 and 13. "Must not touch": `lib/repo.ts`, `lib/enrich.ts` and `renderStackRefusal`'s JSON mode are called and not edited; `lib/stack-guard.ts` and `lib/branch-guard.ts` change in their strings only. The warnings table has no 5b row, which Task 2 records. `lib/rt-render.ts` needs no edit, which the File Structure section records.

**Placeholders.** None. `<repo>` and `<scratchpad>` in Tasks 12, 14 and 15 are the implementer's own absolute paths, named as such; `<b>`, `<r>`, `<t>` and the other angle-bracket names in Task 2's tables stand for values the code interpolates, and every later task spells the template out.

**Type consistency.** `failWith`, `failPlain`, `failUsage`, `refuseWith`, `readFlag`, `asError`, `asRefusal`, `refusalNote`, `drawFailure`, `NOT_ON_A_BRANCH`, `uncommittedChanges`, `plural`, `errText` (Task 3) are called with those names and argument orders in Tasks 4 to 14. `statusBlocks`, `logBlocks`, `branchesBlocks`, `diffBlocks`, `stashBlocks`, `tagBlocks`, `UNDO_REFUSED` (now `Record<UndoRefusal, Block[]>`), `conflictFailure`, `manualReport`, `compactFailure`, `refusalBlocks`, `branchEnding`, `BRANCH_GAP`, `reportSync`, `syncAllBlocks`, `SyncSummary.failure`, `SyncSummary.refused`, `RebaseResult.failure`, `RebaseResult.refused`, `ResetResult.failure`, `ResetResult.refused` and `ResetResult.cancelled` are spelled the same in the Interfaces blocks, the code, the tests and Task 14's render script. The test helpers `trapExit`, `exitCodeOf`, `Exit`, `git`, `makeRepo`, `ctxFor`, `inDir` are defined once in Task 3 and imported under those names everywhere; capture is phase 4's `captureOut({ console: true })` in every file.

**Review Focus.** Five lines, the five most likely to bite, each pinned to a named test in Tasks 3, 5, 7, 8, 9, 10, 12 and 13. The bidi branch name, git's multi-line errors and the long pane tail are still pinned (Tasks 4, 3 and 11) but no longer listed.
