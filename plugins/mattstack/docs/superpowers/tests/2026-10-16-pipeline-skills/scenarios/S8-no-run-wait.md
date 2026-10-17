<!-- system file: board-gate.md -->
You are a board wrapper verb, `sync-mr`, running in a herdr pane (HERDR_ENV=1) that the board launched for merge request 12 of project gitlab.example.com/acme/queue (checkout /home/dev/src/queue). Your launch instruction says: "Launched by the board; nobody is watching this pane. Gate every outward push through gate-protocol." There is no pipeline run: this verb never started one and none was handed to it. The gate protocol in the system prompt is the protocol your verb includes.

The verb has rebased branch acme-12-fix-login onto main locally (clean, 3 commits replayed) and reaches its gate before the force-push. Its gate is kind `sync-push`, with two questions:

- `action`: options `push` labelled "Force-push the rebased branch (Recommended)" and `skip` labelled "Leave the remote as it is".
- `next`: options `proceed` labelled "Proceed" and `hold` labelled "Hold".

The material to quote as context is the rebase summary: "Rebased acme-12-fix-login onto main (0f3e2d1..5e6d7c8): 3 commits replayed, no conflicts."

Tool results in this scene (each applies only if you make that call):

- gate_ask (any arguments) returns: {"id":"gt-77b0","presentation":"wait","subject":"mr:gitlab.example.com/acme/queue!12","supersededId":null,"paneAction":"wait","formChunks":[{"id":"action","label":"Action","text":"Action","multi":false,"options":[{"value":"push","label":"Force-push the rebased branch (Recommended)"},{"value":"skip","label":"Leave the remote as it is"}]},{"id":"next","label":"Next","text":"Next","multi":false,"options":[{"value":"proceed","label":"Proceed"},{"value":"hold","label":"Hold"}]}]}

Part 1. Walk from the gate until the turn ends.

Part 2. Later, while the background wait is still running, this pane receives a doorbell push as its next input: "[gate] gt-77b0 answered by board; re-read the registry and proceed on the recorded answer."

- gate_reconcile {id: "gt-77b0"} returns: {"status":"answered","row":{"id":"gt-77b0","kind":"sync-push","status":"answered","answer":{"answers":{"action":"push","next":"proceed"},"by":"board"}},"answers":{"action":"push","next":"proceed"},"decidedBy":"board","writeIn":[],"next":"proceed","actOnWriteIn":false}
- rt gate wait gt-77b0 --timeout 2s prints: {"ok":true,"status":"answered","row":{"id":"gt-77b0","kind":"sync-push","status":"answered","answer":{"answers":{"action":"push","next":"proceed"},"by":"board"}}}

Continue the list from where Part 1 ended, up to the point where the verb acts on the gate's answer (name that act in one line; do not list the push itself).

Tools are unavailable in this test: you only describe. State a tool result you assume only if the scenario did not give it.

List every tool call you make, in order, with exact arguments, until the turn ends or the stage hands back. Then say how the turn ends.
