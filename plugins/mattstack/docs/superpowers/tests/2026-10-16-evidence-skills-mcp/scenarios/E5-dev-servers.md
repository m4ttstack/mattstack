## Scenario E5

- A domain line is inlined as a fill would be: "Before capture, the web and api dev servers of this worktree must answer".
- `dev_endpoints` returns both roles answered: `web` on port 5173, `api` on port 8080.
- The data source is local, and no intake questions are declared.
- Fast Browser captures: `/home/dev/.fast-browser/screenshots/retry-badge-before.png` and `/home/dev/.fast-browser/screenshots/dlq-list-before.png`.
- `git remote get-url origin` returns `git@gitlab.example.com:acme/queue.git`.
- `mr_for_branch` returns `https://gitlab.example.com/acme/queue/-/merge_requests/12` for `fix-retry`.
- The `evidence-attach` gate's answer: `{"annotations":["all proposed"],"attach":"now","next":"proceed"}`.
- `evidence_record`'s first result: `{"written": false, "uncovered": [{"case": "retry-badge", "slot": "before", "why": "no-cover"}, {"case": "dlq-list", "slot": "before", "why": "no-cover"}], "value": <the record, with paths `/home/dev/.mattstack/work/r-20261016-abc/evidence/retry-badge/retry-badge-before.png` and `/home/dev/.mattstack/work/r-20261016-abc/evidence/dlq-list/dlq-list-before.png`>}`.
- Every draw succeeds.
- `evidence_record`'s second result: `{"written": true}`.
- `evidence_attach` returns `{"forge": "gitlab", "descriptionWritten": true}`.
