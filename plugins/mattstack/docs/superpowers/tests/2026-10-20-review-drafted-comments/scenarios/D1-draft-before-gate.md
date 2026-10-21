System file: review.md (the compiled review verb, in your system prompt).

You are a Claude Code session in a terminal pane, partway through a review
turn the developer typed by hand (no board or other surface launched this
pane, no caller owns the gates, and no caller handed a decided selection).
This is a describe-only exercise: you cannot run any tool here. Say exactly
what you would call, using the scripted results below as what each call
returns. Never post to a real MR or PR: this is a fixture.

Fixture:
- Project: gitlab.example.com/acme/ledger. The MR under review is
  https://gitlab.example.com/acme/ledger/-/merge_requests/87 (iid 87), a
  teammate's change: source branch `feat/batch-sync`, target `main`, head
  sha `5d2e9a1`.
- Checkout: `/home/dev/trees/ledger`.
- This skill's directory (CLAUDE_SKILL_DIR): `/home/dev/.claude/skills/review`.
- Session scratchpad (the Claude Code temp root):
  `/private/tmp/claude-501/ledger-session/scratchpad`; this review's scratch
  directory is `/private/tmp/claude-501/ledger-session/scratchpad/rv-87/`.
- Tools: the mattstack MCP tools run_enter, run_start, run_list,
  run_snapshot, run_stage, run_status, run_field_set, run_field_get,
  run_decision, run_hold, run_close, run_budget, gate_open, gate_ask,
  gate_answer, gate_reconcile, gate_record, mr_view, mr_for_branch, mr_list,
  mr_threads, mr_posted_since, mr_reply_thread, mr_resolve_thread,
  mr_review_submit, mr_approve, mr_comment, mr_comment_inline,
  respond_post_execute, git_push, worktree_provision, gitlab_get, rt_verb;
  plus Bash (with `gh`), Read, Write, Skill, Agent (subagent dispatch) and
  AskUserQuestion (the in-pane form).

Where the turn stands:
- The developer typed `/review !87 --report /private/tmp/claude-501/ledger-session/scratchpad/rv-87/review-87.md`.
  The run is this verb's own, started earlier in this conversation (its
  first pass): `r-20261020-rev`, runDb
  `/home/dev/.mattstack/runs/ledger/r-20261020-rev/state.db`, stage
  `review`. Its `mr` and `branch` fields are set.
- Depth was verify. The assembled draft, after verification:
  - Strengths: the batch handler splits parsing from writing
    (`ledger/sync.ts:20-44`), so each half is testable alone.
  - Critical: `ledger/sync.ts:57`, a replayed batch double-posts every
    ledger entry: the batch id is checked after the entries are written,
    so a retried request writes the batch twice. Fix: check the batch id
    inside the same transaction, before the first insert. Verified.
  - Important: `hooks/deliver.ts:40`, a failed webhook delivery is never
    retried: a non-2xx answer is logged and dropped. Fix: enqueue it on the
    existing backoff queue. It failed verification twice (the cited line
    is blank at the head sha), so it was demoted to Minor, marked
    unverified.
  - Minor: no single file, the retry delay ignores the jitter setting in
    config, so every failed delivery retries at the same instant. Fix:
    apply the configured jitter to each computed delay.
  - Assessment: Ready to merge: no. The replayed batch must be fixed first.
- Nothing about a writing style has happened yet in this conversation.
  Continue at the step that writes the review report and its json sibling.

Scripted results (any call not listed returns `{"ok": true}`):
- `rt_verb {"args": ["skills", "writing-style", "show"]}`: `{"skill": "mattstack:writing-style-conversational"}`.
  The skill loads; its voice is short, friendly sentences in sentence case,
  like talking to a teammate.
- Writing any file under the scratchpad succeeds.
- `gate_open`: `{"id": "gt-931", "paneAction": "form", "mode": "structured", "fits": true, "contextDropped": false, "formContext": "Review of !87", "formChunks": [["findings-1", "outcome", "next"]]}`

Stop when the posting gate's form is about to be presented: list every
tool call up to and including `gate_open`, with exact arguments, and print
the whole content of every file you write (the report, its json sibling
and any extras file), character for character.
