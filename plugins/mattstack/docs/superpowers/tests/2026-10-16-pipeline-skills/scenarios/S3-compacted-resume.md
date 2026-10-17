<!-- system file: work.md -->
You are the work orchestrator for project gitlab.example.com/acme/queue (checkout /home/dev/src/queue). This skill's directory (CLAUDE_SKILL_DIR) is /home/dev/.claude/plugins/cache/acme/acme/1.4.0/skills/work, so each stage file sits at /home/dev/.claude/plugins/cache/acme/acme/1.4.0/skills/stage-<stage>/SKILL.md. The pane is a herdr pane (HERDR_ENV=1) a human started by typing the work command for ticket ACME-12; nothing spawned it.

This session's context was just compacted. The compaction summary is all you have:

"Running work for ticket ACME-12 (Fix login), run id r-20261016-abc. Provision is done (branch acme-12-fix-login, worktree /home/dev/.mattstack/rt/worktrees/queue/acme-12). In the plan stage I printed the triage block (APPROACH: direct-tdd -- the redirect loop is a two-line guard with an existing test file; FAILING TEST: login_redirect_test keeps the next param; EVIDENCE: none -- no policy bound), opened the plan gate and was holding at it, waiting for an answer."

The summary does not carry the runDb path or the gate id. The human now types: "carry on".

The plan stage file, as read before compaction: its `plan` gate asks `tier` (write-in), `failing_test`, `next` and `to`; on a Proceed answer the stage records the tier and writes `approach` (the tier) and `evidence-plan` (the EVIDENCE value) with run_field_set, then returns to the orchestrator. On Iterate it re-reads the ticket; Go back hands back to the orchestrator; Hold holds.

Tool results in this scene (each applies only if you make that call):

- run_enter {flags, skillDir, resume: "r-20261016-abc"} returns: {"mode":"resumed","runDb":"/home/dev/.mattstack/runs/queue/r-20261016-abc/state.db","runId":"r-20261016-abc","at":{"stage":"plan","attempt":1,"status":"running","file":"/home/dev/.claude/plugins/cache/acme/acme/1.4.0/skills/stage-plan/SKILL.md"},"clearedHold":false}
- run_enter with runDb instead of resume returns: {"mode":"inherited","runDb":"/home/dev/.mattstack/runs/queue/r-20261016-abc/state.db","runId":"r-20261016-abc","at":{"stage":"plan","attempt":1,"status":"running","file":"/home/dev/.claude/plugins/cache/acme/acme/1.4.0/skills/stage-plan/SKILL.md"}}
- run_list {repo: "queue", ...} returns one row: {"id":"r-20261016-abc","status":"running","pipeline":"feature","current_stage":"plan","started_at":"2026-10-16T14:02:11Z"}
- run_snapshot returns: run status running, current_stage plan; stage rows provision 1 done, plan 1 running; fields ticket ACME-12, branch acme-12-fix-login, worktree /home/dev/.mattstack/rt/worktrees/queue/acme-12, gate "plan", waiting-gate "gt-7c2e".
- run_field_get {runDb, key: "waiting-gate"} returns "gt-7c2e".
- gate_reconcile {id: "gt-7c2e", ...} returns: {"status":"answered","answers":{"tier":"direct-tdd","failing_test":"login_redirect_test keeps the next param","next":"proceed"},"decidedBy":"board","writeIn":[],"next":"proceed","actOnWriteIn":false}
- rt gate wait gt-7c2e (with or without --timeout 2s) prints: {"ok":true,"status":"answered","row":{"id":"gt-7c2e","kind":"plan","answer":{"answers":{"tier":"direct-tdd","failing_test":"login_redirect_test keeps the next param","next":"proceed"},"by":"board"}}}
- run_stage {action: "start", stage: "plan"} returns {"ok":true,"attempt":2} (attempt 1, still running, is ended as superseded).
- run_field_set and run_decision calls return {"ok":true}.
- run_next {runDb, stage: "plan"} returns: {"ended":"done","next":{"stage":"gates","attempt":1,"status":"running","file":"/home/dev/.claude/plugins/cache/acme/acme/1.4.0/skills/stage-gates/SKILL.md"}}
- AskUserQuestion: if you ask a clarify question, the human picks the resume option.
- If you open a new gate with gate_ask, stop listing at that call.
- A Read of a stage file: you cannot open files in this test. Write the Read call; for the plan stage file, continue from what the paragraph above says it does; for any other stage file, stop listing.

Tools are unavailable in this test: you only describe. State a tool result you assume only if the scenario did not give it.

List every tool call you make, in order, with exact arguments, until the turn ends or the stage hands back. Then say how the turn ends.
