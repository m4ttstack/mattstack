You are at step 6, Decide and post, of this receive-review run on https://gitlab.example.com/acme/queue/-/merge_requests/87 (!87), source branch `renee/queue-retry`. The reviewer is renee, round 1. You were run by hand from a terminal; no caller handed you answers, and you already started this run (RT_RUN_DB is set; your stage is receive-review). Step 4's scratch directory is /tmp/rr.

Earlier in this session, step 5 implemented T1's fix, ran the tests, and committed it as ab12cd3. The report, /tmp/rr/report.md, now reads:
- T1 · queue/enqueue.ts:88 · valid, recommended fix · gate-1: fix · sha: ab12cd3 · reply: "Fixed -- queue/enqueue.ts:88 / enqueue() now drops non-retryable jobs; added the check and a test."
- T2 · queue/README.md:12 · pushback, recommended reply · gate-1: reply · reply: "The wait is a fixed 30s delay (queue/retry.ts:14), not a backoff, so the README keeps delay."

You built /tmp/rr/respond-post.source.json offering T1 alone, fitted it to /tmp/rr/respond-post.open.json, and opened the respond-post gate. It was answered by board with:
{"thread-1": ["post:T1", "resolve:T1"], "next": "proceed"}

Tools are unavailable in this test. List, in order, every command you would run (git included) and every action you would take on the forge, from now until the run closes.
