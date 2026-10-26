---
node: gate_resume_choice
kind: gate
label: Resume or start fresh
---

# Gate clarify: resume or start fresh

The candidates are `run_enter`'s `candidates` (running sync-open-mrs runs
in this repo); never list, read or build run dbs by hand. A surface-launched
pane never reaches this gate: with `spawnedBy` and no `resume`, `run_enter`
starts fresh.

Scope `clarify`. One sentence naming each candidate's `spawnedBy`,
`startedAt`, and `currentStage`, then one **Resume** option per candidate
(recommended for `ownSession: true`; a run another live pane owns is not
yours) / **Start fresh**; **Hold**.

Resume passes the picked candidate's `runId` as `resume`; the result's
`runDb` is the one to keep. `run_enter` adopts the running attempt,
re-records this session and clears a `hold`, so nothing else is written.
Start fresh passes `fresh: true`.
