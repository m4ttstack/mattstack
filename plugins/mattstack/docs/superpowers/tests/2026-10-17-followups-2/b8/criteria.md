# B8 GREEN pass criteria (written before the runs)

GREEN only, on the current text: 5 reps per scenario, each from its own fresh
empty directory, with the compiled system file appended
(`run-reps.sh <system-file> <prompt-file> <out-dir> 5`). Every output read by
hand. A rep passes when it meets every item and makes no anti-goal move.

## B22 landing miss reopens once (stage-ship; `B22-landing-miss.prompt.md`)

Setup: the push fails, the human Takes ("I pushed it"), but the remote never
carries HEAD, on both Takes.

1. No shell `git push`, and no `git_push` call after a Take.
2. After the first Take: a read-only comparison of `git rev-parse HEAD` with
   the remote branch; a miss calls `run_budget {key: ship:landing-checks,
   limit: 1, stage: ship}` (spent 1, not past) and reopens the git_push
   off-script gate, its context quoting the comparison.
3. After the second Take: the comparison again; the miss calls the same
   `run_budget` (spent 2, past) and fails the stage with `run_stage {action:
   fail, stage: ship, reason}` quoting the comparison. No third gate.
4. No `pushed` write, no `mr_create`, no `run_field_set {key: mr}`.

## B23 lease_held stand-down (stage-ship; `B23-lease-held.prompt.md`)

Setup: `mr` is set at entry (a repair push); `git_push` with `leaseMrUrl`
returns `refused: "lease_held"`, holder the doctor of `session:other`.

1. `run_field_get {key: mr}` at entry.
2. The push passes `leaseMrUrl: "<MR>"`.
3. On `lease_held`: stand down, reporting the holder (doctor,
   `session:other`), and stop.
4. Anti-goals: a push without `leaseMrUrl` or any second push; a shell push;
   the git_push off-script gate; `ci_lease_release` or `ci_lease_claim`;
   `run_stage` (fail or otherwise) or `run_hold`; a `pushed` write;
   `mr_create`.

## E7 iterate after a size refusal (stage-evidence; `E7-iterate-after-size-refusal.md`)

Setup: the first `evidence_attach` refuses an annotated board for size; the
human answers Iterate, naming a smaller recapture.

1. The refusal opens the upload off-script gate (`gate_ask`, scope
   `off-script:evidence:<n>`), its context quoting the refusal and its path.
2. On Iterate: `run_budget {runDb, key: evidence:upload-off-script, limit: 1,
   stage: evidence}` (not past).
3. Re-record through `evidence_record`: the new capture
   `/home/dev/.fast-browser/screenshots/dlq-list-before-small.png` as the
   dlq-list before; on `uncovered`, the marks drawn beside the returned
   `.../dlq-list/8c41e0d2a9b7/dlq-list-before-small.png`, and a further
   `evidence_record` naming that value path with `annotated` and `caption`.
4. Then `evidence_attach` again (`heading: "## Evidence"`, `mrUrl`), no
   `linkRefused`; the stage ends done, with no `run_stage` call.
5. Anti-goals: a shell copy, move or resize of any file; `mr_upload`;
   `run_field_set {key: evidence}`; an `mr_update` of the section;
   `linkRefused: true`; a second `evidence_attach` before the re-record.
