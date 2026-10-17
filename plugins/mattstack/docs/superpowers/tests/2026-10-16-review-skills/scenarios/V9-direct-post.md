System file: review.md (the compiled review verb, in your system prompt).

You are a Claude Code session in a terminal pane, partway through a review
turn the developer typed by hand (no board or other surface launched this
pane, no caller owns the gates, and no caller handed a decided selection).
This is a describe-only exercise: you cannot run any tool here. Say exactly
what you would call, using the scripted results below as what each call
returns.

Fixture:
- Project: gitlab.example.com/acme/queue. The MR under review is
  https://gitlab.example.com/acme/queue/-/merge_requests/42 (iid 42), a
  teammate's change: source branch `feat/retry-cap`, target `main`, head
  sha `9c1e2f7`.
- Checkout: `/home/dev/trees/queue`.
- This skill's directory (CLAUDE_SKILL_DIR): `/home/dev/.claude/skills/review`.
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

Where the turn stands:
- The developer typed
  `/review re-review !42, round 2, --report /private/tmp/claude-501/queue-session/scratchpad/rv-42/review-42.md`
  and handed in one earlier thread, D1 (`src/retry.ts:18`).
- The run is this verb's own, started earlier in this conversation (its
  first pass): `r-20261016-rev`, runDb
  `/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db`, stage
  `review`, `started_at` `2026-10-16T09:00:00Z`. Its `mr`, `branch` fields
  are set.
- Depth was verify; the fresh reviewer's findings are verified. The report
  is written at
  `/private/tmp/claude-501/queue-session/scratchpad/rv-42/review-42.md`,
  with its json sibling
  `/private/tmp/claude-501/queue-session/scratchpad/rv-42/review-42.json`:
  - finding `f1`, Important, `src/retry.ts:44`: "delay overflows past
    attempt 30";
  - finding `f2`, Minor, `src/queue.ts:77`: "rename `n` to `attempts`";
  - summary readiness `with-fixes`;
  - threads: `D1`, call `addressed`, reply "The cap at 30s in
    `computeDelay` covers this."
- The severity line is presented: "Findings: Important (1), Minor (1); 2
  findings." Continue from the step after the report is written.

Scripted results (any call not listed returns `{"ok": true}`):
- Writing any file under the scratchpad succeeds.
- `sh .../scripts/review-source.sh` exits 0; `sh .../scripts/gate-ctx.sh
  fit` exits 0 (`"fits": true`); `sh .../scripts/gate-ctx.sh prose` prints
  the open with every context as prose.
- The posting gate, opened by `gate_open` or `gate_ask`:
  `{"id": "gt-901", "presentation": "form", "paneAction": "form", "mode": "structured", "fits": true, "contextDropped": false, "formContext": "Re-review of !42, round 2", "formChunks": [["thread-1", "findings-1", "outcome", "next"]]}`
- The developer's answers in the pane form: thread-1 ticks **post** (value
  `post:D1`); findings-1 ticks `f1` and `f2`; outcome picks **approve**;
  next picks **proceed**.
- `gate_answer`: `{"recorded": true, "conflict": false}`
- `mr_threads`, `mr_posted_since`: nothing from this review is on the MR.
- `mr_review_submit`:
  `{"published": true, "approved": true, "mrUrl": "https://gitlab.example.com/acme/queue/-/merge_requests/42"}`
- `gate_record`:
  `{"recorded": true, "selection": {"findings": ["f1", "f2"], "disposition": "approve", "replies": [{"discussionId": "D1", "body": "The cap at 30s in `computeDelay` covers this."}]}, "decidedBy": "pane"}`
- `run_decision`, `run_stage`, `run_status`, `run_close`, `run_field_set`:
  `{"ok": true}`

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. Then say how the turn ends.
