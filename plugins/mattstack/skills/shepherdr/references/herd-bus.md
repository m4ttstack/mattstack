# herd bus + herd DB mechanics

Loaded when herding. SKILL.md owns the flow; this file owns the machinery.

## the run

`herd-init.py --repo <repo>` mints `<repo>-<yyyymmdd-HHMMSS>`, creates
`~/.mattstack/shepherdr/runs/<run>/herd.db`, snapshots the bus cursor, and prints
`{run, db, mode, cursor}`. `mode: "degraded"` = no bus; use the degraded
loop below. `herd-init.py --resume <run-dir>` reopens a run after a
shepherd relaunch (never re-snapshots).

## topics and payloads

    shepherdr/<run>/<job>/question   {"qid": N}   herd-ask.py
    shepherdr/<run>/<job>/report     {"rid": N}   herd-report.py
    shepherdr/<run>/<job>/blocked    {}           herd-bridge.py
    shepherdr/<run>/<job>/gone       {}           herd-bridge.py

Events are doorbells; rows are the letters. Job names must be unique
within a run -- prefix with the repo when a multi-repo herd collides.

## the DB

questions(id, job, needs, context, question, options, status
  open|answered|stale, answer, asked_at, answered_at)
reports(id, job, body, reported_at, handled_at)
jobs(job PK, repo, pane, target, worktree, branch, model, strategy,
  account, status active|done|crashed|closed, spawned_at)
state(key, value)  -- cursor, run_id, repo, mode, bridge_prev

Never compose SQL: herd-read.py renders, herd-answer.py records answers
(relay-first: a failed relay leaves the row open and exits 1),
herd-job.py transitions status/handled. Before ANY deliberate pane close
(respawn, mid-flight kill, wrap-up): `herd-job.py --db <db> <job>
--status closed` -- otherwise the bridge reports a spurious crash.

## the wait

    scripts/herd-wait.sh --db <db>          # background Bash, re-arm on exit

| exit | meaning | act |
|---|---|---|
| 0 | events (stdout JSON) | handle each by topic, re-arm |
| 124 | 15m sweep | `hrd pane list`; cross-check settled panes against open questions / unhandled reports; a blocked pane the bus never announced = bridge sick (respawn it, say so); re-arm |
| 1 | bus unrecoverable (CLI could not reach or restart the daemon) | announce, switch to degraded |

A killed daemon surfaces as exit 1 on the current rt build (live-validated
2026-08-19: neither the CLI nor launchd restarted it) -- degrade and tell
the user; the journal survives restarts, so if the daemon comes back a
fresh herd resumes cleanly from its cursor. Settled-silent workers are
caught by the sweep,
up to 15 minutes late; accepted cost, the failure is rare and loud in
the pane. Any exit code outside {0, 124, 1} is unexpected -- treat it the
same as exit 1: announce and switch to degraded.

## resume (shepherd relaunched mid-herd)

The DB, not the cursor, makes resume correct:
1. `herd-init.py --resume ~/.mattstack/shepherdr/runs/<run>`
2. Reconcile: relay every open question (`herd-read.py --db <db>
   open-questions`); run completion for every report with no handled_at
   (`herd-read.py --db <db> unhandled-reports` enumerates them;
   `herd-job.py --db <db> <job> --status done --handled <rid>` closes
   them out -- pass `--status done`, not just `--handled`, or the
   resumed job stays stuck `active`).
3. One pane-list sweep against active jobs.
4. Restart herd-bridge.py, re-arm herd-wait.sh. Replayed events whose
   rows are already answered/handled skip idempotently.

## degraded mode

Today's loop with the DB in place of files: per-agent waits
(`hrd agent wait <target> --until done --until idle --until blocked
--timeout 3600000`), herd-bridge.py keeps running (its emits fail, it
prints), and on every wake check `herd-read.py --db <db> open-questions`
and `herd-read.py --db <db> unhandled-reports` instead of `ls`-ing a job
dir. No automatic re-promotion mid-herd.
