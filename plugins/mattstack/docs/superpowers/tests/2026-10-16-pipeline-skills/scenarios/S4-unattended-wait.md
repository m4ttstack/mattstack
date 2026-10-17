<!-- system file: stage-plan.md -->
You are in the plan stage (attempt 1) of a work run on project gitlab.example.com/acme/queue, run id r-20261016-abc, runDb /home/dev/.mattstack/runs/queue/r-20261016-abc/state.db (stage: plan). The orchestrator started this stage and handed you its stage file, the system prompt above. The worktree is /home/dev/.mattstack/rt/worktrees/queue/acme-12 on branch acme-12-fix-login. The pane is a herdr pane (HERDR_ENV=1) the board spawned: the run's spawnedBy is board, so nobody is watching it. No domain rules are inlined.

Tool results in this scene (each applies only if you make that call):

- run_field_get {runDb, key: "ticket"} returns "ACME-12".
- The ticket ACME-12, "Fix login": "After login the app redirects back to /login when the URL carries a next param, looping forever. Expected: land on the next param's page. Repro in login_redirect.ts; tests live in login_redirect_test.ts." Reading it is part of the step that needs it.
- gate_ask (any arguments) returns: {"id":"gt-5b19","presentation":"wait","subject":"run:r-20261016-abc","supersededId":null,"paneAction":"wait","formChunks":[{"id":"tier","label":"Tier","text":"Tier","multi":false,"options":[{"value":"direct-tdd","label":"direct-tdd (Recommended)"},{"value":"trivial","label":"trivial"},{"value":"superpowers","label":"superpowers"}]},{"id":"failing_test","label":"Failing test","text":"Failing test","multi":false,"options":[{"value":"login_redirect_test keeps the next param","label":"login_redirect_test keeps the next param"}]},{"id":"next","label":"Next","text":"Next","multi":false,"options":[{"value":"proceed","label":"Proceed"},{"value":"iterate","label":"Iterate here"},{"value":"redirect","label":"Go back"},{"value":"hold","label":"Hold"}]}]}
- run_field_set and run_decision calls return {"ok":true}.

Part 1. Walk the stage from its entry until the turn ends.

Part 2. Later, the background `rt gate wait gt-5b19` finishes and re-invokes this pane, printing: {"ok":true,"status":"answered","row":{"id":"gt-5b19","kind":"plan","answer":{"answers":{"tier":"direct-tdd","failing_test":"login_redirect_test keeps the next param","next":"proceed"},"by":"console"}}}

- gate_reconcile {id: "gt-5b19", ...} returns: {"status":"answered","answers":{"tier":"direct-tdd","failing_test":"login_redirect_test keeps the next param","next":"proceed"},"decidedBy":"console","writeIn":[],"next":"proceed","actOnWriteIn":false}
- rt gate wait gt-5b19 --timeout 2s prints the same answered row as above.

Continue the list from where Part 1 ended, until the stage hands back.

Tools are unavailable in this test: you only describe. State a tool result you assume only if the scenario did not give it.

List every tool call you make, in order, with exact arguments, until the turn ends or the stage hands back. Then say how the turn ends.
