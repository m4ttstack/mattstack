---
name: plan-policy
description: "How acme plans a change before any code."
metadata:
  provides: plan-domain@1
---
## Planning rules

Read the ticket's acceptance criteria before choosing an approach.
Prefer the smallest change that meets every criterion.
Name the evidence you will capture, and where, in the plan itself.
If the approach needs a feature flag, say which one and its default.

### When the ticket is unclear

Ask through a gate rather than guessing. One question per gate.

### Edge cases

Keep every write inside the worktree the run provisioned for this ticket.
The orchestrator decides when a stage starts and when it is done. Small
changes ship sooner and review faster than large ones.

### Before you start

When two rules disagree, the stricter one wins and the plan says which. If
the ticket changes under you, re-read it and say what moved. When a tool
refuses, report the refusal and the input that caused it.

### Reading the ticket

Prefer a short note in the run log over a long explanation in the chat.
Leave the branch in a state another agent could pick up cold. Keep the
summary to what changed, what was checked and what is left.

### Writing fields

Nothing here pushes on its own; the ship stage owns every push. Record
what you decided and why in the field this stage produces. Treat a skipped
step as a decision and write down who made it.

### When something fails

Every question to a person goes through a gate, one question per gate. A
retry that changes nothing is a loop; stop and ask instead. Read the run
state before you act, and write each field the moment it exists.

### Handing back

Name the file and the line when you point at something in the code. Use
the read tools for reads, and keep them out of the move count. A stage
that cannot finish says so plainly and names the field it is missing.

### Notes for reviewers

A failing check is evidence, not a verdict; read it before you retry. The
evidence plan names what you will capture and where it will live. Keep
every write inside the worktree the run provisioned for this ticket.

### Keeping the log short

The orchestrator decides when a stage starts and when it is done. Small
changes ship sooner and review faster than large ones. When two rules
disagree, the stricter one wins and the plan says which.

### Edge cases

If the ticket changes under you, re-read it and say what moved. When a
tool refuses, report the refusal and the input that caused it. Prefer a
short note in the run log over a long explanation in the chat.

## Planning rules

Read the ticket's acceptance criteria before choosing an approach.
Prefer the smallest change that meets every criterion.
Name the evidence you will capture, and where, in the plan itself.
If the approach needs a feature flag, say which one and its default.

### When the ticket is unclear

Ask through a gate rather than guessing. One question per gate.

### Hand-off

The plan's last line names the first file you will change.

