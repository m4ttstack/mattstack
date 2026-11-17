---
node: dispatch_reviewer
---

# Dispatch one fresh-context reviewer over the diff

The unbound review: one subagent reads `git diff <branch-point>..HEAD`
against the ticket or task description for correctness, tests present and
honest, and scope drift. Its brief asks it to start a finding's fix line
with `Judgment call:` and a one-line reason only when fixing it needs a
decision the author cannot make from the requirements and the code, and
to add `Reachable from this change: yes` or `no` to a finding about code
this change did not write.

The reviewer's brief names each file it passes by its absolute path from this run's
`skills_resolve` map, never by `@key`. A subagent that reads a written
skill itself makes that skill's one `skills_resolve` call.
