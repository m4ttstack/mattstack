---
name: checkout-and-open
disable-model-invocation: true
description: "Use when reviewing someone else's branch in an editor in one step -- 'check out that branch and open it', 'open this MR locally' -- given a branch, MR/PR link, or ticket id. For a checkout without an editor, use checkout."
allowed-tools:
  - Bash(rt worktree:*)
  - Bash(git fetch:*)
  - Bash(git worktree list:*)
  - Bash(gh pr view:*)
  - Bash(glab mr view:*)
  - Bash(command -v:*)
type: pipeline-step
slots: {}
---

# checkout-and-open

The one-step "review someone's code" path: get a teammate's branch into a
local worktree, then open it in an editor.

## 1. Check it out

Follow the pack's compiled `checkout` verb (`../checkout/SKILL.md`, relative
to this file, when the pack compiles both on the same side; a different
surface changes the path) end to end for the target (branch name, MR/PR
link, or ticket id). It returns a worktree path. If it stopped without one
-- ambiguous target, nothing resolved -- stop here too.

## 2. Resolve the editor and open

Walk this cascade, use the first hit: `$MATTSTACK_EDITOR`, else `$VISUAL`,
else `$EDITOR`, else the first of `cursor`, `code`, `zed` found on `PATH`
(`command -v <name>`). If none hit, report the worktree path and say
plainly that no editor was found -- don't guess at a fallback opener.

```
<editor-command> <worktree-path>
```

## 3. Report

State which cascade rung fired -- the provenance for the editor choice --
plus the branch and the worktree path, e.g.:

> Opened `<branch>` in `<editor-command>` (via `$EDITOR`) at
> `<worktree-path>`.

Carry through `checkout`'s safety note: this is someone else's branch,
don't commit or push there.
