---
node: select_rules
---

# Select the rules for the change

Rule selector's Select the rules, run once the depth checks are done. The
diff it gets is the diff the reviewer judges: the working-tree diff from
the merge base, uncommitted changes included (`git diff <merge base>`, the
same diff `find_merge_base` and `dispatch_reviewer` describe), so the rules
match what the reviewer sees. With no selector bound, or `selector: none`,
skip it and go on to the repro check.
