# Per-pipeline Bindings Leftovers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the sixteen RT-491/RT-493 leftovers the spec lists, each with a test.

**Architecture:** Small, independent corrections, grouped into tasks by package and file: rt naming and warnings, rt compile and composition, console model and server, console UI, docs. Each task's items are the spec's numbered items, which hold the exact wording and the rules.

**Tech Stack:** Bun + TypeScript (rt, `bun test` from the repo root), React + Mantine + vitest (console), MDX docs.

**Spec:** `docs/superpowers/specs/2026-10-16-per-pipeline-leftovers-design.md` (item numbers below refer to it; its "My calls" section settles each item's edge cases).

## Global Constraints

- Every rt `--json` change is additive. `commands/__tests__/skills-json-frozen.test.ts` passes unedited.
- Plain-list pipelines are never name-checked ("no migration").
- Exact strings, verbatim from the spec:
  - `pipeline "<name>" must not contain "--"`
  - `${key} from ${layer} is ignored: the pipeline does not list that stage`
  - `This override comes from the override layer; remove it there.`
- Output through `lib/ui/out.ts`; lib warnings through `warn()`; no `console.*` in lib code.
- Fixtures use `acme`; no ticket ids in shipped files.
- Console UI changes are rendered in Fast Browser and screenshotted in light and dark before the task is done.
- Every edit under `plugins/mattstack` bumps `plugins/mattstack/.claude-plugin/plugin.json` once on the branch, past main's version at the time (Task 1 owns the schema edit and the bump).
- Run `bun test` from the repo root, targeted files only.

## Review Focus

1. **A plain-list pipeline named `a--b`** keeps parsing and compiling, because only override-carrying or work-verb pipelines are checked. Task 1 test `plain-list pipeline with -- still parses`.
2. **A real stage named like a copy** is refused by compile's collision guard. Task 2 test `a stage named like a copy collides`.
3. **`compile --dry-run --json` with a stale copy** omits `removedCopies`. Task 2 test `dry run leaves removedCopies out`.
4. **A default change on the default pipeline's canvas** stays marked unsynced. Task 3 test `default change stays unsynced on the default canvas`.
5. **The runs timeline with `?pipeline=` set** shows the filter control and lets you clear it. Task 4 test `timeline shows and clears the pipeline filter`.

---

### Task 1: rt names, warnings and schema (items 1, 3, 4)

**Files:**
- Modify: `lib/skills/manifest-merge.ts`, `lib/skills/sources.ts` (`stageRoster`), `commands/skills.ts` (`pipelineErrors`, bind's `--pipeline` check), `lib/skills/materialize.ts` (the dropped-override warning)
- Modify: `plugins/mattstack/plugin/schemas/skills-manifest.schema.json`, `plugins/mattstack/.claude-plugin/plugin.json`
- Test: `lib/skills/__tests__/manifest-merge.test.ts`, `lib/skills/__tests__/sources.test.ts`, `commands/__tests__/skills.test.ts`, `commands/__tests__/skills-bind.test.ts`, `lib/skills/__tests__/materialize.test.ts`

**Interfaces:**
- Produces: `MergedManifest.dropped` entries gain `reason: "removed" | "unlisted"` (additive; `readManifestDropped` and the `// dropped:` header format are unchanged, per "My calls").

- [ ] **Step 1: Write the failing tests:**
  - `-- in an override-carrying pipeline is refused`: `FragmentError` `fragment pipeline "a--b" must not contain "--": <path>` (materialize), and the same message from `stageRoster`, check/compile pipeline errors (for a work verb naming `a--b`), and `rt skills bind ... --pipeline a--b`.
  - `plain-list pipeline with -- still parses`.
  - `unlisted ref warns does not list`: a bindings-only higher layer naming a ref that no layer's list for that pipeline ever had. `warn` gets the spec's "does not list that stage" text.
  - The existing "no longer lists that stage" test still passes for a stage a higher layer removed.
  - `schema accepts empty pipeline binding`: validate `{ "pipelines": { "a": { "stages": ["mattstack:stage-plan"], "bindings": { "mattstack:stage-plan": { "x": "" } } } } }` against the schema with the repo's schema test helper (or the one the schema tests use). The same `""` at top level still fails.
- [ ] **Step 2: Run** those test files. Expected: FAIL.
- [ ] **Step 3: Implement.** One shared helper decides the name rule, `pipelineNameError(name: string): string | null` in `lib/skills/pipelines.ts`, covering both the regex and `--`, so every site uses the same check. Bump plugin.json one patch past `git show origin/main:plugins/mattstack/.claude-plugin/plugin.json`.
- [ ] **Step 4: Run** the files plus `commands/__tests__/skills-json-frozen.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `skills: refuse -- in pipeline names, tell unlisted refs apart, allow "" in pipeline bindings`.

### Task 2: rt compile and composition (items 2, 12; Review Focus 2)

**Files:**
- Modify: `commands/skills.ts` (`performCompile` / the compile `--json` envelope; the binder verb choice around `verbByEngineRef` ~2020)
- Test: `lib/skills/__tests__/compile-native.e2e.test.ts` (`compile-pipelines`), `commands/__tests__/skills.test.ts`

**Interfaces:**
- Produces: compile `--json` gains `removedCopies?: string[]`, present only after a write that removed copies. The composition binder's `verb` for a shared engine is the default pipeline's verb.

- [ ] **Step 1: Write the failing tests:**
  - `compile --json lists removed copies`: after deleting the override, `compile --json` carries `removedCopies: ["stage-evidence--accessibility"]`.
  - `dry run leaves removedCopies out`.
  - `a stage named like a copy collides`: a pack whose roster names a stage `stage-evidence--accessibility` while the `accessibility` override exists. Compile refuses with the existing collision error.
  - `binder names the default pipeline's verb`: in `compile-pipelines`, the `mattstack:work` binder's `verb` is `work`.
- [ ] **Step 2: Run** them. Expected: FAIL (the collision test may already pass; if so, keep it as a pin and say so in the report).
- [ ] **Step 3: Implement** per the spec's "My calls" for items 2 and 12.
- [ ] **Step 4: Run** the files plus `skills-json-frozen.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `skills: compile reports removed copies; binder names the default verb`.

### Task 3: console model and server (items 7, 8, 10, 11, 13; Review Focus 4)

**Files:**
- Modify: `apps/console/src/app/wiring/graph/model/focusModel.ts` and the link-card / Used-by open path (item 7), `graph/model/templateModel.ts` (`shownPipeline`, item 8), `graph/drawer/rebind.ts` and `RebindPanel.tsx` (items 10, 13), `apps/console/src/server/stageDoc.ts` (`ownPick` ~106, item 11)
- Test: the existing tests beside each file

- [ ] **Step 1: Write the failing tests:**
  - **Item 7:** on the `accessibility` canvas, opening `stage-plan` from a link card or a Used-by site focuses `stage-plan@accessibility`. On `feature`, it focuses the plain key.
  - **Item 8:** `default change stays unsynced on the default canvas`. A `pipeline: "accessibility"` change is unsynced on the accessibility canvas for an engine shown without a copy. A default change on the accessibility canvas, for a slot accessibility overrides, is not marked.
  - **Item 10:** the rebind note for a default stage bind says it rebuilds every skill in the pack.
  - **Item 11:** a run whose pack has no entry in `packDirs` never reads another pack's copy, and gets its own default or nothing.
  - **Item 13:** an override from layer `override` shows `This override comes from the override layer; remove it there.`.
- [ ] **Step 2: Run** them (`cd apps/console && bunx vitest run <files>`). Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them, then `bun run console:typecheck` and `bun run console:lint` from the root. Expected: PASS.
- [ ] **Step 5: Commit** `console: pipeline-aware links, unsynced marking, stage docs and rebind copy`.

### Task 4: console UI (items 5, 6, 9, 14; Review Focus 5)

**Files:**
- Modify: `apps/console/src/app/wiring/HealthTab.tsx` (item 5), `apps/console/src/app/runs/runs-page/RunsPage.tsx` and the timeline view (item 6), the link-card and rendered-card title code in `graph/` (item 9), `apps/console/src/server/fixtures/design/scenarios.ts` plus its composition data (item 14), and console's server types if `check`'s payload type lacks `staleCopies` / `droppedOverrides`
- Test: `apps/console/src/app/wiring/__tests__/HealthTab.test.tsx`, `apps/console/src/app/runs/runs-page/RunsPage.test.tsx`, the timeline test, the card tests, and the fixture scenario test

- [ ] **Step 1: Write the failing tests:**
  - **Item 5:** with `staleCopies: ["stage-evidence--accessibility"]`, the Health tab lists `stale stage copy stage-evidence--accessibility: run rt skills compile` and does not read in sync. A dropped override lists its key and layer.
  - **Item 6:** with `?pipeline=accessibility`, the title reads `web · accessibility pipeline runs on this Mac`. `timeline shows and clears the pipeline filter`.
  - **Item 9:** the copy's link card and rendered card read `evidence · accessibility`, and the full file name stays reachable (title attribute or drawer header).
  - **Item 14:** scenario `pipeline-base-override` answers a composition whose `accessibility` evidence override has layer `base:acme-base`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them plus `console:typecheck` and `console:lint`. Expected: PASS.
- [ ] **Step 5: UI check.** Run the design fixture from this worktree (`CONSOLE_FIXTURE=design`, plus `CONSOLE_FIXTURE_SCENARIO` per view: `runs` for item 6, `pipeline-base-override` for item 14), on a free `PORT` and never 11001. Drive Fast Browser directly, on localhost only.
  - Screenshot light and dark of: the Health tab with a stale copy (a scenario or the fixture's check data), the runs list and timeline filtered to accessibility, the copy cards, and the base-override drawer.
  - Use panel crops, not full pages, because the top bar shows a real org name.
  - Say what looks wrong, then stop the servers.
- [ ] **Step 6: Commit** `console: health shows stale copies, runs title follows the filter, copy labels, base-override scenario`.

### Task 5: docs (items 15, 16)

**Files:**
- Modify: `website/docs/rt/reference/_partials/skills/check.mdx` (item 15), `docs/superpowers/specs/2026-10-16-per-pipeline-bindings-design.md` lines 156-157 (item 16), and the bind or check partial for the new `--` refusal and `removedCopies`

- [ ] **Step 1:** Make the edits with the spec's exact strings. State current mechanics only.
- [ ] **Step 2:** Run `bun run docs:check`, `bun run docs:build` and `bun run check`. Expected: PASS.
- [ ] **Step 3: Commit** `docs: per-pipeline leftovers`.
