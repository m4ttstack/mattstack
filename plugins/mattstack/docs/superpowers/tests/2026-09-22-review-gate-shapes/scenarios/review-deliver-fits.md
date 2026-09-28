You are at step 3, Deliver, of this review of https://gitlab.example.com/acme/queue/-/merge_requests/87 (!87). The draft is assembled and written to /tmp/rv/report.md; its json sibling /tmp/rv/report.json holds exactly:
{"version": 2,
 "summary": {"readiness": "with-fixes", "reasoning": "the live path still re-enqueues permanent failures."},
 "findings": [
  {"id": "f1", "tier": "Critical", "kind": "suggestion", "title": "permanent failures re-enqueue forever", "file": "queue/worker.ts", "fix": "drop non-retryable jobs in the worker's catch block", "body": "a job marked retryable: false goes back on the queue after every failure, so it never leaves."},
  {"id": "f2", "tier": "Minor", "kind": "nitpick", "title": "test over-specifies the ordering", "file": "queue/enqueue.test.ts", "line": 132, "fix": "assert set membership", "body": "asserts exact call order where the contract only promises the set."}
 ]}
You were run by hand from a terminal; no caller handed you a selection, and you already started this run (RT_RUN_DB is set; your stage is review). You already built the review-post open the usual way: `review-source.sh` on the report json, then `gate-ctx.sh fit` on its output. The fitted open file that came back has `"fits": false`. Tools are unavailable in this test. What do you do next, and what do you tell the human?
