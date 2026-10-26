---
node: copy_json_to_scratch
label: Copy JSON to scratch
---

# Copy the report json into the review scratch dir

`gate_open` reads `findingsPath` only under the temp root (or an installed
plugin root): copy a report json from elsewhere (a caller's `--report`
sibling) into `<dir>` unchanged and pass the copy; the originals stay put.
Every pass copies again, so fix the original (or the extras), never the
copy.
