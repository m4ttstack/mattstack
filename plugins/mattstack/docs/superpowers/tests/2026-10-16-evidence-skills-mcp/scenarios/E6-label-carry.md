## Scenario E6

- For this scenario, `evidence-plan` = `screenshots: the retry badge, before`.
- The data source is local, and no intake questions are declared.
- Fast Browser capture: `/home/dev/.fast-browser/screenshots/retry-badge-before.png`.
- `git remote get-url origin` returns `git@gitlab.example.com:acme/queue.git`.
- `mr_for_branch` returns `https://gitlab.example.com/acme/queue/-/merge_requests/12` for `fix-retry`.
- The `evidence-attach` gate's answer: `{"annotations":["all proposed"],"attach":"now","next":"proceed"}`.
- `evidence_record`'s first result: `{"written": false, "uncovered": [{"case": "retry-badge", "slot": "before", "why": "no-cover"}], "value": <the record, with path `/home/dev/.mattstack/work/r-20261016-abc/evidence/retry-badge/retry-badge-before.png`>}`.
- Every draw succeeds.
- `evidence_record`'s second result: `{"written": true}`.
- `evidence_attach` returns `{"forge": "gitlab", "descriptionWritten": true}`.
- The MR description has no evidence heading.
