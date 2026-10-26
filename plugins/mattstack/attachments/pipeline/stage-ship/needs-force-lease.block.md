---
node: needs_force_lease
label: Needs force-with-lease
---

# Push needs force-with-lease?

Yes only when the upstream holds commits HEAD no longer contains
because a rebase rewrote them: one that finished this pass, or a board
frame's rebase earlier in this run. Never force otherwise. Never push a
branch whose tests you have not seen pass this session.
