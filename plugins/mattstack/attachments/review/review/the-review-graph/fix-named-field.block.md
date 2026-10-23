---
node: fix_named_field
---

# Fix the field the review script names

Fix exactly the named field (a `gate_open` line, or `review-source.sh`
exit 1), in the extras or the report json where it drifted from the draft.
Then back through
`Caller owns the review gates?` to the same open.
