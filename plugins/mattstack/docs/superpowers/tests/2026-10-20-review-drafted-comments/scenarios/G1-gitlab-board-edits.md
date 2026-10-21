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
- The developer typed `/review !87`. The run is this verb's own, started
  earlier in this conversation (its first pass): `r-20261020-rev`, runDb
  `/home/dev/.mattstack/runs/ledger/r-20261020-rev/state.db`, stage
  `review`. Its `mr` and `branch` fields are set.
- The writing style is loaded (`mattstack:writing-style-conversational`).
- Depth was verify; every blocking finding verified.
- The report and its json sibling are written:
  `/private/tmp/claude-501/ledger-session/scratchpad/rv-87/review-87.md` and
  `/private/tmp/claude-501/ledger-session/scratchpad/rv-87/review-87.json`.
  The json reads, exactly:

```json
{
  "version": 3,
  "summary": {
    "readiness": "no",
    "reasoning": "the batch path can double-post and refunds race charges; both need a fix before this merges.",
    "comments": {
      "comment": "Thanks for this, the batch endpoint reads much more clearly than the old sync path. I left twelve notes. The two at the top matter most: a retried batch can post twice, and refunds skip the balance lock that charges take, so the two can race. The rest are smaller and some could be follow ups. Happy to look again as soon as the first two are in.",
      "approve": "Thanks for this, the batch endpoint reads much more clearly than the old sync path. I left twelve notes and none of them block: the double-post and the refund race are worth a quick follow up, and the rest are small. Approving, this is ready to merge."
    }
  },
  "findings": [
    {
      "id": "d1",
      "tier": "Critical",
      "title": "a replayed batch double-posts every ledger entry",
      "body": "the batch id is checked after the entries are written, so a retried request from the mobile client writes the whole batch a second time before the duplicate check can refuse it. Two of the sample batches in the fixture already show doubled totals.",
      "file": "ledger/sync.ts",
      "line": 57,
      "fix": "check the batch id inside the same transaction, before the first insert",
      "disposition": "new",
      "comment": "Hi! I think a retried batch can land twice here. The duplicate check on line 57 runs after the inserts, so when the mobile client retries after a timeout the second request writes every entry again and only then sees the batch id. Could we move the check into the transaction ahead of the first insert? A small test that sends the same batch twice and asserts one set of rows would pin it down. Happy to pair on the test if that helps, since the transaction helper has a few quirks around nested savepoints that took me a while to read through."
    },
    {
      "id": "d2",
      "tier": "Critical",
      "title": "the refund path skips the balance lock",
      "body": "refunds read the balance, compute the new value and write it back without taking the row lock the charge path takes, so a refund racing a charge on the same account can lose one of the two updates.",
      "file": "ledger/refund.ts",
      "line": 112,
      "fix": "take the same account row lock the charge path uses before reading the balance",
      "disposition": "new",
      "comment": "The refund path reads and writes the balance without the row lock that charges take on line 88 of charge.ts. If a refund and a charge hit the same account at once, one of the two writes can be lost and the balance drifts with nothing in the logs to show it. Could refunds take the same lock before they read? I tried it locally with two parallel requests against the dev database and saw the drift about one time in twenty, so it is rare but real. Reusing the existing lock helper should keep the change small and the ordering consistent across both paths."
    },
    {
      "id": "d3",
      "tier": "Important",
      "title": "the currency code is trusted from the request body",
      "body": "the handler copies the currency field from the request straight into the entry, so a client can post an entry in a currency the account does not hold and the nightly report sums it with the wrong rate.",
      "file": "ledger/entry.ts",
      "line": 31,
      "fix": "read the currency from the account record and reject a request that disagrees",
      "disposition": "new",
      "comment": "Small one, but it could bite the nightly report: the currency on line 31 comes straight from the request body. A client that sends a different code than the account holds gets an entry that the report then sums at the wrong rate. Would it work to read the currency from the account record and reject a mismatch with a clear error? That also gives the client team a precise message to show instead of a silent wrong total. I checked the existing account fetch and it already loads the currency, so there should be no extra query needed for this."
    },
    {
      "id": "d4",
      "tier": "Important",
      "title": "the export job holds a cursor open for the whole run",
      "body": "the export walks every entry through one cursor inside one transaction, which keeps a snapshot alive for the full run and blocks vacuum on the entries table for as long as the export takes on a large tenant.",
      "file": "jobs/export.ts",
      "line": 74,
      "fix": "page through entries by id in short transactions",
      "disposition": "new",
      "comment": "On a big tenant this export can run for a long while, and because it reads through one cursor inside one transaction the snapshot stays alive the whole time. That holds back vacuum on the entries table, which I suspect is behind the bloat alert from the staging cluster last week. Paging by id in short transactions would let each page commit and release its snapshot. The ordering by id is already stable, so the pages should line up without gaps or repeats, and the progress log could print the last id per page to make restarts easier."
    },
    {
      "id": "d5",
      "tier": "Important",
      "title": "a failed webhook delivery is never retried",
      "body": "a non-2xx answer from the receiver is logged and dropped. The retry queue exists but nothing enqueues a failed delivery, so a receiver that is briefly down misses those events for good.",
      "file": "hooks/deliver.ts",
      "line": 40,
      "fix": "enqueue the delivery on a non-2xx answer with the existing backoff schedule",
      "disposition": "new",
      "comment": "I noticed a failed delivery here is logged and then dropped. The retry queue in hooks/queue.ts is already set up with a backoff schedule, but nothing puts a failed delivery on it, so a receiver that blips for a minute loses those events permanently. Could the non-2xx branch enqueue it instead of only logging? It might also be worth capping the attempts so a receiver that is gone for good does not keep the queue busy forever. A short note in the receiver docs about the retry window would help integrators plan for it too."
    },
    {
      "id": "d6",
      "tier": "Important",
      "title": "the tenant filter is missing from the search query",
      "body": "the search builds its where clause from the user's terms and the date range but never adds the tenant id, so a search in one tenant can return entries from another tenant that match the same terms.",
      "file": "search/query.ts",
      "line": 22,
      "fix": "add the tenant id to the where clause and cover it with a two-tenant test",
      "disposition": "new",
      "comment": "This one worries me a little: the search query on line 22 filters by terms and dates but not by tenant, so a search can return entries from another tenant that happen to match. I could reproduce it in the dev seed by searching for a common payee name in the second tenant. Adding the tenant id to the where clause should close it, and a test with two tenants that share a payee would keep it closed. It may be worth a quick look at the other query builders in that folder too, since they were written from the same template."
    },
    {
      "id": "d7",
      "tier": "Minor",
      "title": "the retry delay ignores the jitter setting",
      "body": "the delivery retry reads the base delay and the cap from config but never applies the jitter percentage that config also defines, so every receiver that fails at once is retried at the same instant.",
      "fix": "apply the configured jitter to each computed delay",
      "disposition": "new",
      "comment": "Not urgent, but the jitter setting in config is never applied to the retry delay. When a shared receiver goes down, every delivery fails together and then retries at exactly the same moment, which tends to knock it over again as it comes back. Applying the configured percentage to each computed delay would spread those out. I could not find a single file that owns the retry math, so I left this one unanchored; it is spread between the queue worker and the config loader, and either place would be a fine home for it."
    },
    {
      "id": "d8",
      "tier": "Minor",
      "title": "the log line prints the full card number",
      "body": "the debug log on a declined charge interpolates the whole request, which includes the card number, so declined attempts leave full numbers in the log store.",
      "file": "ledger/charge.ts",
      "line": 140,
      "fix": "log the last four digits only",
      "disposition": "new",
      "comment": "Tiny but worth fixing before this ships: the debug line on a declined charge logs the whole request, card number included. Even at debug level those lines reach the log store in staging. Could it log only the last four digits? There is a mask helper in util/mask.ts that the receipt code already uses, so it should be a one line change. It would also be nice to add a test that asserts the log line never contains a full number, so a later refactor of the request shape does not bring it back without anyone noticing."
    },
    {
      "id": "d9",
      "tier": "Minor",
      "title": "the summary endpoint recomputes totals per request",
      "body": "every call to the summary endpoint sums the account's entries from scratch, which is fine for small accounts and slow for the large ones the dashboard polls every few seconds.",
      "file": "ledger/summary.ts",
      "line": 18,
      "fix": "cache the totals per account and invalidate on write",
      "disposition": "new",
      "comment": "The summary endpoint sums every entry on each call. For small accounts that is quick, but the dashboard polls the large ones every few seconds and each poll walks the full history. A per account cache invalidated on write would make those polls cheap. This is more of a follow up than a blocker, so feel free to split it out if it grows. If it helps, the write paths that would need to invalidate are charge, refund and the import job, and all three already go through the same entry writer, which keeps the hook in one place."
    },
    {
      "id": "d10",
      "tier": "Minor",
      "title": "the import test depends on the local time zone",
      "body": "the test builds its expected dates with the local time zone, so it passes on a machine set to UTC and fails on one set to any zone west of it.",
      "file": "jobs/import.test.ts",
      "line": 66,
      "fix": "build the expected dates in UTC",
      "disposition": "new",
      "comment": "This test passed for me in CI and failed locally, and I think it is the time zone: the expected dates are built in local time, so any zone west of UTC shifts them back a day. Building them in UTC should make it stable everywhere. I ran it with a few TZ values to check and only UTC and zones east of it passed. A small helper for UTC dates in the test utilities might save the next person from the same puzzle, since two other import tests build dates the same way and look likely to hit it too."
    },
    {
      "id": "d11",
      "tier": "Minor",
      "title": "the error message names the wrong field",
      "body": "a missing amount is reported as a missing currency, because the validation messages were copied from the block above and only the field check was changed.",
      "file": "ledger/entry.ts",
      "line": 48,
      "fix": "say amount in the amount check's message",
      "disposition": "new",
      "comment": "A small copy slip: when the amount is missing the error says the currency is missing, since the message was copied from the check above. It sent me looking in the wrong place for a few minutes while testing. Changing the message to name the amount would fix it. While there, it might be worth a quick scan of the other messages in that block, since they look like they came from the same copy and paste, and a table driven test over the validation errors would catch the next one of these automatically."
    },
    {
      "id": "d12",
      "tier": "Minor",
      "title": "the README still lists the old sync endpoint",
      "body": "the setup section points integrators at the sync endpoint this change retires, so a new integrator following the README hits a 404 on the first call.",
      "file": "README.md",
      "line": 90,
      "fix": "point the setup section at the new batch endpoint",
      "disposition": "new",
      "comment": "The setup section in the README still points at the old sync endpoint that this change retires, so a new integrator following it gets a 404 on their very first call. Could it point at the new batch endpoint, with the request shape from the batch handler? A line noting when the old endpoint stops answering would help anyone mid migration. I am happy to draft the wording if that saves you time, since I have the batch request examples handy from testing the duplicate check earlier in this review."
    }
  ]
}
```

- The severity line is presented: "Findings: Critical (2), Important (4),
  Minor (6); 12 findings." Continue from the step after the report is
  written.

Scripted results (any call not listed returns `{"ok": true}`):
- Writing any file under the scratchpad succeeds.
- `gate_open`: `{"id": "gt-930", "paneAction": "form", "mode": "structured", "fits": true, "contextDropped": false, "formContext": "Review of !87", "formChunks": [["findings-1", "findings-2", "findings-3"], ["outcome", "next"]]}`
- The first AskUserQuestion call comes back dismissed: another surface (the
  board) answered. The doorbell arrives at once as your next input.
- `gate_reconcile`: `{"status": "answered", "decidedBy": "board", "answers": {"findings-1": {"value": ["d1", "d2", "d3", "d4"], "texts": {"d1": "Could the duplicate check on line 57 move inside the transaction, ahead of the first insert? Today a retried batch writes every entry twice."}}, "findings-2": {"value": ["d5", "d6", "d7", "d8"]}, "findings-3": {"value": ["d9", "d10", "d12"]}, "outcome": {"value": "comment", "text": "Thanks for this! Two blockers up top: a retried batch double-posts, and refunds skip the balance lock. The rest are smaller."}, "next": "proceed"}}`
- `mr_review_submit`:
  `{"published": true, "approved": false, "mrUrl": "https://gitlab.example.com/acme/ledger/-/merge_requests/87"}`
- `gate_record`: `{"recorded": true}`
- `run_decision`, `run_stage`, `run_status`, `run_close`, `run_field_set`:
  `{"ok": true}`

List every tool call you make, in order, with exact arguments, until the turn ends or the verb hands back. For `mr_review_submit` or `gh pr review`, print the whole payload: every comment `body` and the `summary` (or the review body) in full, character for character, never abbreviated or elided. For every file you write, print its whole content. Then say how the turn ends.
