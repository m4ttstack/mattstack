---
node: review_rounds_spent
---

# review-rounds spent?

Read `exhausted` from the `run_budget` call just made, which charges this
review: never count rounds from context. The count lives on the run per
stage attempt, so a compacted or resumed stage keeps it, and a new attempt
starts at zero.
