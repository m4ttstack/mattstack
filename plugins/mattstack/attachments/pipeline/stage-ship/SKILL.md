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

- First action: `rt runs stage-start --stage ship`
- Read consumed fields with `rt runs field get <key>` before
  deriving or asking for them.
- Write each declared produce the moment it exists:
  `rt runs field set <key> <value> --stage ship`
- Last action on success: `rt runs stage-done --stage ship`;
  on failure: `rt runs stage-fail --stage ship --reason
  "<what actually failed>"` before you report it.

## Gate `ship` (before the push, bound or unbound)

- `rt runs field set gate ship --stage ship`
- One sentence: the branch, the commits about to go (`git log --oneline
  @{upstream}.. 2>/dev/null || git log --oneline -5`), and whether the
  tree is dirty.
- The form: on a dirty tree, **Commit the changes** / **Stash them** /
  **Abort**; **Push and open as draft** (recommended) / **Push and open
  ready**; every question the domain rules above declare for this gate
  (a ticket mismatch, an MR already open); **Iterate here**; **Go back to
  `<stage>`**; **Hold**.
- `rt runs decision record --contract gate@1 --scope ship --selection '{"dirty":"commit|stash|abort|null","open_as":"draft|ready","domain":{<answers>}}' --decided-by stage-ship`
- Abort or Hold: no push. Hold records `hold:ship:<attempt>` and `rt runs
  field set hold "<their words>" --stage ship`, then the turn ends.

## Forge-host rule

The forge CLI is read from the origin remote, never assumed: `git remote
get-url origin`. A GitLab host means `glab` (`glab mr create`, `glab mr
update <iid> --ready`); a GitHub host means `gh` (`gh pr create`, `gh pr
ready <number>`); anything else is a `clarify` gate (which CLI?) rather than
a guess.

## Domain rules

{{slot:domain}}

When nothing is inlined above, follow the generic path below.

Unbound (generic fallback): push the branch (`git push -u origin
<branch>`), then open the MR/PR with the CLI the forge-host rule names,
as draft unless the gate said ready, title from the ticket or first commit
subject, body linking the ticket and the `evidence` field's entries. Never
force-push; never push a branch whose tests you have not seen pass in this
session.

Finish by writing `mr` (the MR/PR URL).

## Wrap-up form contract

{{include:wrap-up-form}}
