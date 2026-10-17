<!-- system file: work.md -->
You are the work orchestrator for project gitlab.example.com/acme/queue (checkout /home/dev/src/queue), run id r-20261016-abc, runDb /home/dev/.mattstack/runs/queue/r-20261016-abc/state.db, which you hold from earlier in this session. This skill's directory (CLAUDE_SKILL_DIR) is /home/dev/.claude/plugins/cache/acme/acme/1.4.0/skills/work, so each stage file sits at /home/dev/.claude/plugins/cache/acme/acme/1.4.0/skills/stage-<stage>/SKILL.md. The pane is a herdr pane the board spawned (the run's spawnedBy is board; HERDR_ENV=1).

The ship stage (attempt 2) failed: the ship stage file wrote run_stage {action: "fail", stage: "ship", reason: "MR pipeline failed: unit job login_redirect_test"} and ended at "Stage failed". You opened the failure gate `ship-failed:2` with gate_ask (it returned id gt-41aa, paneAction wait), launched the background `rt gate wait gt-41aa` and ended the turn holding at that gate.

Now the background wait finishes and re-invokes this pane, printing: {"ok":true,"status":"answered","row":{"id":"gt-41aa","kind":"ship-failed:2","answer":{"answers":{"action":"retry","next":"redirect","to-2":{"value":"evidence","note":"recapture the login screenshots"}},"by":"board"}}}.

Tool results in this scene (each applies only if you make that call):

- gate_reconcile {id: "gt-41aa", ...} returns: {"status":"answered","answers":{"action":"retry","next":"redirect","to-2":{"value":"evidence","note":"recapture the login screenshots"}},"decidedBy":"board","writeIn":[],"next":"redirect","actOnWriteIn":false}
- rt gate wait gt-41aa --timeout 2s prints the same answered row as above.
- run_resolve {runDb, stage: "ship", next: "redirect", to: "evidence", ...} is refused (an error result): "evidence is not a stage of this run's pipeline (provision, plan, gates, implement, self-review, ship, watch-ci)"
- run_hold returns {"held":true,"at":{"stage":"ship","attempt":2,"status":"failed","file":"/home/dev/.claude/plugins/cache/acme/acme/1.4.0/skills/stage-ship/SKILL.md"},"scope":"hold:ship:2"}
- run_snapshot returns: run status running, current_stage ship; stage rows provision 1 done, plan 1 done, gates 1 done, implement 1 done, self-review 1 done, ship 1 failed, ship 2 failed.
- run_field_set and run_decision calls return {"ok":true}; run_stage {action: "start", stage: "evidence"} returns {"ok":true,"attempt":1}; any other run_stage call returns {"ok":true}.
- A Read of a stage file: you cannot open files in this test. Write the Read call, then stop listing.

Tools are unavailable in this test: you only describe. State a tool result you assume only if the scenario did not give it.

List every tool call you make, in order, with exact arguments, until the turn ends or the stage hands back. Then say how the turn ends.
