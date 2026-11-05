# Usage store

Backend for the Console Usage section. The screens are built directly and
iterated live, so this document covers everything underneath them and says
nothing about layout.

## Why

Matt wants the token cost of a piece of work end to end. A work run for an MR,
then several rounds of review and response, are one thing and should read as
one total. He also wants to rank MRs, drill into where one spent its tokens,
and watch trends over time.

Today rt records no token usage. The data exists in two places, and both
expire: run DBs are pruned at `rt.runsPruneDays` (30 days by default), and
Claude Code transcripts appear to age out on the same schedule. Rankings and
trends need history that outlives both.

A read-only prototype confirmed the join works: 195 of 195 run DBs had a
session with a transcript on disk, and 143 board-launched runs across 78 MRs
produced sensible totals.

## Goals

- Keep per-message token usage in a store that outlives run pruning and
  transcript cleanup.
- Attribute each message to a run, stage and MR, including messages outside
  any run's time window.
- Bundle work, review, respond and doctor usage under one MR key.
- Serve MR list, MR detail and trend queries to Console.
- Report an estimated cost alongside tokens.
- Leave room for teammates' usage later, with no schema rewrite.

## Non-goals

- Any UI. Console screens are built directly against the API here.
- Sharing usage between machines. Rows carry a machine id, nothing publishes.
- Sessions with no link to a run or an MR, such as ad-hoc terminal sessions.
- Codex agents. They have no Claude transcript, so they report no usage.
- Budgets, alerts or limits.
- Real billing. Subscription use is not billed per token, so dollars are what
  the usage would cost at API prices.

## Anti-goals

- A sweep that slows the daemon's event loop.
- Double counting. Sessions can host several runs, and a first prototype that
  summed whole sessions overstated the median review 2.6 times.
- Storing prompt or response text. The store holds counts and identifiers only.

## Approaches

The decision was where usage is captured and kept.

| Approach | Trade-off |
|---|---|
| **A. Daemon sweep into a store (picked)** | Totals lag live runs slightly and it adds a periodic job. It catches runs that crash, reruns safely, backfills what is on disk, and survives pruning. |
| B. Each run saves usage at close | Fewer moving parts, but runs that die or never close record nothing, and follow-up work after close is missed. |
| C. Read transcripts on page load and raise retention | No store, but pages parse hundreds of files per load, retention changes globally, and history is lost if a transcript is ever cleaned up. |

Matt picked A because rankings and trends need durable history. He scoped the
first version to this Mac, shaped so team sharing can be added later, and put
the view in Console only with no board changes.

## How it works

```
run DBs ─────────┐
agents table ────┼─► rt usage sweep ─► usage.db ─► usage:* daemon verbs ─► Console
transcripts ─────┘    (child process)
```

### Where it lives

- `lib/usage/`: store, sweep, transcript reader, attribution, pricing.
- `~/.mattstack/rt/usage.db`, a separate SQLite file. It stays out of
  `state.db` so it avoids the cross-session `SCHEMA_VERSION` race, keeps sweep
  write bursts away from the daemon's 250ms busy timeout on `state.db`, and
  can be rebuilt or dropped alone. It has its own `user_version`.
- Add `rt/usage.db` to `BACKUP_SOURCES`. Once transcripts expire it is the only
  copy of its history. `snapshotSource` opens the file unconditionally, so a
  Mac that has never swept needs a skip, not a failed backup.

### Schema

All tables carry `machine_id` from `stableMachineId()`.

**`usage_messages`**, one row per assistant message. Primary key
`(machine_id, message_id)`.

| Column | Source |
|---|---|
| `message_id` | `message.id` |
| `session_id` | Entry `sessionId` |
| `ts` | Entry `timestamp`, epoch ms |
| `model` | `message.model` |
| `subagent_id`, `subagent_type`, `subagent_model` | Subagent file name and its `.meta.json`; null on the main session |
| `input`, `output`, `cache_read` | `usage.input_tokens`, `output_tokens`, `cache_read_input_tokens` |
| `cache_write_5m`, `cache_write_1h` | `usage.cache_creation.ephemeral_*_input_tokens` |
| `thinking` | `usage.output_tokens_details.thinking_tokens` |
| `speed`, `service_tier` | Same-named `usage` fields |
| `run_id`, `stage`, `attempt` | Attribution; null when unattributed |
| `mr_key` | Attribution, set on the message so an MR total never joins through a table with several rows per session |
| `attribution` | `stage`, `run`, `session` or `none`, see Attribution |

Index on `(run_id)`, `(mr_key)`, `(ts)` and `(session_id)`.

**`usage_runs`**, a snapshot refreshed each sweep and never deleted when the
run DB is pruned. `run_id`, `repo` (the run directory's key, verbatim),
`pipeline`, `work_type`, `spawned_by`, `status`, `started_at`, `ended_at`,
`mr_key`, `mr_url`, `ticket`, `branch`. `kind` is not stored: it is derived from
`work_type` at read time, so a changed mapping reaches pruned runs too.

Runs written with `RT_RUN_TEST` (the `test` field) are skipped.

**`usage_stages`**, also a snapshot. `run_id`, `name`, `attempt`, `status`,
`started_at`, `ended_at`.

**`usage_sessions`**, the link table, one row per link. Primary key
`(session_id, source, ref)`, where `source` is `run` or `agent`, and `ref` is the
run id or agent id. `agent_mr_key` holds the MR from an agent's subject and
`agent_kind` its `doctor` or `other`; both are null on `run` rows.

**`usage_files`**, reader progress. `path`, `session_id`, `size`, `mtime_ms`,
`offset`, `scanned_at`.

### Finding sessions

1. **Run DBs.** Each run's `claude-session` field. Today
   `recordIdentity` overwrites that field, so a run that moves to a new session
   loses the earlier one. Add a `claude-sessions` field: a JSON array appended
   only when a new session appears. The existing change guard applies, because
   `fields.at` feeds the liveness ladder. Runs already on disk fall back to
   `claude-session`.
2. **The `agents` table.** Board launches set `subject: mr:<url>` and the row
   holds `session_id`. Every such row links its session to that MR. This is
   how doctor gets in: doctors have no run DB, and the board state only keeps
   an agent id. A linked session with no run is `kind: doctor` when its agent
   label or launch shows it was a doctor, otherwise `other`.

Also read `agents` rows with `subject: run:<id>`, written by run adoption, as
extra sessions for that run.

### Reading transcripts

- **Locations:** `<config>/projects/*/<session>.jsonl` and
  `<config>/projects/*/<session>/subagents/agent-*.jsonl` with its
  `.meta.json`. `<config>` covers the default Claude dir and every cswap
  account dir (`lib/cswap.ts`), so an account with its own folder is not
  missed. List directories once per sweep and match by session id, rather than
  globbing per session: the tree is 17GB across about 1,700 files.
- **Only linked sessions are read.** A session linked later is read from byte 0
  when it first appears.
- **Incremental:** transcripts are append-only, so resume from `offset` and
  consume only through the last newline. If a file shrinks or its mtime goes
  backward, reread it from 0. Upserts make that safe.
- **Dedup:** a message can span several transcript entries sharing
  `message.id`. Keep one row per id. In a 40,481-entry sample every repeat
  carried identical usage, so last-write-wins is enough.
- **S is the transcript file's session.** Across the 140 main transcripts linked
  to runs on this Mac, all 31,963 usage entries had a `sessionId` matching their
  file, and no message id appeared in two files. Resumed sessions do not replay
  usage today. If an id ever does appear in two files, the copy with the
  earliest `ts` wins, whatever order the files were read in, and a sweep counts
  the conflict in `usage:status`.
- **Skip** entries with no `usage`, and the `<synthetic>` model.
- **Format risk:** transcripts are Claude Code's private format. Malformed or
  unfamiliar lines are skipped and counted, never thrown. A sweep with a high
  skip rate logs a warning, and `usage:status` reports it, so a format change
  reads as a visible problem rather than silently low numbers.

### Attribution

Run for each message after its session's run and stage snapshots are current.
For a message in session S at time T:

1. Among runs linked to S whose window holds T, take the latest started. A run
   still going has an open-ended window.
2. In that run, take the latest-started stage attempt whose window holds T:
   `attribution = stage`. If none holds it, keep the run with `stage` null:
   `attribution = run`.
3. If no run window holds T but S has runs, use the nearest run before T, else
   the nearest after it: `attribution = session`, `stage` null. This is setup
   before a run starts and follow-up after it ends. The prototype found 12% of
   messages here, so leaving them out would undercount every MR.
4. If S has only an agent link with an MR, keep `run_id` null:
   `attribution = session`.
5. Otherwise `attribution = none`.

Then set the message's `mr_key` from the first of these that gives one:

1. Its run's MR, see MR key and bundling.
2. An agent link on session S.

The first source wins when they disagree, because the run's field is what the
pipeline recorded about its own work. So a respond run that died before writing
`mr` still counts toward the MR the board launched it for.

Re-attribute any message whose attribution is not final while its run is live,
because a stage can end after the message was read. Once a run is terminal and
one further sweep has passed, its messages stop changing, so a pruned run keeps
its numbers.

Subagent messages use the same rule, so a subagent counts toward the stage it
ran in.

### MR key and bundling

`mr_key` is the serialized repo identity from rt-client plus the MR number. A
run's MR comes from its latest `mr` field, read directly from the run DB, because
`sessionAndMr` deliberately hides the MRs a run reviewed and those count here.
The value can take three forms:

- A URL. Parse it with a new helper in `lib/usage/` that accepts GitLab
  `/-/merge_requests/` and GitHub `/pull/` URLs. Do not widen `parseMrUrl`: its
  callers read `null` as meaning GitHub.
- A bare `!405`. Combine the number with the run's repo when that key parses as
  an identity. Otherwise treat the run as having no MR.
- The cleared marker `-`, which means no MR.

`mr_key` is never built from a URL-less `repo` that is a pre-cutover directory
name. A value that resolves to nothing leaves the run without an MR, and the
sweep logs it at debug level. Because `mr` is written late, a run's messages pick
up `mr_key` on the sweep after it appears.

`kind` comes from `work_type`, because pipeline names vary by pack. It matches
Console's `runKind`, moved somewhere both can import or mirrored with a test that
pins the two together:

| `work_type` | `kind` |
|---|---|
| `feature`, `work` | `work` |
| `review` | `review` |
| `receive-review` | `respond` |
| anything else | `other` |

Standalone `ship` and `watch-ci` runs are `other`. An agent-only session takes
`doctor` or `other` from `usage_sessions`.

A **round** is one `respond` run. Its number is that run's position among the
MR's respond runs by `started_at`. The board's `respond_rounds` table counts
per person, so it is not the source here.

A teammate's review has no run on this Mac, so the API reports nothing for it.
The UI decides how to show the gap.

### Pricing

`lib/usage/pricing.ts` holds one table keyed by model id. Cost is computed at
read time, never stored, so a corrected price applies to all history.

Per million tokens, from the claude-api skill's table cached 2026-10-06:

| Model | Input | Output | Cache read |
|---|---:|---:|---:|
| `claude-fable-5-1`, `claude-fable-5` | $10 | $50 | $0.25 for 5.1 |
| `claude-opus-5-5` | $4 | $20 | $0.20 |
| `claude-opus-5`, `-4-8`, `-4-7`, `-4-6` | $5 | $25 | 0.1× input |
| `claude-sonnet-5-5`, `claude-sonnet-5` | $2 | $10 | $0.20 for 5.5 |
| `claude-sonnet-4-6` | $3 | $15 | 0.1× input |
| `claude-haiku-5-5` | $0.10 | $0.50 | Confirm |
| `claude-haiku-4-5` | $1 | $5 | 0.1× input |

Cache writes are 1.25× input for 5-minute and 2× for 1-hour. Fast mode
(`speed: "fast"`) is 2× on Opus 5.5 and Opus 5. Haiku 5.5 charges $0.50 / $2.50
past 100K prompt tokens.

Before shipping, confirm every row and multiplier against the live pricing page
in the skill's `shared/live-sources.md`, including the gaps marked above.

A model missing from the table contributes tokens but no cost, and the
response says so through `unpricedTokens`, so a new model reads as incomplete
rather than cheap.

### Sweep

- `rt usage sweep`, a hidden verb, does one pass. The verb gives a manual
  backfill and keeps file parsing out of the daemon.
- The daemon runs it through `scheduleSweep` as a child process, every 5
  minutes with a 2-minute boot delay. It passes `childEnv()`. A lock in
  `usage.db` makes a second concurrent sweep exit at once.
- Each pass: refresh snapshots, refresh `usage_sessions`, read new bytes,
  attribute, record status.
- Sweeps must complete without a daemon. The first pass backfills whatever is
  on disk and may take minutes, so it runs the same way and commits in batches.
- If nothing sweeps for 30 days, what aged out is gone. That is accepted.

### API

Daemon verbs read `usage.db` readonly per request, like `runs:*`, and hold
nothing. Each is typed in `packages/rt-client/src/commands.ts`, listed in the
command roster, and mapped to REST in `lib/daemon/api-server.ts`. Console's
server proxies them, and adds a fixture for design mode.

| Verb | Payload | Returns |
|---|---|---|
| `usage:mrs` | `days?`, `repo?` | Per MR: key, url, ticket, branch, first and last activity, token totals, cost, cost by `kind`, run and round counts. Summary totals with a median MR. Range filters on last activity. |
| `usage:mr` | `mrKey` | Totals, then runs in time order: `kind`, round, stages with totals, plus by-model and main-vs-subagent splits. Includes a row for `attribution = run` and `session` messages inside each run. |
| `usage:trends` | `days`, `repo?` | Per week (Monday start, local time): cost and tokens by `kind`. Totals by pipeline and model. |
| `usage:status` | none | Last sweep time and duration, rows, skipped lines, unpriced models, sessions whose transcript is gone. |

Every token total carries input, output, cache read, cache write and
`unpricedTokens`. Ticket and branch come from the latest run for the MR. Titles
are not stored; Console resolves them the way it does for the Runs page.

## Constraints

- Tests must never read the real `~/.claude` or `~/.mattstack`. The sweep takes
  its roots as parameters, and fixtures use neutral ids per the repo's purity
  gate.
- A built binary only ever runs under an isolated HOME.
- Rules that apply when coding: `.claude/rules/daemon.md` for logging,
  `output-layer.md` and `command-tree.md` for the verb,
  `settings.md` if a setting is added, and the `rt-repo-identity` skill for keys.
- A merged daemon change is not live until the shared checkout syncs and the
  daemon restarts.

## Acceptance

- A fixture with a work run, two respond runs, a doctor session and a resumed
  session returns one MR total with no message counted twice.
- A message outside any run window lands on the nearest run with
  `attribution = session`.
- Deleting a run DB and its transcript after a sweep leaves `usage:mr` unchanged.
- Rerunning a sweep with no new bytes changes nothing and reads no file past its
  offset.
- A file ending in a partial line is finished correctly on the next sweep.
- A model missing from the price table raises `unpricedTokens`, with cost
  covering the rest.
- A respond run with no `mr` field, launched with an `mr:` subject, counts toward
  that MR. When the two disagree, the run's field wins.
- A message id in two transcripts is stored once, on the earlier copy, whichever
  file is read first.

Two checks run by hand on Matt's Mac, from source, after the unit tests. Tests
cannot do this because they never read the real home.

- **Totals:** pick 3 finished runs. A throwaway script recounts output tokens for
  each run's session and subagent files inside the run's window, deduped by
  message id. That count must equal the store's total for the same run where
  `attribution` is `stage` or `run`, exactly.
- **Daemon load:** during the first full backfill, `rt runs` must return in under
  2 seconds on 5 tries spread through the sweep.

## My calls, for Matt to check

- **Separate `usage.db`** rather than `state.db` tables.
- **Only sessions linked to a run or MR are ingested.** Trends therefore show
  pipeline usage, not all Claude use on this Mac.
- **Messages outside run windows count** toward the nearest run.
- **A round is one respond run**, numbered by start time.
- **The run's `mr` field beats the agent subject** when they disagree.
- **A run's review target counts as its MR**, so reviews of teammates' MRs appear
  in the MR list with only your review cost.
- **Sweep every 5 minutes**, as a child process.
- **Estimated cost uses one current price table** for all history.
- **No retention limit** on `usage.db`. Usage so far suggests low tens of MB a
  year. A limit can come later if it grows.

## Left to the builder

- How `rt usage sweep` is hidden in the command tree.
- The lock mechanism and batch sizes.
- How a doctor agent is told apart from other MR-subject agents.
- Exact response field names.
