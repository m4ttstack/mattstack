---
order: 3
props:
  rules:
    merge: add
    default: ""
---

# Domain rules

A domain rule sits here or in its step's own section; extra gate questions
sit in the Gate `provision` section, never here. Where one names a move
the graph above marks STOP (hand-rolling a worktree), the STOP node wins.
A step no rule names runs as the graph alone draws it.

{{props.rules}}
