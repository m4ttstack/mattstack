# Usage by Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record which Claude Code account ran each session and split usage cost into metered, on plan and unknown.

**Architecture:** A mattstack plugin hook notices when the session's `.claude.json` changes and calls `rt usage record-account`, which appends the account to `~/.mattstack/rt/usage/accounts.jsonl`. The usage sweep ingests that file into a `usage_accounts` table; queries match each message to its session's latest account row at or before it and derive the billing class when read. Console shows the split.

**Tech Stack:** Bun + TypeScript (rt), POSIX sh (plugin hook), bun:sqlite, React + Mantine via `@mattstack/app-kit` (console), vitest.

**Spec:** `docs/superpowers/specs/2026-11-11-usage-accounts-design.md`

## Global Constraints

- The account comes only from the session's own config: `$CLAUDE_CONFIG_DIR/.claude.json` when set, else `~/.claude.json`, field `oauthAccount`. Nothing reads cswap files.
- `ANTHROPIC_API_KEY` set, or no `oauthAccount`: account `api-key`.
- Billing class, derived at read time, never stored: **metered** when `seat_tier = 'enterprise_usage_based'` or account is `api-key`; **plan** when `org_type` is `claude_max` or `claude_pro`; **unknown** otherwise and for messages with no account row.
- Messages before a session's first account row stay unknown. No backfill.
- Nothing leaves the Mac. The hook never fails a turn: every path exits 0 and prints nothing.
- Any rt output goes through `lib/ui/out.ts` (`.claude/rules/output-layer.md`); UI copy via `rt:ui-copy`; no `·` separators in UI.
- Bump `plugins/mattstack/.claude-plugin/plugin.json` version one past main's right before merge.
- Rebuild `packages/rt-client` (`bun run build`) after touching its source.

## Review Focus

1. A malformed, missing or half-written `.claude.json` (Claude Code mid-write): no line is appended, the hook exits 0, and the next change records it.
2. A half-written last line in `accounts.jsonl`: the sweep ingests only complete lines and picks the rest up next sweep.
3. `ANTHROPIC_API_KEY` set while `oauthAccount` is also present: records `api-key` (the env key is what bills).
4. A session whose account changes mid-session: messages before the change keep the old account, after it the new one.
5. The hook on a Mac with no `rt` on PATH or at `~/.local/bin/rt`: exits 0 silently.

---

### Task 1: Read and record the account

**Files:**
- Create: `lib/usage/accounts.ts`
- Test: `lib/usage/__tests__/accounts.test.ts`

**Interfaces:**
- Produces:
  - `interface AccountRecord { account: string; label: string | null; orgType: string | null; seatTier: string | null; billingType: string | null }`
  - `readAccount(opts: { configDir: string | null; home: string; env: Record<string, string | undefined> }): AccountRecord | null`; `null` when the config is missing or unparseable (and no API key).
  - `accountsPath(): string` → `join(rtDir(), "usage", "accounts.jsonl")`
  - `recordAccount(opts: { path: string; session: string; ts: number; record: AccountRecord }): boolean`; appends `{"session","ts","account","label","org_type","seat_tier","billing_type"}` as one line and returns true, unless the session's last recorded account (kept in `<dirname(path)>/account-state/<session>`) is the same account, then returns false.
  - `BILLING_CLASS_SQL: string`, a SQL `CASE` over `a.account, a.seat_tier, a.org_type` yielding `'metered' | 'plan' | 'unknown'`, per Global Constraints.

- [ ] **Step 1: Write failing tests** in `accounts.test.ts`, each in a temp dir:
  - `reads oauthAccount from CLAUDE_CONFIG_DIR's .claude.json`: `readAccount({configDir: d, ...})` on `{oauthAccount:{accountUuid:"u1",emailAddress:"a@x",organizationType:"claude_max",billingType:"stripe_subscription"}}` → `{account:"u1",label:"a@x",orgType:"claude_max",seatTier:null,billingType:"stripe_subscription"}`.
  - `falls back to ~/.claude.json with no config dir`.
  - `an API key wins over an oauth account` → `account: "api-key"`, `label: "API key"`.
  - `a missing or broken config reads null` (missing file; `"{not json"`).
  - `records once per account change`: three `recordAccount` calls u1, u1, u2 → returns true, false, true; file has 2 lines.
  - `BILLING_CLASS_SQL classifies`: in-memory sqlite table `a` with rows (enterprise_usage_based → metered), (api-key → metered), (claude_max → plan), (claude_pro → plan), (claude_team, null tier → unknown).
- [ ] **Step 2:** `bun test lib/usage/__tests__/accounts.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement `lib/usage/accounts.ts` to the interfaces. Append with `appendFileSync` of one `JSON.stringify(...) + "\n"` write; the state file holds only the last account id.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `usage: read and record the Claude Code account`.

### Task 2: `rt usage record-account`

**Files:**
- Modify: `commands/usage.ts`, `lib/command-tree-def.ts` (beside the `usageSweepCommand` node, ~line 1912)
- Test: `commands/__tests__/usage-record-account.test.ts`

**Interfaces:**
- Consumes: Task 1's `readAccount`, `recordAccount`, `accountsPath`.
- Produces: `usageRecordAccountCommand(args: { session: string }, deps?: { env, home, now, path }): Promise<void>`; CLI `rt usage record-account --session <id>`. Prints nothing on success or when there's nothing to record; a missing `--session` is a usage failure (`lib/ui/usage.ts`).

- [ ] **Step 1: Failing tests:** with deps pointing at a temp dir: writes one line for a valid config; writes nothing and exits cleanly for a missing config; stdout and stderr empty in both (`captureOut()`).
- [ ] **Step 2:** Run the test → FAIL.
- [ ] **Step 3:** Implement; register a hidden node (`.claude.json` hook verb, follow `.claude/rules/command-tree.md` for hidden nodes and plain-language description).
- [ ] **Step 4:** Run the test plus `bun test lib/__tests__/no-raw-output.test.ts` → PASS.
- [ ] **Step 5:** Commit `usage: add rt usage record-account for the account hook`.

### Task 3: The account hook

**Files:**
- Create: `plugins/mattstack/hooks/account-record.sh`, `plugins/mattstack/hooks/tests/test-account-record.sh`
- Modify: `plugins/mattstack/hooks/hooks.json` (add to `SessionStart` startup|resume|clear|compact, `UserPromptSubmit`, `PostToolUse`, `Stop`, each `timeout: 5`), `plugins/mattstack/hooks/README.md`

**Interfaces:**
- Consumes: Task 2's CLI.
- Produces: the hook. Reads `session_id` from stdin JSON the way `progress-record.sh` does; config file is `${CLAUDE_CONFIG_DIR:+$CLAUDE_CONFIG_DIR/.claude.json}` else `$HOME/.claude.json`; key is the file's mtime plus whether `ANTHROPIC_API_KEY` is set; stamp at `${TMPDIR:-/tmp}/mattstack-account-record-<session>`. Same key as the stamp: exit 0 without calling rt. Otherwise call `rt usage record-account --session <id>` (rt lookup as in `progress-record.sh`), then write the stamp.

- [ ] **Step 1: Failing test script** in the style of `test-progress-record.sh` (stub `rt` appending argv to a calls file, sandboxed HOME/TMPDIR): first call → one rt call; second call with unchanged mtime → no new call; `touch` the config → a call; `CLAUDE_CONFIG_DIR` set → watches that dir's file; no rt anywhere → exit 0, no output; stdout always empty.
- [ ] **Step 2:** `bash plugins/mattstack/hooks/tests/test-account-record.sh` → FAIL.
- [ ] **Step 3:** Write the hook and wire `hooks.json`.
- [ ] **Step 4:** Test script → all `ok`; run the plugin's own checks per `.claude/rules/build-and-plugin.md`.
- [ ] **Step 5:** Commit `mattstack plugin: record the session's account on change`.

### Task 4: Ingest accounts in the sweep

**Files:**
- Modify: `lib/usage/store.ts` (`USAGE_SCHEMA_VERSION = 2`; `usage_accounts (machine_id, session_id, ts, account, label, org_type, seat_tier, billing_type, PRIMARY KEY (machine_id, session_id, ts))`), `lib/usage/sweep.ts`, `commands/usage.ts`, the daemon's sweep caller (find with `rg "runSweep\(" lib commands`)
- Test: `lib/usage/__tests__/sweep.test.ts`, `lib/usage/__tests__/store.test.ts`

**Interfaces:**
- Consumes: Task 1's line format and `accountsPath()`.
- Produces: `SweepInput.accountsPath: string`; `ingestAccounts(db: Database, path: string, machineId: string): number` (rows added), offset kept in `usage_meta` key `accounts_offset`; only complete lines are consumed; a shrunk file (smaller than the offset) restarts from 0; duplicate rows are ignored.

- [ ] **Step 1: Failing tests:** a v1 db opens and gains `usage_accounts`; a sweep ingests two lines; a trailing partial line is left for the next sweep and ingested once completed; a re-sweep adds nothing.
- [ ] **Step 2:** `bun test lib/usage/__tests__/` → new tests FAIL.
- [ ] **Step 3:** Implement; pass `accountsPath()` from both sweep callers.
- [ ] **Step 4:** `bun test lib/usage/__tests__/` → PASS.
- [ ] **Step 5:** Commit `usage: ingest recorded accounts in the sweep`.

### Task 5: Split totals by billing class

**Files:**
- Modify: `lib/usage/queries.ts`, `packages/rt-client/src/commands.ts`
- Test: `lib/usage/__tests__/queries.test.ts`

**Interfaces:**
- Consumes: Task 1's `BILLING_CLASS_SQL`; Task 4's table.
- Produces (wire types):
  - `type UsageBilling = "metered" | "plan" | "unknown"`
  - `byBilling: Record<UsageBilling, UsageTotals>` on `UsageMrRow`, `UsageMrData`, `UsageMrEntry`, and on `UsageTrendsData` (range totals only; weeks keep `byKind`).
  - `accounts: Array<{ account: string; label: string | null; billing: UsageBilling }>` on `UsageMrEntry`, in first-seen order, empty when unknown.
- Matching: a dimension in `selectMessages` that joins the session's latest `usage_accounts` row with `ts <= m.ts` (correlated subquery, `ORDER BY ts DESC LIMIT 1`) and yields its account, label and billing class. `byBilling` sums only counted rows (the same rows as `totals`), so the three add up to `totals`.

- [ ] **Step 1: Failing tests:**
  - `splits an MR by billing class`: one session with a `claude_max` row then an `enterprise_usage_based` row mid-run; messages before and after → `byBilling.plan` and `.metered` hold each side; `plan + metered + unknown = totals`.
  - `messages before a session's first account row are unknown`.
  - `an entry lists the accounts it ran on`: the above entry's `accounts` → two items in order.
  - `the MR list and trends carry byBilling`.
- [ ] **Step 2:** `bun test lib/usage/__tests__/queries.test.ts` → FAIL.
- [ ] **Step 3:** Implement; `bun run build` in `packages/rt-client`.
- [ ] **Step 4:** `bun test lib/usage/__tests__/` and `bunx tsc --noEmit` → PASS.
- [ ] **Step 5:** Commit `usage: split totals into metered, on plan and unknown`.

### Task 6: Show the split in console

**Files:**
- Modify: `apps/console/src/app/usage/UsageMrPage.tsx`, `UsageStats.tsx`, `UsageMrList.tsx`, `steps.ts`, `UsagePage.tsx` (trends summary), `apps/console/src/server/fixtures/design/usageFixture.ts`
- Test: `apps/console/src/app/usage/steps.test.ts`, the existing tests beside each touched component

**Interfaces:**
- Consumes: Task 5's wire types.
- Produces:
  - MR header cost stat: "metered $X" as the figure, "on plan $Y" beside it, "unknown $Z" only when non-zero.
  - Each run's group row: its account label(s) as a second line (`StepRow.note`).
  - MR list cost cell: metered as the figure, plan as a dimmed second line.
  - Trends summary: metered, on plan, unknown for the range.
  - Fixture: give the design fixture's runs accounts across all three classes.

- [ ] **Step 1: Failing tests:** `steps.test.ts`: a group row's note names its account; two accounts → both labels. Component tests for the header split and the list cell.
- [ ] **Step 2:** `bun run console:test` → FAIL.
- [ ] **Step 3:** Implement; copy through `rt:ui-copy`.
- [ ] **Step 4:** `bun run console:test`, `console:typecheck`, `console:lint` → PASS.
- [ ] **Step 5:** Render the design fixture (`CONSOLE_FIXTURE=design CONSOLE_FIXTURE_SCENARIO=runs`) in Fast Browser at the MR page, the list and Trends, in light and dark; say what looks wrong.
- [ ] **Step 6:** Commit `console: show usage by account, metered vs on plan`.
