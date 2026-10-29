---
node: dispatch_adjudicator
---

# Dispatch one fresh-context adjudicator over all the review threads

<HARD-GATE>
Do not judge the reviewer's comments in this session. You (helped) write this
code; reading the diff here re-derives the same assumptions and nods at them,
and reading harder buys confidence, not independence. A ruling formed here IS
the verdict whatever it is labeled, including "the reviewer clearly has a
point, I'll just add the guard."

**REQUIRED SUB-FLOW:** the review dispatch flow below, adjudicator shape,
ONE dispatch covering ALL the threads. Running a
self-review as an afterthought at the end does not satisfy this: the fresh context is how the
comments are adjudicated, not a final gut-check.
</HARD-GATE>

Hand the dispatch flow (below, after the Off-script gate section) the
numbered threads (`file:line` plus note chains), the requirements and the
diff range; it owns the template, the subagent and the standard blocks.

Unless there is no selection or the selection is empty, hand its `text`
to the dispatch as the rule selection (the dispatch flow's Standard
blocks), as reference for judging the threads. It carries no verdict
request: the adjudicator's reply keeps the shape it has without a
selector. Otherwise the payload is the one above.
