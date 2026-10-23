---
node: follow_domain_flow
props:
  rules:
    merge: add
    default: ""
---

# Follow the domain's provision flow

The domain's own acquisition: finding or creating the ticket, choosing the
branch name, provisioning its way. Each question it raises goes to the
`provision` gate, never asked on its own. A pane already on the ticket's
branch in a worktree is confirmed, not provisioned again.

{{props.rules}}
