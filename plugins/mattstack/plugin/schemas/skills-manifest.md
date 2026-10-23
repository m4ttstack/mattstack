# skills.jsonc -- the bindings manifest

The consumer-side authority for parameterized skills. Plugins have no
consumer-parameter surface, so this file is where a repo (or a machine)
says which stack skills it uses, which stage engines it rosters for
compile, which fill each block prop of a compiled engine takes, and which
inner skill fulfills each slot of a runtime-native wrapper. Machine
schema: `skills-manifest.schema.json` (draft-07) in this directory.

A pack's fragment (`pack/skills.jsonc`) says `"version": 2` and binds
block props:

```jsonc
{
  "version": 2,
  "pipelines": {
    "feature": ["mattstack:stage-provision", "mattstack:stage-plan", "mattstack:stage-gates", "mattstack:stage-implement", "mattstack:stage-evidence", "mattstack:stage-self-review", "mattstack:stage-ship", "mattstack:stage-watch-ci"],
    "accessibility": {
      "stages": ["mattstack:stage-provision", "mattstack:stage-plan", "mattstack:stage-gates", "mattstack:stage-implement", "mattstack:stage-evidence", "mattstack:stage-self-review", "mattstack:stage-ship", "mattstack:stage-watch-ci"],
      "bindings": {
        "mattstack:stage-evidence/domain-rules": { "rules": "widgets:a11y-evidence" }
      }
    }
  },
  "bindings": {
    "mattstack:work/sub-agent-tiering": { "tiering": "mattstack:model-tiering" },
    "mattstack:stage-watch-ci/forge": { "forge": "mattstack:ci-forge-gitlab" },
    "mattstack:stage-ship/domain-fast-checks": { "rules": "widgets:ship-lint" }
  }
}
```

## Discovery order (what resolve-args.sh does)

1. The nearest `.mattstack/skills.jsonc` walking up from `$PWD`.
2. With `MATTSTACK_PACK` set, the generated per-pack file
   `$HOME/.mattstack/repos/<slug>/packs/<pack>/skills.jsonc`.
3. `$HOME/.mattstack/skills.jsonc` (the machine-global fallback, for
   wrappers invoked outside any consumer repo).
4. None found: bindings are empty. Optional slots resolve to
   `{"binding": null}`; required slots fail with code `unbound`.

The first file found wins; files do not merge at read time. The generated
per-pack file is itself merged from four layers by `rt skills materialize`:
the mattstack defaults, the base pack named by `extends`, the pack's own
fragment, then the user's overrides. A wrapper slot takes the last
layer's value. A block prop takes every layer's value in that order:
compile inlines them all on a `merge: add` prop, and the last one on a
`merge: replace` prop.

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
| `version` | `1` or `2` (see Versions) | everyone; the only required key |
| `extends` | bare base pack name (`"acme-base"`) | `rt skills materialize` and `rt skills compile`; fragment only (`pack/skills.jsonc`), never in a generated file. Names a folder under the org's `mattstack/org/packs/`; the base pack's bindings layer under this pack's, one level: each prop merges the two by its `merge` |
| `base` | boolean | `rt skills materialize`; fragment only. `true` marks the org's base pack at `mattstack/org/packs/<name>/`: it never claims a repo, gets no bindings file of its own, and is never installed, so its fills (under `attachments/`) are inlined by each team's compile, except a fill only `board:*` bindings name, which compile copies into the team pack (at `plugin/attachments/<name>/`) for the board to open. Materialize reads it from the org folder, so its bindings reach every Mac at once; compiled fills follow at the team owner's next compile |
| `skills.enabled` | array of skill names | documentation in phase 1 |
| `pipelines` | pipeline name -> its stages: a plain list of stage-skill names, or `{ "stages": [...], "bindings": { <engine ref>/<block path> -> { prop -> value } } }` whose `bindings` override the top-level ones per prop for that pipeline only. A pipeline binding value may be `""`, which clears that prop for that pipeline only, the top-level value included. A pipeline a work verb runs starts with `stage-provision`, ends with `stage-watch-ci`, and includes `stage-implement` and `stage-ship`; any other pipeline takes any order the chain check accepts. A pipeline with overrides, or one a work verb names, matches `^[a-z][a-z0-9-]*$`, and must not contain `--`, the separator of `<stage>--<pipeline>` copies. Plain lists nothing names are exempt, and the schema allows `--` only in that plain-list form | `rt skills compile` (stage roster, and a `<stage>--<pipeline>` stage copy where a pipeline's fills differ); not resolved at run time |
| `bindings` | `<engine ref>[/<block path>]` -> { prop -> value } for a block-tree engine; wrapper name -> { slot -> inner skill name } for a runtime-native wrapper | `rt skills compile` for block keys and props; `resolve-args.sh` for wrapper slots |
| `layered` | version 2, generated file only: `<engine ref>[/<block path>]` -> { prop -> [ { `layer`, `value` }, ... ] } | `rt skills compile`; holds every layer's value, in layer order, for a prop more than one layer bound |

Skill names are `name` or `prefix:name` (`^[a-z0-9][a-z0-9-]*(:[a-z0-9][a-z0-9-]*)?$`).
For lookup, the resolver tries the literal directory
`<skills-dir>/<name>/SKILL.md` first (prefixed symlink installs), then
treats `prefix:name` as plugin `prefix` + skill `name` against the
enabled plugins in `claude plugin list --json`.

## Versions

Every mattstack engine is a block tree, and version 2 carries its
bindings in three forms:

- A block key: `"mattstack:ship/flow/domain-fast-checks": { "rules": ... }`
  binds the props of one block of the `ship` engine, keyed by the plugin
  prefix and the block id. A key with no path
  (`"mattstack:shepherdr": { "tiering": ... }`) binds the engine's root
  block. `rt skills blocks --skill <verb>` prints a verb's block ids, and
  `rt skills bind <verb> <block> <prop> <fill>` writes the key.
- A per-file value: `plugin:skill/file` names `<skill dir>/<file>.md`,
  whose skill's `SKILL.md` is frontmatter only. A prop value is
  `plugin:skill`, `plugin:skill/file`, or `""` to clear the layers below
  it, so the prop falls back to its default. Bind takes no empty value:
  write `""` by hand.
- `layered`, at the top level and in a pipeline's object form: each prop
  several layers bound, as every layer's value in layer order. A prop one
  layer bound appears only in `bindings`, its layer in the provenance
  comment.

Compile refuses a key naming a block the engine does not have, a prop
the block does not declare, or a slot the engine declared before it
became a block tree (its root's `replaced-slots`); the refusal names the
manifest line and lists the engine's props.

Version 1 carries only wrapper slots, for runtime-native wrappers.
`rt skills materialize` writes `2` only when the generated file needs one
of the version 2 forms (a block path, a per-file value, or `layered`), so
a file whose keys all name a wrapper or an engine's root block stays
version 1 byte for byte.

## Validation

Full JSON Schema validation is documentation-grade in phase 1 (no ajv or
python dependency is assumed). The runnable gate is jq-structural:

```bash
sed 's|^[[:space:]]*//.*$||' .mattstack/skills.jsonc | jq -e '
  (.version == 1 or .version == 2)
  and ((.bindings // {}) | all(type == "object" and all(type == "string")))
  and ((.layered // {}) | all(type == "object" and all(type == "array")))
  and ((.pipelines // {}) | all(type == "array" or (type == "object" and ((.stages // []) | type == "array") and ((.bindings // {}) | type == "object"))))
  and (((.skills // {}).enabled // []) | all(type == "string"))
' > /dev/null
```

Exit 0 = structurally valid. If `check-jsonschema` happens to be
installed, `check-jsonschema --schemafile plugin/schemas/skills-manifest.schema.json <stripped file>`
gives the full check; it is optional and never a gate.
