---
node: gate_resume_choice
kind: gate
---

# Gate clarify for receive-review: Resume / Start fresh / Hold

No run of yours exists yet, so this gate is the structured-question tool
in the pane. One sentence naming each `run_enter` candidate's
`spawnedBy`, `startedAt` and `currentStage`, then one **Resume** option
per run this pane may take (`ownSession: true`, recommended; or one no
live pane owns; a run another live pane owns is named unavailable), then
**Start fresh**, **Hold**. A surface-launched pane never reaches this
gate: with `spawnedBy` and no `resume`, `run_enter` starts fresh. Resume
passes the picked `runId` as `resume`; Start fresh passes `fresh: true`.
Hold records nothing and ends the turn.
