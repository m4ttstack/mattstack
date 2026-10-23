---
node: gate_off_script_pending
kind: gate
---

# Open the review off-script gate: pending comments on the MR

The reviewer has pending comments here (from the forge UI or an earlier
failed submit) that a submit would publish with the review. `context`
quotes their count and first lines. The human submits or discards them in
the forge UI, so **Iterate here**, retrying the same call, is the
recommended `next`. Take: the human posts this review in the forge UI with
their pending comments (the summary and every comment quoted in full),
recorded as posted by the human.
