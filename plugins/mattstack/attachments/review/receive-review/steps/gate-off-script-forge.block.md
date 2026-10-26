---
node: gate_off_script_forge
kind: gate
label: Forge refused
---

# Off-script gate: the forge refused a reply or resolve

One gate for every reply or resolve the forge refused this pass. Quote each held entry as the `context`: its
`threadId`, `kind` and `error`, whole and unedited; any `push`, `mismatch`
or `read` entries ride in the same context and stay held. Propose: the
human posts or resolves those threads by hand, then this verb calls
`respond_post_execute` again, which finds them (`alreadyPosted`,
`alreadyResolved`). Take and iterate both call again; hold needs no
`run_hold` (the tool set `hold`) and ends with threads held.
