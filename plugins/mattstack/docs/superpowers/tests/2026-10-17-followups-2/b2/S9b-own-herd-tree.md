<!-- system file: stage-provision.md -->
You are in the provision stage (attempt 1) of a work run on project gitlab.example.com/acme/queue, run id r-20261016-abc, runDb /home/dev/.mattstack/runs/queue/r-20261016-abc/state.db (stage: provision). The orchestrator started this stage and handed you its stage file, the system prompt above. The repo's checkout is /home/dev/src/queue (the pane's cwd). A herd shepherd spawned this pane for job acme-12 of herd hd-7 (HERD_ID=hd-7, HERD_JOB=acme-12 in the environment), and the run has spawnedBy "herd:hd-7". No domain rules are inlined.

The ticket ACME-12 is titled "Fix login".

Tool results in this scene (each applies only if you make that call):

- run_field_get {runDb, key: "mode"} returns not set. run_field_get {runDb, key: "ticket"} returns "ACME-12". run_field_get {runDb, key: "repo"} returns "gitlab.example.com/acme/queue".
- whoami {} returns {"sessionId":"7d2e-sess","pane":"w3-p2","chat":null,"herd":{"id":"hd-7","job":"acme-12","room":"herd-hd-7"}}
- worktree_provision {repoName: "/home/dev/src/queue", ticket: "ACME-12", ticketTitle: "Fix login", precheck: true, ...} returns: {"kind":"precheck","branch":"acme-12-fix-login-2","base":"acme-12-fix-login","attached":[{"tree":"queue-acme-12","path":"/home/dev/.mattstack/rt/worktrees/queue/acme-12","branch":"acme-12-fix-login","treeKind":"ephemeral","state":"claimed","owner":"herd:hd-7","disposal":"job","claimedAt":"2026-10-15T16:40:02Z"}],"sameTicket":[],"sameSlug":[],"localBranch":true}
- worktree_provision {..., branch: "acme-12-fix-login", reuse: true, runDb, stage: "provision"} (with or without takeOver) returns: {"kind":"reused","tree":"queue-acme-12","path":"/home/dev/.mattstack/rt/worktrees/queue/acme-12","branch":"acme-12-fix-login","treeKind":"ephemeral","state":"claimed","owner":"herd:hd-7","disposal":"job","recorded":true}
- worktree_provision with no precheck and no reuse returns: {"kind":"provisioned","tree":"queue-acme-12-2","path":"/home/dev/.mattstack/rt/worktrees/queue/acme-12-2","branch":"acme-12-fix-login-2","recorded":true}
- gate_ask (any arguments) returns: {"id":"gt-5a11","presentation":"form","subject":"run:r-20261016-abc","supersededId":null,"paneAction":"form","formChunks":[<the questions exactly as you passed them, 4 to a form>]}
- gate_ask under this spawned run returns paneAction "form"; AskUserQuestion is allowed for it, and the human picks the option that resumes in /home/dev/.mattstack/rt/worktrees/queue/acme-12 and "Proceed".
- gate_answer {id: "gt-5a11", ...} returns: {"row":{"id":"gt-5a11","status":"answered","answer":{"answers":{"resume_in":"resume:/home/dev/.mattstack/rt/worktrees/queue/acme-12","next":"proceed"},"by":"pane"}},"recorded":true,"decidedBy":"pane","writeIn":[],"next":"proceed","actOnWriteIn":false}
- EnterWorktree {path} returns ok.
- run_field_set and run_decision calls return {"ok":true}.

Walk the stage from its entry.

Tools are unavailable in this test: you only describe. State a tool result you assume only if the scenario did not give it.

List every tool call you make, in order, with exact arguments (for gate_ask, every question's options with their labels, in order, and which is recommended), until the turn ends or the stage hands back. Then say how the turn ends.
