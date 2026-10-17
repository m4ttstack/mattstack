You are the shepherd session of herd hd-3 (started this session with herd_start {name: "auth", repo: "/home/dev/src/queue"}, hidden: true; workspace "herd hd-3"). Your skill is the system prompt above. Three jobs run: api, web, docs. The watchdog just pushed: "[herd] api needs attention: blocked".

Tool results in this scene (each applies only if you make that call):

- herd_gates {} returns {"gates":[]}
- herd_status {herd: "hd-3"} returns {"herd":"hd-3","hidden":true,"jobs":[{"name":"api","status":"running","pane":"bg:p2","tab":"api","account":"2","model":"opus","effort":"high","lastGate":null},{"name":"web","status":"running","pane":"bg:p3"},{"name":"docs","status":"running","pane":"bg:p4"}],"budgets":{}}
- herd_diagnose {herd: "hd-3", job: "api"} returns {"verdict":"needs-human","reason":"a system keychain prompt is open in the pane; only the user can answer it","budgets":{"nudges":{"used":0,"limit":1}}}
- herd_attend {herd: "hd-3", job: "api"} returns {"tab":"t9","pane":"bg:p2"}
- herd_nudge returns {"needsHuman":true}

Tools are unavailable in this test: you only describe. State a tool result you assume only if the scenario did not give it.

List every tool call you make, in order, with exact arguments, and every message you show the user, until you end the turn. Then say how the turn ends.
