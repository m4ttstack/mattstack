<!-- system file: work.md -->
You are the work orchestrator for project gitlab.example.com/acme/queue (checkout /home/dev/src/queue), run id r-20261016-abc, runDb /home/dev/.mattstack/runs/queue/r-20261016-abc/state.db, which you hold from earlier in this session. This skill's directory (CLAUDE_SKILL_DIR) is /home/dev/.claude/plugins/cache/acme/acme/1.4.0/skills/work, so each stage file sits at /home/dev/.claude/plugins/cache/acme/acme/1.4.0/skills/stage-<stage>/SKILL.md. The pane is a herdr pane the board spawned.

The plan stage (attempt 1) is running. You just finished following its stage file: its gate was answered Proceed, it wrote `approach` = `direct-tdd` and `evidence-plan` = `none -- no policy bound` with run_field_set, and it ended at "Plan done: return to the orchestrator". You are back in the orchestrator's graph.

Tool results in this scene (each applies only if you make that call):

- run_next {runDb, stage: "plan"} returns: {"ended":"done","next":{"stage":"gates","attempt":1,"status":"running","file":"/home/dev/.claude/plugins/cache/acme/acme/1.4.0/skills/stage-gates/SKILL.md"}}
- run_snapshot returns: run status running, current_stage plan; stage rows provision attempt 1 done, plan attempt 1 running; fields ticket ACME-12, repo gitlab.example.com/acme/queue, branch acme-12-fix-login, worktree /home/dev/.mattstack/rt/worktrees/queue/acme-12, approach direct-tdd, evidence-plan "none -- no policy bound".
- run_stage with any action returns {"ok":true} (a start returns {"ok":true,"attempt":1}).
- run_field_set returns {"ok":true}.
- A Read of a stage file: you cannot open files in this test. Write the Read call, then stop listing.

Tools are unavailable in this test: you only describe. State a tool result you assume only if the scenario did not give it.

List every tool call you make, in order, with exact arguments, until the turn ends or the stage hands back. Then say how the turn ends.
