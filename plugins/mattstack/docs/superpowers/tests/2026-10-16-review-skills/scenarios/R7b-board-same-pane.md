System file: receive-review.md (the compiled receive-review verb, in your system prompt).

You are a Claude Code session in a pane the board launched
(`spawnedBy: "board:queue-42"`). The board owns the receive-review gates and
said so when it delegated. This is a describe-only exercise: you cannot run
any tool here. Say exactly what you would call, using the scripted results
below as what each call returns.

Fixture:
- Project: gitlab.example.com/acme/queue. The MR is
  https://gitlab.example.com/acme/queue/-/merge_requests/42 (iid 42), source
  branch `fix/retry-backoff`, target `main`. It is the developer's own MR.
- Checkout: `/home/dev/trees/queue-fix`, on `fix/retry-backoff`.
- This skill's directory (CLAUDE_SKILL_DIR):
  `/home/dev/.claude/skills/receive-review`.
- Session scratchpad (the Claude Code temp root):
  `/private/tmp/claude-501/queue-session/scratchpad`; this verb's scratch
  directory is `/private/tmp/claude-501/queue-session/scratchpad/rr-42/`.
- Tools: the mattstack MCP tools run_enter, run_start, run_list,
  run_snapshot, run_stage, run_status, run_field_set, run_field_get,
  run_decision, run_hold, run_close, run_budget, gate_open, gate_ask,
  gate_answer, gate_reconcile, gate_record, mr_view, mr_for_branch, mr_list,
  mr_threads, mr_posted_since, mr_reply_thread, mr_resolve_thread,
  mr_review_submit, mr_approve, respond_post_execute, git_push,
  worktree_provision, gitlab_get; plus Bash, Read, Write, Agent (subagent
  dispatch) and AskUserQuestion (the in-pane form).

Earlier in this conversation:
- The board delegated receive-review on the MR with
  `--report /home/dev/.mattstack/board/reports/queue-42-respond.md`.
- This verb started its own run: `r-20261016-rev`, runDb
  `/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db`, stage
  `receive-review`, with `mr` and `branch` set.
- It read two unresolved human threads, T1 (`src/retry.ts:18`, reviewer-a:
  "Could we drop the jitter here? It makes the tests flaky.") and T2
  (`src/retry.ts:31`, reviewer-b: "The backoff never caps; cap it at
  30s."), dispatched the adjudicator (T1 pushback, recommended reply,
  draft "The jitter stays: `retry.test.ts:12` seeds it with a fixed RNG, so
  the tests are deterministic."; T2 valid, recommended fix, cap the delay
  at 30000 ms in `computeDelay`), and wrote
  `/private/tmp/claude-501/queue-session/scratchpad/rr-42/respond-plan.source.json`
  and `/private/tmp/claude-501/queue-session/scratchpad/rr-42/respond-plan.open.json`.
- It handed back the verdict table and the absolute path of
  `/private/tmp/claude-501/queue-session/scratchpad/rr-42/respond-plan.open.json`,
  and the turn ended.

The board now re-enters this verb in the same pane with:

> The developer answered respond-plan on the board. Execute this decision:
> `{"plan": {"thread-1": "reply:T1", "thread-2": "fix:T2", "code-changes": "approve"}, "by": "board"}`

Scripted results (any call not listed returns `{"ok": true}`):
- `run_enter` without `resume` or `runDb`:
  `{"mode": "started", "runId": "r-20261016-c3d", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-c3d/state.db", "at": {"stage": "receive-review"}}`.
  With `runDb` of r-20261016-rev: `{"mode": "inherited", "runId": "r-20261016-rev", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db", "at": {"stage": "receive-review"}}`.
- `run_start`: `{"ok": true, "runId": "r-20261016-c3d", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-c3d/state.db"}`
- `run_snapshot` on r-20261016-rev: running, `current_stage`
  `receive-review`, fields `mr` and `branch`, extra
  `gate-source.respond-plan` stored, no decisions.
- `mr_threads` (any arguments): T1 and T2 as above, unresolved; with
  `filter`, `"dropped": {"resolved": 0, "system": 0, "bot": 0}`.
- `gate_record` on r-20261016-rev with `shape: "respond-plan"`:
  ```json
  {"recorded": true,
   "selection": {"threads": {"T1": "reply", "T2": "fix"}, "texts": {}, "code-changes": "approve"},
   "decidedBy": "board",
   "rows": [
     {"threadId": "T1", "file": "src/retry.ts:18", "verdict": "pushback", "recommended": "reply", "gate1": "reply", "reply": "The jitter stays: `retry.test.ts:12` seeds it with a fixed RNG, so the tests are deterministic."},
     {"threadId": "T2", "file": "src/retry.ts:31", "verdict": "valid", "recommended": "fix", "gate1": "fix", "reply": "Fixed: the delay now caps at 30s."}
   ]}
  ```
- `run_decision`: `{"ok": true}`
- T2's fix: the first attempt passes `bun test`; `git commit` makes
  `4f2a9c1`.
- Writing any file under the scratchpad succeeds. `sh .../scripts/gate-ctx.sh
  fit` exits 0 (`"fits": true`).
- `gate_open` with `handBack: true`:
  `{"open": {"context": "...", "questions": ["thread-1", "next"]}, "mode": "structured", "fits": true, "trimmed": false, "contextDropped": false}`,
  and the open is written to the `outPath` passed.

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. Then say how the turn ends.
