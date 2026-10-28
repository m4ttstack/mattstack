---
order: 2
---

# Repair the verdict set

A problem event charges `verdict-rounds:<depth>`, the depth in force, limit
2, which allows exactly one repair. While the budget is not spent, repair:

1. Dispatch one fresh-context reviewer through the same dispatch flow and
   reviewer provider as the review (Review dispatch). Its payload is the
   selection text, the first verdict set and findings, and the problems,
   with the verdict request from Standard blocks. Its reply is the verdict
   set block alone, tagged with the `fence` value, with no findings: for
   the repair this overrides the reviewer shape's buckets.
2. Check the corrected set as in Check the verdict set. It replaces the
   first verdict set only when it parses (exactly one block, valid JSON);
   otherwise the first set stays. The first review's findings stay either
   way.

Problems left once the budget is spent never hold the run. They go on one
line in the draft's Assessment reasoning, `Unanswered rules:` followed by
the id of each unanswered rule and then the leftover problems, quoted; when
a report json is written, the same line goes into its `notes`. A rule is
unanswered when the set has no verdict for it or a leftover problem names
it. A leftover problem that names no rule (a missing or unparseable block,
an exit status) leaves every selected rule without a validated verdict
unanswered, in practice all of them. An unanswered rule is never turned
into a finding, whatever its verdict.
