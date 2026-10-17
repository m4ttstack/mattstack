<!-- system file: work.md -->
You are the work orchestrator for project gitlab.example.com/acme/queue (checkout /home/dev/src/queue), run id r-20261016-abc, runDb /home/dev/.mattstack/runs/queue/r-20261016-abc/state.db, which you hold from earlier in this session. This skill's directory (CLAUDE_SKILL_DIR) is /home/dev/.claude/plugins/cache/acme/acme/1.4.0/skills/work, so each stage file sits at /home/dev/.claude/plugins/cache/acme/acme/1.4.0/skills/stage-<stage>/SKILL.md. The pane is a herdr pane the board spawned (the run's spawnedBy is board; HERDR_ENV=1).

The ship stage is on attempt 2 (attempt 1 failed earlier and was retried). You just finished following the ship stage file. It ended by failing itself: it wrote run_stage {action: "fail", stage: "ship", reason: "MR pipeline failed: unit job login_redirect_test", detailPath: "/home/dev/.mattstack/work/r-20261016-abc/ship-2.log"} and ended at "Stage failed". You are back in the orchestrator's graph.

Tool results in this scene (each applies only if you make that call):

- run_next {runDb, stage: "ship"} returns: {"ended":"failed","at":{"stage":"ship","attempt":2,"status":"failed","file":"/home/dev/.claude/plugins/cache/acme/acme/1.4.0/skills/stage-ship/SKILL.md"},"reason":"MR pipeline failed: unit job login_redirect_test","detailPath":"/home/dev/.mattstack/work/r-20261016-abc/ship-2.log","scope":"ship-failed:2","earlier":["provision","plan","gates","implement","self-review"]}
- run_snapshot returns: run status running, current_stage ship; stage rows provision 1 done, plan 1 done, gates 1 done, implement 1 done, self-review 1 done, ship 1 failed, ship 2 failed; fields include commits "a1b2c3d e4f5a6b", review "approved", mr "https://gitlab.example.com/acme/queue/-/merge_requests/12", shipTarget "main".
- gate_ask (any arguments) returns: {"id":"gt-41aa","presentation":"wait","subject":"run:r-20261016-abc","supersededId":null,"paneAction":"wait","formChunks":[{"id":"action","label":"Failure action","text":"Failure action","multi":false,"options":[{"value":"retry","label":"Retry the stage"},{"value":"abandon","label":"Abandon the run"}]},{"id":"next","label":"Next","text":"Next","multi":false,"options":[{"value":"proceed","label":"Proceed"},{"value":"iterate","label":"Iterate here"},{"value":"redirect","label":"Go back"},{"value":"hold","label":"Hold"}]}]}
- run_field_set, run_decision and run_stage calls return {"ok":true} (a run_stage start returns {"ok":true,"attempt":<next attempt number>}).

Part 1. Walk from here until the turn ends.

Part 2. Later, the background `rt gate wait gt-41aa` finishes and re-invokes this pane, printing: {"ok":true,"status":"answered","row":{"id":"gt-41aa","kind":"ship-failed:2","answer":{"answers":{"action":"retry","next":"redirect","to-1":{"value":"implement","note":"the fix needs a test"}},"by":"board"}}}. The board's answer is: Go back to implement, note "the fix needs a test".

- gate_reconcile {id: "gt-41aa", ...} returns: {"status":"answered","answers":{"action":"retry","next":"redirect","to-1":{"value":"implement","note":"the fix needs a test"}},"decidedBy":"board","writeIn":[],"next":"redirect","actOnWriteIn":false}
- rt gate wait gt-41aa --timeout 2s prints the same answered row as above.
- run_resolve {runDb, stage: "ship", next: "redirect", to: "implement", note: "the fix needs a test", attempt: 2, decidedBy: "board"} returns: {"applied":"redirect","next":{"stage":"implement","attempt":2,"status":"running","file":"/home/dev/.claude/plugins/cache/acme/acme/1.4.0/skills/stage-implement/SKILL.md"},"cleared":["commits","review","mr","ci","shipTarget"]}
- A Read of a stage file: you cannot open files in this test. Write the Read call, then stop listing Part 2.

Continue the list from where Part 1 ended.

Part 3. Context is compacted right after the call in Part 2 that applied the Go back, before its result reached you. The summary says: "ship-failed:2 answered by board: Go back to implement, note 'the fix needs a test'; the result of the call that applied it was lost." You resend that same call, with the same arguments.

- If that call is run_resolve, it returns: {"applied":"redirect","repeated":true,"next":{"stage":"implement","attempt":2,"status":"running","file":"/home/dev/.claude/plugins/cache/acme/acme/1.4.0/skills/stage-implement/SKILL.md"},"cleared":[]}
- If that call is run_stage {action: "start", stage: "implement"}, it returns {"ok":true,"attempt":3} (attempt 2 of implement, still running, is ended as superseded).

Continue the list from there, then stop.

Tools are unavailable in this test: you only describe. State a tool result you assume only if the scenario did not give it.

List every tool call you make, in order, with exact arguments, until the turn ends or the stage hands back. Then say how the turn ends.
