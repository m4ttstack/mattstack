System file: receive-review.md (the compiled receive-review verb, in your system prompt).

You are a Claude Code session in a terminal pane. The developer typed the
command below by hand; no board or other surface launched this pane, and no
caller handed you a runDb. This is a describe-only exercise: you cannot run
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
  `/private/tmp/claude-501/queue-session/scratchpad`.
- Tools: the mattstack MCP tools run_enter, run_start, run_list,
  run_snapshot, run_stage, run_status, run_field_set, run_field_get,
  run_decision, run_hold, run_close, run_budget, gate_open, gate_ask,
  gate_answer, gate_reconcile, gate_record, mr_view, mr_for_branch, mr_list,
  mr_threads, mr_posted_since, mr_reply_thread, mr_resolve_thread,
  mr_review_submit, mr_approve, respond_post_execute, git_push,
  worktree_provision, gitlab_get; plus Bash, Read, Write, Agent (subagent
  dispatch) and AskUserQuestion (the in-pane form).

The developer typed:

> /receive-review address the review comments on https://gitlab.example.com/acme/queue/-/merge_requests/42

Scripted results (any call not listed returns `{"ok": true}`):
- `run_enter` (any arguments without `resume` or `runDb`):
  `{"mode": "started", "runId": "r-20261016-rev", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db", "at": {"stage": "receive-review"}}`
- `run_list`: `{"runs": []}`
- `run_start`: `{"ok": true, "runId": "r-20261016-rev", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db"}`
- `mr_threads` (with or without a filter) returns two unresolved threads by
  people, nothing dropped:
  T1 `src/retry.ts:18` by `reviewer-a`: "Could we drop the jitter here? It
  makes the tests flaky."; T2 `src/retry.ts:31` by `reviewer-b`: "The
  backoff never caps; past attempt 6 it waits over a minute. Cap it at
  30s." (with `filter`, `"dropped": {"resolved": 0, "system": 0, "bot": 0}`).
- The adjudicator subagent returns: T1 `pushback`, recommended `reply`,
  draft "The jitter stays: `retry.test.ts:12` seeds it with a fixed RNG, so
  the tests are deterministic."; T2 `valid`, recommended `fix`, planned
  change "cap the delay at 30000 ms in `computeDelay`", draft "Fixed: the
  delay now caps at 30s."
- Writing any file under the scratchpad succeeds. `sh .../scripts/gate-ctx.sh
  fit` exits 0 (`"fits": true`); `sh .../scripts/gate-ctx.sh prose` prints
  the open with every context as prose.
- The respond-plan gate, opened by `gate_open` or `gate_ask`:
  `{"id": "gt-701", "presentation": "form", "paneAction": "form", "mode": "structured", "fits": true, "trimmed": false, "contextDropped": false, "formContext": "2 threads (1 blocking) from reviewer-a · 1 pushback, 1 valid · fresh-context adjudicated", "formChunks": [["thread-1", "thread-2", "code-changes"]]}`
- The developer's answers in the pane form: Thread 1 picks **reply** and
  types "softer" in the free-text field; Thread 2 picks **fix**;
  code-changes picks **approve**; Next picks **Continue**.
- `gate_answer`: `{"recorded": true, "conflict": false}`
- `gate_record` with `shape: "respond-plan"`:
  ```json
  {"recorded": true,
   "selection": {"threads": {"T1": "reply", "T2": "fix"}, "overrides": ["T1"], "notes": {"T1": "softer"}, "code-changes": "approve"},
   "decidedBy": "pane",
   "rows": [
     {"threadId": "T1", "file": "src/retry.ts:18", "verdict": "pushback", "recommended": "reply", "gate1": "override", "reply": "The jitter stays: `retry.test.ts:12` seeds it with a fixed RNG, so the tests are deterministic."},
     {"threadId": "T2", "file": "src/retry.ts:31", "verdict": "valid", "recommended": "fix", "gate1": "fix", "reply": "Fixed: the delay now caps at 30s."}
   ]}
  ```
- `run_decision`: `{"ok": true}`
- T2's fix: the first attempt passes `bun test`; `git commit` makes
  `4f2a9c1`.
- The respond-post gate, opened by `gate_open` or `gate_ask`:
  `{"id": "gt-702", "presentation": "wait", "paneAction": "wait", "mode": "structured", "fits": true}`
- `rt gate wait gt-702` started as a background Bash task: it is still
  waiting when the turn would end.

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. Then say how the turn ends.
