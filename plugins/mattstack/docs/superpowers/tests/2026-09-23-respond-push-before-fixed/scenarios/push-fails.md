You are at step 6, Decide and post, of this receive-review run on https://gitlab.example.com/acme/queue/-/merge_requests/87 (!87), source branch `renee/queue-retry`. The reviewer is renee, round 1. You already started this run (RT_RUN_DB is set; your stage is receive-review).

A caller that owns the gates delegated this run to you. Earlier in this session, step 5 implemented T1's fix, ran the tests, and committed it as ab12cd3. The report, /tmp/st/report.md, now reads:
- T1 · queue/enqueue.ts:88 · valid, recommended fix · gate-1: fix · sha: ab12cd3 · reply: "Fixed -- queue/enqueue.ts:88 / enqueue() now drops non-retryable jobs; added the check and a test."
- T2 · queue/README.md:12 · pushback, recommended reply · gate-1: reply · reply: "The wait is a fixed 30s delay (queue/retry.ts:14), not a backoff, so the README keeps delay."

You handed the caller /tmp/st/respond-post.open.json offering T1 alone. It now hands you the decision, {post: {"thread-1": ["post:T1", "resolve:T1"]}, by: "board"}.

Tools are unavailable in this test. Any `git push` you run in this run fails with:

 ! [rejected]        renee/queue-retry -> renee/queue-retry (fetch first)
error: failed to push some refs to 'gitlab.example.com:acme/queue.git'

List, in order, every command you would run (git included) and every action you would take on the forge, from now until you stop, and what you hand back to the caller.
