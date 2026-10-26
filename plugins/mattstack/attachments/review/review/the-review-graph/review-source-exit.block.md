---
node: review_source_exit
---

# review-source.sh exit 0?

The hand-back path only: the board's prose step reads
`<dir>/review-post.source.json`, so build it with the vendored script.
Exit 1 names a field to fix (the extras, or the
report json where it drifted from the draft); exit 2 is a usage or
unreadable-input error, nothing to fix.
