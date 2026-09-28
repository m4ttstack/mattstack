---
name: herd-progress
description: Use when a shepherd is asked for /progress, herd progress, "where is the herd at", or a status view of a running shepherdr herd's jobs, tasks and progress bars.
allowed-tools:
  - "Bash(python3 */scripts/herd_progress.py:*)"
---

# Herd progress

One script call renders the whole view: the herd from rt, and each job's
progress from wherever its method keeps it (an SDD ledger and plan, the
brief's items and the report draft, or a pipeline run). The shepherd prints
what it returns.

## The reply

1. Run the script by its absolute path under this skill's base directory,
   naming your herd:

   ```bash
   python3 <base dir>/scripts/herd_progress.py --herd <herd id>
   ```

   The command starts with `python3`, with no env prefix. When you do not
   know the id, the `herd_list` tool names the active herds.

2. Reply with its output verbatim: the header line, the overall bar, then
   the table. The table is the view; it carries no stage strip, extra
   blocks or re-drawn bars of your own.

3. Under the table, one or two lines: each row whose status is
   **NEEDS YOU**, **CRASHED**, **STUCK** or *idle*, with the move you
   propose. When there is none, one line saying nothing needs the user.
   *closed* and done rows are the record and get no line.

That is the whole reply. The script already measured everything the table
shows, so the turn is one call and one message.

## Reading the table

| Column | Values |
| --- | --- |
| status | **NEEDS YOU** (an open gate, herd or pipeline run), **CRASHED**, **STUCK** (parked at a dialog, or blocked at a prompt with no gate), *idle* (the worker's turn ended, no gate), running, spawning, done, *closed* (no report) |
| spec, plan, exec, review | ✓ done, ▸ current, ✗ failed (pipeline stage), blank not yet, · not tracked for this job's method |
| tasks | `█` done and `░` left; `·` bar with `n/?` when the total is unknown, `?/n` when the done count is not written yet |
| now | the gate's question for **NEEDS YOU**, else the method's latest signal |

Where each method's row comes from:

| Method | spec, plan, exec, review | tasks and now |
| --- | --- | --- |
| superpowers, from-spec, from-plan | the report draft's milestones and the SDD ledger; spec is `·` on from-spec, spec and plan on from-plan | ledger `Task N: complete` lines against the plan's `Task N` headings; the ledger's latest line |
| trivial, direct-tdd | exec only; the rest `·` (no ledger by design) | the brief's item codes against the draft's `- A1: done` lines. The draft is written at completion, so `?/n` for the whole run is normal |
| delegate | once its draft names a strategy, that strategy's row; until then a ledger if one exists, else `delegate: strategy not named yet` | as for the strategy it named |
| a domain Method (a team's pipeline skill) | the herd's pipeline run on the job's branch: its `plan`, `implement` and review stages | `·`; the run's current stage, or its attention reason. Stages after review (ship, CI) show only here, so all ✓ with a stage in now is still running. A run still going keeps the row running, with `pane idle` added when the worker's turn has ended |

The header's trouble count is the **CRASHED**, **STUCK** and *idle* rows.

Task counts are the worker's own ledger or draft, not a verified result:
say "the ledger shows" when you quote one.

## When the script fails

It exits non-zero and prints the reason. Quote the reason in one line.
