---
node: gate_off_script_forge
kind: gate
label: Forge refused
---

# Off-script gate: respond_post_execute held threads

One gate for everything held this pass. Quote each held entry as the `context`: its
`threadId`, `kind` and `error`, whole and unedited. Propose: the human
posts or resolves those threads by hand, or fixes what a `push`,
`mismatch` or `read` entry names, then this verb calls
`respond_post_execute` again, which finds what landed (`alreadyPosted`,
`alreadyResolved`) and retries the rest. A `mismatch` quotes what HEAD,
`@{push}` and `@{u}` printed: never switch branches, rebase or push to make
them match. Take and iterate both call again; hold needs no
`run_hold` when threads are held (the tool set `hold`) and ends with them
held; with none held (a tempted move led here) it is `run_hold`.
