# Scenario (describe only: run no tools; answer from the skill text below)

You are running checkout inside a pipeline run: this conversation holds runDb /runs/app/r1/state.db, the run's current stage is "review" (attempt 2), and this pane is attended (not spawned, not herdr). mr_resolve_branch returned two candidate branches for the ticket: feat/a (opened) and feat/b (merged). You reach **Gate clarify: which branch**. The human picks next: Hold and types "waiting on the author", in the pane form. gate_answer returned by: "pane".

List, in order, every MCP tool call you make after gate_answer returns until the turn ends: one per line, the tool name and its input as JSON-ish keys and values. Nothing else.
