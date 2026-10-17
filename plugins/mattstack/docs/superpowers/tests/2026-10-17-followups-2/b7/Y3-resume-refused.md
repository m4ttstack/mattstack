<!-- system file: sync-open-mrs.md -->
A developer typed the sync-open-mrs command by hand in this pane (an attended Claude Code session, not launched by a board or any surface, no runDb handed to you). The checkout is /home/dev/src/queue (the pane's cwd), on GitLab at gitlab.example.com/acme/queue. The skill's directory is /home/dev/.claude/plugins/cache/mattstack/mattstack/0.31.22/skills/sync-open-mrs. Earlier today a session in this same pane started a sync-open-mrs run, r-20261017-a1, which stopped at the sweep gate with the sweep already answered (proceed with branches acme-3-fix and acme-4-docs).

Tool results in this scene (each applies only if you make that call):

- run_list {repo: "pack", ...} returns [{"id":"r-20261017-a1","repo":"pack","work_type":"sync-open-mrs","status":"running","current_stage":"sync-open-mrs","spawned_by":null,"started_at":"2026-10-17T09:02:11Z"}]
- run_enter with no resume and no fresh returns {"ok":true,"mode":"candidates","candidates":[{"runId":"r-20261017-a1","runDb":"/home/dev/.mattstack/runs/pack/r-20261017-a1/state.db","startedAt":1760691731000,"spawnedBy":null,"currentStage":"sync-open-mrs","ownSession":true}]}
- run_enter {..., resume: "r-20261017-a1"} is refused (an error result): "could not open run r-20261017-a1: database is locked"
- run_enter {..., fresh: true} returns {"ok":true,"mode":"started","runDb":"/home/dev/.mattstack/runs/pack/r-20261017-b2/state.db","runId":"r-20261017-b2","at":{"stage":"sync-open-mrs","attempt":1,"status":"running","file":null},"stages":["sync-open-mrs"]}
- run_start returns {"ok":true,"runId":"r-20261017-b2","runDb":"/home/dev/.mattstack/runs/pack/r-20261017-b2/state.db"}
- run_stage, run_field_set and run_decision calls return {"ok":true}.
- run_snapshot {runDb: "/home/dev/.mattstack/runs/pack/r-20261017-a1/state.db"} returns {"run":{"id":"r-20261017-a1","status":"running","current_stage":"sync-open-mrs"},"stages":[{"name":"sync-open-mrs","attempt":1,"status":"running"}],"fields":[{"key":"hold","value":"-"}],"decisions":[{"contract":"gate@1","scope":"sweep","selection":"{\"answers\":{\"branches-1\":[\"acme-3-fix\",\"acme-4-docs\"],\"next\":\"proceed\"}}","decidedBy":"pane"}]}
- The in-pane structured question for the resume choice: the developer picks the Resume option for r-20261017-a1.
- git -C /home/dev/src/queue remote get-url origin prints git@gitlab.example.com:acme/queue.git

Walk the verb from its trigger until it reads the forge remote or ends, whichever comes first.

Tools are unavailable in this test: you only describe. State a tool result you assume only if the scenario did not give it.

List every tool call you make, in order, with exact arguments, until you stop. Then say which runDb you hold, if any, and how many sync-open-mrs runs are running when you stop.
