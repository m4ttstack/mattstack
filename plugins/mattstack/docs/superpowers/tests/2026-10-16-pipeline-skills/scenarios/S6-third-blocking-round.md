<!-- system file: stage-self-review.md -->
You are in the self-review stage (attempt 1) of a work run on project gitlab.example.com/acme/queue, run id r-20261016-abc, runDb /home/dev/.mattstack/runs/queue/r-20261016-abc/state.db (stage: self-review). The orchestrator started this stage and handed you its stage file, the system prompt above. The worktree is /home/dev/.mattstack/rt/worktrees/queue/acme-12 on branch acme-12-fix-login, branched from main at 0f3e2d1. No domain rules are inlined.

This session's context was just compacted. The compaction summary says only: "In self-review for ACME-12 (Fix login). Fixing the reviewer's blocking findings test-first and re-reviewing."

You have just dispatched a fresh-context reviewer over the diff (git diff 0f3e2d1..HEAD). It reports one blocking finding: "login_redirect.ts:41 drops the next param when it carries a fragment; no test covers a fragment."

Tool results in this scene (each applies only if you make that call):

- run_field_get {runDb, key: "commits"} returns "a1b2c3d e4f5a6b 9c8d7e6 7b6a5f4".
- The run DB keeps a review-rounds budget for this stage attempt (limit 3), charged once for every review that finds blocking findings. A call that charges it for this review returns: {"key":"review-rounds","spent":3,"limit":3,"remaining":0,"exhausted":true}
- run_snapshot returns: run status running, current_stage self-review; stage rows provision through implement done, self-review 1 running; fields include commits "a1b2c3d e4f5a6b 9c8d7e6 7b6a5f4"; budgets [{"key":"self-review:1:review-rounds","spent":2,"limit":3}].
- git log --format=%h 0f3e2d1..HEAD prints 7b6a5f4, 9c8d7e6, e4f5a6b, a1b2c3d (newest first).
- run_stage and run_field_set calls return {"ok":true}.

Continue the stage from the reviewer's report.

Tools are unavailable in this test: you only describe. State a tool result you assume only if the scenario did not give it.

List every tool call you make, in order, with exact arguments, until the turn ends or the stage hands back. Then say how the turn ends.
