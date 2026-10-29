---
order: 1
---

# Caller inputs

- The diff source, already confirmed to resolve. With no named base: the
  branch point (`git merge-base origin/HEAD HEAD`, falling back to the
  default branch by name), plus uncommitted changes and untracked files
  for own-branch flows.
- The requirements, from the ticket or task description.
- A human-readable label for the change.

Take these as given: never re-resolve, never fabricate. An absent,
unreadable, or mismatched input is the draft's first finding. The checkout
is the caller's job (review provisions an MR-head checkout at verify and
repro depth); run checks in the one you are handed.
