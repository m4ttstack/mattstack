# Herd Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the shepherd real herd tools: `herd_respawn`, `herd_spawn {tree}`, `herd_gate_answer`, `herd_gate_park`, `herd_diagnose`, `herd_nudge` and `herd_lanes`, plus daemon-persisted budgets and watchdog ladders, and keep every installed plugin root.

**Architecture:** Four new daemon verbs (`herd:respawn`, `herd:diagnose`, `herd:nudge`, `herd:lanes`) and a `tree` field on `herd:spawn` live in `lib/daemon/handlers/herd.ts`, with focused helpers in new `lib/daemon/herd-*.ts` units. They are typed in rt-client's catalog. Budgets, launch settings and watchdog ladders persist in `herds.db` through `lib/daemon/herd-store.ts`. The MCP tools in `lib/mcp/herd-tools.ts` stay thin: guard, then call one daemon verb.

**Tech Stack:** Bun, TypeScript, bun:sqlite, bun:test, herdr JSON-RPC, `@mattstack/glance` providers.

**Spec:** `docs/superpowers/specs/2026-10-16-herd-tools-design.md` (read it; this plan argues from it)

## Global Constraints

- **Write fence:**
  - `lib/mcp/herd-tools.ts`
  - `lib/daemon/**` (herd units, watchdog, `command-router.ts` herd wiring)
  - `commands/herd.ts`
  - `lib/herd-brief.ts`
  - `lib/herdr/**`
  - `lib/skills/sources.ts` (buildPluginRoots and the `PluginRoots` type only)
  - `lib/mcp/temp-root-guard.ts`
  - `packages/rt-client/src/{commands,client,index}.ts`: herd entries only, one contiguous block each
  - `lib/daemon.ts`: herd wiring lines only
  - `plugins/mattstack/attachments/mcp-tools/reference.md` (regenerated) and `plugins/mattstack/.claude-plugin/plugin.json` (version only)
  - `e2e/tests/mcp-serve.test.ts` (`EXPECTED_TOOL_NAMES` only)
  - `docs/superpowers/{specs,plans}/`, the `__tests__` beside these files, and `.superpowers/`
- **No skill edits** under `plugins/mattstack`.
- **Plugin version:** `0.31.6` → `0.31.7`. On a merge conflict, take the higher version and regenerate the reference.
- **Never act on a spent budget.** A tool returns `{used, cap, spent}` and goes on with its move. No refusal, close, respawn or notification hangs off `spent`.
- **No pane text** in any tool or daemon result.
- **Caps:** `respawns` 2, `blockedNotices` 3, `nudges` 2 (per gate), `reviewerRounds` 2 (per milestone artifact), `unmergedReports` 2 (count of distinct report ids).
- **Tree admission:** only `kind: "ephemeral"` with `state: "claimed"`, found in `loadRegistry(herd.repo)`.
- **Every new MCP tool:**
  - refuses `HERD_JOB` (`IN_WORKER`);
  - requires the recorded shepherd session (`requireShepherd`);
  - resolves the herd with `herdFor`;
  - declares `shellForms: { none: "<reason>" }`.
- **Nudge text:**
  - DM body: `call herd_answer for <gate>`
  - pane line: `shepherd: gate <gate> is answered; call herd_answer {gate: "<gate>"} and act on it.`
- **Tests:**
  - Run `bun test <file>` from the worktree root, targeted files only.
  - Never restart the live daemon. Never run a built binary outside an isolated HOME.
- **Comments:** only for a constraint the code cannot show (clean-code-comments rule). Match the surrounding density.
- **Commits:** one per task, short imperative messages, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A respawn of a job whose tree was disposed after a merge.** Expect a refusal naming the missing path, and nothing provisioned. Pinned in Task 4: `respawn refuses a job whose worktree is gone`.
2. **A guest reviewer's tree.** `herd_wrap_up {dispose: ["review-x"]}` must not dispose the host's tree. Pinned in Task 4: `guest spawn keeps tree null so wrap-up cannot dispose the host tree`.
3. **A forge outage during `herd_lanes`.** Merge reads `unknown` with the error, never `none`, and no unmerged report ticks. Pinned in Task 8: `forge error reads unknown and does not tick unmergedReports`.
4. **A daemon restart mid-ladder.** A worker at strike 3 is still at strike 3 after the watchdog is rebuilt from the same store. Pinned in Task 3: `ladder survives a rebuild from the same persist store`.
5. **A worker that writes a limit phrase mid-sentence in its own output** ("the user said You've hit your limit earlier"). It must not classify as rate-limited, because a prefix only counts at the start of a line, after the gutter. Pinned in Task 6: `limit text inside a longer sentence does not classify`.

---

### Task 1: Keep every installed plugin root

**Files:**
- Modify: `lib/skills/sources.ts` (the `PluginRoots` type, ~line 43; `buildPluginRoots`, ~lines 74-98)
- Modify: `lib/mcp/temp-root-guard.ts:81`
- Test: `lib/skills/__tests__/sources.test.ts`, `lib/mcp/__tests__/temp-root-guard.test.ts`

**Interfaces:**
- Produces: `PluginRoots.dirs?: string[]`, the realpath of every existing `installPath`, deduplicated, in listing order. `buildPluginRoots` always sets it. `resolvePluginRootsFromDir` leaves it unset.

- [ ] **Step 1: Write the failing tests**
  - In `sources.test.ts`, `buildPluginRoots keeps a user-scope and a stale project-scope root for one plugin`:
    - Build two temp dirs, each with `.claude-plugin/plugin.json`.
    - List them as `{id: "mattstack@mattstack", installPath: userDir, scope: "user"}` and `{id: "mattstack@mattstack", installPath: projectDir, scope: "project", projectPath: homedir()}` (add `projectPath` to the entry literal as an extra field).
    - Expect `roots.dirs` to equal `[realpath(userDir), realpath(projectDir)]`.
    - Expect `roots.byName.mattstack.dir` to equal `realpath(projectDir)`, the unchanged last-wins rule.
  - Also `buildPluginRoots dedupes a root listed twice` (same path twice gives one entry), and `skips a missing installPath in dirs`.
  - In `temp-root-guard.test.ts`, `readRootsForThisProcess source lists every installed dir` only if a seam exists. Otherwise assert that `cachedReadRoots` with `pluginRoots: () => [a, b]` returns both: that covers the guard half. The wiring line is covered by the sources test.
- [ ] **Step 2:** Run `bun test lib/skills/__tests__/sources.test.ts`. Expected: FAIL (`dirs` undefined).
- [ ] **Step 3:** Implement. Add `dirs?: string[]` to `PluginRoots`, fill it in `buildPluginRoots`, and change line 81 to `buildPluginRoots(...).dirs ?? []`.
- [ ] **Step 4:** Run both test files. Expected: PASS.
- [ ] **Step 5:** Commit: `skills: keep every installed plugin root for the read guard`.

### Task 2: rt-client catalog for the new herd verbs

**Files:**
- Modify: `packages/rt-client/src/commands.ts`:
  - `HerdJobInfo`;
  - the `Commands` herd block (~lines 1100-1118);
  - `COMMAND_NAMES` herd block (~lines 1267-1281).
- Modify: `packages/rt-client/src/client.ts` (after `herdSpawn`, ~line 645) and `packages/rt-client/src/index.ts` (the herd export line).
- Test: `lib/daemon/__tests__/rt-client-commands.test.ts` (existing coverage; it fails until Task 4 adds handlers, so run it at the end of Task 4) and `packages/rt-client/test/no-unlisted-command-call-sites.test.ts`.

**Interfaces (Produces, consumed by Tasks 4-9):**

```ts
export type HerdBudget = { used: number; cap: number; spent: boolean };
export interface HerdJobBudgets {
  respawns: HerdBudget; blockedNotices: HerdBudget; unmergedReports: HerdBudget;
  nudges: Record<string, HerdBudget>; reviewerRounds: Record<string, HerdBudget>;
}
// HerdJobInfo gains: model: string | null; effort: string | null; account: string | null
"herd:spawn":   payload adds tree?: string; data unchanged
"herd:respawn": { payload: { herd: string; job: string; brief?: string; model?: string; effort?: string; account?: string };
                  data: Commands["herd:spawn"]["data"] & { launch: { model: string | null; effort: string | null; account: string | null }; budget: HerdBudget; settled: { closed: string[]; consumed: string[] } } }
export type HerdDiagnoseVerdict = "no-pane" | "gone" | "dead" | "at-gate" | "parked-modal" | "needs-human" | "working" | "rate-limited" | "login-expired" | "idle";
"herd:diagnose": { payload: { herd: string; job: string };
                   data: { job: string; status: HerdJobStatus; pane: string | null; paneState: "working" | "idle" | "modal" | "dead" | "gone" | null;
                           verdict: HerdDiagnoseVerdict;
                           openGates: Array<{ id: string; kind: string; presentation: "form" | "wait"; owner: string }>;
                           lastGate: { id: string; status: GateStatus; consumed: boolean | null } | null;
                           watchdog: { strikes: number; lastPokeAt: number | null } | null; budgets: HerdJobBudgets } }
"herd:nudge": { payload: { herd: string; job: string; gate: string };
                data: { gate: string; rung: "dm" | "pane"; delivered: boolean; needsHuman: boolean;
                        why?: "pane-busy" | "form-open" | "pane-gone" | "not-claude" | "refused"; budget: HerdBudget } }
export interface HerdLaneRow {
  job: string; worktree: string; branch: string | null; base: string; commits: number;
  drift: { files: Array<{ path: string; added: number; removed: number }>; filesChanged: number; insertions: number; deletions: number };
  collidesWith: Array<{ job: string; files: string[] }>;
  merge: { forge: "github" | "gitlab" | null; state: "open" | "merged" | "closed" | "none" | "unknown"; url: string | null; number: number | null; mergedAt: string | null; error?: string };
  unmergedReports: HerdBudget;
}
"herd:lanes": { payload: { herd: string; job?: string };
                data: { lanes: HerdLaneRow[]; collisions: Array<{ path: string; jobs: string[] }>; skipped: Array<{ job: string; reason: string }> } }
```

Client functions are `herdRespawn`, `herdDiagnose`, `herdNudge` and `herdLanes`, built like `herdSpawn` (`rtCommand` with a payload copy). They need two timeouts:
- `herdRespawn`: the caller passes 300_000, as spawn does.
- `herdLanes`: a 120_000 default.

`herdSpawn` copies `tree` as well.

- [ ] **Step 1:** Add the types, entries, names, client functions and exports. `HerdJobStatus` is not in rt-client: use its string union inline, or `HerdJobInfo["status"]`.
- [ ] **Step 2:** Run `bun run build` in `packages/rt-client`. Expected: exits 0.
- [ ] **Step 3:** Run `bun test packages/rt-client/test/no-unlisted-command-call-sites.test.ts packages/rt-client/test/dist-freshness.test.ts`. Expected: PASS.
- [ ] **Step 4:** Commit: `rt-client: catalog herd respawn, diagnose, nudge and lanes`.

### Task 3: Herd store columns, budgets, and persisted watchdog ladders

**Files:**
- Create: `lib/daemon/herd-budgets.ts`
- Modify: `lib/daemon/herd-store.ts`, `lib/daemon/herd-watchdog.ts`, `lib/daemon.ts` (the watchdog construction, ~lines 1377-1394)
- Test: `lib/daemon/__tests__/herd-store.test.ts`, `lib/daemon/__tests__/herd-budgets.test.ts` (new), `lib/daemon/__tests__/herd-watchdog.test.ts`

**Interfaces:**
- Produces in `herd-budgets.ts`:

  ```ts
  export type BudgetCounter = "respawns" | "blockedNotices" | "nudges" | "reviewerRounds" | "unmergedReports";
  export const BUDGET_CAPS: Record<BudgetCounter, number>; // 2, 3, 2, 2, 2
  export function budgetView(used: number, counter: BudgetCounter): HerdBudget;
  export function jobBudgets(rows: Array<{ counter: BudgetCounter; key: string; used: number }>): HerdJobBudgets;
  ```

  `unmergedReports` counts its rows (one per report id). `nudges` and `reviewerRounds` map by key. A missing counter reads `used: 0`.
- Produces on `HerdStore`:
  - `upsertJob` input and `HerdJobRow` gain `model`, `effort` and `account` (`string | null`). They keep the existing value when `undefined`.
  - `tickBudget(herd, job, counter, key?): number` returns the new `used`.
  - `markBudgetOnce(herd, job, counter, key): boolean` inserts `used = 1` only if absent (for `unmergedReports`) and returns whether it inserted.
  - `budgetRows(herd, job)`.
  - `watchdogLoad(): { ladders: Array<{ key: string; strikes: number; lastPokeAt: number | null; since: number; parked: boolean }>; marks: Array<{ kind: "action" | "notified"; key: string; at: number }> }`
  - `watchdogSaveLadder(row)`, `watchdogDeleteLadder(key)`, `watchdogMark(kind, key, at)`, `watchdogClear()`.
- Produces on `HerdWatchdog`: a constructor option `persist?: WatchdogPersist` (that same load/save/delete/mark/clear shape). Omitted, it keeps everything in memory, as today.

- [ ] **Step 1: Write the failing tests**
  - `herd-store.test.ts`:
    - `upsertJob stores and keeps model, effort and account`: a second upsert without them keeps the stored values.
    - `opening an old herds.db adds the launch columns`: create the table without them first, as the `shepherdPane` migration test does.
    - `tickBudget counts per key`.
    - `markBudgetOnce inserts a report id once`.
    - `watchdog rows round-trip and clear`.
  - `herd-budgets.test.ts`:
    - `budgetView marks spent at the cap and keeps counting past it`: `used 3` with cap 2 gives `{used: 3, cap: 2, spent: true}`.
    - `jobBudgets defaults absent counters to zero`.
  - `herd-watchdog.test.ts`:
    - `ladder survives a rebuild from the same persist store`: drive a worker to strike 3 with an in-memory `persist` fake, build a second `HerdWatchdog` on the same fake, and expect `annotations()` to read strikes 3.
    - `disabling clears persisted ladders and marks`.
    - `a healthy verdict deletes the persisted ladder`.
- [ ] **Step 2:** Run `bun test lib/daemon/__tests__/herd-store.test.ts lib/daemon/__tests__/herd-budgets.test.ts lib/daemon/__tests__/herd-watchdog.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the code.
  - **Store tables:**
    - `herd_budgets (herd, job, counter, key, used, updatedAt, PK(herd, job, counter, key))`
    - `herd_watchdog_ladders (key PK, strikes, lastPokeAt, since, parked)`
    - `herd_watchdog_marks (kind, key, at, PK(kind, key))`
    - plus the `ALTER TABLE` migrations for the three job columns.
  - **Watchdog:** loads at construction and writes through on `track`, `commit`, the park flag, ladder delete, `lastActionAt` and `notifiedAt`.
  - **Comments:** replace the "In memory by design" comment.
  - **`lib/daemon.ts`:** pass `persist` built over `herdStore`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `herd store: launch settings, budgets, persisted watchdog ladders`.

### Task 4: `herd:spawn {tree}`, launch persistence, and `herd:respawn`

**Files:**
- Modify: `lib/daemon/handlers/herd.ts` (the `herd:spawn` body, ~lines 411-499; new `herd:respawn`)
- Create: `lib/daemon/herd-tree-admission.ts`
- Test: `lib/daemon/__tests__/herd-handlers.test.ts`, `lib/daemon/__tests__/herd-tree-admission.test.ts` (new)

**Interfaces:**
- Consumes: `loadRegistry`, `findTreeByPath` and `TreeRecord` (`lib/worktree/registry.ts`); store methods from Task 3.
- Produces:
  - `admitTree(rec: TreeRecord | undefined, name: string): { ok: true; tree: TreeRecord } | { ok: false; error: string }`. The error names the kind and state, for example `tree "x" is unmanaged; only a claimed ephemeral tree can host a worker`.
  - `HerdDeps` gains `registry?: { load(repo: string): TreeRecord[]; byPath(path: string): { repoName: string; tree: string } | null }`, defaulting to the real functions.
  - An internal `launchJob(herd, name, { worktree, branch, tree, disposable, brief?, model, effort, account })`, shared by spawn and respawn.

- [ ] **Step 1: Write the failing tests** (use `harness({ registry: fakeRegistry })`)
  - `herd-tree-admission.test.ts`:
    - `admits a claimed ephemeral tree`.
    - `refuses unknown, main, golden, unmanaged, and ephemeral creating/on-deck/disposable trees`.
  - `herd-handlers.test.ts`, spawn and respawn:
    - `spawn with tree launches in the registered path without provisioning`: `worktreeCalls` is empty, and `agentCalls[0].cwd` is the tree path.
    - `spawn with tree refuses an unmanaged tree`.
    - `spawn persists model, effort and account on the job row`.
    - `guest spawn keeps tree null so wrap-up cannot dispose the host tree`: the host owns tree `t1` and the guest `review-a` spawns into `t1`. Then `herd:wrap-up {dispose: ["review-a"]}` refuses with `no rt-provisioned tree for this job`, and `worktreeCalls` holds no dispose.
    - `guest spawn ticks the host's reviewerRounds under its latest milestone artifact`: open a milestone for the host with `artifact: "/a/spec.md"`, spawn a guest, and expect `jobBudgets(...).reviewerRounds["/a/spec.md"].used` to be 1.
    - `respawn reuses the worktree and inherits model, effort and account`.
    - `respawn overrides one setting and keeps the others`.
    - `respawn refuses a job whose worktree is gone`: remove the dir; the error contains the path; no provision call.
    - `respawn refuses an unknown job`.
    - `respawn ticks respawns and reports spent at 2 but still launches the third`: three respawns, all ok; the third returns `budget: {used: 3, cap: 2, spent: true}`.
    - `respawn closes the old session's open gates and settles its answered unconsumed gates`: `settled.closed` holds the open gate's id, which is now closed `abandoned`; `settled.consumed` holds the answered one, whose `consumedAt` is set.
- [ ] **Step 2:** Run `bun test lib/daemon/__tests__/herd-handlers.test.ts lib/daemon/__tests__/herd-tree-admission.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the code.
  - **Guest:** another job in this herd has `tree === name` and status ≠ `closed`.
  - **Respawn:** checks `existsSync(job.worktree)`, then `registry.byPath(job.worktree)`, then `admitTree` on that record.
  - **Settle:** applies to gates whose `nudge.session` equals the old `agentSession`, among the job's gates (subject `herd:<id>/<job>`, plus run gates in its worktree).
- [ ] **Step 4:** Run the same command, plus `bun test lib/daemon/__tests__/rt-client-commands.test.ts` (it needs Tasks 6-8's handlers too; until then, expect only the missing-handler names for diagnose, nudge and lanes). Expected: the herd tests PASS.
- [ ] **Step 5:** Commit: `herd: spawn into a registered tree, persist launch settings, add respawn`.

### Task 5: Tick blocked notices from the lifecycle

**Files:**
- Modify: `lib/daemon/herd-lifecycle.ts:244-247`
- Test: `lib/daemon/__tests__/herd-lifecycle.test.ts`

- [ ] **Step 1:** Write the failing test `blocked notice ticks blockedNotices for the job`. Fire the blocked debounce with the fake timer, then expect `store.budgetRows` to hold `blockedNotices` with `used` 1. Also `a cleared blocked timer does not tick`.
- [ ] **Step 2:** Run `bun test lib/daemon/__tests__/herd-lifecycle.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Call `store.tickBudget(job.herd, job.name, "blockedNotices")` beside the post, inside the timer callback.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `herd lifecycle: count blocked notices`.

### Task 6: `herd:diagnose` and the screen classifier

**Files:**
- Create: `lib/daemon/herd-diagnose.ts`
- Modify: `lib/daemon/handlers/herd.ts` (new `herd:diagnose`)
- Test: `lib/daemon/__tests__/herd-diagnose.test.ts` (new), `lib/daemon/__tests__/herd-handlers.test.ts`

**Interfaces:**
- Produces:
  - `LIMIT_PREFIXES: readonly string[]`, verbatim from Claude Code 2.1.301:
    - `"You've hit your"`
    - `"You've reached your"`
    - `"You're out of usage credits"`
    - `"Your org is out of usage"`
    - `"Your seat type doesn't include"`
    - `"Your usage allocation has been disabled"`
    - `"Your group's usage limit is set to $0"`
    - `"You're out of extra usage"`
  - `LIMIT_CREDITS_RE = /^(?:Fable|Haiku|Mythos|Opus|Sonnet)(?: [^·\n]{1,40})? requires usage credits\./`
  - `LOGIN_RE = /(?:Please run|Run) \/login\b|^(?:Login expired|OAuth token revoked|Not logged in)\b/`
  - `classifyScreen(text: string): "rate-limited" | "login-expired" | null`:
    - Reads only lines above the last composer rule (`^\s*─{10,}\s*$`, the same rule `backgroundTask` uses).
    - Strips a leading gutter (`/^\s*(?:⎿\s*)?/`) and tests the prefix at line start.
    - Login wins over limit when both appear.
  - `diagnoseVerdict(input: { hasPane: boolean; paneState: ... | null; openGates: number; jobStatus: HerdJobStatus; screen: ReturnType<typeof classifyScreen> }): HerdDiagnoseVerdict` applies the spec's order.
  - `HerdDeps` gains `paneScreen?: (pane: string, socket: string | null) => Promise<string | null>`. Its default reads `herdr("pane.read", { pane_id, source: "visible" })`.

- [ ] **Step 1: Write the failing tests**
  - `herd-diagnose.test.ts`. Fixtures are built from the bundle strings with a header comment saying they are bundle-derived, not captured screens.
    - `classifies every limit prefix as rate-limited` (table-driven).
    - `classifies Login expired · Please run /login and API Error: 401 … · Please run /login as login-expired`.
    - `ignores warning prefixes You've used and You're close to`.
    - `limit text inside a longer sentence does not classify`.
    - `ignores text below the composer rule`.
    - `diagnoseVerdict order`: one table row per verdict, including `at-gate` beating `parked-modal` and `needs-human` for a blocked pane with no gate.
  - `herd-handlers.test.ts`:
    - `diagnose returns verdict, gates and budgets but never screen text`: a fake `paneScreen` returns a limit screen and the pane reads idle, so `verdict` is `rate-limited`. `JSON.stringify(data)` does not contain `hit your`.
    - `diagnose does not read the screen of a working pane` (the `paneScreen` spy is not called).
    - `diagnose refuses an unknown job`.
- [ ] **Step 2:** Run `bun test lib/daemon/__tests__/herd-diagnose.test.ts lib/daemon/__tests__/herd-handlers.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the code.
  - The pane state comes from `paneStatuses(deps.herdr, herd.herdrSocket)`, mapped as `readingState` in the watchdog adapters (export that mapper and reuse it).
  - The open gates come from `openHerdGates` and `listHerdRunGates`, filtered to this job.
  - The watchdog annotations come from `deps.watchdog`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `herd: diagnose a stuck worker without returning pane text`.

### Task 7: `herd:nudge`

**Files:**
- Modify: `lib/daemon/handlers/herd.ts` (new `herd:nudge`)
- Test: `lib/daemon/__tests__/herd-handlers.test.ts`

**Interfaces:**
- Consumes: `chat:dm` (add it to `HerdDeps.chat`'s `Pick` and wire it in `command-router.ts`), `injectIntoPane` from `lib/daemon/inject.ts`, and `HerdDeps.inject?: typeof injectIntoPane` (defaults to the real one).

- [ ] **Step 1: Write the failing tests**
  - `first nudge DMs the job handle from the shepherd and ticks`: `chat:dm` gets `{from: shepherdHandle, to: job.handle, body: "call herd_answer for <id>"}`, with `rung: "dm"`, `delivered: true` and `budget.used` 1.
  - `second nudge types into an idle pane with no form gate`: `inject` gets the exact pane line from Global Constraints, with `rung: "pane"`.
  - `second nudge with a form-presentation gate open returns form-open and does not tick`.
  - `second nudge on a working pane returns pane-busy and does not tick` (`inject` is not called).
  - `injector refusal returns refused, needsHuman, no tick`.
  - `third nudge still acts and reports spent`.
  - `refuses a gate that is not this job's, an unanswered gate, a consumed gate, and a gate from a replaced session`.
- [ ] **Step 2:** Run `bun test lib/daemon/__tests__/herd-handlers.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the handler. The rung is `budgetRows`' `nudges[gate].used === 0 ? "dm" : "pane"`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `herd: nudge ladder with persisted per-gate budget`.

### Task 8: `herd:lanes`

**Files:**
- Create: `lib/daemon/herd-lanes.ts`
- Modify: `lib/daemon/handlers/herd.ts` (new `herd:lanes`), `lib/daemon/command-router.ts` (herd deps), `lib/daemon.ts` (only if a real dep needs daemon-only state)
- Test: `lib/daemon/__tests__/herd-lanes.test.ts` (new), `lib/daemon/__tests__/herd-handlers.test.ts`

**Interfaces:**
- Produces:
  - `parseNumstat(out: string): HerdLaneRow["drift"]`. Binary files are `-\t-`: count them as 0/0 and keep the path.
  - `collisions(rows: Array<{ job: string; files: string[] }>): Array<{ path: string; jobs: string[] }>`.
  - `interface LaneDeps { git(cwd: string, args: string[]): Promise<{ stdout: string; exitCode: number }>; defaultRef(cwd: string): Promise<string>; merge(worktree: string, branch: string): Promise<HerdLaneRow["merge"]> }`.
  - `realLaneDeps`:
    - `git` is `runGit` and `defaultRef` is `remoteDefaultRef` (`lib/worktree/git-async.ts`).
    - `merge` reads `remote.origin.url`, picks the forge with `forgeTokenFor` (secrets from `loadSecrets`, with the GitHub token falling back to `resolveGithubToken`), and parses `parseRemoteUrl(url).projectPath`.
    - GitHub: `new GitHubProvider(host, token).fetchPullRequestByBranch(projectPath, branch, "all")`.
    - GitLab: `getRepoContext(repoIdentity)` then `listMrsLive(provider, projectPath, { sourceBranch: branch, state: "all", limit: 1 })`.
    - Map `opened` to `open`. No result is `none`; a throw is `unknown` with `error`.
  - `HerdDeps.lanes?: LaneDeps`.

- [ ] **Step 1: Write the failing tests**
  - `herd-lanes.test.ts`:
    - `parseNumstat totals insertions and deletions and keeps binary paths`.
    - `collisions lists a file two jobs changed`.
    - `commits and drift come from merge-base against the default ref`: a fake `git` records argv `["diff", "--numstat", "--merge-base", "origin/main"]` and `["rev-list", "--count", "origin/main..HEAD"]`.
  - `herd-handlers.test.ts`, with fake `lanes`:
    - `lanes returns per-job drift, collisions and merge`.
    - `guest jobs get no lane row`.
    - `forge error reads unknown and does not tick unmergedReports`.
    - `a done job's report read open ticks unmergedReports once per report id` (two lanes calls on the same report make one tick).
    - `merged never ticks`.
    - `a job whose worktree is gone is listed in skipped`.
    - `job filter narrows lanes but collisions span every job`.
- [ ] **Step 2:** Run `bun test lib/daemon/__tests__/herd-lanes.test.ts lib/daemon/__tests__/herd-handlers.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the handler and the real deps, and wire `lanes`, `chat:dm`, `inject`, `registry` and `paneScreen` in `command-router.ts` (defaults may live in `createHerdHandlers`).
- [ ] **Step 4:** Run the same command, plus `bun test lib/daemon/__tests__/rt-client-commands.test.ts`. Expected: all PASS.
- [ ] **Step 5:** Commit: `herd: lanes read with drift, collisions and merge state on both forges`.

### Task 9: MCP tools

**Files:**
- Modify: `lib/mcp/herd-tools.ts`
- Test: `lib/mcp/__tests__/herd-tools.test.ts`, `lib/mcp/__tests__/shell-forms.test.ts` (existing), `lib/mcp/__tests__/tools.test.ts` (existing)

**Interfaces:**
- Consumes: `herdRespawn`, `herdDiagnose`, `herdNudge`, `herdLanes`, `herdGates`, `gateAnswer`, `gatePark` and `validateGateAnswers` from rt-client. `HerdToolDeps` gains `respawn`, `diagnose`, `nudge`, `lanes`, `gates`, `answer` and `park`, and the test `fake` records them.
- Produces the tools:
  - `herd_respawn {herd?, job, brief?, model?, effort?, account?}`: brief confinement and token checks as `herd_spawn`; `SPAWN_TIMEOUT_MS`.
  - `herd_spawn` adds `tree?: string`. It refuses `dir` as now. It refuses `job "<job>" already has a worktree; respawn it with herd_respawn` when status data lists the job with a worktree, no `tree` is given and the job's `worktree` exists on disk (check with `existsSync` in the tool).
  - `herd_gate_answer {herd?, gate, answers}`:
    - The gate must be among `herd:gates` rows.
    - It validates per question with `validateGateAnswers` against the row's questions. On a failure, return `{status: "refused", invalid: [{question, got, validValues}]}` as an ok body.
    - Then `gate:answer {by: "shepherd", session}`. Success is `{status: "recorded", gate, answer}`; a conflict is `{status: "conflict", winner: {answers, by}}`.
    - Closed, owned-by and not-found errors use `gate_answer`'s exact wording.
  - `herd_gate_park {herd?, gate}`: the gate must be among `herd:gates` rows; returns `{status: "parked", gate}`.
  - `herd_diagnose {herd?, job}`, `herd_nudge {herd?, job, gate}` and `herd_lanes {herd?, job?}`: guard, then call the verb.

- [ ] **Step 1: Write the failing tests**
  - Extend `SHEPHERD_ONLY` with each new tool. That covers the worker-pane refusal, other-session refusal and no-session refusal through the existing loop.
  - `herd_respawn passes inherited-free payload and never a dir`.
  - `herd_spawn passes tree through`.
  - `herd_spawn refuses an existing job with a worktree and no tree`.
  - `herd_gate_answer refuses a gate outside this herd`.
  - `herd_gate_answer returns refused with validValues for a bad value and never calls answer`.
  - `herd_gate_answer records by shepherd with this session`.
  - `herd_gate_answer reports a conflict winner`.
  - `herd_gate_answer has no override property in its schema`.
  - `herd_gate_park refuses a gate outside this herd and parks one inside`.
  - `every new tool declares shellForms none`.
- [ ] **Step 2:** Run `bun test lib/mcp/__tests__/herd-tools.test.ts lib/mcp/__tests__/temp-root-guard.test.ts lib/mcp/__tests__/tools.test.ts lib/mcp/__tests__/shell-forms.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the tools.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `mcp: herd respawn, gate answer and park, diagnose, nudge, lanes tools`.

### Task 10: Plugin reference, version, e2e roster, gates

**Files:**
- Modify: `plugins/mattstack/attachments/mcp-tools/reference.md` (regenerated), `plugins/mattstack/.claude-plugin/plugin.json` (`0.31.6` → `0.31.7`), `e2e/tests/mcp-serve.test.ts` (`EXPECTED_TOOL_NAMES`: add the new names only if that list covers herd-tools' tools; check what it lists today)

- [ ] **Step 1:** Run `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`. Expected: a diff naming the seven tools. `cli.ts` is source, not a built binary.
- [ ] **Step 2:** Bump the version and update `EXPECTED_TOOL_NAMES` if it applies.
- [ ] **Step 3:** Run `bun run test:e2e -- e2e/tests/mcp-serve.test.ts` (use the package script's form for one file), then `bun run check`, then `bun run purity`. Expected: all pass.
- [ ] **Step 4:** Run every test file touched in Tasks 1-9 once more in one `bun test` invocation. Expected: PASS.
- [ ] **Step 5:** Commit: `mattstack plugin 0.31.7: regenerate the MCP tools reference`.
