# shepherdr on the rt event bus + herd DB

**Tickets:** RT-44 (consumer-side adoption; the bus itself shipped in repo-tools)
**Date:** 2026-08-19
**Status:** Implemented + live-validated 2026-08-19 (evidence:
`.local-dev/rt-events-validation.md`; amendments below marked
LIVE-VALIDATED reflect observed behavior where it differed from design)
**Skill under change:** `skills/orchestration/shepherdr/` (SKILL.md, references/, scripts/)

## Problem

The shepherd watches workers with N per-agent `herdr agent wait --until done
--until idle --until blocked` calls. herdr's detection is screen-scraping (the
manifest engine behind its status dots), and a pane that settles for ten
seconds while a worker's subagents run is pixel-identical to a pane that
settled for good — so "idle" fires on every transient settle, the shepherd
wakes, reads nothing new, and re-arms. N workers = N flappy waits, and the
shepherd's context is the most expensive in the system. Separately, workers
have no push channel: a finished worker sits unnoticed until a wait happens to
fire, and a herd run records no history — `question.md` is deleted after each
answer, so what was asked and decided is lost.

## Decisions and rationale

1. **The rt event bus is the shepherd's single wake channel (when available).**
   The missing bit — "I published something for you" — cannot come from screen
   detection; it can only come from the worker saying so. One
   `rt events wait 'shepherdr/<run>/**' --after <cursor>` replaces N flappy
   waits. Caller-held cursors make delivery race-free and replayable: a
   shepherd relaunched mid-herd resumes from its persisted cursor and misses
   nothing.
2. **A per-run SQLite DB replaces the question/report contract files.** The DB
   is the payload store and the run log: questions get ids, answers are
   recorded (files structurally lost them — the worker deleted `question.md`
   after each answer), reports and spawn records land in one queryable place,
   and degraded-mode polling is one SELECT instead of scanning N job dirs.
   Events carry `{"qid": N}` pointers, never content — the RT-44 "files stay
   the payload store" constraint holds with the DB file as the store.
3. **Scripts are the whole API.** Workers run `herd-ask.py` / `herd-report.py`;
   the insert and the best-effort emit (`|| true`) live inside the script, so
   briefs never teach SQL or emit syntax, and a dead daemon is invisible to
   workers. No worker composes a topic, a query, or an event.
4. **Lifecycle stays on the pane channel, bridged onto the bus.** A blocked
   worker (permission dialog) cannot emit; a crashed one obviously cannot; a
   confused worker that settles without asking or reporting didn't emit
   either. herdr's own detection remains the source of truth for pane state —
   `herd-bridge.py` (evolved from herd-monitor.py) polls `pane list` and emits
   `blocked`/`gone` transitions, so lifecycle events become journaled and
   replayable like everything else, and the shepherd keeps exactly one wake
   channel. herdr offers no herd-wide subscription (verified: `agent wait` is
   single-target), so the bridge polls at the monitor's existing 30s cadence;
   blocked response gains ≤30s latency, immaterial since a blocked worker
   needs a human anyway.
5. **Optional backend, both directions (RT-44 constraint, unrelitigated).**
   The shepherd detects bus availability at herd start and degrades to
   today's behavior when the bus dies mid-herd. LIVE-VALIDATED 2026-08-19:
   the rt transport design's restart-mid-wait self-heal did NOT hold on the
   current build (SMAppService-managed daemon; neither the CLI poll loop
   nor launchd restarted it) — a killed daemon surfaces as `rt events wait`
   exit 1, and exit 1 is the degrade signal. If a future rt build restores
   the self-heal, the shepherd simply never sees the exit; the journal
   survives restarts either way, so a healed bus resumes from the cursor
   with no missed events. Exit 124 is a normal timeout. Worker emits are
   best-effort inside the scripts, so workers never fail on a missing
   daemon either way (live-validated: herd-ask exit 0, row published, with
   the daemon down).
6. **The manifesto is unchanged.** Herd agents never ask questions in their
   own session; they publish a question and stop. Only the medium moves
   (file → DB row + doorbell event). The shepherd still surfaces every
   question to the user, who watches only the shepherd's pane.

## Architecture

### Run identity and layout

- A herd run gets a run id at herd start: `<repo>-<yyyymmdd-HHMMSS>`. The
  date component makes ids unique across the bus's 7-day retention window,
  so a new run can never replay a dead run's events; the run dir create
  fails loudly on the freak same-second collision.
- Run dir: `~/.mattstack/shepherdr/runs/<run-id>/` holding `herd.db`.
- Job dirs (`~/.mattstack/shepherdr/jobs/<repo>/<job>/`) survive but shrink to one
  file: `job.md`, the brief — written before the worker exists, copied in by
  spawn-agent.sh, read once. `question.md` and `report.md` cease to exist.

### Topics

```
shepherdr/<run>/<job>/question    payload {"qid": N}     emitted by herd-ask.py
shepherdr/<run>/<job>/report      payload {"rid": N}     emitted by herd-report.py
shepherdr/<run>/<job>/blocked     payload {}             emitted by herd-bridge.py
shepherdr/<run>/<job>/gone        payload {}             emitted by herd-bridge.py
```

Run-scoped so concurrent herds and replays from dead runs never cross-talk.
The shepherd's one subscription: `shepherdr/<run>/**`.

Job names must be unique within a run — the topic and the `jobs` primary
key both key on job alone. Multi-repo herds (workspace per repo) prefix
colliding job names with the repo at decomposition time; the shepherd
already owns naming (herdr agent names have the same global-uniqueness
need).

### Herd DB schema

SQLite via python3 stdlib (`sqlite3`), WAL mode — same dependency
herd-monitor.py already carries. Multiple worker processes insert
concurrently; WAL handles it.

```sql
questions(id INTEGER PRIMARY KEY, job TEXT NOT NULL,
          needs TEXT NOT NULL DEFAULT 'answer',   -- 'answer' | 'pane'
          context TEXT, question TEXT NOT NULL,
          options TEXT,                            -- JSON array, first = recommended
          status TEXT NOT NULL DEFAULT 'open',     -- 'open' | 'answered' | 'stale'
          answer TEXT, asked_at INTEGER, answered_at INTEGER)
reports(id INTEGER PRIMARY KEY, job TEXT NOT NULL, body TEXT NOT NULL,
        reported_at INTEGER, handled_at INTEGER)   -- handled_at: shepherd ran
                                                   -- completion checks
jobs(job TEXT PRIMARY KEY, repo TEXT, pane TEXT, target TEXT, worktree TEXT,
     branch TEXT, model TEXT, strategy TEXT, account TEXT,
     status TEXT NOT NULL DEFAULT 'active',        -- 'active' | 'done' |
                                                   -- 'crashed' | 'closed'
     spawned_at INTEGER)
state(key TEXT PRIMARY KEY, value TEXT)            -- cursor, run_id, repo, mode
```

Row ownership: spawn-agent.sh upserts the job row (`INSERT OR REPLACE`, so a
respawn refreshes pane/target/account in place); the shepherd owns every
`jobs.status` transition — `done` when a report is handled, `crashed` on a
gone event, `closed` before any deliberate pane close (rate-limit respawn,
mid-flight kill, wrap-up). The wrap-up status table becomes a SELECT over
`jobs` + `reports`.

### Scripts (all in the skill's `scripts/`)

**Worker-side** (absolute paths baked into the brief; args `--db --run --job`
baked in too so workers pass only content):

- `herd-ask.py --db <db> --run <run> --job <job> --context <text>
  --question <text> --option <text>... [--needs pane]` → INSERT question,
  `rt events emit shepherdr/<run>/<job>/question --json '{"qid":N}' || true`,
  print the qid. Worker then stops and waits; the answer arrives as its next
  message. First `--option` is the recommendation.
- `herd-report.py --db <db> --run <run> --job <job> --body-file <path>` (or
  stdin) → INSERT report, emit doorbell, print rid. Worker then stops.
- Script failure (bad path, locked DB): loud stderr, worker stops without
  asking/reporting; the sweep catches it as settled-silent. **No fallback to
  files — one contract.**

**Shepherd-side:**

- `herd-init.py --repo <repo>` → mint run id, create run dir + DB, snapshot
  the starting cursor, detect bus availability, record everything in
  `state`, print `{run, db, mode, cursor}`. Cursor snapshot:
  `rt events list 'shepherdr/<run>/**' --limit 1 | .cursor` — for a fresh
  run id nothing matches and the empty response carries the journal head
  (verified live). Note `--limit 1` returns the OLDEST match when matches
  exist (also verified live), which is why this snapshot is only valid for
  a virgin run id; resume never re-snapshots (it reads `state`).
  `herd-init.py --resume <run-dir>` reopens an existing run for a
  relaunched shepherd instead of minting a new one.
- `herd-wait.sh --db <db>` → read cursor from `state`, run
  `rt events wait 'shepherdr/<run>/**' --after <cursor> --timeout 15m`,
  persist the returned cursor (every response carries one, including
  timeouts), print the events, exit with rt's code (0 events / 124 timeout /
  1 bus unrecoverable). The shepherd runs this in a background Bash and
  re-arms after handling each exit. Shell reads/writes the `state` table via
  inline `python3 -c` — no new dependency. The persisted cursor is a wake
  optimization, not the correctness mechanism: resume correctness comes from
  DB reconciliation (see Resume below), so persist-before-handle is safe.
- `herd-read.py --db <db> question <qid> | report <rid> | open-questions |
  unhandled-reports | log` → human/agent-readable rendering; the shepherd
  never composes SQL either.
- `herd-answer.py --db <db> --qid <id> --target <agent> <answer>` → relay to
  the pane via relay-answer.sh FIRST; only on successful delivery mark the
  row answered (recording the answer text). A failed relay leaves the row
  `open` — the question is still live — and exits nonzero so the shepherd
  reports it.
- `herd-bridge.py --db <db>` — herd-monitor.py evolved: derive the watch set
  (pane → job → topic) from the `jobs` table on each cycle, watching only
  rows with `status = 'active'` — so panes spawned after the bridge started
  are picked up automatically, and deliberately closed panes (row already
  `closed`) never fire a spurious `gone`. Poll `pane list` every 30s; on a
  transition to blocked or a watched pane vanishing, emit the lifecycle
  event; if the emit fails, print the transition instead (which *is*
  today's monitor behavior — the same process serves both modes). All herdr
  traffic goes through the `hrd` shim, exactly as herd-monitor.py does
  today, so invisible herd sessions keep working.

### Watch loop

Set up after spawning: one background `herd-wait.sh` + one `herd-bridge.py`.
Then do nothing until an exit.

| `herd-wait.sh` exit | Meaning | Shepherd action |
|---|---|---|
| 0 | events | Handle each by topic (below), re-arm |
| 124 | 15m sweep | Cheap `pane list`; cross-check settled panes against DB (open question? report row? no → settled-silent, diagnose via pane read). A blocked pane the bus never mentioned means the bridge is sick: respawn it, say so. Re-arm |
| 1 | bus unrecoverable (CLI could not reach or restart the daemon) | Announce; degrade (below) |

Event handling: `question` → `herd-read.py question <qid>`; if the row is
still `open`, run the existing relay flow, answering via `herd-answer.py`;
`answered`/`stale` rows are replay noise, skip (idempotent by construction).
A `needs: pane` question follows today's attend flow; once the user is done,
the shepherd marks the row answered with `(handled in pane)` so the run log
stays complete.
`report` → read the row, run the existing completion checks (git log /
diff --stat against the write fence), then set `handled_at` and
`jobs.status = 'done'`. `blocked` → check open questions in the DB first;
only then read the pane. `gone` → if the job row is `active`, it's a crash:
report to the user, set `status = 'crashed'`, never silently respawn; a
non-active row means a deliberate close already accounted for it — skip.

The settled-silent net has a stated cost: a worker that stops without
publishing (e.g. its ask script failed) is caught by the sweep, up to 15
minutes later — today's per-agent waits would have seen the settle within
seconds. Accepted: the failure is rare, loud in the pane, and the trade
buys the entire flap elimination.

### Resume (shepherd relaunched mid-herd)

The DB, not the cursor, is what makes resume correct — the cursor only
decides where waking resumes from, so events handled-but-unpersisted or
persisted-but-unhandled both reconcile away:

1. `herd-init.py --resume <run-dir>` → reload `state` (run id, mode,
   cursor).
2. Reconcile the DB: relay every `open` question; run completion for every
   report with `handled_at IS NULL` (enumerate them via `herd-read.py
   --db <db> unhandled-reports`).
3. One `pane list` sweep against `active` jobs (same as the 15m sweep) to
   catch blocked/gone/settled-silent that predate the relaunch.
4. Respawn `herd-bridge.py`, re-arm `herd-wait.sh` from the persisted
   cursor. Replayed events whose rows are already answered/handled skip
   idempotently.

### Degraded mode

Entered when `herd-init.py` finds no bus, or mid-herd on exit 1. It is
today's flow with the DB in place of files: per-agent waits return
(`--until done --until idle --until blocked`, 1h timeout), the bridge keeps
running as a plain monitor (its emits fail, it prints), and contract checks
become `herd-read.py open-questions` / report SELECTs instead of `ls`.
Workers notice nothing in either direction. No automatic re-promotion
mid-herd; if the daemon comes back, the next herd uses it.

### Worker contract changes

- `references/job-template.md`: the "Asking the user a question" section
  (file format, multiple-choice markdown) is replaced by the `herd-ask.py`
  invocation with the option rules (every question multiple choice, first
  option recommended, `--needs pane` when the user must see the screen).
  Report instructions likewise become a `herd-report.py` call.
- `spawn-agent.sh`: default kickoff text updated (job dir → brief only;
  ask/report via the named scripts); inserts the job row into `jobs`; gains
  `--db/--run` plumbing (flags or env) so the baked worker args are correct.
  The respawn-after-rate-limit kickoff in SKILL.md updates to match.
- SKILL.md prose: job-dir contract section, watch section, relay, completion,
  wrap-up, degradation, red flags. Wrap-up keeps offering worktree and
  job-dir cleanup but RETAINS the run dir by default — `herd.db` is the run
  log the DB exists to preserve; deleting it is only ever an explicit user
  ask.
- `references/cloud-lane.md`: the cloud lane keeps the legacy FILE contract
  — a pod has no `~/.mattstack/shepherdr/runs/<run>/herd.db` and no skill scripts. The
  old template's question/report file sections move verbatim into
  cloud-lane.md's brief deltas, and cloud jobs stay on today's file-polling
  watch, outside the bus. Mixed herds are therefore explicitly supported:
  pane jobs on the bus + DB, cloud jobs on files.

### SKILL.md restructure

Bus + DB mechanics (topics, exit codes, schema, script reference, degraded
mode) move to `references/herd-bus.md`, loaded when herding. SKILL.md keeps
the flow: what fires, what the shepherd does. This follows the standing
decomposition-over-compression rule; SKILL.md must not grow materially.

## Process: writing-skills is the primary mode

The skill changes are developed under superpowers:writing-skills — TDD for
process documentation. Concretely:

- **RED first, with the right baseline per failure type.** For the shepherd
  watch loop, RED is the current skill's wake pattern on a live herd (the
  flappy-wait count). For the worker-side sections the old template cannot
  exhibit the new-contract failure (there was no script to miscall), so RED
  is the no-guidance control: fresh-context subagent reps given the task
  without the new wording, demonstrating they don't produce the script call
  unprompted. No skill edit lands without its failing test observed first —
  including "simple" template edits.
- **Match the form to the failure.** The worker-side changes are
  wrong-shaped-output problems (agents must produce a specific script call,
  not prose questions) → positive recipe/contract in the template, not
  prohibitions. The shepherd-side changes are conditional behavior (bus up vs
  down) → conditionals keyed to observable predicates (exit codes), not
  exemption clauses.
- **Micro-test wording** where guidance shapes behavior (the template's
  ask/report instructions): fresh-context subagent reps against a no-guidance
  control before full-herd runs, per the writing-skills methodology.
- **GREEN = the live herd** (below). Scenario tests verify wording; the herd
  is the integration test that the handoff defines as the only sufficient
  proof.
- **REFACTOR:** rationalizations or misuse observed in worker panes
  (composing SQL by hand, writing question.md out of habit, shepherd reading
  panes when a row exists) get explicit counters in the skill, then re-test.

## Validation: the live herd (success criteria)

1. Real herd, 2–3 workers, trivial jobs that each ask one question then
   report, bus up. Prove: the shepherd's signal path is the single bus wait;
   shepherd wakes ≈ real worker messages (+ sweeps), not the spurious-settle
   count; a shepherd relaunched mid-herd resumes from the DB cursor with no
   missed message.
2. Resilience. RESULT (2026-08-19): killing the rt daemon mid-wait
   produced `herd-wait.sh` exit 1 directly — the transport design's
   self-heal did not occur on the current build (SMAppService daemon;
   no CLI or launchd restart), so the two planned cases collapsed into
   one real one: the shepherd announces and degrades, no worker fails
   (herd-ask exit 0 with the daemon down, row published, emit swallowed),
   and questions/reports still flow via `open-questions` /
   `unhandled-reports` polling. Reported upstream to RT-44 as a negative
   transport finding.
3. Record before/after wake counts. The comparison is the evidence for
   RT-44's premise; a negative result is a real result and gets reported
   honestly.

## Non-goals

- No herdr changes; its detection stays the pane-state source of truth.
- No rt changes; topic scheme, DB, cursor persistence are all shepherdr-side.
- No automatic bus re-promotion mid-herd.
- No migration of `job.md` into the DB; briefs stay files.
- No bus/DB adoption for the cloud lane: cloud jobs keep the file contract
  (see Worker contract changes) — the lane is amended to say so, not left
  untouched.
- No automatic recovery when the bridge dies; the 15m sweep detecting a
  blocked pane the bus never announced is the bridge-sick signal.

## Verified mechanisms (commands run 2026-08-19)

- `rt events emit/list/wait` live on the RT-44 branch (dev-mode rt), daemon
  answering; stdout is clean JSON, breadcrumbs on stderr.
- Payload round-trips typed (`{"qid":1}` in → `payload: {"qid": 1}` out);
  `--after 0` replays; timeout returns `{ok, timedOut, cursor}` with exit
  **124**.
- `rt events list <pattern> --limit 1` returns the OLDEST match (cursor =
  oldest id) when matches exist, and the journal-head cursor when nothing
  matches — which is why the init snapshot is only valid for a virgin run
  id (verified live during adversarial review).
- `herdr agent wait` is single-target (no herd-wide subscription) — the
  bridge is required, not optional.
- Daemon-kill behavior observed live (2026-08-19): exit 1 within the armed
  wait, no self-heal on the current build; degradation path exercised for
  real. Worker publish path survived the dead daemon (exit 0, row landed).
