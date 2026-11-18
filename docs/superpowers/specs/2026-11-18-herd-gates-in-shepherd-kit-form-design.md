# Herd gates in the shepherd's kit form

## Intent

In a herd, Matt works with the shepherd, not the workers. When a worker
opens a gate, Matt should see exactly the form he would have seen working
with that worker directly: the kit form, in the shepherd's pane. Only where
the gate is drawn changes.

Today a herd worker's gate draws the kit form in the worker's pane, which
nobody is watching, and the shepherd rebuilds it as a plain AskUserQuestion
(up to 4 gates, no kit features). That's two copies, and the one Matt sees
is the worse one.

## Goals

- A gate opened from a herd job draws nothing in the worker's pane. The
  worker takes the gate protocol's existing `wait` branch (`rt gate wait`
  in the background, end the turn).
- The shepherd shows the gate in its own kit form, built by the same code
  that builds the worker's form.
- Matt's answer is recorded `by: shepherd` and wakes the worker the way a
  shepherd answer does today.

## Non-goals

- No change to how the shepherd hears about gates (the daemon's
  subscription push carrying a gate id) or how it looks them up.
- No change to gates outside a herd.
- Milestone gates keep the shepherd's own Approve / Revise / Spawn a
  reviewer choices.

## Anti-goals

- The shepherd's form differing from what the worker would have drawn.
- A second form-building path that can drift from `gate_ask`'s.

## Approaches

1. **Daemon builds the form (picked).** The daemon opens herd-job gates
   as `wait` and, on request, rebuilds the kit form for an existing gate
   id with `gate_ask`'s own builder. One builder, so the forms match.
2. **The shepherd's plugin builds it.** No daemon change, but the
   form-building code (prose fitting, context flattening) is copied into
   the mod and can drift. Rejected for the anti-goal.

Trigger: the shepherd agent asks for the form with a tool call, rather than
its mod drawing on the push. That keeps the shepherd's first look: it still
answers a gate itself when the answer is literally in its brief, and still
handles milestone gates its own way. (Matt's pick.)

## Design

1. **Worker side.** `gate:ask` returns presentation `wait` for a gate opened
   from a herd job's session, whatever `kitForm` says, the same way
   board-only kinds do (`lib/daemon/handlers/gate.ts:840`). The worker's mod
   already passes a `wait` result through untouched, and the gate protocol's
   `wait` branch does the rest.
2. **The form read.** A daemon read builds the kit form payload
   (`questions`, `context`, `controls`) for an open gate id, reusing the
   builder in `lib/mcp/gate-tools.ts` (~line 437). Herd runs get no
   Pause / Go back controls already (`runControls`), so controls come back
   empty for them.
3. **`herd_gate_present {gate}`.** A shepherd-only MCP tool that returns
   that payload in the same shape `gate_ask` returns for a kit gate.
4. **The shepherd's mod.** The gate-form mod takes `herd_gate_present` over
   the way it takes `gate_ask` (`mods/gate-form/src/register.tsx`
   `takeGate`): draws the form, and the agent ends its turn. On submit it
   records the answer `--by shepherd` (today it records `--by pane` and
   wakes its own pane to reconcile, which is wrong here). The worker wakes
   from its `rt gate wait`.
5. **The shepherdr skill.** The present-open-gates block calls
   `herd_gate_present` for each open gate when `rt.gates.kitForm` is on,
   and keeps AskUserQuestion when it is off. Milestone gates and the
   answer-from-brief rule are unchanged.

## Several gates at once

Several workers often have gates open at the same time. Nothing here may
assume one.

- **The mod already queues.** It keeps one form per gate, shows the first
  open one, and moves to the next after an answer (`addForm`,
  `currentForm` in `mods/gate-form/src/gate/forms.ts`). A second
  `herd_gate_present` for a gate already queued replaces its form rather
  than adding a duplicate. A new gate arriving while Matt is mid-form joins
  the queue; it never takes the screen from the form he's on.
- **The shepherd presents, then ends its turn.** On a push, it calls
  `herd_gate_present` once per open gate it isn't answering itself, then
  ends its turn. No cap of 4, no waiting on one gate before presenting the
  next. Pushes for gates already presented are ignored.
- **No wake per answer.** Submitting a relayed form doesn't wake the
  shepherd's agent: the daemon wakes the worker, and the shepherd has
  nothing to do. Waking it per answer would make it re-read and
  re-present while Matt is still working through the queue.
- **Answered elsewhere.** The mod watches each relayed gate as it does its
  own. A gate answered on the board or in the console, or closed by its
  worker, drops out of the queue with the usual "Answered elsewhere" note.

## Left to the builder

- Where the "is this a herd job" check reads from in `gate:ask` (the
  session's agent record, the run's `spawned_by`, or `HERD_JOB` passed
  through).
- What the shepherd's agent is told after submit (the gate is settled;
  nothing to reconcile).
- Whether the form read is its own daemon verb or an option on `herd:gates`.
