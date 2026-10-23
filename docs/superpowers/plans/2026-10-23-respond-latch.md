# Respond Knows the Re-review Latch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triage stops seeing re-review latch threads, and the board's respond-post sheet offers a board-only "ask for a re-review once posting finishes" option that the board's server acts on when the run reports done.

**Architecture:** The latch marker moves to `packages/rt-client` so rt and the board share it. rt's `filterHumanThreads` drops latch threads, so every triage path stops seeing them. The board sheet sends the ticked latch thread ids beside the gate answer; the board server stores them on the MR's respond state and resolves them from `handleAgentSignal` when the respond run reports `done`.

**Tech Stack:** Bun, TypeScript, React (board client), bun:test (rt), vitest (board).

**Spec:** `docs/superpowers/specs/2026-10-23-respond-latch-design.md`

## Global Constraints

- No em or en dashes in UI text, comments or commit messages.
- Comments only where they state a constraint the code cannot show.
- rt tests run from the repo root (`bun test <path>`); board tests from `apps/board` (`bunx vitest run <path>`).
- Any change under `plugins/mattstack` bumps `plugins/mattstack/.claude-plugin/plugin.json`'s version one past main's.
- After an MCP tool description change: `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`.
- Public repo: invented names only in fixtures and stories.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Deviation from the spec (Matt to confirm at review)

The spec fires on "`done` with no `held`". `RespondState.held` counts replies the developer deliberately withheld at the posting gate, not failures, so gating on it would block a re-review whenever one reply was held back on purpose. A failed post never reports `done` (it goes to an off-script gate or `error`), so the plan fires on `done` alone and clears on `error`.

## Review Focus

- A stored re-review that outlives its run: a fresh respond launch on the same MR must clear `pendingReReview`, or the next run's `done` resolves a latch nobody ticked this time.
- A forged or stale id in the answer body: the server stores only ids that are an armed, unrequested latch on that MR in the current snapshot.
- A lost gate answer (409 conflict, or the gate already answered elsewhere): nothing is stored.
- The status CLI's later writes (`drafting`, `done`) must not wipe `pendingReReview` before it fires: `updateByHandle` merges defined fields only, and a test pins that.
- A resolve that throws for one latch must not stop the others or fail the signal handler; the field is cleared either way and the failure is logged.

---

### Task 1: Shared latch marker in rt-client

**Files:**
- Create: `packages/rt-client/src/latch.ts`
- Modify: `packages/rt-client/src/index.ts` (export it)
- Modify: `apps/board/src/latch/markers.ts` (import `LATCH_MARKER`, `LATCH_MARKER_SPENT`, `latchKindOf`, `LatchKind` from `@mattstack/rt-client` and re-export them; keep the body builders local)
- Test: `packages/rt-client/src/__tests__/latch.test.ts`

**Interfaces:**
- Produces: `LATCH_MARKER`, `LATCH_MARKER_SPENT` (the exact strings in today's `markers.ts`), `type LatchKind = "armed" | "spent"`, `latchKindOf(body: string): LatchKind | null` (first line only, spent checked first, unknown version is null).

- [ ] **Step 1:** Move the existing `latchKindOf` cases from `apps/board/src/__tests__/latch-markers.test.ts` into `latch.test.ts`: armed, spent, plain comment is null, a body carrying both markers reads spent, `v2` reads null, a marker on line two reads null.
- [ ] **Step 2:** `bun test packages/rt-client/src/__tests__/latch.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Create `latch.ts` with the moved code; export from `index.ts`; switch `markers.ts` to import and re-export.
- [ ] **Step 4:** `bun test packages/rt-client/src/__tests__/latch.test.ts`, then from `apps/board`: `bunx vitest run src/__tests__/latch-markers.test.ts src/__tests__/latch-discussions.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `rt-client: own the re-review latch marker`.

### Task 2: Triage drops latch threads

**Files:**
- Modify: `lib/mcp/mr-read-tools.ts` (`filterHumanThreads`, the `mr_threads` description)
- Modify: `plugins/mattstack/attachments/mcp-tools/reference.md` (regenerated), `plugins/mattstack/.claude-plugin/plugin.json` (version bump)
- Test: `lib/mcp/__tests__/mr-read-tools.test.ts`

**Interfaces:**
- Consumes: `latchKindOf` from Task 1.
- Produces: `filterHumanThreads` returns `dropped: { resolved, system, bot, latch }`.

- [ ] **Step 1: Write the failing tests** in the `filterHumanThreads` describe:
  - `test("drops an armed latch and counts it")`: an unresolved discussion whose root body is `` `${LATCH_MARKER}\n\nhi` `` is not in `discussions`; `dropped.latch === 1`.
  - `test("drops a spent latch")`: same with `LATCH_MARKER_SPENT`, unresolved.
  - `test("keeps a comment that quotes the marker below its first line")`: body `` `see\n${LATCH_MARKER}` `` is kept; `dropped.latch === 0`.
  - `test("a resolved latch counts as resolved, not latch")`.
- [ ] **Step 2:** `bun test lib/mcp/__tests__/mr-read-tools.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3:** In `filterHumanThreads`, after the resolved check and before the system check, `latchKindOf(first?.body ?? "")` non-null increments `dropped.latch`. Add to the `filter` description: "and drops mattstack re-review latch threads".
- [ ] **Step 4:** Rerun the test file. Expected: PASS. Regenerate `reference.md`; bump `plugin.json`.
- [ ] **Step 5:** Commit `mr_threads: unresolved-human drops re-review latch threads`.

### Task 3: The board stores a re-review pick with the gate answer

**Files:**
- Modify: `apps/board/src/respond-state.ts` (`RespondState.pendingReReview?: string[]`, the same key on `RespondPatch`, carried in `writeRespondState`'s insert)
- Create: `apps/board/src/latch/rereview.ts`
- Modify: `apps/board/src/server.ts` (`/gate/answer` body; `POST /respond`'s queued write)
- Test: `apps/board/src/__tests__/latch-rereview.test.ts`, `apps/board/src/__tests__/respond-state.test.ts`

**Interfaces:**
- Consumes: `reviewerLatches` output on the snapshot MR (`m.reviewerLatches`).
- Produces:
  - `parseReReview(body: unknown): string[]` (the `reReview` field when it is an array of non-empty strings, else `[]`).
  - `acceptedReReview(ids: string[], latches: ReviewerLatch[], person?: string): string[]` (ids that are an unrequested latch's `discussionId`, limited to `person`'s latch when one is given, case-insensitive).
  - The respond-state writes `pendingReReview: string[]`; an empty array means none.

- [ ] **Step 1: Write the failing tests:**
  - `acceptedReReview` keeps a matching unrequested id, drops an unknown id, drops a requested latch's id, and with `person: "Ana"` drops `bo`'s latch.
  - `parseReReview` returns `[]` for a missing field, a string, or an array holding a number.
  - In `respond-state.test.ts`: a row written with `pendingReReview: ["d1"]` keeps it across a later `writeRespondState(handle, { status: "done" })`; a write with `pendingReReview: []` clears it.
- [ ] **Step 2:** From `apps/board`: `bunx vitest run src/__tests__/latch-rereview.test.ts src/__tests__/respond-state.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the two functions and the state field. In `/gate/answer`, only on `result.kind === 'ok'`: find the respond state whose `gateId` is this `gateId`, its MR in `cache.get()`, and write `acceptedReReview(parseReReview(body), mr.reviewerLatches ?? [], state.person)` when non-empty. In the `POST /respond` queued write, pass `pendingReReview: []`.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `board: keep a respond-post re-review pick on the respond state`.

### Task 4: The board resolves the latch when respond finishes

**Files:**
- Modify: `apps/board/src/latch/rereview.ts`
- Modify: `apps/board/src/server.ts` (`handleAgentSignal`)
- Test: `apps/board/src/__tests__/latch-rereview.test.ts`

**Interfaces:**
- Produces: `settleReReview(status: string, pending: string[], resolve: (discussionId: string) => Promise<void>, clear: () => void, log: (msg: string) => void): Promise<void>`.

- [ ] **Step 1: Write the failing tests:**
  - `done` with `["d1","d2"]` resolves both, then clears.
  - `error` resolves nothing and clears.
  - `drafting` resolves nothing and does not clear.
  - `done` where `d1`'s resolve rejects still resolves `d2`, clears, and logs one line naming `d1`.
  - `done` with `[]` calls neither.
- [ ] **Step 2:** Run the test file. Expected: FAIL.
- [ ] **Step 3:** Implement `settleReReview`. In `handleAgentSignal`, for `signal.kind === 'respond'` with a `gitlabToken`, read `readRespondStates().get(signal.mrUrl)`, and call it with `resolve = id => latchGateway(config.gitlabHost, gitlabToken).resolveDiscussion(projectPathFromWebUrl(signal.mrUrl, config.gitlabHost) ?? '', signal.iid, id)` and `clear = () => writeRespondState(respondFilePath(signal.mrUrl), { status: state.status, pendingReReview: [] })`, inside a try/catch that logs, like the latch step above it.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `board: resolve a picked re-review latch once respond reports done`.

### Task 5: The respond-post sheet offers the option

**Files:**
- Modify: `apps/board/src/client/board/RespondSheet.tsx` (post sheet only)
- Modify: `apps/board/src/client/board/GateForm.tsx` (`submit` sends an optional `reReview`)
- Modify: the client respond lane type in `apps/board/src/data.ts` if it lacks `person`
- Modify: `apps/board/src/client/board/gate-gallery.fixtures.ts`, `GateGallery.stories.tsx`
- Test: `apps/board/src/client/board/__tests__/respond-sheet-dom.test.tsx` (or the existing respond-post DOM test file)

**Interfaces:**
- Consumes: `mr.reviewerLatches` (`{reviewer, discussionId, requested}`), `mr.respond?.person`.
- Produces: `submit(payload: { answers: GateAnswers; reReview?: string[] } | null, transformAnswers?)` posts `{ gateId, answers, reReview }` when `reReview` is non-empty.

- [ ] **Step 1: Write the failing DOM tests:**
  - A post gate on an MR with one unrequested latch from `bo` shows one unticked checkbox labelled `Ask bo for a re-review once posting finishes`.
  - Ticking it and submitting posts a body whose `reReview` is `["<bo's discussionId>"]`.
  - Not ticking it posts no `reReview` key.
  - A requested latch shows no checkbox; a plan gate shows none.
  - With `mr.respond.person` set to `ana`, `bo`'s latch shows no checkbox.
- [ ] **Step 2:** From `apps/board`: run the DOM test file. Expected: FAIL.
- [ ] **Step 3:** Render the checkboxes in the post sheet's main column after the reply cards, under a small "Re-review" heading, using the kit's checkbox the sheet already uses for post and resolve picks; carry the ticked ids into `form.submit`. The selection is local component state, not part of `form.selections`, so `sheetAnswers` and the gate's answer stay unchanged.
- [ ] **Step 4:** Rerun. Expected: PASS. Add a gallery story `respond-post with a re-review latch` and refresh affected baselines with `bun run capture:baseline` from `apps/board` only for intended diffs.
- [ ] **Step 5:** Open the story in Storybook (`localhost:6007`), screenshot light and dark, and say plainly what looks wrong.
- [ ] **Step 6:** Commit `board: respond-post sheet offers a board-only re-review`.
