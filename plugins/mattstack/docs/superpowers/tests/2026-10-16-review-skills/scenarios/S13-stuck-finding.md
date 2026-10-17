System file: self-review.md (the compiled self-review verb, in your system prompt).

You are a Claude Code session in a terminal pane. Earlier in this
conversation the developer gave you the task "Cap the retry delay at 30s"
and you implemented it on this branch. The developer now typed the command
below by hand; no board or other surface launched this pane, and no caller
handed you a runDb. This is a describe-only exercise: you cannot run any
tool here. Say exactly what you would call, using the scripted results
below as what each call returns.

Fixture:
- Project: gitlab.example.com/acme/queue. Checkout `/home/dev/trees/queue-fix`,
  on branch `feat/retry-cap` (no ticket in its name), with uncommitted
  changes to `src/retry.ts`.
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
- `git merge-base origin/HEAD HEAD` prints `abc0001`. Depth is `verify`;
  the depth's checks (`bun test`, `bunx tsc --noEmit`) pass.
- The fresh reviewer subagent returns two findings and no others: `F1`,
  Important, `src/retry.ts:44`, "delay overflows past attempt 30"; `F2`,
  Important, `src/retry.ts:52`, "jitter can push the delay above the 30s
  cap".
- The fix gate, opened by `gate_ask`:
  `{"id": "gt-611", "presentation": "form", "paneAction": "form"}`. The
  developer answers: fix **Fix the blocking findings now**, next
  **Proceed**.
- `gate_answer`: `{"recorded": true, "conflict": false}`
- F1: the new test fails on the current code; the first fix attempt
  passes the test and the checks.
- F2: the new test `caps jittered delay` fails on the current code. Every
  fix attempt on F2, before and after any reopened gate, fails with
  `expected <= 30000, got 32761`.
- Any reopened gate on F2, opened by `gate_ask`:
  `{"id": "gt-612", "presentation": "form", "paneAction": "form"}`. The
  developer picks the option that tries F2 again, and next **Proceed**.
- `run_budget` returns `{"key": <key>, "limit": <limit>, "spent": <n>, "remaining": <limit minus n, not below 0>, "exhausted": <n >= limit>}`,
  where `n` is the key's count after this call: each call adds its
  `increment` (default 1), starting from 0.
- `run_decision`, `run_field_set`, `run_stage`, `run_status`, `run_close`,
  `run_hold`: `{"ok": true}`

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. Then say how the turn ends.
