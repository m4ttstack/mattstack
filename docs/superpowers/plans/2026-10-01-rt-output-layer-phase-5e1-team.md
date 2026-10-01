# rt Output Layer, Phase 5e1 (Team) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every human line printed by `rt team` comes from the output layer; every human sentence `lib/team` puts on a screen (a failure title, a join result, a manual step, a remedy) follows the copy rules while each `--json` envelope keeps its shape; and four files leave the raw-output allowlist: `commands/team.ts`, `lib/team/invite.ts`, `lib/team/join.ts`, `lib/team/members.ts`.

**Architecture:** Each verb keeps its `--json` branch and swaps its human branch for `out.print` blocks. Expected failures go through `exitUserError` as today, except a policy refusal, which a person reads as a `refused` line through `out.note` (the `--json` envelope and the exit code do not change). Usage errors go through 5a's `usageFailure`. `TeamDeps.print` stays and after this plan carries only the envelope line. The three `lib/team` warn sinks take `(message, shown?)` and default to 5a's `warn`. The `lib/team` copy pass rewords the human strings named in Task 2's copy table; keys, types, codes, statuses and exit codes stay.

**Tech Stack:** Bun + TypeScript (`commands/`, `lib/`), `bun:test`. No Go change and no pty test: every file under `ui/` is 5a's.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (ticket RT-369), phase 5 of "Phases", plus "Rules", "Block vocabulary", "Status set", "Copy style", "Error seam", "Plain output off a TTY" (its 2026-10-01 amendment: frozen means shape), "Guard" and "Testing". The slice is defined by `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5-scoping.md` (section 2 items 1 and 10; section 3 "5e", second cut (i); section 5's tray row; rulings 2, 8, 9 and 11). The twelve cross-phase rulings in `.superpowers/sdd/cross-phase-rulings.md` bind this plan, and so do the controller's rulings on this slice in `.superpowers/sdd/phase-5e-rulings-r1.md`. The API it builds on is fixed by the 5a plan, `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5a-layer-additions.md`, sections "API for slices 5b to 5f", "The breadcrumb header (nothing to call)" and the warnings table in its Task 1.

**What was run while writing this plan:** nothing was compiled. Every snippet was written against the files at `5bc69f231` (the line numbers are from that commit and shift once 5a and phase 3 land), against 5a's signatures as its plan states them, and against phase 4's `lib/ui/__tests__/capture-out.ts` as it is on `origin/main` at `19ceaa403`.

**One of two plans:** the slice ships as two PRs along the scoping document's second cut, because the copy pass pushes it past 2,500 changed lines. This plan is (i), `team` and `lib/team`. `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5e2-home-release-repos.md` is (ii). Neither depends on the other and either may merge first; both delete allowlist lines and append to AGENTS.md "Output layer", which ruling 7 merges by hand. The single plan this replaced was superseded and is not in the repo.

**Size:** about 1,400 changed lines: about 450 for the `lib/team` copy pass and the tests that pin its strings and follow its facts into `why`, `next`, `log` and `detail`, about 650 for `commands/team.ts` and its tests, about 150 for the warn sinks, about 150 for docs and renders.

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
- 5e1 only: what "byte for byte" means here, per Matt's setup ruling (cross-phase ruling 1 and the spec's 2026-10-01 amendment, applied to this slice by the controller): the shape is frozen (keys, structure, types, exit codes, and every value a program reads: `code`, `access`, `peering`, `intent`, `forgeAccess`, `mode`, slugs, handles, links, timestamps). A human sentence that rides in an envelope and is what a person reads (a `UserActionableError` message, `JoinResult.message`, `peeringFix`, `peeringWarning`, `manualSteps`, `residueNote`) is reworded exactly as Task 2's copy table says, and nowhere else. A string only a program reads stays as it is. The existing `--json` tests stay as the shape and machine-value pins; only their assertions on a reworded string change, and the new wording is pinned on its own.
- 5e1 only: three phrases and one constant stay because files this plan may not edit read them: the join success message keeps `Joined <name>` and the denied message keeps `you don't have access yet` (`lib/setup/__tests__/steps-a.test.ts:483` and `:515`); the `team-pull-only` message keeps `pull-only` and ends with a period (`lib/setup/steps/secrets.ts:51` appends ` Nothing was written.` to it, which `steps-a.test.ts:696` matches, and `lib/secrets/__tests__/team-store.test.ts:301` and `:470` match `/pull-only/`); and `ONE_TEAM_RULE` in `lib/team/one-team.ts` is not edited (`lib/setup/validators/rt-health.ts:636` builds a setup row from it).
- 5e1 only: a fact a reader cannot get back any other way stays in `message`, not only in `why`, `next` or `log`: the tray and phase 3's setup rows read `message` alone. "You do not need a new code", "the invite has not been used yet" and an invite code rt could not save are such facts. A message that carries an invite code carries no `log`, so `logFailureDetail` never writes the code to the CLI log.
- 5e1 only: a policy refusal (rt declining by a guard, an ownership rule or an existing team) is drawn as `out.note(out.line("refused", ...), callouts)` on stderr, never a coral failure block. Its exit code (2) and its `--json` envelope do not change. The codes are listed in Task 5's `REFUSAL_CODES`.
- 5e1 only: exit codes do not change. Team verbs exit 2 on an expected failure, refusals included.
- 5e1 only: files this plan must not edit: anything under `ui/`; `lib/ui/out.ts`, `lib/ui/out-plain.ts`, `lib/ui/warn.ts`, `lib/ui/usage.ts`, `lib/ui/transient-step.ts` (5a); `lib/ui/steps.ts` and `lib/rt-render.ts` (5b); `lib/pick-wrappers.ts`, `lib/ui/pick.ts`, `lib/pickers.ts` (5c); `commands/setup.ts` and everything under `lib/setup/`, tests included (phase 3); `lib/secrets/**` (phase 6); `lib/daemon/**`; `lib/errors.ts` (phase 2); `lib/ui/__tests__/capture-out.ts` (phase 4 extended it on main); `lib/command-tree-def.ts` (no description changes, so no `docs:gen`); `lib/team/invite-records.ts` (its one message is read by `lib/daemon/__tests__/invite-replies.test.ts`).
- 5e1 only: no source file holds a literal bidi or zero-width character. A test that needs one builds it with `String.fromCodePoint(0x202e)`.
- 5e1 only: git commands are run plain and alone from the worktree root, never joined with `cd`, `&&`, pipes or heredocs. Never `git add -A`, `git add .` or `git add -u`.
- 5e1 only: the pickers, prompts and confirms `rt team` already draws through rt-ui (the member picker, the team name prompt, the invite code prompt, the membership confirm) are not changed.

## Review Focus

1. **A warning that fires while a program reads stdout.** `team status --json` is agent-safe: `rt_verb` parses stdout as one JSON value. A skipped roster entry must print on stderr only. Pinned in Task 5 (`a malformed roster entry warns on stderr and leaves the envelope alone`).
2. **The words change, the envelope does not.** The tray decodes `TeamJoinResult`, `InviteResult` and the exit-2 envelope, and shows `message`, `peeringWarning`, `manualSteps` and `error.message` as text without matching them. Every existing `--json` test keeps its structural assertions; Task 4 changes only the assertions on reworded strings and pins the new strings in `lib/team/__tests__/copy.test.ts`. Check that no row of Task 2's copy table touches a key, a code or a status.
3. **Phase 3 and `lib/secrets` still find what they read.** `lib/setup/steps/team.ts` passes `JoinResult.message`, `peeringFix` and `err.message` into setup rows and matches only codes; its tests match two join phrases, and `steps-a.test.ts:696` and `lib/secrets/__tests__/team-store.test.ts` match `pull-only`. Pinned in Task 4 (`the join messages keep the two phrases phase 3 reads`, and C9's new message in `publish.test.ts` and `members.test.ts`, which keep `/pull-only/`).
4. **A refusal is not a failure.** `team manage-membership on` where rt did not create the repo, a code on argv, a pull-only clone: each prints a `[refused]` line on stderr, exits 2, and under `--json` writes the same envelope as today. Pinned in Task 5 (`human mode: on where rt did not create the repo is a refused line, not a failure`) and Task 6 (`a code on argv is refused, not failed`).
5. **Ruling 12 at `join.ts`.** A `UserActionableError` caught inside peering keeps its `next` in the warning and its `log` in the CLI log. Pinned in Task 3.

## What 5e1 consumes from 5a (fixed contracts, cited from the 5a plan)

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

And from phase 4, on main at `19ceaa403`: `captureOut(opts?: { console?: boolean })` in `lib/ui/__tests__/capture-out.ts`, whose result has `clear()` (empties both buffers between two runs in one test; `reset()` does not) beside `stdout()`, `stderr()`, `lines()`, `errLines()`, `reset()` and `restore()`.

## File Structure

| File | Responsibility after this plan |
|---|---|
| `lib/team/invite.ts`, `lib/team/join.ts`, `lib/team/members.ts` (modify) | The `warn` seam takes `(message, shown?)`; the default sink is 5a's `warn`; `join.ts` carries `err.next` into its peering warning; reworded human strings |
| `lib/team/create.ts`, `forge.ts`, `invite-crypto.ts`, `one-team.ts`, `publish.ts`, `relay-client.ts`, `slug.ts`, `team-local.ts` (modify) | Reworded human strings, with `why`, `next` and `log` on their errors |
| `lib/team/__tests__/warn-sinks.test.ts` (create) | The three default sinks |
| `lib/team/__tests__/copy.test.ts` (create) | The reworded strings a pure call reaches |
| `commands/team.ts` (modify) | Human branches on `out`; `print` carries only the envelope; refusals through `exitTeamError`; exported block builders for invite, join, members |
| `commands/__tests__/team-blocks.test.ts` (create) | The block builders, as plain text |
| `lib/__tests__/raw-output-allowlist.json` (modify) | Four lines deleted |
| The tests named in each task (modify) | New copy; captures move from `deps.lines` to `captureOut()` |
| `AGENTS.md`, `docs/design/output-layer/` (modify) | One appended paragraph; two renders |

---

### Task 1: Check that 5a is on main

No code. 5a (`RT-369: output layer phase 5a, layer additions and dispatcher`) must be merged before any task below runs: every task calls its API.

**Files:** none.

**Interfaces:**
- Consumes: `origin/main`.
- Produces: a branch rebased on a main that holds 5a and phase 4.

- [ ] **Step 1: Fetch**

Run: `git fetch origin`

- [ ] **Step 2: Look for 5a's files on main**

Run each alone:

- `git cat-file -e origin/main:lib/ui/warn.ts`
- `git cat-file -e origin/main:lib/ui/usage.ts`

Expected: each exits 0 and prints nothing. If either prints `fatal: path ... does not exist`, **stop here and report "5a is not on main"** to whoever dispatched this plan. Do not start Task 2.

- [ ] **Step 3: Rebase onto main**

Run: `git rebase origin/main`

- [ ] **Step 4: Confirm the APIs match what this plan cites**

Read `lib/ui/warn.ts`, `lib/ui/usage.ts`, the `note` function in `lib/ui/out.ts`, and `lib/ui/__tests__/capture-out.ts`. Compare with "What 5e1 consumes from 5a" above. Phase 4 merged at `19ceaa403`, so `captureOut` takes `opts?: { console?: boolean }` and its result has `clear()`; this plan's tests call `clear()` where one capture serves several runs. If a name or a parameter differs, main wins: note the difference in your report and use main's form everywhere this plan uses the cited one.

Run: `bun test lib/ui/__tests__/warn.test.ts lib/ui/__tests__/usage.test.ts lib/ui/__tests__/out-plain.test.ts`
Expected: PASS.

Run: `grep -n "commands/team.ts\|lib/team/invite.ts\|lib/team/join.ts\|lib/team/members.ts" lib/__tests__/raw-output-allowlist.json`
Expected: four lines.

Run: `grep -rn "ONE_TEAM_RULE\|Joined Acme\|you don't have access yet\|pull-only" lib/setup lib/secrets/__tests__/team-store.test.ts`
Expected: the readers this plan keeps: `rt-health.ts` imports the constant; `steps-a.test.ts` matches the two join phrases and `pull-only`; `secrets.ts:51` appends ` Nothing was written.` to the `team-pull-only` message; `team-store.test.ts` matches `/pull-only/` twice. If phase 3 or phase 6 has since changed what it reads, report it and keep whatever it reads now.

---

### Task 2: Audit of the print sites and the copy this plan owns

No code. This is the inventory every later task implements; it stays in the plan. Line numbers are at `5bc69f231`.

**Files read:** `commands/team.ts`, `lib/team/*.ts`, the tests beside each, `lib/setup/steps/team.ts`, `lib/setup/validators/rt-health.ts`, `lib/setup/__tests__/steps-a.test.ts`, `rt-tray/Sources-core/Setup/TeamChoiceModel.swift`, `rt-tray/Sources-core/Settings/TeamSettingsModel.swift`, `rt-tray/Sources-core/Contract/OtherResults.swift`, `rt-tray/Tests/MattstackCoreChecks/TeamChoiceChecks.swift`, `e2e/tests/setup.test.ts`, `e2e/tests/team-membership.test.ts`.

#### Already on rt-ui (confirming the scoping document)

| Verb | Scoping call | Confirmed | Left for this plan |
|---|---|---|---|
| `team` | partly | Yes. rt-ui draws the member picker (`members remove`), the team name prompt (`create`, through `lib/rt-render.ts`), the confirm in `invite`, and the invite code prompt is `promptSecret`. None changes. | Every result line, the three lib warn sinks, the `lib/team` copy |

#### Rule for strings that live under `lib/team`

The spec's "Known gaps" says the `lib/` printers behind these verbs are unaudited. They were read for this plan. Three kinds:

1. **A human sentence a person reads, in an envelope or not** (a `UserActionableError` message, `JoinResult.message`, `peeringFix`, `peeringWarning`, `manualSteps`, `residueNote`). Reworded in the copy table below, shape kept. A command the sentence named moves to the error's `next` (which the envelope never carries) where the string is an error; raw tool output, paths and ids move to its `log` (the CLI log) or its `why`. A string that is the only carrier of its remedy (a manual step, a `peeringFix`, read by the tray and by phase 3's setup rows, neither of which sees `next`) keeps its command as its last words, the way phase 3 kept commands in its setup remedies.
2. **A string only a program reads.** Unchanged: the `usage:` envelope messages agents read, `invite-records.ts`'s one message, every `code`, and the log text (first argument) of every warning.
3. **A string another slice writes.** Unchanged and not this plan's: the daemon's `team:pull` failure message (`lib/daemon`), the `members-error` passthrough of `lib/secrets` errors.

#### `commands/team.ts` (2 guard lines, 30 seam calls)

| Site | Today | Becomes | Task |
|---|---|---|---|
| `:81` `realTeamDeps().print` | `(s) => console.log(s)` | `(s) => out.payload(s + "\n")`: the envelope line, same bytes | 5 |
| `:119-121` `usageError` (4 callers) | `exitUserError(usage: ...)` in both modes | `--json`: unchanged. Human: `out.fail(usageFailure(title, usage))`, exit 2. Titles: create `What should the team be called?`; invite `Who is the invite for?`; manage-membership `Choose on or off`; members remove `Which member?` | 5 |
| every `catch` that calls `exitUserError(err, ...)` (8) | a failure block for every code | `exitTeamError(err, json, verb, deps)`: a `refused` line on stderr for a code in `REFUSAL_CODES`, `exitUserError` for the rest and for every `--json` run | 5 |
| `:146-150` create | `rt team create: scaffolded "<slug>" at <dir> (remote <url>)` or `... already exists ...` | `line done "Created the <slug> team" <remote>` or `line skipped "The <slug> team is already set up" <remote>` | 5 |
| `:164, :167, :186-189, :238-241, :293-296, :323, :355, :358, :529` errors built here | sentences with commands, flags and paths | reworded per rows T3 to T13 of the copy table | 4 |
| `:198` pull | `rt team pull: <slug> - <outcome> (<detail>)` | `line` by outcome: up-to-date `done "The <slug> team is already up to date"`; fast-forwarded and rebased `done "Pulled the <slug> team"`; conflict `needs-you "The <slug> team has changes that clash with yours"`; skipped `skipped "Skipped pulling the <slug> team"`; detail is the hint | 5 |
| `:218` publish | `rt team publish: pushed "<slug>" to <remote>` | `line done "Pushed the <slug> team" <remote>` | 5 |
| `:263-270` invite | the link, a blank line, the paste block, then `forge access is <x>` and the manual steps as `  - ` rows | `copy(link, "invite link")`, `copy(pasteBlock, "message to send")`; when access is not granted: `line needs-you "Give <handle> read access to the team repo yourself" "forge access: <x>"` and one `fix` callout holding the manual steps | 6 |
| `:305-309` manage-membership | `rt team manage-membership: on for ...` or `off for ... (run ...)` | on: `line done "Invites to <slug> give read access on the forge" "membership management is on"`; off: `line off "Invites to <slug> leave forge access to you" "membership management is off"`, then `callout next rt team manage-membership on` where rt created the repo, else `callout note "mattstack did not create this repo, so this cannot be turned on"` | 5 |
| `:348` join | `rt team join: <message>` | `line <status> <message>`: needs-you for denied and no-account, pending for deferred, warn for unreachable, undetermined or unavailable peering, done otherwise | 6 |
| `:385-387` members sync | `rt team members sync: added N key(s)` and two indented lines | `line done "Added N keys"` (or `skipped "No new keys to add"`), `line pending "Still waiting on a reply" <handles>`, `line done "Locked the team's secrets to the new keys" <files>` | 6 |
| `:436-441` members remove | one line, `Finish revoking forge access by hand:`, steps, the residue note | `line done "Removed <handle> from the team" "forge access: <x>"` (or `skipped "<handle> was not on the team list"`), `callout fix` with the manual steps, `callout note` with the residue note, `callout next rt secrets rotate --team <slug> <domain> <key>` | 6 |
| `:477` and `:537` roster warning | `console.error("rt team status: skipped N malformed ...")` | `warn("team", "skipped N malformed board.members ...", { show: { title: "Some team members could not be read", hint: "N left out" } })` | 5 |
| `:522` status, solo | `rt team status: no team (Just me)` | `line off "No team on this Mac" "just you"` | 5 |
| `:551-556` status | one long line | `section <name> <slug>` holding `kv remote`, `kv "last push"`, `kv members`, `kv sync` (its source line carries the skipped-pull and pull-only notes); a conflict adds `line needs-you "The team has changes that clash with yours" <detail>` | 5 |

Usage sites (shared item 8): 4, not the 2 the scoping document counted with `rg -c` (two more reach `usageError` on other lines).

#### `lib/team` warn sinks (3 guard lines, 11 call sites)

Each sink is `(message: string) => void` today and its default is `console.error(message)`. The seam's exact signature after this plan, in `MintInviteSeams` (`lib/team/invite.ts:119`), `JoinRedeemSeams` (`lib/team/join.ts:277`) and `MembersSeams` (`lib/team/members.ts:170`):

```ts
warn: (message: string, shown?: ShownWarning) => void;
```

`message` is the log text and `shown` the copy a person reads. The default sink in each file is `function defaultWarn(message: string, shown?: ShownWarning): void { warnLine("team", message, { show: shown ?? { title: message } }); }`. A one-argument call keeps working: `lib/setup/team-settings.ts` (phase 3's file) receives this same function through `readTeamSnapshot(p, slug, { read, warn: seams.warn })` and `readUserIntegrationOverrides({ read, warn: seams.warn })`, whose parameter type is `(message: string) => void`, and calls it with one argument, which shows its message as the title. A one-argument fake in a test still satisfies the type. No existing caller changes.

| Call site | Message (unchanged, for the log) | Shown title / hint / next | Task |
|---|---|---|---|
| `invite.ts:282` | today the `peeringWarning` sentence; Task 4 makes it `board peering: <reason>` | `This invite will not connect their board` / `invite their board again from the board's members panel after they join` | 3 |
| `invite.ts:329` | could not revoke the previous invite | `The earlier invite for <handle> is still live` / `it stops working when it expires` | 3 |
| `join.ts:305` | could not set `board.switchboardUrl` | `rt could not point your board at the team's switchboard` / `the join result says how to set it` | 3 |
| `join.ts:328` | setup rows are confirmed for another URL | `rt's setup still points at a different switchboard` / `left as it is` / `rt setup switchboard connect --host <url>` | 3 |
| `join.ts:333` | could not confirm the URL for setup | `rt could not record the team's switchboard for setup` / none / `rt setup switchboard connect --host <url>` | 3 |
| `join.ts:400` | the declared switchboard is not https | `The team's switchboard address is not secure` / `board peering was skipped; the team owner has to fix it` | 3 |
| `join.ts:409` | the invite's switchboard does not match | `This invite's switchboard is not the team's` / `its board token was not used` | 3 |
| `join.ts:437` (ruling 12) | could not register this board | `rt could not register your board with the team's switchboard` / the error's first line / `err.next` when the error is a `UserActionableError` that has one | 3 |
| `members.ts:270` | the reply could not be used | `The reply from <handle> could not be used` / `their invite stays open to try again` | 3 |
| `members.ts:278` | the reply claims a key that is already a recipient | `The reply from <handle> repeats a key the team already has` / `treated as suspect; look into it before syncing again` | 3 |
| `members.ts:291` | the key was already a recipient | `<handle> was already added` / `their invite stays open` | 3 |

AGENTS.md "Switchboard and rt team join" names three seams join must not break: the board token is stored under the rt secrets scope, the user latch is written only when unset or invalid, and a different confirmed URL is never overwritten while the join warns and points at `rt setup switchboard connect --host <url>`. None of that logic is edited; the warning keeps the command, now as its `next`.

#### Copy table: `commands/team.ts` and `lib/team`

For Matt to skim, the way phase 3 laid out its setup copy. "Today" quotes the string, shortened with "..." where it runs long or holds a long dash this document may not contain. In "Becomes", `message` is the error's message (the failure title, and `error.message` in the exit-2 envelope), and `why`, `next` and `log` are the fourth argument to `UserActionableError` (`lib/errors.ts`), which the envelope never carries. `<x>` marks a value the code fills in. "Read by" names who sees the string: "terminal" is the failure or the line `rt team` prints, "tray" is the app's setup or settings screen, "setup row" is phase 3's `lib/setup/steps/team.ts`, which passes the string through as a row's detail or remedy. Every row keeps its `code`.

| # | Site | Today | Becomes | Read by |
|---|---|---|---|---|
| T1 | `commands/team.ts:74` usage | `pass the invite code on stdin as {"code": "..."}` | unchanged: reached only off a terminal or under `--json`, by a program piping the code | agents |
| T2 | `commands/team.ts:120` usage | `usage: <usage line>` | unchanged in the envelope; a person sees `usageFailure` (Task 5) | agents |
| T3 | `commands/team.ts:164` `no-team` | `no local team store found ... run rt team create first, or pass --team` | message `This Mac has no team yet`; next `rt team create` | terminal, tray settings |
| T4 | `commands/team.ts:167` `ambiguous-team` | `multiple local team stores found (<a>, <b>) ... pass --team to choose one` | message `This Mac has more than one team: <a>, <b>`; next `rt <verb> --team <slug>` (the verb comes from `resolveTeamSlug`'s new second parameter; for `members remove` it carries the handle, so the command is `rt team members remove <handle> --team <slug>`) | terminal |
| T5 | `commands/team.ts:186-189` `daemon-unreachable` | `rt daemon is not reachable... start it with rt daemon start, or pull by hand with git in ~/.mattstack/teams/<slug>` | message `The rt daemon is not running`; why `It pulls team changes for you. You can also pull with git in the team's folder.`; next `rt daemon start` | terminal |
| T6 | `commands/team.ts:192` | the daemon's `team:pull` failure message | unchanged: `lib/daemon` writes it | terminal |
| T7 | `commands/team.ts:238-241` `team-pull-only` (refusal) | `this machine joined "<slug>" by invite, so its clone is pull-only and cannot add members ... Member-proposed changes are tracked in MAT-415.` | message `This Mac joined the <slug> team by invite, so its copy is pull-only and cannot invite anyone.`; why `Ask the team's owner to invite <handle>.` | terminal, tray settings |
| T8 | `commands/team.ts:293-296` `not-rt-created` (refusal) | `mattstack did not create the repo behind "<slug>", so it will not administer membership there. Whoever administers that repo grants access.` | message `mattstack did not create the <slug> team's repo, so it will not manage who can see it`; why `Whoever runs that repo gives people access.` | terminal |
| T9 | `commands/team.ts:323` `code-on-argv` (refusal) | `pass the invite code on stdin, never as an argument` | message `rt never takes an invite code as an argument`; why `It would land in your shell history. Run the join on its own and paste the code when it asks.`; next `rt team join` | terminal; `e2e/tests/setup.test.ts` reads the code only |
| T10 | `commands/team.ts:355` `age-key-unavailable` | `JoinKeyExchangeError`'s message (J18) | message J18 (it keeps "you do not need a new code"); why `Check that your keychain is unlocked.`; next `rt team join`; log the error's `detail`, scrubbed (J18) | terminal, tray join |
| T11 | `commands/team.ts:358` `peering-store-failed` | `JoinPeeringStoreError`'s message (J8) | message J8 (it keeps "you do not need a new code"); why `Set up this Mac's secrets if they are not, then join again.`; next `rt home init`; log the error's `detail`, scrubbed (J8) | terminal, tray join |
| T12 | `commands/team.ts:369` `members-error` | a `lib/secrets` error's own message | unchanged: `lib/secrets` is phase 6's. `reportMembersError` gives M6 and M7 their own copy before it reaches this line | terminal |
| T13 | `commands/team.ts:529` `no-team` | `team "<slug>" is not cloned locally at <dir> ... run rt team join or rt team create first` | message `The <slug> team is not on this Mac`; next `rt team join` | terminal, tray settings |
| C1 | `create.ts:99` `gitStepError` (callers `:217`, `:222`, `:228`, `:232`) | `<step> failed (exit <n>): <output>` | message by code: `git-init-failed` `rt could not start the team repo`; `git-remote-failed` `rt could not point the team repo at its remote`; `git-add-failed` `rt could not stage the team repo's files`; `git-commit-failed` `rt could not make the team repo's first commit`; log today's text | terminal, tray create, setup row |
| C2 | `create.ts:123` `remote-required` | `a git remote is required (gh-created or pasted)` | message `The team needs a repo`; why `Give rt the address of an empty repo, or let it create one on GitHub.`; next `rt team create <name> --remote <url>` | terminal, tray create |
| C3 | `create.ts:131-134` `create-repo-exists` | `gh repo create <path>: a repo already exists there ... pass --remote <its URL> instead of --create-repo ...` | message `GitHub already has a repo with this team's name`; why `It is <path>. Point rt at it instead of creating a new one.`; next `rt team create <name> --remote <its url>` | terminal, tray create |
| C4 | `create.ts:136` `create-repo-failed` | `gh repo create <path> failed: <output>` | message `GitHub did not create the team repo`; log today's text | terminal, tray create |
| C5 | `create.ts:140` `create-repo-failed` | `gh repo create <path> printed no URL to use as the remote` | message `GitHub created the team repo but did not say where it is`; log today's text | terminal, tray create |
| C6 | `create.ts:165-168` `team-exists` (refusal) | `team "<slug>" already exists at <dir> with a different remote ... remove <dir> to start over` | message `The <slug> team is already set up here with a different repo`; why `Use the repo it was created with, or remove the team's folder to start over.`; log `<dir>` | terminal, tray create |
| C7 | `slug.ts:13` `bad-team-name` | `not a usable team name: "<name>"` | message `"<name>" cannot be a team name`; why `A team name needs at least one letter or number.` | terminal, tray create |
| C8 | `one-team.ts:17` `team-already-set-up` (refusal) | `this machine is set up for team <x>; mattstack supports one team per machine today` | message `This Mac is already set up for the <x> team, and mattstack supports one team per machine today` (`ONE_TEAM_RULE` itself unchanged) | terminal, tray create and join |
| C9 | `team-local.ts:86-89` `team-pull-only` (refusal) | `this machine joined "<slug>" by invite, so its clone is pull-only. Ask the team's owner to make this change. Member-proposed changes are tracked in MAT-415.` | message `This Mac joined the <slug> team by invite, so its copy is pull-only.`; why `Ask the team's owner to make this change.` (keeps `pull-only` and the closing period: `lib/setup/steps/secrets.ts:51` appends ` Nothing was written.`, and `lib/secrets` tests match `/pull-only/`) | terminal, setup row (phase 3's secrets step) |
| IC1 | `invite-crypto.ts:40` `invite-malformed` | `invite code contains a character outside the Crockford alphabet` | message `That invite code has a character no invite code uses`; why `Check it for a typo, or paste the whole link.` | terminal, tray join |
| IC2 | `invite-crypto.ts:279` `invite-malformed` | `invite code is the wrong length` | message `That invite code is the wrong length`; why `Check that you pasted all of it.` | terminal, tray join |
| IC3 | `invite-crypto.ts:125, :133, :138, :159` | `invite id must be 32 lowercase hex characters`, `invite key must be 32 bytes`, `invite key is unreadable`, `invite IV must be 12 bytes` | message `rt could not read that invite`; log today's text (each keeps its code) | terminal (the mint and encode path) |
| IC4 | `invite-crypto.ts:203, :208, :226, :239` | `invite could not be decrypted`, `invite payload is not valid JSON`, `invite pointer payload is malformed`, `invite reply payload is malformed` | unchanged: always caught, into J1 on a join or into the members sync warning's log text, which quotes the message | log |
| RC1 | `relay-client.ts:55` `relay-unreachable` | `could not reach the invite relay` | message `rt could not reach the invite service`; why `Check your network, then try again.` | terminal |
| RC2 | `relay-client.ts:59` `relay-error` | `<status> <path>` | message `The invite service answered with an error`; log today's text | terminal |
| RC3 | `relay-client.ts:63` `relay-id-conflict` | `invite id already exists on the relay ... retry with a fresh id` | message `The invite service already has an invite with this id`; why `Try again: rt picks a new id each time.` | terminal |
| RC4 | `relay-client.ts:84` `relay-error` | `invite id must be a 32-character hex id` | message `rt could not read that invite`; log today's text | terminal |
| P1 | `publish.ts:33` `push-denied` | the redacted git output | message `The forge would not let rt push to the team repo`; why `Check that you can push to it.`; log today's text | terminal, tray create, setup row (adds its own remedy by code) |
| P2 | `publish.ts:36-39` `remote-not-empty` | `the remote already has commits rt can't fast-forward past ... expects an existing EMPTY repository: <output>` | message `The team repo already has commits`; why `rt starts a team in an empty repo.`; log today's text | terminal, tray create |
| P3 | `publish.ts:41` `push-failed` | `git push -u origin main failed (exit <n>): <output>` | message `rt could not push the team repo`; log today's text | terminal, tray create |
| P4 | `publish.ts:57` `invalid-team-slug` | the slug check's own message | message `That is not a team name rt can use`; log today's text | terminal |
| P5 | `publish.ts:63` `no-team-zone` | `no team zone for "<slug>" at <dir> ... run rt team create first` | message `The <slug> team is not on this Mac`; next `rt team create` | terminal |
| P6 | `publish.ts:71` `git-remote-failed` | `git remote add origin failed (exit <n>): <output>` | message `rt could not point the team repo at its remote`; log today's text | terminal |
| I1 | `invite.ts:58` `invalid-join-base` | `RT_JOIN_BASE_URL must be an https url, or http on loopback: got <x>` | message `The join link address rt was given must be https, or http on this Mac only`; log today's text | a developer setting the override |
| I2 | `invite.ts:173-176` `invalid-handle` | `"<h>" doesn't look like a forge username ... letters, digits, ".", "_", "-" only ...` | message `"<h>" does not look like a forge username`; why `A username uses letters, digits, dots, dashes and underscores, and starts with a letter or digit.` | terminal, tray settings |
| I3 | `invite.ts:202` manual step | `Let mattstack grant it: run rt team manage-membership on --team <slug>, then invite <h> again` | `Let mattstack give <h> access, then invite them again: rt team manage-membership on --team <slug>` | terminal fix callout, tray invite sheet |
| I4 | `invite.ts:213` manual step | `Ask whoever administers <remote> to give <h> read access. mattstack did not create this repo, so your admin decides.` | `Ask whoever runs the team repo to give <h> read access. mattstack did not create it, so they decide.` | terminal fix callout, tray invite sheet |
| I5 | `invite.ts:223` `no-team-remote` | `team "<slug>" has no git remote configured yet ... run rt team create or rt team publish first` | message `The <slug> team has no repo yet`; next `rt team publish --remote <url>` | terminal, tray settings |
| I6 | `invite.ts:280` `peeringWarning` | `board peering was not embedded in this invite (<reason>); after they join, re-invite their board from the board's members panel` | `This invite will not connect their board. After they join, invite their board again from the board's members panel.`; `<reason>` moves to the warning's log text, `board peering: <reason>` | tray invite sheet; terminal warning (Task 3's copy) |
| I7 | `invite.ts:281` `peering-not-embedded` (a failure: the register answered badly, returned no token, or threw) | `refusing to mint: <peeringWarning>` | message `rt did not make the invite, because it could not connect their board`; why `It could not register their board with the team's switchboard.`; log `<reason>` | terminal |
| I8 | `invite.ts:296` `relay-id-mismatch` | `the invite relay did not honor the requested invite id ... cannot be safely opened` | message `rt could not make a safe invite`; why `The invite service changed the invite's id. Try again.` | terminal, tray settings |
| I9 | `invite.ts:310-313` `invite-record-write-failed` | `minted invite <id> (code <code>) but could not save its local record ... write the code down now: <err>` | message `rt made the invite but could not save its record. Write its code down now: <code>`; why `Without the record rt cannot cancel the invite or add the member later. Saving it failed: <err>.`; no `log` (the message carries the code, and a `log` would make `logFailureDetail` write it to the CLI log). The id is not lost: the code encodes it | terminal, tray settings (`TeamSettingsModel` shows `error.message`) |
| I10 | `invite.ts:329-331` warning | log text | unchanged (Task 3 gives it shown copy) | log |
| I11 | `pasteBlock` | the message an inviter sends | unchanged: written for the invitee, and a person copies it as is | the invitee |
| F1 | `forge.ts:58` manual step | `Install the <Forge> CLI (<cli>), then run <cli> auth login` | `Install the <Forge> command line tool, then sign in: <cli> auth login` | terminal fix callout, tray invite sheet |
| F2 | `forge.ts:60` manual step | `Run <cli> auth login, then retry rt team invite` | `Sign in, then invite them again: <cli> auth login` | same |
| F3 | `forge.ts:62` manual step | `Authorize the CLI's token for this organization's SAML/SSO enforcement, then retry` | `Let the command line tool's token through your organization's single sign-on, then try again` | same |
| F4 | `forge.ts:64` manual step | `Check that "<h>" is a real <Forge> username ... it was not found` | `Check that "<h>" is a real <Forge> username: it was not found` | same |
| F5 | `forge.ts:66` manual step | `The CLI's token lacks permission for this repo ... check its scopes with an admin` | `The command line tool's token cannot change who can see this repo. Ask an admin to check its scopes.` | same |
| F6 | `forge.ts:74-75`, `:79-80` manual steps | `Open <url>`, `Invite <h> with Read`, `Invite <h> with Reporter access`, `Remove <h>'s access` | unchanged: a link and a plain step | same |
| F7 | `forge.ts:138` manual step | `<h> must accept the pending GitHub collaboration invite (see github.com/<o>/<r>/invitations, or their email)` | `<h> has to accept GitHub's invite to the repo, on github.com/<o>/<r>/invitations or by email` | same |
| M1 | `members.ts:321-322` `residueNote` | `Removed members keep any secrets they already decrypted; rotate the values themselves with rt secrets rotate --team <slug> <domain> <key>.` | `Removed members keep any secrets they already opened. Rotate those values to shut them out.` (the terminal adds the rotate command as a `next` callout, Task 6) | terminal note |
| M2 | `members.ts:353-356` `invalid-age-key` | `"<key>" is not a well-formed age1 recipient (bech32 checksum failed) ... pass the exact key from rt team status or the roster` | message `That is not a valid age key`; why `Copy the exact key from the team roster.`; next `rt team status`; log today's text | terminal |
| M3 | `members.ts:377-381` `own-key-removal-refused` (refusal) | `refusing to remove "<h>" ... this machine's OWN age key ... fix the roster by hand ...` | message `rt will not remove <h>: the key on record for them is this Mac's own key`; why `Removing it would lock you out of every team secret. If <h>'s invite reply echoed your key back, fix the roster by hand instead.` | terminal |
| M4 | `members.ts:398-400` manual step | `"<h>" still has access to <remote> ... remove them there too; mattstack does not manage membership on this repo` | `<h> can still see the team repo. Remove them there too: mattstack does not manage who can see this repo.` | terminal fix callout |
| M5 | `members.ts:270-272, :278-280, :291` warnings | log text | unchanged (Task 3 gives them shown copy) | log |
| M6 | `members.ts:208-218` `MembersSyncAbortedError` (reaches the envelope as `members-error`) | `rt team members sync: aborted after adding <n> key(s) (<age keys>), <m> still pending (<handles>)` then a long dash and the raw cause | message `rt stopped syncing members partway, after adding <n> key` or `keys`; the class gains `readonly detail` holding `added <keys or none>; pending <handles or none>; <cause>`, which `reportMembersError` passes as `log`, with why `The keys it already added stay. Run the sync again.` and next `rt team members sync` | terminal, tray (`NotificationManager` logs it) |
| M7 | `members.ts:122` `age-keygen -y` failure (reaches the envelope as `members-error`) | `age-keygen -y: could not derive the public key from the stored private key` and the raw stderr | message `rt could not read this Mac's secrets key`, thrown as a new `MembersKeyError(message, detail)` whose `detail` is today's text; `reportMembersError` passes it as `log`, with why `Check that your keychain is unlocked, then try again.` | terminal |
| J1 | `join.ts:67` `invite-unknown` default | `invite not recognized or expired: ask the team owner for a new one` | message `That invite has expired or is not one rt knows`; why `Ask the team's owner for a new one.` | terminal; the tray shows its own copy for this code |
| J2 | `join.ts:80` denied `message` | `you don't have access yet: ask <owner> to grant you access to <name>` | `Ask <owner> to let you into <name>, since you don't have access yet.` | tray join, setup row (`steps-a.test.ts:515` matches the kept phrase) |
| J3 | `join.ts:143` `invite-malformed` | `invite pointer names an invalid team slug` | message `rt could not read that invite`; log today's text | terminal, tray join |
| J4 | `join.ts:146` `invite-malformed` | `invite pointer's remote is not a recognized git URL` | message `rt could not read that invite`; log today's text | terminal, tray join |
| J5 | `join.ts:200-211` `gitFailureMessage` (a failed clone's `message`) | missing-binary `git is not installed (or not on PATH) ... install git and try again`; disk-full `no space left on this machine ...`; exists `the destination already exists and isn't empty ...`; network `could not reach <remote> ... check your network and try again`; local `git failed (exit <n>): <output>` | missing-binary `This Mac cannot run git. Install it, then try again.`; disk-full `This Mac is out of disk space. Free some up, then try again.`; exists `The team's folder is already there and is not empty. Remove it, then try again.`; network `rt could not reach the team repo, so check your network and try again.`; local `git could not clone the team repo (exit <n>): <output>` | tray join, setup row |
| J6 | `join.ts:221-236` `accessFromVerdict` | `Joining <name> (owner <o>)` then: no-clt `... - access to the team repo is checked on the next screen`; no-account `... Connect your <forge> account on the next screen so rt can reach <repo>.`; denied `... Your <forge> account cannot see <repo> yet: ask <o> or your org admin to grant read access.`; unreachable `... Could not reach <repo>: <d>. The next screen re-checks it.`; undetermined `... Could not determine access to <repo> yet: <d>. The next screen re-checks it.` | `Joining <name>, owned by <o>.` then: no-clt `rt checks your access to the team repo once Apple's Command Line Tools are installed.`; no-account `Connect your <forge> account so rt can reach the team repo.`; denied `Your <forge> account cannot see the team repo yet. Ask <o> or your org admin for read access.`; unreachable `rt could not reach the team repo: <d>. It checks again when you join.`; undetermined `rt could not tell yet whether you can see the team repo: <d>. It checks again when you join.` ("next screen" is the tray's word; the terminal has none) | tray join (summary or warning), terminal |
| J7 | `join.ts:245`, `:484` unreachable `message` | `could not reach the invite relay - check your network and try again` | `rt could not reach the invite service. Check your network, then try again.` | tray join, terminal |
| J8 | `join.ts:366-368` `JoinPeeringStoreError` | `joined <name> and redeemed the invite, but could not store your board's switchboard token (<err>): fix that ... and run rt team join again ...` | message `You joined <name>, but rt could not save your board's switchboard token. Join again to finish; you do not need a new code.`; the error's new `detail` holds `<err>` with the board token and any age secret key scrubbed out (T11 adds why, next and log) | terminal, tray join, setup row |
| J9 | `join.ts:373` `peeringFix` | `set it yourself: rt settings set board.switchboardUrl '"<url>"' --scope machine` | `Point your board at the team's switchboard yourself: rt settings set board.switchboardUrl '"<url>"' --scope machine` (command kept: the only carrier the setup row and the tray have) | setup row remedy, terminal (inside J20) |
| J10 | `join.ts:392-395` `peeringFix` | `ask <o> for a new invite (rt team invite --handle <h>) and run rt team join with it, or ask them to re-invite your board ...` | `Ask <o> to invite <h> again and join with the new invite, or ask them to invite your board again from the board's members panel.` (the handle stays: it tells the owner whom to invite) | same |
| J11 | `join.ts:401` `peeringFix` | `the team's switchboard URL must be https, so the owner has to fix it in the team settings` | `The team's switchboard address must be https, so the team's owner has to fix it in the team settings.` | same |
| J12 | `join.ts:490` `no-join-intent` | `no invite in progress ... pass a code, or run rt team join --dry-run first to save one` | message `There is no invite in progress`; why `Run the join and paste the invite code when it asks.`; next `rt team join` | terminal |
| J13 | `join.ts:551-554` `team-remote-mismatch` (refusal) | `"<team>" is already cloned at <dir> with a different remote ... remove it to rejoin, or resolve by hand` | message `The <team> team is already on this Mac with a different repo`; why `Remove its folder to join again, or sort it out by hand.`; log `<dir>` | terminal, tray join |
| J14 | `join.ts:581-584` `secrets-store-not-ready` | `the team is cloned at <dir>, but this machine's secrets store is not set up yet ... run rt home init, then rt team join again ...` | message `The team is on this Mac, but this Mac's secrets are not set up yet. Set them up, then join again; you do not need a new code.`; why `Your board's switchboard token needs somewhere to go.`; next `rt home init` | terminal, setup row (matches the code only) |
| J15 | `join.ts:598-601` `forge-login-unknown` | `the team is cloned at <dir>, but your forge username could not be determined ... authenticate the <cli> CLI and run rt team join again (the invite has not been used yet)` | message `rt could not tell who you are on <GitHub or GitLab>. The invite has not been used yet.`; why `Sign in to the <cli> command line tool, then join again.`; next `<cli> auth login`; log `the team is cloned at <dir>` | terminal, setup row (no remedy for this code, so the fact rides in the message) |
| J16 | `join.ts:609-612` unreachable `message` | `could not reach the invite relay to finish redeeming ... already cloned at <dir>; run rt team join again once the relay is reachable` | `The team is on this Mac, but rt could not reach the invite service to finish. Join again once it is reachable; you do not need a new code.` | tray join, setup row |
| J17 | `join.ts:620` `invite-unknown` | `this invite was already used: ask <o> for a new one` | message `That invite was already used`; why `Ask <o> for a new one.` | terminal |
| J18 | `join.ts:628-631` `JoinKeyExchangeError` | `joined <name> and redeemed the invite, but could not read your local age key (<err>) ... fix keychain access and run rt team join again ...` | message `You joined <name>, but rt could not read this Mac's secrets key. Join again to finish; you do not need a new code.`; the error's new `detail` holds `<err>` with any age secret key scrubbed out (T10 adds why, next and log) | terminal, setup row |
| J19 | `join.ts:644` `message` (key not sent) | `joined <name>, but could not send your key back to <o> ... run rt team join again once the relay is reachable ...` | `Joined <name>, but rt could not send your key back to <o>. Join again once the invite service is reachable; you do not need a new code.` | tray join, setup row |
| J20 | `join.ts:652`, `:658` success `message` | `Joined <name> (owner <o>)` and, when peering failed, `; board peering could not be set up automatically... <peeringFix>` | `Joined <name>, owned by <o>.` and, when peering failed, ` Your board is not connected yet. <peeringFix>` | tray join, setup row (`steps-a.test.ts:483` matches the kept `Joined <name>`) |

Count: 81 rows, 72 reworded. Unchanged by decision: T1, T2, T6, T12, IC4, F6, I10, I11 and M5, and, outside the table, `invite-records.ts:49` (its daemon test reads it).

#### Readers of the reworded strings

| Reader | What it reads | How this plan keeps it working |
|---|---|---|
| `rt-tray/Sources-core/Setup/TeamChoiceModel.swift:219-238` (`joinVerdict`) | `TeamJoinResult.access`, `.intent`, `.team`; shows `.message` as the summary (ok) or the warning (other), and `error.message` for code `no-access`; `joinFailureCopy` keys on codes | displays, never matches: the reworded J2, J6, J7, J16, J19 and J20 read right in the tray (no "next screen", which only the tray could follow). Codes, access, intent unchanged |
| `rt-tray/Sources-core/Settings/TeamSettingsModel.swift:28-32` | `team status --json`, `team invite --json`; shows `peeringWarning` and the manual steps | displays only; I6, I3, I4, F1 to F7 read right on their own |
| `rt-tray/Sources/NotificationManager.swift:467-491` | `team members sync --json`; logs an error's message | log only |
| `rt-tray/Tests/MattstackCoreChecks/*.swift`, `rt-tray/Tests/stub-rt/stub.ts` | their own fixture JSON | never run the CLI; nothing to change |
| `lib/setup/steps/team.ts` (phase 3) | `err.message`, `JoinResult.message`, `peeringFix` as a setup row's detail and remedy; matches codes `push-denied` and `secrets-store-not-ready` | codes unchanged; the strings pass through |
| `lib/setup/__tests__/steps-a.test.ts:483`, `:515` (phase 3) | `toContain("Joined Acme")`, `toContain("you don't have access yet")` from a real join | J20 and J2 keep both phrases; this plan does not edit `lib/setup` |
| `lib/setup/validators/rt-health.ts:636` (phase 3) | `ONE_TEAM_RULE` | the constant is not edited; C8 builds around it |
| `lib/setup/steps/secrets.ts:51` and `lib/setup/__tests__/steps-a.test.ts:696` (phase 3) | the `team-pull-only` message, with ` Nothing was written.` appended; the test matches `pull-only` | C9 keeps `pull-only` and ends with a period, so the appended sentence still reads right |
| `lib/secrets/__tests__/team-store.test.ts:301`, `:470` (phase 6) | `toThrow(/pull-only/)` from `assertNotJoined` | C9 keeps `pull-only` |
| `lib/daemon/__tests__/invite-replies.test.ts` | `invite records file is not a valid records map` | not reworded (`invite-records.ts` is not edited) |
| `e2e/tests/setup.test.ts:92-98`, `e2e/tests/team-membership.test.ts` | `error.code` only | codes unchanged |
| `apps/console`, `apps/board`, `packages/rt-client`, the skills under `skills/` and `plugins/` | nothing: a search for `team join`, `JoinResult`, `peeringFix`, `peeringWarning`, `manualSteps` and `residueNote` finds no reader of these strings | nothing to keep or update |
| `lib/team/__tests__/*.test.ts`, `commands/__tests__/team*.test.ts` | the old strings, in assertions | Task 4 updates each assertion on a reworded string |

---

### Task 3: The `lib/team` warn sinks, and ruling 12 in `join.ts`

**Files:**
- Modify: `lib/team/invite.ts:119, :137-140, :282, :329`
- Modify: `lib/team/join.ts:277, :291-293, :305, :328, :333, :400, :409, :435-438`
- Modify: `lib/team/members.ts:170, :177-180, :270, :278, :291`
- Create: `lib/team/__tests__/warn-sinks.test.ts`
- Modify: `lib/team/__tests__/join.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json`

**Interfaces:**
- Consumes: `warn(module, message, opts?)`, `setWarningLog`, `__test__.reset`, `type ShownWarning` (`lib/ui/warn.ts`, 5a); `out.cmd` (`lib/ui/out.ts`); `captureOut()` (`lib/ui/__tests__/capture-out.ts`); `logFailureDetail`, `UserActionableError` (`lib/errors.ts`).
- Produces, exactly:
  - In `MintInviteSeams` (`lib/team/invite.ts:119`), `JoinRedeemSeams` (`lib/team/join.ts:277`) and `MembersSeams` (`lib/team/members.ts:170`), the field `warn: (message: string, shown?: ShownWarning) => void;`.
  - In each of the three files, the default `function defaultWarn(message: string, shown?: ShownWarning): void`, which calls `warn("team", message, { show: shown ?? { title: message } })` from `lib/ui/warn.ts`.
  - A one-argument call keeps working and still shows something: `lib/setup/team-settings.ts` (phase 3's file, not edited) receives `seams.warn` through `readTeamSnapshot(p, slug, { read, warn: seams.warn })` (`invite.ts:221`, `join.ts:574`) and `readUserIntegrationOverrides({ read, warn: seams.warn })` (`join.ts:323`, `:543`), whose parameter is typed `(message: string) => void`, and calls it with the message alone; that message is shown as the title. A one-argument fake in a test also still satisfies the field's type. The warn-sinks test below pins the one-argument call.

- [ ] **Step 1: Write the failing tests**

Create `lib/team/__tests__/warn-sinks.test.ts`:

```ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import * as out from "../../ui/out.ts";
import { captureOut } from "../../ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnTest } from "../../ui/warn.ts";
import { realMintInviteSeams } from "../invite.ts";
import { realJoinRedeemSeams } from "../join.ts";
import { realMembersSeams } from "../members.ts";

let io: ReturnType<typeof captureOut>;
let logged: Array<{ module: string; message: string }>;

beforeEach(() => {
  io = captureOut();
  out.__test__.setHuman(() => false);
  warnTest.reset();
  logged = [];
  setWarningLog((module, message) => {
    logged.push({ module, message });
  });
});
afterEach(() => {
  warnTest.reset();
  io.restore();
});

const sinks = {
  invite: () => realMintInviteSeams().warn,
  join: () => realJoinRedeemSeams().warn,
  members: () => realMembersSeams().warn,
};

for (const [name, sink] of Object.entries(sinks)) {
  test(`${name}: the default sink logs the message and shows the plain copy on stderr`, () => {
    sink()("board peering: the switchboard register answered 500", { title: "This invite will not connect their board", hint: "invite their board again after they join" });
    expect(logged).toEqual([{ module: "team", message: "board peering: the switchboard register answered 500" }]);
    expect(io.stderr()).toBe("[warning] This invite will not connect their board  invite their board again after they join\n");
    expect(io.stdout()).toBe("");
  });

  test(`${name}: a warning with no copy of its own shows its message`, () => {
    sink()("board.members is not a list");
    expect(io.stderr()).toBe("[warning] board.members is not a list\n");
    expect(io.stdout()).toBe("");
  });
}
```

In `lib/team/__tests__/join.test.ts`, add `import type { ShownWarning } from "../../ui/warn.ts";` to the imports, and add this test directly after the test named `a throwing readTeamSecret stays inside peering: unavailable, join still ok` (same `describe`, so `redeemProbes`, `fakeRelay`, `baseJoinRedeemSeams`, `fakeRead`, `NO_SECRETS` and `CODE` are in scope):

```ts
  test("a team-secrets failure inside peering keeps its next command in the warning", async () => {
    const p = redeemProbes();
    const relay = fakeRelay();
    const shown: Array<ShownWarning | undefined> = [];
    const { seams } = baseJoinRedeemSeams({
      read: fakeRead({ "mattstack.integrations": { switchboard: { url: "https://sb.test" } } }),
      readTeamSecret: async () => {
        throw new UserActionableError("team-secrets-unreadable", "This Mac cannot read the acme team's secrets yet", { team: "acme" }, { why: "No key matches.", next: "rt team pull", log: "sops -d /x/rt.json: no key" });
      },
      warn: (_message, copy) => {
        shown.push(copy);
      },
    });

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.peering).toBe("unavailable");
    expect(shown).toContainEqual({
      title: "rt could not register your board with the team's switchboard",
      hint: "This Mac cannot read the acme team's secrets yet",
      next: { text: "rt team pull", role: "command" },
    });
  });

  test("a plain error inside peering warns with no next command", async () => {
    const p = redeemProbes();
    const relay = fakeRelay();
    const shown: Array<ShownWarning | undefined> = [];
    const { seams } = baseJoinRedeemSeams({
      read: fakeRead({ "mattstack.integrations": { switchboard: { url: "https://sb.test" } } }),
      readTeamSecret: async () => {
        throw new Error("keychain sulking\nsecond line");
      },
      warn: (_message, copy) => {
        shown.push(copy);
      },
    });

    await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(shown).toContainEqual({ title: "rt could not register your board with the team's switchboard", hint: "keychain sulking" });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run (repo root): `bun test lib/team/__tests__/warn-sinks.test.ts lib/team/__tests__/join.test.ts`
Expected: FAIL. The sink tests find the raw message on stderr with no `[warning]` tag and an empty `logged`; the two join tests receive `undefined` copies.

- [ ] **Step 3: Widen the seam and replace the default sink in all three files**

In each of `lib/team/invite.ts`, `lib/team/join.ts` and `lib/team/members.ts`:

Add the import below to all three files. `join.ts` alone also needs `import * as out from "../ui/out.ts";` (Step 4 builds two `next` commands there):

```ts
import { warn as warnLine, type ShownWarning } from "../ui/warn.ts";
```

Change the seam field from `warn: (message: string) => void;` to:

```ts
  /** `message` is the log text; `shown` is what a person reads, and a warning without it shows its message. */
  warn: (message: string, shown?: ShownWarning) => void;
```

Replace the whole `defaultWarn` function, with the doc comment above it where there is one, with:

```ts
function defaultWarn(message: string, shown?: ShownWarning): void {
  warnLine("team", message, { show: shown ?? { title: message } });
}
```

- [ ] **Step 4: Give each call site its copy**

Each edit adds a second argument to an existing `seams.warn(...)` call. The first argument, the message, is not edited.

`lib/team/invite.ts:282`, `seams.warn(peeringWarning);` becomes:

```ts
      seams.warn(peeringWarning, { title: "This invite will not connect their board", hint: "invite their board again from the board's members panel after they join" });
```

`lib/team/invite.ts:329-331`: after the template string that is the call's only argument, add:

```ts
        { title: `The earlier invite for ${opts.handle} is still live`, hint: "it stops working when it expires" },
```

`lib/team/join.ts:305` (inside `pointBoardAt`'s catch): add as the second argument:

```ts
{ title: "rt could not point your board at the team's switchboard", hint: "the join result says how to set it" }
```

`lib/team/join.ts:328` (the confirmed-elsewhere branch of `confirmSwitchboardForRt`): add as the second argument:

```ts
{ title: "rt's setup still points at a different switchboard", hint: "left as it is", next: out.cmd(remedy) }
```

`lib/team/join.ts:333` (that function's catch): add as the second argument:

```ts
{ title: "rt could not record the team's switchboard for setup", next: out.cmd(remedy) }
```

`lib/team/join.ts:400`: add as the second argument:

```ts
{ title: "The team's switchboard address is not secure", hint: "board peering was skipped; the team owner has to fix it" }
```

`lib/team/join.ts:409`: add as the second argument:

```ts
{ title: "This invite's switchboard is not the team's", hint: "its board token was not used" }
```

`lib/team/join.ts:435-438`, the catch in `peerBoard`, becomes (the `logFailureDetail` line is already there from phase 2):

```ts
  } catch (err) {
    if (err instanceof UserActionableError) logFailureDetail(err);
    seams.warn(`board peering: could not register this board (${errorText(err)})`, {
      title: "rt could not register your board with the team's switchboard",
      hint: errorText(err).split("\n")[0],
      ...(err instanceof UserActionableError && err.next ? { next: out.cmd(err.next) } : {}),
    });
    return reinvite;
  }
```

`lib/team/members.ts:270-272`: after the template string, add:

```ts
          { title: `The reply from ${handle} could not be used`, hint: "their invite stays open to try again" },
```

`lib/team/members.ts:278-280`: after the template string, add:

```ts
          { title: `The reply from ${handle} repeats a key the team already has`, hint: "treated as suspect; look into it before syncing again" },
```

`lib/team/members.ts:291`: add as the second argument:

```ts
{ title: `${handle} was already added`, hint: "their invite stays open" }
```

- [ ] **Step 5: Delete three allowlist lines**

In `lib/__tests__/raw-output-allowlist.json`, delete the lines `"lib/team/invite.ts",`, `"lib/team/join.ts",` and `"lib/team/members.ts",`.

- [ ] **Step 6: Run the tests and the guards**

Run: `bun test lib/team/__tests__ lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-daemon-sync-exec.test.ts commands/__tests__/team.test.ts commands/__tests__/team-join.test.ts`
Expected: PASS. Every existing fake in `lib/team/__tests__` takes one argument and still type-checks.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/team/invite.ts lib/team/join.ts lib/team/members.ts lib/team/__tests__/warn-sinks.test.ts lib/team/__tests__/join.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "lib/team: warnings carry plain copy and go through the warn seam

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The copy pass on `lib/team`'s human strings

Applies Task 2's copy table. Every row keeps its `code`, every result keeps its keys and its machine values; only the human strings named in the table change.

**Files:**
- Modify: `lib/team/create.ts:98-100, :123, :131-140, :165-168`, `lib/team/slug.ts:13`, `lib/team/one-team.ts:17`, `lib/team/team-local.ts:86-89`
- Modify: `lib/team/invite-crypto.ts:40, :125, :133, :138, :159, :279`, `lib/team/relay-client.ts:55, :59, :63, :84`
- Modify: `lib/team/publish.ts:33-41, :57, :63, :71`, `lib/team/invite.ts:58, :173-176, :202, :213, :223, :280-282, :296, :310-313`, `lib/team/forge.ts:58-66, :138`
- Modify: `lib/team/members.ts:117-125, :208-218, :321-322, :353-356, :377-381, :398-400`, `lib/team/redact.ts` (adds the exported `scrub`)
- Modify: `lib/team/join.ts:56-61, :67, :80, :143, :146, :200-211, :220-237, :245, :366-368, :373, :392-395, :401, :484, :490, :551-554, :581-584, :596-601, :609-612, :620, :628-631, :644, :652, :658`
- Modify: `commands/team.ts:155-170, :186-192, :238-241, :293-296, :323, :353-359, :365-370, :529` and the eight `resolveTeamSlug(args)` calls
- Create: `lib/team/__tests__/copy.test.ts`
- Modify: `lib/team/__tests__/join.test.ts`, `create.test.ts`, `invite.test.ts`, `forge.test.ts`, `members.test.ts`, `publish.test.ts`, `relay-client.test.ts`, `commands/__tests__/team.test.ts`, `commands/__tests__/team-join.test.ts`

**Interfaces:**
- Consumes: `UserActionableError(code, message, extra?, options?: { why?: string; next?: string; log?: string })` (`lib/errors.ts`, phase 2); Task 3's `lib/team` files.
- Produces:
  - `JoinKeyExchangeError` and `JoinPeeringStoreError` (`lib/team/join.ts`) take `(message: string, detail?: string)` and expose `readonly detail?: string`. A one-argument construction, as `lib/setup/__tests__/steps-a.test.ts:576` does, still type-checks.
  - `MembersSyncAbortedError` (`lib/team/members.ts`) keeps its constructor `(added, pending, causeMessage)` and gains `readonly detail: string`; a new `MembersKeyError(message: string, detail: string)` is exported beside it.
  - `resolveTeamSlug(args: string[], verb: string): string` in `commands/team.ts` (file-local; `verb` is the command after `rt`, such as `"team pull"`, and for `members remove` it ends with the handle).
  - No envelope key, type, code, status or exit code changes.

- [ ] **Step 1: Write the failing tests**

Create `lib/team/__tests__/copy.test.ts`:

```ts
import { test, expect } from "bun:test";
import { UserActionableError } from "../../errors.ts";
import type { Probes } from "../../setup/probes.ts";
import { decodeCode } from "../invite-crypto.ts";
import { createRelayClient } from "../relay-client.ts";
import { slugify } from "../slug.ts";

async function caught(fn: () => unknown): Promise<UserActionableError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof UserActionableError) return err;
    throw err;
  }
  throw new Error("expected a UserActionableError");
}

const words = (err: UserActionableError) => ({ code: err.code, message: err.message, why: err.why, next: err.next, log: err.log });
const relay = (status: number) => createRelayClient((async () => ({ status, body: "" })) as unknown as Probes["fetch"], "https://relay.example.test");
const ID = "0".repeat(32);

test("a team name with no letter or number", async () => {
  expect(words(await caught(() => slugify("!!!")))).toEqual({
    code: "bad-team-name",
    message: '"!!!" cannot be a team name',
    why: "A team name needs at least one letter or number.",
    next: undefined,
    log: undefined,
  });
});

test("an invite code of the wrong length", async () => {
  expect(words(await caught(() => decodeCode("ABC")))).toEqual({
    code: "invite-malformed",
    message: "That invite code is the wrong length",
    why: "Check that you pasted all of it.",
    next: undefined,
    log: undefined,
  });
});

test("the invite service out of reach, and answering with an error", async () => {
  expect(words(await caught(() => relay(0).fetch(ID)))).toEqual({
    code: "relay-unreachable",
    message: "rt could not reach the invite service",
    why: "Check your network, then try again.",
    next: undefined,
    log: undefined,
  });
  expect(words(await caught(() => relay(500).fetch(ID)))).toEqual({
    code: "relay-error",
    message: "The invite service answered with an error",
    why: undefined,
    next: undefined,
    log: `500 /v1/invites/${ID}`,
  });
});

test("an id that is not one rt made never reaches the service", async () => {
  expect(words(await caught(() => relay(200).fetch("not-an-id")))).toEqual({
    code: "relay-error",
    message: "rt could not read that invite",
    why: undefined,
    next: undefined,
    log: "invite id must be a 32-character hex id",
  });
});

test("no reworded string carries a long dash", async () => {
  const dash = new RegExp(`[${String.fromCodePoint(0x2013)}${String.fromCodePoint(0x2014)}]`);
  for (const err of [await caught(() => slugify("!!!")), await caught(() => decodeCode("ABC")), await caught(() => relay(0).fetch(ID))]) {
    expect(`${err.message} ${err.why ?? ""}`).not.toMatch(dash);
  }
});
```

In `lib/team/__tests__/join.test.ts`, change these assertions (each line number at `5bc69f231`).

A pinned fact whose words move out of `message` is asserted where it now lives (`why`, `next`, `log`, or the error's `detail`); no assertion is deleted. `JoinPeeringStoreError` and `JoinKeyExchangeError` are imported in this file already.

| Line | Today's expected value | New expected value |
|---|---|---|
| 211 | `toContain("next screen")` | `toContain("once Apple's Command Line Tools are installed")` |
| 226 (inside the `toEqual`) | `message: "Joining Acme (owner matt)"` | `message: "Joining Acme, owned by matt."` |
| 259 | `toBe("invite not recognized or expired: ask the team owner for a new one")` | `toBe("That invite has expired or is not one rt knows")`, then add `expect((caught as UserActionableError).why).toBe("Ask the team's owner for a new one.");` |
| 306 | `toContain("ask matt or your org admin")` | `toContain("Ask matt or your org admin for read access.")` |
| 327 | `toContain("next screen")` | `toContain("account so rt can reach the team repo.")` |
| 337 | `toContain("re-checks it")` | `toContain("It checks again when you join.")` |
| 458 | `toContain("ask matt")` | `toContain("Ask matt or your org admin for read access.")` (this is `joinDryRun`, whose message comes from `accessFromVerdict`, J6, as at line 306) |
| 884, 906 | `not.toContain("re-invite")` | `not.toContain("invite your board again")` (the https fix must not offer the re-invite remedy; the old word no longer appears in any wording, so the old check passed for anything) |
| 951 | `toContain("re-invite")` | `toContain("invite your board again")` |
| 970 | `(caught as Error).message` `toContain("keychain locked")` | `expect((caught as JoinPeeringStoreError).detail).toBe("keychain locked");` |
| 971 | `toContain("run \`rt team join\` again")` | `toContain("Join again to finish; you do not need a new code.")` |
| 989 | `message` `toContain("rt home init")` | `expect((caught as UserActionableError).next).toBe("rt home init");` |
| 990 | `toContain("no new code needed")` | `toContain("you do not need a new code")` |
| 991 | `not.toContain("has not been used")` | unchanged |
| 1065 | `message` `toContain("sops: no matching creation rules")` | `expect((caught as JoinPeeringStoreError).detail).toBe("sops: no matching creation rules");` |
| 1066 | `toContain("no new code needed")` | `toContain("you do not need a new code")` |
| 1108 | `peeringFix` `toContain("rt team invite --handle zaphod")` | `toContain("Ask matt to invite zaphod again")` (J10 keeps the handle; the owner's command left the joiner's text) |
| 1109 | `peeringFix` `toContain("or ask them to re-invite your board from the board's members panel")` | `toContain("or ask them to invite your board again from the board's members panel")`; line 1110 (`message` contains `peeringFix`) does not change |
| 1199 | `toBe("you don't have access yet: ask matt to grant you access to Acme")` | `toBe("Ask matt to let you into Acme, since you don't have access yet.")` |
| 1222 | `toContain("already exists")` | `toContain("already there and is not empty")` |
| 1241 | `toContain("git is not installed")` | `toContain("This Mac cannot run git")` |
| 1268 | `toBe("this invite was already used: ask matt for a new one")` | `toBe("That invite was already used")`, then add `expect((caught as UserActionableError).why).toBe("Ask matt for a new one.");` |
| 1505 | `toContain("redeemed the invite")` | `toContain("You joined Acme")` |
| 1506 | `toContain("run \`rt team join\` again")` | `toContain("Join again to finish; you do not need a new code.")`, then add `expect((caught as JoinKeyExchangeError).detail).toBeDefined();` |
| 1527 | `toContain("has not been used yet")` | unchanged (J15 keeps the fact in its message); add `expect((caught as UserActionableError).next).toBe("gh auth login");` |
| 1623 | `const REFUSAL = "this machine is set up for team globex; mattstack supports one team per machine today";` | `const REFUSAL = "This Mac is already set up for the globex team, and mattstack supports one team per machine today";` |

Lines 883 and 1121 (`"must be https"`), 1232, 1242 and 1251 (`"check your network"`) and 1450 (`"could not send your key back"`) keep their phrase and do not change.

In the `describe` `a join never burns an invite whose board token has nowhere to go` (where `DECLARED` and `EMBEDDED` are in scope), directly after the test `an embedded token whose store write fails after redeem throws a resumable error: no reply, intent kept with the token`, add:

```ts
    test("a store failure that quotes the board token never carries it into the log detail", async () => {
      const p = redeemProbes();
      const relay = fakeRelay({ fetch: relayServing(EMBEDDED) });
      const secretKey = `AGE-SECRET-KEY-1${"Q".repeat(58)}`;
      const { seams } = baseJoinRedeemSeams({
        read: fakeRead(DECLARED),
        writeLocalSecret: async () => {
          throw new Error(`sops: rejected tok-emb and ${secretKey}`);
        },
      });

      const caught = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams).catch((err: unknown) => err);

      expect(caught).toBeInstanceOf(JoinPeeringStoreError);
      const detail = (caught as JoinPeeringStoreError).detail ?? "";
      expect(detail).not.toContain("tok-emb");
      expect(detail).not.toContain(secretKey);
      expect(detail).toBe("sops: rejected <token> and AGE-SECRET-KEY-1<redacted>");
    });
```

Directly after the test `clone auth failure returns access:denied without ever calling relay.redeem` (same `describe`, so `redeemProbes`, `fakeRelay`, `baseJoinRedeemSeams`, `NO_SECRETS` and `CODE` are in scope), add:

```ts
  test("the join messages keep the two phrases phase 3 reads", async () => {
    const denied = await joinRedeem(
      redeemProbes({ exec: () => ({ code: 128, stdout: "", stderr: "fatal: Authentication failed" }) }),
      fakeRelay().client,
      () => NO_SECRETS,
      { code: CODE },
      baseJoinRedeemSeams().seams,
    );
    expect(denied.message).toContain("you don't have access yet");

    const joined = await joinRedeem(redeemProbes(), fakeRelay().client, () => NO_SECRETS, { code: CODE }, baseJoinRedeemSeams().seams);
    expect(joined.message).toStartWith("Joined Acme");
  });
```

In `commands/__tests__/team-join.test.ts`:

| Line | Today's expected value | New expected value |
|---|---|---|
| 126 | `toBe("pass the invite code on stdin, never as an argument")` | `toBe("rt never takes an invite code as an argument")` |
| 149 | `toBe("this machine is set up for team globex; mattstack supports one team per machine today")` | `toBe("This Mac is already set up for the globex team, and mattstack supports one team per machine today")` |
| 179 (inside the `toEqual`) | `message: "Joining Acme (owner matt)"` | `message: "Joining Acme, owned by matt."` |
| 197 | `toContain("ask matt or your org admin")` | `toContain("Ask matt or your org admin for read access.")` |
| 251 | `toBe("invite code is the wrong length")` | `toBe("That invite code is the wrong length")` |
| 273 | `toBe("Joined Acme (owner matt)")` | `toBe("Joined Acme, owned by matt.")` |
| 353 | `toContain("redeemed the invite")` | `toContain("You joined Acme")` |
| 381 | `toContain("no new code needed")` | `toContain("you do not need a new code")` |
| 418 | `toContain("has not been used yet")` | unchanged (J15 keeps the fact in its message) |

Line 160 (`toContain("[failed] pass the invite code on stdin, never as an argument")`, without the tag after 5a) becomes `toContain("rt never takes an invite code as an argument")` here; Task 6 turns it into the refusal's full text.

In `commands/__tests__/team.test.ts`: line 112 takes the same new one-team string as line 149 above; line 293 `toContain("Ask whoever administers")` becomes `toContain("Ask whoever runs the team repo")`; line 317 `toContain("board peering was not embedded")` becomes `toContain("This invite will not connect their board")`; line 409 takes the same change as line 293. Line 496 is a fake daemon reply, not an assertion, and stays.

In `lib/team/__tests__/create.test.ts`, line 256 (inside `toMatchObject`) takes the new one-team string, and directly after the test `--create-repo path: gh succeeds, git init then fails, and a resume finishes WITHOUT calling gh a second time` add (import `UserActionableError` from `"../../errors.ts"` if the file does not already):

```ts
    test("a failed git step keeps git's output, URLs stripped, in the log and out of the message", async () => {
      const p = gitAwareFakeProbes("/home/x", (argv) =>
        argv[0] === "git" && argv[1] === "init" ? { code: 128, stdout: "", stderr: "fatal: could not reach https://x-access-token:SECRET@github.com/o/r.git" } : undefined,
      );

      const err = await createTeam(p, { name: "Acme", remote: "https://github.com/o/r.git", others: false }, new FakeAgeKeySeam()).catch((e: unknown) => e);

      expect(err).toMatchObject({ code: "git-init-failed", message: "rt could not start the team repo" });
      const log = (err as UserActionableError).log ?? "";
      expect(log).toStartWith("git init -b main failed (exit 128): fatal: could not reach");
      expect(log).not.toContain("SECRET");
      expect(log).not.toContain("https://");
    });
```

In `lib/team/__tests__/invite.test.ts` (import `decodeCode` from `"../invite-crypto.ts"` if the file does not already):

| Line | Today's expected value | New expected value |
|---|---|---|
| 462 | `peeringWarning` `toContain("no readable switchboardAdminToken secret in the local rt domain")` | `toBe("This invite will not connect their board. After they join, invite their board again from the board's members panel.")` |
| 463 | `expect(warnings).toContain(result.peeringWarning!)` | `expect(warnings).toContain("board peering: no readable switchboardAdminToken secret in the local rt domain")` (the reason now lives in the warning's log text) |
| 474 | `(caught as Error).message` `toContain("no readable switchboardAdminToken")` | `expect((caught as UserActionableError).log).toContain("no readable switchboardAdminToken");` |
| 599 | `err.message` `toContain(relay.createReturns[0]!.id)` | the three lines below |
| 629, 685 | `toContain("rt team manage-membership on --team acme")` | unchanged (I3 keeps the command with its team) |
| 708 | `toContain("Ask whoever administers")` | `toContain("Ask whoever runs the team repo")` |
| 714, 723 | `toThrow(/https/)` | unchanged (I1's message keeps "must be https") |

Line 599 becomes:

```ts
    const code = err.message.split("Write its code down now: ")[1]!;
    expect(decodeCode(code).idHex).toBe(relay.createReturns[0]!.id);
    expect(err.log).toBeUndefined();
```

The id is recovered from the code the message carries, and the error has no `log`, so `logFailureDetail` never writes the code to the CLI log.

In `lib/team/__tests__/members.test.ts`:

| Line | Today's expected value | New expected value |
|---|---|---|
| 524 | `err.message` `toContain("aborted after adding 0 key(s)")` | `toBe("rt stopped syncing members partway, after adding 0 keys")`, then add `expect(err.detail).toStartWith("added none; pending none; ");` |
| 566, 598 | `toContain("still has access")` | `toContain("can still see the team repo")` |
| 672, 770 | `residueNote` `toContain("rotate the values themselves")` | `toContain("Rotate those values to shut them out.")` |

`:533` and `:869` (`toThrow(/pull-only/)`) do not change: C9 keeps the word.

In `lib/team/__tests__/publish.test.ts`, the redaction checks follow the redacted git output into `log`, where `logFailureDetail` writes it to disk; the message can no longer hold it at all:

| Line | Today's expected value | New expected value |
|---|---|---|
| 137, 138 | `err.message` `not.toContain("SECRET")`, `not.toContain("https://")` | `const log = err.log ?? "";`, `expect(log).toContain("Authentication failed");`, `expect(log).not.toContain("SECRET");`, `expect(log).not.toContain("https://");`, `expect(err.message).toBe("The forge would not let rt push to the team repo");` |
| 160 | `err.message` `toContain("EMPTY")` | `expect(err.why).toBe("rt starts a team in an empty repo.");` |
| 183 | `err.message` `not.toContain("SECRET")` | `expect(err.log ?? "").toStartWith("git push -u origin main failed");`, `expect(err.log).not.toContain("SECRET");` |
| 203 | `err.message` `not.toContain("SECRET")` | `expect(err.log ?? "").toStartWith("git remote add origin failed");`, `expect(err.log).not.toContain("SECRET");` |

`:98` (`toMatch(/pull-only/)`) does not change.

In `lib/team/__tests__/relay-client.test.ts`, line 265 `toBe(\`500 /v1/invites/${ID_HEX}\`)` becomes `toBe("The invite service answered with an error")`, and add `expect((caught as UserActionableError).log).toBe(\`500 /v1/invites/${ID_HEX}\`);`.

In `lib/team/__tests__/forge.test.ts`:

| Line | Today's expected value | New expected value |
|---|---|---|
| 29 | `toContain("must accept the pending GitHub collaboration invite")` | `toContain("has to accept GitHub's invite to the repo")` |
| 41 | `"Install the GitHub CLI (\`gh\`), then run \`gh auth login\`"` | `"Install the GitHub command line tool, then sign in: gh auth login"` |
| 54 | `toBe("Run \`gh auth login\`, then retry \`rt team invite\`")` | `toBe("Sign in, then invite them again: gh auth login")` |
| 63 | `toContain("SAML/SSO enforcement")` | `toContain("single sign-on")` |
| 72 | `toContain('"octocat" is a real GitHub username')` | unchanged (the phrase stays) |
| 81 | `toContain("token lacks permission")` | `toContain("token cannot change who can see this repo")` |
| 124 | the GitLab unknown-handle step, today with a long dash before `it was not found` | `'Check that "zaphod" is a real GitLab username: it was not found'` |

Then find any assertion this list missed. Run each alone and read every hit:

- `grep -rn "not recognized or expired\|was already used\|next screen\|git is not installed\|no space left\|isn't empty\|could not reach the invite relay\|already cloned at\|could not be determined\|no invite in progress\|grant you access\|(owner \|set it yourself\|re-invite your board\|URL must be https" lib/team/__tests__ commands/__tests__`
- `grep -rn "is not a well-formed\|refusing to remove\|still has access to\|decrypted; rotate\|Let mattstack grant it\|has no git remote configured\|did not honor\|could not save its local record\|doesn't look like\|refusing to mint\|RT_JOIN_BASE_URL must" lib/team/__tests__ commands/__tests__`
- `grep -rn "a git remote is required\|a repo already exists there\|printed no URL\|already exists at\|not a usable team name\|is pull-only\|fast-forward past\|no team zone\|outside the Crockford\|failed (exit" lib/team/__tests__ commands/__tests__`

- `grep -rn "re-invite\|redeemed the invite\|no new code needed\|re-checks it\|ask matt\|aborted after adding\|rotate the values\|EMPTY\|not.toContain(\"SECRET\")\|run \`rt team join\` again\|manage-membership on --team" lib/team/__tests__ commands/__tests__`

A hit inside an `expect(...)` on a value rt produced is an assertion on the old copy: change it to the row's new copy, asserting a fact that left `message` where it now lives. A hit inside a fake (a seam that throws or returns its own string, a fixture message, a test name) stays. The last grep's hits are all listed above; it is there to catch one these tables missed.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/team/__tests__/copy.test.ts lib/team/__tests__/join.test.ts lib/team/__tests__/forge.test.ts lib/team/__tests__/create.test.ts lib/team/__tests__/invite.test.ts lib/team/__tests__/members.test.ts lib/team/__tests__/publish.test.ts lib/team/__tests__/relay-client.test.ts commands/__tests__/team.test.ts commands/__tests__/team-join.test.ts`
Expected: FAIL. Every changed assertion finds today's wording; `copy.test.ts` finds the old messages and no `why` or `log`. The new phase 3 phrase test passes already (both phrases are in today's text) and must stay green.

- [ ] **Step 3: Reword `lib/team`**

Work down the copy table. A row that names `message`, `why`, `next` or `log` becomes a `UserActionableError` with that message and the rest in its fourth argument, `{}` as its third (none of these errors carries `extra` today). For example, row C2 at `lib/team/create.ts:123`:

```ts
    throw new UserActionableError("remote-required", "The team needs a repo", {}, {
      why: "Give rt the address of an empty repo, or let it create one on GitHub.",
      next: "rt team create <name> --remote <url>",
    });
```

A row whose today's text goes to `log` keeps that exact expression as the `log` value, so the CLI log still has the raw output, the path or the id. A row with no `message` (a result string, a manual step, a note) replaces the string in place. The rows that need more than a string swap:

Row C1, `lib/team/create.ts`: above `gitStepError`, add the titles, and give the function its new body (its doc comment stays):

```ts
const GIT_STEP_TITLE: Record<string, string> = {
  "git-init-failed": "rt could not start the team repo",
  "git-remote-failed": "rt could not point the team repo at its remote",
  "git-add-failed": "rt could not stage the team repo's files",
  "git-commit-failed": "rt could not make the team repo's first commit",
};

function gitStepError(code: string, step: string, result: ExecResult): UserActionableError {
  return new UserActionableError(code, GIT_STEP_TITLE[code] ?? "rt could not set up the team repo", {}, {
    log: `${step} failed (exit ${result.code}): ${withoutUrls(`${result.stdout}\n${result.stderr}`.trim())}`,
  });
}
```

Row I9, `lib/team/invite.ts:309-314`, the `catch` around `upsertInviteRecord` (the comment above the `try` stays). It carries no `log`: the message holds the code, and `logFailureDetail` logs the message of any error that has one.

```ts
  } catch (err) {
    throw new UserActionableError("invite-record-write-failed", `rt made the invite but could not save its record. Write its code down now: ${code}`, {}, {
      why: `Without the record rt cannot cancel the invite or add the member later. Saving it failed: ${err instanceof Error ? err.message : String(err)}.`,
    });
  }
```

Row I6 and I7, `lib/team/invite.ts:279-283`: the sentence a person reads no longer carries the reason; the reason goes to the warning's log text and the failure's log:

```ts
    if (embedFailure) {
      peeringWarning = "This invite will not connect their board. After they join, invite their board again from the board's members panel.";
      if (opts.requirePeering) {
        throw new UserActionableError("peering-not-embedded", "rt did not make the invite, because it could not connect their board", {}, {
          why: "It could not register their board with the team's switchboard.",
          log: embedFailure,
        });
      }
      seams.warn(`board peering: ${embedFailure}`, { title: "This invite will not connect their board", hint: "invite their board again from the board's members panel after they join" });
    }
```

Rows J8 and J18, `lib/team/join.ts`: replace the two class declarations at `:56-61` with the code below. `JoinPeeringStoreError`'s doc comment stays; `JoinKeyExchangeError`'s says the CLI exits 1, which has not been true since `teamJoin` gave it the `age-key-unavailable` code, so it is replaced by the one shown.

```ts
/** Raised only after the clone and the relay redeem have already succeeded: the join is real, but the local age key could not be read. Not a `UserActionableError`, so `teamJoin` gives it its own code (`age-key-unavailable`, exit 2) and it never reads as a dead invite. */
export class JoinKeyExchangeError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

export class JoinPeeringStoreError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}
```

Add the scrubber every error detail in this task passes through before it becomes a `log` (J8, J18, M6, M7), to `lib/team/redact.ts` beside `withoutUrls`, so `join.ts` and `members.ts` both import it:

```ts
/** A store or keychain error can quote what it was handed; neither a token nor an age secret key may reach the CLI log. */
export function scrub(text: string, secret?: string): string {
  const keyless = text.replace(/AGE-SECRET-KEY-1[0-9A-Z]+/g, "AGE-SECRET-KEY-1<redacted>");
  return secret ? keyless.split(secret).join("<token>") : keyless;
}
```

In `lib/team/join.ts`, extend the existing import to `import { scrub, withoutUrls } from "./redact.ts";`, and give the two `throw` sites their copy (the first is inside `storeBoardToken`, whose `token` parameter is the board token):

```ts
    throw new JoinPeeringStoreError(
      `You joined ${pointer.name}, but rt could not save your board's switchboard token. Join again to finish; you do not need a new code.`,
      scrub(errorText(err), token),
    );
```

```ts
    throw new JoinKeyExchangeError(
      `You joined ${pointer.name}, but rt could not read this Mac's secrets key. Join again to finish; you do not need a new code.`,
      scrub(err instanceof Error ? err.message : String(err)),
    );
```

Today's messages already embed these error texts unscrubbed, and `age-keygen -y`'s errors (`lib/home/age-key.ts:138`) carry its stderr; the scrub makes moving them into the log no worse than today and better for both shapes of secret.

Rows J5 and J6, `lib/team/join.ts`: replace `gitFailureMessage`'s `switch` body and `accessFromVerdict` (both doc comments stay):

```ts
  switch (kind) {
    case "missing-binary":
      return "This Mac cannot run git. Install it, then try again.";
    case "disk-full":
      return "This Mac is out of disk space. Free some up, then try again.";
    case "exists":
      return "The team's folder is already there and is not empty. Remove it, then try again.";
    case "network":
      return "rt could not reach the team repo, so check your network and try again.";
    case "local":
      return `git could not clone the team repo (exit ${result.code}): ${withoutUrls(`${result.stdout}\n${result.stderr}`.trim())}`;
  }
```

`gitFailureMessage` no longer reads `remote`; rename the parameter `_remote` so its caller at `:217` stays as it is.

```ts
function accessFromVerdict(v: RepoAccessVerdict, pointer: InvitePointer): { access: JoinResult["access"]; message: string } {
  const joining = `Joining ${pointer.name}, owned by ${pointer.owner}.`;
  const forge = forgeLabel(forgeFromRemote(pointer.remote)?.provider);
  switch (v.kind) {
    case "ok":
      return { access: "ok", message: joining };
    case "no-clt":
      return { access: "deferred", message: `${joining} rt checks your access to the team repo once Apple's Command Line Tools are installed.` };
    case "no-account":
      return { access: "no-account", message: `${joining} Connect your ${forge} account so rt can reach the team repo.` };
    case "denied":
      return { access: "denied", message: `${joining} Your ${forge} account cannot see the team repo yet. Ask ${pointer.owner} or your org admin for read access.` };
    case "unreachable":
      return { access: "unreachable", message: `${joining} rt could not reach the team repo: ${v.detail}. It checks again when you join.` };
    default:
      return { access: "undetermined", message: `${joining} rt could not tell yet whether you can see the team repo: ${v.detail}. It checks again when you join.` };
  }
}
```

Row J15, `lib/team/join.ts:596-601`:

```ts
  if (!handle) {
    const cli = forge?.provider === "gitlab" ? "glab" : "gh";
    throw new UserActionableError("forge-login-unknown", `rt could not tell who you are on ${cli === "glab" ? "GitLab" : "GitHub"}. The invite has not been used yet.`, {}, {
      why: `Sign in to the ${cli} command line tool, then join again.`,
      next: `${cli} auth login`,
      log: `the team is cloned at ${dir}`,
    });
  }
```

Row J20, `lib/team/join.ts:652` and `:658`:

```ts
  const peeringHint = peeringFix !== undefined ? ` Your board is not connected yet. ${peeringFix}` : "";
```

```ts
    message: `Joined ${pointer.name}, owned by ${pointer.owner}.${peeringHint}`,
```

Rows J10, J14 and C9 keep a fact in their text: J10's `peeringFix` names the handle (`Ask ${pointer.owner} to invite ${handle} again and join with the new invite, ...`), J14's message keeps "you do not need a new code", and C9's message keeps `pull-only` and its closing period.

Row M1, `lib/team/members.ts:321-322`:

```ts
const RESIDUE_NOTE = "Removed members keep any secrets they already opened. Rotate those values to shut them out.";
```

Rows M6 and M7, `lib/team/members.ts`. Add `import { scrub } from "./redact.ts";` to its imports (merge it into an existing `./redact.ts` import if there is one). Replace `MembersSyncAbortedError` (its doc comment stays) and add `MembersKeyError` below it; both scrub their detail where it is built, so no caller can log it unscrubbed:

```ts
export class MembersSyncAbortedError extends Error {
  readonly detail: string;
  constructor(
    public readonly added: string[],
    public readonly pending: string[],
    causeMessage: string,
  ) {
    super(`rt stopped syncing members partway, after adding ${added.length} ${added.length === 1 ? "key" : "keys"}`);
    this.detail = scrub(`added ${added.length ? added.join(", ") : "none"}; pending ${pending.length ? pending.join(", ") : "none"}; ${causeMessage}`);
  }
}

/** A keychain read that failed inside a members verb; `detail` is the tool's own output, for the log only. */
export class MembersKeyError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(message);
    this.detail = scrub(detail);
  }
}
```

and in `readOwnPublicKeyIfPresent` (`:121-123`):

```ts
  if (derived.code !== 0) {
    throw new MembersKeyError("rt could not read this Mac's secrets key", `age-keygen -y: could not derive the public key from the stored private key\n${derived.stderr}`);
  }
```

Pin it in `lib/team/__tests__/copy.test.ts` (add `MembersKeyError, MembersSyncAbortedError` from `"../members.ts"` and `scrub` from `"../redact.ts"` to its imports):

```ts
test("every detail bound for the log has secret keys and the token scrubbed out", () => {
  const key = `AGE-SECRET-KEY-1${"Q".repeat(58)}`;
  expect(scrub(`sops rejected tok-1 and ${key}`, "tok-1")).toBe("sops rejected <token> and AGE-SECRET-KEY-1<redacted>");
  expect(new MembersSyncAbortedError(["age1aaa"], ["carol"], `sops failed on ${key}`).detail).toBe("added age1aaa; pending carol; sops failed on AGE-SECRET-KEY-1<redacted>");
  expect(new MembersKeyError("rt could not read this Mac's secrets key", `age-keygen -y: bad input ${key}`).detail).toBe("age-keygen -y: bad input AGE-SECRET-KEY-1<redacted>");
});
```

Public age recipients (`age1...`) are not secret and stay in the detail.

Then run: `grep -n "stripUserinfo\|forgeLabel" lib/team/join.ts`
Expected: each import still has a use. If `accessFromVerdict` was the last user of one, drop it from the import.

- [ ] **Step 4: Reword the errors `commands/team.ts` builds**

Change `resolveTeamSlug` to take the verb, and give its two errors their copy (rows T3 and T4):

```ts
function resolveTeamSlug(args: string[], verb: string): string {
  const explicit = flagValue(args, "--team");
  if (explicit) return explicit;

  const teams = listTeams();
  if (teams.length === 0) {
    throw new UserActionableError("no-team", "This Mac has no team yet", {}, { next: "rt team create" });
  }
  if (teams.length > 1) {
    throw new UserActionableError("ambiguous-team", `This Mac has more than one team: ${teams.join(", ")}`, {}, { next: `rt ${verb} --team <slug>` });
  }
  return teams[0]!;
}
```

and pass each caller's verb: `"team pull"` in `teamPull`, `"team publish"` in `teamPublish`, `"team invite"` in `teamInvite`, `"team manage-membership"` in `teamManageMembership`, `"team members sync"` in `teamMembersSync`, `"team members remove"` in `rosterHandles` (it swallows the error, and has no handle yet), `` `team members remove ${handle}` `` in `teamMembersRemove` (the handle is known by then), `"team status"` in `teamStatus`.

Give `reportMembersError` the copy for M6 and M7 (add `MembersKeyError` and `MembersSyncAbortedError` to the `lib/team/members.ts` import); its doc comment stays:

```ts
function reportMembersError(err: unknown, deps: TeamDeps, json: boolean, verb: string): never {
  if (err instanceof UserActionableError) exitUserError(err, json, verb, deps.print);
  if (err instanceof MembersSyncAbortedError) {
    const failure = new UserActionableError("members-error", err.message, {}, { why: "The keys it already added stay. Run the sync again.", next: "rt team members sync", log: err.detail });
    return exitUserError(failure, json, verb, deps.print);
  }
  if (err instanceof MembersKeyError) {
    return exitUserError(new UserActionableError("members-error", err.message, {}, { why: "Check that your keychain is unlocked, then try again.", log: err.detail }), json, verb, deps.print);
  }
  const message = err instanceof Error ? err.message : String(err);
  return exitUserError(new UserActionableError("members-error", message), json, verb, deps.print);
}
```

Task 5 swaps the first line's `exitUserError` for `exitTeamError`; the rest stays.

Run: `grep -n "resolveTeamSlug(args)" commands/team.ts`
Expected: no output.

Rows T5, T7, T8, T9, T13 replace the error at each site in the same shape. Rows T10 and T11 replace the two `return exitUserError(...)` lines in `teamJoin`'s `catch`:

```ts
    if (err instanceof JoinKeyExchangeError) {
      const failure = new UserActionableError("age-key-unavailable", err.message, {}, {
        why: "Check that your keychain is unlocked.",
        next: "rt team join",
        ...(err.detail ? { log: err.detail } : {}),
      });
      return exitUserError(failure, json, "team join", deps.print);
    }
    if (err instanceof JoinPeeringStoreError) {
      const failure = new UserActionableError("peering-store-failed", err.message, {}, {
        why: "Set up this Mac's secrets if they are not, then join again.",
        next: "rt home init",
        ...(err.detail ? { log: err.detail } : {}),
      });
      return exitUserError(failure, json, "team join", deps.print);
    }
```

The comment above the first `if` stays.

- [ ] **Step 5: Run the tests and look for leftovers**

Run: `bun test lib/team/__tests__ commands/__tests__/team.test.ts commands/__tests__/team-join.test.ts commands/__tests__/team-members.test.ts commands/__tests__/team-status.test.ts`
Expected: PASS. Every `--json` test whose only change was a message still matches its keys, codes and statuses exactly: that is the shape check.

Run: `grep -rn "MAT-415\|Crockford alphabet\|administers\|re-invite\|grant you access\|next screen\|was not embedded\|no new code needed" lib/team/*.ts commands/team.ts`
Expected: only comment lines; no string a person reads carries these any more.

Run: `grep -n "pull-only" lib/team/team-local.ts commands/team.ts`
Expected: C9's and T7's messages still carry it.

Run: `bun test lib/setup/__tests__/steps-a.test.ts lib/secrets/__tests__/team-store.test.ts`
Expected: PASS: the readers outside this plan still find `Joined Acme`, `you don't have access yet` and `pull-only`. (Running another phase's tests reads them; this plan edits neither file.)

Run: `bun run typecheck`
Expected: no errors.

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/team-membership.test.ts e2e/tests/setup.test.ts`
Expected: PASS (they read codes only).

- [ ] **Step 6: Commit**

```bash
git add lib/team/redact.ts lib/team/create.ts lib/team/slug.ts lib/team/one-team.ts lib/team/team-local.ts lib/team/invite-crypto.ts lib/team/relay-client.ts lib/team/publish.ts lib/team/invite.ts lib/team/forge.ts lib/team/members.ts lib/team/join.ts commands/team.ts lib/team/__tests__/copy.test.ts lib/team/__tests__/join.test.ts lib/team/__tests__/create.test.ts lib/team/__tests__/invite.test.ts lib/team/__tests__/forge.test.ts lib/team/__tests__/members.test.ts lib/team/__tests__/publish.test.ts lib/team/__tests__/relay-client.test.ts commands/__tests__/team.test.ts commands/__tests__/team-join.test.ts
```

```bash
git commit -m "lib/team: plain copy for every sentence a person reads, envelope shape kept

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `rt team` create, publish, pull, manage-membership and status, and refusals

**Files:**
- Modify: `commands/team.ts`
- Modify: `commands/__tests__/team.test.ts`, `commands/__tests__/team-status.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json`

**Interfaces:**
- Consumes: Task 4's `commands/team.ts` (its reworded errors and `resolveTeamSlug(args, verb)`); `out.print`, `out.fail`, `out.note`, `out.payload`, `out.line`, `out.kv`, `out.section`, `out.callout`, `out.cmd` (`lib/ui/out.ts`); `usageFailure` (5a); `warn`, `setWarningLog`, `__test__` (5a); `logFailureDetail`, `exitUserError` (`lib/errors.ts`); `type Block`, `type RenderStatus` (`lib/ui/protocol.ts`).
- Produces, inside `commands/team.ts` (Task 6 calls both):
  - `usageError(deps: TeamDeps, json: boolean, verb: string, title: string, usage: string): never`
  - `exitTeamError(err: UserActionableError, json: boolean, verb: string, deps: TeamDeps): never`, with `REFUSAL_CODES: Set<string>`
  - `TeamDeps.print` carries only the `--json` envelope line from here on.

After this task `invite`, `join`, `members sync` and `members remove` still send their human text through `deps.print`; Task 6 moves them. The file leaves the allowlist here because its two raw calls are gone.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/team.test.ts`:

Add `realTeamDeps` to the import from `"../team.ts"`.

Replace the two `io.stderr()` assertions in `missing name, human mode: prints usage and exits 2` (after 5a they are `toContain("usage:")` and `not.toContain("[failed]")`) with:

```ts
      expect(io.stderr()).toBe("What should the team be called?\n  next: rt team create <name> (--remote <url> | --create-repo <owner>) [--others] [--json]\n");
```

Replace the test `human output on success names the slug and remote` with:

```ts
  test("human output on success names the slug and remote", async () => {
    const deps = baseDeps();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await teamCreate(["Acme", "--remote", "https://github.com/acme/repo.git"], {}, deps);
      expect(io.stdout()).toBe("[ok] Created the acme team  https://github.com/acme/repo.git\n");
      expect(deps.lines).toEqual([]);
    } finally {
      io.restore();
    }
  });

  test("the default print seam writes the envelope line to stdout byte for byte", () => {
    const io = captureOut();
    try {
      realTeamDeps().print('{"contract":1}');
      expect(io.stdout()).toBe('{"contract":1}\n');
    } finally {
      io.restore();
    }
  });
```

Replace the test `--team explicit: pushes and prints a human summary` with:

```ts
  test("--team explicit: pushes and prints a human summary", async () => {
    const deps = depsWithZone();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await teamPublish(["--team", "acme", "--remote", "https://github.com/acme/repo.git"], {}, deps);
      expect(io.stdout()).toBe("[ok] Pushed the acme team  https://github.com/acme/repo.git\n");
      expect(deps.lines).toEqual([]);
    } finally {
      io.restore();
    }
  });
```

In `describe("teamPull", ...)`, in `daemon unreachable (daemonQuery returns null) exits 2 with a plain message, never a stack`, add after the `toContain("daemon")` line (it passes already since Task 4 gave the error its `next`, and keeps that pinned):

```ts
      expect(io.stderr()).toContain("  next: rt daemon start\n");
```

and add these tests to the same `describe`:

```ts
  test("human output says what the pull did, by outcome", async () => {
    const cases: Array<[string, string | null, string]> = [
      ["up-to-date", null, "[ok] The acme team is already up to date\n"],
      ["fast-forwarded", null, "[ok] Pulled the acme team\n"],
      ["rebased", "2 commits replayed", "[ok] Pulled the acme team  2 commits replayed\n"],
      ["conflict", "settings.team.jsonc", "[needs you] The acme team has changes that clash with yours  settings.team.jsonc\n"],
      ["skipped", "pull not enabled for this repo", "[skipped] Skipped pulling the acme team  pull not enabled for this repo\n"],
    ];
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      for (const [outcome, detail, expected] of cases) {
        io.clear();
        const deps = depsWithZone({ daemon: async () => ({ ok: true, data: { outcome, detail } }) });
        await teamPull(["--team", "acme"], {}, deps);
        expect(io.stdout()).toBe(expected);
        expect(deps.lines).toEqual([]);
      }
    } finally {
      io.restore();
    }
  });
```

In the `describe` that holds the `teamManageMembership` tests (the one with `on is refused where rt did not create the repo, and writes nothing`; its `manageDeps` helper is in scope), add:

```ts
  test("human mode says whether invites grant access, and how to turn it on", async () => {
    const cases: Array<[string[], Parameters<typeof manageDeps>[0], string]> = [
      [["on", "--team", "acme"], { createdByRt: true, joinedByRt: false, rtMayManageMembership: false }, "[ok] Invites to acme give read access on the forge  membership management is on\n"],
      [["--team", "acme"], { createdByRt: true, joinedByRt: false, rtMayManageMembership: false }, "[off] Invites to acme leave forge access to you  membership management is off\n  next: rt team manage-membership on\n"],
      [["--team", "acme"], { createdByRt: false, joinedByRt: false, rtMayManageMembership: false }, "[off] Invites to acme leave forge access to you  membership management is off\n  note: mattstack did not create this repo, so this cannot be turned on\n"],
    ];
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      for (const [args, local, expected] of cases) {
        io.clear();
        const deps = manageDeps(local);
        await teamManageMembership(args, {}, deps);
        expect(io.stdout()).toBe(expected);
        expect(deps.lines).toEqual([]);
      }
    } finally {
      io.restore();
    }
  });

  test("human mode: on where rt did not create the repo is a refused line, not a failure", async () => {
    const deps = manageDeps({ createdByRt: false, joinedByRt: false, rtMayManageMembership: false });
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => teamManageMembership(["on", "--team", "acme"], {}, deps));
      expect(code).toBe(2);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe(
        "[refused] mattstack did not create the acme team's repo, so it will not manage who can see it\n  why: Whoever runs that repo gives people access.\n",
      );
      expect(deps.lines).toEqual([]);
    } finally {
      io.restore();
    }
  });

  test("--json: the same refusal keeps today's exit-2 envelope shape", async () => {
    const deps = manageDeps({ createdByRt: false, joinedByRt: false, rtMayManageMembership: false });
    const code = await runExpectingProcessExit(() => teamManageMembership(["on", "--team", "acme", "--json"], {}, deps));
    expect(code).toBe(2);
    const { at, ...body } = JSON.parse(deps.lines[0]!);
    expect(typeof at).toBe("string");
    expect(body).toEqual({ contract: 1, error: { code: "not-rt-created", message: "mattstack did not create the acme team's repo, so it will not manage who can see it" } });
  });

  test("human mode: a usage error asks for on or off", async () => {
    const deps = baseDeps();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => teamManageMembership(["sideways", "--team", "acme"], {}, deps));
      expect(code).toBe(2);
      expect(io.stderr()).toBe("Choose on or off\n  next: rt team manage-membership [on|off] [--team <slug>] [--json]\n");
    } finally {
      io.restore();
    }
  });
```

In `describe("board peering the invite could not carry is never silent", ...)`, directly after `--require-peering refuses with exit 2 before the relay is touched` (`declareSwitchboard` and `inviteDeps` in scope), pin that this one is a failure, not a refusal: the switchboard register went wrong, and `--require-peering` only makes that stop the invite.

```ts
    test("human mode: an invite that could not connect the board is a failure, not a refusal", async () => {
      declareSwitchboard();
      const deps = inviteDeps();
      const io = captureOut();
      ui.__test__.setHuman(() => false);
      try {
        const code = await runExpectingProcessExit(() => teamInvite(["--handle", "zaphod", "--require-peering"], {}, deps));
        expect(code).toBe(2);
        expect(io.errLines()[0]).toBe("rt did not make the invite, because it could not connect their board");
        expect(io.stderr()).not.toContain("[refused]");
      } finally {
        io.restore();
      }
    });
```

In `commands/__tests__/team-status.test.ts`, add to the imports:

```ts
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnTest } from "../../lib/ui/warn.ts";
```

Replace the test `human mode notes a pull-only clone never pushes` body's last two statements (the `teamStatus` call and the `toContain("pull-only")` line) with:

```ts
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await teamStatus(["--team", SLUG], {}, deps);
      expect(io.stdout()).toContain("sync: ok\n  this copy only pulls, it never pushes\n");
    } finally {
      io.restore();
    }
```

In `no --team and zero local teams -> mode solo, exit 0, in both output modes`, replace the last three lines (the `text` half) with:

```ts
    const text = baseDeps();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await teamStatus([], {}, text);
      expect(io.stdout()).toBe("[off] No team on this Mac  just you\n");
      expect(text.lines).toEqual([]);
    } finally {
      io.restore();
    }
```

Replace the test `human mode names the team and remote` body's last three statements with:

```ts
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await teamStatus(["--team", SLUG], {}, deps);
      expect(io.lines()[0]).toBe(`Acme Team (${SLUG})`);
      expect(io.stdout()).toContain("widgets.git");
      expect(io.stdout()).toContain("last push: 2026-08-21T10:00:00+00:00\n");
      expect(io.stdout()).toContain("sync: unknown\n");
    } finally {
      io.restore();
    }
```

Add after the test `malformed board.members entries (null, a bare string, a non-string username) are filtered, not crashed on or leaked raw`:

```ts
  test("a malformed roster entry warns on stderr and leaves the envelope alone", async () => {
    const deps = clonedDeps({
      exec: async () => ({ code: 0, stdout: "", stderr: "" }),
      read: { "board.members": [null, "matt", { username: { evil: 1 } }, { username: "alice" }, {}] },
    });
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    warnTest.reset();
    setWarningLog(() => {});
    try {
      await teamStatus(["--team", SLUG, "--json"], {}, deps);
      expect(deps.lines).toHaveLength(1);
      expect(JSON.parse(deps.lines[0]!).members).toEqual([{ username: "alice" }]);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe("[warning] Some team members could not be read  4 left out\n");
    } finally {
      warnTest.reset();
      io.restore();
    }
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/team.test.ts commands/__tests__/team-status.test.ts`
Expected: FAIL. The human tests find an empty stdout (the text went to `deps.print`), `realTeamDeps().print` writes nothing the capture sees, the warning test finds the raw `rt team status: skipped ...` line on stderr, and the refusal test finds a failure block (the message as a plain title) where it expects a `[refused]` line. The `--json` refusal test passes already: its envelope is Task 4's and this task must keep it.

- [ ] **Step 3: Convert `commands/team.ts`**

Add to the imports (merge `logFailureDetail` into the existing `lib/errors.ts` import):

```ts
import * as out from "../lib/ui/out.ts";
import type { RenderStatus } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { warn } from "../lib/ui/warn.ts";
import { UserActionableError, exitUserError, logFailureDetail } from "../lib/errors.ts";
```

Below `usageError` (replaced next), add the refusal route:

```ts
/** rt declining by policy rather than failing: a person reads a refused line, never a failure block. */
const REFUSAL_CODES = new Set([
  "team-pull-only",
  "not-rt-created",
  "team-already-set-up",
  "code-on-argv",
  "own-key-removal-refused",
  "team-exists",
  "team-remote-mismatch",
]);

/** `--json` and every non-refusal take exitUserError's route, so the envelope and the exit code never depend on the code. */
function exitTeamError(err: UserActionableError, json: boolean, verb: string, deps: TeamDeps): never {
  if (json || !REFUSAL_CODES.has(err.code)) exitUserError(err, json, verb, deps.print);
  logFailureDetail(err);
  out.note(
    out.line("refused", err.message),
    ...(err.why ? [out.callout("why", err.why)] : []),
    ...(err.next ? [out.callout("next", out.cmd(err.next))] : []),
  );
  process.exit(2);
}
```

Then route every expected failure through it. Each of these statements, in each verb's `catch`, becomes the line after the arrow:

- `if (err instanceof UserActionableError) exitUserError(err, json, "<verb>", deps.print);` → `if (err instanceof UserActionableError) exitTeamError(err, json, "<verb>", deps);` (in `teamCreate`, `teamPull`, `teamPublish`, `teamInvite`, `teamManageMembership`, `teamJoin` and `teamStatus`)
- in `reportMembersError`, `if (err instanceof UserActionableError) exitUserError(err, json, verb, deps.print);` → `if (err instanceof UserActionableError) exitTeamError(err, json, verb, deps);`

The two `exitUserError` calls Task 4 wrote for `JoinKeyExchangeError` and `JoinPeeringStoreError`, `usageError`'s own, and `reportMembersError`'s last line stay on `exitUserError`: none of them is a refusal.

Run: `grep -n "exitUserError(err" commands/team.ts`
Expected: no output.

In `interface TeamDeps`, replace `print: (s: string) => void;` with:

```ts
  /** The --json envelope line only; human text goes through lib/ui/out.ts. */
  print: (s: string) => void;
```

In `realTeamDeps`, replace `print: (s) => console.log(s)` with `print: (s) => out.payload(`${s}\n`)`.

Replace `usageError` and its comment with:

```ts
/** `--json` gets the same exit-2 envelope a real failure gets; a person gets the question and the command. */
function usageError(deps: TeamDeps, json: boolean, verb: string, title: string, usage: string): never {
  if (json) exitUserError(new UserActionableError("usage", `usage: ${usage}`), true, verb, deps.print);
  out.fail(usageFailure(title, usage));
  process.exit(2);
}
```

Update its four call sites by inserting the title as the fourth argument:

- `teamCreate`: `usageError(deps, json, "team create", "What should the team be called?", "rt team create <name> (--remote <url> | --create-repo <owner>) [--others] [--json]");`
- `teamInvite`: `usageError(deps, json, "team invite", "Who is the invite for?", "rt team invite --handle <h> [--team <slug>] [--require-peering] [--json]");`
- `teamManageMembership`: `usageError(deps, json, "team manage-membership", "Choose on or off", "rt team manage-membership [on|off] [--team <slug>] [--json]");`
- `teamMembersRemove`: `usageError(deps, json, "team members remove", "Which member?", "rt team members remove <handle> [--key <age1...>] [--team <slug>] [--json]");`

In `teamCreate`, replace the `deps.print(result.created ? ... : ...)` statement with:

```ts
    out.print(
      result.created
        ? out.line("done", `Created the ${result.slug} team`, result.remote)
        : out.line("skipped", `The ${result.slug} team is already set up`, result.remote),
    );
```

Above `teamPull`, add:

```ts
const PULL_COPY: Record<string, { status: RenderStatus; title: (slug: string) => string }> = {
  "up-to-date": { status: "done", title: (slug) => `The ${slug} team is already up to date` },
  "fast-forwarded": { status: "done", title: (slug) => `Pulled the ${slug} team` },
  rebased: { status: "done", title: (slug) => `Pulled the ${slug} team` },
  conflict: { status: "needs-you", title: (slug) => `The ${slug} team has changes that clash with yours` },
  skipped: { status: "skipped", title: (slug) => `Skipped pulling the ${slug} team` },
};
```

In `teamPull`, replace the final `deps.print(...)` statement with:

```ts
    const outcome = res.data.outcome;
    const copy = PULL_COPY[outcome] ?? { status: "warn" as const, title: (s: string) => `The ${s} team pull ended as ${outcome}` };
    out.print(out.line(copy.status, copy.title(slug), res.data.detail ?? undefined));
```

In `teamPublish`, replace the `deps.print(...)` human line with:

```ts
    out.print(out.line("done", `Pushed the ${slug} team`, result.remote));
```

In `teamManageMembership`, replace the `deps.print(record.rtMayManageMembership ? ... : ...)` statement with:

```ts
    out.print(
      ...(record.rtMayManageMembership
        ? [out.line("done", `Invites to ${slug} give read access on the forge`, "membership management is on")]
        : [
            out.line("off", `Invites to ${slug} leave forge access to you`, "membership management is off"),
            record.createdByRt
              ? out.callout("next", out.cmd("rt team manage-membership on"))
              : out.callout("note", "mattstack did not create this repo, so this cannot be turned on"),
          ]),
    );
```

In `toRosterMembers`, change the parameter `warn: (message: string) => void` to `onSkipped: (skipped: number) => void`, and replace the `if (skipped > 0) { warn(...) }` block with:

```ts
  if (skipped > 0) onSkipped(skipped);
```

In `teamStatus`:

Replace the solo `deps.print(json ? ... : "rt team status: no team (Just me)")` statement with:

```ts
      if (json) deps.print(JSON.stringify(envelope(result)));
      else out.print(out.line("off", "No team on this Mac", "just you"));
```

Replace the `toRosterMembers(..., (msg) => console.error(msg))` call's second argument with:

```ts
(skipped) =>
      warn("team", `skipped ${skipped} malformed board.members entr${skipped === 1 ? "y" : "ies"} (missing or non-string username)`, {
        show: { title: "Some team members could not be read", hint: `${skipped} left out` },
      })
```

Replace everything from `const syncState = ...` through the closing `deps.print(...)` statement with:

```ts
    const syncState = sync.conflicted !== null ? "conflict" : reachable ? "ok" : "unknown";
    const syncNotes = [
      sync.lastPullSkipped ? `the last pull was skipped: ${sync.lastPullSkipped}` : "",
      sync.pullOnly ? "this copy only pulls, it never pushes" : "",
    ].filter((note) => note !== "");
    out.print(
      out.section(
        name,
        name === slug ? undefined : slug,
        out.kv("remote", result.remote ?? "none"),
        out.kv("last push", lastPush ?? "never"),
        out.kv("members", String(members.length)),
        out.kv("sync", syncState, syncNotes.length > 0 ? syncNotes.join("; ") : undefined),
        ...(sync.conflicted !== null ? [out.line("needs-you", "The team has changes that clash with yours", sync.conflicted.detail)] : []),
      ),
    );
```

- [ ] **Step 4: Delete the allowlist line**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `"commands/team.ts",`.

- [ ] **Step 5: Run the tests and the guard**

Run: `bun test commands/__tests__/team.test.ts commands/__tests__/team-status.test.ts commands/__tests__/team-join.test.ts commands/__tests__/team-members.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS. Every `--json` test in those files is unchanged since Task 4 and still passes: that is the shape check for `create`, `publish`, `pull`, `manage-membership` and `status`.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add commands/team.ts commands/__tests__/team.test.ts commands/__tests__/team-status.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "rt team: create, publish, pull, manage-membership and status print through the output layer, refusals as refused

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `rt team` invite, join and members

**Files:**
- Modify: `commands/team.ts`
- Create: `commands/__tests__/team-blocks.test.ts`
- Modify: `commands/__tests__/team.test.ts`, `commands/__tests__/team-join.test.ts`, `lib/team/__tests__/members.test.ts` (two shape pins)

**Interfaces:**
- Consumes: Task 5's `commands/team.ts` (`usageError`, `exitTeamError`); `renderPlain(blocks: Block[]): string` (`lib/ui/out-plain.ts`); `type InviteResult` (`lib/team/invite.ts`), `type JoinResult` (`lib/team/join.ts`), `type MembersSyncResult`, `type MembersRemoveResult` (`lib/team/members.ts`).
- Produces, exported from `commands/team.ts`:
  - `inviteBlocks(handle: string, result: InviteResult): Block[]`
  - `joinBlocks(result: JoinResult): Block[]`
  - `membersSyncBlocks(result: MembersSyncResult): Block[]`
  - `membersRemoveBlocks(handle: string, slug: string, result: MembersRemoveResult): Block[]`

- [ ] **Step 1: Write the failing tests**

Create `commands/__tests__/team-blocks.test.ts`:

```ts
import { test, expect } from "bun:test";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import type { InviteResult } from "../../lib/team/invite.ts";
import type { JoinResult } from "../../lib/team/join.ts";
import { inviteBlocks, joinBlocks, membersRemoveBlocks, membersSyncBlocks } from "../team.ts";

const invite = (extra: Partial<InviteResult> = {}): InviteResult => ({
  code: "CODE123",
  link: "https://join.example.test/join#CODE123",
  expiresAt: "2026-01-08T00:00:00.000Z",
  pasteBlock: "You have been invited to the Acme mattstack team.\n\nCODE123",
  forgeAccess: "granted",
  manualSteps: [],
  peering: "none",
  ...extra,
});

test("an invite is two copy blocks: the link, then the message to send, neither wrapped nor indented", () => {
  expect(renderPlain(inviteBlocks("zaphod", invite()))).toBe(
    "invite link:\nhttps://join.example.test/join#CODE123\nmessage to send:\nYou have been invited to the Acme mattstack team.\n\nCODE123\n",
  );
});

test("an invite rt could not grant access for says who has to, with every manual step", () => {
  const text = renderPlain(inviteBlocks("zaphod", invite({ forgeAccess: "skipped", manualSteps: ["Add zaphod at https://forge.example.test/acme/team/members", "Ask whoever runs the team repo to give zaphod read access."] })));
  expect(text).toContain("[needs you] Give zaphod read access to the team repo yourself  forge access: skipped\n");
  expect(text).toContain("  fix: Add zaphod at https://forge.example.test/acme/team/members\n       Ask whoever runs the team repo to give zaphod read access.\n");
});

const join = (extra: Partial<JoinResult> = {}): JoinResult => ({
  team: { slug: "acme", name: "Acme", owner: "zaphod" },
  access: "ok",
  peering: "idle",
  message: "Joined Acme, owned by zaphod.",
  intent: "written",
  ...extra,
});

test("a join line takes its status from the result and its words from the message", () => {
  expect(renderPlain(joinBlocks(join()))).toBe("[ok] Joined Acme, owned by zaphod.\n");
  expect(renderPlain(joinBlocks(join({ access: "denied", message: "Ask zaphod to let you into Acme, since you don't have access yet." })))).toBe(
    "[needs you] Ask zaphod to let you into Acme, since you don't have access yet.\n",
  );
  expect(renderPlain(joinBlocks(join({ access: "no-account", message: "Joining Acme, owned by zaphod. Connect your GitHub account so rt can reach the team repo." })))).toStartWith("[needs you] ");
  expect(renderPlain(joinBlocks(join({ access: "deferred", message: "Joining Acme, owned by zaphod." })))).toStartWith("[not yet] ");
  expect(renderPlain(joinBlocks(join({ access: "unreachable", message: "rt could not reach the invite service. Check your network, then try again." })))).toStartWith("[warning] ");
  expect(
    renderPlain(joinBlocks(join({ peering: "unavailable", peeringFix: "Ask zaphod for a new invite and join with it.", message: "Joined Acme, owned by zaphod. Your board is not connected yet. Ask zaphod for a new invite and join with it." }))),
  ).toStartWith("[warning] ");
});

test("a message carrying a newline or an escape still prints as one row", () => {
  const text = renderPlain(joinBlocks(join({ message: "Joined Acme\n[ok] forged row\x1b[2J" })));
  expect(text).toBe("[ok] Joined Acme [ok] forged row\n");
});

test("members sync says what was added, who is still pending and what was locked again", () => {
  expect(renderPlain(membersSyncBlocks({ added: ["age1aaa", "age1bbb"], addedHandles: ["bob"], pending: ["carol"], reencrypted: ["rt.json"] }))).toBe(
    "[ok] Added 2 keys\n[not yet] Still waiting on a reply  carol\n[ok] Locked the team's secrets to the new keys  rt.json\n",
  );
  expect(renderPlain(membersSyncBlocks({ added: ["age1aaa"], addedHandles: [], pending: [], reencrypted: [] }))).toBe("[ok] Added 1 key\n");
  expect(renderPlain(membersSyncBlocks({ added: [], addedHandles: [], pending: [], reencrypted: [] }))).toBe("[skipped] No new keys to add\n");
});

test("members remove names the member, what is left to do by hand, the note about old secrets, and the command that rotates them", () => {
  const text = renderPlain(
    membersRemoveBlocks("alice", "acme", {
      forgeAccess: "skipped",
      manualSteps: ["alice can still see the team repo. Remove them there too: mattstack does not manage who can see this repo."],
      reencrypted: [],
      rosterRemoved: true,
      residueNote: "Removed members keep any secrets they already opened. Rotate those values to shut them out.",
    }),
  );
  expect(text).toBe(
    "[ok] Removed alice from the team  forge access: skipped\n" +
      "  fix: alice can still see the team repo. Remove them there too: mattstack does not manage who can see this repo.\n" +
      "  note: Removed members keep any secrets they already opened. Rotate those values to shut them out.\n" +
      "  next: rt secrets rotate --team acme <domain> <key>\n",
  );
  expect(renderPlain(membersRemoveBlocks("alice", "acme", { forgeAccess: "revoked", manualSteps: [], reencrypted: [], rosterRemoved: false, residueNote: "n" }))).toBe(
    "[skipped] alice was not on the team list  forge access: revoked\n  note: n\n  next: rt secrets rotate --team acme <domain> <key>\n",
  );
});
```

In `commands/__tests__/team.test.ts`:

Replace the `io.stderr()` assertions in `missing --handle, human mode: prints usage and exits 2` with:

```ts
      expect(io.stderr()).toBe("Who is the invite for?\n  next: rt team invite --handle <h> [--team <slug>] [--require-peering] [--json]\n");
```

Replace the tests `team invite prints the join link on its own line` and `human output names who to ask, since rt does not manage membership` with:

```ts
  test("team invite prints the join link on its own line", async () => {
    const deps = inviteDeps();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await teamInvite(["--handle", "bob"], {}, deps);
      expect(io.lines()[0]).toBe("invite link:");
      expect(io.lines()[1]).toMatch(/^https:\/\/mattstack\.dev\/join#/);
      expect(deps.lines).toEqual([]);
    } finally {
      io.restore();
    }
  });

  test("human output names who to ask, since rt does not manage membership", async () => {
    const deps = inviteDeps({ exec: ghExec({ code: 127, stdout: "", stderr: "ENOENT: gh" }) });
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await teamInvite(["--handle", "zaphod"], {}, deps);
      const text = io.stdout();
      expect(text).toContain("mattstack://join/");
      expect(text).toContain("[needs you] Give zaphod read access to the team repo yourself  forge access: skipped\n");
      expect(text).toContain("Ask whoever runs the team repo");
    } finally {
      io.restore();
    }
  });
```

and, directly after the test `a joined machine refuses before the relay is ever touched` (same `describe`, so `inviteDeps` is in scope), add the same case for a person:

```ts
  test("human mode: a pull-only clone refuses to invite, as a refused line", async () => {
    const deps = inviteDeps({ record: { joinedByRt: true } });
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => teamInvite(["--handle", "zaphod", "--team", "acme"], {}, deps));
      expect(code).toBe(2);
      expect(io.stderr()).toBe("[refused] This Mac joined the acme team by invite, so its copy is pull-only and cannot invite anyone.\n  why: Ask the team's owner to invite zaphod.\n");
      expect(io.stdout()).toBe("");
    } finally {
      io.restore();
    }
  });
```

In `commands/__tests__/team-join.test.ts`, add `import * as ui from "../../lib/ui/out.ts";` if it is not already imported, and replace the last three statements of `--dry-run, denied access: human output carries the message, no URL or git output` (the `teamJoin` call and the two assertions on `deps.lines[0]`) with:

```ts
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await teamJoin(["--dry-run"], {}, deps);
      expect(io.lines()).toHaveLength(1);
      expect(io.lines()[0]).toStartWith("[needs you] ");
      expect(io.lines()[0]).toContain("Ask matt or your org admin");
      expect(io.lines()[0]).not.toContain("http");
      expect(deps.lines).toEqual([]);
    } finally {
      io.restore();
    }
```

In the same file, rename the test `human mode: code-on-argv prints the message and exits 2` to `a code on argv is refused, not failed`, and replace its `io.stderr()` assertion (today `toContain("[failed] pass the invite code on stdin, never as an argument")`, without the tag after 5a) with:

```ts
      expect(io.stderr()).toBe(
        "[refused] rt never takes an invite code as an argument\n  why: It would land in your shell history. Run the join on its own and paste the code when it asks.\n  next: rt team join\n",
      );
```

Pin the `members sync` and `members remove` success envelopes before the conversion, since no test pins them today. Both verbs build their secrets seams inside themselves (`createRealTeamSecretsSeams(slug)`, which runs sops), so the success path cannot run in a unit test without a new seam on a phase 6 file; and their `--json` branch is the one line `deps.print(JSON.stringify(envelope(result)))`, which this task does not touch (Step 4's grep confirms it). So the pin is the result each lib function hands that line, taken from the real functions with the fakes `lib/team/__tests__/members.test.ts` already uses. In that file:

- at the end of `a record whose reply exists gets added (alongside the owner's own bootstrap key), sops updatekeys runs, and the invite record is removed`, add:

```ts
    expect(Object.keys(result).sort()).toEqual(["added", "addedHandles", "pending", "reencrypted"]);
    expect(Object.values(result).every(Array.isArray)).toBe(true);
```

- at the end of `revokes forge access, writes the roster without the handle, re-encrypts, and returns a non-empty residue note`, add:

```ts
    expect(Object.keys(result).sort()).toEqual(["forgeAccess", "manualSteps", "reencrypted", "residueNote", "rosterRemoved"]);
    expect({ forgeAccess: typeof result.forgeAccess, residueNote: typeof result.residueNote, rosterRemoved: typeof result.rosterRemoved }).toEqual({ forgeAccess: "string", residueNote: "string", rosterRemoved: "boolean" });
```

Run them now, before Step 3 touches anything: `bun test lib/team/__tests__/members.test.ts`. Expected: PASS. That is the capture of today's shape; they must stay green after Step 4. The tray's `MembersSyncOutcome.parse(stdout:)` (`rt-tray/Sources/NotificationManager.swift:467`) decodes these same keys.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/team-blocks.test.ts commands/__tests__/team.test.ts commands/__tests__/team-join.test.ts`
Expected: FAIL. `inviteBlocks` is not exported; the invite and join human tests find an empty stdout. The two refusal tests pass already (Task 5 routed refusals) and must stay green.

- [ ] **Step 3: Add the block builders to `commands/team.ts`**

Extend the imports:

```ts
import type { Block, RenderStatus } from "../lib/ui/protocol.ts";
import { mintInvite, type InviteResult } from "../lib/team/invite.ts";
import { membersRemove, membersSync, preferredRoster, teamRemote, type MembersRemoveResult, type MembersSyncResult } from "../lib/team/members.ts";
```

(merge these into the existing import lines for those modules; `JoinResult` is already imported.)

Add above `teamInvite`:

```ts
/**
 * The link and the message are copy blocks: a person pastes them, so they are
 * never wrapped or indented. The paste block is built by rt from the team's
 * own title; nothing an invitee controls reaches it.
 */
export function inviteBlocks(handle: string, result: InviteResult): Block[] {
  const blocks: Block[] = [out.copy(result.link, "invite link"), out.copy(result.pasteBlock, "message to send")];
  if (result.forgeAccess !== "granted") {
    blocks.push(out.line("needs-you", `Give ${handle} read access to the team repo yourself`, `forge access: ${result.forgeAccess}`));
    if (result.manualSteps.length > 0) blocks.push(out.callout("fix", ...result.manualSteps));
  }
  return blocks;
}

function joinStatus(result: JoinResult): RenderStatus {
  if (result.access === "denied" || result.access === "no-account") return "needs-you";
  if (result.access === "deferred") return "pending";
  if (result.access !== "ok" || result.peering === "unavailable") return "warn";
  return "done";
}

export function joinBlocks(result: JoinResult): Block[] {
  return [out.line(joinStatus(result), result.message)];
}

export function membersSyncBlocks(result: MembersSyncResult): Block[] {
  const added = result.added.length;
  return [
    added > 0 ? out.line("done", `Added ${added} ${added === 1 ? "key" : "keys"}`) : out.line("skipped", "No new keys to add"),
    ...(result.pending.length > 0 ? [out.line("pending", "Still waiting on a reply", result.pending.join(", "))] : []),
    ...(result.reencrypted.length > 0 ? [out.line("done", "Locked the team's secrets to the new keys", result.reencrypted.join(", "))] : []),
  ];
}

export function membersRemoveBlocks(handle: string, slug: string, result: MembersRemoveResult): Block[] {
  return [
    result.rosterRemoved
      ? out.line("done", `Removed ${handle} from the team`, `forge access: ${result.forgeAccess}`)
      : out.line("skipped", `${handle} was not on the team list`, `forge access: ${result.forgeAccess}`),
    ...(result.manualSteps.length > 0 ? [out.callout("fix", ...result.manualSteps)] : []),
    out.callout("note", result.residueNote),
    out.callout("next", out.cmd(`rt secrets rotate --team ${slug} <domain> <key>`)),
  ];
}
```

- [ ] **Step 4: Use them in the four verbs**

In `teamInvite`, replace the seven statements from `deps.print(result.link);` through the closing brace of `if (result.forgeAccess !== "granted") { ... }` with:

```ts
    out.print(...inviteBlocks(handle, result));
```

`handle` is `string | undefined` at that point in the type system although `usageError` has already returned `never` for the undefined case; if the compiler does not narrow it, write `inviteBlocks(handle!, result)`.

In `teamJoin`, replace `deps.print(`rt team join: ${result.message}`);` with:

```ts
    out.print(...joinBlocks(result));
```

In `teamMembersSync`, replace the three `deps.print(...)` human statements with:

```ts
    out.print(...membersSyncBlocks(result));
```

In `teamMembersRemove`, replace the five human statements from `deps.print(`rt team members remove: ...`)` through `deps.print(result.residueNote);` with:

```ts
    out.print(...membersRemoveBlocks(handle, slug, result));
```

Then confirm no human text is left on the seam:

Run: `grep -n "deps.print(" commands/team.ts`
Expected: every hit is `deps.print(JSON.stringify(envelope(...)))` or is the `deps.print` passed to `exitUserError`.

- [ ] **Step 5: Run the tests**

Run: `bun test commands/__tests__/team-blocks.test.ts commands/__tests__/team.test.ts commands/__tests__/team-join.test.ts commands/__tests__/team-members.test.ts commands/__tests__/team-status.test.ts lib/team/__tests__/members.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS. The `--json` tests in `team.test.ts` (`teamInvite --json prints the exact contract envelope shape`, the `peering` cases) and `team-join.test.ts`, unchanged since Task 4, are the shape check for `invite`, `join`, `members sync` and `members remove`.

Run: `bun run typecheck`
Expected: no errors.

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/team-membership.test.ts`
Expected: PASS (it reads only `--json`).

- [ ] **Step 6: Commit**

```bash
git add commands/team.ts commands/__tests__/team-blocks.test.ts commands/__tests__/team.test.ts commands/__tests__/team-join.test.ts lib/team/__tests__/members.test.ts
```

```bash
git commit -m "rt team: invite, join and members print through the output layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Renders, AGENTS.md, and every gate

**Files:**
- Modify: `AGENTS.md` ("Output layer" section: append; never rewrite what is there)
- Modify: `docs/design/output-layer/README.md`
- Create under `docs/design/output-layer/`: `5e1-team-dark.png`, `5e1-team-light.png`

**Interfaces:**
- Consumes: everything above; `ui/dist/rt-ui` built by `bun run ui:build` (no change under `ui/` is made here; the build only makes sure the helper is current).
- Produces: the renders the PR carries.

- [ ] **Step 1: Build the helper and write the render inputs**

Run: `bun run ui:build`

In the session scratchpad (not the repo), write `blocks-5e1.ts`. It prints NDJSON for the team set, built with the real builders so the render shows what the verbs print:

```ts
// usage: bun blocks-5e1.ts > team.ndjson
import * as out from "<repo>/lib/ui/out.ts";
import { encodeLine } from "<repo>/lib/ui/protocol.ts";
import { usageFailure } from "<repo>/lib/ui/usage.ts";
import { inviteBlocks, joinBlocks, membersRemoveBlocks, membersSyncBlocks } from "<repo>/commands/team.ts";

const blocks = [
  out.line("done", "Created the acme team", "https://forge.example.test/acme/mattstack-team-acme.git"),
  out.section("Acme", "acme", out.kv("remote", "https://forge.example.test/acme/mattstack-team-acme.git"), out.kv("last push", "2026-09-30T10:00:00+00:00"), out.kv("members", "3"), out.kv("sync", "ok", "this copy only pulls, it never pushes")),
  ...inviteBlocks("zaphod", {
    code: "CODE123",
    link: "https://join.example.test/join#CODE123",
    expiresAt: "",
    pasteBlock: "You have been invited to the Acme mattstack team.\n\n  https://join.example.test/join#CODE123\n\nCODE123",
    forgeAccess: "skipped",
    manualSteps: ["Open https://forge.example.test/acme/team/settings/access", "Invite zaphod with Read", "Ask whoever runs the team repo to give zaphod read access. mattstack did not create it, so they decide."],
    peering: "none",
  }),
  ...joinBlocks({ team: { slug: "acme", name: "Acme", owner: "trillian" }, access: "ok", peering: "idle", message: "Joined Acme, owned by trillian.", intent: "written" }),
  ...joinBlocks({ team: { slug: "acme", name: "Acme", owner: "trillian" }, access: "denied", peering: "idle", message: "Joining Acme, owned by trillian. Your GitHub account cannot see the team repo yet. Ask trillian or your org admin for read access.", intent: "written" }),
  ...membersSyncBlocks({ added: ["age1aaa", "age1bbb"], addedHandles: ["zaphod"], pending: ["ford"], reencrypted: ["rt.json"] }),
  ...membersRemoveBlocks("arthur", "acme", { forgeAccess: "skipped", manualSteps: ["arthur can still see the team repo. Remove them there too: mattstack does not manage who can see this repo."], reencrypted: [], rosterRemoved: true, residueNote: "Removed members keep any secrets they already opened. Rotate those values to shut them out." }),
  out.line("warn", "rt's setup still points at a different switchboard", "left as it is"),
  out.callout("next", out.cmd("rt setup switchboard connect --host https://switchboard.example.test")),
  out.line("refused", "mattstack did not create the acme team's repo, so it will not manage who can see it"),
  out.callout("why", "Whoever runs that repo gives people access."),
  out.failure({ title: "The rt daemon is not running", why: "It pulls team changes for you. You can also pull with git in the team's folder.", next: out.cmd("rt daemon start") }),
  out.failure(usageFailure("Who is the invite for?", "rt team invite --handle <h> [--team <slug>] [--require-peering] [--json]")),
];
process.stdout.write(encodeLine({ t: "hello", protocol: 1 }) + blocks.map(encodeLine).join(""));
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

- [ ] **Step 2: Render two pages**

At width 100, run these one at a time from the scratchpad:

```bash
bun blocks-5e1.ts > team.ndjson
COLORTERM=truecolor TERM=xterm-256color <repo>/ui/dist/rt-ui render --width 100 < team.ndjson > team-dark.ansi
COLORTERM=truecolor TERM=xterm-256color COLORFGBG="0;15" <repo>/ui/dist/rt-ui render --width 100 < team.ndjson > team-light.ansi
bun ansi-page.ts dark team < team-dark.ansi > team-dark.html
bun ansi-page.ts light team < team-light.ansi > team-light.html
```

- [ ] **Step 3: Screenshot both schemes and look**

Serve the scratchpad over http on 127.0.0.1 (`python3 -m http.server 4173 --bind 127.0.0.1`; `file:` is blocked) and screenshot both pages with Fast Browser (the `fast-browser:browser-driver` agent, or the Fast Browser MCP tools directly). Save the PNGs as `docs/design/output-layer/5e1-team-dark.png` and `5e1-team-light.png`.

Then read each PNG and write down plainly what reads wrong. Check these in particular, on both backgrounds:

- The two `copy` blocks: is it clear where the link ends and the message begins, and does the code sit alone on its line?
- A `needs-you` line followed by a three-row `fix` callout: does it read as one thing?
- The join lines: each title is now a whole sentence or two from `lib/team`. Are they too long to scan at 100 columns, and does the denied one read as something to do rather than an error?
- The `refused` line and its `why`: is it clearly not a failure (no coral), and does it still read as "rt said no"?
- The members remove block: a done line, a fix, a note and a next. Too many callouts for one result?
- On light: every body word uses the terminal's own foreground; nothing is pale on white.

A fault found here is fixed in the task that owns the code, re-rendered, and named in the report. Do not declare success from the tests.

- [ ] **Step 4: Update `docs/design/output-layer/README.md`**

Add one row to its table:

```markdown
| `5e1-team-dark.png`, `5e1-team-light.png` | `rt team` at 100 columns: create, status, an invite with manual steps, two joins, members sync and remove, a switchboard warning, a refusal, a daemon failure and a usage failure |
```

- [ ] **Step 5: Append to `AGENTS.md`**

At the end of the "Output layer" section (after its last paragraph, before the next `##` heading), append:

```markdown
A `print` seam on a command's deps (`TeamDeps`) carries the `--json`
envelope line and nothing else; its default is `out.payload`, so a test of
a human branch reads `captureOut()` and a test of the envelope reads the
seam. A sentence that rides in an envelope and is what a person reads (an
error's message, a join's `message`, a manual step) follows the copy rules
like any other: the envelope's shape is what is frozen, not its words, so
reword it and keep every key, code and status. A command goes in the
error's `next` option, which the envelope never carries; a result string
that is the only carrier of its remedy keeps the command as its last words.
A refusal by policy is a `refused` line through `out.note`, never
`out.fail`.

A warn sink under `lib/` that a caller can replace (`lib/team`'s three)
takes `(message, shown?)`: the message is the log text and `shown` is the
plain copy a person reads. Code that catches a `UserActionableError` and
turns it into such a warning passes `err.next` as the copy's `next`.
```

Wrap the new paragraphs at about 78 columns like the ones above them; prettier ignores root Markdown files, so nothing reflows them. If 5e2 merged first and appended its own paragraphs, keep them and add these after them, dropping any sentence 5e2 already says.

- [ ] **Step 6: Look for readers of the old text**

The spec asks each conversion PR to grep the skills and the tray for text scraped from the verbs it converts. Run each alone:

- `grep -rn "rt team" plugins/mattstack skills apps/board/skills --include="*.md"`
- `grep -rn "rt team status:\|rt team join:\|rt team create:\|rt team invite:\|scaffolded\|invite not recognized\|next screen" plugins/mattstack skills apps/board/skills rt-tray/Sources rt-tray/Sources-core`

Expected for the first: commands being run (`rt team create <Name> --remote <url>` in `creating-a-pack`), none reading output text. Expected for the second: no hit that matches a verb's printed text or a reworded string (the tray's own `joinFailureCopy` strings are its own copy, not read from rt). Any real reader found is fixed here, in this task's commit, by moving it to `--json` or a code.

- [ ] **Step 7: Run every gate**

Run each from the repo root, one at a time:

- `bun run ui:build`
- `bun run typecheck`
- `bun run test`
- `bun run test:e2e`
- `bun run picker:check`
- `bun run format:check`
- `bun run check` (what the `static` CI job runs)

Expected: all pass. `bun run test:pty` and `bun run ui:test` are not needed (no pty test and nothing under `ui/` changed) and `bun run docs:gen` is not needed (no command description changed). Known noise, per the herd notes: about ten rotating load flakes in the unit suite (flavor-takeover, sync-stack-guard, git reset, setup-connect oauth, daemon-logdy-config) and the `rt plugin new` e2e on this machine. A failure in a file this plan did not touch that passes when its file runs alone is a flake; say so in the report with both results.

Then confirm the allowlist lost exactly this plan's four lines:

Run: `grep -n "commands/team.ts\|lib/team/invite.ts\|lib/team/join.ts\|lib/team/members.ts" lib/__tests__/raw-output-allowlist.json`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add AGENTS.md docs/design/output-layer/README.md docs/design/output-layer/5e1-team-dark.png docs/design/output-layer/5e1-team-light.png
```

```bash
git commit -m "docs: output layer rules for envelope seams, envelope copy and lib warn sinks, with the 5e1 renders

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Ship

**Files:** none beyond what a rebase touches.

**Interfaces:**
- Consumes: the finished branch.
- Produces: one PR against `m4ttstack/mattstack`.

- [ ] **Step 1: Rebase and re-check what other phases and slices added**

Run: `git fetch origin`
Run: `git rebase origin/main`

Phase 3, 5e2 and other phase 5 slices may have merged. Merge by hand, per ruling 7:

- `lib/__tests__/raw-output-allowlist.json`: keep every deletion from both sides.
- `AGENTS.md` "Output layer": keep their paragraphs, then this plan's (Task 7 Step 5 says what to drop if 5e2 said it first).
- `lib/team/join.ts`, `lib/team/invite.ts`: if phase 3 touched a string Task 4 reworded (it does not plan to), keep Task 4's wording and tell the phase 3 owner.

If phase 3 has merged, re-run its two readers: `bun test lib/setup/__tests__/steps-a.test.ts lib/setup/__tests__/validators-rt-health.test.ts`. Expected: PASS (the two kept phrases and `ONE_TEAM_RULE`).

Then run: `grep -rn "\[failed\] " commands/__tests__/team.test.ts commands/__tests__/team-join.test.ts commands/__tests__/team-status.test.ts commands/__tests__/team-blocks.test.ts`
Expected: no output. A `[failed] <title>` pinned as the first line of stderr is a leftover from before 5a: drop the tag.

- [ ] **Step 2: Re-run the gates after the rebase**

Run, one at a time: `bun run ui:build`, `bun run typecheck`, `bun run test`, `bun run test:e2e`, `bun run picker:check`, `bun run format:check`, `bun run check`.
Expected: all pass, with the same known noise as Task 7 Step 7.

- [ ] **Step 3: Measure the diff**

Run: `git diff --shortstat origin/main`
Expected: about 1,400 changed lines. Say the number in the report.

- [ ] **Step 4: Push**

Push the branch with the `git_push` MCP tool (it pushes one explicit refspec to the branch's same-named upstream).

- [ ] **Step 5: Open the PR**

Run: `gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 5e1, team" --body-file <scratchpad>/pr-body-5e1.md`

The body, in the style of PR 639: one framing paragraph; bold-labelled bullet groups (**Verbs**: nine `rt team` verbs on the layer, invites as copy blocks, refusals as `refused` lines; **Copy**: the `lib/team` copy pass, 72 strings reworded with every envelope's shape kept, the phrases phase 3 and `lib/secrets` read kept, four error details scrubbed before the log; **Warnings**: the three lib warn sinks with plain copy, ruling 12 in `join.ts`; **Also**: `resolveTeamSlug` names the verb in its `next`; **Follow-up**: `lib/team/repo-access.ts`'s verdict details, shared with phase 3's access validator); the two renders; a verification line with the gate results; and the last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 6: Report**

Report the PR url, the gate results, the flakes seen with both results, the diff size, and what the renders showed. Do not merge: the shepherd watches CI and CodeRabbit and merges.

---

## Decisions this plan made that the scoping document and the spec do not settle

Each is the plan's best reading; Matt or the reviewer may overrule one before execution.

1. **Envelope copy is reworded, shape kept** (the controller's ruling 1 on this slice, carrying Matt's setup ruling over). Where a string is an error, its command moves to `next` and its raw detail to `log`, so the tray and phase 3's setup rows, which read only `message`, lose the inline command; the tray never ran those commands, and the terminal gets them as a `next` callout. Where a result string is the only carrier of its remedy (a manual step, a `peeringFix`), the command stays as its last words, as phase 3 kept them in setup remedies.
2. **Three phrases stay for phase 3 and phase 6** (`Joined <name>`, `you don't have access yet`, `pull-only` with its closing period) and `ONE_TEAM_RULE` stays, because this plan may not edit `lib/setup` or `lib/secrets`. The reworded sentences carry them naturally. A fact only `message` readers can see ("you do not need a new code", "the invite has not been used yet", an unsaved invite's code) stays in the message too (the controller's ruling on I9 and J15).
3. **`JoinResult.message` stops saying "the next screen".** The tray was the only place that phrase made sense; the terminal printed it too. The new sentences say what rt does next ("It checks again when you join") and read right in both.
4. **The `lib/team` warn seam gains an optional second argument** (the copy a person reads), the way ruling 5 widened the settings notice sink. A warning passed through from `lib/setup/team-settings.ts` with one argument shows its message as its title.
5. **Ruling 12 at `join.ts`: `err.next` rides in the warning, not in `peeringFix`.** `peeringFix` is in the envelope, and its remedy (a new invite) is the right one for peering; the error's own `next` (`rt team pull`) is about reading team secrets and belongs beside the warning.
6. **Refusals are decided by code.** `REFUSAL_CODES` in `commands/team.ts` names the seven codes that are rt declining by policy; every other code is a failure. `peering-not-embedded` is not one: the switchboard register answered badly, returned no token or threw, and `--require-peering` only makes that stop the invite. A new refusal code joins the set in the same change that adds it.
7. **`resolveTeamSlug` takes the verb** so the "more than one team" error can name the exact command to run with `--team`; for `members remove` the verb carries the handle.
8. **The invite crypto errors that are always caught keep their words** (IC4): their only reader is a log line that quotes them.
9. **A join whose key could not be sent back draws `[ok]`** (J19): `joinBlocks` takes its status from `access`, which is `ok` because the clone and the redeem happened; the sentence says what is left to do. A `warn` would need a new field or a match on the words, and neither belongs in this plan.
10. **Four error details are scrubbed before they reach the CLI log** (J8, J18, M6, M7), through one `scrub` in `lib/team/redact.ts`: a sops or keychain error can quote what it was handed, so the board token and any `AGE-SECRET-KEY-1...` string are replaced. Today's messages carried the same text unscrubbed into the envelope; the log is the only new place it goes.
11. **The `members sync` and `members remove` success envelopes are pinned at the lib result** (Task 6), not through the verb: the verb builds its secrets seams from a phase 6 file inside itself, and its `--json` line is not edited.

## Gaps and overlaps to know about

- **Other slices' files this plan relies on but does not edit:** `lib/rt-render.ts` (5b; `team create` calls its `textInput`), `lib/pick-wrappers.ts` (5c; the member picker), `lib/ui/*` (5a), `lib/setup/team-settings.ts` and `lib/setup/steps/team.ts` (phase 3; they call and read `lib/team`).
- **Files more than one plan edits:** `lib/__tests__/raw-output-allowlist.json` and `AGENTS.md` (every slice; ruling 7); the command tests 5a's Task 2 touches for the `[failed]` tag (`team.test.ts`, `team-join.test.ts`), which is why 5a must land first.
- **5e2 is independent.** It owns `commands/home.ts`, `commands/release.ts`, `commands/repos.ts` and their libs; it shares only the allowlist and AGENTS.md with this plan.
- **Follow-up, out of scope here: `lib/team/repo-access.ts`'s verdict details.** J6's unreachable and undetermined sentences paste `v.detail` in as it is, which can repeat phrasing ("rt could not reach the team repo: could not reach ..."). Phase 3's `lib/setup/validators/access.ts` reads the same details for its own rows, so rewording them is a change both plans would have to agree on; it is left for a follow-up named in the PR.

## Self-Review

**Spec coverage.** Scoping section 3 "5e", cut (i): `team` all verbs (Tasks 5 and 6); the four allowlisted team files leave in Tasks 3 and 5. Shared item 1 for `lib/team` (Task 3's three sinks). Item 8 (`usageFailure`: Task 5). Item 10 (ruling 12: Task 3). Section 5 readers: the tray's team envelopes (shape kept, words reworded, readers named in Task 2), `team status --json` for `rt_verb` (Task 5), the e2e text assertions (codes only). The controller's rulings: 1 (Task 2's copy table, Task 4), 3 (Tasks 5 and 6), 4 (Task 2's sink paragraph and Task 3's Interfaces), 6 (Task 1). Rulings 2 and 5 are 5e2's (home init steps, release skills).

**Placeholders.** None. `<repo>` and `<scratchpad>` in Tasks 7 and 8 are the implementer's own absolute paths, named as such. In Task 2's table, `<x>` marks a value the code fills in and "..." shortens a quoted string; the code in Tasks 4 to 6 spells each new string out.

**Type consistency.** `warn: (message, shown?: ShownWarning) => void`, `usageError(deps, json, verb, title, usage)`, `exitTeamError(err, json, verb, deps)`, `REFUSAL_CODES`, `resolveTeamSlug(args, verb)`, `JoinKeyExchangeError(message, detail?)`, `JoinPeeringStoreError(message, detail?)`, `scrub(text, secret?)`, `MembersSyncAbortedError.detail`, `MembersKeyError(message, detail)`, `inviteBlocks(handle, result)`, `joinBlocks(result)`, `membersSyncBlocks(result)`, `membersRemoveBlocks(handle, slug, result)` are spelled the same in the Interfaces blocks, the code and the tests.

**Review Focus.** Five items, each pinned to a named test in Tasks 3 to 6.
