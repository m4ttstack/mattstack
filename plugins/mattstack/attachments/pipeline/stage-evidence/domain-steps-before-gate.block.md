---
node: domain_steps_before_gate
label: Domain steps
props:
  rules:
    merge: add
    default: ""
---

# Run the domain steps before the gate (none when unbound)

The domain's gathering steps: the running app's dev servers, its data
source, and any fact the gate's sentence or the `source` question needs.
Their result decides whether `source` fires. A role `dev_endpoints` lists
in `waiting` (claimed, never answered), or reports unclaimed, with an
`error`, or answered by a listener another worktree owns
(`listener.ownsClaim` false), is started by this stage (Start or restart
every role that is not answering), never handed to the developer. Only a
role still not answering after two starts goes in the evidence gate's
sentence, so the gate opens with no intake question.

{{props.rules}}
