---
node: why_refused
---

# Why was run_enter refused?

Start fresh only when the refused call carried `resume` and the refusal
says that run is gone or no longer running (`no run <id>`, `run <id> is
<status>`); say so in one line, then start fresh, keeping the first call's
`spawnedBy`. Any other refusal, a resume one included (a locked or
unreadable run db, stages that do not match the pack), ends the verb:
quote it verbatim and start nothing, since the picked run is still
running. Only when there is no `run_enter` tool at all, say rt predates
the run tools; update rt.
