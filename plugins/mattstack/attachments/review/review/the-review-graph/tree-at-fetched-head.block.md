---
node: tree_at_fetched_head
---

# Provisioned review tree at the fetched head?

Compare `git rev-parse HEAD` in that path with `origin/mr-<iid>` (or
`origin/pr-<n>`). A mismatch is not in hand: quote both shas, and note the
setup checks and the verify command check as not run. Never reset or pull
that tree.
