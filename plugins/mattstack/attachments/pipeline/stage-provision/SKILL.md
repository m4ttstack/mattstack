---
name: stage-provision
description: "Pipeline stage: establish where the unit of work happens -- workspace, branch, ticket. Reached only through the work orchestrator; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
slots:
  domain: { contract: provision-domain@1, required: false }
metadata:
  stage: "provision"
  stage-consumes: "ticket repo"
  stage-produces: "branch worktree"
---

# stage: provision

{{stage.fields}}

Run state: the orchestrator opens and closes this stage, so never write
`run_stage` `start` or `done` here. Read consumes with `run_field_get`,
write each produce with `run_field_set` (`stage: "provision"`) the moment
it exists, and on failure write `run_stage {action: fail, stage:
"provision", reason}` naming what failed.

```dot
digraph provision {
    rankdir=TB;

    "Provision stage entered" [shape=ellipse];
    "run_field_get {key: mode}" [shape=plaintext];
    "mode is worker?" [shape=diamond];
    "git status in $PWD" [shape=plaintext];
    "Clean run?" [shape=diamond];
    "Domain rules inlined?" [shape=diamond];
    "Follow the domain's provision flow" [shape=box];
    "Domain flow result?" [shape=diamond];
    "worktree_provision {repoName, ticket, ticketTitle?} or {repoName, branch: <slug>}" [shape=plaintext];
    "worktree_provision result?" [shape=diamond];
    "EnterWorktree {path}" [shape=plaintext];
    "Gate provision (table below)" [shape=box];
    "provision answer?" [shape=diamond];
    "Provisioned fresh once already?" [shape=diamond];
    "git -C <repo> rev-parse --git-dir; git -C <repo> status --porcelain" [shape=plaintext];
    "Checkout clean?" [shape=diamond];
    "git -C <repo> switch -c <branch> <default>" [shape=plaintext];
    "STOP: never hand-roll a worktree; worktree_provision or the plain branch fallback" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "run_field_set {key: branch}; run_field_set {key: worktree}" [shape=plaintext];
    "This stage found or created the ticket?" [shape=diamond];
    "run_field_set {key: ticket, value: <id>, stage: provision}" [shape=plaintext];
    "run_stage {action: fail, stage: provision, reason}" [shape=plaintext];
    "run_decision {contract: gate@1, scope: hold:provision:<attempt>, selection: {reason}, decidedBy}" [shape=plaintext];
    "run_field_set {key: hold, value: <their words, or held>, stage: provision}" [shape=plaintext];
    "Held: end the turn naming run and stage" [shape=doublecircle];
    "Stage failed" [shape=doublecircle];
    "Provision done: return to the orchestrator" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Provision stage entered" -> "run_field_get {key: mode}";
    "run_field_get {key: mode}" -> "mode is worker?";
    "mode is worker?" -> "git status in $PWD" [label="worker"];
    "mode is worker?" -> "Domain rules inlined?" [label="interactive, or the key is not set"];
    "git status in $PWD" -> "Clean run?";
    "Clean run?" -> "run_field_set {key: branch}; run_field_set {key: worktree}" [label="yes: $PWD and its branch"];
    "Clean run?" -> "run_stage {action: fail, stage: provision, reason}" [label="no"];
    "Domain rules inlined?" -> "Follow the domain's provision flow" [label="yes"];
    "Domain rules inlined?" -> "worktree_provision {repoName, ticket, ticketTitle?} or {repoName, branch: <slug>}" [label="no"];
    "Follow the domain's provision flow" -> "Domain flow result?";
    "Domain flow result?" -> "worktree_provision {repoName, ticket, ticketTitle?} or {repoName, branch: <slug>}" [label="it provisions a tree"];
    "Domain flow result?" -> "Gate provision (table below)" [label="it raises a question"];
    "Domain flow result?" -> "run_field_set {key: branch}; run_field_set {key: worktree}" [label="already provisioned: this tree and its branch"];
    "worktree_provision {repoName, ticket, ticketTitle?} or {repoName, branch: <slug>}" -> "worktree_provision result?";
    "worktree_provision result?" -> "EnterWorktree {path}" [label="ok: the result's path"];
    "worktree_provision result?" -> "Gate provision (table below)" [label="branch is already checked out in worktree"];
    "worktree_provision result?" -> "git -C <repo> rev-parse --git-dir; git -C <repo> status --porcelain" [label="daemon unreachable, or repo not registered"];
    "worktree_provision result?" -> "run_stage {action: fail, stage: provision, reason}" [label="any other error"];
    "worktree_provision result?" -> "STOP: never hand-roll a worktree; worktree_provision or the plain branch fallback" [label="tempted to hand-roll one"];
    "STOP: never hand-roll a worktree; worktree_provision or the plain branch fallback" -> "run_stage {action: fail, stage: provision, reason}";
    "git -C <repo> rev-parse --git-dir; git -C <repo> status --porcelain" -> "Checkout clean?";
    "Checkout clean?" -> "git -C <repo> switch -c <branch> <default>" [label="yes"];
    "Checkout clean?" -> "run_stage {action: fail, stage: provision, reason}" [label="no: quote the dirty paths as the reason"];
    "git -C <repo> switch -c <branch> <default>" -> "run_field_set {key: branch}; run_field_set {key: worktree}" [label="worktree = the checkout"];
    "EnterWorktree {path}" -> "run_field_set {key: branch}; run_field_set {key: worktree}";
    "Gate provision (table below)" -> "provision answer?";
    "provision answer?" -> "EnterWorktree {path}" [label="resume in <tree>"];
    "provision answer?" -> "Provisioned fresh once already?" [label="fresh tree"];
    "provision answer?" -> "Follow the domain's provision flow" [label="ticket: create one"];
    "provision answer?" -> "Follow the domain's provision flow" [label="ticket: recheck the id"];
    "provision answer?" -> "Follow the domain's provision flow" [label="slug: their typed text"];
    "provision answer?" -> "Follow the domain's provision flow" [label="a domain answer"];
    "provision answer?" -> "Follow the domain's provision flow" [label="iterate: redo with their note"];
    "provision answer?" -> "run_decision {contract: gate@1, scope: hold:provision:<attempt>, selection: {reason}, decidedBy}" [label="hold"];
    "run_decision {contract: gate@1, scope: hold:provision:<attempt>, selection: {reason}, decidedBy}" -> "run_field_set {key: hold, value: <their words, or held>, stage: provision}";
    "run_field_set {key: hold, value: <their words, or held>, stage: provision}" -> "Held: end the turn naming run and stage";
    "Provisioned fresh once already?" -> "worktree_provision {repoName, ticket, ticketTitle?} or {repoName, branch: <slug>}" [label="no: under a new title"];
    "Provisioned fresh once already?" -> "run_stage {action: fail, stage: provision, reason}" [label="yes"];
    "run_field_set {key: branch}; run_field_set {key: worktree}" -> "This stage found or created the ticket?";
    "This stage found or created the ticket?" -> "run_field_set {key: ticket, value: <id>, stage: provision}" [label="yes"];
    "This stage found or created the ticket?" -> "Provision done: return to the orchestrator" [label="no, or it came in known"];
    "run_field_set {key: ticket, value: <id>, stage: provision}" -> "Provision done: return to the orchestrator";
    "run_stage {action: fail, stage: provision, reason}" -> "Stage failed";
}
```

### Follow the domain's provision flow

The domain's own acquisition: finding or creating the ticket, choosing the
branch name, provisioning its way. Each question it raises goes to the
`provision` gate rather than being asked on its own; when the pane is
already sitting on the ticket's branch in a worktree, the domain confirms
that instead of calling `worktree_provision` again and the graph records
that tree and branch directly.

## What the graph cannot show

- `worktree_provision` takes `repoName` (the repo's checkout path) and
  `ticket`, plus `ticketTitle` whenever a title is known: without it the
  branch gets no slug. With no ticket, pass `branch` = a short kebab slug
  of the task description instead. A cold create can take minutes; say
  that it is provisioning.
- The plain branch fallback derives the branch from the ticket id and a
  kebab slug of its title (or of the task description). It refuses a dirty
  checkout and passes the repo's default branch as the start point. Never
  commit to the default branch.
- `worktree` is always an absolute path: the checkout itself when no
  separate worktree is used.
- `ticket` is not a declared produce: a ticketless run is a finished run.
  Write it only when this stage is what found or created it.

## Gate `provision`

One sentence above the form: what was found (the tree, the missing
ticket, the title).

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `resume_in` | **Resume in `<tree>`** / **Fresh tree** | the branch is already checked out |
| `ticket` | **Create one** / **I will recheck the id** | a ticket was not found |
| `slug` | the slug as their text (a typed slug arrives as the note, or as `text`) | the title is too generic for a slug |
| the domain's own | as the domain words them | the domain declares them |
| `next` | **Proceed** / **Iterate here** / **Hold** | always |

Selection: `{"resume_in":"<tree or null>","ticket":"create|recheck|null","slug":"<text or null>","domain":{<answers>},"next":"proceed|iterate|hold","note":"<their words or null>"}`.

## Domain rules

The domain rules below supply the provision flow, the ticket lookup and
extra gate questions. Where a domain step names a move the graph above
marks STOP (hand-rolling a worktree), the STOP node wins.

{{slot:domain}}

When nothing is inlined above, the graph alone is the flow.

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
