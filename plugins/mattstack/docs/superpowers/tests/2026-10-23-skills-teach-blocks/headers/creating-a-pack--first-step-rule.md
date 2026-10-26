# Scenario (describe only: run no tools; answer from the skill text below)

The widgets pack was just created and its first `/widgets:work` run has reported back. The author answers the first-rules question: "Yes: our lint, `bun run widgets:lint --changed`, has to run at the ship stage's fast-check step, nowhere else." The rule will be written as the fill `widgets:lint-changed`.

Answer in exactly three numbered lines, nothing else:
1. How the fill gets its rule to that one step: what the fill's body carries, and what the pack's binding names.
2. The entry that ends up in `pack/skills.jsonc`'s `bindings` for it, as JSON.
3. Which skill you hand the rule to.
