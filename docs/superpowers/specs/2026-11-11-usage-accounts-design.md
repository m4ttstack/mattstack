# Usage by account: metered vs plan

## Why

The console's usage pages price every message at API rates. A run on a
Max subscription costs nothing extra, but it reads the same as a run on a
metered account, so a heavy run on a personal Max plan looked like
$1,500 of spend. Matt wants each run to show which Claude Code account ran
it, and the headline to separate real money from plan usage.

## Goals

- Record which Claude Code account each session used, from what Claude
  Code itself stores, with or without cswap.
- Show the account on each run, and split an MR's cost into metered dollars
  and plan usage.
- Work for teammates: anyone with the mattstack plugin and rt.

## Non-goals

- Backfilling past sessions. Nothing on disk records them; they read
  "account unknown".
- Splitting a Max plan's extra usage from its included usage. Claude Code
  does not record per message when a plan spills into extra usage.
- Any dependence on cswap, its files or its log.

## Anti-goals

- Sending the account anywhere off the Mac.
- A recorder that silently stops when the rt daemon is down.

## Where the account comes from

Claude Code keeps the signed-in account in the session's config:
`$CLAUDE_CONFIG_DIR/.claude.json` when that is set, otherwise
`~/.claude.json`, under `oauthAccount`. The fields used:

| Field | Use |
|---|---|
| `accountUuid` | the account's identity |
| `emailAddress`, `organizationName` | the label on the page |
| `organizationType` | `claude_max`, `claude_pro`, `claude_enterprise`, ... |
| `seatTier` | `enterprise_usage_based` marks a metered enterprise seat |
| `billingType` | kept for the record |

A session on an API key (`ANTHROPIC_API_KEY` set, or no `oauthAccount`)
records as account `api-key`.

Checked on Matt's Mac (2026-11-11): every cswap session dir
(`~/.claude-swap-backup/sessions/<n>-<email>/`) carries its own
`.claude.json` naming that session's account, and an unpinned session reads
`~/.claude.json`, which cswap rewrites on a global switch. So the session's
own config names the session's account. The one lag: an unpinned session
running through a global switch shows the new account from the next hook
that fires after it.

Real values seen: the metered work account is `claude_enterprise` with
`seatTier = enterprise_usage_based`; the personal accounts are `claude_max`
with no seat tier.

Billing class (Claude's call, Matt can correct):

- **metered**: `seatTier = enterprise_usage_based`, or `api-key`
- **plan**: `organizationType` is `claude_max` or `claude_pro`
- **unknown**: anything else, and every session with no record

## Approaches

1. **Plugin hook appends to a file (picked).** The mattstack plugin's
   `SessionStart` and `UserPromptSubmit` hooks read the account and append
   a line when it differs from the session's last line. The sweep ingests
   the file. Survives the daemon being down; nearly free per prompt.
2. **Hook calls the daemon** with a new `usage:account` verb. One writer,
   no file format, but a session started while the daemon is down gets no
   account, invisibly.
3. **A plugin mod** (`plugins/mattstack/hooks/register.ts`). Typed, but it
   breaks where mods are blocked (the enterprise guard), which is where
   metered spend happens.

Matt picked 1.

## Design

**Capture.** A hook script in `plugins/mattstack/hooks/` runs on
`SessionStart` (startup, resume, clear, compact), `UserPromptSubmit`,
`PostToolUse` and `Stop` (Claude's call: a switch mid-turn, the likely case
for a rate-limit switch, would otherwise go unseen until the next prompt).
To stay cheap per tool call it compares the config file's mtime with the
last one it saw for the session and does nothing when unchanged.
It reads the session id from the hook input, resolves the account as
above, and appends one JSON line to `~/.mattstack/rt/usage/accounts.jsonl`:
`{ session, ts, account, label, org_type, seat_tier, billing_type }`.
The billing class is not stored: queries derive it from the raw fields
(Claude's call), so a corrected rule applies to every past row.
It keeps the session's last account in a small state file so an unchanged
prompt writes nothing. It never fails the hook: any error exits 0 silently.

Recording on each prompt, not only at start, covers an account that
changes mid-session (cswap's auto-switch swaps credentials under a running
session; other tools may too).

**Store.** A new `usage_accounts` table: `(machine_id, session_id, ts,
account, label, org_type, seat_tier, billing_type)`, primary key
`(machine_id, session_id, ts)`. The sweep reads the file from its last
offset, like transcripts. `SCHEMA_VERSION` bump per `.claude/rules/state.md`
if the usage db follows it.

**Matching.** A message takes the account of the latest
`usage_accounts` row for its session with `ts <= message.ts`. A message
before the session's first row stays unknown (Claude's call, matching the
no-backfill non-goal: a session resumed after the hook shipped may have
run its older messages on another account).
Matching happens at read time in the queries, so a late-arriving account
line fixes past reads without re-attribution.

**Queries.** `UsageTotals` gains nothing; instead `UsageMrData`,
`UsageMrRow`, `UsageMrEntry` and the trends rows gain
`byBilling: Record<"metered" | "plan" | "unknown", UsageTotals>`, and each
entry gains `accounts: Array<{ account, label, class }>` (usually one).

**Console.**
- MR page header: the cost stat becomes "metered $X" with "on plan $Y"
  (and "unknown $Z" while history has no record) beside it.
- Each run's group row names its account; a run that changed account
  names both.
- MR list: the cost column shows metered dollars with the plan estimate
  as a second line; sort stays on the total for now.
- Trends: the weekly bars keep stacking by kind; the summary above them
  shows metered, on plan and unknown totals for the range (Claude's call:
  crossing kind with billing in one bar would be hard to read).

## Left to the builder

- The exact hook input fields for the session id and how the hook finds
  `CLAUDE_CONFIG_DIR` (from its environment).
- Copy for the labels (use `rt:ui-copy`).
- Whether `byBilling` replaces `costByKind` anywhere or sits beside it.
- File rotation for `accounts.jsonl` (lines are tiny; a year is small).
