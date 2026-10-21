System file: review.md (the compiled review verb, in your system prompt).

You are a Claude Code session in a terminal pane, partway through a review
turn the developer typed by hand (no board or other surface launched this
pane, no caller owns the gates, and no caller handed a decided selection).
This is a describe-only exercise: you cannot run any tool here. Say exactly
what you would call, using the scripted results below as what each call
returns. Never post to a real MR or PR: this is a fixture.

Fixture:
- Project: gitlab.example.com/acme/ledger. The MR under review is
  https://gitlab.example.com/acme/ledger/-/merge_requests/42 (iid 42), a
  teammate's change: source branch `feat/export-paging`, target `main`, head
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
- The developer typed `/review !42`. The run is this verb's own, started
  earlier in this conversation (its first pass): `r-20261020-exp`, runDb
  `/home/dev/.mattstack/runs/ledger/r-20261020-exp/state.db`, stage
  `review`. Its `mr` and `branch` fields are set.
- The writing style is loaded (`mattstack:writing-style-conversational`).
- Depth was verify; nothing blocking was found.
- The report and its json sibling are written:
  `/private/tmp/claude-501/ledger-session/scratchpad/rv-42/review-42.md` and
  `/private/tmp/claude-501/ledger-session/scratchpad/rv-42/review-42.json`.
  The json reads, exactly:

```json
{
  "version": 3,
  "summary": {
    "readiness": "yes",
    "reasoning": "the paging change is sound and tested; the three notes are polish.",
    "comments": {
      "comment": "Thanks for this, the export paging reads cleanly and the restart test covers the case I was worried about. I left three small notes, all about polish rather than correctness. I'll leave the merge call to you.",
      "approve": "Thanks for this, the export paging reads cleanly and the restart test covers the case I was worried about. I left three small notes and none of them need to hold this up. Approving, this is ready to merge."
    }
  },
  "findings": [
    {
      "id": "f1",
      "tier": "Minor",
      "kind": "suggestion",
      "title": "the page size is hardcoded",
      "body": "the export pages by 500 rows, a literal in the loop, while the import job reads its batch size from config.",
      "file": "jobs/export.ts",
      "line": 74,
      "fix": "read the page size from the existing jobs config",
      "disposition": "new",
      "comment": "Small one: the page size of 500 on line 74 is a literal, while the import job reads its batch size from config. Could the export read it from the same jobs config? That way ops can tune both from one place."
    },
    {
      "id": "f2",
      "tier": "Minor",
      "kind": "nitpick",
      "title": "the decline log prints the full card number",
      "body": "the debug line on a declined charge interpolates the whole request, card number included.",
      "file": "ledger/charge.ts",
      "line": 140,
      "fix": "log the last four digits with util/mask.ts",
      "disposition": "new",
      "comment": "The debug line on a declined charge logs the whole request, card number included. Could it use the mask helper in util/mask.ts so only the last four digits land in the logs?"
    },
    {
      "id": "f3",
      "tier": "Minor",
      "kind": "thought",
      "title": "the progress log never names the last id",
      "body": "the export logs a page count but not the last id it wrote, so a restart after a crash has to scan from the start to find its place.",
      "fileLabel": "not inline-anchorable",
      "fix": "log the last id of each page",
      "disposition": "new",
      "comment": "One thought that spans the worker and the logger: the progress log counts pages but never prints the last id written. Logging it per page would let a restart pick up where it stopped instead of scanning from the start."
    }
  ]
}
```

- The severity line is presented: "Findings: Minor (3); 3 findings."
  Continue from the step after the report is written.

Scripted results (any call not listed returns `{"ok": true}`):
- Writing any file under the scratchpad succeeds.
- `gate_open`: `{"id": "gt-942", "paneAction": "form", "mode": "structured", "fits": true, "contextDropped": false, "formContext": "Review of !42", "formChunks": [["findings-1"], ["outcome", "next"]]}`
- The first AskUserQuestion call comes back dismissed: another surface (the
  board) answered. The doorbell arrives at once as your next input.
- `gate_reconcile`: `{"status": "answered", "decidedBy": "board", "answers": {"findings-1": {"value": ["f1", "f2", "f3"]}, "outcome": {"value": "approve"}, "next": "proceed"}}`
- `mr_review_submit`:
  `{"published": true, "approved": true, "mrUrl": "https://gitlab.example.com/acme/ledger/-/merge_requests/42"}`
- `gate_record`: `{"recorded": true}`
- `run_decision`, `run_stage`, `run_status`, `run_close`, `run_field_set`:
  `{"ok": true}`

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. For `mr_review_submit` or `gh pr review`, print the whole payload: every comment `body` and the `summary` (or the review body) in full, character for character, never abbreviated or elided. For every file you write, print its whole content. Then say how the turn ends.
