# .mattstack/skills.jsonc -- the bindings manifest

The consumer-side authority for parameterized skills. Plugins have no
consumer-parameter surface, so this file is where a repo (or a machine)
says which stack skills it uses, which pipelines its work types run, and
which inner skill fulfills each wrapper slot. Machine schema:
`skills-manifest.schema.json` (draft-07) in this directory.

## Discovery order (what resolve-args.sh does)

1. The nearest `.mattstack/skills.jsonc` walking up from `$PWD`.
2. `$HOME/.mattstack/skills.jsonc` (the machine-global fallback, for
   wrappers invoked outside any consumer repo).
3. Neither found: bindings are empty. Optional slots resolve to
   `{"binding": null}`; required slots fail with code `unbound`.

The repo manifest always wins over the home manifest; they do not merge.

## JSONC rules (v1)

- JSON, plus comment lines whose first non-whitespace characters are `//`.
  The whole line is discarded.
- No inline (end-of-line) comments: a `//` after content on the same line
  is NOT stripped and will make the manifest invalid (this also protects
  `https://` strings from mangling).
- No trailing commas.

## Keys

| key | type | consumed by |
|---|---|---|
| `version` | const `1` | everyone; the only required key |
| `skills.enabled` | array of skill names | documentation in phase 1 |
| `pipelines` | work type -> ordered array of stage-skill names | `rt skills compile` (`{{pipeline.stages}}`); not resolved at run time |
| `bindings` | wrapper name -> { slot -> inner skill name } | `resolve-args.sh` (phase 1) |

Skill names are `name` or `prefix:name` (`^[a-z0-9][a-z0-9-]*(:[a-z0-9][a-z0-9-]*)?$`).
For lookup, the resolver tries the literal directory
`<skills-dir>/<name>/SKILL.md` first (prefixed symlink installs), then
treats `prefix:name` as plugin `prefix` + skill `name` against the
enabled plugins in `claude plugin list --json`.

## Validation

Full JSON Schema validation is documentation-grade in phase 1 (no ajv or
python dependency is assumed). The runnable gate is jq-structural:

```bash
sed 's|^[[:space:]]*//.*$||' .mattstack/skills.jsonc | jq -e '
  (.version == 1)
  and ((.bindings // {}) | all(type == "object" and all(type == "string")))
  and ((.pipelines // {}) | all(type == "array"))
  and (((.skills // {}).enabled // []) | all(type == "string"))
' > /dev/null
```

Exit 0 = structurally valid. If `check-jsonschema` happens to be
installed, `check-jsonschema --schemafile plugin/schemas/skills-manifest.schema.json <stripped file>`
gives the full check; it is optional and never a gate.
