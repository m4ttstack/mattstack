---
name: stage-provision
description: "Pipeline stage: establish where the unit of work happens -- workspace, branch, ticket. Reached only through a resolved pipeline; not for direct invocation."
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

## Run state

Contracts v2 and v3 (authoritative text: the parameterized-skills skill's convention reference).

- First action: `run_stage` with `action: "start"`, `stage: "provision"` and the run's `runDb`.
- Read consumed fields with `run_field_get` before deriving or asking for them.
- Write each declared produce the moment it exists with `run_field_set` (`key`, `value`, `stage: "provision"`).
- Last action on success: `run_stage` with `action: "done"`; on failure `run_stage` with `action: "fail"` and a `reason` naming what actually failed, before you report it.

Read `mode` with `run_field_get` (`key: "mode"`); an error saying the key
is not set means `interactive`. If `mode` is `worker`, you were
dispatched into a prepared worktree: verify `git status` runs cleanly in `$PWD`, write `worktree`
($PWD) and `branch` (current branch), and finish -- no detection, no
acquisition.

## Domain rules

{{slot:domain}}

When nothing is inlined above, follow the generic path below.

Unbound (generic fallback): call `worktree_provision` with `repoName`
(the repo's checkout path) and `ticket` (plus `ticketTitle` when known).
Pass `ticketTitle` whenever a ticket title is known -- without it the
branch gets no slug. With no ticket, pass `branch` = a short kebab slug
of the task description instead of `ticket`.

- `ok`: `EnterWorktree` with `path` set to the result's `path`; write
  `branch` and `worktree` (the result's `path`) with `run_field_set`. A
  cold create can take minutes -- tell the user it's provisioning.
- a tool error reading
  `branch is already checked out in worktree "<tree>"` (the daemon's
  `branch-attached` code): the provision gate, scope `provision`, below.
  Never pick a side yourself.
- a tool error carrying `rt daemon unreachable`,
  `not registered with rt`, or `did not match a registered repo`: fall
  back to the old generic path -- confirm `repo` is a git checkout
  (`git -C <repo> rev-parse --git-dir`); derive a branch name from the
  ticket id and a short kebab slug of its title (or from the task
  description when there is no ticket); create it from the default branch
  (`git -C <repo> switch -c <branch>`); never commit to the default branch
  directly.

## Gate `provision`

Reached on the `branch is already checked out in worktree "<tree>"`
error, and for any question the bound domain rules above declare for
this gate (a ticket that could not be found, a title too generic for a slug, a classification the domain tracks):

- `run_field_set` with `key: "gate"`, `value: "provision"`, `stage: "provision"`
- One sentence: what was found (the tree, the missing ticket, the title).
- Run gate-protocol's Runs integration with kind `provision` and these
  questions, each its own question (never fold one list into another --
  a question over 4 options sends the whole gate to the wait queue):
  - `resume_in`, only on that already-checked-out error: **Resume in
    `<tree>`** (recommended) / **Fresh tree**
  - `ticket`, only on a missing ticket: **Create one** / **I will
    recheck the id**
  - `slug`, only on a generic title: the slug as their text. A slug they
    type arrives as this answer's note (or its `text`, from a surface that
    edits offered text), with the value left as the option they had
    picked; that typed slug is the one to use.
  - the domain's own questions, each its own, as it words them
  - `next`: **Proceed** (recommended) / **Iterate here** / **Hold**
- `run_decision` with `contract: "gate@1"`, `scope: "provision"`, `selection: {"resume_in":"<tree or null>","ticket":"create|recheck|null","slug":"<text or null>","domain":{<answers>}}`, `decidedBy: <the answer's by>`
- Resume: `EnterWorktree` with `path` set to that tree and write `branch`
  and `worktree` from it with `run_field_set`. Fresh: provision under a
  new title. Hold: record `hold:provision:<attempt>`, `run_field_set`
  with `key: "hold"`, `value: "<their words>"`, `stage: "provision"`, end
  the turn.

Finish by writing `branch` and `worktree` (absolute path; the checkout
itself when no separate worktree is used).

When this stage is what found or created the ticket -- not when one was
already known coming in -- also `run_field_set` with `key: "ticket"`,
`value` = the ticket id, `stage: "provision"`. This field is deliberately
absent from `stage-produces` above: that list is a completeness gate ("this stage is
not done until X exists"), and a ticketless run through this stage is a
normal, finished run -- so `ticket` cannot be a required produce even
though this is the one place its value can become known.

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
