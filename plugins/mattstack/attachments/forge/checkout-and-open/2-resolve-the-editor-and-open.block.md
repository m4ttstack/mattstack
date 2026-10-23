---
order: 2
label: Resolve editor and open
---

# 2. Resolve the editor and open

Walk this cascade, use the first hit: `$MATTSTACK_EDITOR`, else `$VISUAL`,
else `$EDITOR`, else the first of `cursor`, `code`, `zed` found on `PATH`
(`command -v <name>`). If none hit, report the worktree path and say
plainly that no editor was found -- don't guess at a fallback opener.

```
<editor-command> <worktree-path>
```
