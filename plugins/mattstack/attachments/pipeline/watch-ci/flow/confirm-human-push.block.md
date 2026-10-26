---
node: confirm_human_push
---

# Confirm the human's push landed (watch-ci)

Compare `git rev-parse HEAD` with the remote branch and say what it shows;
never push from here. It landed when the remote carries HEAD.
