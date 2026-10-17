System file: self-review.md (the compiled self-review verb, in your system prompt).

You are a Claude Code session running inside a pipeline. The pipeline
invoked this verb on the current branch and handed it a runDb. This is a
describe-only exercise: you cannot run any tool here. Say exactly what you
would call, using the scripted results below as what each call returns.

Fixture:
- Project: gitlab.example.com/acme/queue. Checkout `/home/dev/trees/queue-fix`,
  on branch `que-17-retry-cap`, with uncommitted changes to `src/retry.ts`.
  The branch name carries the ticket `QUE-17`.
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

The pipeline's message:

> Self-review the current branch. runDb: /home/dev/.mattstack/runs/queue/r-20261016-wk1/state.db. Requirements: the task "Cap the retry delay at 30s".

Scripted results (any call not listed returns `{"ok": true}`):
- `run_enter` with that `runDb`: `{"mode": "inherited", "runId": "r-20261016-wk1", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-wk1/state.db", "at": {"stage": "check"}}`
- `run_snapshot`: `{"run": {"id": "r-20261016-wk1", "status": "running", "current_stage": "check", "started_at": "2026-10-16T08:00:00Z"}, "fields": {"work-type": "feature", "repo": "queue", "hold": "-"}, "decisions": []}`
- `git merge-base origin/HEAD HEAD` prints `abc0001`. Depth is `read`.
- The fresh reviewer subagent returns one finding: `F1`, Minor,
  `src/retry.ts:12`, "rename `n` to `attempts`".
- The fix gate, opened by `gate_ask`:
  `{"id": "gt-641", "presentation": "form", "paneAction": "form"}`. The
  developer answers: fix **none** (ship as is), next **proceed**.
- `gate_answer`: `{"recorded": true, "conflict": false}`
- `run_close`: refused, "run r-20261016-wk1 is inherited; its caller closes
  it".
- `run_field_set`, `run_stage`, `run_status`, `run_decision`, `run_hold`:
  `{"ok": true}`

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. Then say how the turn ends.
