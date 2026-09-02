---
name: ship
disable-model-invocation: true
description: "Use when work on the current branch should leave the machine as an MR or PR -- 'ship this', 'ship it', 'push and open an MR', 'create the PR' -- outside a pipeline run."
type: pipeline-step
slots:
  domain: { contract: ship-domain@1, required: false }
---

# ship

The standalone entry for shipping the current branch. Same flow as the
pipeline's ship stage, reached directly: target from the checkout.

## 1. Establish the target, then the ship gate

Current branch (`git branch --show-current`); refuse the default branch.
Then gate `ship`, before anything is pushed:

- When `RT_RUN_DB` is set: `rt runs field set gate ship --stage ship`.
- One sentence: the branch, the commits about to go (`git log --oneline
  @{upstream}.. 2>/dev/null || git log --oneline -5`), and whether the
  tree is dirty (`git status --porcelain`).
- The form: on a dirty tree, **Commit the changes** / **Stash them** /
  **Abort**; **Push and open as draft** (recommended) / **Push and open
  ready**; every question the domain rules below declare for this gate;
  **Iterate here**; **Hold**.
- When `RT_RUN_DB` is set: `rt runs decision record --contract gate@1 --scope ship --selection '{"dirty":"commit|stash|abort|null","open_as":"draft|ready","domain":{<answers>}}' --decided-by ship`.
- Abort or Hold: nothing is pushed.

## Domain rules

{{slot:domain}}

When nothing is inlined above, follow the generic path below.

## 2. Ship

**Domain rules above:** follow them for the shipping flow.

**Generic path:** the forge CLI is read from the origin remote (`git
remote get-url origin`): a GitLab host means `glab`, a GitHub host means
`gh`, anything else is a `clarify` gate. Push with `git push -u origin
<branch>`, then create the MR/PR against the repo's default branch (`glab
mr create --fill --draft` or `gh pr create --fill --draft`; drop the draft
flag when the gate said ready), title from the branch's commits. Print the
URL.

## 3. Mark ready (standalone path)

When the domain flow above ran CI to green (its inherited watch-ci hands
back with the verdict; it fires no gate beyond `ci`), and the MR is a
draft: gate `mark-ready`.

- When `RT_RUN_DB` is set: `rt runs field set gate mark-ready --stage ship`.
- One sentence: CI is green; evidence is attached (or is not).
- The form: **Mark ready now** (recommended when `ci` is green and evidence
  is set) / **Keep it draft**; **Iterate here**; **Hold**.
- When `RT_RUN_DB` is set: `rt runs decision record --contract gate@1 --scope mark-ready --selection '{"ready":true|false}' --decided-by ship`.
- Yes: `glab mr update <iid> --ready` or `gh pr ready <number>` per the
  forge-host rule above.

## Wrap-up form contract

{{include:wrap-up-form}}
