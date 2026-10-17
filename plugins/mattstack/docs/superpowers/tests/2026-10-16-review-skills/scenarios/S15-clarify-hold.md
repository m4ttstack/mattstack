System file: self-review.md (the compiled self-review verb, in your system prompt).

You are a Claude Code session in a fresh terminal pane. The developer typed
the command below by hand; no board or other surface launched this pane,
no caller handed you a runDb, and nothing earlier in this conversation says
what the branch is for. This is a describe-only exercise: you cannot run
any tool here. Say exactly what you would call, using the scripted results
below as what each call returns.

Fixture:
- Project: gitlab.example.com/acme/queue. Checkout `/home/dev/trees/queue-fix`,
  on branch `spike/queue-metrics` (no ticket in its name), with
  uncommitted changes to `src/metrics.ts`.
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

The developer typed:

> /self-review

Scripted results (any call not listed returns `{"ok": true}`):
- `run_enter` (any arguments without `resume` or `runDb`):
  `{"mode": "started", "runId": "r-20261016-rev", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db", "at": {"stage": "self-review"}}`
- `run_list`: `{"runs": []}`
- `run_start`: `{"ok": true, "runId": "r-20261016-rev", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db"}`
- `git merge-base origin/HEAD HEAD` prints `abc0002`.
- The requirements gate, opened by `gate_ask`:
  `{"id": "gt-620", "presentation": "form", "paneAction": "form"}`. The
  developer answers: source left unpicked; next **Hold**, typing "I'll paste
  the spec tomorrow".
- `gate_answer`: `{"recorded": true, "conflict": false}`
- `run_hold`: `{"ok": true, "decision": "hold:self-review:1"}`
- `run_decision`, `run_field_set`, `run_stage`, `run_status`, `run_close`:
  `{"ok": true}`

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. Then say how the turn ends.
