---
node: gate_which_target
kind: gate
label: Which target
---

# Gate review clarify: which target?

One sentence naming the candidates, quoting a failed read's error, or
saying the list was cut at 200 rows or nothing was found
(for a branch, that the forge has no MR or PR for it). Then
gate-protocol's Runs integration from `Trigger: a site reaches its gate`:
`gate_ask {questions, kind: clarify, context, runDb, stage}`, one question `target` (one option per candidate;
after a failed read, its target as **Try it again**; none when nothing was
found: their typed text answers).
A `next: hold` holds whatever `target` says. A picked target resolves; typed text, or a target already tried, charges
`target-clarify` and resolves again, and a spent budget's hand back names
what was tried.
