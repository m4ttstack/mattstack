# Latch Animated States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The re-review latch shows where its follow-up review is (armed, queued, running, error, done) with a per-MR animated GIF strip, and the latch pass queues, retries and lands follow-ups instead of refusing them.

**Architecture:** A new `latch_state` table in the board's state db is the latch's record; the GitLab note is its projection, rewritten after each compare-and-set transition. `banner.ts` composites committed text strips with the MR's invadr animated frame by frame and encodes a GIF with `gifenc`. The cron latch pass drives queue, dispatch, error and retry; the server and the pass share one `landFollowUp` for done.

**Tech Stack:** Bun, TypeScript, bun:sqlite, pngjs, gifenc, invadrs 1.3.1 (`resolveInvadr`), Playwright (build-time only), `@mattstack/glance` (GitLab writes, `MRDetailFetcher`).

**Spec:** `apps/board/docs/superpowers/specs/2026-10-29-latch-animated-states-design.md`

## Global Constraints

- Banner: 1040x128 px GIF, posted as `![<title>](<url>){width=520}`; background `#2a2638`; title Silkscreen 18 `#ece8f4` letter-spacing 1; subtitle IBM Plex Mono 13 `#b7b0c8`; layout in CSS px at 2x: left padding 14, creature box 45x33, gap 10, right padding 24.
- Accents: armed `#f08fb0`, queued `#e6b860`, running `#7fbfe8`, error `#f2917e`, done-comments `#b9a0f2`, approved and done-approved `#86cfa0`, superseded `#8e88a0`. Eye cells `#ece8f4`. Ring unlit `#5d5775`, tail `accent + 'e0'` then `accent + 'b0'`.
- Each GIF under 80 KB.
- Detection stays marker-only; first line; `v1` family. New markers exactly: `<!-- mattstack:board re-review-latch v1 queued -->`, `<!-- mattstack:board re-review-latch v1 running -->`, `<!-- mattstack:board re-review-latch v1 error -->`.
- One author request never launches two reviews.
- Thread replies only on: follow-up finished (comments or approved) and stuck. No "Follow-up review started" reply. Hard refusals keep today's "Not yet" reply.
- Stuck always calls `notifyEscalation(..., 'rt', ...)`, whatever `triage.notify` says.
- Stuck after 3 failed attempts in one request cycle.
- All copy is verbatim from the spec's state table and wait-reason lists.
- Run board tests from `apps/board` (`bun test <file>`); the root run skips the board preload. Run only the targeted files locally.
- Invented names only in tests and fixtures (the repo is public).

## Review Focus

- A stale daemon read shows the note as `queued` or `armed`+resolved after the row says `running`: no second launch, no banner rewrite back. (Task 6 test `stale note never re-requests a running latch`.)
- The cron pass and the server both try to land the same follow-up: exactly one reply and one note rewrite. (Task 8 test `landFollowUp is idempotent across server and pass`.)
- A latch posted before this change (no row, old PNG body, old `![re-review latch](...)` image without `{width=...}`) keeps working and upgrades on its next transition. (Task 6 test `pre-change latch with no row is adopted`.)
- A review parked for hours at its post gate (`reviewing`) is never treated as failed. (Task 7 test `long reviewing is still running`.)
- Approval by the reviewer in GitLab while the latch is queued, running or error spends it with the Approved strip and launches nothing. (Task 6 test `own approval spends from every phase`.)

---

### Task 1: New latch markers in rt-client

**Files:**
- Modify: `packages/rt-client/src/latch.ts`
- Modify: `packages/rt-client/src/index.ts:266`
- Test: `packages/rt-client/src/__tests__/latch.test.ts`
- Modify: `apps/board/src/latch/markers.ts` (re-exports)

**Interfaces:**
- Produces: `LATCH_MARKER_QUEUED`, `LATCH_MARKER_RUNNING`, `LATCH_MARKER_ERROR` (strings, verbatim from Global Constraints); `type LatchKind = 'armed' | 'queued' | 'running' | 'error' | 'spent'`; `latchKindOf(body)` returns the new kinds.

- [ ] **Step 1: Write the failing tests** in `latch.test.ts`: `latchKindOf` returns `'queued'`, `'running'`, `'error'` for bodies whose first line is the new marker; returns `null` when the marker is on line 2; `'v2 running'` returns `null`.
- [ ] **Step 2: Run** `bun test packages/rt-client/src/__tests__/latch.test.ts` from the repo root. Expected: FAIL (new markers undefined).
- [ ] **Step 3: Implement** the three constants and the widened `latchKindOf`; export them from `index.ts` beside the existing two; re-export from `apps/board/src/latch/markers.ts`.
- [ ] **Step 4: Run** the test. Expected: PASS. Then `bun test lib/mcp` targeted file covering `mr-read-tools` if one exists, to confirm resolved-first dropping is unchanged.
- [ ] **Step 5: Commit** `rt-client: queued, running and error latch markers`.

### Task 2: The latch state table

**Files:**
- Modify: `apps/board/src/state/db.ts` (SCHEMA_VERSION 6 → 7, migration v7)
- Create: `apps/board/src/latch/latch-state.ts`
- Test: `apps/board/src/__tests__/latch-state.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LatchPhase = 'armed' | 'queued' | 'running' | 'error' | 'spent';
  export type WaitReason = 'next-sweep' | 'cooldown' | 'budget' | 'review-in-flight';
  export interface LatchRow {
    mrUrl: string; discussionId: string; rootNoteId: number;
    phase: LatchPhase; wait: WaitReason | null;
    launchAt: number | null;   // ms; the follow-up this latch waits on started at or after this
    failures: number; stuck: boolean; updatedAt: number;
  }
  readLatchRow(mrUrl: string, db?: Database): LatchRow | null
  readLatchRows(db?: Database): LatchRow[]
  /** Inserts or replaces the row; for adoption and first post only. */
  putLatchRow(row: LatchRow, db?: Database): void
  /** Applies `patch` only while the row's phase is in `from`; true when it moved. */
  casLatch(mrUrl: string, from: LatchPhase[], patch: Partial<Omit<LatchRow, 'mrUrl'>>, now: number, db?: Database): boolean
  cachedUpload(mrUrl: string, variantKey: string, db?: Database): string | null
  rememberUpload(mrUrl: string, variantKey: string, markdown: string, db?: Database): void
  ```
- Tables: `latch_state (mr_url TEXT PRIMARY KEY, discussion_id TEXT NOT NULL, root_note_id INTEGER NOT NULL, phase TEXT NOT NULL, wait TEXT, launch_at INTEGER, failures INTEGER NOT NULL DEFAULT 0, stuck INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)` and `latch_uploads (mr_url TEXT NOT NULL, variant TEXT NOT NULL, markdown TEXT NOT NULL, PRIMARY KEY (mr_url, variant))`. One row per MR: this board is one reviewer.

- [ ] **Step 1: Write failing tests** (temp db the way `state-db.test.ts` does): `casLatch moves only from a listed phase` (row `queued`, `casLatch(..., ['armed'], {phase:'running'})` returns false and phase stays `queued`; with `['queued']` returns true); `two cas racing from the same phase, only one wins`; `upload cache round-trips per variant`; `migration takes a v6 db to v7` (user_version 7, both tables exist).
- [ ] **Step 2: Run** `bun test src/__tests__/latch-state.test.ts` from `apps/board`. Expected: FAIL.
- [ ] **Step 3: Implement** the migration (append to `MIGRATIONS`, bump `SCHEMA_VERSION` to 7, comment in the existing `// vN:` style) and `latch-state.ts` in the `respond-rounds.ts` accessor style (default `db = getStateDb()`). `casLatch` is one `UPDATE ... WHERE mr_url = ? AND phase IN (...)` checked by `changes`.
- [ ] **Step 4: Run** the test and `bun test src/__tests__/state-db.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `board: latch_state and latch_uploads tables`.

### Task 3: Banner variants, copy and committed strips

**Files:**
- Create: `apps/board/src/latch/variants.ts`
- Modify: `apps/board/scripts/build-latch-band.ts` (renders every variant)
- Create: `apps/board/assets/latch/*.png` (generated, committed)
- Test: `apps/board/src/__tests__/latch-variants.test.ts`

**Interfaces:**
- Consumes: `WaitReason` (Task 2).
- Produces:
  ```ts
  export type BannerState = 'armed' | 'queued' | 'running' | 'error-retrying' | 'error-stuck'
    | 'done-comments' | 'done-approved' | 'approved' | 'superseded';
  export interface BannerVariant { state: BannerState; wait?: WaitReason; count?: number | null }
  export type Indicator = 'none' | 'dots' | 'ring';
  export interface VariantCopy { title: string; sub: string; accent: string; indicator: Indicator; sentence: string }
  variantKey(v: BannerVariant): string          // e.g. 'queued-cooldown', 'done-comments-3', 'done-comments-20plus', 'done-comments-none'
  copyFor(v: BannerVariant): VariantCopy
  allVariantKeys(): string[]                    // every strip the build script renders
  ```
- Copy: titles and subtitles verbatim from the spec. Done-comments: count 1 → `1 new comment. Resolve when ready`; 2..20 → `N new comments. Resolve when ready`; >20 → `20+ new comments. Resolve when ready`; 0 or null → `Review posted. Resolve when ready`. Error-retrying subtitles by wait: next-sweep `Retrying on the next sweep`, cooldown `Retrying after the cooldown`, budget `Daily limit hit; retrying tomorrow`. Queued by wait: next-sweep `Starts on the next sweep`, cooldown `Waiting out the cooldown`, budget `Daily limit hit; starts tomorrow`, review-in-flight `Waiting for the running review`.
- `sentence` is the plain body line under the image: armed keeps today's `ARMED_COPY`; approved and superseded keep `SPENT_COPY` and `DUPLICATE_COPY`; queued `Follow-up review requested. I'll start it as soon as I can.`; running `Follow-up review in progress. I'll reply here when it's done.`; error-retrying `The follow-up review didn't finish. I'll try again.`; error-stuck `The follow-up review didn't finish after 3 tries. The reviewer has been told.`; done-comments `Follow-up review done. Resolve this thread again when you've addressed the new comments.`; done-approved `Follow-up review done and approved, so this latch is spent.`

- [ ] **Step 1: Write failing tests**: `variantKey` is unique across `allVariantKeys()`; each copy row matches the spec strings above; `allVariantKeys()` has every queued and error wait, done-comments 1..20, `20plus` and `none`; indicator is `dots` for queued and error-retrying, `ring` for running, else `none`.
- [ ] **Step 2: Run** `bun test src/__tests__/latch-variants.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `variants.ts`; rewrite `build-latch-band.ts` to loop `allVariantKeys()` and screenshot each 520x64 strip at `deviceScaleFactor: 2` into `assets/latch/<key>.png`, leaving the creature box (x 14..59) and, for `dots`, the 3 dot slots after the title, and for `ring`, a 22x22 box at the right padding empty. Record the dot slot origin per key by measuring the title's right edge in the page and writing `assets/latch/layout.json` (`{ [key]: { dotsX: number, dotsY: number } }`, in 2x px).
- [ ] **Step 4: Run** `bun run scripts/build-latch-band.ts` (needs network for Google Fonts) then the test. Expected: PASS; `assets/latch/` holds one PNG per key plus `layout.json`.
- [ ] **Step 5: Commit** `board: latch banner variants and their committed text strips`.

### Task 4: The animated GIF compositor

**Files:**
- Modify: `apps/board/src/latch/banner.ts` (replace `latchBannerPng`)
- Modify: `package.json` root catalog (`"gifenc": "1.0.3"`) and `apps/board/package.json` (`"gifenc": "catalog:"`)
- Test: `apps/board/src/__tests__/latch-banner.test.ts` (rewrite)

**Interfaces:**
- Consumes: `BannerVariant`, `variantKey`, `copyFor` (Task 3); `resolveInvadr(mrUrl, { accent: true })` from invadrs.
- Produces: `latchBannerGif(mrUrl: string, variant: BannerVariant, assetDir?: string): Uint8Array`; `GIF_W = 1040`, `GIF_H = 128`; `legShuffle(grid: boolean[][]): boolean[][]` (exported for tests).

Frame plans (delay ms; `legs` 0 = grid, 1 = `legShuffle(grid)`; `dx`/`dy` in sprite cells; one cell = 6 px at 2x):
- armed: (0,900) (1,900) (0,900) (0 blink,140) (0,700) (1,900)
- queued: 8 frames of 420 ms, dots 0,1,2,3,0,1,2,3, legs 0 for the first 4 then 1, blink on the last
- running: 8 frames of 130 ms, `dx` 0,1,2,1,0,-1,-2,-1, legs alternate, ring head at index i (clockwise from top-left, 8 cells of 12 px with 4 px gaps in a 3x3 square, centre empty)
- error-retrying and error-stuck: (dx0,700) (dx1 legs1,70) (dx-1,70) (dx1 legs1,70) (dx0,500) (600) (blink,140) (600); retrying also ticks dots 1,1,2,2,2,3,3,0
- done-comments, done-approved, approved: (900) (dy1 legs1,90) (dy2 legs1,140) (dy1 legs1,90) (220) (900) (blink,140) (900); the approved two draw three `#ece8f4` sparkle cells at sprite cells (0,-3), (7,-5), (14,-2) on frames 3-5
- superseded: one frame

`legShuffle` (generic for all 16 creatures): copy the grid; in its bottom two rows move each filled cell one column toward the vertical centre line (left half +1, right half -1, centre column stays), dropping a move onto an already-filled target.

- [ ] **Step 1: Write failing tests**: `encodes a 1040x128 GIF for every variant key` (parse width/height from GIF bytes 6..9 little-endian); `frame count matches the plan` (count `0x2C` image descriptors via a small parser, or `gifenc` frame log); `every GIF is under 80 KB`; `deterministic for one MR`; `differs between MRs`; `legShuffle changes the bottom rows of all 16 INVADR_SPRITES and nothing above them`; `paints the creature in the variant accent` (decode frame 0 with a minimal LZW-free check: sample the palette index at a known creature cell and compare its palette colour).
- [ ] **Step 2: Run** `bun test src/__tests__/latch-banner.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**: read the variant's strip with pngjs once per call; per frame copy it, paint creature cells (6x6 px each, origin x 28 + (2+dx)*6, y centred in 128 minus dy*6), eye cells from `accent.cells`, dots (8x8 px, 4 px apart, at `layout.json`'s origin), ring (as above); `quantize` one global 256-colour palette from all frames concatenated; `applyPalette` per frame; `GIFEncoder().writeFrame(index, GIF_W, GIF_H, { palette (first frame only), delay, repeat: 0 })`. Keep the existing `with { type: 'file' }` import pattern for the asset directory so the compiled binary embeds it; remove `latchBannerPng`, `BAND_W`, `BAND_H` and `assets/latch-band.png`.
- [ ] **Step 4: Run** the test. Expected: PASS. Run `bun run board:typecheck` from the repo root. Expected: clean.
- [ ] **Step 5: Commit** `board: animated latch banner GIFs from committed strips`.

### Task 5: Bodies and the rewrite write

**Files:**
- Modify: `apps/board/src/latch/markers.ts`
- Modify: `apps/board/src/latch/post.ts`
- Test: `apps/board/src/__tests__/latch-markers.test.ts`, `apps/board/src/__tests__/latch-post.test.ts`

**Interfaces:**
- Consumes: Task 1 markers; Task 2 `cachedUpload`/`rememberUpload`; Task 3 `variantKey`/`copyFor`; Task 4 `latchBannerGif`.
- Produces:
  ```ts
  latchBody(phase: LatchPhase, imageMarkdown: string, sentence: string): string   // marker line, blank, image, blank, sentence
  imageMarkdownFor(title: string, markdownFromUpload: string): string             // '![title](url){width=520}'
  imageMarkdownOf(body: string): string | null                                    // also matches a trailing {width=N}
  bannerMarkdown(gw: LatchGateway, projectId: number, mrUrl: string, iid: number, variant: BannerVariant): Promise<string>  // upload cache first
  rewriteLatch(gw: LatchGateway, t: LatchTarget, phase: LatchPhase, variant: BannerVariant, thread: 'resolve' | 'unresolve' | 'keep'): Promise<void>
  interface LatchTarget { projectId: number; projectPath: string; iid: number; mrUrl: string; discussionId: string; rootNoteId: number }
  ```
  `postLatch` keeps its signature, posts the `armed` variant through `bannerMarkdown`, and returns `{ discussionId, rootNoteId }`. `spendLatch` keeps rewrite-before-resolve ordering and takes a `BannerVariant` (`approved`, `done-approved` or `superseded`).
- `rewriteLatch` ordering: rewrite the body first, then change the thread; a crash between leaves the phase visible on the note and the row decides recovery.

- [ ] **Step 1: Write failing tests**: `latchBody` puts each phase's marker on line 1 and `latchKindOf` reads it back; `imageMarkdownOf` finds `![x](/uploads/a/b.gif){width=520}` and the old `![re-review latch](/uploads/a/b.png)`; `bannerMarkdown uploads once per variant` (second call with the same key makes no `uploadFile` call); `rewriteLatch writes the note before unresolving` (recorded gateway call order).
- [ ] **Step 2: Run** the two test files. Expected: FAIL.
- [ ] **Step 3: Implement**; upload filename `latch-<iid>-<variantKey>.gif`, content type `image/gif`.
- [ ] **Step 4: Run** both files plus `latch-review-step.test.ts`. Expected: PASS (update fixtures that asserted the PNG upload).
- [ ] **Step 5: Commit** `board: latch bodies per phase and the banner rewrite`.

### Task 6: The pass queues and dispatches

**Files:**
- Modify: `apps/board/src/triage/latch.ts`
- Modify: `apps/board/src/latch/discussions.ts` (`hasArmedLatch` → `hasLiveLatch`: any kind but `spent`)
- Test: `apps/board/src/__tests__/triage-latch.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 5.
- Produces: `LatchPassDeps` gains `readLatchRow`, `casLatch`, `putLatchRow` (default to the Task 2 functions in `bin/triage.ts`). `waitReasonOf(decisionReason: string): WaitReason | null` (`cooldown` → cooldown, `budget-exhausted` → budget, `review-in-flight` → review-in-flight, else null).

Per MR, after the existing spent and approval steps (which still win, from every phase, using `approved` strip):
1. No row but a live latch on the note: adopt it with `putLatchRow` from the note's kind.
2. Row `armed`, note shows a request: `decideRequest` as today. `dispatch` → launch, `casLatch(['armed'], {phase:'running', launchAt: now, wait: null})`, `rewriteLatch(..., 'running', 'keep')`, charge memory as today, no reply. Wait-able reason → `casLatch(['armed'], {phase:'queued', wait})`, rewrite to the queued variant for that wait, keep resolved, no reply, no notify. Other reasons → today's refusal path unchanged.
3. Row `queued`: if the review is `queued` or `reviewing` → `casLatch(['queued'], {phase:'running', launchAt: review.startedAt})` and rewrite (any review satisfies). Else re-decide: dispatch as in 2 from `['queued']`; a changed wait reason rewrites the strip; same reason touches nothing. Note reopened by the author → `casLatch(['queued'], {phase:'armed'})`, rewrite armed, no reply.
4. Row `running`, `error` or `queued` is never a request, whatever the note shows.
5. `consume`'s duplicate spends (`reason 'duplicate'`) use the `superseded` variant; approval spends use `approved`.
6. The pass's scope check widens: an MR with a row in `queued`, `running` or `error` is processed whatever its review status (today only `done` states are).

- [ ] **Step 1: Write failing tests**: `cooldown queues instead of replying Not yet` (no `createNote`; note rewritten with the queued marker and `queued-cooldown` upload; row `queued`); `queued dispatches when the block clears` (row `running`, one launch, no reply); `wait reason change swaps the strip`; `a hand-launched review satisfies a queued request` (review `reviewing`, no launch, row `running`); `stale note never re-requests a running latch` (row `running`, note armed+resolved: no launch, no rewrite); `author reopening a queued latch withdraws it`; `pre-change latch with no row is adopted`; `own approval spends from every phase` (queued, running, error rows; `approved` strip; no launch); `no-commented-review still refuses with Not yet`.
- [ ] **Step 2: Run** `bun test src/__tests__/triage-latch.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** in `runLatchPass`; keep the per-MR try/catch and audit entries (`event: 'latch'`, actions `queued`, `dispatched`, `withdrawn`, `adopted`).
- [ ] **Step 4: Run** the file plus `latch-discussions.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `board: latch pass queues blocked follow-ups and dispatches from the queue`.

### Task 7: Error, retry and stuck

**Files:**
- Modify: `apps/board/src/triage/latch.ts`
- Test: `apps/board/src/__tests__/triage-latch.test.ts`

**Interfaces:**
- Consumes: Task 6.
- Produces: `LatchPassDeps.notifyStuck(title: string, message: string, mrUrl: string): Promise<void>`; `export const LATCH_MAX_FAILURES = 3`.

Rules:
- Row `running` and review `error`, or launch returned `kind: 'error'` → failures + 1. Below 3: `casLatch(['running', 'queued', 'armed', 'error'], {phase:'error', failures, wait})`, rewrite `error-retrying` with the current wait, keep resolved, no reply. At 3: also `stuck: true`, rewrite `error-stuck`, post the stuck reply (`variants` sentence for error-stuck), call `notifyStuck` once.
- Row `error`, not stuck: re-decide like queued; dispatch → `running` (retry), a launch charges memory like any launch.
- Row `error`, stuck: never dispatch; if the review becomes `queued` or `reviewing` → `running` with `launchAt: review.startedAt`, `stuck: false` (failures kept until it lands).
- Review `reviewing` for any length of time is running (post gate parks count as alive).

- [ ] **Step 1: Write failing tests**: `review error moves running to error-retrying` (no reply); `retry dispatch returns error to running and charges memory`; `launch-failed counts as a failure`; `third failure is stuck: one reply, one notifyStuck, no more launches` (run the pass twice more: still no launch, no second reply); `relaunch from the board clears stuck`; `long reviewing is still running` (review `reviewing`, `startedAt` 6 h ago: row stays `running`, no rewrite); `retry blocked by budget shows the budget wait`.
- [ ] **Step 2: Run** the file. Expected: new tests FAIL.
- [ ] **Step 3: Implement**; audit actions `error`, `retried`, `stuck`, `recovered`.
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit** `board: latch retries failed follow-ups and stops after three`.

### Task 8: Landing a follow-up (server and pass)

**Files:**
- Create: `apps/board/src/latch/land.ts`
- Modify: `apps/board/src/latch/review-step.ts`
- Modify: `apps/board/src/server.ts` (the latch step at the `signal.kind === 'review'` block, ~line 4911)
- Modify: `apps/board/src/triage/latch.ts` (backstop)
- Test: `apps/board/src/__tests__/latch-land.test.ts`, `apps/board/src/__tests__/latch-review-step.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 5.
- Produces:
  ```ts
  export interface LandInput {
    target: LatchTarget; outcome: 'comment' | 'approve' | null;
    reviewStartedAt: number; gateway: LatchGateway; self: string;
    countNew: () => Promise<number | null>;   // reviewer's discussions created at or after launchAt, fresh from GitLab
    now: number;
  }
  landFollowUp(i: LandInput): Promise<'landed' | 'not-mine' | 'none'>
  ```
- Rules: only when the row is `running` (or `error` with a review that reached done) and `reviewStartedAt >= row.launchAt`. `comment` → `casLatch(['running','error'], {phase:'armed', failures:0, stuck:false, wait:null, launchAt:null})`, rewrite `done-comments` with `count`, unresolve, post the finished reply (`Follow-up review done: N new comments.` / `Follow-up review done.` when count is 0 or null). `approve` → cas to `spent`, `spendLatch` with `done-approved`, finished reply `Follow-up review done: approved.`. `null` (abandoned) → cas to `armed`, rewrite plain `armed`, unresolve, no reply. A lost cas returns `'none'` and writes nothing.
- `countNew` in the server and in `bin/triage.ts` uses `new MRDetailFetcher(host, token).fetchDetail(projectId, iid)` and counts discussions whose root note author is `self`, created at or after `launchAt`, excluding latch discussions and system notes.
- `applyReviewLatch` posts a fresh armed latch only when `!hasLiveLatch(latches)` and no row is live; a done review with a `running` row goes through `landFollowUp` instead.

- [ ] **Step 1: Write failing tests**: `comment lands as done-comments with the count and reopens`; `count null shows Review posted`; `approve spends with done-approved and one reply`; `abandoned review re-arms quietly`; `landFollowUp is idempotent across server and pass` (call twice with the same row: one rewrite, one reply, second returns `'none'`); `a review that started before launchAt does not land`; `review step never posts a duplicate beside a queued latch`.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement** `land.ts`; call it from the server's latch step for `status === 'done'` (with or without outcome) and from the pass when it sees a `running` row whose review is `done`.
- [ ] **Step 4: Run** both files and `triage-latch.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `board: land follow-up reviews on the latch from the server or the pass`.

### Task 9: Wiring, scope and the visual check

**Files:**
- Modify: `apps/board/bin/triage.ts` (deps, scope, `notifyStuck`, `countNew`)
- Create: `apps/board/scripts/preview-latch-banners.ts`
- Modify: `apps/board/docs/superpowers/specs/2026-09-01-re-review-latch-design.md` (a one-line pointer to the new spec at the top)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1:** In `bin/triage.ts`, extend `fetchLatchMrs`'s `inScope` with `readLatchRows()` phases `queued | running | error`; pass `readLatchRow`, `casLatch`, `putLatchRow`, `countNew`, and `notifyStuck` (calls `notifyEscalation(title, message, 'rt', { url })` with the same board link the existing `notify` builds, ignoring `triage.notify`).
- [ ] **Step 2:** Write `preview-latch-banners.ts`: for one invented MR URL, write `latchBannerGif` for every `allVariantKeys()` entry into a temp dir plus an `index.html` showing each at 520 px inside a GitLab-like comment card, once on `#fbfafd`/`#ffffff` and once on `#18171d`/`#232128`; print the path.
- [ ] **Step 3: Run** the preview script, open the page in Fast Browser, screenshot both schemes, and look: every strip readable, nothing clipped, the ring visible, dots after the title, creature not touching the text. Fix anything that reads wrong before continuing.
- [ ] **Step 4: Run** `bun test src/__tests__/latch-*.test.ts src/__tests__/triage-latch.test.ts` from `apps/board`, `bun test packages/rt-client/src/__tests__/latch.test.ts` from the root, and `bun run board:typecheck`. Expected: all pass.
- [ ] **Step 5: Commit** `board: wire the latch states into triage and add the banner preview`.
