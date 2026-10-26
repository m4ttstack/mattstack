---
node: relay_measured_only
---

# Relay only what you measured

A worker's claims about its environment (servers up, ports free, CI green)
are routinely stale. Measure first
(`rt_verb {args: ["endpoint", "lookup", "<role>", "--path", "<the job's worktree>"]}`,
`curl`, `lsof`, a CI status call), or attribute it: "the worker reports X".
