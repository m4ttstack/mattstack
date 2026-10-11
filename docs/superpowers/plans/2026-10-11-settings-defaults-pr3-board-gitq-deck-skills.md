# Settings defaults sweep, PR 3: board, gitq, deck, skills and docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The board, gitq and deck read their settings from the stores alone, every remaining key gets its registry `default` (or keeps its `defaultNote`), `PENDING_DEFAULT` and the presence guard's allowlist are gone, and the skills and docs describe defaults and provenance instead of the ownership latch.

**Architecture:** A second dated setup migration copies the last live board and gitq file values into the user and machine stores (deck copies its own fields at boot, see Open question 1). Each app then drops its file fallback in the same commit that gives its keys their registry defaults: the board builds its config from `getSetting` only (`boardSetting` degrades a resolver throw to the registry default), gitq reads `gitq.workSlots`/`gitq.forges`/`gitq.board` from the store, and deck keeps only its file-only fields in its files. The guard tests then lose their pending lists, and the `rt:settings` skill, the board's review and respond skills, the plugin's writing-style lookup and `docs/settings-architecture.md` are rewritten to the current mechanics.

**Tech Stack:** Bun + TypeScript (rt, rt-client, board, gitq, deck), `bun test` (rt from the repo root, board from `apps/board`, gitq from `apps/gitq`, deck from `apps/deck`), Vitest (console), Docusaurus (website), Markdown skills.

**Spec:** `docs/superpowers/specs/2026-10-10-settings-defaults-sweep-design.md` (Delivery items 3, 4 and 5; sections 4, 6 and 7; the appendix). What already landed: `docs/superpowers/plans/2026-10-10-settings-defaults-pr1-registry-console.md` and `docs/superpowers/plans/2026-10-10-settings-defaults-pr2-import-and-rt-latches.md`.

## Decisions (Matt, 2026-10-11)

Matt accepted every recommendation below; the tasks implement them. Each "Otherwise" line records the rejected alternative.

1. **Deck boots before the import runs.** The app starts deck, then runs `rt setup update` once its services settle (`AppDelegate.settleAgentsAfterLaunch`), and deck reads its settings once at boot with no reload. On a Mac whose store does not yet hold `deck.apps`, the new deck would read every app as published (the default) until its next restart, so an app someone made private would be public in that window; `deck.access` and `deck.platform` have the same gap. The spec (section 4) puts deck's import in the setup migration and does not cover this ordering.
   **Recommend:** deck copies its own migrated fields into the store at boot, before its first read (same rules as the migration: user or machine scope only, a store value wins, idempotent), and the rt migration covers only the board and gitq. A failed copy keeps that one boot on the file's values. Otherwise: Task 7's `importFileFields`/`importAccessFile` move into Task 2's migration and Task 7 gains a step that restarts deck after the migration copies anything.
2. **One migration or two.** The spec names one migration, `2026-10-10-import-legacy-settings`, for every source. PR 2 shipped it with the hooks and writing-style sources only; it is not in a release yet (last tag v2.24.0), but a dev Mac that ran `rt setup update` from the shared checkout may already have recorded it done, and a recorded migration never runs again.
   **Recommend:** a new dated migration, `2026-10-11-import-app-settings`, for the board and gitq files. Otherwise: Task 2 adds the readers to `import-legacy-settings.ts` and keeps its id.
3. **The `gitq.workSlots` seed.** `board.keys` writes `{ workSlotLocation: "<repo root>/.gitq-slots", maxWorkSlots: 3 }`, but gitq reads any `workSlotLocation` other than `root` as `auto`, so the seeded value behaves exactly like the new registry default and only shows a misleading path in the console.
   **Recommend:** delete the seed (Task 5). Otherwise: keep it, and Task 5 leaves `lib/setup/steps/skills.ts`'s `gitq.workSlots` block and its tests alone.
4. **The `gitq.board` seed with no tracked repos.** It writes `{ repos: [], port: 11008 }`, which gitq's own validator refuses ("needs a non-empty repos array"), so the gitq board fails to boot.
   **Recommend:** leave `gitq.board` unset and log why, the way `board.cwds` already does (Task 5). Otherwise: keep writing the empty list.
5. **Seeded `gitq.board` values already on Macs.** Every Mac set up before this PR holds `gitq.board.repos` as bare names, which gitq refuses, and the seed never rewrites a value that is set.
   **Recommend:** the new migration rewrites each name to `{ path, name }` from the repo index, machine scope, and leaves the value alone (named in its outcome) when any name is not on this Mac (Task 2). Otherwise: drop `repairGitqBoard` from Task 2.
6. **Team-scope fields in an old board `config.json`.** A migration may write only user and machine scope (spec section 4), so `gitlabHost`, `projects`, `members`, `title`, `botUsernames`, `ticketPrefixes`, `slack`, `doctorSkill`, `tabs` and `triage.doctorSkill` stay in `config.json.imported`.
   **Recommend:** the outcome says so in one sentence ("Your old board file also holds team settings, which a team admin sets") and prints no commands. Otherwise: name the `rt settings set ... --scope team` commands, as PR 2 did for StrongDM.

## Settled by the spec

- Migrations write only the user and machine stores, skip a key a store already sets, and rename an imported file `<name>.imported` (section 4).
- No app reads its old config file as a settings fallback (Outcome). The board's `claudeCommand` escape hatch and its `rtRepos` overrides only ever came from `config.json` and go with it (section 4, board bullet): `rtRepoOverrides` has no reader outside `withBoardStoreFallback`, so `rtRepos` is derived from `board.gitlabHost` and `board.projects` alone.
- Deck's file-only fields (the secret, password hashes, live state, `tlds`, `secrets`) stay in its files; `access.json` is no longer written (section 4, deck bullet).
- `gitq.board` keeps no default; its note stays (appendix, kind N).
- An empty-means-none key gets `[]` or `{}` (appendix, kind E).
- `retire-switchboard-url.ts`'s file edit stays as a migration that has run (section 4).
- Every remaining presence check on a registered key is fixed in this plan (section 3): `rt team status` and `rt team invite` name a team by `board.title`, which now has a default, so their readers ask for a store value (Task 1).

## Keys in this PR

| Key | Registry | Task |
|---|---|---|
| `board.title` | `default: "MRs ready for review"` | 3 |
| `board.botUsernames`, `board.hiddenMembers`, `mattstack.roster` | `default: []` | 3 |
| `board.cwds` | `default: {}` | 3 |
| `board.slack` | `default: { reviewKind: "review", singleTemplate: "{title}: {url}", multiHeader: "{count} MR's ready for review :pray:", multiItem: "- {title}: {url}", autoResolveIntervalMinutes: 15, emoji: { looking: "eyes", commented: "speech_balloon", approved: "white_check_mark" } }` (the board's `DEFAULT_SLACK` without the directory's channel, plus the `review` kind the reader assumed) | 3 |
| `board.doctorSkill`, `board.triage.doctorSkill` | `default: ""` | 3 |
| `board.tabs` | `default: [{ id: "team", label: "Team", source: { kind: "authors" } }]` | 3 |
| `board.gateGraceMinutes` | `default: 90` | 3 |
| `board.workspaces` | `default: { reviews: "reviews", responds: "responses", doctors: "doctors" }` | 3 |
| `board.defaultMember` | `default: "all"` | 3 |
| `board.triage` | `default: { enabled: false, cooldownMinutes: 30, dailyAttemptBudget: 3, fixClasses: { retryFlake: true, inheritedNoteDraft: true, cleanApiRebase: false, mechanicalLint: false, codeFix: false }, tier: "api", notify: "rt" }` (`parseTriageBlock(undefined)` without its two sibling keys) | 3 |
| `board.triageMaxConcurrent` | `default: 2` | 3 |
| `gitq.workSlots` | `default: { workSlotLocation: "auto", maxWorkSlots: 3 }` | 5 |
| `gitq.forges` | `default: {}` | 5 |
| `deck.apps`, `deck.access` | `default: {}` | 7 |
| `deck.platform` | `default: { publicDomain: null, legacyPrefixes: [], railway: null, tunnel: null }` | 7 |

After Task 7 every registry row has a `default` or a `defaultNote`, and Task 9 deletes `PENDING_DEFAULT`.

Readers that keep working unchanged with the new defaults (checked, no edit): `lib/team/peer.ts:45` already skips `board.defaultMember === "all"`; `lib/setup/steps/skills.ts` asks `unwritten("board.cwds")` and `unwritten("board.defaultMember")`; `lib/setup/team-settings.ts` `readTeamSnapshot` and `commands/team.ts:917,988` treat a missing roster as `[]`; `apps/boxscore/src/server/config/index.ts:107` reads the roster through `rosterEntries`.

## Global Constraints

- Work in `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-mattstack/celeborn` on branch `rt-487-settings-defaults-pr3`. Run only the targeted tests each task names; CI runs the full suites.
- Where each suite runs: rt's `bun test` from the repo root (bunfig preload); the board's from `apps/board` (`cd apps/board && bun test <files>`); gitq's from `apps/gitq`; deck's from `apps/deck`; the console's Vitest from `apps/console` (`npx vitest run <file>`).
- A setup migration writes only the user and machine stores: every `setSetting`/`unsetSetting` in `lib/setup/migrations/` passes the scope as the literal `"user"` or `"machine"` (`lib/__tests__/no-shared-store-migrations.test.ts`), and never names an org or team store path.
- The import never overwrites a value any store holds, including a value the resolver refused. It is idempotent and records `done` or `skipped`; only a write that fails is `failed`, so it reruns. A file it cannot fully read is left where it is.
- No app reads its old config file as a settings fallback. Deck keeps only its file-only fields in its files.
- A key leaves `PENDING_DEFAULT` in the same commit that gives it a default, and a latched key gets its default in the commit that deletes its latch (spec, Delivery item 1).
- A reader drops its own `?? fallback` for a key with a registry default and reads `getSetting(k).value`. A resolver throw degrades to the key's registry default after one warning: `getDef(key)!.default` in an app, `registryDefault(key)` in rt.
- "Has anyone set this?" is provenance (`unwritten`/`onlyDefault` in rt, `resolved.provenance.every((p) => p.scope === "default")` in an app), never `.value === undefined` or `!== undefined`.
- After touching `packages/rt-client/src`, run `bun run --cwd packages/rt-client build` before testing any consumer (stale `dist/` footgun). After a registry change, run `env -i HOME="$(mktemp -d)" PATH="$PATH" bun run cli.ts settings schema lock`; this PR changes no schema, so the lock must not move.
- A built binary, or `bun run cli.ts` doing anything that touches HOME, runs only as `env -i HOME="$(mktemp -d)" PATH="$PATH" ...`.
- No real org, team, repo or person names in code, tests, fixtures or docs: acme, widgets, gadgets, gitlab.example.com, example.com, dev1, dev2.
- Comments only state a constraint the code cannot show.
- Everything rt prints for a person goes through `lib/ui/out.ts`; a migration's `detail` and `remedy` are plain sentences to "you" with no flags, store names, file paths or step ids (root `AGENTS.md`, "Output layer" and "Command descriptions are plain language").
- Skills change only in Task 10, which loads `superpowers:writing-skills` and `mattstack:editing-skills` first. A board skill is edited only in `apps/board/skills-src/` and expanded with `bun run skills:expand:board`. A change under `plugins/mattstack` bumps `.claude-plugin/plugin.json`'s version.
- Git: one git command per Bash call, no `git -C`, no compound git commands.

## Review Focus

- A deck app someone made private stays private through the upgrade: with `published: false` only in `settings.json`, the first boot of the new deck reads it as private, and still does when the store copy fails. Pinned in Task 7.
- A board configured only through the team store boots exactly as today with nothing personal set: title, one Team tab, workspaces, Slack templates, a 90-minute gate grace, triage off with two panes. Pinned in Task 3 by a load test and by tests that the registry defaults equal the board's own parsers.
- A team with no `board.title` is named by its slug in `rt team status` and in an invite, never "MRs ready for review". Pinned in Task 1 (`storedValue` on a defaulted key) and Task 3 (`storedValue("board.title")`).
- An old file that will not parse, or holds a value its key's schema refuses, is left where it is, unrenamed; a value any store holds is never overwritten; a second run copies nothing. Pinned in Task 2.
- A malformed store file never takes the board, gitq or deck down: each reads the key's registry default after one warning, and deck minting its secret on a fresh install writes no settings store. Pinned in Tasks 3, 5 and 7.

---

### Task 1: Store-value reads for team names, and tests that lean on default-less keys

**Files:**
- Modify: `lib/settings/presence.ts`
- Test: `lib/settings/__tests__/presence.test.ts`
- Modify: `commands/team.ts:820-828` (`defaultStatusRead`)
- Modify: `lib/team/invite.ts:141-150` (`defaultRead`)
- Modify: `lib/setup/migrations/import-legacy-settings.ts:25-29` (export `storeHolds`)
- Modify: `packages/rt-client/src/settings/__tests__/resolve.test.ts:364-369`
- Modify: `commands/__tests__/settings-get.test.ts:48-52`

**Interfaces:**
- Produces: `storedValue<T>(key: string, opts?: ResolveOpts): T | undefined` from `lib/settings/presence.ts`: the value a store sets, `undefined` when only the registry default (or nothing) answers or the resolver throws.
- Produces: `storeHolds(key: string, opts?: ResolveOpts): boolean`, now exported from `lib/setup/migrations/import-legacy-settings.ts` (Task 2 uses it).

- [ ] **Step 1: Write the failing test**

Add to the `describe("presence", ...)` block in `lib/settings/__tests__/presence.test.ts`, and add `storedValue` to its import from `../presence.ts`:

```ts
  test("storedValue reads a store's value and treats the registry default as nobody's choice", () => {
    expect(storedValue("rt.cron")).toBeUndefined();
    setSetting("rt.cron", { triggers: [] }, "machine");
    expect(storedValue("rt.cron")).toEqual({ triggers: [] });
    expect(storedValue("no.such.key")).toBeUndefined();
  });
```

- [ ] **Step 2: Run it, expect FAIL**: `bun test lib/settings/__tests__/presence.test.ts` (`storedValue` is not exported).

- [ ] **Step 3: Implement `storedValue`** in `lib/settings/presence.ts`, after `unwritten`:

```ts
/**
 * For code that describes what a team or person chose: a registry default is
 * nobody's choice, so it reads as unset, and so does a key the resolver
 * cannot read.
 */
export function storedValue<T>(key: string, opts: ResolveOpts = {}): T | undefined {
  try {
    const resolved = getSetting<T>(key, opts);
    return onlyDefault(resolved) ? undefined : resolved.value;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Point the team-name readers at it**

`commands/team.ts`: replace `defaultStatusRead` with

```ts
function defaultStatusRead(): SettingsReader {
  return storedValue;
}
```

and add `import { storedValue } from "../lib/settings/presence.ts";` beside the other `lib/settings` imports. Keep the `getSetting` import (line 988 still uses it).

`lib/team/invite.ts`: replace `defaultRead` (and its doc comment) with

```ts
/** A team's own values only, so a team with no title of its own is named by its slug. */
function defaultRead(): SettingsReader {
  return storedValue;
}
```

and add `import { storedValue } from "../settings/presence.ts";`. Remove the `getSetting` import from `invite.ts` if nothing else in the file uses it (`rg -n "getSetting" lib/team/invite.ts`).

- [ ] **Step 5: Export `storeHolds`**: in `lib/setup/migrations/import-legacy-settings.ts`, change `function storeHolds(` to `export function storeHolds(`.

- [ ] **Step 6: Move two tests off keys that are about to get defaults**

`packages/rt-client/src/settings/__tests__/resolve.test.ts:364-369`: the test "a key with no default and nothing set resolves to undefined with no items" reads `chat.handle` instead of `gitq.workSlots` (an identity key that never gets a default, spec section 1):

```ts
    test("a key with no default and nothing set resolves to undefined with no items", () => {
      const got = getSetting<unknown>("chat.handle");
      expect(got.value).toBeUndefined();
      expect(got.provenance).toEqual([]);
      expect(got.items).toBeUndefined();
    });
```

`commands/__tests__/settings-get.test.ts:48-52`: the test "an unset key prints no value on stdout" calls `settingsGet(["chat.handle"])` instead of `["board.title"]`.

- [ ] **Step 7: Run, expect PASS**

```bash
bun test lib/settings/__tests__/presence.test.ts packages/rt-client/src/settings/__tests__/resolve.test.ts commands/__tests__/settings-get.test.ts commands/__tests__/team-status.test.ts lib/team/__tests__/invite.test.ts lib/setup/__tests__/migration-import-legacy-settings.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add lib/settings/presence.ts lib/settings/__tests__/presence.test.ts commands/team.ts lib/team/invite.ts lib/setup/migrations/import-legacy-settings.ts packages/rt-client/src/settings/__tests__/resolve.test.ts commands/__tests__/settings-get.test.ts
```

```bash
git commit -m "settings: team names read store values; tests stop leaning on keys about to get defaults"
```

---

### Task 2: The import migration for the board and gitq files

**Files:**
- Create: `lib/setup/migrations/import-app-settings.ts`
- Modify: `lib/setup/migrations/index.ts` (import, append to `MIGRATIONS`)
- Create: `lib/setup/__tests__/migration-import-app-settings.test.ts`
- Modify: `lib/setup/__tests__/migration-import-legacy-settings.test.ts:61-64` ("is the last migration")

**Interfaces:**
- Consumes: `storeHolds` (Task 1); `boardRoots`, `sourceBoardRoots` (`lib/team/board-token.ts`); `repoBasename` (`lib/setup/steps/repos.ts`); `getKnownRepos` (`lib/repo-index.ts`); `validateWrite` (`packages/rt-client/src/settings/validate-write.ts`).
- Produces: `importAppSettingsMigration: MigrationDef` (id `2026-10-11-import-app-settings`); `boardCopies(config: Record<string, unknown>): Copy[]`; `interface Copy { key: string; scope: "user" | "machine"; value: unknown }`.

What it copies (Open questions 2, 5 and 6):

| File | Field | Key | Scope |
|---|---|---|---|
| board `config.json` (first of `boardRoots(p, sourceBoardRoots())` holding one) | `defaultMember`, `staleAfterDays` (not null), `gateGraceMinutes` | `board.defaultMember`, `board.staleAfterDays`, `board.gateGraceMinutes` | user |
| | `reviewsWorkspace`, `respondsWorkspace`, `doctorsWorkspace` | `board.workspaces` `{ reviews, responds, doctors }` (present fields only) | user |
| | `members[].hidden === true` | `board.hiddenMembers` (usernames) | user |
| | `triage` without `doctorSkill` and `maxConcurrent` | `board.triage` | user |
| | `triage.maxConcurrent` | `board.triageMaxConcurrent` | machine |
| | `reviewCwd`, `respondCwd`, `doctorCwd` | `board.cwds` `{ review, respond, doctor }` (present fields only) | machine |
| gitq `<GITQ_APP_ROOT or ~/.mattstack/gitq>/settings.json` | `forges` | `gitq.forges` | user |
| | `workSlotLocation`, `maxWorkSlots` | `gitq.workSlots` (present fields only) | machine |
| gitq `<root>/config.json` | `repos` (non-empty, every entry `{ path }`), `port`, `herdrWorkspace` | `gitq.board` | machine |
| the machine store's `gitq.board` | a `repos` entry that is a bare name | `{ path, name }` from the repo index | machine |

- [ ] **Step 1: Write the failing tests**

`lib/setup/__tests__/migration-import-app-settings.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { updateRepoIndex } from "../../repo-index.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting, setSettingsNoticeSink } from "../../settings/write.ts";
import type { ApplyContext } from "../apply.ts";
import { MIGRATIONS } from "../migrations/index.ts";
import { boardCopies, importAppSettingsMigration } from "../migrations/import-app-settings.ts";
import { importLegacySettingsMigration } from "../migrations/import-legacy-settings.ts";
import { fakeProbes } from "./fakes.ts";

const NOTHING = { state: "skipped", detail: "There were no old board or gitq settings to copy" };

describe("2026-10-11-import-app-settings", () => {
  const origHome = process.env.HOME;
  let home: string;
  let previousSink: ReturnType<typeof setSettingsNoticeSink>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-import-apps-")));
    process.env.HOME = home;
    previousSink = setSettingsNoticeSink(() => {});
  });

  afterEach(() => {
    setSettingsNoticeSink(previousSink);
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  const boardFile = () => join(home, ".mattstack", "board", "config.json");
  const gitqFile = (name: string) => join(home, ".mattstack", "gitq", name);
  function run(files: Record<string, unknown> = {}, env: Record<string, string> = {}) {
    const body = Object.fromEntries(Object.entries(files).map(([path, v]) => [path, typeof v === "string" ? v : JSON.stringify(v)]));
    const p = fakeProbes({ home, env, files: body });
    return { p, outcome: importAppSettingsMigration.run({ p } as unknown as ApplyContext) };
  }
  const stores = (key: string) => getSetting(key).provenance.filter((row) => row.scope !== "default").map((row) => row.scope);

  test("runs right after the hooks and writing-style import", () => {
    expect(MIGRATIONS.at(-1)).toBe(importAppSettingsMigration);
    expect(MIGRATIONS.at(-2)).toBe(importLegacySettingsMigration);
    expect(importAppSettingsMigration.id).toBe("2026-10-11-import-app-settings");
  });

  test("with no old files it is skipped", async () => {
    expect(await run().outcome).toEqual(NOTHING);
  });

  test("copies the board's personal fields into your user and machine settings and moves the file aside", async () => {
    const { p, outcome } = run({
      [boardFile()]: {
        gitlabHost: "gitlab.example.com",
        projects: ["acme/widgets"],
        members: [{ username: "dev1" }, { username: "dev2", hidden: true }],
        defaultMember: "dev1",
        gateGraceMinutes: 45,
        reviewsWorkspace: "rev",
        reviewCwd: "/work/widgets",
        triage: { enabled: true, maxConcurrent: 4, doctorSkill: "acme:doctor" },
      },
    });
    expect(await outcome).toEqual({
      state: "done",
      detail: "Copied 7 old board or gitq settings into your settings. Your old board file also holds team settings, which a team admin sets",
    });
    expect(getSetting("board.defaultMember").value).toBe("dev1");
    expect(getSetting("board.gateGraceMinutes").value).toBe(45);
    expect(getSetting("board.hiddenMembers").value).toEqual(["dev2"]);
    expect(getSetting("board.workspaces").value).toMatchObject({ reviews: "rev" });
    expect(stores("board.workspaces")).toEqual(["user"]);
    expect(getSetting("board.cwds").value).toEqual({ review: "/work/widgets" });
    expect(stores("board.cwds")).toEqual(["machine"]);
    expect(getSetting("board.triage").value).toMatchObject({ enabled: true });
    expect(getSetting("board.triageMaxConcurrent").value).toBe(4);
    expect(getSetting("board.gitlabHost").value).toBeUndefined();
    expect(p.calls.renames).toContainEqual([boardFile(), `${boardFile()}.imported`]);
  });

  test("a value a store already holds is kept, and the file still moves aside", async () => {
    setSetting("board.defaultMember", "dev2", "user");
    const { p, outcome } = run({ [boardFile()]: { defaultMember: "dev1" } });
    expect(await outcome).toEqual(NOTHING);
    expect(getSetting("board.defaultMember").value).toBe("dev2");
    expect(p.calls.renames).toContainEqual([boardFile(), `${boardFile()}.imported`]);
  });

  test("a file that will not parse is left where it is and is not a failure", async () => {
    const { p, outcome } = run({ [boardFile()]: "{ not json" });
    expect(await outcome).toEqual({ state: "skipped", detail: "There were no old board or gitq settings to copy. 1 old file has a value rt could not read, so rt left it where it is" });
    expect(p.calls.renames).toEqual([]);
  });

  test("a field its key refuses is not copied, the rest are, and the file stays", async () => {
    const { p, outcome } = run({ [boardFile()]: { defaultMember: "dev1", gateGraceMinutes: "soon" } });
    expect(await outcome).toEqual({
      state: "done",
      detail: "Copied 1 old board or gitq setting into your settings. 1 old file has a value rt could not read, so rt left it where it is",
    });
    expect(getSetting("board.defaultMember").value).toBe("dev1");
    expect(p.calls.renames).toEqual([]);
  });

  test("a second run copies nothing more", async () => {
    await run({ [boardFile()]: { defaultMember: "dev1" } }).outcome;
    expect(await run().outcome).toEqual(NOTHING);
  });

  test("copies gitq's settings.json and config.json into their keys", async () => {
    const { p, outcome } = run({
      [gitqFile("settings.json")]: { maxWorkSlots: 5, workSlotLocation: "root", forges: { "gitlab.example.com": { provider: "gitlab" } } },
      [gitqFile("config.json")]: { repos: [{ path: "/work/widgets" }], port: 11009 },
    });
    expect((await outcome).state).toBe("done");
    expect(getSetting("gitq.workSlots").value).toEqual({ maxWorkSlots: 5, workSlotLocation: "root" });
    expect(stores("gitq.workSlots")).toEqual(["machine"]);
    expect(getSetting("gitq.forges").value).toEqual({ "gitlab.example.com": { provider: "gitlab" } });
    expect(stores("gitq.forges")).toEqual(["user"]);
    expect(getSetting("gitq.board").value).toEqual({ repos: [{ path: "/work/widgets" }], port: 11009 });
    expect(p.calls.renames).toContainEqual([gitqFile("settings.json"), `${gitqFile("settings.json")}.imported`]);
    expect(p.calls.renames).toContainEqual([gitqFile("config.json"), `${gitqFile("config.json")}.imported`]);
  });

  test("GITQ_APP_ROOT names gitq's folder, as it does for gitq", async () => {
    const root = join(home, "elsewhere");
    await run({ [join(root, "settings.json")]: { maxWorkSlots: 2 } }, { GITQ_APP_ROOT: root }).outcome;
    expect(getSetting("gitq.workSlots").value).toMatchObject({ maxWorkSlots: 2 });
  });

  test("a gitq board config gitq itself would refuse is not copied", async () => {
    expect(await run({ [gitqFile("config.json")]: { repos: [] } }).outcome).toEqual({
      state: "skipped",
      detail: "There were no old board or gitq settings to copy. 1 old file has a value rt could not read, so rt left it where it is",
    });
    expect(getSetting("gitq.board").value).toBeUndefined();
  });

  test("a gitq.board saved as repo names gets each repo's folder from the repo index", async () => {
    const repoDir = mkdtempSync(join(home, "widgets-"));
    updateRepoIndex(basename(repoDir), repoDir);
    setSetting("gitq.board", { repos: [basename(repoDir)], port: 11008 }, "machine");
    expect(await run().outcome).toEqual({ state: "done", detail: "Gave each repo on your gitq board its folder" });
    expect(getSetting("gitq.board").value).toEqual({ repos: [{ path: repoDir, name: basename(repoDir) }], port: 11008 });
  });

  test("a gitq.board naming a repo this Mac does not have is left as it was", async () => {
    setSetting("gitq.board", { repos: ["nowhere"], port: 11008 }, "machine");
    expect(await run().outcome).toEqual({ state: "skipped", detail: "There were no old board or gitq settings to copy. Some repos on your gitq board are not on this Mac, so rt left that setting as it was" });
    expect(getSetting("gitq.board").value).toEqual({ repos: ["nowhere"], port: 11008 });
  });

  test("boardCopies maps only fields that have a user or machine key", () => {
    expect(boardCopies({ title: "Widgets", claudeCommand: "x", rtRepos: { a: "b" }, staleAfterDays: null })).toEqual([]);
    expect(boardCopies({ respondCwd: "/r" })).toEqual([{ key: "board.cwds", scope: "machine", value: { respond: "/r" } }]);
  });
});
```

If `updateRepoIndex` records a different path than `repoDir` (a realpath), compare with `realpathSync` on both sides in that one test rather than changing the migration.

In `lib/setup/__tests__/migration-import-legacy-settings.test.ts`, replace the test "is the last migration" with:

```ts
  test("runs after the board cron migration", () => {
    expect(MIGRATIONS.indexOf(importLegacySettingsMigration)).toBeGreaterThan(MIGRATIONS.findIndex((m) => m.id === "2026-10-10-board-cron-by-tool"));
    expect(importLegacySettingsMigration.id).toBe("2026-10-10-import-legacy-settings");
  });
```

- [ ] **Step 2: Run, expect FAIL**: `bun test lib/setup/__tests__/migration-import-app-settings.test.ts` (cannot resolve `../migrations/import-app-settings.ts`).

- [ ] **Step 3: Implement `lib/setup/migrations/import-app-settings.ts`**

```ts
import { join, resolve } from "path";
import { validateWrite } from "../../../packages/rt-client/src/settings/validate-write.ts";
import { getKnownRepos } from "../../repo-index.ts";
import { onlyDefault } from "../../settings/presence.ts";
import { getDef } from "../../settings/registry.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import { boardRoots, sourceBoardRoots } from "../../team/board-token.ts";
import type { StepOutcome } from "../apply.ts";
import type { Probes } from "../probes.ts";
import { repoBasename } from "../steps/repos.ts";
import { storeHolds } from "./import-legacy-settings.ts";
import type { MigrationDef } from "./index.ts";

export interface Copy {
  key: string;
  scope: "user" | "machine";
  value: unknown;
}

interface Tally {
  copied: number;
  repaired: boolean;
  unrepaired: boolean;
  teamFields: boolean;
  leftInPlace: number;
  failed: string[];
}

type FileProbes = Pick<Probes, "home" | "env" | "exists" | "readFile" | "rename">;
type Reader = (parsed: Record<string, unknown>) => Copy[] | null;

const BOARD_TEAM_FIELDS = ["gitlabHost", "projects", "members", "title", "botUsernames", "ticketPrefixes", "slack", "doctorSkill", "tabs"];

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstLine(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0]!;
}

function picked(source: Record<string, unknown>, fields: Record<string, string>): Record<string, unknown> | null {
  const out = Object.fromEntries(Object.entries(fields).filter(([, from]) => source[from] !== undefined).map(([to, from]) => [to, source[from]]));
  return Object.keys(out).length > 0 ? out : null;
}

/** The fields of the board's config.json that have a user or machine key; the team's are an admin's to set. */
export function boardCopies(c: Record<string, unknown>): Copy[] {
  const copies: Copy[] = [];
  for (const [field, key] of [["defaultMember", "board.defaultMember"], ["staleAfterDays", "board.staleAfterDays"], ["gateGraceMinutes", "board.gateGraceMinutes"]] as const) {
    if (c[field] !== undefined && c[field] !== null) copies.push({ key, scope: "user", value: c[field] });
  }
  const workspaces = picked(c, { reviews: "reviewsWorkspace", responds: "respondsWorkspace", doctors: "doctorsWorkspace" });
  if (workspaces) copies.push({ key: "board.workspaces", scope: "user", value: workspaces });
  const hidden = Array.isArray(c.members)
    ? c.members.filter((m): m is { username: string } => isObject(m) && m.hidden === true && typeof m.username === "string").map((m) => m.username)
    : [];
  if (hidden.length > 0) copies.push({ key: "board.hiddenMembers", scope: "user", value: hidden });
  if (isObject(c.triage)) {
    const { doctorSkill: _teamKey, maxConcurrent, ...flags } = c.triage;
    if (Object.keys(flags).length > 0) copies.push({ key: "board.triage", scope: "user", value: flags });
    if (maxConcurrent !== undefined) copies.push({ key: "board.triageMaxConcurrent", scope: "machine", value: maxConcurrent });
  }
  const cwds = picked(c, { review: "reviewCwd", respond: "respondCwd", doctor: "doctorCwd" });
  if (cwds) copies.push({ key: "board.cwds", scope: "machine", value: cwds });
  return copies;
}

function boardTeamFields(c: Record<string, unknown>): boolean {
  return BOARD_TEAM_FIELDS.some((field) => c[field] !== undefined) || (isObject(c.triage) && c.triage.doctorSkill !== undefined);
}

function gitqSettingsCopies(s: Record<string, unknown>): Copy[] {
  const copies: Copy[] = [];
  if (s.forges !== undefined) copies.push({ key: "gitq.forges", scope: "user", value: s.forges });
  const slots = picked(s, { workSlotLocation: "workSlotLocation", maxWorkSlots: "maxWorkSlots" });
  if (slots) copies.push({ key: "gitq.workSlots", scope: "machine", value: slots });
  return copies;
}

/** gitq's board refuses an empty list and an entry with no path, so such a file is not copied. */
function gitqBoardCopies(c: Record<string, unknown>): Copy[] | null {
  const repos = c.repos;
  if (!Array.isArray(repos) || repos.length === 0 || !repos.every((r) => isObject(r) && typeof r.path === "string" && r.path !== "")) return null;
  const value = { repos, ...(c.port !== undefined ? { port: c.port } : {}), ...(c.herdrWorkspace !== undefined ? { herdrWorkspace: c.herdrWorkspace } : {}) };
  return [{ key: "gitq.board", scope: "machine", value }];
}

type Written = "copied" | "held" | "unreadable" | "failed";

function writeCopy(copy: Copy, t: Tally): Written {
  if (storeHolds(copy.key)) return "held";
  if (!validateWrite(getDef(copy.key)!, copy.value, { scope: copy.scope }).ok) return "unreadable";
  try {
    if (copy.scope === "user") setSetting(copy.key, copy.value, "user");
    else setSetting(copy.key, copy.value, "machine");
  } catch (err) {
    t.failed.push(`${copy.key}: ${firstLine(err)}`);
    return "failed";
  }
  if (!storeHolds(copy.key)) {
    t.failed.push(`${copy.key}: the copy did not read back`);
    return "failed";
  }
  t.copied++;
  return "copied";
}

/** The file moves aside only once every field it holds is in a store, so a refused or failed field keeps it for a hand fix or a rerun. */
function importFile(p: FileProbes, file: string, read: Reader, t: Tally): Record<string, unknown> | null {
  const raw = p.readFile(file);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const copies = isObject(parsed) ? read(parsed) : null;
  if (!isObject(parsed) || copies === null) {
    t.leftInPlace++;
    return null;
  }
  const written = copies.map((copy) => writeCopy(copy, t));
  if (written.includes("failed")) return parsed;
  if (written.includes("unreadable")) {
    t.leftInPlace++;
    return parsed;
  }
  try {
    p.rename(file, `${file}.imported`);
  } catch (err) {
    t.failed.push(`moving an old file aside: ${firstLine(err)}`);
  }
  return parsed;
}

/** rt setup used to seed gitq.board with bare repo names, which gitq refuses. */
function repairGitqBoard(t: Tally): void {
  const resolved = getSetting<{ repos?: unknown }>("gitq.board");
  const repos = resolved.value?.repos;
  if (onlyDefault(resolved) || !Array.isArray(repos) || !repos.some((r) => typeof r === "string")) return;
  const known = getKnownRepos().filter((row) => row.registered !== false && row.worktrees[0]);
  const fixed = repos.map((r) => {
    if (typeof r !== "string") return r;
    const row = known.find((k) => repoBasename(k.repoName) === r);
    return row ? { path: row.worktrees[0]!.path, name: r } : null;
  });
  if (fixed.includes(null)) {
    t.unrepaired = true;
    return;
  }
  try {
    setSetting("gitq.board", { ...(resolved.value as Record<string, unknown>), repos: fixed }, "machine");
  } catch (err) {
    t.failed.push(`gitq.board: ${firstLine(err)}`);
    return;
  }
  t.repaired = true;
}

function outcome(t: Tally): StepOutcome {
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  if (t.failed.length > 0) {
    return {
      state: "failed",
      detail: `Could not copy ${t.failed.length} old ${plural(t.failed.length, "setting", "settings")}: ${t.failed[0]}`,
      remedy: "Run rt settings check, fix what it names, then Retry",
    };
  }
  const notes = [
    t.repaired ? "Gave each repo on your gitq board its folder" : null,
    t.unrepaired ? "Some repos on your gitq board are not on this Mac, so rt left that setting as it was" : null,
    t.teamFields ? "Your old board file also holds team settings, which a team admin sets" : null,
    t.leftInPlace > 0
      ? `${t.leftInPlace} old ${plural(t.leftInPlace, "file has", "files have")} a value rt could not read, so rt left ${plural(t.leftInPlace, "it", "them")} where ${plural(t.leftInPlace, "it is", "they are")}`
      : null,
  ].filter((s): s is string => s !== null);
  if (t.copied === 0 && !t.repaired) return { state: "skipped", detail: ["There were no old board or gitq settings to copy", ...notes].join(". ") };
  const copied = t.copied > 0 ? [`Copied ${t.copied} old board or gitq ${plural(t.copied, "setting", "settings")} into your settings`] : [];
  return { state: "done", detail: [...copied, ...notes].join(". ") };
}

export const importAppSettingsMigration: MigrationDef = {
  id: "2026-10-11-import-app-settings",
  title: "Copy your old board and gitq settings into your settings",
  async run(ctx) {
    const p = ctx.p;
    const t: Tally = { copied: 0, repaired: false, unrepaired: false, teamFields: false, leftInPlace: 0, failed: [] };
    const board = [...new Set(boardRoots(p, sourceBoardRoots()))].map((root) => join(root, "config.json")).find((file) => p.exists(file));
    if (board) {
      const parsed = importFile(p, board, boardCopies, t);
      if (parsed) t.teamFields = boardTeamFields(parsed);
    }
    const gitq = p.env.GITQ_APP_ROOT ? resolve(p.env.GITQ_APP_ROOT) : join(p.home, ".mattstack", "gitq");
    importFile(p, join(gitq, "settings.json"), gitqSettingsCopies, t);
    importFile(p, join(gitq, "config.json"), gitqBoardCopies, t);
    repairGitqBoard(t);
    return outcome(t);
  },
};
```

In `lib/setup/migrations/index.ts`, add `import { importAppSettingsMigration } from "./import-app-settings.ts";` beside the other migration imports and append `importAppSettingsMigration,` after `importLegacySettingsMigration,` in `MIGRATIONS`.

- [ ] **Step 4: Run, expect PASS**

```bash
bun test lib/setup/__tests__/migration-import-app-settings.test.ts lib/setup/__tests__/migration-import-legacy-settings.test.ts lib/__tests__/no-shared-store-migrations.test.ts lib/setup/__tests__/migration-shared-store-refusal.test.ts lib/__tests__/no-settings-bypass.test.ts lib/__tests__/no-raw-output.test.ts
```

If `no-settings-bypass` objects to the `validate-write.ts` import, import `validateWrite` from `@mattstack/rt-client` instead, the way another `lib/` file already does (`rg -n "from \"@mattstack/rt-client\"" lib | head`).

- [ ] **Step 5: Commit**

```bash
git add lib/setup/migrations/import-app-settings.ts lib/setup/migrations/index.ts lib/setup/__tests__/migration-import-app-settings.test.ts lib/setup/__tests__/migration-import-legacy-settings.test.ts
```

```bash
git commit -m "setup: import the board's and gitq's old settings files"
```

---

### Task 3: The board reads the store alone, and its keys get their defaults

**Files:**
- Modify: `apps/board/src/config.ts` (lines 1-30 imports; 59-75 `deriveRtRepos`; 177-241 `BoardConfig`; 273 `CONFIG_PATH`; 282-416 `parseConfig`; 562-1160 everything from `loadConfig` through `seedAndWriteHiddenOverlay`)
- Modify: `apps/board/src/triage/config.ts` (lines 1-4 imports; 164-305)
- Modify: `apps/board/src/server.ts` (lines 63, 751, 963, 1133-1136, 1686-1691, 2039-2045, 4830-4833, 4903-4936)
- Modify: `apps/board/src/compiled.ts:31-45`, `apps/board/src/app-root.ts:11-21` (doc comment), `apps/board/src/client/board/SettingsModal.tsx:9` (comment), `apps/board/scripts/setup.ts:7-12,212-215` (comments), `apps/board/scripts/parity-check.ts:6` (comment)
- Create: `apps/board/src/__tests__/fake-resolve.ts`, `apps/board/src/__tests__/registry-defaults.test.ts`
- Rename and rewrite: `apps/board/src/__tests__/config-store-latch.test.ts` → `apps/board/src/__tests__/config-store.test.ts`
- Delete: `apps/board/src/__tests__/triage-config-latch.test.ts`
- Modify tests: `apps/board/src/__tests__/{agent-command,unconfigured,config,triage-config-peer-asks,triage-config-rereview}.test.ts`
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (`mattstack.roster` row; the `board (team)` block comment; the 13 `board.*` rows)
- Modify: `packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts:132-138` (`PENDING_DEFAULT`)
- Modify: `lib/__tests__/no-presence-by-undefined.test.ts:20` (drop the board entry)
- Modify: `lib/setup/__tests__/steps-b.test.ts:1049,1074,1128,1194,1205`
- Test: `lib/settings/__tests__/presence.test.ts`

**Interfaces:**
- Consumes: `storedValue` (Task 1).
- Produces: `boardSetting<T>(key: string, resolve?: typeof getSetting): T`; `loadConfig(resolve?: typeof getSetting): BoardConfig`; `boardConfigured(resolve?: typeof getSetting): boolean`; `saveRosterMembers(next: Member[], resolve?, write?, viewed?: string[]): BoardConfig`; `saveTabs(next: unknown, resolve?, write?): BoardConfig`; `saveMemberHidden(username: string, hidden: boolean, resolve?, write?): BoardConfig`; `rosterWriteRefusal(): string | null`; `loadTriageConfig(resolve?: typeof getSetting): TriageConfig`; `deriveRtRepos(gitlabHost: string, projects: string[]): Record<string, string>`. Removed: `CONFIG_PATH`, `loadConfigFrom`, `boardConfiguredAt`, `setHiddenInRaw`, `BoardConfig.rtRepoOverrides`.
- Test helper produced: `fakeResolve(values: Record<string, unknown>): typeof getSetting` in `apps/board/src/__tests__/fake-resolve.ts` (store values over the registry default, deep-merged for a `deep` key).

- [ ] **Step 1: Write the test helper**

`apps/board/src/__tests__/fake-resolve.ts`:

```ts
import { getDef, type getSetting } from '@mattstack/rt-client';

type GetSettingFn = typeof getSetting;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base: unknown, over: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(over)) return over;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
  return out;
}

/** getSetting's answer with no store on disk: a test value over the
    registry default, merged the way the resolver layers a `deep` key. */
export function fakeResolve(values: Record<string, unknown>): GetSettingFn {
  return (<T>(key: string) => {
    const def = getDef(key);
    const fallback = structuredClone(def?.default);
    const stored = values[key];
    const value =
      stored === undefined
        ? fallback
        : def?.merge === 'deep'
          ? deepMerge(fallback, stored)
          : stored;
    const provenance =
      stored !== undefined
        ? [{ scope: 'team', file: '/fake/settings.team.jsonc' }]
        : fallback !== undefined
          ? [{ scope: 'default', file: null }]
          : [];
    return { value: value as T, provenance };
  }) as GetSettingFn;
}
```

- [ ] **Step 2: Write the failing tests**

`apps/board/src/__tests__/registry-defaults.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { getDef } from '@mattstack/rt-client';
import { parseConfig } from '../config.ts';
import { parseTriageBlock } from '../triage/config.ts';

const minimal = parseConfig(
  JSON.stringify({
    gitlabHost: 'gitlab.example.com',
    projects: ['acme/widgets'],
    members: [{ username: 'dev1' }],
  }),
  'test'
);
const def = (key: string) => getDef(key)!.default;

describe('the registry defaults are what the board parsers fill in', () => {
  test('scalars and lists', () => {
    expect(def('board.title')).toBe(minimal.title);
    expect(def('board.defaultMember')).toBe(minimal.defaultMember);
    expect(def('board.gateGraceMinutes')).toBe(minimal.gateGraceMinutes);
    expect(def('board.doctorSkill')).toBe(minimal.doctorSkill);
    expect(def('board.botUsernames')).toEqual(minimal.botUsernames);
    expect(def('board.tabs')).toEqual(minimal.tabs);
  });

  test('workspaces and slack', () => {
    expect(def('board.workspaces')).toEqual({
      reviews: minimal.reviewsWorkspace,
      responds: minimal.respondsWorkspace,
      doctors: minimal.doctorsWorkspace,
    });
    const { channel: _fromTheDirectory, ...slack } = minimal.slack;
    expect(def('board.slack')).toEqual({ reviewKind: 'review', ...slack });
  });

  test('triage and its two sibling keys', () => {
    const { doctorSkill, maxConcurrent, ...block } = parseTriageBlock(undefined);
    expect(def('board.triage')).toEqual(block);
    expect(def('board.triage.doctorSkill')).toBe(doctorSkill);
    expect(def('board.triageMaxConcurrent')).toBe(maxConcurrent);
  });
});
```

Rename the latch test file (`git mv apps/board/src/__tests__/config-store-latch.test.ts apps/board/src/__tests__/config-store.test.ts`, one git command), replace its local `fakeResolve` with `import { fakeResolve } from './fake-resolve.ts';`, and add these tests (the old file's `fakeWrite`, `throwingResolve` and `teamView` reset stay):

```ts
const TEAM = {
  'board.gitlabHost': 'gitlab.example.com',
  'board.projects': ['acme/widgets'],
  'mattstack.roster': [{ username: 'dev1' }, { username: 'dev2' }],
};

describe('loadConfig: the store and the registry defaults', () => {
  test('with only the team keys set, every other field is its registry default', () => {
    const cfg = loadConfig(fakeResolve(TEAM));
    expect(cfg).toMatchObject({
      title: 'MRs ready for review',
      defaultMember: 'all',
      gateGraceMinutes: 90,
      doctorSkill: '',
      botUsernames: [],
      reviewsWorkspace: 'reviews',
      respondsWorkspace: 'responses',
      doctorsWorkspace: 'doctors',
      reviewCwd: '',
      respondCwd: '',
      doctorCwd: '',
      claudeCommand: '',
      staleAfterDays: null,
      ticketPrefixes: [],
      tabs: [{ id: 'team', label: 'Team', source: { kind: 'authors' } }],
      rtRepos: { 'acme/widgets': 'gitlab.example.com/acme/widgets' },
    });
    expect(cfg.slack).toMatchObject({
      channel: '',
      singleTemplate: '{title}: {url}',
      autoResolveIntervalMinutes: 15,
    });
  });

  test('a partial workspaces value keeps the defaults for the rest', () => {
    const cfg = loadConfig(
      fakeResolve({ ...TEAM, 'board.workspaces': { reviews: 'rev' } })
    );
    expect([cfg.reviewsWorkspace, cfg.respondsWorkspace, cfg.doctorsWorkspace]).toEqual(['rev', 'responses', 'doctors']);
  });

  test('a board with no team keys, or an empty roster, is not configured', () => {
    expect(() => loadConfig(fakeResolve({}))).toThrow('missing required field "gitlabHost"');
    expect(boardConfigured(fakeResolve({}))).toBe(false);
    expect(boardConfigured(fakeResolve({ ...TEAM, 'mattstack.roster': [] }))).toBe(false);
    expect(boardConfigured(fakeResolve(TEAM))).toBe(true);
  });

  test('a resolver throw on a key with a default reads the default, never crashes', () => {
    const r = fakeResolve(TEAM);
    const flaky = (<T>(key: string, opts?: unknown) => {
      if (key === 'board.tabs') throw new Error('store unreadable');
      return r<T>(key, opts as never);
    }) as typeof r;
    expect(loadConfig(flaky).tabs).toEqual(getDef('board.tabs')!.default as TabConfig[]);
  });

  test('hidden state comes from board.hiddenMembers alone; an inline roster flag is ignored', () => {
    const cfg = loadConfig(
      fakeResolve({
        ...TEAM,
        'mattstack.roster': [{ username: 'dev1', hidden: true }, { username: 'dev2' }],
        'board.hiddenMembers': ['dev2'],
      })
    );
    expect(cfg.members).toEqual([{ username: 'dev1' }, { username: 'dev2', hidden: true }]);
  });

  test('hiding a member when nobody has hidden anyone writes just that member at user scope', () => {
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveMemberHidden('dev2', true, fakeResolve(TEAM), fakeWrite(calls));
    expect(calls).toEqual([{ key: 'board.hiddenMembers', value: ['dev2'], scope: 'user' }]);
  });
});
```

(Add `boardConfigured`, `loadConfig` and `getDef` to the file's imports; drop `loadConfigFrom`.)

Add to `lib/settings/__tests__/presence.test.ts`:

```ts
  test("a team's title is its own value, never the registry default", () => {
    expect(getSetting("board.title").value).toBe("MRs ready for review");
    expect(storedValue("board.title")).toBeUndefined();
  });
```

(import `getSetting` from `../resolve.ts` if the file does not already.)

- [ ] **Step 3: Run, expect FAIL**

```bash
cd apps/board && bun test src/__tests__/registry-defaults.test.ts src/__tests__/config-store.test.ts
```

Expected: registry defaults are `undefined`; `loadConfig` and `boardConfigured` do not take a resolver.

- [ ] **Step 4: Registry defaults**

In `packages/rt-client/src/settings/registry-defs.ts`:

- Delete the four comment lines under `// --- board (team) ---` that start "A board.* row still held for a legacy file carries NO `default`".
- Add after `scopes` on each row:

| Row | Add |
|---|---|
| `mattstack.roster` | `default: [],` |
| `board.title` | `default: "MRs ready for review",` |
| `board.botUsernames`, `board.hiddenMembers` | `default: [],` |
| `board.slack` | `default: { reviewKind: "review", singleTemplate: "{title}: {url}", multiHeader: "{count} MR's ready for review :pray:", multiItem: "- {title}: {url}", autoResolveIntervalMinutes: 15, emoji: { looking: "eyes", commented: "speech_balloon", approved: "white_check_mark" } },` |
| `board.doctorSkill`, `board.triage.doctorSkill` | `default: "",` |
| `board.tabs` | `default: [{ id: "team", label: "Team", source: { kind: "authors" } }],` |
| `board.gateGraceMinutes` | `default: 90,` |
| `board.workspaces` | `default: { reviews: "reviews", responds: "responses", doctors: "doctors" },` |
| `board.defaultMember` | `default: "all",` |
| `board.triage` | `default: { enabled: false, cooldownMinutes: 30, dailyAttemptBudget: 3, fixClasses: { retryFlake: true, inheritedNoteDraft: true, cleanApiRebase: false, mechanicalLint: false, codeFix: false }, tier: "api", notify: "rt" },` |
| `board.cwds` | `default: {},` |
| `board.triageMaxConcurrent` | `default: 2,` |

- In `board.tabs`' description, replace "Absent = one implicit authors tab (fallback lives in the board reader, never here)." with "With nothing set, one Team tab of the roster's MRs."
- In `board.gateGraceMinutes`' description, delete " Default 90."

In `registry-console-ready.test.ts`, `PENDING_DEFAULT` becomes:

```ts
const PENDING_DEFAULT: readonly string[] = [
  "deck.access", "deck.apps", "deck.platform", "gitq.forges", "gitq.workSlots",
];
```

In `lib/__tests__/no-presence-by-undefined.test.ts`, delete the `"apps/board/src/config.ts"` entry from `ALLOWLIST`.

- [ ] **Step 5: Rewrite the board's config reader**

In `apps/board/src/config.ts`:

1. Imports: drop `readFileSync`, `renameSync`, `writeFileSync` from `fs`, `join` from `path` and `APP_ROOT` from `./app-root.ts` if nothing else in the file uses them after this step; add `getDef` to the `@mattstack/rt-client` import.
2. `deriveRtRepos` loses its third parameter and its doc comment's last sentence ("A config.json entry still wins ..."):

```ts
export function deriveRtRepos(
  gitlabHost: string,
  projects: string[]
): Record<string, string> {
  const host = gitlabHost
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  return Object.fromEntries(
    projects.map(project => [project, `${host}/${project}`])
  );
}
```

3. `BoardConfig`: delete the `rtRepoOverrides` field; change `rtRepos`' doc to "rt repo identities keyed by GitLab project path, derived from gitlabHost and projects."; change `claudeCommand`'s doc to "Command that starts claude in every pane the board launches, composed from the board.agent.* settings by composeAgentCommand. Empty = plain "claude"."; change `tabs`' doc to "Board tabs, in display order."; change `IMPLICIT_TABS`' doc to "The tabs a board with no `board.tabs` shows; the registry default is the same list (registry-defaults.test.ts)."
4. Delete `CONFIG_PATH`.
5. `parseConfig`: delete the `rtRepos` local (the `cfg.rtRepos` read), set `rtRepos: deriveRtRepos(cfg.gitlabHost!, cfg.projects!),` and delete the `rtRepoOverrides` line. Its doc comment becomes: "Parse and validate a board config's JSON. `source` names where a malformed value came from in every thrown message: the store reader passes a settings-store label, the fixture server its file."
6. Replace everything from `export function loadConfig()` (line 562) through the end of `seedAndWriteHiddenOverlay` (line 1160) with the code below, keeping `composeAgentCommand`, `loadAgentSettings` (now over `boardSetting`), `teamView`, `applyRosterEdit` and the `Roster*` types as they are apart from what is shown:

```ts
type GetSettingFn = typeof getSetting;
type SetSettingFn = typeof setSetting;

/** A setting's value, the registry default filling what no store sets. A
    resolver throw (an unreadable or malformed store file; getSetting never
    touches the daemon) degrades to that default after one warning, so a bad
    store never takes the board down. */
export function boardSetting<T>(
  key: string,
  resolve: GetSettingFn = getSetting
): T {
  try {
    return resolve<T>(key).value as T;
  } catch (err) {
    console.warn(`board: ${key} unavailable, using its default`, err);
    return structuredClone(getDef(key)?.default) as T;
  }
}

/* composeAgentCommand stays as it is. */

/** The three board.agent.* settings, typed for the rt agent daemon's launch
    payload, which has no field for a whole command. */
export function loadAgentSettings(
  resolve: GetSettingFn = getSetting
): AgentSettings {
  return {
    account: boardSetting<string | undefined>('board.agent.account', resolve),
    model: boardSetting<string | undefined>('board.agent.model', resolve),
    effort: boardSetting<string | undefined>('board.agent.effort', resolve),
  };
}

/* teamView stays as it is. */

type StoredMember = Member & { teams?: string[] };

/** The org roster narrowed to the active team. A Mac on no team, and a team
    nobody is listed on, see everyone. */
function rosterFromStore(resolve: GetSettingFn): {
  members: Member[];
  team: string | null;
} {
  const all = boardSetting<StoredMember[]>('mattstack.roster', resolve);
  const team = teamView.team();
  const onTeam =
    team === null ? [] : all.filter(m => (m.teams ?? []).includes(team));
  // `team` is null for the everyone view: a save from it must never put the
  // whole org on one team.
  return onTeam.length > 0
    ? { members: onTeam, team }
    : { members: all, team: null };
}

/** Why this Mac may not change the roster (it lives in the org store, which
    only an org admin writes); null when it may. */
export function rosterWriteRefusal(): string | null {
  return teamView.rosterRefusal();
}

/**
 * The board's config, from the settings stores alone. Store values never
 * went through parseConfig's normalization (ticketPrefixes' trim and
 * uppercase, the Slack template fill, the member checks), so the assembled
 * object makes the same round trip through it that a file once did.
 */
export function loadConfig(resolve: GetSettingFn = getSetting): BoardConfig {
  const read = <T>(key: string) => boardSetting<T>(key, resolve);
  const workspaces = read<{ reviews?: string; responds?: string; doctors?: string }>('board.workspaces');
  const cwds = read<{ review?: string; respond?: string; doctor?: string }>('board.cwds');
  const hidden = new Set(read<string[]>('board.hiddenMembers'));
  const members = rosterFromStore(resolve).members.map(
    ({ hidden: _inline, ...m }) =>
      hidden.has(m.username) ? { ...m, hidden: true } : m
  );
  const mine = directoryEntry(read<TeamDirectory>('mattstack.directory'), teamView.team());
  const {
    reviewKind,
    channel: _retired,
    ...slackFields
  } = read<Partial<SlackConfig> & { reviewKind: string }>('board.slack');
  const reviewChannel = mine
    ? (channelsOfKind(mine, reviewKind)[0] ?? '')
    : '';
  const ownersChannel = mine?.slack?.codeOwnersChannel;
  const codeOwnersChannel = ownersChannel && normalizeChannel(ownersChannel);
  const tabs = read<TabConfig[]>('board.tabs').map(t =>
    t.source.kind === 'codeowners' && !t.slackChannel && codeOwnersChannel
      ? { ...t, slackChannel: codeOwnersChannel }
      : t
  );
  const merged = {
    gitlabHost: read<string | undefined>('board.gitlabHost'),
    projects: read<string[] | undefined>('board.projects'),
    members,
    title: read<string>('board.title'),
    botUsernames: read<string[]>('board.botUsernames'),
    ticketPrefixes:
      read<string[] | undefined>('board.ticketPrefixes') ??
      (mine?.linear?.team ? [mine.linear.team] : []),
    slack: slackFields,
    doctorSkill: read<string>('board.doctorSkill'),
    staleAfterDays: read<number | undefined>('board.staleAfterDays') ?? null,
    gateGraceMinutes: read<number>('board.gateGraceMinutes'),
    reviewsWorkspace: workspaces.reviews,
    respondsWorkspace: workspaces.responds,
    doctorsWorkspace: workspaces.doctors,
    defaultMember: read<string>('board.defaultMember'),
    claudeCommand: composeAgentCommand(loadAgentSettings(resolve)),
    reviewCwd: cwds.review,
    respondCwd: cwds.respond,
    doctorCwd: cwds.doctor,
    tabs,
  };
  const parsed = parseConfig(
    JSON.stringify(merged),
    'a board.* settings-store value'
  );
  return {
    ...parsed,
    slack: { ...parsed.slack, channel: reviewChannel },
    teamPack: teamView.pack() ?? '',
    ownChannels: mine ? teamChannels(mine) : [],
  };
}

/** Whether the stores hold enough for the board to boot; the setup page
    answers until they do. An empty roster or project list counts as not yet. */
export function boardConfigured(resolve: GetSettingFn = getSetting): boolean {
  try {
    loadConfig(resolve);
    return true;
  } catch {
    return false;
  }
}

/* RosterAction, RosterEdit, RosterEditResult and applyRosterEdit stay as they are. */

/**
 * Replace the roster wholesale by merging it into `mattstack.roster` at org.
 * `next` changes only membership and display names (mergeTeamRoster), and
 * `viewed` names the members the list started from, so an entry written
 * after it was read is kept; it defaults to the roster as resolved now.
 * `mattstack.roster` carries no hidden field.
 */
export function saveRosterMembers(
  next: Member[],
  resolve: GetSettingFn = getSetting,
  write: SetSettingFn = setSetting,
  viewed?: string[]
): BoardConfig {
  const owner = rosterFromStore(resolve);
  const edited = next.map(({ hidden: _hidden, ...rest }) => rest);
  const full = boardSetting<RosterEntry[]>('mattstack.roster', resolve);
  const shown = viewed ?? owner.members.map(m => m.username);
  write(
    'mattstack.roster',
    mergeTeamRoster(full, owner.team, edited, shown),
    'org'
  );
  return loadConfig(resolve);
}

/** Replace the tab list wholesale in the team store. The list is validated
    first, so a bad write never leaves a config the next boot refuses. */
export function saveTabs(
  next: unknown,
  resolve: GetSettingFn = getSetting,
  write: SetSettingFn = setSetting
): BoardConfig {
  write('board.tabs', parseTabs(next, 'tabs'), 'team');
  return loadConfig(resolve);
}

/** Persist `username`'s hidden flag in board.hiddenMembers (user scope) and
    return the reload. An unknown member throws before any write. */
export function saveMemberHidden(
  username: string,
  hidden: boolean,
  resolve: GetSettingFn = getSetting,
  write: SetSettingFn = setSetting
): BoardConfig {
  const current = loadConfig(resolve);
  if (!current.members.some(m => m.username === username)) {
    throw new Error(`unknown member "${username}"`);
  }
  const stored = boardSetting<string[]>('board.hiddenMembers', resolve);
  const next = hidden
    ? [...new Set([...stored, username])]
    : stored.filter(u => u !== username);
  write('board.hiddenMembers', next, 'user');
  return loadConfig(resolve);
}
```

Delete `storeValue`, `agentCommand`, `ROSTER_KEYS`, `RosterStoreKey`, `withBoardStoreFallback`, `NO_FILE_PLACEHOLDER`, `isEnoent`, `storeOwnsRequiredFields`, `boardConfiguredAt`, `loadConfigFrom`, `setHiddenInRaw`, `isHiddenMembersOwned`, `isTabsOwned` and `seedAndWriteHiddenOverlay`. Update `applyRosterEdit`'s doc comment: "same as setHiddenInRaw" becomes nothing (end the sentence at "without a server").

- [ ] **Step 6: Rewrite the triage reader**

In `apps/board/src/triage/config.ts`: drop the `readFileSync` and `CONFIG_PATH` imports and add `import { boardSetting } from '../config.ts';`. Delete `storeValue`, `isEnoent` and `loadTriageConfig`'s old body and doc, and replace them with:

```ts
/** The triage config, from three sibling keys: board.triage (user) carries
    every field but doctorSkill and maxConcurrent, which are
    board.triage.doctorSkill (team, never manifest-resolved) and
    board.triageMaxConcurrent (machine). */
export function loadTriageConfig(
  resolve: GetSettingFn = getSetting
): TriageConfig {
  const triage = parseTriageBlock(
    boardSetting<unknown>('board.triage', resolve),
    'settings key "board.triage"'
  );
  const doctorSkill = boardSetting<unknown>('board.triage.doctorSkill', resolve);
  const maxConcurrent = boardSetting<unknown>('board.triageMaxConcurrent', resolve);
  return {
    ...triage,
    doctorSkill: typeof doctorSkill === 'string' ? doctorSkill : triage.doctorSkill,
    maxConcurrent:
      typeof maxConcurrent === 'number' && maxConcurrent > 0
        ? maxConcurrent
        : triage.maxConcurrent,
  };
}
```

`loadPeerAsksAlwaysAllow` reads `boardSetting<unknown>('board.peerAsksAlwaysAllow', resolve)`. `loadEnabledFlag` reads `boardSetting<unknown>(key, resolve)` and drops the `if (raw === undefined || raw === null) return { enabled: true };` line (the registry default `{ enabled: true }` answers, including after a throw). Fix the doc comments that mention `config.json` or "falling back" to say a throw reads the key's default. Leave `parseTriageBlock` as it is.

- [ ] **Step 7: The server, the compiled entry and the comments**

`apps/board/src/server.ts`:

- Drop `CONFIG_PATH` from the `./config.ts` import.
- Lines 751 and 1433: `errors.push(\`${projectPath}: could not derive its rt repo identity from board.gitlabHost\`);`. Line 963: the same message in the `Response`.
- Lines 1133-1136 comment: "...the team directory can land after boot (a setup migration, a team pull) with no write through this board to reload it."
- Lines 1686-1691 comment: "Board's config is a snapshot resolved at boot, so a write through this API reloads it here; a store edit from a shell still needs a restart."
- Lines 2039-2045: `saveRosterMembers(edit.members, getSetting, setSetting, fresh.members.map(m => m.username))`.
- Lines 4830-4833 comment: "Recomputed per event (not cached): config reloads after a settings write, so a cached Set could serve a stale allowlist."
- Lines 4903-4936: the header comment above `reloadConfig` becomes "Reload the config in place after a settings write through this board (the /api/settings/ mount or /api/config/reload); a store edit from a shell needs a restart."; in `reloadConfig`'s body, "(the board writes config.json itself)" becomes "(the board writes the store itself)"; delete the `if (!FIXTURE_DIR) watch(dirname(CONFIG_PATH), ...)` block. Remove `watch`, `dirname` and `basename` from their imports if nothing else in the file uses them (`rg -n "\bwatch\(|\bdirname\(|\bbasename\(" apps/board/src/server.ts`).

`apps/board/src/compiled.ts:34-45`:

```ts
{
  const { boardConfigured } = await import('./config.ts');
  if (!boardConfigured()) {
    const { serveUnconfigured } = await import('./unconfigured.ts');
    serveUnconfigured({
      port: Number(process.env.PORT) || 7930,
      pollMs: 5_000,
      isConfigured: () => boardConfigured(),
      exit: code => process.exit(code),
    });
    await new Promise(() => {});
  }
}
```

Comments: `app-root.ts` "Where the board's mutable companions live: config.json and .env only." becomes "Where the board's mutable companion lives: .env only."; drop "so a dev checkout keeps its existing config.json in place" from the same comment. `SettingsModal.tsx:9`: "Toggling persists the hidden flag to config.json" becomes "Toggling persists the hidden flag to your board.hiddenMembers setting". `scripts/setup.ts:7-12`: replace the two sentences about `config.example.json` with "The team-owned fields (gitlabHost, projects, members, title, ...) live in the team settings store, not in anything setup writes."; `scripts/setup.ts:212-215`: "The board's current config, or null when the stores do not hold enough for it yet." `scripts/parity-check.ts:6`: "Requires: a board configured in the settings stores, rt daemon running with the".

- [ ] **Step 8: Port the board's tests**

`apps/board/src/__tests__/config-store.test.ts` (renamed in Step 2): replace every `loadConfigFrom(path, r)` with `loadConfig(r)`, every `saveRosterMembers(next, path, r, w, viewed)` with `saveRosterMembers(next, r, w, viewed)`, `saveTabs(next, path, r, w)` with `saveTabs(next, r, w)`, `saveMemberHidden(u, h, path, r, w)` with `saveMemberHidden(u, h, r, w)`, `rosterWriteRefusal(r)` with `rosterWriteRefusal()`, and remove every temp `config.json` the tests write. Store values the old tests put under `members` move to `mattstack.roster`. Then:

- Delete these tests (file or latch behaviour): "an unowned key falls back to config.json's value"; "a config.json rtRepos entry still overrides the derived identity for its project (a fork or a renamed remote)"; "rtRepoOverrides holds only config.json's explicit entries after the store overlay, never the derived map"; "a resolver throw degrades that key to config.json's value, never crashes the load"; "gateGraceMinutes fails open to 90 when the store key is unregistered (a resolver throw), even with no config.json value"; "an empty mattstack.roster is still ownership, not absence"; the whole `describe` blocks "loadConfigFrom: config.json-optional boot once the team store owns the required fields", "saveMemberHidden: config.json-free still succeeds" and "storeOwnsRequiredFields: config.json-free boot"; from "loadConfigFrom: members roster + hiddenMembers overlay" the tests "unowned roster and board.hiddenMembers: hidden comes from config.json's inline flags", "owned board.hiddenMembers overlays hidden by username onto the file roster, replacing inline flags" and "owned mattstack.roster with unowned board.hiddenMembers falls back to the store roster's own inline hidden flags"; "unowned: rewrites config.json's members, store untouched"; "unowned: writes config.json's inline hidden flag, store untouched"; "a resolver throw on the ownership probe degrades to unowned, still writes the file"; "the overlay write seeds from a member already hidden via an inline store-roster flag"; "unowned: rewrites config.json's tabs, store untouched"; "no config.json with owned team keys establishes board.tabs ownership".
- Rename: describe "loadConfigFrom: per-key store-wins fallback" to "loadConfig: store values"; "a store-owned scalar key wins over config.json's value" to "a store value wins over the registry default"; "board.workspaces wins per sub-field, not wholesale" and "board.cwds wins per sub-field, not wholesale" to "... a partial value keeps the default for the rest"; describe "saveRosterMembers: latch-gated writer" to "saveRosterMembers"; "saveMemberHidden: latch-gated writer" to "saveMemberHidden"; "saveMemberHidden: a store-owned roster decides the writer, not config.json existing" to "saveMemberHidden against the org roster"; "un-hiding the only currently-hidden member writes an empty array, which still latches ownership" to "un-hiding the only hidden member writes an empty list"; "saveTabs: latch-gated writer" to "saveTabs"; "an invalid list throws before any write, on either side of the latch" to "an invalid list throws before any write"; "an admin, and a roster config.json owns, are not refused" to "an admin is not refused" (and drop the config.json half of its body); "a malformed store value's error names the settings store, never config.json" keeps its name.
- `owned:` / `unowned:` prefixes come off the remaining test names.

`apps/board/src/__tests__/agent-command.test.ts`: `configWith(values)` returns `loadConfig(fakeResolve({ ...TEAM, ...values }))` (import `fakeResolve` and define the same `TEAM` const); delete `tmpConfig` and the three tests "a file-config claudeCommand still wins as the verbatim escape hatch" and the two after it that build a `claudeCommand` file (lines 170-191); the test at line 203 becomes `expect(loadConfig(fakeResolve(TEAM)).claudeCommand).toBe('')`.

`apps/board/src/__tests__/unconfigured.test.ts`: `boardConfiguredAt(path, r)` becomes `boardConfigured(r)`; delete the first test (a file on disk is configured) and every temp `config.json`; use the shared `fakeResolve`.

`apps/board/src/__tests__/config.test.ts:186`: the test becomes "rtRepos derives one identity per project from gitlabHost; rtRepos in the input is ignored", asserting the derived map and that an input `rtRepos` entry does not appear in it.

`apps/board/src/__tests__/triage-config-peer-asks.test.ts` and `triage-config-rereview.test.ts`: switch their local fake to the shared `fakeResolve`; "unset defaults to enabled" and "an unset key defaults to enabled" now pass through the registry default; rename "a malformed value names the settings key, not config.json" to "a malformed value names the settings key". Delete `triage-config-latch.test.ts` (`git rm`), and add to `triage-config.test.ts`:

```ts
describe('loadTriageConfig', () => {
  test('nothing set reads the disabled defaults', () => {
    expect(loadTriageConfig(fakeResolve({}))).toEqual(parseTriageBlock(undefined));
  });
  test('the two sibling keys win independently of board.triage', () => {
    const cfg = loadTriageConfig(
      fakeResolve({
        'board.triage': { enabled: true },
        'board.triage.doctorSkill': 'acme:doctor',
        'board.triageMaxConcurrent': 4,
      })
    );
    expect(cfg).toMatchObject({ enabled: true, doctorSkill: 'acme:doctor', maxConcurrent: 4 });
  });
  test('a non-positive maxConcurrent keeps the default', () => {
    expect(loadTriageConfig(fakeResolve({ 'board.triageMaxConcurrent': 0 })).maxConcurrent).toBe(2);
  });
  test('a malformed board.triage names the settings key', () => {
    expect(() => loadTriageConfig(fakeResolve({ 'board.triage': { enabled: 'yes' } }))).toThrow('settings key "board.triage"');
  });
});
```

`lib/setup/__tests__/steps-b.test.ts`: lines 1049, 1074 and 1128 (`getSetting("board.cwds").value).toBeUndefined()`) and 1194, 1205 (`board.defaultMember`) become `expect(unwritten("board.cwds")).toBe(true)` / `expect(unwritten("board.defaultMember")).toBe(true)`; import `unwritten` from `../../settings/presence.ts` if the file does not already.

- [ ] **Step 9: Build, lock, run**

```bash
bun run --cwd packages/rt-client build
env -i HOME="$(mktemp -d)" PATH="$PATH" bun run cli.ts settings schema lock
git diff --exit-code packages/rt-client/src/settings/schema.lock.json
bun test packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts packages/rt-client/src/settings/__tests__/schema-examples.test.ts lib/__tests__/no-presence-by-undefined.test.ts lib/settings/__tests__/presence.test.ts lib/setup/__tests__/steps-b.test.ts commands/__tests__/team-status.test.ts lib/team/__tests__/invite.test.ts
bun run board:typecheck
cd apps/board && bun test src/__tests__/registry-defaults.test.ts src/__tests__/config-store.test.ts src/__tests__/config.test.ts src/__tests__/triage-config.test.ts src/__tests__/triage-config-peer-asks.test.ts src/__tests__/triage-config-rereview.test.ts src/__tests__/unconfigured.test.ts src/__tests__/agent-command.test.ts src/__tests__/board.test.ts src/__tests__/turn-setting.test.ts src/__tests__/server-roster-route.test.ts src/__tests__/server-roster-refusal.test.ts src/__tests__/settings-live-reload.test.ts src/__tests__/fixture-mode.test.ts src/__tests__/server-healthz-fast.test.ts
```

Expected: no lock diff; everything passes. A test elsewhere that asserted one of these keys resolves `undefined` is changed to the registry default or to `unwritten`; anything else stops the task and is reported.

- [ ] **Step 10: Commit**

```bash
git add -A apps/board/src apps/board/scripts packages/rt-client/src/settings lib/__tests__/no-presence-by-undefined.test.ts lib/settings/__tests__/presence.test.ts lib/setup/__tests__/steps-b.test.ts
```

```bash
git commit -m "board: read settings from the store alone; board keys and the roster get registry defaults"
```

---

### Task 4: Nothing reads or describes the board's config.json any more

**Files:**
- Modify: `lib/team/board-token.ts:52-65,73-81`
- Modify: `lib/team/__tests__/board-token.test.ts:78-88`
- Modify: `AGENTS.md:774-777` ("Switchboard and `rt team join`")
- Modify: `apps/board/README.md:44-49,90-102,137-157,314-317`, `apps/board/docs/configuration.md:1-80`, `apps/board/docs/tui-kit-adoption-notes.md:14-16`
- Delete: `apps/board/config.example.json`, `apps/board/config.team.example.json`

**Interfaces:**
- Produces: `boardPeering(p, has, teamTracksProjects, extraRoots?)` unchanged in signature; it no longer reads any `config.json`.

- [ ] **Step 1: Write the failing test**: in `board-token.test.ts`, replace "a board whose legacy config.json tracks projects still applies" with:

```ts
  test("an old config.json that tracks projects no longer makes the row apply", async () => {
    const p = fakeProbes({
      home: HOME,
      dirs: { [`${HOME}/.mattstack/orgs`]: ["acme"] },
      files: {
        [`${HOME}/.mattstack/orgs/acme/.git/config`]: "",
        [`${HOME}/.mattstack/board/config.json`]: JSON.stringify({ projects: ["group/app"] }),
      },
    });
    expect(await boardPeering(p, async () => null, false, [])).toEqual({ kind: "not-applicable" });
  });
```

(Reuse the probe set-up the old test built at lines 79-86, whatever its exact fields; only the expectation and the name change.)

- [ ] **Step 2: Run, expect FAIL**: `bun test lib/team/__tests__/board-token.test.ts` (answers `unpeered`).

- [ ] **Step 3: Implement**: delete `legacyConfigTracksProjects` and change `boardPeering`'s check to `if (!teamTracksProjects) return { kind: "not-applicable" };`. Its doc comment's parenthesis becomes "(the team tracks projects)".

`AGENTS.md`: "that runs a board (the team's `board.projects`, or the board's legacy `config.json`, tracks projects)" becomes "that runs a board (the team's `board.projects` tracks projects)".

- [ ] **Step 4: Board docs**

`apps/board/docs/configuration.md` lines 1-19 become:

```markdown
# Configuration reference

Board reads its configuration from the mattstack settings stores
(`~/.mattstack/`), through the resolver in `@mattstack/rt-client`. Team-shared
keys live on the `team` scope (the roster on `org`); personal ones on `user`
or `machine`. A key nobody set reads its registry default, which
`rt settings explain <key>` shows.

## Reload behavior

- Edits made through the board's own settings modal, or the console, reload
  the board: the write goes through `/api/settings/*` or
  `/api/config/reload`, which reloads the in-memory config on success.
- An out-of-band store edit (`rt settings set board.<key> ...` by hand, or
  another tool writing the store directly) does **not** reload. Restart the
  board (`bun run serve`) to pick it up.
```

In the Fields table, replace the `field` column with the setting each value comes from, and drop the `rtRepos` and `claudeCommand` rows:

| Setting | Meaning |
|---|---|
| `board.gitlabHost` | your GitLab instance, e.g. `https://gitlab.com`. Each project's rt repo identity is this host plus the project path |
| `board.projects` | GitLab project paths whose MRs are eligible, e.g. `["group/project"]` |
| `mattstack.roster` | the org roster; the board shows your active team's entries, or everyone when this Mac has no team or nobody is listed on it |
| `board.hiddenMembers` | usernames you hide from the authors tab, for you only |
| `board.defaultMember` | member username the board opens to, or `"all"` (the default). The URL and remembered state override it |
| `board.title` | page heading and tab title (default "MRs ready for review") |
| `board.staleAfterDays` | hide MRs with no activity in more than this many days (default: each project's rt MR sync window; 30 when rt has not reported one) |
| `board.ticketPrefixes` | when non-empty, show only MRs whose ticket key starts with one of these prefixes, e.g. `["ACME"]`. Case-insensitive. With nothing set, your team's Linear key |
| `board.botUsernames` | extra bot accounts whose general MR comments to hide, on top of the built-in heuristic |
| `board.cwds` | `{ review, respond, doctor }`: absolute paths the agent panes start in. An empty review path disables the review launch; respond and doctor fall back to it |
| `board.workspaces` | `{ reviews, responds, doctors }`: herdr workspace labels (defaults `reviews`, `responses`, `doctors`) |
| `board.doctorSkill` | domain skill the doctor wrapper delegates to, e.g. `acme:doctor`. Empty means the wrapper repairs generically. The launch pack's `board:doctor` binding for the MR's repo overrides it when present. See [skill bindings](agent-actions.md#skill-bindings-per-pack-skillsjsonc) |
| `board.agent.account`, `board.agent.model`, `board.agent.effort` | how the panes start Claude. See below |
| `board.slack` | post templates, sweep interval, signal emoji and the channel kind to post to. See [Slack integration](slack.md) |
| `board.triage`, `board.triage.doctorSkill`, `board.triageMaxConcurrent` | reviewer-side automation. See [agent actions](agent-actions.md#reviewer-side-automation) |
| `board.tabs` | board tabs, in display order. See below |

Rename the `### \`claudeCommand\`` heading to `### How panes start Claude` and delete its paragraph "A `claudeCommand` in `config.json` overrides all three ..." (lines 74-76). In `## Tabs`, "With no `tabs` config the board creates one implicit "Team" tab" becomes "With nothing set, `board.tabs` is one "Team" tab".

`apps/board/README.md`:

- Lines 44-49: the last two sentences become "To see the layout without wiring up a real GitLab project, boot the inert fixture board: `BOARD_FIXTURE=$(pwd)/tests/fixture bun run src/server.ts` (port 7941, invented data; see `tests/fixture/README.md`)."
- Quickstart (lines 90-102): delete the `cp config.example.json ...` line and replace the paragraph under it with "The team-shared settings (`board.gitlabHost`, `board.projects`, the roster, `board.title`, and so on) live in your mattstack team's settings, so a teammate who joins the team has them already."
- `## Configuration` (lines 137-157): the opening sentence becomes "The board reads everything from the mattstack settings stores. The essentials:"; the table's `field` column takes the setting names from the table above (`board.gitlabHost`, `board.projects`, `mattstack.roster`, `board.defaultMember`, `board.title`, `board.slack`), and the `rtRepos` row goes; "covers every field, tabs, the settings-store ownership latch and its reload rules, and all the tokens and secrets" becomes "covers every setting, tabs, the reload rules, and all the tokens and secrets".
- Line 165: "Its location is independent of `config.json`'s:" becomes "Its location is independent of the app root:".
- Lines 314-317: "Never commit `config.json` or `.env`." becomes "Never commit `.env`." and "they carry real names, tokens, and MR URLs" becomes "it carries real tokens".

`apps/board/docs/tui-kit-adoption-notes.md:14-16`: "Needs a `config.json` (copy `config.team.example.json` for a fake demo roster — ...)" becomes "Needs a board configured in the settings stores, or the inert fixture board (`BOARD_FIXTURE=$(pwd)/tests/fixture`) to see the layout without a real GitLab project."

Delete the two example files (`git rm apps/board/config.example.json`, then `git rm apps/board/config.team.example.json`, one command each).

- [ ] **Step 5: Run, expect PASS**

```bash
bun test lib/team/__tests__/board-token.test.ts lib/setup/__tests__/validators-accounts.test.ts
rg -n "config\.json|config\.example|ownership latch" apps/board/README.md apps/board/docs/configuration.md apps/board/docs/tui-kit-adoption-notes.md apps/board/src apps/board/scripts lib/team/board-token.ts
```

Expected: tests pass; the `rg` finds only `tests/fixture`-related mentions in `src/server.ts` and the fixture test (fixture mode keeps its own file). If `lib/setup/__tests__/validators-accounts.test.ts` does not exist, run `rg -l boardPeering lib commands -g '*test.ts'` and run those instead.

- [ ] **Step 6: Commit**

```bash
git add -A lib/team/board-token.ts lib/team/__tests__/board-token.test.ts AGENTS.md apps/board/README.md apps/board/docs apps/board/config.example.json apps/board/config.team.example.json
```

```bash
git commit -m "board: drop the last config.json reader and its docs and examples"
```

---

### Task 5: gitq reads the store alone; the setup seed writes what gitq reads

**Files:**
- Modify: `apps/gitq/src/core/worktrees.ts:1-29,138-155`
- Modify: `apps/gitq/src/core/forges.ts:1-3,90-110`
- Modify: `apps/gitq/src/server/config.ts` (whole file below the interfaces)
- Modify: `apps/gitq/src/core/config-paths.ts:48-51,74-77` (delete `getSettingsFilePath`, `SETTINGS_PATH`)
- Modify: `apps/gitq/src/cli/provider.ts:6,30,61-74`, `apps/gitq/src/cli/slots.ts:82-86`
- Delete: `apps/gitq/config.example.json`
- Modify tests: `apps/gitq/tests/{forges-store-latch,worktrees-work-slots-latch,board-config-store-latch}.test.ts` (rename to drop `-latch`), `apps/gitq/tests/{board-config,config-paths,app-root}.test.ts`, `apps/gitq/tests/integration/{cli-worktrees,worktrees}.test.ts`
- Modify: `lib/setup/steps/skills.ts:166-198` (`boardKeysRun`)
- Modify: `lib/setup/__tests__/steps-b.test.ts:1021-1131`
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (`gitq.workSlots`, `gitq.forges`), `packages/rt-client/src/settings/registry-schemas.ts:110` (comment), `packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts` (`PENDING_DEFAULT`)

**Interfaces:**
- Produces: `getWorkSlotLocation(resolve?)`, `getMaxWorkSlots(resolve?)` and `readForgeOverrides(resolve?)` with unchanged signatures, reading only the store; `loadConfig(resolve?: typeof getSetting): BoardConfig` (no `configPath`); `validateBoardConfig(parsed: unknown, source: string): BoardConfig` exported. Removed: `CONFIG_PATH`, `parseConfig`, `getSettingsFilePath`, `SETTINGS_PATH`.

- [ ] **Step 1: Write the failing tests**

Rename the three latch test files (`git mv` each, one command per call) to `forges-store.test.ts`, `worktrees-work-slots-store.test.ts` and `board-config-store.test.ts`. In them, delete every test whose name says it falls back to `settings.json`/`config.json`, is "unowned", or is about a corrupt `settings.json` (the whole `describe` "getMaxWorkSlots / getWorkSlotLocation: a corrupt settings.json is only ever read as a fallback" goes), and drop the helpers that write those files. Keep the tests that write a real store value and the validation tests, renamed without "owned". Then add, using the real store under the preload's temp HOME (`setSetting`/`unsetSetting` from `@mattstack/rt-client`, machine scope for `gitq.workSlots` and `gitq.board`, user for `gitq.forges`, unset again in `afterEach`):

```ts
test('nothing set reads the registry default: auto placement, three slots', async () => {
  expect(await getWorkSlotLocation()).toBe('auto');
  expect(await getMaxWorkSlots()).toBe(3);
});

test('a resolver throw reads the default after one warning, never crashes', async () => {
  const throwing = (() => {
    throw new Error('store unreadable');
  }) as unknown as typeof getSetting;
  expect(await getMaxWorkSlots(throwing)).toBe(3);
  expect(await getWorkSlotLocation(throwing)).toBe('auto');
});

test('an invalid maxWorkSlots in the store reads the default', async () => {
  setSetting('gitq.workSlots', { maxWorkSlots: 0 }, 'machine');
  expect(await getMaxWorkSlots()).toBe(3);
});
```

```ts
test('no forges set is an empty map', async () => {
  expect(await readForgeOverrides()).toEqual({});
});
```

```ts
test('no gitq.board in the store is a startup failure that names how to set one', () => {
  expect(() => loadConfig()).toThrow('no "gitq.board" in your settings');
});
```

In `tests/board-config.test.ts`, replace `parseConfig(raw)` with `validateBoardConfig(JSON.parse(raw), 'gitq.board')`, expected messages that start `config.json` start `gitq.board`, and "a config.json still carrying gitlabHost keeps loading" becomes "a gitq.board still carrying gitlabHost keeps loading". In `tests/config-paths.test.ts`, delete "getSettingsFilePath derives from config dir" and its import. In `tests/app-root.test.ts:40-42`, delete the `CONFIG_PATH` assertion.

`tests/integration/cli-worktrees.test.ts:103`: replace the `settings.json` write with `setSetting('gitq.workSlots', { maxWorkSlots: 2 }, 'machine');` and unset it at the end of the test (the CLI child gets the preload's HOME through `env: { ...process.env, ... }`). `tests/integration/worktrees.test.ts:133` and `:158`: replace each `settings.json` write with `setSetting('gitq.workSlots', { workSlotLocation: 'root' }, 'machine')` (and `'nowhere'` for the second), with `unsetSetting('gitq.workSlots', 'machine')` in the `finally`.

`lib/setup/__tests__/steps-b.test.ts`, in `describe("board.keys")`:

- Lines 1039, 1061 and 1084: the `gitq.board` expectations become entries with each clone's folder, for example at 1084:

```ts
      const board = getSetting<{ repos: { path: string; name: string }[]; port: number }>("gitq.board").value!;
      expect(board.port).toBe(11008);
      expect(board.repos.map((r) => r.name)).toEqual(["one", "two"]);
      expect(board.repos.map((r) => realpathSync(r.path))).toEqual([realpathSync(one), realpathSync(two)]);
```

  (1039 compares against `realpathSync(clone)`, 1061 against `clone`.)
- The test at 1099 becomes "writes board.cwds and gitq.board once, then skips them once set": drop the `gitq.workSlots` detail and value expectations, and expect `gitq.board` to be `{ repos: [{ path: expect.any(String), name: repoName }], port: 11008 }`.
- The test at 1122 becomes:

```ts
    test("no tracked repos and no repo root: nothing is written and nothing crashes", async () => {
      const p = fakeProbes({ home });
      const { ctx, logs } = makeCtx(p);
      const outcome = await boardKeysStep.run(ctx);
      expect(outcome).toEqual({ state: "done", detail: "Nothing to write" });
      expect(getSetting("gitq.board").value).toBeUndefined();
      expect(unwritten("board.cwds")).toBe(true);
      expect(unwritten("gitq.workSlots")).toBe(true);
      expect(logs.some((l) => l.line.includes("gitq.board: the team tracks no repos"))).toBe(true);
    });
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd apps/gitq && bun test tests/worktrees-work-slots-store.test.ts tests/forges-store.test.ts tests/board-config-store.test.ts
bun test lib/setup/__tests__/steps-b.test.ts -t "board.keys"
```

- [ ] **Step 3: Registry**: in `registry-defs.ts`, add `default: { workSlotLocation: "auto", maxWorkSlots: 3 },` to `gitq.workSlots` and `default: {},` to `gitq.forges`. `PENDING_DEFAULT` becomes `["deck.access", "deck.apps", "deck.platform"]`. In `registry-schemas.ts:110`, the comment above `gitqRepo` becomes "Older rt seeded bare repo names; gitq reads { path, name? } and refuses a name, which the 2026-10-11 import rewrites."

- [ ] **Step 4: gitq readers**

`apps/gitq/src/core/worktrees.ts`: drop the `getSettingsFilePath` and `readJson` imports if nothing else uses them, add `getDef` to the `@mattstack/rt-client` import, and replace `storeWorkSlots`, `getWorkSlotLocation` and `getMaxWorkSlots` with:

```ts
/** gitq.workSlots, the registry default filling what no store sets. A
    resolver throw (an unreadable store file, never the daemon) degrades to
    that default after one warning rather than crashing slot provisioning. */
function workSlots(resolve: GetSettingFn): WorkSlotsSetting {
  try {
    return resolve<WorkSlotsSetting>('gitq.workSlots').value as WorkSlotsSetting;
  } catch (err) {
    warnStoreFallback('gitq.workSlots', 'its default', err);
    return structuredClone(getDef('gitq.workSlots')!.default) as WorkSlotsSetting;
  }
}

/**
 * Settings-controlled placement policy: `root` forces every new slot under the
 * work-slot root, `auto` (and anything unrecognised) keeps the pool-aware
 * placement.
 */
export async function getWorkSlotLocation(resolve: GetSettingFn = getSetting): Promise<WorkSlotLocation> {
  return workSlots(resolve).workSlotLocation === 'root' ? 'root' : 'auto';
}

/** Settings-controlled cap on work slots per repo; a value below 1 reads the default. */
export async function getMaxWorkSlots(resolve: GetSettingFn = getSetting): Promise<number> {
  const n = workSlots(resolve).maxWorkSlots;
  if (typeof n === 'number' && n >= 1) return Math.floor(n);
  return (getDef('gitq.workSlots')!.default as Required<WorkSlotsSetting>).maxWorkSlots;
}
```

`apps/gitq/src/core/forges.ts`: drop the `getSettingsFilePath` import (and `readJson` if unused), add `getDef`, change the `ForgeOverrides` doc "A `forges` entry in settings.json" to "A `gitq.forges` entry", and replace `readForgeOverrides` and its doc with:

```ts
/**
 * The `gitq.forges` map. Every entry is validated lazily, in resolveForge. A
 * resolver throw (an unreadable store file, never the daemon) reads the empty
 * default after one warning.
 */
export async function readForgeOverrides(resolve: GetSettingFn = getSetting): Promise<ForgeOverrides> {
  try {
    return resolve<ForgeOverrides>('gitq.forges').value as ForgeOverrides;
  } catch (err) {
    warnStoreFallback('gitq.forges', 'no overrides', err);
    return structuredClone(getDef('gitq.forges')!.default) as ForgeOverrides;
  }
}
```

`apps/gitq/src/server/config.ts`: drop the `readFileSync`, `join`, `APP_ROOT` and `warnStoreFallback` imports; delete `CONFIG_PATH` and `parseConfig`; export `validateBoardConfig` (rename its doc to "Validates a gitq.board value and fills its port and workspace defaults."); replace `loadConfig` with:

```ts
const NO_BOARD =
  'no "gitq.board" in your settings: rt setup writes it with the repos it finds, ' +
  "or run rt settings set gitq.board '{\"repos\":[{\"path\":\"/path/to/repo\"}]}' --scope machine";

/** The board config, from `gitq.board`. `$PORT` still wins over its port; server.ts applies that. */
export function loadConfig(resolve: GetSettingFn = getSetting): BoardConfig {
  const resolved = resolve<unknown>('gitq.board');
  if (resolved.provenance.every((p) => p.scope === 'default')) throw new Error(NO_BOARD);
  return validateBoardConfig(resolved.value, 'gitq.board');
}
```

(A resolver throw propagates: gitq.board has no default to fall back on, and the server reports the error at startup.) Keep the comment block about the forge host, replacing "an on-disk config still carrying it loads fine, ignored" with "a stored value still carrying it loads fine, ignored".

`config-paths.ts`: delete `getSettingsFilePath` and `SETTINGS_PATH`. `cli/provider.ts`: drop the import; the field doc at line 30 becomes "Host → forge map. Read from gitq.forges when not injected."; delete the error's last part from `(or, until gitq.forges is imported, ...` through `}})` so the message ends at "keep any other hosts you already have)". `cli/slots.ts`: delete ` +\n          \`(or, until gitq.workSlots is imported, edit maxWorkSlots in settings.json)\``, ending the message at "you already have)". `rg -n "settings\.json|getSettingsFilePath|SETTINGS_PATH|CONFIG_PATH" apps/gitq/src` must come back empty. Delete `apps/gitq/config.example.json` (`git rm`).

- [ ] **Step 5: The setup seed** (Open questions 3 and 4): in `lib/setup/steps/skills.ts` `boardKeysRun`, replace the `gitq.board` and `gitq.workSlots` blocks with:

```ts
  if (writable(ctx, "gitq.board") && unwritten("gitq.board")) {
    if (waiting) ctx.log("board.keys", `gitq.board: ${waiting}`);
    else if (found.length === 0) ctx.log("board.keys", "gitq.board: the team tracks no repos, left unset");
    else {
      setSetting("gitq.board", { repos: found.map((r) => ({ path: r.path, name: r.name })), port: 11008 }, "machine");
      written.push("gitq.board");
    }
  }
```

and delete the now-unused `root` local (the `rt.repoRoots` read) and the `join` import if nothing else uses it.

- [ ] **Step 6: Build and pass**

```bash
bun run --cwd packages/rt-client build
env -i HOME="$(mktemp -d)" PATH="$PATH" bun run cli.ts settings schema lock
git diff --exit-code packages/rt-client/src/settings/schema.lock.json
bun test packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts packages/rt-client/src/settings/__tests__/resolve.test.ts lib/setup/__tests__/steps-b.test.ts lib/setup/__tests__/migration-import-app-settings.test.ts
cd apps/gitq && bun test tests/worktrees-work-slots-store.test.ts tests/forges-store.test.ts tests/board-config-store.test.ts tests/board-config.test.ts tests/config-paths.test.ts tests/app-root.test.ts && bun test --timeout 30000 tests/integration/cli-worktrees.test.ts tests/integration/worktrees.test.ts && bun run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add -A apps/gitq/src apps/gitq/tests apps/gitq/config.example.json lib/setup/steps/skills.ts lib/setup/__tests__/steps-b.test.ts packages/rt-client/src/settings
```

```bash
git commit -m "gitq: read settings from the store alone; setup seeds gitq.board as gitq reads it"
```

---

### Task 6: gitq's docs describe the store only

**Files:**
- Modify: `apps/gitq/README.md:233,253-269,279-285`
- Modify: `website/docs/gitq/reference/configuration.mdx`, `website/docs/gitq/concepts/state.mdx`, `website/docs/gitq/concepts/work-slots.mdx`, `website/docs/gitq/guides/worktree-pools.mdx:31`, `website/docs/gitq/getting-started/install.mdx:70`, `website/docs/gitq/getting-started/the-board.mdx:14-37`

Independent of Tasks 7 and 8 (docs only).

- [ ] **Step 1: README** (`apps/gitq/README.md`)

- Line 233: drop "`settings.json`, " and "the board's `config.json` and " from the app root row, leaving "the board's `state/jobs/`".
- `### Settings` (253-269) becomes:

```markdown
### Settings

gitq reads three settings from the [rt](https://github.com/m4ttstack/mattstack) settings store.

| Key | Scope | Shape | With nothing set |
| --- | --- | --- | --- |
| `gitq.workSlots` | machine | `{ maxWorkSlots?, workSlotLocation? }` | `{ "workSlotLocation": "auto", "maxWorkSlots": 3 }` |
| `gitq.forges` | user | host-keyed map, naming `tokenEnv` variables only, never a live token | `{}` |
| `gitq.board` | machine | `{ repos, port, herdrWorkspace }` | none: `rt setup` writes it with the repos your team tracks |

Set one with the rt CLI:

```bash
rt settings set gitq.workSlots '{"maxWorkSlots":4}' --scope machine
```

`rt settings set <key> <json-value> --scope user|team|machine` **replaces the whole value stored at that key and scope**, so a value with more than one field needs every field you want to keep. A field you leave out reads its default. Check what is there first with `rt settings explain gitq.workSlots`.

Older gitq read `settings.json` and the board's `config.json` from the app root; `rt setup update` copied their values into these keys and renamed each file `<name>.imported`.
```

- The board quickstart (279-285): replace the two `mkdir`/`cp` lines with `rt settings set gitq.board '{"repos":[{"path":"/path/to/repo"}]}' --scope machine   # rt setup writes this for you`, and "Config changes need a restart" stays.

- [ ] **Step 2: Website pages**

`reference/configuration.mdx`:

- The intro paragraph becomes: "gitq reads its configuration from the [rt](/rt) settings store: the CLI reads `gitq.workSlots` and `gitq.forges`, and the board reads `gitq.board`. A key nobody set reads its default."
- `## The settings store`: the table drops the precedence and file columns and takes a "With nothing set" column with the three values from the README table above; delete the paragraph "A resolver throw ... degrades to the file after one warning ... opt-in, not a flag day." and replace it with "A resolver throw (an unreadable or malformed store file, never the daemon) reads the key's default after one warning; `gitq.board` has none, so the board stops at startup instead."; keep the `rt settings set` paragraph.
- `## The CLI: \`settings.json\``: rename to `## The CLI's directory`; keep the paragraphs about `GITQ_CONFIG_DIR`, work slots and what the variable does not move, with "the stack stores, the settings file, the operation log" becoming "the stack stores and the operation log"; replace "Inside it, `settings.json` holds the three keys ..." and the three per-key sections with one paragraph per field of `gitq.workSlots` and `gitq.forges`, each shown as an `rt settings set` command instead of a JSON file (for example `rt settings set gitq.workSlots '{"workSlotLocation":"root"}' --scope machine` and `rt settings set gitq.forges '{"gitlab.acme.com":{"provider":"gitlab"}}' --scope user`), keeping every sentence about what each value means and does; delete "gitq never creates or writes this file itself; make it by hand ..." and "out of the same file as `maxWorkSlots` ... not merged host by host with what's in the file."
- `## The forge token`: in the refusal quote's parenthesis, delete "and gives the `settings.json` fallback too".
- `## The board: \`config.json\``: rename to `## The board: \`gitq.board\``; its first paragraph becomes "The board (`src/server/server.ts`) is a separate process that reads `gitq.board`, a machine-scoped [store key](#the-settings-store). `rt setup` writes it with the repos your team tracks:" followed by the existing JSON example; "Parsed and validated by `validateBoardConfig` ... against whichever source answers" becomes "Validated by `validateBoardConfig` (`src/server/config.ts`)"; the failure sentence becomes: "No `gitq.board` in the store is a startup failure that names the `rt settings set` command to run (`src/server/config.ts`)."; "an edit — to either the store or the file — needs a server restart" becomes "an edit needs a server restart".

`concepts/state.mdx`: delete the `settings.json` and `config.json` rows from the short-version table and the `### settings.json` and `### config.json` sections; in "The app root" paragraph drop "`settings.json`, " and "the board's `config.json` and "; "(stacks, settings, operation log, work slots)" becomes "(stacks, operation log, work slots)"; the board section's intro "Both of these live ..." becomes "This lives in the [app root](#the-app-root-and-the-config-directory-inside-it) and, unlike the CLI's files, does not follow `GITQ_CONFIG_DIR`." Add one sentence under the short-version table: "Settings are not files gitq keeps: they live in the rt settings store ([Configuration](/gitq/reference/configuration))."

`concepts/work-slots.mdx`: "and `workSlotLocation` in `settings.json` turns it off" becomes "and the `workSlotLocation` field of `gitq.workSlots` turns it off"; the `## workSlotLocation` section's first sentence becomes "Where new slots are created, read from `gitq.workSlots`. `auto` is the default and is the two-row table above. `root` forces every slot gitq creates under the work-slot root, even in a pool. Anything else is `auto`." and its JSON example becomes `rt settings set gitq.workSlots '{"workSlotLocation":"root"}' --scope machine`; the `## maxWorkSlots` first paragraph becomes "The cap on slots per repo, read from `maxWorkSlots` in the `gitq.workSlots` machine-scoped [rt settings store](/gitq/reference/configuration#the-settings-store) key. It must be a number of at least 1, and it is floored. Anything else gives the default of **3**."; the quoted error loses " (or, until gitq.workSlots is imported, edit maxWorkSlots in settings.json)".

`guides/worktree-pools.mdx:31`: "Setting `workSlotLocation` to `root` in `settings.json`" becomes "Setting `gitq.workSlots`'s `workSlotLocation` to `root`".

`getting-started/install.mdx:70`: drop "`settings.json`, " and "the board's `config.json` and ".

`getting-started/the-board.mdx:14-37`: the `## Configure it` intro becomes "The server reads `gitq.board` from the rt settings store. `rt setup` writes it with the repos your team tracks; to set it by hand:" followed by `rt settings set gitq.board '{"repos":[{"path":"/path/to/repo","name":"example"}],"port":11008,"herdrWorkspace":"gitq"}' --scope machine` in a `bash` block (replacing the `mkdir`/`cp` block and the JSON block); "so a launch agent can pin the port without editing the file" becomes "so a launch agent can pin the port without changing the setting"; "named once in `settings.json`'s `forges`" becomes "named once in `gitq.forges`"; "An existing `config.json` still carrying it loads fine, ignored." becomes "A stored value still carrying it loads fine, ignored."; "Editing `config.json` needs a restart." becomes "Changing `gitq.board` needs a restart."

- [ ] **Step 3: Check**

```bash
rg -n "settings\.json|config\.json|config\.example|imported into the store|until .* is imported" apps/gitq/README.md website/docs/gitq
for f in website/docs/gitq/reference/configuration.mdx website/docs/gitq/concepts/state.mdx website/docs/gitq/concepts/work-slots.mdx website/docs/gitq/guides/worktree-pools.mdx website/docs/gitq/getting-started/install.mdx website/docs/gitq/getting-started/the-board.mdx; do python3 skills/doc-standards/scripts/check_docs.py "$f" --no-vale; done
bun run docs:check
bun run docs:build
```

Expected: the `rg` finds only the README's sentence about the old files being imported; zero doc-standards errors; docs build. Then look at `/gitq/reference/configuration`, `/gitq/concepts/state`, `/gitq/concepts/work-slots` and `/gitq/getting-started/the-board` in Fast Browser (delegate to `fast-browser:browser-driver`), light and dark, at the local docs server's port (never a `*.mattstack` URL), and say plainly anything that reads wrong.

- [ ] **Step 4: Commit**

```bash
git add apps/gitq/README.md website/docs/gitq
```

```bash
git commit -m "gitq docs: settings live in the store, the old files are history"
```

---

### Task 7: Deck copies its own fields once, then reads them from the store alone

**Files:**
- Modify: `apps/deck/core/settings.ts:1-12,74-300,346-372`
- Modify: `apps/deck/src/api/platform-settings.ts:1-225`
- Modify: `apps/deck/src/edge/oauth.ts:1-260`
- Modify tests: `apps/deck/core/settings.test.ts`, `apps/deck/src/api/platform-settings.test.ts`, `apps/deck/src/api/platform-settings.railway.test.ts`, `apps/deck/src/api/platform-settings.tunnel.test.ts`, `apps/deck/src/edge/oauth.test.ts`
- Modify: `apps/deck/AGENTS.md:136-145`, `apps/deck/README.md:277-280`
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (`deck.apps`, `deck.access`, `deck.platform`), `registry-console-ready.test.ts` (`PENDING_DEFAULT`), `lib/__tests__/no-presence-by-undefined.test.ts` (`ALLOWLIST`)

**Interfaces:**
- Produces: `importFileFields(resolve?, write?): Record<string, Partial<{ published: boolean; publicFollowsOverride: boolean }>>` (`core/settings.ts`), `importFileFields(resolve?, write?): Partial<StoreFields>` (`platform-settings.ts`), `importAccessFile(resolve?, write?): Record<string, OAuth>` (`oauth.ts`): each copies the module's migrated fields into the store when no store sets the key, and returns what this boot must still overlay when the copy failed (empty on success). `updatePlatformSettings(patch: Partial<PlatformSettings>): void` loses its `resolve` parameter. Removed: `isAppsStoreOwned`, `stripMigratedFields`, `withAppsStoreFallback`, `isPlatformStoreOwned`, `withPlatformStoreFallback`, `isAccessStoreOwned`, `withAccessStoreFallback`, `loadFileKept`, `saveFile`.

This task implements Open question 1's recommendation. Disjoint from Tasks 6 and 8.

- [ ] **Step 1: Write the failing tests**

In `apps/deck/core/settings.test.ts` (it already points `LOCAL_APPS_SETTINGS_PATH` at a temp file and isolates HOME), import `importFileFields` alongside the others and add:

```ts
const appsPath = () => process.env.LOCAL_APPS_SETTINGS_PATH!;

test('a private app in settings.json moves into deck.apps before the first read; the file keeps the rest', () => {
  writeFileSync(appsPath(), JSON.stringify({ version: 1, secret: 's', apps: { widgets: { published: false, passwordVersion: 2 } } }));
  expect(importFileFields()).toEqual({});
  expect(getSetting('deck.apps').value).toEqual({ widgets: { published: false } });
  expect(JSON.parse(readFileSync(appsPath(), 'utf8'))).toEqual({ version: 1, secret: 's', apps: { widgets: { passwordVersion: 2 } } });
  reloadSettings();
  expect(getAppSettings('widgets').published).toBe(false);
});

test('a deck.apps a store already sets is kept; the file copy is dropped, not imported', () => {
  setSetting('deck.apps', { widgets: { published: true } }, 'user');
  writeFileSync(appsPath(), JSON.stringify({ version: 1, apps: { widgets: { published: false } } }));
  importFileFields();
  expect(getSetting('deck.apps').value).toEqual({ widgets: { published: true } });
  expect(JSON.parse(readFileSync(appsPath(), 'utf8')).apps).toEqual({});
});

test('a failed copy keeps this start on the file values and leaves the file alone', () => {
  const body = JSON.stringify({ version: 1, apps: { widgets: { published: false } } });
  writeFileSync(appsPath(), body);
  const failing = (() => {
    throw new Error('store locked');
  }) as typeof setSetting;
  const pending = importFileFields(getSetting, failing);
  expect(pending).toEqual({ widgets: { published: false } });
  expect(readFileSync(appsPath(), 'utf8')).toBe(body);
});

test('a save keeps published only in the store', async () => {
  await setPublished('widgets', false);
  expect(getSetting('deck.apps').value).toMatchObject({ widgets: { published: false } });
  expect(JSON.parse(readFileSync(appsPath(), 'utf8')).apps.widgets?.published).toBeUndefined();
});

test('minting the secret on a fresh install writes no settings store', () => {
  rmSync(userStorePath(), { force: true });
  writeFileSync(appsPath(), JSON.stringify({ version: 1, apps: {} }));
  reloadSettings();
  expect(getSecret()).toMatch(/^[0-9a-f]{64}$/);
  expect(existsSync(userStorePath())).toBe(false);
});
```

In `apps/deck/src/api/platform-settings.test.ts`:

```ts
test('nothing set reads the old defaults: no domain, no prefixes, no railway, no tunnel, localhost only', () => {
  writeFileSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, '{}');
  reloadPlatformSettings();
  expect(getPlatformSettings()).toEqual({ publicDomain: null, tlds: ['localhost'], legacyPrefixes: [], secrets: {}, railway: null, tunnel: null });
});

test('the four store fields move out of platform.json once; tlds and secrets stay', () => {
  writeFileSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, JSON.stringify({ publicDomain: 'apps.example.com', legacyPrefixes: ['old'], tlds: ['localhost', 'test'], secrets: { cfZoneId: 'z' } }));
  expect(importFileFields()).toEqual({});
  expect(getSetting('deck.platform').value).toEqual({ publicDomain: 'apps.example.com', legacyPrefixes: ['old'], railway: null, tunnel: null });
  expect(JSON.parse(readFileSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, 'utf8'))).toEqual({ tlds: ['localhost', 'test'], secrets: { cfZoneId: 'z' } });
});

test('a tlds-only update writes the file and leaves the store alone', () => {
  rmSync(machineStorePath(), { force: true });
  reloadPlatformSettings();
  updatePlatformSettings({ tlds: ['localhost', 'test'] });
  expect(existsSync(machineStorePath())).toBe(false);
});
```

(`machineStorePath()` is the helper this file already uses for the machine store; reuse it.)

In `apps/deck/src/edge/oauth.test.ts`:

```ts
test('access.json moves into deck.access once, valid rules only, and is renamed', () => {
  writeFileSync(accessPath(), JSON.stringify({ apps: { widgets: { mode: 'emails', emails: ['dev1@example.com'] }, stale: { mode: 'nope' } } }));
  expect(importAccessFile()).toEqual({});
  expect(getSetting('deck.access').value).toEqual({ widgets: { mode: 'emails', emails: ['dev1@example.com'] } });
  expect(existsSync(accessPath())).toBe(false);
  expect(existsSync(`${accessPath()}.imported`)).toBe(true);
});

test('a failed copy keeps this start on the file rules', () => {
  writeFileSync(accessPath(), JSON.stringify({ apps: { widgets: { mode: 'domains', domains: ['example.com'] } } }));
  const failing = (() => {
    throw new Error('store locked');
  }) as typeof setSetting;
  expect(importAccessFile(getSetting, failing)).toEqual({ widgets: { mode: 'domains', domains: ['example.com'] } });
  expect(existsSync(accessPath())).toBe(true);
});

test('setOAuth writes the store and never access.json', () => {
  setOAuth('widgets', { mode: 'domains', domains: ['example.com'] });
  expect(getSetting('deck.access').value).toMatchObject({ widgets: { mode: 'domains', domains: ['example.com'] } });
  expect(existsSync(accessPath())).toBe(false);
});
```

Each file adds what these tests use to its imports (`existsSync`, `writeFileSync` from `fs`; `getSetting`, `setSetting` from `@mattstack/rt-client`; the module's own `importFileFields` or `importAccessFile`, `accessPath`, `setOAuth`).

Delete the latch tests: in `core/settings.test.ts` "a field absent from the store falls back to settings.json's value", "an app absent from the store falls back to its file entry untouched", "a resolver throw on the ownership probe degrades to unowned rather than crashing the write", and rename "store key present: passwordVersion survives a write that strips the migrated fields from the file" to "passwordVersion survives a write; the file never carries the store fields"; in `platform-settings.test.ts` "a field absent from the store falls back to platform.json's value", "the inverse: a store carrying only legacyPrefixes still falls back to the file for publicDomain", "a resolver throw degrades to platform.json's values, warning once", "a tlds-only patch never strips publicDomain/legacyPrefixes that only the file was carrying" and "a resolver throw on the ownership probe degrades to unowned rather than crashing the write", and rename "deck.platform store value wins over platform.json, per field" to "deck.platform's store value is what deck reads" and "store key present: platform.json no longer carries the migrated fields after a write" to "platform.json never carries the store fields after a write"; in `platform-settings.railway.test.ts` and `.tunnel.test.ts` drop "(unowned: via platform.json)" from the names and assert the round trip through the store; in `oauth.test.ts` "deck.access store entry wins over access.json wholesale, per app", "an app absent from the store falls back to its access.json entry", "a resolver throw degrades to access.json's entries entirely, warning once", "access.json is written 0600", "a resolver throw on the ownership probe degrades to unowned rather than crashing the write" and the "store key present: a file-write failure collapsing access.json ..." test. Any remaining test that called `updatePlatformSettings(patch, resolve)` passes the patch alone.

- [ ] **Step 2: Run, expect FAIL**: `cd apps/deck && bun test core/settings.test.ts src/api/platform-settings.test.ts src/edge/oauth.test.ts` (`importFileFields`/`importAccessFile` not exported).

- [ ] **Step 3: Registry**: `deck.apps` and `deck.access` get `default: {},`; `deck.platform` gets `default: { publicDomain: null, legacyPrefixes: [], railway: null, tunnel: null },`; `deck.access`' description becomes "deck's sign-in rules, per app." `PENDING_DEFAULT` becomes `[]`. `ALLOWLIST` in `no-presence-by-undefined.test.ts` becomes `{}`.

- [ ] **Step 4: `core/settings.ts`**

Add `import { isDeepStrictEqual } from 'util';`. Replace everything from `const STORE_KEY = 'deck.apps';` through the end of `save` with:

```ts
const STORE_KEY = 'deck.apps';
type StoreAppFields = { published: boolean; publicFollowsOverride: boolean };
type StoreApps = Record<string, Partial<StoreAppFields>>;
type GetSettingFn = typeof getSetting;
type SetSettingFn = typeof setSetting;

/** What settings.json keeps for an app: published and publicFollowsOverride live in deck.apps. */
function fileEntry(entry: AppEntry): AppEntry {
  const { published: _published, publicFollowsOverride: _follows, ...rest } = entry;
  return rest;
}

function readFile(): SettingsFile {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8')) as SettingsFile;
    if (!parsed.apps) parsed.apps = {};
    return parsed;
  } catch {
    return { version: 1, apps: {} };
  }
}

function writeFile(state: SettingsFile): void {
  const apps: Record<string, AppEntry> = {};
  for (const [app, entry] of Object.entries(state.apps)) {
    const kept = fileEntry(entry);
    if (Object.keys(kept).length > 0) apps[app] = kept;
  }
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify({ ...state, apps }, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

/**
 * A deck that kept published and publicFollowsOverride in settings.json
 * copies them into deck.apps before its first read, so an app made private
 * never reads as public. A store that already sets deck.apps wins. When the
 * copy fails, the returned fields overlay this boot and the file is left for
 * the next one.
 */
export function importFileFields(
  resolve: GetSettingFn = getSetting,
  write: SetSettingFn = setSetting
): StoreApps {
  const file = readFile();
  const fields: StoreApps = {};
  for (const [app, entry] of Object.entries(file.apps)) {
    const picked: Partial<StoreAppFields> = {};
    if (entry.published !== undefined) picked.published = entry.published;
    if (entry.publicFollowsOverride !== undefined)
      picked.publicFollowsOverride = entry.publicFollowsOverride;
    if (Object.keys(picked).length > 0) fields[app] = picked;
  }
  if (Object.keys(fields).length === 0) return {};
  try {
    if (resolve(STORE_KEY).provenance.every(p => p.scope === 'default'))
      write(STORE_KEY, fields, 'user');
    writeFile(file);
    return {};
  } catch (err) {
    console.error(
      `deck: could not move app publishing into ${STORE_KEY}; using settings.json until the next start`,
      err
    );
    return fields;
  }
}

function readStore(resolve: GetSettingFn): StoreApps {
  try {
    return resolve<StoreApps>(STORE_KEY).value as StoreApps;
  } catch (err) {
    console.warn(`deck: ${STORE_KEY} unavailable, apps read their defaults`, err);
    return {};
  }
}

function load(resolve: GetSettingFn, pending: StoreApps = {}): SettingsFile {
  const file = readFile();
  const apps: Record<string, AppEntry> = {};
  for (const [app, entry] of Object.entries(file.apps)) apps[app] = fileEntry(entry);
  for (const [app, fields] of Object.entries({ ...readStore(resolve), ...pending }))
    apps[app] = { ...apps[app], ...fields };
  return { ...file, apps };
}

let cache: SettingsFile = load(getSetting, importFileFields());
mintSecretIfMissing();

export function reloadSettings(resolve: GetSettingFn = getSetting): void {
  cache = load(resolve);
  mintSecretIfMissing();
}

/** Minted at boot and on every reload, never on the request path. The secret is file-only, so minting never writes the store. */
function mintSecretIfMissing(): void {
  if (cache.secret) return;
  cache.secret = randomBytes(32).toString('hex');
  writeFile(cache);
}

/* buildAppsStoreDict stays as it is. */

function currentRawAppsStore(): StoreApps {
  return getSetting<StoreApps>(STORE_KEY).value as StoreApps;
}

/* nextAppsStoreDict and revertedAppsStoreDict stay as they are, typed StoreApps. */

/**
 * Every mutation funnels through here: the store fields go to deck.apps
 * (only when they changed), the rest to settings.json. A failure reverts
 * `cache` to `previous` and rethrows; a file failure after a store write
 * un-writes the store too, so a renamed app never keeps a store entry whose
 * password hash never reached disk.
 */
function save(previous: SettingsFile): void {
  const next = nextAppsStoreDict(previous);
  const storeChanged = !isDeepStrictEqual(next, currentRawAppsStore());
  if (storeChanged) {
    try {
      setSetting(STORE_KEY, next, 'user');
    } catch (err) {
      cache = previous;
      throw err;
    }
  }
  try {
    writeFile(cache);
  } catch (err) {
    if (storeChanged) {
      try {
        setSetting(STORE_KEY, revertedAppsStoreDict(previous), 'user');
      } catch (revertErr) {
        console.error('settings save: failed to revert deck.apps after a file-write failure', revertErr);
      }
    }
    cache = previous;
    console.error('settings save failed:', err);
    throw err;
  }
}
```

Delete `withAppsStoreFallback`, the old `load`, the old `mintSecretIfMissing`, `stripMigratedFields`, `isAppsStoreOwned` and `MigratedAppFields` (its uses become `StoreAppFields`). In `renameAppSettings`' doc, "The store side follows automatically (when the store owns deck.apps)" becomes "The store side follows automatically". In `setPublicFollowsOverride`, the comment "so settings.json stays free of noise" becomes "so deck.apps stays free of noise".

- [ ] **Step 5: `src/api/platform-settings.ts`**

Add `import { isDeepStrictEqual } from 'util';` and `getDef` to the rt-client import. Replace `DEFAULTS` through the end of `updatePlatformSettings` with:

```ts
const FILE_DEFAULTS: Pick<PlatformSettings, 'tlds' | 'secrets'> = {
  tlds: ['localhost'],
  secrets: {},
};

const STORE_KEY = 'deck.platform';
type StoreFields = Pick<PlatformSettings, 'publicDomain' | 'legacyPrefixes' | 'railway' | 'tunnel'>;
const STORE_FIELDS = ['publicDomain', 'legacyPrefixes', 'railway', 'tunnel'] as const;
type GetSettingFn = typeof getSetting;
type SetSettingFn = typeof setSetting;

export function platformSettingsPath(): string {
  return (
    process.env.LOCAL_PLATFORM_SETTINGS_PATH ??
    join(stateDir(), 'platform.json')
  );
}

function readFile(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(platformSettingsPath(), 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** platform.json keeps tlds and secrets; the store fields live in deck.platform. */
function writeFile(values: Record<string, unknown>): void {
  const { publicDomain: _a, legacyPrefixes: _b, railway: _c, tunnel: _d, ...kept } = values;
  const path = platformSettingsPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(kept, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

function storeFieldsOf(values: PlatformSettings): StoreFields {
  return { publicDomain: values.publicDomain, legacyPrefixes: values.legacyPrefixes, railway: values.railway, tunnel: values.tunnel };
}

/** Same one-time copy as core/settings.ts's importFileFields, for the four store fields. */
export function importFileFields(
  resolve: GetSettingFn = getSetting,
  write: SetSettingFn = setSetting
): Partial<StoreFields> {
  const file = readFile();
  const fields = Object.fromEntries(
    STORE_FIELDS.filter(f => file[f] !== undefined).map(f => [f, file[f]])
  ) as Partial<StoreFields>;
  if (Object.keys(fields).length === 0) return {};
  try {
    if (resolve(STORE_KEY).provenance.every(p => p.scope === 'default'))
      write(STORE_KEY, fields, 'machine');
    writeFile(file);
    return {};
  } catch (err) {
    console.error(`deck: could not move platform settings into ${STORE_KEY}; using platform.json until the next start`, err);
    return fields;
  }
}

function readStore(resolve: GetSettingFn): StoreFields {
  try {
    return resolve<StoreFields>(STORE_KEY).value as StoreFields;
  } catch (err) {
    console.warn(`deck: ${STORE_KEY} unavailable, using its defaults`, err);
    return structuredClone(getDef(STORE_KEY)!.default) as StoreFields;
  }
}

function load(resolve: GetSettingFn, pending: Partial<StoreFields> = {}): PlatformSettings {
  const { publicDomain: _a, legacyPrefixes: _b, railway: _c, tunnel: _d, ...fileOnly } = readFile();
  return { ...FILE_DEFAULTS, ...fileOnly, ...readStore(resolve), ...pending } as PlatformSettings;
}

let cache: PlatformSettings = load(getSetting, importFileFields());

export function reloadPlatformSettings(resolve: GetSettingFn = getSetting): void {
  cache = load(resolve);
}
export function getPlatformSettings(): PlatformSettings {
  return cache;
}

/**
 * The store fields go to deck.platform (only when they changed), the rest to
 * platform.json. Writing replaces deck.platform wholesale from this process's
 * view, as any boot-read config in deck does; a restart picks up an outside
 * edit.
 */
export function updatePlatformSettings(patch: Partial<PlatformSettings>): void {
  const previous = cache;
  cache = {
    ...cache,
    ...patch,
    secrets: { ...cache.secrets, ...(patch.secrets ?? {}) },
  };
  const storeChanged = !isDeepStrictEqual(storeFieldsOf(cache), storeFieldsOf(previous));
  if (storeChanged) {
    try {
      setSetting(STORE_KEY, storeFieldsOf(cache), 'machine');
    } catch (err) {
      cache = previous;
      throw err;
    }
  }
  try {
    writeFile(cache as unknown as Record<string, unknown>);
  } catch (err) {
    if (storeChanged) {
      try {
        setSetting(STORE_KEY, storeFieldsOf(previous), 'machine');
      } catch (revertErr) {
        console.error('platform settings save: failed to revert deck.platform after a file-write failure', revertErr);
      }
    }
    cache = previous;
    throw err;
  }
}
```

Every caller of `updatePlatformSettings` already passes one argument outside tests (`rg -n "updatePlatformSettings\(" apps/deck --type ts -g '!*.test.ts'`); fix any that passes two.

- [ ] **Step 6: `src/edge/oauth.ts`**

Imports become `import { readFileSync, renameSync } from 'fs';` and `import { join } from 'path';`. Replace from `const STORE_KEY = 'deck.access';` through the end of `renameOAuth` with:

```ts
const STORE_KEY = 'deck.access';
type GetSettingFn = typeof getSetting;
type SetSettingFn = typeof setSetting;

/**
 * A deck that kept sign-in rules in access.json copies its valid rules into
 * deck.access before the first read, then renames the file
 * access.json.imported. A store that already sets deck.access wins. When the
 * copy fails, the returned rules overlay this boot and the file is left for
 * the next one.
 */
export function importAccessFile(
  resolve: GetSettingFn = getSetting,
  write: SetSettingFn = setSetting
): Record<string, OAuth> {
  const path = accessPath();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
  const apps = (parsed as AccessFile | null)?.apps;
  const rules: Record<string, OAuth> = {};
  if (typeof apps === 'object' && apps !== null)
    for (const [app, rule] of Object.entries(apps)) if (isOAuth(rule)) rules[app] = rule;
  try {
    if (Object.keys(rules).length > 0 && resolve(STORE_KEY).provenance.every(p => p.scope === 'default'))
      write(STORE_KEY, rules, 'user');
    renameSync(path, `${path}.imported`);
    return {};
  } catch (err) {
    console.error(`deck: could not move sign-in rules into ${STORE_KEY}; using access.json until the next start`, err);
    return rules;
  }
}

function readStore(resolve: GetSettingFn): Record<string, unknown> {
  try {
    return resolve<Record<string, unknown>>(STORE_KEY).value as Record<string, unknown>;
  } catch (err) {
    console.warn(`deck: ${STORE_KEY} unavailable, apps read with no sign-in rule`, err);
    return {};
  }
}

/** The store is authoritative as written: an entry that is not a valid rule is skipped, never corrected. */
function load(resolve: GetSettingFn, pending: Record<string, OAuth> = {}): AccessFile {
  const apps: Record<string, OAuth> = {};
  for (const [app, rule] of Object.entries({ ...readStore(resolve), ...pending }))
    if (isOAuth(rule)) apps[app] = rule;
  return { apps };
}

let cache: AccessFile = load(getSetting, importAccessFile());

export function reloadOAuth(resolve: GetSettingFn = getSetting): void {
  cache = load(resolve);
}

export function getOAuth(app: string): OAuth {
  return cache.apps[app] ?? { mode: 'off' };
}

function currentRawAccessStore(): Record<string, unknown> {
  return getSetting<Record<string, unknown>>(STORE_KEY).value as Record<string, unknown>;
}

/** Overlays this one app onto a fresh read of the store, so an entry another process wrote, or one load skipped as malformed, survives. */
export function setOAuth(app: string, rule: OAuth): void {
  const previous = structuredClone(cache);
  cache.apps[app] = rule;
  try {
    setSetting(STORE_KEY, { ...currentRawAccessStore(), [app]: rule }, 'user');
  } catch (err) {
    cache = previous;
    throw err;
  }
}

/**
 * Move an app's sign-in rule to a new name, verbatim: a rename that dropped
 * it would open the renamed app the moment its hostname goes live. A no-op
 * when the old name has no rule.
 */
export function renameOAuth(oldName: string, newName: string): void {
  const rule = cache.apps[oldName];
  if (!rule) return;
  const previous = structuredClone(cache);
  delete cache.apps[oldName];
  cache.apps[newName] = rule;
  const next = { ...currentRawAccessStore(), [newName]: rule };
  delete next[oldName];
  try {
    setSetting(STORE_KEY, next, 'user');
  } catch (err) {
    cache = previous;
    throw err;
  }
}
```

`accessPath()` stays (the import reads it); its doc, if any, says it names the old file the import reads.

- [ ] **Step 7: Deck docs**

`apps/deck/AGENTS.md:136-145`, the Settings bullet becomes:

```markdown
- Settings: `getSetting`/`setSetting` from `@mattstack/rt-client` (bundled into
  the compiled binary), or `rt settings` from a shell. Deck's config lives in
  three keys: `deck.platform` (machine: `publicDomain`, `tunnel {name,uuid}`,
  `railway {projectId,environmentId}`, `legacyPrefixes`), `deck.apps` (user:
  each app's `published` and `publicFollowsOverride`) and `deck.access`
  (user: each app's sign-in rule). Their defaults live in the registry. A
  deck that still finds those fields in `platform.json`, `settings.json` or
  `access.json` copies them into the store once, at boot, before its first
  read (`importFileFields`, `importAccessFile`). The files keep only what is
  file-only by design: the secret, password hashes, port overrides and live
  state in `settings.json`, `tlds` and `secrets` in `platform.json`. A new
  store field goes in the registry default and schema, the module's store
  field list, its store write and revert, and its file writer's exclusion.
  Never hand-edit a settings jsonc or read `~/.mattstack/deck/*.json` for
  config that belongs in settings.
```

`apps/deck/README.md:277-280`: "The registry, logs, and sign-in rules live under `~/.mattstack/deck` as plain JSON on your own disk. Settings route through ..." becomes "The registry and logs live under `~/.mattstack/deck` as plain JSON on your own disk. Settings, sign-in rules included, route through mattstack's own git-backed settings store instead, also just files, no server."

- [ ] **Step 8: Build and pass**

```bash
bun run --cwd packages/rt-client build
env -i HOME="$(mktemp -d)" PATH="$PATH" bun run cli.ts settings schema lock
git diff --exit-code packages/rt-client/src/settings/schema.lock.json
bun test packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts packages/rt-client/test/index-surface.test.ts lib/__tests__/no-presence-by-undefined.test.ts
cd apps/deck && bun test core/settings.test.ts core/settings-path-fallback.test.ts core/gateway.test.ts core/gateway-proxy.test.ts src/api/platform-settings.test.ts src/api/platform-settings.railway.test.ts src/api/platform-settings.tunnel.test.ts src/edge/oauth.test.ts src/edge/access.test.ts src/edge/domain.bind.test.ts src/api/server.test.ts src/api/status.test.ts
```

Deck has no typecheck script: run `bunx tsc --noEmit -p .` from `apps/deck` once before Step 3 (note the error count) and again now; the second run adds no errors.

- [ ] **Step 9: Commit**

```bash
git add -A apps/deck/core apps/deck/src apps/deck/AGENTS.md apps/deck/README.md packages/rt-client/src/settings lib/__tests__/no-presence-by-undefined.test.ts
```

```bash
git commit -m "deck: copy its old fields into the store once, then read the store alone"
```

---

### Task 8: The console fixture names a registered key

**Files:**
- Modify: `apps/console/src/app/settings/fixtures/repos.ts:11`
- Modify: `apps/console/src/app/settings/KeyPanel.test.tsx:600,649`

Independent of every other task.

- [ ] **Step 1: Edit**: `POOL_KEY` becomes `'rt.worktrees'` (spec section 7); the two `def('rt.worktreePool', ...)` calls in `KeyPanel.test.tsx` become `def('rt.worktrees', ...)`. `rg -n "worktreePool" apps/console/src` must come back empty.

- [ ] **Step 2: Pass**: `cd apps/console && npx vitest run src/app/settings/KeyPanel.test.tsx` and `bun run console:typecheck`.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/app/settings/fixtures/repos.ts apps/console/src/app/settings/KeyPanel.test.tsx
```

```bash
git commit -m "console: the pool fixture uses the registered rt.worktrees key"
```

---

### Task 9: The pending lists and the latch wording go

**Files:**
- Modify: `packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts:132-148`
- Modify: `lib/__tests__/no-presence-by-undefined.test.ts:1-6,19-24,56`
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (eight descriptions at lines 118, 262, 281, 325, 344, 599, 909, 917)
- Modify: `lib/team/create.ts:170-171`, `lib/setup/steps/settings.ts:12-16`

- [ ] **Step 1: The gates lose their lists**

`registry-console-ready.test.ts`: delete the `PENDING_DEFAULT` doc comment and constant, and the test body becomes:

```ts
  test("every key has a default or a defaultNote", () => {
    const bare = defs.filter((d) => !("default" in d) && !d.defaultNote).map((d) => d.key);
    expect({ without: bare, note: ADD_A_KEY }).toEqual({ without: [], note: ADD_A_KEY });
  });
```

`no-presence-by-undefined.test.ts`: delete `ALLOWLIST`; the assertion becomes `expect(counts).toEqual({});`; the header comment's last sentence ("Each allowlisted file is an ownership latch ...") goes.

- [ ] **Step 2: Wording**: in `registry-defs.ts`, delete the sentence "A fresh key, not an ownership-latch port, so a default is fine here." from each of the eight descriptions (`rg -n "ownership-latch" packages/rt-client/src/settings/registry-defs.ts` comes back empty). `lib/team/create.ts:170-171`: "a present value claims repos for the team's pack and flips the board's store-ownership latch." becomes "a present value claims repos for the team's pack." `lib/setup/steps/settings.ts:12-16`: the paragraph becomes "Never seeds a key with an empty placeholder value: an empty list claims nothing and hides the setup row that asks for the real one. Every write here carries a real, non-empty value or doesn't happen."

- [ ] **Step 3: Pass**

```bash
bun run --cwd packages/rt-client build
bun test packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts lib/__tests__/no-presence-by-undefined.test.ts lib/team/__tests__/create.test.ts lib/setup/__tests__/steps-a.test.ts
rg -n -i "ownership latch|ownership-latch|store-ownership|PENDING_DEFAULT" commands lib packages apps/board/src apps/gitq/src apps/deck/core apps/deck/src -g '!node_modules' -g '!dist'
```

Expected: tests pass; the `rg` finds nothing (or only test names that describe the board's re-review latch, which is a different feature).

- [ ] **Step 4: Commit**

```bash
git add packages/rt-client/src/settings lib/__tests__/no-presence-by-undefined.test.ts lib/team/create.ts lib/setup/steps/settings.ts
```

```bash
git commit -m "settings: every key answers what it is when unset; the pending lists and latch wording go"
```

---

### Task 10: Skills say defaults live in the registry and presence is provenance

**Files:**
- Modify: `skills/rt-settings/SKILL.md:27-30,108-118,246`
- Modify: `apps/board/skills-src/review/SKILL.md:94,245,247,739-746`, `apps/board/skills-src/respond/launch.md:45,117,119,237-244`; regenerate `apps/board/skills/`
- Modify: `plugins/mattstack/attachments/writing-style-lookup/SKILL.md:9-14`, `plugins/mattstack/.claude-plugin/plugin.json` (version `0.31.1` → `0.31.2`)

Every live skill mention, found with `rg -n -i "ownership latch|legacy config|app-side read|preferences\.md" skills plugins/mattstack apps/board/skills-src -g '!**/node_modules/**'`:

| File | Line(s) | What it says now |
|---|---|---|
| `skills/rt-settings/SKILL.md` | 27-30 | "add a `default` only after clearing line 5; a ported `board.*` row never has one" |
| `skills/rt-settings/SKILL.md` | 108-118 | rule 5: board rows never carry `default:`, fallback app-side, the ownership latch |
| `skills/rt-settings/SKILL.md` | 246 | "porting + ownership latch" in "Where the details live" |
| `apps/board/skills-src/review/SKILL.md` | 94, 245, 247, 739-746 | the `preferences.md` fallback node and section |
| `apps/board/skills-src/respond/launch.md` | 45, 117, 119, 237-244 | the same, for respond |
| `plugins/mattstack/attachments/writing-style-lookup/SKILL.md` | 12-14 | the `preferences.md` fallback |

- [ ] **Step 1: Load the skills**: invoke `superpowers:writing-skills` and `mattstack:editing-skills` and follow them for every edit below (baseline, edit, verify, and how each surface goes live).

- [ ] **Step 2: `rt:settings`**

Contract item 2, "(type, allowed scopes, merge, description — add a `default` only after clearing line 5; a ported `board.*` row never has one)" becomes "(type, allowed scopes, merge, description, and a `default` or `defaultNote` per line 5)".

Rule 5 (lines 108-118) becomes:

```markdown
5. A key's default lives in its registry row and nowhere else: `default:`
   for a key whose app falls back to a fixed value or to an empty `[]`/`{}`,
   and `defaultNote:` (one short plain sentence the console shows) for a key
   with none, such as an identity, a trust grant, a required value or one
   computed from the machine. `registry-console-ready.test.ts` fails a row
   with neither. A reader takes `getSetting(k).value`, which carries the
   default, and adds no `?? fallback` of its own. Whether anyone set a key
   is a provenance question: `unwritten(key)` or `onlyDefault(resolved)`
   (`lib/settings/presence.ts`; in an app, `resolved.provenance`), never
   `.value === undefined`, which a default makes always false
   (`lib/__tests__/no-presence-by-undefined.test.ts`). Any registry block's
   own comment binds every row added under it.
```

"Where the details live", first row: "porting + ownership latch" becomes "defaults and default notes, the porting history".

- [ ] **Step 3: Board review and respond skills** (`apps/board/skills-src/` only)

In both files, the digraph node and its two edges rename "Load the preferences.md style, else conversational (review)" to "Load conversational (review)" (and `(respond)` in `launch.md`), and the section under that heading becomes:

```markdown
### Load conversational (review)

`rt_verb` is unavailable, refused, or failed. Load
`mattstack:writing-style-conversational`. The load still comes before the
first drafted word. This fallback is the defined path, not an off-script
origin.
```

(with `(respond)` in `launch.md`). Then `bun run skills:expand:board` and `bun run skills:check:board`.

- [ ] **Step 4: The plugin's lookup**: `writing-style-lookup/SKILL.md`'s last two sentences become "If the tool is unavailable, refused, or fails, or the skill it names will not load, load `mattstack:writing-style-conversational`." Bump `plugins/mattstack/.claude-plugin/plugin.json`'s `version` to `0.31.2`.

- [ ] **Step 5: Check**

```bash
rg -n -i "ownership latch|legacy config|app-side read|preferences\.md" skills plugins/mattstack apps/board/skills-src apps/board/skills -g '!**/node_modules/**'
bun run skills:check:board
(cd plugins/mattstack && sh tests/certify.sh attachments/writing-style-lookup/)
env -i HOME="$(mktemp -d)" PATH="$PATH" bun cli.ts skills check --pack-dir "$PWD/plugins/mattstack" --mattstack-dir "$(mktemp -d)" --strict
bun test lib/__tests__/no-board-skills-drift.test.ts
```

Expected: the `rg` finds only the review skill's unrelated "re-review latch" lines (none of the four patterns); every check passes.

- [ ] **Step 6: Commit**

```bash
git add skills/rt-settings/SKILL.md apps/board/skills-src apps/board/skills plugins/mattstack/attachments/writing-style-lookup/SKILL.md plugins/mattstack/.claude-plugin/plugin.json
```

```bash
git commit -m "skills: defaults live in the registry; the writing-style fallback is conversational"
```

---

### Task 11: The settings docs describe defaults, and the latch becomes history

**Files:**
- Modify: `docs/settings-architecture.md:153-162,314-335`
- Modify: `AGENTS.md:13-19` ("Settings architecture")

Every live doc mention of the latch, found with `rg -n -i "ownership latch|one-way latch|store-ownership" --glob '*.md' --glob '*.mdx' --glob '!**/superpowers/**' --glob '!**/node_modules/**' .`: `AGENTS.md:16-17`, `docs/settings-architecture.md:314,333`, `skills/rt-settings/SKILL.md:115,246` (Task 10), `apps/board/README.md:156` and `apps/board/docs/configuration.md:11` (Task 4). `apps/deck/AGENTS.md:141` (Task 7) and the gitq pages (Task 6) describe the fallback without the word.

- [ ] **Step 1: Checklist**: append to step 1 of "Adding a key (the checklist)":

```markdown
   Then give the row its `default`, the value the app uses with nothing set
   (`[]` or `{}` for a key whose empty value means no config), or, for a key
   with none (an identity, a trust grant, a required or computed value), a
   `defaultNote`: one short plain sentence the console shows instead.
   `registry-console-ready.test.ts` fails a row with neither, or with both.
   A reader takes `getSetting(k).value` with no `?? fallback` of its own and
   asks whether anyone set a key with `unwritten`/`onlyDefault`
   (`lib/settings/presence.ts`), never `.value === undefined`.
```

- [ ] **Step 2: History note**: replace the whole "## Porting an app's config (the ownership latch)" section, through the "**Invariant: ...**" paragraph, with:

```markdown
## Porting history

Until RT-487 an app's own config file could keep owning a key: the reader
fell back to the file while `getSetting(k).value` was `undefined`, so a
ported key carried no registry default. The
`2026-10-10-import-legacy-settings` and `2026-10-11-import-app-settings`
setup migrations copied the last live values into the user and machine
stores, deck copies its own at boot, and every reader now reads the store
alone. A new port goes in the same order: a migration copies the file's
values (user and machine scope only, never over a value a store holds),
verifies each copy read back, renames the file `<name>.imported`, and only
then does the reader drop the file. `lib/state/legacy-import.ts` is the
reference for verifying before the rename.
```

- [ ] **Step 3: AGENTS.md**: "(scope model, registry checklist, ownership latch, the call-time HOME and sops footguns). The working rules for `getSetting`/`setSetting`, scope choice and latches are" becomes "(scope model, registry checklist, defaults and default notes, the call-time HOME and sops footguns). The working rules for `getSetting`/`setSetting`, scope choice and defaults are".

- [ ] **Step 4: Check**: rerun the `rg` above (expect nothing outside `docs/superpowers/`), then `python3 skills/doc-standards/scripts/check_docs.py docs/settings-architecture.md --no-vale` and `bun run docs:check`.

- [ ] **Step 5: Commit**

```bash
git add docs/settings-architecture.md AGENTS.md
```

```bash
git commit -m "docs: settings defaults in the checklist; the ownership latch becomes history"
```

---

### Task 12: PR-wide gates and the PR

**Files:** none new (regenerated outputs only, if a gate asks).

- [ ] **Step 1: Nothing is pending**: `rg -n "PENDING_DEFAULT|ALLOWLIST" packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts lib/__tests__/no-presence-by-undefined.test.ts` comes back empty.

- [ ] **Step 2: Store and schema gates, isolated**

```bash
bun run --cwd packages/rt-client build
env -i HOME="$(mktemp -d)" PATH="$PATH" bun run cli.ts settings schema lock
git diff --exit-code packages/rt-client/src/settings/schema.lock.json
env -i HOME="$(mktemp -d)" PATH="$PATH" bun cli.ts settings check --json
```

Expected: no lock diff; `{"ok":true,"findings":[]}` (a default is not a store value).

- [ ] **Step 3: Guards and copy snapshots**

```bash
bun test lib/__tests__/no-presence-by-undefined.test.ts packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts lib/__tests__/no-settings-bypass.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-shared-store-migrations.test.ts commands/__tests__/setup-copy.test.ts packages/rt-client/test/dist-freshness.test.ts lib/__tests__/no-board-skills-drift.test.ts
```

`setup-copy` should pass unchanged (no row wording moved). If it fails only on a sentence this PR changed on purpose, update it with `bun test commands/__tests__/setup-copy.test.ts --update-snapshots` and say so in the PR; any other diff stops the task.

- [ ] **Step 4: Docs and the static gate**: `bun run docs:check` (if it reports a stale settings reference, `bun run docs:gen` and commit the result), then `bun run check 2>&1 | tail -20`. Expected: PASS.

- [ ] **Step 5: Push and open the PR**: title `RT-487: settings defaults, part 3 (board, gitq, deck, skills)`. The body follows `.github/pull_request_template.md` if the repo has one: the import migration and what it copies; deck's boot-time copy; per key, the default added and the reader retired; the seed and `gitq.board` repair; the skills and docs rewritten; the plugin version bump; each open question's answer as applied. End with the attribution line. Then wait for CodeRabbit and CI (address every actionable finding) before asking Matt to merge.

---

## Self-review

- **Spec coverage.** Delivery 3 (board): Tasks 3 and 4, import in Task 2. Delivery 4 (gitq, deck, the seed): Tasks 5, 6 and 7, gitq import in Task 2, deck's in Task 7. Delivery 5 (skills and docs): Tasks 10 and 11. Section 6's "Registry block comments that forbid defaults are removed": Task 3 (board block) and Task 9 (descriptions). Section 7: the seed (Task 5) and the fixture key (Task 8). Testing: per parser-backed key `parse(undefined)` equals the default (Task 3's `registry-defaults.test.ts`; deck's platform default in Task 7), migration fixtures run twice and keep store values (Task 2), each app's latch tests deleted or rewritten (Tasks 3, 5, 7).
- **Placeholders.** None: every code step carries its code; doc steps carry their replacement text or an exact sentence-level edit.
- **Names.** `boardSetting`, `loadConfig(resolve)`, `boardConfigured(resolve)`, `storedValue`, `storeHolds`, `importAppSettingsMigration`, `importFileFields`, `importAccessFile`, `validateBoardConfig` are used with the same signatures in every task that names them.
- **Review Focus.** Each line has its pinning test in the named task.
