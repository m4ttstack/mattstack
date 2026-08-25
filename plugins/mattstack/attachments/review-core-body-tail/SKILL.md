---
name: review-core-body-tail
description: "Review flow tail after the reviewer dispatch, inlined by the review verbs. Not for direct invocation."
disable-model-invocation: true
---

## Assemble the draft

Fold your observations in; present exactly this shape:

- **Strengths** -- specific.
- **Issues** -- **Critical** (must fix) / **Important** (should fix) /
  **Minor** (nice to have). Every finding lands in one bucket, with
  `file:line`, what is wrong, why it matters, and the fix.
- **Assessment** -- Ready to merge: yes | no | with fixes, plus reasoning.

Those names and those three words are fixed vocabulary: downstream callers
read the draft by them. Return the draft; never post it, approve, or ship.

## Red flags

| Thought | Reality |
|---|---|
| "It's ~20 lines, or it's my own code" | The bias the fresh context removes. Dispatch it (the review dispatch step). |
| "I understand it from sizing it" | The understanding IS the bias. Dispatch it. |
| "I'll decide the depth as I go" | Print the block first (the review-depth step). |
| "Tests first, depth after" | Running them IS the depth decision, unprinted. Print, then set up. |
| "This writes up better its own way" | The five headings ARE the write-up; anything outside them is unreadable downstream. |
| "I'll post the findings myself" | Return the draft; the caller owns what follows. |

## Quick reference

| Signal | Action |
|---|---|
| Inputs in hand | Print REVIEW DEPTH / EVIDENCE CHECK and provider lines. |
| Criteria bound | Its triage lines into the block, its addendum into the dispatch. |
| About to judge the diff | Don't. The review dispatch flow (the dispatch step), reviewer shape, full payload. |
| Draft assembled | Buckets, `file:line`-what-why-fix, assessment word; return it. |
