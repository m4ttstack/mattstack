---
node: gate_off_script_submit
kind: gate
---

# Open the review off-script gate: mr_review_submit refused

A timeout, an unknown outcome or a partial landing may have left some or
all of this review on the MR; any other error means nothing is up.
Proposed move: the human posts the review in the forge UI, approving on an
approve (the summary and every comment quoted in full in `context`),
recorded as posted by the human.

- **Timed out, or outcome unknown:** `context` first says some or all of
  it may be up; the human looks for the summary first, and one already up
  means take records it without posting again.
- **Only partly landed:** `context` first says some comments may be up
  without the summary, so the human checks the MR's threads. Take only:
  the human finishes the review in the forge UI, summary included.

`context` then says **Iterate here** is only for a human who confirmed
nothing from this review is up, never a blind resubmit. From `This review
already on the MR?` with partly, it quotes the hold reason and which
`mr_posted_since` items are posted.
