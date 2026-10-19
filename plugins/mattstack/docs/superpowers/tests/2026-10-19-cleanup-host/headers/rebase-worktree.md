# Scenario (describe only: run no tools; answer from the skill text below)

You are running rebase-worktree inside a pipeline run: this conversation holds runDb /runs/app/r1/state.db, the run's current stage is "ship", and this pane is attended (not spawned, not herdr). branch_sync {tree: /repo/wt} returned {"kind":"synced","pushed":false,"oldHead":"aaa1111","newHead":"bbb2222"}. You report the move and reach **Gate push**. The human picks push: Push with force-with-lease now, next: Proceed, in the pane form.

List, in order, every MCP tool call you make from reaching Gate push up to (not including) the git_push it leads to: one per line, the tool name and its input as JSON-ish keys and values. Nothing else.
