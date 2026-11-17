# Unwitnessed Merge Asks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merge the reactor never saw open asks the session to leave (leaving mark, question, grace) when the tree's HEAD is the merged MR's source head.

**Architecture:** A git-only proof helper beside `mergedMrCoversTips` in `lib/worktree/containment.ts`; `detectTransitions` in `lib/daemon/reconciler/reactor.ts` lets proven unwitnessed trees skip the live-cwd gate, so they reach `actOnTree`, which already disposes with `askSessions`.

**Tech Stack:** Bun/TypeScript, git via `lib/worktree/git-async.ts`, `bun:test` with temp git repos.

**Spec:** `docs/superpowers/specs/2026-11-16-unwitnessed-merge-asks-design.md`

## Global Constraints

- Proven = the MR state is `merged`, `mr.sha` is set, the tree's `HEAD` equals `mr.sha`, and the branch ref (when it exists and differs from `HEAD`) is an ancestor of `mr.sha`.
- Any git failure during the proof = not proven (fail closed).
- Witnessed path, job trees (`disposal: "job"`) and main-tree auto-return are unchanged.
- Not-proven unwitnessed trees keep today's behaviour exactly: live-cwd gate, `holdForLiveProcess`, fired key unspent while a live tree defers, fail closed when the lsof snapshot fails.
- Targeted tests only: `bun test lib/worktree/__tests__/containment.test.ts lib/daemon/reconciler/__tests__/reactor.test.ts`, run from the repo root; `bunx tsc --noEmit -p .` clean.
- Comments state only constraints the code cannot show.

## Review Focus

1. A reused branch: tree `HEAD` is new work, `mr.sha` is the old MR's head: not proven, held as today (Task 2 test).
2. A tree behind `mr.sha` (someone else pushed to the branch): not proven, held as today (Task 1 and Task 2 tests).
3. The lsof snapshot fails while the only tree on the branch is proven: the proven tree still gets the leaving mark; the proof needs no lsof (Task 2 test).
4. `mr.sha` missing (older cache rows) or the MR `closed`: not proven (Task 1 test).
5. Tree path gone or not a git dir: not proven, no throw (Task 1 test).

---

### Task 1: The proof helper

**Files:**
- Modify: `lib/worktree/containment.ts` (beside `mergedMrCoversTips`, ~line 179)
- Test: `lib/worktree/__tests__/containment.test.ts`

**Interfaces:**
- Produces: `export async function mergedMrIsTreeHead(treePath: string, branch: string | null, mr: { state?: string | null; sha?: string | null } | null): Promise<boolean>` (use the file's existing `MrHead` type and `mergedShaOf`).

- [ ] **Step 1: Write failing tests** in a new `describe("mergedMrIsTreeHead", ...)` using the file's `repoWithOrigin` and `commit` helpers:
  - `"HEAD at the merged MR's source head is proven"`: branch `feat`, two commits, `sha = HEAD` → `true` for `{ state: "merged", sha }`.
  - `"a HEAD behind the MR's head is not proven"`: commit A, record it, commit B as `mrSha`, `git reset -q --hard A` → `false`.
  - `"a HEAD with commits the MR never saw is not proven"`: `mrSha` = commit A, then commit B on top → `false`.
  - `"a branch ref ahead of a detached HEAD at the MR's head is not proven"`: on `feat`, commit A (`mrSha`), commit B, `git checkout -q --detach A` → `false` for branch `feat`.
  - `"no sha, a closed MR, or a null MR is not proven"`: `{ state: "merged" }`, `{ state: "closed", sha: HEAD }`, `null` → all `false`.
  - `"a missing tree path is not proven"`: `join(repo, "gone")` with `{ state: "merged", sha: HEAD }` → `false`, no throw.
- [ ] **Step 2: Run** `bun test lib/worktree/__tests__/containment.test.ts`. Expected: new tests FAIL (export missing).
- [ ] **Step 3: Implement** `mergedMrIsTreeHead`: `mergedShaOf(mr)` null → false; `headSha(treePath)` must equal it; the branch ref via the same `rev-parse --verify --quiet refs/heads/<branch>^{commit}` `droppedTips` uses, and when present and different from `HEAD`, `isAncestorAsync(treePath, ref, mergedSha)` must hold. Wrap in try/catch returning false.
- [ ] **Step 4: Run** the test file. Expected: PASS.
- [ ] **Step 5: Commit** `containment: prove a tree sits at the merged MR's head`.

### Task 2: The reactor asks on a proven unwitnessed merge

**Files:**
- Modify: `lib/daemon/reconciler/reactor.ts` (`detectTransitions`, the unwitnessed block ~lines 650-700; update the comment above `gated` to say a proven tree skips the gate)
- Test: `lib/daemon/reconciler/__tests__/reactor.test.ts`

**Interfaces:**
- Consumes: `mergedMrIsTreeHead` from Task 1.

**Behaviour:**
- Only when `!witnessed`: for each tree in `trees`, compute `proven = await mergedMrIsTreeHead(r.path, r.branch, entry.mr)`. Skip the proof for job trees.
- `gated` excludes proven trees.
- The `if (cwds === null && !witnessed) continue;` line no longer skips the whole MR: it drops the gated (not-proven) trees from `trees` and sets `skippedLive = true` (their dispose is still owed), then the proven trees go on to `actOnTree` as usual.
- Log one `info` line per proven unwitnessed tree before acting: `"reactor: unwitnessed merge; tree is at the MR's head, asking sessions to leave"` with `{ repo, branch, tree }`.

- [ ] **Step 1: Write failing tests** inside `describe("a merged MR asks sessions inside to leave", ...)` (its `recorder()` seams, `killProcesses: true`, the outer `detect(entries, opts)` and `headOf`). Every merged entry below has no prior `opened` pass, so each is unwitnessed:
  - `"an unwitnessed merge at the tree's head asks the session inside to leave"`: `ephemeralTree(..., "sierra2", "feat-sierra2")`; `detect({ "feat-sierra2": { repoName, mr: { iid: 101, state: "merged", sha: headOf(rec.path) } } }, { ...r.seams, liveCwds: async () => new Set([rec.path]) })` → state `claimed`, `leaving.why` = `` `${changeNoun(repoName)} ${changeMarker(repoName)}101 merged` ``, `heldReason` undefined, `r.kills` `[]`, fired contains `disposed:${repoName}:101:merged`.
  - `"an unwitnessed merge on a reused branch name holds the tree without asking"`: tree `tango2`; `mr.sha` = the tree's `HEAD~1` (the base commit, not its work) with a live cwd → `leaving` undefined, `heldReason` defined, `r.kills` `[]`, fired does not contain `disposed:${repoName}:102:merged`.
  - `"an unwitnessed merge ahead of the tree holds it without asking"`: tree `uniform2`; record `HEAD` as `mrSha` after a second commit, then `git reset -q --hard HEAD~1` in the tree; live cwd → `leaving` undefined, `heldReason` defined, fired unspent (iid 103).
  - `"a proven unwitnessed tree is asked even when the live-cwd snapshot fails"`: tree `victor2`, `mr.sha = headOf(rec.path)`, `liveCwds` throws → `leaving` defined, fired contains `disposed:${repoName}:104:merged`.
- [ ] **Step 2: Run** `bun test lib/daemon/reconciler/__tests__/reactor.test.ts`. Expected: the first and fourth new tests FAIL; the second and third pass already (they pin today's hold). Every existing test passes.
- [ ] **Step 3: Implement** the behaviour above.
- [ ] **Step 4: Run** `bun test lib/daemon/reconciler/__tests__/reactor.test.ts lib/worktree/__tests__/containment.test.ts` and `bunx tsc --noEmit -p .`. Expected: PASS, exit 0. The existing `terminal-state catch-up` tests (no `sha` in their entries) must pass unchanged.
- [ ] **Step 5: Commit** `reactor: an unwitnessed merge at the tree's head asks the session to leave`.
