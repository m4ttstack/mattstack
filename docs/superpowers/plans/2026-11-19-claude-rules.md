# Shared Claude Code Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every mattstack Mac loads mattstack's shared Claude Code rules, plus its org's published base-pack and active-team-pack rules, through one link per Claude config dir.

**Architecture:** One reconcile function owns `~/.mattstack/claude/rules/`: a `mattstack` link into the mattstack marketplace clone, one folder per pack written from the org's data branch, and a `rules/mattstack` link in each Claude config dir. Three callers run it: a new update-safe setup step `claude.rules`, a daemon org-pull hook, and `rt team use`.

**Tech Stack:** Bun, TypeScript, `bun:test`, the setup `Probes` seam (`lib/setup/probes.ts`).

**Spec:** `docs/superpowers/specs/2026-11-19-claude-rules-design.md`

## Global Constraints

- `~/.mattstack/claude/rules/` is the managed folder; each config dir's link is `<config dir>/rules/mattstack`.
- The mattstack entry is named `mattstack`; pack entries are `<org>-<pack>` (pack = base pack folder name or team name).
- Pack rules are read at `generatedMarketplaceRef(p, cloneDir)` only, never the working tree; only `*.md` files are copied.
- A pack entry is swapped in whole: write a temp folder beside it, then `p.rename` over the entry.
- A marketplace location outside `p.home`, or with no `plugins/mattstack/rules/`, means no `mattstack` entry; say why in the result.
- Never touch an entry in a config dir's `rules/` other than `mattstack`, and leave a `rules/mattstack` rt did not make alone.
- Config dirs: `distinctConfigDirs(claudeConfigDirs(p, cswapConfigDirs(p)))` (move `distinctConfigDirs` out of `org-folder-marketplace.ts` to share it).
- One org per Mac (`discoverOrgs(p)`); the team pack is the active team's (`activeTeamFor(p, org).team`); every base pack under `mattstack/org/packs/` counts.
- Shipped rule text names no person ("Matt", "the operator"), no personal path, and passes `scripts/repo-purity.sh`.
- Any change under `plugins/mattstack` bumps `plugins/mattstack/.claude-plugin/plugin.json`'s version.
- Run tests from the worktree root; run only the targeted files locally.

## Review Focus

1. A `rules/mattstack` that already exists as a real folder or a link elsewhere: left alone, reported as foreign, never deleted.
2. The data branch has no `rules/` for a pack whose working tree has one (an admin's unpublished edit): no entry is written.
3. A pack that stops publishing `rules/`, or a team switch: the stale `<org>-<old>` entry is removed, and no other entry is touched.
4. `known_marketplaces.json` missing or unparsable, or no `mattstack` marketplace: the step still links the folder and writes pack entries; only `mattstack` is skipped.
5. Re-running on a correct Mac changes nothing (no rename, no relink); the result reports every part as `ok`.

---

## File Structure

- Create `lib/claude-rules/paths.ts`: folder and entry names, marketplace location lookup.
- Create `lib/claude-rules/packs.ts`: which packs a member gets, reading a pack's `rules/` at the data ref, writing an entry.
- Create `lib/claude-rules/reconcile.ts`: the one reconcile function the three callers share.
- Create `lib/setup/steps/claude-rules.ts`: the `claude.rules` StepDef.
- Create `lib/daemon/claude-rules-pull-hook.ts`: the pull hook.
- Create `plugins/mattstack/rules/*.md`: the shipped rules.
- Modify: `lib/setup/contract.ts`, `lib/setup/run-phases.ts`, `lib/setup/steps/index.ts`, `lib/setup/__tests__/update-safe.test.ts`, `lib/setup/steps/org-folder-marketplace.ts`, `lib/daemon/team-pull-hooks.ts`, `commands/team.ts`, `lib/setup/uninstall.ts`.
- Tests under each folder's `__tests__/`.

### Task 1: Paths, marketplace lookup and config-dir links

**Files:**
- Create: `lib/claude-rules/paths.ts`
- Modify: `lib/setup/steps/org-folder-marketplace.ts` (export `distinctConfigDirs` from a shared spot; keep behaviour)
- Test: `lib/claude-rules/__tests__/paths.test.ts`

**Interfaces:**
- Produces:
  - `claudeRulesDir(home: string): string` → `join(home, ".mattstack", "claude", "rules")`
  - `packEntryName(org: string, pack: string): string` → `` `${org}-${pack}` ``
  - `mattstackRulesSource(p: Pick<Probes, "readFile" | "exists" | "home">, configDir: string): { path: string } | { skipped: string }` reads `<configDir>/plugins/known_marketplaces.json`, takes `mattstack.installLocation`, returns `join(loc, "plugins", "mattstack", "rules")`.
  - `linkConfigDir(p: Probes, configDir: string, target: string): "created" | "ok" | "foreign"` makes `<configDir>/rules/mattstack` → `target` (mkdirp `<configDir>/rules` first).
  - `distinctConfigDirs(dirs: string[]): string[]` (moved, same behaviour).

- [ ] **Step 1: Write the failing tests**

Tests on a temp HOME with real `fakeProbes({ home })` (as `steps-b.test.ts` does):
- `mattstackRulesSource` returns the joined path for a `known_marketplaces.json` naming `mattstack` with an `installLocation` under home that has `plugins/mattstack/rules/`.
- returns `{ skipped }` when the file is missing, unparsable, has no `mattstack`, the location is outside home (e.g. `/private/tmp/x`), or `rules/` is absent; each `skipped` string is non-empty.
- `linkConfigDir` returns `"created"` on a fresh dir and the link resolves to the target; `"ok"` on a second call; `"foreign"` when `rules/mattstack` is a real folder or a link to elsewhere, and the existing entry is unchanged.

- [ ] **Step 2: Run** `bun test lib/claude-rules/__tests__/paths.test.ts` — Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `paths.ts`; move `distinctConfigDirs` here and import it back in `org-folder-marketplace.ts`.
- [ ] **Step 4: Run** the new test and `bun test lib/setup/__tests__/` files covering `org.folder` — Expected: PASS.
- [ ] **Step 5: Commit** `add lib/claude-rules/paths.ts: rules folder, marketplace lookup, config-dir link`

### Task 2: Pack entries from the data branch

**Files:**
- Create: `lib/claude-rules/packs.ts`
- Test: `lib/claude-rules/__tests__/packs.test.ts`

**Interfaces:**
- Consumes: `packEntryName`, `claudeRulesDir` (Task 1); `discoverOrgs` (`lib/setup/team-settings.ts`), `activeTeamFor` (`lib/team/active-team.ts`), `orgDirUnder` (`lib/rt-paths.ts`), `generatedMarketplaceRef` (`lib/setup/generated-marketplace.ts`).
- Produces:
  - `interface PackRulesSource { entry: string; cloneDir: string; ref: string; repoPath: string }` (`repoPath` is the pack's `rules` path inside the repo, e.g. `mattstack/teams/widgets/plugin/rules`)
  - `memberPackSources(p: Probes): PackRulesSource[]` every base pack under `mattstack/org/packs/` plus the active team's `mattstack/teams/<team>/plugin`, for the Mac's org; `[]` with no org.
  - `readPackRules(p: Probes, src: PackRulesSource): Promise<Map<string, string> | null>` `.md` file name → content at `ref`, via `git -C <cloneDir> ls-tree --name-only <ref> <repoPath>/` and `git show <ref>:<file>`; `null` when the ref has no such folder.
  - `writePackEntry(p: Probes, rulesDir: string, entry: string, files: Map<string, string>): "written" | "ok"` `"ok"` when the entry already holds exactly these files and contents; otherwise temp folder + `p.rename`.

- [ ] **Step 1: Write the failing tests** on a real temp git repo laid out as an org clone (data branch `mattstack`, marker with `dataBranch`):
- `memberPackSources` lists the base pack and the active team only, not another team folder present in the clone.
- `readPackRules` returns committed `.md` files and skips a `notes.txt`; returns `null` when `rules/` exists only in the working tree (Review Focus 2).
- `writePackEntry` returns `"written"` then `"ok"` for the same files; a changed file rewrites; a dropped file is gone after the rewrite.

- [ ] **Step 2: Run** `bun test lib/claude-rules/__tests__/packs.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `packs.ts`. Run git through `p.exec` with `LC_ALL=C`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `add lib/claude-rules/packs.ts: member pack rules read from the data branch`

### Task 3: The reconcile

**Files:**
- Create: `lib/claude-rules/reconcile.ts`
- Test: `lib/claude-rules/__tests__/reconcile.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2; `claudeConfigDirs` (`lib/setup/tools-install.ts`), `cswapConfigDirs` (`lib/cswap.ts`).
- Produces:
  - `interface ClaudeRulesResult { mattstack: "linked" | "ok" | { skipped: string }; packs: { entry: string; state: "written" | "ok" | "removed" }[]; links: { configDir: string; state: "created" | "ok" | "foreign" }[] }`
  - `reconcileClaudeRules(p: Probes): Promise<ClaudeRulesResult>` mkdirp the folder; point `mattstack` at `mattstackRulesSource` of the first config dir (remove a stale `mattstack` link when skipped); write each member pack entry that has rules; remove any other non-`mattstack` entry in the folder; link every distinct config dir.
  - `claudeRulesDetail(r: ClaudeRulesResult): string` one plain sentence for step details and logs, e.g. `Linked mattstack's rules and 1 pack into 1 Claude folder`, naming a skip reason or a foreign link when present.

- [ ] **Step 1: Write the failing tests**:
- fresh Mac: result `mattstack: "linked"`, one pack `"written"`, one link `"created"`; a file read through `~/.claude/rules/mattstack/<entry>/x.md` returns its content.
- second run: everything `"ok"` (Review Focus 5).
- team switch (change `mattstack.activeTeam` in the user store): old entry `"removed"`, new `"written"` (Review Focus 3).
- marketplace missing: `mattstack` is `{ skipped }`, packs and links still done (Review Focus 4).
- `CLAUDE_CONFIG_DIR` set to a second folder: two links.
- foreign `rules/mattstack`: link state `"foreign"`, folder untouched, other entries in `~/.claude/rules/` untouched (Review Focus 1).
- `claudeRulesDetail` for the fresh case equals the exact sentence above.

- [ ] **Step 2: Run** `bun test lib/claude-rules/__tests__/reconcile.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `reconcile.ts`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `add reconcileClaudeRules: one reconcile for the shared rules folder`

### Task 4: The `claude.rules` setup step

**Files:**
- Create: `lib/setup/steps/claude-rules.ts`
- Modify: `lib/setup/contract.ts` (add `"claude.rules"` to `STEP_IDS` right after `"plugins.install"`), `lib/setup/run-phases.ts` (`"claude.rules": { weight: 1, paused: "Couldn't set up Claude" }`), `lib/setup/steps/index.ts` (after `pluginsInstallStep`), `lib/setup/__tests__/update-safe.test.ts` (add after `"plugins.install"`)
- Test: `lib/setup/__tests__/steps-claude-rules.test.ts`

**Interfaces:**
- Consumes: `reconcileClaudeRules`, `claudeRulesDetail` (Task 3); `toFailedOutcome` (`lib/setup/steps/step-utils.ts`).
- Produces: `claudeRulesStep: StepDef` with `id: "claude.rules"`, `title: "Link the shared Claude rules"`, `kind: "rt"`, `updateSafe: true`, `applies: () => true`; run returns `{ state: "done", detail: claudeRulesDetail(r) }`, failures through `toFailedOutcome`.

- [ ] **Step 1: Write the failing test**: the step on a fresh temp HOME returns `done` with the Task 3 sentence; `update-safe.test.ts` expects the new id in order.
- [ ] **Step 2: Run** both files — Expected: FAIL.
- [ ] **Step 3: Implement** and register the step.
- [ ] **Step 4: Run** the two files plus `bun test commands/__tests__/setup-copy.test.ts`. If its snapshot differs only by the new step's title and paused copy, update with `--update-snapshots` and check the diff shows nothing else.
- [ ] **Step 5: Commit** `setup: add claude.rules step, update-safe, after plugins.install`

### Task 5: Daemon pull hook and `rt team use`

**Files:**
- Create: `lib/daemon/claude-rules-pull-hook.ts`
- Modify: `lib/daemon/team-pull-hooks.ts` (add `claudeRules` maker; run it after `render`, before `toolNotices`), `commands/team.ts` (after `useTeam` returns, call `reconcileClaudeRules(createRealProbes())`; a failure logs through `warn` and never fails the verb)
- Test: `lib/daemon/__tests__/claude-rules-pull-hook.test.ts`, the existing `team-pull-hooks` test

**Interfaces:**
- Consumes: `reconcileClaudeRules`, `claudeRulesDetail`.
- Produces: `createClaudeRulesPullHook(deps: { log: Pick<Logger, "debug" | "info" | "warn">; probes?: Probes; reconcile?: typeof reconcileClaudeRules }): (slug: string) => Promise<void>`. Never throws; logs `info` when any pack state is `written` or `removed`, else `debug`; `warn` with `{ err }` on a throw.

- [ ] **Step 1: Write the failing tests**: the hook calls the injected reconcile once per call; a throwing reconcile is logged at `warn` and the hook resolves; `teamPullHooks` returns five hooks with `claudeRules` fourth.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, following `materialize-pull-hook.ts`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `daemon: reconcile shared Claude rules after an org pull and on rt team use`

### Task 6: Uninstall removes rt's links

**Files:**
- Modify: `lib/setup/uninstall.ts` (in the `plugins.uninstall` action's run, for each distinct config dir remove `rules/mattstack` only when it is a link to `claudeRulesDir(home)`)
- Test: the existing uninstall test file for `plugins.uninstall`

**Interfaces:**
- Consumes: `claudeRulesDir`, `distinctConfigDirs` (Task 1).

- [ ] **Step 1: Write the failing test**: after the action, rt's link is gone; a foreign `rules/mattstack` stays.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** No new `UninstallActionId`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `uninstall: remove the shared Claude rules link rt made`

### Task 7: The shipped rules

**Files:**
- Create: `plugins/mattstack/rules/*.md`, one per row of the spec's "Rules that ship" table
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (version bump)
- Test: `lib/claude-rules/__tests__/shipped-rules.test.ts`

Content comes from the sources the spec's table names (Matt's `~/.claude/rules/*.md` and `~/.claude/CLAUDE.md` sections, readable on this Mac). Rewrite each for any member: "the user", never "Matt" or "the operator"; no personal paths or accounts; no model ids in the `/model` line (point at `mattstack:model-tiering`). Plain markdown, no frontmatter, a `#` title, short. Load `superpowers:writing-skills` as the writing guide.

- [ ] **Step 1: Write the failing test**: `plugins/mattstack/rules/` exists, holds only `.md` files, at least 16 of them, none contains `/\bMatt\b/`, `the operator`, `/Users/`, or `~/Documents`, and none starts with `---`.
- [ ] **Step 2: Run** `bun test lib/claude-rules/__tests__/shipped-rules.test.ts` — Expected: FAIL.
- [ ] **Step 3: Write the rule files** and bump the plugin version one past `main`'s.
- [ ] **Step 4: Run** the test and `scripts/repo-purity.sh` — Expected: PASS, `ok repo-purity`.
- [ ] **Step 5: Commit** `plugins/mattstack: ship the shared Claude rules`

### Task 8: Pack checks accept `rules/`, end-to-end check

**Files:**
- Modify (only if Step 1 refuses): the pack check that rejects the folder
- Test: whatever file covers that check

- [ ] **Step 1: Probe**: copy a fixture team pack under a temp HOME, add `rules/x.md`, run `env -i HOME=<temp> PATH="$PATH" bun cli.ts skills check --strict` against it. Expected: no error about `rules/`. If it errors, add `rules` to the allowed pack folders with a test, then rerun.
- [ ] **Step 2: End-to-end, on a scratch HOME under the real home folder** (e.g. `~/.mattstack/scratch/claude-rules-e2e`, never the real HOME itself): copy this worktree's `plugins/mattstack/rules/` into a marketplace folder inside the scratch HOME (a location outside it is skipped by design) and write a `.claude/plugins/known_marketplaces.json` there whose `mattstack.installLocation` is that folder, then run `env -i HOME=<scratch> PATH="$PATH" bun cli.ts setup apply --only claude.rules`. Expected: `cat <scratch>/.claude/rules/mattstack/mattstack/<any shipped rule>.md` prints the rule. (Claude Code following these links was proven with canary rules on 2026-11-19; the spec's table records it.)
- [ ] **Step 3: Commit** any check change: `skills check: accept a pack rules/ folder`

## After merge (Matt, by hand)

Delete from your `~/.claude/rules/` and `~/.claude/CLAUDE.md` everything the spec's table ships, so nothing loads twice.
