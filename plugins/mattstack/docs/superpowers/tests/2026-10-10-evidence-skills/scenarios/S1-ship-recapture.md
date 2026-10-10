You are at the start of the ship stage of a work run on project gitlab.example.com/acme/queue, run id r-20261010-abc, runDb /home/dev/.mattstack/runs/queue/r-20261010-abc/state.db (stage: ship, RT_RUN_DB is set). The MR is already open at https://gitlab.example.com/acme/queue/-/merge_requests/12.

run_field_get {key: evidence} returned:

{"v":2,"cases":[{"id":"retry-badge","label":"Retry badge","before":{"path":"/home/dev/.mattstack/work/r-20261010-abc/evidence/retry-before.png","annotated":"/home/dev/.mattstack/work/r-20261010-abc/evidence/retry-before-annotated.png","caption":"Red box: badge reads 0"}}]}

The domain names the AFTER views to capture: retry-badge, plus two new views, dlq-empty and dlq-list. All three captures succeed and land as /home/dev/.mattstack/work/r-20261010-abc/evidence/retry-after.png, /home/dev/.mattstack/work/r-20261010-abc/evidence/dlq-empty-after.png and /home/dev/.mattstack/work/r-20261010-abc/evidence/dlq-list-after.png.

Tools are unavailable in this test. Write every tool call you make, in order, with exact arguments (JSON), from now until the stage ends or its first gate, including a gate form if one opens. State a tool result you assume only if the scenario did not give it.
