# Husk Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Team packs commit husk skills and sources only; each member's Mac renders the full skills into a local cache, and a mattstack mod tool, `load_skill`, hands an agent the rendered body as attached context.

**Architecture:** A whole-pack render (the existing compile, run in memory with team-level bindings) writes into `~/.mattstack/rt/rendered/...`, keyed by pack and mattstack version, triggered after a daemon pull, after setup installs, and on a miss. A hidden `rt skills render` verb serves the cache; the mattstack plugin's mod registers `load_skill`, which calls it. A pack that sets `"husks": true` compiles husks instead of bodies; `skills_resolve`, `check`, provenance and the views read rendered output from memory or the cache.

**Tech Stack:** Bun + TypeScript (rt CLI and daemon), Claude Code mod API (`plugins/mattstack/hooks/register.ts`), bun test.

**Spec:** `docs/superpowers/specs/2026-11-17-husk-skills-design.md` (RT-586). Read it before any task.

## Execution batches

Subagent-driven execution runs by batch, not by task: one implementer per
batch works through its tasks in order (committing after each), then one
reviewer reviews the batch's commits against this plan and the spec. A
whole-branch review follows Batch 3.

| Batch | Tasks | Review question |
| --- | --- | --- |
| 1. Render core | 1, 2, 3, 4 | Does a render produce the right tree, keyed and swapped safely? |
| 2. Serving and triggers | 5, 6, 7, 8 | Does a rendered tree reach an agent, from a pull to `load_skill`? |
| 3. Husk packs | 9, 10 | Does an opted-in pack commit only husks and check cleanly? |

Tasks 11 (end to end on real accounts) and 12 (skill updates through
`superpowers:writing-skills`) run inline in the controlling session after
the whole-branch review, since they need live sessions, not code review.

## Global Constraints

- Run every test from the worktree root (`bun test <path>`); bun reads `bunfig.toml` only from the cwd.
- Never run a built rt binary or the daemon against the real `~/.mattstack`; tests use temp HOMEs (`seedTwoVerbPack` and the existing fixtures).
- Context pieces: at most **99,000** characters each, split at line boundaries. Body limit for `check`: **200,000** characters.
- Render cache path: `~/.mattstack/rt/rendered/<org>/<plugin>/<pack version>/<mattstack version>/`, stamp file `render.json` `{ rtBuild, mattstack, inputHash }`.
- Pruning keeps **3** pack versions per plugin × **2** mattstack versions, and never the installed pack version's tree for the installed mattstack.
- Tool name: `mcp__mattstack__load_skill`. Husk opt-in key: `"husks": true` in a team pack's `pack/skills.jsonc`.
- Renders never read `~/.mattstack/user/skills/overrides.jsonc` or a member's `~/.mattstack/repos/<slug>/packs/<pack>/skills.jsonc`.
- An ordinary source edit never raises `pack/requires.json`; a mattstack bump alone changes no committed file in a husk pack.
- Every print goes through `lib/ui/out.ts`; failures throw `UserActionableError`; `--json` through `out.json`.
- The plugin change bumps `plugins/mattstack/.claude-plugin/plugin.json` and raises `plugins/mattstack/pack/requires.json` `minEngine` to the release that ships `rt skills render` (same value as `HUSKS_MIN_ENGINE`).
- Commit after each task. Comments only for constraints the code cannot show.

## Review Focus

1. A member whose installed pack lags the clone (pull landed, setup not yet run) keeps loading the existing tree for the installed version; nothing re-renders or refuses. Test in Task 4.
2. Two panes loading the same missing skill at once both get a whole tree, and the loser's temp folder is gone. Test in Task 4.
3. Claude Code's process environment has no `rt` on PATH; `load_skill` tries `~/.local/bin/rt` next and, failing both, denies with a sentence naming the fix. Test in Task 6.
4. A pack zone listing several projects renders with `projects[0]` every time, so the `--repo` key in run-start flags is stable across members. Test in Task 2.
5. Vendored scripts keep their executable bit in the cache, so `@key` paths run as before. Test in Task 3.

---

## Phase A: the release that renders (inert for packs that have not opted in)

### Task 1: Floor constant and lock field

**Files:**
- Modify: `lib/skills/team-params.ts` (beside `VERSIONLESS_IDS_MIN_ENGINE`, line 28)
- Modify: `lib/skills/compiled-lock.ts` (type at line 7, `serializeLock`, `mergeLock`, `readLock`)
- Test: `lib/skills/__tests__/compiled-lock.test.ts`

**Interfaces:**
- Produces: `export const HUSKS_MIN_ENGINE: string` (the version this PR bumps `plugins/mattstack/.claude-plugin/plugin.json` to); `CompiledLock.builtWith?: string`; `CompiledLock.sourcesHash?: string`.

- [ ] **Step 1: Write failing tests** `readLock` round-trips `builtWith` and `sourcesHash`; a lock without them reads both as `undefined`; `serializeLock` omits a key that is undefined; `mergeLock(current, compiled)` keeps `current`'s value for either field when `compiled`'s is undefined.
- [ ] **Step 2: Run** `bun test lib/skills/__tests__/compiled-lock.test.ts` — expect FAIL on the new cases.
- [ ] **Step 3: Implement** the optional field through read, merge and serialize; add `HUSKS_MIN_ENGINE`.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `skills: HUSKS_MIN_ENGINE and the lock's builtWith field`.

### Task 2: Team-level bindings for a render

**Files:**
- Modify: `lib/skills/materialize.ts` (extract the merge in `materializePack`, line 78)
- Test: `lib/skills/__tests__/materialize.test.ts`

**Interfaces:**
- Consumes: `readZonesFrom` (`lib/skills/init.ts:180`), `parseRemote` (`lib/skills/init.ts:30`), `mergeLayers`/`renderManifest` (`lib/skills/manifest-merge.ts`).
- Produces: `export function teamBindings(deps: MaterializeDeps, zone: ZoneInfo, pack: string): { text: string; repoKey: string } | { error: string }` — merges engine defaults, the base layer and the pack's own fragment, never the override layer; `repoKey` is `parseRemote(\`https://${zone.host}/${zone.projects[0]}\`).slug`. `materializePack` calls it for the shared merge, then adds the override layer as today.

- [ ] **Step 1: Write failing tests** `teamBindings ignores overrides.jsonc` (seed an overrides file binding a slot; the text lacks it); `teamBindings needs no registered repo` (no `repos/` dir; returns text); `teamBindings uses projects[0]` (zone with two projects; `repoKey` matches the first project's slug on both calls); `teamBindings reports a zone with no projects` as `{ error }`.
- [ ] **Step 2: Run** `bun test lib/skills/__tests__/materialize.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `teamBindings` and make `materializePack` reuse it; existing materialize tests stay green.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `skills: team-level bindings without personal overrides`.

### Task 3: Render a whole pack into any folder

**Files:**
- Modify: `commands/skills.ts` (`Flags` line 215, `resolve` line 641, `performCompile` line 1337, `writeCompiledVerb` line 995)
- Create: `lib/skills/render.ts`
- Test: `lib/skills/__tests__/render.test.ts`

**Interfaces:**
- Consumes: `teamBindings` (Task 2).
- Produces:
  - `Flags.manifestText?: string` and `Flags.repoKey?: string`: when set, `resolve` uses them instead of `findDefaultManifest`/`manifestRepoKey`.
  - `export async function renderPackInto(opts: { packDir: string; manifestText: string; repoKey: string; outRoot: string; mattstackDir?: string }): Promise<{ ok: true; mattstack: string } | { ok: false; errors: string[] }>` in `commands/skills.ts`: runs `performCompile` with every target and writes compiled targets, emits (base copies), doors and `compiled.json` maps under `outRoot` with the same relative paths a compile writes in the pack. `mattstack` is the engine plugin version `resolvePluginRoots` chose.
  - `export function inputHash(packDir: string, baseDir: string | null, manifestText: string): string` in `lib/skills/render.ts`: sha256 over sorted relative paths and contents of the pack's source files (fills, hand-written skills, `pack/` minus the lock), the base pack's sources, and `manifestText`.

- [ ] **Step 1: Write failing tests** `renderPackInto writes what compile writes` (two-verb fixture from `seedTwoVerbPack`: compile into the pack, render into a temp `outRoot`, every file under the pack's `skills/` and `attachments/` equals the rendered one byte for byte); `renderPackInto keeps the executable bit` (a vendored `scripts/x.sh` with mode 0755 stays 0755); `renderPackInto leaves the pack untouched` (pack tree hash before equals after); `inputHash changes when a fill changes and not when the lock changes`.
- [ ] **Step 2: Run** `bun test lib/skills/__tests__/render.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `outRoot` as a parameter threaded through `performCompile`'s write loop and `writeCompiledVerb` (default: the pack dir, so compile is unchanged), plus `renderPackInto` and `inputHash`. Use `copyFileSync` then `chmodSync` with the source mode for `copyFrom` files.
- [ ] **Step 4: Run** the same command plus `bun test commands/__tests__/skills-compile-output.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `skills: render a whole pack into any folder`.

### Task 4: The render cache

**Files:**
- Create: `lib/skills/render-cache.ts`
- Test: `lib/skills/__tests__/render-cache.test.ts`

**Interfaces:**
- Consumes: `renderPackInto`, `inputHash` (Task 3); `teamBindings` (Task 2).
- Produces:
  - `export type RenderStamp = { rtBuild: string; mattstack: string; inputHash: string }`
  - `export function treeDir(root: string, org: string, plugin: string, packVersion: string, mattstack: string): string`
  - `export type EnsureResult = { ok: true; dir: string; stamp: RenderStamp; rendered: boolean } | { ok: false; reason: "missing" | "render-failed"; message: string; builtWith?: string }`
  - `export async function ensureTree(opts: { root: string; zone: ZoneInfo; pack: string; installedVersion: string; mattstack: string; rtBuild: string; deps: MaterializeDeps }): Promise<EnsureResult>` — the clone's pack version is read from the zone's pack `plugin.json`. When it equals `installedVersion`: render when the tree is missing or its stamp's `rtBuild` or `inputHash` differs. When it does not: an existing tree is returned as is; a missing one is `{ ok: false, reason: "missing" }`.
  - `export function pruneTrees(root: string, org: string, plugin: string, keep: { installedVersion: string; mattstack: string }): void`.

- [ ] **Step 1: Write failing tests**
  - `renders a missing tree when the clone holds the installed version`
  - `re-renders when inputHash differs` and `re-renders when rtBuild differs`
  - `uses an existing tree as is when the clone is ahead` (clone at N+1, tree for N with a stale hash: returned, `rendered: false`)
  - `reports missing when the clone is ahead and no tree exists`
  - `two concurrent ensureTree calls both return a whole tree and leave no temp folder` (start both, await both; one `rendered: true`; no `*.tmp-*` siblings)
  - `render-failed carries builtWith from the pack lock`
  - `pruneTrees keeps 3 pack versions × 2 mattstack versions and the installed pair`
- [ ] **Step 2: Run** `bun test lib/skills/__tests__/render-cache.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** with a temp sibling `<tree>.tmp-<pid>-<random>`, `renameSync` into place, and on `EEXIST`/`ENOTEMPTY` delete the temp and read the winner's stamp.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `skills: render cache with stamps, atomic swap and pruning`.

### Task 5: `rt skills render`

**Files:**
- Create: `commands/skills-render.ts`
- Modify: `lib/command-tree-def.ts` (under `skills.subcommands`, line 2606, `hidden: true`)
- Test: `commands/__tests__/skills-render.test.ts`

**Interfaces:**
- Consumes: `ensureTree`, `pruneTrees`, `treeDir` (Task 4).
- Produces: `export async function skillsRender(args: string[]): Promise<void>` for `rt skills render <plugin>:<unit> --dir <skill dir> [--file <rel>] --json`. The installed pack version is the `<version>` segment of `--dir` under `<cache>/<market>/<plugin>/<version>/`; the zone is the org zone whose pack `plugin.json` name is `<plugin>`. `--json` envelope: `{ ok: true, id, packVersion, mattstack, rtBuild, treeDir, path, body }` where `path` is the rendered file (default `<unit dir>/SKILL.md`) and `body` its text. Failures throw `UserActionableError`: missing tree → "<plugin> <version> isn't rendered on this Mac." with `next: "rt setup"`; render failed with `builtWith` newer than the installed mattstack → "<plugin> was built with mattstack <builtWith>; this Mac has <mattstack>." with `next: "rt setup"`; other render failures carry the compile errors in `log`.

- [ ] **Step 1: Write failing tests** (temp HOME, fake plugin cache and org clone built from the Task 3 fixture): `prints the rendered SKILL.md for a stage and for a verb`; `--file returns a references file`; `missing tree when the clone is ahead`; `names builtWith when the engine is older`; `--json envelope keys are exactly` the list above.
- [ ] **Step 2: Run** `bun test commands/__tests__/skills-render.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the verb and its hidden tree entry; prune after a render.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `skills: hidden rt skills render verb`.

### Task 6: The `load_skill` mod tool

**Files:**
- Create: `plugins/mattstack/hooks/load-skill.ts`
- Modify: `plugins/mattstack/hooks/register.ts` (add `loadSkill.register(on, options)` beside `enterWorktreeCheck`)
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (version bump), `plugins/mattstack/pack/requires.json` (`minEngine` = `HUSKS_MIN_ENGINE`)
- Test: `plugins/mattstack/hooks/load-skill.test.ts`

**Interfaces:**
- Consumes: `rt skills render --json` (Task 5).
- Produces: `export function splitPieces(text: string, max = 99_000): string[]` (line boundaries; a single line longer than `max` is split at `max`); `export const register: Register`. On `session.start` it calls `$.tool.register({ name: 'load_skill', isDeferred: false, description, inputSchema: { skill: string, dir: string } })` the way `mods/human-todos/src/contract.ts` does; `tool.check` on `mcp__mattstack__load_skill` answers allow; `tool.call` runs `[rt, 'skills', 'render', skill, '--dir', dir, '--json']` for `rt` in `['rt', \`${home}/.local/bin/rt\`]` (as `enter-worktree-check.ts` does, `timeoutMs: 60_000`), and returns `{ result: \`Loaded ${id} (pack ${packVersion}, mattstack ${mattstack}): ${n} characters in ${k} parts\`, context: splitPieces(body) }`, or `{ deny: <the envelope's error sentence and next> }`.

- [ ] **Step 1: Write failing tests** `splitPieces` (200,001 characters of 100-char lines → 3 pieces, each ≤ 99,000, joined equals input; a 150,000-char single line → 2 pieces); `tool.call returns result and context` with a fake `$.process.run` printing a render envelope; `falls back to ~/.local/bin/rt when rt is missing`; `denies naming the fix when both rts fail`; `denies with the envelope's sentence on ok:false`.
- [ ] **Step 2: Run** `claude plugin test plugins/mattstack` (and `bun test plugins/mattstack/hooks/load-skill.test.ts` if the existing hook tests run under bun) — expect FAIL.
- [ ] **Step 3: Implement** the module and register it; bump the plugin version and the floor.
- [ ] **Step 4: Run** `claude plugin validate plugins/mattstack` and the tests — expect PASS, no validation errors.
- [ ] **Step 5: Commit** `mattstack: load_skill mod tool`.

### Task 7: `skills_resolve` and provenance read the cache

**Files:**
- Modify: `lib/skills/resolve.ts` (`pluginUnit` line 160, `targetPath` line 206)
- Modify: `lib/runs/installed-provenance.ts` (`lockedMattstack` line 76)
- Test: `lib/skills/__tests__/resolve.test.ts`, `lib/runs/__tests__/installed-provenance.test.ts`

**Interfaces:**
- Consumes: `treeDir`, `RenderStamp` (Task 4).
- Produces: `pluginUnit` reads `compiled.json` from the plugin copy first; when the plugin copy's unit has none and the pack's `pack/skills.jsonc` sets `husks: true`, it reads the unit from the newest render tree for that plugin version under `~/.mattstack/rt/rendered/<org>/<plugin>/<version>/`, and `bound` becomes that tree dir. No tree → refuse with "Load the skill first: call mcp__mattstack__load_skill." `lockedMattstack` returns the render stamp's `mattstack` (and `rtBuild` as a token) when the skill dir's pack is a husk pack.

- [ ] **Step 1: Write failing tests** `resolves a husk pack's keys into the render tree`; `refuses a key outside the render tree`; `refuses with the load-first sentence when no tree exists`; `non-husk packs resolve as before`; provenance `reads the render stamp for a husk pack`.
- [ ] **Step 2: Run** `bun test lib/skills/__tests__/resolve.test.ts lib/runs/__tests__/installed-provenance.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** using `lib/skills/__tests__/resolve-fs.ts`'s fake fs shape for reads.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `skills: resolver and provenance read the render cache`.

### Task 8: Render triggers (pull and install)

**Files:**
- Create: `lib/skills/render-packs.ts`, `lib/daemon/render-pull-hook.ts`
- Modify: `lib/daemon.ts` (`composePullHooks` list, line ~1251: after `createMaterializePullHook`), `lib/setup/steps/plugins.ts` (after line 565)
- Test: `lib/skills/__tests__/render-packs.test.ts`, `lib/daemon/__tests__/render-pull-hook.test.ts`

**Interfaces:**
- Consumes: `ensureTree`, `pruneTrees` (Task 4); `teamBindings` (Task 2).
- Produces: `export async function renderHuskPacks(p: Probes, opts: { org?: string }): Promise<{ pack: string; ok: boolean; detail: string }[]>` — for each zone pack with `husks: true`, `ensureTree` at the clone's pack version with the installed mattstack; never throws. `createRenderPullHook(deps: { log; render? }): (slug: string) => Promise<void>` lazy-imports `render-packs.ts` (the `no-eager-tui` rule, as `materialize-pull-hook.ts` does), logs failures at `warn` with pack and reason.

- [ ] **Step 1: Write failing tests** `renders only husk packs`; `an unchanged pack costs one hash and no render`; `a failure is reported, never thrown`; the hook `runs after materialize` (order in the composed list) and `never throws`; the setup step `includes the render detail`.
- [ ] **Step 2: Run** `bun test lib/skills/__tests__/render-packs.test.ts lib/daemon/__tests__/render-pull-hook.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** and wire both call sites.
- [ ] **Step 4: Run** the same command plus `bun test lib/setup/__tests__/update-safe.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `skills: render husk packs after a pull and after install`.

## Phase B: packs that opt in compile husks

### Task 9: Husk compile, lock and floor

**Files:**
- Create: `lib/skills/husk.ts`
- Modify: `commands/skills.ts` (`performCompile` write loop, `compiledLockOf` line 1283, `floorWrite` line 1250), `lib/skills/base-attachments.ts` (`doorFor` line 154)
- Test: `lib/skills/__tests__/husk.test.ts`, `commands/__tests__/skills-floor.test.ts`, `commands/__tests__/skills-compile-output.test.ts`

**Interfaces:**
- Consumes: `HUSKS_MIN_ENGINE`, `CompiledLock.builtWith` (Task 1); `inputHash` (Task 3).
- Produces:
  - `export function huskFor(compiledSkillMd: string, id: string): string` — keeps the frontmatter, adds `mcp__mattstack__load_skill` to `allowed-tools`, and sets the body to the spec's husk text with `id`.
  - With `husks: true`, compile writes `huskFor(...)` as each target's `SKILL.md` and each door's `SKILL.md` (the base unit's id), and writes nothing else for those targets; it removes `references/`, `parts/`, `scripts/`, `compiled.json` and base-copy folders from the pack.
  - `compiledLockOf` for a husk pack: `targets: {}`, `bases` as today, `builtWith` set to the engine version and `sourcesHash` to `inputHash(packDir, baseDir, "")` when the opt-in compile runs or when that hash differs from the lock's `sourcesHash`; otherwise both are carried from the current lock.
  - `floorWrite` for a husk pack: `max(HUSKS_MIN_ENGINE, team markers, pointer keys)`; it does not copy the engine plugin's own floor.

- [ ] **Step 1: Write failing tests**
  - `huskFor keeps frontmatter and adds the tool`
  - `a husk pack commits only husks` (fixture with `husks: true`: no `references/`, `parts/`, `scripts/`, `compiled.json` under `skills/` or `attachments/`)
  - `a door becomes a husk for its base unit`
  - `an ordinary fill edit leaves pack/requires.json unchanged`
  - `a mattstack version bump changes no committed file in a husk pack` (compile, bump the fixture engine version, compile again, `git status --porcelain` empty)
  - `builtWith moves only when a source changes`
- [ ] **Step 2: Run** `bun test lib/skills/__tests__/husk.test.ts commands/__tests__/skills-floor.test.ts commands/__tests__/skills-compile-output.test.ts` — expect FAIL on the new cases.
- [ ] **Step 3: Implement**; non-husk packs compile byte for byte as before.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `skills: husk packs compile husks, a quiet lock and a rule-based floor`.

### Task 10: `check`, views and the board for husk packs

**Files:**
- Modify: `commands/skills.ts` (`computeCheck` line 1895, `closedViewFiles` line 874), `lib/skills/unit-maps.ts` (leftover-token check, line ~325), `lib/skills/anatomy.ts`, `lib/skills/blocks/payload.ts`
- Modify (only if Step 1's board test fails): `apps/board/src/herdr.ts` (`dispatchPrompt`, line ~350)
- Test: `commands/__tests__/skills-check-strict.test.ts`, `commands/__tests__/skills-husk-check.test.ts` (new), `apps/board/src/herdr.test.ts`

**Interfaces:**
- Consumes: `renderPackInto` (Task 3) into a temp dir for in-memory checks.
- Produces: for a husk pack, `check` compares husks, lock and floor against a compile; renders the whole pack to a temp dir and reports `body-too-large` (a `SKILL.md` over 200,000 characters), `leftover-token` on any rendered file, and `husk-tool-path` (a husk `allowed-tools` rule naming `${CLAUDE_SKILL_DIR}/scripts/`, `/references/`, or `/parts/`). `closedViewFiles`/anatomy/blocks build sibling maps from a whole-pack render of the working tree, never the cache.

- [ ] **Step 1: Write failing tests** `check fails a rendered body over 200,000 characters`; `check fails a leftover token in a rendered references file`; `check fails a husk rule naming ${CLAUDE_SKILL_DIR}/scripts/`; `check passes a clean husk pack`; `anatomy shows uncommitted edits in a husk pack`; board `dispatchPrompt hands a husk path and still throws SkillBindError when the skill does not resolve`.
- [ ] **Step 2: Run** `bun test commands/__tests__/skills-husk-check.test.ts commands/__tests__/skills-check-strict.test.ts` and `bun run board:test` — expect FAIL on the new cases.
- [ ] **Step 3: Implement**; the board keeps passing the husk path (the agent follows its line), so change it only if its test shows otherwise.
- [ ] **Step 4: Run** the same commands — expect PASS.
- [ ] **Step 5: Commit** `skills: check, views and board dispatch for husk packs`.

### Task 11: End-to-end proof on real accounts

**Files:**
- Create: `docs/superpowers/plans/2026-11-17-husk-skills-e2e.md` (the run log: commands, accounts, results)

**Interfaces:**
- Consumes: everything above, run from this worktree through `--plugin-dir plugins/mattstack` and a scratch copy of the widgets pack with `husks: true` compiled by this worktree's `bun cli.ts`.

- [ ] **Step 1:** In a scratch org copy (never the live org clone), set `husks: true` on widgets, compile with `bun cli.ts skills compile --pack-dir <scratch pack>`, and confirm the pack's `git status` shows only husks, the lock and `requires.json`.
- [ ] **Step 2:** Personal account, `claude -p --model sonnet --plugin-dir plugins/mattstack --plugin-dir <scratch pack>`: load `ship`, `stage-evidence` and `review`; each run quotes probe lines at 20/45/70/97% word for word and names the same first action as today's committed body.
- [ ] **Step 3:** Enterprise account through a herdr pane (`rt agent start --account <enterprise account> ... --extra-args "--plugin-dir ..."`): repeat Step 2 for `ship`; expect no "skipped" notice for the mattstack mod.
- [ ] **Step 4:** A subagent handed a husk path loads it through `load_skill` (one Sonnet run whose prompt spawns a subagent to load `stage-evidence`).
- [ ] **Step 5:** Record results in the run log and commit `husks: end-to-end proof on personal and enterprise accounts`.

## Phase C: teach it

### Task 12: Skill and doc updates

**Files:**
- Modify: `plugins/mattstack/plugin/skills/editing-skills/SKILL.md`, the extending-a-pack and creating-a-pack skill sources under `plugins/mattstack/`, `lib/skills/README.md`, `plugins/mattstack/.claude-plugin/plugin.json` (version bump)

- [ ] **Step 1:** Load `superpowers:writing-skills` and `mattstack:editing-skills`; run a RED baseline: a fresh agent asked "a husk pack's capture-evidence rule changed; how do you check it landed?" on the current skill.
- [ ] **Step 2:** Edit: husk packs commit husks and sources; members render on pull; check a change with `rt skills render` or the render cache, not committed bodies; `{{pack.path}}` resolves into the render cache; "Read the compiled output in full" reads `rt skills render` output; sync commits no bodies.
- [ ] **Step 3:** GREEN: the same scenario on a fresh agent answers from the new text with no shell call a tool covers.
- [ ] **Step 4:** `sh plugins/mattstack/tests/certify.sh <each edited skill folder>` — expect no `FAIL` lines.
- [ ] **Step 5: Commit** `skills: teach husk packs in editing-skills and friends`.

## After merge (not part of this PR)

- Release; then trim widgets `review` under 200,000 characters and opt widgets and gadgets in (`"husks": true`), each through the editing-skills pipeline in the org clone.
