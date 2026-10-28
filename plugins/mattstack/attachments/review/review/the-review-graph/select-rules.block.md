---
node: select_rules
---

# Select the rules for the change

Rule selector's Select the rules, run once the diff is in hand. Every path to
the dispatch passes here, a failed head checkout included, since the
selector reads only the diff. With no selector bound, or `selector: none`,
skip it and go straight to the dispatch.
