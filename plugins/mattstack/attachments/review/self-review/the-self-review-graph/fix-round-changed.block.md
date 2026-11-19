---
node: fix_round_changed
---

# Did the fix round change code?

Yes when any fix this round kept a change to a file: committed, staged or
in the working tree, tests included. A round whose findings were all not
reproduced, left open with their attempts undone, judgment calls or owed
evidence changed nothing.

**Comments only** when every change the round kept is the text of a
comment in a source file: a line or block comment, or a doc comment such as
JSDoc or a docstring. Such a round changes no behavior, so it closes
without a re-review and without a `rereview-rounds` charge. A change to
anything else counts as code: a statement, a string, a test, a config
file, or a file that is not source code (Markdown included, since skills
and docs are read as instructions).
