System file: review.md (the compiled review verb, in your system prompt).

You are a Claude Code session in a terminal pane, partway through a review
turn the developer typed by hand (no board or other surface launched this
pane, no caller owns the gates, and no caller handed a decided selection).
This is a describe-only exercise: you cannot run any tool here. Say exactly
what you would call, using the scripted results below as what each call
returns. Never post to a real MR or PR: this is a fixture.

Fixture:
- Project: github.com/acme/ledger. The PR under review is
  https://github.com/acme/ledger/pull/42 (#42), a
  teammate's change: head branch `feat/export-paging`, base `main`, head
  sha `9c41b07`.
- Checkout: `/home/dev/trees/ledger`.
- This skill's directory (CLAUDE_SKILL_DIR): `/home/dev/.claude/skills/review`.
- Session scratchpad (the Claude Code temp root):
  `/private/tmp/claude-501/ledger-session/scratchpad`; this review's scratch
  directory is `/private/tmp/claude-501/ledger-session/scratchpad/rv-42/`.
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
- The developer typed `/review https://github.com/acme/ledger/pull/42 --report /private/tmp/claude-501/ledger-session/scratchpad/rv-42/review-42.md`.
  The run is this verb's own, started earlier in this conversation (its
  first pass): `r-20261020-exp`, runDb
  `/home/dev/.mattstack/runs/ledger/r-20261020-exp/state.db`, stage
  `review`. Its `mr` and `branch` fields are set.
- Depth was verify. The assembled draft, after verification:
  - Strengths: the export now pages by id in short transactions
    (`jobs/export.ts:60-90`), and the new restart test covers a crash
    mid-page.
  - Minor: `jobs/export.ts:74`, the page size of 500 is a literal while
    the import job reads its batch size from config. Fix: read it from the
    jobs config.
  - Minor: `ledger/charge.ts:140`, the debug line on a declined charge
    logs the whole request, card number included. Fix: log the last four
    digits with `util/mask.ts`.
  - Minor: no single file, the progress log counts pages but never the
    last id written, so a restart scans from the start. Fix: log the last
    id of each page.
  - Assessment: Ready to merge: yes. Nothing blocks; the three notes are
    polish.
- Nothing about a writing style has happened yet in this conversation.
  Continue at the step that writes the review report and its json sibling.

Scripted results (any call not listed returns `{"ok": true}`):
- `rt_verb {"args": ["skills", "writing-style", "show"]}`: `{"skill": "mattstack:writing-style-conversational"}`.
  The skill loads; its voice is short, friendly sentences in sentence case,
  like talking to a teammate.
- Writing any file under the scratchpad succeeds.
- `gate_open`: `{"id": "gt-943", "paneAction": "form", "mode": "structured", "fits": true, "contextDropped": false, "formContext": "Review of #42", "formChunks": [["findings-1", "outcome", "next"]]}`

Stop when the posting gate's form is about to be presented: list every
tool call up to and including `gate_open`, with exact arguments, and print
the whole content of every file you write (the report, its json sibling
and any extras file), character for character.
