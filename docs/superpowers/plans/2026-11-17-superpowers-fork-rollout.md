# Superpowers Fork Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every mattstack Mac installs Matt's superpowers fork as `superpowers@mattstack`, swaps out stock superpowers once, and defaults plans to Native with reviews.

**Architecture:** A marketplace entry pins the fork by sha. `rt setup`'s baseline names `superpowers@mattstack`; a one-time setup migration disables the stock copies and records what it disabled so `rt uninstall` can turn them back on. A new `superpowers.execution` setting drives a mattstack SessionStart hook that tells agents the default execution mode.

**Tech Stack:** Bun/TypeScript (rt), sh hooks, zod settings schemas, the console's settings groups.

**Spec:** `docs/superpowers/specs/2026-11-17-superpowers-fork-rollout-design.md`

## Global Constraints

- Plugin id is `superpowers@mattstack`; skill names stay `superpowers:*`.
- Superseded ids, exactly: `superpowers@claude-plugins-official`, `superpowers@superpowers-marketplace`. Never a name match.
- The swap is once per Mac (a `MigrationDef`); `plugins.install` itself never disables anything; a user who re-enables a stock copy is left alone.
- Disables run `claude plugin disable <id>` at user scope in each config dir; rt edits no settings file.
- Setting key `superpowers.execution`: scopes `["user", "team"]`, `merge: "replace"`, default `"native-with-reviews"`, values `native-with-reviews | subagent-driven | native | ask`.
- Hook line, verbatim apart from `<mode>`: `When a superpowers plan is ready to execute, use <mode> without asking which execution approach; use subagent-driven instead when the user asks for it or the plan is long enough to compact mid-run.` Mode names in the line: `Native with reviews (superpowers:executing-plans, Native with reviews variant)`, `subagent-driven (superpowers:subagent-driven-development)`, `Native (superpowers:executing-plans)`. For `subagent-driven` the sentence ends after "approach".
- Marketplace entry: `url` `https://github.com/m4ttstack/superpowers.git`, `ref` `mattstack`, `sha` `4e49c04aba058d593eaa02e9de3d70c030ab6973`.
- No mattstack ticket ids in anything pushed to m4ttstack/superpowers or obra/superpowers.
- Run `bun test` from the repo root; targeted tests only (Matt's rule for this repo), CI runs the rest.

## Review Focus

1. A Mac where the user already disabled stock superpowers: the migration changes nothing and records `skipped`, never re-enables or nags. Pinned in Task 4.
2. cswap Macs with several config dirs, stock copies enabled in some: each dir is handled and recorded separately. Pinned in Task 4.
3. `claude plugin list` failing or Claude Code missing: missing is `skipped`; a failed list is `failed` (unrecorded, retried next launch), never a crash. Pinned in Task 4.
4. Uninstall after the user removed a stock copy themselves: re-enable "not found" is a note, not a failed uninstall. Pinned in Task 5.
5. The hook on a Mac with the fork disabled, or with `ask`: prints nothing. Pinned in Task 6.

---

### Task 1: The `superpowers.execution` setting

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (claude block, after `claude.plugins`)
- Modify: `packages/rt-client/src/settings/registry-schemas.ts`
- Modify: `packages/rt-client/src/settings/__tests__/schema-examples.ts`
- Modify: `apps/console/src/app/settings/groups.ts:149` (add `superpowers` to the suite group's prefix regex)
- Regenerate: `packages/rt-client/src/settings/schema.lock.json` (`bun run cli.ts settings schema lock`)
- Test: `packages/rt-client/src/settings/__tests__/` existing `registry-console-ready.test.ts`, `schema-examples.test.ts`; `apps/console` `groups.test.ts`

**Interfaces:**
- Produces: `getSetting<"native-with-reviews" | "subagent-driven" | "native" | "ask">("superpowers.execution").value`, and `rt settings get superpowers.execution`.

- [ ] **Step 1: Add the examples first** in `schema-examples.ts`: `"superpowers.execution": { good: ["native-with-reviews", "ask"], bad: [{ value: "fast", path: [] }] }`.
- [ ] **Step 2: Run** `bun test packages/rt-client/src/settings/__tests__/schema-examples.test.ts` — Expected: FAIL (no schema / unregistered key).
- [ ] **Step 3: Register the row** (description: "Which superpowers execution mode plans use without asking; `ask` keeps the three-option question."), the zod `z.enum([...])` schema, the console regex change, and regenerate the lock.
- [ ] **Step 4: Run** `bun test packages/rt-client/src/settings/__tests__/schema-examples.test.ts packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts` and `bun run console:test -- groups` (or the console's own vitest for `groups.test.ts`) — Expected: PASS.
- [ ] **Step 5: Commit** `settings: superpowers.execution picks the default plan execution mode`

### Task 2: Baseline names the fork; stock copies are superseded

**Files:**
- Modify: `lib/setup/base-plugins.ts`
- Modify: `lib/setup/steps/plugins.ts` (`computePlugins`)
- Test: `lib/setup/__tests__/steps-c.test.ts`, new `lib/setup/__tests__/base-plugins.test.ts`

**Interfaces:**
- Produces: `BASE_PLUGINS` containing `"superpowers@mattstack"` (in place of the stock id); `export const SUPERSEDED_PLUGINS: Readonly<Record<string, string>>` mapping each superseded id to `"superpowers@mattstack"`; `isSuperseded(id: string): boolean`. `BASE_PLUGIN_ALTERNATES` loses its superpowers entry (keep the mechanism; it may be empty).

- [ ] **Step 1: Write failing tests.** `base-plugins.test.ts`: `BASE_PLUGINS` includes `superpowers@mattstack` and not `superpowers@claude-plugins-official`; `isSuperseded("superpowers@superpowers-marketplace")` is true; `isSuperseded("superpowers@superpowers-pinned")` is false; `resolveBasePlugin("superpowers@mattstack", id => id === "superpowers@claude-plugins-official")` returns `"superpowers@mattstack"`. In `steps-c.test.ts`: a `claude.plugins` setting listing `superpowers@claude-plugins-official` at team scope yields neither `trusted` nor `teamAuthored` containing it, and `ctx.log` receives one line containing `superpowers@claude-plugins-official` and `superpowers@mattstack`.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/base-plugins.test.ts lib/setup/__tests__/steps-c.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the list change, `SUPERSEDED_PLUGINS`/`isSuperseded`, and the skip in `computePlugins` (filter `named` before splitting own/shared; log `claude.plugins: skipped <id>; mattstack installs <replacement> instead`).
- [ ] **Step 4: Run** the same tests — Expected: PASS.
- [ ] **Step 5: Commit** `setup: baseline installs superpowers@mattstack; stock superpowers ids are superseded`

### Task 3: `tool.plugins` warns about a second superpowers

**Files:**
- Modify: `lib/setup/validators/tools.ts` (`pluginsRow`)
- Test: `lib/setup/__tests__/validators-tools.test.ts`

**Interfaces:**
- Consumes: `BASE_PLUGINS` from Task 2.

- [ ] **Step 1: Write failing tests.** A plugin list with every baseline id enabled plus `superpowers@claude-plugins-official` enabled → status `needs-you`, detail contains both `superpowers@mattstack` and `superpowers@claude-plugins-official`, action type `steps` whose text includes `claude plugin disable superpowers@claude-plugins-official`. Same list with the stock copy `enabled: false` → `ready`. Any other enabled `superpowers@x` (e.g. `superpowers@superpowers-pinned`) → the same `needs-you`.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/validators-tools.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** after the existing missing/disabled checks: enabled ids matching `/^superpowers@/` other than `superpowers@mattstack` → `needs-you` with detail `Two superpowers plugins are enabled (<ids>); the superpowers:* skills may come from either` and a `steps` action listing one disable command per extra id. (Detection here is display-only, so a pattern is fine; the migration's action list stays explicit.) Add a sentence that a project- or managed-scope enable cannot be changed by rt, only when the extra id's scope is not `user`.
- [ ] **Step 4: Run** the test — Expected: PASS. Then `bun test commands/__tests__/setup-copy.test.ts` and update snapshots only if the row's copy appears there.
- [ ] **Step 5: Commit** `setup: tool.plugins warns when a second superpowers is enabled`

### Task 4: One-time swap migration

**Files:**
- Create: `lib/setup/migrations/superpowers-fork-swap.ts`
- Modify: `lib/setup/migrations/index.ts` (register)
- Modify: `lib/setup/state.ts` (`SetupState.superpowersDisabled?: { configDir: string; id: string }[]`, carried through `parseSetupState`)
- Test: create `lib/setup/__tests__/migration-superpowers-fork-swap.test.ts`

**Interfaces:**
- Consumes: `SUPERSEDED_PLUGINS` (Task 2).
- Produces: `export const superpowersForkSwapMigration: MigrationDef` with `id: "2026-11-18-superpowers-fork-swap"`, `title: "Switch to mattstack's superpowers"`; setup-state `superpowersDisabled`, read by Task 5.

- [ ] **Step 1: Write failing tests** with a fake `ctx.p.exec` (model on `migration-retire-switchboard-url.test.ts` and the team-packs migration tests):
  - one config dir, stock official copy enabled at user scope → one `plugin disable superpowers@claude-plugins-official` call with `CLAUDE_CONFIG_DIR` set, outcome `done`, state records `{configDir, id}`;
  - stock copy already disabled → no disable call, `skipped`, nothing recorded (Review Focus 1);
  - two config dirs (cswap), official enabled in the first, marketplace copy enabled in the second → two disables, two records (Review Focus 2);
  - stock copy enabled at project scope only → no disable call, `skipped`;
  - Claude Code missing (`resolveTool` no exec) → `skipped`; `plugin list` exits non-zero → `failed`, nothing recorded (Review Focus 3);
  - a disable that exits non-zero → `failed`, the dirs that succeeded are still recorded.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/migration-superpowers-fork-swap.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** using the same config-dir set and runner as `migrations/team-packs-from-git.ts` (`claudeConfigDirs` with cswap dirs, deduped by real plugins path; `plugin list --json` → `parsePluginList`); record via `updateSetupState`, appending.
- [ ] **Step 4: Run** the test, plus `bun test lib/setup/__tests__/update-safe.test.ts lib/setup/__tests__/state.test.ts` if present — Expected: PASS.
- [ ] **Step 5: Commit** `setup: migration swaps stock superpowers for mattstack's once`

### Task 5: Uninstall turns the stock copies back on

**Files:**
- Modify: `lib/setup/uninstall.ts` (`pluginsUninstallRun`)
- Test: `lib/setup/__tests__/uninstall.test.ts`

**Interfaces:**
- Consumes: `SetupState.superpowersDisabled` (Task 4).

- [ ] **Step 1: Write failing tests:** state with `superpowersDisabled: [{ configDir: D, id: "superpowers@claude-plugins-official" }]` → after the uninstall loop, `plugin enable superpowers@claude-plugins-official` runs with `CLAUDE_CONFIG_DIR=D`, after `plugin uninstall superpowers@mattstack`; an enable answering "not found" adds a note and the step is not failed (Review Focus 4); the recorded list is cleared from state after the step.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/uninstall.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the re-enable pass and the state clear; widen the "nothing recorded" early return to consider `superpowersDisabled`.
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit** `uninstall: re-enable the stock superpowers rt turned off`

### Task 6: The default-mode SessionStart hook

**Files:**
- Create: `plugins/mattstack/hooks/superpowers-execution-note.sh`
- Modify: `plugins/mattstack/hooks/hooks.json` (SessionStart, beside `agent-effort-note.sh`)
- Test: create `plugins/mattstack/hooks/tests/test-superpowers-execution-note.sh` (model on `test-agent-effort-note.sh`)

**Interfaces:**
- Consumes: `rt settings get superpowers.execution` (Task 1).

- [ ] **Step 1: Write the failing test** with a sandbox `HOME`/`CLAUDE_CONFIG_DIR` and a stub `rt` on `PATH`:
  - fork installed and enabled (sandbox `settings.json` `enabledPlugins["superpowers@mattstack"]: true` and `plugins/installed_plugins.json` listing it), stub prints `native-with-reviews` → one SessionStart JSON with `additionalContext` equal to the Global Constraints line for Native with reviews;
  - stub prints `subagent-driven` → the subagent-driven line;
  - stub prints `ask` → no output (Review Focus 5);
  - fork disabled, or not installed → no output whatever the stub prints (Review Focus 5);
  - fork enabled, stub `rt` exits non-zero or `rt` absent → the Native with reviews line.
- [ ] **Step 2: Run** `sh plugins/mattstack/hooks/tests/test-superpowers-execution-note.sh` — Expected: FAIL.
- [ ] **Step 3: Implement** the hook (timeout in hooks.json: 5; read the setting's bare value, e.g. through `rt settings get`'s `--json` envelope or its payload output, whichever `rt settings get --help` documents as stable).
- [ ] **Step 4: Run** the test, and `claude plugin test plugins/mattstack` if the plugin harness covers hooks.json — Expected: PASS.
- [ ] **Step 5: Commit** `mattstack plugin: SessionStart names the default superpowers execution mode`

### Task 7: Marketplace entry, docs and the release skill

**Files:**
- Modify: `marketplace/marketplace.json` (new `superpowers` entry, Global Constraints values; description: "Superpowers with task groups and Native with reviews: mattstack's fork of obra/superpowers.")
- Modify: `marketplace/README.md` (Usage list and "Plugin sources" paragraph name superpowers beside fast-browser)
- Modify: `skills/rt-release/SKILL.md` (external-plugin section: bumping the superpowers pin after a fork rebase, the same way as fast-browser)
- Modify: docs site skills page per the rt:docs skill (mattstack installs its superpowers fork; `superpowers.execution`)
- Modify: `rt-tray/vm/fixtures/team-kitchen-sink/expect.json` (expect `superpowers@mattstack`)
- Test: `scripts/__tests__/release-marketplace.test.ts`

- [ ] **Step 1: Run** `bun test scripts/__tests__/release-marketplace.test.ts` before the edit to record the baseline (Expected: PASS), then add the entry and run it again — Expected: PASS (its 40-hex `sha` check covers the new pin).
- [ ] **Step 2: The rt-release skill edit** follows superpowers:writing-skills: one scenario run before the edit ("superpowers upstream released 7.0.3 and the fork was rebased and tagged; what does the release do about it?") showing the gap, the edit, the same scenario after. Record both in the commit message.
- [ ] **Step 3: Docs** per rt:docs; build or lint the docs site if the skill says to.
- [ ] **Step 4: Commit** `marketplace: list mattstack's superpowers fork; docs and release skill`

---

## Hand-off (needs Matt's go, outside this plan's tasks)

1. Before this branch merges: push branch `mattstack` (at `4e49c04`) to m4ttstack/superpowers and make it the default branch.
2. Open the upstream PR to obra/superpowers from a branch off upstream `main` with the feature commits only.
3. After the release: on Matt's Mac remove the `superpowers-pinned` marketplace and its plugin, run `rt setup`, delete `~/.claude/rules/subagent-execution-default.md`.
