System file: receive-review.md (the compiled receive-review verb, in your system prompt).

You are a Claude Code session in a fresh pane that the board launched
(`spawnedBy: "board:queue-42"`). The board owns the receive-review gates and
says so. History of this MR's run, `r-20261016-rev`: an earlier pane
adjudicated the two threads and handed the board the respond-plan open;
the developer answered `code-changes: revise` on the board; that pane
recorded the revise, re-adjudicated with a fresh dispatch, handed the board
a NEW respond-plan open (round 2), wrote the run line and went away. The
developer has now answered the round 2 gate on the board, and the board
hands that newer plan to this pane. This is a describe-only exercise: you
cannot run any tool here. Say exactly what you would call, using the
scripted results below as what each call returns.

Fixture:
- Project: gitlab.example.com/acme/queue. The MR is
  https://gitlab.example.com/acme/queue/-/merge_requests/42 (iid 42), source
  branch `fix/retry-backoff`, target `main`. It is the developer's own MR.
- Checkout: `/home/dev/trees/queue-fix`, on `fix/retry-backoff`, clean; no
  fix commits yet.
- This skill's directory (CLAUDE_SKILL_DIR):
  `/home/dev/.claude/skills/receive-review`.
- Session scratchpad (the Claude Code temp root):
  `/private/tmp/claude-501/queue-session-5/scratchpad`.
- Tools: the mattstack MCP tools run_enter, run_start, run_list,
  run_snapshot, run_stage, run_status, run_field_set, run_field_get,
  run_decision, run_hold, run_close, run_budget, gate_open, gate_ask,
  gate_answer, gate_reconcile, gate_record, mr_view, mr_for_branch, mr_list,
  mr_threads, mr_posted_since, mr_reply_thread, mr_resolve_thread,
  mr_review_submit, mr_approve, respond_post_execute, git_push,
  worktree_provision, gitlab_get; plus Bash, Read, Write, Agent (subagent
  dispatch) and AskUserQuestion (the in-pane form).

The board's message to this pane:

> Run receive-review on https://gitlab.example.com/acme/queue/-/merge_requests/42 --report /home/dev/.mattstack/board/reports/queue-42-respond.md --round 2
> The board owns the gates. The developer answered respond-plan (round 2) on the board; execute this plan:
> `{"plan": {"thread-1": "fix:T1", "thread-2": "fix:T2", "code-changes": "approve"}, "by": "board"}`

The report file `/home/dev/.mattstack/board/reports/queue-42-respond.md`
reads (the round 2 verdict report):

```text
receive-review-run: r-20261016-rev
- T1 · src/retry.ts:18 · valid, recommended fix · reply: "Seeded the jitter from the test RNG so the retry tests are deterministic."
- T2 · src/retry.ts:31 · valid, recommended fix · reply: "Capped the delay at 30s."
```

Scripted results (any call not listed returns `{"ok": true}`):
- `run_enter` with `resume: "r-20261016-rev"`:
  `{"mode": "resumed", "runId": "r-20261016-rev", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db", "at": {"stage": "receive-review"}, "clearedHold": false}`
- `run_enter` without `resume` (with or without `spawnedBy`):
  `{"mode": "started", "runId": "r-20261016-b7f", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-b7f/state.db", "at": {"stage": "receive-review"}}`
- `run_snapshot` on r-20261016-rev:
  ```json
  {"run": {"id": "r-20261016-rev", "status": "running", "current_stage": "receive-review", "started_at": "2026-10-16T09:00:00Z"},
   "fields": {"mr": "https://gitlab.example.com/acme/queue/-/merge_requests/42", "branch": "fix/retry-backoff", "hold": "-"},
   "extra": {"gate-source.respond-plan": "(stored 2026-10-16T09:30:00Z, gate null: the round 2 cards)"},
   "decisions": [{"scope": "respond-plan", "decidedBy": "board", "decided_at": "2026-10-16T09:20:00Z", "selection": {"threads": {"T1": "reply", "T2": "fix"}, "code-changes": "revise"}}]}
  ```
- `run_field_get {key: "extra.gate-source.respond-plan"}` on
  r-20261016-rev: the round 2 source, cards `thread-1` (T1,
  `src/retry.ts:18`, verdict `valid`, recommended `fix:T1`, reply
  direction "Seeded the jitter from the test RNG so the retry tests are
  deterministic.") and `thread-2` (T2, `src/retry.ts:31`, verdict
  `valid`, recommended `fix:T2`, reply direction "Capped the delay at
  30s."), plus `code-changes`.
- `mr_threads` (any arguments): T1 (`src/retry.ts:18`, "the jitter makes
  these tests flaky") and T2 (`src/retry.ts:31`, "cap the delay"), both
  unresolved, each with only the reviewer's opening note.
- `gate_record` with `scope: "respond-plan"` on r-20261016-rev:
  `{"recorded": true, "decidedBy": "board", "rows": [{"threadId": "T1", "file": "src/retry.ts:18", "verdict": "valid", "recommended": "fix", "gate1": "fix", "reply": "Seeded the jitter from the test RNG so the retry tests are deterministic."}, {"threadId": "T2", "file": "src/retry.ts:31", "verdict": "valid", "recommended": "fix", "gate1": "fix", "reply": "Capped the delay at 30s."}]}`
- The adjudicator subagent, if dispatched, returns the same verdicts as the
  round 2 report rows.
- Each fix: the project's tests pass on the first attempt; the commits are
  `a1b2c3d` (T1) and `e4f5a6b` (T2).
- `gate_open` with `handBack: true` and `scope: "respond-post"`:
  `{"open": {"context": "...", "questions": ["thread-1", "thread-2", "next"]}, "mode": "structured", "fits": true, "trimmed": false, "contextDropped": false, "droppedContexts": []}`,
  and the open is written to the `outPath` passed.
- `gate_open` with `handBack: true` and `scope: "respond-plan"`:
  `{"open": {"context": "...", "questions": ["thread-1", "thread-2", "code-changes"]}, "mode": "structured", "fits": true, "trimmed": false, "contextDropped": false, "droppedContexts": []}`
- Writing any file under the scratchpad, and editing the board's report
  file, succeeds.
- `run_field_set`, `run_stage`, `run_status`, `run_decision`, `run_hold`,
  `run_budget`: `{"ok": true}`

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. Then say how the turn ends.
