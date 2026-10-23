---
node: respond_post_execute
---

# respond_post_execute {runDb, tree, stage}

GitLab's whole post side is this one call, `tree` = this checkout's root
(where the fixes were committed, registered with rt as `git_push` needs).
It checks both decisions against their gate sources, pushes only when a
picked thread is a fix row, posts each picked reply and every `gate-1:
reply` row, resolves the picked threads, and counts what already landed
(`alreadyPosted`, `alreadyResolved`). It is idempotent, so a resume, a
take and an iterate all call it again.
