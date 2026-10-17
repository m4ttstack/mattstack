# Remove a Pipeline Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt skills bind --pipeline <p> --unset` removes a pipeline override as if it was never written, and console's rebind drawer can pick the pipeline a change goes to and clear an override.

**Architecture:**
- A pure fragment edit removes the override, prunes empty maps and collapses `{ stages }` back to a plain list. `applyBind` runs it in place of the set edit when unsetting; the refusals in `skillsBind` run first.
- Console's drawer model gains a pipeline-choice function and a chosen-pipeline argument. The server bind route forwards `unset`. The pending banner renders a removed override as falling back to the default fill.

**Tech Stack:** Bun + TypeScript (rt, `bun test` from the repo root), jsonc-parser, React + Mantine + vitest (console).

**Spec:** `docs/superpowers/specs/2026-10-16-unset-pipeline-override-design.md`

## Global Constraints

- `--unset` needs `--pipeline`, takes no fill, and removes only an override this pack's fragment sets. Refusal wording is the spec's, verbatim:
  - `--unset removes a pipeline override; name the pipeline with --pipeline`
  - `--unset takes no fill`
  - `<pipeline> has no override for <verb>.<slot>`
  - `<pipeline>'s override for <verb>.<slot> comes from <layer>; remove it there`
- Refusals run before any write. Comments elsewhere in the fragment survive the edit.
- When the last override goes, the pipeline is a plain list again, and the generated manifest is byte-identical to the pack that never had the override.
- Bind `--json` stays additive: today's keys plus `"unset": true`; `to` is the fill the slot reads after the unset (the default's, or `"(unbound)"`). `commands/__tests__/skills-json-frozen.test.ts` passes unedited.
- rt's `changes` payload is unchanged: a removed override is `{ pipeline, from, to: null }`.
- The drawer's preselection is Matt's ruling: a specialized pipeline's view preselects that pipeline on a stage it lists. The default pipeline's view and stage copies behave as the spec's "My calls" say.
- Output through `lib/ui/out.ts`; no `console.*` in lib code. Fixtures use `acme`.
- Every edit under `plugins/mattstack` bumps `plugins/mattstack/.claude-plugin/plugin.json` once on the branch (Task 5). Skill edits load `superpowers:writing-skills` and `mattstack:editing-skills` first.
- Console UI changes are rendered in Fast Browser and screenshotted in light and dark before the task is done.
- Run `bun test` from the repo root, targeted files only.

## Review Focus

1. **Collapse loses comments only inside that pipeline's value.** A pipeline whose stage list carries comments loses them when it collapses, while comments elsewhere survive. Task 1 test `collapse keeps comments outside the pipeline`.
2. **Fixture mode (manifest-only) removes the provenance header line too.** Task 2 test `unset in fixture mode drops the provenance line`.
3. **An override on the default pipeline itself** (a one-pipeline pack with an `--pipeline feature` override) unsets, and its copy is swept. Task 2 test `unset an override on the only pipeline`.
4. **A lower layer still overrides after the unset.** `to` reports that layer's fill, with a note that it still applies. Task 2 test `a lower layer's override still applies after unset`, with an injected materialize writing that manifest.
5. **"Use default" on a stage copy** sends the copy's engine as the verb and the copy's pipeline. Task 3 test `use default on a copy targets its engine and pipeline`.

---

### Task 1: The pure fragment edit

**Files:**
- Create: `lib/skills/pipeline-edit.ts`
- Test: `lib/skills/__tests__/pipeline-edit.test.ts` (create)

**Interfaces:**
- Produces:
  - `removePipelineOverride(text: string, pipeline: string, engineRef: string, slot: string): string` removes `pipelines.<pipeline>.bindings.<engineRef>.<slot>`. It then drops `bindings.<engineRef>` if that is now empty, then `bindings` if empty. If the pipeline is then an object holding only `stages`, it rewrites it as that plain array. It returns `text` unchanged when the path does not exist.
  - `dropProvenanceLine(text: string, key: string): string` removes the manifest header line `//   <key> <- <layer>` (the provenance format `readManifestProvenance` reads) for exactly that key, and nothing else.

- [ ] **Step 1: Write the failing tests:**
  - `removes one slot and keeps the rest`: two slots under one ref; removing one leaves the other.
  - `prunes empty maps and collapses to a plain list`: input `{"pipelines":{"accessibility":{"stages":["mattstack:stage-plan"],"bindings":{"mattstack:stage-plan":{"x":"acme:y"}}}}}`. Output parses to `{"pipelines":{"accessibility":["mattstack:stage-plan"]}}`.
  - `collapse keeps comments outside the pipeline`: a `// top` comment and a comment beside `feature` survive.
  - `missing path is a no-op`: returns the same string.
  - `dropProvenanceLine removes only its key`: a header holding `accessibility/mattstack:stage-evidence domain` and `accessibility/mattstack:stage-plan x` loses only the first.
- [ ] **Step 2: Run** `bun test lib/skills/__tests__/pipeline-edit.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** with jsonc-parser `modify(..., undefined, ...)` for removals, `findNodeAtLocation` to check what is left, and one `modify` to replace the pipeline node with its `stages` array for the collapse.
- [ ] **Step 4: Run** the same file. Expected: PASS.
- [ ] **Step 5: Commit** `skills: a fragment edit that removes a pipeline override`.

### Task 2: `rt skills bind --unset`

**Files:**
- Modify: `commands/skills.ts`: `BindFlags`, `parseBindFlags`, `separateBindArgs`, `skillsBind`, `applyBind`, `bindBlocks`, and the usage line
- Modify: `lib/command-tree-def.ts` (the bind node's flags gain `--unset`)
- Test: `commands/__tests__/skills-bind.test.ts`, `lib/skills/__tests__/compile-native.e2e.test.ts` (`compile-pipelines`)

**Interfaces:**
- Consumes: `removePipelineOverride`, `dropProvenanceLine` (Task 1); `pipelineBindingKey`, `effectiveSlotBindings`, `readManifestPipelineBindings`, `readManifestProvenance` (existing).
- Produces:
  - `BindFlags.unset: boolean`, set by the boolean `--unset` flag.
  - `applyBind(opts & { unset: boolean })`. With `unset`, `fill` is ignored, and the fragment edit and the manifest-only edit use Task 1's functions.
  - The bind `--json` envelope gains `"unset": true` only on an unset.

- [ ] **Step 1: Write the failing tests** in `skills-bind.test.ts`, using the existing `refused()` helper for refusals:
  - The four refusals, with the Global Constraints' exact strings and nothing written. The `<layer>` case uses a manifest whose provenance names `base:acme-base` for the key.
  - `--unset removes the override and its copy`: bind `stage-evidence domain acme:b --pipeline accessibility`, then `--unset`. The fragment's `accessibility` is a plain list again. `stage-evidence--accessibility/` is gone, and `rt skills check` reports no drift.
  - `unset in fixture mode drops the provenance line`: in `--mattstack-dir` mode, the manifest has no `accessibility/mattstack:stage-evidence domain` line afterwards.
  - `unset an override on the only pipeline`: a one-pipeline pack with an override bound under `--pipeline feature`. Unsetting it removes the copy, and the pack compiles.
  - `a lower layer's override still applies after unset`: call `applyBind` directly with an injected `materialize` that writes a manifest still carrying a base override. `skillsBind`'s `to` is the base's fill, and the human output carries a note that `base:acme-base`'s override still applies.
  - `unset json`: the envelope has `unset: true`, `to` equal to the default fill, and `pipeline`.
  - `unset dry run`: prints the line and writes nothing.
  - `byte-identical after unset`: render the manifest from the post-unset fragment and from a fragment that never had the override, both through the same merge-and-render path materialize uses (`mergeLayers` + `renderManifest`). The two are byte-identical.
- [ ] **Step 2: Run** `bun test commands/__tests__/skills-bind.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - Refusal order: the flag-shape refusals first, then the existing pipeline, verb and slot checks. After those comes the no-override refusal (read the merged `resolved.pipelineBindings`), then the other-layer refusal (provenance for `pipelineBindingKey`, where any layer other than this pack's is refused).
  - `to` is read from the manifest after materialize, using the effective fill for that pipeline. When a pipeline override still lands there, note which layer it comes from.
  - The recompile scope is the same as a set bind's.
  - The human line uses `bindBlocks` with `to` set to the new effective fill, plus a note that the override was removed.
- [ ] **Step 4: Run** `bun test commands/__tests__/skills-bind.test.ts commands/__tests__/skills-json-frozen.test.ts lib/skills/__tests__/compile-native.e2e.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `skills bind: --unset removes a pipeline override`.

### Task 3: Console model and server

**Files:**
- Modify: `apps/console/src/app/wiring/graph/drawer/rebind.ts`
- Modify: `apps/console/src/app/wiring/graph/model/pendingChanges.ts` (the `to: null` rendering)
- Modify: `apps/console/src/server/skills.ts` (`bindBody` near 631; the bind route at 1199)
- Test: `apps/console/src/app/wiring/graph/__tests__/rebindChoices.test.ts`, `pendingChanges.test.ts`, `apps/console/src/server/skills.test.ts`

**Interfaces:**
- Consumes: Task 2's `--unset`.
- Produces:
  - `type PipelineChoice = { pipeline: string | null; label: string }`. A `null` pipeline is "Default"; any other label is the pipeline name.
  - `pipelineChoices(composition, skill, ref, slot, workType): { choices: PipelineChoice[]; preselected: string | null }`. `choices` is empty when no choice is shown: a roster verb's own slot, a stage copy, or a stage that no non-default pipeline lists.
  - `rebindChoices(composition, skill, ref, slot, workType, chosen?: string | null)`. When `chosen` is given (including `null`), it is both the pipeline read and the pipeline written. When omitted, behavior is today's.
  - `RebindChoices` gains `overridden: boolean` (the written pipeline overrides this slot) and `fallback: string | null` (the top-level default fill for this slot).
  - Server `bindBody` gains `unset?: boolean`. With `unset`, `pipeline` is required and `fill` must be absent. The route then runs `rt skills bind <verb> <slot> --pipeline <p> --unset --pack <pack>`.

- [ ] **Step 1: Write the failing tests:**
  - `pipelineChoices`:
    - Under `accessibility` on `stage-evidence`'s `domain`, choices are `[Default, accessibility]` and `preselected` is `"accessibility"`.
    - Under `feature` with no feature override: preselected `null`, and `feature` is not offered.
    - Under `feature` when `feature` overrides the slot: `feature` is offered and preselected.
    - `work-a11y`'s `tiering` gives no choices.
    - A copy target gives no choices.
  - `rebindChoices` with `chosen: null` from the `accessibility` view: `pipeline` is null and `current` is the default fill. With `chosen: "accessibility"`: `overridden` is true and `fallback` is the default fill.
  - `use default on a copy targets its engine and pipeline`: `rebindChoices` on `stage-evidence--accessibility` gives `verb: "stage-evidence"`, `pipeline: "accessibility"` and `overridden: true`.
  - `pendingChangesOf`: a change `{pipeline:"accessibility", from:"acme:evidence-b", to:null}` reads `domain · accessibility: evidence-b → evidence-a (default)`, with the default resolved from the composition's binder slot `boundTo`. With no default bound, it reads `→ default (unbound)`.
  - Server:
    - POST with `unset: true, pipeline: "accessibility"` and no fill runs rt with `['skills','bind','stage-evidence','domain','--pipeline','accessibility','--unset','--pack','acme']`.
    - `unset` without `pipeline` → 400, and nothing is spawned.
    - `unset` with `fill` → 400.
- [ ] **Step 2: Run** `cd apps/console && bunx vitest run src/app/wiring/graph/__tests__/rebindChoices.test.ts src/app/wiring/graph/__tests__/pendingChanges.test.ts src/server/skills.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep `fill`'s check for the non-unset path only.
- [ ] **Step 4: Run** the same files, then `bun run console:typecheck` and `bun run console:lint` from the root. Expected: PASS.
- [ ] **Step 5: Commit** `console: pipeline choices, use-default and unset in the bind route`.

### Task 4: Console drawer UI

**Files:**
- Modify: `apps/console/src/app/wiring/graph/drawer/RebindPanel.tsx` (and its caller in `SkillDrawer.tsx` if the choice state lives there)
- Modify: `apps/console/src/server/fixtures/design/composition.json` (only if the drawer's states are not already drawable)
- Test: `apps/console/src/app/wiring/graph/drawer/__tests__/RebindPanel.test.tsx` (or the existing RebindPanel test file)

**Interfaces:**
- Consumes: `pipelineChoices`, `rebindChoices(..., chosen)`, `overridden`, `fallback` (Task 3); the bind route's `unset`.

- [ ] **Step 1: Write the failing tests:**
  - From the accessibility view, `stage-evidence`'s `domain` shows the pipeline control with `accessibility` selected. The command preview carries `--pipeline accessibility`.
  - Choosing Default updates the current fill and drops `--pipeline` from the preview.
  - With an override present, a "Use default" button shows. Confirming it posts `{unset:true, pipeline:"accessibility"}`. The confirm message names the override's fill and says the slot falls back to the default fill "if no other layer overrides it".
  - `work-a11y`'s `tiering` shows no pipeline control.
- [ ] **Step 2: Run** the RebindPanel test file. Expected: FAIL.
- [ ] **Step 3: Implement.** Use the control the drawer's existing styles suggest, following `docs/apps/ui-authoring.md`. The confirm goes through `modals.confirm` and the result through `notifications`, like the drawer's existing writes.
- [ ] **Step 4: Run** the test file plus the Task 3 files, `console:typecheck` and `console:lint`. Expected: PASS.
- [ ] **Step 5: UI check.** Run console on the design fixture from this worktree: `CONSOLE_FIXTURE=design`, `bun run dev:server` and `bun run dev` in `apps/console`, on a free `PORT` and never 11001. Drive the Fast Browser MCP tools directly, on localhost only.
  - Open the wiring graph's `accessibility` pipeline, then the evidence `domain` rebind drawer.
  - Screenshot it in light and dark: preselected, switched to Default, and with the "Use default" confirm open.
  - Say plainly what looks wrong, then stop the servers.
- [ ] **Step 6: Commit** `console: rebind drawer picks the pipeline and clears an override`.

### Task 5: Docs and skills

**Files:**
- Modify: `website/docs/rt/reference/_partials/skills/bind.mdx` (`--unset`, its refusals, the plain-list collapse)
- Modify: `plugins/mattstack/plugin/skills/extending-a-pack/SKILL.md` (one line in "Add a specialized pipeline" on removing an override)
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (patch bump past main's version at the time)
- Modify: `plugins/mattstack/pack/requires.json` only if CI's engine-floor check asks (the bind change is CLI-only, so expect `engine-floor: unchanged` in the PR body instead)

- [ ] **Step 1:** Load `superpowers:writing-skills` and `mattstack:editing-skills`, then edit the skill. State the RED (what the current text gets wrong when you ask "undo my accessibility evidence override") and the GREEN in the commit body.
- [ ] **Step 2:** Edit the bind partial, then run `bun run docs:check` and `bun run docs:build`.
- [ ] **Step 3:** Run `python3 plugins/mattstack/plugin/skills/process-digraphs/check-dot.py plugins/mattstack/plugin/skills/extending-a-pack/SKILL.md`, `sh plugins/mattstack/tests/certify.sh plugins/mattstack/plugin/skills/extending-a-pack` and `bun run check`. Expected: PASS.
- [ ] **Step 4: Commit** `docs: rt skills bind --unset`.
