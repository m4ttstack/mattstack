# Review Gate Drafted Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The review drafts every comment and the summary line before the `review-post` gate. The board shows them in editable boxes, and what's in the box posts word for word.

**Architecture:** The report json gains drafted text. The gate source builder (TS and jq twins) carries it into `findings@1` and `review@1`. The fitter shortens it to previews when the gate is over budget. A new board endpoint serves the full drafts, and the sheet shows edit boxes only when the gate is marked `editable` and the full drafts arrive. Per-finding edits ride back as a `texts` map on each `findings-N` answer, and the summary line edit as `text` on `outcome`. The mattstack review verb posts edit-or-draft word for word, on GitLab and GitHub.

**Tech Stack:** Bun + TypeScript, React (board client), jq shell scripts (plugin), mattstack plugin skills (Markdown + dot digraphs).

**Spec:** `docs/superpowers/specs/2026-10-20-review-gate-drafted-comments-design.md`. Mock: `docs/apps/design/board/board.pen`, board B15, frame "A · gate".

## Global Constraints

- One gate only: `review-post`. No new gate, no preview step.
- What posts is the edited text, else the drafted text, character for character. The post step never rewrites either one. The single exception: a bad-anchor finding moved into the summary keeps its body word for word and gains only its `file:line`.
- An anchored finding the 100-comment cap pushes into the summary posts its inline draft word for word.
- Edit boxes show only when `review@1.editable === true` AND the board has fetched the full drafts. Otherwise the sheet renders exactly as today.
- Previews never post. The pane form and herd relays post the full draft, which the poster reads from the report json.
- An unticked finding hides its comment box. An edit made before unticking is kept in form state and comes back on re-tick.
- The board wrapper's generic path (no domain skill) is unchanged.
- The respond flow is unchanged.
- Report json stays `version: 3`. The new fields are additive and optional.
- The TS (`lib/gates/*.ts`) and jq (`plugins/mattstack/attachments/review/review/scripts/*.sh`) builders change together, and `lib/gates/__tests__/parity.test.ts` must stay green.
- The two `gate-ctx.sh` copies (`review/review/scripts`, `review/receive-review/scripts`) stay byte-identical (`tests/test-review-source.sh:26`).
- Any edit under `plugins/mattstack/` bumps `plugins/mattstack/.claude-plugin/plugin.json` `version` (CI: `scripts/ci/plugin-version-bumped.ts`). Re-check against main right before merge.
- Skill text edits load `superpowers:writing-skills`, `mattstack:editing-skills` and `mattstack:process-digraphs` first. Board wrapper edits go in `apps/board/skills-src/`, then `bun run skills:expand:board`.
- Public repo: fixtures use invented names only. No Assured names or ticket ids anywhere.
- No em dashes or en dashes in UI copy or skill text.
- Run tests from the repo root for `lib/`, and from `apps/board` for board tests (`cd apps/board && bun test <file>`).

## Review Focus

1. **A review with 12 findings, each with a long comment.** The gate stays under `GATE_CTX_LIMIT` by shortening comments to previews. It never drops a `findings-N` context, and `readReviewGate` still returns a gate, so the sheet still renders. Test in Task 2.
2. **The human picks Comment while the summary was drafted for Approve.** The summary posts word for word, and the board shows a hint under the summary card. Test in Task 6.
3. **An edit cleared to empty.** Submit is disabled while any shown, ticked comment edit is blank, matching `sendableTexts`. Test in Task 6.
4. **An edit equal to the draft after trimming** doesn't ride in `texts`, so the "edited" chip doesn't show. Test in Task 6.
5. **A `texts` key for an id not in that answer's `value`** (for example an unticked finding) is rejected by `validateGateAnswers`, so a stale edit can't post. Test in Task 3.

---

### Task 1: Report json carries drafts, builder passes them through

**Files:**
- Modify: `lib/gates/review-source.ts` (`findingErrs` :44-62, `fileErrs` :95-124, `extrasErrs` :126-144, `entry` :241-252, `buildReviewSource` :319-357)
- Modify: `plugins/mattstack/attachments/review/review/scripts/review-source.sh` (`file_errs` ~:39-80, `entry` ~:111, review context build)
- Modify: `plugins/mattstack/attachments/review/review/tests/fixtures/findings-v3.json` and `extras.json` (add a drafted variant, or a new `findings-v3-drafts.json`)
- Test: `lib/gates/__tests__/review-source.test.ts`, `lib/gates/__tests__/parity.test.ts`, `plugins/mattstack/attachments/review/review/tests/test-review-source.sh`

**Interfaces:**
- Produces: report finding field `comment?: string` (non-empty when present). Report `summary.comment?: string` (non-empty when present). Extras `editable?: boolean`. `findings@1` entry gains `comment?: string` (full text). `review@1` context gains `editable?: true` and `summaryComment?: string`.

- [ ] **Step 1: Write failing tests** in `review-source.test.ts`, in a new `describe("version 3: drafted comments")`:
  - `buildReviewSource` over a v3 file whose findings carry `comment`, plus `summary.comment`, with extras `{editable: true}`. Expect each `findings@1` entry's `comment` to equal its report comment. Expect `review@1` to have `editable: true` and `summaryComment` equal to `summary.comment`.
  - The same file without `comment`, `summary.comment` or `editable`. Expect the output deep-equal to today's (no new keys).
  - `reviewSourceErrors` with `comment: ""` reports an error naming `comment`. With `summary.comment: 3` it reports one naming `summary.comment`. With `editable: "yes"` in extras it reports one naming `editable`.
- [ ] **Step 2: Run** `bun test lib/gates/__tests__/review-source.test.ts`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement in TS.** Add the optional validators. Add `comment` to `entry`'s `pick`. Add `editable` to the `pick(x, [...])` for the context, and `summaryComment: f.summary.comment` when present.
- [ ] **Step 4: Mirror in `review-source.sh`.** Same validation and the same output keys, in the same key order as TS so parity's deep compare holds. Add the drafted fixture.
- [ ] **Step 5: Run** `bun test lib/gates/__tests__/review-source.test.ts lib/gates/__tests__/parity.test.ts` and `sh plugins/mattstack/attachments/review/review/tests/test-review-source.sh`. Expected: PASS.
- [ ] **Step 6: Commit** `gates: report json drafts ride into findings@1 and review@1`.

### Task 2: Context shapes validate, print and fit the drafts

**Files:**
- Modify: `lib/gates/ctx.ts` (`findingsErrs` :195-220, `reviewErrs` :154-168, `findingsProse` :382-395, `reviewProse` :365, `fitOpen` :609-624, plus a shortening helper beside the carryover one at :536-550)
- Modify: `plugins/mattstack/attachments/review/review/scripts/gate-ctx.sh` and its byte-identical copy `plugins/mattstack/attachments/review/receive-review/scripts/gate-ctx.sh`
- Test: `lib/gates/__tests__/ctx-validate.test.ts`, `ctx-fit.test.ts`, `parity.test.ts`, `plugins/mattstack/attachments/review/receive-review/tests/test-gate-ctx.sh`, `apps/board/src/client/board/__tests__/review-source-contract.test.ts`

**Interfaces:**
- Consumes: the Task 1 fields.
- Produces: `COMMENT_PREVIEW_CP = 160`. Prose line `Will post as comment: <comment>` after a finding's body. Prose line `Will post as summary: <summaryComment>` in `reviewProse`. Fit order: shorten every `findings@1` `comment` and the `review@1` `summaryComment` to 160 code points plus `…`, largest first, BEFORE the existing evidence and fix trims.

- [ ] **Step 1: Write failing tests.**
  - `ctx-validate`: a `findings@1` entry with `comment: 5` errors with `comment: optional non-empty string`. `review@1` with `editable: "y"` errors. `summaryComment: ""` errors.
  - `ctx-fit`, the Review Focus #1 test: build a source with 12 findings (3 chunks), each with a 900-character body and a 1,200-character comment, and `editable: true`. After `fitOpen(source, GATE_CTX_LIMIT)`:
    - the result is structured (not prose)
    - every `findings-N` question still has its `findings@1` context
    - every `comment` is 161 code points or fewer and ends with `…`
    - `readReviewGate` (imported from `apps/board/src/client/board/review-gate.ts`), applied to a GateRow built from the result, is non-null. If the cross-package import is awkward, assert the conditions it checks: one entry per option, per-severity counts match.
  - `ctx-fit`: a source under budget keeps every `comment` unshortened.
  - `findingsProse` prints `Will post as comment: ` followed by the comment.
- [ ] **Step 2: Run** `bun test lib/gates/__tests__/ctx-validate.test.ts lib/gates/__tests__/ctx-fit.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement in `ctx.ts`.** Write the shortening helper on the carryover helper's model ("shortens, never deletes"), and wire it first in `fitOpen`.
- [ ] **Step 4: Mirror in `gate-ctx.sh`** (validate, prose, fit), then copy the file byte for byte to `receive-review/scripts/gate-ctx.sh`.
- [ ] **Step 5: Run** the ctx tests, `parity.test.ts`, both shell suites, and `cd apps/board && bun test src/client/board/__tests__/review-source-contract.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `gates: findings@1 and review@1 validate, print and shorten drafts`.

### Task 3: Answers carry per-finding edit text

**Files:**
- Modify: `packages/rt-client/src/commands.ts:198` (`GateAnswer` answer union), `packages/rt-client/src/gate-answers.ts` (`wrapperFieldError` :15-22, `validateGateAnswers`)
- Modify: `packages/gate-kit/src/payload.ts` (`GateAnswers` type :7, `unwrapGateAnswer`)
- Modify: `lib/gates/record.ts` (`normalizeAnswers` :21-33, `extraOf` :88)
- Test: `packages/rt-client/src/__tests__/gate-answers.test.ts` (or the existing validator test file), `lib/gates/__tests__/record-answers.test.ts`, gate-kit's payload test

**Interfaces:**
- Produces: wrapper answer `{ value: string | string[]; note?: string; text?: string; texts?: Record<string, string> }`. Rules:
  - `texts` is allowed only when `value` is an array.
  - Every key must be an element of `value`.
  - Every value must be a non-blank string.
  - `unwrapGateAnswer` returns `texts` when present.
  - `normalizeAnswers` keeps `texts`, and doesn't collapse a wrapper that has only `texts`.

- [ ] **Step 1: Write failing tests.**
  - `validateGateAnswers` accepts `{"findings-1": {value: ["f1","f2"], texts: {f1: "Edited"}}}`.
  - It rejects `texts: {f3: "x"}` when `f3` is not in `value` (Review Focus #5).
  - It rejects `texts: {f1: "  "}`.
  - It rejects `texts` on a single-value answer.
  - `normalizeAnswers` round-trips `texts`.
  - `unwrapGateAnswer` returns it.
- [ ] **Step 2: Run** the three test files (`bun test <paths>` from the root). Expected: FAIL.
- [ ] **Step 3: Implement** the type widening and the checks above.
- [ ] **Step 4: Run** the same tests, plus `bun test lib/mcp/__tests__/gate-tools.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `gates: answers carry a per-option texts map`.

### Task 4: Board serves the full drafts for a gate

**Files:**
- Create: `apps/board/src/review-drafts.ts`
- Modify: `apps/board/src/server.ts` (add `case '/review/drafts'` beside `/review/report.json` at :3899-3910, and a fixture-mode case beside :1721-1745)
- Create: `apps/board/tests/fixture/review-drafts.json`, plus a line in `apps/board/tests/fixture/README.md`
- Test: `apps/board/src/__tests__/review-drafts.test.ts`

**Interfaces:**
- Consumes: `readReviewReportJson(mrUrl, db?)` (`review-state.ts:105`). For `run:` gates, the run's `extra.gate-source.post` field (written by `lib/mcp/gate-tools.ts:497,544`). Read it the way `src/gates/run-mr.ts` reads run fields (`mrUrlFromRun` :50).
- Produces:
  - `export interface ReviewDrafts { findings: Record<string, string>; summary: string | null }`
  - `export function reviewDraftsFromReport(json: unknown): ReviewDrafts | null`: from a report json, `comment` by finding `id` and `summary.comment`. Null when no finding has a comment and there is no summary comment.
  - `export function reviewDraftsFromSource(source: unknown): ReviewDrafts | null`: from an untrimmed gate source, `findings@1` entries' `comment` and `review@1.summaryComment`.
  - `GET /review/drafts?gate=<gateId>` → 200 `ReviewDrafts`, 404 `no drafts`, 400 without `gate`. The subject `mr:<url>` resolves through `readReviewReportJson`, and `run:<id>` through the run's gate source.

- [ ] **Step 1: Write failing tests** for both pure functions:
  - drafts extracted by id
  - a finding without a comment is absent from `findings`
  - null for a legacy report
  - null for a source without drafts
- [ ] **Step 2: Run** `cd apps/board && bun test src/__tests__/review-drafts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `review-drafts.ts` and the two server cases. The fixture case serves `tests/fixture/review-drafts.json`. Write its findings with invented text that matches the ids of the fixture review in `tests/fixture/data.json`.
- [ ] **Step 4: Run** the test file and `bun run board:typecheck` from the root. Expected: PASS.
- [ ] **Step 5: Commit** `board: serve a review gate's full drafts`.

### Task 5: Editable box speaks "comment" as well as "reply"

**Files:**
- Modify: `apps/board/src/client/board/RespondCards.tsx` (`EditableReply` :116-262)
- Test: `apps/board/src/client/board/__tests__/respond-thread-card-dom.test.tsx` (existing copy stays), plus a new case

**Interfaces:**
- Produces: `EditableReply` gains `noun?: 'reply' | 'comment'` (default `'reply'`) and `heading?: string`. Copy keyed by `noun`:
  - "will post as reply" / "will post as comment"
  - "drafted reply · not posting" / "drafted comment · not posting"
  - aria `${label}: edit reply` / `${label}: edit comment`
  - "the reply is empty" / "the comment is empty"
  - `heading`, when set, replaces the "will post as …" label (the summary uses "will post as the review summary").

- [ ] **Step 1: Write a failing DOM test.** With `noun="comment"`, the box reads "will post as comment", and the edit button's aria-label ends in "edit comment".
- [ ] **Step 2: Run** `cd apps/board && bun test src/client/board/__tests__/respond-thread-card-dom.test.tsx`. Expected: the new case FAILS and the existing ones PASS.
- [ ] **Step 3: Implement** the props. Existing callers are unchanged.
- [ ] **Step 4: Run** the same file and `respond-replies-dom.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `board: EditableReply speaks comment as well as reply`.

### Task 6: Review sheet shows and edits the drafts

**Files:**
- Modify: `apps/board/src/client/board/gate-ctx.ts` (`FindingEntry` :105-115, `readFinding` ~:330, `ReviewCtx` :88): add `comment?: string`, plus `editable?: boolean` and `summaryComment?: string`
- Modify: `apps/board/src/client/board/ReviewGateSheet.tsx`
- Create: `apps/board/src/client/board/review-drafts-client.ts` (fetch hook plus pure payload helpers)
- Test: `apps/board/src/client/board/__tests__/review-gate-sheet-dom.test.tsx`, plus `apps/board/src/client/board/__tests__/review-drafts-client.test.ts`

**Interfaces:**
- Consumes: Task 4's `GET /review/drafts?gate=`, Task 5's `EditableReply` `noun`/`heading`, `editedText` and `sendableTexts` from `respond-post.ts`, `EditedChip`.
- Produces:
  - Form text keys `comment:<findingId>` and `summary`.
  - `export function useReviewDrafts(gateId: string, enabled: boolean): ReviewDrafts | null`.
  - `export function draftEdits(drafts: ReviewDrafts, ticked: Set<string>, texts: Record<string,string>): { texts: Record<string,string>; summary?: string } | null`: trimmed edits that differ from their draft, for ticked findings only. Null when any ticked finding's edit is blank (Review Focus #3).
  - `export function attachDraftEdits(answers: GateAnswers, questions: GateQuestion[], edits: {texts; summary?}): GateAnswers`:
    - runs after `splitChunkSelections`
    - puts `texts` onto each `findings-N` answer, holding only the ids in that chunk's value
    - puts `text: summary` on `outcome`, keeping any note
    - adds nothing when edits are empty

  Per the seam map, `pickMultis` keeps only arrays, so this must run after the split.

- [ ] **Step 1: Write failing pure tests** in `review-drafts-client.test.ts`:
  - `draftEdits`: an edit equal to its draft after trimming is dropped (Review Focus #4); an unticked finding's edit is dropped; a blank ticked edit gives null.
  - `attachDraftEdits` splits `texts` across `findings-1` and `findings-2` by chunk.
  - The outcome answer becomes `{value: "approve", text: "<edited summary>"}`, and keeps `note` when one was set.
- [ ] **Step 2: Write failing DOM tests** in `review-gate-sheet-dom.test.tsx`. Mock `fetch` for `/review/drafts` beside the existing `/review/report.json` mock:
  - With `editable: true` and drafts, each ticked finding shows "will post as comment" with its draft, and the fix line is gone.
  - Unticking a finding hides its box. Re-ticking shows the earlier edit again.
  - Editing then submitting sends `findings-1: {value:[...], texts:{f1: "<edit>"}}`.
  - A summary card renders above the findings list header, with "Summary comment", the summary draft, and one box per ticked finding with no `file`/line (folded in). An unticked folded finding is not listed.
  - The submit label reads `post 3 comments + summary · Approve` for 3 ticked anchored findings plus a summary.
  - With outcome `comment` while the recommended option is `approve`, the hint "Drafted for approve. Check the summary still reads right." shows under the summary (Review Focus #2).
  - Without `editable`, or when the drafts fetch 404s, the sheet matches today's (existing tests stay green, no boxes).
- [ ] **Step 3: Run** `cd apps/board && bun test src/client/board/__tests__/review-drafts-client.test.ts src/client/board/__tests__/review-gate-sheet-dom.test.tsx`. Expected: the new cases FAIL.
- [ ] **Step 4: Implement.**
  - Parse the new ctx fields.
  - Add the hook and helpers.
  - In the sheet:
    - the summary card goes first in `tui-sheet-main` (option A in the mock)
    - each finding gets an `EditableReply noun="comment"` under its body when ticked and editable
    - a finding with no anchor shows the pointer "No diff line, so this posts in the summary comment above" instead of a box
    - the fix line is hidden when editable
    - `submit` runs `attachDraftEdits` after the existing transform
    - submit is disabled when `draftEdits` is null
    - the label count is as in Step 2
  - Style with existing `tui-*` classes and role tokens (`docs/apps/ui-authoring.md`). No raw hex.
- [ ] **Step 5: Run** the two files, `review-gate.test.ts`, `review-routing-dom.test.tsx`, `decision-queue-dom.test.tsx`, and `bun run board:typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `board: review sheet shows and edits drafted comments`.

### Task 7: Gallery face, capture baseline, eyes on it

**Files:**
- Modify: `apps/board/src/client/board/gate-gallery.fixtures.ts` (add `reviewPostDrafted` beside `reviewPost` :1080: same radar fixture, `editable: true`, comments on every finding, one finding with no anchor)
- Modify: `apps/board/src/client/board/GateGallery.stories.tsx:154-170` (add `ReviewPostDrafted`, with a `fetchStub` for `/review/drafts` on the `ReviewGateSheet.stories.tsx:249-300` model)
- Modify: `apps/board/tests/capture.ts` only if the review sheet shot (:321-330) needs the drafts route
- Regenerate: `apps/board/tests/baselines/*` (`bun run capture:baseline` in `apps/board`)

- [ ] **Step 1: Add the fixture and story** with invented names and text.
- [ ] **Step 2: Run** `bun run storybook` from the root. Open `http://localhost:6006/iframe.html?id=gates-board-gallery--review-post-drafted&viewMode=story` in Fast Browser at 1440×900 and screenshot it in light and dark. Compare against B15 "A · gate". In the report, say plainly what reads wrong.
- [ ] **Step 3: Run** `cd apps/board && bun run capture:compare`. Expected: only the review sheet shots differ. Then run `bun run capture:baseline`, and check the regenerated shots by eye.
- [ ] **Step 4: Commit** `board: gallery face and baselines for drafted review comments`.

### Task 8: The review verb drafts before the gate and posts word for word

**Before editing:** load `superpowers:writing-skills`, `mattstack:editing-skills` and `mattstack:process-digraphs`. Keep every touched digraph valid (`plugin/skills/process-digraphs/test-check-dot.sh`, "Every plugin digraph passes check-dot (warnings fail)").

**Files:**
- Modify: `plugins/mattstack/attachments/review-core-body-tail/SKILL.md`
  - "Structured findings file" :24-101: document `findings[].comment` and `summary.comment` as the exact text that posts, written in the loaded writing-style voice; still version 3
  - Quick reference :121
- Modify: `plugins/mattstack/attachments/review/review/SKILL.md`
  - `Assemble the review draft` :578: write each comment and the summary line into the json; the writing-style skill loads before this step
  - `Write review-post.extras.json` :620-651: `editable: true`
  - `Caller handed a decided selection…` :470-485: accept `texts` and `summaryText`
  - `Compose the submitted review` :732-755: each body is the answer's `texts[id]`, else the json `comment`; the summary is the outcome's `text`, else `summary.comment`; never rewritten
  - `This review already on the MR?` :757-775: `contains:` uses the first line of the body actually sent
  - `Move the bad-anchor findings into the summary` :777-781: body word for word, plus `file:line`
  - GitHub `gh pr review` :934-940: the summary line, then each finding's text word for word with its `file:line`
  - the 100-cap sentence: overflow findings post their draft word for word in the summary
  - drop "note steers wording" where it appears
- Modify: `plugins/mattstack/attachments/review-posting/SKILL.md` (tacit-approval rule :128-135): it applies at drafting time, never to text a human saw. A summary from an edit or a draft posts as is.
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` version (one past main's)
- Modify: `plugins/mattstack/CERTIFICATION.md` (one row), `plugins/mattstack/docs/superpowers/tests/2026-10-17-digraph-ids/slugs/review.json` if node labels change, `plugins/mattstack/README.md:192-220` if it describes Compose
- Test: `sh plugins/mattstack/tests/certify.sh`, the digraph check, and the Task 1 and 2 shell suites

- [ ] **Step 1: RED baseline** per `superpowers:writing-skills`. Have a subagent follow today's verb against `findings-v3-drafts.json` with an answer carrying `texts`. Record that it rewrites the bodies.
- [ ] **Step 2: Edit the skill text** listed above. A digraph label change also updates the slugs file.
- [ ] **Step 3: GREEN.** Rerun the Step 1 scenario. The composed `mr_review_submit` call carries the edited body for `f1`, the draft for the rest, and the outcome `text` as the summary line. Repeat for the GitHub branch.
- [ ] **Step 4: Run** `sh plugins/mattstack/tests/certify.sh`, the digraph check, `bun test scripts/__tests__` (plugin CI gates), and `bun scripts/ci/plugin-version-bumped.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `mattstack: review drafts comments before the gate and posts them verbatim`.

### Task 9: Board wrapper hands the edits to the poster

**Before editing:** load `superpowers:writing-skills` and `mattstack:process-digraphs`.

**Files:**
- Modify: `apps/board/skills-src/review/SKILL.md`
  - `Hand the answer to the domain skill to post` :1105-1148: pass `texts` (the union of every `findings-N` answer's `texts`) and `summaryText` (the outcome answer's `text`) beside `{findings, outcome, replies, restored}`
  - :489-490: a note no longer steers wording when the gate's `review@1.editable` is true
  - `Record the verdict answer in --report` :1002-1016 already round-trips the whole envelope; add one sentence saying `texts` rides in it
- Regenerate: `apps/board/skills/` via `bun run skills:expand:board`
- Test: `bun run skills:check:board`, `bun test lib/__tests__/no-board-skills-drift.test.ts`

- [ ] **Step 1: Edit `skills-src`** as listed.
- [ ] **Step 2: Run** `bun run skills:expand:board`, then `bun run skills:check:board` and the drift test. Expected: PASS.
- [ ] **Step 3: End-to-end check** (manual, isolated HOME per the root `AGENTS.md`).
  - Run a fixture board (`PORT=` with `BOARD_FIXTURE=tests/fixture`) and open its review gate in Fast Browser.
  - Edit a comment, approve, and confirm the posted `answers` (from the gate store, or the `review-post-answer:` line) carry `texts`.
  - Screenshot light and dark.
- [ ] **Step 4: Commit** `board: review wrapper hands drafted-comment edits to the poster`.
