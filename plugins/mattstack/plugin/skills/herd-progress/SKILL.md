---
name: herd-progress
description: Use when a shepherd is asked for /progress, herd progress, "where is the herd at", or a status view of a running shepherdr herd's jobs, tasks and progress bars.
allowed-tools:
  - "Bash(python3 */scripts/herd_progress.py:*)"
---

# Herd progress

One script call renders the whole view: the herd from rt, and each job's
tasks from its own SDD ledger and plan. The shepherd prints what it returns.

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
| spec, plan, exec, review | ✓ done, ▸ current, blank not yet, · not tracked for this job's method (trivial, direct-tdd and delegate jobs) |
| tasks | `█` done and `░` left, from the ledger's `Task N: complete` lines against the plan's `Task N` headings; `·` bar with `n/?` when the plan total is unknown |
| now | the gate's question for **NEEDS YOU**, else the ledger's latest line |

Task counts are the worker's own ledger, not a verified result: say "the
ledger shows" when you quote one.

## When the script fails

It exits non-zero and prints the reason. Quote the reason in one line.
