<!-- system file: stage-provision.md -->
You are in the provision stage (attempt 1) of a work run on project gitlab.example.com/acme/queue, run id r-20261016-abc, runDb /home/dev/.mattstack/runs/queue/r-20261016-abc/state.db (stage: provision). The orchestrator started this stage and handed you its stage file, the system prompt above. The repo's checkout is /home/dev/src/queue (the pane's cwd). A human typed the work command for ticket ACME-12 in this pane: it is attended, and the run has no spawnedBy. No domain rules are inlined.

The ticket ACME-12 is titled "Fix login".

Tool results in this scene (each applies only if you make that call):

- run_field_get {runDb, key: "mode"} returns not set. run_field_get {runDb, key: "ticket"} returns "ACME-12". run_field_get {runDb, key: "repo"} returns "gitlab.example.com/acme/queue".
- whoami {} returns {"sessionId":"7d2e-sess","pane":"w3-p2","chat":null,"herd":null}
- worktree_provision {repoName: "/home/dev/src/queue", ticket: "ACME-12", ticketTitle: "Fix login", precheck: true, ...} returns: {"kind":"precheck","branch":"acme-12-fix-login-2","base":"acme-12-fix-login","attached":[{"tree":"queue-acme-12","path":"/home/dev/.mattstack/rt/worktrees/queue/acme-12","branch":"acme-12-fix-login","treeKind":"ephemeral","state":"claimed","owner":"herd:nightly-0915","disposal":"job","claimedAt":"2026-10-15T16:40:02Z"}],"sameTicket":[],"sameSlug":[],"localBranch":true}
- worktree_provision {..., branch: "acme-12-fix-login", reuse: true, ...} WITHOUT takeOver is refused (an error result): {"kind":"refused","code":"tree-held","tree":"queue-acme-12","owner":"herd:nightly-0915","claimedAt":"2026-10-15T16:40:02Z","error":"worktree queue-acme-12 is held by herd:nightly-0915 since 2026-10-15T16:40:02Z; reuse it only after the human picks it, by calling again with takeOver: true"}
- worktree_provision {..., branch: "acme-12-fix-login", reuse: true, takeOver: true, runDb, stage: "provision"} returns: {"kind":"reused","tree":"queue-acme-12","path":"/home/dev/.mattstack/rt/worktrees/queue/acme-12","branch":"acme-12-fix-login","treeKind":"ephemeral","state":"claimed","owner":"herd:nightly-0915","disposal":"job","recorded":true}
- worktree_provision with no precheck and no reuse returns: {"kind":"provisioned","tree":"queue-acme-12-2","path":"/home/dev/.mattstack/rt/worktrees/queue/acme-12-2","branch":"acme-12-fix-login-2","recorded":true}
- gate_ask (any arguments) returns: {"id":"gt-5a11","presentation":"form","subject":"run:r-20261016-abc","supersededId":null,"paneAction":"form","formChunks":[<the questions exactly as you passed them, 4 to a form>]}
- AskUserQuestion for that gate: the human picks the option that resumes in /home/dev/.mattstack/rt/worktrees/queue/acme-12 (whatever its label says) and "Proceed". They add the note: "that nightly herd is gone, take the tree".
- gate_answer {id: "gt-5a11", ...} returns: {"row":{"id":"gt-5a11","status":"answered","answer":{"answers":{"resume_in":"resume:/home/dev/.mattstack/rt/worktrees/queue/acme-12","next":"proceed"},"by":"pane"}},"recorded":true,"decidedBy":"pane","writeIn":[],"next":"proceed","actOnWriteIn":false}
- EnterWorktree {path} returns ok.
- run_field_set and run_decision calls return {"ok":true}.

Walk the stage from its entry.

Tools are unavailable in this test: you only describe. State a tool result you assume only if the scenario did not give it.

List every tool call you make, in order, with exact arguments (for gate_ask, every question's options with their labels, in order, and which is recommended), until the turn ends or the stage hands back. Then say how the turn ends.
