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
  `/review !42 --report /private/tmp/claude-501/queue-session/scratchpad/rv-42/review-42.md`.
- The run is this verb's own, started earlier in this conversation:
  `r-20261016-rev`, runDb
  `/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db`, stage
  `review`. Its `mr`, `branch` fields are set.
- The verified report is written at
  `/private/tmp/claude-501/queue-session/scratchpad/rv-42/review-42.md`,
  json sibling
  `/private/tmp/claude-501/queue-session/scratchpad/rv-42/review-42.json`
  (findings `f1` Important `src/retry.ts:44`, `f2` Minor `src/queue.ts:77`;
  readiness `with-fixes`; no threads, nothing skipped).
- The severity line is presented: "Findings: Important (1), Minor (1); 2
  findings." Continue from the step after the report is written.

Scripted results (any call not listed returns `{"ok": true}`):
- Writing any file under the scratchpad succeeds.
- `gate_open`, first call: refused, nothing opened, problems
  `["extras.questions[0].options[1].description: empty"]`. Second call
  (after any change): refused, nothing opened, problems
  `["extras.questions[0].label: over 200 bytes"]`. Every later call: the
  same refusal as the second.
- `sh .../scripts/review-source.sh`, first run: exits 1,
  `extras.questions[0].options[1].description: empty`. Second run (after
  any change): exits 1, `extras.questions[0].label: over 200 bytes`. Every
  later run: the same as the second. `sh .../scripts/gate-ctx.sh fit` is
  never reached while review-source.sh exits 1.
- `run_budget` returns `{"key": <key>, "limit": <limit>, "spent": <n>, "remaining": <limit minus n, not below 0>, "exhausted": <n >= limit>}`,
  where `n` is the key's count after this call: each call adds its
  `increment` (default 1), starting from 0.
- Any off-script gate, opened by `gate_ask`:
  `{"id": "gt-950", "presentation": "form", "paneAction": "form"}`. The
  developer answers it: action **Take the proposed move**, next **Hold**,
  typing "I'll look at the extras myself".
- `gate_answer`: `{"recorded": true, "conflict": false}`
- `run_hold`: `{"ok": true, "decision": "hold:review:1"}`
- `run_decision`, `run_field_set`, `run_stage`, `run_status`, `run_close`:
  `{"ok": true}`

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. Then say how the turn ends.
