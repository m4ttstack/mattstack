# Scenario (describe only: run no tools; answer from the skill text below)

The work orchestrator hands you the gates stage of a `/widgets:work` run in the worktree /repo/wt, runDb /runs/widgets/r9/state.db. `run_field_get {key: approach}` returns an approach that renames a column: it touches `db/migrations/0043_rename_badge_level.sql`, `src/api/schema.graphql` and `src/badge/Badge.tsx`. The domain rules are the ones compiled into the skill below. `bun run widgets:migrate --dry-run` exits 1 with "column badge_level is referenced by view badge_summary"; every other command you run exits 0.

Answer in exactly four numbered lines, nothing else:
1. Every MCP tool you call, in order, with the arguments of any `run_field_set` or `run_stage`.
2. Every shell command you run, in order, exactly as you would type it, separated by ` ; `, or none.
3. The gates that fire, by name, and which of them failed, or none.
4. The outcome node you end at.
