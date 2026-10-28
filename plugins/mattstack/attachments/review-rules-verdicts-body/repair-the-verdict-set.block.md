---
order: 2
---

# Repair the verdict set

A problem event charges `verdict-rounds:<depth>`, the depth in force, limit
2, which allows exactly one repair. While the budget is not spent, repair:

1. Dispatch one fresh-context reviewer with the selection text, the first
   verdict set and findings, and the problems. It returns a corrected
   verdict set only, in a block tagged with the `fence` value, and no
   findings.
2. Check the corrected set as in Check the verdict set. The first review's
   findings stay; only the verdict set is replaced.

Problems left once the budget is spent go into the draft's notes, quoted,
and the run goes on without a hold. A rule with no verdict in the set, or
one the remaining problems name, is listed in the notes as unanswered.
