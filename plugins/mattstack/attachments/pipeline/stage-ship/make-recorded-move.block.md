---
node: make_recorded_move
---

# Make the recorded move once

Compare `git rev-parse HEAD` with the remote branch; never push from here.
It landed when the remote branch carries HEAD, which `pushed` records with
no prior id. A miss reopens the push gate, quoting the comparison.
