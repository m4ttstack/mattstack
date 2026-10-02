---
name: gates
description: "Gate rules for acme"
---

# Gate rules for acme

### When something fails

Leave the branch in a state another agent could pick up cold. Keep the
summary to what changed, what was checked and what is left. Nothing here
pushes on its own; the ship stage owns every push.

Record what you decided and why in the field this stage produces. Treat a
skipped step as a decision and write down who made it. Every question to a
