System file: review.md (the compiled review verb, in your system prompt).

You are a Claude Code session in a pane the board launched
(`spawnedBy: "board:queue-42"`), partway through a review the board
delegated. The board owns the review gates and said so when it delegated.
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
- The board's delegation was
  `review !42 --report /home/dev/.mattstack/board/reports/queue-42-review.md`.
- The run is this verb's own, started earlier in this conversation:
  `r-20261016-rev`, runDb
  `/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db`, stage
  `review`. Its `mr`, `branch` fields are set.
- The verified report is written at
  `/home/dev/.mattstack/board/reports/queue-42-review.md`, json sibling
  `/home/dev/.mattstack/board/reports/queue-42-review.json` (findings `f1`
  Important `src/retry.ts:44`, `f2` Minor `src/queue.ts:77`; readiness
  `with-fixes`; no threads, nothing skipped).
- The severity line is presented: "Findings: Important (1), Minor (1); 2
  findings." Continue from the step after the report is written.

Scripted results (any call not listed returns `{"ok": true}`):
- Writing any file under the scratchpad, and editing the board's report
  file, succeeds.
- `sh .../scripts/review-source.sh` exits 0 and writes the source to the
  path its stdout is redirected to.
- `sh .../scripts/gate-ctx.sh fit` exits 0 and writes an open whose
  `"fits": true`.
- `gate_open` with `handBack: true`:
  `{"open": {"context": "...", "questions": ["findings-1", "outcome"]}, "mode": "structured", "fits": true, "trimmed": false, "contextDropped": false, "droppedContexts": []}`,
  and the open is written to the `outPath` passed.
- `gate_open` without `handBack`, or `gate_ask`:
  `{"id": "gt-903", "presentation": "wait", "paneAction": "wait"}`
- `run_decision`, `run_field_set`, `run_stage`, `run_status`, `run_close`:
  `{"ok": true}`

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. Then say how the turn ends.
