---
node: keep_recorded_answers
---

# Keep the recorded answers

The decisions the resumed `run_snapshot` shows are answers already given.
Each gate step that finds its scope's decision there takes it instead of
asking again, but only a proceed decision for that gate counts: one whose
`next` is iterate or hold is not an answer, and a gate reached again after
an iterate edge always asks afresh (a re-ask after Hold or Iterate opens a
new gate). **Resumed run already holds this gate's decision?** reads this
rule.
