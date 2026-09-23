---
name: writing-style-lookup
description: "The one writing-style lookup every drafting skill carries: which skill sets the voice of prose posted under the operator's name. Not for direct invocation; engines include it."
---

## Writing style

Before drafting, call `mcp__plugin_mattstack_mattstack__rt_verb` with
`{"args": ["skills", "writing-style", "show"]}` and load the skill its
`skill` names. That load is step one: compose in that voice from the first
word, never as a pass over a finished draft. If the tool is unavailable,
refused, or fails, load the skill named on the `writing-style:` line of
`~/.mattstack/user/skills/preferences.md` if there is one. If that is missing
too, or the skill will not load, load `mattstack:writing-style-conversational`.
