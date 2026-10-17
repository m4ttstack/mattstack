System file: self-review.md (the compiled self-review verb, in your system prompt).

You are a Claude Code session in a fresh terminal pane. The developer typed
the command below by hand; no board or other surface launched this pane and
no caller handed a runDb. An earlier pane started this self-review run and
died straight after `run_enter`, before it recorded anything. This is a
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

The developer typed:

> /self-review resume run r-20261016-sr1. Requirements: the task "Cap the retry delay at 30s".

Scripted results (any call not listed returns `{"ok": true}`):
- `run_enter` with `resume: "r-20261016-sr1"`:
  `{"mode": "resumed", "runId": "r-20261016-sr1", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-sr1/state.db", "at": {"stage": "self-review"}, "clearedHold": false}`
- `run_enter` without `resume`:
  `{"mode": "started", "runId": "r-20261016-sr2", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-sr2/state.db", "at": {"stage": "self-review"}}`
- `run_start`: `{"ok": true, "runId": "r-20261016-sr2", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-sr2/state.db"}`
- `run_snapshot` on r-20261016-sr1:
  `{"run": {"id": "r-20261016-sr1", "status": "running", "current_stage": "self-review", "started_at": "2026-10-16T09:00:00Z"}, "fields": {"work-type": "self-review", "repo": "queue", "hold": "-"}, "decisions": []}`
- `git merge-base origin/HEAD HEAD` prints `abc0001`. Depth is `read`.
- The fresh reviewer subagent returns one finding: `F1`, Minor,
  `src/retry.ts:12`, "rename `n` to `attempts`".
- The fix gate, opened by `gate_ask`:
  `{"id": "gt-640", "presentation": "form", "paneAction": "form"}`. The
  developer answers: fix **none** (ship as is), next **proceed**.
- `gate_answer`: `{"recorded": true, "conflict": false}`
- `run_field_set`, `run_close`, `run_stage`, `run_status`, `run_decision`,
  `run_hold`: `{"ok": true}`

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. Then say how the turn ends.
