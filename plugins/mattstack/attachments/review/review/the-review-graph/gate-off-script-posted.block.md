---
node: gate_off_script_posted
kind: gate
label: Posted unread
---

# Open the review off-script gate: the posted-already read errored

`context` quotes the error and says some or all of this review may be up,
quoting the latest hold's reason. Proposed move: the human looks at the
MR's threads, posts or finishes the review in the forge UI (the summary and
every comment quoted in full in `context`), approving on an approve,
recorded as posted by the human. Nothing is submitted until the read comes
back. A hold's or hand-back's reason says what the human's answer says
is posted and whether the approval is outstanding, else repeats the latest
hold's, else outcome unknown.
