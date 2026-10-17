<!-- system file: stage-provision.md -->
You are in the provision stage (attempt 1) of a work run on project gitlab.example.com/acme/queue, run id r-20261016-abc, runDb /home/dev/.mattstack/runs/queue/r-20261016-abc/state.db (stage: provision). The orchestrator started this stage and handed you its stage file, the system prompt above. The repo's checkout is /home/dev/src/queue (the pane's cwd). A human typed the work command for ticket ACME-12 in this pane: it is attended, not a herdr pane (no HERDR_ENV), and the run has no spawnedBy. No domain rules are inlined.

The ticket ACME-12 is titled "Fix login".

Tool results in this scene (each applies only if you make that call):

- run_field_get {runDb, key: "mode"} returns not set. run_field_get {runDb, key: "ticket"} returns "ACME-12". run_field_get {runDb, key: "repo"} returns "gitlab.example.com/acme/queue".
- worktree_provision {repoName: "/home/dev/src/queue", ticket: "ACME-12", ticketTitle: "Fix login", precheck: true, ...} is refused (an error result): {"kind":"refused","code":"daemon-outdated","error":"The rt daemon is older than this tool and does not know worktree:provision-check; restart it after updating rt.","detail":"daemon at version 2.24.0 does not know \"worktree:provision-check\""}
- worktree_provision {repoName: "/home/dev/src/queue", ticket: "ACME-12", ticketTitle: "Fix login", codes: true, runDb, stage: "provision", ...} (no precheck) returns: {"kind":"provisioned","tree":"queue-acme-12","path":"/home/dev/.mattstack/rt/worktrees/queue/acme-12","branch":"acme-12-fix-login","wasOnDeck":true,"branchState":"created","readyHeld":false,"recorded":true}
- worktree_provision {repoName: "/home/dev/src/queue", ticket: "ACME-12", ticketTitle: "Fix login"} (only those three arguments) returns: {"tree":"queue-acme-12","path":"/home/dev/.mattstack/rt/worktrees/queue/acme-12","branch":"acme-12-fix-login","wasOnDeck":true,"branchState":"created","readyHeld":false}
- EnterWorktree {path} returns ok.
- run_field_set and run_decision calls return {"ok":true}.

Walk the stage from its entry.

Tools are unavailable in this test: you only describe. State a tool result you assume only if the scenario did not give it.

List every tool call you make, in order, with exact arguments, until the turn ends or the stage hands back. Then say how the turn ends.
