# Quiet Pack Version Stamps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pack version bump touches `plugin.json` and one lock file instead of every compiled file, with run tracking, the console and session pinning unchanged.

**Architecture:** Compile stops writing versions into compiled bodies and records them per target in `pack/compiled.lock.json`. Resolve ids lose their version and pin by the loaded skill's folder. Run start works out provenance from `skillDir` instead of baked flags. Sync makes one commit, and the console folds old version-only commits, classified by rt.

**Tech Stack:** Bun + TypeScript (rt), `bun test`; console is Hono + React (vitest).

**Spec:** `docs/superpowers/specs/2026-11-12-quiet-pack-version-stamps-design.md`

## Global Constraints

- `pack_commits` keeps its `name=value,...` shape; the run DB schema does not change.
- Old compiled output (versioned ids, `version=` seams, baked `--mattstack-sha`/`--mattstack-dirty`/`--pack-sha`) keeps resolving and recording provenance everywhere it does today.
- After the upgrade, every pack reads stale once (its opening lines changed) until its next sync recompiles it. That one recompile is the migration commit, accepted.
- A team pack's `minEngine` rises through `floorWrite`'s `raises`. The mattstack plugin's own `pack/requires.json` is hand-maintained (`floorWrite` skips it), so Task 9 raises it by hand, and team packs inherit it as `engineFloor`.
- `VERSIONLESS_IDS_MIN_ENGINE` equals the mattstack `plugin.json` version this branch ships. When `plugin.json` is re-bumped one past `main` at merge, both move together, along with the plugin's `requires.json`.
- Run every test from the repo root (`bun test <file>`); only targeted tests locally, CI runs the rest.
- An edit that changes the include seam, expand's `compiled:` stamp or `openingLine` ends with `bun run skills:expand:board` and a committed `apps/board/skills`, or `lib/__tests__/no-board-skills-drift.test.ts` fails.
- Everything rt prints goes through `lib/ui/out.ts`; a new `--json` envelope is frozen once shipped.
- No real team, org or pack names in fixtures, tests or docs: use `acme`, `acme-base`.
- A UI change is rendered in Fast Browser (the `fast-browser:browser-driver` agent, Haiku at medium) in light and dark before its task is done, with what looks wrong said plainly.
- Commit after each task: `<area>: <imperative>`, ending with the Co-Authored-By line.

## Review Focus

1. **A pack compiled half old, half new** (a `--verb` compile on a pack whose other targets still carry `version=` seams): anatomy shows built versions for both, and nothing crashes. Test in Task 2.
2. **A run started on 0.4.11 that resolves after 0.4.12 installs**: with `dir` under 0.4.11, resolve returns 0.4.11's paths while both are installed, and a map held from another version folder is not reused. Test in Task 4.
3. **An org clone on a trial branch**: run start still finds the bump commit on the data branch. Test in Task 5.
4. **A pack installed on a Mac with no org clone for it**: run start records `<pack>=<version>`, and the console's run detail shows a version row without a sha. Test in Task 5.
5. **A commit that mixes a real edit with stamp churn, or edits only an org base file**: the classifier does not fold it. Test in Task 7.

---

### Task 1: The lock file module

**Files:**
- Create: `lib/skills/compiled-lock.ts`
- Test: `lib/skills/__tests__/compiled-lock.test.ts`

**Interfaces:**
- Produces:
  - `export const LOCK_REL = "pack/compiled.lock.json"`
  - `export type CompiledLock = { targets: Record<string, Record<string, string>>; bases: Record<string, string>; mattstackSha: Record<string, string>; mattstackDirty: Record<string, 0 | 1> }`. Target keys are pack-relative dirs (`skills/work`, `attachments/stage-ship`). Every version is plain (`"0.32.56"`, or `"org"` for an org base source). A checkout sha lives only in `mattstackSha[target]`.
  - `export function readLock(packDir: string, readFile: (p: string) => string | null = readIfPresent): CompiledLock` (a missing or unparseable file reads as all four maps empty)
  - `export function mergeLock(current: CompiledLock, compiled: { targets: CompiledLock["targets"]; bases: CompiledLock["bases"]; mattstackSha: CompiledLock["mattstackSha"]; mattstackDirty: CompiledLock["mattstackDirty"] }): CompiledLock`. It replaces the `targets`, `mattstackSha` and `mattstackDirty` entries for each target named in `compiled.targets` (a compiled target with no sha drops its old one), and merges `bases` per key.
  - `export function serializeLock(lock: CompiledLock): string` (keys sorted at every level, 2-space JSON, trailing newline)
  - `export function lockWrite(packDir: string, next: CompiledLock, readFile: (p: string) => string | null, write: boolean): { written: string[]; removed: string[]; stale: boolean }` (the same contract as `floorWrite` in `commands/skills.ts`)

- [ ] **Step 1: Write the failing tests.**
  - `"mergeLock keeps targets a partial compile did not touch"`: current targets `skills/work` and `skills/review` at `0.32.55`/`0.4.11`; merge only `skills/work` at `0.32.56`/`0.4.12`; `skills/review` is unchanged.
  - `"mergeLock merges bases per key and keeps them when none were emitted"`: current `{acme-base: "0.2.3"}` merged with `{}` stays the same; merged with `{acme-base: "0.2.4"}` becomes `0.2.4`.
  - `"mergeLock drops a recompiled target's old sha"`.
  - `"serializeLock is stable across key order"`: two key orders give identical text ending in `\n`.
  - `"readLock treats a missing or damaged file as empty"`.
  - `"lockWrite reports stale without writing when write is false"`: a temp dir; assert `stale: true` and no file.
- [ ] **Step 2: Run `bun test lib/skills/__tests__/compiled-lock.test.ts`.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement `lib/skills/compiled-lock.ts` per the Interfaces block.**
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit** `skills: add the compiled lock file module`.

### Task 2: Versionless seams and header, built versions from the lock

**Files:**
- Modify the five seam writers: `lib/skills/placeholders.ts:140` (prop), `:148` (include), `lib/skills/team-params.ts:173` (section), `lib/skills/blocks/render.ts:140` (prop by reference) and `:358` (block)
- Modify the two `compiled:` writers: `lib/skills/compile.ts:246` and `lib/skills/expand.ts:50,232`
- Modify `lib/skills/drift.ts:47-48`: `EXTENT_RE` with an optional `version=`, plus `pluginOfSeam`
- Modify `lib/skills/provenance.ts:5-15`: `maskProvenance` deletes ` version=<v>` from seams instead of starring it, so old and new seams compare equal
- Modify `commands/skills.ts`:
  - the compile write path calls `lockWrite` beside `floorWrite` and adds its `written` to `CompileWrites`
  - the anatomy sources at `2715-2780`, with `ROOT_VERSION_RE` at `2675` accepting a missing version
- Modify `apps/console/src/server/waiting.ts:87-100` (`compiledOutputs` adds `pack/compiled.lock.json`), `apps/console/src/app/wiring/parseSeam.ts` (accept a seam without `version=`)
- Regenerate: `apps/board/skills` (`bun run skills:expand:board`)
- Test (new cases): `lib/skills/__tests__/drift.test.ts`, `lib/skills/__tests__/placeholders.test.ts`, `lib/skills/__tests__/anatomy.test.ts`, `commands/__tests__/skills-compile-output.test.ts`, `commands/__tests__/skills-check-strict.test.ts`, `apps/console/src/server/waiting.test.ts`, `apps/console/src/app/wiring/parseSeam.test.ts` (a four-token seam parses)
- Test (update their `version=` and `compiled:` assertions): `lib/skills/blocks/__tests__/render.test.ts`, `lib/skills/__tests__/compile.test.ts`, `lib/skills/__tests__/compile-blocks.test.ts`, `lib/skills/__tests__/team-params.test.ts`, `lib/skills/__tests__/expand.test.ts`, `lib/skills/__tests__/field-contract.test.ts`, `lib/skills/__tests__/__snapshots__/compile-native.e2e.test.ts.snap`, `commands/__tests__/skills.test.ts`, `commands/__tests__/skills-writing-style.test.ts`, `commands/__tests__/fixtures/skills-blocks-json/mini.txt`

**Interfaces:**
- Consumes: Task 1's `readLock`, `mergeLock`, `lockWrite`, `LOCK_REL`.
- Produces:
  - Seam shape: `<!-- part: <key> source=<plugin>:<path> path=<p> lines=<a>-<b> -->` (a prop seam has `binding=` in place of `source=`). No `version=`.
  - Header shape: `compiled: "mattstack + acme:review-criteria + acme-base:reply-rules"`.
  - `PartExtent.version: string | null`: the seam's `version=` when present (old output), else `null`.
  - `export function pluginOfSeam(seamLine: string): string | null` in `lib/skills/drift.ts`: the plugin named by `source=` or `binding=`.
  - `export function builtVersionOf(extentVersion: string | null, plugin: string | null, lockEntry: Record<string, string> | undefined): string | null` in `lib/skills/anatomy.ts`: the seam's own version first, else `lockEntry?.[plugin] ?? null`. The result is always a plain version, never one with a sha.

- [ ] **Step 1: Write the failing tests.**
  - `placeholders.test.ts`, `"a prop seam carries no version"`: the seam line matches `/^<!-- part: prop:\S+ binding=\S+ path=\S+ lines=\d+-\d+ -->$/`.
  - `drift.test.ts`, `"partExtents reads seams with and without version"`: an old seam with `version=0.4.11` and a new one without give `version` `"0.4.11"` and `null`, with the same `start`/`end` as today.
  - `drift.test.ts`, `"maskProvenance makes an old and a new seam compare equal"`.
  - `anatomy.test.ts`, `"builtVersion falls back to the lock"`: `builtVersionOf(null, "acme", {acme: "0.4.12"})` is `"0.4.12"`, and `builtVersionOf("0.4.11", "acme", {acme: "0.4.12"})` is `"0.4.11"`.
  - `skills-compile-output.test.ts`, `"a version-only bump changes only plugin.json and the lock"`: compile an `acme` fixture with no `@keys` and no pipeline (Tasks 4 and 5 remove the other two stamps; Task 5 repeats this test with both) in a temp git repo, commit, bump `plugin.json`, recompile; `git status --porcelain` lists exactly `.claude-plugin/plugin.json` and `pack/compiled.lock.json`.
  - `skills-compile-output.test.ts`, `"a --verb compile leaves other targets' lock entries alone"`.
  - `skills-check-strict.test.ts`, `"check never reads the lock"`: hand-edit the lock; check exits 0 with no stale file and no compile error. Sync's compile always rewrites the lock, so check has nothing to report.
  - `waiting.test.ts`, `"a lock-only commit counts as a compile"`.
- [ ] **Step 2: Run each file.** Expected: FAIL on the new cases only.
- [ ] **Step 3: Drop `version=` from the five seam writers and the versions from the two `compiled:` writers.**
- [ ] **Step 4: Update the readers.** Make `EXTENT_RE` and `ROOT_VERSION_RE` accept a missing `version=`, add `pluginOfSeam`, change `maskProvenance`, and make `parseSeam.ts` accept four tokens.
- [ ] **Step 5: Compile writes the lock.** For each compiled target, each source plugin maps to `sources.byName[plugin].version` (`"org"` for the base). When mattstack comes from a checkout (`mattstackProvenance` returns a sha that is not the version), set `mattstackSha[target]` and `mattstackDirty[target]`.
- [ ] **Step 6: Anatomy reads `readLock(packDir)` once and uses `builtVersionOf` for every `builtVersion`.**
- [ ] **Step 7: Update the listed existing tests and fixtures, run `bun run skills:expand:board`, and run every test file named in Files plus `lib/__tests__/no-board-skills-drift.test.ts` and `bun run console:test`.** Expected: PASS.
- [ ] **Step 8: Commit** `skills: move compile versions into the lock file`.

### Task 3: Base copy versions in the lock

**Files:**
- Modify: `lib/skills/base-attachments.ts:160,385` (`PROVENANCE_FILE` content drops `version`) and its `maskProvenanceVersion`
- Modify: `lib/skills/origin.ts:16` (`baseVersion` from `readLock(packDir).bases[base]`, falling back to the copy's own `version` for old output)
- Modify: the Task 2 compile write path, to fill `bases` for each base copy it emits
- Test: `lib/skills/__tests__/base-attachments.test.ts`, `lib/skills/__tests__/origin.test.ts`

**Interfaces:**
- Consumes: Task 1's `CompiledLock.bases` and `mergeLock`; Task 2's compile write path.
- Produces: a base copy's `compiled.json` is `{ base, files, ... }` with no `version`.

- [ ] **Step 1: Write the failing tests.**
  - `"a base copy's compiled.json carries no version"`.
  - `"originFor reads baseVersion from the lock"`.
  - `"originFor still reads an old copy's own version"`.
  - `"an org base bump changes only the lock"`: with the same keyless, pipeline-free fixture as Task 2, compile, bump the base `plugin.json`, recompile; only `pack/compiled.lock.json` changes in the team pack.
  - `"a --verb compile keeps the base version"`: after a `--verb` compile that emits no base copy, `bases` and the console's `baseVersion` are unchanged.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, then `bun run console:test`.** Expected: PASS, with the console's base owner and version rows matching today's fixtures.
- [ ] **Step 5: Commit** `skills: keep the org base version in the lock`.

### Task 4: Versionless resolve ids, pinned by the skill's folder

**Files:**
- Modify: `lib/skills/pointers.ts` (`ID_RE`, `unitId`, `openingLine`)
- Modify: `lib/skills/unit-maps.ts:74-75,212` (`readPackIdentity` refuses a pack named `skills`), `lib/skills/compile-blocks.ts:370`, `lib/skills/base-attachments.ts:383`
- Modify: `lib/skills/resolve.ts` (`PLUGIN_ID_RE`, `resolvePointers`, `pluginUnit`)
- Modify: `lib/mcp/skills-resolve-tool.ts` (the input schema and description), `lib/skills/team-params.ts` (`VERSIONLESS_IDS_MIN_ENGINE`), `commands/skills.ts` (the `raises` list in `floorWrite`)
- Regenerate: `plugins/mattstack/attachments/mcp-tools/reference.md` and `apps/board/skills`
- Test (new cases): `lib/skills/__tests__/pointers.test.ts`, `lib/skills/__tests__/resolve.test.ts`, `lib/mcp/__tests__/skills-resolve-tool.test.ts`
- Test (update their `@<version>:` ids): `commands/__tests__/skills-pointers.test.ts`, `lib/skills/__tests__/compile-blocks.test.ts`, `lib/skills/__tests__/expand.test.ts`, `commands/__tests__/skills.test.ts`, `lib/skills/__tests__/__snapshots__/compile-native.e2e.test.ts.snap`

**Interfaces:**
- Consumes: `findPluginVersionDirs` (`lib/skills/installed-plugins.ts`).
- Produces:
  - `ID_RE` accepts `<plugin>:<unit>`, `<plugin>@<version>:<unit>` and `skills:<name>`.
  - `unitId(plugin: string, unit: string): string` returns `<plugin>:<unit>`. The version checks at `unit-maps.ts:74-75` become `isIdSafeVersion(version: string): boolean` there.
  - `resolvePointers(id: string, deps: ResolveDeps, dir?: string): ResolveResult & { pinned: boolean; warning?: string }`:
    - **`skills:` id or versioned id:** `pinned: true`, no warning, resolved as today.
    - **Versionless id with a `dir` under `~/.claude/plugins/cache/<market>/<plugin>/<version>/`:** that version, `pinned: true`. A `dir` naming a different plugin is refused.
    - **Versionless id with no `dir`, or one outside the cache:** the highest installed version among `findPluginVersionDirs` (refused, as today, when more than one marketplace holds the plugin), `pinned: false`, and `warning`: `"No skill folder was passed, so this run is not pinned to the version it loaded."`
  - `export const VERSIONLESS_IDS_MIN_ENGINE` (see Global Constraints for its value).
  - The opening line's exact text:

```
Pointers here are `@keys`. Resolve them once per run: if you already hold a `skills_resolve` map that covers `<id>` and whose folder sits in the same plugin version folder as the loaded skill's own directory, use it; otherwise call `skills_resolve {id: "<id>", dir: "<the loaded skill's own directory>"}` and use the path it returns for each key, in anything you hand a subagent or a tool too. If it fails, stop and say so; never look for the file another way.
```

- [ ] **Step 1: Write the failing tests.**
  - `pointers.test.ts`:
    - `"ID_RE accepts versionless, versioned and skills ids"`.
    - `"openingLine names dir and the version folder rule"` (assert the exact text above).
  - `resolve.test.ts` (with the `resolve-fs.ts` fakes):
    - `"dir pins resolve to its version while two are installed"`: install `acme` 0.4.11 and 0.4.12; with `dir` under 0.4.11, the paths are 0.4.11's and `pinned` is true.
    - `"no dir resolves the highest installed version with a warning"`: 0.4.12, `pinned: false`, and the warning text above.
    - `"a dir outside the plugin cache is treated as no dir"`.
    - `"a dir naming another plugin is refused"`.
    - `"skills ids and versioned ids are pinned with no warning"`.
  - `skills-resolve-tool.test.ts`, `"dir is passed through and confined"`: a `dir` whose `..` leaves the cache is refused.
  - `compile-blocks.test.ts`, `"a pack named skills is refused"`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement the id, resolve and tool changes.**
- [ ] **Step 4: Add `VERSIONLESS_IDS_MIN_ENGINE` to `floorWrite`'s `raises` whenever `carriesKeys`.**
- [ ] **Step 5: Regenerate** the MCP reference (`bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`) and the board skills (`bun run skills:expand:board`).
- [ ] **Step 6: Update the listed existing tests, then run every test file named in Files plus `lib/__tests__/no-board-skills-drift.test.ts`.** Expected: PASS.
- [ ] **Step 7: Commit** `skills: versionless resolve ids pinned by the skill folder`.

### Task 5: Run provenance from skillDir

**Files:**
- Create: `lib/runs/installed-provenance.ts`
- Modify: `lib/skills/placeholders.ts:338-353` (`runStartFlags` emits no `--mattstack-sha`, `--mattstack-dirty` or `--pack-sha`), `commands/skills.ts:698` (drop the `computePackSha` call and the `mattstackSha`/`mattstackDirty` context fields that fed it)
- Modify: `lib/mcp/run-tools.ts` `prepareStart` (append `--skill-dir <skillDir>` beside `--pack-dirs`), `commands/runs-write.ts` and `lib/runs/start.ts` (accept `--skill-dir`, and call `installedProvenance` when `packProvenance` finds no git checkout)
- Modify: `apps/console/src/server/effectiveInputs.ts` (`parsePackCommits` keeps version tokens; `PackVersionRow` gains `recordedVersion: string | null`, with `recordedSha: null` for one), `apps/console/src/app/runs/EffectiveInputs.tsx` (a version row shows the version, with no drift and no count), `apps/console/src/server/fixtures/design/runsFixture.ts` (a run whose `pack_commits` carries a version token)
- Test: `lib/runs/__tests__/installed-provenance.test.ts`, `lib/runs/__tests__/write.test.ts`, `lib/skills/__tests__/placeholders.test.ts`, `apps/console/src/server/effectiveInputs.test.ts`, `apps/console/src/server/stageDoc.test.ts`, `e2e/tests/runs.test.ts` (update its baked-flag expectations)

**Interfaces:**
- Consumes: Task 1's `readLock` (`mattstackSha`, `mattstackDirty`, `targets`); `teamPackDir` (`lib/rt-paths.ts:298`); `generatedMarketplaceRef` (`lib/setup/generated-marketplace.ts:63`).
- Produces:
  - `export type InstalledProvenance = { tokens: string[]; dirty: 0 | 1 }`
  - `export type OrgClone = { dir: string; ref: string; packRel: string }`
  - `export function installedProvenance(skillDir: string, deps: { readFile: (p: string) => string | null; git: (cwd: string, args: string[]) => { code: number; stdout: string }; orgCloneFor: (marketplace: string, plugin: string) => OrgClone | null }): InstalledProvenance`
    - The pack token is `<pack>=<short sha>` of the oldest commit on `ref` whose `<packRel>/.claude-plugin/plugin.json` carries the installed version (walked the way `committedSinceBump` walks it). With no org clone or no such commit, it is `<pack>=<version>`.
    - The mattstack token is `mattstack=<mattstackSha[target]>` when the lock has one, else `mattstack=<targets[target].mattstack>`. `dirty` comes from `mattstackDirty[target]`.
    - The target is the skill's dir relative to its pack root.
  - `export function realOrgCloneFor(home: string): (marketplace: string, plugin: string) => OrgClone | null`. For each org clone under `~/.mattstack/orgs/<org>/`, it reads the name in that org's generated marketplace (`generatedMarketplaceDir`). On a match with the skill folder's `<market>` segment, it returns the clone dir, `generatedMarketplaceRef(p, cloneDir)` and `teamPackDir(org, plugin)` relative to the clone.

- [ ] **Step 1: Write the failing tests.**
  - `installed-provenance.test.ts` (a temp git repo stands in for the org clone, with a fake `orgCloneFor`):
    - `"names the sync commit that reached the installed version"`: commits bump `acme` from 0.4.10 to 0.4.12, followed by another team's commit; with the skill installed at 0.4.11, the token is the 0.4.11 sync commit's short sha.
    - `"reads the data branch while the clone is on a trial branch"`: a checked-out trial branch with an extra bump; the token still comes from `ref`.
    - `"falls back to the version with no org clone"`: tokens include `acme=0.4.11`.
    - `"takes mattstack and its dirty bit from the lock"`: with `mattstackSha` `abc1234` and dirty 1, tokens include `mattstack=abc1234` and `dirty` is 1. With no sha, the token is `mattstack=0.32.56`.
    - `"realOrgCloneFor matches the marketplace name"`: a temp HOME with one org clone and its generated marketplace.
  - `placeholders.test.ts`, `"run-start flags bake no shas"`.
  - `write.test.ts`, `"old baked flags still record provenance"`: the existing case passes unchanged.
  - `effectiveInputs.test.ts`, `"a version token shows a version row"`: `acme=0.4.11` gives `{ pack: "acme", recordedSha: null, recordedVersion: "0.4.11", drifted: null }`.
  - `stageDoc.test.ts`, `"a sync-commit sha finds the stage doc"`.
  - `skills-compile-output.test.ts`, `"a version-only bump changes only plugin.json and the lock, with keys and a pipeline"`: the Task 2 test, on a fixture with `@keys` and a pipeline, committing between compiles so the org HEAD moves. This is the end-to-end proof of the first Goal.
- [ ] **Step 2: Run them.** Expected: FAIL on the new cases.
- [ ] **Step 3: Implement `installedProvenance` and `realOrgCloneFor`, then wire `--skill-dir` through `prepareStart` and `start.ts`.**
- [ ] **Step 4: Implement the console's version row.**
- [ ] **Step 5: Run the Step 1 files, `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/runs.test.ts` and `bun run console:test`.** Expected: PASS.
- [ ] **Step 6: Render the run detail's effective inputs** on the `runs` design fixture, with a run carrying a version token, in light and dark (see Global Constraints).
- [ ] **Step 7: Commit** `runs: work out pack provenance at run start`.

### Task 6: One sync commit

**Files:**
- Modify: `lib/skills/sync.ts:974-1160` (one subject, one staged set, one snapshot check, and undo for one commit)
- Test: `lib/skills/__tests__/sync.test.ts`, `commands/__tests__/skills-sync.test.ts`

**Interfaces:**
- Produces: the sync commit subject `skills sync: <pack> v<version>`. `made` holds at most one commit.

- [ ] **Step 1: Write the failing tests.**
  - `"published edits and the bump land in one commit"`: one new commit holding the person's staged edit, `plugin.json`, `pack/compiled.lock.json` and the recompiled files.
  - `"a file staged by someone else mid-sync still abandons"`: the existing unseen-staged case, against one commit.
  - `"a failed push undoes the one commit"`.
- [ ] **Step 2: Run both files.** Expected: FAIL on the new cases. The existing two-commit assertions also fail, and Step 3 updates them.
- [ ] **Step 3: Implement.**
  - Stage the published edits and the compiled set together.
  - Check the index against `expectedBlobs(staged)` merged with `builtBlobs` in one `unseenStaged` call.
  - Make one commit, then run `rodeIn` against that snapshot.
  - Drop `pendingSubject` and the guard that the version commit sits directly on the pending commit.
- [ ] **Step 4: Run both files again.** Expected: PASS.
- [ ] **Step 5: Commit** `skills sync: one commit per sync`.

### Task 7: The history classifier

**Files:**
- Create: `lib/skills/history-classify.ts`, `commands/skills-history-classify.ts`
- Modify: `lib/command-tree-def.ts` (`skills history-classify`, with `--repo-dir <dir> --sha <sha>... --json`; not agent-safe), `lib/rt-paths.ts` (the cache path)
- Test: `lib/skills/__tests__/history-classify.test.ts`, `commands/__tests__/skills-history-classify.test.ts`

**Interfaces:**
- Produces:
  - `export const CLASSIFY_RULE = 1`
  - `export function maskStamps(path: string, text: string): string`. It applies `maskProvenance`, also masks the `--mattstack-dirty` value, and masks unit-id versions (`<plugin>@<v>:` → `<plugin>@*:`), the `id`/`covers` versions and a base copy's `version` in `compiled.json`, the `version` in `plugin.json` and `minEngine` in `requires.json`. `pack/compiled.lock.json` masks to a constant.
  - `export function isVersionOnly(changes: { path: string; before: string | null; after: string | null }[]): boolean`. It is true only when `changes` is non-empty and every file is present on both sides with equal masked text.
  - The `--json` envelope (frozen): `{ "versionOnly": string[] }`, the input shas that are version-only.
  - The cache: `~/.mattstack/rt/cache/history-classify/<repo identity>.json`, where the repo identity is the org clone's serialized identity from rt-client (`docs/repo-identity.md`), never a derived name, holding `{ rule: number; shas: Record<string, boolean> }`. A file with a different `rule` is ignored and rewritten.

- [ ] **Step 1: Write the failing tests** (in a temp git repo, with commits built in the old stamp shapes: versioned ids, `version=` seams and baked flags):
  - `"a sync commit that only moved versions is version-only"`
  - `"a bump-only commit is version-only"` (`plugin.json` plus `requires.json` `minEngine`)
  - `"a compile-only commit that changed only stamps is version-only"`
  - `"a dirty-bit-only change is version-only"`
  - `"a lock-only commit is version-only"`
  - `"a commit that also edits a fill body is not"`
  - `"a commit that edits only an org base file is not"`
  - `"an added or deleted file is never version-only"`
  - `"an empty commit is not version-only"`
  - `"a cached sha is answered without git, and a new rule ignores the cache"`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** For each sha, run `git diff-tree -r --no-renames <sha>^ <sha>` over the whole commit (no pathspec, so a change outside the pack counts as real), `git show` each side, then call `isVersionOnly`. A root commit or a merge is never version-only.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `skills: classify version-only pack commits`.

### Task 8: Fold version-only commits in the console

**Files:**
- Modify: `apps/console/src/server/skills.ts` (`/api/skills/history` passes the shas it lists and the repo root it resolved to `rt skills history-classify`, then adds `versionOnly: boolean` to each commit)
- Create: `apps/console/src/app/wiring/graph/model/foldHistory.ts`
- Modify: `apps/console/src/app/wiring/PackHistory.tsx` (consecutive `versionOnly` commits fold into one row, "N version-only commits", with a toggle; a compare still accepts any commit)
- Modify: `apps/console/src/server/fixtures/design/` (a scenario with a run of version-only commits, added to `scenarios.ts`)
- Test: `apps/console/src/app/wiring/graph/model/foldHistory.test.ts`, `apps/console/src/server/skills.test.ts`

**Interfaces:**
- Consumes: Task 7's verb and envelope.
- Produces: `export function foldVersionOnly<C extends { sha: string; versionOnly: boolean }>(commits: C[]): ({ kind: "commit"; commit: C } | { kind: "fold"; commits: C[] })[]`. A single version-only commit is not folded.

- [ ] **Step 1: Write the failing tests.**
  - `foldHistory.test.ts`: `"three consecutive version-only commits fold into one"`, `"a lone version-only commit stays a row"`, `"a real commit splits two folds"`.
  - `skills.test.ts`: `"history marks version-only commits from rt"`, `"history still answers when the classifier fails"` (every commit gets `versionOnly: false`).
- [ ] **Step 2: Run `bun run console:test`.** Expected: FAIL.
- [ ] **Step 3: Implement the route change, the model, then the row.** Copy follows `rt:ui-copy`: `N version-only commits`, with the toggle reading `Show` / `Hide`.
- [ ] **Step 4: Run `bun run console:test`, `bun run console:typecheck` and `bun run console:lint`.** Expected: PASS.
- [ ] **Step 5: Render Packs → Changes** on the new fixture scenario, folded and expanded, in light and dark (see Global Constraints).
- [ ] **Step 6: Commit** `console: fold version-only commits in pack history`.

### Task 9: Plugin recompile, authoring guidance and docs

**Files:**
- Modify: `plugins/mattstack/plugin/skills/editing-skills/SKILL.md` through `superpowers:writing-skills` (RED baseline, then the edit, then GREEN). The new rule: recompile in the same commit as the source edit, never as a separate "compile the X" commit.
- Modify: `lib/skills/README.md` (the seam shape and the lock), `plugins/mattstack/.claude-plugin/plugin.json` (version bump), `plugins/mattstack/pack/requires.json` (`minEngine` raised by hand to `VERSIONLESS_IDS_MIN_ENGINE`)
- Regenerate: every compiled skill in `plugins/mattstack`, and `apps/board/skills`
- Test: the `plugin-mattstack` CI job's checks, run locally

- [ ] **Step 1: Run the writing-skills RED baseline.** Ask a subagent to fix a pack fill and record whether it commits the recompile separately.
- [ ] **Step 2: Edit the skill, then run GREEN.** Expected: the recompile lands in the same commit.
- [ ] **Step 3: Bump the plugin, raise its `requires.json`, and set `VERSIONLESS_IDS_MIN_ENGINE` to the new version.** Recompile the plugin, run `bun run skills:expand:board`, and update the README.
- [ ] **Step 4: Run `bun cli.ts skills check --strict` against the plugin, the mcp-tools reference diff and `lib/__tests__/no-board-skills-drift.test.ts`.** Expected: clean. The plugin's compiled files lose their version stamps once, in this migration commit.
- [ ] **Step 5: Commit** `mattstack: recompile without version stamps; recompile with the edit`.
