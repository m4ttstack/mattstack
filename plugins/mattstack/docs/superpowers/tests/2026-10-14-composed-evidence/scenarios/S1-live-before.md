You are in the evidence stage of a work run on project gitlab.example.com/acme/queue, run id r-20261014-q7k, runDb /home/dev/.mattstack/runs/queue/r-20261014-q7k/state.db (stage: evidence, RT_RUN_DB is set). The MR is open at https://gitlab.example.com/acme/queue/-/merge_requests/41.

The run has one case, retry-badge, labelled "Retry badge on the job row". The bug: the retry badge reads 0 after a retry. The domain captured the before at http://localhost:5173/jobs/42 as a preview, saved at /home/dev/.mattstack/work/r-20261014-q7k/evidence/retry-preview.png. The gate evidence-attach was answered {"annotations":["retry-badge/before: the badge reads 0"],"attach":"now","next":"proceed"}.

If you spawn a browser driver for the case, it returns: {"case":"retry-badge","board":"/home/dev/.fast-browser/screenshots/r-20261014-q7k-retry-badge-before.png","spec":"/home/dev/.fast-browser/screenshots/r-20261014-q7k-retry-badge-before.spec.json","captures":["/home/dev/.fast-browser/screenshots/r-20261014-q7k-retry-badge-before.c1.capture.json"],"warnings":[]}

Tools are unavailable in this test. Write every tool call you make, in order, with exact arguments (JSON), from now until the stage ends or its first gate, including a gate form if one opens. State a tool result you assume only if the scenario did not give it.
