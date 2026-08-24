# Parameterized skills -- slot and provides declarations

Status: v1 convention. Ships with the mattstack-skills plugin. The
enforcement companion is `scripts/resolve-args.sh` in the
parameterized-skills skill directory.

## The primitive

A **parameterized skill** (a "wrapper") is a skill that takes other skills
as named arguments. The wrapper declares **slots**; a consumer **binds**
each slot to an installed skill (the "inner skill") in the bindings
manifest (`.mattstack/skills.jsonc`, documented in
`plugin/schemas/skills-manifest.md`); the wrapper's companion script
resolves and validates the bindings deterministically at run time and
prints machine-readable JSON. The wrapper stays domain-free: every
domain-specific behavior arrives through a binding.

**Composition depth is capped at 1.** Inner skills do not declare slots of
their own. A SKILL.md that declares both `metadata.slots` and
`metadata.provides` is invalid under this convention. The cap constrains
slot chains only: a prose REQUIRED SUB-SKILL reference is not a slot
binding and does not count toward it (precedent: the pipeline stages,
which the orchestrator reaches by manifest entry, not by slot).

## Slot declaration (wrapper SKILL.md)

Slots live under the spec-legal `metadata` frontmatter map. No invented
top-level frontmatter fields: nothing in the ecosystem gives invented
fields runtime semantics anyway.

```yaml
---
name: mattstack:shepherdr
description: "..."
metadata:
  slots: "tiering"
  slot-tiering: "required model-tiering@1 -- given a unit of work, names the least capable model tier and effort that can succeed at it"
---
```

- `slots`: comma-separated slot names, in enumeration order. A slot name
  matches `[a-z][a-z0-9-]*`.
- `slot-<name>`: one key per slot named in `slots`. Value grammar:

  ```
  <requirement> <contract>@<major> -- <one-line contract description>
  ```

  - `<requirement>` is `required` or `optional`.
  - `<contract>` is the contract name, `[a-z][a-z0-9-]*`.
  - `<major>` is an integer contract major. Contract versions ride the
    shipping plugin's semver: a release that breaks a contract bumps the
    plugin major and the contract major together. There are no per-skill
    versions (deferred decision record: MAT-248).
  - The prose after ` -- ` is the human half of the contract: what the
    inner skill must actually provide. The machine checks only the
    `<contract>@<major>` token.

## provides declaration (inner SKILL.md)

```yaml
---
name: mattstack:model-tiering
description: "..."
metadata:
  provides: "model-tiering@1"
---
```

- `provides`: a space-separated list of `<contract>@<major>` tokens the
  skill fulfills.
- Fulfillment is **trust-but-declare** (v1): the resolver checks that the
  bound skill declares the exact `<contract>@<major>` token the slot
  demands. Nothing probes the skill's actual behavior; probe-invocation
  harnesses are v2 (MAT-246).

## Enforcement lives in the script or nowhere

The composite-actions lesson: declared-but-unenforced `required` rots. The
ONLY enforcement point for slot requiredness, installed-ness, and provides
matching is the wrapper's `scripts/resolve-args.sh`. Wrapper prose tells
the agent to run the script and how to react to its JSON; it must never
restate, soften, or replace the checks, and it must never guess a fallback
binding when resolution fails. Frontmatter alone enforces nothing.

## Binding-only inner skills hide from the model

An inner skill that is only ever reached through a binding sets

```yaml
disable-model-invocation: true
```

in its frontmatter so it stays out of the model's skill listing (listings
trim under context budget pressure; keep them lean). A skill that is also
independently useful at model-invocation time keeps model invocation
enabled and simply adds `provides`.

## Promptless invocation

The wrapper's prose invokes the resolver via `${CLAUDE_SKILL_DIR}`:

```bash
"${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"
```

and the wrapper's frontmatter carries a matching `allowed-tools` Bash rule
so the call runs promptless:

```yaml
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
```

If a runtime does not expand `${CLAUDE_SKILL_DIR}` inside permission
rules, fall back to the concrete installed path, e.g.
`Bash(~/.claude/skills/mattstack:shepherdr/scripts/resolve-args.sh:*)`.

## Vendoring the resolver

The canonical `resolve-args.sh` lives in the parameterized-skills skill.
Every wrapper vendors a byte-identical copy at
`<wrapper>/scripts/resolve-args.sh`; the plugin test matrix asserts
identity with `cmp`. Running the canonical copy in place (inside
parameterized-skills itself) exits 2 with code `no-slots` by design: the
authoring skill declares no slots, and the copy is there to be vendored.

## Bound skills that ship executables

An inner skill may ship scripts the wrapper invokes at
`resolved.<slot>.path`. `${CLAUDE_SKILL_DIR}` is the wrapper's own
directory and does not reach them, so the wrapper carries an
`allowed-tools` rule matching the invocation. Write it as a
leading-wildcard Bash rule against the script's path suffix --
`Bash(*/scripts/<entry>:*)` -- not a `~/`-anchored one: Bash rules match
the command string, and the resolver emits absolute paths. A contract
whose providers ship executables must prescribe the entry-point filename,
which is what lets one rule serve every provider. Vendoring the script
into the wrapper is not an alternative -- it re-couples the wrapper to
one implementation, which is what the slot exists to prevent.

## Constrained frontmatter grammar (what the resolver parses)

The resolver is POSIX sh + awk, not a YAML parser. Frontmatter it reads
must obey:

1. Line 1 of SKILL.md is exactly `---`; frontmatter ends at the next line
   that is exactly `---`.
2. `name:` and `metadata:` start at column 0.
3. Keys under `metadata:` are indented exactly two spaces, one
   `key: value` pair per line, value on the same line.
4. Values may be bare or double-quoted; no folded or multi-line scalars,
   no nested maps under `metadata` keys.

The existing mattstack skills already follow this shape.

## resolve-args.sh contract (v1)

```
"${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh" \
  [--manifest <path>] [--skills-dir <path>] [--plugin-list-cmd <cmd>]
```

- `--manifest`: bindings manifest path. Default discovery order:
  1. nearest `.mattstack/skills.jsonc` walking up from `$PWD`;
  2. `$HOME/.mattstack/skills.jsonc`;
  3. none found = empty bindings (optional slots resolve to null,
     required slots fail `unbound`). A path that names a nonexistent file
     is treated the same as none found.
- `--skills-dir`: installed-skills directory, default `~/.claude/skills`.
- `--plugin-list-cmd`: a space-splittable command printing
  `claude plugin list --json` output; default
  `claude plugin list --json`. Overridable so tests run model-free and
  offline. No quoting support inside the command string.

Bound-skill lookup order for a binding `B`:
1. `<skills-dir>/B/SKILL.md` (the literal directory name, which is how
   prefixed symlinks like `mattstack:model-tiering` install);
2. if `B` is `<plugin>:<skill>`: the enabled plugin whose id starts
   `<plugin>@` in the plugin list, at `<installPath>/skills/<skill>/SKILL.md`,
   falling back to one category level:
   `<installPath>/skills/<category>/<skill>/SKILL.md` (first match in glob
   order). This is how a plugin whose manifest lists `skills/<category>`
   directories installs. Exactly one level: deeper nesting does not resolve.
3. if still not found and `B` is `<plugin>:<skill>`: the same enabled
   plugin's `<installPath>/attachments/<skill>/SKILL.md` -- the root a
   compiled skill's unregistered slot fills live under.

### Success (exit 0)

```json
{
  "ok": true,
  "skill": "mattstack:shepherdr",
  "resolved": {
    "tiering": {
      "binding": "mattstack:model-tiering",
      "contract": "model-tiering@1",
      "source": "skills-dir",
      "path": "/home/user/.claude/skills/mattstack:model-tiering"
    },
    "some-optional-slot": { "binding": null }
  }
}
```

- `resolved` has one key per declared slot.
- `source` is `"skills-dir"`, `"plugin"`, or `"attachments"`.
- `path` is the inner skill's directory (read `<path>/SKILL.md`).
- An unbound optional slot resolves to `{ "binding": null }`.

### Failure (exit 1: resolution failure; exit 2: environment/usage)

```json
{
  "ok": false,
  "skill": "mattstack:shepherdr",
  "errors": [
    {
      "slot": "tiering",
      "code": "unbound",
      "message": "required slot \"tiering\" of \"mattstack:shepherdr\" has no binding (no .mattstack/skills.jsonc found upward from /some/dir)"
    }
  ]
}
```

- `errors` has one entry per unfulfilled slot; manifest-level and
  environment failures use `"slot": null`.
- Exit 2 errors may print `"skill": ""` when the failure happens before
  the wrapper name is read.

### Error codes

| code | exit | slot | meaning |
|---|---|---|---|
| `usage` | 2 | null | unknown CLI option |
| `jq-missing` | 2 | null | jq not on PATH |
| `skill-md-missing` | 2 | null | no SKILL.md next to the script's parent dir |
| `name-missing` | 2 | null | wrapper frontmatter has no `name:` |
| `no-slots` | 2 | null | wrapper metadata declares no `slots` |
| `tmp-failed` | 2 | null | mktemp failed |
| `manifest-invalid` | 1 | null | manifest exists but is not valid JSONC |
| `slot-decl-invalid` | 1 | slot | `slot-<name>` key missing or grammar violation |
| `unbound` | 1 | slot | required slot has no binding |
| `skill-not-installed` | 1 | slot | bound skill not in skills dir or any enabled plugin |
| `provides-missing` | 1 | slot | bound skill declares no `metadata.provides` |
| `provides-mismatch` | 1 | slot | bound skill's provides lacks the demanded `<contract>@<major>` |

Degradation is loud and deterministic; prose never guesses.

## Pipeline stages (v1.1)

A **stage skill** is a skill the `work` orchestrator can place in a
pipeline. Its marker is `metadata.stage` -- NOT `provides`, because a stage
skill is usually itself a wrapper with a `domain` slot, and a SKILL.md may
never declare both `slots` and `provides`. Pipeline membership is not slot
binding, so composition depth stays capped at 1: orchestrator -> stage
(pipeline entry) -> stage's slot-bound inner skill.

```yaml
---
name: mattstack:stage-ship
description: "..."
disable-model-invocation: true
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
metadata:
  stage: "ship"
  stage-consumes: "commits ticket"
  stage-produces: "mr"
  slots: "domain"
  slot-domain: "optional ship-domain@1 -- owns the domain's shipping flow end to end"
---
```

- `stage`: the stage's role name, `[a-z][a-z0-9-]*`.
- `stage-consumes` / `stage-produces`: space-separated unit-of-work record
  field names (see `plugin/schemas/uow.md`), or the single token `-` for
  none. Both keys are mandatory when `stage` is present.
- Stage skills that are only ever reached through a pipeline set
  `disable-model-invocation: true` (selection hygiene).
- A domain team's custom stage is just a skill with these keys; it needs
  nothing from this repo beyond the convention.

## Pipeline resolution (the orchestrator's companion script)

The `work` orchestrator ships `scripts/resolve-pipeline.sh` alongside its
vendored `resolve-args.sh`. Chain validation lives there or nowhere: the
orchestrator's prose runs the script and reacts to its JSON, never
re-derives the chain.

```
"${CLAUDE_SKILL_DIR}/scripts/resolve-pipeline.sh" --work-type <t> \
  [--manifest <path>] [--skills-dir <path>] [--plugin-list-cmd <cmd>] \
  [--seed "<field field ...>"]
```

- `--work-type` (required): key into the manifest's `pipelines` map.
- `--manifest`, `--skills-dir`, `--plugin-list-cmd`: same semantics and
  defaults as resolve-args.sh, except a missing manifest is an error here
  (`no-manifest`): a pipeline cannot exist without one.
- `--seed`: record fields present before stage 1 runs; default
  `work-type ticket repo mode`.

For each entry of `pipelines.<work-type>`, in order, the script:
1. locates the skill (same lookup as resolve-args: literal skills-dir name,
   then enabled plugin) -- else `stage-not-installed`;
2. requires `metadata.stage` -- else `not-a-stage`; requires both
   `stage-consumes` and `stage-produces` -- else `stage-decl-invalid`;
3. checks every consumed field is in the seed set or produced by an earlier
   stage -- else `chain-broken` (chain checking is suppressed after the
   first stage-level error to avoid cascading noise);
4. if the stage declares `slots`, runs the stage's own vendored
   `scripts/resolve-args.sh` (passing through manifest/skills-dir/
   plugin-list-cmd) -- missing script is `resolver-missing`; a nonzero exit
   is `stage-unresolved` with the inner errors embedded in `detail`.

### Success (exit 0)

```json
{
  "ok": true,
  "skill": "mattstack:work",
  "workType": "feature",
  "seed": ["work-type", "ticket", "repo", "mode"],
  "pipeline": [
    {
      "name": "mattstack:stage-ship",
      "stage": "ship",
      "source": "skills-dir",
      "path": "/abs/path/to/stage-ship",
      "consumes": ["commits", "ticket"],
      "produces": ["mr"],
      "slots": { "domain": { "binding": "fake:shipper", "contract": "ship-domain@1", "source": "skills-dir", "path": "..." } }
    }
  ]
}
```

`slots` is `null` for a slotless stage, otherwise the stage's own
`resolved` object verbatim.

### Failure (exit 1; exit 2 environment/usage)

```json
{
  "ok": false,
  "skill": "mattstack:work",
  "errors": [
    { "stage": "mattstack:stage-build", "code": "chain-broken",
      "message": "stage consumes \"branch\" but no earlier stage produces it and it is not in the seed", "detail": null }
  ]
}
```

### Error codes

| code | exit | stage | meaning |
|---|---|---|---|
| `usage` | 2 | null | unknown option or missing --work-type |
| `jq-missing` | 2 | null | jq not on PATH |
| `skill-md-missing` | 2 | null | no SKILL.md next to scripts/ |
| `name-missing` | 2 | null | orchestrator frontmatter has no `name:` |
| `tmp-failed` | 2 | null | mktemp failed |
| `no-manifest` | 1 | null | no bindings manifest found |
| `manifest-invalid` | 1 | null | manifest exists but is not valid JSONC |
| `no-pipeline` | 1 | null | `pipelines` has no entry for the work type |
| `pipeline-invalid` | 1 | null | entry is not a non-empty array of strings |
| `stage-not-installed` | 1 | name | pipeline entry not in skills dir or any enabled plugin |
| `not-a-stage` | 1 | name | installed skill has no `metadata.stage` |
| `stage-decl-invalid` | 1 | name | `stage-consumes` or `stage-produces` missing |
| `resolver-missing` | 1 | name | stage declares slots but ships no scripts/resolve-args.sh |
| `chain-broken` | 1 | name | consumed field unavailable at that point in the order |
| `stage-unresolved` | 1 | name | stage's own slot resolution failed (inner errors in `detail`) |

## Unit-of-work record (v1)

Shared context flowing between stages. One JSON file per unit of work at
`~/.mattstack/work/<work-id>/uow.json` -- outside every repo, exactly like
shepherdr's job dirs. Schema: `plugin/schemas/uow.schema.json`; field
vocabulary and lifecycle: `plugin/schemas/uow.md`. Stages read the record
at the path the orchestrator states, do their work, and write their
`stage-produces` fields plus their entry in `stages` before finishing. The
record plus the re-runnable resolve scripts make pipeline state
recoverable after context compaction; prose is never the state carrier.

## Hidden skills and the slash menu

Step 1 confirmed that `disable-model-invocation: true` blocks the Skill
tool from model-initiated invocation: a non-interactive probe against a
skill carrying that flag returned BLOCKED, with no content (not even the
first heading) loaded. Claude Code documentation (Skills documentation,
invocation control table,
https://code.claude.com/docs/en/skills.md#control-who-invokes-a-skill)
confirms the companion facts: a skill with `disable-model-invocation: true`
is still invocable by the USER via its typed `/plugin:name` slash command,
but it does not appear in the slash-command menu or autocomplete, because
its description is never loaded into context. Consequence: a library skill
may hide
without losing typed-slash access, at the cost of menu discoverability.

## Zone markers

A **zone marker** is a `mattstack.jsonc` file at the top of a skill tree
directory, declaring whether skills there belong to a user zone or a team
zone. Discovery: `git ls-files | grep mattstack.jsonc`.

- **User zones** declare `{"role":"user"}` only. A repo holds at most one.
- **Team zones** declare `{"role":"team","namespace":"acme","org":"widgets"}`.
  The `namespace` is the plugin name users type (e.g. `/acme:run`); `org` is
  the marketplace name and must match across all team zones in the repo.
  A repo may hold many team zones, but only one per namespace.
- Only `.claude-plugin/marketplace.json` sits at the repo root. Zone markers
  live inside the skills directory tree, marking subtrees, never the root.
- Schema: `plugin/schemas/zone-marker.schema.json`.

## Manifest layers

`resolve-args.sh` discovers a bindings manifest in this order: (1) a
**committed in-repo file** -- nearest `.mattstack/skills.jsonc` walking up
from `$PWD`, stopping before `$HOME`; (2) a **generated per-repo file** --
`$MATTSTACK_HOME/repos/<slug>/skills.jsonc`, `<slug>` the git remote
normalized (protocol/creds/`.git` stripped, host lowercased, `/` to `-`),
e.g. `gitlab.example.com-acme-widgets`; (3) the **personal global file** --
`~/.mattstack/skills.jsonc`, the user's own repo-independent bindings;
(4) **none** -- generic fallback behavior, i.e. empty bindings and
required slots fail as unbound.

RULING: `MATTSTACK_HOME` is honored by `merge-manifests.sh` only (useful
for tests); the runtime resolvers always read `$HOME/.mattstack` -- this
is deliberate, not a bug.

`merge-manifests.sh` writes layer (2): at pack install time, or by hand
(`merge-manifests.sh [--repo <path>]`) to refresh it after a team pack or
override changes. It merges one fragment per team zone that declares the
repo (`team.jsonc`'s `gitlabHost` + `projects`, fragments at
`packs/*/pack/skills.jsonc`), then applies
`$MATTSTACK_HOME/user/skills/overrides.jsonc` last -- the user zone's own
rebindings win silently, even against a team's claim. Between two team
fragments, an exclusive double-claim (same binding key + slot, different
values) is a hard error at merge time: nothing is written, both claimants
are named. Runtime only ever reads an already-merged, already-decided file.
Fragments and overrides are JSONC with full-line `//` comments only -- no
trailing same-line comments, since the strip pass is one regex per line.

## Stage contract v2: run state

Alongside `stage-consumes`/`stage-produces`, every stage reports lifecycle
and data to the run DB through the `pipeline-state.sh` helper. The contract:

- The orchestrator exports `RT_RUN_DB` and `RT_PIPELINE_STATE` before the
  first stage. A stage invoked with neither set is running standalone: skip
  all state calls silently — never fail, never warn.
- On entry: `"$RT_PIPELINE_STATE" stage-start --stage <name>`.
- Consumed fields are read with `field get <key>` (exit 3 = absent; fall
  back to asking or deriving, exactly as consumes-resolution already
  prescribes).
- Every declared produce is written with `field set <key> <value> --stage
  <name>` at the moment it is known.
- On success: `stage-done --stage <name>`; on failure: `stage-fail --stage
  <name> --reason "<one-line, what actually failed>"` before reporting the
  failure. The reason is a sentence, not a category ("ui-islands gate:
  3 files exceed the loc budget", not "gate failed"). Pass `--detail-path
  <path>` too when the stage already produced a log or report file for
  this failure.
- Decisions made under a slot contract (`execution-strategy@1`,
  `model-tiering@1`, ...) are recorded by the wrapper that owns the slot:
  `decision record --contract <c> --scope <scope> --selection <JSON>
  --decided-by <wrapper>`. Slots define who decides; the DB records what was
  decided.
- Stages never run sqlite directly and never read another run's DB. The
  helper is the whole interface.
