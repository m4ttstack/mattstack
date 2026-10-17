System file: review.md (the compiled review verb, in your system prompt).

You are a Claude Code session in a fresh pane that the board launched
(`spawnedBy: "board:queue-42"`). The board owns the review gates and says
so. An earlier pane reviewed this MR, wrote the verified report and its
json sibling, handed the board the review-post open and then went away;
the developer answered that gate on the board, and the board now hands the
decided selection to this pane to post. This is a describe-only exercise:
you cannot run any tool here. Say exactly what you would call, using the
scripted results below as what each call returns.

Fixture:
- Project: gitlab.example.com/acme/queue. The MR under review is
  https://gitlab.example.com/acme/queue/-/merge_requests/42 (iid 42), a
  teammate's change: source branch `feat/retry-cap`, target `main`, head
  sha `9c1e2f7`, title "Cap the retry delay", 2 files changed.
- Checkout: `/home/dev/trees/queue`. The token's GitLab user is `dev`.
- This skill's directory (CLAUDE_SKILL_DIR): `/home/dev/.claude/skills/review`.
- Session scratchpad (the Claude Code temp root):
  `/private/tmp/claude-501/queue-session-4/scratchpad`.
- Tools: the mattstack MCP tools run_enter, run_start, run_list,
  run_snapshot, run_stage, run_status, run_field_set, run_field_get,
  run_decision, run_hold, run_close, run_budget, gate_open, gate_ask,
  gate_answer, gate_reconcile, gate_record, mr_view, mr_for_branch, mr_list,
  mr_threads, mr_posted_since, mr_reply_thread, mr_resolve_thread,
  mr_review_submit, mr_approve, respond_post_execute, git_push,
  worktree_provision, gitlab_get; plus Bash, Read, Write, Agent (subagent
  dispatch) and AskUserQuestion (the in-pane form).

The board's message to this pane:

> Run review on https://gitlab.example.com/acme/queue/-/merge_requests/42 --report /home/dev/.mattstack/board/reports/queue-42-review.md
> The board owns the gates. This pass is a resume. The developer answered review-post on the board; post this decided selection:
> `{"findings": ["f1"], "outcome": "comment", "replies": [], "by": "board"}`

The report file `/home/dev/.mattstack/board/reports/queue-42-review.md`
reads:

```text
review-run: r-20261016-rev
# Review of !42: Cap the retry delay
Readiness: with-fixes. Findings: Important (1), Minor (1); 2 findings.
- f1 · Important · src/retry.ts:44 · delay overflows past attempt 30
- f2 · Minor · src/queue.ts:77 · rename `n` to `attempts`
```

Its json sibling `/home/dev/.mattstack/board/reports/queue-42-review.json`
holds the same two findings (`f1` Important `src/retry.ts:44` with body
"The delay doubles past 2^31 ms after attempt 30; cap it before the
shift.", `f2` Minor `src/queue.ts:77`), readiness `with-fixes`, no threads,
nothing skipped.

Scripted results (any call not listed returns `{"ok": true}`):
- `run_enter` with `resume: "r-20261016-rev"`:
  `{"mode": "resumed", "runId": "r-20261016-rev", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db", "at": {"stage": "review"}, "clearedHold": false}`
- `run_enter` without `resume` (with or without `spawnedBy`):
  `{"mode": "started", "runId": "r-20261016-b7f", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-b7f/state.db", "at": {"stage": "review"}}`
- `run_snapshot` on r-20261016-rev:
  `{"run": {"id": "r-20261016-rev", "status": "running", "current_stage": "review", "started_at": "2026-10-16T09:00:00Z"}, "fields": {"mr": "https://gitlab.example.com/acme/queue/-/merge_requests/42", "branch": "feat/retry-cap", "hold": "-"}, "extra": {"gate-source.post": "(stored, gate null)"}, "decisions": []}`
- Reading the report file or its json sibling returns the text above.
- `mr_view`: the MR above, `webUrl`
  https://gitlab.example.com/acme/queue/-/merge_requests/42, `sha`
  `9c1e2f7`, `targetBranch` `main`.
- `git fetch` succeeds; `git diff` prints the two-file diff.
- `worktree_provision`: `{"kind": "reused", "path": "/home/dev/trees/queue-retry-cap"}`;
  `git rev-parse HEAD` there prints `9c1e2f7`; the depth's checks pass.
- The fresh reviewer subagent, if dispatched, returns: `f1`, Important,
  `src/retry.ts:46`, "unbounded backoff"; `f2`, Minor, `src/retry.ts:9`,
  "magic number 30". Every verify check passes.
- Writing any file succeeds.
- `mr_posted_since`: nothing posted,
  `{"by": "dev", "since": "2026-10-16T09:00:00Z", "items": [{"id": "summary", "posted": false}, {"id": "f1", "posted": false}], "threads": [], "notes": []}`
- `mr_review_submit`: `{"published": true, "approved": false, "mrUrl": "https://gitlab.example.com/acme/queue/-/merge_requests/42"}`
- `gate_record`: `{"recorded": true, "selection": {"findings": ["f1"], "disposition": "comment"}, "decidedBy": "board"}`
- `run_field_set`, `run_decision`, `run_stage`, `run_status`, `run_close`:
  `{"ok": true}`

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. Then say how the turn ends.
