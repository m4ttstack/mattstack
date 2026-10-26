---
order: 9
---

# Posting quick reference

| Signal | Action |
|---|---|
| Decided `{findings, disposition}`, or legacy `{levels, disposition}`, + draft (parked: the report file AND its json sibling) + target in hand | Post per the sections above. |
| No decided selection arrived | Stop; name it a caller bug. Never ask a question here. |
| Posting inline threads | Selected findings only (legacy: whole selected levels), plus restored findings with their recorded text (one with `changed` true goes in the summary instead); deselected findings drop, no side door. |
| A selected finding carries no `file` anchor | It rides in the summary comment; never invent a line for it. |
| Posting the summary | One comment, scoped to what was selected; an unanchorable selected finding lives here. Drafted review: exactly the caller's joined summary, composing nothing. |
| Disposition is Approve | GitLab: outcome approve on the one submit. GitHub: gh pr review --approve. |
| Disposition is Request changes on a forge without it (GitLab) | Blocking-framed Comment: the Assessment names what blocks the merge and says approval is withheld. |
| Disposition carries no approval | Strip all-clear language from the summary; state the decision is deferred or withheld. |
| About to close | Markdown link to the real URL, read from the forge (a posting tool's `mrUrl`; else `mr_view`'s `webUrl`, called with `mrUrl` or `repoName` plus `iid`, on GitLab, `gh pr view` on GitHub) -- every time. |
