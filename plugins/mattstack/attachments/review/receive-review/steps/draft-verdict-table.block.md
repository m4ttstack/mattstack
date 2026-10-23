---
node: draft_verdict_table
---

# Draft the verdict table and one reply per thread

Present the verdict table, a drafted reply per thread, then the
recommendation, in one structured block (the verdict report); nothing is
written to code or posted yet. Bucket each thread by verdict (`valid` /
`pushback` / `needs-clarification`) and recommended action (`fix` /
`reply` / `skip`); gate respond-plan reads this bucketing.

**Reply content is a seam.** **No Reply rules section below** (the slot is
unbound): **REQUIRED SUB-SKILL** `superpowers:receiving-code-review`. **A
Reply rules section below**: follow it. Compose in the voice the Writing
style section below names. On top of either branch:

- **Per verdict.** `valid` -> a technical acknowledgment of the fix.
  `pushback` -> the technical reason, referencing the code or test that
  shows it. `needs-clarification` -> one crisp question.
- **An ask is an ask.** A reply that asks the reviewer anything is
  `needs-clarification`, not a `pushback` ending in a question: when the
  answer would change the ruling, the question is the ruling.
- **No performative openers.** A reply states the technical content. An
  opener acknowledging the comment's quality or offering thanks carries
  none: "Good call", "You're right", "Great catch", "Nice find", "Thanks"
  -- and every variant, "Confirmed, thanks." included. Open on what the
  code does or what changes.
