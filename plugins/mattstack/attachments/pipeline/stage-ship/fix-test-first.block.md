---
node: fix_test_first
label: Fix test-first
props:
  rules:
    merge: add
    default: ""
---

# Fix test-first, commit, rerun

Each fix gets its failing test first, then the fix, then a commit.

{{props.rules}}
