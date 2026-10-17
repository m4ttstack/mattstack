System file: receive-review.md (the compiled receive-review verb, in your system prompt).

You are a Claude Code session in a terminal pane, partway through a
receive-review turn the developer typed by hand (no board or other surface
launched this pane). This is a describe-only exercise: you cannot run any
tool here. Say exactly what you would call, using the scripted results
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

Where the turn stands:
- The run is this verb's own, started earlier in this conversation:
  `r-20261016-rev`, runDb
  `/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db`, stage
  `receive-review`. Its `mr` and `branch` fields are set.
- Gate respond-plan (`gt-701`) was answered in this pane and is recorded on
  the run: T1 (`src/retry.ts:18`) reply with the note "softer", so an
  override; T2 (`src/retry.ts:31`) fix; code-changes approve.
- The row walk is done: T2's fix is committed as `4f2a9c1`, Fixed reply
  "Fixed: `src/retry.ts:31` now caps the delay at 30s."; T1's override is
  redrafted as "The jitter stays: the tests seed it with a fixed RNG
  (`retry.test.ts:12`), so they are deterministic."
- Nothing has been pushed or posted yet. Continue from the step after the
  row walk.

Scripted results (any call not listed returns `{"ok": true}`):
- `mr_threads` (any arguments): T1 and T2, unresolved, each with only the
  reviewer's opening note; nothing by this account.
- Writing any file under the scratchpad succeeds. `sh .../scripts/gate-ctx.sh
  fit` exits 0 (`"fits": true`); `sh .../scripts/gate-ctx.sh prose` prints
  the open with every context as prose.
- The first respond-post gate, opened by `gate_open` or `gate_ask`:
  `{"id": "gt-702", "presentation": "form", "paneAction": "form", "mode": "structured", "fits": true, "contextDropped": false, "formChunks": [["thread-1", "thread-2", "next"]]}`
- The developer's answers to it: Thread 1 ticks **post**; Thread 2 ticks
  **post** and **resolve**; Next picks **Iterate here** and types "make the
  T1 reply one sentence".
- The next respond-post gate opened after that:
  `{"id": "gt-703", "presentation": "form", "paneAction": "form", "mode": "structured", "fits": true, "contextDropped": false, "formChunks": [["thread-1", "thread-2", "next"]]}`
- The developer's answers to it: Thread 1 ticks **post**; Thread 2 ticks
  **post** and **resolve**; Next picks **Proceed**.
- `gate_answer`: `{"recorded": true, "conflict": false}`
- `gate_record` with `gateId: "gt-702"`: refused, "stale gate: the
  respond-post source names gt-703". With `gateId: "gt-703"`:
  `{"recorded": true, "selection": {"threads": {"T1": {"post": true, "resolve": false}, "T2": {"post": true, "resolve": true}}}, "decidedBy": "pane"}`
- `respond_post_execute`:
  `{"mr": "https://gitlab.example.com/acme/queue/-/merge_requests/42", "pushed": true, "posted": ["T1", "T2"], "alreadyPosted": [], "resolved": ["T2"], "alreadyResolved": [], "held": [], "recorded": true, "hold": null}`
- `git branch --show-current` prints `fix/retry-backoff`; `git rev-parse
  --abbrev-ref @{push}` prints `origin/fix/retry-backoff`.
- `git_push`: `{"pushed": true, "branch": "fix/retry-backoff"}`
- `mr_reply_thread`: `{"posted": true}`; `mr_resolve_thread`:
  `{"resolved": true}`
- `run_decision`, `run_field_set`, `run_close`, `run_stage`, `run_status`:
  `{"ok": true}`

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. Then say how the turn ends.
