---
node: keep_unresolved_human
label: Keep human threads
---

# Keep only unresolved human threads (GitHub)

On GitLab the `mr_threads` filter applies this rule: its result is the set to adjudicate, never filtered again, no
dropped thread added back. On GitHub apply it by hand: keep only
**unresolved** threads a **person** opened, dropping resolved threads,
system notes and bot authors (a username that starts `project_<n>_bot` or
`group_<n>_bot`, is `ghost`, or ends in `-bot`, `_bot` or `[bot]`).
Capture each thread's id, `file:line` and full note chain.
