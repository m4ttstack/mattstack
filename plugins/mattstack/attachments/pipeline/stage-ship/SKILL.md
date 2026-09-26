---
name: stage-ship
description: "Pipeline stage: publish the unit of work for review -- push, open the MR/PR, attach evidence. Reached only through a resolved pipeline; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
slots:
  domain: { contract: ship-domain@1, required: false }
metadata:
  stage: "ship"
  stage-consumes: "commits ticket"
  stage-produces: "mr"
---

# stage: ship

{{stage.fields}}

## Run state

Contracts v2 and v3 (authoritative text: the parameterized-skills skill's convention reference).

- First action: `run_stage` with `action: "start"`, `stage: "ship"` and the run's `runDb`.
- Read consumed fields with `run_field_get` before deriving or asking for them.
- Write each declared produce the moment it exists with `run_field_set` (`key`, `value`, `stage: "ship"`).
- Last action on success: `run_stage` with `action: "done"`; on failure `run_stage` with `action: "fail"` and a `reason` naming what actually failed, before you report it.

## Gate `ship` (before the push, bound or unbound)

- `run_field_set` with `key: "gate"`, `value: "ship"`, `stage: "ship"`
- One sentence: the branch, the commits about to go (`git log --oneline
  @{upstream}.. 2>/dev/null || git log --oneline -5`), and whether the
  tree is dirty.
- Run gate-protocol's Runs integration with kind `ship` and these
  questions, each its own question (never fold one list into another --
  a question over 4 options sends the whole gate to the wait queue):
  - `dirty`, only on a dirty tree: **Commit the changes** / **Stash
    them** / **Abort**
  - `open_as`: **Push and open as draft** (recommended) / **Push and
    open ready**
  - every question the domain rules below declare for this gate (a
    ticket mismatch, an MR already open)
  - `next`: **Proceed** (recommended) / **Iterate here** / **Go back to
    `<stage>`** / **Hold**
- `run_decision` with `contract: "gate@1"`, `scope: "ship"`, `selection: {"dirty":"commit|stash|abort|null","open_as":"draft|ready","domain":{<answers>},"next":"proceed|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}`, `decidedBy: <the answer's by>`
- Go back: hand control back to the orchestrator with one sentence naming
  the answer; it runs `## Redirect`.
- Abort or Hold: no push. Hold records `hold:ship:<attempt>` and
  `run_field_set` with `key: "hold"`, `value: "<their words>"`,
  `stage: "ship"`, then the turn ends.

## Forge-host rule

The forge is read from the origin remote, never assumed: `git remote
get-url origin`. A GitLab host means rt's MR tools (`mr_create`,
`mr_ready`); a GitHub host means `gh` (`gh pr create`, `gh pr ready
<number>`); anything else is a `clarify` gate (which forge?) rather than a
guess.

## Domain rules

{{slot:domain}}

When nothing is inlined above, follow the generic path below.

Unbound (generic fallback): push with the `git_push` tool (`tree` = the
worktree root, the absolute path `git rev-parse --show-toplevel` prints;
`setUpstream: true`). An error starting
`tree must be the absolute path of the root` fires for a subdirectory as
well as for a repo not registered with rt: retry once with that root, and
only when the root is refused too, push with plain git on Bash instead
(`git push -u origin <branch>`). <!-- mcp-lint: allow -->
Then open
the MR/PR the way the forge-host rule names, as draft unless the gate said ready, title
from the ticket or first commit subject, body linking the ticket and the `evidence` field's entries. Never
force-push; never push a branch whose tests you have not seen pass in this
session.

Finish by writing `mr` (the MR/PR URL).

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
