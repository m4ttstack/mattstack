---
node: fix_round_changed
---

# Did the fix round change code?

Sort every change this round kept (committed, staged or in the working
tree, tests included):

- **Comment text** is the text of a comment in a source file: a line or
  block comment, or a doc comment such as JSDoc or a docstring. A comment
  a tool reads is not comment text: a lint or type-check suppression
  (`eslint-disable`, `@ts-expect-error`, `noqa`, `type: ignore`), a build
  tag or pragma, a JSDoc type in a type-checked file, or a docstring
  example a test runner runs.
- **Code** is every other change: a statement, a string, a test, a config
  file, a comment a tool reads, or a file that is not source code
  (Markdown included, since skills and docs are read as instructions).

Yes when any kept change is code. No when the round kept no change at
all, or when every kept change is comment text: such a round changes no
behavior, so it closes without a re-review and without a
`rereview-rounds` charge. A round whose findings were all not reproduced,
left open with their attempts undone, judgment calls or owed evidence kept
no change.
