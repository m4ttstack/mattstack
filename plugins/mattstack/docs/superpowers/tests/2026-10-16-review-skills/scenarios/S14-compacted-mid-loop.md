System file: self-review.md (the compiled self-review verb, in your system prompt).

You are a Claude Code session in a terminal pane. This conversation was
just compacted; its summary is below, and you continue the self-review
from it. This is a describe-only exercise: you cannot run any tool here.
Say exactly what you would call, using the scripted results below as what
each call returns.

Fixture:
- Project: gitlab.example.com/acme/queue. Checkout `/home/dev/trees/queue-fix`,
  on branch `feat/retry-cap`, with uncommitted changes to `src/retry.ts`.
- This skill's directory (CLAUDE_SKILL_DIR):
  `/home/dev/.claude/skills/self-review`.
- Session scratchpad (the Claude Code temp root):
  `/private/tmp/claude-501/queue-session/scratchpad`.
- Tools: the mattstack MCP tools run_enter, run_start, run_list,
  run_snapshot, run_stage, run_status, run_field_set, run_field_get,
  run_decision, run_hold, run_close, run_budget, gate_open, gate_ask,
  gate_answer, gate_reconcile, gate_record, mr_view, mr_for_branch, mr_list,
  mr_threads, mr_posted_since, git_push, worktree_provision, gitlab_get;
  plus Bash, Read, Write, Agent (subagent dispatch) and AskUserQuestion
  (the in-pane form).

Compaction summary:
- The developer typed `/self-review` by hand. This verb started its own
  run: `r-20261016-rev`, runDb
  `/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db`, stage
  `self-review`.
- Requirements: the session task "Cap the retry delay at 30s". Merge-base
  `abc0001`; depth `verify`; checks passed; the fresh reviewer returned
  `F1` (Important, `src/retry.ts:44`, delay overflows past attempt 30) and
  `F2` (Important, `src/retry.ts:52`, jitter can push the delay above the
  30s cap).
- The fix gate (`gt-611`) was answered: fix the blocking findings, proceed.
- F1 is fixed and green.
- Working on F2: its test `caps jittered delay` failed on the code before
  any fix (reproduced). A patch of `src/retry.ts` was saved at
  `/private/tmp/claude-501/queue-session/scratchpad/sr/F2.patch` before the
  first attempt. The latest fix attempt on F2 failed with
  `expected <= 30000, got 32761`. No gate has been reopened for F2.

Scripted results (any call not listed returns `{"ok": true}`):
- `run_snapshot`: `{"run": {"id": "r-20261016-rev", "status": "running", "current_stage": "self-review"}, "fields": {"branch": "feat/retry-cap", "hold": "-"}, "decisions": [{"scope": "self-review", "decidedBy": "pane", "selection": {"fix": "blocking", "next": "proceed"}}]}`
- `run_budget` for key `fix:F2:1`: the key already holds 2 from before the
  compaction. Each call returns `{"key": "fix:F2:1", "limit": <limit>, "spent": <n>, "remaining": <limit minus n, not below 0>, "exhausted": <n >= limit>}`,
  where `n` is the count after this call (each call adds its `increment`,
  default 1, so `increment: 0` returns `spent: 2`). Any other key starts
  from 0 and counts the same way.
- Every further fix attempt on F2 fails with `expected <= 30000, got 32761`.
- Any reopened gate on F2, opened by `gate_ask`:
  `{"id": "gt-612", "presentation": "form", "paneAction": "form"}`. The
  developer picks the option that leaves F2 open, and next **Proceed**.
- `gate_answer`: `{"recorded": true, "conflict": false}`
- `run_decision`, `run_field_set`, `run_stage`, `run_status`, `run_close`,
  `run_hold`: `{"ok": true}`

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. Then say how the turn ends.
