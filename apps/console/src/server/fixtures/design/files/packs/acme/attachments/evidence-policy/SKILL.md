---
name: evidence-policy
description: "What acme captures before a change lands."
metadata:
  provides: evidence-domain@1
---
## Evidence rules

Capture the screen the ticket changes, in light and dark, before any code.
Name each capture after the ticket and the state it shows.
Keep the captures beside the run, never in the repo.

### When the before is gone

Say so in the evidence field and name what replaced it. Never stage a
before by reverting the change.

### Handing back

Write the evidence field the moment the captures exist, with one line per
file. A stage that cannot capture says so plainly and names the screen.
