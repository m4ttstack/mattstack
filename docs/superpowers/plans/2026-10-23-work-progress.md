# work-progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `mattstack:herd-progress` with `mattstack:work-progress`, which renders a herd, one plan or several plans, and backs finished plans with a plan record rt keeps.

**Architecture:** rt gets a pure ledger parser, a `kv`-backed plan record store and two agent verbs (`rt progress record`, `rt progress list`). A throttled plugin hook calls `record` for the session's tree. The renamed Python script reads herds as today and plans through `rt progress list --refresh`. Matt's statusline asks rt about finished plans.

**Tech Stack:** Bun/TypeScript (rt), `bun:sqlite` via `lib/state/kv-blob.ts`, POSIX sh hooks with bash tests, Python 3 stdlib script.

**Spec:** `docs/superpowers/specs/2026-10-23-work-progress-design.md`

## Global Constraints

- No `SCHEMA_VERSION` claim: the record lives in the existing `kv` table, namespace `plan-progress`.
- rt never watches agents or drives a loop; `record` is a plain scan of one tree's `.superpowers/sdd/*/progress.md`.
- Done is stored (`finishedAt`) when `record` sees the ledger directory gone and the tree still on the record's `branch`. No `FINAL`-line rule.
- `tree-gone`: no `finishedAt`, and the tree is gone or on a different branch. Never shown as done.
- Records not seen for 30 days are dropped on the next `record`.
- Lettered sub-tasks: Task N counts done when `Task N: complete` appears, or every lettered part of N that the ledger mentions (`Task 8a`, `Task 8b`) has a `: complete` line.
- Output: `--json` through `out.json`, frozen once pinned; no `console.*`; human text through `lib/ui/out.ts`.
- New command module registered in `lib/module-registry.ts`; `progress` added to the `rt.picker.hidden` default; `bun run docs:gen` after the tree edit.
- The hook fails open on every path: exit 0, no output.
- Never name the team packs' orgs in code, tests or text (use acme/widgets). `bun run purity` before pushing.
- Run `bun test` from the repo root; targeted tests only locally.
- Skill text changes go through `mattstack:editing-skills` plus `superpowers:writing-skills` (RED baseline, GREEN); `plugins/mattstack/tests/certify.sh` passes.
- `plugins/mattstack/.claude-plugin/plugin.json` version bumped one past main right before merging; `plugins/mattstack/pack/requires.json` `minEngine` raised to that version.
- Leave `plugins/mattstack/docs/superpowers/tests/` untouched (history).

## Review Focus

- A pool tree disposed and re-provisioned at the same path on a new branch: an unfinished plan's record reads `tree-gone`, not `done`. (Task 2 test `reprovisioned tree on another branch reads tree-gone`.)
- The last task's completion and the workspace delete inside one throttle window: the record still turns `done` with `done = total`. (Task 2 test `ledger gone on same branch is done with full count`.)
- A ledger whose first line names a relative plan path, or a `plan-path` marker file: total resolves against the tree, and a missing plan file gives `total: 0`, not a crash. (Task 1 tests.)
- A machine whose rt has no `progress` verb: the hook stays silent and the script falls back with the honest no-record text. (Task 4 test `old rt usage exit stays silent`, Task 5 test `old rt falls back`.)
- A tree with no `.superpowers/sdd` (most sessions): the hook never calls rt. (Task 4 test `no sdd dir skips rt`.)

---

### Task 1: Ledger parser

**Files:**
- Create: `lib/progress/ledger.ts`
- Test: `lib/progress/__tests__/ledger.test.ts`

**Interfaces:**
- Produces:
  - `export interface LedgerReading { planRef: string; done: number; total: number; latest: string }`
  - `export function planRefOf(ledgerText: string, markerText: string): string`: the `plan-path` marker's trimmed text when non-empty, else the `plan:\s*(\S+)` value on the ledger's first line, else `""`.
  - `export function countPlanTasks(planText: string): number`: distinct N over lines matching `^#+\s*Task\s+(\d+)\b`.
  - `export function countDoneTasks(ledgerText: string): number`: the lettered rule from Global Constraints.
  - `export function latestLine(ledgerText: string): string`: last non-blank line after the first that does not start with `#`, `|`, `Ruling` or `Spec:`, with a leading `Task N:` rewritten to `TN ` (today's `herd_progress.py` rule).
  - `export function readLedger(tree: string, ledgerDir: string): LedgerReading`: reads `progress.md` and `plan-path` in `ledgerDir`, resolves `planRef` against `tree` when relative, total 0 when the plan file is missing.

- [ ] **Step 1: Write the failing tests**

```ts
test("counts plain complete lines once each", () => {
  expect(countDoneTasks("# SDD ledger plan: p.md\nTask 1: complete (abc)\nTask 1: complete (again)\nTask 2: complete\n")).toBe(2);
});
test("a lettered task counts only when every part is complete", () => {
  const half = "Task 8a: complete\nTask 8b: dispatched\n";
  expect(countDoneTasks(half)).toBe(0);
  expect(countDoneTasks(half + "Task 8b: complete\n")).toBe(1);
});
test("an explicit Task N complete wins over parts", () => {
  expect(countDoneTasks("Task 5a: dispatched\nTask 5: complete\n")).toBe(1);
});
test("free-text mentions of complete do not count", () => {
  expect(countDoneTasks("Task 6: dispatched (complete code in brief)\n")).toBe(0);
});
test("plan task count is distinct Task N headings", () => {
  expect(countPlanTasks("### Task 1: a\n### Task 2: b\n## Task 2: dup\n")).toBe(2);
});
test("marker file beats the ledger's first line", () => {
  expect(planRefOf("# SDD ledger plan: a.md", "docs/b.md\n")).toBe("docs/b.md");
  expect(planRefOf("# SDD ledger plan: a.md", "")).toBe("a.md");
});
test("missing plan file gives total 0", () => { /* readLedger on a temp tree whose ledger names docs/nope.md: total === 0 */ });
test("latest line skips rulings and rewrites Task N", () => {
  expect(latestLine("# SDD ledger plan: p.md\nTask 7: complete\nRuling: x\nTask 8b: in progress\n")).toBe("T8b in progress");
});
```

The `latestLine` rewrite keeps the letter: match `^Task\s+(\d+[a-z]?):\s*`.

- [ ] **Step 2: Run** `bun test lib/progress/__tests__/ledger.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the five functions in `lib/progress/ledger.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `progress: ledger parser with lettered sub-tasks`.

### Task 2: Plan record store

**Files:**
- Create: `lib/progress/store.ts`
- Test: `lib/progress/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `readLedger`, `LedgerReading` (Task 1); `getKvValue`, `setKvValue`, `deleteKvValue`, `listKvValues` from `lib/state/kv-blob.ts`.
- Produces:
  - `export const PROGRESS_NS = "plan-progress"`
  - `export interface PlanRecord { tree: string; branch: string; plan: string; stem: string; done: number; total: number; latest: string; firstSeen: number; lastSeen: number; finishedAt: number | null }`
  - `export type PlanState = "running" | "done" | "tree-gone"`
  - `export interface PlanView extends PlanRecord { state: PlanState }`
  - `export interface ProgressDeps { db: Database; now: () => number; branchOf: (tree: string) => string | null; exists: (path: string) => boolean }`
  - `export function defaultDeps(): ProgressDeps`: `getStateDb()`, `Date.now`, `getCurrentBranch` from `lib/git-ops.ts`, `existsSync`.
  - `export function recordTree(tree: string, deps?: ProgressDeps): PlanRecord[]`: the records it upserted or finished.
  - `export function listPlans(filter: { tree?: string; plan?: string }, deps?: ProgressDeps): PlanView[]`

Key: `${tree}\u0000${stem}`. `tree` is the absolute path with no trailing slash. `listPlans`' `plan` filter matches a record whose `plan` equals the given path after both resolve against `tree`, or whose `stem` equals the file's basename without `.md`, within the filtered tree only.

`recordTree` does, in order:
1. Drops every record in the namespace whose `lastSeen` is older than 30 days.
2. Upserts each live ledger directory under `tree/.superpowers/sdd/`, keeping `firstSeen` and `finishedAt: null`, setting `branch` from `branchOf(tree)`.
3. For each existing record of this tree with `finishedAt === null` whose ledger directory is gone: if `branchOf(tree) === record.branch`, it sets `finishedAt = now()` and `done = total`.

`listPlans` derives `state` like this: `done` if `finishedAt` is set; `running` if the ledger directory exists; else `tree-gone`. A tree gone, or on a different branch, with no `finishedAt` falls through to `tree-gone`. A directory gone on the same branch before any `record` ran is also `tree-gone`. Only `record` turns a plan done.

- [ ] **Step 1: Write the failing tests.** Use a temp `Database` with the `kv` table created via the state db's migration helper (or `openStateDb` on a temp path, whichever `lib/state/__tests__` already uses), and a temp tree.

```ts
test("records a live ledger", () => { /* ledger with Task 1,2 complete, plan with 3 headings → one record, done 2, total 3, finishedAt null; listPlans state "running" */ });
test("ledger gone on same branch is done with full count", () => { /* record at 2/3, delete ledger dir, recordTree again with branchOf unchanged → finishedAt set, done 3; state "done" */ });
test("reprovisioned tree on another branch reads tree-gone", () => { /* record at 2/3 on branch a; delete ledger dir; branchOf now returns "b"; recordTree → finishedAt stays null; state "tree-gone" */ });
test("done survives the tree moving branch later", () => { /* finish on branch a, then branchOf returns b, recordTree → still done */ });
test("tree removed reads tree-gone", () => { /* exists(tree) false → state "tree-gone" */ });
test("records older than 30 days are dropped on record", () => { /* now() advanced 31 days past lastSeen → listPlans({}) empty */ });
test("plan filter matches path or stem within one tree", () => { /* two trees with same stem; filter {tree: t1, plan: "docs/superpowers/plans/x.md"} → only t1's */ });
```

- [ ] **Step 2: Run** `bun test lib/progress/__tests__/store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `lib/progress/store.ts` per the interfaces and order above.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `progress: plan record store over kv`.

### Task 3: `rt progress` verbs

**Files:**
- Create: `commands/progress.ts`
- Modify: `lib/command-tree-def.ts` (add a `progressSubcommands` record and a top-level `progress` node beside `runs`)
- Modify: `lib/module-registry.ts` (thunk for `./commands/progress.ts`)
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (add `"progress"` to the `rt.picker.hidden` default, alphabetical)
- Test: `commands/__tests__/progress.test.ts`

**Interfaces:**
- Consumes: `recordTree`, `listPlans`, `defaultDeps`, `ProgressDeps` (Task 2).
- Produces (the script and hook rely on these bytes):
  - `rt progress record --tree <root> [--json]`: exit 0. No stdout without `--json`; with it, `{"ok":true,"records":[PlanRecord...]}`.
  - `rt progress list [--tree <root>] [--plan <path>] [--refresh] --json`: `{"ok":true,"plans":[PlanView...]}`, newest `lastSeen` first. `--refresh` requires `--tree` and runs `recordTree` first.
  - Usage errors under `--json`: `{"ok":false,"error":"<message>"}`, exit 2. A missing `--tree` on `record` is `"--tree is required"`.
  - `export function runProgress(args: string[], deps?: ProgressDeps): { out: string; code: number }`: the pure core, in the `commands/runs-find.ts` shape. `progressRecord` and `progressList` are thin wrappers that write through `out.payload`.

Descriptions (plain language, per `.claude/rules/command-tree.md`): group "Progress of plans run with subagent-driven development", `record` "Save what this tree's plan ledgers show", `list` "Plans recorded on this machine and whether each finished". Mark both leaves `agentSafe: true`.

- [ ] **Step 1: Write the failing tests** against `runProgress` with a temp db and tree: `record` without `--tree` gives exit 2 with the frozen error JSON; `record --tree t --json` returns the records; `list --tree t --refresh --json` sees a ledger written after the last record; `list --refresh` without `--tree` gives exit 2.
- [ ] **Step 2: Run** `bun test commands/__tests__/progress.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `commands/progress.ts`, the tree nodes, the registry thunk and the hidden default.
- [ ] **Step 4: Run** `bun test commands/__tests__/progress.test.ts lib/__tests__/agent-safe.test.ts lib/__tests__/command-tree-resolve.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts`, then `bun run docs:gen` and `bun run picker:check`. Expected: all PASS, and docs regenerated.
- [ ] **Step 5:** The rt-client source changed, so rebuild its dist: run `bun run build` in `packages/rt-client`, then `bun test packages/rt-client/test/dist-freshness.test.ts` from the root. Expected: PASS.
- [ ] **Step 6: Commit** `rt progress: record and list plan ledgers`.

### Task 4: Recording hook

**Files:**
- Create: `plugins/mattstack/hooks/progress-record.sh`
- Modify: `plugins/mattstack/hooks/hooks.json` (a second `PostToolUse` hook entry beside `inject-time.sh`, `timeout: 5`)
- Modify: `plugins/mattstack/hooks/README.md` (one row for the new hook)
- Create: `plugins/mattstack/hooks/tests/test-progress-record.sh`
- Modify: `.github/workflows/checks.yml` (add `bash hooks/tests/test-progress-record.sh` to "Plugin hook tests")

**Interfaces:**
- Consumes: `rt progress record --tree <root>` (Task 3).
- Behavior, in order:
  1. Read the hook's stdin JSON and take `session_id` and `cwd`.
  2. Read the throttle stamp `${TMPDIR:-/tmp}/mattstack-progress-record-${session_id:-global}`. If it holds an epoch less than 60 seconds old, exit.
  3. `root=$(git -C "$cwd" rev-parse --show-toplevel)`. Exit on failure.
  4. If `$root/.superpowers/sdd` is not a directory, exit, before writing the stamp or calling rt.
  5. Write the stamp, then run `rt progress record --tree "$root"` with stdout and stderr discarded. rt is resolved as in `pipeline-gate-stop.sh` (`command -v rt`, else `$HOME/.local/bin/rt`).
  6. Always exit 0 with no output.

- [ ] **Step 1: Write the failing test script.** Model it on `hooks/tests/test-pipeline-gate-stop.sh`: a sandbox HOME and TMPDIR, a stub `rt` that appends its argv to a calls file, and a temp git repo. Cases:
  - `no sdd dir skips rt`: no calls.
  - `sdd dir records once`: one call `progress record --tree <root>`.
  - `second call inside 60s is throttled`: still one call.
  - `old rt usage exit stays silent`: the stub exits 2 with usage text. The hook still prints nothing and exits 0.
  - `no rt on PATH exits 0`.
  - `cwd outside git exits 0`.
- [ ] **Step 2: Run** `bash plugins/mattstack/hooks/tests/test-progress-record.sh`. Expected: FAIL, hook missing.
- [ ] **Step 3: Implement** `progress-record.sh`, wire `hooks.json`, add the README row and the CI line.
- [ ] **Step 4: Run** the test script, then `bash plugins/mattstack/hooks/tests/test-pipeline-gate-stop.sh`. Expected: every case `ok`.
- [ ] **Step 5: Commit** `mattstack: hook records plan ledgers through rt`.

### Task 5: `work_progress.py`

**Files:**
- Move: `plugins/mattstack/plugin/skills/herd-progress/scripts/herd_progress.py` → `plugins/mattstack/plugin/skills/work-progress/scripts/work_progress.py` (use `git mv`; the old skill folder goes in Task 6)
- Create: `plugins/mattstack/tests/test-work-progress.sh` (bash driver around fixture trees and a stub `rt`; add it to the CI step from Task 4)

**Interfaces:**
- Consumes: `rt progress list --tree <root> --refresh --json` (Task 3); today's `rt herd status|gates`, `rt runs` reads.
- Produces the CLI the skill teaches:
  - `--herd <id>`: today's view. One change: a ledger-method job with no live ledger takes `done`/`total`/`latest` from the job tree's `rt progress list` record when one exists.
  - `--plan <path>` (repeatable), `--tree <root>` (optional, default: the git toplevel of the first plan's directory), `--title <text>` (default: the first plan's stem without its date).
  - Neither `--herd` nor `--plan`: exit 1 with `work_progress: name a herd (--herd <id>) or the plans to show (--plan <path> ...)`.
  - Plan header: `**<title>** · branch <b> · worktree <basename of tree> · <done> of <total> tasks done · <stuck summary>`, where the stuck summary is `nothing stuck` or `<n> quiet`. Overall line: `Overall \`<20-cell bar>\` <pct>%`, by tasks.
  - Plan table header: `| plan | status | spec | plan | exec | review | tasks | now |`. Cells follow spec §3:
    - status is running, done, not started, *quiet* (ledger untouched 30+ minutes) or tree gone.
    - The tasks bar uses today's `bar()`.
    - `not started` shows `0/<plan task count>`.
  - Old rt: `rt progress list` exits non-zero or prints non-JSON. Live plans fall back to today's in-script ledger parse. A plan with no ledger shows status `unknown`, with now `not started or finished (rt has no record)`.

- [ ] **Step 1: Write the failing test script.** Fixture tree with three plans: 1 has no ledger plus a stub record in state `done`, 2 has a live ledger at 7/9, 3 has nothing. The stub `rt` serves `progress list` from a fixture file. Cases:
  - `epic view rows and totals`: header `19 of 30` for 12+9+9 tasks with 12+7 done, rows in the given order, statuses done/running/not started.
  - `tree-gone record shows tree gone`.
  - `no flags exits 1 with the message`.
  - `old rt falls back`: the stub exits 2. Row 2 still reads 7/9 and row 1 reads `unknown`.
  - `herd mode unchanged`: a herd fixture through stubbed `herd status`/`herd gates` renders the same header as before the move.
- [ ] **Step 2: Run** `bash plugins/mattstack/tests/test-work-progress.sh`. Expected: FAIL.
- [ ] **Step 3: Implement** the plan mode, the rt read and the herd-mode fallback in `work_progress.py`. Keep `herd_progress.py`'s functions and behavior for `--herd`.
- [ ] **Step 4: Run** the test script. Expected: every case `ok`.
- [ ] **Step 5: Commit** `mattstack: work_progress renders plans and epics`.

### Task 6: The skill and the rename

**Files:**
- Create: `plugins/mattstack/plugin/skills/work-progress/SKILL.md`
- Delete: `plugins/mattstack/plugin/skills/herd-progress/`
- Modify:
  - `plugins/mattstack/surface.jsonc:17`
  - `plugins/mattstack/.claude-plugin/plugin.json` (description list; version, see Task 8)
  - `plugins/mattstack/tests/desc-test-scenarios.json:76,80` (expect `work-progress`; add scenarios for "where is the skill-blocks epic at" and "progress on this plan")
  - `lib/skills/__tests__/sources.test.ts:442-446`
  - `plugins/mattstack/attachments/orchestration/shepherdr/SKILL.md:606` (name only: `mattstack:herd-progress` → `mattstack:work-progress`), then `rt skills compile` to refresh `plugins/mattstack/skills/shepherdr/SKILL.md`
  - `plugins/mattstack/CERTIFICATION.md` (new rows for work-progress and shepherdr)

- [ ] **Step 1: RED baseline.** Per `superpowers:writing-skills` and `mattstack:editing-skills`, run a fresh agent with the skill absent on these prompts, and record call counts and output shape:
  - "show progress on the skill-blocks epic" in a fixture tree.
  - "where is my plan at" with one live ledger.
  - "herd progress" with a stubbed herd.
- [ ] **Step 2: Write `SKILL.md`.**
  - frontmatter: `name: work-progress`, and `allowed-tools: ["Bash(python3 */scripts/work_progress.py:*)"]`.
  - description: "Use when asked for progress, status or "where is it at" on long-running work: a shepherdr herd, a superpowers plan running under subagent-driven development, or an epic made of several plans."
  - Body: today's reply rules, plus the input choice from spec §4 and the plan statuses table. It also states in one line that a solo direct-tdd or trivial job has nothing to measure.
- [ ] **Step 3: Make the rename edits** listed above. The shepherdr edit is the name only.
- [ ] **Step 4: GREEN.** Rerun the RED prompts with the skill present. Expected: one script call and the table, on every run.
- [ ] **Step 5: Run** these and expect all of them to pass:
  - `bash plugins/mattstack/tests/certify.sh`
  - `bun cli.ts skills check --strict`, under an isolated HOME as the CI job does
  - `bun test plugins/mattstack/tests/desc-test.test.ts lib/skills/__tests__/sources.test.ts`
  - `git grep -n herd-progress -- ':!plugins/mattstack/docs/superpowers/tests' ':!docs/superpowers'`, which must print nothing
- [ ] **Step 6: Commit** `mattstack: herd-progress becomes work-progress`.
- [ ] **Step 7: DM lawson the exact changed shepherdr line:** `rt chat dm lawson.9w6b "<old line> → <new line>"`.

### Task 7: Matt's statusline

**Files:**
- Modify: `~/.claude/statusline-command.sh` (outside the repo, Matt-approved)

- [ ] **Step 1: Back up the file.** Copy it to the session scratchpad as `statusline-command.sh.bak`.
- [ ] **Step 2: Edit it.**
  - The live-ledger task regex becomes the lettered rule. A shell port of `countDoneTasks` is fine.
  - Delete the `^FINAL` check and the `~/.claude/statusline-state/` read/write code.
  - When no live ledger is found and `$sp_r/.superpowers/sdd` exists, run `rt progress list --tree "$sp_r" --json`. Show ✅ with the plan name for the newest record whose state is `done` and whose `finishedAt` is under 24 hours old.
- [ ] **Step 3: Verify by rendering.** Pipe a sample statusline JSON into the script for three cwd values and read the output:
  - a fixture tree with a live ledger shows a bar
  - a tree whose record is done shows ✅
  - a tree with no SDD shows no plan segment, and the stub rt is never called (check this with a PATH stub that logs calls)
- [ ] **Step 4: Remove the state folder.** Delete `~/.claude/statusline-state/` only after Step 3 passes. Not a repo commit; report the change in the PR body.

### Task 8: Ship

- [ ] **Step 1: Bump the version.** Fetch main, then set `plugin.json` version one past main's. Set `plugins/mattstack/pack/requires.json` `minEngine` to the same value.
- [ ] **Step 2: Run the gates** and expect every one to pass:
  - `bun run purity`
  - `bun run typecheck`
  - the targeted tests from Tasks 1 to 6
- [ ] **Step 3: Push and open the PR** on `m4ttstack/mattstack`. The body names the statusline change and the shepherdr line sent to lawson.
- [ ] **Step 4: Get it ready to merge.** Wait for CodeRabbit and address every actionable finding. Wait for green CI. Merge only with Matt's go. Before merging, re-check that the plugin version is still past main.
