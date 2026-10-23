---
name: work-progress
description: Use when asked for progress, status, "where is it at" or "where is my plan at" on long-running work: a shepherdr herd, a superpowers plan running under subagent-driven development (its SDD ledger), or an epic made of several plans.
allowed-tools:
  - "Bash(python3 */scripts/work_progress.py:*)"
---

# Work progress

One script call renders the whole view, for a herd or for plans: the header
line, the overall bar, then one table row per job or plan. rt holds each
plan's record, so the script measures what git logs, ledgers and directory
listings would only hint at. You print what it returns.

A solo direct-tdd or trivial job outside a herd has no plan or ledger, so
there is nothing to measure: say so in one line.

## Choose the input

| You are | Pass |
| --- | --- |
| A shepherd, asked about the herd | `--herd <herd id>`; the `herd_list` tool names the active herds when you do not know the id |
| An agent on one plan | `--plan <plan path>` |
| An agent on an epic (several plans) | one `--plan` per plan, in order, grouped as your own context says (one spec's plans, a numbered family, everything on the branch), and `--title "<epic name>"` |

The script reads every plan's progress from one tree: by default the tree
holding the first plan file. Add `--tree <root>` when the plans run in
another tree (a herd worker running a plan committed on main). Plans that
run in different trees need separate calls, one per tree.

## The reply

1. Run the script by its absolute path under this skill's base directory:

   ```bash
   python3 <base dir>/scripts/work_progress.py --herd <herd id>
   python3 <base dir>/scripts/work_progress.py --plan <plan 1> --plan <plan 2> --title "<epic name>"
   ```

   The command starts with `python3`, with no env prefix. Always pass
   `--herd` or `--plan`; with neither, the script refuses.

2. Reply with its output verbatim: the header line, the overall bar, then
   the table. The table is the view; it carries no stage strip, extra
   blocks or re-drawn bars of your own.

3. Under the table, one or two lines: each row whose status needs the
   user (the tables below say which), with the move you propose. When
   there is none, one line saying nothing needs the user.

That is the whole reply: one call and one message. A plan's status is what
the script prints. A plan reading not started or unknown stays that in your
reply, even when a later plan has started: never call a plan done unless
its row says done.

## Reading the table

Herd rows:

| Column | Values |
| --- | --- |
| status | **NEEDS YOU** (an open gate, herd or pipeline run), **CRASHED**, **STUCK** (parked at a dialog, or blocked at a prompt with no gate), *idle* (the worker's turn ended, no gate), running, spawning, done, *closed* (no report) |
| spec, plan, exec, review | ✓ done, ▸ current, ✗ failed (pipeline stage), blank not yet, · not tracked for this job's method |
| tasks | `█` done and `░` left; `·` bar with `n/?` when the total is unknown, `?/n` when the done count is not written yet |
| now | the gate's question for **NEEDS YOU**, else the method's latest signal |

A line under the table: **NEEDS YOU**, **CRASHED**, **STUCK** and *idle*.
*closed* and done rows are the record and get no line. The header's trouble
count is the **CRASHED**, **STUCK** and *idle* rows.

Where each herd method's row comes from:

| Method | spec, plan, exec, review | tasks and now |
| --- | --- | --- |
| superpowers, from-spec, from-plan | the report draft's milestones and the SDD ledger; spec is `·` on from-spec, spec and plan on from-plan | ledger `Task N: complete` lines against the plan's `Task N` headings; the ledger's latest line |
| trivial, direct-tdd | exec only; the rest `·` (no ledger by design) | the brief's item codes against the draft's `- A1: done` lines. The draft is written at completion, so `?/n` for the whole run is normal |
| delegate | once its draft names a strategy, that strategy's row; until then a ledger if one exists, else `delegate: strategy not named yet` | as for the strategy it named |
| a domain Method (a team's pipeline skill) | the herd's pipeline run on the job's branch: its `plan`, `implement` and review stages | `·`; the run's current stage, or its attention reason. Stages after review (ship, CI) show only here, so all ✓ with a stage in now is still running. A run still going keeps the row running, with `pane idle` added when the worker's turn has ended |

Plan rows (the overall bar counts tasks across the plans):

| Status | Means | Line under the table |
| --- | --- | --- |
| running | its SDD ledger is live | no |
| done | rt recorded it finished | no |
| not started | rt has no record of it | no |
| *quiet* | its ledger untouched 30+ minutes | yes: propose checking the session running it |
| tree gone | the tree that ran it is gone or on another branch | yes: say the counts are the last seen and its finish was never recorded |
| unknown | rt is too old to keep plan records, and no ledger is live | yes: say it is not started or finished, and that you cannot tell which |

Task counts are the worker's own ledger or draft, not a verified result:
say "the ledger shows" when you quote one.

## When the script fails

It exits non-zero and prints the reason. Quote the reason in one line.
