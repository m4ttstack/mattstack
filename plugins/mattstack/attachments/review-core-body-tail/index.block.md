---
name: review-core-body-tail
description: "Review flow tail after the reviewer dispatch, inlined by the review verbs. Not for direct invocation."
disable-model-invocation: true
---

# Assemble the draft

Fold your observations in; present exactly this shape:

- **Earlier threads** -- re-review passes only, and first: one entry per
  earlier thread the caller handed in, with its anchor, its call (one of
  the four the structured findings file names), what was checked, and the
  reply to post. **Issues** then hold only what is new.
- **Strengths** -- specific.
- **Issues** -- **Critical** (must fix) / **Important** (should fix) /
  **Minor** (nice to have). Every finding lands in one bucket, with
  `file:line`, what is wrong, why it matters, and the fix.
- **Assessment** -- Ready to merge: yes | no | with fixes, plus reasoning.

Those names and those three words are fixed vocabulary: downstream callers
read the draft by them. Return the draft; never post it, approve, or ship.
