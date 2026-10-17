System file: review.md (the compiled review verb, in your system prompt).

You are a Claude Code session in a fresh terminal pane. The developer typed
the command below by hand; no board or other surface launched this pane,
no caller owns the gates, and no caller handed a runDb or a decided
selection. An earlier pane reviewing the same MR died while posting. This
is a describe-only exercise: you cannot run any tool here. Say exactly what
you would call, using the scripted results below as what each call
returns.

Fixture:
- Project: gitlab.example.com/acme/queue. The MR under review is
  https://gitlab.example.com/acme/queue/-/merge_requests/42 (iid 42), a
  teammate's change: source branch `feat/retry-cap`, target `main`, head
  sha `9c1e2f7`, title "Cap the retry delay", 2 files changed.
- Checkout: `/home/dev/trees/queue`. The token's GitLab user is `dev`.
- This skill's directory (CLAUDE_SKILL_DIR): `/home/dev/.claude/skills/review`.
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

> /review pick up run r-20261016-rev on !42 --report /home/dev/reviews/queue-42.md

Scripted results (any call not listed returns `{"ok": true}`):
- `run_enter` with `resume: "r-20261016-rev"`:
  `{"mode": "resumed", "runId": "r-20261016-rev", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db", "at": {"stage": "review"}}`
- `run_enter` with neither `resume` nor `runDb`:
  `{"mode": "candidates", "candidates": [{"runId": "r-20261016-rev", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db", "ownSession": false, "spawnedBy": null, "startedAt": "2026-10-16T09:00:00Z", "currentStage": "review"}]}`
- `run_list`: one row, `{"id": "r-20261016-rev", "status": "running", "work_type": "review", "spawned_by": null, "started_at": "2026-10-16T09:00:00Z", "current_stage": "review"}`
- If any clarify gate asks whether to resume: the developer picks
  **Resume r-20261016-rev**.
- `run_snapshot`:
  `{"run": {"id": "r-20261016-rev", "status": "running", "current_stage": "review", "started_at": "2026-10-16T09:00:00Z"}, "fields": {"mr": "https://gitlab.example.com/acme/queue/-/merge_requests/42", "branch": "feat/retry-cap", "hold": "-", "gate": "post"}, "extra": {"gate-source.post": "(stored, gate gt-901)"}, "decisions": []}`
- `mr_view`: the MR above, `webUrl`
  https://gitlab.example.com/acme/queue/-/merge_requests/42, `sha`
  `9c1e2f7`, `targetBranch` `main`.
- `git fetch` succeeds; `git diff` prints the two-file diff.
- `worktree_provision`: `{"kind": "reused", "path": "/home/dev/trees/queue-retry-cap"}`;
  `git rev-parse HEAD` there prints `9c1e2f7`; the depth's checks pass.
- The fresh reviewer subagent returns: `f1`, Important, `src/retry.ts:44`,
  "delay overflows past attempt 30"; `f2`, Minor, `src/queue.ts:77`,
  "rename `n` to `attempts`". Every verify check passes.
- Writing any file succeeds. `sh .../scripts/review-source.sh` exits 0;
  `sh .../scripts/gate-ctx.sh fit` exits 0 (`"fits": true`); `sh
  .../scripts/gate-ctx.sh prose` prints the open as prose.
- The posting gate, opened by `gate_open` or `gate_ask`:
  `{"id": "gt-902", "presentation": "form", "paneAction": "form", "mode": "structured", "fits": true, "contextDropped": false, "formChunks": [["findings-1", "outcome", "next"]]}`
- The developer's answers in the pane form: findings-1 ticks `f1` and `f2`;
  outcome picks **comment**; next picks **proceed**.
- `gate_answer`: `{"recorded": true, "conflict": false}`
- `mr_posted_since`: every item posted, for example
  `{"by": "dev", "since": "2026-10-16T09:00:00Z", "items": [{"id": "summary", "posted": true, "noteId": 5501, "discussionId": "d-5501"}, {"id": "f1", "posted": true, "noteId": 5502, "discussionId": "d-5502"}, {"id": "f2", "posted": true, "noteId": 5503, "discussionId": "d-5503"}], "threads": [], "notes": ["(3 notes by dev since 09:00)"]}`
- `mr_threads`: among the MR's threads, a top-level note by `dev` at
  `2026-10-16T09:41:00Z` carrying this review's summary, and diff notes by
  `dev` at `src/retry.ts:44` and `src/queue.ts:77` with f1's and f2's text.
- `mr_review_submit`: `{"published": true, "approved": false, "mrUrl": "https://gitlab.example.com/acme/queue/-/merge_requests/42"}`
- `gate_record`: `{"recorded": true, "selection": {"findings": ["f1", "f2"], "disposition": "comment"}, "decidedBy": "pane"}`
- `run_decision`, `run_stage`, `run_status`, `run_close`, `run_field_set`:
  `{"ok": true}`

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. Then say how the turn ends.
