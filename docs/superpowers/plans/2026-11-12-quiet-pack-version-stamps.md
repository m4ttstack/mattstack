# Quiet Pack Version Stamps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pack version bump touches `plugin.json` and one lock file instead of every compiled file, with run tracking, the console and session pinning unchanged.

**Architecture:** Compile stops writing versions into compiled bodies and records them per target in `pack/compiled.lock.json`. Resolve ids lose their version and pin by the loaded skill's folder. Run start works out provenance from `skillDir` instead of baked flags. Sync makes one commit, and the console folds old version-only commits, classified by rt.

**Tech Stack:** Bun + TypeScript (rt), `bun test`; console is Hono + React (vitest).

**Spec:** `docs/superpowers/specs/2026-11-12-quiet-pack-version-stamps-design.md`

## Global Constraints

- `pack_commits` keeps its `name=value,...` shape; the run DB schema does not change.
- Old compiled output (versioned ids, `version=` seams, baked `--mattstack-sha`/`--mattstack-dirty`/`--pack-sha`) keeps working everywhere it works today.
- Every new pack format raises `minEngine` through `floorWrite`'s `raises` list, never by hand.
- Run every test from the repo root (`bun test <file>`); only targeted tests locally, CI runs the rest.
- Everything rt prints goes through `lib/ui/out.ts`; any new `--json` envelope is frozen once shipped.
- The mattstack plugin changes need a `plugins/mattstack/.claude-plugin/plugin.json` bump, re-checked one past `main` right before merge.
- No real team, org or pack names in fixtures, tests or docs: use `acme`, `acme-base`.
- Commit after each task: `<area>: <imperative>`, ending with the Co-Authored-By line.

## Review Focus

1. **A pack compiled half old, half new** (a `--verb` compile on a pack whose other targets still carry `version=` seams): anatomy shows built versions for both, and nothing crashes. Test in Task 2.
2. **A run started before an update, resolving after it**: the held map's folder is the old version, so the agent resolves again with `dir`, and resolve returns the old version's paths while both versions are installed. Test in Task 4.
3. **An org clone on a trial branch**: run start still finds the bump commit on the data branch. Test in Task 5.
4. **A pack installed on a Mac with no org clone** (a member whose sparse cone lacks the pack, or no clone at all): run start records `<pack>=<version>`, and the console shows a version row without a sha. Test in Task 5.
5. **A historical commit that mixes a real edit with stamp churn**: the classifier must not fold it. Test in Task 7.

---

### Task 1: The lock file module

**Files:**
- Create: `lib/skills/compiled-lock.ts`
- Test: `lib/skills/__tests__/compiled-lock.test.ts`

**Interfaces:**
- Produces:
  - `export const LOCK_REL = "pack/compiled.lock.json"`
  - `export type SourceVersion = string` (`"0.32.56"`, `"org"`, or for a checkout `"0.32.56+abc1234"`)
  - `export type CompiledLock = { targets: Record<string, Record<string, SourceVersion>>; bases: Record<string, string>; mattstackDirty?: Record<string, 0 | 1> }`, where target keys are pack-relative dirs (`skills/work`, `attachments/stage-ship`)
  - `export function readLock(packDir: string, readFile: (p: string) => string | null): CompiledLock` (missing or unparseable file reads as `{ targets: {}, bases: {} }`)
  - `export function mergeLock(current: CompiledLock, compiled: Record<string, Record<string, SourceVersion>>, bases: Record<string, string>, dirty: Record<string, 0 | 1>): CompiledLock` (replaces only the entries named in `compiled`)
  - `export function serializeLock(lock: CompiledLock): string` (keys sorted, 2-space JSON, trailing newline)
  - `export function lockWrite(packDir: string, next: CompiledLock, readFile: (p: string) => string | null, write: boolean): { written: string[]; removed: string[]; stale: boolean }` (same contract as `floorWrite` in `commands/skills.ts`)

- [ ] **Step 1: Write the failing tests**

```ts
test("mergeLock keeps targets a partial compile did not touch", () => {
  const current = { targets: { "skills/work": { mattstack: "0.32.55", acme: "0.4.11" }, "skills/review": { mattstack: "0.32.55", acme: "0.4.11" } }, bases: {} };
  const next = mergeLock(current, { "skills/work": { mattstack: "0.32.56", acme: "0.4.12" } }, {}, {});
  expect(next.targets["skills/review"]).toEqual({ mattstack: "0.32.55", acme: "0.4.11" });
  expect(next.targets["skills/work"]).toEqual({ mattstack: "0.32.56", acme: "0.4.12" });
});
test("serializeLock is stable across key order", () => {
  const a = serializeLock({ targets: { b: { y: "1", x: "2" }, a: {} }, bases: {} });
  const b = serializeLock({ targets: { a: {}, b: { x: "2", y: "1" } }, bases: {} });
  expect(a).toBe(b);
  expect(a.endsWith("\n")).toBe(true);
});
test("readLock treats a missing or damaged file as empty", () => {
  expect(readLock("/p", () => null)).toEqual({ targets: {}, bases: {} });
  expect(readLock("/p", () => "{not json")).toEqual({ targets: {}, bases: {} });
});
test("lockWrite reports stale without writing when write is false", () => { /* temp dir; assert stale: true, no file */ });
```

- [ ] **Step 2: Run `bun test lib/skills/__tests__/compiled-lock.test.ts`.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement `lib/skills/compiled-lock.ts` per the Interfaces block.**
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit** `skills: add the compiled lock file module`.

### Task 2: Versionless seams and header, built versions from the lock

**Files:**
- Modify: `lib/skills/placeholders.ts:140,148` (prop and include seams), `lib/skills/team-params.ts:173` (section seam), `lib/skills/blocks/render.ts` (block seam), `lib/skills/compile.ts:246` (`compiled:` header), `lib/skills/expand.ts:50`
- Modify: `lib/skills/drift.ts:47-48` (`EXTENT_RE` with `version=` optional), `lib/skills/provenance.ts:5-15`
- Modify: `commands/skills.ts`: the compile write path (call `lockWrite` beside `floorWrite`, add its `written` to `CompileWrites`), the check path (compare the lock on its own, not as drift), the anatomy sources (`2715-2780`, `ROOT_VERSION_RE` at `2675`)
- Modify: `apps/console/src/server/waiting.ts:87-100` (`compiledOutputs` includes `pack/compiled.lock.json`)
- Test: `lib/skills/__tests__/drift.test.ts`, `lib/skills/__tests__/placeholders.test.ts`, `lib/skills/__tests__/anatomy.test.ts`, `commands/__tests__/skills-compile-output.test.ts` (compile writes), `commands/__tests__/skills-check-strict.test.ts` (check), `apps/console/src/server/waiting.test.ts`

**Interfaces:**
- Consumes: Task 1's `readLock`, `mergeLock`, `lockWrite`, `LOCK_REL`.
- Produces:
  - Seam shape: `<!-- part: <key> source=<plugin>:<path> path=<p> lines=<a>-<b> -->` (prop seams keep `binding=` in place of `source=`). No `version=`.
  - Header shape: `compiled: "mattstack + acme:review-criteria + acme-base:reply-rules"`.
  - `PartExtent.version: string | null` stays; it is the seam's `version=` when present (old output), else `null`.
  - `export function builtVersionOf(extent: PartExtent, plugin: string, lockEntry: Record<string, string> | undefined): string | null` in `lib/skills/anatomy.ts`: the seam's own version first, else `lockEntry?.[plugin] ?? null`.
  - `export function pluginOfSeam(seamLine: string): string | null` in `lib/skills/drift.ts`: the plugin named by `source=`/`binding=`.

- [ ] **Step 1: Write the failing tests**
  - `placeholders.test.ts`: `"a prop seam carries no version"`: render a prop fill and expect the seam line to match `/^<!-- part: prop:\S+ binding=\S+ path=\S+ lines=\d+-\d+ -->$/`.
  - `drift.test.ts`: `"partExtents reads seams with and without version"`: one old seam with `version=0.4.11`, one new without; expect `version` `"0.4.11"` and `null`, with the same `start`/`end` as today.
  - `anatomy.test.ts`: `"builtVersion falls back to the lock"`: `builtVersionOf({version: null, ...}, "acme", {acme: "0.4.12"})` is `"0.4.12"`; with `version: "0.4.11"` it is `"0.4.11"`.
  - compile/check command test: `"a version-only bump changes only plugin.json and the lock"`: compile an `acme` fixture, bump `plugin.json`, recompile; `git status --porcelain` lists exactly `.claude-plugin/plugin.json` and `pack/compiled.lock.json`.
  - compile/check command test: `"a --verb compile leaves other targets' lock entries alone"`.
  - check test: `"a stale lock alone is not drift"`.
  - `waiting.test.ts`: `"a lock-only commit counts as a compile"`.
- [ ] **Step 2: Run each file.** Expected: FAIL on the new cases only.
- [ ] **Step 3: Drop `version=` from the four seam writers and the versions from the two `compiled:` writers.** `maskProvenance` keeps its seam/header patterns so it still masks old output.
- [ ] **Step 4: Make `EXTENT_RE` and `ROOT_VERSION_RE` accept a missing `version=`, and add `pluginOfSeam`.**
- [ ] **Step 5: Compile writes the lock.** Each compiled target's entry maps each source plugin to its version (`sources.byName[plugin].version`, `"org"` for the base). When mattstack comes from a checkout (`mattstackProvenance` gives a sha), the entry is `<version>+<sha>` and `mattstackDirty[target]` is the dirty bit.
- [ ] **Step 6: Anatomy reads `readLock(packDir)` and uses `builtVersionOf` for every `builtVersion`.**
- [ ] **Step 7: Check compares the lock with `lockWrite(..., write=false)` and reports it as a stale file with no drift cause.**
- [ ] **Step 8: Run the Step 1 files plus `bun test lib/skills/__tests__/provenance.test.ts`.** Expected: PASS.
- [ ] **Step 9: Commit** `skills: move compile versions into the lock file`.

### Task 3: Base copy versions in the lock

**Files:**
- Modify: `lib/skills/base-attachments.ts:160,385` (`PROVENANCE_FILE` content drops `version`), its `maskProvenanceVersion`
- Modify: `lib/skills/origin.ts:16` (`baseVersion` from `readLock(packDir).bases[base]`, falling back to the copy's own `version` for old output)
- Modify: the Task 2 compile write path, to fill `bases`
- Test: `lib/skills/__tests__/base-attachments.test.ts`, `lib/skills/__tests__/origin.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 `CompiledLock.bases`; Task 2 compile write path.
- Produces: a base copy's `compiled.json` is `{ base, files, ... }` with no `version`.

- [ ] **Step 1: Write the failing tests:** `"a base copy's compiled.json carries no version"`; `"originFor reads baseVersion from the lock"`; `"originFor still reads an old copy's own version"`; `"an org base bump changes only the lock"` (compile, bump the base `plugin.json`, recompile; only `pack/compiled.lock.json` changes in the team pack).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, then `bun run console:test`.** Expected: PASS, and the console's base owner and version rows match today's fixtures.
- [ ] **Step 5: Commit** `skills: keep the org base version in the lock`.

### Task 4: Versionless resolve ids, pinned by the skill's folder

**Files:**
- Modify: `lib/skills/pointers.ts` (`ID_RE`, `unitId`, `openingLine`)
- Modify: `lib/skills/unit-maps.ts:74-75,212`, `lib/skills/compile-blocks.ts:370`, `lib/skills/base-attachments.ts:383`
- Modify: `lib/skills/resolve.ts` (`PLUGIN_ID_RE`, `resolvePointers`, `pluginUnit`)
- Modify: `lib/mcp/skills-resolve-tool.ts` (input schema and description), `lib/skills/team-params.ts` (`VERSIONLESS_IDS_MIN_ENGINE`), `commands/skills.ts` `floorWrite` raises
- Regenerate: `plugins/mattstack/attachments/mcp-tools/reference.md`
- Test: `lib/skills/__tests__/pointers.test.ts`, `lib/skills/__tests__/resolve.test.ts`, `lib/mcp/__tests__/skills-resolve-tool.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `ID_RE` accepts `<plugin>:<unit>`, `<plugin>@<version>:<unit>` and `skills:<name>`.
  - `unitId(plugin: string, unit: string): string` returns `<plugin>:<unit>`. Its version parameter goes away; the name/version checks in `unit-maps.ts:74-75` move to a separate `isIdSafeVersion(version)` there.
  - `resolvePointers(id: string, deps: ResolveDeps, dir?: string): ResolveResult & { pinned: boolean; warning?: string }`.
  - `export const VERSIONLESS_IDS_MIN_ENGINE`: set to the mattstack `plugin.json` version this branch ships.
  - The opening line, exact text:

```
Pointers here are `@keys`. Resolve them once per run: if you already hold a `skills_resolve` map that covers `<id>` and whose folder is inside the loaded skill's own directory, use it; otherwise call `skills_resolve {id: "<id>", dir: "<the loaded skill's own directory>"}` and use the path it returns for each key, in anything you hand a subagent or a tool too. If it fails, stop and say so; never look for the file another way.
```

- [ ] **Step 1: Write the failing tests**
  - `pointers.test.ts`: `"ID_RE accepts versionless, versioned and skills ids"`, `"openingLine names dir and the folder rule"` (assert the exact text above).
  - `resolve.test.ts` (using `resolve-fs.ts` fakes):
    - `"dir pins resolve to its version while two are installed"`: install `acme` 0.4.11 and 0.4.12; with `dir` under 0.4.11, the paths are 0.4.11's and `pinned: true`.
    - `"no dir resolves the installed version with a warning"`: `pinned: false`, and `warning` matches `/not pinned/`.
    - `"a dir outside the plugin cache is treated as no dir"`.
    - `"a versioned id resolves as today"`: the existing cases still pass.
  - `skills-resolve-tool.test.ts`: `"dir is passed through and confined"`: a `dir` with `..` leaving the cache is refused, the same way a bad `compiled.json` folder is today.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The version comes from `dir`'s path under `~/.claude/plugins/cache/<market>/<plugin>/<version>/` (the shape `findPluginVersionDirs` walks); a `dir` whose plugin segment is not the id's plugin is refused.
- [ ] **Step 4: Raise the floor.** Add `VERSIONLESS_IDS_MIN_ENGINE` to `floorWrite`'s `raises` whenever `carriesKeys`.
- [ ] **Step 5: Regenerate the MCP reference** with `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`.
- [ ] **Step 6: Run the Step 1 files plus `bun test lib/skills/__tests__/unit-maps.test.ts`.** Expected: PASS.
- [ ] **Step 7: Commit** `skills: versionless resolve ids pinned by the skill folder`.

### Task 5: Run provenance from skillDir

**Files:**
- Create: `lib/runs/installed-provenance.ts`
- Modify: `lib/skills/placeholders.ts:338-353` (`runStartFlags` stops emitting `--mattstack-sha`, `--mattstack-dirty`, `--pack-sha`), `lib/skills/provenance.ts` (drop `computePackSha`'s use in compile)
- Modify: `lib/mcp/run-tools.ts` `prepareStart` (pass `--skill-dir <skillDir>`), `commands/runs-write.ts` and `lib/runs/start.ts` (accept `--skill-dir`, call `installedProvenance` when the pack root is not a git checkout), `lib/mcp/run-tools.ts` `RUN_START_FLAGS` unchanged
- Test: `lib/runs/__tests__/installed-provenance.test.ts`, `lib/runs/__tests__/write.test.ts` (run start), `lib/skills/__tests__/placeholders.test.ts`, `apps/console/src/server/effectiveInputs.test.ts`, `apps/console/src/server/stageDoc.test.ts`

**Interfaces:**
- Consumes: Task 1 `readLock`; `generatedMarketplaceRef` and `teamPackDir` (`lib/team/team-pack-path.ts`) to find the org clone and data branch.
- Produces:
  - `export type InstalledProvenance = { tokens: string[]; dirty: 0 | 1 }`
  - `export function installedProvenance(skillDir: string, deps: { readFile: (p: string) => string | null; git: (cwd: string, args: string[]) => { code: number; stdout: string }; orgCloneFor: (plugin: string) => { dir: string; ref: string; packRel: string } | null }): InstalledProvenance`
  - Tokens: `<pack>=<short sha>` (the oldest commit on `ref` whose `<packRel>/.claude-plugin/plugin.json` carries the installed version, walked like `committedSinceBump`), else `<pack>=<version>`; plus `mattstack=<lock version>`, with `dirty` from `mattstackDirty`.

- [ ] **Step 1: Write the failing tests**
  - `installed-provenance.test.ts` (a temp git repo standing in for the org clone):
    - `"names the sync commit that reached the installed version"`: three commits bumping `acme` 0.4.10 to 0.4.12, plus one unrelated team's commit after; skill installed at 0.4.11; the token is the 0.4.11 sync commit's short sha.
    - `"reads the data branch while the clone is on a trial branch"`: check out a trial branch with an extra bump; the token still comes from `ref`.
    - `"falls back to the version with no org clone"`: `orgCloneFor` returns null; tokens include `acme=0.4.11`.
    - `"takes mattstack and its dirty bit from the lock"`: lock entry `0.32.56+abc1234`, dirty 1; tokens include `mattstack=0.32.56+abc1234` and `dirty` is 1.
  - `placeholders.test.ts`: `"run-start flags bake no shas"`: the fenced output has no `--mattstack-sha`, `--mattstack-dirty` or `--pack-sha`.
  - `write.test.ts`: `"old baked flags still record provenance"`: the existing case passes unchanged.
  - console `effectiveInputs.test.ts`: `"a version token shows a row without a sha"`; `stageDoc.test.ts`: `"a sync-commit sha finds the stage doc"`.
- [ ] **Step 2: Run them.** Expected: FAIL on the new cases.
- [ ] **Step 3: Implement `installedProvenance`, then wire it into `start.ts` when `--skill-dir` is given and `packProvenance` found no git checkout.**
- [ ] **Step 4: If `parsePackCommits` drops version tokens, make the drift row show them as a version-only row (no drift, no count).** `stageDoc.ts` already parses them.
- [ ] **Step 5: Run the Step 1 files and `bun run console:test`.** Expected: PASS.
- [ ] **Step 6: Commit** `runs: work out pack provenance at run start`.

### Task 6: One sync commit

**Files:**
- Modify: `lib/skills/sync.ts:974-1160` (one subject, one staged set, one snapshot check, undo for one commit)
- Test: `lib/skills/__tests__/sync.test.ts`

**Interfaces:**
- Produces: the sync commit subject `skills sync: <pack> v<version>`. `made` holds at most one commit.

- [ ] **Step 1: Write the failing tests:** `"published edits and the bump land in one commit"` (one new commit; it holds the person's staged edit, `plugin.json`, `pack/compiled.lock.json` and the recompiled files); `"a file staged by someone else mid-sync still abandons"` (the existing unseen-staged case, against one commit); `"a failed push undoes the one commit"`.
- [ ] **Step 2: Run `bun test lib/skills/__tests__/sync.test.ts`.** Expected: FAIL on the new cases; the existing two-commit assertions fail too and are updated in Step 3.
- [ ] **Step 3: Implement.** Stage the published edits and the compiled set together. Check the index against `expectedBlobs(staged)` merged with `builtBlobs` in one `unseenStaged` call. Make one commit, then `rodeIn` against that one snapshot. Drop `pendingSubject` and the "sits directly on the pending commit" guard.
- [ ] **Step 4: Run it again.** Expected: PASS.
- [ ] **Step 5: Commit** `skills sync: one commit per sync`.

### Task 7: The history classifier

**Files:**
- Create: `lib/skills/history-classify.ts`, `commands/skills-history-classify.ts`
- Modify: `lib/command-tree-def.ts` (`skills history-classify`, `--pack <name> --sha <sha>... --json`, not agent-safe), `lib/rt-paths.ts` (cache path)
- Test: `lib/skills/__tests__/history-classify.test.ts`, `commands/__tests__/skills-history-classify.test.ts`

**Interfaces:**
- Produces:
  - `export function maskStamps(path: string, text: string): string`: `maskProvenance` plus unit-id versions (`<plugin>@<v>:` → `<plugin>@*:`), `compiled.json` `id`/`covers` versions and a base copy's `version`, `plugin.json`'s `version`, `requires.json`'s `minEngine`; `pack/compiled.lock.json` masks to a constant.
  - `export function isVersionOnly(changes: { path: string; before: string | null; after: string | null }[]): boolean`: true when every changed file is present on both sides and its masked texts are equal.
  - `--json` envelope (frozen): `{ "pack": string, "versionOnly": string[] }`, the input shas that are version-only.
  - Cache: `~/.mattstack/rt/cache/history-classify/<pack>.json`, `{ [sha]: boolean }`, read before git and written after.

- [ ] **Step 1: Write the failing tests:** `"a sync commit that only moved versions is version-only"` (build it with the old stamp shapes: versioned ids, `version=` seams, baked flags); `"a commit that also edits a fill body is not"`; `"an added or deleted file is never version-only"`; `"a lock-only commit is version-only"`; `"a cached sha is answered without git"` (count git calls with a fake).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** For each sha: `git diff-tree -r --no-renames <sha>^ <sha> -- <packRel>`, `git show` each side, then `isVersionOnly`. A root commit or a merge is never version-only.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `skills: classify version-only pack commits`.

### Task 8: Fold version-only commits in the console

**Files:**
- Modify: `apps/console/src/server/skills.ts` (`/api/skills/history` calls `rt skills history-classify` for the shas it lists and adds `versionOnly: boolean` per commit)
- Modify: `apps/console/src/app/wiring/PackHistory.tsx` (fold consecutive `versionOnly` commits into one row, "N version-only commits", with a show toggle; the compare still accepts any commit)
- Modify: `apps/console/src/server/fixtures/design/` (an `unsynced`-style scenario with a run of version-only commits)
- Test: `apps/console/src/server/skills.test.ts`, the `PackHistory` test beside it (create a pure `foldVersionOnly(commits)` model in `apps/console/src/app/wiring/graph/model/foldHistory.ts` and test that)

**Interfaces:**
- Consumes: Task 7's verb and envelope.
- Produces: `export function foldVersionOnly<C extends { sha: string; versionOnly: boolean }>(commits: C[]): ({ kind: "commit"; commit: C } | { kind: "fold"; commits: C[] })[]`. A single version-only commit is not folded.

- [ ] **Step 1: Write the failing tests:** `foldHistory.test.ts`: `"three consecutive version-only commits fold into one"`, `"a lone version-only commit stays a row"`, `"a real commit splits two folds"`; `skills.test.ts`: `"history marks version-only commits from rt"` and `"history still answers when the classifier fails"` (every `versionOnly: false`).
- [ ] **Step 2: Run them with `bun run console:test`.** Expected: FAIL.
- [ ] **Step 3: Implement the route change and the model, then the row in `PackHistory.tsx`.** Copy follows `rt:ui-copy`: `N version-only commits`, toggle `Show` / `Hide`.
- [ ] **Step 4: Run `bun run console:test`, `bun run console:typecheck` and `bun run console:lint`.** Expected: PASS.
- [ ] **Step 5: Render it.** Start the console on the design fixture with the new scenario, open Packs → Changes in Fast Browser (through the `fast-browser:browser-driver` agent, on Haiku at medium), screenshot light and dark, folded and expanded, and say plainly what looks wrong.
- [ ] **Step 6: Commit** `console: fold version-only commits in pack history`.

### Task 9: Plugin recompile, authoring guidance and docs

**Files:**
- Modify: `plugins/mattstack/plugin/skills/editing-skills/SKILL.md` (recompile in the same commit as the source edit; never a separate "compile the X" commit), through `superpowers:writing-skills` (RED baseline, then the edit, then GREEN)
- Modify: `lib/skills/README.md` (the seam shape and the lock), `plugins/mattstack/.claude-plugin/plugin.json` (version bump)
- Regenerate: every compiled skill in `plugins/mattstack` (`rt skills compile` for the plugin)
- Test: the `plugin-mattstack` CI job's checks locally: `rt skills check --strict` on the plugin and the mcp-tools reference diff

- [ ] **Step 1: Run the writing-skills RED baseline** on a subagent asked to fix a pack fill, and record whether it commits the recompile separately.
- [ ] **Step 2: Edit the skill, then run GREEN.** Expected: the recompile lands in the same commit.
- [ ] **Step 3: Recompile the plugin, bump its version and update the README.**
- [ ] **Step 4: Run `bun cli.ts skills check --strict` against the plugin.** Expected: clean, and `git diff --stat` shows the plugin's compiled files lost their version stamps once, as expected for this one migration commit.
- [ ] **Step 5: Commit** `mattstack: recompile without version stamps; recompile with the edit`.
