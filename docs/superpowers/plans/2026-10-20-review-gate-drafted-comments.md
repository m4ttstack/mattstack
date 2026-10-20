# Review Gate Drafted Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gates store their context whole, with fields that render only on the board. On that, the review drafts every comment and the summary line before the `review-post` gate, the board shows them in editable boxes, and what's in the box posts word for word.

**Architecture:**
- Tasks 1-3 remove the 8192-byte cap on what a gate stores. The budget moves to the Claude Code pane's prose alone, and a per-shape list of board-only fields that pane prose leaves out is added.
- Tasks 4-10 build the review feature on top:
  - the report json gains drafts
  - the gate source builders (TS and jq twins) carry them whole into `findings@1` and `review@1` as board-only fields
  - the board sheet edits them when the gate is marked `editable`
  - edits ride back as a `texts` map on each `findings-N` answer, and the summary line edit as `text` on `outcome`
  - the mattstack review verb posts edit-or-draft word for word, reading drafts from the gate source it opened

**Tech Stack:** Bun + TypeScript, React (board client), jq shell scripts (plugin), mattstack plugin skills (Markdown + dot digraphs).

**Spec:** `docs/superpowers/specs/2026-10-20-review-gate-drafted-comments-design.md`. Mock: `docs/apps/design/board/board.pen`, board B15, frame "A · gate".

## Global Constraints

- **No size limit on stored gate context**, for any gate kind. Nothing the daemon stores, and nothing the board draws, is trimmed or dropped for size.
- **The pane prose has a budget**: `PANE_PROSE_LIMIT = 8192` UTF-8 bytes. It covers the form prose and form chunks only: what `flattenContext`, `formChunks` and `proseContext` produce.
- **Board-only fields never appear in pane prose**: `findings@1.comment` and `review@1.summaryComment`.
- One gate only: `review-post`. No new gate, no preview step.
- What posts is the edited text, else the drafted text, character for character, from the gate source the poster opened. The single exception: a bad-anchor finding moved into the summary keeps its body word for word and gains only its `file:line`.
- An anchored finding the 100-comment cap pushes into the summary posts its inline draft word for word.
- Edit boxes show only when `review@1.editable === true` and the drafts are in the gate. Otherwise the sheet renders exactly as today.
- An unticked finding hides its comment box. Its edit is kept in form state and comes back on re-tick.
- The board wrapper's generic path is unchanged. The respond flow's behavior is unchanged; only its size-budget plumbing is removed.
- Report json stays `version: 3`. The new fields are additive and optional.
- The TS (`lib/gates/*.ts`) and jq (`plugins/mattstack/attachments/review/review/scripts/*.sh`) twins change together, and `lib/gates/__tests__/parity.test.ts` stays green. The two `gate-ctx.sh` copies (`review/review/scripts`, `review/receive-review/scripts`) stay byte-identical.
- Any edit under `plugins/mattstack/` bumps `plugins/mattstack/.claude-plugin/plugin.json` `version`. Re-check against main right before merge. Changing `attachments/mcp-tools/reference.md` also triggers `scripts/ci/engine-floor-check.ts`.
- Skill text edits first load `superpowers:writing-skills`, `mattstack:editing-skills` and `mattstack:process-digraphs`. Board skills are edited in `apps/board/skills-src/`, then `bun run skills:expand:board`.
- Public repo: invented names only in fixtures, and no employer names or ticket ids (`scripts/repo-purity.sh`).
- No em dashes or en dashes in UI copy or skill text.
- `lib/` tests run from the repo root. Board tests run from `apps/board` (`cd apps/board && bun test <file>`). Built binaries only ever run under an isolated HOME.

## Review Focus

1. **A 12-finding review with long bodies and long comments.** Stored structured and whole: every `findings-N` context is present, every comment is untrimmed, and `readReviewGate` is non-null. The pane prose stays within `PANE_PROSE_LIMIT` and contains no comment text. Test in Task 4.
2. **A pane-owned gate (no board) whose untrimmed prose is over the pane budget.** The pane form still opens, with trimmed prose, and the stored gate stays whole. Test in Task 2.
3. **The human picks Comment while the summary was drafted for Approve.** The summary posts word for word, and the board shows the hint. Test in Task 7.
4. **An edit cleared to empty**, or one equal to its draft after trimming. A blank edit disables submit. An unchanged edit doesn't ride in `texts`. Test in Task 7.
5. **A `texts` key for an id not in that answer's `value`** is rejected, so a stale edit for an unticked finding can't post. Test in Task 5.

---

### Task 1: The daemon stores gate context whole

**Files:**
- Modify: `lib/daemon/handlers/gate.ts`. Remove `CONTEXT_CAP_BYTES` (:85), the gate:open reject (:505-506) and the gate-ask drop path (:794-849), and remove the size sentence from the help text at :137.
- Modify: `lib/daemon/reconciler.ts:43-46`. It keeps its own peek cap: rename it `PANE_PEEK_CAP_BYTES` and drop the "matches gate.ts" comment. A pane peek is terminal capture, not gate context.
- Modify: `commands/gate.ts:173-228` (the cap and the `contextOmitted` diagnostic), `apps/board/src/gates/verbs.ts:102-146,212` (the cap and its warning), and `packages/rt-client/src/commands.ts:1067-1077` (the `contextOmitted` field and its doc).
- Modify: `lib/mcp/gate-tools.ts:230`, the `extra.context-dropped` write. It now fires only on `contextDropped` from the pane fitter (Task 2), never on a daemon drop.
- Test: `lib/daemon/__tests__/` (the gate handler tests that pin the 8192 reject/drop), `commands/__tests__/` for `rt gate`, `apps/board/src/gates/__tests__/verbs*.test.ts`

**Interfaces:**
- Produces: `gate:open` and gate-ask store `context` and every question `context` verbatim at any size. The response no longer carries `contextOmitted`. Readers that still accept the field stay tolerant until it is deleted here.

- [ ] **Step 1: Rewrite the pinning tests.**
  - A gate opened with a 40,000-byte gate context and three 20,000-byte question contexts is stored byte for byte, and returns no `contextOmitted`.
  - `rt gate` prints no omitted diagnostic for the same input.
  - The board's `verbs.ts` gate open sends the context with no warning.
- [ ] **Step 2: Run** `bun test lib/daemon commands/__tests__/gate*` from the root and `cd apps/board && bun test src/gates`. Expected: the rewritten cases FAIL.
- [ ] **Step 3: Implement the removals above.** Delete `contextOmitted` from the rt-client type, and delete every reader that only existed to report it.
- [ ] **Step 4: Run** the same tests and `bun run typecheck` (root). Expected: PASS.
- [ ] **Step 5: Commit** `gates: the daemon stores gate context whole`.

### Task 2: The fitter becomes a pane-prose budget with board-only fields

**Files:**
- Modify: `lib/gates/ctx.ts`
  - rename `GATE_CTX_LIMIT` (:313) to `PANE_PROSE_LIMIT`
  - add `BOARD_ONLY_FIELDS`
  - `proseContext` (:448) and every `*Prose` skip board-only fields
  - `fitOpen` (:609-624) no longer trims the stored structured context; it returns the structured source untouched, plus the fitted pane prose
  - `boardsBudgetError` (:606) and its 12-board rule stay; its budget becomes the pane's
- Modify: `lib/gates/form.ts`. `flattenContext` (:38) and `formChunks` (:65) drop board-only fields. `dropContextsToFit` (:91-113) runs only on the pane prose copy.
- Modify: `lib/mcp/gate-tools.ts`
  - `gate_open`: the stored open is the untrimmed source
  - `formContext`/`formChunks` come from the pane fitter
  - `fits`, `trimmed` and `contextDropped` describe the pane prose only
  - the `handBack` path (:465) drops contexts only in the pane copy
- Modify: `plugins/mattstack/attachments/review/review/scripts/gate-ctx.sh` (`LIMIT` :20, the fit subcommand, the prose renderer) and its byte-identical copy in `receive-review/scripts/`. `apps/board/skills-src/{review,respond}/scripts/open-gate.sh` lose their "drop contexts until < 8192" loop (:9, :25) and open the file as is.
- Test: `lib/gates/__tests__/ctx-fit.test.ts`, `form.test.ts`, `parity.test.ts`, `lib/mcp/__tests__/gate-tools.test.ts`, `plugins/mattstack/attachments/review/review/tests/test-review-source.sh` (:155 asserts the 8192 total; it now asserts the pane prose budget), `receive-review/tests/test-gate-ctx.sh`, `apps/board/src/__tests__/skills-respond-open-gate.test.ts`

**Interfaces:**
- Produces:
  - `export const PANE_PROSE_LIMIT = 8192`
  - `export const BOARD_ONLY_FIELDS: Record<string, readonly string[]>`, initially `{}`; Task 4 adds `findings@1: ["comment"]` and `review@1: ["summaryComment"]`
  - `fitOpen(source, limit = PANE_PROSE_LIMIT): FitResult`, where `FitResult.questions`/`context` are the stored open (untrimmed) and a new `FitResult.pane: { context?: string; questions: Record<string, unknown>[]; fits: boolean; trimmed: string[] }` holds the pane prose
  - the jq twin's `fit` output gains the same `pane` key

- [ ] **Step 1: Write failing tests.**
  - `ctx-fit`: a source with 40 KB of structured context is stored untouched in `FitResult`, and `FitResult.pane` is within `PANE_PROSE_LIMIT` (Review Focus #2).
  - `form`: with a test-local `BOARD_ONLY_FIELDS` entry, `flattenContext` omits that field.
  - `gate-tools`: `gate_open` stores the untrimmed open, and `formContext` is the pane prose.
  - `skills-respond-open-gate`: the open file passes through unmodified.
- [ ] **Step 2: Run** `bun test lib/gates lib/mcp/__tests__/gate-tools.test.ts` and `cd apps/board && bun test src/__tests__/skills-respond-open-gate.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement in TS**, then mirror in `gate-ctx.sh`. Copy it byte for byte to `receive-review`, and strip the drop loops from both `open-gate.sh` files.
- [ ] **Step 4: Run** the Step 2 tests, `parity.test.ts`, both shell suites, and `cd apps/board && bun test src/client/board/__tests__/review-source-contract.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `gates: size budget applies to pane prose only; board-only fields`.

### Task 3: Agents stop being told about an 8192-byte gate budget

**Before editing:** load `superpowers:writing-skills`, `mattstack:editing-skills` and `mattstack:process-digraphs`.

**Files:**
- Modify: `lib/mcp/tools.ts:143,203` and `lib/mcp/gate-tools.ts:687`, the tool descriptions. Context is stored whole, the pane form shows a budgeted prose view, board-only fields never reach the pane, and the `contextOmitted` sentences go.
- Regenerate: `plugins/mattstack/attachments/mcp-tools/reference.md` with its generator (find it from `scripts/ci/engine-floor-check.ts`). Never hand-edit it.
- Modify: `plugins/mattstack/attachments/gate-protocol/structured-context.txt:56`, the size rule. The pane prose has a budget, and stored context has none.
- Modify: `apps/board/skills-src/respond/SKILL.md:295,506`, `apps/board/skills-src/review/SKILL.md:978,1727,1791-1794` (the "`fits: false` … drops whole question contexts" paragraph), and `apps/board/skills-src/doctor/SKILL.md:294`. Restate the size rule the same way. Respond's "never trim the reply" rule stays as written; it is now always true.
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (version bump) and `plugins/mattstack/CERTIFICATION.md` (one row).
- Regenerate: `apps/board/skills/` (`bun run skills:expand:board`).
- Test: `bun run skills:check:board`, `lib/__tests__/no-board-skills-drift.test.ts`, `sh plugins/mattstack/tests/certify.sh`, `bun scripts/ci/engine-floor-check.ts`, `bun scripts/ci/plugin-version-bumped.ts`

- [ ] **Step 1: Find every remaining mention:** `rg -n "8192|context budget|contextOmitted" lib commands packages plugins/mattstack apps/board/skills-src -g '!**/__tests__/**'`. The only hits allowed after this task are `PANE_PROSE_LIMIT` and its tests.
- [ ] **Step 2: Edit the text** listed above, then regenerate `reference.md` and the board skills.
- [ ] **Step 3: Run** every check in the Test line. Expected: PASS, and Step 1's search finds only the allowed hits.
- [ ] **Step 4: Commit** `gates: skills and tool docs describe the pane budget, not a storage cap`.

### Task 4: Report json drafts ride into the gate as board-only fields

**Files:**
- Modify: `lib/gates/review-source.ts` (`findingErrs` :44-62, `fileErrs` :95-124, `extrasErrs` :126-144, `entry` :241-252, `buildReviewSource` :319-357)
- Modify: `lib/gates/ctx.ts` (`findingsErrs` :195-220, `reviewErrs` :154-168, `BOARD_ONLY_FIELDS` from Task 2)
- Modify: `plugins/mattstack/attachments/review/review/scripts/review-source.sh` (`file_errs`, `entry`, context build) and `gate-ctx.sh` validation in both copies
- Create: `plugins/mattstack/attachments/review/review/tests/fixtures/findings-v3-drafts.json` (invented text, 12 findings, long bodies and comments, one finding with no `file`)
- Test: `lib/gates/__tests__/review-source.test.ts`, `ctx-validate.test.ts`, `ctx-fit.test.ts`, `parity.test.ts`, `test-review-source.sh`

**Interfaces:**
- Consumes: Task 2's `BOARD_ONLY_FIELDS` and `FitResult.pane`.
- Produces:
  - report finding `comment?: string`, non-empty when present
  - report `summary.comment?: string`, non-empty when present
  - extras `editable?: boolean`
  - `findings@1` entry `comment?: string`, the full text
  - `review@1` `editable?: true` and `summaryComment?: string`, the full text
  - `BOARD_ONLY_FIELDS["findings@1"] = ["comment"]` and `BOARD_ONLY_FIELDS["review@1"] = ["summaryComment"]`

- [ ] **Step 1: Write failing tests:**
  - `buildReviewSource` over the drafts fixture with extras `{editable: true}` passes every `comment` through whole, and sets `review@1.editable` and `summaryComment`.
  - A v3 file without drafts produces exactly today's output.
  - `reviewSourceErrors` names `comment` for `""`, `summary.comment` for a number, and `editable` for `"yes"`.
  - `ctx-validate` rejects a `findings@1` `comment: 5` and a `review@1` `summaryComment: ""`.
  - Review Focus #1: `fitOpen` over the 12-finding drafts source gives a structured stored open with every comment untrimmed. `FitResult.pane` is within `PANE_PROSE_LIMIT`, and no comment's text appears in it.
- [ ] **Step 2: Run** `bun test lib/gates`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement in TS, then in jq** (key order matching, for parity).
- [ ] **Step 4: Run** `bun test lib/gates` and both shell suites. Expected: PASS.
- [ ] **Step 5: Commit** `gates: review drafts ride whole into findings@1 and review@1, board-only`.

### Task 5: Answers carry per-finding edit text

**Files:**
- Modify: `packages/rt-client/src/commands.ts:198` (the `GateAnswer` answer union), `packages/rt-client/src/gate-answers.ts` (`wrapperFieldError` :15-22, `validateGateAnswers`)
- Modify: `packages/gate-kit/src/payload.ts` (`GateAnswers` :7, `unwrapGateAnswer`)
- Modify: `lib/gates/record.ts` (`normalizeAnswers` :21-33, `extraOf` :88)
- Test: rt-client's gate-answers test, gate-kit's payload test, `lib/gates/__tests__/record-answers.test.ts`

**Interfaces:**
- Produces: wrapper answer `{ value: string | string[]; note?: string; text?: string; texts?: Record<string, string> }`. Rules:
  - `texts` is allowed only when `value` is an array.
  - Every key must be in `value`.
  - Every value must be a non-blank string.
  - `unwrapGateAnswer` returns `texts`.
  - `normalizeAnswers` keeps `texts`, and doesn't collapse a wrapper that has only `texts`.

- [ ] **Step 1: Write failing tests.**
  - It accepts `{"findings-1": {value: ["f1","f2"], texts: {f1: "Edited"}}}`.
  - It rejects `texts: {f3: "x"}` when `f3` is not in `value` (Review Focus #5), a blank text, and `texts` on a single value.
  - `normalizeAnswers` and `unwrapGateAnswer` round-trip `texts`.
- [ ] **Step 2: Run** those test files from the root. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them plus `lib/mcp/__tests__/gate-tools.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `gates: answers carry a per-option texts map`.

### Task 6: Editable box speaks "comment" as well as "reply"

**Files:**
- Modify: `apps/board/src/client/board/RespondCards.tsx` (`EditableReply` :116-262)
- Test: `apps/board/src/client/board/__tests__/respond-thread-card-dom.test.tsx`

**Interfaces:**
- Produces: `EditableReply` gains `noun?: 'reply' | 'comment'` (default `'reply'`) and `heading?: string`. Copy keyed by `noun`:
  - "will post as reply" / "will post as comment"
  - "drafted reply · not posting" / "drafted comment · not posting"
  - aria `${label}: edit reply` / `${label}: edit comment`
  - "the reply is empty" / "the comment is empty"
  - `heading` replaces the "will post as …" label when set

- [ ] **Step 1: Write a failing DOM test.** With `noun="comment"`, the box reads "will post as comment", and the edit aria-label ends in "edit comment".
- [ ] **Step 2: Run** `cd apps/board && bun test src/client/board/__tests__/respond-thread-card-dom.test.tsx`. Expected: the new case FAILS.
- [ ] **Step 3: Implement.** Existing callers are unchanged.
- [ ] **Step 4: Run** that file and `respond-replies-dom.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `board: EditableReply speaks comment as well as reply`.

### Task 7: Review sheet shows and edits the drafts

**Files:**
- Modify: `apps/board/src/client/board/gate-ctx.ts`
  - `FindingEntry` (:105-115) and `readFinding` (~:330): add `comment?: string`
  - `ReviewCtx` (:88): add `editable?: boolean` and `summaryComment?: string`
- Modify: `apps/board/src/client/board/ReviewGateSheet.tsx`
- Create: `apps/board/src/client/board/review-drafts.ts` (pure helpers)
- Test: `apps/board/src/client/board/__tests__/review-drafts.test.ts`, `review-gate-sheet-dom.test.tsx`

**Interfaces:**
- Consumes:
  - the gate's `findings@1.comment` and `review@1.{editable, summaryComment}` (Task 4)
  - Task 5's `texts`
  - Task 6's `EditableReply` `noun`/`heading`
  - `editedText` (`respond-post.ts`) and `EditedChip`
- Produces:
  - Form text keys `comment:<findingId>` and `summary`.
  - `export function draftEdits(drafts: { findings: Map<string, string>; summary?: string }, ticked: Set<string>, texts: Record<string,string>): { texts: Record<string,string>; summary?: string } | null`: trimmed edits that differ from their draft, for ticked findings only. Null when a ticked finding's edit is blank.
  - `export function attachDraftEdits(answers: GateAnswers, questions: GateQuestion[], edits: { texts: Record<string,string>; summary?: string }): GateAnswers`:
    - runs after `splitChunkSelections` (`pickMultis` keeps only arrays, so it must run after the split)
    - puts `texts` on each `findings-N` answer, holding only that chunk's ids
    - puts `text` on `outcome`, keeping any `note`
    - adds nothing for empty edits

- [ ] **Step 1: Write failing pure tests.**
  - An unchanged-after-trim edit is dropped (Review Focus #4).
  - An unticked finding's edit is dropped.
  - A blank ticked edit gives null.
  - `texts` split across `findings-1`/`findings-2` by chunk.
  - Outcome becomes `{value: "approve", text}`, with `note` kept.
- [ ] **Step 2: Write failing DOM tests:**
  - With `editable: true`, each ticked finding shows "will post as comment" with its full draft, and the fix line is gone.
  - Unticking hides the box, and re-ticking restores the earlier edit.
  - Edit then submit sends `findings-1: {value:[...], texts:{f1: "<edit>"}}`.
  - A summary card renders first in the main column, with "Summary comment", the summary draft, and one box per ticked finding with no `file`/line. An unticked one is not listed. Its finding card shows "No diff line, so this posts in the summary comment above" instead of a box.
  - The submit label reads `post 3 comments + summary · Approve`.
  - Picking `comment` while `approve` is recommended shows "Drafted for approve. Check the summary still reads right." under the summary (Review Focus #3).
  - Without `editable`, the sheet matches today's, and the existing tests stay green.
- [ ] **Step 3: Run** `cd apps/board && bun test src/client/board/__tests__/review-drafts.test.ts src/client/board/__tests__/review-gate-sheet-dom.test.tsx`. Expected: the new cases FAIL.
- [ ] **Step 4: Implement.** Follow mock B15 "A · gate". Use existing `tui-*` classes and role tokens (`docs/apps/ui-authoring.md`), no raw hex. Submit is disabled while `draftEdits` is null.
- [ ] **Step 5: Run** those files, `review-gate.test.ts`, `review-routing-dom.test.tsx`, `decision-queue-dom.test.tsx`, and `bun run board:typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `board: review sheet shows and edits drafted comments`.

### Task 8: Gallery face, capture baseline, eyes on it

**Files:**
- Modify: `apps/board/src/client/board/gate-gallery.fixtures.ts`. Add `reviewPostDrafted` beside `reviewPost` (:1080): `editable: true`, comments on every finding, one finding with no anchor, invented text.
- Modify: `apps/board/src/client/board/GateGallery.stories.tsx:154-170`. Add `ReviewPostDrafted`.
- Modify: `apps/board/tests/fixture/data.json` (or the fixture gate source the capture uses) so the captured review sheet carries drafts.
- Regenerate: `apps/board/tests/baselines/*`.

- [ ] **Step 1: Add the fixture and story.**
- [ ] **Step 2: Run** `bun run storybook` (root). Open `http://localhost:6006/iframe.html?id=gates-board-gallery--review-post-drafted&viewMode=story` in Fast Browser at 1440×900, and screenshot light and dark. Compare against B15 "A · gate", and state plainly what reads wrong.
- [ ] **Step 3: Run** `cd apps/board && bun run capture:compare`. Expected: only the review sheet shots differ. Then run `bun run capture:baseline`, and check them by eye.
- [ ] **Step 4: Commit** `board: gallery face and baselines for drafted review comments`.

### Task 9: The review verb drafts before the gate and posts word for word

**Before editing:** load `superpowers:writing-skills`, `mattstack:editing-skills` and `mattstack:process-digraphs`. Every touched digraph passes `plugin/skills/process-digraphs/test-check-dot.sh`.

**Files:**
- Modify: `plugins/mattstack/attachments/review-core-body-tail/SKILL.md`. In "Structured findings file" (:24-101), document `findings[].comment` and `summary.comment` as the exact text that posts, written in the loaded writing-style voice; still version 3. Update the quick reference (:121).
- Modify: `plugins/mattstack/attachments/review/review/SKILL.md`
  - `Assemble the review draft` :578: write each comment and the summary line into the json; the writing-style skill loads before this step
  - `Write review-post.extras.json` :620-651: `editable: true`
  - `Caller handed a decided selection…` :470-485: accept `texts` and `summaryText`
  - `Compose the submitted review` :732-755:
    - each body is the answer's `texts[id]`, else the `comment` in `review-post.source.json` (the source the gate opened with)
    - the summary is the outcome's `text`, else `summaryComment` from the same source
    - never rewritten
  - `This review already on the MR?` :757-775: `contains:` uses the first line of the body actually sent
  - `Move the bad-anchor findings into the summary` :777-781: body word for word, plus `file:line`
  - the 100-cap sentence: overflow findings post their draft word for word in the summary
  - GitHub `gh pr review` :934-940: the summary line, then each selected finding's text word for word with its `file:line`
  - remove "note steers wording"
- Modify: `plugins/mattstack/attachments/review-posting/SKILL.md:128-135`. The tacit-approval rule applies when drafting, never to text a human saw.
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (version one past main's), `CERTIFICATION.md` (row), `docs/superpowers/tests/2026-10-17-digraph-ids/slugs/review.json` if node labels change, `README.md:192-220` if it describes Compose
- Test: `sh plugins/mattstack/tests/certify.sh`, the digraph check, the review shell suites

- [ ] **Step 1: RED baseline** per `superpowers:writing-skills`. A subagent follows today's verb against `findings-v3-drafts.json` with an answer carrying `texts`. Record that it rewrites the bodies.
- [ ] **Step 2: Edit the skill text** as listed.
- [ ] **Step 3: GREEN.** Rerun the scenario. The `mr_review_submit` call carries the edit for `f1`, the drafts for the rest, and the outcome `text` as the summary line. Repeat for GitHub.
- [ ] **Step 4: Run** `sh plugins/mattstack/tests/certify.sh`, the digraph check, `bun test scripts/__tests__` and `bun scripts/ci/plugin-version-bumped.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `mattstack: review drafts comments before the gate and posts them verbatim`.

### Task 10: Board wrapper hands the edits to the poster

**Before editing:** load `superpowers:writing-skills` and `mattstack:process-digraphs`.

**Files:**
- Modify: `apps/board/skills-src/review/SKILL.md`
  - `Hand the answer to the domain skill to post` (:1105-1148): pass `texts` (the union of every `findings-N` answer's `texts`) and `summaryText` (the outcome answer's `text`) beside `{findings, outcome, replies, restored}`
  - :489-490: a note no longer steers wording when `review@1.editable` is true
  - `Record the verdict answer in --report` (:1002-1016): one sentence saying `texts` rides in the envelope
- Regenerate: `apps/board/skills/` (`bun run skills:expand:board`)
- Test: `bun run skills:check:board`, `bun test lib/__tests__/no-board-skills-drift.test.ts`

- [ ] **Step 1: Edit `skills-src`.**
- [ ] **Step 2: Run** the expand, the check and the drift test. Expected: PASS.
- [ ] **Step 3: End-to-end check** under an isolated HOME (root `AGENTS.md`).
  - Run a fixture board and open its review gate in Fast Browser.
  - Edit a comment, approve, and confirm the stored answer carries `texts`.
  - Answer the same gate kind from a pane form, and confirm no comment text appears there.
  - Screenshot light and dark.
- [ ] **Step 4: Commit** `board: review wrapper hands drafted-comment edits to the poster`.
