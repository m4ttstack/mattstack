A board wrapper delegated this review of https://gitlab.example.com/acme/queue/-/merge_requests/87 (!87) to you and told you up front that it owns the posting gate: it will present the gate itself and hand you {findings, outcome} afterwards. You are at step 3, Deliver. The draft is written to /tmp/rv/report.md; its json sibling /tmp/rv/report.json holds exactly:
{"version": 2,
 "summary": {"readiness": "with-fixes", "reasoning": "the live path still re-enqueues permanent failures."},
 "findings": [
  {"id": "f1", "tier": "Critical", "kind": "suggestion", "title": "permanent failures re-enqueue forever", "file": "queue/worker.ts", "fix": "drop non-retryable jobs in the worker's catch block", "body": "a job marked retryable: false goes back on the queue after every failure, so it never leaves."},
  {"id": "f2", "tier": "Minor", "kind": "nitpick", "title": "test over-specifies the ordering", "file": "queue/enqueue.test.ts", "line": 132, "fix": "assert set membership", "body": "asserts exact call order where the contract only promises the set."}
 ]}
Tools are unavailable in this test. List, in order, every command you would run and every file you would write (full contents), and then the exact message you hand back to the wrapper.
