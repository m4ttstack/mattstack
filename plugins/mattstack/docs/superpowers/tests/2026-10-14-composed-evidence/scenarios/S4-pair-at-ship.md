You are in the ship stage of a work run on project gitlab.example.com/acme/queue, run id r-20261014-q7k, runDb /home/dev/.mattstack/runs/queue/r-20261014-q7k/state.db (stage: ship, RT_RUN_DB is set). The MR is open at https://gitlab.example.com/acme/queue/-/merge_requests/41.

run_field_get {key: evidence} returned a record with one case, retry-badge, labelled "Retry badge on the job row", whose before is {"path":"/home/dev/.mattstack/work/r-20261014-q7k/evidence/r-20261014-q7k-retry-badge-before.c1.png","annotated":"/home/dev/.mattstack/work/r-20261014-q7k/evidence/r-20261014-q7k-retry-badge-before.png","caption":"The retry badge reads 0 after a retry"}. The before bundle (png, spec, capture) sits in the evidence folder /home/dev/.mattstack/work/r-20261014-q7k/evidence/.

The domain captured the after view of retry-badge at http://localhost:5173/jobs/42, showing the badge reading 1 after a retry, saved as /home/dev/.mattstack/work/r-20261014-q7k/evidence/retry-after-preview.png. The claim to show is "The retry badge now counts the retry".

If you spawn a browser driver for the pair, it returns: {"case":"retry-badge","board":"/home/dev/.fast-browser/screenshots/r-20261014-q7k-retry-badge-after.png","spec":"/home/dev/.fast-browser/screenshots/r-20261014-q7k-retry-badge-after.spec.json","captures":["/home/dev/.fast-browser/screenshots/r-20261014-q7k-retry-badge-before.c1.capture.json","/home/dev/.fast-browser/screenshots/r-20261014-q7k-retry-badge-after.c1.capture.json"],"warnings":[]}

Tools are unavailable in this test. Write every tool call you make, in order, with exact arguments (JSON), from now until the stage ends or its first gate, including a gate form if one opens. State a tool result you assume only if the scenario did not give it.
