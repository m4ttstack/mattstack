---
name: stage-provision
description: "Pipeline stage: establish where the unit of work happens -- workspace, branch, ticket. Reached only through a resolved pipeline; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
slots:
  domain: { contract: provision-domain@1, required: false }
allowed-tools: Bash(rt worktree provision:*)
metadata:
  stage: "provision"
  stage-consumes: "ticket repo"
  stage-produces: "branch worktree"
---

# stage: provision

{{stage.fields}}

## Run state

Contract v2 (authoritative text: the parameterized-skills skill's convention reference).

- First action: `rt runs stage-start --stage provision`
- Read consumed fields with `rt runs field get <key>` before
  deriving or asking for them.
- Write each declared produce the moment it exists:
  `rt runs field set <key> <value> --stage provision`
- Last action on success: `rt runs stage-done --stage provision`;
  on failure: `rt runs stage-fail --stage provision --reason
  "<what actually failed>"` before you report it.

Read `mode` with `rt runs field get mode` (unset means
`interactive`). If `mode` is `worker`, you were dispatched into a prepared
worktree: verify `git status` runs cleanly in `$PWD`, write `worktree`
($PWD) and `branch` (current branch), and finish -- no detection, no
acquisition.

## Domain rules

{{slot:domain}}

When nothing is inlined above, follow the generic path below.

Unbound (generic fallback): run
`rt worktree provision --repo <repo> --ticket <ticket> --json`. Pass
`--title "<ticket title>"` whenever a ticket title is known -- without it
the branch gets no slug.

- `ok`: `EnterWorktree` to `data.path`; write `branch` and `worktree`
  (`data.path`). A cold create (`wasOnDeck:false`) can take minutes --
  tell the user it's provisioning.
- error `branch-attached:<tree>`: the provision gate, scope `provision`,
  below. Never pick a side yourself.
- `null` (daemon down) or an `unknown-repo` error: fall back to the old
  generic path -- confirm `repo` is a git checkout
  (`git -C <repo> rev-parse --git-dir`); derive a branch name from the
  ticket id and a short kebab slug of its title (or from the task
  description when there is no ticket); create it from the default branch
  (`git -C <repo> switch -c <branch>`); never commit to the default branch
  directly.

## Gate `provision`

Reached on `branch-attached:<tree>`, and for any question the bound domain
rules above declare for this gate (a ticket that could not be found, a
title too generic for a slug, a classification the domain tracks):

- `rt runs field set gate provision --stage provision`
- One sentence: what was found (the tree, the missing ticket, the title).
- The form: on `branch-attached`, **Resume in `<tree>`** (recommended) /
  **Fresh tree**; on a missing ticket, **Create one** / **I will recheck
  the id**; on a generic title, the slug as their text; the domain's own
  questions as it words them; then **Iterate here** and **Hold**.
- `rt runs decision record --contract gate@1 --scope provision --selection '{"resume_in":"<tree or null>","ticket":"create|recheck|null","slug":"<text or null>","domain":{<answers>}}' --decided-by stage-provision`
- Resume: `EnterWorktree` to that tree and write `branch` and `worktree`
  from it. Fresh: provision under a new title. Hold: record
  `hold:provision:<attempt>`, `rt runs field set hold "<their words>"
  --stage provision`, end the turn.

Finish by writing `branch` and `worktree` (absolute path; the checkout
itself when no separate worktree is used).

When this stage is what found or created the ticket -- not when one was
already known coming in -- also run `rt runs field set ticket
<value> --stage provision`. This field is deliberately absent from
`stage-produces` above: that list is a completeness gate ("this stage is
not done until X exists"), and a ticketless run through this stage is a
normal, finished run -- so `ticket` cannot be a required produce even
though this is the one place its value can become known.

## Wrap-up form contract

{{include:wrap-up-form}}
