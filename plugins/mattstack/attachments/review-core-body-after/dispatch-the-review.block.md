---
order: 3
---

# Dispatch the review

**REQUIRED SUB-FLOW:** the review dispatch flow below, reviewer shape. Hand
it the full payload:

- a one-or-two-sentence description of the change
- the requirements
- the commit range
- the setup observations from Set up for the depth
- the filled criteria addendum, when the pack binds criteria

It owns the template, the subagent, and the standard blocks. Judgment forms
there, not here: whoever sized this change carries assumptions about it, and
reading the diff here inherits them rather than tests them. No exemption for
a small diff, a clear requirement, or your own code.
