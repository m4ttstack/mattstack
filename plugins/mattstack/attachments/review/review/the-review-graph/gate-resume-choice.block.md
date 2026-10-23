---
node: gate_resume_choice
kind: gate
label: Resume or start fresh
---

# Gate review clarify: Resume / Start fresh / Hold

No run is yours yet: use the in-pane structured-question tool. One
sentence naming each candidate's `spawnedBy`, `startedAt` and
`currentStage`; one **Resume** option per candidate this pane may take
(this session's, `ownSession: true`, recommended; or one no live pane
owns), naming one another live pane owns unavailable; then **Start fresh**
and **Hold**. A launched pane never gets here: with `spawnedBy` and no
`resume`, `run_enter` starts fresh. Hold records nothing.
