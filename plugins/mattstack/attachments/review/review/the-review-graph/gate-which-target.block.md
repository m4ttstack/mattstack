---
node: gate_which_target
kind: gate
---

# Gate review clarify: which target?

One sentence naming the candidates, quoting a failed read's error, or
saying the list was cut at 200 rows or nothing was found. Then
gate-protocol's Runs integration from `Trigger: a site reaches its gate`:
`gate_ask {questions, kind: clarify, context, runDb, stage}`, questions `target` (one option per candidate;
none when nothing was found or a read failed: their typed text answers)
and `next`: **Proceed** (recommended) / **Hold**. `next: hold` holds
whatever `target` says. A picked
target resolves; typed text charges `target-clarify` and resolves again,
and a spent budget's hold names what was tried.
