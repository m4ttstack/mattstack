# Stop hook: let a turn end while a background task is pending

**Date:** 2026-10-09
**Status:** draft from an independent review of one pipeline session; open decisions below are Matt's to make
**Builds on:** `2026-09-01-pipeline-gates-design.md` (section 5, the Stop hook). Nothing that spec settled changes except what section 5 says a Stop means.

## Problem

Claude Code moves any MCP call still running after 120 s to the background
("moved to the background as task `<id>`") and re-invokes the session with a
`<task-notification>` when it finishes. `ci_watch` with a long
`maxWaitSeconds` is always such a call, and so is every async `Agent`.

The pipeline gate Stop hook (`hooks/pipeline-gate-stop.sh`) was written on
the premise that a Stop under a `running` run means the agent ended in
prose. A pending background task is a sixth case the hook cannot see, so it
blocks the turn. Blocked, the agent waits in the foreground instead
(`python3 -c "import time; time.sleep(540)"`, which the shell tool's
foreground-sleep block does not catch), and keeps doing so for the rest of
the session even when nothing blocks it any more.

In the reviewed session this cost about 3% of the session's cache-read
tokens (eight sleep wakes that had nothing to deliver) and, worse, delayed
the `ci_watch` result itself by 3.5 minutes and any chat or user message by
up to the length of the sleep. The two earlier blocks in that session were
async `Agent`s, not MCP: the hole is "background task", not `ci_watch`.

The stage skill also never says that a backgrounded `ci_watch` may end the
turn: its graph reads "running: call again" and nothing else, so even with
the hook fixed an agent that has learned to sleep has no reason to stop.

## Fix

1. **The hook allows a Stop while a background task is pending.** It reads
   `transcript_path` from the Stop input and scans the session transcript
   for background tasks that have started and not yet been delivered:
   - an MCP call backgrounded (`moved to the background as task <id>` in a
     tool result);
   - an async agent launched (`toolUseResult.status: "async_launched"`,
     `agentId`);
   - minus any task whose notification was delivered (a `queue-operation`
     `remove`, or a `queued_command` attachment, naming the `<task-id>`) or
     that the agent stopped (`TaskStop` with that `task_id`).

   A launch that is enqueued but not yet delivered still counts as pending:
   the delivery is what re-invokes the pane, and it happens the moment the
   turn ends.

   A pending task older than a fixed bound is ignored (background tasks
   "do not survive exiting this session" and emit no notification when they
   die, so without a bound one stale launch would hold the gate open for
   the life of the transcript). A transcript over a size cap, a scan over
   its time cap, a missing `transcript_path`, or any parse error falls
   through to today's block. The scan runs only after the hook has already
   found this session's open run, so a session with no run pays nothing.

2. **Background shell tasks are ignored on purpose.** `rt gate wait` is
   covered by `waiting-gate`, and a dev server never finishes.

3. **The stage skill names the exit.** `attachments/pipeline/stage-watch-ci`
   gains the one branch the incident lacked: when `ci_watch` comes back
   backgrounded, end the turn in one line; the task notification re-invokes
   the stage with the result as the `ci_watch state`.

4. **The three sentences that state the old invariant change with it:**
   `attachments/gate-protocol/SKILL.md` ("Under a run a turn ends only with
   `waiting-gate` or `hold` set"), the `hooks/README.md` row for the hook,
   and a dated note under section 5 of the 2026-09-01 spec.

No run field, no console or board change, no rt change.

## Acceptance

- Under a `running` run with a backgrounded MCP call whose notification has
  not been delivered, the hook exits 0 and prints nothing.
- The same with an async agent launched and not yet delivered: exit 0.
- A launch whose `<task-id>` was delivered (`queue-operation` `remove` or a
  `queued_command` attachment): exit 2, today's message.
- A launch the agent ended with `TaskStop`: exit 2.
- A launch enqueued but not delivered: exit 0.
- A background shell task alone (`backgroundTaskId` in a Bash result): exit 2.
- A pending launch older than the age bound: exit 2.
- No `transcript_path`, a missing file, a file over the size cap, a line
  the scan must read (one carrying a task marker) that is not JSON, or a
  scan past its time cap: exit 2, today's message. Lines with no marker
  are skipped unread.
- A session with no running run never opens the transcript.
- Every fixture is a real transcript line from the reviewed session with
  paths, URLs, shas, branch names and prompts replaced by neutral values.
- The hook's existing tests still pass (`hooks/tests/test-pipeline-gate-stop.sh`,
  `tests/test-gate-stop-hook.sh`).
- `stage-watch-ci`'s graph has the backgrounded branch, passes
  `check-dot.py` and `tests/certify.sh`, and a fresh agent given the
  backgrounded `ci_watch` result ends its turn instead of sleeping (GREEN),
  where the same agent without the edit slept (RED).
- `gate-protocol/SKILL.md`, `hooks/README.md` and the 2026-09-01 spec say
  the new rule.
- `plugin.json` version is bumped in the commit that changes the skill.

## Decided (2026-10-09)

1. **Age bound:** a pending launch older than 120 minutes (by its launch
   line's timestamp) no longer counts. No session-start boundary.
2. **Background shell tasks are ignored.** The GitHub branch's "sleep 60 as
   a background Bash task" path stays as it is.
3. **CI coverage:** the `plugin-mattstack` job gains one step that runs both
   hook test scripts.
4. **The plan stays local** in the gitignored plans folder; only this spec
   is committed.

## Open decisions

1. **Size and time caps.** Recommendation: 64 MB and 1.5 s inside the scan
   (the reviewed transcript was 14 MB and the scan takes well under a
   second; `hooks.json` gives the whole hook 5 s).
2. **The standalone `watch-ci` engine.** Its flow graph has the same
   `ci_watch state?` node. Recommendation: give it the same branch in the
   same PR; the RED/GREEN scenario is identical.

## Out of scope

- A `waiting-task` run field, console `PLUMBING_KEYS`, or any board change.
- Changing `ci_watch`'s defaults or caps, or the agent's choice of
  `maxWaitSeconds`.
- Resumed agents: an agent resumed through `SendMessage` after its first
  notification writes no launch line, so the hook does not count it.
- The daemon-side idle nudge from the 2026-09-01 spec.

## Source

Review of one pipeline session's transcript (2026-10-08 to 2026-10-09):
three Stop blocks in 357 requests, two during async agents and one during a
backgrounded `ci_watch`; 31 foreground sleeps, 8 with nothing to deliver.
