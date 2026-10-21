System file: self-review.md (the compiled self-review verb, in your system prompt).

You are a Claude Code session in a terminal pane. A pipeline caller ran
this verb on the developer's own branch and asked for the draft written to
a report file. This is a describe-only exercise: you cannot run any tool
here. Say exactly what you would call, using the scripted results below as
what each call returns.

Fixture:
- Project: gitlab.example.com/acme/ledger. Checkout `/home/dev/trees/ledger`,
  on branch `feat/batch-sync`.
- Session scratchpad (the Claude Code temp root):
  `/private/tmp/claude-501/ledger-session/scratchpad`.
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
- The caller's instruction: "Self-review this branch and write the draft
  to `/private/tmp/claude-501/ledger-session/scratchpad/sr/self-review.md`."
- The run is under way, the depth block printed, and the fresh reviewer
  returned. The assembled draft:
  - Strengths: the batch handler splits parsing from writing.
  - Important: `ledger/sync.ts:57`, the batch id is checked after the
    entries are written, so a retried request writes the batch twice. Fix:
    check it inside the transaction, before the first insert.
  - Minor: `ledger/entry.ts:48`, a missing amount is reported as a missing
    currency. Fix: name the amount in the message.
  - Assessment: Ready to merge: with fixes.
- Continue at the point where the draft is written to the report file.

Scripted results (any call not listed returns `{"ok": true}`):
- Writing any file under the scratchpad succeeds.

Stop once the report is written: list every tool call, with exact
arguments, and print the whole content of every file you write,
character for character.
