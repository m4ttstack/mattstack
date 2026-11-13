# Codeowner tabs and the re-review latch on GitHub: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GitHub team's board gets codeowner tabs, an ask picker that
lists real code owners, and the re-review latch with its banner, with
GitLab unchanged.

**Architecture:** Tabs and owners are board-side switches over data the
daemon already syncs, plus one read verb. The latch keeps its whole state
machine. `LatchGateway` takes a per-MR target, a GitHub gateway runs over
`rtCommand`, and three new daemon verbs (and one glance method) cover the
GitHub writes nothing offered.

**Tech Stack:** Bun, TypeScript, React (board client), bun:sqlite (board
state), `@mattstack/glance`, `@mattstack/rt-client`, gh CLI (daemon only).

**Spec:** `docs/superpowers/specs/2026-11-12-board-github-tabs-latch-design.md`
(read it before any task; this plan argues from it).

## Global Constraints

- GitLab behaviour does not change: every GitLab glance call keeps its
  method, arguments, order and error text; GitLab tabs, demand, the
  approval_state read and the channel join are unchanged byte for byte.
  The existing GitLab tests stay green with only signature-shape edits.
- The board never holds a GitHub client or token: every GitHub read and
  write goes through `rtCommand` with the serialized repo identity
  (`repoIdentityField(mr.rtRepo)`).
- `latchGateway(...)` is only ever called as `latchGateway(gitlabOnly(config), token)`
  (`src/__tests__/no-hardcoded-forge.test.ts` enforces it).
- No new poll or interval. Every new request is one the spec's Request cost
  table lists.
- No test, fixture or browser check reaches a real PR, the real daemon or
  the real HOME. Board tests run from `apps/board` (`bun test <path>`),
  lib tests from the worktree root.
- Write fence: `apps/board/`, `lib/daemon/` (the three verbs only),
  `packages/rt-client/` (the `github.team` directory key and the three
  verbs' `commands.ts` entries only), `packages/glance/` (only in Task 11,
  only after the shepherd says glance is free), `docs/superpowers/`.
- Never read, print or stage `packages/glance/harness_credentials.json`.
  Stage named files only.
- Copy: forge-aware (PR on GitHub, MR on GitLab); rt:ui-copy for every
  string; no em or en dashes; no dot separators; kit primitives; no
  coloured border with a radius.
- Comments state only a constraint the code cannot show.
- Before touching `packages/rt-client/src/settings/registry-defs.ts`,
  `registry-schemas.ts` or `schema.lock.json`: `chat_dm` to
  `forge-copy-sweep.x5pq` saying which key is being added.
- Constants pinned by the spec: GitHub common banner set = armed,
  queued (next-sweep), running, done-comments (count null), done-approved,
  approved; identity cache 24 h; `mr:attach-upload` takes 1 to 10 files;
  staging under `~/.mattstack/evidence/board-latch/<random>/`, mode 0700.

## Review Focus

1. A GitHub tab typed `@Acme/Web` must match rows tagged `@acme/web` and
   the known owner `@acme/web`, and show no chip (Task 1 test
   `mixed-case GitHub tab matches lowercased tags and known owners`).
2. A directory `github.team` typed `acme/web` or `@ACME/web` must claim
   the owner `@acme/web` (Task 8 test `github.team matches without @ and
   in any case`).
3. A GitHub arm whose upload landed but whose thread post got no answer
   must not upload again on the next tick: the cached banners are reused
   (Task 4 test `a failed thread post reuses the cached batch next tick`).
4. A PR with two reviewers' latches, one requested and one not, re-requests
   only the requested reviewer, and never the author (Task 6 test `only
   the requested reviewer is re-requested`).
5. A machine with no `~/.mattstack/evidence` folder must still stage: the
   board creates it and its subfolder, and removes only its own subfolder
   afterwards (Task 3 test `staging creates a missing evidence folder and
   removes only its own subfolder`).

---

### Task 1: Codeowner tabs on GitHub

**Files:**
- Modify: `apps/board/src/sections.ts` (add `sectionKey`, forge-aware `sectionStatus`)
- Modify: `apps/board/src/data.ts:171-263` (`buildBoard` tag mapping), `:290-308` (`boardDemand`), `:366-415` (`aggregateSyncScope`)
- Modify: `apps/board/src/client/board/Board.tsx:1768-1783,2126-2140` (status calls, uncovered check, banner copy)
- Modify: `apps/board/src/client/board/TabBar.tsx:50-70` (chip and hint copy, new `forge` prop)
- Test: `apps/board/src/__tests__/sections.test.ts`, `apps/board/src/__tests__/board.test.ts` (or the file that already covers `buildBoard`/`boardDemand`/`aggregateSyncScope`; grep), a TabBar DOM test beside the existing ones in `src/client/board/__tests__/`

**Interfaces:**
- Produces: `sectionKey(forge: 'gitlab' | 'github', section: string): string`
  (lowercase on GitHub, identity on GitLab);
  `sectionStatus(section: string, known: string[] | null, forge?: 'gitlab' | 'github'): { unknown: boolean; suggestion: string | null }`
  (default `'gitlab'`, today's behaviour).

- [ ] **Step 1: Write the failing tests**
  - `sectionKey`: `('github', '@Acme/Web')` is `'@acme/web'`; `('gitlab', 'Acme - #pod-acme')` is unchanged.
  - `mixed-case GitHub tab matches lowercased tags and known owners`: `buildBoard` on a GitHub config with tab section `@Acme/Web` and `tags` `{pr: ['@acme/web']}` stamps `codeownerSections: ['@Acme/Web']` (the tab's own string, so `filterByTab` and `channelForMR` match unchanged); `sectionStatus('@Acme/Web', ['@acme/web'], 'github').unknown` is false.
  - GitLab `buildBoard` with a tab `Web` and tag `web` keeps nothing (exact match, as today).
  - `boardDemand` on GitHub with tabs `@Acme/Web` and `@acme/web` sends `codeownerSections: ['@acme/web']`; on GitLab it sends the sections exactly as today.
  - `aggregateSyncScope(reads, 'github')` keeps `knownSections` and `uncoveredSections`.
  - TabBar on GitHub renders "no such owner" with the tooltip naming the repo's CODEOWNERS; on GitLab "no such section" exactly as today.

- [ ] **Step 2: Run them and see them fail**

Run (from `apps/board`): `bun test src/__tests__/sections.test.ts src/__tests__/board.test.ts`
Expected: FAIL (`sectionKey` not exported; GitHub demand empty).

- [ ] **Step 3: Implement**
  - `buildBoard`: map each daemon tag through a `Map<sectionKey(forge, tabSection), tabSection>`; keep only mapped tags. Two GitHub tabs differing only by case are one owner, so only the first keeps rows; that is accepted.
  - `boardDemand`: drop the `forge.kind === 'gitlab'` condition; send deduped `sectionKey`'d sections.
  - `aggregateSyncScope`: drop both `forge === 'github'` exclusions.
  - `Board.tsx`: pass `data.forge ?? 'gitlab'` to `sectionStatus`; compare `scopeUncoveredSections` by `sectionKey`; on GitHub the banner reads along the lines of `no CODEOWNERS owner "@x"`, and the suggestion is its own element, never joined with `·` (GitLab banner unchanged). Pass `forge` to `TabBar`.
  - Final words by rt:ui-copy.

- [ ] **Step 4: Run the tests and see them pass**, plus `bun test src/__tests__/tab-picks.test.ts src/__tests__/fixture-github.test.ts`. The fixture's `data.json` is served as is, so its empty sections hold until Task 12; if an assertion there reads `aggregateSyncScope` output instead, update it here.

- [ ] **Step 5: Commit** `board: codeowner tabs name CODEOWNERS owners on GitHub (BOARD-66)`

### Task 2: The latch gateway takes a per-MR target (no behaviour change)

**Files:**
- Modify: `apps/board/src/latch/post.ts` (types and every function signature), `latch/gateway.ts`, `latch/land.ts`, `latch/review-step.ts`, `src/triage/latch.ts` (`LatchMrFacts.projectId: number | null`, every gateway call), `src/server.ts` (latch step and settle call sites), `bin/triage.ts` (`fetchLatchMrs`)
- Test: `src/__tests__/latch-post.test.ts`, `latch-land.test.ts`, `latch-review-step.test.ts`, `triage-latch.test.ts` (fake gateways move to the new shape)

**Interfaces:**
- Produces (in `latch/post.ts`):
  ```ts
  export interface LatchMr { projectId: number | null; projectPath: string; iid: number; rtRepo: string }
  export interface LatchFile { filename: string; bytes: Uint8Array; contentType: string; alt: string }
  export interface LatchGateway {
    forge: 'gitlab' | 'github';
    uploadFiles(mr: LatchMr, files: LatchFile[]): Promise<string[]>;
    createThread(mr: LatchMr, body: string): Promise<{ discussionId: string; rootNoteId: number } | null>;
    updateNote(mr: LatchMr, noteId: number, body: string): Promise<void>;
    resolveDiscussion(mr: LatchMr, discussionId: string): Promise<void>;
    unresolveDiscussion(mr: LatchMr, discussionId: string): Promise<void>;
    createNote(mr: LatchMr, body: string, discussionId?: string): Promise<{ id: number }>;
  }
  export type LatchTarget = LatchMr & { mrUrl: string; discussionId: string; rootNoteId: number };
  ```
  `postLatch(gw, mr: LatchMr & {mrUrl: string}, db?)` returns
  `{discussionId, rootNoteId}` (Task 4 widens it). `spendLatch`,
  `spendAllLatches`, `bannerMarkdown`, `postReplyDue`, `spendForApproval`
  take `mr: LatchMr & {mrUrl}` in place of `projectId, projectPath, mrUrl, iid`;
  `ReviewLatchStep` takes `mr: LatchMr` in place of `projectId`/`projectPath`/`iid`.
- `latchGateway(host, token)` (GitLab) returns the new shape with `forge: 'gitlab'`.
  It throws if `mr.projectId` is null.

- [ ] **Step 1: Move the fakes to the new shape and add a pinning test**: `gitlab gateway sends today's calls`. A fake `NoteMutator`/`GitLabProvider` records calls: `uploadFiles(mr, [file])` makes exactly one `uploadFile(projectId, filename, bytes, contentType)`; `createThread` makes `createDiscussion(projectId, iid, body)` and returns `{discussionId: d.id, rootNoteId: d.notes[0].id}`; `resolveDiscussion` makes `resolveDiscussion(projectPath, iid, id)`; `createNote` passes `discussionId` through.
- [ ] **Step 2: Run** `bun test src/__tests__/latch-post.test.ts` (from `apps/board`). Expected: FAIL on the new shape.
- [ ] **Step 3: Implement the signature change everywhere.** Logic, ordering and crash-recovery comments stay as they are. Inject the gateway factory into `latch/gateway.ts` (or accept fakes through parameters) so the pinning test needs no network.
- [ ] **Step 4: Run** every latch suite: `bun test src/__tests__/latch-*.test.ts src/__tests__/triage-latch.test.ts src/__tests__/no-hardcoded-forge.test.ts`, then `bun run typecheck` in `apps/board`. Expected: all PASS.
- [ ] **Step 5: Commit** `board: latch gateway takes a per-MR target`

### Task 3: The GitHub latch gateway and banner staging

**Files:**
- Create: `apps/board/src/latch/github-gateway.ts`, `apps/board/src/latch/stage.ts`
- Create: `apps/board/src/latch/board-gateway.ts` (picks a gateway by forge)
- Test: `apps/board/src/__tests__/latch-github-gateway.test.ts`, `latch-stage.test.ts`

**Interfaces:**
- Consumes: Task 2's `LatchGateway`, `LatchMr`, `LatchFile`.
- Produces:
  - `githubLatchGateway(deps?: { command?: typeof rtCommand; stage?: StageFn; timeoutMs?: number }): LatchGateway` with `forge: 'github'`.
  - `stageFiles(files: LatchFile[], opts?: { root?: string }): Promise<{ dir: string; paths: { path: string; name: string }[]; cleanup(): Promise<void> }>`. Default root is `join(process.env.HOME ?? homedir(), '.mattstack', 'evidence', 'board-latch')`, read at call time (Bun freezes `homedir()` at startup; see `src/app-root.ts`), so a test HOME is honoured. It makes a `mkdtemp` subfolder there, mode 0700, and writes each file under its `filename`.
  - `boardLatchGateway(config: BoardConfig, gitlabToken: string | null): LatchGateway | null`: GitLab with a token gives `latchGateway(gitlabOnly(config), token)`; GitHub gives `githubLatchGateway()`; anything else gives null.
  - `LATCH_GITHUB_TIMEOUT_MS = 120_000` (above the daemon's 90 s budget, as `FORGE_WRITE_TIMEOUT_MS`).

- [ ] **Step 1: Write the failing tests** with a fake `command` recording `(verb, payload)`:
  - `uploadFiles` sends `mr:attach-upload {repoName: mr.rtRepo, iid, files: [{path, name}]}` with each staged path; returns `![<alt>](<url>)` per file in input order; calls `cleanup` on success and when the verb fails.
  - `createThread` sends `mr:comment-file {repoName, iid, body}`; maps `{discussionId, noteId}` to `{discussionId, rootNoteId: noteId}`; maps `{fallback: 'no-files'}` to null.
  - `updateNote` gives `mr:note-update {repoName, iid, noteId, body}`; `resolveDiscussion` and `unresolveDiscussion` give `discussions:resolve {..., resolved: true|false}`; `createNote` gives `discussions:reply {repoName, iid, discussionId, body}` and returns `{id: data.noteId}`.
  - A daemon `{ok: false, error: 'Error: mr:comment-file failed: nope'}` throws an Error whose message is `nope` (use `forgeReason` from `src/forge-writes.ts`).
  - `staging creates a missing evidence folder and removes only its own subfolder`: with a temp `root` that does not exist, `stageFiles` creates it; `cleanup()` removes only the returned `dir`, and a sibling file in `root` survives.
  - `boardLatchGateway` returns null on GitLab with no token; its GitLab path calls `latchGateway(gitlabOnly(...))`.
- [ ] **Step 2: Run** `bun test src/__tests__/latch-github-gateway.test.ts src/__tests__/latch-stage.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.** `uploadFiles` maps returned `urls[name]` back to files by name; a missing URL throws.
- [ ] **Step 4: Run them again.** Expected: PASS. Also `src/__tests__/no-hardcoded-forge.test.ts`.
- [ ] **Step 5: Commit** `board: a GitHub latch gateway over daemon verbs`

### Task 4: GitHub latch behaviour: banners, copy, no-files

**Files:**
- Modify: `apps/board/src/latch/post.ts` (`bannerMarkdown` batch, `postLatch` result), `latch/variants.ts` (forge-aware sentences), `latch/markers.ts` (`ARMED_COPY` by forge), `latch/land.ts` (uncounted done on GitHub), `latch/review-step.ts` and `src/triage/latch.ts` step 0 (no-files)
- Create: `apps/board/src/latch/no-files.ts`
- Test: `latch-post.test.ts`, `latch-variants.test.ts`, `latch-land.test.ts`, `latch-review-step.test.ts`, `triage-latch.test.ts`

**Interfaces:**
- Consumes: Task 2 and Task 3 types.
- Produces:
  - `GITHUB_BANNER_SET: BannerVariant[]` (the six in Global Constraints).
  - `armedCopy(forge): string` (GitLab returns today's `ARMED_COPY` exactly); `copyFor(v, forge = 'gitlab')` passes the forge into the armed and done-comments sentences.
  - `postLatch(...)` returns `{ discussionId: string; rootNoteId: number } | { noFiles: true }`.
  - `recordNoFiles(mrUrl: string, runStamp: number, db?)` and `noFilesFor(mrUrl: string, runStamp: number, db?): boolean`, in kv namespace `latch-no-files`.
  - Audit action `'no-files'` on event `'latch'`.
  - `ReviewLatchStep.runStamp: number` and `ReviewLatchStep.appendAudit` (both required).

- [ ] **Step 1: Write the failing tests**
  - `a GitHub arm uploads the common set in one batch`: a GitHub fake gateway with an empty upload cache sees one `uploadFiles` call with six files (keys of `GITHUB_BANNER_SET`), then `createThread`; every key lands in `latch_uploads`.
  - A rare variant (`{state: 'error-stuck'}`) on GitHub uploads alone even with nothing cached; on GitLab every upload is one file, as today (the existing parity tests stay green).
  - `a failed thread post reuses the cached batch next tick`: `createThread` throws once; a second `postLatch` makes no `uploadFiles` call.
  - A GitHub comment landing writes the `done-comments` variant with `count: null` and still posts `Follow-up review done: 3 new comments.`; GitLab keeps the counted variant.
  - `armedCopy('github')` says "PR" where GitLab's says "MR"; the done-comments sentence likewise; GitLab strings equal today's literals.
  - No-files from `applyReviewLatch`: returns `'none'`, writes no latch row, records the memo with `runStamp`, and calls `appendAudit` with `{event: 'latch', action: 'no-files'}`; a second call with the same `runStamp` makes no `createThread` call; a new one tries again.
  - No-files from the pass's step 0: the same audit, memo and skip, keyed by `runStamp(review)`.
- [ ] **Step 2: Run** the five suites and `latch-markers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `bannerMarkdown` takes the gateway's `forge`. One rule: on GitHub, an uncached variant that is in `GITHUB_BANNER_SET` uploads with every other uncached member of that set, deduped by `variantKey`; any other variant uploads alone. The landing variant is chosen in `landFollowUp` from `i.gateway.forge`. `ReviewLatchStep` gains two required fields: `runStamp: number` (the finished lane's `runStamp`, which the server passes whether or not it vouches for the run; with no lane on file it passes the signal's `emittedAt`, so GitLab's arm path is unchanged) and `appendAudit(entry: AuditEntry): void`. The memo uses `runStamp`, never `reviewRunStartedAt`, which is null when the run is not vouched.
- [ ] **Step 4: Run** all latch suites again. Expected: PASS.
- [ ] **Step 5: Commit** `board: GitHub latch banners, copy and the no-files outcome`

### Task 5: Identity check and turning the latch on for GitHub

**Files:**
- Create: `apps/board/src/latch/identity.ts`, `apps/board/src/triage/latch-setup.ts`
- Modify: `apps/board/src/triage/forge-plan.ts`, `apps/board/bin/triage.ts:175-205,375-445`, `apps/board/src/server.ts` (latch step around `:5832`, settle around `:5925`)
- Test: `apps/board/src/__tests__/latch-identity.test.ts`, `apps/board/src/__tests__/triage-latch-setup.test.ts`, the existing `forge-plan` test (grep `triageForgePlan`), `src/__tests__/server-github-team.test.ts` (done-signal and settle cases against its fake daemon)

**Interfaces:**
- Consumes: `boardLatchGateway` (Task 3), the `postLatch` no-files result (Task 4).
- Produces:
  - `verifyLatchIdentity(repoName: string, self: string, deps?: { command?: typeof rtCommand; now?: () => number; db?: Database }): Promise<{ ok: true } | { ok: false; login: string | null }>`. A match (case-insensitive) is cached in kv `latch-identity` (key `repoName`, value `{login, at}`) for 24 h; a mismatch returns the daemon's `login`, a failure returns `login: null`, and neither is cached. Callers write the log line (both logins) and the audit.
  - `TriageForgePlan` swaps `asksAndLatch` for `asks: boolean; latch: boolean`.
  - `GITHUB_ASKS_SKIP` is the log line (respond asks only); `GITHUB_ASKS_LATCH_SKIP` goes away.
  - `latchPassSetup(args: { config: BoardConfig; plan: TriageForgePlan; gitlabToken: string | null; username: string }, deps: { verify?: typeof verifyLatchIdentity; appendAudit: (e: AuditEntry) => void; now: () => number; log: (line: string) => void }): { self: string; gateway: LatchGateway; scope(mrs: LatchMrFacts[]): Promise<LatchMrFacts[]>; countNew(mr: LatchMrFacts, launchAt: number): Promise<number | null> } | null`. `countNew` is today's `MRDetailFetcher` read on GitLab and `discussions:refresh` then `countNewDiscussions` on GitHub. Null when the latch cannot run (GitLab with no token, GitHub with no recorded username, `plan.latch` false). On GitLab `scope` returns `mrs` unchanged. On GitHub it verifies each distinct `rtRepo` once, drops the MRs of an unverified repo, and logs and audits `identity-mismatch` once per repo. `bin/triage.ts` only calls it and passes the result into `runLatchPass`.

- [ ] **Step 1: Write the failing tests**
  - `verifyLatchIdentity`: `forge:self` answering `Ellie-Dev` for self `ellie-dev` gives `{ok: true}`; a second call within 24 h makes no daemon call; after 24 h it calls again; `ivasco` vs `ellie-dev` gives `{ok: false, login: 'ivasco'}`; `{ok: false}` from the daemon gives `{ok: false, login: null}`.
  - `triageForgePlan` on GitHub with a username gives `{asks: false, latch: true}` and logs `GITHUB_ASKS_SKIP`; with none gives `latch: false` plus `GITHUB_NO_USERNAME`; GitLab gives both true and no lines.
  - Server GitHub team (fake daemon on the test HOME's `rt.sock`): a review `done`/`comment` signal with `board.reReview` on reaches the fake daemon with `forge:self`, then `mr:attach-upload`, then `mr:comment-file`; with `forge:self` answering another login it sends no write and logs one line naming both logins. A finished respond with a pending re-review pick sends `discussions:resolve`. With no recorded team username (`forgeSelf()` null) the done step sends nothing and logs one line.
  - `latchPassSetup`, in `src/__tests__/triage-latch-setup.test.ts` (no harness runs `bin/triage.ts`, so the wiring lives in this testable function): a GitHub plan with a recorded username and no GitLab token gives `self` equal to that username and a gateway with `forge: 'github'`; `scope` over two MRs on one verified repo returns both and calls `verify` once; on a repo whose `verify` returns `{ok: false, login: 'ivasco'}` it returns none, logs one line naming `ivasco` and the username, and audits `{event: 'latch', action: 'identity-mismatch'}` once; GitLab with a token gives `forge: 'gitlab'` and `scope` is the identity; GitLab with no token gives null; on GitHub `countNew` sends `discussions:refresh {repoName, iid}` and counts only the reviewer's non-latch threads opened at or after `launchAt`, and a failed refresh gives null.
- [ ] **Step 2: Run** the four suites (from `apps/board`). Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `bin/triage.ts` (through `latchPassSetup`): the latch pass runs when `plan.latch` (GitLab: today's `latchToken` condition); on GitHub `self = plan.identity.recorded`, `gateway = boardLatchGateway(...)`, `projectId: null`, and `countNew` is `fetchNewDiscussionCount(() => refreshed detail via discussions:refresh, username, launchAt)`. Before the pass on GitHub, `verifyLatchIdentity` per distinct `rtRepo` in `fetchLatchMrs`; MRs on an unverified repo are dropped from the pass, with one audit `{event: 'latch', action: 'identity-mismatch'}` per repo per run.
  - `server.ts` latch step: the `config.forge.kind === 'gitlab' && gitlabToken` gate becomes "a gateway exists"; on GitHub `self = forgeSelf.get()`, checked with `verifyLatchIdentity`, `countNew` over `discussions:refresh`. Settle: resolve through `boardLatchGateway(...)`, gated the same way. GitLab paths keep their current calls.
- [ ] **Step 4: Run** the suites again, plus `triage-latch.test.ts` and `server-own-mr.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `board: the re-review latch runs on GitHub (BOARD-65)`

### Task 6: The GitHub re-request from the author's board

**Files:**
- Create: `apps/board/src/latch/rerequest.ts`
- Modify: `apps/board/src/latch/discussions.ts` (add `reviewerRequests`), `apps/board/src/data.ts` (`BoardMR.reviewerRequests?`), `apps/board/src/server.ts` (compute beside `reviewerLatches` at `:1106`; schedule after each snapshot beside `refreshOwnerTeamsInBackground` at `:2479`)
- Test: `apps/board/src/__tests__/latch-rerequest.test.ts`, `latch-discussions.test.ts`

**Interfaces:**
- Consumes: `findLatches` (unchanged), `verifyLatchIdentity` (Task 5), `forgeReason` and `DAEMON_UNREACHABLE_PREFIX`.
- Produces:
  - `export interface ReviewerRequest { reviewer: string; discussionId: string; requested: boolean }` (unlike the existing armed-only `ReviewerLatch`, it covers a reviewer's newest live latch in any phase; keep both) and
    `reviewerRequests(detail: MRDetail, author: string): ReviewerRequest[]`. One entry per non-author reviewer with a live latch. `requested` is true when the reviewer's newest latch is armed and resolved, or is queued, running or error.
  - `planReRequests(mrUrl: string, requests: ReviewerRequest[], reviewers: { username: string; reviewState: string | null }[], sentKeys: string[]): { send: string[]; mark: string[]; forget: string[] }`. Pure; `sentKeys` are the stored `latch-rerequest` keys for that `mrUrl`; keys are `${mrUrl}|${discussionId}`; `send` lists reviewer usernames, `mark` and `forget` list keys. Any stored key with no `requested: true` entry (spent, gone, or armed and open) is in `forget`.
  - `sendReReviewRequests(mrs: BoardMR[], deps: { self: string; command?; db?; log? }): Promise<void>`. `self` is `forgeSelf.get()`, for `verifyLatchIdentity`. Kv namespace `latch-rerequest`.

- [ ] **Step 1: Write the failing tests**
  - `reviewerRequests` per phase: armed and open gives false; armed and resolved, queued, running and error give true; spent gives no entry; the author's own latch gives no entry.
  - `planReRequests`: requested with `reviewState: 'COMMENTED'` and no key gives `send`; requested with `UNREVIEWED` gives `mark` only; requested with the key already set gives nothing; not requested with a key gives `forget`; a key whose thread is gone gives `forget`.
  - `only the requested reviewer is re-requested`: two reviewers, one requested, sends one `mr:action {action: 'requestReReview', args: [['ivasco']]}`.
  - The send writes the key; a refused call writes nothing and logs; an unanswered call (`DAEMON_UNREACHABLE_PREFIX`) writes the key.
  - After a stuck reply (reviewer reads `COMMENTED`, latch still error, key set), nothing is sent.
  - On a GitLab board `sendReReviewRequests` is never scheduled (server wiring test, or a guard in the function on `config.forge.kind`).
- [ ] **Step 2: Run** `bun test src/__tests__/latch-rerequest.test.ts src/__tests__/latch-discussions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, with the server step guarded by `config.forge.kind === 'github'`, single-flight like `ownerTeamsRefreshing`, and the identity check per repo.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit** `board: the author's board re-requests a GitHub reviewer once per ask`

### Task 7: The `github.team` directory key

**Files:**
- Modify: `packages/rt-client/src/settings/registry-schemas.ts:212-245` (`mattstack.directory` team entry), `registry-defs.ts` only if the key needs a def there, regenerate `schema.lock.json` with the repo's own script (grep `schema.lock`)
- Test: the existing schema or lock test that covers `mattstack.directory` (grep under `packages/rt-client`)

**Interfaces:**
- Produces: `DirectoryTeam['github']?: { team?: string }` (optional, `min(1)`, titled and described per rt:settings and rt:ui-copy, placeholder `@acme/web`).

- [ ] **Step 1:** `chat_dm` to `forge-copy-sweep.x5pq`: "Adding one optional key, mattstack.directory teams.<name>.github.team, to registry-schemas.ts and regenerating schema.lock.json on branch board-tabs-latch. Nothing else in those files." Read the rt:settings skill and `.claude/rules/settings.md`.
- [ ] **Step 2: Write the failing test**: a directory value with `teams.web.github.team: '@acme/web'` parses, and one with `github.team: ''` is refused.
- [ ] **Step 3: Run it** (from the worktree root, the test's own path). Expected: FAIL.
- [ ] **Step 4: Implement** and regenerate the lock.
- [ ] **Step 5: Run** the test and `bun run typecheck` at the root. Expected: PASS.
- [ ] **Step 6:** Before the final push (Task 13), if forge-copy-sweep's PR has landed, merge main and regenerate `schema.lock.json` again.
- [ ] **Step 7: Commit** `rt-client: an optional GitHub team on directory teams (BOARD-66)`

### Task 8: The ask picker's GitHub owners (board side)

**Files:**
- Modify: `apps/board/src/owner-teams.ts` (`OwnerTeam.person`, forge-aware `ownerTeamsFromRules`, `attachOwnerTeams` config gains `forge`), `apps/board/src/client/types.ts:293-301` (`OwnerTeam.person?`), `apps/board/src/client/board/ask-picker.ts:83-104` (person owners), `apps/board/src/server.ts:1412-1455` (`readOwnerRules` GitHub branch), and where `attachOwnerTeams` is called (`:1325`)
- Test: `src/__tests__/owner-teams.test.ts`, `src/__tests__/client-ask-picker.test.ts`, `src/__tests__/server-slack-owners.test.ts` (or `codeowner-posts.test.ts`)

**Interfaces:**
- Consumes: Task 7's `DirectoryTeam['github']`; the `mr:owner-rules` reply shape `{ rules: { type: string; section: string | null; approved: boolean }[]; unknownReason?: string }` (Task 9 builds the verb; tests here fake it).
- Produces: `ownerTeamsFromRules(rules, directory, ownTeam, posts?, forge?: 'gitlab' | 'github')`. On GitHub: `@login` gives `{person, section, approved}`; `@org/team` claimed by a directory team whose `github.team` matches (strip a leading `@`, lowercase both sides) gives `{team, section, approved, mine?}`; otherwise `{section, approved}`.

- [ ] **Step 1: Write the failing tests**
  - `github.team matches without @ and in any case`: directory `web.github.team = 'acme/web'` and `'@ACME/web'` both claim `@acme/web`.
  - A `@ellie-dev` rule gives `{person: 'ellie-dev', section: '@ellie-dev', approved: false}`; an unclaimed `@acme/api` gives `{section: '@acme/api', approved: false}`; GitLab rules give today's output for the existing cases.
  - `askPickerModel` with a person owner lists that person under a block headed `@ellie-dev`, and omits them when not askable (engaged, or not an enrolled peer).
  - `readOwnerRules` on GitHub sends `mr:owner-rules {repoName, iid}`, keeps only `CODE_OWNER` rules, returns `{ok: true, rules: []}` on `unknownReason`, and `{ok: false, status: 502, ...}` on a daemon error; GitLab still sends `forge:get` approval_state.
  - A GitHub rule set plans no Code Owner Slack post (`planOwnersPost` finds no channel).
- [ ] **Step 2: Run** the suites (from `apps/board`). Expected: FAIL.
- [ ] **Step 3: Implement.** `refreshOwnerTeams` keeps its seen-key rule unchanged.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit** `board: the ask picker lists GitHub code owners (BOARD-66)`

### Task 9: Daemon verb `mr:owner-rules`

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (type entry beside `forge:self` at `:1315`, name in `COMMAND_NAMES` at `:1504+`), `lib/daemon/handlers/mr.ts` (handler beside `forge:self`, `:799`)
- Test: `lib/daemon/__tests__/` (the file that tests `forge:self`, or a new `mr-owner-rules.test.ts`)

**Interfaces:**
- Produces: `"mr:owner-rules": { payload: { repoName: string; iid: number }; data: { rules: ApprovalRuleLite[]; unknownReason?: string } }`.

- [ ] **Step 1: Write the failing test**: with a fake provider, the handler calls `fetchApprovalRules({projectPath, iids: [iid]})` once and returns that iid's `rules` and `unknownReason`; a bad `iid` or repo is refused with the same messages `forge:self` and `forge:file-diff` use; a provider throw is `{ok: false, error}`.
- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/<file>` from the worktree root. Expected: FAIL.
- [ ] **Step 3: Implement** following `.claude/rules/daemon.md` (no outcome logging in the handler).
- [ ] **Step 4: Run it**, plus any test that checks every `COMMAND_NAMES` entry has a handler (grep `COMMAND_NAMES` under `lib/`). Expected: PASS.
- [ ] **Step 5: Commit** `daemon: mr:owner-rules reads a PR's code owner rules`

### Task 10: Daemon verb `mr:attach-upload`

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (type and name), `lib/daemon/handlers/mr-upload.ts` (handler beside `mr:describe-with-attachments`, `:434`)
- Test: `lib/daemon/__tests__/mr-attach-upload.test.ts` (model it on `mr-describe-attachments.test.ts`)

**Interfaces:**
- Produces: `"mr:attach-upload": { payload: { repoName: string; iid: number; files: { path: string; name: string }[] }; data: { urls: Record<string, string> } }`.

- [ ] **Step 1: Write the failing tests** (fake gh, fake GitHub context, fake provider, temp roots, all through the handler's existing seams):
  - A GitLab repo is refused with `unsupported: mr:attach-upload needs a GitHub repo`.
  - 0 or 11 files, a duplicate name (ignoring case), a path outside every root, and bytes that do not match `.gif` are refused through the same `checkAttachment` messages `mr:upload` gives.
  - The gh argv is `pr comment <iid> --repo github.com/<path> --body-file <staged> --attach <staged file>#<name> ...`, the token is only in `env.GH_TOKEN`, and never in argv.
  - The comment id parses from gh's printed URL (`...#issuecomment-123`); the body read back maps `![name](url)` per name; `deleteComment(path, iid, {id: 123, kind: 'general'})` is called; the reply is `{urls}`.
  - A failed delete still returns the URLs and logs at warn; a name missing from the read-back fails the verb after the delete; the verb never fetches an asset URL.
- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/mr-attach-upload.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, reusing the describe handler's staging, gh lookup, token and timeout seams.
- [ ] **Step 4: Run it** and `bun test lib/daemon/__tests__/mr-describe-attachments.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `daemon: mr:attach-upload uploads images through a deleted holder comment`

### Task 11: Glance `createFileComment` and daemon verb `mr:comment-file` (after glance frees)

**Gate:** start only after the shepherd says, through `herd_ask`, that glance is free (PR #1121 at 0.33.1 and the 0.33.2 live-fixes job merged). Merge main first.

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts` (method beside `createInlineComment`), `packages/glance/CHANGELOG.md`, `packages/glance/package.json` (next patch after whatever main carries)
- Modify: `packages/rt-client/src/commands.ts`, `lib/daemon/handlers/discussions.ts` or `mr.ts` (wherever `mr:comment-inline` lives)
- Test: `packages/glance/tests/gh-file-comment.test.ts`; `lib/daemon/__tests__/` (the `mr:comment-inline` test file or a new `mr-comment-file.test.ts`)

**Interfaces:**
- Produces: `GitHubProvider.createFileComment(projectPath: string, mrIid: number, body: string): Promise<{ discussionId: string; noteId: number; path: string } | null>`;
  `"mr:comment-file": { payload: { repoName: string; iid: number; body: string }; data: { discussionId: string; noteId: number; path: string } | { fallback: 'no-files' } }`.

- [ ] **Step 1: Write the failing glance tests** (fake fetch): `GET /repos/{p}/pulls/{n}` for `head.sha`, `GET .../files?per_page=1`, then `POST .../pulls/{n}/comments` with `{body, commit_id, path, subject_type: 'file'}`; an empty files list returns null and posts nothing; the result is `discussionId: 'gh-review-thread-<id>'`. And `fetchMRDiscussions` maps a review comment with `subject_type: 'file'` and `line: null` to a resolvable `gh-review-thread-` discussion whose `notes[0].id` is numeric and whose `resolved` comes from the thread index.
- [ ] **Step 2: Run** `bun test tests/gh-file-comment.test.ts` in `packages/glance`. Expected: FAIL.
- [ ] **Step 3: Implement** through `forgeWrite`, like the other writes; CHANGELOG entry and version bump.
- [ ] **Step 4: Write the failing daemon tests**: a GitLab repo is refused with `unsupported: mr:comment-file needs a GitHub repo`; a null from glance answers `{fallback: 'no-files'}`; a post answers `{discussionId, noteId, path}` and then refreshes the PR's discussions in the store (as `discussions:reply` does).
- [ ] **Step 5: Run, implement, and run again.** Expected: PASS.
- [ ] **Step 6: Commit** `glance, daemon: a file-level review thread on GitHub (mr:comment-file)`

### Task 12: Fixture and the Fast Browser check

**Files:**
- Modify: `apps/board/tests/fixture-github/config.json`, `data.json`, `discussions.json`, `README.md`; `apps/board/src/__tests__/fixture-github.test.ts`

- [ ] **Step 1: Fixture data**, all invented:
  - Tabs: `team` (authors), `@acme/web`, `@ellie-dev`, and `@acme/payments` (not in CODEOWNERS).
  - `scopeKnownSections`: `["@acme/api", "@acme/web", "@ellie-dev"]`.
  - Rows tagged with those owners, some by non-members.
  - An own row with `ownerTeams`: a person owner `@ellie-dev`, a team claimed through a directory team, and an unclaimed `@acme/api`. Add the teams and peers the ask picker reads (follow how `Board.tsx` builds `AskPickerEnv`).
  - An own row whose respond sheet offers a re-review pick (`reviewerLatches`, and a latch thread in `discussions.json` carrying the armed marker).
- [ ] **Step 2: Update `fixture-github.test.ts`** so its empty-sections assertions flip to the new data. Run it (from `apps/board`). Expected: PASS.
- [ ] **Step 3: Fast Browser.** Boot `PORT=7942 BOARD_FIXTURE=$(pwd)/tests/fixture-github bun run src/server.ts` from `apps/board` (background, stop it by PID afterwards). Delegate to the `fast-browser:browser-driver` agent (haiku, medium). Capture light and dark: the tab strip with counts and the "no such owner" chip on `@acme/payments`; the ask picker on the own row with its three owner blocks; the respond sheet's re-review pick. Look at every capture and write down plainly anything that reads wrong (alignment, wrapping, copy, contrast) before calling it done.
- [ ] **Step 4: Commit** `board: GitHub fixture shows owner tabs, owners and a re-review pick`

### Task 13: Whole-branch verification

- [ ] From `apps/board`: `bun test` (the board suite), `bun run typecheck`, the board's lint if it has one, and from the root `bun run skills:check:board` under an isolated temp HOME.
- [ ] From the root: `bun test` on each touched `lib/daemon/__tests__` file and the rt-client settings test, `bun run typecheck`, `bun run purity`; in `packages/glance`, `bun test tests` and `bun run typecheck`.
- [ ] Record each command and its result in `.superpowers/report-draft.md`.
