---
name: comment-text
description: "Use when a review loop decides whether a fix round needs another review -- sorting each kept change into comment text or code, so a round of comment text alone skips the re-review. Not for direct invocation."
---

# Comment text or code

Sort every change the fix round kept (committed, staged or in the working
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

A round whose every kept change is comment text changes no behavior, so
it needs no further review and charges no review budget.
