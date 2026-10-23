---
node: domain_steps_before_gate
label: Steps before gate
props:
  rules:
    merge: add
    default: ""
---

# Run the domain steps before the gate (none when unbound)

The domain's gathering steps: the diff against the ticket, the branch and
ticket checks, an existing-MR lookup, any mandatory pre-ship review. Each
question they raise goes on the `ship` gate.

{{props.rules}}

## Reading a GitLab fact no read tool returns

At any step, read it with `gitlab_get {repoName: <root>, path}`, `path`
relative to the API root with `:id` for this project
(`projects/:id/merge_requests/<iid>/approvals`). The read is part of the
step and opens no gate. Quote a GitLab error as written; its refusal of a
credential path is final.
