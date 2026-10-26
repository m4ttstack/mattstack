---
order: 2
label: GitHub list PRs
---

# 2. GitHub: list the open PRs

`gh pr list --author @me --limit 200`. Capture each item's ref
(`#number`), title, author, and source branch. Exactly 200 rows means the
list was cut: say plainly that it was cut at 200 open PRs.
