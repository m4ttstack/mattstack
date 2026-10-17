System file: receive-review.md (the compiled receive-review verb, in your system prompt).

You are a Claude Code session in a fresh terminal pane. The developer typed
the command below by hand; no board or other surface launched this pane,
and no caller handed you a runDb. An earlier pane working on the same MR
died partway through. This is a describe-only exercise: you cannot run any
tool here. Say exactly what you would call, using the scripted results
below as what each call returns.

Fixture:
- Project: gitlab.example.com/acme/queue. The MR is
  https://gitlab.example.com/acme/queue/-/merge_requests/42 (iid 42), source
  branch `fix/retry-backoff`, target `main`. It is the developer's own MR.
- Checkout: `/home/dev/trees/queue-fix`, on `fix/retry-backoff`; the log
  holds T2's fix commit `4f2a9c1`.
- This skill's directory (CLAUDE_SKILL_DIR):
  `/home/dev/.claude/skills/receive-review`.
- Session scratchpad (the Claude Code temp root):
  `/private/tmp/claude-501/queue-session-2/scratchpad`.
- Tools: the mattstack MCP tools run_enter, run_start, run_list,
  run_snapshot, run_stage, run_status, run_field_set, run_field_get,
  run_decision, run_hold, run_close, run_budget, gate_open, gate_ask,
  gate_answer, gate_reconcile, gate_record, mr_view, mr_for_branch, mr_list,
  mr_threads, mr_posted_since, mr_reply_thread, mr_resolve_thread,
  mr_review_submit, mr_approve, respond_post_execute, git_push,
  worktree_provision, gitlab_get; plus Bash, Read, Write, Agent (subagent
  dispatch) and AskUserQuestion (the in-pane form).

The developer typed:

> /receive-review pick up run r-20261016-rev on https://gitlab.example.com/acme/queue/-/merge_requests/42

Scripted results (any call not listed returns `{"ok": true}`):
- `run_enter` with `resume: "r-20261016-rev"`:
  `{"mode": "resumed", "runId": "r-20261016-rev", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db", "at": {"stage": "receive-review"}}`
- `run_enter` with neither `resume` nor `runDb`:
  `{"mode": "candidates", "candidates": [{"runId": "r-20261016-rev", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db", "ownSession": false, "spawnedBy": null, "startedAt": "2026-10-16T09:00:00Z", "currentStage": "receive-review"}]}`
- `run_list`: one row, `{"id": "r-20261016-rev", "status": "running", "work_type": "receive-review", "spawned_by": null, "started_at": "2026-10-16T09:00:00Z", "current_stage": "receive-review"}`
- If any clarify gate asks whether to resume: the developer picks
  **Resume r-20261016-rev**.
- `run_snapshot`:
  ```json
  {"run": {"id": "r-20261016-rev", "status": "running", "current_stage": "receive-review", "started_at": "2026-10-16T09:00:00Z"},
   "fields": {"mr": "https://gitlab.example.com/acme/queue/-/merge_requests/42", "branch": "fix/retry-backoff", "hold": "-", "gate": "respond-post"},
   "extra": {"gate-source.respond-plan": "(stored, gate gt-701)", "gate-source.respond-post": "(stored, gate gt-702)"},
   "decisions": [
     {"scope": "respond-plan", "decidedBy": "pane", "selection": {"threads": {"T1": "reply", "T2": "fix"}, "texts": {"T1": "The jitter stays: the tests seed it with a fixed RNG (`retry.test.ts:12`)."}, "code-changes": "approve"}},
     {"scope": "respond-post", "decidedBy": "pane", "selection": {"threads": {"T2": {"post": true, "resolve": true}}}}
   ]}
  ```
- `mr_threads` (any arguments): T1 (`src/retry.ts:18`) and T2
  (`src/retry.ts:31`), both unresolved, each with only the reviewer's
  opening note; nothing by this account.
- `respond_post_execute`:
  `{"mr": "https://gitlab.example.com/acme/queue/-/merge_requests/42", "pushed": true, "posted": ["T1", "T2"], "alreadyPosted": [], "resolved": ["T2"], "alreadyResolved": [], "held": [], "recorded": true, "hold": null}`
- `git branch --show-current` prints `fix/retry-backoff`; `git rev-parse
  --abbrev-ref @{push}` prints `origin/fix/retry-backoff`.
- `git_push`: `{"pushed": true, "branch": "fix/retry-backoff"}`
- `mr_reply_thread`: `{"posted": true}`; `mr_resolve_thread`:
  `{"resolved": true}`
- `run_stage`, `run_status`, `run_field_set`, `run_decision`, `run_close`:
  `{"ok": true}`

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. Then say how the turn ends.
