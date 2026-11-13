---
node: act_write_in
---

# Act on a write-in

A site that names its own write-in edge takes that edge. Otherwise,
handle the gate like `iterate`: skip the site's own branch (a `proceed`
beside it is the form's preselection), do what the write-in asks, reading
the whole answer set, then open a NEW gate at the same site so the human
sees the result first. One too unclear to act on goes straight to that new
gate, which asks about it.
