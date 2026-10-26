---
node: flag_drift_collision
---

# Flag the drift or collision to the user

Files outside the job's write fence are drift; a file two jobs changed is
a collision. Flag it now, not at integration.
