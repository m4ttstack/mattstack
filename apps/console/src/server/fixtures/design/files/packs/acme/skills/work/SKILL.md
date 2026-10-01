---
name: "work"
description: "Runs a unit of work end to end, from provisioning through ship and CI."
allowed-tools:
  - "Bash(git -C *:*)"
  - "Bash(*/scripts/ci-triage.sh:*)"
  - "Bash(*/scripts/ci-forge.sh:*)"
metadata:
  compiled: "mattstack:work@0.28.10 + mattstack:model-tiering@0.28.10 + mattstack:gate-protocol@0.28.10 + mattstack:wrap-up-form@0.28.10"
---

<!-- compiled by rt skills compile from the sources below; slots pre-resolved; edits here are working-tree drift (rt skills promote) -->

<!-- part: step source=mattstack:work version=0.28.10 lines=13-250 -->


# work -- the pipeline orchestrator

You run one unit of work through eight stages. The graph below is the run:
follow its edges, and treat a move it does not show as a question for a
gate, never as a judgment call. Reads through the read tools and
`gitlab_get` are part of the step that needs them, not moves. Every `run_*`
call passes `runDb`.

## Stages

Walk them in this order. Each file sits beside this one; read it when its
stage starts, and follow it.

| Stage | Read | Consumes | Produces |
|---|---|---|---|
| `provision` | `${CLAUDE_SKILL_DIR}/../../attachments/stage-provision/SKILL.md` | `ticket` `repo` | `branch`
| `plan` | `${CLAUDE_SKILL_DIR}/../../attachments/stage-plan/SKILL.md` | `ticket` | `approach` `evidence-plan
| `gates` | `${CLAUDE_SKILL_DIR}/../../attachments/stage-gates/SKILL.md` | `approach` `worktree` | nothing |
| `evidence` | `${CLAUDE_SKILL_DIR}/../../attachments/stage-evidence/SKILL.md` | `evidence-plan` `worktree` |
| `implement` | `${CLAUDE_SKILL_DIR}/../../attachments/stage-implement/SKILL.md` | `approach` `branch` `workt
| `self-review` | `${CLAUDE_SKILL_DIR}/../../attachments/stage-self-review/SKILL.md` | `commits` | `review` |
| `ship` | `${CLAUDE_SKILL_DIR}/../../attachments/stage-ship/SKILL.md` | `commits` `ticket` | `mr` |
| `watch-ci` | `${CLAUDE_SKILL_DIR}/../../attachments/stage-watch-ci/SKILL.md` | `mr` `branch` | `ci` |

`run_start` takes these flags verbatim:

```json
{
  "work": "--repo gitlab.example.com/acme/storefront --work-type work --pipeline work --mattstack-sha 4f2a9c1 --mattstack-dirty 0 --pack-sha 9b07e3d"
}
```

```dot
digraph work {
rankdir=TB;

"Work entered" [shape=ellipse];
"run_start with the flags above" [shape=plaintext];
"Next stage?" [shape=diamond];
"Read the stage file and follow it" [shape=box];
"Stage failed?" [shape=diamond];
"Gate: retry, hold or stop" [shape=box];
"Work done" [shape=doublecircle];

"Work entered" -> "run_start with the flags above";
"run_start with the flags above" -> "Next stage?";
"Next stage?" -> "Read the stage file and follow it" [label="one left"];
"Next stage?" -> "Work done" [label="none left"];
"Read the stage file and follow it" -> "Stage failed?";
"Stage failed?" -> "Next stage?" [label="no"];
"Stage failed?" -> "Gate: retry, hold or stop" [label="yes"];
}
```

## Running a stage

Stop at the first stage that fails and retry it once before you gate.

### Edge cases

The orchestrator decides when a stage starts and when it is done. Small
changes ship sooner and review faster than large ones. When two rules
disagree, the stricter one wins and the plan says which.

### Before you start

If the ticket changes under you, re-read it and say what moved. When a
tool refuses, report the refusal and the input that caused it. Prefer a
short note in the run log over a long explanation in the chat.

### Reading the ticket

Leave the branch in a state another agent could pick up cold. Keep the
summary to what changed, what was checked and what is left. Nothing here
pushes on its own; the ship stage owns every push.

### Writing fields

Record what you decided and why in the field this stage produces. Treat a
skipped step as a decision and write down who made it. Every question to a
person goes through a gate, one question per gate.

### When something fails

A retry that changes nothing is a loop; stop and ask instead. Read the run
state before you act, and write each field the moment it exists. Name the
file and the line when you point at something in the code.

### Handing back

Use the read tools for reads, and keep them out of the move count. A stage
that cannot finish says so plainly and names the field it is missing. A
failing check is evidence, not a verdict; read it before you retry.

### Notes for reviewers

The evidence plan names what you will capture and where it will live. Keep
every write inside the worktree the run provisioned for this ticket. The
orchestrator decides when a stage starts and when it is done.

### Keeping the log short

Small changes ship sooner and review faster than large ones. When two
rules disagree, the stricter one wins and the plan says which. If the
ticket changes under you, re-read it and say what moved.

### Edge cases

When a tool refuses, report the refusal and the input that caused it.
Prefer a short note in the run log over a long explanation in the chat.
Leave the branch in a state another agent could pick up cold.

### Before you start

Keep the summary to what changed, what was checked and what is left.
Nothing here pushes on its own; the ship stage owns every push. Record
what you decided and why in the field this stage produces.

### Reading the ticket

Treat a skipped step as a decision and write down who made it. Every
question to a person goes through a gate, one question per gate. A retry
that changes nothing is a loop; stop and ask instead.

### Writing fields

Read the run state before you act, and write each field the moment it
exists. Name the file and the line when you point at something in the
code. Use the read tools for reads, and keep them out of the move count.

### When something fails

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

### Handing back

Prefer a short note in the run log over a long explanation in the chat.
Leave the branch in a state another agent could pick up cold. Keep the
summary to what changed, what was checked and what is left.

### Notes for reviewers

Nothing here pushes on its own; the ship stage owns every push. Record
what you decided and why in the field this stage produces. Treat a skipped
step as a decision and write down who made it.

### Keeping the log short

Every question to a person goes through a gate, one question per gate. A
retry that changes nothing is a loop; stop and ask instead. Read the run
state before you act, and write each field the moment it exists.

### Edge cases

Name the file and the line when you point at something in the code. Use
the read tools for reads, and keep them out of the move count. A stage
that cannot finish says so plainly and names the field it is missing.

### Before you start

A failing check is evidence, not a verdict; read it before you retry. The
evidence plan names what you will capture and where it will live. Keep
every write inside the worktree the run provisioned for this ticket.

### Reading the ticket

The orchestrator decides when a stage starts and when it is done. Small
changes ship sooner and review faster than large ones. When two rules
disagree, the stricter one wins and the plan says which.

### Writing fields

If the ticket changes under you, re-read it and say what moved. When a
tool refuses, report the refusal and the input that caused it. Prefer a
short note in the run log over a long explanation in the chat.

### When something fails

Leave the branch in a state another agent could pick up cold. Keep the
summary to what changed, what was checked and what is left. Nothing here
pushes on its own; the ship stage owns every push.

### Handing back

Record what you decided and why in the field this stage produces. Treat a
skipped step as a decision and write down who made it. Every question to a
person goes through a gate, one question per gate.

### Notes for reviewers

A retry that changes nothing is a loop; stop and ask instead. Read the run
state before you act, and write each field the moment it exists. Name the
file and the line when you point at something in the code.

### Keeping the log short

Use the read tools for reads, and keep them out of the move count. A stage
that cannot finish says so plainly and names the field it is missing. A
failing check is evidence, not a verdict; read it before you retry.

### Edge cases

The evidence plan names what you will capture and where it will live. Keep
every write inside the worktree the run provisioned for this ticket. The
orchestrator decides when a stage starts and when it is done.

### Before you start

Small changes ship sooner and review faster than large ones. When two
rules disagree, the stricter one wins and the plan says which. If the
ticket changes under you, re-read it and say what moved.

### Reading the ticket

When a tool refuses, report the refusal and the input that caused it.
Prefer a short note in the run log over a long explanation in the chat.
Leave the branch in a state another agent could pick up cold.


## Model tiering

<!-- part: slot:tiering binding=mattstack:model-tiering version=0.28.10 lines=6-95 -->

## Model tiering

### Reading the ticket

Name the file and the line when you point at something in the code. Use
the read tools for reads, and keep them out of the move count. A stage
that cannot finish says so plainly and names the field it is missing.

### Writing fields

A failing check is evidence, not a verdict; read it before you retry. The
evidence plan names what you will capture and where it will live. Keep
every write inside the worktree the run provisioned for this ticket.

### When something fails

The orchestrator decides when a stage starts and when it is done. Small
changes ship sooner and review faster than large ones. When two rules
disagree, the stricter one wins and the plan says which.

### Handing back

If the ticket changes under you, re-read it and say what moved. When a
tool refuses, report the refusal and the input that caused it. Prefer a
short note in the run log over a long explanation in the chat.

### Notes for reviewers

Leave the branch in a state another agent could pick up cold. Keep the
summary to what changed, what was checked and what is left. Nothing here
pushes on its own; the ship stage owns every push.

### Keeping the log short

Record what you decided and why in the field this stage produces. Treat a
skipped step as a decision and write down who made it. Every question to a
person goes through a gate, one question per gate.

### Edge cases

A retry that changes nothing is a loop; stop and ask instead. Read the run
state before you act, and write each field the moment it exists. Name the
file and the line when you point at something in the code.

### Before you start

Use the read tools for reads, and keep them out of the move count. A stage
that cannot finish says so plainly and names the field it is missing. A
failing check is evidence, not a verdict; read it before you retry.

### Reading the ticket

The evidence plan names what you will capture and where it will live. Keep
every write inside the worktree the run provisioned for this ticket. The
orchestrator decides when a stage starts and when it is done.

### Writing fields

Small changes ship sooner and review faster than large ones. When two
rules disagree, the stricter one wins and the plan says which. If the
ticket changes under you, re-read it and say what moved.

### When something fails

When a tool refuses, report the refusal and the input that caused it.
Prefer a short note in the run log over a long explanation in the chat.
Leave the branch in a state another agent could pick up cold.

### Handing back

Keep the summary to what changed, what was checked and what is left.
Nothing here pushes on its own; the ship stage owns every push. Record
what you decided and why in the field this stage produces.

### Notes for reviewers

Treat a skipped step as a decision and write down who made it. Every
question to a person goes through a gate, one question per gate. A retry
that changes nothing is a loop; stop and ask instead.

### Keeping the log short

Read the run state before you act, and write each field the moment it
exists. Name the file and the line when you point at something in the
code. Use the read tools for reads, and keep them out of the move count.

A stage that cannot finish says so plainly and names the field it is
missing. A failing check is evidence, not a verdict; read it before you
retry. The evidence plan names what you will capture and where it will
live.

## Gates

<!-- part: include:gate-protocol source=mattstack:gate-protocol version=0.28.10 lines=7-455 -->
# Gate protocol

One shared protocol for any gated pane or wrapper: publish first, then act
on the presentation the daemon returns. The daemon's gate registry is the
single arbiter; no per-verb conflict logic belongs anywhere downstream of
it. Every gate walks this graph: the site names the scope, the questions
and the selection; this part publishes, answers and records.

If a site's questions or a rule in the including verb ask for a move this
graph marks STOP, open the Off-script gate (below) instead.

```dot
digraph gate_protocol {
rankdir=TB;

"Trigger: a site reaches its gate" [shape=ellipse];
"Build the gate's questions and context" [shape=box];
"Under a run: bracket the gate?" [shape=diamond];
"run_field_set {key: gate, value: <scope>, stage}" [shape=plaintext];
"gate_ask {questions, kind: <scope>, context?, subject?}" [shape=plaintext];
"gate_ask result?" [shape=diamond];
"Fixed this gate_ask call once already?" [shape=diamond];
"Fix what the gate_ask refusal names" [shape=box];
"Daemon down: is the gated pane unattended?" [shape=diamond];
"Under a run: fail the stage at the gate?" [shape=diamond];
"Present the gate form with no registry" [shape=box];
"gate_ask presentation?" [shape=diamond];
"Act on the presentation" [shape=box];
"Record the answer" [shape=box];
"Gate closed" [shape=doublecircle];

"Trigger: a site reaches its gate" -> "Build the gate's questions and context";
"Build the gate's questions and context" -> "Under a run: bracket the gate?";
"gate_ask presentation?" -> "Act on the presentation" [label="form"];
"Act on the presentation" -> "Record the answer";
"Record the answer" -> "Gate closed";
}
```

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

### When something fails

If the ticket changes under you, re-read it and say what moved. When a
tool refuses, report the refusal and the input that caused it. Prefer a
short note in the run log over a long explanation in the chat.

### Handing back

Leave the branch in a state another agent could pick up cold. Keep the
summary to what changed, what was checked and what is left. Nothing here
pushes on its own; the ship stage owns every push.

### Notes for reviewers

Record what you decided and why in the field this stage produces. Treat a
skipped step as a decision and write down who made it. Every question to a
person goes through a gate, one question per gate.

### Keeping the log short

A retry that changes nothing is a loop; stop and ask instead. Read the run
state before you act, and write each field the moment it exists. Name the
file and the line when you point at something in the code.

### Edge cases

Use the read tools for reads, and keep them out of the move count. A stage
that cannot finish says so plainly and names the field it is missing. A
failing check is evidence, not a verdict; read it before you retry.

### Before you start

The evidence plan names what you will capture and where it will live. Keep
every write inside the worktree the run provisioned for this ticket. The
orchestrator decides when a stage starts and when it is done.

### Reading the ticket

Small changes ship sooner and review faster than large ones. When two
rules disagree, the stricter one wins and the plan says which. If the
ticket changes under you, re-read it and say what moved.

### Writing fields

When a tool refuses, report the refusal and the input that caused it.
Prefer a short note in the run log over a long explanation in the chat.
Leave the branch in a state another agent could pick up cold.

### When something fails

Keep the summary to what changed, what was checked and what is left.
Nothing here pushes on its own; the ship stage owns every push. Record
what you decided and why in the field this stage produces.

### Handing back

Treat a skipped step as a decision and write down who made it. Every
question to a person goes through a gate, one question per gate. A retry
that changes nothing is a loop; stop and ask instead.

### Notes for reviewers

Read the run state before you act, and write each field the moment it
exists. Name the file and the line when you point at something in the
code. Use the read tools for reads, and keep them out of the move count.

### Keeping the log short

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

### Edge cases

Prefer a short note in the run log over a long explanation in the chat.
Leave the branch in a state another agent could pick up cold. Keep the
summary to what changed, what was checked and what is left.

### Before you start

Nothing here pushes on its own; the ship stage owns every push. Record
what you decided and why in the field this stage produces. Treat a skipped
step as a decision and write down who made it.

### Reading the ticket

Every question to a person goes through a gate, one question per gate. A
retry that changes nothing is a loop; stop and ask instead. Read the run
state before you act, and write each field the moment it exists.

### Writing fields

Name the file and the line when you point at something in the code. Use
the read tools for reads, and keep them out of the move count. A stage
that cannot finish says so plainly and names the field it is missing.

### When something fails

A failing check is evidence, not a verdict; read it before you retry. The
evidence plan names what you will capture and where it will live. Keep
every write inside the worktree the run provisioned for this ticket.

### Handing back

The orchestrator decides when a stage starts and when it is done. Small
changes ship sooner and review faster than large ones. When two rules
disagree, the stricter one wins and the plan says which.

### Notes for reviewers

If the ticket changes under you, re-read it and say what moved. When a
tool refuses, report the refusal and the input that caused it. Prefer a
short note in the run log over a long explanation in the chat.

### Keeping the log short

Leave the branch in a state another agent could pick up cold. Keep the
summary to what changed, what was checked and what is left. Nothing here
pushes on its own; the ship stage owns every push.

### Edge cases

Record what you decided and why in the field this stage produces. Treat a
skipped step as a decision and write down who made it. Every question to a
person goes through a gate, one question per gate.

### Before you start

A retry that changes nothing is a loop; stop and ask instead. Read the run
state before you act, and write each field the moment it exists. Name the
file and the line when you point at something in the code.

### Reading the ticket

Use the read tools for reads, and keep them out of the move count. A stage
that cannot finish says so plainly and names the field it is missing. A
failing check is evidence, not a verdict; read it before you retry.

### Writing fields

The evidence plan names what you will capture and where it will live. Keep
every write inside the worktree the run provisioned for this ticket. The
orchestrator decides when a stage starts and when it is done.

### When something fails

Small changes ship sooner and review faster than large ones. When two
rules disagree, the stricter one wins and the plan says which. If the
ticket changes under you, re-read it and say what moved.

### Handing back

When a tool refuses, report the refusal and the input that caused it.
Prefer a short note in the run log over a long explanation in the chat.
Leave the branch in a state another agent could pick up cold.

### Notes for reviewers

Keep the summary to what changed, what was checked and what is left.
Nothing here pushes on its own; the ship stage owns every push. Record
what you decided and why in the field this stage produces.

### Keeping the log short

Treat a skipped step as a decision and write down who made it. Every
question to a person goes through a gate, one question per gate. A retry
that changes nothing is a loop; stop and ask instead.

### Edge cases

Read the run state before you act, and write each field the moment it
exists. Name the file and the line when you point at something in the
code. Use the read tools for reads, and keep them out of the move count.

### Before you start

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

### Reading the ticket

Read the run state before you act, and write each field the moment it
exists. Name the file and the line when you point at something in the
code. Use the read tools for reads, and keep them out of the move count.

### Writing fields

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

### Edge cases

A failing check is evidence, not a verdict; read it before you retry. The
evidence plan names what you will capture and where it will live. Keep
every write inside the worktree the run provisioned for this ticket.

### Before you start

The orchestrator decides when a stage starts and when it is done. Small
changes ship sooner and review faster than large ones. When two rules
disagree, the stricter one wins and the plan says which.

### Reading the ticket

If the ticket changes under you, re-read it and say what moved. When a
tool refuses, report the refusal and the input that caused it. Prefer a
short note in the run log over a long explanation in the chat.

### Writing fields

Leave the branch in a state another agent could pick up cold. Keep the
summary to what changed, what was checked and what is left. Nothing here
pushes on its own; the ship stage owns every push.

### When something fails

Record what you decided and why in the field this stage produces. Treat a
skipped step as a decision and write down who made it. Every question to a
person goes through a gate, one question per gate.

### Handing back

A retry that changes nothing is a loop; stop and ask instead. Read the run
state before you act, and write each field the moment it exists. Name the
file and the line when you point at something in the code.

### Notes for reviewers

Use the read tools for reads, and keep them out of the move count. A stage
that cannot finish says so plainly and names the field it is missing. A
failing check is evidence, not a verdict; read it before you retry.

### Keeping the log short

The evidence plan names what you will capture and where it will live. Keep
every write inside the worktree the run provisioned for this ticket. The
orchestrator decides when a stage starts and when it is done.

Small changes ship sooner and review faster than large ones. When two
rules disagree, the stricter one wins and the plan says which. If the




## Wrap up

<!-- part: include:wrap-up-form source=mattstack:wrap-up-form version=0.28.10 lines=6-32 -->
## Wrap-up form

### Notes for reviewers

Keep every write inside the worktree the run provisioned for this ticket.
The orchestrator decides when a stage starts and when it is done. Small
changes ship sooner and review faster than large ones.

### Keeping the log short

When two rules disagree, the stricter one wins and the plan says which. If
the ticket changes under you, re-read it and say what moved. When a tool
refuses, report the refusal and the input that caused it.

### Edge cases

Prefer a short note in the run log over a long explanation in the chat.
Leave the branch in a state another agent could pick up cold. Keep the
summary to what changed, what was checked and what is left.

### Before you start

Nothing here pushes on its own; the ship stage owns every push. Record
what you decided and why in the field this stage produces. Treat a skipped
step as a decision and write down who made it.

Every question to a person goes through a gate, one question per gate. A
