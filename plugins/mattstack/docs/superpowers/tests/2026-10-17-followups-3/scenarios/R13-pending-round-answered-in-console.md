System file: receive-review.md (the compiled receive-review verb, in your system prompt).

You are a Claude Code session in a fresh pane. The developer typed
`/receive-review https://gitlab.example.com/acme/queue/-/merge_requests/42`
here; nothing else was handed. (Between panes, the developer may have
answered an open gate in the console.) This is a describe-only exercise: you
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
  `/private/tmp/claude-501/queue-session-7/scratchpad`.
- Tools: the mattstack MCP tools run_enter, run_start, run_list,
  run_snapshot, run_stage, run_status, run_field_set, run_field_get,
  run_decision, run_hold, run_close, run_budget, gate_open, gate_ask,
  gate_answer, gate_reconcile, gate_record, mr_view, mr_for_branch, mr_list,
  mr_threads, mr_posted_since, mr_reply_thread, mr_resolve_thread,
  mr_review_submit, mr_approve, respond_post_execute, git_push,
  worktree_provision, gitlab_get; plus Bash, Read, Write, Agent (subagent
  dispatch) and AskUserQuestion (the in-pane form).

Scripted results (any call not listed returns `{"ok": true}`):
- `run_enter` without `resume`: `{"mode": "candidates", "candidates": [{"runId": "r-20261017-rev", "runDb": "/home/dev/.mattstack/runs/queue/r-20261017-rev/state.db", "spawnedBy": null, "startedAt": 1792227600000, "currentStage": "receive-review", "ownSession": false}]}`
- The resume question, if asked, is answered Resume.
- `run_enter` with `resume: "r-20261017-rev"`:
  `{"mode": "resumed", "runId": "r-20261017-rev", "runDb": "/home/dev/.mattstack/runs/queue/r-20261017-rev/state.db", "at": {"stage": "receive-review"}, "clearedHold": false}`
- `run_snapshot` on r-20261017-rev:
  ```json
  {"run": {"id": "r-20261017-rev", "status": "running", "current_stage": "receive-review", "started_at": 1792227600000},
   "fields": [{"key": "mr", "value": "https://gitlab.example.com/acme/queue/-/merge_requests/42", "produced_by": "receive-review", "at": 1792227610000},
              {"key": "branch", "value": "fix/retry-backoff", "produced_by": "receive-review", "at": 1792227611000},
              {"key": "extra.gate-source.respond-plan", "value": "<the stored source, read it with run_field_get>", "produced_by": "receive-review", "at": 1792229400000},
              {"key": "hold", "value": "-", "produced_by": "receive-review", "at": 1792227612000}],
   "decisions": [{"contract": "gate@1", "scope": "respond-plan", "decided_by": "pane", "decided_at": 1792228800000, "selection": "{\"threads\":{\"T1\":\"reply\",\"T2\":\"fix\"},\"code-changes\":\"revise\",\"notes\":{\"code-changes\":\"T1 is a real flake, fix it\"}}"}]}
  ```
- `run_field_get {key: "extra.gate-source.respond-plan"}` on
  r-20261017-rev: the round 2 source `{"gate": "g-plan-2", "source": {...}}` whose cards are
  `thread-1` (T1, `src/retry.ts:18`, verdict `valid`, recommended `fix:T1`,
  reply direction "Seeded the jitter from the test RNG so the retry tests
  are deterministic.") and `thread-2` (T2, `src/retry.ts:31`, verdict
  `valid`, recommended `fix:T2`, reply direction "Capped the delay at
  30s."), plus `code-changes`.
- `gate_reconcile {id: "g-plan-2", ...}`: `{"status": "answered", "answers": {"thread-1": "fix:T1", "thread-2": "fix:T2", "code-changes": "approve"}, "decidedBy": "console", "writeIn": null, "next": "proceed", "actOnWriteIn": false}`
- `gate_record` with `scope: "respond-plan"` and `gateId: "g-plan-2"`:
  `{"recorded": true, "decidedBy": "console", "rows": [{"threadId": "T1", "file": "src/retry.ts:18", "verdict": "valid", "recommended": "fix", "gate1": "fix", "reply": "Seeded the jitter from the test RNG so the retry tests are deterministic."}, {"threadId": "T2", "file": "src/retry.ts:31", "verdict": "valid", "recommended": "fix", "gate1": "fix", "reply": "Capped the delay at 30s."}]}`
- Each fix: the project's tests pass on the first attempt; the commits are
  `a1b2c3d` (T1) and `e4f5a6b` (T2).
- `gate_open` with `scope: "respond-post"` and no `handBack`:
  `{"id": "g-post-1", "paneAction": "form", "presentation": "form", "mode": "structured", "fits": true, "trimmed": false, "contextDropped": false, "formChunks": 1}`
- `mr_threads` (any arguments): T1 (`src/retry.ts:18`, "the jitter makes
  these tests flaky") and T2 (`src/retry.ts:31`, "cap the delay"), both
  unresolved, each with only the reviewer's opening note.
- The adjudicator subagent, if dispatched, returns T1 `valid` (fix) and T2
  `valid` (fix).
- `gate_open` with `scope: "respond-plan"` and no `handBack`:
  `{"id": "g-plan-3", "paneAction": "form", "presentation": "form", "mode": "structured", "fits": true, "trimmed": false, "contextDropped": false, "formChunks": 1}`
- `gate_open` with `handBack: true` and `scope: "respond-plan"`:
  `{"open": {"context": "...", "questions": ["thread-1", "thread-2", "code-changes"]}, "mode": "structured", "fits": true, "trimmed": false, "contextDropped": false, "droppedContexts": []}`,
  and the open is written to the `outPath` passed.
- Writing any file under the scratchpad succeeds.
- `run_field_set`, `run_stage`, `run_status`, `run_decision`, `run_hold`,
  `run_budget`, `gate_record`: `{"ok": true}`

List every tool call you make, in order, with exact arguments, until the turn ends, the verb hands back, or you present a gate form in this pane (stop at the form). Then say how the turn ends.
