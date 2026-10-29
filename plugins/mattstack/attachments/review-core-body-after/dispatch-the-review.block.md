---
order: 3
---

# Dispatch the review

**REQUIRED SUB-FLOW:** the review dispatch flow below, reviewer shape. Hand
it the full payload:

- a one-or-two-sentence description of the change
- the requirements
- the commit range
- the diff file, when the caller wrote one because the change reaches
  past HEAD
- the setup observations from Set up for the depth
- the filled criteria addendum, when the pack binds criteria
- the rule selection text and the verdict request naming the `fence`
  value, unless there is no selection or the selection is empty (Rule
  selector's Select the rules)

It owns the template, the subagent, and the standard blocks. Judgment forms
there, not here: whoever sized this change carries assumptions about it, and
reading the diff here inherits them rather than tests them. No exemption for
a small diff, a clear requirement, or your own code.
