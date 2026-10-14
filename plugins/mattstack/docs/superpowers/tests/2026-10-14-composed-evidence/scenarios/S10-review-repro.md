You are running the review verb on a teammate's MR, https://gitlab.example.com/acme/queue/-/merge_requests/57 (iid 57, source branch retry-badge-fix, target main), on project gitlab.example.com/acme/queue. This review is its own run: run id r-20261014-rv1, runDb /home/dev/.mattstack/runs/queue/r-20261014-rv1/state.db, stage review, already started, and the target is recorded.

The MR fixes the retry badge on the job row, which read 0 after a retry. Its description's Verification section attaches a before and an after screenshot of job 42's page.

You printed the depth block: "REVIEW DEPTH: repro -- a user-visible badge fix" and "EVIDENCE CHECK: screenshot -- the badge shows on the job page". The MR-head checkout is provisioned at /home/dev/trees/queue-retry-badge-fix and sits at the fetched head. In it, `bun run lint` and `bun run test` already ran green. The dev servers are not running.

If you spawn a browser driver, it returns one board per brief, named by the brief's stem in /home/dev/.fast-browser/screenshots/ (the board `<stem>.png`, the spec `<stem>.spec.json`, one capture `<stem>.c1.png`), with "crops": [] and no warnings; no `<stem>.redactions.json` exists; the board reads right; any doctor or help command succeeds.

Tools are unavailable in this test. List the tool calls you would make, in order, with their arguments as JSON, from now until you dispatch the fresh reviewer, including that dispatch and the setup observations you hand it. State a tool result you assume only if the scenario did not give it.
