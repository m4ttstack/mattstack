---
node: commit_named_files
label: Commit named
props:
  rules:
    merge: add
    default: ""
---

# Commit named files (ship)

Stage the files by name, never everything; the subject follows the
domain's commit rules, else the branch's own style.

{{props.rules}}
