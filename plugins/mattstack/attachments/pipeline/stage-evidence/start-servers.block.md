---
node: start_servers
label: Start servers
props:
  rules:
    merge: add
    default: ""
---

# Start or restart every role that is not answering

Starting this worktree's dev servers is this stage's job. Start each role
`dev_endpoints` reported unclaimed, and restart each one it reported
waiting, with an `error`, or served by another worktree, the way the
domain rules say (its dev-servers procedure); then `dev_endpoints` reads
them again. Start only this worktree's servers, never another worktree's.

| Thought | Reality |
|---|---|
| "The servers are not running; I'll ask the developer to start them" | Starting them is the stage's step, not a question. Start them. |
| "A gate is opening anyway, so I'll mention the servers there" | The gate hears about a server only after two starts failed. |

{{props.rules}}
