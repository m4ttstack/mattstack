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
    versions (decision deferred, recorded 2026-08).
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
  harnesses are v2 (decided 2026-08).

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
name: stage-ship
description: "..."
disable-model-invocation: true
type: pipeline-step
slots:
  domain: { contract: ship-domain@1, required: false }
metadata:
  stage: "ship"
  stage-consumes: "commits ticket"
  stage-produces: "mr"
---
```

- `stage`: the stage's role name, `[a-z][a-z0-9-]*`.
- `stage-consumes` / `stage-produces`: space-separated run-state field
  names, or the single token `-` for none. Both keys are mandatory when
  `stage` is present.
- Stage skills that are only ever reached through a pipeline set
  `disable-model-invocation: true` (selection hygiene).
- A domain team's custom stage is just a skill with these keys; it needs
  nothing from this repo beyond the convention.

## Pipeline resolution

The compiler reads `pipelines` from the manifest and bakes the stage list
into the compiled `work` skill via `{{pipeline.stages}}`. Nothing resolves
pipelines at run time.

## Compile-native vs runtime-native

A skill is one of two kinds, never both.

**Compile-native** engines are consumed only after `rt_verb {args: ["skills",
"compile", "--pack", "<pack>"]}` runs. They
declare typed top-level `slots:` and `type: pipeline-step`, and their
bodies carry `{{placeholder}}` markers that only the compiler fills
(`slot`, `include`, `pipeline.stages`, `work-type`, `stage.fields`,
`stage.dir`, `run-start.flags`, `compiled-from`). Run raw, they visibly do
not work: an unfilled placeholder is a compile error and never reaches an
agent. They ship no `resolve-args.sh`; the compiler errors if one is
called. The pipeline engines, the review verbs, `ship`, `watch-ci`, and
`shepherdr` are compile-native.

**Runtime-native** wrappers resolve their slots at skill time with the
vendored `resolve-args.sh` described above. They declare `metadata.slots`
and must never contain `{{`; the certify gate errors if one does. The
board's `mr-board:*` wrappers are runtime-native.

An `{{include:<attachment>}}` target must be slotless and contain no
placeholder; it inlines in place with a seam marker of kind `include`.

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
and data to the run DB through the run tools (`run_stage`, `run_field_set`,
`run_field_get`, `run_decision`, `run_status`). The contract:

- A compiled stage always runs under `work`, which passes `runDb` into
  each stage's context before the first stage. There is no standalone
  stage invocation, so the four calls below are unconditional.
- On entry: `run_stage {runDb, action: "start", stage: <name>}`.
- Consumed fields are read with `run_field_get {runDb, key: <key>}` (it
  errors when the key is not set; fall back to asking or deriving, exactly
  as consumes-resolution already prescribes).
- Every declared produce is written with `run_field_set {runDb, key,
  value, stage: <name>}` at the moment it is known.
- On success: `run_stage {runDb, action: "done", stage: <name>}`; on
  failure: `run_stage {runDb, action: "fail", stage: <name>, reason:
  "<one-line, what actually failed>"}` before reporting the failure. The
  reason is a sentence, not a category ("ui-islands gate: 3 files exceed
  the loc budget", not "gate failed"). Pass `detailPath` too when the
  stage already produced a log or report file for this failure.
- Decisions made under a slot contract (`execution-strategy@1`,
  `model-tiering@1`, ...) are recorded by the wrapper that owns the slot:
  `run_decision {runDb, contract: <c>, scope: <scope>, selection: <the
  JSON as an object>, decidedBy: <wrapper>}`. Slots define who decides;
  the DB records what was decided.
- Stages never touch the run DB directly and never read another run's DB.
  The run tools are the whole interface.

## Stage contract v4: gates

A gate is a named human decision point. Every gate site in an engine
brackets with `run_field_set` (key `gate`) -> publishes and resolves per
gate-protocol's Runs integration -> `run_decision {..., decidedBy: <the
answer's by>}`. A gate whose `gate` field is newer than its last `gate@1`
decision for that scope is pending.

Scopes. Pipeline gates: `plan`, `provision`, `evidence`, `evidence-attach`,
`ship`, `mark-ready`, `ci`, `close`, `<stage>-failed`, `redirect`, `hold`.
Standalone verbs add their own (`post`, `respond-plan`, `respond-post`,
`doctor-escalation`, `self-review`, `sweep`, `push`, `conflict`,
`wrap-up`). `clarify` is the generic scope for any mid-verb "which one do
you mean". The decisions table upserts on `(run, contract, scope)`, so a
gate that can fire more than once per run carries stage and attempt:
`redirect:ship:2`, `hold:implement:3`, `implement-failed:2`, `ci:watch-ci:2`,
`conflict:rebase-worktree:1`; the attempt is the current stage row's, read
from `snapshot`. Gates that fire once per pass (`plan`, `close`,
`mark-ready`) keep the bare name; after a redirect they fire again and the
latest answer stands.

Standing options on every gate form but `clarify` (defined below): *Iterate
here* (the human's free text is the change request) and *Hold*; *Go back to
<stage>* when `snapshot` shows an earlier stage row.

Iterate here at a stage gate means: act on the human's note inside the
stage, then gate the same scope again (the upsert keeps the latest
answer). Redirect is only for Go back. On a form with more than one
question, Iterate here and Hold are the last question's options.

`-` is the cleared sentinel for any field this contract writes (`hold`, a
redirected stage's produces): `run_field_set {runDb, key, value: "-",
stage}`. Every reader treats it as absent: `run_field_get` returning `-`
reads as not set, and the orchestrator's completeness check is "non-null
and not `-`".

Pass `runDb` when the engine handed you one; otherwise pass `cwd` (the
worktree's absolute path), and the tool resolves the run this session
started, else the newest running run in that worktree. When neither
resolves a run, the `run_field_set` / `run_decision` calls are skipped
and the form alone is the gate -- for an ATTENDED
invocation. A SPAWNED pane with no resolved run never presents that form:
nobody is watching it and no gate row reaches any surface, so it ends the
path with one error line instead (see the forge parts' dirty-tree,
conflict, push, and clarify gates for the exact wording). A resolved run
always gets the run tool calls and its gate integration, however the
runDb reached this call.

A verb that inherited a run (invoked from inside a stage) uses
`run.current_stage` as its `stage`, calls no `run_stage {action: "done"}`
and no `run_status`, and fires no gate beyond its own: only the verb that
called `run_start` closes the stage and the run. Every close ends with
`run_status {runDb, status}`.

Selections record the standing options with the pattern work's failure and
close gates use: `next` is the gate's own enum and always includes
`iterate` and `hold`, plus `redirect` with `to` wherever the form offers Go
back; `note` carries their free text or null. A gate's own answer keys
stand beside them.

A `clarify` form carries its candidates, optionally their text, and Hold;
it offers no Iterate here (the free-text candidate plays that role) and no
Go back, and its selection keeps its single key. Hold on any form: one
sentence, end the turn; under a run also record `hold:<stage>:<attempt>`
and `run_field_set {runDb, key: "hold", value: "<their words>", stage}`;
outside a run nothing is recorded.

Every `run_*` call takes `runDb` whenever one reached you: the value
`run_start` returned, carried in the calling agent's context; `cwd` is
only the fallback for a call no runDb reached. A compiled stage
receives it already, since the engine passes `runDb` into each stage's
context; call `run_start` yourself only to open a run other than the one
you inherited.
