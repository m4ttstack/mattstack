# Scenario (describe only: run no tools; answer from the skill text below)

The work orchestrator hands you the gates stage of a `/widgets:work` run in the worktree /repo/wt, runDb /runs/widgets/r9/state.db. `run_field_get {key: approach}` returns an approach that adds a `badge_level` column: it touches `db/migrations/0042_add_badge_level.sql` and `src/badge/Badge.tsx`. The domain rules are the ones compiled into the skill below. Every command you run exits 0.

Answer in exactly four numbered lines, nothing else:
1. Every MCP tool you call, in order, with the arguments of any `run_field_set` or `run_stage`.
2. Every shell command you run, in order, exactly as you would type it, separated by ` ; `, or none.
3. The gates that fire, by name, or none.
4. The outcome node you end at.
