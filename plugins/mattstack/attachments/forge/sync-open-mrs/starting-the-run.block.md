---
order: 1
---

# Starting the run

The `run_enter` nodes: `flags` is the compiled flag text below, verbatim;
`skillDir` is the folder holding the SKILL.md you are following (the `dir`
you passed `load_skill`, or the folder of the file you read); `stage` is `sync-open-mrs`;
`runDb` only when a caller handed one; add `spawnedBy` when a board or
another surface launched this pane.

{{run-start.flags:sync-open-mrs}}

Keep the result's `runDb` and pass it to every `run_*` call; nothing is
exported. The close is `run_close` only on a run this verb started or
resumed; `reason` on an abandoned close is the why, quoted when it is an
error.
