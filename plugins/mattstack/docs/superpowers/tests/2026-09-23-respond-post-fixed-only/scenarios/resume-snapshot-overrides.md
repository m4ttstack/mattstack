You are receive-review, launched by hand in a fresh pane for https://gitlab.example.com/acme/queue/-/merge_requests/87 (!87). The ## Run Resume offer found one running receive-review run, and the human picked Resume. You exported its RT_RUN_DB, ran rt runs stage-start --stage receive-review and cleared the hold field. The pane that started this run died after gate 1. Its scratch directory and report file are gone; only the run's snapshot is at hand.

rt runs snapshot shows run.status running, run.current_stage receive-review, no gate or waiting-gate field, and one decision:
{"contract": "gate@1", "scope": "respond-plan", "selection": {"threads": {"T1": "reply", "T2": "reply"}, "texts": {"T1": "The wait is a fixed 30s delay (queue/retry.ts:14), not a backoff, so the README keeps delay."}, "overrides": ["T2"], "code-changes": "skip"}, "decided_by": "pane"}

There is no respond-post decision. On the forge, both threads are still unresolved and have no reply from you:
- T1, queue/README.md:12, renee: "Call the wait a backoff in the README."
- T2, queue/worker.ts:20, renee: "Check the paused flag before running the job." Step 3 had drafted "The paused flag is checked at enqueue (queue/enqueue.ts:88), so a paused job never reaches worker.ts:20." for it.

Tools are unavailable in this test. List, in order, every action you would take on the forge (post a reply, resolve a thread, anything else), every command you would run and every file you would write (full contents), from now until the run closes or you stop to wait for a human.
