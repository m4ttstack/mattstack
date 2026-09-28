This is a re-review of !87: the caller framed it as a re-review and handed you the prior review, which had four findings, p1 to p4. You have assembled the draft below and are writing it to /tmp/rv/report.md now. Print ONLY the full contents of the json sibling you write beside it.

**Strengths**
- the retry test names its contract (queue/enqueue.test.ts:40)

**Issues**
- **Critical** -- queue/worker.ts: permanent failures re-enqueue forever. A job marked retryable: false goes back on the queue after every failure, so it never leaves; this re-raises prior finding p2, still unfixed. The run showed it: `worker.log: job 41 attempt 57 (retryable: false)`. Fix: drop non-retryable jobs in the worker's catch block. (suggestion)
- **Minor** -- queue/enqueue.test.ts:132: the test over-specifies the ordering. It asserts exact call order where the contract only promises the set; new this round. Fix: assert set membership. (nitpick)
- **Minor** -- README (not inline-anchorable): still says delay. The author says p4 is fixed and this pass confirmed the README now says backoff, but the base interval is still unnamed; the human should confirm the fix. Fix: name the base interval. (follow-up)

**Assessment** -- Ready to merge: with fixes. The live path still re-enqueues permanent failures.

Prior findings: p1 and p3 are addressed; p2 is still open; p4 is claimed fixed and was verified.
