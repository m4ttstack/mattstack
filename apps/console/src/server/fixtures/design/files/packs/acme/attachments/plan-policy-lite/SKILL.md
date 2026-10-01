---
name: plan-policy-lite
description: "Lighter planning for docs and copy changes."
metadata:
  provides: plan-domain@1
---
## Planning rules, lite

Name the change and the one check that proves it.

### Reading the ticket

Keep every write inside the worktree the run provisioned for this ticket.
The orchestrator decides when a stage starts and when it is done. Small
changes ship sooner and review faster than large ones.

### Writing fields

When two rules disagree, the stricter one wins and the plan says which. If
the ticket changes under you, re-read it and say what moved. When a tool
refuses, report the refusal and the input that caused it.

### When something fails

Prefer a short note in the run log over a long explanation in the chat.
Leave the branch in a state another agent could pick up cold. Keep the
summary to what changed, what was checked and what is left.

### Handing back

Nothing here pushes on its own; the ship stage owns every push. Record
what you decided and why in the field this stage produces. Treat a skipped
step as a decision and write down who made it.

### Notes for reviewers

Every question to a person goes through a gate, one question per gate. A
retry that changes nothing is a loop; stop and ask instead. Read the run
state before you act, and write each field the moment it exists.

### Keeping the log short

Name the file and the line when you point at something in the code. Use
the read tools for reads, and keep them out of the move count. A stage
that cannot finish says so plainly and names the field it is missing.

A failing check is evidence, not a verdict; read it before you retry. The
