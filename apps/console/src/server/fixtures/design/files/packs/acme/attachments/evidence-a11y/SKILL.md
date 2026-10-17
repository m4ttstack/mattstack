---
name: evidence-a11y
description: "What acme captures before an accessibility change lands."
metadata:
  provides: evidence-domain@1
---
## Accessibility evidence rules

Capture the screen the ticket changes, in light and dark, before any code.
Run the screen reader over the changed region and save the transcript.
Record the contrast of every text and icon colour the ticket touches.
Keep the captures and transcripts beside the run, never in the repo.

### Keyboard

Walk the changed region with the keyboard alone and write down the focus
order, every trap, and every control focus never reaches.

### When the before is gone

Say so in the evidence field and name what replaced it. Never stage a
before by reverting the change.

### Handing back

Write the evidence field the moment the captures exist, with one line per
file. A stage that cannot capture says so plainly and names the screen.
