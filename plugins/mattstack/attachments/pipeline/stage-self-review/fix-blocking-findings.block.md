---
node: fix_blocking_findings
---

# Fix each blocking finding test-first, commit

Each fix gets its failing test first, then the fix, then a commit. Ship
presents and pushes what `commits` names, so the field is rewritten with
every sha on the branch, fixes included, before the next review round.
