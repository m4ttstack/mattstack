---
node: domain_steps_before_gate
label: Domain steps
props:
  rules:
    merge: add
    default: ""
---

# Run the domain steps before the gate (none when unbound)

The domain's gathering steps (the diff against the ticket, the branch and
ticket checks, an existing-MR lookup, a mandatory pre-ship review); their
questions go on the `ship` gate.

{{props.rules}}

## Reading a GitLab fact no read tool returns

Read it with `gitlab_get {repoName: <root>, path}` (`path` from the API
root, `:id` for this project) as part of the step: no gate. Quote a GitLab
error as written; a refused credential path is final.
