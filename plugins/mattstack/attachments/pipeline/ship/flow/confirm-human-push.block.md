---
node: confirm_human_push
---

# Confirm the human's push landed (ship)

Compare `git rev-parse HEAD` with the remote branch and report it; never
push from here. It landed when the remote carries HEAD, which becomes the
watched sha with no prior pipeline id.
