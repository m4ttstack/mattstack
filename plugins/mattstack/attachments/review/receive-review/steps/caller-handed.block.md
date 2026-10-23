---
node: caller_handed
---

# What did the caller hand receive-review?

**Decision intake.** A caller that owns the gates hands decided answers
instead of a gate answer: `{plan}` alone (a board wrapper, after its own
first gate; `{post}` follows when respond-post offers a thread), or a
combined `{plan, post}`. Each half is that gate's raw per-question answers
(keyed by question id, option values verbatim); the caller's `by` records
as `decidedBy`. A `{plan}` asks nothing; the `post` half waits for gate
respond-post. A `{post}` alone records at once: its plan decision is on
the run, unless the pane is fresh with no run line or a refused resume,
and then `respond_post_execute`'s refusal goes to its off-script gate,
quoted. In the pane that handed the open back, the caller re-enters at
that hand-back box instead.
