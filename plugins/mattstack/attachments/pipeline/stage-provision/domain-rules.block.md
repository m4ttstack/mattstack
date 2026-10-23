---
order: 3
props:
  rules:
    merge: add
    default: ""
---

# Domain rules

Domain rules supply the provision flow and the ticket lookup. Extra gate
questions sit in the Gate `provision` section, never here. Where a
domain step names a move the graph above marks STOP (hand-rolling a
worktree), the STOP node wins.

{{props.rules}}

Rules sit above or in a step's own section. A step no rule names runs as
the graph alone draws it.
