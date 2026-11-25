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
waiting, with an `error`, or answered by a listener another worktree owns
(`listener.ownsClaim` false), the way the domain rules say (its
dev-servers procedure); then `dev_endpoints` reads them again. Start only
this worktree's servers, never another worktree's. One pass starts every
role not answering, so `server-starts` counts the stage's passes before
the gate, shared by every role: two at most. A Try again at the gate runs
one more pass, counted by `gate-iterates` instead. A role that stops
answering after a pass gets only the passes left, perhaps none, before the
gate.

| Thought | Reality |
|---|---|
| "The servers are not running; I'll ask the developer to start them" | Starting them is the stage's step, not a question. Start them. |
| "A gate is opening anyway, so I'll mention the servers there" | The gate hears about a server only after the stage's start passes are spent. |

{{props.rules}}
