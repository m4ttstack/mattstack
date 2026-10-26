# Scenario (describe only: run no tools; answer from the skill text below)

The widgets team (acme org) already has a pack, `widgets`, with `ship` rostered as a door. The author says: "Make ship run our lint at its fast-check step, in /widgets:ship and in the ship stage of /widgets:work." RED has run and reproduced the miss. The fill `widgets:lint-changed` is written and certified; its body is one rule: run `bun run widgets:lint --changed` on the changed files. Nothing in the pack binds ship or stage-ship yet.

Answer in exactly three numbered lines, nothing else:
1. Every `rt_verb` call you make to bind the fill, in order, with its exact `args` array.
2. For each call, the key and value it writes into `pack/skills.jsonc`'s `bindings`, as JSON.
3. The heading of the section of the compiled ship where the lint rule lands.
