---
node: report_move
---

# Report the move

One line: old head -> new head, each as the sha and subject from its
`git -C <tree> log -1 --oneline --no-decorate` read. `<oldHead>` is the
result's `oldHead`. `<newHead>` is the result's `newHead` on the
`branch_sync` path, and HEAD after an iterate where the human finished the
rebase. The line ends "already current; nothing pushed" when the heads
match, "pushed by branch_sync" when `pushed` is true, and otherwise "not
pushed", followed on `push-refused` by the quoted `refusal`.
