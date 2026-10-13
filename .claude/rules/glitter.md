---
paths:
  - "lib/mission/**"
  - "ui/internal/views/mission/**"
  - "docs/design/mission/**"
  - "commands/glitter.ts"
---

# Glitter

### GitHub Desktop is the authority for glitter's behavior

`rt glitter` (`lib/mission/`, `ui/internal/views/mission/`) is a port of
GitHub Desktop. Before designing or fixing any glitter behavior (an action,
an error, a dialog, a state transition, its copy), read how Desktop does it
in its source, cloned at `~/Documents/GitHub/github-desktop`
(`app/src/ui`, `app/src/lib/git`, and dugite's error patterns for git
failures), and copy it: the same trigger, flow, dialog, wording and
buttons. Do not invent a glitter-only answer to a problem Desktop already
solves. Depart from Desktop only where a terminal cannot do what it does,
or where glitter has a surface Desktop lacks (worktrees), and record each
departure in `docs/design/mission/README.md`'s "Ratified deviations from
GitHub Desktop". Cite the Desktop file a port came from in its doc comment.

### Mission adopts GitHub Desktop's staging model

`rt glitter`'s checkboxes (line, hunk, or whole file) are commit
INTENT, not index state -- toggling one never touches git. The real
index is rebuilt from scratch at commit time (reset to HEAD, then
restaged file by file from each one's own selection), so **anything
staged outside glitter -- a plain `git add`, another agent editing the
same repo concurrently -- is discarded at the next commit and replaced
with exactly what the checkboxes say.** This is GitHub Desktop's own
behavior, not a bug. Full design and the one selection-persistence
exception (a Partial selection downgrades to None, not All, once a
commit or discard shifts its file's diff shape) are in
`docs/design/mission/README.md`'s "Staging model" section.
