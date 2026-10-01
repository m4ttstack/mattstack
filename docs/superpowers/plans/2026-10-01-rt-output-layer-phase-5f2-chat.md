# rt Output Layer, Phase 5f2 (chat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The human `rt chat` verbs print through the output layer for a person at a terminal, every `rt chat` verb keeps every byte it writes to stdout off a terminal, chat's failures become failure blocks (and its two policy refusals `refused` notes) on stderr, and the two files this plan owns leave the raw-output allowlist.

**Architecture:** `commands/chat.ts` is split by reader. Every verb's stdout off a terminal is frozen text written through `out.payload` and `out.json` (pinned by a fixture captured before the conversion). Five verbs a person reads (`rooms`, `read`, `who`, `buddies`, `sign-in`) and `--help` draw blocks only when `out.isHuman()`. Every failure becomes a `failure` block on stderr, except the two places rt declines by policy, which are `refused` notes. `lib/chat-viewer-url.ts` moves its one warning onto 5a's `warn`, log only.

**Tech Stack:** Bun + TypeScript (`commands/`, `lib/`), `bun:test`, the compiled-binary e2e suite (`e2e/tests/`). No Go change: every file under `ui/` is 5a's.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (ticket RT-369), phase 5 of "Phases", plus "Rules", "Copy style", "Block vocabulary", "Status set" and "Guard". The slice is defined by `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5-scoping.md` (section 1 "What rt-ui already draws", section 2 items 1 and 8, section 3 "5f", section 5, and rulings 1, 5, 6 and 11). The controller's rulings on this slice, `.superpowers/sdd/phase-5f-rulings-r1.md` (eight items), bind it; this document cites them as "5f ruling N". The twelve rulings in `.superpowers/sdd/cross-phase-rulings.md` bind this plan. The API this plan calls from 5a is fixed by `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5a-layer-additions.md`, section "API for slices 5b to 5f"; this plan cites it and never redefines it.

**The split (5f ruling 7).** Slice 5f is two plans along the scoping document's second cut, each shippable alone: `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5f1-sdm-port-runs.md` (sdm, port, runs, the sdm picker and `lib/sdm/*`) and this one (`rt chat` and `lib/chat-viewer-url.ts`). They share no source file. Both delete lines from `lib/__tests__/raw-output-allowlist.json` and append to the AGENTS.md "Output layer" section and `docs/design/output-layer/README.md`, which the second to merge resolves by hand (cross-phase ruling 7). The single plan this replaced was superseded and is not in the repo.

**Size:** about 1,150 changed lines (additions and deletions; the captured chat fixture, about 235 lines, included). Task 8 measures the real diff before the PR.

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
- 5f2 only: exit codes do not change. Every `rt chat` failure and refusal exits 1.
- 5f2 only (5f ruling 1): for `rt chat`, the exception to "plain text off a TTY takes the new wording" is stdout. Every verb's stdout off a terminal is byte-identical before and after (Matt's ruling: chat is read by agents and the herd). `commands/__tests__/fixtures/chat-bytes.json`, captured in Task 4 before any conversion, is the proof, and no later task regenerates it. Only `rooms`, `read`, `who`, `buddies`, `sign-in` and `--help` draw blocks, and only when `out.isHuman()` is true. Failures and refusals on stderr take the new wording.
- 5f2 only, copy inside envelopes (5f ruling 5): `rt chat`'s `--json` envelopes carry the daemon's data, and its frozen text is frozen by 5f ruling 1, so this plan rewords no envelope string; Task 2 says why for each kind.
- 5f2 only, refusals (5f ruling 6): rt declining by policy is `out.note(out.line("refused", ...), ...callouts)` on stderr, never `out.fail`, and still exits 1. In this plan: the long one-line message and the second identity in one session.
- 5f2 only: the delivery frame and `renderWelcome` are the daemon's (`lib/daemon/handlers/chat.ts`) and are not edited. `lib/chat-viewer-url.ts` keeps the `/r/<room>#m-<id>` link shape.
- 5f2 only: files this plan must not edit: `lib/herdr-launch.ts` (5c), `lib/daemon/handlers/chat.ts`, `lib/pick-wrappers.ts`, `lib/ui/pick.ts`, `lib/pickers.ts` (5c), `lib/rt-render.ts` (5b), `lib/daemon-client.ts` (5a), `lib/ui/__tests__/capture-out.ts` (phase 4's), every file under `ui/`, everything 5a creates (`lib/ui/warn.ts`, `usage.ts`, `transient-step.ts`, `screen.ts`), `skills/rt-chat/SKILL.md` (no edit needed, Task 2), and every file 5f1 owns (`commands/sdm.ts`, `commands/port.ts`, `commands/runs.ts`, `lib/navigate.ts`, `lib/sdm/*`).
- 5f2 only: git commands are run plain and alone from the worktree root, never joined with `cd`, `&&`, pipes or heredocs. Never `git add -A`, `git add .` or `git add -u`.
- 5f2 only: where today's text holds a long dash, this plan writes `--` when quoting it. New code never carries one.

## Review Focus

1. **An agent reading `rt chat` stdout from Bash after the conversion.** The rt-chat skill sends an agent to `rt chat sign-in`, `rooms`, `read`, `post` and `dm` in Bash after a `/clear`; `plugins/herdr-chat` and the e2e delivery test read `dm` and `claim` lines. Every verb's stdout must be the bytes it was. Pinned in Task 4 (`every verb's stdout off a terminal matches the fixture captured before the output layer`) and re-run unchanged by Tasks 5 and 6.
2. **A chat message carrying escape sequences or a forged status row, at a terminal.** A body such as `hi` + an erase-screen escape + a newline + `[ok] forged` must print as indented text inside its paragraph, never as a row at column 0. Pinned in Task 5 (`a message body cannot repaint the screen or forge a row`). This covers the human path only: off a terminal `read` writes bodies raw, as today (decision 9).
3. **`--json` on argv when a verb fails.** stdout must stay empty; the failure goes to stderr plainly. Pinned in Task 6 (`a failure under --json leaves stdout empty and exits 1`).
4. **rt declining by policy is not drawn as a failure.** The long one-line message and the second identity in one session are `refused` notes on stderr, still exit 1, and keep the command that gets the agent unstuck. Pinned in Task 6 (`the long one-line refusal keeps its heredoc and its override`, `a second identity while signed in is refused with the sign-out command`).
5. **The sign-in lines an agent reads after a `/clear`.** An agent signing in from a checkout reads the joined-room form, and Task 5 Step 6 retypes `runSignInViaPane`'s template literal by hand. Pinned in Task 4 by the fixture entries `sign-in-room`, `sign-in-pane`, `sign-in-pane-room` and `sign-out-pane` (`every verb's stdout off a terminal matches the fixture captured before the output layer`), so a slip in the retyped line fails the fixture.

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

// lib/ui/usage.ts
export function usageFailure(title: string, usage: string, why?: string): FailureInput;
```

Two behaviors of 5a this plan leans on:

- **The plain failure rule.** A `failure` block that opens a plain render has no `[failed]` tag: its first line is the title. Every `out.fail(...)` in this plan is such a render, so every expected stderr string below starts with the title. A `refused` line keeps its tag (`[refused]`), as any `line` does.
- **The breadcrumb header.** The dispatcher draws it before the handler, on stderr, only when a person is reading stderr. Nothing in this plan calls it, and with `out.__test__.setHuman(() => false)` it never appears in a test's expected strings.

From 5a's warnings table (ruling 2), this plan applies row 42 (rows 40 and 41 are 5f1's):

| Row | File:line | Decision | Log message (module) | Shown copy |
|---|---|---|---|---|
| 42 | `lib/chat-viewer-url.ts:24` | Log only | `chat.viewerUrl could not be read, posting without a link: <err>` (`chat`) | none |

## File Structure

| File | Responsibility |
|---|---|
| `lib/chat-viewer-url.ts` (modify) | One warning moves onto `warn`, log only |
| `commands/chat.ts` (modify) | `say` and `show`, block builders for five verbs and help, `fail`, `failUsage` and `refuse` on the layer |
| `commands/__tests__/chat.test.ts` (modify) | Harness reads `captureOut()`; new block, failure and refusal tests |
| `commands/__tests__/fixtures/chat-bytes.json` (create, captured) | Every chat verb's stdout before the conversion |
| `lib/__tests__/chat-viewer-url.test.ts` (modify) | The warning, logged and never shown |
| `lib/__tests__/raw-output-allowlist.json` (modify) | Two lines deleted |
| `AGENTS.md`, `docs/design/output-layer/` (modify) | One appended paragraph; two renders |

---

### Task 1: Confirm 5a is on main

No code. This plan calls three things 5a builds. If they are not on main, stop.

Phase 4 is already on main (`19ceaa403`). It extended the shared capture helper, `lib/ui/__tests__/capture-out.ts`, which this plan imports and never edits: `captureOut(opts?: { console?: boolean })` (with `console: true`, `console.log` and `console.error` land in the same buffers as the stream writes, in the order they happen) and `clear()`, which empties both buffers between two runs in one test (`reset()` does not; it only resets the human gate and `humanStream`). Task 4's harness uses `captureOut({ console: true })` so the same tests read the unconverted file and the converted one; Task 6 drops the option. Every test creates one capture per run, so `clear()` is not needed here.

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
- `grep -n "export function usageFailure" lib/ui/usage.ts`
- `grep -n "console?: boolean\|clear: ()" lib/ui/__tests__/capture-out.ts`

Expected: every command prints at least one line, and the signatures match the block in "What this plan takes from 5a". The last grep shows phase 4's two additions.

If any of the first three files is missing or its grep is empty: **stop. Do not start Task 2.** Report "5a is not on main" with the output of the commands. Nothing in this plan may be stubbed to get past this. If the last grep is empty, phase 4's capture helper is not on this branch: stop and report that instead.

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

- [ ] **Step 4: Record a baseline**

Run: `bun run ui:build`
Run: `bun test commands/__tests__/chat.test.ts lib/__tests__/chat-viewer-url.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS. A failure here is not this plan's: stop and report it with the output.

Nothing to commit.

---

### Task 2: Audit of the print sites this plan owns

No code. This is the inventory every later task implements; it stays in the plan. Line numbers are `5bc69f231`'s.

**Files read:** `commands/chat.ts`, `lib/chat-viewer-url.ts`, `lib/daemon/handlers/chat.ts` (what the daemon puts in a reply), `lib/mcp/chat-tools.ts`, `lib/mcp/rt-verb.ts`, `plugins/herdr-chat/src/rt.rs`, `skills/rt-chat/SKILL.md`, `marketplace/plugins/chat/skills/*/SKILL.md`, `lib/state/presence-store.ts`, `lib/state/identity-store.ts` (the daemon refusals in decision 8), `plugins/mattstack/attachments/orchestration/shepherdr/references/job-template.md`, and the tests named below.

#### Already on rt-ui (confirming the scoping document)

| Verb | Scoping call | Confirmed | What 5f2 touches |
|---|---|---|---|
| `chat` | partly | Yes. The verb picker (`pickChatVerb`, `commands/chat.ts:1314`) is rt-ui and is not changed. | 22 `--json` lines to `out.json`; 21 frozen text lines to `out.payload`; 8 lines a person reads to blocks at a terminal; 41 `fail` sites (two of them refusals) and one warn line |

#### `lib/chat-viewer-url.ts` (Task 3)

Row 42 in "What this plan takes from 5a": log only. No test spies `console.warn` for this line today (checked: `lib/__tests__/chat-viewer-url.test.ts`, `commands/__tests__/chat.test.ts`).

#### `commands/chat.ts` (Tasks 4 to 6)

**`--json` (22 sites, guard-only):** lines 605, 623, 642, 738, 769, 805, 829, 870, 882, 897, 916, 929, 954, 967, 997, 1023, 1094, 1138, 1190, 1219, 1241, 1255. Each `console.log(JSON.stringify(x))` becomes `out.json(x)`: the same bytes.

**Frozen text, agent verbs (21 sites):** lines 608 (`join`), 626 (`leave`), 645 to 649 (`archive`, one three-line call), 745 to 748 (`post`), 773, 774 (`ack`), 810, 814, 818 (`claim`), 832 (`release`), 970 (`prune`), 1000, 1002 (`dm`), 1026 (`invite`), 1192, 1222 (`sign-out`), 1244 (`away`), 1258 (`back`). Each `console.log(text)` becomes `say(text)`, which is `out.payload(text + "\n")`: the same bytes, at a terminal and off one. These verbs print plain text today (the file imports no color), so a person sees no change either.

**Verbs a person reads (8 sites):** lines 874, 886 (`read`), 900 (`rooms`), 921 (`who`), 932 (`buddies`), 1097, 1141 (`sign-in`), 1268 (`--help`). Each becomes `show(blocks, frozen)`: blocks through `out.print` when `out.isHuman()`, today's text through `say` otherwise.

| Verb | At a terminal |
|---|---|
| `rooms` | one `table`: heading (strong), members, unread (`needs-you` when it holds a mention, dim "nothing unread" when zero), last post (dim); a `direct` group label before the DM rows. No rooms: `line("skipped", "You are not in any room yet")`, `callout("next", cmd("rt chat join <room>"))` |
| `read` | one `section` per room, titled by the room heading; per message a one-row `table` (name strong, `HH:MM` dim) and a `paragraph` holding the body. Nothing unread: `line("skipped", "Nothing unread")` |
| `who <room>` | a `section` titled by the heading, holding a `table`: name (strong), status word (`listening` as `running`, `idle` as `pending`, `offline` as `off`), folder and pane (dim) |
| `buddies`, bare `who` | one `table`: name (strong), status with its age, then repo, branch, pane and away text (dim). Nobody: `line("skipped", "Nobody is signed in")` |
| `sign-in` | `line("done", "Signed in as <name>", <the rest of today's line, joined by " · ">)` |
| `--help` | `kv("usage", "rt chat <verb>")` and a `section("Verbs")` holding a `table` of verb and hint |

**Failures and refusals (41 `fail` call sites and one warn line).** `fail(msg)` (`:157`) becomes `fail(f: FailureInput)`, plus `failUsage(title, usage, why?)` over 5a's `usageFailure`, plus `refuse(...blocks)` for the two places rt declines by policy (5f ruling 6): `out.note(...)` on stderr. All three exit 1, as today.

| Site | Today (`rt chat: ` prefix on each) | Becomes |
|---|---|---|
| `:142` | `unknown flag <flag>` and the usage line | `failUsage("rt chat <verb> does not take <flag>", <usage>)` |
| `:166` | `invalid <kind> "<name>" -- must match ^[a-z0-9._-]+$` | `{ title: "\"<name>\" is not a valid <kind> name", why: "Names use lowercase letters, digits, dots, dashes and underscores." }` |
| `:171, 1172` | `invalid session id "<id>" -- must match ...` | `{ title: "That session id is not valid", why: "A session id uses letters, digits, dots, dashes and underscores." }` |
| `:175` `unwrap` | the daemon's error, or `<label> failed` | `{ title: <the daemon's error> }`, or `{ title: "The chat <label> did not go through" }` |
| `:277` | `sign-in <flag> needs a non-empty value` | `failUsage("Which identity?" \| "What name?", "rt chat sign-in <flag> <name>")` |
| `:285` | `sign-in takes --as or --name, not both: ...` | `{ title: "Sign in with one of them, not both", why: "--as continues an identity you had; --name starts a fresh one." }` |
| `:318` | `sign-in --pane takes --as only, not --name` | `{ title: "A pane sign-in continues an identity", why: "sign-in --pane takes --as, never --name." }` |
| `:366` | `signed in as <name>: sign out to change identity (rt chat sign-out)` | a refusal: `refuse(line("refused", "You are signed in as <name>"), callout("why", "One session keeps one identity. Leave out --as, or sign out to change it."), callout("next", cmd("rt chat sign-out")))` |
| `:586, 613, 631` | `usage: rt chat join\|leave\|archive <room> ...` | `failUsage("Which room?", "rt chat <verb> <room>")` |
| `:596` | `--wake-on must be mention, all, or none (got "<x>")` | `{ title: "\"<x>\" is not a wake setting", why: "Use mention, all or none." }` |
| `:667` | `cannot read --file <path>` | `{ title: "That file could not be read", why: <path> }` |
| `:669` | `--file <path> is empty` | `{ title: "That file is empty", why: <path> }` |
| `:675, 679` | the usage line | `failUsage("What is the message?", <usage>)` |
| `:704` | `refusing a <n>-character body with no line breaks.` and three lines | a refusal: `refuse(line("refused", "That message is <n> characters with no line breaks"), callout("why", "A long one-line message has usually lost its paragraphs on the way in."), callout("next", cmd(<the verb's own form>)), callout("note", "Put the message on stdin from a heredoc so its paragraphs and lists survive.", "--as-is posts it as it is."))` |
| `:722` | `POST_USAGE` | `failUsage("Which room?", POST_USAGE)` |
| `:759, 778` | `usage: rt chat ack\|claim\|release <messageId>` | `failUsage("Which message?", "rt chat <verb> <messageId>")` |
| `:761, 780` | `not a message id: <raw> (the delivered line shows it as "#<id>")` | `{ title: "\"<raw>\" is not a message id", why: "A delivered message shows its id as #<id>." }` |
| `:846` | `--limit must be a positive number (got "<x>")` | `{ title: "\"<x>\" is not a number of messages", why: "--limit takes a positive number." }` |
| `:854` | `--since: bad duration "<x>" (use 30s, 5m, 500ms, or bare seconds)` | `{ title: "\"<x>\" is not a length of time", why: "--since takes 30s, 5m, 500ms or a number of seconds." }` |
| `:860` | `--last and --since are mutually exclusive` | `{ title: "Use --last or --since, not both" }` |
| `:861` | `--last needs a room` | `failUsage("Which room?", "rt chat read <room> --last <n>")` |
| `:863` | `--last must be a positive integer (got "<x>")` | `{ title: "\"<x>\" is not a number of messages", why: "--last takes a positive whole number." }` |
| `:945` | `--upto needs a room` | `failUsage("Which room?", "rt chat mark <room> --upto <messageId>")` |
| `:947` | `--upto must be a positive message id (got "<x>")` | `{ title: "\"<x>\" is not a message id", why: "--upto takes a positive message id." }` |
| `:985` | `DM_USAGE` | `failUsage("Who is it for?", DM_USAGE)` |
| `:1012, 1014` | `usage: rt chat invite ...`, `--room is required` | `failUsage("Which pane?" \| "Which room?", "rt chat invite <pane> --room <room>")` |
| `:1053, 1168, 1235, 1249` | `no session id -- pass --session <id> or run under CLAUDE_CODE_SESSION_ID` | `{ title: "rt cannot tell which session this is", why: "Chat needs a session id. Claude Code sets one; anywhere else, pass --session <id>." }` |
| `:1183` (a warning; the verb exits 0) | `rt chat: sign-out: daemon error (<err>) -- local state cleaned up anyway` | `out.note(out.line("warn", "Signed out here, but the daemon did not hear it", <err>))` |
| `:1213` | `sign-out --pane needs a daemon that supports it; restart the rt daemon` | `{ title: "The rt daemon is too old to sign a pane out", next: cmd("rt daemon restart") }` |
| `:1232` | `usage: rt chat away <text>` | `failUsage("What should your status say?", "rt chat away <text>")` |
| `:1332` | `USAGE` | `failUsage("Which chat verb?", USAGE)` |
| `:1340` | `unknown verb "<x>" -- usage: ...` | `{ title: "rt chat has no verb called <x>", next: cmd("rt chat --help"), details: "Verbs: <the list>" }` |

Why those two are refusals and the rest are not: `:704` is a guard rt applies to a message it could send (the body is valid, rt declines it on purpose, and `--as-is` overrides it), and `:366` is an ownership rule (one session keeps one identity). Every other site is input rt cannot act on (a missing or malformed argument, an unreadable file, a session it cannot identify) or a daemon that said no, which are failures. Three of those daemon replies are policy refusals by meaning (a release by someone who is neither holder nor author, `--as` naming an identity another session holds, `--as` naming the human's handle), but the reply carries no code that says so; they stay failures in this plan, with no string parsing (decision 8).

`:704`'s `next` names the verb that was refused: `requireReadable` takes the heredoc form from its caller (`rt chat post <room> <<'EOF'` from `post`, `rt chat dm <handle> <<'EOF'` from `dm`), where today's text names `post` for both. `:366`'s `why` names leaving out `--as`, which is what unsticks an agent that passed it by habit; `next` stays the sign-out command for one that meant to change identity.

One line of today's stdout holds a long dash: a `rooms` row prints one for a room with nothing unread (`commands/chat.ts:465`). That line is frozen text and is not edited. The fixture stores it ASCII-escaped, so no file this plan writes holds the character.

Every verb named in a `next` exists in `lib/command-tree-def.ts`: `rt chat join`, `rt chat post`, `rt chat dm`, `rt chat sign-out`, `rt chat --help` (the chat branch's help), `rt daemon restart`.

#### Copy inside envelopes (5f ruling 5)

The ruling's pass looks for a human sentence that rides in a `--json` envelope and is also what a person reads on screen. `rt chat` has none to reword:

| What rides in an envelope | Read on screen? | Decision |
|---|---|---|
| The 22 `--json` replies: `{ ok, ... }` built from the daemon's reply data (room names, ids, handles, counts, `delivered`, and the daemon's own `reason` on an invite) | no: the human path prints frozen text or blocks, never the envelope | stay; every human word in them is the daemon's (`lib/daemon/handlers/chat.ts`, not this plan's) |
| A daemon refusal (`no such room: ghost`) | yes, as a failure title (`unwrap`) | stays in the daemon's words; it never rides in a chat envelope (a failure under `--json` writes nothing to stdout) and the handler is not this plan's (decision 3) |
| The frozen text lines | yes | not envelopes, and frozen byte for byte by 5f ruling 1 |

So this plan's copy work is the failure and refusal table above, which is stderr only.

#### Who reads this plan's output (spec: each conversion PR greps `plugins/mattstack`, `skills/` and `apps/board/skills`)

| Reader | What it reads | After this plan |
|---|---|---|
| `skills/rt-chat/SKILL.md` lines 145 to 157 | after a `/clear`, an agent runs `rt chat sign-in`, `rooms`, `join`, `read`, `post`, `dm` in Bash and reads the text | stdout bytes unchanged (Task 4). The skill quotes no failure or refusal text. No skill edit |
| `plugins/herdr-chat/src/rt.rs` | `rooms --json`, `buddies --json`, `sign-in\|sign-out --pane --json`; `post` and `dm` by exit code. On a non-zero exit, `err_text` (`:168`) shows stderr whole as the error for a failed `post`, `dm` or `rooms` | stdout unchanged. The error it shows takes the new failure and refusal wording; it is shown as a whole and never parsed. No edit |
| `lib/mcp/chat-tools.ts:326` | spawns `rt chat sign-in --json` and parses stdout; a failed sign-in's error carries stderr's tail (`lib/mcp/rt-verb.ts:80`) | stdout unchanged. The error's tail takes the new failure wording; nothing matches on it. No edit |
| `marketplace/plugins/chat/skills/*/SKILL.md` (join, sign-in, sign-out, away) | send an agent to `rt chat sign-in`, `join`, `post`, `read`, `away`, `back` and `sign-out` in Bash | stdout bytes unchanged (Task 4). The refusals they quote are the MCP tools', not the CLI's. No edit |
| `e2e/tests/chat-inbox-delivery.test.ts` | the `dm` and `claim` text lines, the daemon's frame | unchanged; must pass untouched |
| `plugins/mattstack/attachments/orchestration/shepherdr/references/job-template.md:217-219` | tells a worker to run `rt chat dm <id>`; reads nothing back | unchanged |

#### Tests this plan moves

| File | What changes | Task |
|---|---|---|
| `lib/__tests__/chat-viewer-url.test.ts` | new tests of the warning | 3 |
| `commands/__tests__/chat.test.ts` | `runChatRaw` captures both the console and the streams (Task 4), then only the streams (Task 6); seven failure assertions (Task 6) | 4, 5, 6 |
| `e2e/tests/chat-inbox-delivery.test.ts`, `e2e/tests/chat-presence-roster.test.ts` | no edit; each must pass untouched | 6, 7 |

The spec names no pty test for these verbs, so this plan adds none and does not edit `.github/workflows/e2e.yml`.

Counts against the scoping document: `commands/chat.ts` 53 guard lines and 8 seam lines, `lib/chat-viewer-url.ts` 1. Two allowlist lines. (5f1 carries the slice's other six.)

---

### Task 3: The chat link warning goes through `warn`

**Files:**
- Modify: `lib/chat-viewer-url.ts`
- Modify: `lib/__tests__/chat-viewer-url.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `lib/chat-viewer-url.ts`)

**Interfaces:**
- Consumes (5a): `warn(module, message, opts?)`, `setWarningLog(log, opts?)`, `__test__.reset()` from `lib/ui/warn.ts`; `captureOut()` from `lib/ui/__tests__/capture-out.ts` (phase 2).
- Produces: `readChatViewerUrlSetting(read?: () => { value?: unknown }): string | undefined`. The parameter is a test seam; every caller keeps calling it with no argument.

- [ ] **Step 1: Write the failing tests**

In `lib/__tests__/chat-viewer-url.test.ts`, replace the two import lines with:

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { chatViewerUrl, readChatViewerUrlSetting } from "../chat-viewer-url.ts";
import * as out from "../ui/out.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnings } from "../ui/warn.ts";

beforeEach(() => warnings.reset());
afterEach(() => warnings.reset());
```

and append:

```ts
test("a setting that cannot be read is logged, never shown, and the link is dropped", () => {
  const logged: Array<{ module: string; message: string }> = [];
  setWarningLog((module, message) => logged.push({ module, message }));
  const io = captureOut();
  out.__test__.setHuman(() => false);
  try {
    const url = readChatViewerUrlSetting(() => {
      throw new Error("boom");
    });
    expect(url).toBeUndefined();
    expect(logged).toEqual([{ module: "chat", message: "chat.viewerUrl could not be read, posting without a link: boom" }]);
    expect(io.stderr()).toBe("");
    expect(io.stdout()).toBe("");
  } finally {
    io.restore();
  }
});

test("a set value comes back, and an empty one is no link", () => {
  expect(readChatViewerUrlSetting(() => ({ value: "https://chat.example" }))).toBe("https://chat.example");
  expect(readChatViewerUrlSetting(() => ({ value: "" }))).toBeUndefined();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run (repo root): `bun test lib/__tests__/chat-viewer-url.test.ts`
Expected: FAIL. `readChatViewerUrlSetting` ignores its argument, so the first new test gets the default URL instead of `undefined`, and `logged` stays empty.

- [ ] **Step 3: Edit `lib/chat-viewer-url.ts`**

Add after the `getSetting` import:

```ts
import { warn } from "./ui/warn.ts";
```

Replace `readChatViewerUrlSetting` (its doc comment stays) with:

```ts
export function readChatViewerUrlSetting(read: () => { value?: unknown } = () => getSetting<string>("chat.viewerUrl")): string | undefined {
  try {
    const resolved = read();
    return typeof resolved.value === "string" && resolved.value ? resolved.value : undefined;
  } catch (err) {
    warn("chat", `chat.viewerUrl could not be read, posting without a link: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}
```

- [ ] **Step 4: Delete the allowlist line**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `"lib/chat-viewer-url.ts",`.

- [ ] **Step 5: Run the tests and the guards**

Run (repo root): `bun test lib/__tests__/chat-viewer-url.test.ts commands/__tests__/chat.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-daemon-sync-exec.test.ts`
Expected: PASS. The daemon loads this file (the chat desk notification), which is why the last two guards are in the run: `lib/ui/warn.ts` is safe to import from a file the daemon reaches (5a's constraint).
Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/chat-viewer-url.ts lib/__tests__/chat-viewer-url.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "chat: the viewer link warning goes through warn

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Pin every `rt chat` verb's stdout before converting it

No change to `commands/chat.ts`. This task moves the test harness onto a capture that reads both the console and the streams, so the same tests pass before and after the conversion, and captures the fixture that Tasks 5 and 6 must leave alone.

**Files:**
- Modify: `commands/__tests__/chat.test.ts` (imports, `runChatRaw`, one new `describe`)
- Create: `commands/__tests__/fixtures/chat-bytes.json` (captured)

**Interfaces:**
- Consumes: `captureOut(opts?: { console?: boolean })` (phase 2, extended by phase 4); `out.__test__.setHuman`; the file's own harness (`home`, `canned`, the fake daemon over the real chat handlers).
- Produces: `runChatRaw(args, opts?)` returns `{ code, stdout, stderr, rawStdout }`. `stdout` and `stderr` are what they were (the text with one trailing newline dropped); `rawStdout` is every byte. Tasks 5 and 6 use it as it is.

- [ ] **Step 1: Capture both the console and the streams**

In `commands/__tests__/chat.test.ts`, change `import { join } from "path";` to `import { dirname, join } from "path";` and add after the `fakeHerdr` import:

```ts
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
```

(The module is imported as `ui` because many tests in this file already name a local `out`.)

Replace `runChatRaw` (the function; the doc comment above it stays) with:

```ts
async function runChatRaw(args: string[], opts: { sock?: string } = {}): Promise<{ code: number; stdout: string; stderr: string; rawStdout: string }> {
  if (opts.sock) args = [...args, "--sock", opts.sock];
  const io = captureOut({ console: true });
  ui.__test__.setHuman(() => false);
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });

  let code = 0;
  let rawStdout = "";
  let rawStderr = "";
  try {
    await chat(args);
  } catch (err) {
    if (err instanceof Error && err.message === "process.exit sentinel") {
      code = (exitSpy.mock.calls.at(-1)?.[0] as number | undefined) ?? 1;
    } else {
      throw err;
    }
  } finally {
    rawStdout = io.stdout();
    rawStderr = io.stderr();
    exitSpy.mockRestore();
    io.restore();
  }
  return { code, stdout: rawStdout.replace(/\n$/, ""), stderr: rawStderr.replace(/\n$/, ""), rawStdout };
}
```

Run (repo root): `bun test commands/__tests__/chat.test.ts`
Expected: PASS, all tests, with `commands/chat.ts` untouched. `captureOut({ console: true })` records `console.log(x)` as `x` and a newline, in the same buffer and order as a stream write, so the text minus one trailing newline is exactly what the old harness returned.

- [ ] **Step 2: Write the fixture test**

Append at the end of `commands/__tests__/chat.test.ts`:

```ts
// ─── the bytes agents read ──────────────────────────────────────────────────

const BYTES_FIXTURE = join(import.meta.dir, "fixtures", "chat-bytes.json");

describe("rt chat stdout off a terminal (frozen for agents)", () => {
  test("every verb's stdout off a terminal matches the fixture captured before the output layer", async () => {
    const got: Record<string, { code: number; stdout: string }> = {};
    // Only what changes from run to run is replaced: the temp HOME, clock
    // values, and the random id behind a signed-in name.
    const stable = (text: string): string =>
      text
        .replaceAll(home, "<home>")
        .replace(/\b1\d{12}\b/g, "<ms>")
        .replace(/\[\d\d:\d\d\]/g, "[HH:MM]")
        .replace(/\b\d+[smhd] ago\b/g, "<age> ago")
        .replace(/claimable again in [0-9ms ]+\)/g, "claimable again in <dur>)")
        .replace(/\bidle \d+[smhd]\b/g, "idle <age>")
        .replace(/"(handle|baseHandle)":"remy[^"]*"/g, '"$1":"<id>"');
    const run = async (name: string, args: string[]): Promise<void> => {
      const r = await runChatRaw(args);
      got[name] = { code: r.code, stdout: stable(r.rawStdout) };
    };

    const origCwd = process.cwd();
    // Outside any repo, so sign-in prints no repo or branch of this checkout.
    process.chdir(home);
    try {
      await run("join-first-member", ["join", "r", "--as", "a"]);
      await run("join-json", ["join", "r", "--as", "b", "--json"]);
      await run("join-third-member", ["join", "r", "--as", "c"]);
      await run("post-woke-nobody", ["post", "r", "hello", "--as", "a"]);
      await run("post-mention", ["post", "r", "@b", "ping", "--as", "a"]);
      await run("post-quiet", ["post", "r", "fyi", "--quiet", "--as", "a"]);
      await run("post-json", ["post", "r", "again", "--as", "a", "--json"]);
      await run("rooms", ["rooms", "--as", "b"]);
      await run("rooms-json", ["rooms", "--as", "b", "--json"]);
      await run("who-room", ["who", "r", "--as", "b"]);
      await run("who-room-json", ["who", "r", "--json"]);
      await run("ack", ["ack", "1", "--as", "b"]);
      await run("ack-again", ["ack", "1", "--as", "b"]);
      await run("ack-json", ["ack", "2", "--as", "c", "--json"]);
      await run("claim-won", ["claim", "1", "--as", "b"]);
      await run("claim-held", ["claim", "1", "--as", "b"]);
      await run("claim-lost", ["claim", "1", "--as", "c"]);
      await run("claim-json", ["claim", "2", "--as", "c", "--json"]);
      await run("release", ["release", "1", "--as", "b"]);
      await run("release-json", ["release", "2", "--as", "c", "--json"]);
      await run("read", ["read", "r", "--as", "b"]);
      await run("read-nothing-unread", ["read", "r", "--as", "b"]);
      await run("read-last", ["read", "r", "--last", "2", "--as", "b"]);
      await run("read-last-json", ["read", "r", "--last", "1", "--as", "b", "--json"]);
      await run("read-json", ["read", "--as", "c", "--json"]);
      await run("mark-json", ["mark", "r", "--as", "b", "--json"]);
      await run("mark", ["mark", "r", "--as", "b"]);
      await run("dm", ["dm", "b", "hi", "there", "--as", "a"]);
      await run("dm-json", ["dm", "b", "again", "--as", "a", "--json"]);
      await run("rooms-with-a-direct-room", ["rooms", "--as", "b"]);
      await run("leave", ["leave", "r", "--as", "c"]);
      await run("leave-json", ["leave", "r", "--as", "b", "--json"]);
      await run("archive", ["archive", "r", "--as", "a"]);
      await run("archive-reopen", ["archive", "r", "--reopen", "--as", "a"]);
      await run("archive-json", ["archive", "r", "--as", "a", "--json"]);
      await run("prune", ["prune"]);
      await run("prune-json", ["prune", "--json"]);
      await run("buddies-nobody", ["buddies"]);
      await run("sign-in", ["sign-in", "--as", "remy", "--no-room", "--session", "s1"]);
      await run("sign-in-json", ["sign-in", "--as", "remy", "--no-room", "--session", "s1", "--json"]);
      await run("buddies", ["buddies"]);
      await run("buddies-json", ["buddies", "--json"]);
      await run("who-bare", ["who"]);
      await run("away", ["away", "brb", "lunch", "--session", "s1"]);
      await run("away-json", ["away", "afk", "--session", "s1", "--json"]);
      await run("back", ["back", "--session", "s1"]);
      await run("back-json", ["back", "--session", "s1", "--json"]);
      await run("sign-out", ["sign-out", "--session", "s1"]);
      await runChatRaw(["sign-in", "--as", "remy", "--no-room", "--session", "s2"]);
      await run("sign-out-json", ["sign-out", "--session", "s2", "--json"]);
      await run("sign-out-quiet", ["sign-out", "--session", "s2", "--quiet"]);
      // A room no earlier line touched: "r" is archived by now.
      await run("sign-in-room", ["sign-in", "--as", "remy", "--room", "fresh", "--session", "s3"]);
      canned = { "chat:sign-in": { ok: true, data: { handle: "kai", baseHandle: "kai", reclaimed: false, sessionId: "pane-sess-1", room: null } } };
      await run("sign-in-pane", ["sign-in", "--pane", "w1:p1"]);
      canned = { "chat:sign-in": { ok: true, data: { handle: "kai", baseHandle: "kai", reclaimed: false, sessionId: "pane-sess-1", room: "build" } } };
      await run("sign-in-pane-room", ["sign-in", "--pane", "w1:p1"]);
      canned = { "chat:sign-out": { ok: true, data: { sessionId: "pane-sess-1" } } };
      await run("sign-out-pane", ["sign-out", "--pane", "w1:p1"]);
      canned = { "chat:invite": { ok: true, data: { paneId: "w1:p1", delivered: "accepted" } } };
      await run("invite", ["invite", "w1:p1", "--room", "r"]);
      await run("invite-json", ["invite", "w1:p1", "--room", "r", "--json"]);
      canned = { "chat:invite": { ok: true, data: { paneId: "w1:p1", delivered: "refused", reason: "at a prompt" } } };
      await run("invite-refused", ["invite", "w1:p1", "--room", "r"]);
      canned = {};
      await run("help", ["join", "--help"]);
    } finally {
      process.chdir(origCwd);
    }

    if (process.env.RT_UPDATE_CHAT_BYTES) {
      mkdirSync(dirname(BYTES_FIXTURE), { recursive: true });
      // ASCII only: every character above 0x7f is written as its escape, so the
      // fixture holds no glyph an editor or a formatter could rewrite.
      const ascii = JSON.stringify(got, null, 2).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
      writeFileSync(BYTES_FIXTURE, ascii + "\n");
    }
    expect(got).toEqual(JSON.parse(readFileSync(BYTES_FIXTURE, "utf8")));
  }, 60_000);
});
```

- [ ] **Step 3: Capture the fixture from the unconverted code, and read it**

Run (repo root): `RT_UPDATE_CHAT_BYTES=1 bun test commands/__tests__/chat.test.ts -t "matches the fixture"`
Expected: PASS, and `commands/__tests__/fixtures/chat-bytes.json` exists with 58 entries.

Read the fixture before trusting it. It must show, once decoded (the file writes `✓` as `\u2713`, `·` as `\u00b7`, `→` as `\u2192`):

- Every entry has `"code": 0`. A non-zero code means the scenario is wrong for today's daemon rules, not that the verb is broken: fix the scenario line so the verb succeeds, and capture again.
- `join-first-member`: `✓ joined #r as a · 1 member, you are alone here` and a newline.
- `post-woke-nobody`: `on the record for 2 members, woke nobody: @handle or @here wakes someone, rt chat dm reaches one`, a newline, `posted → https://chat.mattstack/r/r#m-1`, a newline.
- `post-mention`: `delivered to b`, then the `posted →` line for `#m-2`.
- `claim-won`: `claimed #1 → a`. `claim-held`: `you already hold #1`. `claim-lost`: `#1 already claimed by b <age> ago (claimable again in <dur>)`.
- `mark`: an empty string. `sign-out-quiet`: an empty string.
- `sign-in`: `signed in as remy · not in a repository · no room joined`.
- `sign-in-room`: `signed in as remy · joined #fresh (1 member)`.
- `sign-in-pane`: `signed in as kai · pane w1:p1 · no room joined`. `sign-in-pane-room`: `signed in as kai · pane w1:p1 · joined #build`.
- `sign-out-pane`: `✓ signed out (kai) · pane w1:p1` (the session file `sign-in-pane-room` wrote under `pane-sess-1` supplies the name).
- Every `-json` entry is one line of JSON and a newline, and holds no 13-digit number and no path under the temp HOME.
- `help`: the one `usage: rt chat <join|leave|...> ...` line.

If any volatile value slipped through (a timestamp, a temp path, an id after `remy`), extend `stable` for it and capture again. Do not hand-edit the fixture.

Run twice more without the variable: `bun test commands/__tests__/chat.test.ts`
Expected: PASS both times. A second run that fails means something volatile is still in the fixture.

- [ ] **Step 4: Commit**

```bash
git add commands/__tests__/chat.test.ts commands/__tests__/fixtures/chat-bytes.json
```

```bash
git commit -m "chat: pin every verb's stdout off a terminal before the output layer touches it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `rt chat` stdout: envelopes and frozen lines through the layer, blocks for a person

After this task `commands/chat.ts` holds no `console.log`. Its two `console.error` sites are Task 6's, so the file stays on the allowlist until then.

**Files:**
- Modify: `commands/chat.ts`
- Modify: `commands/__tests__/chat.test.ts`

**Interfaces:**
- Consumes: `out.json(value)`, `out.payload(text)`, `out.print`, `out.isHuman()`, the block builders (phases 1 and 2); `runChatRaw` and the fixture test (Task 4); the fake helper `lib/ui/__tests__/fake-rt-ui.ts` (its `render` verb records its stdin and prints `STYLED`).
- Produces, in `commands/chat.ts`:
  - `say(text: string): void` (one frozen line on stdout) and `show(blocks: () => Block[], frozen: () => string): void`
  - `roomsBlocks(rooms)`, `readBlocks(rooms, full, headingFor)`, `whoBlocks(heading, members)`, `buddiesBlocks(buddies)`, `signInBlocks(frozen)`, `helpBlocks()`: each returns `Block[]`, each added to `__test__`
  - an `invite` entry in `VERB_HINTS`
  - In the test file, `runChatRaw` gains `opts.human?: boolean`.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/chat.test.ts`, add to the imports:

```ts
import { renderPlain } from "../../lib/ui/out-plain.ts";
import type { BuddyStatus, ChatMember, ChatMessage, PresenceRow } from "../../packages/rt-client/src/index.ts";
```

In `runChatRaw`, change the signature's options to `opts: { sock?: string; human?: boolean } = {}` and the gate line to:

```ts
  ui.__test__.setHuman(() => opts.human === true);
```

Add this block before the `// ─── the bytes agents read` banner:

```ts
// ─── what a person at a terminal sees ───────────────────────────────────────

describe("rt chat at a terminal", () => {
  const cols = (cells: string[], widths: number[]): string => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!))).join("  ");
  const at = Date.UTC(2026, 9, 1, 12, 4);
  const message = (over: Partial<ChatMessage>): ChatMessage => ({ id: 1, room: "build", handle: "ana.1", name: "ana", body: "hello", mentions: [], mentionNames: [], postedAt: at, ...over });
  const heading = (room: string): string => `#${room}`;

  test("rooms is one table: name, members, unread, last post", () => {
    const text = renderPlain(
      __test__.roomsBlocks([
        { room: "build-and-ship", memberCount: 3, unread: 2, mentions: 1, lastPostedAt: Date.now() - 65_000 },
        { room: "quiet", memberCount: 1, unread: 0, mentions: 0 },
      ]),
    );
    expect(text).toBe(
      cols(["#build-and-ship", "3 members", "2 unread (1 mention)", "last post 1m ago"], [15, 9, 20]) + "\n" + cols(["#quiet", "1 member", "nothing unread", "no posts yet"], [15, 9, 20]) + "\n",
    );
  });

  test("a direct room sits under its own label and shows two names, never its hashed id", () => {
    const text = renderPlain(
      __test__.roomsBlocks([
        { room: "build", memberCount: 2, unread: 0, mentions: 0 },
        { room: "dm-abc123", kind: "dm", participants: { a: "ana.1", b: "bo.2", aName: "ana", bName: "bo" }, memberCount: 2, unread: 1, mentions: 0 },
      ]),
    );
    const lines = text.split("\n");
    expect(lines[1]).toBe("direct:");
    expect(lines[2]).toMatch(/^ana ↔ bo +2 members +1 unread +no posts yet$/);
    expect(text).not.toContain("dm-abc123");
  });

  test("no rooms says so and names the join command", () => {
    expect(renderPlain(__test__.roomsBlocks([]))).toBe("[skipped] You are not in any room yet\n  next: rt chat join <room>\n");
  });

  test("read is a section per room: each message a name, a time and its body as written", () => {
    const text = renderPlain(__test__.readBlocks([{ room: "build", messages: [message({ body: "the lede\n\n- one point" }), message({ id: 2, name: "bo", body: "ok" })] }], false, heading));
    expect(text).toBe("#build\nana  12:04\n  the lede\n  \n  - one point\nbo  12:04\n  ok\n");
    expect(renderPlain(__test__.readBlocks([], false, heading))).toBe("[skipped] Nothing unread\n");
  });

  test("a long body is cut at 200 characters unless the person asks for all of it", () => {
    const long = "x".repeat(300);
    const cut = renderPlain(__test__.readBlocks([{ room: "r", messages: [message({ body: long })] }], false, heading));
    expect(cut).toBe(`#r\nana  12:04\n  ${"x".repeat(199)}…\n`);
    const whole = renderPlain(__test__.readBlocks([{ room: "r", messages: [message({ body: long })] }], true, heading));
    expect(whole).toBe(`#r\nana  12:04\n  ${long}\n`);
  });

  test("a message body cannot repaint the screen or forge a row", () => {
    const text = renderPlain(__test__.readBlocks([{ room: "r", messages: [message({ name: "mal", body: "hi\x1b[2Jthere\n[ok] forged" })] }], true, heading));
    expect(text).toBe("#r\nmal  12:04\n  hithere\n  [ok] forged\n");
  });

  test("who is the room's members, each with its status as a word", () => {
    const member = (over: Partial<ChatMember>): ChatMember => ({ room: "build", handle: "ana.1", name: "ana", joinedAt: 1, lastReadId: 0, wakeOn: "mention", status: "live", ...over });
    const text = renderPlain(__test__.whoBlocks("#build", [member({ cwd: "/code/sample-app", pane: "w1:p2" }), member({ handle: "bo.2", name: "bo", status: "offline", cwd: "/code/other" })]));
    expect(text).toBe("#build\n" + cols(["ana", "listening", "/code/sample-app  w1:p2"], [3, 9]) + "\n" + cols(["bo", "offline", "/code/other"], [3, 9]) + "\n");
    expect(renderPlain(__test__.whoBlocks("#empty", []))).toBe("#empty\n[skipped] No members\n");
  });

  test("buddies lists listening, then idle, then offline, each with what it is doing", () => {
    const now = Date.now();
    const buddy = (over: Partial<PresenceRow & { status: BuddyStatus }>): PresenceRow & { status: BuddyStatus } => ({ sessionId: "s", handle: "ana.1", baseHandle: "ana", name: "ana", signedInAt: now, lastSeenAt: now, status: "live", ...over });
    const text = renderPlain(
      __test__.buddiesBlocks([
        buddy({ handle: "cy.3", name: "cy", status: "offline", signedOutAt: now - 2 * 3_600_000 }),
        buddy({ handle: "bo.2", name: "bo", status: "idle", lastSeenAt: now - 180_000, statusText: "at lunch" }),
        buddy({ repo: "sample-app", branch: "main", pane: "w1:p2" }),
      ]),
    );
    const lines = text.split("\n");
    expect(lines[0]).toBe(cols(["ana", "listening", "sample-app · main · pane w1:p2"], [3, 15]));
    expect(lines[1]).toBe(cols(["bo", "idle 3m", "at lunch"], [3, 15]));
    expect(lines[2]).toMatch(/^cy +offline, 2h ago\s*$/);
    expect(renderPlain(__test__.buddiesBlocks([]))).toBe("[skipped] Nobody is signed in\n");
  });

  test("sign-in is one done line, with the rest of today's line as its hint", () => {
    expect(renderPlain(__test__.signInBlocks("signed in as remy · sample-app · main · joined #sample-app (3 members)"))).toBe(
      "[ok] Signed in as remy  sample-app · main · joined #sample-app (3 members)\n",
    );
    expect(renderPlain(__test__.signInBlocks("signed in as remy"))).toBe("[ok] Signed in as remy\n");
  });

  test("help is a usage line and every verb with what it does", () => {
    const text = renderPlain(__test__.helpBlocks());
    expect(text.startsWith("usage: rt chat <verb>\n\nVerbs\n")).toBe(true);
    for (const verb of ["join", "post", "read", "dm", "sign-in", "invite"]) expect(text).toContain(`\n${verb} `);
    expect(text).toContain("send a message to a room");
    expect(text).toContain("invite an agent's pane into a room");
  });

  test("at a terminal rooms is drawn by rt-ui, and an agent verb still writes its frozen line", async () => {
    await runChat(["join", "r", "--as", "a"]);
    const dir = mkdtempSync(join(tmpdir(), "rt-chat-ui-"));
    const record = join(dir, "record.ndjson");
    process.env.RT_UI_BIN = join(import.meta.dir, "..", "..", "lib", "ui", "__tests__", "fake-rt-ui.ts");
    process.env.RT_UI_FAKE = JSON.stringify({ record });
    try {
      const styled = await runChatRaw(["rooms", "--as", "a"], { human: true });
      expect(styled.rawStdout).toBe("STYLED\n");
      const sent = readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { t?: string });
      expect(sent.map((l) => l.t)).toEqual([undefined, "hello", "table"]);

      const posted = await runChatRaw(["post", "r", "hello", "--as", "a"], { human: true });
      expect(posted.stdout).toBe("on the record for 0 members, woke nobody: @handle or @here wakes someone, rt chat dm reaches one\nposted → https://chat.mattstack/r/r#m-1");

      const json = await runChatRaw(["rooms", "--as", "a", "--json"], { human: true });
      expect(JSON.parse(json.stdout).ok).toBe(true);

      const piped = await runChatRaw(["rooms", "--as", "a"]);
      expect(piped.stdout.startsWith("#r ")).toBe(true);
    } finally {
      delete process.env.RT_UI_BIN;
      delete process.env.RT_UI_FAKE;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run (repo root): `bun test commands/__tests__/chat.test.ts -t "at a terminal"`
Expected: FAIL. `__test__.roomsBlocks` is not a function.

- [ ] **Step 3: Add the two printers and the block builders to `commands/chat.ts`**

Add after the `parseDuration` import:

```ts
import * as out from "../lib/ui/out.ts";
import type { Block, Segment } from "../lib/ui/protocol.ts";
```

In `positionals` (line 116), the local array is named `out`, which would shadow the module: rename it to `found` on its three lines (`const found: string[] = [];`, `found.push(a);`, `return found;`).

Add after `sockOpts` (before `fail`):

```ts
/** One line an agent may be reading: stdout, byte for byte, never styled. */
function say(text: string): void {
  out.payload(`${text}\n`);
}

/** Blocks for a person at a terminal; the frozen text for every other reader. */
function show(blocks: () => Block[], frozen: () => string): void {
  if (out.isHuman()) out.print(...blocks());
  else say(frozen());
}
```

Add before the `// ─── verbs` banner (after `renderBuddies`):

```ts
// ─── what a person at a terminal sees ───────────────────────────────────────

const STATUS_ROLE: Record<BuddyStatus, Segment["role"]> = { live: "running", idle: "pending", offline: "off" };

function present(parts: Array<string | undefined>, glue: string): string {
  return parts.filter((s): s is string => Boolean(s)).join(glue);
}

function roomRow(r: RoomSummary): out.CellInput[] {
  const unread: Segment =
    r.unread === 0
      ? out.dim("nothing unread")
      : { text: `${r.unread} unread${r.mentions > 0 ? ` (${pluralize(r.mentions, "mention")})` : ""}`, role: r.mentions > 0 ? "needs-you" : "text" };
  const last = r.lastPostedAt !== undefined ? `last post ${relativeAgo(r.lastPostedAt)} ago` : "no posts yet";
  return [out.strong(roomHeading(r)), pluralize(r.memberCount, "member"), unread, out.dim(last)];
}

function roomsBlocks(rooms: RoomSummary[]): Block[] {
  if (rooms.length === 0) return [out.line("skipped", "You are not in any room yet"), out.callout("next", out.cmd("rt chat join <room>"))];
  const channels = rooms.filter((r) => r.kind !== "dm").map(roomRow);
  const directs = rooms.filter((r) => r.kind === "dm").map(roomRow);
  return [out.table(directs.length > 0 ? [...channels, { group: DIRECT_SECTION_LABEL }, ...directs] : channels)];
}

function readBlocks(rooms: { room: string; messages: ChatMessage[] }[], full: boolean, headingFor: (room: string) => string): Block[] {
  if (rooms.length === 0) return [out.line("skipped", "Nothing unread")];
  return rooms.map((r) =>
    out.section(
      headingFor(r.room),
      undefined,
      ...r.messages.flatMap((m) => [
        out.table([[out.strong(m.name ?? m.handle), out.dim(new Date(m.postedAt).toISOString().slice(11, 16))]]),
        out.paragraph(full ? m.body : truncate(m.body, 200)),
      ]),
    ),
  );
}

function whoBlocks(heading: string, members: ChatMember[]): Block[] {
  if (members.length === 0) return [out.section(heading, undefined, out.line("skipped", "No members"))];
  const rows = members.map((m): out.CellInput[] => [out.strong(m.name ?? m.handle), { text: STATUS_WORD[m.status], role: STATUS_ROLE[m.status] }, out.dim(present([m.cwd, m.pane], "  "))]);
  return [out.section(heading, undefined, out.table(rows))];
}

function buddiesBlocks(buddies: Array<PresenceRow & { status: BuddyStatus }>): Block[] {
  if (buddies.length === 0) return [out.line("skipped", "Nobody is signed in")];
  const rows: out.CellInput[][] = [];
  for (const status of BUDDY_SECTIONS) {
    for (const b of buddies.filter((x) => x.status === status)) {
      const word = status === "offline" ? `offline, ${relativeAgo(b.signedOutAt ?? b.lastSeenAt)} ago` : buddyStatusWord(b);
      rows.push([out.strong(b.name ?? b.handle), { text: word, role: STATUS_ROLE[status] }, out.dim(present([buddyDeets(b), b.statusText], " · "))]);
    }
  }
  return [out.table(rows)];
}

function signInBlocks(frozen: string): Block[] {
  const [first, ...rest] = frozen.split(" · ");
  return [out.line("done", (first ?? frozen).replace(/^signed in/, "Signed in"), rest.join(" · ") || undefined)];
}

function helpBlocks(): Block[] {
  return [out.kv("usage", "rt chat <verb>"), out.section("Verbs", undefined, out.table(Object.keys(VERBS).map((v) => [out.strong(v), out.dim(VERB_HINTS[v] ?? "")])))];
}
```

`VERB_HINTS` has no `invite` entry today, so help (and the verb picker, which reads the same map) shows it with no description. Add one after `buddies: "the presence roster",`:

```ts
  invite: "invite an agent's pane into a room",
```

`USAGE` does not read `VERB_HINTS`, so no frozen line moves.

Add the six builders to the `__test__` object at the end of the file:

```ts
  roomsBlocks,
  readBlocks,
  whoBlocks,
  buddiesBlocks,
  signInBlocks,
  helpBlocks,
```

- [ ] **Step 4: Move every `--json` line onto `out.json`**

At each of these 22 lines, `console.log(JSON.stringify(X));` becomes `out.json(X);` with `X` untouched: 605, 623, 642, 738, 769, 805, 829, 870, 882, 897, 916, 929, 954, 967, 997, 1023, 1094, 1138, 1190, 1219, 1241, 1255. (Line numbers are `5bc69f231`'s; Step 3 shifted them down by the lines it added. Find each by its text.)

Two examples, exactly:

```ts
    out.json({ ok: true, room, ...data });
```

```ts
  if (args.includes("--json")) out.json({ ok: true });
```

`out.json(value)` writes `JSON.stringify(value)` and a newline, which is what `console.log(JSON.stringify(value))` wrote.

- [ ] **Step 5: Move every agent verb's text line onto `say`**

At each of these lines, `console.log(TEXT);` becomes `say(TEXT);` with `TEXT` untouched: 608 (`join`), 626 (`leave`), 645 to 649 (`archive`, the three-line call), 745, 746, 747, 748 (`post`), 773, 774 (`ack`), 810, 814, 818 (`claim`), 832 (`release`), 970 (`prune`), 1000, 1002 (`dm`), 1026 (`invite`), 1192 (`sign-out`), 1222 (`sign-out --pane`), 1244 (`away`), 1258 (`back`).

Do not touch the strings. In particular `renderRooms`, `renderReadRooms`, `renderMessage`, `renderWhoSection`, `renderBuddies`, `renderJoin` and `renderSignIn` are not edited: they are the frozen text.

- [ ] **Step 6: Give the five human verbs and `--help` both forms**

In `runRead`, the `--last` branch, replace

```ts
    const headingFor = await dmHeadingsFor(handle);
    console.log(renderReadRooms(rooms, args.includes("--full"), headingFor));
    return;
```

with

```ts
    const headingFor = await dmHeadingsFor(handle);
    const full = args.includes("--full");
    show(() => readBlocks(rooms, full, headingFor), () => renderReadRooms(rooms, full, headingFor));
    return;
```

and at the end of `runRead`, replace

```ts
  const headingFor = await dmHeadingsFor(handle);
  console.log(renderReadRooms(data.rooms, args.includes("--full"), headingFor));
```

with

```ts
  const headingFor = await dmHeadingsFor(handle);
  const full = args.includes("--full");
  show(() => readBlocks(data.rooms, full, headingFor), () => renderReadRooms(data.rooms, full, headingFor));
```

In `runRooms`, replace `console.log(renderRooms(data.rooms));` with:

```ts
  show(() => roomsBlocks(data.rooms), () => renderRooms(data.rooms));
```

In `runWho`, replace `console.log(renderWhoSection(headingFor(room), members));` with:

```ts
  const heading = headingFor(room);
  show(() => whoBlocks(heading, members), () => renderWhoSection(heading, members));
```

In `runBuddies`, replace `console.log(renderBuddies(data.buddies));` with:

```ts
  show(() => buddiesBlocks(data.buddies), () => renderBuddies(data.buddies));
```

In `runSignIn`, replace the last line, `console.log(renderSignIn(displayName, { repo, branch, pane }, root !== null, noRoomFlag, joinedRoom));`, with:

```ts
  const signedIn = renderSignIn(displayName, { repo, branch, pane }, root !== null, noRoomFlag, joinedRoom);
  show(() => signInBlocks(signedIn), () => signedIn);
```

In `runSignInViaPane`, replace the last line (the `console.log` of the `signed in as ... · pane ...` template) with:

```ts
  const signedIn = `signed in as ${displayName} · pane ${paneId} · ${room ? `joined #${room}` : "no room joined"}`;
  show(() => signInBlocks(signedIn), () => signedIn);
```

Replace the body of `usage()` with:

```ts
  show(helpBlocks, () => USAGE);
```

- [ ] **Step 7: Run the tests, the fixture included**

Run (repo root): `bun test commands/__tests__/chat.test.ts`
Expected: PASS, every test: the new block tests, every test that was there, and the fixture test with `commands/__tests__/fixtures/chat-bytes.json` untouched. If the fixture test fails, a string or a newline moved: fix `commands/chat.ts`. Never regenerate the fixture.
Run: `grep -n "console\.log" commands/chat.ts`
Expected: no output.
Run: `grep -c "console\.error" commands/chat.ts`
Expected: `2` (the `fail` helper and the sign-out warning, both Task 6's).
Run: `bun run typecheck`
Expected: no errors.
Run: `bun test lib/__tests__/no-raw-output.test.ts`
Expected: PASS (`commands/chat.ts` still prints raw through `console.error`, so its allowlist line still belongs).

- [ ] **Step 8: Commit**

```bash
git add commands/chat.ts commands/__tests__/chat.test.ts
```

```bash
git commit -m "chat: envelopes and frozen lines go through the output layer; a person at a terminal gets blocks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `rt chat` failures and refusals, and the file leaves the allowlist

**Files:**
- Modify: `commands/chat.ts` (the `fail` helper, 41 call sites of which two become refusals, `requireReadable` and its two callers, the sign-out warning)
- Modify: `commands/__tests__/chat.test.ts` (the harness drops its console capture; seven assertions; one new `describe`)
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `commands/chat.ts`)

**Interfaces:**
- Consumes: `usageFailure(title, usage, why?)` and `out.note(...blocks)` (5a); `out.fail`, `out.line`, `out.callout`, `out.cmd`, `out.FailureInput` (phases 1 and 2).
- Produces, in `commands/chat.ts`: `fail(f: out.FailureInput): never`, `failUsage(title: string, usage: string, why?: string): never` and `refuse(...blocks: Block[]): never` (the blocks through `out.note`, on stderr). All three exit 1. `requireReadable(body: string, args: string[], heredoc: string): void` gains its third parameter.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/chat.test.ts`, add this block before the `// ─── the bytes agents read` banner:

```ts
// ─── failures ───────────────────────────────────────────────────────────────

describe("rt chat failures", () => {
  test("a missing room asks which room and shows the command", async () => {
    const r = await runChatRaw(["join"]);
    expect(r.code).toBe(1);
    expect(r.rawStdout).toBe("");
    expect(r.stderr).toBe("Which room?\n  next: rt chat join <room>");
  });

  test("a failure under --json leaves stdout empty and exits 1", async () => {
    const r = await runChatRaw(["join", "Bad/Name", "--json"]);
    expect(r.code).toBe(1);
    expect(r.rawStdout).toBe("");
    expect(r.stderr).toBe('"Bad/Name" is not a valid room name\n  why: Names use lowercase letters, digits, dots, dashes and underscores.');
  });

  test("an unknown verb names the verbs and where help is", async () => {
    const r = await runChatRaw(["bogus"]);
    expect(r.code).toBe(1);
    expect(r.stderr.startsWith("rt chat has no verb called bogus\n  next: rt chat --help\n  Verbs: ack, claim, release, join, leave, ")).toBe(true);
  });

  test("no verb off a terminal asks which one", async () => {
    // A test run from an interactive terminal would otherwise open the verb picker and wait.
    const origBatch = process.env.RT_BATCH;
    process.env.RT_BATCH = "1";
    try {
      const r = await runChatRaw([]);
      expect(r.code).toBe(1);
      expect(r.stderr.startsWith("Which chat verb?\n  next: rt chat <join|leave|")).toBe(true);
    } finally {
      if (origBatch === undefined) delete process.env.RT_BATCH;
      else process.env.RT_BATCH = origBatch;
    }
  });

  test("a daemon refusal is the title, as the daemon worded it", async () => {
    const r = await runChatRaw(["archive", "ghost", "--as", "a"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no such room");
    expect(r.stderr.split("\n")).toHaveLength(1);
  });

  test("the long one-line refusal keeps its heredoc and its override", async () => {
    await runChat(["join", "r", "--as", "a"]);
    const r = await runChatRaw(["post", "r", "x".repeat(520), "--as", "a"]);
    expect(r.code).toBe(1);
    expect(r.rawStdout).toBe("");
    expect(r.stderr).toBe(
      "[refused] That message is 520 characters with no line breaks\n" +
        "  why: A long one-line message has usually lost its paragraphs on the way in.\n" +
        "  next: rt chat post <room> <<'EOF'\n" +
        "  note: Put the message on stdin from a heredoc so its paragraphs and lists survive.\n" +
        "        --as-is posts it as it is.",
    );
    const dm = await runChatRaw(["dm", "b", "x".repeat(520), "--as", "a"]);
    expect(dm.code).toBe(1);
    expect(dm.stderr).toContain("\n  next: rt chat dm <handle> <<'EOF'\n");
  });

  test("a second identity while signed in is refused with the sign-out command", async () => {
    await signInInProcess({ as: "x", session: "s1" });
    const r = await runChatRaw(["post", "r", "hi", "--as", "y", "--session", "s1"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("[refused] You are signed in as x\n  why: One session keeps one identity. Leave out --as, or sign out to change it.\n  next: rt chat sign-out");
  });

  test("a flag post does not take is refused by name, with the usage as the command", async () => {
    await runChat(["join", "r", "--as", "a"]);
    const r = await runChatRaw(["post", "r", "hello", "--herd", "gate-cleanup-1", "--as", "a"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("rt chat post does not take --herd\n  next: rt chat post <room> <text | <<'EOF'> [--file <path>] [--as-is] [--quiet]");
  });
});
```

Update the seven assertions the new wording moves. Each is found by its test name:

| Test | Old assertion | New assertion |
|---|---|---|
| `an invalid room name is rejected with the reason` | `expect(stderr).toContain("[a-z0-9._-]");` | `expect(stderr).toContain("lowercase letters, digits, dots, dashes and underscores");` |
| `--as rejects an invalid handle the same way a bad room does` | the same line | the same replacement |
| the `sign-in --pane ... --room Bad Room` test (its `stderr` line) | the same line | the same replacement |
| `claim and release refuse a non-id the same way ack does` | `.toContain("usage: rt chat release <messageId>")` | `.toContain("next: rt chat release <messageId>")` |
| `--as while signed in is refused with the reason` | `expect(stderr).toMatch(/signed in as x.*sign out/);` | `expect(stderr).toContain("You are signed in as x");` and, on the next line, `expect(stderr).toContain("rt chat sign-out");` |
| `sign-out --pane against an old daemon ...` | `.toContain("sign-out --pane needs a daemon that supports it")` | `.toContain("The rt daemon is too old to sign a pane out")` |
| the sign-out test that stops the server first (it asserts `expect(stderr).toContain("daemon");`) | that line | `expect(stderr.startsWith("[warning] Signed out here, but the daemon did not hear it")).toBe(true);` |

Every other failure assertion in the file (`is empty`, `no line breaks`, `<<'EOF'`, `not a message id`, `neither the holder`, `no such room`, `--status`, `--herd`, `--as`, `--name`, `--pane`, `session id`, `handle reclaimed`, `matt`) still holds under the new copy and is not edited.

- [ ] **Step 2: Run them to verify they fail**

Run (repo root): `bun test commands/__tests__/chat.test.ts -t "rt chat failures"`
Expected: FAIL. stderr still reads `rt chat: usage: rt chat join <room> ...`, and the two refusals still print as `rt chat: ...` lines with no `[refused]` tag.

- [ ] **Step 3: Replace `fail` and its helpers**

In `commands/chat.ts`, add after the `out` import:

```ts
import { usageFailure } from "../lib/ui/usage.ts";
```

Replace `refuseUnknownFlags` with:

```ts
function refuseUnknownFlags(args: string[], allowed: ReadonlySet<string>, verb: "post" | "dm", usage: string): void {
  for (const a of args) {
    if (!a.startsWith("--")) continue;
    const name = a.split("=")[0]!;
    if (!allowed.has(name)) failUsage(`rt chat ${verb} does not take ${name}`, usage);
  }
}
```

Replace `fail`, `NAME_RULE`, `requireValidName`, `requireValidSessionId` and `unwrap` (lines 157 to 177, their doc comments included; the second comment is retyped below because today's holds a long dash) with:

```ts
function fail(f: out.FailureInput): never {
  out.fail(f);
  process.exit(1);
}

function failUsage(title: string, usage: string, why?: string): never {
  out.fail(usageFailure(title, usage, why));
  process.exit(1);
}

/** A policy refusal is a `refused` note on stderr, never a failure block; it still exits 1. */
function refuse(...blocks: Block[]): never {
  out.note(...blocks);
  process.exit(1);
}

const NAME_WHY = "Names use lowercase letters, digits, dots, dashes and underscores.";
const SESSION_ID_INVALID: out.FailureInput = { title: "That session id is not valid", why: "A session id uses letters, digits, dots, dashes and underscores." };
const NO_SESSION: out.FailureInput = { title: "rt cannot tell which session this is", why: "Chat needs a session id. Claude Code sets one; anywhere else, pass --session <id>." };

/** Rejects with the reason rather than silently normalizing (Global Constraint). */
function requireValidName(kind: string, name: string): void {
  if (!isValidChatName(name)) fail({ title: `"${name}" is not a valid ${kind} name`, why: NAME_WHY });
}

/** sign-in/sign-out only. Every other verb's session-id use (resolveHandle) goes through readChatSession, which degrades an invalid id to "no session" rather than failing. */
function requireValidSessionId(id: string): void {
  if (!isValidSessionId(id)) fail(SESSION_ID_INVALID);
}

function unwrap<T>(res: RtResponse<T>, label: string): T {
  if (!res.ok || res.data === undefined) fail({ title: res.error ?? `The chat ${label} did not go through` });
  return res.data;
}
```

- [ ] **Step 4: Convert every call site**

Each entry below is one statement, under the line it replaces. The condition before it stays as it is; only the `fail(...)` call changes. (Line numbers are `5bc69f231`'s.)

```ts
// 277
failUsage(flag === "--as" ? "Which identity?" : "What name?", `rt chat sign-in ${flag} <name>`);
// 285
fail({ title: "Sign in with one of them, not both", why: "--as continues an identity you had; --name starts a fresh one." });
// 318
fail({ title: "A pane sign-in continues an identity", why: "sign-in --pane takes --as, never --name." });
// 366
refuse(out.line("refused", `You are signed in as ${sessionName(session)}`), out.callout("why", "One session keeps one identity. Leave out --as, or sign out to change it."), out.callout("next", out.cmd("rt chat sign-out")));
// 586
failUsage("Which room?", "rt chat join <room>");
// 596
fail({ title: `"${wakeOnRaw}" is not a wake setting`, why: "Use mention, all or none." });
// 613
failUsage("Which room?", "rt chat leave <room>");
// 631
failUsage("Which room?", "rt chat archive <room>");
// 667
fail({ title: "That file could not be read", why: file });
// 669
fail({ title: "That file is empty", why: file });
// 675 and 679
failUsage("What is the message?", usage);
// 722
failUsage("Which room?", POST_USAGE);
// 759
failUsage("Which message?", "rt chat ack <messageId>");
// 761 and 780
fail({ title: `"${raw}" is not a message id`, why: "A delivered message shows its id as #<id>." });
// 778
failUsage("Which message?", `rt chat ${verb} <messageId>`);
// 846
fail({ title: `"${limitRaw}" is not a number of messages`, why: "--limit takes a positive number." });
// 854
fail({ title: `"${sinceRaw}" is not a length of time`, why: "--since takes 30s, 5m, 500ms or a number of seconds." });
// 860
fail({ title: "Use --last or --since, not both" });
// 861
failUsage("Which room?", "rt chat read <room> --last <n>");
// 863
fail({ title: `"${lastRaw}" is not a number of messages`, why: "--last takes a positive whole number." });
// 945
failUsage("Which room?", "rt chat mark <room> --upto <messageId>");
// 947
fail({ title: `"${uptoRaw}" is not a message id`, why: "--upto takes a positive message id." });
// 985
failUsage("Who is it for?", DM_USAGE);
// 1012
failUsage("Which pane?", "rt chat invite <pane> --room <room>");
// 1014
failUsage("Which room?", "rt chat invite <pane> --room <room>");
// 1053, 1168, 1235 and 1249
fail(NO_SESSION);
// 1172
fail(SESSION_ID_INVALID);
// 1213
fail({ title: "The rt daemon is too old to sign a pane out", next: out.cmd("rt daemon restart") });
// 1232
failUsage("What should your status say?", "rt chat away <text>");
// 1332
failUsage("Which chat verb?", USAGE);
// 1340
fail({ title: `rt chat has no verb called ${verb}`, next: out.cmd("rt chat --help"), details: `Verbs: ${Object.keys(VERBS).join(", ")}` });
```

(The `// <line>` markers are this plan's labels and are not copied into the source.)

The call at 704 to 709 (inside `requireReadable`) becomes a refusal: the body is one rt could post, and it declines on purpose (5f ruling 6). `requireReadable` also takes the refused verb's own heredoc form, so a `dm` is not told to `post`. Replace the function (line 701; its doc comment stays) with:

```ts
function requireReadable(body: string, args: string[], heredoc: string): void {
  if (args.includes("--as-is")) return;
  if (body.length >= WALL_CHARS && !body.includes("\n")) {
    refuse(
      out.line("refused", `That message is ${body.length} characters with no line breaks`),
      out.callout("why", "A long one-line message has usually lost its paragraphs on the way in."),
      out.callout("next", out.cmd(heredoc)),
      out.callout("note", "Put the message on stdin from a heredoc so its paragraphs and lists survive.", "--as-is posts it as it is."),
    );
  }
}
```

Its two callers become `requireReadable(body, args, "rt chat post <room> <<'EOF'");` in `runPost` (line 725) and `requireReadable(body, args, "rt chat dm <handle> <<'EOF'");` in `runDm` (line 988).

The two callers of `refuseUnknownFlags` become `refuseUnknownFlags(args, POST_FLAGS, "post", POST_USAGE);` and `refuseUnknownFlags(args, DM_FLAGS, "dm", DM_USAGE);`.

In `runSignOut`, replace

```ts
    console.error(`rt chat: sign-out: daemon error (${res.error ?? "sign-out failed"}) -- local state cleaned up anyway`);
```

(the source line holds a long dash where `--` is written here) with:

```ts
    out.note(out.line("warn", "Signed out here, but the daemon did not hear it", res.error ?? "sign-out failed"));
```

It stays inside the same `if (!res.ok && !quiet)`: `--quiet` is the SessionEnd hook's flag and must print nothing.

Update the doc comment above `usage()` to `/** The --help text: blocks for a person, the one usage line for anyone else. */`.

- [ ] **Step 5: Drop the console capture from the harness**

In `commands/__tests__/chat.test.ts`, in `runChatRaw`, change `const io = captureOut({ console: true });` to `const io = captureOut();`. With the file off `console`, a stray `console.log` left behind would now vanish from the capture and fail the fixture test instead of passing unseen.

- [ ] **Step 6: Delete the allowlist line**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `"commands/chat.ts",`.

- [ ] **Step 7: Run the tests, the fixture and the guards**

Run (repo root): `bun test commands/__tests__/chat.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/picker-conformance.test.ts lib/mcp`
Expected: PASS, with `commands/__tests__/fixtures/chat-bytes.json` untouched.
Run: `grep -n "console\.\|process\.std\(out\|err\)\.write" commands/chat.ts`
Expected: no output.
Run: `grep -n "rt chat: " commands/chat.ts`
Expected: no output (the prefix is gone from every message).
Run: `grep -c "refuse(" commands/chat.ts`
Expected: `3` (the helper and its two callers; no other site declines by policy, Task 2).
Run: `bun run typecheck`
Expected: no errors.
Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/chat-inbox-delivery.test.ts e2e/tests/chat-presence-roster.test.ts`
Expected: PASS with no edit to either file. They pin `dm → b #1`, the `claimed #<id> → asker` and `already claimed` lines and the daemon's delivery frame through the real binary.

- [ ] **Step 8: Commit**

```bash
git add commands/chat.ts commands/__tests__/chat.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "chat: failures are failure blocks and policy refusals are refused notes on stderr; the file leaves the raw-output allowlist

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Renders, AGENTS.md and every gate

**Files:**
- Modify: `AGENTS.md` ("Output layer" section: append; never rewrite what is there)
- Modify: `docs/design/output-layer/README.md`
- Create under `docs/design/output-layer/`: `chat-dark.png`, `chat-light.png`

**Interfaces:**
- Consumes: every builder above; `ui/dist/rt-ui` built by `bun run ui:build`.
- Produces: the renders the PR carries.

- [ ] **Step 1: Write the render inputs**

Run: `bun run ui:build`

In the session scratchpad (not the repo), write `blocks.ts`. Replace `<repo>` with the worktree's absolute path. All sample names are invented.

```ts
// usage: bun blocks.ts > chat.ndjson
import { __test__ as chat } from "<repo>/commands/chat.ts";
import * as out from "<repo>/lib/ui/out.ts";
import { encodeLine } from "<repo>/lib/ui/protocol.ts";
import { usageFailure } from "<repo>/lib/ui/usage.ts";

const now = Date.now();
const message = (over: object) => ({ id: 1, room: "build", handle: "ana.1", name: "ana", body: "the lede\n\n- one point\n- another", mentions: [], mentionNames: [], postedAt: now - 120_000, ...over });
const buddy = (over: object) => ({ sessionId: "s", handle: "ana.1", baseHandle: "ana", name: "ana", signedInAt: now, lastSeenAt: now, status: "live", ...over });

const blocks: object[] = [
  ...chat.roomsBlocks([
    { room: "build", memberCount: 3, unread: 2, mentions: 1, lastPostedAt: now - 65_000 },
    { room: "quiet", memberCount: 1, unread: 0, mentions: 0 },
    { room: "dm-abc123", kind: "dm", participants: { a: "ana.1", b: "bo.2", aName: "ana", bName: "bo" }, memberCount: 2, unread: 1, mentions: 0, lastPostedAt: now - 7_200_000 },
  ] as never),
  ...chat.readBlocks([{ room: "build", messages: [message({}), message({ id: 2, name: "bo", body: "ok, taking the second point" })] }] as never, false, (room: string) => `#${room}`),
  ...chat.whoBlocks("#build", [
    { room: "build", handle: "ana.1", name: "ana", joinedAt: 1, lastReadId: 0, wakeOn: "mention", status: "live", cwd: "/code/sample-app", pane: "w1:p2" },
    { room: "build", handle: "bo.2", name: "bo", joinedAt: 1, lastReadId: 0, wakeOn: "mention", status: "offline" },
  ] as never),
  ...chat.buddiesBlocks([buddy({ repo: "sample-app", branch: "main", pane: "w1:p2" }), buddy({ handle: "bo.2", name: "bo", status: "idle", lastSeenAt: now - 180_000, statusText: "at lunch" }), buddy({ handle: "cy.3", name: "cy", status: "offline", signedOutAt: now - 7_200_000 })] as never),
  ...chat.signInBlocks("signed in as remy · sample-app · main · joined #sample-app (3 members)"),
  ...chat.helpBlocks(),
  out.failure(usageFailure("Which room?", "rt chat join <room>")),
  out.line("refused", "You are signed in as remy"),
  out.callout("why", "One session keeps one identity. Leave out --as, or sign out to change it."),
  out.callout("next", out.cmd("rt chat sign-out")),
  out.line("refused", "That message is 520 characters with no line breaks"),
  out.callout("why", "A long one-line message has usually lost its paragraphs on the way in."),
  out.callout("next", out.cmd("rt chat post <room> <<'EOF'")),
  out.callout("note", "Put the message on stdin from a heredoc so its paragraphs and lists survive.", "--as-is posts it as it is."),
  out.line("warn", "Signed out here, but the daemon did not hear it", "daemon unreachable"),
];
process.stdout.write(encodeLine({ t: "hello", protocol: 1 }) + blocks.map(encodeLine).join(""));
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

- [ ] **Step 2: Render two pages**

At width 100, run these five commands one at a time from the scratchpad (the light page sets `COLORFGBG=0;15`, which is how 5a's renderer learns the background is light):

```bash
bun blocks.ts > chat.ndjson
COLORTERM=truecolor TERM=xterm-256color <repo>/ui/dist/rt-ui render --width 100 < chat.ndjson > chat-dark.ansi
COLORTERM=truecolor TERM=xterm-256color COLORFGBG="0;15" <repo>/ui/dist/rt-ui render --width 100 < chat.ndjson > chat-light.ansi
bun ansi-page.ts dark chat < chat-dark.ansi > chat-dark.html
bun ansi-page.ts light chat < chat-light.ansi > chat-light.html
```

- [ ] **Step 3: Screenshot both schemes and look**

Serve the scratchpad over http on 127.0.0.1 (`python3 -m http.server 4173 --bind 127.0.0.1`; `file:` is blocked) and screenshot both pages with Fast Browser (the `fast-browser:browser-driver` agent, or the Fast Browser MCP tools directly). Save the two PNGs into `docs/design/output-layer/` under the names in this task's Files list.

Then read each PNG and write down plainly what reads wrong. Check these in particular, on both backgrounds:

- **rooms:** the `direct` label separates the DM rows without looking like a room; a room with a mention reads as waiting on you, and "nothing unread" is quiet.
- **read:** a message's name and time sit directly above its body, and the blank line inside a body survives.
- **buddies and who:** the idle and offline rows are quieter than the listening row.
- **help:** the verb column lines up.
- **failure and refusals:** the two refusals read as rt declining, in the refused color, never coral, and are visibly different from the failure above them; the refusal's `next:` and `note:` lines sit under it, and the second note line lines up with the first.
- **everywhere:** body text is the terminal's own foreground on both backgrounds; nothing is unreadably faint on light.

A fault found here is fixed in the task that owns the code, re-rendered, and named in the report. Do not declare success from the tests.

- [ ] **Step 4: Update `docs/design/output-layer/README.md`**

Add one row to its table:

```markdown
| `chat-dark.png`, `chat-light.png` | what a person sees from `rt chat`: rooms, read, who, buddies, sign-in, help, a failure, the two policy refusals and the sign-out warning. Off a terminal these verbs print their older plain text, unchanged |
```

- [ ] **Step 5: Append to `AGENTS.md`**

At the end of the "Output layer" section (after its last paragraph, before the next `##` heading), append:

```markdown
`rt chat` is read by agents as often as by a person, so its stdout off a
terminal is frozen. Every verb writes the text it always wrote through
`out.payload` (`say` in `commands/chat.ts`) and its `--json` through
`out.json`, and `commands/__tests__/fixtures/chat-bytes.json` pins the bytes;
never regenerate that fixture to make a change pass. Only `rooms`, `read`,
`who`, `buddies`, `sign-in` and `--help` draw blocks, and only when
`out.isHuman()` says a person is at the terminal (`show`). Chat failures are
ordinary `failure` blocks on stderr; where chat declines on purpose (a long
one-line message, a second identity in one session) it is a `refused` note
(`refuse`), with the same exit code.
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

Then confirm the allowlist lost exactly this plan's two lines. Run: `git diff origin/main -- lib/__tests__/raw-output-allowlist.json`
Expected: two deleted lines and nothing added: `commands/chat.ts`, `lib/chat-viewer-url.ts`. (If 5f1 merged first, its six lines are already gone on main and do not show here.)

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md docs/design/output-layer/README.md docs/design/output-layer/chat-dark.png docs/design/output-layer/chat-light.png
```

```bash
git commit -m "docs: output layer rule for chat's frozen stdout, with chat renders

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Ship

**Files:** none beyond what a rebase touches.

**Interfaces:**
- Consumes: the finished branch.
- Produces: one PR against `m4ttstack/mattstack`.

- [ ] **Step 1: Rebase and re-check what other slices added**

Run: `git fetch origin`
Run: `git rebase origin/main`

Other phases and slices may have merged, 5f1 among them. Merge by hand, per cross-phase ruling 7:

- `lib/__tests__/raw-output-allowlist.json`: keep every deletion from both sides.
- `AGENTS.md` "Output layer": keep their paragraphs, then this plan's.
- `docs/design/output-layer/README.md`: keep their rows, then this plan's.

- [ ] **Step 2: Re-run the gates after the rebase**

Run, one at a time: `bun run ui:build`, `bun run ui:test`, `bun run typecheck`, `bun run test`, `bun run test:e2e`, `bun run test:pty`, `bun run picker:check`, `bun run format:check`, `bun run check`.
Expected: all pass, with the same known noise as Task 7 Step 6. `commands/__tests__/fixtures/chat-bytes.json` must pass as committed.

- [ ] **Step 3: Measure the diff**

Run: `git diff --shortstat origin/main...HEAD`
Expected: about 1,150 changed lines (insertions plus deletions). Put the number in the report.

- [ ] **Step 4: Push**

Push the branch with the `git_push` MCP tool (it pushes one explicit refspec to the branch's same-named upstream).

- [ ] **Step 5: Open the PR**

Write the body to `<scratchpad>/pr-body-5f2.md`, then run:

`gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 5f2, chat" --body-file <scratchpad>/pr-body-5f2.md`

The body, in the style of PR 639: one framing paragraph; bold-labelled bullet groups (**chat**: stdout off a terminal frozen and pinned by a fixture, blocks for a person on five verbs and help, failures as failure blocks, the two policy refusals as refused notes; **Also**: the viewer link warning on `warn`, log only; **Follow-up**: one line, "give the daemon's policy refusals (release by a non-holder, `--as` naming a held identity or the human's handle) a code so the CLI can draw them `refused` (phase 6, with the daemon handlers)", then any item from "Decisions" below that Matt has not ruled on); the two renders; a verification line with the gate results and the fixture; and the last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 6: Report**

Report the PR url, the gate results, the flakes seen with both results, the measured diff size and what the renders showed. Do not merge: the shepherd watches CI and CodeRabbit and merges.

---

## Decisions this plan made that the scoping document and the spec do not settle

Each is the plan's best reading unless it says it was ruled; Matt or the reviewer may overrule one before execution. (Decisions on sdm, port and runs live in the 5f1 plan.)

1. **Every `rt chat` verb is agent-facing off a terminal, the five "human" ones included** (ruled, 5f ruling 1). The rt-chat skill sends an agent to `rt chat sign-in`, `rooms` and `read` in Bash after a `/clear`, so their plain text is frozen too. Those five verbs and `--help` therefore have two renderings: blocks when `out.isHuman()`, today's text otherwise. The spec's general rule (plain text off a terminal takes the new wording) is set aside for chat's stdout only.
2. **Chat's failures do take the new wording,** on stderr, exit 1 unchanged (ruled, 5f ruling 1). Scoping item 8 already counts chat's 12 usage sites for `usageFailure`, and nothing under `skills/`, `plugins/mattstack` or `apps/board/skills` quotes a chat failure. An agent that hits one reads a plain sentence and a `next` command where it read `rt chat: usage: ...`.
3. **A daemon refusal is the failure's title, in the daemon's words** (`no such room: ghost`). The daemon handlers are not this plan's, so their strings are not rewritten, and they never ride in a chat envelope (Task 2's copy section). Decision 8 names the three that are refusals by meaning.
4. **Two chat sites are policy refusals** (ruled, 5f ruling 6): the long one-line message (`:704`, a guard with an `--as-is` override) and a second identity in one session (`:366`, an ownership rule). Each is `out.note(out.line("refused", ...), callouts)` on stderr through `refuse`, exit 1 as before. The long-message refusal keeps its two-line advice as a `note` callout rather than a failure's `details`, since a refusal is a line and callouts, not a failure block. Every other `fail` site is input rt cannot act on or a daemon that said no, so it stays a failure.
5. **`readChatViewerUrlSetting` gains an optional reader argument** so its warning can be tested without corrupting a settings store. Every caller still passes nothing.
6. **The chat fixture is ASCII-escaped.** One frozen `rooms` row prints a long dash today; the fixture stores it as an escape so no file this plan writes holds the character, and the source line that prints it is not edited.
7. **The harness reads the console through phase 4's `captureOut({ console: true })`** for Tasks 4 and 5, rather than spying on `console` by hand, and drops the option in Task 6 once `commands/chat.ts` no longer prints through `console` (5f ruling 8).
8. **Three daemon refusals by policy stay failures in 5f2** (ruled, review round 1). By meaning they are rt declining, not input it cannot act on: a `release` by someone who is neither the holder nor the author (`you are neither the holder of #<id> nor its author`, `lib/daemon/handlers/chat.ts:1031`); `--as` naming an identity another session holds (`chat: handle reclaimed: "<id>" is now held by another session; sign in again`, `lib/state/presence-store.ts:261`); and `--as` naming the human's handle (`chat: may not continue "<x>": that handle speaks for the human`, thrown at `lib/state/presence-store.ts:269` from `fixedIdentityRefusal` in `lib/state/identity-store.ts:70`). `RtResponse` carries only an error string for each, no code, and the handlers are phase 6's. Telling them apart in the CLI would mean matching the daemon's wording, which this plan does not do, so each reaches `unwrap` and is a failure titled in the daemon's words, exit 1. The PR body's Follow-up names the fix: give these daemon refusals a code so the CLI can draw them `refused` (phase 6, with the daemon handlers).
9. **Frozen `read` still writes message bodies raw off a terminal.** A body's escape sequences and newlines reach an agent's output exactly as they do today, because that text is frozen (5f ruling 1). Review Focus 2 and its test cover the human path only, where the body is a `paragraph` that rt-ui and the plain renderer sanitize.

## Self-Review

**Spec coverage.** Phase 5 names "the human `chat` verbs" for this half of 5f: Tasks 4 to 6. Rule 1 (never style a payload): chat's frozen lines and every envelope go through `out.payload` and `out.json` (Task 5). Rule 3 (failures on stderr as a `failure` block): Task 6, with the two policy refusals as `refused` notes (5f ruling 6). `table` for `chat rooms`: Task 5. "Each conversion PR greps ... for text scraped from the verbs it converts": Task 2's readers table. Characterization of stdout and `--json`: Task 4's fixture, captured before any conversion. The copy pass on envelope strings (5f ruling 5): Task 2's copy section (none to reword, with the reason for each kind). Scoping items: 1 (row 42, Task 3), 8 (Task 6). Ruling 6 (chat leaves the allowlist): Task 6. Ruling 11 (a verb on rt-ui is not converted): Task 2's table. Two allowlist lines: Tasks 3 and 6, checked in Task 7 Step 6. Screenshots: Task 7. No pty test is named by the spec for these verbs, so none is added. The eight 5f rulings: 1 is decisions 1 and 2 and the Global Constraints; 2, 3 and 4 are 5f1's; 5 is Task 2's copy section; 6 is decision 4 and Task 6; 7 is the split; 8 is Task 1's note and decision 7.

**Placeholders.** None. `<repo>` and `<scratchpad>` in Tasks 7 and 8 are the implementer's own absolute paths, named as such. The fixture is captured from the unconverted code by commands this plan gives, with what it must contain.

**Type consistency.** `roomsBlocks`, `readBlocks(rooms, full, headingFor)`, `whoBlocks(heading, members)`, `buddiesBlocks`, `signInBlocks(frozen)`, `helpBlocks()`, `say`, `show(blocks, frozen)`, `fail(f)`, `failUsage(title, usage, why?)`, `refuse(...blocks)`, `requireReadable(body, args, heredoc)` and `runChatRaw`'s `{ code, stdout, stderr, rawStdout }` are spelled the same in the Interfaces blocks, the code, the tests and the render input. 5a's names (`out.note`, `warn`, `setWarningLog`, `usageFailure`) are used with the signatures its plan states.

**Review Focus.** Five lines, each pinned to a named test in Tasks 4 to 6.
