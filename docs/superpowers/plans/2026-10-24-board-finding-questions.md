> Superseded by [the review finding question design](../specs/2026-10-27-review-finding-question-design.md): the question now runs in the reviewer's own pane, with no separate question agent.

# Ask a Question About a Review Finding: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every finding in a board review gate gets an "Ask a question" button that opens a read-only questions agent in Flock. A finding the conversation changes goes back through the review agent, which rebuilds the gate.

**Architecture:**
- **The board** launches a `/board:question` pane per finding into a new `questions` herdr workspace and tracks it in its own sqlite table. It keeps the sheet's in-progress ticks and edits server-side, and joins stored revisions onto the sheet's cards.
- **The send-back** is a status-bin verb. It writes the revision beside the report and closes the review gate with a new `revised` close reason.
- **The review wrapper** treats `closed (revised)` as "rewrite this finding and open a fresh gate".

**Tech Stack:**
- Bun and TypeScript
- `bun:sqlite` (the board's `state.db`)
- React with the board's own `tui-*` CSS (not Mantine)
- herdr through the rt daemon (`agent:start`)
- Claude Code skills (Markdown, expanded by `rt skills expand`)

**Spec:** `docs/superpowers/specs/2026-10-23-board-finding-questions-design.md`. Mockups: `docs/apps/design/board/board.pen`, frames **B23** and **B23b**.

## Global Constraints

- Workspace setting key: `board.workspaces.questions`, default `"questions"`.
- Tab label: `Q <findingId> !<iid> <author>`, or `Q <findingId> !<iid>` with no author (`mrTabLabel(iid, author, \`Q ${findingId}\`)`).
- New gate close reason: exactly `revised`.
- Revision handoff file: `<report stem>.revision.json`, beside the report json. The stem is `reviewReportPath(handle)` with `.md` stripped.
- Report freshness: lowercase hex sha-256 of the report json's bytes.
- The questions agent is read-only, enforced by its skill. sdm connections use `*-read-only` resources; prod only when the user asks for prod.
- A pending revision older than 15 minutes with no open review gate on its MR counts as failed (`PENDING_REVISION_TTL_MS = 15 * 60_000`).
- The Ask button shows only on a gate whose MR has a report json containing that finding id, and only on this round's findings (the `findings` question). Never on `skipped-N` or `thread-N`.
- Revised-card strip copy: `Revised from your question in Q <id> · <old tier> → <new tier> · lines <a–b> → <c–d> · finding reworded`. Include only the parts that changed; the strip is amber (the warn hue) and the card gets an amber border.
- Board skills are edited only in `apps/board/skills-src/`; run `bun run skills:expand:board` and commit `apps/board/skills/`.
- Any change under `plugins/mattstack` bumps `plugins/mattstack/.claude-plugin/plugin.json`'s version.
- After touching `packages/rt-client/src`, run `bun run build` in `packages/rt-client`.
- Run `bun test` from the repo root only. Never run a built binary or start a daemon outside an isolated HOME.

## Review Focus

1. **Two questions on one MR send back seconds apart.** The second is refused with "the review is being rebuilt; send again once it reopens", never a second close. *(Task 5)*
2. **The review agent dies after a `revised` close and never reopens the gate.** The pending revision must not block send-backs forever: it expires after `PENDING_REVISION_TTL_MS`, and the sheet stops showing "rebuilding". *(Tasks 5 and 6)*
3. **The user submits the review while a question agent is mid send-back.** `gateClose` fails `already-answered`, and the verb says the review was already submitted, with no revision row left behind. *(Task 5)*
4. **A finding id or author with spaces, slashes or quotes.** The handle slug and tab label stay safe and distinct per finding. *(Task 4)*
5. **A review with no report json (generic path or tier fallback).** No button renders, and `POST /question` refuses with 409. *(Tasks 4 and 8)*

---

### Task 1: `revised` gate close reason (rt daemon and rt-client)

**Files:**
- Modify: `packages/rt-client/src/commands.ts:1160` (`gate:close` payload reason union)
- Modify: `lib/daemon/handlers/gate.ts:695-711` (the reason check)
- Modify: `lib/daemon/gates-store.ts:64,126` (`close()` reason param and the `closedReason` type)
- Modify: `lib/daemon/gate-push.ts:79-83` (`GATE_CLOSED_PHRASE`)
- Modify: `apps/board/src/gates/sweep.ts` (`PruneOffBoardGatesIo.gateClose` reason union, to keep types aligned)
- Test: `lib/daemon/__tests__/gates-handlers.test.ts`, `lib/daemon/__tests__/gate-push.test.ts`

**Interfaces:**
- Produces: `gate:close` accepts `reason: "abandoned" | "superseded" | "pruned" | "revised"`. A closed row's `closedReason` may be `"revised"`. `gate wait` on that gate reports `closed (revised)` through the existing path.

- [ ] **Step 1: Write the failing tests**

```ts
// gates-handlers.test.ts
test('gate:close accepts reason revised and records it', async () => {
  // open a gate (existing helper in this file), then:
  const res = await handlers['gate:close']({ id, reason: 'revised' });
  expect(res.ok).toBe(true);
  expect(store.get(id)!.closedReason).toBe('revised');
});
test('gate:close still rejects an unknown reason', async () => {
  expect(await handlers['gate:close']({ id, reason: 'bogus' })).toEqual({ ok: false, error: 'invalid reason' });
});

// gate-push.test.ts
test('a revised close has its own doorbell wording', () => {
  expect(GATE_CLOSED_PHRASE('g1', 'revised')).toBe(
    '[gate] g1 closed for a revised finding from the board; re-read the registry and proceed.'
  );
});
```

- [ ] **Step 2: Run them and confirm they fail.** `bun test lib/daemon/__tests__/gates-handlers.test.ts lib/daemon/__tests__/gate-push.test.ts`. Expected: the revised cases FAIL.
- [ ] **Step 3: Widen the union in the four places listed, and add the `revised` branch to `GATE_CLOSED_PHRASE`.** The sqlite column is TEXT, so no migration is needed.
- [ ] **Step 4: Rebuild rt-client and run the tests.** Run `bun run build` in `packages/rt-client`, then the two test files above plus `packages/rt-client/test/dist-freshness.test.ts`. Expected: PASS.
- [ ] **Step 5: Run the gate e2e.** `bun run test:e2e` (at least `lib/daemon/__tests__/gates-e2e.test.ts` under the e2e preload if it lives there). Expected: PASS.
- [ ] **Step 6: Commit.** `gate: closing a gate for a revised finding (revised close reason)`

---

### Task 2: `questions` workspace setting

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts:602-608` (default gains `questions: "questions"`; description names question panes)
- Modify: `packages/rt-client/src/settings/registry-schemas.ts:281` (`questions: z.string().optional()`)
- Modify: `packages/rt-client/src/settings/__tests__/schema-examples.ts:325` (add `questions` to the `good` example)
- Modify: `apps/board/src/config.ts`: the `questionsWorkspace: string` field beside `doctorsWorkspace` (:217), validation (:324-345), default `cfg.questionsWorkspace ?? 'questions'` (:386), mapping `questionsWorkspace: workspaces.questions` (:756)
- Test: `apps/board/src/__tests__/registry-defaults.test.ts:28`, `apps/board/src/__tests__/config-store.test.ts:112-139,213`

**Interfaces:**
- Produces: `BoardConfig.questionsWorkspace: string`

- [ ] **Step 1: Write the failing tests.** In `registry-defaults.test.ts`, expect `def('board.workspaces')` to equal `{ reviews: 'reviews', responds: 'responses', doctors: 'doctors', questions: 'questions' }`. In `config-store.test.ts`, expect `cfg.questionsWorkspace` to be `'questions'` by default, and to be `'q'` when the store sets `board.workspaces: { questions: 'q' }`.
- [ ] **Step 2: Run them and confirm they fail.** `bun run board:test`, filtered to those files. Expected: FAIL.
- [ ] **Step 3: Implement the listed changes, then run `bun run build` in `packages/rt-client`.**
- [ ] **Step 4: Run the tests.** The board tests above plus `bun test packages/rt-client/src/settings`. Expected: PASS.
- [ ] **Step 5: Commit.** `board: questions workspace setting`

---

### Task 3: Board state for questions, revisions and sheet drafts

**Files:**
- Modify: `apps/board/src/state/db.ts`: `SCHEMA_VERSION = 6`, a `V6_SCHEMA`, and a sixth migration
- Create: `apps/board/src/question-state.ts`
- Test: `apps/board/src/__tests__/state-db.test.ts`, `apps/board/src/__tests__/question-state.test.ts`

**V6 schema** (exact):

```sql
CREATE TABLE IF NOT EXISTS question_states (
  mr_url     TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  handle     TEXT NOT NULL,
  state      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (mr_url, finding_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_question_states_handle ON question_states(handle);
CREATE TABLE IF NOT EXISTS finding_revisions (
  mr_url        TEXT NOT NULL,
  finding_id    TEXT NOT NULL,
  original      TEXT NOT NULL,
  revised       TEXT,
  status        TEXT NOT NULL,
  closed_gate   TEXT NOT NULL,
  new_gate      TEXT,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (mr_url, finding_id, created_at)
);
CREATE TABLE IF NOT EXISTS review_sheet_drafts (
  mr_url     TEXT PRIMARY KEY,
  draft      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

`revised` is NULL for a drop. `status` is one of `pending`, `applied` or `failed`.

**Interfaces (produced, all in `question-state.ts`, each taking `db: Database = getStateDb()` last):**
- `type QuestionStatus = 'queued' | 'live' | 'done' | 'error'`
- `interface QuestionState { mrUrl: string; iid: number; findingId: string; gateId: string; status: QuestionStatus; agentId?: string; paneId?: string; tabId?: string; workspaceId?: string; message?: string }`
- `questionHandle(mrUrl: string, findingId: string, root?: string): string`. Returns `join(root, 'state', 'questions', \`${slug(mrUrl)}--${slug(findingId)}.json\`)`, reusing `agent-states.ts`'s slug (export it).
- `writeQuestionState(mrUrl: string, findingId: string, patch: Partial<QuestionState>, now?: number): void`: an upsert that merges into the JSON `state`.
- `writeQuestionStateByHandle(handle: string, patch: Partial<QuestionState>, now?: number): boolean`. Returns false when there is no row.
- `readQuestionStates(): Map<string, Map<string, QuestionState>>`, keyed by mrUrl, then findingId.
- `liveQuestionMrs(): Set<string>`: MRs with a row whose status is `queued` or `live`.
- `deleteQuestionStates(mrUrl: string): QuestionState[]`. Returns the deleted rows so the caller can close their tabs.
- `questionAgentIds(): Set<string>`: the `agentId` of every question row.
- `markQuestionsGone(agentIds: ReadonlySet<string>, now?: number): number`: a `queued` or `live` row whose `agentId` is in the set becomes `done`. Returns the count.
- `interface FindingRevision { mrUrl: string; findingId: string; original: unknown; revised: unknown | null; status: 'pending' | 'applied' | 'failed'; closedGate: string; newGate?: string; createdAt: number }`
- `insertPendingRevision(r: Omit<FindingRevision, 'status' | 'newGate'>): void`
- `pendingRevision(mrUrl: string, now: number): FindingRevision | undefined`: the newest `pending` row younger than `PENDING_REVISION_TTL_MS`.
- `markRevisionsApplied(mrUrl: string, newGate: string): void`: every `pending` row on the MR becomes `applied` with `new_gate`.
- `expireStaleRevisions(now: number): number`: `pending` rows older than the TTL become `failed`. Returns the count.
- `latestRevisions(mrUrl: string): Map<string, FindingRevision>`: the newest `applied` row per finding.
- `deleteRevisions(mrUrl: string): void`
- `PENDING_REVISION_TTL_MS = 15 * 60_000`
- `interface SheetDraft { ticked: string[]; texts: Record<string, string>; outcome?: string; notes: Record<string, string> }`
- `readSheetDraft(mrUrl: string): SheetDraft | undefined`, `writeSheetDraft(mrUrl: string, d: SheetDraft, now?: number): void`, `deleteSheetDraft(mrUrl: string): void`

- [ ] **Step 1: Write the failing tests.**
  - In `state-db.test.ts`: `'v6 adds question_states, finding_revisions and review_sheet_drafts, and a v5 db upgrades in place with its rows intact'`, modelled on the v5 test at :138.
  - In `question-state.test.ts`, on a tmp db from `openStateDb`:
    - two findings on one MR keep two rows, and two distinct handles;
    - `questionHandle('https://g/x/-/merge_requests/1', 'f 1/x')` contains no `/` after `questions/`, and differs from the handle for `'f-1-x'`'s row only if their slugs differ. Assert `questionHandle(u, 'f1') !== questionHandle(u, 'f2')`;
    - `liveQuestionMrs` includes only queued and live rows;
    - `pendingRevision` returns undefined once `now - createdAt >= PENDING_REVISION_TTL_MS`;
    - `expireStaleRevisions` flips exactly those rows to `failed`;
    - `markRevisionsApplied` sets `new_gate`, and `latestRevisions` returns it;
    - a sheet draft round-trips, and `deleteSheetDraft` removes it.
- [ ] **Step 2: Run them and confirm they fail.** `bun run board:test`. Expected: FAIL.
- [ ] **Step 3: Implement the migration and `question-state.ts`.** Follow `respond-rounds.ts` and `agent-states.ts` idioms (prepared queries, `db.transaction`).
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `board: state for finding questions, revisions and sheet drafts`

---

### Task 4: Launch a question pane (`POST /question`)

**Files:**
- Modify: `apps/board/src/herdr.ts`: `questionPrompt` fields on `SkillPromptOpts` and `launchQuestion`
- Create: `apps/board/src/question-launch.ts`: the route's logic behind an io seam
- Modify: `apps/board/src/server.ts`: `case '/question'`, a thin shell like `/doctor` (:2850)
- Test: `apps/board/src/__tests__/herdr.test.ts`, `apps/board/src/__tests__/question-launch.test.ts`

**Interfaces:**
- Consumes: Task 2's `config.questionsWorkspace`. Task 3's `questionHandle`, `readQuestionStates` and `writeQuestionState`.
- Produces:
  - `SkillPromptOpts` gains `findingId?: string`, `gateId?: string` and `reportJsonPath?: string`. `dispatchArgs` emits `--finding <id>`, `--gate <id>` and `--report-json <path>` after `--report`, only when set. The existing prompts stay byte-identical.
  - `launchQuestion(opts: LaunchPaneOpts & { findingId: string; gateId: string; reportJsonPath: string }, io?: AgentIo): Promise<AgentLaunchResult>`. It runs wrapper `board:question` with `--state <questionHandle>` and `--status-bin`, `skill` unset, tab `mrTabLabel(iid, author, \`Q ${findingId}\`)`, and subject `mr:<url>`.
  - `QUESTION_IN_FLIGHT: ReadonlySet<string> = new Set(['queued', 'live'])` in `launch-dedup.ts`.
  - `handleQuestionLaunch(body: unknown, io: QuestionLaunchIo): Promise<{ status: number; body: string | object }>`. `QuestionLaunchIo` holds `findMr(mrUrl)`, `readReportJson(mrUrl): string | null` (`readReviewReportJson`), `reportJsonPath(mrUrl): string`, `config`, `readQuestion(mrUrl, findingId)`, `writeQuestion(...)`, `launch: typeof launchQuestion`, `focusPane`, `resolveRepo(mr)`, `agentSettings()`, and `pack(boardTabId)`.

**Behaviour of `handleQuestionLaunch`** (each line is a test):
- Body `{ mrUrl: string, iid: number, gateId: string, findingId: string, focus?: boolean, boardTabId?: string }`. Anything else returns 400 `expected { mrUrl, iid, gateId, findingId }`.
- Unknown MR returns 400. No `reviewCwd` returns 400 `reviewCwd not configured`.
- No report json, or report json without that finding id in `findings`, returns 409 `this review has no findings report to ask about`.
- An existing row in `QUESTION_IN_FLIGHT` with a tab is focused through `dedupInFlight` and returns `{ ok: true, focused: true }`. `focus: true` with nothing live returns 409.
- Otherwise:
  1. Write `{ status: 'queued', iid, gateId }`.
  2. Launch with `workspaceLabel: config.questionsWorkspace` and `cwd: config.reviewCwd`. Don't await it; the route returns `{ ok: true }` first.
  3. When the launch resolves (not `focusedExisting`), write `{ status: 'live', agentId, paneId, tabId, workspaceId }`, then `focusPane({ paneId, tabId })` so Flock comes forward.
  4. If the launch rejects, write `{ status: 'error', message: launchErrorMessage('question', err) }`. Add `'question'` to `launch-error.ts`'s union.

- [ ] **Step 1: Write the failing tests.**
  - In `herdr.test.ts`: `launchQuestion` sends `workspace: 'questions'`, `tab: 'Q f2 !812 Joel'`, and a prompt starting with `/board:question https://…` containing `--finding f2`, `--gate g1`, `--report-json /…/x.json` and `--state …/questions/…--f2.json`.
  - Also in `herdr.test.ts`: `reviewPrompt` output for an existing fixture is unchanged (snapshot of the current string).
  - In `question-launch.test.ts`: one test per behaviour line above, with a fake io. Include an author `"O'Brien / QA"` and a finding id `f 1` (tab `Q f 1 !812 O'Brien / QA`, handle without spaces or extra slashes).
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.** The `server.ts` case does the method, local and JSON-body checks like `/doctor`, calls `handleQuestionLaunch` with real io, and maps the result to a `Response`.
- [ ] **Step 4: Run the tests.** `bun run board:test` and `bun run board:typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `board: launch a questions pane per review finding`

---

### Task 5: `question` status-bin verb and the send-back

**Files:**
- Create: `apps/board/bin/question.ts`
- Create: `apps/board/src/question-send-back.ts`
- Modify: `apps/board/src/subcommands.ts` (`question: () => import('../bin/question.ts')`)
- Test: `apps/board/src/__tests__/question-send-back.test.ts`, `apps/board/src/__tests__/status-bin.test.ts` (verb registered)

**Interfaces:**
- Consumes: Task 1's `revised` reason. Task 3's `writeQuestionStateByHandle`, `pendingRevision`, `insertPendingRevision` and `readQuestionStates`.
- Produces the CLI:
  - `<status-bin> question status <state> <live|done|error> [message]`. Writes the row by handle. Exit 2 on an unknown handle or status.
  - `<status-bin> question send-back <state> --revision <file> --report-sha <hex>`. Prints one line and exits 0 on success. On refusal it prints the refusal line to stderr and exits 3, so the skill can tell refusal from failure.
- Produces `sendBack(input: { handle: string; revision: RevisionInput; reportSha: string; now: number }, io: SendBackIo): Promise<SendBackResult>`, where:
  - `RevisionInput = { finding: ReportFinding } | { drop: true }`, and `ReportFinding` is the report json finding shape (`id`, `tier`, `kind?`, `title`, `body`, `fix?`, `file?`, `line?`, `fileLabel?`, `evidence?`, `comment`).
  - `SendBackIo` holds `question(handle)`, `reportJsonPath(mrUrl)`, `readFile(path): string | null`, `writeFile(path, text)`, `openReviewGate(mrUrl): Promise<GateRow | 'parked' | null>` (through `gateList({ subject: \`mr:${mrUrl}\`, kind: 'review-post' })`), `gateClose`, `pendingRevision` and `insertPendingRevision`.
  - `SendBackResult = { kind: 'sent' } | { kind: 'refused'; message: string }`

**Refusals** (exact messages, each a test):

| Condition | Message |
|---|---|
| No question row | `this question is no longer tracked by the board` |
| The revision's `finding.id` is not the row's `findingId` | `the revision must keep finding id <id>` |
| No open review-post gate, gate parked | `the review is parked; resume it from the board, then send again` |
| No open review-post gate, otherwise | `the review was already submitted or closed` |
| Gate's `findings-N` options lack the finding id | `this finding is no longer in the review` |
| `pendingRevision(mrUrl, now)` exists | `the review is being rebuilt; send again once it reopens` |
| sha-256 of the report json ≠ `reportSha` | `the review report changed since you read it; re-read it and check the revision still holds` |
| `gateClose` returns `already-answered` | `the review was already submitted or closed`, and no revision row is left |

**On success:**
1. Write `<report stem>.revision.json` as `{ findingId, revised: ReportFinding | null, original: ReportFinding }`, with `original` taken from the current report json.
2. `insertPendingRevision({ ..., closedGate: gate.id })`.
3. `gateClose({ id: gate.id, reason: 'revised' })`.

If the close fails, delete the revision row and the file before refusing.

- [ ] **Step 1: Write the failing tests.** One per refusal row, plus `sent` (file written with `revised` and `original`, row pending, close called with `revised`), plus a drop (`revised: null`). Also a `status-bin.test.ts` case: `SUBCOMMANDS` includes `question`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement `question-send-back.ts`, then `bin/question.ts`.** The bin follows `bin/doctor-status.ts`: it parses argv, opens the db from the handle's root (`dbPathForRoot`), and wires real io with `gateList` and `gateClose` from `@mattstack/rt-client`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `board: question status and send-back verbs`

---

### Task 6: Board reactions: rebuilt gate, submit, parking, expiry, client data

**Files:**
- Modify: `apps/board/src/server.ts`: the relay handler (:5202-5224), `planSweep`'s caller (:5098), the periodic sweep, and `/data.json` (:2081)
- Create: `apps/board/src/question-lifecycle.ts` (pure decisions)
- Modify: `apps/board/src/gates/sweep.ts`: `GateSweepStates` gains `questionMrs: ReadonlySet<string>`; `planSweep` skips `park` for a review-domain row whose MR is in it
- Modify: `apps/board/src/client/types.ts`: `BoardMRWithReview.questions?: QuestionInfo`
- Test: `apps/board/src/__tests__/gates-sweep.test.ts`, `apps/board/src/__tests__/question-lifecycle.test.ts`

**Interfaces:**
- Consumes: Task 3's store functions.
- Produces:
  - `interface QuestionInfo { live: Record<string, { paneId?: string; tabId?: string; status: 'queued' | 'live' }>; revised: Record<string, { original: ReportFinding; revised: ReportFinding | null }>; rebuilding: boolean }`
  - `questionInfoFor(mrUrl: string, now: number): QuestionInfo | undefined`. Undefined when the MR has no rows of any kind.
  - `onReviewGateEvent(frame: GateEventFrame, io: LifecycleIo): Promise<void>`:
    - `gate/opened/*`, kind `review-post`, with a pending revision on that MR: `markRevisionsApplied(mrUrl, newGateId)`.
    - `gate/answered/*`, kind `review-post` (a real verdict): close every question tab for the MR (`closeTab`), `deleteQuestionStates`, `deleteSheetDraft`, `deleteRevisions`.
  - The same cleanup runs when the MR's review row reaches `done`, and from the prune that already drops off-board review state.
  - `withoutQuestionExecutors(executors: ExecutorView[], questionAgents: ReadonlySet<string>): { executors: ExecutorView[]; goneQuestionAgents: Set<string> }`. Question panes carry the MR's `mr:` subject, so without this a closed question tab would attach to the MR row as an interrupted lane. The server passes the filtered list to `joinExecutorOrphans` (`server.ts:1177`) and calls `markQuestionsGone(goneQuestionAgents)`. A dead question tab then stops holding off parking.

- [ ] **Step 1: Write the failing tests.**
  - `gates-sweep.test.ts`: `'an open review gate whose MR has a live question is not parked'` and `'it parks again once no question is live'`.
  - `question-lifecycle.test.ts`:
    - an opened review-post marks the pending revision applied with the new gate id;
    - an answered review-post closes both question tabs on that MR and clears rows, sheet draft and revisions;
    - an answered respond-post on the same MR touches nothing;
    - `questionInfoFor` reports `rebuilding: true` while a revision is pending and `false` once it is older than the TTL;
    - `withoutQuestionExecutors` removes a `gone` executor whose agentId is a question pane's, reports it in `goneQuestionAgents`, and leaves a review lane's executor on the same `mr:` subject in place;
    - after `markQuestionsGone`, `liveQuestionMrs()` no longer holds that MR.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Wire it up.**
  - Call `onReviewGateEvent` in the relay handler under `writer`, next to `handleAnsweredEvent`.
  - Run `expireStaleRevisions(Date.now())` in the periodic sweep.
  - Pass `liveQuestionMrs()` into `planSweep`.
  - Attach `questions: questionInfoFor(...)` per MR in `/data.json`, the way `attachRespondRounds` attaches.
- [ ] **Step 4: Run the tests.** `bun run board:test` and `bun run board:typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `board: question lifecycle around the review gate`

---

### Task 7: Keep the sheet's ticks and edits across a rebuild

**Files:**
- Modify: `apps/board/src/server.ts`: `case '/review/sheet-draft'` (GET `?mr=`, PUT JSON `{ mrUrl, draft }`, local-only like the others)
- Create: `apps/board/src/client/board/sheet-draft.ts`
- Modify: `apps/board/src/client/board/ReviewGateSheet.tsx`
- Test: `apps/board/src/client/board/__tests__/sheet-draft.test.ts`, plus a DOM test beside the existing review sheet DOM tests (`apps/board/src/client/board/__tests__/`)

**Interfaces:**
- Consumes: Task 3's `SheetDraft`, `readSheetDraft` and `writeSheetDraft`. Task 6's `QuestionInfo.revised`.
- Produces, in `sheet-draft.ts`:
  - `snapshotSheet(form: Pick<GateFormState, 'selections' | 'texts' | 'notes'>, names: { findings?: string; outcome?: string }): SheetDraft`. `ticked` is the union of every `findings-N` selection (or the collapsed `findings` name the sheet uses), and `texts` holds only `comment:<id>` and `summary:<outcome>` keys.
  - `restoreOps(draft: SheetDraft, findingIds: string[], revisedIds: string[]): Array<{ op: 'tick'; id: string; on: boolean } | { op: 'text'; key: string; value: string } | { op: 'outcome'; value: string } | { op: 'note'; key: string; value: string }>`. This is pure: it skips ids not in `findingIds`, and skips `comment:<id>` for any id in `revisedIds`. A revised finding keeps its tick but takes the new draft text.
  - `useSheetDraft(mrUrl, form, names, findingIds, revisedIds)`:
    - restores once per gate id, applying ops through `form.toggleMulti`, `form.setText`, `form.setSingle` and `form.setNote`;
    - then PUTs the snapshot, debounced 500 ms;
    - stops after the gate is submitted.

- [ ] **Step 1: Write the failing tests.**
  - `restoreOps`: drops unknown ids; keeps a revised finding's tick but drops its comment text; carries the outcome and the summary text.
  - `snapshotSheet`: unions the chunked selections.
  - DOM: open sheet A, untick f2, edit f3's comment, swap in gate B with the same ids. f2 is unticked and f3 holds the edit.
- [ ] **Step 2: Run them and confirm they fail.** `bun run board:test`.
- [ ] **Step 3: Implement the route, the module and the hook call in `ReviewGateSheet`.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `board: review sheet keeps ticks and edits across a rebuilt gate`

---

### Task 8: The sheet UI: Ask button, live pill, revised strip

**Files:**
- Modify: `apps/board/src/client/board/icons.tsx`: `QuestionGlyph()`, Lucide `message-circle-question-mark` (ISC), on `RECORD_ICON` like `CommentGlyph`
- Modify: `apps/board/src/client/board/ReviewDraftCard.tsx`: `FindingCard` props and the Agent Finding `SectionHead` children; a new `RevisedStrip` component
- Modify: `apps/board/src/client/board/ReviewGateSheet.tsx`: pass the new props, POST `/question`
- Modify: `apps/board/src/style.css`: `.tui-review-revised` (strip) and `[data-revised]` on `.tui-review-finding` (border), using the warn role tokens the stylesheet already uses for its warn hue. No raw hex.
- Modify: `apps/board/src/client/board/gate-gallery.fixtures.ts` and `GateGallery.stories.tsx`: a review-post variant with one live question and one revised finding (invented names)
- Test: a DOM test beside `respond-sheet-dom.test.tsx` (for example `review-question-dom.test.tsx`)

**Interfaces:**
- Consumes: Task 6's `mr.questions`. Task 4's `POST /question`.
- Produces:
  - `FindingCard` props gain `ask?: { state: 'idle' | 'live'; onAsk: () => void }` and `revision?: { original: FindingEntry; revised: FindingEntry | null; tabLabel: string }`.
  - `revisionSummary(original: FindingEntry, revised: FindingEntry): string[]`. A pure function in `ReviewDraftCard.tsx`, exported for tests. It returns the changed parts in order: `"<old> → <new>"` for severity, `"lines <a> → <b>"` for anchor, `"finding reworded"` when title or body changed.

**Behaviour:**
- `ask` is passed only when the sheet renders drafts (`drafts` true), the MR's report json includes the finding id, and the finding comes from the `findings` question.
- **Idle** renders `<button type="button" className="tui-review-section-link" aria-label="<title>: ask a question">ask a question <QuestionGlyph/></button>`. Clicking it POSTs `/question` with `{ mrUrl, iid, gateId, findingId }`.
- **Live** renders the same control class with text `question open · Q <id>` and `<ArrowOutGlyph/>`. Clicking it POSTs `/question` with `focus: true`.
- With `revision`, the card gets `data-revised=""`, and `RevisedStrip` renders right under the head: `Revised from your question in Q <id> · <parts joined by " · ">`, plus a `show original` toggle that reveals the original body.
- While `mr.questions.rebuilding` is true and the gate is closed, the existing answered or closed sheet body shows. Nothing new is needed beyond not erroring.

- [ ] **Step 1: Write the failing tests.**
  - `revisionSummary(Important→Minor, 117–119→121–123, body changed)` returns `['Important → Minor', 'lines 117–119 → 121–123', 'finding reworded']`.
  - DOM tests:
    - an idle button per finding, and its POST body;
    - no button on a skipped finding;
    - no button when `/review/report.json` 404s;
    - a live finding shows the pill;
    - a revised finding shows the strip text and `data-revised`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.** Compare against frames B23 and B23b for placement.
- [ ] **Step 4: Run the tests and the visual gates.** `bun run board:test`, `bun run board:typecheck`, then `bun run capture:compare` in `apps/board`. If only the intended review sheet captures differ, regenerate them with `bun run capture:baseline`. Check 720 px by hand in Storybook (`Gates/Board/Gallery`).
- [ ] **Step 5: Commit.** `board: ask a question from a review finding`

---

### Task 9: The `/board:question` wrapper skill

**Files:**
- Create: `apps/board/skills-src/question/SKILL.md`
- Create: `apps/board/skills-src/question/scripts/resolve-args.sh`, copied from `skills-src/doctor/scripts/resolve-args.sh` and adapted to `--finding`, `--gate` and `--report-json`
- Generated: `apps/board/skills/question/` (`bun run skills:expand:board`)
- Test: `bun run skills:check:board` and `lib/__tests__/no-board-skills-drift.test.ts`

**SKILL.md must carry:**
- **Frontmatter:**
  - `name: board:question`
  - `disable-model-invocation: true`
  - `allowed-tools` for its `resolve-args.sh`
  - a description in the house form: `Use when the mr-board launches a pane to answer the human's questions about ONE review finding, invoked as "/board:question <mrUrl> --state <path> --status-bin <path> --report <path> --report-json <path> --finding <id> --gate <id>". Not for manual use.`
- **Start:**
  1. Run `<status-bin> question status <state> live`.
  2. Read the report json. Record `shasum -a 256` of it as `REPORT_SHA`.
  3. Print the finding (tier, title, anchor, body, fix, drafted comment) and one line inviting questions.
  4. End the turn. The human drives from here.
- **Hard rule: read-only.**
  - Never write to a database, post to the MR, push, commit, or answer or open any gate.
  - sdm only through rt's sdm verbs (the `rt:sdm-connect` skill), and only `*-read-only` resources. QA by default; prod only when the human asks for prod in this conversation.
  - New Relic and logs are read-only by nature.
  - Code through `mr_view` and `gitlab_get`. When a real tree is needed, provision a worktree with the `rt:worktree` skill at the MR head and dispose of it before `done`.
- **When the finding changes:**
  1. Write the revised finding in the report json's finding shape, keeping `id`, to a temp file. For a drop, write `{"drop": true}`.
  2. Show the human what changed (tier, anchor, body, comment).
  3. Ask in plain text whether to send it back. Not an rt gate.
- **On yes:** run `<status-bin> question send-back <state> --revision <file> --report-sha <REPORT_SHA>`.
  - Exit 0: tell the human the review is being rebuilt with the revision, and that they finish it in the board.
  - Exit 3: relay the refusal line verbatim.
  - On "report changed": re-read the report, recompute `REPORT_SHA`, re-check the revision against it, and ask again.
- **Finding holds:** say so. Nothing to send.
- **Ending:** when the human is done, or the board closes the tab, run `<status-bin> question status <state> done`.

- [ ] **Step 1: Write the skill and script, then run `bun run skills:expand:board`.**
- [ ] **Step 2: Run the checks.** `bun run skills:check:board` and `bun test lib/__tests__/no-board-skills-drift.test.ts`. Expected: PASS, with no strict lint hits.
- [ ] **Step 3: Commit.** `board: the questions agent wrapper skill`. Include both `skills-src/question` and the generated `skills/question`.

---

### Task 10: The review agent handles `closed (revised)`

**Files:**
- Modify: `apps/board/skills-src/review/SKILL.md`:
  - the gate wait results (:1487-1556 and :1640-1651);
  - the flow digraph's "Review wait result?" and "Resumed wait result (review)?" edges (:205 and :1547);
  - the "Gone" bullets (:1500 and :1671).
- Modify: `plugins/mattstack/attachments/review/review/SKILL.md`: a new section after "Take the human's changes into the review draft" (:748)
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (version bump)
- Generated: `apps/board/skills/review/` (`bun run skills:expand:board`)
- Test: `bun run skills:check:board`, the plugin's certify and `rt skills check --strict` (the `plugin-mattstack` CI job's commands), and `apps/board/src/__tests__/skills-review-open-gate.test.ts`

**Wrapper changes:**
- A wait result `gate <id> closed (revised)` is not "Gone". It goes to a new box, `Review gate closed for a revision`:
  1. Read `<report stem>.revision.json`.
  2. Hand it to the domain skill as a revision.
  3. Open the domain skill's newly fitted open file with `open-gate.sh`, exactly like the first open.
  4. Delete the `.revision.json` file once the new gate is open.
- **Missing or unreadable revision file:** end cleanly as "Gone", saying why.
- **A resumed pane (`--resumed-gate`) never sees this:** the board refuses a send-back on a parked gate.
- Every other `closed (<reason>)` stays terminal.

**Domain skill section, "Revise one finding from the board":**
- **Revision `{findingId, revised, original}`:**
  - When `revised` is null, remove the finding from the report `.md` and `.json`.
  - Otherwise replace it, keeping `id`.
- **New anchor:** if the new `file:line` is not in the MR diff (`mr_view`), drop `line` so it posts in the summary, the rule `hasDiffLine` encodes. Say so in the hand-back.
- **Rebuild:**
  1. Recompute the `review@1` severity counts.
  2. Re-run `review-source.sh`, then `gate-ctx.sh fit`, the same way the first open was built.
  3. Hand back the new open file's path to the caller.
- **No re-verify pass** of other findings. A revision is the human's decision.

- [ ] **Step 1: Make the wrapper and domain-skill edits, bump the plugin version, and run `bun run skills:expand:board`.**
- [ ] **Step 2: Run the checks.** `bun run skills:check:board`, the `plugin-mattstack` job's checks locally, and `bun run board:test`, filtered to `skills-review-open-gate`. Expected: PASS.
- [ ] **Step 3: Commit.** `review: rebuild one finding when the board closes the gate as revised`

---

### Task 11: End-to-end check and the Flock follow-up

- [ ] **Step 1: Run the full suites.** `bun run test:all` and `bun run check`. Expected: PASS. Report any failure with its output; don't paper over it.
- [ ] **Step 2: Fixture board walk-through.**
  1. Start a fixture board on a raw port (`PORT=` per `apps/board/AGENTS.md`).
  2. Drive a review-post gate with two findings: click ask a question, see the pill, call `question send-back` against an isolated HOME's board state, see the revised strip after a reopened gate.
  3. Drive it in a browser at `http://localhost:<port>`, never a `*.mattstack` URL. Capture screenshots for the PR.
- [ ] **Step 3: Flock follow-up.** Tell the user that the `questions` workspace may need adding to Flock's BOARD section (repo `m4ttstack/flock`), with what to check. Don't file anything without asking.
