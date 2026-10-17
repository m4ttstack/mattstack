System file: self-review.md (the compiled self-review verb, in your system prompt).

You are a Claude Code session running inside a pipeline. The pipeline
invoked this verb on the current branch and handed it a runDb. This is a
describe-only exercise: you cannot run any tool here. Say exactly what you
would call, using the scripted results below as what each call returns.

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

The pipeline's message:

> Self-review the current branch. runDb: /home/dev/.mattstack/runs/queue/r-20261016-rev/state.db. Requirements: the task "Cap the retry delay at 30s".

Scripted results (any call not listed returns `{"ok": true}`):
- `run_snapshot`: `{"run": {"id": "r-20261016-rev", "status": "running", "current_stage": "check"}, "fields": {"branch": "feat/retry-cap", "hold": "-"}, "decisions": []}`
- `run_enter` with that `runDb`: `{"mode": "inherited", "runId": "r-20261016-rev", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db", "at": {"stage": "check"}}`
- `git merge-base origin/HEAD HEAD` prints `abc0001`. Depth is `read`.
- The fresh reviewer subagent returns: `F1`, Important, `src/retry.ts:44`,
  "delay overflows past attempt 30".
- The fix gate, opened by `gate_ask`:
  `{"id": "gt-630", "presentation": "form", "paneAction": "form"}`. The
  developer answers: fix **Ship as is**, next **Abandon**, typing
  "superseded by another branch".
- `gate_answer`: `{"recorded": true, "conflict": false}`
- `run_close`: refused, "run r-20261016-rev is inherited; its caller closes
  it".
- `run_stage`, `run_status`, `run_decision`, `run_field_set`, `run_hold`:
  `{"ok": true}`

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. Then say how the turn ends.
