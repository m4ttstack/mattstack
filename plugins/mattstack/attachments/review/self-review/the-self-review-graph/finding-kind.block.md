---
node: finding_kind
---

# What does the finding need?

Read it from the draft, never from your own view of the finding:

- **A judgment call** only when the reviewer marked it one: its fix line
  starts `Judgment call:` with a one-line reason.
- **Evidence only the pushed branch can show**: the fix is a capture (an
  AFTER on the pushed commit, a check against a preview or deployed
  branch), and no code, test or docs change would satisfy it.
- **A change** for everything else, a finding about code this change did
  not write included. Such a finding carries the reviewer's
  `Reachable from this change: yes` or `no` line. `yes`, or no line at all,
  is a change to make like any other. `no` is a judgment call only when
  the reviewer also marked it one; otherwise it is a change too.

"Pre-existing", "out of scope" and "a follow-up is fine" are not one of
these kinds. Without the reviewer's mark they are changes.
