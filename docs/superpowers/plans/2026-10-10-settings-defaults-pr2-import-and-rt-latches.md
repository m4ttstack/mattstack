# Settings defaults sweep, PR 2: import and rt latches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-time setup migration copies the live legacy values rt still reads (per-repo `hooks.json`, the `preferences.md` writing-style line) into the user store, then rt's own latches and legacy fallbacks for `rt.hooks`, `sdm.resources`/`rt.sdmEnrichment`, `skills.writingStyle` and the VS Code extension's `rt.branchNaming` are deleted, each key gets its registry default and leaves `PENDING_DEFAULT`, and every "has anyone set this?" check on these keys asks provenance instead of `.value === undefined`.

**Architecture:** A new `lib/settings/presence.ts` holds the three helpers every task uses: `onlyDefault(resolved)` (provenance is all `default`), `unwritten(key, opts)` (the existing step-utils helper, now taking `ResolveOpts`) and `registryDefault(key)` (a copy of the row's default, for a reader's error path). The migration `2026-10-10-import-legacy-settings` runs once per Mac from `rt setup update`, writes only `"user"` scope, and never overwrites a value any store holds (a value the resolver refused counts as held). Each retirement task then deletes one reader's fallback, adds the registry default, drops the row's `migrated`/latch text, and shrinks `PENDING_DEFAULT` in the same commit. A `no-presence-by-undefined` guard pins the remaining board and deck latches for PR 3 and PR 4.

**Tech Stack:** Bun + TypeScript (rt, rt-client), `bun test` from the repo root, Vitest (console), the VS Code extension's bun tests, Docusaurus (website).

**Spec:** `docs/superpowers/specs/2026-10-10-settings-defaults-sweep-design.md` (sections 2, 3, 4 and the appendix rows for the keys below). PR 1's plan, for what already landed: `docs/superpowers/plans/2026-10-10-settings-defaults-pr1-registry-console.md`.

## Open questions for Matt

The spec is silent or self-conflicting on these, and each changes behaviour. The plan is written with the default named in each line; the line says what changes if you pick otherwise.

1. **`.imported` rename of files still in use.** The spec renames each imported file to `<name>.imported`. Two of PR 2's files are still read by something else: `hooks.json` is the cache the git hook shim greps and the file the daemon's hooks guard keys on (renaming it makes every hook run and stops the guard until the next `rt hooks`), and `preferences.md` holds other sections and is still the agent-side fallback in the board's review and respond skills. **Plan default:** copy `hooks.json` to `hooks.json.imported` and leave `hooks.json` in place; leave `preferences.md` untouched. To rename literally instead, Task 2 Step 3 swaps `copyFileSync` for `renameSync` and also renames `preferences.md`.
2. **Repos with no remote.** Settings repo sections are keyed by remote, so a remote-less repo has nowhere to keep `rt.hooks`; today `rt hooks` keeps its choice in that repo's `hooks.json`. **Plan default:** `rt hooks` refuses in such a repo (a `refused` note, exit 1) before touching anything, so the existing `hooks.json` and shims keep working. Alternative: keep `hooks.json` as the store for remote-less repos only (a small branch in `loadHooksConfig`/`saveHooksConfig`).
3. **Machine-scope `rt.hooks` values today's rt wrote.** `machine.repo` outranks `user.repo`, so an existing machine value would silently override every new user-scope write. **Plan default:** after its user write, `rt hooks` removes that repo's machine-scope value on this Mac (Task 3). The migration does not move them. Alternative: the migration moves them up front, which needs a per-rung read on the `no-settings-bypass` allowlist.
4. **`hooks.json` freshness.** The shim reads only `hooks.json`, which rt rewrites when `rt hooks` or `rt settings set rt.hooks --repo` runs on this Mac. With user scope, a choice made on another Mac reaches this Mac's store by sync, but its cache keeps the old choice until someone runs `rt hooks` here. Also, an `rt hooks` run between installing this release and the launch-time `rt setup update` rewrites a not-yet-imported `hooks.json` from the default (every hook on). **Plan default:** no extra regeneration. Alternatives: regenerate every tracked repo's cache after the home repo pulls (the daemon's `onPulled`), and/or have `regenerateHooksCache` leave an existing `hooks.json` alone until `hooks.json.imported` exists.
5. **StrongDM.** (a) `rt sdm enrichment init` scaffolds the file this PR stops reading. **Plan default:** remove `init`; `rt sdm enrichment` with any argument prints a `refused` note, and the bare verb shows the label count with no file path. Alternative: `init` prints an `rt settings set sdm.resources ... --scope team` command built from the scanned names. (b) A team whose owner never ran `2026-10-07-sdm-resources-key` still has only `rt.sdmEnrichment`; retiring it (the spec's call) drops those labels for its members. Alternative: list `rt.sdmEnrichment` in `RENAMES` as an older name of `sdm.resources`, so the resolver keeps reading it with no reader code.

Assumed, not asked: the spec's "prints, once, the `rt settings set` an admin would run" is `warn()`'s once-per-process notice, and only while the key is unwritten.

## Keys in this PR

| Key | This PR | Task |
|---|---|---|
| `claude.marketplaces`, `claude.plugins` | `default: []`. The only presence check was `commands/home.ts`'s installer pointer. | 1 |
| `rt.hooks` | `default: { enabled: true }`, latch retired, writes go to user scope | 3 |
| `skills.writingStyle` | `default: "mattstack:writing-style-conversational"`, `preferences.md` rung retired | 4 |
| `sdm.resources`, `sdm.carriers` | `default: {}`, file fallback retired | 5 |
| `rt.sdmEnrichment` | removed from the registry, joins `RETIRED_KEYS` | 5 |
| `rt.branchNaming` | `default: { template: "${identifier}-${titleSlug}" }`, VS Code import retired | 6 |
| `mattstack.roster` | **stays pending.** `apps/board/src/config.ts` `rosterFromStore` reads `undefined` as "config.json owns the roster" (and `saveRosterMembers` routes on it). A `[]` default would hand the board an empty store roster, which fails `parseConfig`'s required-field check. rt's own readers (`active-team.ts`, `members.ts`, `invite.ts`, `commands/team.ts`) read raw sections and need nothing. PR 3 retires the board latch. | none |

`lib/team/board-token.ts`'s `legacyConfigTracksProjects` reads the board's `config.json`, so it goes with the board retirement in PR 3. After this PR, `PENDING_DEFAULT` holds the 13 `board.*` keys, `deck.access`, `deck.apps`, `deck.platform`, `gitq.forges`, `gitq.workSlots` and `mattstack.roster`.

Out of scope (PR 5, through `superpowers:writing-skills`): the `rt:settings` skill's latch text, the board review and respond skills' agent-side `preferences.md` fallback, and the rewrite of `docs/settings-architecture.md`'s porting section into a history note.

## Global Constraints

- Work in `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-mattstack/beorn` on branch `rt-487-settings-defaults-pr2`. Run `bun test` from the repo root (bunfig preload). Run only the targeted tests each task names; CI runs the full suite.
- A setup migration writes only the user and machine stores: every `setSetting`/`unsetSetting` in `lib/setup/migrations/` passes the scope as the literal `"user"` or `"machine"` (`lib/__tests__/no-shared-store-migrations.test.ts`), and never names an org or team store path.
- The import never overwrites a value any store holds, including a value the resolver refused. It is idempotent and records `done` or `skipped`; only a write that fails is `failed`, so it reruns.
- A built binary, or `bun run cli.ts` doing anything that touches HOME, runs only as `env -i HOME="$(mktemp -d)" PATH="$PATH" ...`.
- After touching `packages/rt-client/src`, run `bun run --cwd packages/rt-client build` before testing any consumer (stale `dist/` footgun). After a registry or `SCHEMAS` change, run `env -i HOME="$(mktemp -d)" PATH="$PATH" bun run cli.ts settings schema lock` and commit the lock.
- A key leaves `PENDING_DEFAULT` in the same commit that gives it a default. The list only shrinks.
- No reader keeps a fallback that disagrees with the registry default; an error path that needs the default calls `registryDefault(key)`.
- "Has anyone set this?" is `unwritten` / `onlyDefault`, never `.value === undefined` or `!== undefined`.
- No real org, team, repo or person names in code, tests, fixtures or docs: acme, widgets, gadgets, gitlab.example.com, example.com, dev1, dev2.
- Comments only state a constraint the code cannot show.
- Everything a person reads goes through `lib/ui/out.ts` (root `AGENTS.md`, "Output layer"): a refusal by policy is a `refused` line through `out.note`, never `out.fail`; coral (`failed`) only for failures; a command a person runs goes in a `next` callout via `out.cmd`, never mid-sentence; no `console.*` under `lib/`, `commands/` or `cli.ts`; `lib/` warns through `warn()` from `lib/ui/warn.ts`. Copy is short plain sentences to "you", with no flags, store names or step ids ("Command descriptions are plain language").
- Do not edit any skill (`plugins/mattstack`, `skills/`, `apps/board/skills*`) in this PR.

## Review Focus

- A repo whose `hooks.json` turned a hook off before any store value existed keeps that hook off after `rt setup update`, and `rt hooks status` still shows it off. Pinned in Task 3 ("after the import migration, regenerating the cache keeps the imported choices").
- `rt hooks on` on a Mac where today's rt wrote a machine-scope value turns hooks back on. Pinned in Task 3.
- A team that sets a writing style keeps it after the migration even when `preferences.md` names another; someone with no store value keeps their `preferences.md` choice. Pinned in Task 2.
- A malformed legacy file (`hooks.json` that will not parse, a `writing-style:` line with an invalid id) or a store value the resolver refuses is left exactly as it was, and the migration records `skipped` or `done`, never `failed`. Pinned in Task 2.
- Someone who chose the conversational style on purpose (a user value equal to the registry default) reads as chosen, and the setup row is `ready`. Pinned in Task 4.

---

### Task 1: Presence helpers, presence-check fixes, and the `claude.*` defaults

**Files:**
- Create: `lib/settings/presence.ts`
- Create: `lib/settings/__tests__/presence.test.ts`
- Create: `lib/__tests__/no-presence-by-undefined.test.ts`
- Modify: `lib/setup/steps/step-utils.ts` (move `unwritten` out, re-export it)
- Modify: `lib/setup/steps/skills.ts:133-135, 176, 186, 195` (`isUnset`)
- Modify: `commands/home.ts:599-612` (`claudePluginsPointerMessage`, `printClaudePluginsPointer`)
- Modify: `lib/daemon/cron.ts:62-74` (`loadCronConfig`)
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (`claude.marketplaces`, `claude.plugins` rows)
- Modify: `packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts` (`PENDING_DEFAULT`)
- Test: `commands/__tests__/home.test.ts:1707-1730`

**Interfaces:**
- Produces: `onlyDefault(resolved: { provenance: readonly Provenance[] }): boolean`; `unwritten(key: string, opts?: ResolveOpts): boolean`; `registryDefault<T>(key: string): T` (all from `lib/settings/presence.ts`). `lib/setup/steps/step-utils.ts` keeps exporting `unwritten`, so existing importers are unchanged.
- Produces: `claudePluginsPointerMessage(marketplacesSet: boolean, pluginsSet: boolean): string | null`.

- [ ] **Step 1: Write the failing helper tests**

`lib/settings/__tests__/presence.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { onlyDefault, registryDefault, unwritten } from "../presence.ts";
import { setSetting, setSettingsNoticeSink } from "../write.ts";

const REPO = "gitlab.example.com/acme/widgets";

describe("presence", () => {
  const origHome = process.env.HOME;
  let home: string;
  let previousSink: ReturnType<typeof setSettingsNoticeSink>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-presence-")));
    process.env.HOME = home;
    previousSink = setSettingsNoticeSink(() => {});
  });

  afterEach(() => {
    setSettingsNoticeSink(previousSink);
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("onlyDefault reads provenance, never the value", () => {
    expect(onlyDefault({ provenance: [] })).toBe(true);
    expect(onlyDefault({ provenance: [{ scope: "default", file: null }] })).toBe(true);
    expect(onlyDefault({ provenance: [{ scope: "default", file: null }, { scope: "user", file: "/u" }] })).toBe(false);
  });

  test("a key nobody set is unwritten, with or without a registry default", () => {
    expect(unwritten("rt.cron")).toBe(true);
    expect(unwritten("rt.dopplerTemplate", { repoIdentity: REPO })).toBe(true);
  });

  test("a store value makes the key written, globally and per repo", () => {
    setSetting("rt.cron", { triggers: [] }, "machine");
    expect(unwritten("rt.cron")).toBe(false);
    setSetting("rt.dopplerTemplate", [{ path: "env", project: "web", config: "dev" }], "machine", { repoIdentity: REPO });
    expect(unwritten("rt.dopplerTemplate", { repoIdentity: REPO })).toBe(false);
    expect(unwritten("rt.dopplerTemplate", { repoIdentity: "gitlab.example.com/acme/gadgets" })).toBe(true);
  });

  test("registryDefault hands back a copy", () => {
    const first = registryDefault<{ triggers: unknown[] }>("rt.cron");
    first.triggers.push("changed");
    expect(registryDefault("rt.cron")).toEqual({ triggers: [] });
    expect(registryDefault("rt.dopplerTemplate")).toBeUndefined();
    expect(() => registryDefault("no.such.key")).toThrow('unknown setting "no.such.key"');
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**: `bun test lib/settings/__tests__/presence.test.ts` (cannot resolve `../presence.ts`).

- [ ] **Step 3: Implement `lib/settings/presence.ts`**

```ts
import { getDef } from "./registry.ts";
import { getSetting, type Provenance, type ResolveOpts } from "./resolve.ts";

/** No store sets the value: every provenance row is the registry default, or there are none. */
export function onlyDefault(resolved: { provenance: readonly Provenance[] }): boolean {
  return resolved.provenance.every((p) => p.scope === "default");
}

/**
 * `getSetting` reads a registry default as a present value, so "has anyone
 * set this?" is asked here, never by testing the value against undefined.
 */
export function unwritten(key: string, opts: ResolveOpts = {}): boolean {
  return onlyDefault(getSetting(key, opts));
}

/** A copy, so a caller may change it without changing the registry. */
export function registryDefault<T>(key: string): T {
  const def = getDef(key);
  if (!def) throw new Error(`unknown setting "${key}"`);
  return structuredClone(def.default) as T;
}
```

In `lib/setup/steps/step-utils.ts`, delete the `unwritten` function and its doc comment, delete the now-unused `getSetting` import, and add:

```ts
export { unwritten } from "../../settings/presence.ts";
```

- [ ] **Step 4: Run it, expect PASS**: `bun test lib/settings/__tests__/presence.test.ts lib/setup/__tests__/migration-board-cron-by-tool.test.ts`.

- [ ] **Step 5: Write the failing guard**

`lib/__tests__/no-presence-by-undefined.test.ts`:

```ts
/**
 * Source guard: whether a setting is set is asked with provenance
 * (lib/settings/presence.ts), never by comparing its value with undefined,
 * which a registry default makes always false. Each allowlisted file is an
 * ownership latch a later settings-defaults PR retires; its count pins it.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { extname, join, relative, resolve } from "path";

const ROOT = resolve(import.meta.dir, "..", "..");
const SCAN_ROOTS = ["commands", "lib", "cli.ts", "apps", "packages", "extensions"];
const SKIP_DIRS = new Set(["node_modules", "dist", "dist-bin", "build", ".turbo", "fixtures", "test", "tests", "__tests__", "docs"]);
const SOURCE_EXT = new Set([".ts", ".tsx", ".mts", ".js", ".mjs"]);
const EXCLUDED_PREFIXES = ["packages/rt-client/src/settings/"];
const PRESENCE = /\b(?:getSetting|resolve)\s*(?:<[^>()]*>)?\(\s*[^()]*\)\s*\.value\s*[!=]==?\s*undefined/g;

const ALLOWLIST: Record<string, { count: number; reason: string }> = {
  "apps/board/src/config.ts": { count: 1, reason: "board.hiddenMembers ownership latch; the board retirement deletes it" },
  "apps/deck/core/settings.ts": { count: 1, reason: "deck.apps ownership latch; the deck retirement deletes it" },
  "apps/deck/src/api/platform-settings.ts": { count: 1, reason: "deck.platform ownership latch; the deck retirement deletes it" },
  "apps/deck/src/edge/oauth.ts": { count: 1, reason: "deck.access ownership latch; the deck retirement deletes it" },
};

function* sourceFiles(path: string): Generator<string> {
  if (!existsSync(path)) return;
  if (statSync(path).isFile()) {
    if (SOURCE_EXT.has(extname(path)) && !/\.test\.[cm]?[jt]sx?$/.test(path)) yield path;
    return;
  }
  for (const name of readdirSync(path)) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    yield* sourceFiles(join(path, name));
  }
}

describe("presence checks", () => {
  test("the pattern catches both comparisons and a typed call", () => {
    for (const hit of ['getSetting("k").value === undefined', "getSetting<unknown>(KEY).value !== undefined", "resolve<unknown>('k').value !== undefined"]) {
      expect(hit.match(PRESENCE)).toHaveLength(1);
    }
    expect('getSetting("k").value ?? []'.match(PRESENCE)).toBeNull();
  });

  test("no source asks whether a setting is set by comparing its value with undefined", () => {
    const counts: Record<string, number> = {};
    for (const root of SCAN_ROOTS) {
      for (const file of sourceFiles(join(ROOT, root))) {
        const rel = relative(ROOT, file);
        if (EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        const hits = readFileSync(file, "utf8").match(PRESENCE)?.length ?? 0;
        if (hits > 0) counts[rel] = hits;
      }
    }
    expect(counts).toEqual(Object.fromEntries(Object.entries(ALLOWLIST).map(([file, a]) => [file, a.count])));
  });
});
```

- [ ] **Step 6: Run it, expect FAIL**: `bun test lib/__tests__/no-presence-by-undefined.test.ts`; `counts` names `lib/setup/steps/skills.ts: 1`.

- [ ] **Step 7: Fix the presence sites**

`lib/setup/steps/skills.ts`: delete `isUnset` (lines 133-135) and replace each of its three calls with `unwritten`, which the file already imports from `./step-utils.ts`:

```ts
  if (writable(ctx, "board.cwds") && unwritten("board.cwds")) {
```
```ts
  if (writable(ctx, "gitq.board") && unwritten("gitq.board")) {
```
```ts
  if (writable(ctx, "gitq.workSlots") && unwritten("gitq.workSlots")) {
```

(None of the three keys has a default yet, so behaviour is unchanged; PR 3 and PR 4 can add theirs without touching this file. Leave the `gitq.board` seed's shape alone; spec section 7's fix is PR 4.)

`commands/home.ts`: replace `claudePluginsPointerMessage` and `printClaudePluginsPointer` with:

```ts
/**
 * `claude.marketplaces`/`claude.plugins` replay is the installer's job, not
 * init's. This only points at it when a store sets either, so a machine with
 * nothing configured stays silent.
 */
export function claudePluginsPointerMessage(marketplacesSet: boolean, pluginsSet: boolean): string | null {
  if (!marketplacesSet && !pluginsSet) return null;
  return "Your Claude plugin and marketplace settings are applied by the mattstack installer, not by rt home init. Run the installer again if this Mac needs them.";
}

function printClaudePluginsPointer(): void {
  const message = claudePluginsPointerMessage(!unwritten("claude.marketplaces"), !unwritten("claude.plugins"));
  if (message) out.print(out.paragraph(message));
}
```

and add `import { unwritten } from "../lib/settings/presence.ts";` beside the other `lib/settings` imports.

`lib/daemon/cron.ts` `loadCronConfig`: delete the line `if (raw === undefined) return { triggers: [] };` (`rt.cron` has had a `{ triggers: [] }` default since PR 1; `lib/daemon/__tests__/cron.test.ts`'s "empty store degrades to no triggers" already pins the result), and change the doc comment's first words from "Absent/unresolvable setting" to "Unresolvable setting".

- [ ] **Step 8: Update the pointer's unit tests**: in `commands/__tests__/home.test.ts`, replace the `describe("claudePluginsPointerMessage", ...)` block with:

```ts
describe("claudePluginsPointerMessage", () => {
  test("neither key set in a store: no message", () => {
    expect(claudePluginsPointerMessage(false, false)).toBeNull();
  });

  test("marketplaces set, plugins not: points at the installer", () => {
    const message = claudePluginsPointerMessage(true, false);
    expect(message).toContain("marketplace settings");
    expect(message).toContain("installer");
  });

  test("plugins set, marketplaces not: points at the installer", () => {
    expect(claudePluginsPointerMessage(false, true)).toContain("Claude plugin");
  });

  test("never suggests rt home init itself replays them", () => {
    expect(claudePluginsPointerMessage(true, true)).toContain("not by rt home init");
  });
});
```

- [ ] **Step 9: Give `claude.*` their defaults**: in `registry-defs.ts`, add `default: [],` after `scopes` on the `claude.marketplaces` and `claude.plugins` rows. In `registry-console-ready.test.ts`, remove `"claude.marketplaces", "claude.plugins",` from `PENDING_DEFAULT`.

- [ ] **Step 10: Build and run the touched suites**

```bash
bun run --cwd packages/rt-client build
bun test lib/settings/__tests__/presence.test.ts lib/__tests__/no-presence-by-undefined.test.ts packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts packages/rt-client/src/settings/__tests__/schema-examples.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts
bun test commands/__tests__/home.test.ts lib/daemon/__tests__/cron.test.ts lib/setup/__tests__/steps-b.test.ts lib/setup/__tests__/steps-c.test.ts lib/setup/__tests__/team-settings.test.ts commands/__tests__/settings-json-frozen.test.ts
```

Expected: PASS. `settings-json-frozen`'s add-key fixtures do not move: an empty default list contributes no item and no provenance once a store lists one.

- [ ] **Step 11: Commit**

```bash
git add lib/settings/presence.ts lib/settings/__tests__/presence.test.ts lib/__tests__/no-presence-by-undefined.test.ts lib/setup/steps/step-utils.ts lib/setup/steps/skills.ts commands/home.ts commands/__tests__/home.test.ts lib/daemon/cron.ts packages/rt-client/src/settings/registry-defs.ts packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts
git commit -m "settings: presence through provenance, claude.* defaults"
```

---

### Task 2: The import migration

**Files:**
- Create: `lib/setup/migrations/import-legacy-settings.ts`
- Create: `lib/setup/__tests__/migration-import-legacy-settings.test.ts`
- Modify: `lib/setup/migrations/index.ts` (`MIGRATIONS`)
- Modify: `commands/__tests__/onboarding-org.test.ts:440` (`expectedOrder`)

**Interfaces:**
- Consumes: `onlyDefault` (Task 1).
- Produces: `importLegacySettingsMigration: MigrationDef` (id `2026-10-10-import-legacy-settings`); `legacyHooksValue(raw: unknown): { enabled: boolean; hooks: Record<string, boolean> } | null`; `parsePreferencesStyle(text: string): string | null` (copied here from `lib/skills/writing-style.ts`; Task 4 deletes the original).

- [ ] **Step 1: Write the failing tests**

`lib/setup/__tests__/migration-import-legacy-settings.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { seedOrg } from "../../../packages/rt-client/test/org-fixture.ts";
import { repoDataDir, userSettingsPath } from "../../rt-paths.ts";
import { serializeIdentity } from "../../settings/identity.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting, setSettingsNoticeSink } from "../../settings/write.ts";
import { ORG_LAYOUT } from "../../team/org-marker.ts";
import type { ApplyContext } from "../apply.ts";
import { MIGRATIONS } from "../migrations/index.ts";
import { importLegacySettingsMigration, legacyHooksValue, parsePreferencesStyle } from "../migrations/import-legacy-settings.ts";

const REPO = "gitlab.example.com/acme/widgets";
const OFF = JSON.stringify({ enabled: false, hooks: { "pre-push": false } });
const NOTHING = { state: "skipped", detail: "There were no old settings to copy" };

describe("2026-10-10-import-legacy-settings", () => {
  const origHome = process.env.HOME;
  let home: string;
  let previousSink: ReturnType<typeof setSettingsNoticeSink>;
  const run = () => importLegacySettingsMigration.run({} as ApplyContext);

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-import-legacy-")));
    process.env.HOME = home;
    previousSink = setSettingsNoticeSink(() => {});
  });

  afterEach(() => {
    setSettingsNoticeSink(previousSink);
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  function writeHooks(dirName: string, body: string): string {
    const dir = repoDataDir(dirName);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "hooks.json"), body);
    return join(dir, "hooks.json");
  }
  const remoteDir = (id: string) => serializeIdentity({ kind: "remote", id });

  function writePrefs(text: string): string {
    const file = join(home, ".mattstack", "user", "skills", "preferences.md");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    return file;
  }
  const PREFS = "## Writing style\n\nwriting-style: `mattstack:writing-style-sparse`\n\n## Other\nkeep me\n";

  test("is the last migration", () => {
    expect(MIGRATIONS.at(-1)).toBe(importLegacySettingsMigration);
    expect(importLegacySettingsMigration.id).toBe("2026-10-10-import-legacy-settings");
  });

  test("with nothing to copy it is skipped and creates no store", async () => {
    expect(await run()).toEqual(NOTHING);
    expect(existsSync(userSettingsPath())).toBe(false);
  });

  test("copies a repo's hooks.json into that repo's user section and keeps the file the git hook reads", async () => {
    const file = writeHooks(remoteDir(REPO), OFF);
    expect(await run()).toEqual({ state: "done", detail: "Copied your hook choices for 1 repo into your settings" });
    const resolved = getSetting<{ enabled: boolean; hooks: Record<string, boolean> }>("rt.hooks", { repoIdentity: REPO });
    expect(resolved.value).toMatchObject({ enabled: false, hooks: { "pre-push": false } });
    expect(resolved.provenance.map((p) => p.scope)).toContain("user.repo");
    expect(readFileSync(file, "utf8")).toBe(OFF);
    expect(readFileSync(`${file}.imported`, "utf8")).toBe(OFF);
  });

  test("a second run changes nothing", async () => {
    writeHooks(remoteDir(REPO), OFF);
    writePrefs(PREFS);
    await run();
    const store = readFileSync(userSettingsPath(), "utf8");
    expect(await run()).toEqual(NOTHING);
    expect(readFileSync(userSettingsPath(), "utf8")).toBe(store);
  });

  test("a repo a store already sets keeps its value: its hooks.json is a cache", async () => {
    setSetting("rt.hooks", { enabled: true, hooks: {} }, "machine", { repoIdentity: REPO });
    const file = writeHooks(remoteDir(REPO), OFF);
    expect(await run()).toEqual(NOTHING);
    expect(getSetting<{ enabled: boolean }>("rt.hooks", { repoIdentity: REPO }).value.enabled).toBe(true);
    expect(existsSync(`${file}.imported`)).toBe(false);
  });

  test("a store value the resolver refuses still counts as set, and is never overwritten", async () => {
    mkdirSync(dirname(userSettingsPath()), { recursive: true });
    const text = JSON.stringify({ repos: { [REPO]: { "rt.hooks": "not an object" } } });
    writeFileSync(userSettingsPath(), text);
    writeHooks(remoteDir(REPO), OFF);
    expect(await run()).toEqual(NOTHING);
    expect(readFileSync(userSettingsPath(), "utf8")).toBe(text);
  });

  test("a remote-less repo and an old name-keyed folder are left alone", async () => {
    writeHooks(serializeIdentity({ kind: "path", id: "/src/widgets" }), OFF);
    writeHooks("widgets", OFF);
    expect(await run()).toEqual(NOTHING);
  });

  test("a hooks.json that will not parse is left where it is and is not a failure", async () => {
    const file = writeHooks(remoteDir(REPO), "{ not json");
    expect(await run()).toEqual({ state: "skipped", detail: "There were no old settings to copy. 1 old file could not be read, so rt left it where it is" });
    expect(readFileSync(file, "utf8")).toBe("{ not json");
  });

  test("copies the writing-style line into your user settings and leaves preferences.md as it was", async () => {
    const file = writePrefs(PREFS);
    expect(await run()).toEqual({ state: "done", detail: "Copied your writing style into your settings" });
    const resolved = getSetting("skills.writingStyle");
    expect(resolved.value).toBe("mattstack:writing-style-sparse");
    expect(resolved.provenance.map((p) => p.scope)).toEqual(["user"]);
    expect(readFileSync(file, "utf8")).toBe(PREFS);
  });

  test("hooks and a writing style in one run are named together", async () => {
    writeHooks(remoteDir(REPO), OFF);
    writeHooks(remoteDir("gitlab.example.com/acme/gadgets"), OFF);
    writePrefs(PREFS);
    expect(await run()).toEqual({ state: "done", detail: "Copied your hook choices for 2 repos and your writing style into your settings" });
  });

  test("a writing style your team sets keeps winning: preferences.md is not copied", async () => {
    const seeded = seedOrg({
      layout: ORG_LAYOUT,
      org: "acme",
      username: "dev1",
      roster: [{ username: "dev1", teams: ["widgets"] }],
      roles: { admins: ["dev1"], teams: { widgets: { owners: ["dev1"] } } },
      teams: { widgets: { "skills.writingStyle": "mattstack:writing-style-structured" } },
    });
    const dir = join(home, ".mattstack", "orgs", seeded.org);
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, ".git", "config"), "");
    writePrefs(PREFS);
    expect(await run()).toEqual(NOTHING);
    expect(getSetting("skills.writingStyle").value).toBe("mattstack:writing-style-structured");
    expect(existsSync(userSettingsPath())).toBe(false);
  });

  test("a writing-style line with an invalid id is not copied", async () => {
    writePrefs("## Writing style\nwriting-style: `-rf`\n");
    expect(await run()).toEqual(NOTHING);
  });
});

describe("legacyHooksValue", () => {
  test("keeps the switch and boolean hook entries, drops the rest", () => {
    expect(legacyHooksValue({ enabled: false, hooks: { "pre-push": false, "pre-commit": "yes" } })).toEqual({ enabled: false, hooks: { "pre-push": false } });
    expect(legacyHooksValue({})).toEqual({ enabled: true, hooks: {} });
  });
  test("anything but an object is unreadable", () => {
    for (const raw of [null, [], "x", 3]) expect(legacyHooksValue(raw)).toBeNull();
  });
});

describe("parsePreferencesStyle", () => {
  test("reads the backticked value on the keyed line", () => {
    expect(parsePreferencesStyle("## Writing style\n\nwriting-style: `acme:team-writing-style`\n\nLoad it first.\n")).toBe("acme:team-writing-style");
  });
  test("reads an unquoted value", () => {
    expect(parsePreferencesStyle("## Writing style\nwriting-style: team-voice\n")).toBe("team-voice");
  });
  test("no keyed line, no section, or a keyed line in another section reads nothing", () => {
    expect(parsePreferencesStyle("## Writing style\nLoad `x:y` before drafting.\n")).toBeNull();
    expect(parsePreferencesStyle("## Dev process runner\nwriting-style: `x:y`\n")).toBeNull();
    expect(parsePreferencesStyle("## Writing style\n\n## Other\nwriting-style: `x:y`\n")).toBeNull();
  });
  test("an invalid id reads nothing", () => {
    expect(parsePreferencesStyle("## Writing style\nwriting-style: `-rf`\n")).toBeNull();
  });
  test("an indented next heading still ends the section", () => {
    expect(parsePreferencesStyle("## Writing style\n\n  ## Other\nwriting-style: `x:y`\n")).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**: `bun test lib/setup/__tests__/migration-import-legacy-settings.test.ts` (module not found).

- [ ] **Step 3: Implement `lib/setup/migrations/import-legacy-settings.ts`**

```ts
import { copyFileSync, existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { mattstackHome, reposDir } from "../../rt-paths.ts";
import { parseIdentity } from "../../settings/identity.ts";
import { onlyDefault } from "../../settings/presence.ts";
import { listSettings, type ResolveOpts } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import { isValidSkillId } from "../../skills/writing-style.ts";
import type { StepOutcome } from "../apply.ts";
import type { MigrationDef } from "./index.ts";

const HOOKS_KEY = "rt.hooks";
const STYLE_KEY = "skills.writingStyle";

interface Tally {
  hooks: number;
  style: boolean;
  unreadable: number;
  failed: string[];
}

/** A value the resolver refused still sits in a store, and the import must never overwrite it. */
function storeHolds(key: string, opts: ResolveOpts = {}): boolean {
  const row = listSettings(opts).find((s) => s.key === key);
  return row !== undefined && (!onlyDefault(row) || (row.invalid?.length ?? 0) > 0);
}

export function legacyHooksValue(raw: unknown): { enabled: boolean; hooks: Record<string, boolean> } | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { enabled, hooks } = raw as { enabled?: unknown; hooks?: unknown };
  const entries = hooks !== null && typeof hooks === "object" && !Array.isArray(hooks) ? Object.entries(hooks) : [];
  return { enabled: enabled !== false, hooks: Object.fromEntries(entries.filter((e): e is [string, boolean] => typeof e[1] === "boolean")) };
}

export function parsePreferencesStyle(text: string): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase() === "## writing style");
  if (start === -1) return null;
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith("## ")) return null;
    const m = /^\s*writing-style:\s*`?([^`\s]+)`?\s*$/.exec(line);
    if (m) return isValidSkillId(m[1]!) ? m[1]! : null;
  }
  return null;
}

/** Only remote repos have a settings section, so a path-kind or pre-identity folder has nowhere to go. */
function importHooks(t: Tally): void {
  if (!existsSync(reposDir())) return;
  for (const dir of readdirSync(reposDir())) {
    const identity = parseIdentity(dir);
    if (identity?.kind !== "remote") continue;
    const file = join(reposDir(), dir, "hooks.json");
    const opts = { repoIdentity: identity.id };
    if (!existsSync(file) || storeHolds(HOOKS_KEY, opts)) continue;
    let value: ReturnType<typeof legacyHooksValue>;
    try {
      value = legacyHooksValue(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      value = null;
    }
    if (value === null) {
      t.unreadable++;
      continue;
    }
    try {
      setSetting(HOOKS_KEY, value, "user", opts);
    } catch (err) {
      t.failed.push(`${identity.id}: ${(err as Error).message.split("\n")[0]}`);
      continue;
    }
    if (!storeHolds(HOOKS_KEY, opts)) {
      t.failed.push(`${identity.id}: the copy did not read back`);
      continue;
    }
    // The shim and the daemon's hooks guard still read hooks.json, so it stays.
    copyFileSync(file, `${file}.imported`);
    t.hooks++;
  }
}

function importWritingStyle(t: Tally): void {
  const file = join(mattstackHome(), "user", "skills", "preferences.md");
  if (!existsSync(file) || storeHolds(STYLE_KEY)) return;
  const style = parsePreferencesStyle(readFileSync(file, "utf8"));
  if (style === null) return;
  try {
    setSetting(STYLE_KEY, style, "user");
  } catch (err) {
    t.failed.push(`writing style: ${(err as Error).message.split("\n")[0]}`);
    return;
  }
  if (!storeHolds(STYLE_KEY)) {
    t.failed.push("writing style: the copy did not read back");
    return;
  }
  t.style = true;
}

function outcome(t: Tally): StepOutcome {
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  if (t.failed.length > 0) {
    return {
      state: "failed",
      detail: `Could not copy ${t.failed.length} old ${plural(t.failed.length, "setting", "settings")} into your settings: ${t.failed[0]}`,
      remedy: "Run rt settings check, fix what it names, then Retry",
    };
  }
  const copied = [
    t.hooks > 0 ? `your hook choices for ${t.hooks} ${plural(t.hooks, "repo", "repos")}` : null,
    t.style ? "your writing style" : null,
  ].filter((part): part is string => part !== null);
  const unread = t.unreadable > 0 ? `${t.unreadable} old ${plural(t.unreadable, "file", "files")} could not be read, so rt left ${plural(t.unreadable, "it where it is", "them where they are")}` : null;
  if (copied.length === 0) return { state: "skipped", detail: unread ? `There were no old settings to copy. ${unread}` : "There were no old settings to copy" };
  return { state: "done", detail: `Copied ${copied.join(" and ")} into your settings${unread ? `. ${unread}` : ""}` };
}

export const importLegacySettingsMigration: MigrationDef = {
  id: "2026-10-10-import-legacy-settings",
  title: "Copy your old hook choices and writing style into your settings",
  async run() {
    const tally: Tally = { hooks: 0, style: false, unreadable: 0, failed: [] };
    importHooks(tally);
    importWritingStyle(tally);
    return outcome(tally);
  },
};
```

In `lib/setup/migrations/index.ts`, import it and append it last:

```ts
import { importLegacySettingsMigration } from "./import-legacy-settings.ts";
```
```ts
  boardCronByToolMigration,
  importLegacySettingsMigration,
];
```

In `commands/__tests__/onboarding-org.test.ts:440`, add `"migration.2026-10-10-import-legacy-settings"` to `expectedOrder` right after `"migration.2026-10-10-board-cron-by-tool"`.

- [ ] **Step 4: Run, expect PASS**

```bash
bun test lib/setup/__tests__/migration-import-legacy-settings.test.ts lib/__tests__/no-shared-store-migrations.test.ts lib/__tests__/no-settings-bypass.test.ts lib/setup/__tests__/update-safe.test.ts lib/setup/__tests__/migrations.test.ts commands/__tests__/onboarding-org.test.ts commands/__tests__/member-upgrade.test.ts
```

If `no-settings-bypass` flags the new file, the read reached for a per-rung helper; `listSettings` is not one, so go back to it rather than adding an allowlist entry.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/migrations/import-legacy-settings.ts lib/setup/migrations/index.ts lib/setup/__tests__/migration-import-legacy-settings.test.ts commands/__tests__/onboarding-org.test.ts
git commit -m "setup: import legacy hooks.json and writing style into the user store"
```

---

### Task 3: Retire the `rt.hooks` latch

**Files:**
- Modify: `commands/hooks.ts` (module doc, `HOOKS_WRITE_SCOPE`, `probeHooksStore`, `readLegacyRaw`, `loadHooksConfig`, `saveHooksConfig`, `toggleHooks`, exports)
- Modify: `commands/__tests__/hooks.test.ts`
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (`rt.hooks` row)
- Modify: `packages/rt-client/src/settings/__tests__/registry.test.ts`, `registry-console-ready.test.ts`

**Interfaces:**
- Consumes: `registryDefault` (Task 1); `importLegacySettingsMigration` (Task 2, in a test).
- Produces: `loadHooksConfig(discoveredHooks: string[], repoIdentity: string | null): HooksConfig`; `saveHooksConfig(repoRoot: string, dataDir: string, config: HooksConfig, repoIdentity: string): void` (throws `UserActionableError` code `hooks-not-saved`). `regenerateHooksCache(repoRoot, dataDir, repoIdentity)` keeps its signature.

- [ ] **Step 1: Write the failing tests**: in `commands/__tests__/hooks.test.ts`:

1. Add imports: `existsSync` from `fs`; `serializeIdentity` from `../../lib/settings/identity.ts`; `setSettingsNoticeSink` beside `setSetting`; `importLegacySettingsMigration` from `../../lib/setup/migrations/import-legacy-settings.ts`; `type ApplyContext` from `../../lib/setup/apply.ts`; `getDef` from `../../lib/settings/registry.ts`. In the outer `beforeEach`, add `previousSink = setSettingsNoticeSink(() => {});` (declare `let previousSink: ReturnType<typeof setSettingsNoticeSink>;`), and restore it in the outer `afterEach`: user-scope writes print a share tip otherwise.
2. Rename `writeLegacy` to `writeCache` everywhere (it only writes the file the shim reads).
3. Replace the `describe("loadHooksConfig", ...)` block with:

```ts
  describe("loadHooksConfig", () => {
    test("nothing set: the registry default, every hook on", () => {
      expect(getDef("rt.hooks")!.default).toEqual({ enabled: true });
      expect(loadHooksConfig(["pre-commit", "pre-push"], IDENTITY)).toEqual({ enabled: true, hooks: { "pre-commit": true, "pre-push": true } });
    });

    test("an old hooks.json is no longer read", () => {
      writeCache({ enabled: false, hooks: { "pre-commit": false } });
      expect(loadHooksConfig(["pre-commit"], IDENTITY)).toEqual({ enabled: true, hooks: { "pre-commit": true } });
    });

    test("a hook the store does not name runs", () => {
      writeStoreValue({ enabled: true, hooks: { "pre-commit": false } });
      expect(loadHooksConfig(["pre-commit", "pre-push"], IDENTITY)).toEqual({ enabled: true, hooks: { "pre-commit": false, "pre-push": true } });
    });
  });
```

4. In `describe("regenerateHooksCache", ...)`: change the "store unowned" test to

```ts
    test("nothing set: the cache is rewritten from the registry default", () => {
      writeCache({ enabled: true, hooks: { "pre-commit": false } });
      regenerateHooksCache(repoRoot, dataDir, IDENTITY);
      expect(readCache()).toEqual({ enabled: true, hooks: { "pre-commit": true, "pre-push": true } });
    });
```

change the probe-failure test's title to "a store rt cannot read is best-effort: never throws, and the cache is written from the registry default" (its expectation stays), and add:

```ts
    test("after the import migration, regenerating the cache keeps the imported choices", async () => {
      const idDir = repoDataDir(serializeIdentity({ kind: "remote", id: IDENTITY }));
      mkdirSync(idDir, { recursive: true });
      writeFileSync(join(idDir, "hooks.json"), JSON.stringify({ enabled: true, hooks: { "pre-push": false } }));
      await importLegacySettingsMigration.run({} as ApplyContext);
      regenerateHooksCache(repoRoot, idDir, IDENTITY);
      expect(JSON.parse(readFileSync(join(idDir, "hooks.json"), "utf8"))).toEqual({ enabled: true, hooks: { "pre-commit": true, "pre-push": false } });
    });
```

5. Replace the `describe("saveHooksConfig", ...)` block with:

```ts
  describe("saveHooksConfig", () => {
    test("writes your user settings for this repo and refreshes the cache", () => {
      const next: HooksConfig = { enabled: false, hooks: { "pre-commit": false } };
      saveHooksConfig(repoRoot, dataDir, next, IDENTITY);
      const resolved = getSetting("rt.hooks", { repoIdentity: IDENTITY });
      expect(resolved.value).toEqual(next);
      expect(resolved.provenance.map((p) => p.scope)).toContain("user.repo");
      expect(readCache()).toEqual({ enabled: false, hooks: { "pre-commit": false, "pre-push": true } });
    });

    test("a value an older rt wrote on this Mac no longer outranks your choice", () => {
      setSetting("rt.hooks", { enabled: false, hooks: {} }, "machine", { repoIdentity: IDENTITY });
      saveHooksConfig(repoRoot, dataDir, { enabled: true, hooks: { "pre-commit": true, "pre-push": true } }, IDENTITY);
      const resolved = getSetting<HooksConfig>("rt.hooks", { repoIdentity: IDENTITY });
      expect(resolved.value.enabled).toBe(true);
      expect(resolved.provenance.map((p) => p.scope)).not.toContain("machine.repo");
      expect(readCache()).toEqual({ enabled: true, hooks: { "pre-commit": true, "pre-push": true } });
    });

    test("a store rt cannot write is a failure, and the cache is left alone", () => {
      mkdirSync(join(userSettingsPath(), ".."), { recursive: true });
      writeFileSync(userSettingsPath(), "{not valid json");
      expect(() => saveHooksConfig(repoRoot, dataDir, { enabled: false, hooks: {} }, IDENTITY)).toThrow("Your hooks choice was not saved");
      expect(existsSync(hooksConfigPath(dataDir))).toBe(false);
    });
  });
```

6. In the `"store writes + regeneration"` test nothing changes. In `describe("through toggleHooks", ...)`, change `ctx()` to pass `remoteUrl: "git@example.com:org/repo.git"`, and add:

```ts
      test("a repo with no remote is refused, and its hook files are left alone", async () => {
        writeCache({ enabled: false, hooks: { "pre-commit": false } });
        const noRemote: CommandContext = { identity: { repoName: "repo", identity: "path:%2Frepo", repoRoot, dataDir, remoteUrl: "", baseUrl: "" } };
        await expect(toggleHooks(["on"], noRemote)).rejects.toThrow("exit 1");
        expect(io.stderr()).toBe("[refused] This repo has no remote, so rt has nowhere to keep its hook choices\n");
        expect(io.stdout()).toBe("");
        expect(readCache()).toEqual({ enabled: false, hooks: { "pre-commit": false } });
        expect(existsSync(join(dataDir, "hooks"))).toBe(false);
      });
```

7. In "a hooks setting rt cannot read is shown once and logged", change both calls to `loadHooksConfig(["pre-commit"], IDENTITY)`.

- [ ] **Step 2: Run, expect FAIL**: `bun test commands/__tests__/hooks.test.ts` (signature mismatches, legacy file still read, machine value still wins, no refusal).

- [ ] **Step 3: Implement in `commands/hooks.ts`**

Replace the module doc's second and third paragraphs (lines 6-24) with:

```ts
 * core.hooksPath points at shim scripts in ~/.mattstack/rt/repos/<repo>/hooks/.
 * A shim greps ~/.mattstack/rt/repos/<repo>/hooks.json and delegates to the
 * real .husky/ script. That file must stay a zero-spawn grep target, because a
 * git hook runs on every git operation and cannot pay for a second process, so
 * it is a cache of `rt.hooks`, rewritten at every seam that can change the
 * resolved value: `rt hooks` itself, `rt settings set rt.hooks --repo`
 * (commands/settings-keys.ts), and `rt hooks status`, where a person notices a
 * stale cache, so it self-heals there. The cache is never renamed or unlinked
 * out from under the shim.
```

Imports: drop `readFileSync`; add `import { UserActionableError } from "../lib/errors.ts";`, `import { registryDefault } from "../lib/settings/presence.ts";`, and `unsetSetting` beside `setSetting`.

Replace everything from `const HOOKS_WRITE_SCOPE` through the end of `saveHooksConfig` (keeping `hooksConfigPath`, `regenerateHooksCache` and `refreshHooksCacheBestEffort`) with:

```ts
/** Your hook choices for a repo follow you to every Mac. */
const HOOKS_WRITE_SCOPE: SettingScope = "user";

function hooksConfigPath(dataDir: string): string {
  return join(dataDir, "hooks.json");
}

/** A store rt cannot read falls back to the registry default, with a warning that never echoes the store's value. */
function readHooksSetting(repoIdentity: string | null): Value<"rt.hooks"> {
  try {
    return getSetting<Value<"rt.hooks">>(SETTING_KEY, { repoIdentity }).value;
  } catch (err) {
    const message = (err as Error).message;
    warn("hooks", `ignoring "${SETTING_KEY}" -- ${message}`, {
      show: { title: "Your hooks setting is being ignored", hint: message.split("\n")[0], next: out.cmd("rt settings check") },
    });
    return registryDefault<Value<"rt.hooks">>(SETTING_KEY);
  }
}

/** The resolved config, with a hook the setting does not name turned on. Both the toggle UI and the cache read it. */
function loadHooksConfig(discoveredHooks: string[], repoIdentity: string | null): HooksConfig {
  const declared = readHooksSetting(repoIdentity);
  const hooks: Record<string, boolean> = {};
  for (const hook of discoveredHooks) hooks[hook] = declared.hooks?.[hook] !== false;
  return { enabled: declared.enabled !== false, hooks };
}
```

then, after `refreshHooksCacheBestEffort`:

```ts
/**
 * Writes your user settings, then drops this repo's machine value: an older
 * rt wrote there, and machine.repo outranks user.repo, so it would hide this
 * choice on this Mac.
 */
function saveHooksConfig(repoRoot: string, dataDir: string, config: HooksConfig, repoIdentity: string): void {
  try {
    setSetting(SETTING_KEY, config, HOOKS_WRITE_SCOPE, { repoIdentity });
    unsetSetting(SETTING_KEY, "machine", { repoIdentity });
  } catch (err) {
    throw new UserActionableError("hooks-not-saved", "Your hooks choice was not saved", {}, { why: (err as Error).message.split("\n")[0], next: "rt settings check" });
  }
  regenerateHooksCache(repoRoot, dataDir, repoIdentity);
}
```

In `regenerateHooksCache`, change its read to `const config = loadHooksConfig(discoveredHooks, repoIdentity);`; its doc comment stays.

In `toggleHooks`, right after the `derivedIdentity`/`repoIdentity` lines and before `loadHooksConfig`:

```ts
  if (repoIdentity === null) {
    out.note(out.line("refused", "This repo has no remote, so rt has nowhere to keep its hook choices"));
    process.exit(1);
  }
```

and change `loadHooksConfig(dataDir, discoveredHooks, repoIdentity)` to `loadHooksConfig(discoveredHooks, repoIdentity)`.

- [ ] **Step 4: Registry row**: in `registry-defs.ts`, make the `rt.hooks` row:

```ts
  {
    key: "rt.hooks",
    type: "object",
    scopes: ALL_SCOPES,
    default: { enabled: true },
    merge: "deep",
    repoScoped: true,
    repoOnly: true,
    description: "Per-repo git hook switches ({enabled, hooks: {<hookName>: boolean}}); a hook the map does not name runs. rt hooks writes your user settings, so a repo's choices follow you to every Mac. The git hook shim reads repos/<repo>/hooks.json, a cache rt rewrites from this key whenever rt hooks or rt settings set --repo changes it.",
  },
```

(`migrated: true` goes: the row has no legacy reader left.) In `registry-console-ready.test.ts`, remove `"rt.hooks"` from `PENDING_DEFAULT`. In `registry.test.ts`: the `rt.hooks is a repo-scoped field-bag object with no default ...` test becomes `"rt.hooks is a repo-scoped field-bag object that defaults to every hook on"` with `expect(def?.default).toEqual({ enabled: true });`; remove `"rt.hooks"` from both `migrated:true` lists (the `exactly 28 keys are migrated:true` test and `migratedTrueKeys`), add `"rt.hooks"` to `suiteKeys`, bump `expect(suiteKeys).toHaveLength(87)` to `88`, and change both test titles' migrated count from 28 to 27.

- [ ] **Step 5: Build and pass**

```bash
bun run --cwd packages/rt-client build
bun test commands/__tests__/hooks.test.ts commands/__tests__/settings-keys-hooks-regen.test.ts lib/daemon/__tests__/hooks-handlers.test.ts lib/daemon/__tests__/hooks-guard.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts packages/rt-client/src/settings/__tests__/schema-examples.test.ts lib/__tests__/no-raw-output.test.ts
```

Expected: PASS. If `settings-keys-hooks-regen.test.ts` asserts a cache built while nothing is set, its expectation becomes the default (every hook on).

- [ ] **Step 6: Commit**

```bash
git add commands/hooks.ts commands/__tests__/hooks.test.ts packages/rt-client/src/settings/registry-defs.ts packages/rt-client/src/settings/__tests__/registry.test.ts packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts
git commit -m "hooks: rt.hooks reads only the store and writes your user settings"
```

---

### Task 4: Retire the `preferences.md` writing-style rung

**Files:**
- Modify: `lib/skills/writing-style.ts`
- Modify: `lib/setup/validators/writing-style.ts:64`
- Modify: `lib/skills/__tests__/writing-style.test.ts`, `lib/setup/__tests__/validators-writing-style.test.ts:61-63`
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (`skills.writingStyle` row and its comment)
- Modify: `packages/rt-client/src/settings/__tests__/registry.test.ts:108-115`, `registry-console-ready.test.ts`
- Modify: `AGENTS.md` ("Writing-style presets"), `website/docs/skills/writing-styles.mdx:24`

**Interfaces:**
- Consumes: `onlyDefault`, `registryDefault` (Task 1).
- Produces: `resolveWritingStyle(opts?: { read?: (key: string) => Resolved<unknown> }): ResolvedWritingStyle`; `WritingStyleSource = "user" | "team" | "fallback"`; `FALLBACK_WRITING_STYLE` (now the registry default). Removed: `preferencesPath`, `parsePreferencesStyle` (Task 2 owns the parser now). `source: "fallback"` means exactly what `unwritten("skills.writingStyle")` means, on the same read, so `show` and the setup row cannot disagree.

- [ ] **Step 1: Write the failing tests**: replace `lib/skills/__tests__/writing-style.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getDef } from "../../settings/registry.ts";
import type { Resolved } from "../../settings/resolve.ts";
import { FALLBACK_WRITING_STYLE, isPresetId, isValidSkillId, resolveWritingStyle } from "../writing-style.ts";

const unset = (): Resolved<unknown> => ({ value: undefined, provenance: [] });
const onDefault = (): Resolved<unknown> => ({ value: FALLBACK_WRITING_STYLE, provenance: [{ scope: "default", file: null }] });
const at = (value: unknown, scope: "user" | "team" | "org"): Resolved<unknown> => ({ value, provenance: [{ scope, file: `/x/${scope}.jsonc` }] });

describe("isValidSkillId", () => {
  test("accepts plugin:name and bare names; refuses flags and paths", () => {
    for (const ok of ["mattstack:writing-style-sparse", "acme:team-writing-style", "team-voice", "a.b_c"]) expect(isValidSkillId(ok)).toBe(true);
    for (const bad of ["-rf", "../x", "a/b", "", "Upper", "a:b:c", " x"]) expect(isValidSkillId(bad)).toBe(false);
  });
});

describe("resolveWritingStyle", () => {
  test("a user value is yours", () => {
    expect(resolveWritingStyle({ read: () => at("mattstack:writing-style-sparse", "user") })).toEqual({ skill: "mattstack:writing-style-sparse", source: "user" });
  });
  test("a team or org value reads as the team default", () => {
    expect(resolveWritingStyle({ read: () => at("mattstack:writing-style-structured", "team") }).source).toBe("team");
    expect(resolveWritingStyle({ read: () => at("mattstack:writing-style-conversational", "org") }).source).toBe("team");
  });
  test("the registry default, or nothing at all, reads as not chosen", () => {
    expect(resolveWritingStyle({ read: onDefault })).toEqual({ skill: FALLBACK_WRITING_STYLE, source: "fallback" });
    expect(resolveWritingStyle({ read: unset })).toEqual({ skill: FALLBACK_WRITING_STYLE, source: "fallback" });
  });
  test("choosing conversational on purpose reads as chosen", () => {
    expect(resolveWritingStyle({ read: () => at(FALLBACK_WRITING_STYLE, "user") })).toEqual({ skill: FALLBACK_WRITING_STYLE, source: "user" });
  });
  test("an invalid stored value is skipped, not returned", () => {
    expect(resolveWritingStyle({ read: () => at("-rf", "user") }).source).toBe("fallback");
  });
  test("the fallback is the registry default and a preset", () => {
    expect(FALLBACK_WRITING_STYLE).toBe(getDef("skills.writingStyle")!.default as string);
    expect(isPresetId(FALLBACK_WRITING_STYLE)).toBe(true);
  });
});

describe("preferences.md", () => {
  const origHome = process.env.HOME;
  let home: string;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-writing-style-")));
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("its writing-style line is no longer read", () => {
    const dir = join(home, ".mattstack", "user", "skills");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "preferences.md"), "## Writing style\nwriting-style: `mattstack:writing-style-sparse`\n");
    expect(resolveWritingStyle()).toEqual({ skill: FALLBACK_WRITING_STYLE, source: "fallback" });
  });
});
```

In `lib/setup/__tests__/validators-writing-style.test.ts`, replace the "preferences.md and personal choices read ready with their source" test with:

```ts
  test("a personal choice reads ready as yours", () => {
    expect(writingStyleRow({ homeReady: true, resolved: { skill: "team-voice", source: "user" }, inventory: inv(["team-voice"]), options: opts }).detail).toBe("team-voice (yours)");
  });

  test("conversational chosen on purpose is ready, not asked again", () => {
    const r = writingStyleRow({ homeReady: true, resolved: { skill: "mattstack:writing-style-conversational", source: "user" }, inventory: inv(["mattstack:writing-style-conversational"]), options: opts });
    expect(r.status).toBe("ready");
    expect(r.detail).toBe("Conversational (yours)");
  });
```

- [ ] **Step 2: Run, expect FAIL**: `bun test lib/skills/__tests__/writing-style.test.ts lib/setup/__tests__/validators-writing-style.test.ts` (`resolveWritingStyle()` still reads `preferences.md`; the fallback is still a literal; a source of `"default"` provenance reads as `"user"`).

- [ ] **Step 3: Implement `lib/skills/writing-style.ts`**

Imports become:

```ts
import { onlyDefault, registryDefault } from "../settings/presence.ts";
import { getSetting, isSharedScope, type Resolved } from "../settings/resolve.ts";
```

Replace `FALLBACK_WRITING_STYLE`'s line with `export const FALLBACK_WRITING_STYLE = registryDefault<string>(WRITING_STYLE_KEY);` (move it below `WRITING_STYLE_KEY` if needed). `WritingStyleSource` becomes `"user" | "team" | "fallback"`; drop the `preferences` entry from `WRITING_STYLE_SOURCE_LABEL`. Delete `preferencesPath` and `parsePreferencesStyle`. Replace `resolveWritingStyle` with:

```ts
/** Not chosen means no store sets the key, so a value equal to the default still reads as someone's choice. */
export function resolveWritingStyle(opts: { read?: (key: string) => Resolved<unknown> } = {}): ResolvedWritingStyle {
  const read = opts.read ?? ((key: string) => getSetting<unknown>(key));
  const configured = read(WRITING_STYLE_KEY);
  const scope = configured.provenance.at(-1)?.scope;
  if (!onlyDefault(configured) && scope !== undefined && typeof configured.value === "string" && isValidSkillId(configured.value)) {
    return { skill: configured.value, source: isSharedScope(scope) ? "team" : "user" };
  }
  return { skill: FALLBACK_WRITING_STYLE, source: "fallback" };
}
```

In `lib/setup/validators/writing-style.ts:64`, change `resolveWritingStyle({ home: p.home })` to `resolveWritingStyle()`.

- [ ] **Step 4: Registry row**: in `registry-defs.ts`, delete the two comment lines under `// --- skills (writing style) ---` and add `default: "mattstack:writing-style-conversational",` after `scopes` on `skills.writingStyle`. Remove `"skills.writingStyle"` from `PENDING_DEFAULT`. In `registry.test.ts`, the test becomes `"skills.writingStyle is a user, team and org string that defaults to conversational"` with `expect(def!.default).toBe("mattstack:writing-style-conversational");`.

- [ ] **Step 5: Docs**

`AGENTS.md`, "Writing-style presets": replace the first sentence (from "Every review or reply" through "`mattstack:writing-style-conversational`.") with:

```markdown
Every review or reply an agent drafts composes in one writing style, resolved
by `resolveWritingStyle` in `lib/skills/writing-style.ts`: the
`skills.writingStyle` setting (user scope beats team), else its registry
default, `mattstack:writing-style-conversational`. A Mac where no store sets
the key reads as not chosen yet (`source: "fallback"`), which is what the
setup row asks about. rt no longer reads `~/.mattstack/user/skills/preferences.md`;
the `2026-10-10-import-legacy-settings` migration copied its `writing-style:`
line into the user store.
```

`website/docs/skills/writing-styles.mdx:24`: replace the line with

```markdown
Which style applies: the `skills.writingStyle` setting, where your user scope beats the team's. With neither set, it is `mattstack:writing-style-conversational`.
```

then `python3 skills/doc-standards/scripts/check_docs.py website/docs/skills/writing-styles.mdx --no-vale` (zero errors).

- [ ] **Step 6: Build and pass**

```bash
bun run --cwd packages/rt-client build
bun test lib/skills/__tests__/ lib/setup/__tests__/validators-writing-style.test.ts commands/__tests__/skills-writing-style.test.ts rt-tray/Tests/stub-rt packages/rt-client/src/settings/__tests__/registry.test.ts packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add lib/skills/writing-style.ts lib/skills/__tests__/writing-style.test.ts lib/setup/validators/writing-style.ts lib/setup/__tests__/validators-writing-style.test.ts packages/rt-client/src/settings/registry-defs.ts packages/rt-client/src/settings/__tests__/registry.test.ts packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts AGENTS.md website/docs/skills/writing-styles.mdx
git commit -m "skills: writing style defaults in the registry, preferences.md no longer read"
```

---

### Task 5: Retire the StrongDM file fallback and `rt.sdmEnrichment`

**Files:**
- Modify: `lib/sdm/enrichment.ts`
- Modify: `commands/sdm.ts` (`enrichmentBlocks`, `enrichmentCmd`, `enrichmentSkeleton`, imports)
- Modify: `lib/command-tree-def.ts:1120-1128` (`sdm enrichment` node)
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (wave-2 comment, `rt.sdmEnrichment` row, `sdm.*` rows)
- Modify: `packages/rt-client/src/settings/registry-machinery.ts:101` (`RETIRED_KEYS`)
- Modify: `packages/rt-client/src/settings/registry-schemas.ts:174`, `breaking-schema-changes.json`, `schema.lock.json` (regenerated)
- Modify: `packages/rt-client/src/settings/__tests__/schema-examples.ts:161-164`, `registry.test.ts`, `registry-console-ready.test.ts`
- Modify: `apps/console/src/app/settings/groups.ts:89`, `groups.test.ts:28-31`
- Modify: `lib/sdm/__tests__/enrichment.test.ts`, `lib/sdm/__tests__/enrichment-cmd.test.ts`, `commands/__tests__/sdm.test.ts:262-273`, `e2e/tests/sdm-enrichment.test.ts`
- Modify: `docs/strongdm.md:54`, `website/docs/rt/guides/strongdm.mdx:60`, generated `website/docs/rt/reference/sdm/*`

**Interfaces:**
- Consumes: `onlyDefault`, `registryDefault` (Task 1).
- Produces: `loadEnrichment(): Record<string, EnrichmentEntry>`, `loadCarriers(): CarrierNames`. Removed: `probeEnrichmentStore`, `enrichmentPath`, the `stripJsonc` re-export, `enrichmentSkeleton`. `enrichmentBlocks(enriched: number, total: number): Block[]`.

- [ ] **Step 1: Write the failing tests**

Replace `describe("stripJsonc", ...)` and `describe("loadEnrichment", ...)` in `lib/sdm/__tests__/enrichment.test.ts` (and drop `stripJsonc` from its import), keeping `writeStore` and `sharedStorePath`:

```ts
describe("loadEnrichment", () => {
  let logged: string[];
  let io: ReturnType<typeof captureOut>;
  const legacyFile = () => join(process.env.HOME!, ".mattstack", "rt", "sdm", "enrichment.jsonc");

  beforeEach(() => {
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "enr-home-")));
    warnings.reset();
    logged = [];
    setWarningLog((_module, message) => logged.push(message));
    io = captureOut();
    out.__test__.setHuman(() => false);
  });
  afterEach(() => {
    io.restore();
    warnings.reset();
  });

  test("nothing set: no labels, and no word about it", () => {
    expect(loadEnrichment()).toEqual({});
    expect(io.stderr()).toBe("");
  });

  test("reads your team's sdm.resources", () => {
    writeStore(sharedStorePath("acme"), { "sdm.resources": { "acme-db-qa": { label: "Acme QA", tier: "gold" } } });
    expect(loadEnrichment()).toEqual({ "acme-db-qa": { label: "Acme QA", tier: "gold" } });
  });

  test("the retired rt.sdmEnrichment is not read, and says nothing", () => {
    writeStore(sharedStorePath("acme"), { "rt.sdmEnrichment": { "acme-db-qa": { label: "old key" } } });
    expect(loadEnrichment()).toEqual({});
    expect(io.stderr()).toBe("");
  });

  test("an old labels file is not read: rt says once how your team's owner can move it", () => {
    mkdirSync(dirname(legacyFile()), { recursive: true });
    writeFileSync(legacyFile(), '{\n  // mine\n  "acme-db-qa": { "label": "It\'s QA" },\n}\n');
    expect(loadEnrichment()).toEqual({});
    expect(loadEnrichment()).toEqual({});
    expect(io.stderr()).toBe(
      "[warning] Your old StrongDM labels file is no longer read  your team's owner can copy it into your team's settings\n" +
        `  next: rt settings set sdm.resources '{"acme-db-qa":{"label":"It'\\''s QA"}}' --scope team\n`,
    );
    expect(logged[0]).toBe(`the old labels file ${legacyFile()} is no longer read`);
  });

  test("an old labels file says nothing once your team has labels", () => {
    mkdirSync(dirname(legacyFile()), { recursive: true });
    writeFileSync(legacyFile(), '{ "acme-db-qa": { "label": "x" } }');
    writeStore(sharedStorePath("acme"), { "sdm.resources": { "acme-db-qa": { label: "Acme QA" } } });
    expect(loadEnrichment()).toEqual({ "acme-db-qa": { label: "Acme QA" } });
    expect(io.stderr()).toBe("");
  });

  test("an old labels file rt cannot read is named without a command", () => {
    mkdirSync(dirname(legacyFile()), { recursive: true });
    writeFileSync(legacyFile(), "{ not json");
    expect(loadEnrichment()).toEqual({});
    expect(io.stderr()).toBe("[warning] Your old StrongDM labels file is no longer read  rt could not read it either\n");
  });
});
```

In the same file's `describe("enrichment warnings", ...)`: delete "a file that will not parse is logged..." and "a missing file is no warning at all"; rewrite "a setting the store cannot resolve..." to seed `{ "sdm.resources": { "acme-db-qa": { label: "${team:../x}" } } }`, call `loadEnrichment()`, and expect the log to start with `'ignoring "sdm.resources" -- '`; change its other `loadEnrichment(join(...))` calls to `loadEnrichment()`. `loadCarriers`'s tests stay.

Replace `lib/sdm/__tests__/enrichment-cmd.test.ts`'s body (drop `enrichmentSkeleton`, `enrichmentPath`, `stripJsonc`, `sharedStorePath` imports) with:

```ts
describe("enrichmentCmd", () => {
  let io: ReturnType<typeof captureOut>;

  beforeEach(() => {
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "enr-cmd-home-")));
    io = captureOut();
    out.__test__.setHuman(() => false);
  });
  afterEach(() => {
    io.restore();
    process.exitCode = 0;
  });

  test("an argument is refused, and no labels file is made", async () => {
    await enrichmentCmd(["init"]);
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("[refused] rt no longer makes a labels file  your team's labels live in your team's settings\n");
    expect(process.exitCode).toBe(1);
    expect(existsSync(join(process.env.HOME!, ".mattstack", "rt", "sdm", "enrichment.jsonc"))).toBe(false);
  });
});
```

In `commands/__tests__/sdm.test.ts:262-273`, drop the path argument and the `labels file:` line from every `enrichmentBlocks` expectation, for example:

```ts
    expect(renderPlain(__test__.enrichmentBlocks(2, 2))).toBe("[ok] Labels on all 2 connections\n");
    expect(renderPlain(__test__.enrichmentBlocks(0, 0))).toBe("[skipped] StrongDM shows no connections to label\n");
```

and the line-picking helper becomes `renderPlain(__test__.enrichmentBlocks(e, t)).split("\n")[0]`.

In `e2e/tests/sdm-enrichment.test.ts`, replace the two tests with:

```ts
  test("the count says how many connections have labels, with no file path", async () => {
    const res = await rt(["sdm", "enrichment"], { home, env: { RT_SDM_BIN: fakeSdm } });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Labels on 0 of 2 connections");
    expect(res.stdout).not.toContain("enrichment.jsonc");
  });

  test("an old labels file is not read, and rt says how to move it", async () => {
    mkdirSync(dirname(enrichmentPath), { recursive: true });
    writeFileSync(enrichmentPath, '{ "acme-alpha-staging": { "label": "Alpha" } }');
    const res = await rt(["sdm", "enrichment"], { home, env: { RT_SDM_BIN: fakeSdm } });
    expect(res.stdout).toContain("Labels on 0 of 2 connections");
    expect(res.stderr).toContain("Your old StrongDM labels file is no longer read");
    expect(res.stderr).toContain(`rt settings set sdm.resources '{"acme-alpha-staging":{"label":"Alpha"}}' --scope team`);
  });
```

(add `dirname` to its `path` import).

Registry tests: in `registry.test.ts`, replace the `rt.sdmEnrichment is a TEAM-ONLY map ...` test with

```ts
    test("rt.sdmEnrichment is retired: gone from the registry, still removable from a store", () => {
      expect(getDef("rt.sdmEnrichment")).toBeUndefined();
      expect(isRetiredKey("rt.sdmEnrichment")).toBe(true);
    });
```

change the `sdm.resources and sdm.carriers ...` test's title to end "default to empty" and its assertion to `expect(def?.default).toEqual({});`, remove `"rt.sdmEnrichment"` from both `migrated:true` lists, and change both titles' migrated count from 27 to 26. In `apps/console/src/app/settings/groups.test.ts`, the test becomes `"puts the sdm keys in the StrongDM group"` over `['sdm.resources', 'sdm.carriers']`.

- [ ] **Step 2: Run, expect FAIL**

```bash
bun test lib/sdm/__tests__/ commands/__tests__/sdm.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts
```

- [ ] **Step 3: Implement `lib/sdm/enrichment.ts`**

```ts
/**
 * Declarative enrichment overlay: labels, tiers and db defaults layered on
 * top of the resources the catalog scanner (scan.ts) found. The only source
 * is the team's `sdm.resources`, team-only because it names employer
 * resources. Loading never throws: a store rt cannot read means no labels.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripJsonc } from "../jsonc.ts";
import { rtDir } from "../rt-paths.ts";
import { onlyDefault, registryDefault } from "../settings/presence.ts";
import { getSetting, type Resolved } from "../settings/resolve.ts";
import type { Value } from "../settings/registry-schemas.ts";
import * as out from "../ui/out.ts";
import { warn } from "../ui/warn.ts";

export type EnrichmentEntry = Value<"sdm.resources">[string];
export type CarrierNames = Record<string, { label: string }>;

function read<T>(key: string, title: string): Resolved<T> {
  try {
    return getSetting<T>(key);
  } catch (err) {
    const message = (err as Error).message;
    warn("sdm", `ignoring "${key}" -- ${message}`, {
      show: { title, hint: message.split("\n")[0], next: out.cmd("rt settings check") },
    });
    return { value: registryDefault<T>(key), provenance: [] };
  }
}

/** Nothing reads the pre-store labels file; only a team owner can move it, so a member is told how. */
function noticeLegacyFile(): void {
  const path = join(rtDir(), "sdm", "enrichment.jsonc");
  if (!existsSync(path)) return;
  let value: string | null;
  try {
    value = JSON.stringify(JSON.parse(stripJsonc(readFileSync(path, "utf8"))));
  } catch {
    value = null;
  }
  const title = "Your old StrongDM labels file is no longer read";
  warn("sdm", `the old labels file ${path} is no longer read`, {
    context: { path },
    show:
      value === null
        ? { title, hint: "rt could not read it either" }
        : { title, hint: "your team's owner can copy it into your team's settings", next: out.cmd(`rt settings set sdm.resources '${value.replaceAll("'", "'\\''")}' --scope team`) },
  });
}

export function loadCarriers(): CarrierNames {
  return read<CarrierNames>("sdm.carriers", "Your sdm carrier names are being ignored").value;
}

export function loadEnrichment(): Record<string, EnrichmentEntry> {
  const resolved = read<Record<string, EnrichmentEntry>>("sdm.resources", "Your sdm enrichment setting is being ignored");
  if (onlyDefault(resolved)) noticeLegacyFile();
  return resolved.value;
}
```

- [ ] **Step 4: Implement the verb**: in `commands/sdm.ts`:

```ts
function enrichmentBlocks(enriched: number, total: number): Block[] {
  if (total === 0) return [out.line("skipped", "StrongDM shows no connections to label")];
  const noun = total === 1 ? "connection" : "connections";
  if (enriched === total) return [out.line("done", total === 1 ? "Labels on the 1 connection" : `Labels on all ${total} ${noun}`)];
  return [out.line("pending", `Labels on ${enriched} of ${total} ${noun}`, "the rest show their StrongDM names")];
}
```

```ts
/** `rt sdm enrichment`: how many scanned connections your team's labels cover. */
export async function enrichmentCmd(rest: string[]): Promise<void> {
  if (rest.length > 0) {
    out.note(out.line("refused", "rt no longer makes a labels file", "your team's labels live in your team's settings"));
    process.exitCode = 1;
    return;
  }
  const enr = loadEnrichment();
  const { resources } = await getScan();
  const enriched = resources.filter((r) => enr[r.name]).length;
  out.print(...enrichmentBlocks(enriched, resources.length));
}
```

Delete `enrichmentSkeleton` and its doc comment, change the import to `import { loadCarriers, loadEnrichment } from "../lib/sdm/enrichment.ts";`, and remove any import `tsc` then reports unused (`existsSync`, `mkdirSync`, `writeFileSync`, `dirname` if nothing else uses them). In `lib/command-tree-def.ts`, the node becomes:

```ts
      enrichment: {
        description: "See how many of your connections have labels",
        module: "./commands/sdm.ts",
        fn: "enrichmentCmd",
        args: [],
      },
```

- [ ] **Step 5: Retire the key in the registry**

`registry-defs.ts`: replace the four-line wave-2 comment with `// --- wave 2 (ports from rt's own files, RT-53) ---------------------------`, delete the `rt.sdmEnrichment` row and the two-line `sdm.*` comment, add `default: {},` after `scopes` on `sdm.resources` and `sdm.carriers`, and cut "Replaces rt.sdmEnrichment; the store value wins wholesale." from `sdm.resources`' description.

`registry-machinery.ts:101`: add `"rt.sdmEnrichment"` to `RETIRED_KEYS`.

`registry-schemas.ts:174`: delete the `"rt.sdmEnrichment"` entry. `schema-examples.ts`: delete its `"rt.sdmEnrichment"` entry. `breaking-schema-changes.json`: add

```json
  "rt.sdmEnrichment": "Retired: sdm.resources replaced it, and the 2026-10-07-sdm-resources-key migration moved stored values."
```

`registry-console-ready.test.ts`: remove `"rt.sdmEnrichment"` from `UNANNOTATED_YET` and remove `"rt.sdmEnrichment", "sdm.carriers", "sdm.resources"` from `PENDING_DEFAULT`. `apps/console/src/app/settings/groups.ts:89`: the match becomes `key => key.startsWith('sdm.')`.

- [ ] **Step 6: Docs**: replace the "rt reads overrides from `sdm.resources` first, ..." paragraph in both `docs/strongdm.md:54` and `website/docs/rt/guides/strongdm.mdx:60` with:

```markdown
rt reads overrides only from `sdm.resources` in your team's settings. `rt setup update` moved the older `rt.sdmEnrichment` key there on the Mac of the team's owner, and rt no longer reads it. rt no longer reads the local file `~/.mattstack/rt/sdm/enrichment.jsonc` either: when one is still there and your team has no overrides, rt prints the `rt settings set` command your team's owner can run to move it. `rt sdm enrichment` shows how many of your connections have labels.
```

Then `python3 skills/doc-standards/scripts/check_docs.py website/docs/rt/guides/strongdm.mdx --no-vale` (zero errors) and `bun run docs:gen` (the `sdm enrichment` reference page changes).

- [ ] **Step 7: Regenerate, build and pass**

```bash
env -i HOME="$(mktemp -d)" PATH="$PATH" bun run cli.ts settings schema lock
env -i HOME="$(mktemp -d)" PATH="$PATH" bun run cli.ts settings schema diff
bun run --cwd packages/rt-client build
bun run picker:check
bun test lib/sdm/__tests__/ commands/__tests__/sdm.test.ts packages/rt-client/src/settings/__tests__/ lib/setup/__tests__/migration-sdm-resources-key.test.ts commands/__tests__/member-upgrade.test.ts lib/__tests__/no-raw-output.test.ts
bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/sdm-enrichment.test.ts
cd apps/console && npx vitest run src/app/settings/groups.test.ts
```

Expected: `schema diff` reports no problem (the removed key is acknowledged); everything PASS. If the e2e harness keeps the warning off stderr, assert the same two strings against the CLI log it captures instead; do not drop the assertion.

- [ ] **Step 8: Commit**

```bash
git add lib/sdm commands/sdm.ts commands/__tests__/sdm.test.ts lib/command-tree-def.ts packages/rt-client/src/settings e2e/tests/sdm-enrichment.test.ts apps/console/src/app/settings/groups.ts apps/console/src/app/settings/groups.test.ts docs/strongdm.md website/docs/rt
git commit -m "sdm: read labels only from sdm.resources, retire rt.sdmEnrichment"
```

---

### Task 6: Retire the VS Code `branch-naming.json` import

**Files:**
- Modify: `extensions/vscode/rt-context/src/branchNaming.ts`
- Modify: `extensions/vscode/rt-context/src/branchSwitcher.ts:403`
- Modify: `extensions/vscode/rt-context/src/__tests__/branchNaming.test.ts`
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (`rt.branchNaming` row)
- Modify: `packages/rt-client/src/settings/__tests__/registry.test.ts`, `registry-console-ready.test.ts`
- Modify: `docs/settings-architecture.md:330`

**Interfaces:**
- Produces: `loadBranchNamingConfig(dataDir: string, repoIdentity: string | null): BranchNamingConfig` (never null now); `defaultBranchNaming(): BranchNamingConfig`; `resolveBranchName(ticket, config: BranchNamingConfig | null)` unchanged in signature.

- [ ] **Step 1: Write the failing tests**: replace the `describe('loadBranchNamingConfig', ...)` body in `branchNaming.test.ts` (drop `teamSettingsPath`, `seedTeamStore` and the `setSetting`-based org cases; keep the HOME and console spies), with:

```ts
  const DEFAULT = { template: '${identifier}-${titleSlug}' };
  const writeStore = (value: unknown) => {
    mkdirSync(join(home, '.mattstack', 'user'), { recursive: true });
    writeFileSync(userSettingsPath(home), JSON.stringify({ repos: { [IDENTITY]: { 'rt.branchNaming': value } } }));
  };

  test('nothing set -> the registry default', () => {
    expect(getDef('rt.branchNaming')!.default).toEqual(DEFAULT);
    expect(loadBranchNamingConfig(dataDir, IDENTITY)).toEqual(DEFAULT);
    expect(loadBranchNamingConfig(dataDir, null)).toEqual(DEFAULT);
  });

  test('a store value wins', () => {
    writeStore({ template: 'feature/${identifier}' });
    expect(loadBranchNamingConfig(dataDir, IDENTITY)).toEqual({ template: 'feature/${identifier}' });
  });

  test('an old branch-naming.json is not read or moved, and the warning names the command once', () => {
    writeLegacy(JSON.stringify({ template: 'legacy/${identifier}' }));
    expect(loadBranchNamingConfig(dataDir, IDENTITY)).toEqual(DEFAULT);
    expect(loadBranchNamingConfig(dataDir, IDENTITY)).toEqual(DEFAULT);
    expect(existsSync(legacyPath())).toBe(true);
    expect(getSetting('rt.branchNaming', { repoIdentity: IDENTITY }).provenance.every((p) => p.scope === 'default')).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]![0])).toContain(`rt settings set rt.branchNaming '{"template":"legacy/\${identifier}"}' --scope org --repo ${IDENTITY}`);
  });

  test('an old file says nothing once the store sets the key', () => {
    writeStore({ template: 'feature/${identifier}' });
    writeLegacy(JSON.stringify({ template: 'legacy/${identifier}' }));
    loadBranchNamingConfig(dataDir, IDENTITY);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('a malformed store value -> the default', () => {
    writeStore({ template: '' });
    expect(loadBranchNamingConfig(dataDir, IDENTITY)).toEqual(DEFAULT);
  });

  test('never throws: an unexpandable stored variable -> the default', () => {
    writeStore({ template: '${worktree}/x' });
    expect(loadBranchNamingConfig(join(home, 'missing'), IDENTITY)).toEqual(DEFAULT);
  });
```

(`getDef` joins the `@mattstack/rt-client` import. The once-per-file notice set lives for the whole file, which is safe because `beforeEach` gives every test a fresh `home` and so a fresh `dataDir`.)

- [ ] **Step 2: Run, expect FAIL**: `bun test extensions/vscode/rt-context/src/__tests__/branchNaming.test.ts` (from the repo root).

- [ ] **Step 3: Implement `branchNaming.ts`**: replace the module doc and everything above `mechanicalSlug` with:

```ts
/**
 * Branch naming template resolver, VS Code extension copy.
 *
 * Synchronous-only: supports ${identifier}, ${teamPrefix}, ${ticketNumber},
 * ${titleSlug}. ${llmSlug:N} falls back to a mechanical slug (LLM is CLI-only).
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getDef, getSetting } from '@mattstack/rt-client';

export interface BranchNamingConfig {
  template: string;
}

const SETTING_KEY = 'rt.branchNaming';

function asConfig(raw: unknown): BranchNamingConfig | null {
  const template = (raw as { template?: unknown } | null)?.template;
  if (typeof template !== 'string' || !template.trim()) return null;
  return { template: template.trim() };
}

export function defaultBranchNaming(): BranchNamingConfig {
  return asConfig(getDef(SETTING_KEY)?.default) as BranchNamingConfig;
}

const noticed = new Set<string>();

/** The pre-store file is no longer read. Only an org admin can move it, so say how, once per file. */
function noticeLegacyFile(dataDir: string, repoIdentity: string | null): void {
  const legacyPath = join(dataDir, 'branch-naming.json');
  if (noticed.has(legacyPath) || !existsSync(legacyPath)) return;
  noticed.add(legacyPath);
  let config: BranchNamingConfig | null;
  try {
    config = asConfig(JSON.parse(readFileSync(legacyPath, 'utf8')));
  } catch {
    config = null;
  }
  if (config === null || repoIdentity === null) {
    console.warn(`rt-context: ${legacyPath} is no longer read`);
    return;
  }
  const value = JSON.stringify(config).replaceAll("'", "'\\''");
  console.warn(`rt-context: ${legacyPath} is no longer read. An org admin can move it with: rt settings set rt.branchNaming '${value}' --scope org --repo ${repoIdentity}`);
}

/** Never throws: a store rt cannot read gives the default template. */
export function loadBranchNamingConfig(dataDir: string, repoIdentity: string | null): BranchNamingConfig {
  try {
    const resolved = getSetting<unknown>(SETTING_KEY, { repoIdentity });
    if (resolved.provenance.every((p) => p.scope === 'default')) noticeLegacyFile(dataDir, repoIdentity);
    return asConfig(resolved.value) ?? defaultBranchNaming();
  } catch {
    return defaultBranchNaming();
  }
}
```

In `resolveBranchName`, replace `const template = config?.template ?? "${identifier}-${titleSlug}";` with `const template = (config ?? defaultBranchNaming()).template;`. `branchSwitcher.ts:403` needs no change (its `null` for a repo with no data dir still reaches the default through `resolveBranchName`).

- [ ] **Step 4: Registry row**: `rt.branchNaming` gets `default: { template: "${identifier}-${titleSlug}" },` after `scopes`, loses `migrated: true`, and its description becomes `"Branch-naming template for a repo, read by the VS Code extension (extensions/vscode/rt-context). rt itself has no CLI-side reader."`. Remove `"rt.branchNaming"` from `PENDING_DEFAULT`. In `registry.test.ts`, remove `"rt.branchNaming"` from both `migrated:true` lists, add it to `suiteKeys`, bump `toHaveLength(88)` to `89`, and change both titles' migrated count from 26 to 25.

- [ ] **Step 5: Docs**: in `docs/settings-architecture.md:329-331`, remove `` `extensions/vscode/rt-context/src/branchNaming.ts`, `` from the reference implementations list (it no longer holds a latch).

- [ ] **Step 6: Build and pass**

```bash
bun run --cwd packages/rt-client build
bun test extensions/vscode/rt-context/src/__tests__/ packages/rt-client/src/settings/__tests__/registry.test.ts packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts packages/rt-client/src/settings/__tests__/schema-examples.test.ts commands/__tests__/repos-reidentify.test.ts lib/__tests__/repo-reidentify.test.ts
```

(`bundle-load.test.ts` rebuilds the extension and load-smokes it, which proves `getDef` bundles.)

- [ ] **Step 7: Commit**

```bash
git add extensions/vscode/rt-context/src packages/rt-client/src/settings/registry-defs.ts packages/rt-client/src/settings/__tests__/registry.test.ts packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts docs/settings-architecture.md
git commit -m "rt-context: branch naming reads only the store, default in the registry"
```

---

### Task 7: Final gates and the PR

**Files:** none new (regenerated outputs only, if a gate asks).

- [ ] **Step 1: Pending list is what the plan says**: `bun test packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts`, then confirm `PENDING_DEFAULT` holds exactly the 13 `board.*` keys, `deck.access`, `deck.apps`, `deck.platform`, `gitq.forges`, `gitq.workSlots` and `mattstack.roster`.

- [ ] **Step 2: Store and schema gates, isolated**

```bash
env -i HOME="$(mktemp -d)" PATH="$PATH" bun run cli.ts settings schema lock
git diff --exit-code packages/rt-client/src/settings/schema.lock.json
env -i HOME="$(mktemp -d)" PATH="$PATH" bun cli.ts settings check --json
bun test packages/rt-client/test/dist-freshness.test.ts
```

Expected: no lock diff; `{"ok":true,"findings":[]}` (a default is not a store value); dist fresh.

- [ ] **Step 3: Guards and copy snapshots**

```bash
bun test lib/__tests__/no-presence-by-undefined.test.ts lib/__tests__/no-shared-store-migrations.test.ts lib/__tests__/no-settings-bypass.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/picker-conformance.test.ts commands/__tests__/setup-copy.test.ts
```

`setup-copy` should pass unchanged (no row wording moved). If it fails only on a sentence this PR changed on purpose, update it with `bun test commands/__tests__/setup-copy.test.ts --update-snapshots` and say so in the PR; any other diff stops the task.

- [ ] **Step 4: Docs**: `bun run docs:check`, then `bun run docs:build`. Look at `/skills/writing-styles` and `/rt/guides/strongdm` in Fast Browser, light and dark (website `AGENTS.md`, "Writing a page", step 6), and say plainly anything that reads wrong.

- [ ] **Step 5: Full static gate**: `bun run check 2>&1 | tail -20`. Expected: PASS.

- [ ] **Step 6: Push and open the PR**: title `RT-487: settings defaults, part 2 (import and rt latches)`. Body: the import migration and what it copies; per key, the default added and the reader retired; the keys still pending and which PR takes each (board PR 3, gitq/deck PR 4, `mattstack.roster` with the board); the answer to each open question as applied. End with the attribution line. Then wait for CodeRabbit and CI (address every actionable finding) before asking Matt to merge.
