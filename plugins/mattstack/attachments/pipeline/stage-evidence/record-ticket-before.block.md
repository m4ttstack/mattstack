---
node: record_ticket_before
props:
  rules:
    merge: add
    default: ""
---

# Record the ticket's location as the BEFORE

When the ticket shows the broken state only as a link or as text (a
failing output pasted in), with no image to save, that is the before:
keep where it sits for the record's `url` instead of recapturing. That
case has no BEFORE image; ship records it with its AFTER.

{{props.rules}}
