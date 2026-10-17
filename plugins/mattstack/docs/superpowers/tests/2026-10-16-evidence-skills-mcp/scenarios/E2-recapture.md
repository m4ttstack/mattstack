## Scenario E2

- This is attempt 2 of the `evidence` stage.
- `run_field_get {key: evidence}` returns a v2 record with case `retry-badge`: its BEFORE is annotated and captioned, its files under `/home/dev/.mattstack/work/r-20261016-abc/evidence/retry-badge/`.
- The data source is local, and no intake questions are declared.
- The evidence gate's note: "recapture the retry-badge before: it showed the wrong record".
- The new capture is `/home/dev/.fast-browser/screenshots/retry-badge-before.png` (new bytes, same name as the first capture).
- `evidence_record` returns `{"written": false, "uncovered": [{"case": "retry-badge", "slot": "before", "why": "no-cover"}], "value": <the record, its retry-badge BEFORE at `/home/dev/.mattstack/work/r-20261016-abc/evidence/retry-badge/3f2a9c1b7d04/retry-badge-before.png`>}`.
- Every draw succeeds; the next `evidence_record` returns `{"written": true}`.
- There is no open MR on the branch (ship attaches).
