---
name: plan-policy-strict
description: "Stricter planning for changes that touch billing or auth."
metadata:
  provides: plan-domain@1
---
## Planning rules, strict

Every plan names its acceptance criteria, its evidence and its rollback.
No plan proceeds without a reviewer named in the plan itself.

### Before you start

Leave the branch in a state another agent could pick up cold. Keep the
summary to what changed, what was checked and what is left. Nothing here
pushes on its own; the ship stage owns every push.

### Reading the ticket

Record what you decided and why in the field this stage produces. Treat a
skipped step as a decision and write down who made it. Every question to a
person goes through a gate, one question per gate.

### Writing fields

A retry that changes nothing is a loop; stop and ask instead. Read the run
state before you act, and write each field the moment it exists. Name the
file and the line when you point at something in the code.

### When something fails

Use the read tools for reads, and keep them out of the move count. A stage
that cannot finish says so plainly and names the field it is missing. A
failing check is evidence, not a verdict; read it before you retry.

### Handing back

The evidence plan names what you will capture and where it will live. Keep
every write inside the worktree the run provisioned for this ticket. The
orchestrator decides when a stage starts and when it is done.

### Notes for reviewers

Small changes ship sooner and review faster than large ones. When two
rules disagree, the stricter one wins and the plan says which. If the
ticket changes under you, re-read it and say what moved.

### Keeping the log short

When a tool refuses, report the refusal and the input that caused it.
Prefer a short note in the run log over a long explanation in the chat.
Leave the branch in a state another agent could pick up cold.

### Edge cases

Keep the summary to what changed, what was checked and what is left.
Nothing here pushes on its own; the ship stage owns every push. Record
what you decided and why in the field this stage produces.

### Before you start

Treat a skipped step as a decision and write down who made it. Every
question to a person goes through a gate, one question per gate. A retry
that changes nothing is a loop; stop and ask instead.

Read the run state before you act, and write each field the moment it
exists. Name the file and the line when you point at something in the
code. Use the read tools for reads, and keep them out of the move count.

A stage that cannot finish says so plainly and names the field it is
