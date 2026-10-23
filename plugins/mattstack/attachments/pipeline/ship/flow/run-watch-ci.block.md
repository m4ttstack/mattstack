---
node: run_watch_ci
props:
  rules:
    merge: add
    default: ""
---

# Run watch-ci inheriting this run

Invoke the `watch-ci` verb with this run's `runDb`, so it inherits the run
and fires no gate beyond `ci` and its off-script gates. Hand it `mr` (its
URL), `sha` (`git_push`'s, or the HEAD a confirmed human push carries),
and `git_push`'s `priorPipelineId` only when the push moved the branch:
`git log @{upstream}..` listed commits before the push (before the gate,
or committed by this verb since), or the push forced. Otherwise that
pipeline is the sha's own and the watch would wait for one that never
comes. A push that moved nothing relies on the sha's own pipeline matching
by sha; on a fast-forward merge train that pipeline is unprovable, and
watch-ci's waiting budget ends the watch.

A stand-down means another attendant (the doctor or another watch-ci
session) holds the MR's lease: an own run closes `done`, since the MR
exists, the report names the `holder`, and nothing releases that lease; an
inherited run hands the stand-down back. A hold is already recorded by
watch-ci: end the turn naming it, with no second `run_hold`.

{{props.rules}}
