# Per-pipeline bindings and specialized work commands

Ticket: RT-491. Status: approved 2026-10-16.

## Intent

Work means taking a ticket end to end through a pipeline's stages. Today
there is one pipeline, `feature`, and it covers most work. A team should be
able to add a pipeline built for one kind of task (accessibility, a bug
fix) that runs its own stage list with its own fills, without forking any
mattstack engine. No team needs one yet: this makes it possible.

Two things block it today:

1. **Nothing runs a second pipeline.** A manifest can declare several
   `pipelines` keys, but the work orchestrator
   (`plugins/mattstack/attachments/pipeline/work/SKILL.md`) has a fixed
   eight-row stage table and always starts runs with
   `{{run-start.flags:work}}`, so every run records work type `work` and
   pipeline `work`. The work-type menu was removed on purpose at the work
   cutover (`plugins/mattstack/docs/superpowers/specs/2026-09-27-work-cutover-design.md`).
2. **Bindings have no pipeline in them.** `bindings` is keyed by engine ref
   and slot (`lib/skills/manifest-merge.ts`), and `stageRoster`
   (`lib/skills/sources.ts`) compiles each stage once however many
   pipelines list it, so every pipeline gets the same fills.

## Goals

- A pack can declare a second pipeline with its own stage list and its own
  fills for any stage in it.
- A pack exposes each specialized pipeline as its own command, so the
  command you run decides the pipeline. No menu, no guessing.
- Runs record which pipeline they ran, and console shows and filters by it.
- Pack authoring (init, the pack skills, docs) teaches the new shape.

## Non-goals

- Bringing back a pipeline menu inside `work`.
- Per-pipeline overrides for anything other than the pipeline's stages (the
  work engine's own slots, roster verbs, board launches).
- The board's review, doctor and respond skills: their `resolve-args.sh`
  keeps reading default bindings, since they never run inside a pipeline.
- Forking or parameterizing any stage engine.

## Anti-goals

- Any change in compiled stages, other verbs, generated manifests or run
  records for a pack that declares one pipeline and no overrides. The
  allowed exceptions: new runs record the pipeline plain `work` resolves
  to (usually `feature`, below), and the compiled
  `work` orchestrator's own text changes once, since its stage table
  becomes generated (*my call*: it need not reproduce today's hand-written
  table byte for byte, only carry the same stages, paths, consumes and
  produces). Existing packs must not otherwise notice this landed.
- A migration. Today's plain-list pipelines stay valid forever.
- A specialized run that console shows as anything other than a work run.

## Vocabulary

- **Stage**: a step a pipeline runs, in order (plan, evidence, ship).
  Engines are mattstack's and are the same for every team.
- **Binding**: a team's skill plugged into a slot a stage (or verb) leaves
  open.
- **Work type**: the kind of run (`work`, `review`, `receive-review`).
  Console derives a run's kind from it (`apps/console/src/app/runs/derive/kind.ts`).
- **Pipeline**: which version of work a run is (`feature`, `accessibility`,
  `bugfix`).

## Decided

### Commands

A pack adds a specialized pipeline as a new verb in `pack/stubs.jsonc` on
the existing `work` engine, naming the pipeline it runs:

```jsonc
{
  "verbs": {
    "work": { "engine": "work", "description": "Run a unit of work" },
    "work-a11y": {
      "engine": "work",
      "pipeline": "accessibility",
      "description": "Run accessibility work end to end"
    }
  }
}
```

- `work` with no `pipeline` keeps today's behavior. *My call:* it runs the
  pack's only pipeline when there is exactly one, whatever its name, else
  `feature`; check errors if there are several and none is `feature`.
- The recommended name is `work-<kind>`, so every kind groups under
  `/<pack>:work` in autocomplete and `work` stays the default. Mattstack
  does not enforce names; the pack skills recommend this one.
- The work orchestrator's stage table stops being hand-written rows and is
  built at compile time from the verb's pipeline, so each compiled work
  verb points at its own pipeline's stage copies.

### Run records

A run started by a work verb records work type `work` and pipeline `<name>`
(`--work-type work --pipeline accessibility`). Work type stays `work` so
console keeps classifying it as a work run. New plain `work` runs record
the pipeline plain `work` resolves to (usually `feature`); old runs keep
`work`, and console shows whatever a run stored.

Stage names in a run record stay the plain stage names (`evidence`), for
every pipeline. Anything that needs a run's pipeline-specific stage copy
finds it through the run's `pipeline` field.

### Resuming

A work verb only offers to resume running runs of its own
pipeline, so `work-a11y` never picks up a `feature` run with the wrong
fills, and the reverse. `run_list` (`lib/mcp/run-tools.ts`) gains a
pipeline filter and the orchestrator's resume branch uses it. When plain
`work` resumes, a run recorded with the old pipeline `work` counts as the
pipeline plain `work` resolves to.

### Manifest shape

A pipeline's value is either today's plain list of stages, or an object
carrying the stages and that pipeline's binding overrides:

```jsonc
"pipelines": {
  "feature": ["mattstack:stage-plan", "...", "mattstack:stage-evidence"],
  "accessibility": {
    "stages": ["mattstack:stage-plan", "...", "mattstack:stage-evidence"],
    "bindings": {
      "mattstack:stage-evidence": { "evidence-domain": "acme:capture-a11y-evidence" }
    }
  }
},
"bindings": {
  "mattstack:stage-evidence": { "evidence-domain": "acme:capture-evidence" }
}
```

- Top-level `bindings` stay the default for every pipeline and for
  everything that is not a stage.
- A pipeline's `bindings` override per slot. Slots it does not list come
  from the default. An empty string unbinds the slot for that pipeline
  only, matching how an empty fill unbinds today.
- Stages and bindings are siblings, not inline on each stage, so layering
  keeps its two rules:
  - a layer that sets a pipeline's `stages` replaces the list whole, as
    today;
  - a layer's pipeline `bindings` merge one slot at a time, as top-level
    bindings do.
- A layer may set a pipeline's `bindings` without restating its `stages`.
  The merged result must end with a stage list for every pipeline.
- When a higher layer replaces a pipeline's stage list and drops
  a stage that a lower layer's override names, check warns and the
  override is ignored, since layering cannot delete the lower key. An
  override naming a stage missing from the same layer's own list fails
  materialize.
- A pipeline that carries overrides and whose name does not match
  `^[a-z][a-z0-9-]*$` (the schema's rule, and the `{{verb.path}}` rule a
  copy's name must pass) fails materialize, naming the pipeline. A
  pipeline with no overrides is not checked here, so an existing pack is
  untouched; check catches a bad name a work verb names.
- The manifest's provenance header records which layer set each pipeline
  override slot, as it does for default slots.
- A pipeline with no overrides renders as a plain list in the generated
  manifest, so existing manifests are byte-identical.

### Compile

- A pipeline whose effective fills for a stage match the default uses the
  default copy. A pipeline whose fills differ gets its own copy, named
  `<stage>--<pipeline>` (e.g. `stage-evidence--accessibility`). Two
  pipelines never share a copy, even with identical fills, so anything
  holding a (pipeline, stage) pair can find the copy by name.
- `{{verb.path:...}}` and `rt skills check`'s recompile-and-diff cover the
  extra copies. Compile removes a copy's directory once it is no longer a
  target (today no sweep removes a stage directory), and check reports a
  leftover one, since console and runs would otherwise read a stale copy.
  The sweep removes only `stage-*--*` directories whose `SKILL.md` carries
  the compiler's header, and judges "no longer a target" against the full
  target set, never a `--verb`-scoped one, so a scoped compile or bind's
  recompile never deletes a live copy.
- Console's wiring view finds a work verb's stage links through its
  `verb.path` anatomy parts. The generated table keeps one such part per
  row, so existing packs keep their stage links.
- `bind` refuses a copy's name as its verb (`--pipeline` is how to reach
  a copy), and the interactive picker hides copies.
- The stage allowed-tools union stays off for `work`, as the work cutover
  left it. The generated stage table must not use `{{pipeline.stages}}`,
  whose presence is what turns the union on (`commands/skills.ts`
  `isOrchestrator`).
- A pipeline override for a pipeline no layer gives a stage list fails
  materialize, naming the pipeline.
- `rt skills check` errors on: a pipeline override for a stage the pipeline
  does not list; a work verb naming an undeclared pipeline; a pipeline that
  a work verb runs (one whose engine renders the stage table) and that
  does not start with `stage-provision`, end with `stage-watch-ci`, and
  include `stage-implement` and `stage-ship` (the work digraph's close
  step walks back to implement, holds against watch-ci, and needs `mr` and
  `ci`; pipelines no work verb runs keep today's rules); a pipeline's
  stages that fail the existing consumes/produces chain check
  (`pipelineChainErrors`).

### `rt skills bind`

`rt skills bind <verb> <slot> <fill> --pipeline <name>` writes
`pipelines.<name>.bindings.<engineRef>.<slot>` in the pack fragment,
turning a plain-list pipeline into the object form when needed. It refuses
a pipeline the pack does not declare, and a stage that pipeline does not
list. Without `--pipeline`, it writes the default, as today.

### Console

- **Runs**: each row in the runs list shows its pipeline, and the list can
  be filtered by pipeline. The run and record headers already read
  `<pipeline> pipeline · ...` and search already matches pipeline. The
  stage strip already reads the run's own `pipeline-stages` field, so a
  pipeline with a different stage list draws correctly.
- **Run detail**: the stage-doc route (`apps/console/src/server/stageDoc.ts`)
  resolves a stage's text through the run's `pipeline`, so an
  accessibility run shows its own stage copy, not the default.
- **Wiring graph**: the pipeline view shows each pipeline's real fills (an
  accessibility stage shows its override, not the default), and each
  pipeline's spine leads with the work verb that runs it (`work-a11y` for
  `accessibility`), not always `work`.
- **Rebind drawer**: the existing drawer (`drawer/rebind.ts`,
  `POST /api/skills/bind`) gains a pipeline choice and passes `--pipeline`.
- **Pending changes**: binding changes carry their pipeline, so the
  unsynced banner and rows say which pipeline changed.
- The used-by index (`invertBindings`) and the orphan check count a fill
  bound only by a pipeline override as used.

### Pack authoring in scope

Everything that would be out of date after this lands is updated in the
same project:

- `rt skills init`: seeded `skills.jsonc` comments (no longer "a fixed
  order" for every pack) and the seeded `stubs.jsonc`.
- `mattstack:creating-a-pack`, `mattstack:extending-a-pack` (a recipe for
  adding a specialized pipeline and command), `mattstack:editing-skills`.
- `plugins/mattstack/docs/your-first-pack.md`, the example
  `plugins/mattstack/plugin/examples/skills.jsonc`, the manifest schema
  `plugins/mattstack/plugin/schemas/skills-manifest.schema.json` and its
  prose `plugins/mattstack/plugin/schemas/skills-manifest.md`.
- `plugins/mattstack/README.md` (Pipeline section: "lists all eight",
  "order is fixed") and
  `plugins/mattstack/attachments/parameterized-skills/references/convention.md`
  ("Pipeline resolution").
- Docs site pages under `website/docs/rt/reference/skills/` (`bind`,
  `compile`, `composition`, `anatomy`, `check`) and any page that
  describes pipelines.
- The work orchestrator skill itself.

## Constraints

- Skill edits go through `superpowers:writing-skills` and
  `mattstack:editing-skills`. A change under `plugins/mattstack` bumps
  `.claude-plugin/plugin.json`'s version (the `plugin-mattstack` CI job).
- rt's `--json` envelopes (composition, check, bind) are frozen: new
  fields are additive, existing keys and values unchanged
  (`commands/__tests__/skills-json-frozen.test.ts`).
- Console's server types in `apps/console/src/server/skills.ts` mirror
  rt's composition and changes payloads and move in step with them. The
  composition's `pipelines` stays `Record<string, string[]>` (stage lists
  only); overrides travel in a new additive field.
- Every reader of a manifest's `pipelines` accepts both shapes. One has no
  type to lead the builder to it: `lib/setup/pack.ts` parses the
  generated manifest with its own local type, iterates
  `pipelines[workType]`, and checks only top-level `bindings` for unbound
  stage slots. It must normalize the shape and check a pipeline's
  overrides too.
- Examples in this repo use `acme`, never a real team's pack name.
- Stage copy directory names pass `isSafeName` and never collide with a
  roster verb name (`compileTargets` throws on that today).

## Left to the builder

- How `StageEntry` records which engine a copy runs (it has no engine
  field today).
- The new placeholder that renders the orchestrator's stage table (not
  `{{pipeline.stages}}`, see Compile). `{{work-type}}`, `{{pipeline.stages}}`
  and the no-argument `{{run-start.flags}}` render as today whatever the
  verb's pipeline.
- The exact provenance key format for pipeline override slots, within what
  `readManifestProvenance` can parse.
- How `run-start.flags` is keyed once work type and pipeline differ.

## Acceptance

- A pack declares `feature` and `accessibility`, binds `stage-evidence`'s
  slot to fill A by default and fill B for `accessibility`, and adds a
  `work-a11y` command. `work` runs use fill A; `work-a11y` runs use fill B.
- A pack with one plain-list pipeline and no overrides compiles to
  byte-identical stages and non-work verbs and an identical generated
  manifest; its `work` verb carries the same stages, paths, consumes and
  produces as today.
- `work-a11y` never offers to resume a `feature` run, and `work` never
  offers to resume an `accessibility` run.
- An accessibility run's detail page shows the accessibility copy of each
  overridden stage.
- A base pack, the pack, and the personal override layer can each set a
  pipeline override slot, and the manifest's provenance shows which layer
  won.
- `rt skills bind --pipeline` writes the override, and refuses an
  undeclared pipeline or a stage outside it.
- `rt skills check` flags each error listed under Compile, and
  materialize fails, naming the pipeline, for each manifest error listed
  under Manifest shape and Compile.
- A `work-a11y` run records work type `work`, pipeline `accessibility`,
  and shows in console as a work run with its pipeline in the list row,
  header and filter.
- Console's wiring graph and rebind drawer show and change per-pipeline
  fills.
- The pack skills, init output, example, schema and docs pages describe the
  new shape.
