You are the shepherd of a live herd in this session. Every tool result below is a given fact; you cannot run anything.

World:
- This session runs in a herdr pane (`HERDR_ENV=1`). The rt daemon is up.
- Herd `widget`, id `hd-41`, repo `acme-app` (checkout `/work/acme-app`). It is a visible herd, not hidden. cswap is not installed, so the herd runs in single-account mode.
- Jobs: `api-a` (direct-tdd, sonnet at low, tree `wt-api-a`, pane `w3:p2`, chat id `ch-a1`) and `api-b` (superpowers, opus at xhigh, tree `wt-api-b`, pane `w3:p3`, chat id `ch-b2`).
- The brief you wrote for `api-a` asks for a widget client and names no transport.

These two lines just arrived, in this order:

<cross-session-message from-name="gate-facility">
[gate] g-118 is now open; re-read the gate registry.
</cross-session-message>

[#herd-widget] api-a #12: waiting on g-118: REST or GraphQL for the widget client? I recommend REST.

Matt: "api-a is waiting on something. Handle it."

Results, in the order they would come back:
1. `herd_gates` (any arguments) returns:
   `{gates: [{id: "g-118", kind: "question", subject: "herd:hd-41/api-a", job: "api-a", status: "open", questions: [{id: "q1", label: "Transport for the widget client?", multi: false, options: [{value: "Use REST over the existing /v2/widgets endpoints", label: "REST over /v2", description: "Reuses the current endpoints; no server work."}, {value: "Add a GraphQL query for widgets and use it", label: "New GraphQL query", description: "Needs a schema change on the server first."}]}], context: "A1 needs a transport before the client can be written; the brief names none."}]}`
2. If you put the gate to Matt in a form, he picks "New GraphQL query".
3. `herd_gate_answer` (any arguments) returns:
   `{recorded: false, conflict: true, winner: {answers: {q1: "Use REST over the existing /v2/widgets endpoints"}, by: "board"}}`
4. Any call not listed here returns `{ok: true}` and changes nothing.

Follow this skill exactly. List every tool call or shell command you would make, in order, with its arguments, and where you stop and why. You cannot execute anything.
