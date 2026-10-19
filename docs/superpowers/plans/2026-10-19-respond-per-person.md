# Respond per person Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The board's respond action answers one person's feedback at a time, with a round count per person.

**Architecture:** A pure function derives each MR's respondable people from its discussions during the existing snapshot enrichment. A new `respond_rounds` table records each launched response per (MR, person). The live respond state stays one row per MR, gaining `person` and `responseRound`. The client builds the menu, lane line and gate header from those fields. The respond wrapper takes `--person` and drops anyone else's threads.

**Tech Stack:** Bun, TypeScript, bun:sqlite, React (board client), bun test. Board skills are markdown under `apps/board/skills-src/`.

**Spec:** `docs/superpowers/specs/2026-10-19-respond-per-person-design.md`

## Global Constraints

- One response runs per MR at a time. A launch while one runs focuses it (existing `dedupInFlight`), whoever it was for.
- A person's round counts responses to them: 1, 2, 3. Mid-run revises are not rounds.
- The round counter shows only from round 2 on: `(round 2)`.
- Respond never joins the bulk menu: no `bulk` key on any respond item.
- Bots are excluded by `isBotUsername` plus config `botUsernames`, the same rule as `summarizeDiscussions`.
- Run every test from `apps/board` (`cd apps/board && bun test <file>`), never from the repo root.
- Run only the targeted tests for touched files locally; CI runs the full suite.
- Board skills are edited only in `apps/board/skills-src/`, then `bun run skills:expand:board` from the repo root, and `bun run skills:check:board` must pass. Load `superpowers:writing-skills` before editing any skill.
- Menu and dialog copy follows `rt:ui-copy`, all lowercase as the existing menu items are.
- Fixtures and stories use invented names only (John, Darryl, Priya). The repo is public.
- Comments only state constraints the code cannot show (clean-code comments rule).

## Review Focus

1. **A person who is both the MR author and a commenter** never appears as a target. Task 1 tests it.
2. **A reply on an Overview comment by someone other than the author** does not count as answering it. The comment stays open. Task 1 tests it.
3. **A `/respond` POST with a `person` who isn't a target** (a stale menu) is refused with 400, not launched against the whole MR. Task 4 tests it.
4. **An old respond row with no `person`** still renders its lane line and resume item, with no name and no round. Tasks 5 and 6 test it.
5. **A redo after a revise-heavy run.** Round history grows by one per launch, never by the wrapper's revise count. Task 2 tests it.

---

### Task 1: Derive respondable people from discussions

**Files:**
- Create: `apps/board/src/respond-targets.ts`
- Test: `apps/board/src/__tests__/respond-targets.test.ts`

**Interfaces:**
- Consumes: `MRDetail` from `@mattstack/glance`; `latchKindOf` from `./latch/markers.ts`; exports `isBotUsername` from `./discussions.ts`. Also export the existing `isBotAuthor` from `discussions.ts` and reuse it; don't copy it.
- Produces:
  ```ts
  export interface RespondTarget {
    username: string;
    name: string;
    /** Resolvable threads this person started that await the author. */
    openThreads: number;
    /** This person's Overview comments the author has not answered. */
    openComments: number;
  }
  export function respondTargets(
    detail: MRDetail,
    author: string | null,
    botUsernames?: string[]
  ): RespondTarget[];
  ```
  Returns only people with `openThreads + openComments > 0`, sorted by name. People with nothing open but a prior response are added by the client from `respondRounds` (Task 5).

- [ ] **Step 1: Write the failing tests.** Build `MRDetail` fixtures the way `src/__tests__/discussions.test.ts` does. One test each:
  - `counts a person's awaiting threads and open Overview comments together`: John starts 2 resolvable threads (1 awaiting, 1 resolved) and leaves 3 Overview notes. Expect `[{ username: 'john', name: 'John', openThreads: 1, openComments: 3 }]`.
  - `drops a thread whose last note is the author's`: status `replied`, so `openThreads` is 0.
  - `an Overview comment the author replied on is answered`: the author's note in the same discussion. `openComments` is 0.
  - `an Overview comment followed by a later author Overview comment is answered`: the comment is answered.
  - `a third person's reply on an Overview comment does not answer it`: `openComments` is 1.
  - `excludes the author, bots and latch threads`: the author's own notes, `review-bot` and a config-listed `Danger` name, and a latch thread (body from `latch/markers.ts`) all yield no target.
  - `omits people with nothing open`.
  - `sorts by display name`.

- [ ] **Step 2: Run, expect FAIL.** `cd apps/board && bun test src/__tests__/respond-targets.test.ts`. Expected: module not found.

- [ ] **Step 3: Implement `respondTargets`.**
  - **Threads:** reuse `summarizeDiscussions(detail, author, botUsernames).threads`, take the ones with status `awaiting`, and group them by `notes[0].username`.
  - **Overview comments:** walk `detail.discussions` with no resolvable note. Skip system, automated and bot notes. A comment is open when no later note in its discussion is the author's, and the author has no Overview note with a later `createdAt` anywhere on the MR.

- [ ] **Step 4: Run, expect PASS.** Same command.

- [ ] **Step 5: Commit.** `git add apps/board/src/respond-targets.ts apps/board/src/__tests__/respond-targets.test.ts apps/board/src/discussions.ts && git commit -m "board: derive respondable people from MR discussions"`

### Task 2: Per-person round history and person on respond state

**Files:**
- Modify: `apps/board/src/state/db.ts` (`SCHEMA_VERSION` 4 → 5, add `V5_SCHEMA` and its migration)
- Create: `apps/board/src/respond-rounds.ts`
- Modify: `apps/board/src/respond-state.ts` (`RespondState`, `writeRespondState`, `respondFreshDispatchFields`)
- Test: `apps/board/src/__tests__/respond-rounds.test.ts`, `apps/board/src/__tests__/respond-state.test.ts`, `apps/board/src/__tests__/state-db.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // V5_SCHEMA
  // CREATE TABLE IF NOT EXISTS respond_rounds (
  //   mr_url TEXT NOT NULL, person TEXT NOT NULL, round INTEGER NOT NULL,
  //   started_at INTEGER NOT NULL, PRIMARY KEY (mr_url, person, round));

  /** Records the next response round for this person and returns it (1 on the first). */
  export function recordRespondRound(mrUrl: string, person: string, now?: number, db?: Database): number;
  /** Highest recorded round per person, per MR. */
  export function readRespondRounds(db?: Database): Map<string, Record<string, number>>;
  /** Drop rounds whose MR left the board (same contract as pruneRespondStates). */
  export function pruneRespondRounds(keepUrls: ReadonlySet<string>, db?: Database): void;

  // RespondState gains:
  person?: string;        // username this run answers; absent on rows written before v5
  responseRound?: number; // this person's round for this run, from recordRespondRound
  ```
  `respondFreshDispatchFields(state, responseRound?: number): { round?: number }` returns `{ round: responseRound }` when given. Otherwise it keeps today's `state.round + 1` fallback, for a launch with no person.

- [ ] **Step 1: Write the failing tests.**
  - `respond-rounds.test.ts`:
    - `first round for a person is 1, then 2`.
    - `rounds are per person`: John 1, 2 and Darryl 1. `readRespondRounds()` gives `{ john: 2, darryl: 1 }` for the MR.
    - `prune keeps rounds for MRs still shown`.
  - `state-db.test.ts`: a v4 db migrates to v5 with `respond_rounds` present and the existing `agent_states` rows untouched.
  - `respond-state.test.ts`: `writeRespondState` round-trips `person` and `responseRound`. `respondFreshDispatchFields({ round: 4 }, 2)` is `{ round: 2 }`. `respondFreshDispatchFields({ round: 4 })` is `{ round: 5 }`.

- [ ] **Step 2: Run, expect FAIL.** `cd apps/board && bun test src/__tests__/respond-rounds.test.ts src/__tests__/respond-state.test.ts src/__tests__/state-db.test.ts`

- [ ] **Step 3: Implement.** Pattern: `review-rounds.ts` for the store and `V4_SCHEMA` for the migration. Add `person` and `responseRound` to the explicit field list in `writeRespondState`'s insert branch. Call `pruneRespondRounds` wherever `pruneRespondStates` is called in `server.ts`.

- [ ] **Step 4: Run, expect PASS.** Same command.

- [ ] **Step 5: Commit.** `git commit -m "board: record respond rounds per person (state v5)"`

### Task 3: Put targets and rounds on the snapshot

**Files:**
- Modify: `apps/board/src/data.ts` (`BoardMR`)
- Modify: `apps/board/src/server.ts` (`enrichReviewerComments`, around line 878; the `attachResponds(` chain at lines 1809 and 1910)
- Modify: `apps/board/src/client/types.ts` (`RespondInfo`)
- Test: `apps/board/src/__tests__/respond-rounds.test.ts` (attach helper)

**Interfaces:**
- Consumes: `respondTargets` (Task 1), `readRespondRounds` (Task 2).
- Produces:
  ```ts
  // BoardMR gains
  respondTargets?: RespondTarget[];             // set only when ownedHere(m)
  respondRounds?: Record<string, number>;       // username -> highest round
  // RespondInfo gains
  person?: string;
  responseRound?: number;
  // respond-rounds.ts
  export function attachRespondRounds<T extends { webUrl?: string | null }>(
    mrs: T[], rounds: Map<string, Record<string, number>>
  ): Array<T & { respondRounds?: Record<string, number> }>;
  ```

- [ ] **Step 1: Write the failing test.** `attachRespondRounds sets rounds by webUrl and leaves others untouched`.
- [ ] **Step 2: Run, expect FAIL.** `cd apps/board && bun test src/__tests__/respond-rounds.test.ts`
- [ ] **Step 3: Implement.**
  - In `enrichReviewerComments`, inside `if (ownedHere(m))`, set `m.respondTargets = respondTargets(detail, m.author.username, config.botUsernames)`.
  - Wrap `attachResponds(...)` with `attachRespondRounds(..., readRespondRounds())` at both call sites.
  - Forward `person` and `responseRound` wherever `RespondState` becomes the client's `respond`.
- [ ] **Step 4: Run, expect PASS.** Also run `cd apps/board && bun run typecheck`, expect exit 0.
- [ ] **Step 5: Commit.** `git commit -m "board: snapshot carries respond targets and per-person rounds"`

### Task 4: `/respond` launches for a person

**Files:**
- Modify: `apps/board/src/respond-state.ts` (`parseRespondRequestBody`)
- Modify: `apps/board/src/server.ts` (`/respond` handler, around lines 2480-2620)
- Modify: `apps/board/src/herdr.ts` (`SkillPromptOpts`, `dispatchArgs`, `launchRespond` opts)
- Test: `apps/board/src/__tests__/respond-state.test.ts`, `apps/board/src/__tests__/herdr.test.ts`

**Interfaces:**
- Consumes: `recordRespondRound` (Task 2), `BoardMR.respondTargets` and `BoardMR.respondRounds` (Task 3).
- Produces:
  - `parseRespondRequestBody(body): { mrUrl: string; iid: number; person?: string } | null`. A `person` that is present but not a non-empty string makes it return null.
  - `SkillPromptOpts.person?: string`, emitted by `dispatchArgs` as `--person <username>` right after `--round`.
  - Server rule. A fresh (non-resume, non-focus) launch with `person`:
    - `person` must be in `mr.respondTargets` usernames or `mr.respondRounds` keys. Otherwise respond `400` with `person "<username>" has no feedback on this MR`.
    - Then `recordRespondRound(mrUrl, person)`, write state with `person` and `responseRound`, and pass `person` plus `round: responseRound` to `launchRespond`.
  - A launch without `person` behaves as today.

- [ ] **Step 1: Write the failing tests.**
  - `parseRespondRequestBody`: accepts `person: 'john'`, omits it when absent, returns null for `person: 7` or `person: ''`.
  - `herdr.test.ts`: `respond prompt carries --person after --round` asserts the flag lines `--round 2` then `--person john`, using `FLAG_SEPARATOR` formatting like the existing `--round` test.
  - Route test, in the style of `src/__tests__/server-respond-report.test.ts`: `a person with no feedback is refused` (400 with the exact message, no launch, and no `respond_rounds` row written). `a focus on a running response records no round`.
- [ ] **Step 2: Run, expect FAIL.** `cd apps/board && bun test src/__tests__/respond-state.test.ts src/__tests__/herdr.test.ts`
- [ ] **Step 3: Implement** per the Interfaces block. Record the round only after `dedupInFlight` returns neither `focused` nor `refused`, so a focus never burns a round.
- [ ] **Step 4: Run, expect PASS.** Same command.
- [ ] **Step 5: Commit.** `git commit -m "board: /respond takes a person and records its round"`

### Task 5: Row menu, picker and redo copy

**Files:**
- Modify: `apps/board/src/client/board/format.ts` (replace `respondItemLabel`)
- Modify: `apps/board/src/client/board/row-actions.ts` (respond and resume-respond items, around lines 281-318; `ActionRequest` launch gains `person?`)
- Modify: `apps/board/src/client/board/redo-copy.ts`
- Modify: `apps/board/src/client/board/Board.tsx` (`runRowAction` and `launch`: pass `opts.pick ?? req.person` into `respondAction`'s extras as `person`)
- Modify: `apps/board/src/client/board/action-runner.ts` (`LaunchOpts.person?: string`, passed through `runOne`)
- Test: `apps/board/src/client/board/__tests__/row-actions.test.ts`, `apps/board/src/client/board/__tests__/redo-copy.test.ts`

**Interfaces:**
- Consumes: `BoardMR.respondTargets`, `BoardMR.respondRounds`, `RespondInfo.person` and `RespondInfo.responseRound` (Task 3).
- Produces:
  ```ts
  // format.ts
  export interface RespondChoice {
    username: string;
    name: string;
    nextRound: number;   // (respondRounds[username] ?? 0) + 1
    open: number;        // openThreads + openComments, 0 for a redo-only person
    hint: string;        // the picker's right-hand text
  }
  export function respondChoices(mrx: BoardMRWithReview): RespondChoice[];
  export function roundSuffix(round: number): string; // '' when round < 2, else ' (round N)'
  export function respondChoiceLabel(c: RespondChoice): string;
  // ActionRequest launch: { kind: 'launch'; flow: LaunchFlow; intent?: 'focus'; person?: string }
  // redoCopy(lane, count, prior, who?: { name: string; round: number })
  ```
  `respondChoices` lists every target with something open, plus every `respondRounds` person with nothing open (the redo case). Sorted by name.

  Exact copy:

  | Case | Text |
  |---|---|
  | Item label, open, round 1 | `respond to John` |
  | Item label, open, round N ≥ 2 | `respond to John (round N)` |
  | Item label, nothing open | `redo response to John (round N)`, carries `redo: 'respond'` |
  | Several choices | item `respond to…` with `pick: { title: 'respond to', aria: 'respond', options }`, one option per choice: `value` = username, `label` = name, `hint` = choice hint |
  | Picker hint, open, round 1 | `3 threads · 2 comments`, `1 thread`, `2 comments` (each part dropped when 0) |
  | Picker hint, open, round ≥ 2 | `round N · ` + the above |
  | Picker hint, nothing open | `round N · nothing open · redo` |
  | Response running or queued | `focus response to Darryl`, plus `roundSuffix(responseRound)` |
  | Resume item | `resume response to Darryl` plus suffix, using `respond.person` and `respond.responseRound` |
  | No choices and no respond state | no respond item |
  | Legacy state with no `person` | `focus response`, `resume response`, as today |
  | Redo confirm title | `Redo response to John?` |
  | Redo confirm body | `John has nothing open.`, then `This starts round N anyway.` |
  | Redo confirm button | `Redo response to John` |

  Clicking a several-choices option whose person has nothing open goes through the redo confirm too.

- [ ] **Step 1: Write the failing tests** in `row-actions.test.ts`, one per table row except the confirm. Assert `label`, `pick.options`, `redo`, `request.person`, and that no respond item carries `bulk`. In `redo-copy.test.ts`, assert the three confirm strings for `who = { name: 'John', round: 3 }` and that the no-`who` output is unchanged.
- [ ] **Step 2: Run, expect FAIL.** `cd apps/board && bun test src/client/board/__tests__/row-actions.test.ts src/client/board/__tests__/redo-copy.test.ts`
- [ ] **Step 3: Implement** per the Interfaces block. Delete `respondItemLabel` once nothing calls it.
- [ ] **Step 4: Run, expect PASS.** Same command, plus `bun run typecheck`.
- [ ] **Step 5: Commit.** `git commit -m "board: respond menu names the person, with a picker and per-person rounds"`

### Task 6: Lane line and gate header name the person

**Files:**
- Modify: `apps/board/src/client/board/row-status.ts` (`respondLine`, `respondDoneLine`)
- Modify: `apps/board/src/client/board/RespondGateHeader.tsx` (`headerMeta`, `RespondCtxFacts`, and their callers in `RespondSheet.tsx`)
- Test: `apps/board/src/client/board/__tests__/row-status.test.ts`, `apps/board/src/client/board/__tests__/respond-header-dom.test.tsx`

**Interfaces:**
- Consumes: `roundSuffix` (Task 5), `RespondInfo.person` and `RespondInfo.responseRound`, `BoardMR.respondTargets`.
- Produces:
  - `who` = the target's name for `respond.person` (falling back to the username), plus `roundSuffix(responseRound)`.
  - **In flight:** the word becomes `responding to ${who}`. The detail becomes the phase (`triaging`, `implementing`, `drafting replies`), then ` · ${message}` when a message exists. Queued: `response to ${who} queued`.
  - **Done or error:** words unchanged; detail prefixed `${who} · `.
  - **The "reviewer came back" check:** uses that person's target `openThreads + openComments > held`, not the MR-wide `threadSummary.awaiting`. Its verb label becomes `respond to ${name}${roundSuffix(next)}` and carries `person`.
  - **No `person`:** every line stays byte-identical to today.
  - **Gate header:** `headerMeta(ctx, responseRound?: number): string[]`. Given `responseRound`, it emits `round N` only when N ≥ 2, plus `revise M` when `ctx.round - responseRound > 0`. Without it, today's output is unchanged.

- [ ] **Step 1: Write the failing tests.**
  - Row status: `in-flight line names the person and round` (`responding to John (round 2)`, detail `triaging`). `done line prefixes who`. `came back counts only that person`: Darryl has 2 open and held is 0, so the respond-again verb reads `respond to Darryl (round 2)`. `legacy row unchanged`.
  - Header: `headerMeta(ctx{round:4}, 2)` is `['round 2', 'revise 2', adjudication]`. `headerMeta(ctx{round:1}, 1)` is `[adjudication]`. The existing two tests stay green.
- [ ] **Step 2: Run, expect FAIL.** `cd apps/board && bun test src/client/board/__tests__/row-status.test.ts src/client/board/__tests__/respond-header-dom.test.tsx`
- [ ] **Step 3: Implement.** The gate sheet finds the MR's `respond.responseRound` through the subject's MR, which `RespondSheet` already joins.
- [ ] **Step 4: Run, expect PASS.** Same command.
- [ ] **Step 5: Commit.** `git commit -m "board: lane line and gate header name the person"`

### Task 7: The respond wrapper takes `--person`

**Files:**
- Modify: `apps/board/skills-src/respond/SKILL.md` (flag table; the slot metadata `mr-respond@2` → `mr-respond@3`, adding the person as an input; Triage summary)
- Modify: `apps/board/skills-src/respond/triage.md` (Delegate adjudication; Adjudicate each unresolved thread; a backstop step before "Write the verdict table")
- Modify: `apps/board/skills-src/respond/launch.md` (only where it lists which launch flags survive a resume, line ~199: add `--person`)
- Regenerate: `apps/board/skills/respond/**` via `bun run skills:expand:board`
- Test: `bun run skills:check:board`; `apps/board/src/__tests__/skills-resolve.test.ts` if it pins the slot string

**Interfaces:**
- Consumes: the `--person <username>` flag from Task 4.
- Produces, in the wrapper:
  - **Flag table row:** `--person <username>`. The one person whose feedback this run answers: the resolvable threads they started and their Overview comments. Absent means every unresolved human thread (a pane launched by an older board).
  - **Delegate adjudication:** a fifth item tells the domain skill the person.
  - **Generic path:** keep only unresolved threads whose first note is the person's, plus the person's unanswered Overview-comment discussions (`resolvable: false` in `mr_threads`). A reply on an Overview comment goes through `mr_reply_thread` on that discussion id.
  - **Backstop**, a new box between "Domain adjudication result?" and the zero-threads check: with `--person`, drop verdict rows whose thread's first note is not the person's, and say which rows were dropped in the pane.
  - The "Unresolved human threads = 0?" done message, when `--person` is given: `done "no open feedback from <person>" --posted 0 --threads 0`.

- [ ] **Step 1: Load `superpowers:writing-skills` and run its RED baseline.** Record how the current wrapper treats a launch carrying `--person john` on an MR with John's and Darryl's threads (expected RED: it adjudicates both).
- [ ] **Step 2: Edit `skills-src/respond/*`** per the Interfaces block. Add the backstop box and its edges to the triage graph the way `mattstack:process-digraphs` describes.
- [ ] **Step 3: Regenerate and check.** From the repo root: `bun run skills:expand:board && bun run skills:check:board`. Expected: exit 0, no drift, no strict mcp lint hits.
- [ ] **Step 4: GREEN.** Rerun the Step 1 scenario. Expected: only John's threads are adjudicated, and Darryl's would be named as dropped if a domain skill returned them.
- [ ] **Step 5: Commit.** `git add apps/board/skills-src/respond apps/board/skills/respond && git commit -m "board:respond: answer one person's feedback with --person"`

### Task 8: Stories, captures, the mock and a visual check

**Files:**
- Modify: the row-menu stories next to `ActionMenu.tsx` / `RowMenu.tsx` (whichever already holds row-menu variants), and `gate-gallery.fixtures.ts` for a respond-plan gate with `responseRound: 2` and a revise
- Modify: `apps/board/tests/baselines/**` only if `capture:compare` shows an intended change
- Add: `docs/apps/design/board/board.pen` (frame B13), copied from the shared checkout after Matt saves it in pen.dev

- [ ] **Step 1: Add stories** with invented names: one person; several people with the picker open; nothing open (redo); running (focus); a legacy row with no person.
- [ ] **Step 2: Run `cd apps/board && bun run capture:compare`.** Regenerate baselines with `bun run capture:baseline` only for diffs this plan intends, and list them in the commit message.
- [ ] **Step 3: Render in Fast Browser.** Run Storybook (`bun run storybook` from the repo root, port 6006) and open the new stories. Screenshot each in light and dark. Check against B13 by eye, including widths below 720px, and write down anything that reads wrong.
- [ ] **Step 4: Copy the saved `board.pen`** from `~/Documents/GitHub/repo-tools/docs/apps/design/board/board.pen` into this tree, after checking B13 is in the file on disk.
- [ ] **Step 5: Commit.** `git commit -m "board: respond-per-person stories, captures and B13 mock"`

## Follow-up outside this plan

- The claimview pack's respond binding moves to `mr-respond@3` in its own repo, with no mattstack ticket ids. Until then the wrapper's backstop keeps its replies to the person.
