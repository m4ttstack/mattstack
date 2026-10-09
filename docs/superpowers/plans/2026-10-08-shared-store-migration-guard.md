# Shared-store migration guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop setup migrations from writing the shared org and team stores (in CI and at run time), move the team directory onto a layout 3 conversion script, fail CI on a new setting that is not console-ready, and teach agents which tool fits.

**Architecture:**
- **Runtime refusal:** a flag in rt-client's write module refuses org- and team-scope writes while a non-allowlisted migration runs.
- **Static guard:** a `no-` test scans `lib/setup/migrations/`.
- **Team directory move:** its planner moves out of the migration list into `scripts/lib/`, behind a script shaped like the layout 2 one, sharing a new preflight helper. `ORG_LAYOUT` goes to 3.
- **Console readiness:** a registry test with shrink-only allowlists makes every new setting carry a schema and annotated properties.
- **Guidance:** the `rt:settings` skill, root `AGENTS.md` and `docs/settings-architecture.md` gain the rule.

**Tech Stack:** Bun, TypeScript, bun:test.

**Spec:** `docs/superpowers/specs/2026-10-08-shared-store-migration-guard-design.md`

## Global Constraints

- A setup migration never writes the org or team stores. The one exception, `2026-10-07-sdm-resources-key`, is listed in `SHARED_STORE_MIGRATIONS` (`lib/setup/migrations/index.ts`) with its reason.
- The refusal sentence, verbatim: `A setup migration only changes this Mac. A change to the org or team stores is a layout change: see the rt:settings skill, "Changing the org repo's layout".`
- `ORG_LAYOUT` becomes 3. `ORG_LAYOUT_ABSENT_DEFAULT` stays 2.
- Conversion script: `bun scripts/move-to-team-directory.ts <clone-dir> --admin <username> [--write]`.
- Tests that read source as text are named `no-*.test.ts`.
- Run `bun test` from the worktree root (bunfig loads only from the cwd). After any change under `packages/rt-client/src`, run `cd packages/rt-client && bun run build`.
- Comments state only constraints the code cannot show.
- Edits to `skills/rt-settings/SKILL.md` go through `superpowers:writing-skills`.
- Every commit message ends with a `Co-Authored-By:` line naming the model that wrote it.

## Review Focus

- **A migration that writes through a helper outside `lib/setup/migrations/`.** The static guard cannot see it, so the runtime refusal must. Tested in Task 2.
- **An allowlisted migration whose write throws for another reason.** The flag must still clear, through `finally`, so later steps can write. Tested in Task 2.
- **The script pointed at a copy of the clone, not the one rt reads.** It must refuse, because its writes go to the resolver's org. Tested in Task 6.
- **A clone already at layout 3, run again.** It refuses with "already converted" and changes nothing. Tested in Task 6.
- **A key that gains a schema but stays on the console-ready allowlist.** The test fails until it is removed from the list. Tested in Task 7.

---

### Task 1: Take the team directory move out of the migrations list

**Files:**
- Create: `scripts/lib/team-directory-move.ts`. Move into it, verbatim, `entryFromTeamStore`, `withoutRetired`, `apply`, and the types and helpers `Tab`, `Write`, `Values`, `slackOf`, `tabsOf` and `bare` from `lib/setup/migrations/team-directory.ts`. Fix the relative import paths for the new location.
- Add to the new file, in the same module, a pure planner built from the body of `teamDirectoryMigration.run` (lines 95-117 and the write order of lines 119-129):

```ts
export interface DirectoryPlan {
  /** The directory to write, or null when no team gained an entry. */
  directory: TeamDirectory | null;
  /** Writes per team store; only teams with a folder and a directory entry. */
  teamWrites: Record<string, Write[]>;
  /** Writes to the org store: board.slack.channel removed when present. */
  orgWrites: Write[];
  /** Plain lines for the plan printout, one per entry added and per store changed. */
  report: string[];
}

export class DirectoryRefusal extends Error {
  constructor(message: string, readonly why?: string) { super(message); }
}

/** Throws DirectoryRefusal when the existing directory already has a duplicate code owners channel. */
export function planDirectoryMove(orgValues: Values, teamValues: Record<string, Values>): DirectoryPlan
```

  `teamValues` is keyed by team folder name. Refusal copy: title `Two teams claim #<channel> as their code owners channel`, why `<a> and <b> both claim it. Fix the team directory, then run this again.`
- Delete: `lib/setup/migrations/team-directory.ts`. Remove `teamDirectoryMigration` from `MIGRATIONS` in `lib/setup/migrations/index.ts`.
- Move: `lib/setup/__tests__/migration-team-directory.test.ts` becomes `scripts/__tests__/team-directory-move.test.ts`. Keep every `entryFromTeamStore` and `withoutRetired` case. Turn each `run(ctx)` case into a `planDirectoryMove` case over plain values; the outcome detail strings become `report` and `DirectoryRefusal` assertions. Cases that test ownership refusals (owner, non-admin) move to Task 6, where the script checks the admin.
- Modify: `commands/__tests__/onboarding-org.test.ts` L438. Remove `"migration.2026-10-08-team-directory"` from `expectedOrder`.
- Modify: `lib/__tests__/no-settings-bypass.test.ts`. Rename the three `lib/setup/migrations/team-directory.ts` entries to `scripts/lib/team-directory-move.ts`, and recount them by running the test.

**Interfaces:**
- Produces: `planDirectoryMove`, `DirectoryPlan`, `DirectoryRefusal`, `apply(org, writes, scope, opts)` and `Write`, all from `scripts/lib/team-directory-move.ts`.

Steps:
- [ ] **Step 1: Move the tests.** Write `scripts/__tests__/team-directory-move.test.ts` against the new module. Run `bun test scripts/__tests__/team-directory-move.test.ts`. It should FAIL with the module not found.
- [ ] **Step 2: Move the code.** Create `scripts/lib/team-directory-move.ts`, delete the migration file, and edit the index. Run the new test, `bun test lib/setup/__tests__ commands/__tests__/onboarding-org.test.ts lib/__tests__/no-settings-bypass.test.ts`. Expect PASS.
- [ ] **Step 3: Commit.** Message: `setup: the team directory move leaves the migrations list for a script`.

---

### Task 2: Refuse shared-store writes while a migration runs

**Files:**
- Modify: `packages/rt-client/src/settings/write.ts`.
- Modify: `lib/setup/migrations/index.ts`.
- Modify: `lib/setup/apply.ts`.
- Test: `lib/setup/__tests__/migration-shared-store-refusal.test.ts`.

**Interfaces:**
- Produces, in `write.ts`, exported from rt-client's index next to `setSetting`:

```ts
let sharedWriteRefusal: string | null = null;

/** While set, org- and team-scope writes throw this sentence. Returns the previous value so a caller can restore it. */
export function refuseSharedWrites(sentence: string | null): string | null {
  const was = sharedWriteRefusal;
  sharedWriteRefusal = sentence;
  return was;
}

function assertSharedWriteAllowed(scope: SettingScope): void {
  if (sharedWriteRefusal !== null && (scope === "org" || scope === "team")) refuse(sharedWriteRefusal);
}
```

  Call `assertSharedWriteAllowed(scope)` as the first statement of `setSetting`, `unsetSetting` (before the retired-key branch) and `pruneStoreName`.
- Produces, in `lib/setup/migrations/index.ts`:

```ts
export const SHARED_STORE_REFUSAL = 'A setup migration only changes this Mac. A change to the org or team stores is a layout change: see the rt:settings skill, "Changing the org repo\'s layout".';

/** Shipped migrations that write the org or team stores, each with why it stays. No new entries: see SHARED_STORE_REFUSAL. */
export const SHARED_STORE_MIGRATIONS: Readonly<Record<string, string>> = {
  "2026-10-07-sdm-resources-key": "shipped in a release and recorded done on most Macs; it renames rt.sdmEnrichment to sdm.resources in place",
};
```

- In `apply.ts` `updateItems`, wrap the migration's run:

```ts
run: async (ctx) => {
  const was = refuseSharedWrites(m.id in SHARED_STORE_MIGRATIONS ? null : SHARED_STORE_REFUSAL);
  try { return await m.run(ctx); } finally { refuseSharedWrites(was); }
},
```

  Import `refuseSharedWrites` through `lib/settings/write.ts`, the barrel the migrations use, so both sides share one module instance.

Steps:
- [ ] **Step 1: Write the failing tests.** Use `seedOrg` under the test HOME, admin `me`, team `claim`, and `runUpdateWith(steps, [migration], ctx)` with an empty steps list (follow `lib/setup/__tests__/migration-sdm-resources-key.test.ts` for the `ctx` setup). Cases:
  1. A migration calling `setSetting("board.slack", { singleTemplate: "x" }, "team", { team: "claim" })` ends `failed`, its detail contains `SHARED_STORE_REFUSAL`, and the team store is unchanged.
  2. One calling `setSetting("rt.logLevel", "debug", "user")` ends `done`.
  3. A migration whose id is temporarily added to `SHARED_STORE_MIGRATIONS` (mutate a copy through an injected list if the constant is frozen; otherwise add a test-only id and remove it in `afterEach`) may write `team`.
  4. A migration that throws after a refused write leaves the flag cleared: a later `setSetting(..., "team")` outside any migration succeeds.
  5. A helper defined outside `lib/setup/migrations/` that writes `org` is refused when a migration calls it.

  Run it and expect FAIL.
- [ ] **Step 2: Implement.** Make the changes above, then rebuild rt-client. Run the new test, `lib/setup/__tests__/migration-sdm-resources-key.test.ts`, `lib/setup/__tests__/migrations.test.ts`, `packages/rt-client/src/settings/__tests__/write.test.ts` and `packages/rt-client/test/dist-freshness.test.ts`. Expect PASS.
- [ ] **Step 3: Commit.** Message: `setup: a migration cannot write the org or team stores`.

---

### Task 3: CI guard against shared-store migrations

**Files:**
- Create: `lib/__tests__/no-shared-store-migrations.test.ts`.

**Interfaces:**
- Consumes: `SHARED_STORE_MIGRATIONS` and `SHARED_STORE_REFUSAL` (Task 2).

```ts
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { MIGRATIONS, SHARED_STORE_MIGRATIONS, SHARED_STORE_REFUSAL } from "../setup/migrations/index.ts";

const DIR = join(import.meta.dir, "../setup/migrations");
const WRITE = /\b(setSetting|unsetSetting|pruneStoreName)\s*\(([^;]*?)\)/gs;
const PATHS = /\b(orgSettingsPath|teamSettingsPath|listTeamFolders)\b/;

export function sharedStoreHits(source: string): string[] {
  const hits: string[] = [];
  for (const m of source.matchAll(WRITE)) {
    const args = m[2]!;
    if (/"(org|team)"/.test(args)) hits.push(`${m[1]}(... "org"/"team" ...)`);
    else if (!/"(user|machine)"/.test(args)) hits.push(`${m[1]}(... a scope that is not a literal ...)`);
  }
  const path = source.match(PATHS);
  if (path) hits.push(path[1]!);
  return hits;
}

describe("setup migrations never write the org or team stores", () => {
  const allowedFiles = new Set(
    MIGRATIONS.filter((m) => m.id in SHARED_STORE_MIGRATIONS).map((m) => m.id),
  );
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".ts") && f !== "index.ts")) {
    test(file, () => {
      const source = readFileSync(join(DIR, file), "utf8");
      const ids = [...source.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]!);
      if (ids.some((id) => allowedFiles.has(id))) return;
      const hits = sharedStoreHits(source);
      if (hits.length) throw new Error(`${file}: ${hits.join(", ")}. ${SHARED_STORE_REFUSAL}`);
    });
  }
  test("the inline migrations in index.ts write only this Mac's stores", () => {
    const source = readFileSync(join(DIR, "index.ts"), "utf8").replace(/export const SHARED_STORE_[\s\S]*?;\n/g, "");
    expect(sharedStoreHits(source)).toEqual([]);
  });
});
```

  The check reads scope literals anywhere in the call's arguments, so an object literal with commas cannot shift it. A write whose scope is a variable counts as a hit. The runtime refusal (Task 2) is the backstop for anything this regex misses. Add unit cases for `sharedStoreHits` covering `"team"`, `"org"`, a variable scope, `"user"`, and a `teamSettingsPath` mention.

Steps:
- [ ] **Step 1: Write the test and confirm it catches a bad migration.** Temporarily add `lib/setup/migrations/zz-probe.ts` containing `export const x = { id: "zz", run: () => setSetting("a", 1, "team") };`. Run `bun test lib/__tests__/no-shared-store-migrations.test.ts` and expect `zz-probe.ts` to FAIL with the sentence. Delete the probe and expect PASS.
- [ ] **Step 2: Commit.** Message: `guards: no setup migration writes the org or team stores`.

---

### Task 4: `ORG_LAYOUT` 3

**Files:**
- Modify: `lib/team/org-marker.ts`, setting `ORG_LAYOUT = 3`. `ORG_LAYOUT_ABSENT_DEFAULT` stays 2.
- Modify: `packages/rt-client/test/org-fixture.ts`. `SeedOrg` gains `layout?: number`, written into the marker when given. Tests that need a ready org pass `layout: 3`. The fixture cannot import `lib/team`, so tests pass `ORG_LAYOUT` themselves.
- Modify: every test the bump breaks. Find them with `grep -rln "ORG_LAYOUT\|orgLayoutState\|seedOrg\|role: \"org\"" lib commands scripts packages/rt-client/test packages/rt-client/src`, then run those files.
  - A fixture that wants a ready org writes `layout: ORG_LAYOUT`.
  - A test that pins "layout 2 is current" now pins 3.
  - A test that means "an old layout waits" uses 2.
- Modify: root `AGENTS.md` L51. "moves only with a breaking change to the repo's shape" becomes "moves only with a breaking change to the repo's shape or to the shared settings' shape".
- Test: `lib/team/__tests__/org-layout.test.ts`. Add: a layout 2 marker reads `waiting`, a layout 3 marker reads `ready`, and a marker with no layout reads `waiting`.

Steps:
- [ ] **Step 1: Write the new `org-layout` cases.** Run them and expect FAIL.
- [ ] **Step 2: Bump and fix fixtures.** Run every file the grep found, plus `lib/daemon/__tests__/home-snapshot.test.ts`, `lib/skills/__tests__/`, `lib/team/__tests__/`, `commands/__tests__/member-upgrade.test.ts`, `scripts/__tests__/move-team-packs.test.ts` and `lib/setup/__tests__/`. Expect PASS. `scripts/lib/move-team-packs.ts` keeps `MOVED_LAYOUT = 2`, which is correct: that script produces layout 2.
- [ ] **Step 3: Commit.** Message: `team: ORG_LAYOUT 3, the team directory's layout`.

---

### Task 5: Shared preflight for org conversion scripts

**Files:**
- Create: `scripts/lib/org-conversion.ts`. Move into it, unchanged in behaviour, the checks in `scripts/move-team-packs-to-plugin.ts` L46-60 and L94-151, generalised:

```ts
export interface Conversion {
  clone: string;
  git: (...argv: string[]) => string;
  branch: string;
  start: string;
}

/** Every check a conversion makes before it writes. Throws UserActionableError or exits through `refuse`. */
export function preflight(cloneArg: string, admin: string, opts: { managedFolders: readonly string[] }): Conversion
```

  The checks, in this order:
  1. the path is the root of a git clone;
  2. team sync is off;
  3. the recorded forge username equals `--admin`;
  4. the tree is clean, and the managed folders hold no ignored files;
  5. a branch is checked out;
  6. after a fetch from origin, the branch is neither ahead nor behind origin.

  Move `refuse` and `assertNoLink` here too, exported.
- Modify: `scripts/move-team-packs-to-plugin.ts` to call `preflight`. Its move, rollback and output stay as they are.
- Test: `scripts/__tests__/org-conversion.test.ts`. Use a temp git repo with a bare origin, under the test HOME. Cases:
  - not a clone root refuses;
  - sync on refuses;
  - a dirty tree refuses;
  - no branch refuses;
  - behind origin refuses;
  - ahead of origin refuses;
  - a clean, current clone returns `{ branch, start }`.

  Set `rt.teamSnapshot` with `setSetting(..., "machine")` under the test HOME. Write the forge username with `seedOrg({ username })`, or with the same `teamLocalPath` file `seedOrg` writes.

Steps:
- [ ] **Step 1: Write the preflight tests.** Run them and expect FAIL.
- [ ] **Step 2: Extract.** Run the new test and `scripts/__tests__/move-team-packs.test.ts`. Also run `bun scripts/move-team-packs-to-plugin.ts` with no arguments, and expect the usage failure, exit 2.
- [ ] **Step 3: Commit.** Message: `scripts: one preflight for org conversion scripts`.

---

### Task 6: `scripts/move-to-team-directory.ts`

**Files:**
- Create: `scripts/move-to-team-directory.ts`. Parse arguments like the layout 2 script (usage `bun scripts/move-to-team-directory.ts <clone-dir> --admin <username> [--write]`), then:
  1. Read the marker. Refuse `This is not a mattstack org repo` unless it has `role: "org"`. Refuse `This org is already on the team directory layout` when the layout is 3 or more. Refuse `This org is on layout <n>` with why `Convert it to layout 2 first.` when it is below 2.
  2. Resolve the org slug from the marker's `org`. Refuse `Run this on the org clone rt reads` unless `resolve(clone) === orgDirUnder(home, slug)` (from `lib/team/`), with next `bun scripts/move-to-team-directory.ts ~/.mattstack/orgs/<slug> --admin <username>`.
  3. Refuse `<admin> is not an admin of this org` unless the `mattstack.org` admins in the org store list `--admin` (compare with `sameUser`).
  4. Read the org store and each team folder's store with `readStore`, then call `planDirectoryMove`. A `DirectoryRefusal` becomes `refuse(message, why)`.
  5. Print the plan as an `out.section` with `plan.report`. Without `--write`, print `Nothing was written` with the usage line as next, and stop.
  6. With `--write`, call `preflight(clone, admin, { managedFolders: ORG_CLONE_FOLDERS })`, then inside a try block:
     - `setSetting("mattstack.directory", plan.directory, "org")` when `plan.directory` is non-null;
     - `apply(slug, writes, "team", { team })` for each team's writes;
     - `apply(slug, plan.orgWrites, "org")`;
     - write the marker with `layout: 3`, keeping its header and keys, as `planMove` does for layout 2 (export that helper from `scripts/lib/move-team-packs.ts` as `markerWithLayout(text, layout)` and use it from both);
     - `git add -A -- mattstack`, then `git commit -q -m "org: move team channels and Linear keys into the team directory"`.

     On any throw, `git reset -q --hard <start>` and throw `UserActionableError("move-stopped", "The move stopped partway, and the clone is back as it was")`.
  7. Print `Moved this org onto the team directory in one commit`, with next `git show` and `rt team publish`.
- Modify: `lib/__tests__/no-settings-bypass.test.ts`. Add entries for the new script if the guard flags it, with reason "converts the org clone rt reads; reads each store's own values".
- Test: `scripts/__tests__/move-to-team-directory.test.ts`. Run the script with `Bun.spawnSync` and `env: childEnv()` (from `lib/subprocess.ts`) on a `seedOrg` org under the test HOME made into a git repo with a bare origin, with `layout: 2`, admin `me` and sync off. Cases:
  1. Plan mode prints each entry and changes no file.
  2. `--write` writes the directory, deletes the moved keys, writes `layout: 3`, and makes one commit.
  3. A run on a layout 3 clone refuses with "already" and changes nothing.
  4. A path that is a copy of the clone refuses.
  5. `--admin` naming a non-admin refuses.
  6. An existing duplicate in the directory refuses.

Steps:
- [ ] **Step 1: Write the script tests.** Run them and expect FAIL.
- [ ] **Step 2: Implement.** Run the new test, `scripts/__tests__/team-directory-move.test.ts`, `scripts/__tests__/move-team-packs.test.ts` and `lib/__tests__/no-settings-bypass.test.ts`. Expect PASS.
- [ ] **Step 3: Commit.** Message: `scripts: move-to-team-directory converts an org to layout 3`.

---

### Task 7: Every new setting is console-ready

**Files:**
- Create: `packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts`.

```ts
import { describe, expect, test } from "bun:test";
import { allDefs } from "../../index.ts";

type Schema = { title?: string; description?: string; properties?: Record<string, Schema>; items?: Schema | Schema[]; additionalProperties?: Schema | boolean; anyOf?: Schema[]; oneOf?: Schema[] };

function unannotated(schema: Schema, path: string, out: string[]): string[] {
  for (const [name, sub] of Object.entries(schema.properties ?? {})) {
    if (!sub.title && !sub.description) out.push(`${path}.${name}`);
    unannotated(sub, `${path}.${name}`, out);
  }
  for (const s of Array.isArray(schema.items) ? schema.items : schema.items ? [schema.items] : []) unannotated(s, `${path}[]`, out);
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") unannotated(schema.additionalProperties, `${path}{}`, out);
  for (const s of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) unannotated(s, path, out);
  return out;
}

/** Keys with no zod schema yet. Shrink only: a key that gains a schema leaves this list. */
const NO_SCHEMA_YET: readonly string[] = [/* filled in Step 1 */];
/** Keys with an object property that has no title or description yet. Shrink only. */
const UNANNOTATED_YET: readonly string[] = [/* filled in Step 1 */];

const ADD_A_KEY = "See the rt:settings skill, 'Adding a key', and docs/settings-architecture.md's checklist.";

describe("every setting is console-ready", () => {
  const defs = allDefs();
  test("every key has a zod schema", () => {
    const missing = defs.filter((d) => !d.schema).map((d) => d.key);
    expect({ newWithoutSchema: missing.filter((k) => !NO_SCHEMA_YET.includes(k)), note: ADD_A_KEY }).toEqual({ newWithoutSchema: [], note: ADD_A_KEY });
    expect(NO_SCHEMA_YET.filter((k) => !missing.includes(k))).toEqual([]);
  });
  test("every object property carries a title or description", () => {
    const gaps = new Map(defs.filter((d) => d.schema).map((d) => [d.key, unannotated(d.schema as Schema, d.key, [])] as const));
    const withGaps = [...gaps].filter(([, g]) => g.length > 0).map(([k]) => k);
    expect({ newGaps: [...gaps].filter(([k, g]) => g.length > 0 && !UNANNOTATED_YET.includes(k)).map(([, g]) => g).flat(), note: ADD_A_KEY }).toEqual({ newGaps: [], note: ADD_A_KEY });
    expect(UNANNOTATED_YET.filter((k) => !withGaps.includes(k))).toEqual([]);
  });
});
```

Steps:
- [ ] **Step 1: Fill the allowlists.** Run the test once with both lists empty. Copy the reported keys into `NO_SCHEMA_YET` (50 today) and `UNANNOTATED_YET` (43 today), sorted. Run again and expect PASS.
- [ ] **Step 2: Prove both directions.**
  - In a scratch edit, add a registry row with no schema. The test should FAIL naming it.
  - Remove a key from `NO_SCHEMA_YET` that has no schema. It should FAIL.
  - Give a listed key a schema while leaving it on the list. It should FAIL.

  Revert the scratch edits. Run the test, `registry.test.ts` and `schema-examples.test.ts`. Expect PASS.
- [ ] **Step 3: Commit.** Message: `settings: every new setting has a schema and annotated fields`.

---

### Task 8: Guidance

**Files:**
- Modify: `skills/rt-settings/SKILL.md`, through `superpowers:writing-skills`.
  1. **The decision rule.** At the top of "Changing the org repo's layout", add a short test:
     - A setup migration (`MigrationDef`) changes only this Mac: user and machine settings, local files, cron, app config.
     - Any change to the org or team stores, even adding a key, is a layout change: an `ORG_LAYOUT` bump plus a conversion script the admin runs, by the runbook below. A plain value an admin sets by hand is `rt settings set`.
     - Why: a migration runs unreviewed on the first admin Mac that launches, on whatever branch the clone has checked out, and sync carries the result to every member, older apps included. CI (`no-shared-store-migrations`) and the runtime both refuse it.
  2. **The runbook's step 1.** Name both conversion scripts: layout 2 `move-team-packs-to-plugin.ts`, layout 3 `move-to-team-directory.ts`.
  3. **The new-key rule.** In "The contract", item 2 (every key is declared), add one sentence: a new key also needs a zod schema in `registry-schemas.ts` with examples in `schema-examples.ts`, `.meta({ title, description })` on every object property, and a console group, all enforced by `registry-console-ready.test.ts`, `schema-examples.test.ts` and the console's `groups.test.ts`.
- **writing-skills evidence.** Run two baseline subagent prompts against the current skill, and record each choice:
  - (a) "Rename the team-scope key `board.foo` to `board.bar` for every team; older apps still read `board.foo`."
  - (b) "Add a new string setting `chat.theme` the console can edit."

  Then run the same prompts against the edited skill. Expect (a) to pick a layout script and (b) to name the schema, `.meta` and console group. Put both runs in the commit body, or in a scratchpad note linked from the PR.
- Modify: root `AGENTS.md` "Setup after an update". After "Add a one-time fix as a `MigrationDef` in `lib/setup/migrations/index.ts` with a dated id that is never renamed;", insert: "a migration changes only this Mac and never writes the org or team stores (a change there is a layout change, see the `rt:settings` skill);".
- Modify: `docs/settings-architecture.md`.
  - "Adding a key (the checklist)" (L147): add schema, examples, annotated properties and console group, with the tests that enforce each.
  - Its layout section: name layout 3 and its script.

Steps:
- [ ] **Step 1: Baseline runs.** Record what each prompt picks today.
- [ ] **Step 2: Edit the skill, `AGENTS.md` and the docs.** Rerun both prompts against the edited skill. If either picks wrong, revise the wording and rerun.
- [ ] **Step 3: Run the docs and guard tests.** Run `bun test lib/__tests__/` for the docs guards, such as `docs-moves`, and any test that reads `AGENTS.md`. Run `bun run docs:check`. Expect PASS.
- [ ] **Step 4: Commit.** Message: `docs, rt:settings: migration or layout script, and what a new key needs`.

---

### Task 9: Whole-branch verification and PR

- [ ] **Step 1:** Run `bun run typecheck`, `bun run console:test`, `bun test lib/setup lib/team lib/__tests__ scripts/__tests__ packages/rt-client/src/settings commands/__tests__/onboarding-org.test.ts commands/__tests__/member-upgrade.test.ts`, `packages/rt-client/test/dist-freshness.test.ts` and `bun run format:check`. Expect PASS.
- [ ] **Step 2:** Run `bun run purity`. Expect PASS.
- [ ] **Step 3:** Open the PR. The body says this replaces the merged, never-released team directory migration with a layout 3 script, and gives the rollout from the `rt:settings` runbook:
  1. Merge this.
  2. Pull the shared checkout and restart the daemon.
  3. Put the org clone on a branch and turn sync off.
  4. Run the script with `--write`, review it, publish, and turn sync back on.
  5. Use it on the branch.
  6. Merge the org branch.
  7. Release.
