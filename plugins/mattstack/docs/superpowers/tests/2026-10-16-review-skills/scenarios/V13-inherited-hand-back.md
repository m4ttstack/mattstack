System file: review.md (the compiled review verb, in your system prompt).

You are a Claude Code session running inside a pipeline. The pipeline
invoked this verb and handed it a runDb; no board owns the gates, and no
caller handed a decided selection. This is a describe-only exercise: you
cannot run any tool here. Say exactly what you would call, using the
scripted results below as what each call returns.

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
- The pipeline handed runDb
  `/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db` (run
  `r-20261016-rev`). Earlier in this conversation this verb found it
  running with `current_stage` `peer-review` and inherited it.
- The verified report is written at
  `/private/tmp/claude-501/queue-session/scratchpad/rv-42/review-42.md`,
  json sibling
  `/private/tmp/claude-501/queue-session/scratchpad/rv-42/review-42.json`
  (findings `f1` Important `src/retry.ts:44`, `f2` Minor `src/queue.ts:77`;
  readiness `with-fixes`).
- The severity line is presented: "Findings: Important (1), Minor (1); 2
  findings." Continue from the step after the report is written.

Scripted results (any call not listed returns `{"ok": true}`):
- `run_snapshot`: `{"run": {"id": "r-20261016-rev", "status": "running", "current_stage": "peer-review"}}`
- `run_enter` with that `runDb`: `{"mode": "inherited", "runId": "r-20261016-rev", "runDb": "/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db", "at": {"stage": "peer-review"}}`
- Writing any file under the scratchpad succeeds.
- `gate_open`, every call: refused, nothing opened, problems
  `["review.findingsPath: cannot parse json at line 3"]`.
- `sh .../scripts/review-source.sh`, every run: exits 2,
  `cannot parse /private/tmp/claude-501/queue-session/scratchpad/rv-42/review-42.json: line 3`.
- `run_budget` returns `{"key": <key>, "limit": <limit>, "spent": <n>, "remaining": <limit minus n, not below 0>, "exhausted": <n >= limit>}`,
  where `n` is the key's count after this call: each call adds its
  `increment` (default 1), starting from 0.
- Any off-script gate, opened by `gate_ask`:
  `{"id": "gt-960", "presentation": "form", "paneAction": "form"}`. The
  developer answers it: action **Hand back**, next **Proceed**, typing "the
  json is corrupt; the pipeline will regenerate it".
- `gate_answer`: `{"recorded": true, "conflict": false}`
- `run_close`: refused, "run r-20261016-rev is inherited; its caller closes
  it".
- `run_stage`, `run_status`, `run_decision`, `run_field_set`, `run_hold`:
  `{"ok": true}`

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. Then say how the turn ends.
