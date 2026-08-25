---
name: review-dispatch-body-after
description: "Fresh-context dispatch shapes after the reviewer slot, inlined by the review verbs. Not for direct invocation."
disable-model-invocation: true
---

**Nothing under Reviewer above** (the slot is unbound): apply
`superpowers:requesting-code-review`. Fill its `code-reviewer.md`
placeholders -- `DESCRIPTION` (the caller's description),
`PLAN_OR_REQUIREMENTS` (the requirements), `BASE_SHA` / `HEAD_SHA` (the
commit range ends) -- then append the standard blocks. If the
superpowers plugin is not installed, say so and stop.

**Content under Reviewer above**: follow it, still appending the standard
blocks.

Either branch dispatches its template as written: placeholders filled,
standard blocks appended, every other section untouched. What to look
hardest at is the fresh reviewer's call; a hunch about where this change is
weak travels as a setup observation, not a rewritten checklist.

Both branches return the same shape, stated in the dispatched prompt:
**Strengths / Critical / Important / Minor / Assessment**. Callers assemble
drafts out of those buckets, so a bound provider owes them too.

## Adjudicator shape

Fill `${CLAUDE_SKILL_DIR}/references/adjudicator.md` (`{DIFF_RANGE}`,
`{REQUIREMENTS}`, `{THREADS}`), append the standard blocks, and dispatch ONE
fresh-context `general-purpose` subagent with it. One dispatch judges all
threads together.

## Red flags

| Thought | Reality |
|---|---|
| "It's tiny, just eyeball it" | Size is not the variable; the authoring context is. |
| "We're in a hurry" | Building the dispatch is one message; the inline review is the slow path when it misses. |
| "I wrote it this session, so I know this code" | That is the disqualification stated as a qualification. |
| "My read was careful -- I pulled the real diff and grepped the repo" | Care buys confidence, not independence. Same assumptions, checked harder. |
| "I will just note anything obvious" | An inline opinion IS the verdict, whatever it is labeled. |
| "I will point the reviewer at what actually matters here" | Choosing the reviewer's focus is the authoring bias re-entering through the template. Fill placeholders; the checklist is not yours to rewrite. |
| "The author is a colleague I want to back up" | Judge each claim against the code, in both directions. |
| "Nothing is bound to the reviewer slot, so I will review it" | Unbound means the superpowers default, not a fallback to inline. |

## Quick reference

| | Reviewer shape | Adjudicator shape |
|---|---|---|
| Template | `superpowers:requesting-code-review`, or the Reviewer section above | `${CLAUDE_SKILL_DIR}/references/adjudicator.md` |
| Fill (only these) | DESCRIPTION, PLAN_OR_REQUIREMENTS, BASE_SHA, HEAD_SHA | {DIFF_RANGE}, {REQUIREMENTS}, {THREADS} |
| Returns | Strengths / Critical / Important / Minor / Assessment | per thread: verdict `valid \| pushback \| needs-clarification`, plus relations |
