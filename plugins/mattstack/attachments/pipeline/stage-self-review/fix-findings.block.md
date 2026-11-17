---
node: fix_findings
---

# Fix each finding test-first, commit

Every finding the review raised, Minor ones included, except a judgment
call the reviewer marked (`Judgment call:` and a reason), which goes into
`review` as an `Open:` bullet with that reason, and evidence only the
pushed branch can show, which goes on the `owed-evidence` list. A finding
about code this change did not write is fixed when the reviewer says it
is reachable from this change, or says nothing about reachability.

Each fix gets its failing test first, then the fix, then a commit. Ship
presents and pushes what `commits` names, so the field is rewritten with
every sha on the branch, fixes included, before the next review round.
The next round reviews `<branch-point>..HEAD` again, the whole branch,
never only the latest commit.
