---
node: write_title_description
label: Write title
props:
  rules:
    merge: add
    default: ""
---

# Write the title and description

Title from the ticket or the first commit subject; the body links the
ticket. The update replaces the whole body, so start from the read-back
and keep everything else: a teammate's edits, and the evidence section
`Attach the evidence` wrote, byte for byte, never a second evidence block.
This stage always writes them, an existing MR's included; the domain's
title, template and voice rules decide what they say, never whether the
write happens.

Each `Open:` bullet in the run's `review` field (a judgment call
self-review left open) goes in the description's follow-up section as one
line: the finding and the reviewer's reason. The domain's template names
that section; with none, it is a `Follow-up` list at the end of the body.
An unset `review` (`run_field_get` errors) adds nothing. The answers from
`Gate owed-evidence` add one line each: a follow-up item to that same
section, an accepted item beside its evidence naming the sha it was
captured at, and a put-off item beside the evidence as pending, naming the
environment. A line an earlier pass wrote for an item since captured comes
out.

{{props.rules}}
