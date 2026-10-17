## Scenario E4

- The data source is local, and no intake questions are declared.
- Fast Browser captures: `/home/dev/.fast-browser/screenshots/retry-badge-before.png` and `/home/dev/.fast-browser/screenshots/dlq-list-before.png`.
- `git remote get-url origin` returns `git@github.com:acme/queue.git`.
- `gh pr view fix-retry --json number,url` returns `{"number":7,"url":"https://github.com/acme/queue/pull/7"}`.
- `gh pr view 7 --json body` returns a body with a `## Evidence` heading.
- The `evidence-attach` gate's answer: `{"annotations":["all proposed"],"attach":"now","next":"proceed"}`.
- `evidence_record`'s first result: `{"written": false, "uncovered": [{"case": "retry-badge", "slot": "before", "why": "no-cover"}, {"case": "dlq-list", "slot": "before", "why": "no-cover"}], "value": <the record, with paths `/home/dev/.mattstack/work/r-20261016-abc/evidence/retry-badge/retry-badge-before.png` and `/home/dev/.mattstack/work/r-20261016-abc/evidence/dlq-list/dlq-list-before.png`>}`.
- Every draw succeeds.
- `evidence_record`'s second result: `{"written": true}`.
- `evidence_attach` returns `{"forge": "github", "description": "<spliced>", "notWritten": "github", "next": "gh pr view 7 --json body, then gh pr edit 7 --body-file"}`.
