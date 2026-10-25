---
order: 3
label: Graph notes
---

# What the graph cannot show

- **Entry.** A running run's id goes to `resume`, never `runDb`: only
  resume writes a missing manifest. `spawnedBy` starts fresh, never clarify.
- **Resumed.** The attempt is adopted, so an armed `waiting-gate` on any
  row is reconciled first, and a late (`alreadyReconciled`) answer is still
  acted on. On a failed or done row `run_next` writes nothing and returns
  that gate's inputs. Decided questions stay decided. A `gate_reconcile`
  error reading `no gate <id>` is `not found`; any other error is
  `refused`.
- **One owner for stage rows.** The run tools write them; a stage writes
  its fields and its own `run_stage fail`. Never write stage rows, produce
  clears, `shipTarget` or `pipeline-stages` here.
- **Hand-back.** A stage ending at a Go back hands `{to, note,
  decidedBy}`, and a Fix hands `{to: implement, note, decidedBy}` the same
  way; `attempt` is its running attempt.
- **`repeated: true`**: already applied; follow the result.
- **decidedBy** is the gate tool's returned `decidedBy`, or, for a
  hand-back, the handed `decidedBy` (`pane` when it was typed in the
  pane). The gate tools record each gate's answers; this file records none.
- **A finished run stays finished.** Only Close's Done, or an Abandon (at a failure gate or the `ci` gate), ends it;
  a green `ci` does not. Never carry a finished run's `runDb` into new work;
  a new AFTER on a shipped run is not new work, so it reopens that run.
- **This file's gates** walk gate-protocol's Runs integration with `runDb`
  and `stage`, "Under a run: fail the stage at the gate?" answered no.
- **Account back-fill**: `selection` is the spawn-time pick as an object,
  `decidedBy` the spawning surface.
- **A board frame while a gate waits.** Walk the board frame map, then end
  the turn again: the `rt gate wait` task already running keeps waiting
  (never start a second), and the gate stays armed. The map never fails
  a stage with a gate armed.
