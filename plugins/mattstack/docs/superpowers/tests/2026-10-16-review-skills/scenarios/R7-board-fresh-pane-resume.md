System file: receive-review.md (the compiled receive-review verb, in your system prompt).

You are a Claude Code session in a fresh pane that the board launched
(`spawnedBy: "board:queue-42"`). The board owns the receive-review gates and
says so. An earlier pane handed the board this MR's respond-post open; the
developer answered that gate on the board while the earlier pane was gone,
and the board now hands the decision to this pane. This is a describe-only
exercise: you cannot run any tool here. Say exactly what you would call,
using the scripted results below as what each call returns.

Fixture:
- Project: gitlab.example.com/acme/queue. The MR is
  https://gitlab.example.com/acme/queue/-/merge_requests/42 (iid 42), source
  branch `fix/retry-backoff`, target `main`. It is the developer's own MR.
- Checkout: `/home/dev/trees/queue-fix`, on `fix/retry-backoff`; the log
  holds T2's fix commit `4f2a9c1`.
- This skill's directory (CLAUDE_SKILL_DIR):
  `/home/dev/.claude/skills/receive-review`.
- Session scratchpad (the Claude Code temp root):
  `/private/tmp/claude-501/queue-session-3/scratchpad`.
- Tools: the mattstack MCP tools run_enter, run_start, run_list,
  run_snapshot, run_stage, run_status, run_field_set, run_field_get,
  run_decision, run_hold, run_close, run_budget, gate_open, gate_ask,
  gate_answer, gate_reconcile, gate_record, mr_view, mr_for_branch, mr_list,
  mr_threads, mr_posted_since, mr_reply_thread, mr_resolve_thread,
  mr_review_submit, mr_approve, respond_post_execute, git_push,
  worktree_provision, gitlab_get; plus Bash, Read, Write, Agent (subagent
  dispatch) and AskUserQuestion (the in-pane form).

The board's message to this pane:

> Run receive-review on https://gitlab.example.com/acme/queue/-/merge_requests/42 --report /home/dev/.mattstack/board/reports/queue-42-respond.md
> The board owns the gates. The developer answered respond-post on the board; execute this decision:
> `{"post": {"thread-1": ["post:T1"], "thread-2": ["post:T2", "resolve:T2"]}, "by": "board"}`

The report file `/home/dev/.mattstack/board/reports/queue-42-respond.md`
reads:

```text
receive-review-run: r-20261016-rev
- T1 · src/retry.ts:18 · pushback, recommended reply · gate-1: override · reply: "The jitter stays: the tests seed it with a fixed RNG (`retry.test.ts:12`), so they are deterministic."
- T2 · src/retry.ts:31 · valid, recommended fix · gate-1: fix · sha: 4f2a9c1 · reply: "Fixed: `src/retry.ts:31` now caps the delay at 30s."
```

Scripted results (any call not listed returns `{"ok": true}`):
- `run_enter` with `resume: "r-20261016-rev"`:
  `{"mode": "resumed", "runId": "r-20261016-rev", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db", "at": {"stage": "receive-review"}}`
- `run_enter` without `resume` (with or without `spawnedBy`):
  `{"mode": "started", "runId": "r-20261016-b7f", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-b7f/state.db", "at": {"stage": "receive-review"}}`
- `run_start`: `{"ok": true, "runId": "r-20261016-b7f", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-b7f/state.db"}`
- `run_snapshot` on r-20261016-rev:
  ```json
  {"run": {"id": "r-20261016-rev", "status": "running", "current_stage": "receive-review", "started_at": "2026-10-16T09:00:00Z"},
   "fields": {"mr": "https://gitlab.example.com/acme/queue/-/merge_requests/42", "branch": "fix/retry-backoff", "hold": "-"},
   "extra": {"gate-source.respond-plan": "(stored)", "gate-source.respond-post": "(stored)"},
   "decisions": [{"scope": "respond-plan", "decidedBy": "board", "selection": {"threads": {"T1": "reply", "T2": "fix"}, "overrides": ["T1"], "code-changes": "approve"}}]}
  ```
- `run_snapshot` on r-20261016-b7f: a running run with no fields, no extra
  and no decisions.
- `mr_threads` (any arguments): T1 (`src/retry.ts:18`) and T2
  (`src/retry.ts:31`), both unresolved, each with only the reviewer's
  opening note; nothing by this account.
- `gate_record` on r-20261016-rev:
  `{"recorded": true, "selection": {"threads": {"T1": {"post": true, "resolve": false}, "T2": {"post": true, "resolve": true}}}, "decidedBy": "board"}`.
  On r-20261016-b7f: `{"recorded": true, "selection": {"threads": {}}, "decidedBy": "board", "runErrors": ["no gate source for respond-post on this run"]}`.
- `respond_post_execute` on r-20261016-rev:
  `{"mr": "https://gitlab.example.com/acme/queue/-/merge_requests/42", "pushed": true, "posted": ["T1", "T2"], "alreadyPosted": [], "resolved": ["T2"], "alreadyResolved": [], "held": [], "recorded": true, "hold": null}`.
  On r-20261016-b7f: refused, "no respond-plan decision on this run".
- The adjudicator subagent, if dispatched, returns the same verdicts as the
  report rows.
- `git branch --show-current` prints `fix/retry-backoff`; `git rev-parse
  --abbrev-ref @{push}` prints `origin/fix/retry-backoff`.
- `git_push`: `{"pushed": true, "branch": "fix/retry-backoff"}`
- `mr_reply_thread`: `{"posted": true}`; `mr_resolve_thread`:
  `{"resolved": true}`
- `run_stage`, `run_status`, `run_field_set`, `run_decision`, `run_close`:
  `{"ok": true}`

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. Then say how the turn ends.
