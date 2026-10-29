---
node: select_rules
---

# Select the rules for the change

Rule selector's Select the rules, run once the depth checks are done. The
diff it gets on stdin is the self-review diff (Find the self-review
merge-base), untracked files included, so the rules match what the
reviewer judges. With no selector bound, or `selector: none`, skip it and
go on to the repro check.
