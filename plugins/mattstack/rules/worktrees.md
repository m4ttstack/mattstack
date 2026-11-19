# Worktrees

Prefer working in a worktree.

- In a repo rt manages (one `rt worktree list` knows), get one with
  EnterWorktree in name mode: rt's hook provisions it and enters in one
  step (see the `rt:worktree` skill). Never hand-roll `git worktree add`
  there.
- In any other repo, use `.claude/worktrees/<name>/` or
  `.worktrees/<name>/`, and first make sure git ignores that folder
  (`.gitignore` or `.git/info/exclude`), so the main checkout never stages
  the nested tree.
- Never create a worktree as a sibling of the repo's main checkout.
- A tree that already exists but the session has not entered (for example
  one `rt worktree provision` made) is entered with EnterWorktree's path
  mode, so the session works from the folder it changes.

EnterWorktree cannot cross repos. When new work targets a different repo
than the session's folder, `/cd` there first, then enter the worktree. In a
herdr pane, queue it with the `rt:herdr-inject` skill:
`rt pane send self --text "/cd <repo>" --then "Continue: ..."` and end the
turn. Outside a pane, ask the user to type it.
