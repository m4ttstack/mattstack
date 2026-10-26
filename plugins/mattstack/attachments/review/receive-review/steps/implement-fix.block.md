---
node: implement_fix
---

# Implement the thread's fix

Nothing is implemented until `code-changes: approve`: not "in a
follow-up commit", not while drafting. Implement the `fix:<threadId>`
threads one at a time. A fix whose commit is already on the branch (its
row carries `sha`, or the branch log shows it) is never implemented
again.
