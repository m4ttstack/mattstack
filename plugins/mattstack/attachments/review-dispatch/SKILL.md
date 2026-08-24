---
name: review-dispatch
description: >-
  Use when a review judgment is about to happen in the same context that
  wrote, triaged, or set up the code under review -- reviewing a diff or
  commit range inline, or judging reviewer comments on a change this
  session authored. Small diffs and own code get no exemption.
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
metadata:
  slots: "reviewer"
  slot-reviewer: "optional reviewer-dispatch@1 -- owns dispatching the fresh-context reviewer over a commit range: template, placeholders, subagent framing, and the severity-bucketed return shape"
---

# Review dispatch

## The rule

Code judgment never happens in the context that wrote, triaged, or set up
the code. This context builds the dispatch; a fresh context renders the
verdict.

No exemption for a small diff, a hurry, or code you wrote yourself. An
inline self-review lets a stale assumption ship, because the same context
re-derives its own assumptions and nods at them. Reading harder does not
fix it: a careful, tool-assisted read of your own change is the authoring
context grading itself at higher confidence. The fresh context exists to
test assumptions, not inherit them.

Time pressure argues for dispatching sooner, never for judging inline.
Building the dispatch takes one message.

## Caller inputs

- which shape: reviewer or adjudicator
- reviewer: the commit range, plus a one-or-two-sentence description of the
  change
- adjudicator: the numbered threads (file:line plus note chains), plus the commit range
- the requirements or acceptance criteria the change is judged against
- optional: an already-filled domain addendum block
- optional: setup observations already gathered (commands run, values seen)

## Standard blocks

Append to every dispatched prompt, in this order, after its filled template:

1. Setup observations: `## Already checked before dispatch (fold in; do not
   redo)`, followed by the caller's observations, or `none`.
2. The caller's addendum block, verbatim, when provided.
3. No fabrication: do not invent requirements, files, or findings; if the
   diff, the requirements, or a referenced file cannot be read, say so for
   that item and stop rather than guessing.

Observations travel exactly once: block 1 carries them unless the caller's
addendum claims them through a `{SETUP_OBSERVATIONS}` placeholder, in which
case fill that placeholder and skip block 1. A `{SETUP_OBSERVATIONS}`
placeholder with nothing to carry is filled `none`.

## Reviewer shape

Resolve the slot first:

```bash
"${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"
```

Nonzero exit: print `errors` verbatim and stop.

**Unbound** (`resolved.reviewer.binding` is `null`): apply
`superpowers:requesting-code-review`. Fill its `code-reviewer.md`
placeholders -- `DESCRIPTION` (the caller's description),
`PLAN_OR_REQUIREMENTS` (the requirements), `BASE_SHA` / `HEAD_SHA` (the
commit range ends) -- then append the standard blocks. If the
superpowers plugin is not installed, say so and stop.

**Bound**: read the SKILL.md at `resolved.reviewer.path` and follow it,
still appending the standard blocks.

Either branch dispatches its template as written: placeholders filled,
standard blocks appended, every other section untouched. What to look
hardest at is the fresh reviewer's call; a hunch about where this change is
weak travels as a setup observation, not a rewritten checklist.

Both branches return the same shape, stated in the dispatched prompt:
**Strengths / Critical / Important / Minor / Assessment**. Callers assemble
drafts out of those buckets, so a bound provider owes them too.

## Adjudicator shape

Fill `references/adjudicator.md` (`{DIFF_RANGE}`, `{REQUIREMENTS}`,
`{THREADS}`), append the standard blocks, and dispatch ONE fresh-context
`general-purpose` subagent with it. One dispatch judges all threads
together.

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
| Template | `superpowers:requesting-code-review`, or `resolved.reviewer.path` | `references/adjudicator.md` |
| Fill (only these) | DESCRIPTION, PLAN_OR_REQUIREMENTS, BASE_SHA, HEAD_SHA | {DIFF_RANGE}, {REQUIREMENTS}, {THREADS} |
| Returns | Strengths / Critical / Important / Minor / Assessment | per thread: verdict `valid \| pushback \| needs-clarification`, plus relations |
