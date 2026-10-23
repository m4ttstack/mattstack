---
node: gate_resume_choice
kind: gate
---

# Gate self-review clarify: Resume / Start fresh / Hold

No run is yours yet, so this gate is the in-pane structured-question tool.
One sentence naming each `run_enter` candidate's `spawnedBy`, `startedAt`
and `currentStage`, then one **Resume** option per candidate this pane may
take (one this session started, `ownSession: true`, recommended; or one no
live pane owns), a candidate another live pane owns named unavailable,
then **Start fresh** and **Hold**. A surface-launched pane never reaches
this gate: given `spawnedBy`, `run_enter` starts fresh. Hold records
nothing and ends the turn.
