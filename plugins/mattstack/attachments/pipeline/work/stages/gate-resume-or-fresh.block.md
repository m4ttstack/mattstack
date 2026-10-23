---
node: gate_resume_or_fresh
kind: gate
---

# Gate clarify, AskUserQuestion only: Resume it / Start fresh / Hold

No run exists yet: no `gate_*` or `run_*` call. Offer the newest
`run_list` row. `run_list`'s `pipelines` is {{run-list.pipelines}}; only those runs are offered to resume.
Never `run_enter`'s candidates, which ignore that filter. Starting fresh
leaves that run untouched.
