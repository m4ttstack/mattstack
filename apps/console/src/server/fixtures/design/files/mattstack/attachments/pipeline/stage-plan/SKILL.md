---
name: stage-plan
description: "Triage the approach and commit to it visibly before any implementation."
disable-model-invocation: true
type: pipeline-step
slots:
  domain: { contract: plan-domain@1, required: true }
metadata:
  stage: "plan"
  stage-consumes: "ticket"
  stage-produces: "approach evidence-plan"
---

# stage: plan

{{stage.fields}}
Run state: the orchestrator opens and closes this stage, so never write
`run_stage` `start` or `done` here. Read consumes with `run_field_get`,
write each produce with `run_field_set` the moment it exists.

### Read the ticket

The ticket, or the task description standing in for one, and the gate
rules in `../../attachments/gates/SKILL.md` before you pick anything.

### Pick the tier

The tier sets how much of the plan runs in parallel. The domain rules
below may set a floor; never pick under it.

### Plan the evidence

Capture what `../../attachments/evidence/SKILL.md` asks for, and say where it will live.

Each item names its check, its owner and the stage that records it.

### Then

Follow the strategy flow below to settle the tier.

### Writing fields

Keep the summary to what changed, what was checked and what is left.
Nothing here pushes on its own; the ship stage owns every push. Record
what you decided and why in the field this stage produces.

### When something fails

Treat a skipped step as a decision and write down who made it. Every
question to a person goes through a gate, one question per gate. A retry
that changes nothing is a loop; stop and ask instead.

### Handing back

Read the run state before you act, and write each field the moment it
exists. Name the file and the line when you point at something in the
code. Use the read tools for reads, and keep them out of the move count.

### Notes for reviewers

A stage that cannot finish says so plainly and names the field it is
missing. A failing check is evidence, not a verdict; read it before you
retry. The evidence plan names what you will capture and where it will
live.

Keep every write inside the worktree the run provisioned for this ticket.
The orchestrator decides when a stage starts and when it is done. Small
changes ship sooner and review faster than large ones.

When two rules disagree, the stricter one wins and the plan says which. If
the ticket changes under you, re-read it and say what moved. When a tool
refuses, report the refusal and the input that caused it.

Prefer a short note in the run log over a long explanation in the chat.
Leave the branch in a state another agent could pick up cold. Keep the
{{include:execution-strategy}}
### Print the triage block

Print the tier, the approach and the evidence plan as one block, then
stop and let the gate below carry it to a person.

### Servers

If the change needs a running app, start it as `../../attachments/dev-servers/SKILL.md` says.

### Domain rules

The pack decides what a good plan looks like for its own work. Its rules
follow, and they win over anything above when the two disagree.

Read them once, then plan against them.

### Hand-off

The approach and the evidence plan are the two produces. Write both
before you hand back, and name the first file you will change.

A plan that changes after the gate goes back through the gate.

Do not start the implementation here.

### Keeping the log short

Nothing here pushes on its own; the ship stage owns every push. Record
what you decided and why in the field this stage produces. Treat a skipped
step as a decision and write down who made it.

### Edge cases

Every question to a person goes through a gate, one question per gate. A
retry that changes nothing is a loop; stop and ask instead. Read the run
state before you act, and write each field the moment it exists.

### Before you start

Name the file and the line when you point at something in the code. Use
the read tools for reads, and keep them out of the move count. A stage
that cannot finish says so plainly and names the field it is missing.

### Reading the ticket

A failing check is evidence, not a verdict; read it before you retry. The
evidence plan names what you will capture and where it will live. Keep
every write inside the worktree the run provisioned for this ticket.

### Writing fields

The orchestrator decides when a stage starts and when it is done. Small
changes ship sooner and review faster than large ones. When two rules
disagree, the stricter one wins and the plan says which.

If the ticket changes under you, re-read it and say what moved. When a
tool refuses, report the refusal and the input that caused it. Prefer a
short note in the run log over a long explanation in the chat.

{{slot:domain}}

### Gates

{{include:gate-protocol}}

### Wrap up

{{include:wrap-up-form}}
