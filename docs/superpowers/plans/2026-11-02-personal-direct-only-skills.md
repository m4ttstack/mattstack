# Personal "only when I type it" skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member can mark a pack skill "only when I type it" on the Console Config tab or through an rt verb, affecting only their machine and compiling nothing.

**Architecture:** A `user`-scope setting holds the choices and is the source of truth. A reconcile function makes each installed plugin copy's `SKILL.md` match it by adding or removing a marked `disable-model-invocation` line. Reconcile runs after a toggle, after `rt skills sync`, after setup's plugin step, and from a mattstack `SessionStart` hook.

**Tech Stack:** Bun and TypeScript (rt, `bun test` from the repo root), Hono and React with vitest (`apps/console`), POSIX sh (plugin hook).

**Spec:** `docs/superpowers/specs/2026-11-02-personal-direct-only-skills-design.md`

## Global Constraints

- Never touch the pack, its source, its compile output or its version. A toggle leaves the org clone clean and never appears in Changes, Discard or Apply.
- Never write through a path whose realpath is outside a `plugins/cache` folder.
- Only the newest version folder of a plugin in each config dir is edited. Older ones are left alone.
- A source value of `disable-model-invocation: true` is never removed, and the control shows locked on. A source value of `false` is replaced while on and restored when off.
- The control shows only on rows with `status: "public"` and no `base`.
- Reconcile failures warn. They never fail `rt skills sync`, `rt setup` or a session start.
- The personal verb never calls `refuseUnlessPackOwned`. Any member may use it.
- Run `bun test` from the repo root. Never run a built binary without an isolated HOME; use `bun run cli.ts` during development, and tests must not reach the real `~/.claude`.
- Read before editing: `.claude/rules/settings.md`, `output-layer.md`, `command-tree.md`, `kit-recipes.md`, the `rt:settings` and `rt:ui-copy` skills. UI copy has no dot separators, and a coloured border never pairs with a border radius.

## Review Focus

- A `SKILL.md` with CRLF line endings, or with no frontmatter block: CRLF keeps working and is preserved; no frontmatter is skipped with a warning, never corrupted. Test in Task 2.
- A version folder that vanishes mid-reconcile because Claude Code is updating: that plugin is skipped with no crash, and a half-written `SKILL.md` can never exist (temp file, then rename). Test in Task 3.
- An unwritable `SKILL.md`: the choice is still saved, and the member is told it did not reach the installed copy. Test in Task 4, and shown in Task 8.
- Two config dirs whose `plugins` resolve to the same folder: edited once, with no duplicate warning. Test in Task 3.
- The hook on a machine with no `rt`, or an older `rt` without the verb: exits 0 and prints nothing. Test in Task 6.

---

### Task 1: The setting

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts`, `packages/rt-client/src/settings/registry-schemas.ts`, `packages/rt-client/src/settings/schema.lock.json`, `apps/console/src/app/settings/groups.ts`
- Test: `packages/rt-client/src/settings/__tests__/schema-examples.ts`

**Interfaces:**
- Produces: setting key `rt.skills.directOnly`, value `Record<string, string[]>` from `<plugin>@<marketplace>` to skill names, `scopes: ["user"]`, `default: {}`, `merge: "replace"`.

- [ ] **Step 1:** Add to `EXAMPLES`: good `{ "widgets@acme": ["work", "ship"] }` and `{}`; bad `{ "widgets@acme": "work" }`, whose first issue names path `widgets@acme`.
- [ ] **Step 2:** Run `bun test packages/rt-client/src/settings/__tests__/schema-examples.test.ts`. Expected: FAIL, no schema for the key.
- [ ] **Step 3:** Add the registry row, the zod schema `z.record(z.string(), z.array(z.string()))` with `.meta`, and the console group `match`. Follow the "Adding a key" checklist in `docs/settings-architecture.md`.
- [ ] **Step 4:** Run `bun run cli.ts settings schema lock`, then `cd packages/rt-client && bun run build` as its own step.
- [ ] **Step 5:** From the root, run `bun test packages/rt-client/src/settings/__tests__`, and from `apps/console` run `bun run vitest run src/app/settings/groups.test.ts`. Expected: PASS.
- [ ] **Step 6:** Commit `add rt.skills.directOnly setting`.

### Task 2: The frontmatter line

**Files:**
- Create: `lib/skills/direct-only-line.ts`
- Test: `lib/skills/__tests__/direct-only-line.test.ts`

**Interfaces:**
- Produces:
  - `DIRECT_ONLY_MARK = "# rt: direct-only"` and `DIRECT_ONLY_MARK_WAS_FALSE = "# rt: direct-only (was false)"`
  - `addDirectOnly(md: string): string | null`: `null` when there is no frontmatter block
  - `removeDirectOnly(md: string): string`
  - `sourceSetsDirectOnly(md: string): boolean`: true for an unmarked `disable-model-invocation: true`

- [ ] **Step 1: Write the failing tests**, one each:
  - `addDirectOnly` puts `disable-model-invocation: true # rt: direct-only` last in the frontmatter, body untouched
  - it is idempotent on its own output
  - it leaves an unmarked `true` byte-identical
  - it turns `disable-model-invocation: false` into `disable-model-invocation: true # rt: direct-only (was false)`
  - `removeDirectOnly(addDirectOnly(x)) === x` for plain, `false` and CRLF inputs
  - `removeDirectOnly` leaves an unmarked `true` alone
  - `addDirectOnly` returns `null` with no frontmatter
  - a `disable-model-invocation: true` in the body is ignored by all three functions
- [ ] **Step 2:** Run `bun test lib/skills/__tests__/direct-only-line.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement with line-based edits between the `---` fences, never a YAML round trip, so every other byte survives. Match the file's line ending.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Prove Claude Code accepts the marked line.** In the scratchpad, make a plugin with one skill carrying the marked line, then run `claude -p "Without using any tools: is a skill named ping in your skills list? yes or no." --model haiku --plugin-dir <dir> </dev/null` and `claude -p "/<plugin>:ping" --model haiku --plugin-dir <dir> </dev/null`, with the skill's body printing a marker. Expected: "No", then the marker. If the comment breaks parsing, use a separate `# rt: direct-only` line above the key, and update the tests.
- [ ] **Step 6:** Commit `add direct-only frontmatter line editing`.

### Task 3: Reconcile

**Files:**
- Create: `lib/skills/skill-roots.ts`, `lib/skills/direct-only.ts`
- Modify: `commands/skills.ts` (import `registeredSkillRoots` instead of defining it)
- Test: `lib/skills/__tests__/direct-only.test.ts`

**Interfaces:**
- Consumes: Task 1's key, Task 2's functions, `findInstalledPluginDir`'s newest-version logic from `lib/skills/installed-plugins.ts`.
- Produces:
  - `registeredSkillRoots(packDir: string): string[]`, moved unchanged
  - `directOnlyConfigDirs(env: NodeJS.ProcessEnv, home: string): string[]`: `CLAUDE_CONFIG_DIR ?? ~/.claude`, plus each `~/.claude-swap-backup/sessions/<name>` that has a `plugins` folder, deduped by the realpath of `plugins`
  - `reconcileDirectOnly(opts: { configDirs: string[]; choices: Record<string, string[]> }): { changed: string[]; warnings: string[] }`

- [ ] **Step 1: Write the failing tests** against a temp folder shaped like `<config>/plugins/cache/<marketplace>/<plugin>/<version>/` with a `.claude-plugin/plugin.json`:
  - a chosen skill gains the line in the newest version only
  - a skill no longer chosen loses it, and an empty list `[]` strips every marked line for that plugin
  - a skill under a manifest root such as `./plugin/skills` is found
  - an unknown name in the choices is ignored with no warning
  - a plugin that is not installed is ignored with no warning
  - a second run reports `changed: []` and rewrites nothing
  - a `SKILL.md` symlinked outside `plugins/cache` is not written and gives a warning
  - a version folder removed before the write produces no throw
  - two config dirs sharing one `plugins` are edited once
  - no frontmatter gives a warning naming the file
  - a read-only `SKILL.md` gives a warning and the other skills still apply
- [ ] **Step 2:** Run `bun test lib/skills/__tests__/direct-only.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Move `registeredSkillRoots` to `lib/skills/skill-roots.ts`. Implement reconcile; every write goes to a temp file in the same folder and then renames. A catch per skill turns a failure into a warning. Skills not in a registered root are never touched.
- [ ] **Step 4:** Run the new test and `bun test lib/skills/__tests__` for the moved function. Expected: PASS.
- [ ] **Step 5:** Commit `add direct-only reconcile over installed plugin copies`.

### Task 4: The verb and the surface field

**Files:**
- Modify: `lib/command-tree-def.ts` (add `direct-only` under `skills`), `commands/skills.ts`
- Test: `lib/skills/__tests__/direct-only-verb.test.ts`

**Interfaces:**
- Consumes: Task 3's functions, `getSetting`, `setSetting`, `resolvePack`, `PackInfo.marketplace`.
- Produces:
  - `rt skills direct-only list --pack <pack> [--json]`
  - `rt skills direct-only set <name>... --on|--off --pack <pack> [--json]`, whose JSON is `{ names: string[]; on: boolean; applied: boolean; warnings: string[] }`
  - `rt skills direct-only reapply [--json]`, which takes no pack, reconciles every plugin in the setting and prints nothing without `--json` unless there are warnings
  - `SurfaceRow` gains `directOnly?: "on" | "off" | "locked"`, set by `rt skills surface list --json`. It is absent on rows that are not public, rows with a `base`, and packs with no marketplace.

- [ ] **Step 1: Write the failing tests**, with a temp HOME and installed plugin copy:
  - `set --on` writes the setting at user scope and edits the installed copy
  - `set --off` removes the name and restores the original bytes
  - an unwritable copy keeps the saved choice and returns `applied: false` with a warning
  - `set` on an internal row, on a `base` row and on an unknown name refuses and writes nothing
  - `set` on a row whose source sets `true` refuses with the reason
  - a pack with no marketplace refuses
  - a member who does not own the pack can still `set`
  - the org clone's `git status` stays clean
  - `surface list --json` gives `on`, `off` and `locked` on public rows and no field on internal ones
  - `reapply` restores a line removed by hand
- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3:** Implement `skillsDirectOnly` and the tree row. Decorate rows in the surface list handler rather than changing `computeRows`; `locked` reads the row's `path` with `sourceSetsDirectOnly`. Output goes through the output layer. The description comes from `rt:ui-copy`. Leave the verb off `agentSafe`, so an agent cannot change a person's choice through `rt_verb`.
- [ ] **Step 4:** Run the test and `bun test lib/__tests__/ -t "command tree"` plus any picker conformance test the rule names. Expected: PASS.
- [ ] **Step 5:** Commit `add rt skills direct-only verb and surface field`.

### Task 5: Reapply after sync and setup

**Files:**
- Modify: `lib/skills/sync.ts`, `commands/skills-sync.ts` (`STEP_TITLE`), `lib/setup/steps/plugins.ts`
- Test: the existing sync and `lib/setup/__tests__/steps-c.test.ts` suites

**Interfaces:**
- Consumes: `reconcileDirectOnly`, `directOnlyConfigDirs`.
- Produces: sync step `direct-only`, titled "Keep your typed-only skills".

- [ ] **Step 1: Write the failing tests:**
  - with a stored choice, a sync that updates the pack reports a `direct-only` step that ran, and the new version's `SKILL.md` carries the line
  - with no choices, the step is `skipped`
  - a reconcile warning lands in `report.warnings` and does not stop the run
  - after the setup plugin step's update, the line is present
  - a warning there is logged through `ctx.log` and the step still returns `done`
- [ ] **Step 2:** Run the two files. Expected: the new tests FAIL.
- [ ] **Step 3:** Add the step after `verify-installed`, before `cswap-sweep`, reached even when the pack was already current. Add a deps seam so tests inject the config dirs. In setup, call reconcile just before the final `return { state: "done" ... }`.
- [ ] **Step 4:** Run them, plus the e2e file covering sync output if `git grep "Check each account"` finds one. Expected: PASS.
- [ ] **Step 5:** Commit `reapply direct-only choices after sync and setup`.

### Task 6: The session-start hook

**Files:**
- Create: `plugins/mattstack/hooks/direct-only-reapply.sh`, `plugins/mattstack/hooks/tests/test-direct-only-reapply.sh`
- Modify: `plugins/mattstack/hooks/hooks.json`, `plugins/mattstack/hooks/README.md`, `plugins/mattstack/.claude-plugin/plugin.json` (bump)

**Interfaces:**
- Consumes: `rt skills direct-only reapply`.

- [ ] **Step 1: Write the failing shell test**, in the style of `test-spill-read-note.sh`:
  - no `rt` on PATH: exit 0, empty stdout
  - a stub `rt` that exits 2: exit 0, empty stdout
  - a stub `rt`: it receives exactly `skills direct-only reapply`, with cwd `$HOME`
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Write the hook. It does `cd "$HOME"` first, because a compiled `rt` autoloads a bunfig from its cwd. It never prints to stdout, because hook stdout becomes session context. It always exits 0. Register it on `SessionStart` with `"timeout": 5`.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Measure when the edit takes effect.** Using a scratch plugin installed through a scratch marketplace, never the real cache, strip the line by hand, then start one `claude -p` session and ask whether the skill is listed, then a second. Record the answers in the PR. Expected: listed in the first at worst, gone by the second. **If it is still listed in the second, stop and bring it to Matt.** The spec forbids falling back to a deny rule without him.
- [ ] **Step 6:** Bump the plugin version. Leave `minEngine` alone, since the hook is silent on an older `rt`, and add `engine-floor: unchanged <reason>` to the PR body if the check asks.
- [ ] **Step 7:** Commit `reapply direct-only choices at session start`.

### Task 7: The mock (Matt's gate)

**Files:**
- Modify: `docs/apps/design/console/console.pen`

- [ ] **Step 1:** Measure tokens from the live Config tab. Find it through `deck list`, since `.mattstack` URLs don't work in a browser.
- [ ] **Step 2:** Draw the Config tab with the row control in its three states (off, on, locked on), on rows in both grid columns at the current width, plus the third legend line. Use `console.pen` variables through the pencil MCP. Copy comes from `rt:ui-copy`, in 2-6 word clauses, with the help text covering both spec points: plain requests stop triggering it, and another skill can't hand off to it.
- [ ] **Step 3:** Save the pen file, confirm it reached disk, and commit `console mock: personal direct-only row control`.
- [ ] **Step 4: Stop.** Show Matt the mock and wait for approval before Task 8.

### Task 8: Console route and row control

**Files:**
- Modify: `apps/console/src/server/skills.ts`, `apps/console/src/app/wiring/useWiring.ts`, `apps/console/src/app/wiring/SurfaceTab.tsx`, `apps/console/src/app/wiring/SurfaceTab.module.css`, and the server fixture that feeds the tab
- Test: `apps/console/src/server/skills.test.ts`, `apps/console/src/app/wiring/__tests__/SurfaceTab.test.tsx`

**Interfaces:**
- Consumes: Task 4's verb and `directOnly` field, the approved mock.
- Produces: `POST /api/skills/direct-only`, body `{ pack: string; name: string; on: boolean }`, returning the verb's JSON. `useDirectOnly(pack)` returns a mutation with its own key, not `skillsWriteKey(pack)`, so a toggle does not count as a pack write.

- [ ] **Step 1: Write the failing server tests:**
  - an invalid name (fails `VERB_NAME`) gives 400 and spawns nothing
  - a valid call runs `skills direct-only set <name> --on --pack <pack> --json` through `heldOpen`, never `cachedRun`
  - it calls `dropCachedReads(pack)` whatever the outcome
  - `applied: false` passes through with 200
- [ ] **Step 2: Write the failing UI tests:**
  - a public row shows the control and an internal row does not
  - a `base` row does not
  - `locked` shows it disabled with its reason
  - toggling posts at once and `Nothing staged` stays
  - a row with the team switch staged off still reads from on-disk `directOnly`, and the control hides only after Apply
  - `applied: false` shows a notification naming the warning
  - the legend has the third line
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4:** Implement to match the approved mock. Keep the state out of `useSurfaceStaging`, and use `notifications` from the kit, as `guardedWrite` does.
- [ ] **Step 5:** Run both, then `bun run console:test`. Expected: PASS.
- [ ] **Step 6: Look at it.** Render the Config tab in Fast Browser on a localhost URL from `deck list`, screenshot light and dark, compare with the mock, and say plainly what looks wrong. Check it at phone width too.
- [ ] **Step 7:** Commit `console: personal direct-only control on the Config tab`.

### Task 9: End-to-end acceptance

**Files:** none, unless a check fails.

- [ ] **Step 1:** On a scratch plugin in a scratch marketplace, under an isolated `CLAUDE_CONFIG_DIR` where auth allows, run each spec acceptance line and record the results in the PR:
  - toggled on: gone from the list, a plain request does not trigger it, typing runs it
  - toggled off: all three restored, and `SKILL.md` byte-identical
  - choice holds after a real version change through sync and through setup
  - choice is back by the next session after a hand-run `claude plugin update`
  - the org clone is clean, `rt skills check` reports no drift, and Changes and Apply don't move
- [ ] **Step 2:** Run `bun run test:e2e` for files touching skills output and `bun run check`. Expected: PASS. Other repo tests stay with CI.
- [ ] **Step 3:** Run the purity check, then push with `git_push` and open the PR against `main`, re-checking the plugin version against `main` right before merge.
