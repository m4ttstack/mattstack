## Scenario E3

- The data source is local, and no intake questions are declared.
- Fast Browser captures: `/home/dev/.fast-browser/screenshots/retry-badge-before.png` and `/home/dev/.fast-browser/screenshots/dlq-list-before.png`, plus a video `/home/dev/.fast-browser/screenshots/dlq-replay.mp4` for the dead-letter list, which is waived (a recording, no marks).
- `git remote get-url origin` returns `git@gitlab.example.com:acme/queue.git`.
- `mr_for_branch` returns `https://gitlab.example.com/acme/queue/-/merge_requests/12` for `fix-retry`.
- The `evidence-attach` gate's answer: `{"annotations":["all proposed"],"attach":"now","next":"proceed"}`.
- `evidence_record`'s first result: `{"written": false, "uncovered": [{"case": "retry-badge", "slot": "before", "why": "no-cover"}, {"case": "dlq-list", "slot": "before", "why": "no-cover"}], "value": <the record, with paths `/home/dev/.mattstack/work/r-20261016-abc/evidence/retry-badge/retry-badge-before.png`, `/home/dev/.mattstack/work/r-20261016-abc/evidence/dlq-list/dlq-list-before.png` and `/home/dev/.mattstack/work/r-20261016-abc/evidence/dlq-list/dlq-replay.mp4`>}`.
- Every draw succeeds.
- `evidence_record`'s second result: `{"written": true}`.
- `evidence_attach` returns `{"forge": "gitlab", "refused": {"size": [{"path": "/home/dev/.mattstack/work/r-20261016-abc/evidence/dlq-list/dlq-replay.mp4", "error": "file is 81 MB; the upload cap is 50 MB"}]}, "descriptionWritten": false, "notWritten": "refused"}`.
- The off-script gate's answer: `{"next":"proceed","action":"take"}`.
- The MR description has no evidence heading.
