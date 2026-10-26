# Scenario (describe only: run no tools; answer from the skill text below)

The widgets pack declares an `accessibility` pipeline. Its only override binds `widgets:evidence-a11y` to stage-evidence's domain rules for that pipeline; the default for every other pipeline is `widgets:evidence`. The author says: "Put accessibility runs back on our normal evidence rules."

Answer in exactly two numbered lines, nothing else:
1. The exact `rt_verb` call you make, with its `args` array.
2. The JSON path in `pack/skills.jsonc` that call removes, written as dot-separated keys.
