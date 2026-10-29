---
node: check_rules
props:
  rule-selector:
    merge: replace
    default: ""
    contract: "rule-selector@1"
---

# Check the work against the team's rules

The pack's rule selector is the text after the italic line at the end of
this section; an unbound slot leaves it empty. Resolve it now, on this
run, since it may consult settings or the environment. It resolves to the
single line `selector: none`, or to `selector:`, `verdicts:` and `fence:`
lines with an optional fourth, `check: <command template>`. Only the
`check:` line matters here. Skip this step (the `no` edge of Does the rule
selector resolve to a check line?) when the text is empty, resolves to
`selector: none`, or has no `check:` line.

With a `check:` line:

1. Find the branch point the way self-review does: `git merge-base
   origin/HEAD HEAD`, or the default branch by name when `origin/HEAD` is
   unset.
2. Replace `{base}` in the command with that sha and run it once on Bash,
   in the worktree, with nothing on stdin. Capture its stdout and its exit
   status.
3. Read the stdout. It is written for you: the rules that apply to this
   change and the lines worth a look. Decide, rule by rule, whether the
   change breaks it.

An exit other than 0 is one observation, never a failure of the stage:
quote the exit status and the first line of stderr in one line when the
stage returns to the orchestrator, fix nothing on its account, and record
the commits.

Run it once. The check never runs again in this stage. Rule verdicts come
later only where the pack's self-review runs the self-review verb with
this same selector bound; the default self-review stage reads the diff
without the rules.

*If a rule below asks for a move this skill's graph marks STOP, take the off-script edge instead.*

{{props.rule-selector}}
