---
order: 1
---

# Reviewer shape

**No reviewer rules bound**: apply
`superpowers:requesting-code-review`. Fill its `code-reviewer.md`
placeholders -- `DESCRIPTION` (the caller's description),
`PLAN_OR_REQUIREMENTS` (the requirements), `BASE_SHA` / `HEAD_SHA` (the
commit range ends) -- then append the standard blocks. If the
superpowers plugin is not installed, say so and stop.

**Reviewer rules bound** (at the top of the Reviewer section): follow them,
still appending the standard blocks.

Either branch dispatches its template as written: placeholders filled,
standard blocks appended, every other section untouched. What to look
hardest at is the fresh reviewer's call; a hunch about where this change is
weak travels as a setup observation, not a rewritten checklist.

Both branches return the same shape, stated in the dispatched prompt:
**Strengths / Critical / Important / Minor / Assessment**. Callers assemble
drafts out of those buckets, so a bound provider owes them too. When the
payload carries a rule selection, the reply ends with the verdict set in the
fenced block the selection names.
