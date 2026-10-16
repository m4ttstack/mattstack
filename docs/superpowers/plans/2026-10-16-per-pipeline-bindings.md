# Per-pipeline Bindings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A team pack can declare a specialized pipeline with its own stage list and per-slot fill overrides, expose it as its own `work-<kind>` command, and see its runs in console as their own pipeline.

**Architecture:** A pipeline's manifest value becomes `string[] | { stages, bindings }`, normalized once in `lib/skills/manifest-merge.ts`. Compile builds one extra copy of a stage, named `<stage>--<pipeline>`, only where a pipeline's effective fills for that stage differ from the default. A work verb names its pipeline in `stubs.jsonc`; its orchestrator table, `run_start` flags and `run_list` filter are rendered from that pipeline at compile time. Console reads additive fields on rt's composition, changes and run payloads.

**Tech Stack:** Bun + TypeScript (rt, `bun test` from the repo root), jsonc-parser, React + Mantine + vitest (console), Markdown skills (mattstack plugin).

**Spec:** `docs/superpowers/specs/2026-10-16-per-pipeline-bindings-design.md`

## Global Constraints

- A pack with one plain-list pipeline and no overrides: byte-identical compiled stages and non-work verbs, identical generated manifest. Only the compiled `work` verb's text may change, keeping the same stages, paths, consumes and produces.
- No migration: a plain-list pipeline stays valid in every fragment, manifest and `--manifest` file.
- rt `--json` envelopes are frozen: new fields are additive only (`commands/__tests__/skills-json-frozen.test.ts` must stay green unchanged except for added keys).
- Console server types in `apps/console/src/server/skills.ts` mirror rt payloads and change in the same task as rt.
- Examples and fixtures use `acme`, never a real team's pack name.
- Every edit under `plugins/mattstack` bumps `plugins/mattstack/.claude-plugin/plugin.json`'s version once on the branch; any MCP tool change regenerates `plugins/mattstack/attachments/mcp-tools/reference.md` (`bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`).
- Skill edits load `superpowers:writing-skills` and `mattstack:editing-skills` first.
- Console UI changes are rendered in Fast Browser and screenshotted in light and dark before the task is done.
- Run `bun test` from the repo root only; run targeted test files, not the full suite.
- Pipeline names match `^[a-z][a-z0-9-]*$` (already the schema's `propertyNames`). Stage copy names are `${stage}--${pipeline}` (e.g. `stage-evidence--accessibility`).
- Output goes through `lib/ui/out.ts`; lib code warns through `warn()` from `lib/ui/warn.ts`; no `console.*`.

## Review Focus

1. A pipeline override whose fill equals the default fill: no copy is made and output is byte-identical (Task 3 test `override equal to default makes no copy`).
2. A pipeline override of `""` when the default is bound: the copy compiles with that slot unbound (Task 3 test `empty override unbinds in the copy only`).
3. A layer sets only `bindings` for a pipeline no layer gives `stages`: materialize fails with a sentence naming the pipeline, not a crash (Task 1 test `bindings-only pipeline with no stages anywhere`).
4. Old runs whose `pipeline` is `work`, and runs with no `pipeline` at all, under the default verb's `run_list` filter (Task 5 test `legacy work runs match the default verb`).
5. A work verb's `pipeline` naming an undeclared or badly named pipeline: a check error naming the verb, never a crash in compile (Task 4 test `verb names an undeclared pipeline`).

---

### Task 1: Manifest shape, merge and render

**Files:**
- Modify: `lib/skills/manifest-merge.ts`
- Modify: `plugins/mattstack/plugin/schemas/skills-manifest.schema.json:35-44`
- Test: `lib/skills/__tests__/manifest-merge.test.ts`

**Interfaces:**
- Produces:
  - `type BindingsMap = Record<string, Record<string, string>>`
  - `type PipelineValue = string[] | { stages?: string[]; bindings?: BindingsMap }`
  - `Fragment.pipelines?: Record<string, PipelineValue>`
  - `normalizePipelines(raw: unknown): { stages: Record<string, string[]>; bindings: Record<string, BindingsMap> }`: a plain list gives stages and no bindings; an object gives what it has; a pipeline with neither is omitted from both.
  - `pipelineBindingKey(type: string, engineRef: string, slot: string): string` returns `` `${type}/${engineRef} ${slot}` ``.
  - `MergedManifest` gains `pipelineBindings: Record<string, BindingsMap>` and `dropped: { key: string; layer: string }[]`.
  - `readManifestDropped(text: string): { key: string; layer: string }[]`

- [ ] **Step 1: Write the failing tests** in `manifest-merge.test.ts`:
  - `object pipeline parses`: `parseFragment` accepts `{"pipelines":{"accessibility":{"stages":["mattstack:stage-plan"],"bindings":{"mattstack:stage-plan":{"x":"acme:y"}}}}}`; rejects `{"pipelines":{"a":{"stages":"x"}}}` with message `fragment pipelines.a.stages is not an array of strings: <path>` and `{"pipelines":{"a":{"bindings":{"r":{"s":1}}}}}` with `fragment pipelines.a.bindings.r.s is not a string: <path>`.
  - `stages replace whole, pipeline bindings merge per slot`: layers default `{a:{stages:[s1,s2],bindings:{r:{x:"f1"}}}}`, pack `{a:{bindings:{r:{y:"f2"}}}}`, override `{a:{stages:[s1]}}` merge to `pipelines.a == [s1]`, `pipelineBindings.a.r == {x:"f1", y:"f2"}`, provenance `pipeline a <- override`, `a/r x <- default`, `a/r y <- pack`.
  - `bindings-only pipeline with no stages anywhere`: merging `{pack:{a:{bindings:{...}}}}` throws `FragmentError` with message `pipeline "a" has bindings but no layer gives it stages`.
  - `override for a stage a higher layer dropped`: base sets `a.bindings["mattstack:stage-gates"]`, pack sets `a.stages` without `mattstack:stage-gates`: merged `pipelineBindings.a` lacks that ref; `dropped == [{key:"a/mattstack:stage-gates <slot>", layer:"base:acme-base"}]`.
  - `override for a stage missing from its own layer's list`: one layer sets `a.stages=[s1]` and `a.bindings[s2]`: throws `FragmentError` `pipeline "a" binds mattstack:<s2> but does not list it`.
  - `render: no overrides stays a plain list`: a merge with no pipeline bindings renders byte-identical to today's `renderManifest` output (pin with an inline expected string from the current code).
  - `render: overrides use the object form` and `readManifestDropped` round-trips `// dropped: <key> <- <layer>` header lines.
  - `normalizePipelines` on a plain list, an object, and an object with only `bindings`.
- [ ] **Step 2: Run** `bun test lib/skills/__tests__/manifest-merge.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** in `manifest-merge.ts`: extend `shapeError` for both pipeline forms; `mergeLayers` keeps `stages` replace-whole per layer and pipeline `bindings` merge per slot (empty string kept, as top-level); after all layers, for each pipeline: no stages → throw; an override ref not in its stages → throw when the stages' layer equals the override's layer, else drop it and record it in `dropped`. `renderManifest` writes a pipeline as a plain list when it has no bindings, else `{ "stages": [...], "bindings": {...} }`, and adds one `// dropped: <key> <- <layer>` header line per dropped override after the provenance lines.
- [ ] **Step 4: Update the schema**: `pipelines.additionalProperties` becomes `oneOf` [the existing array, an object `{ stages: array (minItems 1), bindings: <same shape as top-level bindings> }` with `additionalProperties: false`]; the description drops "a pack lists all eight" and says a pipeline may carry `bindings` overriding the top-level ones per slot.
- [ ] **Step 5: Run** `bun test lib/skills/__tests__/manifest-merge.test.ts lib/skills/__tests__/materialize.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `skills: pipelines take an object form with per-slot binding overrides`.

### Task 2: Manifest readers outside compile

**Files:**
- Modify: `lib/skills/sources.ts:552-570` (`readManifestPipelines`, add `readManifestPipelineBindings`)
- Modify: `lib/setup/pack.ts:20-87`
- Modify: `lib/skills/changes.ts:13,151-180`
- Modify: `lib/skills/materialize.ts` (surface `dropped` as a warning)
- Test: `lib/skills/__tests__/sources.test.ts`, `lib/skills/__tests__/changes.test.ts`, `lib/setup/__tests__/pack.test.ts` (create if absent, next to existing setup tests)

**Interfaces:**
- Consumes: `normalizePipelines`, `BindingsMap`, `MergedManifest.dropped` (Task 1).
- Produces:
  - `readManifestPipelines(path): Record<string, string[]>`: unchanged signature, now accepts both forms.
  - `readManifestPipelineBindings(path): Record<string, BindingsMap>`
  - `BindingChange.pipeline?: string` (absent for default-binding changes).

- [ ] **Step 1: Write the failing tests:**
  - `sources.test.ts` `readManifestPipelines reads the object form`: a manifest with `feature: [..]` and `accessibility: {stages:[..], bindings:{..}}` returns both stage lists; `readManifestPipelineBindings` returns only `accessibility`'s map.
  - `changes.test.ts` `pipeline override changes carry their pipeline`: `bindingChanges(before, after)` where only `pipelines.accessibility.bindings["mattstack:stage-evidence"]["evidence-domain"]` changed from `"acme:a"` to `"acme:b"` returns `[{engineRef:"mattstack:stage-evidence", slot:"evidence-domain", from:"acme:a", to:"acme:b", pipeline:"accessibility"}]`; a default-only change has no `pipeline` key.
  - `pack.test.ts` `object-form pipeline resolves`: the setup row reports `8 stages resolved for feature work` for an object-form `feature` pipeline, and flags a stage whose pipeline override is `""` while the default is bound.
  - Materialize: a merge with one `dropped` override calls `warn("skills", ...)` once with a message naming the key and layer (assert via `setWarningLog` + `__test__.reset()`).
- [ ] **Step 2: Run** those four files. Expected: FAIL.
- [ ] **Step 3: Implement**: `readManifestPipelines` and `readManifestPipelineBindings` go through `normalizePipelines`. `lib/setup/pack.ts` replaces `manifest.pipelines?.[workType]` with `normalizePipelines(manifest.pipelines)` and checks each stage against the pipeline override, falling back to the default. `bindingsOf`/`bindingChanges` diff top-level bindings, then each pipeline's bindings, tagging the latter with `pipeline`. Materialize warns once per dropped override: message `` `${key} from ${layer} is ignored: the pipeline no longer lists that stage` ``, shown.
- [ ] **Step 4: Run** the four files. Expected: PASS.
- [ ] **Step 5: Commit** `skills: manifest readers accept per-pipeline bindings`.

### Task 3: Stage copies in compile

**Files:**
- Modify: `lib/skills/types.ts:33-41` (`VerbDef`, `StageEntry`)
- Modify: `lib/skills/sources.ts:537-589` (`readVerbRoster`, `stageRoster`)
- Modify: `lib/skills/layout.ts:29-60` (`buildStageEntries`)
- Modify: `commands/skills.ts:608-760` (`resolve`, `loadFillsFor`, `stageAllowedToolsFor`, `compileVerb` stage dir lookup)
- Test: `lib/skills/__tests__/sources.test.ts`, `lib/skills/__tests__/layout.test.ts`, `lib/skills/__tests__/compile-native.e2e.test.ts` (with fixture under `lib/skills/__tests__/fixtures/compile-native/`)

**Interfaces:**
- Consumes: `readManifestPipelineBindings`, `BindingsMap` (Tasks 1-2).
- Produces:
  - `VerbDef.pipeline?: string`: set by `readVerbRoster` from a stubs entry's `pipeline`, and on stage copies.
  - `StageEntry.engine: string`: the stage engine name. `StageEntry.name` is the compiled target name (the copy's name for a copy).
  - `stageCopyName(stage: string, pipeline: string): string` returns `` `${stage}--${pipeline}` `` (in `sources.ts`).
  - `stageRoster(pipelines: Record<string, string[]>, pipelineBindings: Record<string, BindingsMap>, defaults: BindingsMap): VerbDef[]`: today's deduped stages, then one copy `{ name: stageCopyName(s, p), engine: s, description: "", pipeline: p }` for each (pipeline, stage) whose effective slot map differs from the default's.
  - `effectiveSlotBindings(defaults: BindingsMap, overrides: BindingsMap | undefined, engineRef: string): Record<string, string>` (in `sources.ts`): default slots with the overrides on top.
  - `Resolved` gains `pipelineBindings: Record<string, BindingsMap>`.
  - `buildStageEntries` input gains `copies: Set<string>` (copy names); a pipeline's entry uses the copy's name and dir when its copy exists.

- [ ] **Step 1: Write the failing tests:**
  - `sources.test.ts`: `stageRoster` with `feature` and `accessibility` both listing `mattstack:stage-evidence`, default `{ "mattstack:stage-evidence": { "evidence-domain": "acme:a" } }`:
    - `override equal to default makes no copy`: an override to `"acme:a"` returns only `stage-evidence`.
    - an override to `"acme:b"` adds `{ name: "stage-evidence--accessibility", engine: "stage-evidence", pipeline: "accessibility" }`.
    - `empty override unbinds in the copy only`: an override `""` adds a copy, and `effectiveSlotBindings` gives `{ "evidence-domain": "" }` for it.
  - `readVerbRoster` reads `pipeline` from `{ "work-a11y": { "engine": "work", "pipeline": "accessibility", "description": "d" } }`.
  - `layout.test.ts`: with that copy, `buildStageEntries` gives `accessibility`'s evidence entry `name: "stage-evidence--accessibility"`, `engine: "stage-evidence"`, `dir` ending `/attachments/stage-evidence--accessibility`; `feature`'s keeps `stage-evidence`.
  - `compile-native.e2e.test.ts` `per-pipeline fill compiles a copy`: a fixture pack (`acme`) with both pipelines and a `stage-evidence` override compiles `attachments/stage-evidence/SKILL.md` with fill A's body and `attachments/stage-evidence--accessibility/SKILL.md` with fill B's body; a recompile after removing the override deletes the copy dir.
  - `no overrides is byte-identical`: compiling the existing `compile-native` fixture produces the same files as a snapshot taken from `main` before this task (commit the snapshot as the expected output in the test).
- [ ] **Step 2: Run** those three test files. Expected: FAIL.
- [ ] **Step 3: Implement**: `resolve()` reads `pipelineBindings` and passes it to `stageRoster` and `buildStageEntries`. `loadFillsFor(step, resolved, where, pipeline?: string)` looks up `effectiveSlotBindings(resolved.bindings, pipeline ? resolved.pipelineBindings[pipeline] : undefined, ref)`. `compileVerb` passes `target.verb.pipeline` for a stage copy. `stageAllowedToolsFor` loads `entry.engine` and fills with that entry's pipeline. Stage targets already load `verb.engine`; copies set it to the stage name. `compileTargets`' roster-vs-stage clash check covers copy names. The stale sweep needs no change: copies are ordinary stage targets.
- [ ] **Step 4: Run** the three files plus `commands/__tests__/skills.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `skills: compile a stage copy per pipeline that overrides its fills`.

### Task 4: Work verbs run their own pipeline

**Files:**
- Modify: `lib/skills/types.ts` (`PlaceholderContext.pipeline`)
- Modify: `lib/skills/placeholders.ts:139-153,270-290` (`run-start.flags`, new `pipeline.table` and `run-list.pipelines`)
- Modify: `commands/skills.ts` (`compileVerb` sets `pipeline`; `check` errors; `PIPELINE_SEED` untouched)
- Modify: `plugins/mattstack/attachments/pipeline/work/SKILL.md` (table, prose, resume call)
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (version bump)
- Test: `lib/skills/__tests__/placeholders.test.ts`, `commands/__tests__/skills.test.ts`, `lib/skills/__tests__/compile-native.e2e.test.ts`

**Interfaces:**
- Consumes: `VerbDef.pipeline`, `StageEntry.engine`, stage copies (Task 3).
- Produces:
  - `PlaceholderContext.pipeline: string | null`: set for a roster verb that declares `pipeline` or whose engine body uses `{{pipeline.table}}`; null otherwise.
  - `defaultPipeline(pipelines: Record<string, string[]>): string | null` (in `sources.ts`): the only key when there is one, else `"feature"` when present, else null.
  - `{{pipeline.table}}`: the header `| Stage | Read | Consumes | Produces |`, `|---|---|---|---|`, then one row per `ctx.pipelines[ctx.pipeline]` entry: `` | `<entry.stage>` | `${CLAUDE_SKILL_DIR}/<verbPath(entry.name)>` | <consumes> | <produces> | ``, each list rendered as backticked names separated by single spaces, an empty list as `nothing`.
  - `{{run-start.flags:<arg>}}`: emits `--work-type <arg> --pipeline <ctx.pipeline ?? arg>`; unchanged when `ctx.pipeline` is null.
  - `{{run-list.pipelines}}`: a JSON array of `ctx.pipeline`, plus `"work"` when `ctx.pipeline` is `defaultPipeline(...)`.

- [ ] **Step 1: Write the failing tests:**
  - `placeholders.test.ts`: `pipeline.table` for the eight default stages renders exactly the eight rows in today's `work/SKILL.md` (copy them as the expected string); for `accessibility` with an evidence copy, the evidence row's Read path names `stage-evidence--accessibility`. `run-start.flags:work` with `pipeline: "accessibility"` renders `--work-type work --pipeline accessibility`; with `pipeline: null` it is unchanged from today. `run-list.pipelines` renders `["feature","work"]` for the default and `["accessibility"]` otherwise. `pipeline.table` with `pipeline: null` throws `` `${where}: {{pipeline.table}} used by a verb with no pipeline` ``.
  - `skills.test.ts` check errors, each one a message naming the verb or pipeline:
    - `verb names an undeclared pipeline`: `verb "work-a11y" runs pipeline "accessibility", which the manifest does not declare`.
    - several pipelines, none named `feature`, and a `pipeline.table` verb with no `pipeline`: `verb "work" names no pipeline and the manifest declares several with none named feature`.
    - a pipeline without `mattstack:stage-provision` first, or without `mattstack:stage-ship`: `pipeline "accessibility" must start with stage-provision and include stage-ship`.
    - a badly named pipeline (`Access_ibility`) named by a verb: `pipeline "Access_ibility" must match [a-z][a-z0-9-]*`.
    - a hand-written `--manifest` whose pipeline override names a stage the pipeline does not list: `pipeline "accessibility" binds mattstack:stage-x but does not list it`.
    - a generated manifest with a `// dropped:` header line: check passes and reports a warning (not an error) naming the key and layer, read through `readManifestDropped`.
  - `compile-native.e2e.test.ts` `work-a11y compiles against its pipeline`: the fixture's `work-a11y` output has the accessibility table and `--pipeline accessibility`; plain `work` has `--pipeline feature` and the same eight rows as today.
- [ ] **Step 2: Run** those three files. Expected: FAIL.
- [ ] **Step 3: Implement** the placeholders and context field. `compileVerb` sets `pipeline` per the rule above (`verb.pipeline ?? defaultPipeline(resolved.pipelines)` when the engine body uses `pipeline.table`). The check errors go through `pipelineChainErrors`' neighbors in `check`, as data in the existing errors list.
- [ ] **Step 4: Edit `work/SKILL.md`** (load writing-skills and editing-skills first):
  - replace the eight hand-written rows and their header with `{{pipeline.table}}`;
  - "You run one unit of work through eight stages" becomes "through the stages below";
  - `run_list {repo}` (node and edge labels) becomes `run_list {repo, pipelines: {{run-list.pipelines}}}`;
  - the `pipeline-stages` note drops the literal eight-name example and says it is the Stage column of the table above.
  Bump the plugin version.
- [ ] **Step 5: Run** the three files plus `bun cli.ts skills check --strict` against `plugins/mattstack` under an isolated HOME (`env -i HOME=$(mktemp -d) PATH=$PATH bun cli.ts skills check --strict --pack-dir plugins/mattstack`). Expected: PASS, no drift.
- [ ] **Step 6: Commit** `work: build the stage table and run flags from the verb's pipeline`.

### Task 5: `run_list` filters by pipeline

**Files:**
- Modify: `lib/mcp/run-tools.ts:250-260`
- Modify: `plugins/mattstack/attachments/mcp-tools/reference.md` (regenerated)
- Test: `lib/mcp/__tests__/run-tools.test.ts` (or the existing run-tools test file)

**Interfaces:**
- Produces: `run_list` input `{ repo?: string; pipelines?: string[] }`. With `pipelines`, the returned list keeps only runs whose `pipeline` is in it; a run with no `pipeline` is treated as `"work"`.

- [ ] **Step 1: Write the failing tests**: `legacy work runs match the default verb`: a deps.list fake returning runs with pipeline `feature`, `work`, `accessibility` and one with none; `pipelines: ["feature","work"]` returns the first, second and fourth; `pipelines: ["accessibility"]` returns the third; `pipelines: "x"` returns the error `"pipelines" must be an array`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** the optional array check and the filter on `res.data` before `fromResponse`; update the description to say it narrows by pipeline.
- [ ] **Step 4: Regenerate** the mcp-tools reference with the command in Global Constraints, then run the test and `bun test plugins/mattstack` only if the reference diff test lives there. Expected: PASS.
- [ ] **Step 5: Commit** `run_list: filter by pipeline`.

### Task 6: `rt skills bind --pipeline` and composition fields

**Files:**
- Modify: `commands/skills.ts` (`Flags`, `parseFlags`, `skillsBind`, `applyBind`, `buildBinders`, `CompositionVerb`)
- Test: `commands/__tests__/skills-bind.test.ts`, `commands/__tests__/skills.test.ts`, `commands/__tests__/skills-json-frozen.test.ts`

**Interfaces:**
- Consumes: `pipelineBindingKey`, `readManifestPipelineBindings` (Tasks 1-2).
- Produces:
  - `Flags.pipeline: string | null` (`--pipeline <name>`).
  - `applyBind(opts & { pipeline: string | null })`
  - Composition binder slot: `overrides?: { pipeline: string; boundTo: string; layer: string | null }[]`, present only when at least one exists. A binder appears for a ref bound only by an override, with `boundTo: ""`.
  - `CompositionVerb.pipeline?: string`.

- [ ] **Step 1: Write the failing tests** in `skills-bind.test.ts`:
  - `--pipeline writes the override`: on a fragment whose `accessibility` is a plain list, `rt skills bind stage-evidence evidence-domain acme:b --pipeline accessibility` turns it into `{ "stages": [<same list>], "bindings": { "mattstack:stage-evidence": { "evidence-domain": "acme:b" } } }`; on a fragment with no `accessibility` key it writes `{ "bindings": ... }` only.
  - Refusals, nothing written: an undeclared pipeline gives `pipeline "nope" is not declared in this pack's manifest`; a roster verb or a stage the pipeline does not list gives `stage-x is not a stage of pipeline "accessibility"`.
  - `shadowedBy` reads the provenance key `pipelineBindingKey(...)`.
  - In `skills.test.ts`, the composition JSON for the fixture carries the override on the evidence binder slot and `pipeline: "accessibility"` on the `work-a11y` verb; `skills-json-frozen.test.ts` passes for the no-override fixture with no changes.
- [ ] **Step 2: Run** those three files. Expected: FAIL.
- [ ] **Step 3: Implement**: `--pipeline` parsing; in `applyBind`, edit `["pipelines", p, "bindings", ref, slot]`, first replacing a plain-list value with `{ stages: <list> }` via `modify`. The refusals run before any write. `buildBinders` iterates the union of default and override refs. Update the bind usage line to show `[--pipeline <name>]`.
- [ ] **Step 4: Run** the three files. Expected: PASS.
- [ ] **Step 5: Commit** `skills bind: --pipeline writes a pipeline override`.

### Task 7: Console wiring view and rebind per pipeline

**Files:**
- Modify: `apps/console/src/server/skills.ts:120-135,242,320-325,1167` (types, bind route body `pipeline?: string`)
- Modify: `apps/console/src/app/wiring/outline.ts:222,328-350,521` (`invertBindings`, `slotsFor`, orphan check)
- Modify: `apps/console/src/app/wiring/graph/drawer/rebind.ts:70-110`, `apps/console/src/app/wiring/graph/drawer/usedBy.ts:85`
- Modify: `apps/console/src/app/wiring/graph/model/pendingChanges.ts:61,103-144`
- Test: matching `*.test.ts(x)` beside each, plus `apps/console/src/server/skills.test.ts`; fixtures under `apps/console/src/server/fixtures/design/`

**Interfaces:**
- Consumes: binder slot `overrides`, `BindingChange.pipeline`, bind `--pipeline` (Tasks 2, 6).
- Produces:
  - `BindingSite.pipeline?: string`
  - `effectiveBoundTo(slot: BinderSlot, workType: string | null): string`: the override for `workType` if present, else `boundTo`.
  - `rebindChoices(composition, skill, ref, slot, workType: string | null)`
  - The bind route forwards `pipeline` as `--pipeline`.

- [ ] **Step 1: Write the failing tests**:
  - `outline.test.ts`: `invertBindings` lists an override-only fill with a site carrying `pipeline: "accessibility"`, and the orphan check does not flag it. `slotsFor` in the `accessibility` work type shows fill B; in `feature`, fill A.
  - `rebind.test.ts`: `current` is the override under `accessibility` and the default under `feature`.
  - `pendingChanges.test.ts`: a change with `pipeline` maps to a row labeled `` `${slot} · ${pipeline}` ``.
  - `skills.test.ts` (server): POST `/api/skills/bind` with `pipeline` runs rt with `--pipeline accessibility`.
- [ ] **Step 2: Run** `bun run console:test` scoped to those files (`cd apps/console && bunx vitest run <files>`). Expected: FAIL.
- [ ] **Step 3: Implement**, with the drawer taking the graph's selected work type. Add an `accessibility` override to the design fixtures (`composition.json`) so the fixture server shows it.
- [ ] **Step 4: Run** the files. Expected: PASS.
- [ ] **Step 5: UI check**: start console against the design fixture, open the wiring graph, switch to the accessibility pipeline, open the evidence slot's rebind drawer; screenshot light and dark in Fast Browser and say what looks wrong.
- [ ] **Step 6: Commit** `console: per-pipeline fills in the wiring view and rebind drawer`.

### Task 8: Console runs show and filter by pipeline

**Files:**
- Modify: `apps/console/src/app/runs/runs-page/useRunsUrl.ts` (`pipeline` param)
- Modify: `apps/console/src/app/runs/runs-page/RunsPage.tsx` (filter control, filtering)
- Modify: `apps/console/src/app/runs/runs-page/EarlierList.tsx`, `apps/console/src/app/runs/StatusCard.tsx` (row label)
- Modify: `apps/console/src/server/stageDoc.ts:20-24,44-46,106-135`, `apps/console/src/server/effectiveInputs.ts:290-320`
- Test: beside each file; `apps/console/src/server/stageDoc.test.ts`

**Interfaces:**
- Produces:
  - `RunsUrl.pipeline: string | null` (`?pipeline=`).
  - `StageDocInput.pipeline: string | null`: `resolveStageDoc` tries `stage-<stage>--<pipeline>` before `stage-<stage>` in both the sha and version paths.

- [ ] **Step 1: Write the failing tests**:
  - `useRunsUrl.test.ts`: round-trips `?pipeline=accessibility`; absent gives `null`.
  - `RunsPage.test.tsx`: with runs from `feature` and `accessibility`, choosing `accessibility` lists only that run; the control is hidden when every run shares one pipeline.
  - `EarlierList.test.tsx`: a row shows its pipeline name.
  - `stageDoc.test.ts`: with both `attachments/stage-evidence/SKILL.md` and `attachments/stage-evidence--accessibility/SKILL.md` in the tree, `pipeline: "accessibility"` returns the copy's text and `pipeline: "feature"` returns the default's.
- [ ] **Step 2: Run** the files. Expected: FAIL.
- [ ] **Step 3: Implement**; `effectiveInputs.ts` passes `res.data.pipeline` into `resolveStageDoc`. Add an accessibility run to `runsFixture.ts`.
- [ ] **Step 4: Run** the files. Expected: PASS.
- [ ] **Step 5: UI check**: the runs list with and without the pipeline filter, and an accessibility run's stage doc; screenshot light and dark in Fast Browser and say what looks wrong.
- [ ] **Step 6: Commit** `console: runs show and filter by pipeline`.

### Task 9: Pack authoring and docs

**Files:**
- Modify: `lib/skills/init.ts:249-300` (seeded comments)
- Modify: `plugins/mattstack/plugin/skills/creating-a-pack/SKILL.md`, `plugins/mattstack/plugin/skills/extending-a-pack/SKILL.md`, `plugins/mattstack/plugin/skills/editing-skills/SKILL.md`
- Modify: `plugins/mattstack/docs/your-first-pack.md`, `plugins/mattstack/plugin/examples/skills.jsonc`
- Modify: `website/docs/rt/reference/skills/{bind,compile,composition,anatomy,check}.mdx` and any page under `website/docs` that describes `pipelines` (find with `git grep -l pipelines website/docs`)
- Test: `lib/skills/__tests__/init.test.ts`

- [ ] **Step 1: Write the failing test** `init.test.ts` `seeded fragment explains pipelines`: `renderPackFiles({pack:"acme", workDescription:"d"})["pack/skills.jsonc"]` contains `add a specialized pipeline with mattstack:extending-a-pack`, and its `stubs.jsonc` comment mentions `"pipeline"` for a `work-<kind>` verb. The parsed JSON is unchanged from today.
- [ ] **Step 2: Run** it. Expected: FAIL. **Step 3:** update the comments. **Step 4:** run it. Expected: PASS.
- [ ] **Step 5: Skills** (load superpowers:writing-skills and mattstack:editing-skills; follow writing-skills' RED/GREEN for each):
  - `extending-a-pack` gains a recipe "Add a specialized pipeline": declare it in `pipelines`, add a `work-<kind>` verb with `"pipeline"`, bind with `rt skills bind --pipeline`, then compile and check;
  - `creating-a-pack` says the seed has one `feature` pipeline and points to that recipe;
  - `editing-skills` notes that stage copies `<stage>--<pipeline>` are compiled output.
- [ ] **Step 6: Docs**: the example manifest shows an `accessibility` pipeline in the object form; `your-first-pack.md` and the five reference pages document the object form, `--pipeline`, stage copies and `work-<kind>` verbs. Docs use `acme`.
- [ ] **Step 7: Run** `env -i HOME=$(mktemp -d) PATH=$PATH bun cli.ts skills check --strict --pack-dir plugins/mattstack` and the website build if the repo has a docs check (`bun run check` covers it). Expected: PASS.
- [ ] **Step 8: Commit** `docs: per-pipeline bindings and work-<kind> verbs`.
