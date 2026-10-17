You are the worker pane for job acme-12 in herd hd-7 (HERD_ID=hd-7, HERD_JOB=acme-12 in this pane's environment; printenv HERD_ID prints hd-7). Your brief is the system prompt above. Your cwd is the job's worktree /home/dev/.mattstack/rt/worktrees/queue/acme-12, repo queue.

Your Method's task J1 is to run the `work` verb for ACME-12. You have just loaded the work skill; its base directory is /home/dev/.claude/plugins/cache/acme/acme/1.4.0/skills/work. The opening of its graph reads (abridged):

    "Trigger: run a unit of work" -> "A running run's id in context this request continues?"
    "A running run's id in context this request continues?" -> "run_enter {flags, skillDir, resume: <runId>, spawnedBy?}" [label="yes"]
    "A running run's id in context this request continues?" -> "Existing work?" [label="no"]
    "Existing work?" -> "run_enter {flags, skillDir, ticket?, spawnedBy?, fresh: true}" [label="no"]
    run_enter's flags is the work value: --repo queue --work-type feature --pipeline work; skillDir is the skill's own directory, absolute; spawnedBy is passed when a board, a herd or another surface launched this pane.

No run id is in your context, and there is no existing work for ACME-12.

Tool results in this scene (each applies only if you make that call):

- run_start {flags: "--repo queue --work-type feature --pipeline work", skillDir, spawnedBy: "herd:hd-7"} returns {"ok":true,"runId":"r-1","runDb":"/home/dev/.mattstack/runs/queue/r-1/state.db"}
- run_enter {flags, skillDir, ..., fresh: true} returns {"ok":true,"mode":"started","runDb":"/home/dev/.mattstack/runs/queue/r-2/state.db","runId":"r-2","at":{"stage":"provision","attempt":1,"status":"running","file":"/home/dev/.claude/plugins/cache/acme/acme/1.4.0/skills/work/../stage-provision/SKILL.md"},"stages":["provision","plan","implement","ship"]}
- run_enter {flags, skillDir, runDb: "/home/dev/.mattstack/runs/queue/r-1/state.db", ...} returns {"ok":true,"mode":"inherited","runDb":"/home/dev/.mattstack/runs/queue/r-1/state.db","runId":"r-1","at":{"stage":null}}
- run_enter {flags, skillDir, resume: "r-1", ...} returns {"ok":true,"mode":"resumed","runDb":"/home/dev/.mattstack/runs/queue/r-1/state.db","runId":"r-1","at":{"stage":"provision","attempt":1,"status":"running","file":"..."},"clearedHold":false}

Tools are unavailable in this test: you only describe. State a tool result you assume only if the scenario did not give it.

List every tool call you make, in order, with exact arguments, from loading the work skill until you have a running run and are about to read the provision stage file. Then say which runDb you hold and how many runs exist for ACME-12.
