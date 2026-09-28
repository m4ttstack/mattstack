---
name: parameterized-skills
description: "Use when authoring or reviewing a parameterized skill (a wrapper skill that takes other skills as named arguments), declaring metadata slots or provides on a SKILL.md, writing or debugging a .mattstack/skills.jsonc bindings manifest, or wiring resolve-args.sh into a wrapper skill."
---

# Parameterized skills

A wrapper skill declares named slots; a consumer binds each slot to an
installed inner skill in `.mattstack/skills.jsonc`; the wrapper's vendored
`scripts/resolve-args.sh` resolves and validates the bindings and prints
machine-readable JSON. Enforcement lives in the script, never in prose or
frontmatter alone. Composition depth is capped at 1.

Read, from this skill's directory and the plugin root:

1. `references/convention.md` -- slot and provides declaration grammar,
   the constrained frontmatter rules, and the resolver contract with its
   exact output shapes and error codes.
2. `../../schemas/skills-manifest.md` -- the bindings manifest, its
   discovery order, and its JSONC rules.

To parameterize a skill: declare slots under `metadata` in its SKILL.md,
copy `scripts/resolve-args.sh` from this skill into the wrapper's
`scripts/` unchanged (the test matrix asserts identity with `cmp`), add
the `allowed-tools` Bash rule from convention.md, and make the wrapper's
prose run the script and react to its JSON -- resolve, then read the
skill at `resolved.<slot>.path`; on failure, surface `errors` verbatim
and stop.

Worked example: `mattstack:shepherdr` declares slot `tiering`
(contract `model-tiering@1`), bound to `mattstack:model-tiering`.

Run the model-free matrix from the plugin root:

```bash
tests/test-resolve-args.sh
```
