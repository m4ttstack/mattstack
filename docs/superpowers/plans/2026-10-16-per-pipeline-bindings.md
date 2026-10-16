# Per-pipeline Bindings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A team pack can declare a specialized pipeline with its own stage list and per-slot fill overrides, expose it as its own `work-<kind>` command, and see its runs in console as their own pipeline.

**Architecture:** A pipeline's manifest value becomes `string[] | { stages, bindings }`, normalized by pure helpers in a new `lib/skills/pipelines.ts`. Compile builds one extra copy of a stage, `<stage>--<pipeline>`, only where a pipeline's effective fills for that stage differ from the default, and sweeps copies that stop being targets. A work verb names its pipeline in `stubs.jsonc`; its orchestrator table, `run_start` flags and `run_list` filter come from that pipeline at compile time. Console reads additive fields on rt's composition, changes and run payloads.

**Tech Stack:** Bun + TypeScript (rt, `bun test` from the repo root), jsonc-parser, React + Mantine + vitest (console), Markdown skills (mattstack plugin).

**Spec:** `docs/superpowers/specs/2026-10-16-per-pipeline-bindings-design.md`

## Global Constraints

- A pack with one plain-list pipeline and no overrides: byte-identical compiled stages and non-work verbs, identical generated manifest. Only the compiled `work` verb's text may change, keeping the same stages, paths, consumes and produces.
- No migration: a plain-list pipeline stays valid in every fragment, manifest and `--manifest` file.
- rt `--json` envelopes are frozen: new fields are additive only (`commands/__tests__/skills-json-frozen.test.ts` stays green with no edits to existing expectations). The composition's `pipelines` stays `Record<string, string[]>`.
- Console server types in `apps/console/src/server/skills.ts` mirror rt payloads and change in the same task as rt.
- Examples and fixtures use `acme`, never a real team's pack name.
- Every edit under `plugins/mattstack` bumps `plugins/mattstack/.claude-plugin/plugin.json`'s version once on the branch. Any MCP tool change regenerates `plugins/mattstack/attachments/mcp-tools/reference.md` (`bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`).
- Skill edits load `superpowers:writing-skills` and `mattstack:editing-skills` first.
- Console UI changes are rendered in Fast Browser and screenshotted in light and dark before the task is done.
- Run `bun test` from the repo root only, on targeted files. A compiled `rt` binary only ever runs under `env -i HOME=<temp>`.
- Pipeline names match `^[a-z][a-z0-9-]*$`. Stage copy names are `${stage}--${pipeline}` (e.g. `stage-evidence--accessibility`), and two pipelines never share a copy.
- The stage allowed-tools union stays off for `work`: nothing new may use `{{pipeline.stages}}`.
- Output goes through `lib/ui/out.ts`; lib code warns through `warn()` from `lib/ui/warn.ts`; no `console.*`.

## Review Focus

1. An override whose fill equals the default, or a `""` override where the default slot is absent: no copy, byte-identical output (Task 3 tests `override equal to default makes no copy`, `empty override over an absent slot makes no copy`).
2. A `""` override where the default is bound: the copy compiles with that slot unbound (Task 3 test `empty override unbinds in the copy only`).
3. A layer gives a pipeline only `bindings` and no layer gives it stages: materialize fails naming the pipeline (Task 1 test `bindings-only pipeline with no stages anywhere`).
4. Old runs whose `pipeline` is `work` or `""`, under the default verb's `run_list` filter (Task 5 test `legacy work runs match the default verb`).
5. A work verb's `pipeline` naming an undeclared or badly named pipeline: a clean compile/check error naming the verb, never a throw from inside a placeholder (Task 4 test `verb names an undeclared pipeline`).

---

### Task 1: Pipeline helpers, manifest merge and render

**Files:**
- Create: `lib/skills/pipelines.ts` (pure; imports nothing from `sources.ts`, avoiding a cycle with `manifest-merge.ts`)
- Modify: `lib/skills/manifest-merge.ts`
- Modify: `plugins/mattstack/plugin/schemas/skills-manifest.schema.json:35-44`
- Test: `lib/skills/__tests__/pipelines.test.ts` (create), `lib/skills/__tests__/manifest-merge.test.ts`

**Interfaces:**
- Produces, in `pipelines.ts`:
  - `type BindingsMap = Record<string, Record<string, string>>`
  - `type PipelineValue = string[] | { stages?: string[]; bindings?: BindingsMap }`
  - `PIPELINE_NAME_RE = /^[a-z][a-z0-9-]*$/`
  - `normalizePipelines(raw: unknown): { stages: Record<string, string[]>; bindings: Record<string, BindingsMap> }`: a plain list gives stages and no bindings; an object gives what it has; a pipeline with neither is omitted from both.
  - `pipelineBindingKey(type: string, engineRef: string, slot: string): string` returns `` `${type}/${engineRef} ${slot}` ``.
  - `stageCopyName(stage: string, pipeline: string): string` returns `` `${stage}--${pipeline}` ``.
  - `effectiveSlotBindings(defaults: BindingsMap, overrides: BindingsMap | undefined, engineRef: string): Record<string, string>`: default slots with the override slots on top.
  - `fillsDiffer(defaults: BindingsMap, overrides: BindingsMap | undefined, engineRef: string): boolean`: true when the effective map differs from the default's, treating a `""` slot and an absent slot as equal.
  - `defaultPipeline(stages: Record<string, string[]>): string | null`: the only key when there is one, else `"feature"` when present, else null.
- Produces, in `manifest-merge.ts`: `Fragment.pipelines?: Record<string, PipelineValue>`; `MergedManifest` gains `pipelineBindings: Record<string, BindingsMap>` and `dropped: { key: string; layer: string }[]`; `readManifestDropped(text: string): { key: string; layer: string }[]`.

- [ ] **Step 1: Write the failing tests.** `pipelines.test.ts` covers each helper, including `fillsDiffer` true for `"acme:b"` over `"acme:a"`, false for `"acme:a"` over `"acme:a"`, false for `""` over an absent slot, true for `""` over `"acme:a"`. `manifest-merge.test.ts` adds:
  - `object pipeline parses`: accepts `{"pipelines":{"accessibility":{"stages":["mattstack:stage-plan"],"bindings":{"mattstack:stage-plan":{"x":"acme:y"}}}}}`. Rejects `{"pipelines":{"a":{"stages":"x"}}}` with `fragment pipelines.a.stages is not an array of strings: <path>`, and `{"pipelines":{"a":{"bindings":{"r":{"s":1}}}}}` with `fragment pipelines.a.bindings.r.s is not a string: <path>`.
  - `stages replace whole, pipeline bindings merge per slot`: layers default `{a:{stages:[s1,s2],bindings:{r:{x:"f1"}}}}`, pack `{a:{bindings:{r:{y:"f2"}}}}`, override `{a:{stages:[s1]}}` merge to `pipelines.a == [s1]` and `pipelineBindings.a.r == {x:"f1", y:"f2"}`, with provenance `pipeline a <- override`, `a/r x <- default`, `a/r y <- pack` (here `r` is listed in `[s1]`).
  - `bindings-only pipeline with no stages anywhere`: throws `FragmentError` `pipeline "a" has bindings but no layer gives it stages`.
  - `bad pipeline name`: a key `Access_ibility` throws `FragmentError` `pipeline "Access_ibility" must match [a-z][a-z0-9-]*`.
  - `override for a stage a higher layer dropped`: base sets `a.bindings["mattstack:stage-gates"]`, the pack sets `a.stages` without it. The merged `pipelineBindings.a` lacks that ref, and `dropped == [{key:"a/mattstack:stage-gates <slot>", layer:"base:acme-base"}]`.
  - `override for a stage missing from its own layer's list`: throws `FragmentError` `pipeline "a" binds <ref> but does not list it`.
  - `render: no overrides stays a plain list`: byte-identical to today's `renderManifest` output (pin the expected string from current code before editing).
  - `render: overrides use the object form`; `readManifestDropped` round-trips `// dropped: <key> <- <layer>` header lines.
- [ ] **Step 2: Run** `bun test lib/skills/__tests__/pipelines.test.ts lib/skills/__tests__/manifest-merge.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** `pipelines.ts`. In `manifest-merge.ts`: `shapeError` takes both forms and checks names against `PIPELINE_NAME_RE`. `mergeLayers` replaces `stages` whole per layer and merges pipeline `bindings` per slot (keeping `""`, as top-level does). After all layers, for each pipeline: no stages → throw; an override ref not in its stages → throw if the stages' layer set the override, else drop it into `dropped`. `renderManifest` writes a plain list when a pipeline has no bindings, else `{ "stages": [...], "bindings": {...} }`, plus one `// dropped: <key> <- <layer>` header line per dropped override after the provenance lines.
- [ ] **Step 4: Schema**: `pipelines.additionalProperties` becomes `oneOf` [today's array; `{ stages: array minItems 1, bindings: <top-level bindings shape> }`, `additionalProperties: false`]. The description drops "a pack lists all eight" and says a pipeline may carry `bindings` overriding the top-level ones per slot.
- [ ] **Step 5: Run** `bun test lib/skills/__tests__/pipelines.test.ts lib/skills/__tests__/manifest-merge.test.ts lib/skills/__tests__/materialize.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `skills: pipelines take an object form with per-slot binding overrides`.

### Task 2: Manifest readers outside compile

**Files:**
- Modify: `lib/skills/sources.ts:552-570`
- Modify: `lib/setup/pack.ts:20-87`
- Modify: `lib/skills/changes.ts:13,151-180`
- Modify: `lib/skills/materialize.ts` (warn on `dropped`)
- Test: `lib/skills/__tests__/sources.test.ts`, `lib/skills/__tests__/changes.test.ts`, `lib/skills/__tests__/materialize.test.ts`, and the existing test file for `lib/setup/pack.ts` (create `lib/setup/__tests__/pack.test.ts` if none)

**Interfaces:**
- Consumes: Task 1's helpers and `MergedManifest.dropped`.
- Produces: `readManifestPipelines(path): Record<string, string[]>` (same signature, both forms); `readManifestPipelineBindings(path): Record<string, BindingsMap>`; `BindingChange.pipeline?: string` (absent for default changes).

- [ ] **Step 1: Write the failing tests:**
  - `readManifestPipelines reads the object form`: both stage lists come back; `readManifestPipelineBindings` returns only `accessibility`'s map.
  - `pipeline override changes carry their pipeline`: changing only `pipelines.accessibility.bindings["mattstack:stage-evidence"]["evidence-domain"]` from `"acme:a"` to `"acme:b"` yields `[{engineRef:"mattstack:stage-evidence", slot:"evidence-domain", from:"acme:a", to:"acme:b", pipeline:"accessibility"}]`; a default-only change has no `pipeline` key.
  - Setup: an object-form `feature` reports `8 stages resolved for feature work`; a stage whose `feature` override is `""` while the default is bound reports `The stage-x stage has no skill bound to it`.
  - Materialize: one dropped override calls `warn` once with `` `${key} from ${layer} is ignored: the pipeline no longer lists that stage` `` (assert through `setWarningLog`, with `__test__.reset()` before and after).
- [ ] **Step 2: Run** those files. Expected: FAIL.
- [ ] **Step 3: Implement**: the readers go through `normalizePipelines`. `lib/setup/pack.ts` normalizes `manifest.pipelines` and checks each stage with `effectiveSlotBindings`. `bindingChanges` diffs top-level bindings, then each pipeline's, tagging those with `pipeline`. Materialize warns once per dropped override, shown.
- [ ] **Step 4: Run** the files. Expected: PASS.
- [ ] **Step 5: Commit** `skills: manifest readers accept per-pipeline bindings`.

### Task 3: Stage copies in compile, and their sweep

**Files:**
- Modify: `lib/skills/types.ts:33-41` (`VerbDef`, `StageEntry`)
- Modify: `lib/skills/sources.ts:537-589` (`readVerbRoster`, `stageRoster`)
- Modify: `lib/skills/layout.ts:29-60` (`buildStageEntries`)
- Modify: `commands/skills.ts`: `resolve` (608-671), `loadFillsFor`, `stageAllowedToolsFor`, `compileVerb`'s stage dir lookup, `stageNamesFor` (~2465), and `performCompile` (the new copy sweep)
- Test: `lib/skills/__tests__/sources.test.ts`, `lib/skills/__tests__/layout.test.ts`, `lib/skills/__tests__/compile-native.e2e.test.ts`; new fixture `lib/skills/__tests__/fixtures/compile-pipelines/` (below)

**Interfaces:**
- Consumes: Task 1's helpers, `readManifestPipelineBindings`.
- Produces:
  - `VerbDef.pipeline?: string`: from a stubs entry's `pipeline`, and set on copies.
  - `StageEntry.engine: string`: `StageEntry.name` is the compiled target name, the copy's for a copy.
  - `stageRoster(pipelines: Record<string, string[]>, pipelineBindings: Record<string, BindingsMap>, defaults: BindingsMap): VerbDef[]`: today's deduped stages, then a copy `{ name: stageCopyName(s, p), engine: s, description: "", pipeline: p }` for each (p, s) where `fillsDiffer`. Pipeline names failing `PIPELINE_NAME_RE` throw `pipeline "<p>" must match [a-z][a-z0-9-]*`, as hand-written `--manifest` files skip materialize.
  - `Resolved.pipelineBindings: Record<string, BindingsMap>`
  - `buildStageEntries` input gains `copies: Set<string>`; a pipeline's entry for a copied stage uses the copy's name and dir.
  - `loadFillsFor(step, resolved, where, pipeline?: string)`

**Fixture:** `compile-pipelines` is a test that builds a temp mattstack root with the same layout as `compile-native`'s helper. It copies the real `plugins/mattstack/attachments/pipeline/` (the `work` engine and all eight stages) and adds a pack `acme`:
- the eight-stage `feature` pipeline;
- an `accessibility` pipeline with the same stages;
- two fills providing `stage-evidence`'s domain slot contract, `acme:evidence-a` and `acme:evidence-b`, with default `evidence-a` and an `accessibility` override `evidence-b`;
- verbs `work` and `work-a11y` (`"pipeline": "accessibility"`) in stubs.

The `compile-native` fixture stays untouched; it is the byte-identity baseline.

- [ ] **Step 1: Write the failing tests:**
  - `sources.test.ts`, `stageRoster` with both pipelines listing `mattstack:stage-evidence` and the default `{ "mattstack:stage-evidence": { "evidence-domain": "acme:a" } }`:
    - `override equal to default makes no copy`.
    - `empty override over an absent slot makes no copy`.
    - override `"acme:b"` adds `{ name: "stage-evidence--accessibility", engine: "stage-evidence", pipeline: "accessibility" }`.
    - `empty override unbinds in the copy only`.
    - a key `../x` throws the name error.
  - `readVerbRoster` reads `pipeline`.
  - `layout.test.ts`: `accessibility`'s evidence entry has the copy's name, `engine: "stage-evidence"`, and a dir ending `/attachments/stage-evidence--accessibility`; `feature`'s keeps `stage-evidence`.
  - `compile-native.e2e.test.ts`:
    - `no overrides is byte-identical`: the `compile-native` fixture compiles to the committed snapshot. Capture the snapshot from this branch before any Task 3 code change, and commit it in Step 1.
    - `per-pipeline fill compiles a copy` (`compile-pipelines`): `attachments/stage-evidence/SKILL.md` carries `evidence-a`'s body and `attachments/stage-evidence--accessibility/SKILL.md` carries `evidence-b`'s.
    - `a dropped override removes its copy`: recompiling after deleting the override removes `stage-evidence--accessibility/`, and `check` before that recompile reports it.
- [ ] **Step 2: Run** those files. Expected: FAIL.
- [ ] **Step 3: Implement**:
  - `resolve()` reads `pipelineBindings` and passes them to `stageRoster` and `buildStageEntries`; so does `stageNamesFor`.
  - `loadFillsFor` uses `effectiveSlotBindings` with the given pipeline. `compileVerb` passes `target.verb.pipeline` for a copy, and its stage dir lookup still matches by exact name.
  - `stageAllowedToolsFor` loads `entry.engine` with that entry's pipeline (it only runs for `{{pipeline.stages}}` engines, unchanged).
  - **Sweep:** after writing, `performCompile` removes any dir under the pack's `attachments/` or `skills/` that:
    - matches `^stage-[a-z0-9-]+--[a-z][a-z0-9-]*$`,
    - holds a `SKILL.md` that starts with the compiled-by header,
    - and is not a current target.

    `check` reports each such dir as drift: `stale stage copy <name>: run rt skills compile`.
- [ ] **Step 4: Run** the files plus `commands/__tests__/skills.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `skills: compile a stage copy per pipeline that overrides its fills`.

### Task 4: Work verbs run their own pipeline

**Files:**
- Modify: `lib/skills/types.ts` (`PlaceholderContext.pipeline`)
- Modify: `lib/skills/placeholders.ts:139-153,270-300` (`run-start.flags`, new `pipeline.table` and `run-list.pipelines`, trace parts)
- Modify: `lib/skills/compile.ts` (`compileSkill` options carry `pipeline` into the context)
- Modify: `lib/skills/anatomy.ts` (only if `buildParts` needs per-row rendered lines for a multi-part trace entry)
- Modify: `commands/skills.ts` (`compileVerb` sets `pipeline`; the new errors run wherever `pipelineChainErrors` runs: compile, `compilePackAll`, check; `CheckPayload` gains `droppedOverrides`)
- Modify: `plugins/mattstack/attachments/pipeline/work/SKILL.md`, `plugins/mattstack/.claude-plugin/plugin.json`
- Test: `lib/skills/__tests__/placeholders.test.ts`, `lib/skills/__tests__/anatomy.test.ts`, `commands/__tests__/skills.test.ts`, `lib/skills/__tests__/compile-native.e2e.test.ts` (`compile-pipelines`)

**Interfaces:**
- Consumes: `VerbDef.pipeline`, `StageEntry.engine`, copies, `defaultPipeline`, `readManifestDropped`.
- Produces:
  - `PlaceholderContext.pipeline: string | null`: `verb.pipeline ?? defaultPipeline(...)` for a roster verb whose engine body uses `{{pipeline.table}}`; null for every other target.
  - `{{pipeline.table}}`:
    - Renders the header `| Stage | Read | Consumes | Produces |` and `|---|---|---|---|`, then one row per entry of `ctx.pipelines[ctx.pipeline]`: `` | `<entry.stage>` | `${CLAUDE_SKILL_DIR}/<verbPath(entry.name)>` | <consumes> | <produces> | ``.
    - Lists are backticked names joined by single spaces; an empty list renders `nothing`.
    - Its trace entry lists one `{ kind: "verb.path", arg: entry.name }` per row, so anatomy yields one `verb.path` part per row.
    - With `pipeline: null` it throws `` `${where}: {{pipeline.table}} used by a verb with no pipeline` ``.
  - `{{run-start.flags:<arg>}}`: `--work-type <arg> --pipeline <ctx.pipeline ?? arg>`.
  - `{{run-list.pipelines}}`: a comma-separated list of backticked names, `` `accessibility` `` or `` `feature`, `work` `` (the default verb adds `work`). It is prose-safe and has no double quotes.
  - `{{work-type}}`, `{{pipeline.stages}}` and the no-argument `{{run-start.flags}}` render exactly as today.
  - `CheckPayload.droppedOverrides?: { key: string; layer: string }[]` (additive), rendered by `checkBlocks` as one `warn` line each.

- [ ] **Step 1: Write the failing tests:**
  - `placeholders.test.ts`:
    - `pipeline.table` for the eight default stages renders exactly today's eight rows and header from `work/SKILL.md`.
    - with an `accessibility` evidence copy, that row's Read path names `stage-evidence--accessibility`.
    - the trace for that line has eight `verb.path` placeholders.
    - `run-start.flags:work` with `pipeline: "accessibility"` renders `--work-type work --pipeline accessibility`; with null it is unchanged.
    - `run-list.pipelines` renders `` `feature`, `work` `` for the default and `` `accessibility` `` otherwise.
    - the null-pipeline throw.
  - `anatomy.test.ts`: a `pipeline.table` trace entry yields eight `verb.path` parts with targets, each on its own rendered line.
  - `skills.test.ts`, check errors on a manifest where a `{{pipeline.table}}` verb runs the pipeline (compile refuses with the same messages, never throwing from a placeholder):
    - `verb names an undeclared pipeline`: `verb "work-a11y" runs pipeline "accessibility", which the manifest does not declare`.
    - several pipelines, none `feature`, a table verb with no `pipeline`: `verb "work" names no pipeline and the manifest declares several with none named feature`.
    - a pipeline run by a table verb that does not start with `mattstack:stage-provision`, end with `mattstack:stage-watch-ci`, and include `mattstack:stage-implement` and `mattstack:stage-ship`: `pipeline "accessibility" must start with stage-provision, end with stage-watch-ci, and include stage-implement and stage-ship`.
    - the same subset pipeline in a pack whose verbs never use `{{pipeline.table}}` passes, as today. Existing subset fixtures stay green.
    - a hand-written `--manifest` override naming an unlisted stage: `pipeline "accessibility" binds mattstack:stage-x but does not list it`.
    - a generated manifest with a `// dropped:` line: check passes, and `--json` carries `droppedOverrides`.
  - `compile-native.e2e.test.ts` (`compile-pipelines`):
    - `work-a11y compiles against its pipeline`: the accessibility table, `--pipeline accessibility`, and a resume line naming `` `accessibility` ``.
    - plain `work` carries `--pipeline feature`, the same eight rows as today, and every `.md` it emits passes `python3 plugins/mattstack/plugin/skills/process-digraphs/check-dot.py`.
- [ ] **Step 2: Run** those files. Expected: FAIL.
- [ ] **Step 3: Implement** the context field, placeholders, trace parts and checks.
- [ ] **Step 4: Edit `work/SKILL.md`** (load writing-skills and editing-skills first):
  - Replace the eight hand-written rows and their header with `{{pipeline.table}}`.
  - "You run one unit of work through eight stages" becomes "through the stages below".
  - Leave the digraph's `run_list {repo}` node and edge labels as `run_list {repo, pipelines}`, with no placeholder inside the dot fence.
  - Add a "What the graph cannot show" bullet: "**Resume filter.** `run_list`'s `pipelines` is {{run-list.pipelines}}; only those runs are offered to resume."
  - The `pipeline-stages` note drops the eight-name example and says it is the Stage column of the table above.

  Bump the plugin version. Run `sh plugins/mattstack/tests/certify.sh plugins/mattstack/attachments/pipeline/work` (or the path form CI uses at `.github/workflows/checks.yml:310`) and `python3 plugins/mattstack/plugin/skills/process-digraphs/check-dot.py plugins/mattstack/attachments/pipeline/work/SKILL.md`. Expected: both pass.
- [ ] **Step 5: Run** the four test files, then `env -i HOME="$(mktemp -d)" PATH="$PATH" bun cli.ts skills check --strict --pack-dir plugins/mattstack --mattstack-dir "$(mktemp -d)"`. Expected: PASS.
- [ ] **Step 6: Commit** `work: build the stage table and run flags from the verb's pipeline`.

### Task 5: `run_list` filters by pipeline

**Files:**
- Modify: `lib/mcp/run-tools.ts:250-260`
- Modify: `plugins/mattstack/attachments/mcp-tools/reference.md` (regenerated)
- Test: the existing run-tools test file under `lib/mcp/__tests__/`

**Interfaces:**
- Produces: `run_list` input `{ repo?: string; pipelines?: string[] }`. With `pipelines`, `res.data.runs` keeps only runs whose `pipeline` is in it; a `pipeline` of `""` counts as `"work"`.

- [ ] **Step 1: Write the failing test** `legacy work runs match the default verb`. A fake `deps.list` returns runs with pipeline `feature`, `work`, `accessibility` and `""`:
  - `pipelines: ["feature","work"]` returns the first, second and fourth;
  - `["accessibility"]` returns the third;
  - `pipelines: "x"` or `[1]` returns the error `"pipelines" must be an array of strings`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** a custom array check (`checkOptional` has no array type) and the filter on `res.data.runs` before `fromResponse`. The description says it narrows by pipeline.
- [ ] **Step 4: Regenerate** the reference with the Global Constraints command, then rerun the test. Expected: PASS.
- [ ] **Step 5: Commit** `run_list: filter by pipeline`.

### Task 6: `rt skills bind --pipeline` and composition fields

**Files:**
- Modify: `commands/skills.ts`: `BindFlags`, `separateBindArgs` and `parseBindFlags` (2938-3002), `skillsBind`, `pickBindArgs`, `applyBind`, `buildBinders`, `CompositionVerb`, composition targets
- Test: `commands/__tests__/skills-bind.test.ts`, `commands/__tests__/skills.test.ts`, `commands/__tests__/skills-json-frozen.test.ts`

**Interfaces:**
- Consumes: `pipelineBindingKey`, `readManifestPipelineBindings`, copies (Task 3).
- Produces:
  - `BindFlags.pipeline: string | null`, with `--pipeline` in `separateBindArgs`' valued set.
  - `applyBind(opts & { pipeline: string | null })`
  - A composition binder slot gains `overrides?: { pipeline: string; boundTo: string; layer: string | null }[]`, present only when one exists. A ref bound only by overrides still gets a binder, with `boundTo: ""`.
  - `CompositionVerb.pipeline?: string`. A copy's composition target gains `engine` and `pipeline`.

- [ ] **Step 1: Write the failing tests** in `skills-bind.test.ts`:
  - `--pipeline writes the override`: a plain-list `accessibility` becomes `{ "stages": [<same list>], "bindings": { "mattstack:stage-evidence": { "evidence-domain": "acme:b" } } }`. With no `accessibility` key in the fragment, only `{ "bindings": ... }` is written.
  - Refusals, nothing written:
    - an undeclared pipeline: `pipeline "nope" is not declared in this pack's manifest`;
    - a stage the pipeline does not list: `stage-x is not a stage of pipeline "accessibility"`;
    - a copy name as the verb: `stage-evidence--accessibility is a compiled copy; bind stage-evidence --pipeline accessibility instead`.
  - The picker never lists copy names.
  - `shadowedBy` reads the `pipelineBindingKey` provenance.
  - `skills.test.ts`: the `compile-pipelines` composition carries the override on the evidence binder slot, `pipeline: "accessibility"` on `work-a11y`, and `engine`/`pipeline` on the copy target. `skills-json-frozen.test.ts` passes unedited.
- [ ] **Step 2: Run** those three files. Expected: FAIL.
- [ ] **Step 3: Implement**:
  - `applyBind` edits `["pipelines", p, "bindings", ref, slot]`, first replacing a plain-list value with `{ stages: <list> }`.
  - The refusals run before any write.
  - `buildBinders` iterates the union of default and override refs.
  - The usage line shows `[--pipeline <name>]`.
- [ ] **Step 4: Run** the files. Expected: PASS.
- [ ] **Step 5: Commit** `skills bind: --pipeline writes a pipeline override`.

### Task 7: Console wiring view and rebind per pipeline

**Files:**
- Modify: `apps/console/src/server/skills.ts` (types near 120-135 and 320-325; bind route at 1167 and its body type near 242 take `pipeline?: string`)
- Modify: `apps/console/src/app/wiring/outline.ts` (`invertBindings` ~222, `slotsFor` ~350, the spine at 328-349, the orphan check ~521)
- Modify: `apps/console/src/app/wiring/graph/model/templateModel.ts` (`textNounOf` 336-343; spine lead verb)
- Modify: `apps/console/src/app/wiring/graph/drawer/rebind.ts`, `drawer/usedBy.ts`, `graph/model/pendingChanges.ts`
- Modify: `apps/console/src/server/fixtures/design/composition.json` (an `accessibility` override, a `work-a11y` verb and a copy target)
- Test: `apps/console/src/app/wiring/graph/__tests__/` (`rebindChoices.test.ts`, `pendingChanges.test.ts`), the existing outline and templateModel tests, `apps/console/src/server/skills.test.ts`

**Interfaces:**
- Consumes: binder slot `overrides`, `CompositionVerb.pipeline`, copy targets' `engine`/`pipeline`, `BindingChange.pipeline`, bind `--pipeline`.
- Produces:
  - `BindingSite.pipeline?: string`
  - `effectiveBoundTo(slot, workType: string | null): string`: the override for `workType` if present, else `boundTo`.
  - `rebindChoices(composition, skill, ref, slot, workType: string | null)`
  - Pending change row keys become `` `binding:${pipeline ?? ""}:${engineRef}:${slot}` ``, and `sameChanges` compares `pipeline` too.

- [ ] **Step 1: Write the failing tests**:
  - `invertBindings` lists an override-only fill with `pipeline: "accessibility"`, and the orphan check does not flag it.
  - `slotsFor` shows fill B under `accessibility` and fill A under `feature`.
  - The `accessibility` spine leads with `work-a11y`, and `textNounOf` treats `work-a11y` as an orchestrator.
  - Copy targets are not drawn as extra stages; they group under their `engine`.
  - `rebindChoices` returns `current` as the override under `accessibility` and the default under `feature`.
  - A pending change with `pipeline` gets the row label `` `${slot} · ${pipeline}` ``, and a default change and an override change on one slot stay two rows.
  - The server's POST `/api/skills/bind` with `pipeline` runs rt with `--pipeline accessibility`.
- [ ] **Step 2: Run** them (`cd apps/console && bunx vitest run <files>`). Expected: FAIL.
- [ ] **Step 3: Implement**; the drawer takes the graph's selected work type.
- [ ] **Step 4: Run** the files. Expected: PASS.
- [ ] **Step 5: UI check**: run console on the design fixture. Open the wiring graph for `work` (stage links still present), switch to `accessibility`, and open the evidence slot's rebind drawer. Screenshot light and dark in Fast Browser and say what looks wrong.
- [ ] **Step 6: Commit** `console: per-pipeline fills in the wiring view and rebind drawer`.

### Task 8: Console runs show and filter by pipeline

**Files:**
- Modify: `apps/console/src/app/runs/runs-page/useRunsUrl.ts`, `runs-page/RunsPage.tsx`, `runs-page/EarlierList.tsx`, `apps/console/src/app/runs/StatusCard.tsx`
- Modify: `apps/console/src/server/stageDoc.ts:20-24,44-46,106-135`, `apps/console/src/server/effectiveInputs.ts:290-320`
- Modify: `apps/console/src/server/fixtures/design/runsFixture.ts` (an accessibility run; its fixture `stageDoc` returns the copy's text)
- Test: tests beside each file; `apps/console/src/server/stageDoc.test.ts`

**Interfaces:**
- Produces:
  - `RunsUrl.pipeline: string | null` (`?pipeline=`).
  - `StageDocInput.pipeline: string | null`: `resolveStageDoc` tries `stage-<stage>--<pipeline>` before `stage-<stage>`, on both the sha and version paths.

- [ ] **Step 1: Write the failing tests**:
  - `?pipeline=accessibility` round-trips, and absent gives `null`.
  - With `feature` and `accessibility` runs, choosing `accessibility` lists only that run. The control is hidden when all runs share one pipeline.
  - A run row shows its pipeline.
  - With both stage dirs in the tree, `stageDoc` returns the copy's text for `pipeline: "accessibility"` and the default's for `feature`.
- [ ] **Step 2: Run** the files. Expected: FAIL.
- [ ] **Step 3: Implement**; `effectiveInputs.ts` passes `res.data.run.pipeline`.
- [ ] **Step 4: Run** the files. Expected: PASS.
- [ ] **Step 5: UI check**: the runs list with and without the filter, and the accessibility run's stage doc. Screenshot light and dark in Fast Browser and say what looks wrong.
- [ ] **Step 6: Commit** `console: runs show and filter by pipeline`.

### Task 9: Pack authoring and docs

**Files:**
- Modify: `lib/skills/init.ts:249-300` (seeded comments)
- Modify: `plugins/mattstack/plugin/skills/{creating-a-pack,extending-a-pack,editing-skills}/SKILL.md`
- Modify: `plugins/mattstack/docs/your-first-pack.md`, `plugins/mattstack/plugin/examples/skills.jsonc` (including its line-10 comment), `plugins/mattstack/plugin/schemas/skills-manifest.md:41`, `plugins/mattstack/README.md:155`, `plugins/mattstack/attachments/parameterized-skills/references/convention.md:283-302`
- Modify: `website/docs/rt/reference/skills/{bind,compile,composition,anatomy,check}.mdx` and every page `git grep -l pipelines website/docs` finds that describes manifest pipelines
- Test: `lib/skills/__tests__/init.test.ts`

- [ ] **Step 1: Write the failing test** `seeded fragment explains pipelines`. `renderPackFiles({pack:"acme", workDescription:"d"})["pack/skills.jsonc"]` contains `add a specialized pipeline with mattstack:extending-a-pack`, and the stubs comment mentions `"pipeline"` for a `work-<kind>` verb. The parsed JSON is unchanged.
- [ ] **Step 2: Run** it. Expected: FAIL. **Step 3:** update the comments. **Step 4:** run it. Expected: PASS.
- [ ] **Step 5: Skills** (load writing-skills and editing-skills; RED/GREEN each):
  - `extending-a-pack` gains the recipe "Add a specialized pipeline": declare it, add a `work-<kind>` verb with `"pipeline"`, `rt skills bind --pipeline`, then compile and check.
  - `creating-a-pack` says the seed has one `feature` pipeline and points to that recipe.
  - `editing-skills` notes that `<stage>--<pipeline>` dirs are compiled output.
- [ ] **Step 6: Docs**: replace every "fixed eight" / "lists all eight" / "order is fixed" statement with the new rules. That is: provision first, watch-ci last, implement and ship required for a pipeline a work verb runs, and any order the chain check accepts otherwise. `convention.md`'s placeholder list adds `pipeline.table` and `run-list.pipelines`. The example manifest shows an `accessibility` pipeline in object form. The reference pages document `--pipeline`, stage copies and `work-<kind>` verbs. Use `acme`.
- [ ] **Step 7: Run** `env -i HOME="$(mktemp -d)" PATH="$PATH" bun cli.ts skills check --strict --pack-dir plugins/mattstack --mattstack-dir "$(mktemp -d)"`, `python3 plugins/mattstack/plugin/skills/process-digraphs/check-dot.py` on every touched `.md` with a dot fence, and `bun run check`. Expected: PASS.
- [ ] **Step 8: Commit** `docs: per-pipeline bindings and work-<kind> verbs`.
