# Usage Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep per-message token usage in a durable store, attributed to runs, stages and MRs, and serve it to Console.

**Architecture:** `rt usage sweep` reads run DBs, the `agents` table and Claude transcripts into `~/.mattstack/rt/usage.db`. The daemon runs it as a child process every 5 minutes. Read-only `usage:*` daemon verbs answer MR, trend and status queries, and Console's server proxies them.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, Hono (Console server), vitest (Console), `bun test` (rt).

**Spec:** `docs/superpowers/specs/2026-11-04-usage-store-design.md`

## Global Constraints

- Run `bun test` from the repo root only. Run targeted tests for the files touched; CI runs the full suite.
- Tests never read the real `~/.claude` or `~/.mattstack`. Everything in `lib/usage/` takes paths as parameters.
- A built binary only ever runs under an isolated HOME.
- Child processes get `childEnv()` from `lib/subprocess.ts`.
- Fixtures use neutral ids (`acme/widgets`, `WEB-123`). No real tickets, repos or MR numbers.
- No Console screens in this plan.
- `usage.db` stores counts and identifiers only, never prompt or response text.
- Comments state only a constraint the code cannot show.
- Commit messages are short and imperative, and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Read before coding: `.claude/rules/daemon.md`, `output-layer.md`, `command-tree.md`, `workspace-packages.md`, and the `rt-repo-identity` skill.

## Review Focus

- Console opens Usage before any sweep has run: `usage:*` return empty results, and never an error. (Task 9)
- A run DB is unreadable, locked or from an old schema: that run is skipped and the sweep finishes. (Task 5)
- The same session file exists in two Claude config dirs: its messages count once and offsets do not fight. (Task 3)
- A sweep dies holding the lock: the next sweep takes it over after 30 minutes. (Task 7)
- `stableMachineId()` returns null: a generated id is stored in `usage_meta` and reused. (Task 1)

---

### Task 1: Store and backup

**Files:**
- Create: `lib/usage/store.ts`
- Modify: `lib/state/backup-sources.ts:14-19`
- Test: `lib/usage/__tests__/store.test.ts`

**Interfaces:**
- Produces:
  - `usageDbPath(): string`, which is `join(rtDir(), "usage.db")`
  - `openUsageDb(path: string): Database` for read-write, migrated, WAL
  - `openUsageDbReadonly(path: string): Database | null`, null when the file is missing
  - `machineIdFor(db: Database, stable: () => Promise<string | null>): Promise<string>`
  - `USAGE_SCHEMA_VERSION = 1`

- [ ] **Step 1: Write the failing tests**

`opening creates every table`: asserts `usage_messages`, `usage_runs`, `usage_stages`, `usage_sessions`, `usage_files`, `usage_meta` exist and `PRAGMA user_version` is 1.
`reopening keeps rows`: insert one `usage_meta` row, reopen, row is present.
`a null stable id falls back to one stored id`: two `machineIdFor` calls with `async () => null` return the same non-empty string.
`a stable id is used as is`: `async () => "abc"` returns `"abc"`.
`readonly open of a missing file returns null`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun test lib/usage/__tests__/store.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/usage/store.ts`**

Columns are the spec's Schema section, with these additions: `usage_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)` and `machine_id` on `usage_messages`, `usage_runs`, `usage_stages` and `usage_sessions`. Primary keys: `usage_messages (machine_id, message_id)`, `usage_runs (machine_id, run_id)`, `usage_stages (machine_id, run_id, name, attempt)`, `usage_sessions (machine_id, session_id, source, ref)`, `usage_files (path)`. Add `usage_files.config_dir` and the indexes from the spec. Use `CREATE TABLE IF NOT EXISTS` only.

- [ ] **Step 4: Add the backup row**

Add `{ app: "rt", type: "sqlite", sourcePath: "rt/usage.db", ext: ".db" }` to `BACKUP_SOURCES`. The backup loop already skips a missing file.

- [ ] **Step 5: Run the tests**

Run: `bun test lib/usage/__tests__/store.test.ts lib/state/__tests__`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/usage lib/state/backup-sources.ts
git commit -m "add usage store"
```

### Task 2: Keep every session a run used

**Files:**
- Modify: `lib/runs/identity.ts`
- Test: `lib/runs/__tests__/identity.test.ts` (create if absent)

**Interfaces:**
- Produces: a run field `claude-sessions`, a JSON array of session ids in first-seen order.

- [ ] **Step 1: Write the failing tests**

`a first session records a one-item list`: `recordIdentity` with `CLAUDE_CODE_SESSION_ID=s1` gives `claude-sessions` of `["s1"]`.
`a new session appends`: `s1` then `s2` gives `["s1","s2"]` and `claude-session` of `s2`.
`returning to an old session does not duplicate it`: `s1`, `s2`, `s1` gives `["s1","s2"]`.
`an unchanged session leaves fields.at alone`: same session twice with a later `now` keeps the `at` of both fields.
`an existing claude-session seeds the list`: a run with only `claude-session=s0`, then `s1`, gives `["s0","s1"]`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun test lib/runs/__tests__/identity.test.ts`
Expected: FAIL on the `claude-sessions` assertions.

- [ ] **Step 3: Implement in `recordIdentity`**

Update `claude-sessions` only when the session is absent from the list, using the same `INSERT OR REPLACE` shape, with `produced_by` `run`.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/runs/__tests__/identity.test.ts lib/runs/__tests__/liveness.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/runs
git commit -m "runs: keep every claude session a run used"
```

### Task 3: Transcript reader

**Files:**
- Create: `lib/usage/transcripts.ts`
- Test: `lib/usage/__tests__/transcripts.test.ts`

**Interfaces:**
- Produces:

```ts
export interface TranscriptFile {
  path: string; sessionId: string; configDir: string;
  subagentId: string | null; subagentType: string | null; subagentModel: string | null;
}
export interface UsageMessage {
  messageId: string; sessionId: string; ts: number; model: string;
  subagentId: string | null; subagentType: string | null; subagentModel: string | null;
  input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number;
  thinking: number; speed: string | null; serviceTier: string | null;
}
export function indexTranscripts(configDirs: string[], sessionIds: Set<string>): TranscriptFile[];
export function readFrom(file: TranscriptFile, offset: number):
  { messages: UsageMessage[]; nextOffset: number; skippedLines: number };
```

- [ ] **Step 1: Write the failing tests**

Build fixture trees in a temp dir.

`indexes only linked sessions`: two sessions on disk, one in the set, one file returned.
`finds subagent files and reads their meta`: `<session>/subagents/agent-a1.jsonl` with `{"agentType":"general-purpose","model":"opus"}` gives `subagentId "a1"`.
`a session in two config dirs yields one file`: the first dir in `configDirs` wins.
`maps usage fields`: one entry with `cache_creation.ephemeral_1h_input_tokens: 491` gives `cacheWrite1h 491`, and `output_tokens_details.thinking_tokens` maps to `thinking`.
`skips entries with no usage and the synthetic model`.
`dedupes a repeated message id within a read`: two entries with one id give one message, the later one.
`a partial last line stays unread`: file ending without a newline gives `nextOffset` at the last newline, and appending the rest then reading from it returns the message.
`a malformed line is skipped and counted`: `skippedLines` is 1 and the next line still parses.
`ts is epoch ms`: `2026-01-02T00:00:00.000Z` gives `Date.UTC(2026,0,2)`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun test lib/usage/__tests__/transcripts.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/usage/transcripts.ts`**

`indexTranscripts` lists `projects/*` once per config dir rather than globbing per session. `readFrom` reads bytes from the offset, stops at the last `\n`, and filters on the substring `"usage"` before `JSON.parse`. `S` is the file's session, not the entry's `sessionId`.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/usage/__tests__/transcripts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/usage
git commit -m "usage: read token usage from transcripts"
```

### Task 4: MR key and run kind

**Files:**
- Create: `lib/usage/mr-key.ts`
- Test: `lib/usage/__tests__/mr-key.test.ts`

**Interfaces:**
- Produces:

```ts
export function mrKeyFromUrl(url: string): string | null;
export function mrKeyFromField(value: string, runRepo: string): string | null;
export function mrKeyFromSubject(subject: string): string | null;
export type UsageKind = "work" | "review" | "respond" | "doctor" | "other";
export function kindOf(workType: string): UsageKind;
```

- [ ] **Step 1: Write the failing tests**

`a GitLab url resolves`: `https://gitlab.com/acme/widgets/-/merge_requests/12/diffs` gives `${serializeIdentity({kind:"remote",id:"gitlab.com/acme/widgets"})}!12`.
`a GitHub url resolves`: `https://github.com/acme/widgets/pull/7` gives the identity for `github.com/acme/widgets` plus `!7`.
`a nested GitLab group keeps its path`.
`junk returns null`.
`the cleared marker means none`: `mrKeyFromField("-", repo)` is null.
`a bare number uses the run's repo`: `mrKeyFromField("!405", <serialized identity>)` gives `<identity>!405`.
`a bare number on a pre-cutover repo means none`: `mrKeyFromField("!405", "legacy-run-dir-name")` is null.
`a subject resolves`: `mr:https://gitlab.com/acme/widgets/-/merge_requests/12` gives the same key as the url; `agent:abc` is null.
`kinds match the spec`: `feature` and `work` give `work`, `review` gives `review`, `receive-review` gives `respond`, `ship` gives `other`.
`kinds agree with Console`: import `runKind` from `apps/console/src/app/runs/derive/kind.ts` and assert that it agrees with `kindOf` on those work types, with Console's `utility` meaning `other`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun test lib/usage/__tests__/mr-key.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Use `serializeIdentity` and `parseIdentity` from rt-client. Do not touch `parseMrUrl`. Its callers read `null` as GitHub.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/usage/__tests__/mr-key.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/usage
git commit -m "usage: resolve MR keys and run kinds"
```

### Task 5: Snapshot runs and link sessions

**Files:**
- Create: `lib/usage/sources.ts`
- Test: `lib/usage/__tests__/sources.test.ts`

**Interfaces:**
- Consumes: `openUsageDb`, `mrKeyFromField`, `mrKeyFromSubject`.
- Produces:

```ts
export interface AgentLink { id: string; sessionId: string; subject: string | null; label: string | null; caller: string | null }
export function snapshotRuns(db: Database, runsRoot: string, machineId: string): { runs: number; skipped: number };
export function linkAgents(db: Database, agents: AgentLink[], machineId: string): void;
export function linkedSessionIds(db: Database, machineId: string): Set<string>;
```

- [ ] **Step 1: Write the failing tests**

Build run DBs with the `lib/runs/__tests__/fixtures.ts` helpers.

`copies a run and its stages`: `usage_runs` holds pipeline, times, ticket, branch, `mr_url` and `mr_key`.
`reads the mr field directly`: a review run's reviewed MR gets a key, even though `sessionAndMr` hides it.
`links claude-sessions and falls back to claude-session`.
`skips test runs`: a run with a `test` field writes nothing.
`a corrupt run DB is skipped`: a garbage `state.db` beside a good run gives `skipped: 1` and the good run is stored.
`an old-schema run DB still snapshots`: no `pack_commits` column, run stored.
`a pruned run keeps its snapshot`: delete the dir, snapshot again, row unchanged.
`a mr: agent links session to MR`: `agent_mr_key` set.
`a run: agent adds a session to that run`: `subject: run:<id>` writes a `source = run` link.
`a doctor agent is marked doctor`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun test lib/usage/__tests__/sources.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/usage/sources.ts`**

Open each run DB readonly, inside try/catch per run. Check how `apps/board/src/herdr.ts:527-603` labels its three launches, then mark a doctor from that label.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/usage/__tests__/sources.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/usage
git commit -m "usage: snapshot runs and link sessions"
```

### Task 6: Attribution

**Files:**
- Create: `lib/usage/attribute.ts`
- Test: `lib/usage/__tests__/attribute.test.ts`

**Interfaces:**
- Consumes: tables from Tasks 1 and 5.
- Produces:

```ts
export function attributeMessages(db: Database, machineId: string): { changed: number };
export function isFinalRun(status: string, endedAt: number | null, lastSweepAt: number | null): boolean;
```

- [ ] **Step 1: Write the failing tests**

Seed tables directly.

`inside a stage window gives attribution stage`.
`inside a run, between stages, gives attribution run with a null stage`.
`overlapping runs pick the latest started`.
`a retried stage picks the latest attempt`.
`a live run has an open window`.
`before the first run uses the next run, attribution session`.
`after a run uses the previous run, attribution session`.
`agent-only sessions get mr_key with a null run_id, attribution session`.
`an unlinked session gets attribution none`.
`mr_key comes from the run first`: run and agent disagree, the run's wins.
`a run with no MR falls back to the agent link`.
`a run gaining an mr later updates its messages`.
`a final run's messages stop changing`: edit the stage window after `isFinalRun` is true, attribute again, nothing moves.
`a subagent message follows the same rule`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun test lib/usage/__tests__/attribute.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `attributeMessages`**

Follow the Attribution steps in the spec, in order. Work one session at a time, in memory, inside one transaction. Skip messages already attributed to a final run. A run is final once it is terminal and a later sweep has already run, so `lastSweepAt` must be after `endedAt`.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/usage/__tests__/attribute.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/usage
git commit -m "usage: attribute messages to runs, stages and MRs"
```

### Task 7: Sweep and verb

**Files:**
- Create: `lib/usage/sweep.ts`, `commands/usage.ts`
- Modify: `lib/command-tree-def.ts`
- Test: `lib/usage/__tests__/sweep.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 5, 6.
- Produces:

```ts
export interface SweepInput {
  dbPath: string; runsRoot: string; configDirs: string[];
  agents: AgentLink[]; machineId: () => Promise<string | null>; now: number;
}
export interface SweepResult {
  ran: boolean; files: number; messages: number; skippedLines: number; conflicts: number; durationMs: number;
}
export function runSweep(input: SweepInput): Promise<SweepResult>;
```

`usage_meta` keys written: `last_sweep_at`, `last_sweep_ms`, `skipped_lines`, `conflicts`, `sweep_lock`.

- [ ] **Step 1: Write the failing tests**

`one MR total with no double counting`: a work run, two respond runs, a doctor session and a session shared by two runs produce one `mr_key`, with the sum of `output` equal to the fixture's known total.
`a rerun with no new bytes changes nothing`: second `runSweep` gives `messages: 0`, and rows are identical.
`new bytes are read from the offset`: append one entry, `messages: 1`.
`a partial last line finishes next sweep`.
`a shrunken file is reread from 0 without duplicating rows`.
`deleting a run DB and transcript keeps its rows`.
`a message id in two files keeps the earlier copy, whichever is read first`, and `conflicts` is 1. Run it in both orders.
`a session linked later is read from byte 0`.
`a held lock makes a second sweep return ran: false`.
`a lock older than 30 minutes is taken over`.
`sessions linked to nothing are not read`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun test lib/usage/__tests__/sweep.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `runSweep`**

Order: take lock, `snapshotRuns`, `linkAgents`, index, read each file from its offset, upsert in batches of 500, `attributeMessages`, write status, release lock in `finally`. On a conflicting id keep the earliest `ts`. A shrunken file or a backward mtime resets its offset to 0. A sweep with more than 1% skipped lines logs a warning.

- [ ] **Step 4: Add the verb**

Add `usage: { description: "Token usage for pipeline runs", subcommands: { sweep } }` to the tree, with `sweep` `hidden: true`, an `omitBehavior` of `{ exempt: "run by the daemon on a timer" }`, and `module: "./commands/usage.ts"`. Its `usageSweepCommand` builds `SweepInput` from `runsRoot()`, `usageDbPath()`, the default Claude dir plus `cswapConfigDirs(...)`, `listAgents({})`, and `stableMachineId`. It prints one line in the output layer's style.

- [ ] **Step 5: Run the tests**

Run: `bun test lib/usage/__tests__/sweep.test.ts lib/__tests__/command-tree-def.test.ts lib/__tests__/command-tree-program-verbs.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/usage commands/usage.ts lib/command-tree-def.ts
git commit -m "usage: add the sweep and rt usage sweep"
```

### Task 8: Pricing

**Files:**
- Create: `lib/usage/pricing.ts`
- Test: `lib/usage/__tests__/pricing.test.ts`

**Interfaces:**
- Produces:

```ts
export interface TokenTotals { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number }
export function costOf(model: string, tokens: TokenTotals, speed: string | null): number | null;
```

- [ ] **Step 1: Confirm prices**

Fetch the Pricing row in the claude-api skill's `shared/live-sources.md`. Confirm every row and multiplier in the spec, and fill in Haiku 5.5's, Fable 5's and Sonnet 5's cache read rates. Correct the spec's table if the page differs.

- [ ] **Step 2: Write the failing tests**

`opus 5.5 prices each field`: one million of each gives `4 + 20 + 0.20 + 5 + 8`.
`fast mode doubles Opus 5.5 input and output`.
`haiku 5.5 uses the higher rate past 100K prompt tokens`, checked per message by the caller passing one message's tokens.
`an unknown model returns null`.

- [ ] **Step 3: Run it to make sure it fails**

Run: `bun test lib/usage/__tests__/pricing.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `costOf`**

One table keyed by model id. Cache writes are 1.25× input for 5-minute and 2× for 1-hour.

- [ ] **Step 5: Run the tests**

Run: `bun test lib/usage/__tests__/pricing.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/usage docs/superpowers/specs/2026-11-04-usage-store-design.md
git commit -m "usage: add estimated pricing"
```

### Task 9: Queries

**Files:**
- Create: `lib/usage/queries.ts`
- Test: `lib/usage/__tests__/queries.test.ts`

**Interfaces:**
- Consumes: `openUsageDbReadonly`, `costOf`, `kindOf`.
- Produces, with types added to `packages/rt-client/src/commands.ts` in Task 10:

```ts
export function usageMrs(dbPath: string, q: { days?: number; repo?: string; now: number }): UsageMrsData;
export function usageMr(dbPath: string, mrKey: string): UsageMrData | null;
export function usageTrends(dbPath: string, q: { days: number; repo?: string; now: number }): UsageTrendsData;
export function usageStatus(dbPath: string): UsageStatusData;
```

Field names are the builder's, covering the spec's API table. Every total carries input, output, cache read, cache write, cost and `unpricedTokens`.

- [ ] **Step 1: Write the failing tests**

Seed rows by hand.

`a missing database gives empty results`: `usageMrs` returns no MRs and zero totals, `usageMr` null, `usageTrends` no weeks, `usageStatus` a null last sweep.
`an MR total adds work, respond, review and doctor`.
`cost is split by kind`.
`rounds number respond runs by start time`.
`the range filters on last activity`.
`the summary has a median MR`: three MRs at 1, 2 and 9 give 2.
`usageMr lists runs in time order with their stages`, and a row for messages with a null stage.
`by-model and main-vs-subagent splits add up to the total`.
`an agent-only doctor session appears as a run-less entry of kind doctor`.
`weeks start on Monday local time`.
`an unknown model raises unpricedTokens and cost covers the rest`.
`kinds are derived at read time`: a stored `work_type` of `feature` reports `work`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun test lib/usage/__tests__/queries.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/usage/queries.ts`**

Group in SQL by model and speed, except Haiku 5.5, which prices per message for its 100K tier. Then price in TypeScript. Close each readonly handle in `finally`.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/usage/__tests__/queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/usage
git commit -m "usage: add MR, trend and status queries"
```

### Task 10: Daemon verbs and client

**Files:**
- Create: `lib/daemon/handlers/usage.ts`
- Modify: `packages/rt-client/src/commands.ts:862,1279`, `packages/rt-client/src/client.ts`, `packages/rt-client/src/index.ts`, `lib/daemon/command-router.ts:266`, `lib/daemon/api-server.ts:64-79`
- Test: `lib/daemon/handlers/__tests__/usage.test.ts`

**Interfaces:**
- Consumes: Task 9.
- Produces: commands `usage:mrs`, `usage:mr`, `usage:trends`, `usage:status`. REST: `/api/usage/mrs`, `/api/usage/mr`, `/api/usage/trends`, `/api/usage/status`, all GET. Client: `usageMrs`, `usageMr`, `usageTrends`, `usageStatus`, shaped like `listRuns`.

- [ ] **Step 1: Write the failing tests**

`usage:mrs returns ok with no database`.
`usage:mr with no mrKey is refused`.
`usage:mr with an unknown key returns null data`.
`days must be a positive number`.
Follow the seam style of `lib/daemon/handlers/__tests__` for runs, passing `dbPath` through `createUsageHandlers(ctx, { dbPath })`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun test lib/daemon/handlers/__tests__/usage.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement and wire**

Add the four command types and the roster rows, spread `createUsageHandlers` in the router, and add the REST rows. `dbPath` defaults to `usageDbPath()`. Handlers catch, log with `ctx.log.warn({ err }, ...)`, and return `{ ok: false, error }`, as `runs:list` does.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/daemon/handlers/__tests__/usage.test.ts lib/daemon/__tests__`
Expected: PASS. Rebuild rt-client's `dist/` if `workspace-packages.md` requires it for your consumers.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon packages/rt-client
git commit -m "usage: add daemon verbs and client calls"
```

### Task 11: Schedule the sweep

**Files:**
- Modify: `lib/daemon.ts:851` (beside `runs-prune`)
- Create: `lib/daemon/usage-sweep.ts`
- Test: `lib/daemon/__tests__/usage-sweep.test.ts`

**Interfaces:**
- Consumes: `rt usage sweep` from Task 7.
- Produces: `spawnUsageSweep(deps?: { argv?: string[]; spawn?: typeof Bun.spawn }): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`spawns rt usage sweep with childEnv`: a fake `spawn` receives `[...rtSelfArgv(), "usage", "sweep"]` and an env that came from `childEnv()`.
`a nonzero exit rejects`, so `scheduleSweep` logs it.
`a sweep still running after 30 minutes is killed`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun test lib/daemon/__tests__/usage-sweep.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement and schedule**

`scheduleSweep("usage-sweep", () => spawnUsageSweep(), { bootDelayMs: 120_000, intervalMs: 300_000 }, log)`.

Check `rtSelfArgv()` from the daemon's real entry point. `Bun.main` must resolve to something that accepts `usage sweep`, both from source and compiled. If it does not, take the entry path as a parameter and fix it at this call site.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/daemon/__tests__/usage-sweep.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon lib/daemon.ts
git commit -m "daemon: sweep token usage every 5 minutes"
```

### Task 12: Console server proxy

**Files:**
- Create: `apps/console/src/server/usage.ts`, `apps/console/src/server/usage.test.ts`
- Modify: `apps/console/src/server/routes.ts:32`, `apps/console/src/server/fixtures/design/runsFixture.ts`

**Interfaces:**
- Consumes: Task 10's client calls.
- Produces: `usageRoutes(fixture: RunsFixture | null)` serving `GET /api/usage/mrs`, `/mr`, `/trends`, `/status`. `RunsFixture` gains `usage: { mrs, mr, trends, status }`.

- [ ] **Step 1: Write the failing tests**

`passes days and repo through`.
`a daemon refusal answers 502 with its error`, matching `runs.ts`.
`the fixture answers without a daemon`.
`the outage fixture answers 502`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run console:test -- usage`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Follow `runsRoutes` for the shape. Fixture data uses neutral ids and includes an MR with a work run, 3 respond rounds and a doctor.

- [ ] **Step 4: Run the tests**

Run: `bun run console:test -- usage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/server
git commit -m "console: proxy usage reads"
```

### Task 13: Manual checks on Matt's Mac

**Files:**
- None committed.

These need the real home, so they run by hand from source after the branch's daemon is live, and after confirming with Matt.

- [ ] **Step 1: Backfill while timing the daemon**

Run `rt usage sweep` from source. During it, run `rt runs` 5 times spread through the sweep.
Expected: each returns in under 2 seconds.

- [ ] **Step 2: Recount 3 finished runs**

A throwaway script in the session scratchpad recounts output tokens for each run's session and subagent files inside the run's window, deduped by message id.
Expected: equal to the store's total for that run where `attribution` is `stage` or `run`.

- [ ] **Step 3: Read the status**

Run the `usage:status` verb.
Expected: last sweep set, no unpriced models, skipped lines under 1%.

- [ ] **Step 4: Report the results to Matt**

Include any mismatch in full.
