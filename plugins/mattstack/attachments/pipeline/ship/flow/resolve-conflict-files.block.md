---
node: resolve_conflict_files
label: Resolve conflicts
props:
  rules:
    merge: add
    default: ""
---

# Resolve the files, then git rebase --continue on Bash (ship)

Resolve each conflicted file `git_rebase` returned, then continue on Bash
(no tool continues a rebase).

{{props.rules}}
