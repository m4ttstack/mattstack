---
node: resolve_conflict_files
props:
  rules:
    merge: add
    default: ""
---

# Resolve the files, then git rebase --continue on Bash

Resolve each conflicted file `git_rebase` returned, then continue on Bash
(no tool continues a rebase).

{{props.rules}}
