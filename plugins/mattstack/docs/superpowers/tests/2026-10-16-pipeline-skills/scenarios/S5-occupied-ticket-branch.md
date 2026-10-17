<!-- system file: stage-provision.md -->
You are in the provision stage (attempt 1) of a work run on project gitlab.example.com/acme/queue, run id r-20261016-abc, runDb /home/dev/.mattstack/runs/queue/r-20261016-abc/state.db (stage: provision). The orchestrator started this stage and handed you its stage file, the system prompt above. The repo's checkout is /home/dev/src/queue (the pane's cwd). A human typed the work command for ticket ACME-12 in this pane: it is attended, not a herdr pane (no HERDR_ENV), and the run has no spawnedBy. No domain rules are inlined.

The ticket ACME-12 is titled "Fix login".

Tool results in this scene (each applies only if you make that call):

- run_field_get {runDb, key: "mode"} returns not set. run_field_get {runDb, key: "ticket"} returns "ACME-12". run_field_get {runDb, key: "repo"} returns "gitlab.example.com/acme/queue".
- worktree_provision {repoName: "/home/dev/src/queue", ticket: "ACME-12", ticketTitle: "Fix login", precheck: true, ...} returns: {"kind":"precheck","branch":"acme-12-fix-login-2","base":"acme-12-fix-login","attached":[{"tree":"queue-acme-12","path":"/home/dev/.mattstack/rt/worktrees/queue/acme-12","branch":"acme-12-fix-login","treeKind":"ephemeral","state":"claimed","owner":"session:4f1c","disposal":"job","claimedAt":"2026-10-15T16:40:02Z"}],"sameTicket":[{"tree":"queue-acme-12","path":"/home/dev/.mattstack/rt/worktrees/queue/acme-12","branch":"acme-12-fix-login","treeKind":"ephemeral","state":"claimed"}],"sameSlug":[{"tree":"queue-acme-12","path":"/home/dev/.mattstack/rt/worktrees/queue/acme-12","branch":"acme-12-fix-login","treeKind":"ephemeral","state":"claimed"}],"localBranch":true}
- worktree_provision {repoName: "/home/dev/src/queue", ticket: "ACME-12", ticketTitle: "Fix login"} (no precheck, no reuse) returns: {"tree":"queue-acme-12-2","path":"/home/dev/.mattstack/rt/worktrees/queue/acme-12-2","branch":"acme-12-fix-login-2","wasOnDeck":true,"branchState":"created"} (plus "kind":"provisioned" and "recorded":true when runDb was passed).
- worktree_provision {repoName: "/home/dev/src/queue", branch: "acme-12-fix-login", reuse: true, runDb, stage: "provision"} returns: {"kind":"reused","tree":"queue-acme-12","path":"/home/dev/.mattstack/rt/worktrees/queue/acme-12","branch":"acme-12-fix-login","treeKind":"ephemeral","state":"claimed","owner":"session:4f1c","disposal":"job","recorded":true}
- worktree_provision {repoName: "/home/dev/src/queue", branch: "acme-12-fix-login"} with no reuse is refused (an error result): "branch acme-12-fix-login is already checked out in worktree queue-acme-12"
- gate_ask (any arguments) returns: {"id":"gt-2d90","presentation":"form","subject":"run:r-20261016-abc","supersededId":null,"paneAction":"form","formChunks":[{"id":"resume_in","label":"Resume in","text":"Resume in","multi":false,"options":[{"value":"resume:/home/dev/.mattstack/rt/worktrees/queue/acme-12","label":"Resume in /home/dev/.mattstack/rt/worktrees/queue/acme-12 (Recommended)"},{"value":"fresh","label":"Fresh tree"}]},{"id":"next","label":"Next","text":"Next","multi":false,"options":[{"value":"proceed","label":"Proceed"},{"value":"iterate","label":"Iterate here"},{"value":"hold","label":"Hold"}]}]}
- AskUserQuestion for that gate: the human picks "Resume in /home/dev/.mattstack/rt/worktrees/queue/acme-12 (Recommended)" and "Proceed".
- gate_answer {id: "gt-2d90", ...} returns: {"row":{"id":"gt-2d90","status":"answered","answer":{"answers":{"resume_in":"resume:/home/dev/.mattstack/rt/worktrees/queue/acme-12","next":"proceed"},"by":"pane"}},"recorded":true,"decidedBy":"pane","writeIn":[],"next":"proceed","actOnWriteIn":false}
- EnterWorktree {path} returns ok.
- run_field_set and run_decision calls return {"ok":true}.

Walk the stage from its entry.

Tools are unavailable in this test: you only describe. State a tool result you assume only if the scenario did not give it.

List every tool call you make, in order, with exact arguments, until the turn ends or the stage hands back. Then say how the turn ends.
