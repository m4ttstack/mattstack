# Org and Teams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One org repo holds several team folders, every app reads the org layer plus the member's active team layer, and rt refuses writes outside what a member owns.

**Architecture:** The settings resolver in `packages/rt-client` gains an `org` scope under `team`, reads one org clone per Mac, and picks the team layer from the roster plus a stored forge username. Packs move into team folders, with an org base pack read straight from the org folder. A role check (org admin, team owner, member) replaces the joined-clone gate on every write path and in the sync engine. A one-off script converts the one existing team repo, and the Mac app's Team pane learns about roles and teams.

**Tech Stack:** Bun and TypeScript (rt, rt-client, settings-kit), jsonc-parser, zod (schema lock), React and Mantine (console, board, boxscore), Swift and SwiftUI (rt-tray), `bun:test`, vitest for the apps.

**Spec:** `docs/superpowers/specs/2026-10-01-org-and-teams-design.md` (at `bab9e93a6`). Read it before any task; section numbers below refer to it.

## Global Constraints

- Public repo: fixtures, tests, docs and PR bodies use placeholders only (`acme`, `widgets`, `gadgets`, `acme-base`, `gitlab.example.com`, `acme/widgets`, `dev1`, `dev2`). No real org, repo, user or ticket names.
- No em dashes or en dashes anywhere (code, comments, docs, commit messages). Use `...`, parentheses, or rephrase.
- Comments only for constraints the code cannot show. No narration, no decision history, no ticket or review references in source.
- Run `bun test` from the repo root (bun reads `bunfig.toml` only from the cwd). Tests never touch the real HOME and never start a daemon. A spawned child gets `childEnv()` from `lib/subprocess.ts`.
- A built binary runs only under an isolated HOME (`env -i HOME=<temp> ...`).
- Everything rt prints goes through `lib/ui/out.ts`. Failures throw `UserActionableError`; a refusal by policy is `out.note` with a `refused` line. Copy is plain: say what happened, speak to "you", put the command in `next`.
- `--json` envelopes are frozen. A task that changes one says so and updates its frozen snapshot on purpose.
- The TypeScript CLI holds no UI code. Console, board and boxscore UI follows `apps/AGENTS.md` (kit components first).
- A UI change is not done until it is rendered in Fast Browser in both color schemes and looked at. Use the `localhost` urls from `deck list`.
- After touching `packages/rt-client` source run `bun run build` in `packages/rt-client`; after `packages/settings-kit` source, the same there.
- A schema change regenerates the lock: `bun run cli.ts settings schema lock`, then `bun run cli.ts settings schema diff` must report nothing breaking.
- A new command module is registered in `lib/module-registry.ts` as a thunk. A new leaf with a required positional declares `omitBehavior`. After editing command descriptions run `bun run docs:gen`.
- Skill files (`skills/**`, `plugins/mattstack/**`) are edited only with `superpowers:writing-skills` and `mattstack:editing-skills` loaded, and a change under `plugins/mattstack` bumps `plugins/mattstack/.claude-plugin/plugin.json`.
- We share worktrees. Commit only the files a task names, by path. Never `git add -A`, never `git commit -a`. Push with the `git_push` tool.
- No `SCHEMA_VERSION` change: nothing here touches `state.db`.
- `lib/__tests__/no-settings-bypass.test.ts` pins, per file, how many times source reaches for a store path, a raw store reader or a per-rung reader. A task that adds, moves or removes such a use updates that file's allowlist entry (count and reason) in the same commit; the failure message names the file and the count it found.
- The in-memory `fakeProbes` (`lib/setup/__tests__/fakes.ts`) knows a directory only when it is seeded in `dirs`: `exists()` and `readDir()` do not infer folders from seeded files. A test whose code lists or probes a folder seeds it.
- Every `--json` envelope is flat (`envelope()` in `lib/setup/contract.ts` spreads the body beside `contract` and `at`): a test reads `JSON.parse(line).team`, never `.data.team`.
- One e2e file runs as `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/<file>` (the preload builds `dist/rt` when it is stale). `bun run test:e2e` runs the whole directory.
- Names (spec section 1): the clone folder under `~/.mattstack/teams/` is the **org slug**; a **team** is a folder under `mattstack/teams/` matching `^[a-z][a-z0-9-]*$`; a team's pack carries the team's name.

## Branch stack

Five stacked PRs. Each branches from the one before it and is green against its own base. Nothing merges to `main` until all five are reviewed and green; the "Landing" section at the end says how they land.

| PR | Branch | Base | Tasks |
|---|---|---|---|
| 1 | `org-teams-1-resolver` | `main` | 1 to 12 |
| 2 | `org-teams-2-packs` | `org-teams-1-resolver` | 13 to 19 |
| 3 | `org-teams-3-writes` | `org-teams-2-packs` | 20 to 34 |
| 4 | `org-teams-4-conversion` | `org-teams-3-writes` | 35 to 37 |
| 5 | `org-teams-5-app` | `org-teams-4-conversion` | 38 to 40 |

The old layout stops being read at Task 5, so `main` never holds a part of the stack: PR 1 merges last, as one commit, with the other four already folded into it. The conversion (Task 35's script) runs on the admin's Mac right after the release that follows.

Every PR ends with its own gate: `bun run test`, `bunx tsc --noEmit`, `bun run check`, plus `bun run test:all` for PRs 3 and 4 (they change verbs the e2e and pty suites drive) and `swift run mattstack-checks` for PR 5.

Three placements differ from the spec's build-order list, each because a PR has to be green on its own base. PR 1 also moves the zone reader in `lib/skills/init.ts` to team folders (Task 11: the claim cannot be read from settings otherwise) and has `rt team create` scaffold the new layout (Task 10: setup tests create an org and then read it). The stored-username writers (`rt team join`, `rt team create`, the `team.identity` step) land in PR 3 with the verbs they belong to; PR 1 ships the record field and its reader.

## Review Focus

Inputs the spec implies but does not spell out. Each has a test in the task named.

1. A roster entry whose `teams` holds something that is not a team name (`../x`, `Widgets`, `""`, a number): it is ignored and never becomes a path. Task 4.
2. The stored forge username and the roster differ only in case (`Dev1` and `dev1`): the same person. Tasks 4 and 20.
3. One layer of an `add` key holds a non-array (a string): that layer is skipped as invalid and the other layers still add up. Task 6.
4. The roster lists you on a team whose folder is not on disk yet (not pulled, or a typo by the admin): reads fall back to the org layer without throwing, and a write to that team refuses with the folder it looked for. Task 5.
5. The conversion script is run a second time on an already converted clone: it refuses and changes nothing. Task 35.

---
## PR 1: Names, layout and resolver

Branch `org-teams-1-resolver`, based on `main`. After this PR the resolver reads `mattstack/org/settings.org.jsonc` and the active team's `settings.team.jsonc`, and nothing reads the old `mattstack/settings.team.jsonc`.

### Task 1: Org and team folder paths

**Files:**
- Modify: `lib/rt-paths.ts` (after `teamsDir`, near line 221)
- Modify: `packages/rt-client/src/settings/paths.ts` (after `teamsDir`)
- Test: `lib/__tests__/settings-paths-parity.test.ts`, `packages/rt-client/src/settings/__tests__/paths.test.ts`

**Interfaces:**
- Produces (identical in both modules): `orgDir(org)`, `orgMarkerPath(org)`, `orgSettingsPath(org)`, `orgSecretsDir(org)`, `orgPacksDir(org)`, `teamFoldersDir(org)`, `teamFolderDir(org, team)`, `teamPackDir(org, team)`, all returning `string`. `teamSettingsPath` keeps its one-argument form until Task 5.

- [ ] **Step 1: Write the failing tests**

Append to `packages/rt-client/src/settings/__tests__/paths.test.ts`, inside its top-level `describe`, using the file's existing HOME setup (it sets `process.env.HOME` to a fake dir per test; reuse that variable name):

```ts
describe("org and team folder paths", () => {
  test("every org path hangs off teams/<org>", () => {
    process.env.HOME = "/tmp/fake-home-org";
    const root = "/tmp/fake-home-org/.mattstack/teams/acme";
    expect(orgDir("acme")).toBe(root);
    expect(orgMarkerPath("acme")).toBe(`${root}/mattstack/mattstack.jsonc`);
    expect(orgSettingsPath("acme")).toBe(`${root}/mattstack/org/settings.org.jsonc`);
    expect(orgSecretsDir("acme")).toBe(`${root}/mattstack/org/secrets`);
    expect(orgPacksDir("acme")).toBe(`${root}/mattstack/org/packs`);
    expect(teamFoldersDir("acme")).toBe(`${root}/mattstack/teams`);
    expect(teamFolderDir("acme", "widgets")).toBe(`${root}/mattstack/teams/widgets`);
    expect(teamPackDir("acme", "widgets")).toBe(`${root}/mattstack/teams/widgets/packs/widgets`);
  });
});
```

Add the eight names to that file's import from `../paths.ts`.

Append to `lib/__tests__/settings-paths-parity.test.ts`, inside its `describe`:

```ts
test("org and team folder paths agree under a faked HOME", () => {
  process.env.HOME = "/tmp/parity-fake-home";
  expect(clientPaths.orgDir("acme")).toBe(rtPaths.orgDir("acme"));
  expect(clientPaths.orgMarkerPath("acme")).toBe(rtPaths.orgMarkerPath("acme"));
  expect(clientPaths.orgSettingsPath("acme")).toBe(rtPaths.orgSettingsPath("acme"));
  expect(clientPaths.orgSecretsDir("acme")).toBe(rtPaths.orgSecretsDir("acme"));
  expect(clientPaths.orgPacksDir("acme")).toBe(rtPaths.orgPacksDir("acme"));
  expect(clientPaths.teamFoldersDir("acme")).toBe(rtPaths.teamFoldersDir("acme"));
  expect(clientPaths.teamFolderDir("acme", "widgets")).toBe(rtPaths.teamFolderDir("acme", "widgets"));
  expect(clientPaths.teamPackDir("acme", "widgets")).toBe(rtPaths.teamPackDir("acme", "widgets"));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/paths.test.ts lib/__tests__/settings-paths-parity.test.ts`
Expected: FAIL, `orgDir is not a function` (or an import error naming it).

- [ ] **Step 3: Add the functions to both modules**

Add this block to `lib/rt-paths.ts` directly after `teamsDir()`, and the same block to `packages/rt-client/src/settings/paths.ts` directly after its `teamsDir()`:

```ts
/** ~/.mattstack/teams/<org>: the org clone. The parent folder keeps its `teams` name. */
export function orgDir(org: string): string {
  return join(teamsDir(), org);
}

export function orgMarkerPath(org: string): string {
  return join(orgDir(org), "mattstack", "mattstack.jsonc");
}

export function orgSettingsPath(org: string): string {
  return join(orgDir(org), "mattstack", "org", "settings.org.jsonc");
}

export function orgSecretsDir(org: string): string {
  return join(orgDir(org), "mattstack", "org", "secrets");
}

export function orgPacksDir(org: string): string {
  return join(orgDir(org), "mattstack", "org", "packs");
}

export function teamFoldersDir(org: string): string {
  return join(orgDir(org), "mattstack", "teams");
}

export function teamFolderDir(org: string, team: string): string {
  return join(teamFoldersDir(org), team);
}

/** A team's pack carries the team's name. */
export function teamPackDir(org: string, team: string): string {
  return join(teamFolderDir(org, team), "packs", team);
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test packages/rt-client/src/settings/__tests__/paths.test.ts lib/__tests__/settings-paths-parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rt-paths.ts packages/rt-client/src/settings/paths.ts lib/__tests__/settings-paths-parity.test.ts packages/rt-client/src/settings/__tests__/paths.test.ts
git commit -m "paths: org and team folder paths in rt-paths and rt-client"
```

### Task 2: Shared-store test fixture (mechanical, no behavior change)

About sixty test files put a value in the shared layer by writing to `teamSettingsPath("<slug>")`. This task moves them all to one helper, still pointing at the old file, so Task 5 flips one function instead of sixty files.

**Files:**
- Create: `packages/rt-client/test/org-fixture.ts`
- Modify: every test file that calls `teamSettingsPath`, except the four that test the path or the listing itself: `packages/rt-client/src/settings/__tests__/paths.test.ts`, `packages/rt-client/src/settings/__tests__/stores.test.ts`, `lib/__tests__/rt-paths.test.ts`, `lib/__tests__/settings-paths-parity.test.ts`. Also leave `lib/__tests__/no-settings-bypass.test.ts` alone (it reads source text).

**Interfaces:**
- Produces: `sharedStorePath(org: string): string` and `writeSharedStore(org: string, value: unknown): string` from `packages/rt-client/test/org-fixture.ts`.

- [ ] **Step 1: Create the fixture**

```ts
// packages/rt-client/test/org-fixture.ts
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { teamSettingsPath } from "../src/settings/paths.ts";

function writeJson(file: string, value: unknown): string {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return file;
}

/** The store a test seeds to put a value in the layer every member shares. HOME is read at call time. */
export function sharedStorePath(org: string): string {
  return teamSettingsPath(org);
}

export function writeSharedStore(org: string, value: unknown): string {
  return writeJson(sharedStorePath(org), value);
}
```

- [ ] **Step 2: Rewrite the call sites with a scratch codemod**

Save this in your scratchpad (never commit it) as `codemod-shared-store.ts`:

```ts
import { readFileSync, writeFileSync } from "fs";
import { dirname, relative } from "path";

const FIXTURE = "packages/rt-client/test/org-fixture.ts";

for (const file of process.argv.slice(2)) {
  let src = readFileSync(file, "utf8");
  if (!src.includes("teamSettingsPath")) continue;
  src = src.replace(/\bteamSettingsPath\(/g, "sharedStorePath(");
  src = src.replace(/^import \{ teamSettingsPath \} from "[^"]+";\n/m, "");
  src = src.replace(/^[ \t]*teamSettingsPath,\n/m, "");
  src = src.replace(/\bteamSettingsPath,\s*/, "");
  src = src.replace(/,\s*teamSettingsPath\b/, "");
  let rel = relative(dirname(file), FIXTURE);
  if (!rel.startsWith(".")) rel = `./${rel}`;
  const imports = [...src.matchAll(/^import [^;]+;\n/gm)];
  const last = imports[imports.length - 1];
  const at = last ? last.index! + last[0].length : 0;
  src = `${src.slice(0, at)}import { sharedStorePath } from "${rel}";\n${src.slice(at)}`;
  writeFileSync(file, src);
  console.log(file);
}
```

Run it over the test files:

```bash
rg -l "teamSettingsPath" lib commands packages/rt-client e2e --glob '**/__tests__/**' --glob '**/*.test.ts' --glob 'e2e/**' \
  | grep -v -e 'settings/__tests__/paths.test.ts' -e 'settings/__tests__/stores.test.ts' -e '__tests__/rt-paths.test.ts' -e 'settings-paths-parity.test.ts' -e 'no-settings-bypass.test.ts' \
  | xargs bun run <scratchpad>/codemod-shared-store.ts
```

- [ ] **Step 3: Let the type checker find what the codemod missed**

Run: `bunx tsc --noEmit`
Expected: clean. If it reports an unused or missing `teamSettingsPath` or `sharedStorePath` import, fix that file by hand (a multi-line import the regexes did not match).

- [ ] **Step 4: Run the full unit suite**

Run: `bun run test`
Expected: the same pass and fail counts as `main` (this commit changes no behavior). If a failure is new, the codemod changed something other than the helper name; revert that file and redo it by hand.

- [ ] **Step 5: Commit, by path**

```bash
git add packages/rt-client/test/org-fixture.ts $(git diff --name-only)
git commit -m "tests: seed the shared settings layer through one fixture helper"
```

`git diff --name-only` here lists only the files the codemod touched; check the list with `git status --short` first, and if anything outside test files appears, stop and leave it out.

### Task 3: Registry: the org scope, the add mode, the new keys

**Files:**
- Modify: `packages/rt-client/src/settings/registry-machinery.ts` (`SettingScope`, `SettingDef.merge`)
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (`ALL_SCOPES`, the export, three defs)
- Modify: `packages/rt-client/src/settings/registry-schemas.ts` (`mattstack.roster`, `mattstack.org`)
- Modify: `packages/rt-client/src/settings/schema.lock.json` (regenerated)
- Modify: `packages/rt-client/src/settings/sample-values.ts` (a sample for `mattstack.org` if `sample-values.test.ts` asks for one)
- Test: `packages/rt-client/src/settings/__tests__/registry.test.ts`

**Interfaces:**
- Produces: `SettingScope = "user" | "team" | "org" | "machine"`; `SettingDef.merge: "replace" | "deep" | "add"`; registry keys `mattstack.org` (org only), `mattstack.activeTeam` (user only); `mattstack.roster` becomes org only and its entries gain `teams?: string[]`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/rt-client/src/settings/__tests__/registry.test.ts`:

```ts
describe("org scope", () => {
  test("every key a team may set, the org may set too", () => {
    for (const def of allDefs()) {
      if (def.scopes.includes("team")) expect(def.scopes).toContain("org");
    }
  });

  test("a key's first scope is unchanged, so the apps keep grouping it where they did", () => {
    expect(getDef("board.title")?.scopes).toEqual(["team", "org"]);
    expect(getDef("rt.roles")?.scopes).toEqual(["user", "team", "org", "machine"]);
    expect(getDef("claude.plugins")?.scopes).toEqual(["user", "team", "org"]);
  });

  test("the roster and the roles are org only", () => {
    expect(getDef("mattstack.roster")?.scopes).toEqual(["org"]);
    expect(getDef("mattstack.org")?.scopes).toEqual(["org"]);
  });

  test("the active team is a user setting", () => {
    expect(getDef("mattstack.activeTeam")?.scopes).toEqual(["user"]);
    expect(getDef("mattstack.activeTeam")?.type).toBe("string");
  });

  test("a roster entry may carry teams", () => {
    const def = getDef("mattstack.roster")!;
    expect(checkSchema(def, [{ username: "dev1", teams: ["widgets"] }], { layer: false })).toEqual([]);
    expect(checkSchema(def, [{ username: "dev1", teams: "widgets" }], { layer: false }).length).toBeGreaterThan(0);
  });

  test("roles need admins and teams with owners", () => {
    const def = getDef("mattstack.org")!;
    expect(checkSchema(def, { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } }, { layer: false })).toEqual([]);
    expect(checkSchema(def, { admins: "dev1", teams: {} }, { layer: false }).length).toBeGreaterThan(0);
  });
});
```

Add `checkSchema` (from `../schema.ts`) and `allDefs`, `getDef` (from `../registry-machinery.ts`) to the imports if the file lacks them.

Four older tests in this file call `def.scopes.sort()` in place (near lines 157, 173, 278 and 452), which reorders the live def and would break the first-scope test above depending on run order. Change each to `[...def.scopes].sort()` and update what they expect now that `org` is derived: `["org", "team", "user"]` for `board.reReview` and the two `claude.*` keys, `["machine", "org", "team", "user"]` for the repo-scoped keys and `rt.hooks`, and the scope spot-check's `board.gitlabHost` becomes `["team", "org"]`. The file also pins the full key list in registry order (near line 300): add `"mattstack.org"` and `"mattstack.activeTeam"` to that list directly after `"mattstack.roster"`.

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/registry.test.ts`
Expected: FAIL on the org scope tests.

- [ ] **Step 3: Widen the types**

In `registry-machinery.ts`:

```ts
export type SettingScope = "user" | "team" | "org" | "machine";
```

and in `SettingDef`:

```ts
  merge: "replace" | "deep" | "add";
```

- [ ] **Step 4: Derive the org scope and add the keys**

In `registry-defs.ts`, rename the exported array to a private one and export the derived table:

```ts
const ALL_SCOPES: SettingScope[] = ["user", "team", "machine"];

const ROWS: readonly SettingDef[] = [
  // ... every existing row, unchanged ...
];

/** `org` goes after `team` so a key's first scope, which the apps group their settings pages by, does not change. */
function withOrgScope(def: SettingDef): SettingDef {
  if (!def.scopes.includes("team") || def.scopes.includes("org")) return def;
  const at = def.scopes.indexOf("team") + 1;
  return { ...def, scopes: [...def.scopes.slice(0, at), "org", ...def.scopes.slice(at)] };
}

export const REGISTRY: readonly SettingDef[] = ROWS.map(withOrgScope);
```

Change the `mattstack.roster` row and add two rows after it:

```ts
  {
    key: "mattstack.roster",
    type: "array",
    scopes: ["org"],
    merge: "replace",
    description:
      "Everyone in the org: [{username, name?, agePublicKey?, teams?}], by forge username. teams lists the team folders a member belongs to. Any app that lists people reads this; hiding someone is the app's own overlay (e.g. boxscore.hiddenMembers).",
  },
  {
    key: "mattstack.org",
    type: "object",
    scopes: ["org"],
    merge: "replace",
    description: "Who may change shared settings: the org's admins, and each team's owners, by forge username.",
  },
  {
    key: "mattstack.activeTeam",
    type: "string",
    scopes: ["user"],
    merge: "replace",
    description: "The team you use the apps as, when the roster lists you on more than one.",
  },
```

- [ ] **Step 5: Add the schemas**

In `registry-schemas.ts`, replace the `mattstack.roster` line and add `mattstack.org` after it:

```ts
  "mattstack.roster": z.array(
    z.looseObject({ username: z.string(), name: z.string().optional(), agePublicKey: z.string().optional(), teams: z.array(z.string()).optional() }),
  ),
  "mattstack.org": z.looseObject({
    admins: z.array(z.string()),
    teams: z.record(z.string(), z.looseObject({ owners: z.array(z.string()) })),
  }),
```

- [ ] **Step 6: Regenerate the lock and check it**

```bash
bun run cli.ts settings schema lock
bun run cli.ts settings schema diff
```

Expected: `diff` reports one added key (`mattstack.org`) and one widened key (`mattstack.roster`, a new optional property), nothing breaking. If it calls the roster change breaking, stop: the new property must be `.optional()`.

- [ ] **Step 7: Run the settings tests**

Run: `bun test packages/rt-client/src/settings`
Expected: PASS, apart from tests whose expected "allowed:" lists now include `org`. Update those expectations (the order is `user, team, org, machine` for an all-scopes key and `team, org` for a team key).

If `sample-values.test.ts` fails for `mattstack.org`, add to `sample-values.ts`'s table:

```ts
  "mattstack.org": { admins: ["dev1"], teams: { widgets: { owners: ["dev1"] } } },
```

- [ ] **Step 8: Typecheck and commit**

Run: `bunx tsc --noEmit`
Expected: errors only where a `switch` or a `Record<SettingScope, ...>` is now missing `org`. Fix each by adding the `org` case beside `team` with the same handling (Task 7 gives the CLI its own wording). Known sites: `commands/settings-keys.ts` (the scope copy table near line 172) and `packages/rt-client/src/settings/migrate-stores.ts`.

```bash
git add packages/rt-client/src/settings/registry-machinery.ts packages/rt-client/src/settings/registry-defs.ts packages/rt-client/src/settings/registry-schemas.ts packages/rt-client/src/settings/schema.lock.json packages/rt-client/src/settings/sample-values.ts packages/rt-client/src/settings/__tests__ commands/settings-keys.ts
git commit -m "settings registry: org scope, add merge mode, mattstack.org and mattstack.activeTeam"
```

### Task 4: Who you are, and the active team

**Files:**
- Modify: `lib/team/team-local.ts` (`TeamLocalRecord`, `readTeamLocal`)
- Modify: `packages/rt-client/src/settings/team-local-read.ts`
- Modify: `packages/rt-client/src/settings/stores.ts`
- Create: `packages/rt-client/src/settings/active-team.ts`
- Modify: `packages/rt-client/src/index.ts` (exports)
- Test: `packages/rt-client/src/settings/__tests__/active-team.test.ts` (new), `packages/rt-client/src/settings/__tests__/stores.test.ts`, `lib/team/__tests__/team-local.test.ts`

**Interfaces:**
- Consumes: Task 1 paths, Task 3 registry keys.
- Produces, from `stores.ts`: `TEAM_NAME_RE: RegExp`, `listOrgs(): string[]`, `currentOrg(): string | null`, `listTeamFolders(org: string): string[]`, `sharedStoreFiles(): string[]`, `parseStoreText(file: string, raw: string): StoreFile` (`readStore`'s parse step, for a caller that already holds the text).
- Produces, from `team-local-read.ts`: `readForgeUsername(org: string): string | null`.
- Produces, from `active-team.ts`:

```ts
export interface RosterEntry { username: string; name?: string; agePublicKey?: string; teams?: string[]; [key: string]: unknown }
export interface OrgRoles { admins: string[]; teams: Record<string, { owners: string[] }> }
export type ActiveTeamReason = "no-org" | "chosen" | "first-team" | "no-team" | "setting-only" | "identity";
export interface ActiveTeam { org: string | null; team: string | null; reason: ActiveTeamReason; username: string | null; listedOn: string[] }
export function sameUser(a: string, b: string): boolean;
export function decideActiveTeam(input: { username: string | null; roster: RosterEntry[]; setting: string | undefined; teamFolders: () => string[] }): Pick<ActiveTeam, "team" | "reason" | "listedOn">;
export function rosterFrom(orgStore: StoreFile): RosterEntry[];
export function rolesFrom(orgStore: StoreFile): OrgRoles;
export function activeTeamFrom(org: string, orgStore: StoreFile, userStore: StoreFile): ActiveTeam;
export function activeTeam(): ActiveTeam;
export function readOrgRoster(org: string): RosterEntry[];
export function readOrgRoles(org: string): OrgRoles;
export function activeTeamRoster(): RosterEntry[];
```

- Produces, in `lib/team/team-local.ts`: `TeamLocalRecord.forgeUsername?: string`.

- [ ] **Step 1: Write the failing tests for the pure decision**

```ts
// packages/rt-client/src/settings/__tests__/active-team.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { activeTeam, activeTeamRoster, decideActiveTeam, readOrgRoles, sameUser, type RosterEntry } from "../active-team.ts";
import { orgSettingsPath, teamFolderDir, teamLocalPath, userSettingsPath } from "../paths.ts";

const ROSTER: RosterEntry[] = [
  { username: "dev1", teams: ["widgets"] },
  { username: "dev2", teams: ["widgets", "gadgets"] },
  { username: "dev3" },
];
const folders = () => ["gadgets", "widgets"];

describe("decideActiveTeam", () => {
  test("no team lists you: none", () => {
    expect(decideActiveTeam({ username: "dev3", roster: ROSTER, setting: "widgets", teamFolders: folders })).toEqual({ team: null, reason: "no-team", listedOn: [] });
    expect(decideActiveTeam({ username: "stranger", roster: ROSTER, setting: undefined, teamFolders: folders }).reason).toBe("no-team");
  });

  test("the setting names a team you are on: that team", () => {
    expect(decideActiveTeam({ username: "dev2", roster: ROSTER, setting: "gadgets", teamFolders: folders })).toEqual({ team: "gadgets", reason: "chosen", listedOn: ["widgets", "gadgets"] });
    expect(decideActiveTeam({ username: "dev1", roster: ROSTER, setting: "widgets", teamFolders: folders }).reason).toBe("chosen");
  });

  test("the setting is unset or names a team you are not on: the first team in your roster entry", () => {
    expect(decideActiveTeam({ username: "dev2", roster: ROSTER, setting: undefined, teamFolders: folders })).toEqual({ team: "widgets", reason: "first-team", listedOn: ["widgets", "gadgets"] });
    expect(decideActiveTeam({ username: "dev2", roster: ROSTER, setting: "sprockets", teamFolders: folders }).team).toBe("widgets");
    expect(decideActiveTeam({ username: "dev1", roster: ROSTER, setting: "gadgets", teamFolders: folders })).toEqual({ team: "widgets", reason: "first-team", listedOn: ["widgets"] });
  });

  test("a member added to a second team keeps their first team", () => {
    const before = [{ username: "dev1", teams: ["widgets"] }];
    const after = [{ username: "dev1", teams: ["widgets", "gadgets"] }];
    expect(decideActiveTeam({ username: "dev1", roster: before, setting: undefined, teamFolders: folders }).team).toBe("widgets");
    expect(decideActiveTeam({ username: "dev1", roster: after, setting: undefined, teamFolders: folders }).team).toBe("widgets");
  });

  test("no stored username and the setting names a team folder: that team", () => {
    expect(decideActiveTeam({ username: null, roster: ROSTER, setting: "widgets", teamFolders: folders })).toEqual({ team: "widgets", reason: "setting-only", listedOn: [] });
  });

  test("no stored username and no usable setting: none, identity", () => {
    expect(decideActiveTeam({ username: null, roster: ROSTER, setting: undefined, teamFolders: folders })).toEqual({ team: null, reason: "identity", listedOn: [] });
    expect(decideActiveTeam({ username: null, roster: ROSTER, setting: "sprockets", teamFolders: folders }).reason).toBe("identity");
  });

  test("usernames compare without case", () => {
    expect(sameUser("Dev1", "dev1")).toBe(true);
    expect(decideActiveTeam({ username: "DEV1", roster: ROSTER, setting: undefined, teamFolders: folders }).team).toBe("widgets");
  });

  test("a teams entry that is not a team name is ignored and never becomes a path", () => {
    const roster = [{ username: "dev1", teams: ["../x", "Widgets", "", 7 as unknown as string, "widgets"] }];
    expect(decideActiveTeam({ username: "dev1", roster, setting: undefined, teamFolders: folders })).toEqual({ team: "widgets", reason: "first-team", listedOn: ["widgets"] });
  });
});

describe("activeTeam on disk", () => {
  const origHome = process.env.HOME;
  let home: string;

  function write(file: string, value: unknown): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  }

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-active-team-")));
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("no org clone: no-org", () => {
    expect(activeTeam()).toEqual({ org: null, team: null, reason: "no-org", username: null, listedOn: [] });
  });

  test("reads the roster, the stored username and the user setting", () => {
    write(orgSettingsPath("acme"), { "mattstack.roster": ROSTER, "mattstack.org": { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } } });
    write(teamLocalPath("acme"), { forgeUsername: "dev2" });
    write(userSettingsPath(), { "mattstack.activeTeam": "gadgets" });
    expect(activeTeam()).toEqual({ org: "acme", team: "gadgets", reason: "chosen", username: "dev2", listedOn: ["widgets", "gadgets"] });
    expect(activeTeamRoster().map((e) => e.username)).toEqual(["dev2"]);
    expect(readOrgRoles("acme")).toEqual({ admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } });
  });

  test("with no active team the roster is everyone", () => {
    write(orgSettingsPath("acme"), { "mattstack.roster": ROSTER });
    write(teamLocalPath("acme"), { forgeUsername: "dev3" });
    expect(activeTeamRoster().map((e) => e.username)).toEqual(["dev1", "dev2", "dev3"]);
  });

  test("a setting-only team must be a folder on disk", () => {
    write(orgSettingsPath("acme"), { "mattstack.roster": ROSTER });
    write(userSettingsPath(), { "mattstack.activeTeam": "widgets" });
    expect(activeTeam().reason).toBe("identity");
    mkdirSync(teamFolderDir("acme", "widgets"), { recursive: true });
    expect(activeTeam()).toMatchObject({ team: "widgets", reason: "setting-only" });
  });

  test("malformed roles read as nobody", () => {
    write(orgSettingsPath("acme"), { "mattstack.org": { admins: "dev1", teams: [] } });
    expect(readOrgRoles("acme")).toEqual({ admins: [], teams: {} });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `bun test packages/rt-client/src/settings/__tests__/active-team.test.ts`
Expected: FAIL, cannot find `../active-team.ts`.

- [ ] **Step 3: Add the org listing to `stores.ts`**

In `packages/rt-client/src/settings/stores.ts`, change the import and add below `listTeams` (which stays until Task 5):

```ts
import { orgSettingsPath, teamFolderDir, teamFoldersDir, teamsDir, teamSettingsPath } from "./paths.ts";
```

```ts
export const TEAM_NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Org clones on this Mac: folders under teamsDir() that hold
 * mattstack/org/settings.org.jsonc. The scan degrades the way listTeams does:
 * one unreadable entry never empties the list.
 */
export function listOrgs(): string[] {
  const dir = teamsDir();
  if (!existsSync(dir)) return [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`rt: failed to list orgs in ${dir}, treating as none: ${(err as Error).message}`);
    return [];
  }
  const orgs: string[] = [];
  for (const entry of entries) {
    try {
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && statSync(join(dir, entry.name)).isDirectory());
      if (isDir && existsSync(orgSettingsPath(entry.name))) orgs.push(entry.name);
    } catch (err) {
      console.warn(`rt: skipping unreadable entry ${join(dir, entry.name)}: ${(err as Error).message}`);
    }
  }
  return orgs;
}

/** One org per Mac; with several clones the first by name is the one read. */
export function currentOrg(): string | null {
  return [...listOrgs()].sort()[0] ?? null;
}

export function listTeamFolders(org: string): string[] {
  try {
    return readdirSync(teamFoldersDir(org), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && TEAM_NAME_RE.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** The org store and every team folder's store that exists, for the one org on this Mac. */
export function sharedStoreFiles(): string[] {
  const org = currentOrg();
  if (org === null) return [];
  const teamFile = (team: string) => join(teamFolderDir(org, team), "settings.team.jsonc");
  return [orgSettingsPath(org), ...listTeamFolders(org).map(teamFile).filter((file) => existsSync(file))];
}
```

Also split the parse out of `readStore`, so code that reads through `Probes` (Tasks 17 and 20) gets the same `StoreFile` from text it already holds:

```ts
/** `readStore`'s parse step, for a caller that already holds the file's text. Never throws. */
export function parseStoreText(file: string, raw: string): StoreFile {
  if (raw.trim() === "") return EMPTY_STORE(file, true);
  const errors: ParseError[] = [];
  const root = parse(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0 || root === undefined || typeof root !== "object" || Array.isArray(root)) {
    console.warn(`rt: malformed settings store ${file}, ignoring (treating as empty)`);
    return EMPTY_STORE(file, true);
  }
  const { repos, ...global } = root as Record<string, unknown>;
  const reposIsValid = repos !== undefined && typeof repos === "object" && repos !== null && !Array.isArray(repos);
  if (repos !== undefined && !reposIsValid) {
    console.warn(`rt: malformed "repos" section in settings store ${file}, ignoring repo sections (global keys still apply)`);
  }
  return { global, repos: reposIsValid ? (repos as Record<string, Record<string, unknown>>) : {}, file, exists: true };
}
```

and `readStore` ends with `return parseStoreText(file, raw);` in place of the lines it now duplicates.

Add to `stores.test.ts`, in its `describe` (it already repoints HOME per test):

```ts
describe("org listing", () => {
  test("an org is a clone with mattstack/org/settings.org.jsonc", () => {
    const org = join(teamsDir(), "acme", "mattstack", "org");
    mkdirSync(org, { recursive: true });
    writeFileSync(join(org, "settings.org.jsonc"), "{}");
    mkdirSync(join(teamsDir(), "old-layout", "mattstack"), { recursive: true });
    writeFileSync(join(teamsDir(), "old-layout", "mattstack", "settings.team.jsonc"), "{}");
    expect(listOrgs()).toEqual(["acme"]);
    expect(currentOrg()).toBe("acme");
  });

  test("parseStoreText gives the same store readStore does", () => {
    const text = `// header\n{ "board.title": "Acme", "repos": { "gitlab.example.com/acme/widgets": { "rt.roles": {} } } }`;
    expect(parseStoreText("/x/settings.org.jsonc", text)).toEqual({ global: { "board.title": "Acme" }, repos: { "gitlab.example.com/acme/widgets": { "rt.roles": {} } }, file: "/x/settings.org.jsonc", exists: true });
    expect(parseStoreText("/x/s.jsonc", "{ not json").global).toEqual({});
  });

  test("team folders are plain lowercase names, sorted", () => {
    const teams = join(teamsDir(), "acme", "mattstack", "teams");
    for (const name of ["widgets", "gadgets", "Widgets2", ".git"]) mkdirSync(join(teams, name), { recursive: true });
    writeFileSync(join(teams, "notes.md"), "");
    expect(listTeamFolders("acme")).toEqual(["gadgets", "widgets"]);
    expect(listTeamFolders("nope")).toEqual([]);
  });
});
```

- [ ] **Step 4: Store and read the forge username**

In `lib/team/team-local.ts`, add the field to `TeamLocalRecord` after `agePublicKey`:

```ts
  /**
   * This member's username on the org's forge, recorded at join, at create
   * and by setup. The resolver reads it to pick the active team and the write
   * guard reads it for the member's role, so it has to be on disk: neither
   * may spawn a forge CLI.
   */
  forgeUsername?: string;
```

and in `readTeamLocal`'s returned object, after the `agePublicKey` spread:

```ts
      ...(typeof parsed.forgeUsername === "string" && parsed.forgeUsername.trim() !== "" ? { forgeUsername: parsed.forgeUsername.trim() } : {}),
```

Add to `lib/team/__tests__/team-local.test.ts`, inside its `describe` (the file already imports `fakeProbes` and defines `HOME` and `SLUG`):

```ts
  test("forgeUsername round-trips and a blank one reads as absent", () => {
    const p = fakeProbes({ home: HOME });
    writeTeamLocal(p, SLUG, { createdByRt: false, joinedByRt: true, rtMayManageMembership: false, forgeUsername: "dev1" });
    expect(readTeamLocal(p, SLUG).forgeUsername).toBe("dev1");
    updateTeamLocal(p, SLUG, { forgeUsername: "  " });
    expect(readTeamLocal(p, SLUG).forgeUsername).toBeUndefined();
  });
```

In `packages/rt-client/src/settings/team-local-read.ts` add:

```ts
/** Null when the record is absent, unreadable, or carries no username. */
export function readForgeUsername(org: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(teamLocalPath(org), "utf8"));
    const name = typeof parsed === "object" && parsed !== null ? (parsed as { forgeUsername?: unknown }).forgeUsername : undefined;
    return typeof name === "string" && name.trim() !== "" ? name.trim() : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Write `active-team.ts`**

```ts
// packages/rt-client/src/settings/active-team.ts
/**
 * Which team this Mac reads settings as. Everything here reads store files
 * directly and never calls getSetting: the resolver calls this to find the
 * team layer, so going through the resolver would recurse.
 */

import { readSection } from "./migrate.ts";
import { orgSettingsPath, userSettingsPath } from "./paths.ts";
import { getDef } from "./registry-machinery.ts";
import { currentOrg, listTeamFolders, readStore, TEAM_NAME_RE, type StoreFile } from "./stores.ts";
import { readForgeUsername } from "./team-local-read.ts";

export interface RosterEntry {
  username: string;
  name?: string;
  agePublicKey?: string;
  teams?: string[];
  [key: string]: unknown;
}

export interface OrgRoles {
  admins: string[];
  teams: Record<string, { owners: string[] }>;
}

export type ActiveTeamReason = "no-org" | "chosen" | "first-team" | "no-team" | "setting-only" | "identity";

export interface ActiveTeam {
  org: string | null;
  team: string | null;
  reason: ActiveTeamReason;
  username: string | null;
  /** The team folders the roster lists this member on. */
  listedOn: string[];
}

/** Forge usernames are case-insensitive on GitHub and GitLab. */
export function sameUser(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function stored<T>(key: string, section: Record<string, unknown>): T | undefined {
  const def = getDef(key);
  if (!def) return undefined;
  const read = readSection(def, section, { layer: true });
  return read.present ? (read.value as T) : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : [];
}

export function rosterFrom(orgStore: StoreFile): RosterEntry[] {
  const raw = stored<unknown>("mattstack.roster", orgStore.global);
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is RosterEntry => e !== null && typeof e === "object" && typeof (e as { username?: unknown }).username === "string");
}

export function rolesFrom(orgStore: StoreFile): OrgRoles {
  const raw = stored<{ admins?: unknown; teams?: unknown }>("mattstack.org", orgStore.global);
  const teams: OrgRoles["teams"] = {};
  if (raw?.teams !== null && typeof raw?.teams === "object" && !Array.isArray(raw.teams)) {
    for (const [name, value] of Object.entries(raw.teams as Record<string, { owners?: unknown } | null>)) {
      if (TEAM_NAME_RE.test(name)) teams[name] = { owners: strings(value?.owners) };
    }
  }
  return { admins: strings(raw?.admins), teams };
}

export function decideActiveTeam(input: {
  username: string | null;
  roster: RosterEntry[];
  setting: string | undefined;
  teamFolders: () => string[];
}): Pick<ActiveTeam, "team" | "reason" | "listedOn"> {
  const { username, roster, setting } = input;
  if (username === null) {
    if (setting !== undefined && TEAM_NAME_RE.test(setting) && input.teamFolders().includes(setting)) {
      return { team: setting, reason: "setting-only", listedOn: [] };
    }
    return { team: null, reason: "identity", listedOn: [] };
  }
  const entry = roster.find((e) => sameUser(e.username, username));
  // The roster is written by other people; a name that is not a plain folder name must never reach a path.
  const listedOn = [...new Set(strings(entry?.teams).filter((team) => TEAM_NAME_RE.test(team)))];
  if (listedOn.length === 0) return { team: null, reason: "no-team", listedOn };
  if (setting !== undefined && listedOn.includes(setting)) return { team: setting, reason: "chosen", listedOn };
  return { team: listedOn[0]!, reason: "first-team", listedOn };
}

export function activeTeamFrom(org: string, orgStore: StoreFile, userStore: StoreFile): ActiveTeam {
  const username = readForgeUsername(org);
  const setting = stored<unknown>("mattstack.activeTeam", userStore.global);
  const decision = decideActiveTeam({
    username,
    roster: rosterFrom(orgStore),
    setting: typeof setting === "string" ? setting : undefined,
    teamFolders: () => listTeamFolders(org),
  });
  return { org, username, ...decision };
}

export function activeTeam(): ActiveTeam {
  const org = currentOrg();
  if (org === null) return { org: null, team: null, reason: "no-org", username: null, listedOn: [] };
  return activeTeamFrom(org, readStore(orgSettingsPath(org)), readStore(userSettingsPath()));
}

export function readOrgRoster(org: string): RosterEntry[] {
  return rosterFrom(readStore(orgSettingsPath(org)));
}

export function readOrgRoles(org: string): OrgRoles {
  return rolesFrom(readStore(orgSettingsPath(org)));
}

/** The roster entries on the active team; everyone when this Mac has no active team. */
export function activeTeamRoster(): RosterEntry[] {
  const org = currentOrg();
  if (org === null) return [];
  const orgStore = readStore(orgSettingsPath(org));
  const { team } = activeTeamFrom(org, orgStore, readStore(userSettingsPath()));
  const roster = rosterFrom(orgStore);
  return team === null ? roster : roster.filter((e) => strings(e.teams).includes(team));
}
```

- [ ] **Step 6: Export from the package**

In `packages/rt-client/src/index.ts`, beside the other settings exports:

```ts
export { activeTeam, activeTeamRoster, decideActiveTeam, readOrgRoles, readOrgRoster, sameUser } from "./settings/active-team.ts";
export type { ActiveTeam, ActiveTeamReason, OrgRoles, RosterEntry } from "./settings/active-team.ts";
export { readForgeUsername } from "./settings/team-local-read.ts";
```

and extend the stores export line:

```ts
export { readStore, parseStoreText, listTeams, listOrgs, currentOrg, listTeamFolders, sharedStoreFiles, TEAM_NAME_RE } from "./settings/stores.ts";
```

Add to `packages/rt-client/test/index-surface.test.ts`, inside its `describe`:

```ts
  test("exports the org and active-team API", () => {
    expect(typeof rtClient.activeTeam).toBe("function");
    expect(typeof rtClient.activeTeamRoster).toBe("function");
    expect(typeof rtClient.readOrgRoles).toBe("function");
    expect(typeof rtClient.readOrgRoster).toBe("function");
    expect(typeof rtClient.readForgeUsername).toBe("function");
    expect(typeof rtClient.listOrgs).toBe("function");
    expect(typeof rtClient.currentOrg).toBe("function");
    expect(rtClient.TEAM_NAME_RE.test("widgets")).toBe(true);
  });
```

- [ ] **Step 7: Run the tests**

Run: `bun test packages/rt-client/src/settings/__tests__/active-team.test.ts packages/rt-client/src/settings/__tests__/stores.test.ts packages/rt-client/test/index-surface.test.ts lib/team/__tests__/team-local.test.ts`
Expected: PASS.

- [ ] **Step 8: Rebuild dist and commit**

```bash
(cd packages/rt-client && bun run build)
bunx tsc --noEmit
git add lib/team/team-local.ts lib/team/__tests__/team-local.test.ts packages/rt-client/src/settings/team-local-read.ts packages/rt-client/src/settings/stores.ts packages/rt-client/src/settings/active-team.ts packages/rt-client/src/index.ts packages/rt-client/src/settings/__tests__/active-team.test.ts packages/rt-client/src/settings/__tests__/stores.test.ts packages/rt-client/test/index-surface.test.ts
git commit -m "rt-client: stored forge username, org listing and the active team"
```

### Task 5: The resolver and the write path read the new layout

This is the switch. After it, `getSetting` reads the org store and the active team's store, `setSetting` writes them, and nothing reads `mattstack/settings.team.jsonc` at the clone root.

**Files:**
- Modify: `packages/rt-client/src/settings/paths.ts` and `lib/rt-paths.ts` (`teamSettingsPath` takes `(org, team)`)
- Modify: `packages/rt-client/src/settings/stores.ts` (remove `listTeams`)
- Modify: `packages/rt-client/src/settings/resolve.ts`
- Modify: `packages/rt-client/src/settings/write.ts`
- Modify: `packages/rt-client/src/settings/validate-write.ts`
- Modify: `packages/rt-client/src/settings/migrate-stores.ts`
- Modify: `packages/rt-client/src/index.ts`
- Modify: `packages/rt-client/test/org-fixture.ts`
- Modify (every gate that treats team-authored values as untrusted): `lib/worktree/config.ts` (`inspectReadyGate`), `commands/settings-keys.ts` (`migratePrune`, `SCOPE_WORDS`), `lib/skills/writing-style.ts` (the source label)
- Modify (readers and writers of the old store path): `lib/team/board-token.ts` (`declaresHttpsSwitchboard`), `lib/variations.ts` (line 92), `extensions/vscode/rt-context/src/branchNaming.ts` (line 65)
- Modify: `lib/__tests__/no-settings-bypass.test.ts` (the rules and the allowlist)
- Modify (callers of the removed names): `commands/team.ts`, `commands/setup.ts`, `commands/tools.ts`, `commands/verify.ts`, `lib/endpoint/shim.ts`, `lib/repo-reidentify.ts`, `lib/setup/plan.ts`, `lib/team/invite.ts`, `lib/team/members.ts`, `packages/settings-kit/src/server.ts`
- Test: `packages/rt-client/src/settings/__tests__/resolve.test.ts`, `write.test.ts`, `validate-write.test.ts`, `stores.test.ts`, `paths.test.ts`, `migrate-stores.test.ts`, `check.test.ts`, `lib/__tests__/rt-paths.test.ts`, `lib/__tests__/settings-paths-parity.test.ts`, `lib/worktree/__tests__/ready-approval.test.ts`, `commands/__tests__/settings-migrate.test.ts`, `lib/team/__tests__/board-token.test.ts`, `packages/settings-kit/src/__tests__/server.test.ts`, and the board's server tests under `apps/board/src/__tests__/`

**Interfaces:**
- Consumes: Task 1 paths, Task 3 scopes, Task 4 `activeTeamFrom`, `listOrgs`, `currentOrg`, `listTeamFolders`, `sharedStoreFiles`, `TEAM_NAME_RE`.
- Produces:

```ts
// paths.ts and rt-paths.ts
export function teamSettingsPath(org: string, team: string): string;

// resolve.ts
export type Scope = "machine.repo" | "machine" | "user.repo" | "team.repo" | "org.repo" | "user" | "team" | "org" | "default";
export const SCOPE_ORDER: Scope[]; // default, org, team, user, org.repo, team.repo, user.repo, machine, machine.repo
export interface ResolveOpts {
  repoIdentity?: string | null;
  expand?: boolean;
  expandCtx?: { repoRoot?: string; worktree?: string };
  /** Read as this team folder instead of the active team; null reads the org layer alone. */
  team?: string | null;
}

/** A layer other people author: the org's or a team's, global or per repo. Every gate that distrusts team-authored values asks this. */
export function isSharedScope(scope: Scope): boolean; // org, org.repo, team, team.repo

// write.ts
export interface SetSettingOpts {
  repoIdentity?: string;
  /** The team folder a `scope: "team"` write lands in; the active team when omitted. Ignored for every other scope. */
  team?: string;
}

// org-fixture.ts
export function seedOrg(opts?: SeedOrg): { org: string; orgStore: string; teamStores: Record<string, string> };
```

- [ ] **Step 1: Write the failing resolver tests**

In `packages/rt-client/src/settings/__tests__/resolve.test.ts`:

Replace the `TEAM` constant and the `writeTeam` fixture with org-aware ones (the imports gain `seedOrg` from `../../../test/org-fixture.ts`, `orgSettingsPath` from `../paths.ts`, and `teamSettingsPath` now takes two arguments):

```ts
const ORG = "acme";
const TEAM = "widgets";
```

```ts
  const writeOrg = (obj: unknown) => write(orgSettingsPath(ORG), obj);
  /** Puts this Mac on `TEAM` and writes that team's store. */
  const writeTeam = (obj: unknown) => {
    seedOrg({ org: ORG, username: "dev1", roster: [{ username: "dev1", teams: [TEAM] }], teams: { [TEAM]: obj as Record<string, unknown> } });
  };
```

`seedOrg` rewrites the org store, so a test that needs both layers passes the org values through `seedOrg({ settings: ... })` rather than calling `writeOrg` first. Every existing call `writeTeam(TEAM, obj)` in the file is a shared-layer seed: change it to `writeOrg(obj)` and change the scope it asserts from `"team"` to `"org"` (and `"team.repo"` to `"org.repo"`). After Task 2's codemod the file's expectations and its `writeTeam` helper spell the path `sharedStorePath(TEAM)`; those become `orgSettingsPath(ORG)`.

Replace the `scope precedence` ladder with the nine-rung one:

```ts
    type Layer = "org" | "team" | "user" | "org.repo" | "team.repo" | "user.repo" | "machine" | "machine.repo";

    const LADDER: Layer[] = ["org", "team", "user", "org.repo", "team.repo", "user.repo", "machine", "machine.repo"];

    const marker = (layer: Layer) => [{ id: layer }];

    function fileFor(layer: Layer): string {
      if (layer === "org" || layer === "org.repo") return orgSettingsPath(ORG);
      if (layer === "team" || layer === "team.repo") return teamSettingsPath(ORG, TEAM);
      if (layer === "user" || layer === "user.repo") return userSettingsPath();
      return machineSettingsPath();
    }

    function writeLayers(active: Layer[]): void {
      const on = (l: Layer) => active.includes(l);
      const global = (l: Layer) => (on(l) ? { "rt.intercepts": marker(l) } : {});
      const repos = (l: Layer) => (on(l) ? { [IDENTITY]: { "rt.intercepts": marker(l) } } : {});

      seedOrg({
        org: ORG,
        username: "dev1",
        roster: [{ username: "dev1", teams: [TEAM] }],
        settings: { ...global("org"), repos: repos("org.repo") },
        teams: { [TEAM]: { ...global("team"), repos: repos("team.repo") } },
      });
      writeUser({ ...global("user"), repos: repos("user.repo") });
      writeMachine({ ...global("machine"), repos: repos("machine.repo") });
    }
```

The two tests under it stay as they are (they loop over `LADDER`).

Add a new `describe` after `scope precedence`:

```ts
  describe("org and team layers", () => {
    const roster = [
      { username: "dev1", teams: ["widgets"] },
      { username: "dev2", teams: ["widgets", "gadgets"] },
    ];

    function seed(username: string | undefined): void {
      seedOrg({
        org: ORG,
        ...(username ? { username } : {}),
        roster,
        settings: { "board.title": "Acme", "board.gitlabHost": "gitlab.example.com" },
        teams: { widgets: { "board.title": "Widgets" }, gadgets: { "board.title": "Gadgets" } },
      });
    }

    test("the active team's value replaces the org's, and the org's shows through where the team is silent", () => {
      seed("dev1");
      expect(getSetting<string>("board.title")).toEqual({ value: "Widgets", provenance: [{ scope: "team", file: teamSettingsPath(ORG, "widgets") }] });
      expect(getSetting<string>("board.gitlabHost")).toEqual({ value: "gitlab.example.com", provenance: [{ scope: "org", file: orgSettingsPath(ORG) }] });
    });

    test("a member on two teams reads the one mattstack.activeTeam names", () => {
      seed("dev2");
      expect(getSetting<string>("board.title").value).toBe("Widgets");
      writeUser({ "mattstack.activeTeam": "gadgets" });
      expect(getSetting<string>("board.title").value).toBe("Gadgets");
    });

    test("a Mac with no active team reads the org layer and skips the team rung", () => {
      seed("stranger");
      expect(getSetting<string>("board.title").value).toBe("Acme");
      const rows = explainSetting("board.title");
      expect(rows.map((r) => r.scope)).toEqual(["default", "org", "team", "user", "machine"]);
      expect(rows.find((r) => r.scope === "team")).toEqual({ scope: "team", file: null, present: false });
    });

    test("opts.team reads as another team, and null reads the org alone", () => {
      seed("dev1");
      expect(getSetting<string>("board.title", { team: "gadgets" }).value).toBe("Gadgets");
      expect(getSetting<string>("board.title", { team: null }).value).toBe("Acme");
      expect(() => getSetting("board.title", { team: "../x" })).toThrow(/not a team name/);
    });

    test("a team the roster lists whose folder is not on disk reads as the org layer", () => {
      seedOrg({ org: ORG, username: "dev1", roster: [{ username: "dev1", teams: ["sprockets"] }], settings: { "board.title": "Acme" } });
      expect(getSetting<string>("board.title").value).toBe("Acme");
      const team = explainSetting("board.title").find((r) => r.scope === "team");
      expect(team).toEqual({ scope: "team", file: teamSettingsPath(ORG, "sprockets"), present: false });
    });

    test("an org-only key in a team store is refused as not settable there", () => {
      seedOrg({ org: ORG, username: "dev1", roster, teams: { widgets: { "mattstack.roster": [{ username: "intruder", teams: ["widgets"] }] } } });
      const got = getSetting<{ username: string }[]>("mattstack.roster");
      expect(got.value.map((e) => e.username)).toEqual(["dev1", "dev2"]);
      expect(got.provenance).toEqual([{ scope: "org", file: orgSettingsPath(ORG) }]);
    });

    test("with two org clones only the first by name is read, and rt warns once", () => {
      setSettingsWarnSink(null);
      seedOrg({ org: "acme", settings: { "board.title": "Acme" } });
      seedOrg({ org: "zeta", settings: { "board.title": "Zeta" } });
      expect(getSetting<string>("board.title").value).toBe("Acme");
      getSetting<string>("board.title");
      const multi = warnSpy.mock.calls.filter(([msg]) => String(msg).includes("org clones"));
      expect(multi.length).toBe(1);
    });
  });
```

In the `teamLocked` describe, add one assertion that an org value survives the lock (use the file's `withTeamLocked` helper):

```ts
    test("a locked key still takes the org's value and ignores the user's", () => {
      writeOrg({ "board.title": "Acme" });
      writeUser({ "board.title": "Mine" });
      withScope("board.title", "user", () =>
        withTeamLocked("board.title", () => {
          expect(getSetting<string>("board.title").value).toBe("Acme");
        }),
      );
    });
```

- [ ] **Step 2: Write the failing write tests**

In `packages/rt-client/src/settings/__tests__/write.test.ts`, replace the team-selection tests (the ones about "exactly one team", "multiple local team stores" and "pass opts.team") with:

```ts
  describe("org and team stores", () => {
    const roster = [{ username: "dev1", teams: ["widgets"] }];

    test("scope org writes the org store and keeps its comments", () => {
      seedOrg({ org: "acme", username: "dev1", roster });
      const file = orgSettingsPath("acme");
      writeFileSync(file, `// org settings\n${readFileSync(file, "utf8")}`);
      setSetting("board.gitlabHost", "gitlab.example.com", "org");
      expect(readFileSync(file, "utf8")).toStartWith("// org settings\n");
      expect(getSetting<string>("board.gitlabHost").provenance).toEqual([{ scope: "org", file }]);
    });

    test("scope team writes the active team's store", () => {
      seedOrg({ org: "acme", username: "dev1", roster, teams: { widgets: {}, gadgets: {} } });
      setSetting("board.title", "Widgets", "team");
      expect(readStore(teamSettingsPath("acme", "widgets")).global["board.title"]).toBe("Widgets");
      expect(readStore(teamSettingsPath("acme", "gadgets")).global["board.title"]).toBeUndefined();
    });

    test("opts.team names another team folder", () => {
      seedOrg({ org: "acme", username: "dev1", roster, teams: { widgets: {}, gadgets: {} } });
      setSetting("board.title", "Gadgets", "team", { team: "gadgets" });
      expect(readStore(teamSettingsPath("acme", "gadgets")).global["board.title"]).toBe("Gadgets");
    });

    test("a team write with no active team and no name refuses", () => {
      seedOrg({ org: "acme", username: "stranger", roster, teams: { widgets: {} } });
      expect(() => setSetting("board.title", "x", "team")).toThrow(/no active team/);
    });

    test("a team name that is not a folder name refuses before touching disk", () => {
      seedOrg({ org: "acme", username: "dev1", roster, teams: { widgets: {} } });
      expect(() => setSetting("board.title", "x", "team", { team: "../x" })).toThrow(/not a team name/);
    });

    test("a team whose settings file is missing refuses and names the file", () => {
      seedOrg({ org: "acme", username: "dev1", roster: [{ username: "dev1", teams: ["sprockets"] }] });
      expect(() => setSetting("board.title", "x", "team")).toThrow(teamSettingsPath("acme", "sprockets"));
      expect(existsSync(teamSettingsPath("acme", "sprockets"))).toBe(false);
    });

    test("an org write on a Mac with no org refuses", () => {
      expect(() => setSetting("board.gitlabHost", "gitlab.example.com", "org")).toThrow(/no org/);
    });

    test("an org-only key refuses at team scope", () => {
      seedOrg({ org: "acme", username: "dev1", roster, teams: { widgets: {} } });
      expect(() => setSetting("mattstack.roster", [], "team")).toThrow(/cannot be set in the team store/);
    });

    test("unset on a Mac with no org, or with no active team, is a clean no-op", () => {
      expect(unsetSetting("board.title", "org")).toBe(false);
      seedOrg({ org: "acme", username: "stranger", roster, teams: { widgets: {} } });
      expect(unsetSetting("board.title", "team")).toBe(false);
    });
  });
```

Keep the file's existing joined-clone test (`refuseIfJoined`) but seed it with `seedOrg` plus a record `{ joinedByRt: true, forgeUsername: "dev1" }` written to `teamLocalPath("acme")`, and assert both an org write and a team write refuse. Task 21 replaces that gate.

- [ ] **Step 3: Write the failing trust-gate tests**

An org value is written by other people, exactly like a team value, so every gate that holds back team-authored values has to hold back org-authored ones. Three gates exist.

`lib/worktree/__tests__/ready-approval.test.ts` (after Task 2 its `teamReady` helper seeds through `sharedStorePath("acme")`, which this task turns into the org store, so its existing "held" tests are already the org case). Add the team-folder case and name the org case:

```ts
  test("a ready ladder the org authors is held until you approve it", async () => {
    teamReady([{ run: "echo org" }]);
    const cfg = loadWorktreeRepoConfig(IDENTITY, repoPath);
    const gate = await evaluateReadyGate(cfg, "ready-gate", repoPath);
    expect(gate.held).toBe(true);
    expect(gate.steps).toEqual([]);
  });

  test("a ready ladder a team folder authors is held too", async () => {
    seedOrg({
      org: "acme",
      username: "dev1",
      roster: [{ username: "dev1", teams: ["widgets"] }],
      teams: { widgets: { repos: { [IDENTITY]: { "rt.worktrees": { onDeck: 1, ready: [{ run: "echo team" }] } } } } },
    });
    const cfg = loadWorktreeRepoConfig(IDENTITY, repoPath);
    expect((await evaluateReadyGate(cfg, "ready-gate", repoPath)).held).toBe(true);
  });
```

(match `loadWorktreeRepoConfig`'s real argument order from the file's other tests; import `seedOrg` from `../../../packages/rt-client/test/org-fixture.ts`.)

`commands/__tests__/settings-migrate.test.ts`, replacing the test near line 172 (`TEAM` there is the clone slug; the store it seeds is now the org store):

```ts
  test("--prune leaves the org store alone without --team, and prunes it with --team", async () => {
    await withMigrationAsync("rt.roles", ROLES_BUMP, async () => {
      write(orgSettingsPath(TEAM), { repos: { [IDENTITY]: { "rt.roles": { web: { hook: "./dev.sh" } }, "rt.roles@2": { web: { devHook: "./dev.sh" } } } } });
      await settingsMigrate(["--prune", "--yes"], noPrompt);
      expect((read(orgSettingsPath(TEAM)).repos as Record<string, Record<string, unknown>>)[IDENTITY]!["rt.roles"]).toBeDefined();
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
      await settingsMigrate(["--prune", "--team", "--yes"], noPrompt);
      expect(read(orgSettingsPath(TEAM))).toEqual({ repos: { [IDENTITY]: { "rt.roles@2": { web: { devHook: "./dev.sh" } } } } });
    });
  });
```

`lib/skills/__tests__/writing-style.test.ts`: add a case that `skills.writingStyle` set in the org store resolves with `source: "team"` (the label reads "team default"), seeded the way that file seeds its team case.

`lib/team/__tests__/board-token.test.ts`: its fixture near line 16 writes the switchboard declaration to `teams/<slug>/mattstack/settings.team.jsonc`; write it to `teams/<slug>/mattstack/org/settings.org.jsonc`, so the existing "unpeered" and "peered" cases keep meaning what they say.

- [ ] **Step 4: Run them to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/resolve.test.ts packages/rt-client/src/settings/__tests__/write.test.ts lib/worktree/__tests__/ready-approval.test.ts commands/__tests__/settings-migrate.test.ts lib/team/__tests__/board-token.test.ts`
Expected: FAIL (type errors on `teamSettingsPath(ORG, TEAM)` and missing `seedOrg`).

- [ ] **Step 5: Change `teamSettingsPath` in both path modules**

In `lib/rt-paths.ts` and in `packages/rt-client/src/settings/paths.ts`, replace the function and its doc comment:

```ts
/** ~/.mattstack/teams/<org>/mattstack/teams/<team>/settings.team.jsonc: one team folder's store. */
export function teamSettingsPath(org: string, team: string): string {
  return join(teamFolderDir(org, team), "settings.team.jsonc");
}
```

In rt-client's `paths.ts`, `teamLocalPath(team)` keeps its body; rename its parameter to `org` and reword its comment to say the record is keyed by the org slug.

Update the three path tests to the new shape: in `paths.test.ts` and `rt-paths.test.ts` the expectation becomes `<home>/.mattstack/teams/acme/mattstack/teams/widgets/settings.team.jsonc` for `teamSettingsPath("acme", "widgets")`; in the parity test the line becomes `expect(clientPaths.teamSettingsPath("acme", "widgets")).toBe(rtPaths.teamSettingsPath("acme", "widgets"));`.

- [ ] **Step 6: Finish the fixture**

Replace `packages/rt-client/test/org-fixture.ts` with:

```ts
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { orgMarkerPath, orgSettingsPath, teamLocalPath, teamSettingsPath } from "../src/settings/paths.ts";

function writeJson(file: string, value: unknown): string {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return file;
}

/** The store a test seeds to put a value in the layer every member shares. HOME is read at call time. */
export function sharedStorePath(org: string): string {
  return orgSettingsPath(org);
}

export function writeSharedStore(org: string, value: unknown): string {
  return writeJson(sharedStorePath(org), value);
}

export interface SeedOrg {
  org?: string;
  settings?: Record<string, unknown>;
  teams?: Record<string, Record<string, unknown>>;
  /** Stored as this Mac's forge username for the org. */
  username?: string;
  roster?: { username: string; teams?: string[]; [key: string]: unknown }[];
  roles?: { admins: string[]; teams: Record<string, { owners: string[] }> };
}

/** Writes an org clone's marker, org store and team stores under the current HOME. Not a git repo. */
export function seedOrg(opts: SeedOrg = {}): { org: string; orgStore: string; teamStores: Record<string, string> } {
  const org = opts.org ?? "acme";
  writeJson(orgMarkerPath(org), { role: "org", org });
  const settings: Record<string, unknown> = { ...(opts.settings ?? {}) };
  if (opts.roster) settings["mattstack.roster"] = opts.roster;
  if (opts.roles) settings["mattstack.org"] = opts.roles;
  const orgStore = writeJson(orgSettingsPath(org), settings);
  const teamStores: Record<string, string> = {};
  for (const [team, value] of Object.entries(opts.teams ?? {})) teamStores[team] = writeJson(teamSettingsPath(org, team), value);
  if (opts.username !== undefined) writeJson(teamLocalPath(org), { forgeUsername: opts.username });
  return { org, orgStore, teamStores };
}
```

- [ ] **Step 7: Rewrite the store reading in `resolve.ts`**

Imports:

```ts
import { activeTeamFrom } from "./active-team.ts";
import { machineSettingsPath, orgSettingsPath, teamSettingsPath, teamsDir, userSettingsPath } from "./paths.ts";
import { listOrgs, readStore, TEAM_NAME_RE, type StoreFile } from "./stores.ts";
```

Types and order:

```ts
export type Scope =
  | "machine.repo"
  | "machine"
  | "user.repo"
  | "team.repo"
  | "org.repo"
  | "user"
  | "team"
  | "org"
  | "default";

/** The scope ladder, weakest first. Also the order every result is built in. */
export const SCOPE_ORDER: Scope[] = [
  "default",
  "org",
  "team",
  "user",
  "org.repo",
  "team.repo",
  "user.repo",
  "machine",
  "machine.repo",
];
```

Add to `ResolveOpts`:

```ts
  /** Read as this team folder instead of the active team; null reads the org layer alone. */
  team?: string | null;
```

Replace `StoreBundle`, `readStores`, `multiTeamWarned` and `warnMultipleTeams`:

```ts
interface StoreBundle {
  user: StoreFile;
  machine: StoreFile;
  /** Null on a Mac with no org clone. */
  org: StoreFile | null;
  /** Null with no org, or with no active team. A team whose file is missing is a store with `exists: false`. */
  team: StoreFile | null;
}

function assertTeamName(team: string): void {
  if (!TEAM_NAME_RE.test(team)) throw new Error(`rt: "${team}" is not a team name (lowercase letters, digits and dashes, starting with a letter)`);
}

function readStores(view: { team?: string | null } = {}): StoreBundle {
  const user = readStore(userSettingsPath());
  const machine = readStore(machineSettingsPath());
  const orgs = [...listOrgs()].sort();
  if (orgs.length > 1) warnMultipleOrgs(orgs);
  const org = orgs[0];
  if (org === undefined) return { user, machine, org: null, team: null };
  const orgStore = readStore(orgSettingsPath(org));
  if (typeof view.team === "string") assertTeamName(view.team);
  const team = view.team !== undefined ? view.team : activeTeamFrom(org, orgStore, user).team;
  return { user, machine, org: orgStore, team: team === null ? null : readStore(teamSettingsPath(org, team)) };
}

let multiOrgWarned: string | null = null;

/** Once per process and per set of clones: every settings read folds the stores, so an unguarded warning would repeat on each one. */
function warnMultipleOrgs(orgs: string[]): void {
  const names = orgs.join(", ");
  if (multiOrgWarned === names) return;
  multiOrgWarned = names;
  emitSettingsWarning(
    `rt: this machine has ${orgs.length} org clones (${names}); mattstack supports one org per machine today. Only ${orgs[0]} is read.`,
  );
}
```

`setSettingsWarnSink` resets `multiOrgWarned = null` where it reset `multiTeamWarned`.

Replace `mergedValueWith` and `currentMergedValue`:

```ts
/**
 * The merged value the resolver would produce if `override.scope` (and its
 * repo section, when given) held `override.value`. A team write is judged in
 * the view of the team it lands in, never the caller's own active team.
 */
export function mergedValueWith(
  def: SettingDef,
  override: { scope: SettingScope; repoIdentity?: string; team?: string; value: unknown },
  opts: ResolveOpts = {},
): unknown {
  const view = override.scope === "team" && override.team !== undefined ? override.team : opts.team;
  const stores = readStores({ team: view });
  const patched: StoreBundle = {
    user: cloneStore(stores.user),
    machine: cloneStore(stores.machine),
    org: stores.org ? cloneStore(stores.org) : null,
    team: stores.team ? cloneStore(stores.team) : null,
  };
  const target = { user: patched.user, machine: patched.machine, org: patched.org, team: patched.team }[override.scope];
  if (target) {
    if (override.repoIdentity !== undefined) {
      target.repos[override.repoIdentity] = { ...(target.repos[override.repoIdentity] ?? {}), [currentStoreName(def)]: override.value };
    } else {
      target.global = { ...target.global, [currentStoreName(def)]: override.value };
    }
  }
  return resolveDef(def, patched, opts).value;
}

export function currentMergedValue(def: SettingDef, opts: ResolveOpts = {}): unknown {
  return resolveDef(def, readStores({ team: opts.team }), opts).value;
}
```

Replace the three store walkers:

```ts
function sharedStores(stores: StoreBundle): StoreFile[] {
  return [stores.org, stores.team].filter((s): s is StoreFile => s !== null);
}

export function listStoreRepoIdentities(): string[] {
  const stores = readStores();
  const ids = new Set<string>();
  for (const store of [stores.user, stores.machine, ...sharedStores(stores)]) for (const id of Object.keys(store.repos)) ids.add(id);
  return [...ids].sort();
}
```

In `listUnregisteredSettings`, replace the `for (const store of stores.teams)` block with:

```ts
  if (stores.org) {
    scan("org", stores.org.file, stores.org.global);
    for (const s of Object.values(stores.org.repos)) scan("org.repo", stores.org.file, s);
  }
  if (stores.team) {
    scan("team", stores.team.file, stores.team.global);
    for (const s of Object.values(stores.team.repos)) scan("team.repo", stores.team.file, s);
  }
```

In `repoSectionsFor`, replace `for (const store of stores.teams) note("team", store);` with:

```ts
  if (stores.org) note("org", stores.org);
  if (stores.team) note("team", stores.team);
```

In `collectSlots`, replace `pushTeams` and the ladder:

```ts
  /** A layer this Mac has no store for still gets its rung, absent, so `explain` shows the ladder in full. */
  const pushShared = (scope: Scope, store: StoreFile | null, section: (store: StoreFile) => Record<string, unknown> | undefined) => {
    if (store === null) {
      slots.push({ scope, file: null, present: false });
      return;
    }
    push(scope, store.file, section(store));
  };
```

```ts
  pushShared("org", stores.org, (store) => store.global);
  pushShared("team", stores.team, (store) => store.global);
  push("user", stores.user.file, stores.user.global);
  if (useRepo) pushShared("org.repo", stores.org, repoSection);
  if (useRepo) pushShared("team.repo", stores.team, repoSection);
  if (useRepo) push("user.repo", stores.user.file, repoSection(stores.user));
  push("machine", stores.machine.file, stores.machine.global);
  if (useRepo) push("machine.repo", stores.machine.file, repoSection(stores.machine));
```

Replace the scope helpers:

```ts
const TEAM_LOCKED_SCOPES: Scope[] = ["default", "org", "team", "org.repo", "team.repo"];

function isRepoRung(scope: Scope): boolean {
  return scope === "org.repo" || scope === "team.repo" || scope === "user.repo" || scope === "machine.repo";
}

function baseScope(scope: Scope): SettingScope | null {
  if (scope === "org" || scope === "org.repo") return "org";
  if (scope === "team" || scope === "team.repo") return "team";
  if (scope === "user" || scope === "user.repo") return "user";
  if (scope === "machine" || scope === "machine.repo") return "machine";
  return null;
}
```

```ts
export function isSharedScope(scope: Scope): boolean {
  return scope === "org" || scope === "org.repo" || scope === "team" || scope === "team.repo";
}
```

and in `validateForScope`:

```ts
  const shared = scope !== "default" && scope !== "machine" && scope !== "machine.repo";
```

Export `isSharedScope` from `packages/rt-client/src/index.ts` on the resolve export line.

In `getSetting`, `listSettings` and `explainSetting`, change `readStores()` to `readStores({ team: opts.team })`.

In the private `listUnregistered(stores, opts)`, replace the two `for (const store of stores.teams)` lines with:

```ts
  if (stores.org) scan("org", stores.org.file, stores.org.global);
  if (stores.team) scan("team", stores.team.file, stores.team.global);
  scan("user", stores.user.file, stores.user.global);
  if (stores.org) scan("org.repo", stores.org.file, repoSection(stores.org));
  if (stores.team) scan("team.repo", stores.team.file, repoSection(stores.team));
```

(the `user.repo`, `machine` and `machine.repo` scans after them stay).

Update the file's header comment: the ladder line reads `default < org < team < user < org.repo < team.repo < user.repo < machine < machine.repo`, and the sentence about overlaying every cloned team goes.

- [ ] **Step 8: Remove `listTeams`**

Delete `listTeams` from `stores.ts` (its body is now `listOrgs`), drop it from the `index.ts` export line, and drop `teamSettingsPath` from `stores.ts`'s import if it is no longer used there. In `stores.test.ts`, delete the `listTeams` tests whose behavior the Task 4 `org listing` tests already cover, and port the dangling-symlink and unreadable-entry tests to `listOrgs` by changing the seeded file to `mattstack/org/settings.org.jsonc`.

- [ ] **Step 9: Rewrite the store targeting in `write.ts`**

Imports:

```ts
import { activeTeam } from "./active-team.ts";
import { machineSettingsPath, orgDir, orgSettingsPath, teamSettingsPath, userSettingsPath } from "./paths.ts";
import { currentOrg, readStore, TEAM_NAME_RE } from "./stores.ts";
```

Replace the `SetSettingOpts.team` doc as in the Interfaces block. In `setSetting`, the create flag becomes:

```ts
    /* createIfMissing */ scope === "user" || scope === "machine",
```

Replace `resolveStorePath` and `resolveStorePathForUnset`:

```ts
function requireOrg(): string {
  const org = currentOrg();
  if (org === null) refuse("this Mac has no org yet, so there are no shared settings to write");
  return org;
}

function sharedStoreTarget(scope: "org" | "team", opts: SetSettingOpts): { org: string; path: string; label: string } {
  const org = requireOrg();
  if (scope === "org") return { org, path: orgSettingsPath(org), label: `the ${org} org` };
  const team = opts.team ?? activeTeam().team;
  if (team === null) refuse("no active team on this Mac; name the team to write to");
  if (!TEAM_NAME_RE.test(team)) refuse(`"${team}" is not a team name (lowercase letters, digits and dashes, starting with a letter)`);
  return { org, path: teamSettingsPath(org, team), label: `the ${team} team` };
}

/** Resolves which store file a write targets. A shared store is never created here: it lives in a repo that has to be committed and pushed to reach anyone. */
function resolveStorePath(scope: SettingScope, opts: SetSettingOpts): string {
  if (scope === "user") return userSettingsPath();
  if (scope === "machine") return machineSettingsPath();
  const { org, path, label } = sharedStoreTarget(scope, opts);
  if (!existsSync(path)) refuse(`${label} has no settings file on this Mac (${path}); pull the org before writing to it`);
  refuseIfJoined(org);
  return path;
}

/** `resolveStorePath` for removal: no store to target answers null (nothing to remove) instead of refusing. */
function resolveStorePathForUnset(scope: SettingScope, opts: SetSettingOpts): string | null {
  if (scope === "user") return userSettingsPath();
  if (scope === "machine") return machineSettingsPath();
  if (currentOrg() === null) return null;
  if (scope === "team" && opts.team === undefined && activeTeam().team === null) return null;
  const { org, path } = sharedStoreTarget(scope, opts);
  if (!existsSync(path)) return null;
  refuseIfJoined(org);
  return path;
}
```

`refuseIfJoined(team)` keeps its body; rename its parameter to `org` and change its message to `this Mac joined "${org}" by invite, so its clone is pull-only and shared settings cannot be written here. Ask an org admin to make this change.`

Replace the shared-store half of `shareTip` (everything after the `if (scope === "user") { ... }` block):

```ts
  const org = currentOrg();
  if (org === null) return;
  const repo = orgDir(org);
  const whose = scope === "org" ? `the ${org} org's settings` : `the ${basename(dirname(storePath))} team's settings`;
  if (!hasOrigin(repo)) {
    notify({ text: `${did} ${prep} ${whose} on this Mac only. The org repo has no remote yet.`, next: "rt team publish --remote <url>" });
  } else if (!snapshotEnabled("rt.teamSnapshot")) {
    notify({ text: `${did} ${prep} ${whose}, but automatic team sync is off.`, next: "rt team publish" });
  }
```

Update the module's header comment: the "Team selection" section now says a team write lands in `opts.team` or the active team, an org write takes no name, and neither store is ever created by a write.

- [ ] **Step 10: Carry the team view through `validate-write.ts`**

Change the `before` read so a team write is compared in the same view it was merged in:

```ts
    const view = opts.scope === "team" && opts.team !== undefined ? { team: opts.team } : {};
    const before = currentMergedValue(def, { repoIdentity, expand: false, ...view });
```

- [ ] **Step 11: Walk the new stores in `migrate-stores.ts`**

```ts
import { machineSettingsPath, orgSettingsPath, teamSettingsPath, userSettingsPath } from "./paths.ts";
import { currentOrg, listTeamFolders, readStore } from "./stores.ts";
```

```ts
export interface StoreSection {
  scope: SettingScope;
  /** The team folder's name, for a team store. */
  team?: string;
  file: string;
  repo?: string;
  section: Record<string, unknown>;
}

export function storeSections(): StoreSection[] {
  const org = currentOrg();
  const shared: { scope: SettingScope; team?: string; file: string }[] =
    org === null
      ? []
      : [
          { scope: "org", file: orgSettingsPath(org) },
          ...listTeamFolders(org).map((team) => ({ scope: "team" as const, team, file: teamSettingsPath(org, team) })),
        ];
  const stores = [...shared, { scope: "user" as const, file: userSettingsPath() }, { scope: "machine" as const, file: machineSettingsPath() }];
  const out: StoreSection[] = [];
  for (const s of stores) {
    const store = readStore(s.file);
    if (!store.exists) continue;
    out.push({ ...s, section: store.global });
    for (const [repo, section] of Object.entries(store.repos)) out.push({ ...s, repo, section });
  }
  return out;
}
```

Every team folder is walked, not only the active one: `rt settings check` and `rt settings migrate` are about the clone, not about this member's view.

- [ ] **Step 12: Fix the callers of the removed names**

Run `bunx tsc --noEmit` and fix each error with these rules:

| Site | Change |
|---|---|
| `commands/team.ts` `resolveTeamSlug` and line 614 | `listTeams()` becomes `listOrgs()`; the copy stays |
| `commands/team.ts` line 497 | `readStore(teamSettingsPath(slug))` becomes `readStore(orgSettingsPath(slug))` |
| `commands/setup.ts`, `commands/tools.ts`, `commands/verify.ts`, `lib/setup/plan.ts` | `listTeams` becomes `listOrgs` (the `teams:` field name on `PlanInputs` stays until Task 9) |
| `lib/endpoint/shim.ts` `interceptSourceFiles` | `return [userSettingsPath(), machineSettingsPath(), ...sharedStoreFiles()];` |
| `lib/repo-reidentify.ts` | `teamsOrRefusal()` returns `sharedStoreFiles()` (keep its unreadable-dir refusal); the loop becomes `for (const file of files) add(\`settings:${sharedLabel(file)}\`, () => settingsReport(sharedLabel(file), file, from.raw, to.raw, dryRun));` with `const sharedLabel = (file: string) => \`shared:${relative(teamsDir(), file)}\`;` (two team folders' stores share a basename, so the label is the path under the teams folder) |
| `lib/team/invite.ts`, `lib/team/members.ts` | `defaultReadTeamStore(slug)` reads `readStore(orgSettingsPath(slug)).global`; every `writeSetting(key, value, "team", { team: slug })` becomes `writeSetting(key, value, "org")` |
| `commands/settings-keys.ts` `SCOPE_WORDS` | add `org: "the org's settings"` and `"org.repo": "the org's settings for this repo"` (the record is keyed by every resolver scope) |
| `packages/settings-kit/src/server.ts` | `RtSettingsApi.listTeams` becomes `listOrgs: typeof listOrgs`; the `/defs` reply keeps `team` for now: `const orgs = rt.listOrgs(); ... team: orgs.length === 1 ? orgs[0] : null` (Task 8 replaces it). In `server.test.ts`, the "defs names the machine's one team" test overrides `listTeams`; it overrides `listOrgs` instead |
| `lib/worktree/config.ts` `inspectReadyGate` | `const teamOwned = owner !== null && isSharedScope(owner);` (import `isSharedScope` beside `SCOPE_ORDER`); the comments on `ReadyGateInfo.teamOwned` and above `evaluateReadyGate` say "org or team authored" |
| `commands/settings-keys.ts` `migratePrune` | the guard's condition becomes `(n.scope === "team" \|\| n.scope === "org") && !o.team`, and its reason is built as `n.scope + " store: pass --team to prune it"` |
| `lib/skills/writing-style.ts` line 88 | `source: isSharedScope(scope) ? "team" : "user"` |
| `lib/team/board-token.ts` `declaresHttpsSwitchboard` | reads `join(p.home, ".mattstack", "teams", slug, "mattstack", "org", "settings.org.jsonc")`; its comment says "the org's own store" |
| `lib/variations.ts` line 92 | `setSetting("rt.variations", all, "org", { repoIdentity })`: a shared repo's section sits at the org (spec section 3) |
| `apps/boxscore/scripts/import-legacy-settings.ts` | the planned `mattstack.roster` write takes scope `'org'` (widen `PlannedWrite`'s scope type), and the closing message says "org and team writes landed in the local org clone" |
| `extensions/vscode/rt-context/src/branchNaming.ts` line 65 | the legacy import writes `"org"`; reword the comment above it ("the org.repo store rung", and "one org per Mac" for the refusal it describes) |

`lib/team/invite.ts` and `members.ts` still write `board.members` beside `mattstack.roster`; both now land in the org store. Task 18 removes the first.

- [ ] **Step 13: Move the remaining tests onto the new layout**

Run: `bun run test`

Fix what fails with these rules, and nothing else:

1. An expectation of `scope: "team"` (or `"team.repo"`) for a value seeded through `sharedStorePath` becomes `"org"` (or `"org.repo"`).
2. A test that seeds a clone by hand (`mkdirSync(join(teams, "acme", "mattstack"))` plus `settings.team.jsonc`) to make `listOrgs` or `discoverTeams` see it writes `mattstack/org/settings.org.jsonc` instead. `lib/setup/team-settings.ts` `discoverTeams` itself changes in Task 9; for this step change only its path literal to `join(dir, name, "mattstack", "org", "settings.org.jsonc")`.
3. A message assertion that quoted the old copy takes the new copy from the `write.ts` step above.
4. `extensions/vscode/rt-context/src/__tests__/branchNaming.test.ts` builds the path by hand: change its helper to `join(home, '.mattstack', 'teams', team, 'mattstack', 'org', 'settings.org.jsonc')`.
5. `e2e/tests/settings.test.ts` seeds through `sharedStorePath` already; update its `explain` expectations for the extra `org` rung. Run it with `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/settings.test.ts`.

6. A test that writes the shared layer through `setSetting(key, value, "team", ...)` with no team name or with `{ team: "<clone slug>" }` (for example `lib/worktree/__tests__/dispose.test.ts:219`, `lib/daemon/__tests__/repo-tracking.test.ts:432`, `lib/__tests__/variations.test.ts:66`) writes `"org"` and drops the `team` option. Find them with `rg -n 'setSetting\([^)]*"team"' lib commands packages e2e -g '*.test.ts'`.
7. The board's server tests seed `teams/testteam/mattstack/settings.team.jsonc` by hand (`apps/board/src/__tests__/server-roster-route.test.ts:18`, `server-dismiss.test.ts:16`, `settings-live-reload.test.ts:14` and about fourteen more; find them with `rg -ln "settings.team.jsonc" apps/board/src`). Each seeds `teams/testteam/mattstack/org/settings.org.jsonc` instead. Run `bun run board:test`.
8. `lib/__tests__/no-settings-bypass.test.ts`: add `orgSettingsPath: "store path helper"` to `IDENTIFIER_RULES`, widen the first `STORE_FILE_TEXT` pattern to `/settings\.(?:user|team|org|local)\.jsonc/`, then update each allowlist entry the run reports (this task changes the counts for `lib/team/invite.ts`, `lib/team/members.ts`, `commands/team.ts`, `lib/endpoint/shim.ts`, `lib/repo-reidentify.ts`, `lib/setup/team-settings.ts`, `lib/team/board-token.ts` and `lib/worktree/config.ts`), rewording a reason that still says "merges every team store".

If a failing test does not fit one of these rules, stop and read it: it is testing behavior this task changed on purpose (team selection, multi-team overlay) and belongs with the tests rewritten in Steps 1 to 3, or it points at a caller the table above missed.

- [ ] **Step 14: Verify**

```bash
(cd packages/rt-client && bun run build)
bunx tsc --noEmit
bun run test
bun run board:test
bun run check
```

Expected: all green.

- [ ] **Step 15: Commit**

```bash
git status --short
git add packages/rt-client/src packages/rt-client/test/org-fixture.ts lib/rt-paths.ts lib/endpoint/shim.ts lib/repo-reidentify.ts lib/setup/plan.ts lib/setup/team-settings.ts lib/team/invite.ts lib/team/members.ts commands/team.ts commands/setup.ts commands/tools.ts commands/verify.ts commands/settings-keys.ts lib/worktree/config.ts lib/skills/writing-style.ts lib/team/board-token.ts lib/variations.ts apps/boxscore/scripts/import-legacy-settings.ts extensions/vscode/rt-context/src/branchNaming.ts lib/__tests__/no-settings-bypass.test.ts packages/settings-kit/src/server.ts extensions/vscode/rt-context/src/__tests__/branchNaming.test.ts e2e/tests/settings.test.ts
git add $(git diff --name-only -- '*.test.ts')
git commit -m "settings: the resolver and the write path read the org store and the active team's store"
```

Check `git status --short` shows nothing of yours left unstaged and nothing staged that you did not edit.

### Task 6: The add merge, with per-item provenance

**Files:**
- Modify: `packages/rt-client/src/settings/resolve.ts` (`Resolved`, `ListedSetting`, `Resolution`, `mergeApplied`, `getSetting`, `listSettings`)
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (`claude.marketplaces`, `claude.plugins`)
- Modify: `packages/rt-client/src/index.ts` (export `ItemSource`)
- Modify: `lib/setup/steps/plugins.ts` (`computePlugins`, `isTeamAuthored`)
- Modify: `docs/settings-architecture.md` (the merge section)
- Test: `packages/rt-client/src/settings/__tests__/resolve.test.ts`, `packages/rt-client/src/settings/__tests__/registry.test.ts`, `lib/setup/__tests__/steps-c.test.ts` (its `plugins.install` describe)

**Interfaces:**
- Produces:

```ts
export interface ItemSource {
  value: unknown;
  /** Every layer that lists this item, weakest first. */
  sources: Provenance[];
}
export interface Resolved<T> {
  value: T;
  provenance: Provenance[];
  /** Present only for a `merge: "add"` key: each item of `value`, in order, with the layers it came from. */
  items?: ItemSource[];
}
```

- [ ] **Step 1: Write the failing resolver tests**

Add to `resolve.test.ts`:

```ts
  describe("add merge", () => {
    const roster = [{ username: "dev1", teams: ["widgets"] }];

    function seed(layers: { org?: unknown; team?: unknown; user?: unknown }): void {
      seedOrg({
        org: ORG,
        username: "dev1",
        roster,
        settings: layers.org === undefined ? {} : { "claude.plugins": layers.org },
        teams: { widgets: layers.team === undefined ? {} : { "claude.plugins": layers.team } },
      });
      if (layers.user !== undefined) writeUser({ "claude.plugins": layers.user });
    }

    test("every layer's list adds up, weakest first, without duplicates", () => {
      seed({ org: ["acme-tools@acme", "shared@acme"], team: ["widgets@acme", "shared@acme"], user: ["mine@elsewhere"] });
      const got = getSetting<string[]>("claude.plugins");
      expect(got.value).toEqual(["acme-tools@acme", "shared@acme", "widgets@acme", "mine@elsewhere"]);
      expect(got.provenance.map((p) => p.scope)).toEqual(["org", "team", "user"]);
    });

    test("each item names every layer it came from", () => {
      seed({ org: ["shared@acme"], team: ["widgets@acme"], user: ["shared@acme"] });
      const items = getSetting<string[]>("claude.plugins").items!;
      expect(items.map((i) => [i.value, i.sources.map((s) => s.scope)])).toEqual([
        ["shared@acme", ["org", "user"]],
        ["widgets@acme", ["team"]],
      ]);
    });

    test("a layer that holds a non-array is skipped as invalid and the others still add", () => {
      seed({ org: ["shared@acme"], team: "widgets@acme", user: ["mine@elsewhere"] });
      const got = getSetting<string[]>("claude.plugins");
      expect(got.value).toEqual(["shared@acme", "mine@elsewhere"]);
      expect(warnSpy.mock.calls.some(([msg]) => String(msg).includes('ignoring "claude.plugins" from the team scope'))).toBe(true);
    });

    test("an empty list everywhere resolves to [] and names the strongest layer", () => {
      seed({ org: [], user: [] });
      const got = getSetting<string[]>("claude.plugins");
      expect(got.value).toEqual([]);
      expect(got.provenance.map((p) => p.scope)).toEqual(["user"]);
      expect(got.items).toEqual([]);
    });

    test("nothing set anywhere resolves to undefined with no items", () => {
      const got = getSetting<string[]>("claude.plugins");
      expect(got.value).toBeUndefined();
      expect(got.items).toBeUndefined();
    });

    test("a replace key carries no items", () => {
      writeOrg({ "board.title": "Acme" });
      expect(getSetting<string>("board.title").items).toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/resolve.test.ts -t "add merge"`
Expected: FAIL (the user's list replaces the others today).

- [ ] **Step 3: Implement the merge**

In `resolve.ts`, add the type beside `Provenance` and the field on `Resolved` and `ListedSetting` (`items?: ItemSource[]`) and on the private `Resolution` (`items?: ItemSource[]`).

In `mergeApplied`, change the return type to `{ value: unknown; provenance: Provenance[]; items?: ItemSource[] }` and add this branch before the final `winner` lines:

```ts
  if (def.merge === "add" && def.type === "array") {
    const lists = applied.filter((layer) => Array.isArray(layer.value));
    if (lists.length > 0) {
      const items: ItemSource[] = [];
      const byId = new Map<string, ItemSource>();
      const contributors: Provenance[] = [];
      for (const layer of lists) {
        const source: Provenance = { scope: layer.scope, file: layer.file };
        const seenHere = new Set<string>();
        for (const value of layer.value as unknown[]) {
          const id = JSON.stringify(value);
          if (seenHere.has(id)) continue;
          seenHere.add(id);
          let item = byId.get(id);
          if (!item) {
            item = { value, sources: [] };
            byId.set(id, item);
            items.push(item);
          }
          item.sources.push(source);
        }
        if (seenHere.size > 0) contributors.push(source);
      }
      const strongest = lists[lists.length - 1] as (typeof applied)[number];
      return {
        value: items.map((item) => item.value),
        provenance: contributors.length > 0 ? contributors : [{ scope: strongest.scope, file: strongest.file }],
        items,
      };
    }
  }
```

In `resolveDef`, pass `items` through:

```ts
  return { value: merged.value, provenance: merged.provenance, invalid, rows, mergedIssues, ...(merged.items ? { items: merged.items } : {}) };
```

In `getSetting`:

```ts
  return { value: value as T, provenance: resolution.provenance, ...(resolution.items ? { items: resolution.items } : {}) };
```

In `listSettings`, after `if (resolution.invalid.length > 0) ...`:

```ts
    if (resolution.items) listed.items = resolution.items;
```

Items are not variable-expanded: both `add` keys hold plugin ids and marketplace sources, and a consumer that needs the expanded form reads `value`.

Export the type from `index.ts` on the resolve type-export line: add `ItemSource`.

- [ ] **Step 4: Switch the two keys**

In `registry-defs.ts`, set `merge: "add"` on `claude.marketplaces` and `claude.plugins`, and reword their descriptions:

```ts
    description: "Claude Code plugin marketplaces to add, in order. The org's, the team's and your own lists add up.",
```

```ts
    description: "Claude Code plugins to install, in order. The org's, the team's and your own lists add up; a plugin from the org or a team is installed but left for you to enable.",
```

`registry.test.ts` has a test named "claude.marketplaces and claude.plugins are user+team arrays with replace merge" (near line 448). Rename it to "... add up across layers" and change its `expect(def.merge).toBe("replace")` to `"add"`.

- [ ] **Step 5: Run the resolver tests**

Run: `bun test packages/rt-client/src/settings`
Expected: PASS.

- [ ] **Step 6: Write the failing trust-split test**

In `lib/setup/__tests__/steps-c.test.ts`, inside `describe("plugins.install", ...)`, add this nested describe. `computePlugins` reads settings through the real resolver, so the block points HOME at its own scratch dir; `makeCtx` is the file's existing context builder:

```ts
    describe("trust split per item", () => {
      const origHome = process.env.HOME;
      let home: string;
      let ctx: ApplyContext;
      beforeEach(() => {
        home = realpathSync(mkdtempSync(join(tmpdir(), "rt-plugins-trust-")));
        process.env.HOME = home;
        ctx = makeCtx(fakeProbes({ home })).ctx;
      });
      afterEach(() => {
        process.env.HOME = origHome;
        rmSync(home, { recursive: true, force: true });
      });

      test("a plugin only the org or a team lists is installed and never enabled; one you list yourself is enabled", async () => {
        seedOrg({
          org: "acme",
          username: "dev1",
          roster: [{ username: "dev1", teams: ["widgets"] }],
          settings: { "claude.plugins": ["org-tool@acme", "both@acme"] },
          teams: { widgets: { "claude.plugins": ["team-tool@acme"] } },
        });
        setSetting("claude.plugins", ["mine@elsewhere", "both@acme"], "user");

        const { trusted, teamAuthored } = computePlugins(ctx, null);

        expect(trusted).toEqual(expect.arrayContaining(["mine@elsewhere", "both@acme"]));
        expect(teamAuthored).toEqual(["org-tool@acme", "team-tool@acme"]);
        expect(trusted).not.toContain("org-tool@acme");
      });
    });
```

Export `computePlugins` from `lib/setup/steps/plugins.ts` for this test (add `export` to its declaration).

- [ ] **Step 7: Run to see it fail**

Run: `bun test lib/setup/__tests__ -t "trust split per item"`
Expected: FAIL (`computePlugins` is not exported, then the split is all-or-nothing).

- [ ] **Step 8: Split per item in `plugins.ts`**

Replace `isTeamAuthored` and the head of `computePlugins` (import `isSharedScope` and `type Provenance` from `../../settings/resolve.ts`):

```ts
/** An item is the org's or a team's only when no layer of your own lists it too. */
function sharedOnly(sources: Provenance[]): boolean {
  return sources.length > 0 && sources.every((s) => isSharedScope(s.scope));
}

export function computePlugins(ctx: ApplyContext, teamMarketplace: TeamMarketplaceFile | null): ComputedPlugins {
  const items = getSetting<unknown>("claude.plugins").items ?? [];
  const named = items.filter((item): item is typeof item & { value: string } => typeof item.value === "string");
  if (named.length !== items.length) {
    const dropped = items.length - named.length;
    ctx.log("plugins.install", `claude.plugins: dropped ${dropped} non-string entr${dropped === 1 ? "y" : "ies"}`);
  }
  const own = named.filter((item) => !sharedOnly(item.sources)).map((item) => item.value);
  const shared = named.filter((item) => sharedOnly(item.sources)).map((item) => item.value);
```

and its tail:

```ts
  const trusted = dedupe([...own, ...BASE_PLUGINS]);
  const teamAuthored = dedupe([...shared, ...teamPlugins]).filter((p) => !trusted.includes(p));
  return { trusted, teamAuthored };
}
```

The `marketplaceName` and `teamPlugins` lines in the middle stay. Update `ComputedPlugins`' two field comments: `trusted` is "rt's own baseline, plus anything one of your own layers lists"; `teamAuthored` is "listed only by the org or a team, or served by the org's marketplace".

- [ ] **Step 9: Run the setup tests**

Run: `bun test lib/setup`
Expected: PASS. A test that seeded `claude.plugins` in the shared store and expected the whole list to be team-authored still passes; one that seeded both a user list and a shared list and expected the user list to replace the shared one now sees both, so update its expectation to the union.

- [ ] **Step 10: Document the mode**

In `docs/settings-architecture.md`, in the section that describes `replace` and `deep`, add:

```markdown
- `add` (arrays only): every layer's list is concatenated weakest first, user
  and machine layers included, and duplicates are dropped. Nothing subtracts
  an inherited item. `getSetting` also returns `items`: each item with every
  layer that lists it, which is how setup tells a plugin you chose from one
  only the org or a team listed. `claude.plugins` and `claude.marketplaces`
  use it; another list opts in by setting `merge: "add"` on its registry row.
```

- [ ] **Step 11: Commit**

```bash
(cd packages/rt-client && bun run build)
bunx tsc --noEmit
git add packages/rt-client/src/settings/resolve.ts packages/rt-client/src/settings/registry-defs.ts packages/rt-client/src/index.ts packages/rt-client/src/settings/__tests__/resolve.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts lib/setup/steps/plugins.ts docs/settings-architecture.md
git add $(git diff --name-only -- 'lib/setup/__tests__/*.test.ts')
git commit -m "settings: add merge for list keys, with per-item provenance for the plugin trust split"
```

### Task 7: `rt settings` takes the org scope

**Files:**
- Modify: `commands/settings-keys.ts` (`VALID_SCOPES`, `requireScope`, `whereText`, the usage strings)
- Modify: `lib/command-tree-def.ts` (the `Scope` and `Team` args of `settings set` and `settings unset`, near lines 1833 and 1845)
- Test: `commands/__tests__/settings-set.test.ts`, `commands/__tests__/settings-json-frozen.test.ts`

**Interfaces:**
- Consumes: Task 5 `setSetting(key, value, "org")`.
- Produces: `rt settings set <key> <value> --scope user|org|team|machine [--team <name>] [--repo <name>]`; `--team` is a team folder name and is accepted only with `--scope team`.

- [ ] **Step 1: Write the failing tests**

Add to `commands/__tests__/settings-set.test.ts`, inside its `describe` (it already repoints HOME, captures output in `cap`, and turns `process.exit` into a thrown `__exit_<code>`). Add `seedOrg` (from `../../packages/rt-client/test/org-fixture.ts`), `orgSettingsPath` and `teamSettingsPath` (from `../../lib/rt-paths.ts`) and `readStore` (from `../../lib/settings/stores.ts`) to the imports:

```ts
  describe("org and team scopes", () => {
    beforeEach(() => {
      seedOrg({ org: "acme", username: "dev1", roster: [{ username: "dev1", teams: ["widgets"] }], teams: { widgets: {}, gadgets: {} } });
    });

    test("set --scope org writes the org store", async () => {
      await settingsSet(["board.gitlabHost", '"gitlab.example.com"', "--scope", "org"]);
      expect(readStore(orgSettingsPath("acme")).global["board.gitlabHost"]).toBe("gitlab.example.com");
      expect(cap.stdout()).toStartWith("[ok] Saved board.gitlabHost  the org's settings\n");
    });

    test("set --scope team writes your own team's store", async () => {
      await settingsSet(["board.title", '"Widgets"', "--scope", "team"]);
      expect(readStore(teamSettingsPath("acme", "widgets")).global["board.title"]).toBe("Widgets");
      expect(cap.stdout()).toStartWith("[ok] Saved board.title  your team's settings\n");
    });

    test("set --scope team --team gadgets writes that team folder", async () => {
      await settingsSet(["board.title", '"Gadgets"', "--scope", "team", "--team", "gadgets"]);
      expect(readStore(teamSettingsPath("acme", "gadgets")).global["board.title"]).toBe("Gadgets");
      expect(cap.stdout()).toStartWith("[ok] Saved board.title  the gadgets team's settings\n");
    });

    test("a team name with the org scope is refused", async () => {
      await expect(settingsSet(["board.gitlabHost", '"x"', "--scope", "org", "--team", "widgets"])).rejects.toThrow("__exit_1");
      expect(cap.stderr()).toStartWith("A team name only goes with the team scope");
      expect(cap.stderr()).toContain("why: You asked for the org scope.");
    });

    test("an unknown scope names the four scopes", async () => {
      await expect(settingsSet(["board.title", '"x"', "--scope", "everyone"])).rejects.toThrow("__exit_1");
      expect(cap.stderr()).toContain("why: The scopes are user, org, team and machine.");
    });
  });
```

The existing test "a missing scope names the three scopes and the command to type" changes with the copy: rename it to "names the four scopes", and its expected stderr becomes
`"Say which settings to write\n  why: A value lives in exactly one of your user, org, team or machine settings.\n  next: rt settings set <key> <value> --scope user|org|team|machine\n"`.

- [ ] **Step 2: Run to see them fail**

Run: `bun test commands/__tests__/settings-set.test.ts`
Expected: FAIL (`org is not a scope`).

- [ ] **Step 3: Implement**

In `commands/settings-keys.ts`:

```ts
const VALID_SCOPES: SettingScope[] = ["user", "org", "team", "machine"];
```

In `requireScope`, the missing-scope `why` becomes `"A value lives in exactly one of your user, org, team or machine settings."` and the unknown-scope `why` becomes `"The scopes are user, org, team and machine."`.

```ts
const SET_USAGE = "rt settings set <key> <value> --scope user|org|team|machine";
const UNSET_USAGE = "rt settings unset <key> --scope user|org|team|machine";
```

Replace `whereText`:

```ts
function whereText(scope: SettingScope, team: string | undefined, repoName: string | undefined): string {
  const store =
    scope === "user" ? "your user settings"
    : scope === "machine" ? "this Mac's settings"
    : scope === "org" ? "the org's settings"
    : team ? `the ${team} team's settings` : "your team's settings";
  return repoName ? `${store} for ${repoName}` : store;
}
```

Update the file's header comment line to `rt settings set <key> <json-value> --scope user|org|team|machine [--repo <name>] [--team <name>]`.

In `lib/command-tree-def.ts`, in both `Scope` args, add the `org` option before `team` and reword `team`:

```ts
{ value: "org", label: "org", hint: "shared by every team in your org" }, { value: "team", label: "team", hint: "your team's own settings" },
```

and both `Team` args become:

```ts
{ name: "Team", flag: "--team", type: "text", placeholder: "widgets", hint: "A team's name, for --scope team; your own team when left out" },
```

- [ ] **Step 4: Update the frozen JSON snapshots on purpose**

Run: `bun test commands/__tests__/settings-json-frozen.test.ts commands/__tests__/settings-explain.test.ts`

`rt settings explain --json` and `rt settings list --json` now carry an `org` rung (and `org.repo` with `--repo`). This is a deliberate contract change (spec section 3: `explainSetting` names the org layer and the team layer separately). Read each failing diff, confirm the only changes are the added `org` rows and `team` rows whose `file` is now a team folder's store or `null`, then update the frozen expectations by hand. Name the change in the PR body.

- [ ] **Step 5: Run, regenerate docs, commit**

The reworded `--scope` and `--team` hints name fewer store files, so `lib/__tests__/no-settings-bypass.test.ts` reports a new count for `lib/command-tree-def.ts` (6 today, 4 if the hints read as above): set the allowlist entry to the count the failure prints.

```bash
bun test commands/__tests__
bun run docs:gen
git status --short
git add commands/settings-keys.ts lib/command-tree-def.ts lib/__tests__/no-settings-bypass.test.ts commands/__tests__/settings-set.test.ts commands/__tests__/settings-json-frozen.test.ts commands/__tests__/settings-explain.test.ts
git add $(git diff --name-only -- docs)
git commit -m "rt settings: the org scope, and --team names a team folder"
```

### Task 8: settings-kit and the console name the org layer

**Files:**
- Modify: `packages/settings-kit/src/server.ts` (`RtSettingsApi`, the `/defs` reply, `effectiveFromRows`)
- Modify: `apps/console/src/app/settings/useConsoleSettings.ts`, `view.ts`, `SettingsSection.tsx`, `SettingsPage.tsx`, `ExplainModal.tsx`
- Modify: `apps/board/src/client/board/config-shapes.ts` (`SCOPE_ORDER`), `apps/board/src/config.ts` (the roster write near line 992)
- Test: `packages/settings-kit/src/__tests__/server.test.ts`, `apps/console/src/app/settings/view.test.ts`, `apps/console/src/server/settings-kit-mount.test.ts`, `apps/board/src/__tests__/config-store-latch.test.ts`

**Interfaces:**
- Consumes: Task 4 `activeTeam`, `listOrgs`; Task 6 `merge: "add"`.
- Produces: `GET {base}/defs` answers `{ defs, unregistered, org: string | null, activeTeam: string | null }` (the `team` field is gone). `POST /set`, `/unset`, `/prune` accept `scope: "org"`, and their `team` body field names a team folder.

- [ ] **Step 1: Write the failing server tests**

`packages/settings-kit/src/__tests__/server.test.ts` builds requests with its own `get(path)` and `post(path, body)` helpers and runs them through `handle(req, { rt: {...} })`, which overlays the file's fake `RT` object; `setCalls` records what reached `setSetting`. Replace the "defs names the machine's one team, and null with none or several" test with:

```ts
  test("defs names the org and the active team, and nulls with no org", async () => {
    const active = { org: "acme", team: "widgets", reason: "first-team" as const, username: "dev1", listedOn: ["widgets"] };
    const one = await handle(get("/api/settings/defs"), { rt: { listOrgs: () => ["acme"], activeTeam: () => active } });
    const body = (await one!.json()) as Record<string, unknown>;
    expect(body.org).toBe("acme");
    expect(body.activeTeam).toBe("widgets");
    expect("team" in body).toBe(false);

    const none = await handle(get("/api/settings/defs"), {
      rt: { listOrgs: () => [], activeTeam: () => ({ org: null, team: null, reason: "no-org" as const, username: null, listedOn: [] }) },
    });
    expect(await none!.json()).toMatchObject({ org: null, activeTeam: null });
  });
```

Add `listOrgs: () => []` and `activeTeam: () => ({ org: null, team: null, reason: "no-org", username: null, listedOn: [] })` to the file's `RT` object (in place of `listTeams`), give `board.slack` in `DEFS` the scopes `["team", "org"]`, and add:

```ts
  test("an add key's effective value is every live layer's list, weakest first, without duplicates", () => {
    const def = { key: "claude.plugins", type: "array", scopes: ["user", "team", "org"], merge: "add", description: "" } as never;
    const rows = [
      { scope: "default", file: null, present: false },
      { scope: "org", file: "/o", present: true, value: ["a@acme", "b@acme"] },
      { scope: "team", file: "/t", present: true, value: ["b@acme", "c@acme"] },
      { scope: "user", file: "/u", present: true, value: ["d@x"] },
    ] as never;
    expect(effectiveFromRows(def, rows)).toEqual({ scope: "user", file: "/u", value: ["a@acme", "b@acme", "c@acme", "d@x"] });
  });

  test("a set at org scope reaches setSetting with the org scope and no team", async () => {
    const res = await handle(post("/api/settings/set", { key: "board.slack", scope: "org", value: { webhookUrl: "https://hooks.example.com/x" } }), { allowComposite: true });
    expect(res!.status).toBe(200);
    expect(setCalls.at(-1)).toEqual(["board.slack", { webhookUrl: "https://hooks.example.com/x" }, "org", {}]);
  });
```

The first fails today because the reply has `team` and no `org`; the second because `effectiveFromRows` takes the strongest layer for an array. The third is a pin, not a red test: it passes as soon as the fixture lists `org`, and it holds the handler to handing `org` through with no team name.

- [ ] **Step 2: Run to see them fail**

Run: `bun test packages/settings-kit/src/__tests__/server.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the server changes**

In `server.ts`:

- Import `activeTeam` and `listOrgs` from `@mattstack/rt-client` where `listTeams` was imported.
- In `RtSettingsApi`, replace `listTeams: typeof listTeams;` with:

```ts
  listOrgs: typeof listOrgs;
  activeTeam: typeof activeTeam;
```

and in the default object inside `settingsHandler` replace `listTeams,` with `listOrgs, activeTeam,`.

- Replace the end of the `/defs` branch:

```ts
    const active = rt.activeTeam();
    return json({ defs, unregistered: rt.listUnregisteredSettings(), org: active.org, activeTeam: active.team });
```

- In `effectiveFromRows`, add a branch between the deep-merge branch and the final `else if`:

```ts
  } else if (def.merge === "add" && def.type === "array") {
    const merged: unknown[] = [];
    const seen = new Set<string>();
    for (const r of live) {
      if (r.invalid || !Array.isArray(r.value)) continue;
      for (const item of r.value) {
        const id = JSON.stringify(item);
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(item);
      }
    }
    if (!top.invalid) wire.value = merged;
  } else if (!top.invalid && "value" in top) {
```

- Update the doc comment above `settingsHandler`: the `/defs` line reads `→ { defs: SettingDefWire[], unregistered, org, activeTeam }`.

The `/set`, `/unset` and `/prune` branches need no change: they pass `scope` and `team` straight to rt-client, which now accepts `org` and reads `team` as a folder name.

- [ ] **Step 4: Run the kit's tests and rebuild it**

```bash
bun test packages/settings-kit
(cd packages/settings-kit && bun run build)
```

Expected: PASS.

- [ ] **Step 5: Write the failing console view tests**

Add to `apps/console/src/app/settings/view.test.ts`:

```ts
describe('org layer', () => {
  it('names the org and the team stores apart', () => {
    expect(scopeLabel('org', 'widgets', 'acme')).toBe('org (acme)');
    expect(scopeLabel('team', 'widgets', 'acme')).toBe('team (widgets)');
    expect(scopeLabel('team', null, 'acme')).toBe('team');
    expect(scopeLabel('org', null, null)).toBe('org');
  });

  it('treats org and org.repo as a store and its repo section', () => {
    expect(isStoreScope('org')).toBe(true);
    expect(isRung('org.repo')).toBe(true);
    expect(rungBase('org.repo')).toBe('org');
    expect(layerLabel('org.repo', 'widgets', 'acme')).toBe('org (acme) · repo');
  });
});
```

Run: `(cd apps/console && bunx vitest run src/app/settings/view.test.ts)`
Expected: FAIL.

- [ ] **Step 6: Implement the console changes**

`view.ts`:

```ts
export type StoreScope = 'org' | 'team' | 'user' | 'machine';
```

```ts
const SUB_ORDER: StoreScope[] = ['org', 'team', 'user', 'machine'];
```

```ts
export function isStoreScope(s: string | null | undefined): s is StoreScope {
  return s === 'org' || s === 'team' || s === 'user' || s === 'machine';
}

export type RungScope = 'org.repo' | 'team.repo' | 'user.repo' | 'machine.repo';
```

```ts
export function isRung(s: string | null | undefined): s is RungScope {
  return (
    s === 'org.repo' ||
    s === 'team.repo' ||
    s === 'user.repo' ||
    s === 'machine.repo'
  );
}
```

```ts
export function layerLabel(
  scope: LayerScope,
  team: string | null = null,
  org: string | null = null
): string {
  const base = scopeLabel(rungBase(scope)!, team, org);
  return isRung(scope) ? `${base} · repo` : base;
}

/** A shared store's name carries whose it is, so an edit says where it goes. */
export function scopeLabel(
  scope: StoreScope,
  team: string | null,
  org: string | null = null
): string {
  if (scope === 'org' && org) return `org (${org})`;
  if (scope === 'team' && team) return `team (${team})`;
  return scope;
}
```

The function near line 139 that builds a move or write target label takes the same optional `org` third argument and passes it to `scopeLabel`.

`useConsoleSettings.ts`: the store keeps `team: string | null` (now the active team) and gains `org: string | null`. Where it parses the defs body:

```ts
        setTeam(typeof body.activeTeam === 'string' ? body.activeTeam : null);
        setOrg(typeof body.org === 'string' ? body.org : null);
```

with `const [org, setOrg] = useState<string | null>(null);`, the body type's `team?: string | null` replaced by `org?: string | null; activeTeam?: string | null`, `org` added to the returned object and to its `useMemo` dependency list, and a second context beside `SettingsTeamContext`:

```ts
/** The machine's org, as the defs response names it, or null. */
export const SettingsOrgContext = createContext<string | null>(null);

export function useSettingsOrg(): string | null {
  return useContext(SettingsOrgContext);
}
```

Update the comment on `SettingsTeamContext` to "The team this Mac reads settings as, or null."

`SettingsPage.tsx` and `ExplainModal.tsx`: wrap the existing `SettingsTeamContext.Provider` in `<SettingsOrgContext.Provider value={store.org}>`, and add `'org'` to `SCOPES`:

```ts
const SCOPES = ['user', 'org', 'team', 'machine'] as const;
```

`SettingsSection.tsx`: add the org entry to `SUBHEAD` and name the team in the note:

```ts
  org: {
    label: 'Org',
    note: 'shared with every team through the org repo',
    color: 'var(--tk-text-purple-small)',
  },
  team: {
    label: 'Team',
    note: 'shared with your team through the org repo',
    color: 'var(--tk-text-purple-small)',
  },
```

```ts
function subheadNote(
  scope: StoreScope,
  team: string | null,
  org: string | null
): string {
  if (scope === 'org' && org)
    return `shared with every team through the ${org} org repo`;
  if (scope === 'team' && team)
    return `shared with the ${team} team through the org repo`;
  return SUBHEAD[scope].note;
}
```

Read `org` with `useSettingsOrg()` where the component reads the team, and pass both to `subheadNote`, `scopeLabel` and `layerLabel` at every call site `bun run console:typecheck` flags.

Run: `bun run console:typecheck && bun run console:test`
Expected: PASS after updating test fixtures that built a defs body with `team:` (they send `org` and `activeTeam` now).

- [ ] **Step 7: The board groups org keys and writes the roster to the org**

In `apps/board/src/client/board/config-shapes.ts`:

```ts
const SCOPE_ORDER = ['org', 'team', 'user', 'machine'] as const;
```

In `apps/board/src/config.ts`, the roster writer (`saveRosterMembers`, near line 992) writes the owning roster key at the scope that key allows:

```ts
    write(owner.key, value, owner.key === 'mattstack.roster' ? 'org' : 'team');
```

`apps/board/src/__tests__/config-store-latch.test.ts` holds the roster-write tests and their helpers (a temp `config.json` path and `fakeResolve`). Its assertion near line 527 expects the roster write at scope `'team'`; it now expects `'org'`:

```ts
    expect(calls).toEqual([
      { key: 'mattstack.roster', value: next, scope: 'org' },
    ]);
```

The same file's "a write to mattstack.roster strips hidden" test asserts the scope the same way; it becomes `'org'` too. `fakeWrite` there runs `validateWrite` with the scope, so a `'team'` write of the roster now fails the test by itself.

Run: `bun run board:typecheck && bun run board:test`
Expected: PASS.

- [ ] **Step 8: Look at it in the browser, both schemes**

Seed a scratch HOME and serve the console from this worktree:

```bash
export RT_SCRATCH_HOME="$(mktemp -d)"
HOME="$RT_SCRATCH_HOME" bun -e '
import { seedOrg } from "./packages/rt-client/test/org-fixture.ts";
seedOrg({ org: "acme", username: "dev1",
  roster: [{ username: "dev1", teams: ["widgets"] }, { username: "dev2", teams: ["gadgets"] }],
  roles: { admins: ["dev1"], teams: { widgets: { owners: ["dev1"] }, gadgets: { owners: ["dev2"] } } },
  settings: { "board.gitlabHost": "gitlab.example.com", "claude.plugins": ["acme-tools@acme"] },
  teams: { widgets: { "board.title": "Widgets", "claude.plugins": ["widgets@acme"] }, gadgets: { "board.title": "Gadgets" } } });
'
(cd apps/console && bun run build && HOME="$RT_SCRATCH_HOME" PORT=11991 bun run serve)
```

(If the console server reads its port from a different variable, `apps/console/src/server/index.ts` names it; use that.) With the `fast-browser:fast-browsing` skill, open `http://localhost:11991/settings` and screenshot the page in the light and the dark scheme. Check, and say plainly what is wrong if anything is:

- `board.gitlabHost` sits under an "Org" subhead whose note reads "shared with every team through the acme org repo".
- `board.title` sits under "Team", shows `Widgets`, and its "Where it's set" panel lists `org (acme)` (not set) and `team (widgets)` (set) as separate layers.
- `claude.plugins` shows both `acme-tools@acme` and `widgets@acme` as its value.
- `mattstack.roster` and `mattstack.org` appear under "Org".
- The scope filter offers `org`.

Stop the server and remove `$RT_SCRATCH_HOME` when done.

- [ ] **Step 9: Commit**

```bash
git add packages/settings-kit/src/server.ts packages/settings-kit/src/__tests__/server.test.ts apps/console/src/app/settings apps/console/src/server/settings-kit-mount.test.ts apps/board/src/client/board/config-shapes.ts apps/board/src/config.ts apps/board/src/__tests__/config-store-latch.test.ts
git commit -m "settings-kit, console and board: name the org layer apart from the team layer"
```

Stage `apps/console/src/app/settings` only after `git status --short apps/console` shows nothing there but your edits.

### Task 9: Rename the clone-level names to org

Mechanical. No behavior change.

**Files:**
- Modify: `lib/setup/team-settings.ts` (`discoverTeams` becomes `discoverOrgs`), `lib/setup/contract.ts` (`TeamRef` becomes `OrgRef`), `lib/setup/intent.ts` (`teamRefFromIntent` becomes `orgRefFromIntent`), `lib/setup/plan.ts` (`PlanInputs.teams` becomes `orgs`), and every importer.

**Interfaces:**
- Produces: `discoverOrgs(p: Probes): string[]`, `interface OrgRef { slug: string; name: string; mode: TeamMode }`, `orgRefFromIntent(intent, orgs): OrgRef`, `PlanInputs.orgs: string[]`. The plan JSON keeps its `team` key and `ApplyContext.team` keeps its name: both are the app's wire contract (`PlanModels.swift` decodes `team`).

- [ ] **Step 1: Rename with word boundaries**

```bash
rg -l '\bdiscoverTeams\b' lib commands | xargs perl -pi -e 's/\bdiscoverTeams\b/discoverOrgs/g'
rg -l '\bTeamRef\b' lib commands | xargs perl -pi -e 's/\bTeamRef\b/OrgRef/g'
rg -l '\bteamRefFromIntent\b' lib commands | xargs perl -pi -e 's/\bteamRefFromIntent\b/orgRefFromIntent/g'
```

In `lib/setup/plan.ts`, rename the `teams` field of `PlanInputs` to `orgs` (and its comment to "Discovered org slugs"), then fix each caller `bunx tsc --noEmit` reports: `teams: listOrgs()` becomes `orgs: listOrgs()`, and `commands/verify.ts`'s `teams: listOrgs` dep becomes `orgs: listOrgs`.

In `lib/setup/team-settings.ts`, reword `discoverOrgs`' doc comment: "Every org clone's slug: subdirectories of `<home>/.mattstack/teams` that hold `mattstack/org/settings.org.jsonc`." Keep the sentence about `Probes` and the ambient HOME.

The switchboard seams change together (`AGENTS.md`, "Switchboard and `rt team join`"). Three of them (`lib/team/join.ts`, `lib/setup/validators/accounts.ts`, `lib/setup/validators/access.ts`) read the switchboard URL through `readTeamSnapshot`, which resolves `mattstack.integrations`, so after Task 5 that value comes from the org layer with no change to those files. The fourth, `lib/team/board-token.ts`, reads the store by path, and Task 5 already moved that read to the org store. Their tests in the run below are the check: a peering row that reports "no switchboard" for an org that declares one means one of the four still reads the old path.

- [ ] **Step 2: Verify nothing else moved**

```bash
bunx tsc --noEmit
bun run test
rg -n '\b(discoverTeams|TeamRef|teamRefFromIntent|listTeams)\b' lib commands packages apps --glob '!**/dist/**'
```

Expected: tsc and tests green; the `rg` prints nothing.

- [ ] **Step 3: Commit**

```bash
git add $(git diff --name-only)
git commit -m "setup: rename the clone-level team names to org (discoverOrgs, OrgRef)"
```

Check `git diff --name-only` lists only files the three `perl` commands and the `plan.ts` edit touched before running the `git add`.

### Task 10: `rt team create` scaffolds the new layout

Layout only. The creator's role, roster entry and stored username arrive in Task 25.

**Files:**
- Modify: `lib/team/create.ts` (`scaffoldFiles`, `createTeam`, `CreateTeamResult`)
- Modify: `lib/team/join.ts` (the `assertNotRealStoreInTest` path near line 532)
- Modify: `rt-tray/vm/run/host/team-rebase.sh` (the settings path near lines 159 to 162)
- Test: `lib/team/__tests__/create.test.ts`

**Interfaces:**
- Produces:

```ts
export function defaultTeamName(orgSlug: string): string; // the slug when it is a team name, else `team-<slug>`
export function scaffoldFiles(slug: string, name: string, remote: string, recipients?: string[], team?: string): Record<string, string>;
export interface CreateTeamResult { slug: string; team: string; name: string; remote: string; dir: string; created: boolean; gitDeferred?: true }
```

- [ ] **Step 1: Write the failing tests**

In `lib/team/__tests__/create.test.ts`, replace the `scaffoldFiles` describe's body with:

```ts
describe("scaffoldFiles", () => {
  const ORG_SETTINGS = "mattstack/org/settings.org.jsonc";
  const TEAM_SETTINGS = "mattstack/teams/acme/settings.team.jsonc";

  test("writes the org layout: marker, org store, one team folder, marketplace, sops rule", () => {
    const files = scaffoldFiles("acme", "Acme", "https://gitlab.example.com/g/acme.git");
    expect(Object.keys(files).sort()).toEqual([".claude-plugin/marketplace.json", ".gitignore", ".sops.yaml", "mattstack/mattstack.jsonc", ORG_SETTINGS, TEAM_SETTINGS].sort());
    expect(JSON.parse(files["mattstack/mattstack.jsonc"]!)).toEqual({ role: "org", org: "acme" });
  });

  test("gitlab remote: the org store holds the forge and board.gitlabHost", () => {
    const org = parseSettingsBody(scaffoldFiles("acme", "Acme", "https://gitlab.example.com/g/acme.git")[ORG_SETTINGS]!);
    expect(org["mattstack.integrations"]).toEqual({ forge: { host: "gitlab.example.com", provider: "gitlab" } });
    expect(org["board.gitlabHost"]).toBe("gitlab.example.com");
  });

  test("github remote: no board.gitlabHost key at all", () => {
    const org = parseSettingsBody(scaffoldFiles("acme", "Acme", "https://github.com/acme/mattstack-team-acme.git")[ORG_SETTINGS]!);
    expect("board.gitlabHost" in org).toBe(false);
  });

  test("the display name is the first team's board title", () => {
    const team = parseSettingsBody(scaffoldFiles("acme", "Acme", "https://github.com/acme/repo.git")[TEAM_SETTINGS]!);
    expect(team).toEqual({ "board.title": "Acme" });
  });

  test("board.projects is never written: a present value would claim repos nobody chose", () => {
    const files = scaffoldFiles("acme", "Acme", "https://github.com/acme/repo.git");
    expect("board.projects" in parseSettingsBody(files[ORG_SETTINGS]!)).toBe(false);
    expect("board.projects" in parseSettingsBody(files[TEAM_SETTINGS]!)).toBe(false);
  });

  test("a named first team gets its own folder", () => {
    const files = scaffoldFiles("acme", "Acme", "https://github.com/acme/repo.git", [], "widgets");
    expect(files["mattstack/teams/widgets/settings.team.jsonc"]).toBeDefined();
    expect(files[TEAM_SETTINGS]).toBeUndefined();
  });

  test("seeds .sops.yaml with the given recipients, not empty", () => {
    const files = scaffoldFiles("acme", "Acme", "https://github.com/acme/repo.git", [FAKE_PUBLIC_KEY]);
    expect(files[".sops.yaml"]).toContain(FAKE_PUBLIC_KEY);
  });
});

describe("defaultTeamName", () => {
  test("the org slug when it is a team name", () => {
    expect(defaultTeamName("acme")).toBe("acme");
    expect(defaultTeamName("acme-labs")).toBe("acme-labs");
  });
  test("a slug that starts with a digit gets a team- prefix", () => {
    expect(defaultTeamName("3d-tools")).toBe("team-3d-tools");
  });
});
```

Keep `parseSettingsBody` and `FAKE_PUBLIC_KEY` as the file defines them. In the `createTeam` describes, every path assertion on `mattstack/settings.team.jsonc` becomes `mattstack/org/settings.org.jsonc`, and add to the first happy-path test: `expect(result.team).toBe("acme");`.

- [ ] **Step 2: Run to see them fail**

Run: `bun test lib/team/__tests__/create.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the scaffold**

In `lib/team/create.ts`, import `TEAM_NAME_RE` from `../settings/stores.ts` and replace `scaffoldFiles` and its header constant:

```ts
const ORG_SETTINGS_HEADER = "// mattstack org settings, shared by every team. Created by `rt team create`. JSONC: comments and trailing commas are fine.\n";
const TEAM_SETTINGS_HEADER = "// mattstack team settings. Created by `rt team create`. JSONC: comments and trailing commas are fine.\n";

/** The first team is named after the org unless that is not a folder name a team may have. */
export function defaultTeamName(orgSlug: string): string {
  return TEAM_NAME_RE.test(orgSlug) ? orgSlug : `team-${orgSlug}`;
}

/**
 * The scaffold's tracked files, keyed by path relative to the clone root.
 * `recipients` seeds `.sops.yaml` at creation so a fresh org never passes
 * through a zero-recipient state.
 *
 * `board.projects` is deliberately not written: a present value claims repos
 * for the team's pack and flips the board's store-ownership latch.
 */
export function scaffoldFiles(slug: string, name: string, remote: string, recipients: string[] = [], team: string = defaultTeamName(slug)): Record<string, string> {
  const forge = forgeFromRemote(remote);

  const orgSettings: Record<string, unknown> = { "mattstack.integrations": { forge } };
  if (forge?.provider === "gitlab") orgSettings["board.gitlabHost"] = forge.host;
  const teamSettings = { "board.title": name };
  const marketplace = { name: slug, owner: { name }, plugins: [] };

  return {
    [SCAFFOLD_MARKER]: `${JSON.stringify({ role: "org", org: slug }, null, 2)}\n`,
    "mattstack/org/settings.org.jsonc": `${ORG_SETTINGS_HEADER}${JSON.stringify(orgSettings, null, 2)}\n`,
    [`mattstack/teams/${team}/settings.team.jsonc`]: `${TEAM_SETTINGS_HEADER}${JSON.stringify(teamSettings, null, 2)}\n`,
    ".claude-plugin/marketplace.json": `${JSON.stringify(marketplace, null, 2)}\n`,
    ".sops.yaml": renderSopsYamlFor(TEAM_PATH_REGEX, recipients),
    ".gitignore": "mattstack/secrets/*.tmp\n.DS_Store\n",
  };
}
```

Delete `ownerFromRemote` if nothing else uses it (`rg -n ownerFromRemote lib commands`).

In `createTeam`: add `team: string` to `CreateTeamResult`; compute `const team = defaultTeamName(slug);` beside `slug`; pass `team` as the fifth argument to `scaffoldFiles`; include `team` in all three returned objects; and change the guard path to `assertNotRealStoreInTest(join(dir, "mattstack", "org", "settings.org.jsonc"));`.

In `lib/team/join.ts` near line 532, the same guard path becomes `join(p.home, ".mattstack", "teams", pointer.team, "mattstack", "org", "settings.org.jsonc")`.

In `rt-tray/vm/run/host/team-rebase.sh`, `board.title` now lives in the first team's folder. Replace the fixed path `mattstack/settings.team.jsonc` in the comment and in the `git show` pathspec with `mattstack/teams` (a directory pathspec, so the check holds whatever the team is named). This script only runs in the VM harness; `bash -n rt-tray/vm/run/host/team-rebase.sh` must still pass.

- [ ] **Step 4: Run and commit**

```bash
bun test lib/team/__tests__/create.test.ts lib/team/__tests__/join.test.ts commands/__tests__/team.test.ts lib/setup
bash -n rt-tray/vm/run/host/team-rebase.sh
bunx tsc --noEmit
```

Expected: PASS. A setup test that created a team and then looked for `mattstack/settings.team.jsonc` looks for the org store instead. `lib/__tests__/no-settings-bypass.test.ts` reports new counts for `lib/team/create.ts` (2 today, 1 once the scaffold writes through the path helpers) and `lib/team/join.ts`: set each allowlist entry to the count the failure prints and reword its reason to name the org store.

```bash
git add lib/team/create.ts lib/team/join.ts lib/team/__tests__/create.test.ts rt-tray/vm/run/host/team-rebase.sh lib/__tests__/no-settings-bypass.test.ts
git add $(git diff --name-only -- '*.test.ts')
git commit -m "rt team create: scaffold the org layout with one team folder"
```

### Task 11: Zones are team folders, and a pack's claim comes from settings

**Files:**
- Modify: `lib/skills/init.ts` (`ZoneInfo`, `readZonesFrom`, `zoneTeamConfigReads`, `chooseZone`, `addMarketplacePlugin`, `initPack`, `InitDeps`; delete `declareRepo`, `isValidNamespace`, `zoneHasPack`)
- Modify: `lib/skills/materialize.ts` (`claimingPacksIn`, the over-claim message)
- Modify: `commands/skills.ts` (`packRootDir`, `resolvePack`'s fallback, `findDefaultManifest`'s zone filter)
- Modify: `commands/skills-init.ts` (the real `declareClaim` dep; `createZone` returns the team)
- Modify: `lib/setup/steps/skills.ts` (`teamPacks`), `apps/console/src/server/effectiveInputs.ts` (a comment)
- Modify: `lib/__tests__/no-settings-bypass.test.ts` (the `lib/skills/init.ts` entry: the zone reader now calls `readSection` and names two store files; set the count the failure prints and reword the reason to "reads each team folder's own claim and host; getSetting resolves only the active team")
- Test: `lib/skills/__tests__/init.test.ts`, `lib/skills/__tests__/materialize.test.ts`, `commands/__tests__/skills-init.test.ts`, `commands/__tests__/skills.test.ts`, `commands/__tests__/skills-bind.test.ts`

**Interfaces:**
- Consumes: `TEAM_NAME_RE`, `getDef`, `readSection` from rt-client's settings modules (import through `../settings/stores.ts`, `../settings/registry.ts`, and `../../packages/rt-client/src/settings/migrate.ts`).
- Produces:

```ts
export type ZoneInfo = {
  /** "<org>/<team>": what a bindings file's header records. */
  slug: string;
  org: string;
  team: string;
  /** The org clone's root. */
  orgDir: string;
  /** The team folder. */
  dir: string;
  host: string | null;
  projects: string[];
  marketplace: string | null;
  hasPack: boolean;
};
export function packDirOf(zone: Pick<ZoneInfo, "dir" | "team">): string;
export function readZonesFrom(fs: InitFs, teams: string): ZoneInfo[];
export function zoneTeamConfigReads(fs: InitFs, zoneDir: string): boolean; // the team folder's settings parse
// InitDeps gains:
declareClaim(zone: ZoneInfo, projects: string[]): void;
// createZone now answers the first team too:
createZone(name: string, remote: string): Promise<{ slug: string; team: string; dir: string }>;
```

The zone slug changes shape here because a zone is now a team folder; Task 15 pins the sweep's rules against it.

- [ ] **Step 1: Write the failing zone tests**

In `lib/skills/__tests__/init.test.ts`, replace `zoneFiles` and the `readZones` describe:

```ts
const HOME = "/h";
const ORG_ROOT = (org: string) => `${HOME}/.mattstack/teams/${org}`;
const orgFiles = (org: string, orgSettings: Record<string, unknown>, teams: Record<string, Record<string, unknown>>, extra: Record<string, string> = {}) => ({
  [`${ORG_ROOT(org)}/mattstack/mattstack.jsonc`]: `{ "role": "org", "org": "${org}" }`,
  [`${ORG_ROOT(org)}/mattstack/org/settings.org.jsonc`]: `// org\n${JSON.stringify(orgSettings)}`,
  [`${ORG_ROOT(org)}/.claude-plugin/marketplace.json`]: `{ "name": "${org}-market", "owner": { "name": "x" }, "plugins": [] }`,
  ...Object.fromEntries(Object.entries(teams).map(([team, settings]) => [`${ORG_ROOT(org)}/mattstack/teams/${team}/settings.team.jsonc`, `// team\n${JSON.stringify(settings)}`])),
  ...extra,
});

describe("readZones", () => {
  test("one zone per team folder, named <org>/<team>", () => {
    const fs = memFs(orgFiles("acme", {}, { widgets: {}, gadgets: {} }));
    const zones = readZonesFrom(fs, `${HOME}/.mattstack/teams`);
    expect(zones.map((z) => z.slug)).toEqual(["acme/gadgets", "acme/widgets"]);
    expect(zones[1]).toEqual({
      slug: "acme/widgets", org: "acme", team: "widgets", orgDir: ORG_ROOT("acme"), dir: `${ORG_ROOT("acme")}/mattstack/teams/widgets`,
      host: null, projects: [], marketplace: "acme-market", hasPack: false,
    });
    expect(readZones(fs, HOME)).toEqual(zones);
  });

  test("in a monorepo every team inherits the org's board.projects, so every team's pack claims the shared repo", () => {
    const fs = memFs(orgFiles("acme", { "board.gitlabHost": "https://GitLab.example.com", "board.projects": ["acme/widgets"] }, { widgets: {}, gadgets: {} }));
    for (const zone of readZones(fs, HOME)) {
      expect(zone.host).toBe("gitlab.example.com");
      expect(zone.projects).toEqual(["acme/widgets"]);
    }
  });

  test("a team that sets board.projects claims only its own repos", () => {
    const fs = memFs(orgFiles("acme", { "board.gitlabHost": "gitlab.example.com", "board.projects": ["acme/widgets"] }, { widgets: {}, gadgets: { "board.projects": ["acme/gadgets"] } }));
    const byTeam = Object.fromEntries(readZones(fs, HOME).map((z) => [z.team, z.projects]));
    expect(byTeam).toEqual({ widgets: ["acme/widgets"], gadgets: ["acme/gadgets"] });
  });

  test("the host falls back to the forge in mattstack.integrations, team then org", () => {
    const fs = memFs(orgFiles("acme", { "mattstack.integrations": { forge: { host: "github.com", provider: "github" } } }, { widgets: {} }));
    expect(readZones(fs, HOME)[0]!.host).toBe("github.com");
  });

  test("a team folder with a pack/skills.jsonc under packs/<team> has a pack; a base beside it does not count", () => {
    const fs = memFs(orgFiles("acme", {}, { widgets: {}, gadgets: {} }, {
      [`${ORG_ROOT("acme")}/mattstack/teams/widgets/packs/widgets/pack/skills.jsonc`]: `{}`,
      [`${ORG_ROOT("acme")}/mattstack/teams/gadgets/packs/gadgets/.claude-plugin/plugin.json`]: `{ "name": "gadgets", "version": "0.1.0" }`,
    }));
    const byTeam = Object.fromEntries(readZones(fs, HOME).map((z) => [z.team, z.hasPack]));
    expect(byTeam).toEqual({ widgets: true, gadgets: false });
  });

  test("a folder that is not a team name, or whose settings do not parse, is no zone", () => {
    const fs = memFs(orgFiles("acme", {}, { widgets: {} }, {
      [`${ORG_ROOT("acme")}/mattstack/teams/Widgets2/settings.team.jsonc`]: `{}`,
      [`${ORG_ROOT("acme")}/mattstack/teams/broken/settings.team.jsonc`]: `{ not json`,
      [`${ORG_ROOT("acme")}/mattstack/teams/empty/notes.md`]: `x`,
    }));
    expect(readZones(fs, HOME).map((z) => z.team)).toEqual(["widgets"]);
  });

  test("an old-layout clone and a user zone are skipped", () => {
    const fs = memFs({
      [`${HOME}/.mattstack/teams/old/mattstack/mattstack.jsonc`]: `{ "role": "team", "namespace": "old", "org": "x" }`,
      [`${HOME}/.mattstack/teams/old/mattstack/settings.team.jsonc`]: `{}`,
      [`${HOME}/.mattstack/teams/me/mattstack/mattstack.jsonc`]: `{ "role": "user" }`,
    });
    expect(readZones(fs, HOME)).toEqual([]);
  });
});
```

In the `chooseZone` describe, the `z` builder becomes:

```ts
  const z = (team: string, host: string | null, projects: string[] = [], hasPack = false): ZoneInfo =>
    ({ slug: `acme/${team}`, org: "acme", team, orgDir: "/z", dir: `/z/mattstack/teams/${team}`, host, projects, marketplace: "acme", hasPack });
```

and its tests name zones by team (`chooseZone(zones, repo, "widgets")`); a `--zone` value matches a zone's `team`.

In the `initPack` world, seed with `orgFiles("acme", { "board.gitlabHost": "gitlab.com" }, { acme: {} })`, add the dep `declareClaim: (zone, projects) => { calls.claims.push([zone.slug, projects]); },` (with `claims: [string, string[]][]` on `Calls`), and change the happy path's expectations:

```ts
    const packDir = `${HOME}/.mattstack/teams/acme/mattstack/teams/acme/packs/acme`;
    expect(out.pack).toEqual({ name: "acme", dir: packDir, zone: "acme/acme", marketplace: "acme-market" });
    expect(calls.claims).toEqual([["acme/acme", ["acme/api"]]]);
    expect(JSON.parse(fs.readFile(`${HOME}/.mattstack/teams/acme/.claude-plugin/marketplace.json`)!).plugins[0]).toMatchObject({ name: "acme", source: "./mattstack/teams/acme/packs/acme" });
```

Add:

```ts
  test("a new claim is the team's resolved list plus the new repo, never the new repo alone", async () => {
    const { deps, calls } = world({ files: orgFiles("acme", { "board.gitlabHost": "gitlab.com", "board.projects": ["acme/widgets"] }, { acme: {} }) });
    const out = await initPack({ repoDir: REPO, zone: "acme" }, deps);
    expect(out.ok).toBe(true);
    expect(calls.claims).toEqual([["acme/acme", ["acme/widgets", "acme/api"]]]);
  });

  test("a repo the team already claims writes no claim", async () => {
    const { deps, calls } = world({ files: orgFiles("acme", { "board.gitlabHost": "gitlab.com", "board.projects": ["acme/api"] }, { acme: {} }) });
    await initPack({ repoDir: REPO, zone: null }, deps);
    expect(calls.claims).toEqual([]);
  });
```

Delete the `declareRepo` describe and the "the pack takes the zone namespace" test (a pack is named after its team folder now). Update the remaining `initPack` tests' seeds from `zoneFiles`/`team.jsonc` to `orgFiles` with the same host and projects.

- [ ] **Step 2: Run to see them fail**

Run: `bun test lib/skills/__tests__/init.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite the zone reader**

In `lib/skills/init.ts`, add imports:

```ts
import { readSection } from "../../packages/rt-client/src/settings/migrate.ts";
import { getDef } from "../settings/registry.ts";
import { TEAM_NAME_RE } from "../settings/stores.ts";
```

Replace `ZoneInfo` with the type in the Interfaces block. Delete `isValidNamespace` and `zoneHasPack`. Replace `zoneTeamConfigReads` and `readZonesFrom`:

```ts
function storeGlobal(fs: InitFs, path: string): Record<string, unknown> | null {
  const parsed = readJsonc(fs, path);
  if (parsed === null) return null;
  const { repos: _repos, ...global } = parsed;
  return global;
}

function stored(key: string, section: Record<string, unknown> | null): unknown {
  const def = getDef(key);
  if (!def || section === null) return undefined;
  const read = readSection(def, section, { layer: true });
  return read.present ? read.value : undefined;
}

function forgeHost(section: Record<string, unknown> | null): unknown {
  return (stored("mattstack.integrations", section) as { forge?: { host?: unknown } | null } | undefined)?.forge?.host;
}

export function packDirOf(zone: Pick<ZoneInfo, "dir" | "team">): string {
  return join(zone.dir, "packs", zone.team);
}

/** A team folder can land before its settings file (a partial pull); only a parsed settings file says what the team claims. */
export function zoneTeamConfigReads(fs: InitFs, zoneDir: string): boolean {
  return readJsonc(fs, join(zoneDir, "settings.team.jsonc")) !== null;
}

/**
 * One zone per team folder of every org clone. A team's pack claims the
 * projects in board.projects as that team resolves it (the team's own list,
 * else the org's), on board.gitlabHost, else the forge host.
 */
export function readZonesFrom(fs: InitFs, teams: string): ZoneInfo[] {
  const zones: ZoneInfo[] = [];
  for (const org of [...fs.readDir(teams)].sort()) {
    const orgDir = join(teams, org);
    const marker = readJsonc(fs, join(orgDir, "mattstack", "mattstack.jsonc"));
    if (marker?.role !== "org") continue;
    const orgSettings = storeGlobal(fs, join(orgDir, "mattstack", "org", "settings.org.jsonc"));
    const market = readJsonc(fs, join(orgDir, ".claude-plugin", "marketplace.json"));
    const marketplace = typeof market?.name === "string" ? market.name : null;
    const teamsRoot = join(orgDir, "mattstack", "teams");
    for (const team of [...fs.readDir(teamsRoot)].sort()) {
      if (!TEAM_NAME_RE.test(team)) continue;
      const dir = join(teamsRoot, team);
      const teamSettings = storeGlobal(fs, join(dir, "settings.team.jsonc"));
      if (teamSettings === null) continue;
      const claimed = stored("board.projects", teamSettings) ?? stored("board.projects", orgSettings);
      const projects = Array.isArray(claimed) ? claimed.filter((p): p is string => typeof p === "string") : [];
      const host =
        hostOnly(stored("board.gitlabHost", teamSettings)) ??
        hostOnly(stored("board.gitlabHost", orgSettings)) ??
        hostOnly(forgeHost(teamSettings)) ??
        hostOnly(forgeHost(orgSettings));
      const packDir = join(dir, "packs", team);
      zones.push({ slug: `${org}/${team}`, org, team, orgDir, dir, host, projects, marketplace, hasPack: isPackDir(fs, packDir) && !isBasePack(fs, packDir) });
    }
  }
  return zones;
}
```

In `chooseZone`, the named lookup becomes `zones.find((z) => z.team === wanted)`.

- [ ] **Step 4: Rewrite `initPack`'s zone-dependent lines**

- `addMarketplacePlugin` takes the source: `export function addMarketplacePlugin(marketplaceJson: string, pack: string, description: string, source: string): string` and writes `{ name: pack, source, description }`.
- Delete `declareRepo`.
- `InitDeps` gains `declareClaim(zone: ZoneInfo, projects: string[]): void;` and `createZone` returns `Promise<{ slug: string; team: string; dir: string }>`.
- Remove `"invalid-namespace"` from `InitRefusalCode`.
- In `initPack`: after `deps.createZone`, `wantedZone = created.team; ... choice = chooseZone(zones, repo, created.team);`. Then:

```ts
  const zone = choice.zone;
  const pack = zone.team;
  const packDir = packDirOf(zone);
  if (zone.hasPack || deps.fs.exists(packDir)) {
    return refuse("pack-exists", "This team already has a pack, and rt never changes an existing pack. To add to it, use the mattstack:extending-a-pack skill");
  }
  const marketplace = zone.marketplace ?? zone.org;
  const pluginId = `${pack}@${marketplace}`;
```

- The refusal copy that says "zone" now says "team": `zone-missing` reads `No team on ${repo.host} is free for a new pack` and `There is no team called ${wantedZone}`; `zone-ambiguous` reads `More than one team could hold this pack: ${choice.zones.map((z) => z.team).join(", ")}`; `zone-mismatch` reads `The ${choice.zone.team} team is on ${choice.zone.host}, but this repo is on ${repo.host}`; `zone-has-pack` reads `The ${choice.zone.team} team already has a pack, and a team holds only one`. The refusal codes keep their names (they are in the `--json` contract).
- In `remedyFor`, the install remedy's marketplace path is `zone.orgDir`.
- Replace the `team.jsonc` block and the marketplace block inside the `try`:

```ts
    if (!zone.projects.includes(repo.path)) {
      deps.declareClaim(zone, [...zone.projects, repo.path]);
      wrote.push(join(zone.dir, "settings.team.jsonc"));
    }
    const marketPath = join(zone.orgDir, ".claude-plugin", "marketplace.json");
    const marketOnDisk = deps.fs.readFile(marketPath);
    const marketBefore = marketOnDisk ?? JSON.stringify({ name: marketplace, owner: { name: zone.org }, plugins: [] }, null, 2) + "\n";
    const marketAfter = addMarketplacePlugin(marketBefore, pack, packDescription(pack), `./mattstack/teams/${zone.team}/packs/${zone.team}`);
    if (marketAfter !== marketOnDisk) {
      deps.fs.mkdirp(join(zone.orgDir, ".claude-plugin"));
      deps.fs.writeFile(marketPath, marketAfter);
      wrote.push(marketPath);
    }
```

- `claude plugin marketplace add` takes `zone.orgDir`.
- The returned `pack` is `{ name: pack, dir: packDir, zone: zone.slug, marketplace }`.

In `commands/skills-init.ts`'s `realDeps`:

```ts
    createZone: async (name, remote) => {
      const r = await createTeam(p, { name, remote, others: false });
      return { slug: r.slug, team: r.team, dir: r.dir };
    },
    declareClaim: (zone, projects) => setSetting("board.projects", projects, "team", { team: zone.team }),
```

with `setSetting` imported from `../lib/settings/write.ts`.

- [ ] **Step 5: Point materialize and the skills command at team folders**

`lib/skills/materialize.ts`, in `claimingPacksIn`:

```ts
  const packsDir = join(zone.dir, "packs");
```

and the over-claim detail reads:

```ts
      const detail = `team "${zone.team}" holds ${names.length} packs (${names.join(", ")}) that all claim ${repo}; a team folder binds one pack per repo, so keep one and move the shared fills to the org base pack`;
```

`commands/skills.ts`:

```ts
function packRootDir(mattstackRoot: string, team: string): string | null {
  const zone = readZonesFrom(realInitFs, join(mattstackRoot, "teams")).find((z) => z.team === team);
  return zone ? packDirOf(zone) : null;
}
```

In `resolvePack`, the hand-installed fallback becomes:

```ts
    const byFolder = packRootDir(mattstackRoot, flags.team);
    if (byFolder && existsSync(byFolder)) return { team: flags.team, packDir: byFolder };
    throw new SkillsUsageError(
      `no pack named "${flags.team}" (discovered: ${packs.map((p) => p.name).join(", ") || "none"})`,
      { title: `No pack is called ${flags.team}`, next: out.cmd("rt skills packs"), details: `Packs here: ${packs.map((p) => p.name).join(", ") || "none"}` },
    );
```

In `findDefaultManifest`, the zone filter becomes `.filter((z) => z.team === team && existsSync(packDirOf(z)))`, and "its team zone declares no forge host" reads "its team declares no forge host". The same function decides whether a pack directory is a team pack by its path shape (near line 478); a team pack now sits at `<repo>/mattstack/teams/<team>/packs/<team>`:

```ts
  // Team packs sit at <repo>/mattstack/teams/<team>/packs/<team>; that path
  // shape survives worktrees, unlike the clone's location, and a team pack's
  // pack/skills.jsonc is a merge fragment, never its manifest.
  const parts = resolvePath(packDir).split(sep);
  const teamShaped = parts.at(-2) === "packs" && parts.at(-4) === "teams" && parts.at(-5) === "mattstack";
```

`apps/console/src/server/effectiveInputs.ts` line 220 has a comment naming the old pack path; reword it to `teams/<org>/mattstack/teams/<team>/packs/<team>` (the code under it resolves the pack through discovery and needs no change).

`lib/setup/steps/skills.ts`, `teamPacks` walks every team folder of the org:

```ts
function teamPacks(ctx: ApplyContext): { name: string; base: boolean }[] {
  if (!ctx.team.slug) return [];
  const teams = join(ctx.p.home, ".mattstack", "teams", ctx.team.slug, "mattstack", "teams");
  return ctx.p.readDir(teams)
    .flatMap((team) => ctx.p.readDir(join(teams, team, "packs")).map((name) => ({ name, dir: join(teams, team, "packs", name) })))
    .filter((pack) => isPackDir(ctx.p, pack.dir))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((pack) => ({ name: pack.name, base: isBasePack(ctx.p, pack.dir) }));
}
```

(Task 18 deletes this function with `seedDefaultPack`.)

- [ ] **Step 6: Move the remaining skills tests onto the new layout**

Run: `bun test lib/skills commands/__tests__/skills.test.ts commands/__tests__/skills-init.test.ts commands/__tests__/skills-bind.test.ts lib/setup`

Each failure is a fixture that wrote the old zone. The rule: a fixture that wrote `<zone>/mattstack/mattstack.jsonc` with `role: "team"`, `<zone>/mattstack/team.jsonc` with `{ gitlabHost, projects }` and `<zone>/mattstack/packs/<pack>/...` now writes `<org>/mattstack/mattstack.jsonc` with `{ "role": "org", "org": "<org>" }`, `<org>/mattstack/org/settings.org.jsonc` with `{ "board.gitlabHost": <host>, "board.projects": <projects> }`, `<org>/mattstack/teams/<pack>/settings.team.jsonc` with `{}`, and the pack under `<org>/mattstack/teams/<pack>/packs/<pack>/...`. An expected bindings header `zone: <zone>` becomes `zone: <org>/<pack>`. For `lib/skills/__tests__/materialize.test.ts`, replace its `zone()` helper now with the `org()` helper shown in Task 14 Step 1 (it writes exactly this layout), keeping the `installBase` helper and the `claudeHome` argument until Task 14 removes them. A fixture with two packs in one zone that expected the "one pack per repo" failure puts both packs under one team folder's `packs/`.

- [ ] **Step 7: Verify and commit**

```bash
bunx tsc --noEmit
bun run test
git add lib/skills/init.ts lib/skills/materialize.ts commands/skills.ts commands/skills-init.ts lib/setup/steps/skills.ts apps/console/src/server/effectiveInputs.ts lib/__tests__/no-settings-bypass.test.ts
git add $(git diff --name-only -- '*.test.ts')
git commit -m "skills: zones are team folders, and a pack's claim is the team's board.projects"
```

### Task 12: Docs for the layout and the scopes

**Files:**
- Modify: `docs/settings-architecture.md`, `docs/home-repo.md`
- Modify: `skills/rt-settings/SKILL.md` (with `superpowers:writing-skills` and `mattstack:editing-skills` loaded)

- [ ] **Step 1: `docs/settings-architecture.md`**

Replace the stores table's team row with two rows and add the active-team paragraph:

```markdown
| org     | `~/.mattstack/teams/<org>/mattstack/org/settings.org.jsonc` | the org's repo, shared by every team |
| team    | `~/.mattstack/teams/<org>/mattstack/teams/<team>/settings.team.jsonc` | the same repo, one folder per team |
```

```markdown
Scope order, weakest first:
`default < org < team < user < org.repo < team.repo < user.repo < machine < machine.repo`.

The `team` layer is the active team's store. `activeTeam()` in rt-client picks
it from the org's roster (`mattstack.roster`, each entry's `teams`) and this
Mac's stored forge username (`forgeUsername` in
`~/.mattstack/rt/teams/<org>.json`): the team `mattstack.activeTeam` names
when the roster lists you on it, else the first team in your roster entry. A
Mac with no active team reads the org layer alone. Every key that allows
`team` also allows `org`; `mattstack.roster` and `mattstack.org` are org only.
```

Update the registry checklist in that file: a new shared key lists `team` in `scopes` (the org scope is derived), and a list that should add up across layers sets `merge: "add"`.

- [ ] **Step 2: `docs/home-repo.md`**

Wherever it describes "team clones" under `~/.mattstack/teams/<team>/`, say "org clones under `~/.mattstack/teams/<org>/`, each holding `mattstack/org/` and one folder per team under `mattstack/teams/`". Keep the folder name `teams/` and say why in one sentence: renaming it is out of scope.

- [ ] **Step 3: The `rt-settings` skill**

Load `superpowers:writing-skills` and `mattstack:editing-skills` first and follow them (baseline, edit, verify). The changes: the scope list gains `org` ("shared by every team in the org"); the store path for `team` becomes the team folder's file; "choosing a scope" gains the rule "the same for every team goes to `org`, how one team works goes to `team`"; `setSetting(key, value, "team", { team })` names a team folder and defaults to the active team; reading another team's value is `getSetting(key, { team: "<name>" })`.

- [ ] **Step 4: Check and commit**

```bash
rg -n '[\x{2013}\x{2014}]' docs/settings-architecture.md docs/home-repo.md skills/rt-settings/SKILL.md
bun run cli.ts skills check --strict 2>/dev/null || true
git add docs/settings-architecture.md docs/home-repo.md skills/rt-settings/SKILL.md
git commit -m "docs: the org and team layers in the settings architecture, home repo and rt-settings skill"
```

The `rg` must print only lines that were already there before your edit (compare with `git diff`); your own lines carry no dashes of either kind.

- [ ] **Step 5: PR 1 gate**

```bash
bun run test
bunx tsc --noEmit
bun run check
bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/settings.test.ts
```

All green, then open PR 1 from `org-teams-1-resolver` against `main` (it stays open until the whole stack lands; see Landing). Its body names the two deliberate contract changes: the `org` rows in `rt settings explain --json` and `list --json`, and the `/defs` reply's `org` and `activeTeam` fields replacing `team`.

---
## PR 2: Packs

Branch `org-teams-2-packs`, based on `org-teams-1-resolver`.

### Task 13: Pack discovery looks in team folders and the org folder

**Files:**
- Modify: `lib/skills/packs.ts` (`discoverPacks`, new `orgFolderPacks`)
- Test: `lib/skills/__tests__/packs.test.ts`

**Interfaces:**
- Consumes: Task 11 layout (`<org>/mattstack/teams/<team>/packs/<team>`, `<org>/mattstack/org/packs/<base>`).
- Produces:

```ts
export type DiscoverOpts = {
  settingsPath?: string;
  extraPackDirs?: { name: string; dir: string }[];
  /** The `~/.mattstack` root to scan for org clones; defaults to the real one. Pass null to skip the folder scan. */
  mattstackRoot?: string | null;
};
export function orgFolderPacks(mattstackRoot: string): PackInfo[];
```

A pack found through a registered marketplace keeps winning on a name clash (it is the same directory, and it carries the marketplace key `rt skills sync` needs).

- [ ] **Step 1: Write the failing tests**

Add to `lib/skills/__tests__/packs.test.ts`:

```ts
describe("orgFolderPacks", () => {
  function makeOrg() {
    const root = tmp("rt-packs-org-");
    const org = join(root, "teams", "acme");
    writeFile(join(org, "mattstack", "mattstack.jsonc"), `{ "role": "org", "org": "acme" }`);
    writeFile(join(org, ".claude-plugin", "marketplace.json"), `{ "name": "acme-market", "plugins": [] }`);
    const widgets = join(org, "mattstack", "teams", "widgets", "packs", "widgets");
    writeFile(join(widgets, "pack", "surface.jsonc"), `{ "public": ["work"] }`);
    const base = join(org, "mattstack", "org", "packs", "acme-base");
    writeFile(join(base, "pack", "surface.jsonc"), `{ "public": [] }`);
    writeFile(join(org, "mattstack", "teams", "gadgets", "settings.team.jsonc"), `{}`);
    return { root, widgets, base };
  }

  test("finds each team's pack and the org base pack, by folder", () => {
    const { root, widgets, base } = makeOrg();
    expect(orgFolderPacks(root).map((p) => [p.name, p.dir, p.marketplace])).toEqual([
      ["acme-base", base, "acme-market"],
      ["widgets", widgets, "acme-market"],
    ]);
  });

  test("a clone that is not an org, or a root with no teams dir, yields nothing", () => {
    const root = tmp("rt-packs-org-");
    writeFile(join(root, "teams", "old", "mattstack", "mattstack.jsonc"), `{ "role": "team" }`);
    writeFile(join(root, "teams", "old", "mattstack", "packs", "old", "pack", "surface.jsonc"), `{ "public": [] }`);
    expect(orgFolderPacks(root)).toEqual([]);
    expect(orgFolderPacks(tmp("rt-packs-empty-"))).toEqual([]);
  });

  test("discoverPacks adds folder packs, and a marketplace entry of the same name wins", () => {
    const { root, widgets } = makeOrg();
    const { settingsPath } = makeMarketplaceFixture();
    const names = discoverPacks({ settingsPath, mattstackRoot: root }).map((p) => p.name);
    expect(names).toEqual(["acme", "acme-base", "mattstack", "widgets"]);
    expect(discoverPacks({ settingsPath, mattstackRoot: null }).map((p) => p.name)).toEqual(["acme", "mattstack"]);
    const viaExtra = discoverPacks({ settingsPath, mattstackRoot: root, extraPackDirs: [{ name: "widgets", dir: widgets }] });
    expect(viaExtra.filter((p) => p.name === "widgets").length).toBe(1);
  });
});
```

Add `orgFolderPacks` to the file's import from `../packs.ts`.

- [ ] **Step 2: Run to see them fail**

Run: `bun test lib/skills/__tests__/packs.test.ts`
Expected: FAIL, `orgFolderPacks` is not exported.

- [ ] **Step 3: Implement**

In `lib/skills/packs.ts`:

```ts
function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

/**
 * Packs found by where they sit in an org clone rather than through a
 * registered marketplace: the org base pack is never installed, and a team
 * pack must be compilable before anyone has added the org's marketplace.
 */
export function orgFolderPacks(mattstackRoot: string): PackInfo[] {
  const found: PackInfo[] = [];
  const teams = join(mattstackRoot, "teams");
  for (const org of subdirs(teams)) {
    const orgDir = join(teams, org);
    let marker: { role?: unknown };
    let marketplace: string | null = null;
    try {
      marker = readJsonc(join(orgDir, "mattstack", "mattstack.jsonc")) as { role?: unknown };
    } catch {
      continue;
    }
    if (marker?.role !== "org") continue;
    try {
      const name = (readJsonc(join(orgDir, ".claude-plugin", "marketplace.json")) as { name?: unknown }).name;
      if (typeof name === "string") marketplace = name;
    } catch {
      marketplace = null;
    }
    for (const base of subdirs(join(orgDir, "mattstack", "org", "packs"))) {
      const pack = packFromDir(base, join(orgDir, "mattstack", "org", "packs", base), marketplace);
      if (pack) found.push(pack);
    }
    for (const team of subdirs(join(orgDir, "mattstack", "teams"))) {
      const pack = packFromDir(team, join(orgDir, "mattstack", "teams", team, "packs", team), marketplace);
      if (pack) found.push(pack);
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}
```

In `discoverPacks`, after the `extraPackDirs` loop and before the return:

```ts
  const root = opts.mattstackRoot === undefined ? join(process.env.HOME ?? homedir(), ".mattstack") : opts.mattstackRoot;
  if (root !== null) {
    for (const pack of orgFolderPacks(root)) if (!found.has(pack.name)) found.set(pack.name, pack);
  }
```

Add the `mattstackRoot` field to `DiscoverOpts` as in the Interfaces block.

- [ ] **Step 4: Keep existing callers hermetic**

`discoverPacks()` now reads `~/.mattstack/teams` by default. Tests that call it with a fixture `settingsPath` and expect an exact list must not see the developer's real org: the test preload already points HOME at a scratch dir, so no change is needed when the suite runs from the repo root. Confirm with:

Run: `bun test lib/skills commands/__tests__/skills.test.ts commands/__tests__/skills-sync.test.ts lib/mcp`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/packs.ts lib/skills/__tests__/packs.test.ts
git commit -m "skills: discover packs in team folders and the org folder"
```

### Task 14: The org base pack, by bare name

**Files:**
- Modify: `lib/skills/materialize.ts` (`MaterializeDeps`, `baseLayer`, `materializePack`)
- Modify: `lib/setup/skills-materialize.ts` (the `deps` object)
- Modify: `lib/skills/sources.ts` (`PluginRoots`, `orgBasePackRoots`, `loadAttachment`)
- Modify: `commands/skills.ts` (`resolve`: add the base roots)
- Test: `lib/skills/__tests__/materialize.test.ts`, `lib/skills/__tests__/sources.test.ts`, `commands/__tests__/skills.test.ts`

**Interfaces:**
- Produces:

```ts
// materialize.ts
export type MaterializeDeps = { fs: MaterializeFs; mattstackRoot: string; enginePackDir: string };

// sources.ts
export type PluginRoots = {
  byName: Record<string, { dir: string; version: string }>;
  list: PluginListEntry[];
  /** Roots that are read from a folder and never installed: a fill found under their skills/ cannot be invoked at run time. */
  folderOnly?: Set<string>;
};
export function orgBasePackRoots(mattstackRoot: string): { name: string; dir: string; version: string }[];
```

A team pack's fragment says `"extends": "acme-base"`. The `<plugin>@<marketplace>` form is refused.

- [ ] **Step 1: Write the failing materialize tests**

In `lib/skills/__tests__/materialize.test.ts`, replace the `zone` and `installBase` helpers (Task 11 already moved `zone` to the org layout; this is its final shape) and drop `claudeHome` from every `materializeRepo` call:

```ts
function org(root: string, slug: string, opts: { projects: string[]; teams: Record<string, object | null>; base?: Record<string, object> }): void {
  const dir = join(root, "teams", slug);
  write(join(dir, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "org", org: slug }));
  write(join(dir, "mattstack", "org", "settings.org.jsonc"), JSON.stringify({ "board.gitlabHost": "https://gitlab.example.com", "board.projects": opts.projects }));
  for (const [team, fragment] of Object.entries(opts.teams)) {
    write(join(dir, "mattstack", "teams", team, "settings.team.jsonc"), "{}");
    if (fragment) write(join(dir, "mattstack", "teams", team, "packs", team, "pack", "skills.jsonc"), JSON.stringify(fragment));
  }
  for (const [name, fragment] of Object.entries(opts.base ?? {})) {
    write(join(dir, "mattstack", "org", "packs", name, "pack", "skills.jsonc"), JSON.stringify(fragment));
  }
}
```

Replace the base-pack tests with:

```ts
  describe("org base pack", () => {
    test("a team pack that extends the org base layers default, base, pack", () => {
      const { root, engine } = makeWorld();
      org(root, "acme", {
        projects: ["acme/widgets"],
        teams: { widgets: { extends: "acme-base", bindings: { "mattstack:stage-gates": { domain: "widgets:gates" } } } },
        base: { "acme-base": { base: true, bindings: { "mattstack:stage-watch-ci": { forge: "acme-base:ci-forge" } } } },
      });
      const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
      if (out.kind !== "written") throw new Error("expected written");
      expect(out.packs).toEqual([{ pack: "widgets", zone: "acme/widgets", ok: true, path: join(root, "repos", SLUG, "packs", "widgets", "skills.jsonc"), layers: ["default", "base:acme-base", "pack"] }]);
      const merged = body(join(root, "repos", SLUG, "packs", "widgets", "skills.jsonc"));
      expect(merged.bindings["mattstack:stage-watch-ci"]).toEqual({ forge: "acme-base:ci-forge" });
      expect(merged.bindings["mattstack:stage-gates"]).toEqual({ domain: "widgets:gates" });
    });

    test("two teams on the shared repo each get a bindings file, and the base gets none", () => {
      const { root, engine } = makeWorld();
      org(root, "acme", {
        projects: ["acme/widgets"],
        teams: { widgets: { extends: "acme-base" }, gadgets: { extends: "acme-base" } },
        base: { "acme-base": { base: true } },
      });
      const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
      if (out.kind !== "written") throw new Error("expected written");
      expect(out.packs.map((p) => [p.pack, p.zone, p.ok])).toEqual([["gadgets", "acme/gadgets", true], ["widgets", "acme/widgets", true]]);
      expect(existsSync(join(root, "repos", SLUG, "packs", "acme-base"))).toBe(false);
    });

    test("a missing base names the folder it looked in", () => {
      const { root, engine } = makeWorld();
      org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { extends: "acme-base" } } });
      const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
      if (out.kind !== "written") throw new Error("expected written");
      expect(out.packs[0]).toMatchObject({
        ok: false,
        detail: `widgets extends acme-base, but the org has no base pack there (looked in ${join(root, "teams", "acme", "mattstack", "org", "packs", "acme-base")})`,
      });
    });

    test("the plugin@marketplace form is refused", () => {
      const { root, engine } = makeWorld();
      org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { extends: "acme-base@acme" } }, base: { "acme-base": { base: true } } });
      const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
      if (out.kind !== "written") throw new Error("expected written");
      expect(out.packs[0]).toMatchObject({ ok: false, detail: 'widgets extends "acme-base@acme", which is not a base pack name; name the folder under the org\'s packs, for example "extends": "acme-base"' });
    });

    test("a folder that is not marked base is refused, and so is a base that extends", () => {
      const { root, engine } = makeWorld();
      org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { extends: "plain" }, gadgets: { extends: "deep" } }, base: { plain: {}, deep: { base: true, extends: "deeper" } } });
      const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
      if (out.kind !== "written") throw new Error("expected written");
      const byPack = Object.fromEntries(out.packs.map((p) => [p.pack, p.ok ? "" : p.detail]));
      expect(byPack.widgets).toContain('is not marked "base": true');
      expect(byPack.gadgets).toBe("gadgets extends deep, which extends deeper; a base pack cannot extend another");
    });
  });
```

Keep the file's other tests (no remote, undeclared, override layer, legacy migration, sweep), seeded through `org(...)`.

- [ ] **Step 2: Run to see them fail**

Run: `bun test lib/skills/__tests__/materialize.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the base read in materialize**

In `lib/skills/materialize.ts`: drop the `installed-plugins.ts` import; `MaterializeDeps` loses `claudeHome` and `installedPluginDir`; replace `baseLayer`:

```ts
const BASE_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/** The org base pack a team pack extends, read from the org folder of the same clone. It is never installed. */
function baseLayer(deps: MaterializeDeps, zone: ZoneInfo, pack: string, name: string): Layer | { error: string } {
  if (!BASE_NAME_RE.test(name)) {
    return { error: `${pack} extends "${name}", which is not a base pack name; name the folder under the org's packs, for example "extends": "${zone.org}-base"` };
  }
  const dir = join(zone.orgDir, "mattstack", "org", "packs", name);
  const fragmentPath = join(dir, "pack", "skills.jsonc");
  const fragment = readFragment(deps.fs, fragmentPath);
  if (!fragment) return { error: `${pack} extends ${name}, but the org has no base pack there (looked in ${dir})` };
  if (fragment.base !== true) return { error: `${pack} extends ${name}, but ${fragmentPath} is not marked "base": true` };
  if (fragment.extends) return { error: `${pack} extends ${name}, which extends ${fragment.extends}; a base pack cannot extend another` };
  return { label: `base:${name}`, fragment };
}
```

and in `materializePack`: `const base = baseLayer(deps, zone, pack, own.extends);`.

In `lib/setup/skills-materialize.ts`, the deps object becomes `{ fs: p, mattstackRoot: join(p.home, ".mattstack"), enginePackDir }`.

- [ ] **Step 4: Write the failing compile-roots tests**

Add to `lib/skills/__tests__/sources.test.ts`:

```ts
describe("org base pack roots", () => {
  function makeRoot(): { root: string; base: string } {
    const root = mkdtempSync(join(tmpdir(), "rt-sources-org-"));
    const base = join(root, "teams", "acme", "mattstack", "org", "packs", "acme-base");
    mkdirSync(join(base, "pack"), { recursive: true });
    writeFileSync(join(base, "pack", "skills.jsonc"), `{ "base": true }`);
    mkdirSync(join(base, "attachments", "ci-forge"), { recursive: true });
    writeFileSync(join(base, "attachments", "ci-forge", "SKILL.md"), "---\nname: ci-forge\nmetadata:\n  provides: forge\n---\nUse the forge.\n");
    return { root, base };
  }

  test("each org base pack is a root named after its folder", () => {
    const { root, base } = makeRoot();
    expect(orgBasePackRoots(root)).toEqual([{ name: "acme-base", dir: realpathSync(base), version: "org" }]);
    expect(orgBasePackRoots(join(root, "nope"))).toEqual([]);
  });

  test("a fill under a base pack's attachments loads from the org folder", () => {
    const { root, base } = makeRoot();
    const roots: PluginRoots = { byName: { "acme-base": { dir: base, version: "org" } }, list: [], folderOnly: new Set(["acme-base"]) };
    const fill = loadAttachment("acme-base:ci-forge", "forge", roots);
    expect(fill).toMatchObject({ plugin: "acme-base", version: "org", registered: false, provides: "forge" });
    expect(root.length).toBeGreaterThan(0);
  });

  test("a fill under a base pack's skills is refused: nothing installs the base, so it could never be invoked", () => {
    const { base } = makeRoot();
    mkdirSync(join(base, "skills", "watch"), { recursive: true });
    writeFileSync(join(base, "skills", "watch", "SKILL.md"), "---\nname: watch\nmetadata:\n  provides: forge\n---\nbody\n");
    const roots: PluginRoots = { byName: { "acme-base": { dir: base, version: "org" } }, list: [], folderOnly: new Set(["acme-base"]) };
    expect(() => loadAttachment("acme-base:watch", "forge", roots)).toThrow(/move it under attachments\//);
  });
});
```

Add `orgBasePackRoots`, `loadAttachment`, `type PluginRoots` and the `fs`, `os`, `path` names the block uses to the file's imports where missing.

Run: `bun test lib/skills/__tests__/sources.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement the roots**

In `lib/skills/sources.ts`, widen `PluginRoots` as in the Interfaces block and add:

```ts
/** Every org clone's base packs under `<mattstackRoot>/teams/<org>/mattstack/org/packs/`. */
export function orgBasePackRoots(mattstackRoot: string): { name: string; dir: string; version: string }[] {
  const out: { name: string; dir: string; version: string }[] = [];
  for (const org of listDirs(join(mattstackRoot, "teams"))) {
    const packs = join(mattstackRoot, "teams", org, "mattstack", "org", "packs");
    for (const name of listDirs(packs)) {
      const dir = join(packs, name);
      if (!existsSync(join(dir, "pack", "skills.jsonc"))) continue;
      out.push({ name, dir: realpathSync(dir), version: "org" });
    }
  }
  return out;
}
```

In `loadAttachment`, directly after the `foundDir` search succeeds (before reading `SKILL.md`):

```ts
  if (registered && roots.folderOnly?.has(plugin)) {
    throw new Error(
      `loadAttachment: slot "${slot}": "${binding}" sits under ${plugin}'s skills/, but ${plugin} is an org base pack that is never installed; move it under attachments/ so it is inlined`,
    );
  }
```

In `commands/skills.ts` `resolve`, after the line that computes `invocable`:

```ts
  // After the invocable roster: a base pack is never installed, so nothing in it is invocable.
  if (fullRoster.length > 0) {
    for (const base of orgBasePackRoots(mattstackRoot)) {
      pluginRoots.byName[base.name] = { dir: base.dir, version: base.version };
      (pluginRoots.folderOnly ??= new Set()).add(base.name);
    }
  }
```

and import `orgBasePackRoots` beside the other `sources.ts` imports. The roots are read under `mattstackRoot` whether it is the real home or a `--mattstack-dir`, so a compile test can reach them; a directory with no `teams/` folder yields none.

- [ ] **Step 6: A compile through a base pack's fill**

`commands/__tests__/skills.test.ts` calls `materializeRepo` with `claudeHome` in its "two packs bound to one repo" test (near line 582): drop that argument (Task 11 already moved the test's fixture to the org layout). Then add, beside it:

```ts
  test("a team pack compiles a fill that lives in the org base pack", async () => {
    const mattstackDir = makeMattstackDir();
    const orgDir = join(mattstackDir, "teams", "acme", "mattstack");
    const baseDir = join(orgDir, "org", "packs", "acme-base");
    const packDir = join(orgDir, "teams", "widgets", "packs", "widgets");
    writeFile(join(orgDir, "mattstack.jsonc"), JSON.stringify({ role: "org", org: "acme" }));
    writeFile(join(orgDir, "org", "settings.org.jsonc"), JSON.stringify({ "board.gitlabHost": "https://gitlab.example.com", "board.projects": ["acme/widgets"] }));
    writeFile(join(baseDir, "pack", "skills.jsonc"), JSON.stringify({ base: true, bindings: { "mattstack:watch-ci": { domain: "acme-base:watch-ci-domain", forge: "mattstack:gitlab-forge" } } }));
    writeFile(join(baseDir, "attachments", "watch-ci-domain", "SKILL.md"), DOMAIN_SKILL_MD);
    writeFile(join(baseDir, "attachments", "watch-ci-domain", "ci-config.json"), CI_CONFIG_JSON);
    writeFile(join(orgDir, "teams", "widgets", "settings.team.jsonc"), "{}");
    writeFile(join(packDir, "pack", "skills.jsonc"), JSON.stringify({ extends: "acme-base" }));
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_JSONC);

    const out = materializeRepo({ fs: realInitFsForTests, mattstackRoot: mattstackDir, enginePackDir: join(mattstackDir, "plugins", "mattstack") }, "https://gitlab.example.com/acme/widgets.git");
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs).toMatchObject([{ pack: "widgets", ok: true, layers: ["default", "base:acme-base", "pack"] }]);

    const { errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]));
    expect(errors).toEqual([]);
    expect(readFileSync(join(packDir, "skills", "watch-ci", "SKILL.md"), "utf8")).toContain("acme-base:watch-ci-domain");
    expect(existsSync(join(baseDir, "skills"))).toBe(false);
  });
```

It fails before Step 5 with the loader's "unknown plugin acme-base" error, and passes once `resolve` adds the base roots. Add `existsSync` to the file's `fs` import if it lacks it.

- [ ] **Step 7: Run and commit**

```bash
bun test lib/skills lib/setup commands/__tests__/skills.test.ts
bunx tsc --noEmit
git add lib/skills/materialize.ts lib/skills/sources.ts lib/setup/skills-materialize.ts commands/skills.ts lib/skills/__tests__/materialize.test.ts lib/skills/__tests__/sources.test.ts commands/__tests__/skills.test.ts
git commit -m "skills: a team pack extends the org base pack by bare name, read from the org folder"
```

### Task 15: The bindings header and the stale-file sweep

Task 11 already made the header record `<org>/<team>`. This task pins the sweep's rules (spec section 4, "What a Mac installs") so they cannot drift.

**Files:**
- Modify: `lib/skills/materialize.ts` (the doc comment on `setAsideStale` only, unless a test below fails)
- Test: `lib/skills/__tests__/materialize.test.ts`

- [ ] **Step 1: Write the tests**

```ts
  describe("stale bindings files", () => {
    const fileFor = (root: string, pack: string) => join(root, "repos", SLUG, "packs", pack, "skills.jsonc");
    const stale = (root: string, pack: string, zone: string) => write(fileFor(root, pack), `// zone: ${zone}\n{}`);

    function run(root: string, engine: string) {
      const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
      if (out.kind !== "written") throw new Error(`expected written, got ${out.kind}`);
      return out;
    }

    test("the header records <org>/<team>", () => {
      const { root, engine } = makeWorld();
      org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: {} } });
      run(root, engine);
      expect(readFileSync(fileFor(root, "widgets"), "utf8")).toContain("// zone: acme/widgets");
    });

    test("a file whose team no longer claims this repo is set aside", () => {
      const { root, engine } = makeWorld();
      org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: {}, gadgets: {} } });
      write(join(root, "teams", "acme", "mattstack", "teams", "gadgets", "settings.team.jsonc"), JSON.stringify({ "board.projects": ["acme/gadgets"] }));
      stale(root, "gadgets", "acme/gadgets");
      expect(run(root, engine).pruned).toEqual([`${fileFor(root, "gadgets")}.stale`]);
    });

    test("a file whose team no longer has that pack is set aside", () => {
      const { root, engine } = makeWorld();
      org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: {}, gadgets: null } });
      stale(root, "gadgets", "acme/gadgets");
      expect(run(root, engine).pruned).toEqual([`${fileFor(root, "gadgets")}.stale`]);
    });

    test("a missing team folder, a team whose settings do not parse, and a missing org clone set nothing aside", () => {
      const { root, engine } = makeWorld();
      org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: {} } });
      write(join(root, "teams", "acme", "mattstack", "teams", "broken", "settings.team.jsonc"), "{ not json");
      stale(root, "gone", "acme/gone");
      stale(root, "broken", "acme/broken");
      stale(root, "elsewhere", "other-org/elsewhere");
      expect(run(root, engine).pruned).toEqual([]);
      for (const pack of ["gone", "broken", "elsewhere"]) expect(existsSync(fileFor(root, pack))).toBe(true);
    });

    test("a file written before the org layout (its header names only the clone) is left alone", () => {
      const { root, engine } = makeWorld();
      org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: {} } });
      stale(root, "legacy", "acme");
      expect(run(root, engine).pruned).toEqual([]);
    });
  });
```

- [ ] **Step 2: Run them**

Run: `bun test lib/skills/__tests__/materialize.test.ts -t "stale bindings files"`
Expected: PASS already (Task 11 gave `setAsideStale` the new zones). If one fails, fix `setAsideStale` so the lookup is `allZones.find((z) => z.slug === recorded)` and the keep condition is `zone.host === ref.host && zone.projects.includes(ref.path) && claimingPacksIn(deps.fs, zone).some((c) => c.name === pack)`.

- [ ] **Step 3: Reword the comment and commit**

Replace the doc comment above `setAsideStale` with:

```ts
/**
 * Sets aside (renames to `.stale`, never deletes) a bindings file this run did
 * not write, but only when the team its header records (`<org>/<team>`) is on
 * disk with settings that parse, and that team no longer has a pack of that
 * name claiming this repo. A file whose team folder or org clone is absent,
 * whose team settings do not parse (not pulled yet, mid-sync, an unreadable
 * mount), or whose header records no such zone is left alone, as is every
 * pack this run claimed, ok or failed, so a broken pack keeps its last good
 * bindings.
 */
```

```bash
git add lib/skills/materialize.ts lib/skills/__tests__/materialize.test.ts
git commit -m "skills: pin the stale bindings sweep against team-folder zones"
```

### Task 16: `rt skills init` per team folder

**Files:**
- Modify: `lib/skills/init.ts` (`chooseZone`, `initPack`, new `packIsCompiled`)
- Modify: `commands/skills-init.ts` (`InitArgs`, `parseInitArgs`, the header comment, the call)
- Modify: `lib/command-tree-def.ts` (the `skills init` args)
- Test: `lib/skills/__tests__/init.test.ts`, `commands/__tests__/skills-init.test.ts`

**Interfaces:**
- Consumes: `activeTeam` from rt-client (through a new `InitDeps.activeTeam`).
- Produces:

```ts
export type ZoneWanted = { org: string | null; team: string | null; active: string | null };
export function chooseZone(zones: ZoneInfo[], repo: RepoRef, wanted: ZoneWanted): ZoneChoice;
export function packIsCompiled(fs: Pick<InitFs, "readDir" | "exists">, packDir: string): boolean;
export async function initPack(opts: { repoDir: string; zone: string | null; team: string | null }, deps: InitDeps): Promise<InitOutcome>;
// InitDeps gains:
activeTeam(): string | null;
```

`rt skills init [--repo <path>] [--team <name>] [--zone <org>] [--json]`: `--team` names the team folder (default: your active team), `--zone` keeps naming the clone.

- [ ] **Step 1: Write the failing tests**

In `lib/skills/__tests__/init.test.ts`, the `chooseZone` tests call the new signature. Add:

```ts
  describe("with team folders", () => {
    const shared = ["acme/api"];
    const zones = [z("widgets", "gitlab.com", shared), z("gadgets", "gitlab.com", shared)];

    test("the active team wins when two teams claim the shared repo", () => {
      expect(chooseZone(zones, repo, { org: null, team: null, active: "gadgets" })).toEqual({ kind: "found", zone: zones[1] });
    });
    test("--team names the folder, whatever the active team is", () => {
      expect(chooseZone(zones, repo, { org: null, team: "widgets", active: "gadgets" })).toEqual({ kind: "found", zone: zones[0] });
    });
    test("an unknown --team is missing", () => {
      expect(chooseZone(zones, repo, { org: null, team: "sprockets", active: "gadgets" })).toEqual({ kind: "missing" });
    });
    test("--zone filters by org before the team is picked", () => {
      expect(chooseZone(zones, repo, { org: "other", team: null, active: "gadgets" })).toEqual({ kind: "missing" });
    });
    test("with no active team and no --team, two claiming teams are ambiguous", () => {
      expect(chooseZone(zones, repo, { org: null, team: null, active: null })).toEqual({ kind: "ambiguous", zones });
    });
    test("a team on another host is a mismatch", () => {
      const other = [z("widgets", "gitlab.example.com", shared)];
      expect(chooseZone(other, repo, { org: null, team: "widgets", active: null })).toEqual({ kind: "mismatch", zone: other[0] });
    });
  });
```

Update the older `chooseZone` tests to pass `{ org: null, team: <the name they passed>, active: null }`. Every existing `initPack({ repoDir: REPO, zone: ... }, deps)` call gains `team: null`; where a test passed `zone: "acme"` to pick the team, it now passes `zone: null, team: "acme"`.

In the `initPack` describe (the `world()` helper gains `activeTeam: () => "acme"` in its default deps):

```ts
  test("a pack skeleton that never compiled is carried on: claim, materialize, compile, install", async () => {
    const pack = `${HOME}/.mattstack/teams/acme/mattstack/teams/acme/packs/acme`;
    const { deps, calls, fs } = world({
      files: orgFiles("acme", { "board.gitlabHost": "gitlab.com" }, { acme: {} }, {
        [`${pack}/.claude-plugin/plugin.json`]: `{ "name": "acme", "version": "0.1.0" }`,
        [`${pack}/pack/skills.jsonc`]: `{}`,
        [`${pack}/pack/stubs.jsonc`]: `{ "verbs": { "work": { "engine": "work", "description": "kept" } } }`,
        [`${HOME}/.mattstack/teams/acme/.claude-plugin/marketplace.json`]: `{ "name": "acme-market", "plugins": [{ "name": "acme", "source": "./mattstack/teams/acme/packs/acme" }] }`,
      }),
    });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out.ok).toBe(true);
    expect(fs.readFile(`${pack}/pack/stubs.jsonc`)).toContain('"kept"');
    expect(calls.claims).toEqual([["acme/acme", ["acme/api"]]]);
    expect(calls.compiled).toEqual([pack]);
    expect(calls.claude).toContainEqual(["plugin", "install", "acme@acme-market"]);
  });

  test("a pack with compiled output is never changed", async () => {
    const pack = `${HOME}/.mattstack/teams/acme/mattstack/teams/acme/packs/acme`;
    const { deps, calls } = world({
      files: orgFiles("acme", { "board.gitlabHost": "gitlab.com" }, { acme: {} }, {
        [`${pack}/pack/skills.jsonc`]: `{}`,
        [`${pack}/skills/work/SKILL.md`]: `compiled`,
      }),
    });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "pack-exists" });
    expect(calls.claims).toEqual([]);
  });

  test("with no --team the pack goes to the active team's folder", async () => {
    const { deps } = world({
      files: orgFiles("acme", { "board.gitlabHost": "gitlab.com", "board.projects": ["acme/api"] }, { widgets: {}, gadgets: {} }),
      activeTeam: () => "gadgets",
    });
    deps.materialize = async () => {
      deps.fs.mkdirp(`${HOME}/.mattstack/repos/gitlab.com-acme-api/packs/gadgets`);
      deps.fs.writeFile(`${HOME}/.mattstack/repos/gitlab.com-acme-api/packs/gadgets/skills.jsonc`, "{}");
      return { ok: true, detail: "merged" };
    };
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.pack).toMatchObject({ name: "gadgets", zone: "acme/gadgets" });
  });
```

In `commands/__tests__/skills-init.test.ts`, add a `parseInitArgs` case:

```ts
  test("--team names a team folder and --zone the clone", () => {
    expect(parseInitArgs(["--team", "gadgets", "--zone", "acme"])).toMatchObject({ team: "gadgets", zone: "acme" });
  });
```

(export `parseInitArgs` if it is not exported yet).

- [ ] **Step 2: Run to see them fail**

Run: `bun test lib/skills/__tests__/init.test.ts commands/__tests__/skills-init.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`lib/skills/init.ts`:

```ts
export type ZoneWanted = { org: string | null; team: string | null; active: string | null };

export function chooseZone(zones: ZoneInfo[], repo: RepoRef, wanted: ZoneWanted): ZoneChoice {
  const inOrg = wanted.org ? zones.filter((z) => z.org === wanted.org) : zones;
  const onHost = (z: ZoneInfo) => z.host === null || z.host === repo.host;
  const declares = (z: ZoneInfo) => z.projects.includes(repo.path);

  const named = wanted.team ?? wanted.active;
  if (named) {
    const zone = inOrg.find((z) => z.team === named);
    if (zone) return onHost(zone) ? { kind: "found", zone } : { kind: "mismatch", zone };
    if (wanted.team) return { kind: "missing" };
  }

  const declared = inOrg.filter((z) => onHost(z) && declares(z));
  if (declared.length === 1) return { kind: "found", zone: declared[0]! };
  if (declared.length > 1) return { kind: "ambiguous", zones: declared };
  const free = inOrg.filter((z) => onHost(z) && !z.hasPack);
  if (free.length === 1) return { kind: "found", zone: free[0]! };
  if (free.length > 1) return { kind: "ambiguous", zones: free };
  return { kind: "missing" };
}

/** A pack that compile has written into: its public verbs live under skills/, its stages and fills under attachments/. */
export function packIsCompiled(fs: Pick<InitFs, "readDir" | "exists">, packDir: string): boolean {
  return ["skills", "attachments"].some((side) =>
    fs.readDir(join(packDir, side)).some((name) => fs.exists(join(packDir, side, name, "SKILL.md"))),
  );
}
```

The `"has-pack"` member of `ZoneChoice` and its branch in `initPack` go; `"zone-has-pack"` stays in `InitRefusalCode` and `POLICY_REFUSALS` only if another caller emits it (`rg -n "zone-has-pack" lib commands`); otherwise remove it from both.

In `initPack`:

```ts
export async function initPack(opts: { repoDir: string; zone: string | null; team: string | null }, deps: InitDeps): Promise<InitOutcome> {
```

```ts
  const wanted = (): ZoneWanted => ({ org: opts.zone, team: wantedTeam, active: deps.activeTeam() });
  let wantedTeam = opts.team;
  let zones = readZones(deps.fs, deps.home);
  let choice = chooseZone(zones, repo, wanted());
  if (choice.kind === "missing" && opts.team === null && zones.length === 0) {
    if (!deps.isTTY) {
      return refuse("zone-missing", "This Mac has no org yet, so there is no team to hold a pack", "rt team create <name> --remote <url>");
    }
    const answer = await deps.promptZone();
    const created = await deps.createZone(answer.name, answer.remote);
    wantedTeam = created.team;
    zones = readZones(deps.fs, deps.home);
    choice = chooseZone(zones, repo, wanted());
  }
  if (choice.kind === "missing") {
    return refuse("zone-missing", wantedTeam ? `There is no team called ${wantedTeam}` : `No team on ${repo.host} is free for a new pack`, "rt skills init --team <name>");
  }
  if (choice.kind === "ambiguous") {
    return refuse("zone-ambiguous", `More than one team could hold this pack: ${choice.zones.map((z) => z.team).join(", ")}`, "rt skills init --team <name>");
  }
```

and the pack-exists check:

```ts
  const packDir = packDirOf(zone);
  if (packIsCompiled(deps.fs, packDir)) {
    return refuse("pack-exists", "This team already has a pack, and rt never changes an existing pack. To add to it, use the mattstack:extending-a-pack skill");
  }
```

In the write loop, an existing skeleton file is kept:

```ts
    for (const [rel, text] of Object.entries(renderPackFiles({ pack, workDescription }))) {
      const full = join(packDir, rel);
      if (deps.fs.exists(full)) continue;
      deps.fs.mkdirp(join(full, ".."));
      deps.fs.writeFile(full, text);
      wrote.push(full);
    }
```

`commands/skills-init.ts`: `InitArgs` gains `team: string | null` (default `null`); `parseInitArgs` gains `case "--team": out.team = value(a); break;`; the call becomes `initPack({ repoDir: parsed.repo, zone: parsed.zone, team: parsed.team }, resolvedDeps)`; `realDeps` gains `activeTeam: () => activeTeam().team,` (import `activeTeam` from `../packages/rt-client/src/settings/active-team.ts`); the header comment's usage line reads `rt skills init [--repo <path>] [--team <name>] [--zone <org>] [--json]` and its first sentence says the pack is named after its team folder; the two prompts read "Org name (a new org will be created)" and "Empty git remote URL for the org".

`lib/command-tree-def.ts`, the `skills init` node: add `{ name: "Team", flag: "--team", type: "text", placeholder: "widgets", hint: "The team folder that gets the pack; your own team when left out" }` and reword the `Zone` arg's hint to `The org clone, when this Mac has more than one`.

- [ ] **Step 4: Run, regenerate docs, commit**

```bash
bun test lib/skills commands/__tests__/skills-init.test.ts
bunx tsc --noEmit
bun run docs:gen
git add lib/skills/init.ts commands/skills-init.ts lib/command-tree-def.ts lib/skills/__tests__/init.test.ts commands/__tests__/skills-init.test.ts
git add $(git diff --name-only -- docs)
git commit -m "rt skills init: one pack per team folder, --team, and carry on a skeleton that never compiled"
```

### Task 17: A Mac installs only its active team's pack

**Files:**
- Create: `lib/team/active-team.ts` (the `Probes`-seamed twin of rt-client's `activeTeam`)
- Modify: `lib/setup/pack-cache.ts` (`readServedPacks`, `convergePackCache`)
- Modify: `lib/setup/steps/plugins.ts` (`computePlugins`), `lib/setup/apply.ts` (`ApplyContext.activeTeam`)
- Modify: `lib/setup/validators/tools.ts` (`toolRows`)
- Modify: `lib/setup/requirements.ts` (`readPackRequirements`)
- Test: `lib/team/__tests__/active-team.test.ts` (new), `lib/setup/__tests__/pack.test.ts`, `lib/setup/__tests__/pack-cache-converge.test.ts`, `lib/setup/__tests__/steps-c.test.ts`, `lib/setup/__tests__/validators-tools.test.ts`, `lib/setup/__tests__/requirements.test.ts`

**Interfaces:**
- Consumes: `decideActiveTeam`, `rosterFrom`, `type ActiveTeam` (Task 4), `parseStoreText`, `TEAM_NAME_RE` (Task 4), `readTeamLocal`.
- Produces:

```ts
// lib/team/active-team.ts
/** The active team as rt-client's activeTeam() decides it, read through Probes so setup and daemon code never touches the ambient HOME. */
export function activeTeamFor(p: Pick<Probes, "readFile" | "readDir" | "home">, org: string): ActiveTeam;

// lib/setup/pack-cache.ts
export function readServedPacks(p: Pick<Probes, "readFile" | "home">, slug: string, opts?: { only?: string | null }): ServedPacks;
// `only` unset: every entry. A string: that pack alone. null: none (this Mac has no active team).
export async function convergePackCache(p: Probes, slug: string, log: Logger, opts?: { now?: () => number; activeTeam?: () => string | null }): Promise<ConvergeResult>;

// lib/setup/apply.ts, on ApplyContext
/** Test seam: the active team's name. Production reads it from the org's roster through `p`. */
activeTeam?: () => string | null;

// lib/setup/requirements.ts
/** The active team's pack requirements; [] when this Mac has no active team or the pack declares none. */
export function readPackRequirements(p: Pick<Probes, "readDir" | "readFile" | "exists" | "home">, org: string, team?: string | null): PackRequirements[];
```

Every default goes through `activeTeamFor(p, slug)`, never rt-client's `activeTeam()`: this code runs under fake `Probes` in tests, and a context built from fake probes must not read the ambient HOME.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/team/__tests__/active-team.test.ts
import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { activeTeamFor } from "../active-team.ts";
import { teamLocalPath } from "../team-local.ts";

const HOME = "/h";
const ROOT = `${HOME}/.mattstack/teams/acme`;
const roster = [{ username: "dev1", teams: ["widgets"] }, { username: "dev2", teams: ["widgets", "gadgets"] }];

function probes(opts: { username?: string; setting?: string; folders?: string[] }) {
  return fakeProbes({
    home: HOME,
    dirs: { [`${ROOT}/mattstack/teams`]: opts.folders ?? [] },
    files: {
      [`${ROOT}/mattstack/org/settings.org.jsonc`]: `// org\n${JSON.stringify({ "mattstack.roster": roster })}`,
      ...(opts.username ? { [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: opts.username }) } : {}),
      ...(opts.setting ? { [`${HOME}/.mattstack/user/settings.user.jsonc`]: JSON.stringify({ "mattstack.activeTeam": opts.setting }) } : {}),
    },
  });
}

describe("activeTeamFor", () => {
  test("your first team, unless the user setting names another one you are on", () => {
    expect(activeTeamFor(probes({ username: "dev2" }), "acme")).toEqual({ org: "acme", team: "widgets", reason: "first-team", username: "dev2", listedOn: ["widgets", "gadgets"] });
    expect(activeTeamFor(probes({ username: "dev2", setting: "gadgets" }), "acme")).toMatchObject({ team: "gadgets", reason: "chosen" });
  });
  test("no team lists you: none", () => {
    expect(activeTeamFor(probes({ username: "stranger" }), "acme")).toMatchObject({ team: null, reason: "no-team" });
  });
  test("no stored username: the setting alone, and only for a team folder that exists", () => {
    expect(activeTeamFor(probes({ setting: "widgets", folders: ["widgets"] }), "acme")).toMatchObject({ team: "widgets", reason: "setting-only" });
    expect(activeTeamFor(probes({ setting: "widgets" }), "acme")).toMatchObject({ team: null, reason: "identity" });
    expect(activeTeamFor(probes({}), "acme")).toMatchObject({ team: null, reason: "identity" });
  });
  test("a missing org store reads as no roster", () => {
    expect(activeTeamFor(fakeProbes({ home: HOME, files: { [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: "dev1" }) } }), "acme")).toMatchObject({ team: null, reason: "no-team" });
  });
});
```

In `lib/setup/__tests__/pack.test.ts`:

```ts
  describe("readServedPacks filter", () => {
    const market = JSON.stringify({ name: "acme", plugins: [
      { name: "widgets", source: "./mattstack/teams/widgets/packs/widgets" },
      { name: "gadgets", source: "./mattstack/teams/gadgets/packs/gadgets" },
    ] });
    const p = fakeProbes({ home: "/h", files: { "/h/.mattstack/teams/acme/.claude-plugin/marketplace.json": market } });

    test("with no filter every entry is served", () => {
      expect(readServedPacks(p, "acme").packs.map((x) => x.name)).toEqual(["widgets", "gadgets"]);
    });
    test("only names the one pack this Mac installs", () => {
      expect(readServedPacks(p, "acme", { only: "gadgets" }).packs.map((x) => x.id)).toEqual(["gadgets@acme"]);
    });
    test("null means no active team, so nothing is served", () => {
      expect(readServedPacks(p, "acme", { only: null }).packs).toEqual([]);
    });
  });
```

In `lib/setup/__tests__/steps-c.test.ts`, inside `describe("plugins.install", ...)`:

```ts
    test("only the active team's marketplace entry is team-authored; another team's pack is not installed", () => {
      const { ctx } = makeCtx(fakeProbes({ home: "/h" }), { team: { slug: "acme", name: "Acme", mode: "none" }, activeTeam: () => "widgets" });
      const market = { name: "acme", plugins: [{ name: "widgets" }, { name: "gadgets" }] };
      expect(computePlugins(ctx, market).teamAuthored).toEqual(["widgets@acme"]);
    });

    test("a Mac with no active team installs no team pack", () => {
      const { ctx } = makeCtx(fakeProbes({ home: "/h" }), { team: { slug: "acme", name: "Acme", mode: "none" }, activeTeam: () => null });
      expect(computePlugins(ctx, { name: "acme", plugins: [{ name: "widgets" }] }).teamAuthored).toEqual([]);
    });

    test("with no seam the active team comes from the org's roster through probes", () => {
      const p = fakeProbes({
        home: "/h",
        files: {
          "/h/.mattstack/teams/acme/mattstack/org/settings.org.jsonc": JSON.stringify({ "mattstack.roster": [{ username: "dev1", teams: ["gadgets"] }] }),
          "/h/.mattstack/rt/teams/acme.json": JSON.stringify({ forgeUsername: "dev1" }),
        },
      });
      const { ctx } = makeCtx(p, { team: { slug: "acme", name: "Acme", mode: "none" } });
      expect(computePlugins(ctx, { name: "acme", plugins: [{ name: "widgets" }, { name: "gadgets" }] }).teamAuthored).toEqual(["gadgets@acme"]);
    });
```

In `lib/setup/__tests__/requirements.test.ts`:

```ts
  describe("the active team's pack", () => {
    const REQ = JSON.stringify({ tools: [{ name: "jq", why: "parses json" }], integrations: [] });
    const files = {
      "/h/.mattstack/teams/acme/mattstack/teams/widgets/packs/widgets/requirements.jsonc": REQ,
      "/h/.mattstack/teams/acme/mattstack/teams/gadgets/packs/gadgets/requirements.jsonc": JSON.stringify({ tools: [{ name: "yq", why: "parses yaml" }], integrations: [] }),
    };
    test("reads only the named team's pack", () => {
      const reqs = readPackRequirements(fakeProbes({ home: "/h", files }), "acme", "widgets");
      expect(reqs.map((r) => [r.pack, r.tools.map((t) => t.name)])).toEqual([["widgets", ["jq"]]]);
    });
    test("no active team, or a pack with no requirements file, is no requirements", () => {
      expect(readPackRequirements(fakeProbes({ home: "/h", files }), "acme", null)).toEqual([]);
      expect(readPackRequirements(fakeProbes({ home: "/h", files }), "acme", "sprockets")).toEqual([]);
    });
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `bun test lib/team/__tests__/active-team.test.ts lib/setup/__tests__/pack.test.ts lib/setup/__tests__/steps-c.test.ts lib/setup/__tests__/requirements.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the probes twin**

```ts
// lib/team/active-team.ts
import { join } from "path";
import { decideActiveTeam, rosterFrom, type ActiveTeam } from "../../packages/rt-client/src/settings/active-team.ts";
import { parseStoreText, TEAM_NAME_RE } from "../../packages/rt-client/src/settings/stores.ts";
import type { Probes } from "../setup/probes.ts";
import { readTeamLocal } from "./team-local.ts";

/** The active team as rt-client's activeTeam() decides it, read through Probes so setup and daemon code never touches the ambient HOME. */
export function activeTeamFor(p: Pick<Probes, "readFile" | "readDir" | "home">, org: string): ActiveTeam {
  const orgFile = join(p.home, ".mattstack", "teams", org, "mattstack", "org", "settings.org.jsonc");
  const userFile = join(p.home, ".mattstack", "user", "settings.user.jsonc");
  const orgRaw = p.readFile(orgFile);
  const userRaw = p.readFile(userFile);
  const setting = userRaw === null ? undefined : parseStoreText(userFile, userRaw).global["mattstack.activeTeam"];
  const username = readTeamLocal(p, org).forgeUsername ?? null;
  const decision = decideActiveTeam({
    username,
    roster: orgRaw === null ? [] : rosterFrom(parseStoreText(orgFile, orgRaw)),
    setting: typeof setting === "string" ? setting : undefined,
    teamFolders: () => p.readDir(join(p.home, ".mattstack", "teams", org, "mattstack", "teams")).filter((name) => TEAM_NAME_RE.test(name)),
  });
  return { org, username, ...decision };
}
```

- [ ] **Step 4: Filter what is served, installed and required**

`lib/setup/pack-cache.ts`:

```ts
export function readServedPacks(p: Pick<Probes, "readFile" | "home">, slug: string, opts: { only?: string | null } = {}): ServedPacks {
```

and inside the entry loop, after the name check:

```ts
    if (opts.only !== undefined && entry.name !== opts.only) continue;
```

In `convergePackCache`, add `activeTeam?: () => string | null` to its opts and read the filtered list:

```ts
  const team = (opts.activeTeam ?? (() => activeTeamFor(p, slug).team))();
  const servedPacks = readServedPacks(p, slug, { only: team });
```

Add to the function's doc comment: "Only the active team's pack is converged; a Mac on no team converges none."

`lib/setup/apply.ts`: add the `activeTeam` seam to `ApplyContext` as in the Interfaces block.

`lib/setup/steps/plugins.ts`, in `computePlugins`, the marketplace half becomes:

```ts
  const marketplaceName = teamMarketplace?.name ?? ctx.team.slug;
  const active = ctx.activeTeam ? ctx.activeTeam() : ctx.team.slug ? activeTeamFor(ctx.p, ctx.team.slug).team : null;
  const teamPlugins = (teamMarketplace?.plugins ?? [])
    .map((plugin) => plugin.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0 && name === active)
    .map((name) => `${name}@${marketplaceName}`);
```

Update the comment on `ComputedPlugins.teamAuthored` to say "the active team's entry in the org's marketplace.json".

`lib/setup/validators/tools.ts`, in `toolRows`:

```ts
  const only = opts.activeTeam !== undefined ? opts.activeTeam : opts.teamSlug ? activeTeamFor(p, opts.teamSlug).team : null;
  const served = opts.teamSlug ? readServedPacks(p, opts.teamSlug, { only }) : { packs: [], error: null };
```

with `activeTeam?: string | null` added to its `opts` type.

`lib/setup/requirements.ts`: a pack's requirements file now sits at `teams/<org>/mattstack/teams/<team>/packs/<team>/requirements.jsonc`, six segments below the clone root, past the old finder's depth of four; and only the active team's pack is this Mac's. Replace the recursive finder with a direct read:

```ts
/** teams/<org>/mattstack/teams/<team>/packs/<team>/requirements.jsonc: the active team's pack, the only one this Mac installs. */
export function readPackRequirements(p: Pick<Probes, "readDir" | "readFile" | "exists" | "home">, org: string, team: string | null = activeTeamFor(p, org).team): PackRequirements[] {
  if (team === null) return [];
  const file = join(p.home, ".mattstack", "teams", org, "mattstack", "teams", team, "packs", team, REQUIREMENTS_FILE);
  if (!p.exists(file)) return [];
  const text = p.readFile(file);
  // A file that is there but cannot be read is reported, never skipped.
  if (text === null) return [{ pack: team, tools: [], integrations: [], error: `could not read ${file}` }];
  return [parseRequirements(team, text)];
}
```

and delete `findRequirementsFiles`, `MAX_DEPTH` and `SKIP_DIRS`. Reword the file's header comment to the new path. Its callers (`createApplyContext` and `reloadTeam` in `lib/setup/apply.ts`, `composePlan` in `lib/setup/plan.ts`, and `commands/tools.ts`) keep calling it with the org slug alone.

- [ ] **Step 5: Give the existing tests an active team**

With no org seeded, the default active team is none, so every existing test that expected a team pack to be installed, converged or listed now needs one named:

- `lib/setup/__tests__/pack-cache-converge.test.ts`: each of its sixteen `convergePackCache(p, "acme", log)` calls passes `{ activeTeam: () => "<the pack that test serves>" }` (merged with `now` where the test already passes it). Add one test: two served packs, `activeTeam: () => "widgets"`, and only `widgets@...` is installed; and one with `activeTeam: () => null` that converges nothing.
- `lib/setup/__tests__/steps-c.test.ts`: the `plugins.install` tests that seed a team marketplace and expect its pack (about eleven, for example lines 288 to 330) build their context with `activeTeam: () => "<that pack's name>"`.
- `lib/setup/__tests__/validators-tools.test.ts`: tests that expect a pack row pass `activeTeam: "<that pack's name>"`; add one asserting that with two entries and `activeTeam: "widgets"` only `pack.widgets` gets a row.
- `lib/setup/__tests__/requirements.test.ts`: the older tests seed `teams/<slug>/mattstack/packs/<pack>/requirements.jsonc`; they seed `teams/<slug>/mattstack/teams/<pack>/packs/<pack>/requirements.jsonc` and pass the team name as the third argument. Keep "an unreadable file yields one error entry naming the file" on the new path, and delete the tests of the recursive finder's depth and skip rules.
- Anything in `commands/__tests__/setup-*.test.ts` that asserted a pack row or a `plugin install <pack>@...` call: give its probes the org store and the record (`mattstack.roster` listing a username on the team, and `rt/teams/<org>.json` with that `forgeUsername`), which is what a real Mac has.

- [ ] **Step 6: Run and commit**

```bash
bun test lib/setup lib/team lib/daemon/__tests__ commands/__tests__
bunx tsc --noEmit
git add lib/team/active-team.ts lib/team/__tests__/active-team.test.ts lib/setup/pack-cache.ts lib/setup/apply.ts lib/setup/steps/plugins.ts lib/setup/validators/tools.ts lib/setup/requirements.ts
git add $(git diff --name-only -- '*.test.ts')
git commit -m "setup: install, converge and require only the active team's pack"
```

### Task 18: Retire `board.defaultPack` and `board.members`; the board and boxscore read the active team

**Files:**
- Modify: `packages/rt-client/src/settings/registry-machinery.ts` (`RETIRED_KEYS`)
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (delete both rows), `registry-schemas.ts` (delete `board.members`), `schema.lock.json` (regenerated), `breaking-schema-changes.json`
- Modify: `packages/rt-client/src/settings/active-team.ts` (`activeTeamPack`, `mergeTeamRoster`), `packages/rt-client/src/index.ts`
- Modify: `lib/setup/steps/skills.ts` (delete `seedDefaultPack`, `teamPacks` and both call sites)
- Modify: `lib/team/invite.ts`, `lib/team/members.ts`, `commands/team.ts` (drop the `board.members` dual write and fallback)
- Modify: `apps/board/src/config.ts`, `apps/board/src/manifest-bindings.ts`, `apps/board/src/review-launch.ts`, `apps/board/src/client/board/StatusLine.tsx`, `apps/board/src/client/board/ConfigModal.tsx`, `apps/board/src/client/board/config-shapes.ts`, `apps/board/docs/configuration.md`, `apps/board/docs/agent-actions.md`
- Modify: `apps/boxscore/src/server/config/index.ts`, `apps/boxscore/scripts/import-legacy-settings.ts`
- Modify: `apps/board/src/unconfigured.ts` (line 25), `lib/team/create.ts` (the comment near line 64)
- Modify: `packages/settings-kit/src/shapes.ts` (drop the `board.members` shape), `packages/settings-kit/README.md`
- Test: `packages/rt-client/src/settings/__tests__/active-team.test.ts`, `registry.test.ts`, `apps/board/src/__tests__/config.test.ts`, `manifest-bindings.test.ts`, `config-store-latch.test.ts`, `apps/boxscore` config tests, `lib/setup/__tests__/steps-b.test.ts`, `lib/team/__tests__/invite.test.ts`, `members.test.ts`

**Interfaces:**
- Produces, from rt-client:

```ts
/** The active team's pack: the team's own name when its folder holds a pack that is not a base; else null. */
export function activeTeamPack(): string | null;
/**
 * The full roster after an edit made in one team's view: members of other
 * teams are untouched, a member added in the view joins `team`, and a member
 * removed from the view leaves `team` but stays in the org.
 */
export function mergeTeamRoster(full: RosterEntry[], team: string | null, edited: RosterEntry[]): RosterEntry[];
```

- `BoardConfig.defaultPack` is renamed `teamPack`.

- [ ] **Step 1: Write the failing rt-client tests**

Add to `active-team.test.ts`:

```ts
describe("mergeTeamRoster", () => {
  const full: RosterEntry[] = [
    { username: "dev1", name: "Dev One", agePublicKey: "age1aaa", teams: ["widgets"] },
    { username: "dev2", teams: ["widgets", "gadgets"] },
    { username: "dev3", teams: ["gadgets"] },
  ];

  test("an edit in one team's view never touches members of other teams", () => {
    const out = mergeTeamRoster(full, "widgets", [{ username: "dev1", name: "Dev 1" }, { username: "dev2" }]);
    expect(out).toEqual([
      { username: "dev1", name: "Dev 1", agePublicKey: "age1aaa", teams: ["widgets"] },
      { username: "dev2", teams: ["widgets", "gadgets"] },
      { username: "dev3", teams: ["gadgets"] },
    ]);
  });

  test("a member added in the view joins that team; one already in the org gains it", () => {
    const out = mergeTeamRoster(full, "widgets", [{ username: "dev1" }, { username: "dev2" }, { username: "DEV3" }, { username: "dev4", name: "Dev Four" }]);
    expect(out.find((e) => e.username === "dev3")!.teams).toEqual(["gadgets", "widgets"]);
    expect(out[3]).toEqual({ username: "dev4", name: "Dev Four", teams: ["widgets"] });
  });

  test("a member removed from the view leaves the team but stays in the org", () => {
    const out = mergeTeamRoster(full, "widgets", [{ username: "dev2" }]);
    expect(out[0]).toEqual({ username: "dev1", name: "Dev One", agePublicKey: "age1aaa", teams: [] });
    expect(out.length).toBe(3);
  });

  test("with no active team the edit is the whole roster", () => {
    expect(mergeTeamRoster(full, null, [{ username: "dev9" }])).toEqual([{ username: "dev9" }]);
  });
});

describe("activeTeamPack", () => {
  const origHome = process.env.HOME;
  let home: string;
  beforeEach(() => { home = realpathSync(mkdtempSync(join(tmpdir(), "rt-active-pack-"))); process.env.HOME = home; });
  afterEach(() => { process.env.HOME = origHome; rmSync(home, { recursive: true, force: true }); });

  function seed(fragment: string | null): void {
    seedOrg({ org: "acme", username: "dev1", roster: [{ username: "dev1", teams: ["widgets"] }], teams: { widgets: {} } });
    if (fragment !== null) {
      const file = join(teamPackDir("acme", "widgets"), "pack", "skills.jsonc");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, fragment);
    }
  }

  test("the team's name when its folder holds a pack", () => {
    seed(`// bindings\n{ "version": 1 }`);
    expect(activeTeamPack()).toBe("widgets");
  });
  test("null with no pack, a base pack, an unreadable fragment, or no active team", () => {
    seed(null);
    expect(activeTeamPack()).toBeNull();
    seed(`{ "base": true }`);
    expect(activeTeamPack()).toBeNull();
    seed(`{ not json`);
    expect(activeTeamPack()).toBeNull();
    seedOrg({ org: "acme", username: "stranger", teams: { widgets: {} } });
    expect(activeTeamPack()).toBeNull();
  });
});
```

Add to `registry.test.ts`:

```ts
  test("board.defaultPack and board.members are retired: gone from the registry, still removable from a store", () => {
    expect(getDef("board.defaultPack")).toBeUndefined();
    expect(getDef("board.members")).toBeUndefined();
    expect(isRetiredKey("board.defaultPack")).toBe(true);
    expect(isRetiredKey("board.members")).toBe(true);
  });
```

and remove both names from the file's pinned key list.

- [ ] **Step 2: Run to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/active-team.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement in rt-client**

`registry-machinery.ts`:

```ts
const RETIRED_KEYS: ReadonlySet<string> = new Set(["mattstack.mode", "board.defaultPack", "board.members"]);
```

Delete the `board.defaultPack` and `board.members` rows from `registry-defs.ts` and the `board.members` schema from `registry-schemas.ts`. In `board.hiddenMembers`' description, "the authors tab's board.members roster" becomes "the authors tab's roster". Add to `breaking-schema-changes.json`:

```json
  "board.members": "Retired: the org roster (mattstack.roster) is the one member list."
```

then `bun run cli.ts settings schema lock && bun run cli.ts settings schema diff` (the diff accepts the removal because of that entry).

`active-team.ts`:

```ts
import { readFileSync } from "fs";
import { join } from "path";
import { parse, type ParseError } from "jsonc-parser";
import { orgSettingsPath, teamPackDir, userSettingsPath } from "./paths.ts";
```

```ts
export function activeTeamPack(): string | null {
  const { org, team } = activeTeam();
  if (org === null || team === null) return null;
  try {
    const errors: ParseError[] = [];
    const fragment: unknown = parse(readFileSync(join(teamPackDir(org, team), "pack", "skills.jsonc"), "utf8"), errors, { allowTrailingComma: true });
    if (errors.length > 0 || fragment === null || typeof fragment !== "object" || Array.isArray(fragment)) return null;
    return (fragment as { base?: unknown }).base === true ? null : team;
  } catch {
    return null;
  }
}

export function mergeTeamRoster(full: RosterEntry[], team: string | null, edited: RosterEntry[]): RosterEntry[] {
  if (team === null) return edited;
  const inView = (username: string) => edited.find((e) => sameUser(e.username, username));
  const out: RosterEntry[] = full.map((entry) => {
    const teams = strings(entry.teams);
    const kept = inView(entry.username);
    if (kept) return { ...entry, ...kept, username: entry.username, teams: teams.includes(team) ? teams : [...teams, team] };
    return teams.includes(team) ? { ...entry, teams: teams.filter((t) => t !== team) } : entry;
  });
  for (const added of edited) {
    if (!full.some((entry) => sameUser(entry.username, added.username))) out.push({ ...added, teams: [team] });
  }
  return out;
}
```

Export both from `index.ts` on the active-team line.

- [ ] **Step 4: Drop the seed step and the dual write**

`lib/setup/steps/skills.ts`: delete `seedDefaultPack`, `teamPacks`, the `try { seedDefaultPack(...) } catch` block in `skillsMaterializeRun` (and its comment), the `if (seedDefaultPack(ctx, "board.keys")) ...` line in `boardKeysRun`, and the now-unused `isBasePack`, `isPackDir` imports. In `lib/setup/__tests__/steps-b.test.ts`, delete the `describe("seeds board.defaultPack", ...)` block and the two `!l.line.startsWith("board.defaultPack")` filters around line 929 (the assertions become `expect(logs.filter((l) => l.id === "skills.materialize")).toEqual([])`).

`lib/team/invite.ts` `addToRoster`:

```ts
/** Adds the handle to the org roster unless it is already there. */
function addToRoster(seams: MintInviteSeams, slug: string, handle: string): void {
  const store = seams.readTeamStore(slug);
  const existing = Array.isArray(store["mattstack.roster"]) ? (store["mattstack.roster"] as RosterEntryLike[]) : [];
  if (existing.some((m) => m.username === handle)) return;
  seams.writeSetting("mattstack.roster", [...existing, { username: handle }], "org");
}
```

(rename the local `BoardMember` interface to `RosterEntryLike`; Task 27 gives the entry its teams.)

`lib/team/members.ts`: delete `ROSTER_KEYS`, `RosterKey` and `preferredRoster`; `readRoster(seams, slug)` reads `mattstack.roster` only; `recordRosterKey` and `membersRemove` write `mattstack.roster` only (delete the `boardRoster` / `boardHad` halves; `rosterRemoved` is `crossAppHad`). `commands/team.ts`: line 497 reads `readRoster`'s source directly (`readStore(orgSettingsPath(slug)).global["mattstack.roster"]`), and `teamStatus`'s member read drops the `board.members` fallback and its warning copy says `mattstack.roster`. Update the tests in `lib/team/__tests__/invite.test.ts`, `members.test.ts` and `commands/__tests__/team*.test.ts` that asserted two writes: they assert one, to `mattstack.roster` at `org`.

- [ ] **Step 5: The board reads the active team's pack and roster**

`apps/board/src/config.ts`:

- Import `activeTeam`, `activeTeamPack`, `mergeTeamRoster` from `@mattstack/rt-client`, and add one seam object the tests replace, so no loader signature changes:

```ts
/** What this Mac's active team contributes to the board's config. Tests replace the fields; production reads rt-client. */
export const teamView: {
  pack: () => string | null;
  team: () => string | null;
} = {
  pack: activeTeamPack,
  team: () => activeTeam().team,
};
```

The roster is not on the seam: it comes from the injected resolver, like every other store value, and only the team's name comes from the seam.

- Rename `BoardConfig.defaultPack` to `teamPack` with the doc comment `/** The active team's pack; a launch from a tab that names no pack uses it. "" when this Mac has no team pack. */`.
- In `parseConfig`, delete the `defaultPack` type check and its field; `teamPack: ''` is the parsed default (the legacy `config.json` field is no longer read).
- `ROSTER_KEYS` becomes `['mattstack.roster'] as const`, and `rosterFromStore` answers the active team's members when the store owns the roster:

```ts
type StoredMember = Member & { teams?: string[] };

/** The roster the store owns, narrowed to the active team. A Mac on no team,
    and a team nobody is listed on, see everyone: an empty member list fails
    parseConfig's required-field check and would take the whole board down. */
function rosterFromStore(
  resolve: GetSettingFn
): { key: RosterStoreKey; members: Member[]; team: string | null } | null {
  const all = storeValue<StoredMember[]>('mattstack.roster', resolve);
  if (all === undefined) return null;
  const team = teamView.team();
  const onTeam = team === null ? [] : all.filter(m => (m.teams ?? []).includes(team));
  // `team` is the team the list is narrowed to, null when it is everyone: a
  // save from the everyone view must never put the whole org on one team.
  return onTeam.length > 0
    ? { key: 'mattstack.roster', members: onTeam, team }
    : { key: 'mattstack.roster', members: all, team: null };
}
```

- In `withBoardStoreFallback`, delete the `defaultPack:` lines from `merged`, and set the pack after the round trip (`parseConfig` rebuilds the object and would discard a value set before it):

```ts
  const parsed = parseConfig(
    JSON.stringify(merged),
    'a board.* team settings-store value'
  );
  return { ...parsed, teamPack: teamView.pack() ?? '' };
```

- `saveRosterMembers` merges before it writes, so a save from one team's view cannot drop another team's members. Its store branch becomes:

```ts
  if (owner) {
    const edited = next.map(({ hidden: _hidden, ...rest }) => rest);
    const full = storeValue<Member[]>('mattstack.roster', resolve) ?? [];
    write('mattstack.roster', mergeTeamRoster(full, owner.team, edited), 'org');
  } else {
```

and its doc comment drops the sentence about `board.members`.

`apps/board/src/manifest-bindings.ts`: `const pack = tab?.pack || cfg.teamPack;` and the comment above `packForLaunch` reads "the launching tab's pack, else the active team's pack, else none".

`apps/board/src/review-launch.ts` line 44 and `config.ts` line 136: the comments say "the active team's pack" instead of `board.defaultPack`.

`apps/board/src/client/board/StatusLine.tsx`:

```ts
  'No pack selected. Launched the generic skill. Set a pack on the tab, or join a team that has one.';
```

`ConfigModal.tsx` line 934: `placeholder="your team's pack"`; and remove the `board.members` entries near lines 1002 and 1099 to 1115 (the roster row is `mattstack.roster` alone). `config-shapes.ts` line 64: delete the `'board.members'` shape.

Tests. Each board test file that loads config sets the seam in `beforeEach` and restores it in `afterEach`:

```ts
const realView = { ...teamView };
beforeEach(() => {
  teamView.pack = () => null;
  teamView.team = () => null;
});
afterEach(() => {
  Object.assign(teamView, realView);
});
```

`config.test.ts` drops the `defaultPack` parse tests and adds:

```ts
  test('a legacy defaultPack in config.json is ignored', () => {
    expect(parseConfig(JSON.stringify({ ...base, defaultPack: 'widgets' })).teamPack).toBe('');
  });
```

`manifest-bindings.test.ts` renames the field in its fixtures. `config-store-latch.test.ts` replaces "board.defaultPack reads from the store" with (use the file's existing way of loading config through `fakeResolve`):

```ts
  const twoTeams = [
    { username: 'dev1', teams: ['widgets'] },
    { username: 'dev3', teams: ['gadgets'] },
  ];

  test('the team pack comes from the active team, never from a setting, and survives the store round trip', () => {
    teamView.pack = () => 'widgets';
    const cfg = loadConfigFrom(
      tmpConfig(),
      fakeResolve({ 'board.title': 'Acme', 'board.defaultPack': 'gadgets' })
    );
    expect(cfg.title).toBe('Acme');
    expect(cfg.teamPack).toBe('widgets');
  });

  test("the roster is the active team's members", () => {
    teamView.team = () => 'widgets';
    const cfg = loadConfigFrom(tmpConfig(), fakeResolve({ 'mattstack.roster': twoTeams }));
    expect(cfg.members.map(m => m.username)).toEqual(['dev1']);
  });

  test('a Mac on no team, and a team nobody is listed on, see the whole roster instead of failing to load', () => {
    const everyone = loadConfigFrom(tmpConfig(), fakeResolve({ 'mattstack.roster': twoTeams }));
    expect(everyone.members.map(m => m.username)).toEqual(['dev1', 'dev3']);
    teamView.team = () => 'sprockets';
    const empty = loadConfigFrom(tmpConfig(), fakeResolve({ 'mattstack.roster': twoTeams }));
    expect(empty.members.map(m => m.username)).toEqual(['dev1', 'dev3']);
  });

  test('a save from the everyone view replaces the roster as edited and puts nobody on a team', () => {
    teamView.team = () => 'sprockets';
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveRosterMembers(twoTeams, tmpConfig(), fakeResolve({ 'mattstack.roster': twoTeams }), fakeWrite(calls));
    expect(calls[0]!.value).toEqual(twoTeams);
  });

  test("saving from one team's view writes the org roster, keeps the other team's members, and reloads", () => {
    teamView.team = () => 'widgets';
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const cfg = saveRosterMembers(
      [{ username: 'dev1' }, { username: 'dev4' }],
      tmpConfig(),
      fakeResolve({ 'mattstack.roster': twoTeams }),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      {
        key: 'mattstack.roster',
        value: [
          { username: 'dev1', teams: ['widgets'] },
          { username: 'dev3', teams: ['gadgets'] },
          { username: 'dev4', teams: ['widgets'] },
        ],
        scope: 'org',
      },
    ]);
    expect(cfg.members.map(m => m.username)).toEqual(['dev1']);
  });
```

(`tmpConfig`, `fakeResolve` and `fakeWrite` are that file's own helpers; the reload reads the fake resolver's unchanged roster, which is why the last line still sees `dev1` alone.) In the same file, delete the tests whose point was `board.members` as a roster source or write target; a test that seeded `board.members` beside `mattstack.roster` drops that seed and keeps its Task 8 scope assertion.

Update `apps/board/docs/configuration.md` (the `defaultPack` row goes; the pack rule reads "the tab's `pack`, else your active team's pack") and `apps/board/docs/agent-actions.md` lines 91 to 96 the same way.

`apps/board/src/unconfigured.ts` line 25 tells people to set `board.members`; the sentence becomes: "join a team that has them, or set `board.gitlabHost` and `board.projects` with `rt settings` and add yourself with `rt team members`" (keep the `<code>` markup the line uses). In `lib/team/create.ts`, the comment near line 64 says "`board.projects`/`board.members` are deliberately NOT written"; it names `board.projects` alone.

- [ ] **Step 6: boxscore reads the active team's roster**

`apps/boxscore/src/server/config/index.ts`: add a roster seam beside `reader`:

```ts
let rosterReader: (() => RosterEntry[]) | null = null;

/** Test seam, like __setSettingReader. */
export function __setRosterReader(r: (() => RosterEntry[]) | null): void {
  rosterReader = r;
}

function teamRoster(): RosterEntry[] {
  if (rosterReader) return rosterReader();
  if (process.env.VITEST) throw new Error('tests must inject a roster reader (__setRosterReader)');
  return activeTeamRoster() as RosterEntry[];
}
```

and in `readSettings`: `const roster = teamRoster();`. Tests that injected `mattstack.roster` through the setting reader inject it through `__setRosterReader` instead; add one asserting `users` holds only the injected team's members.

`apps/boxscore/scripts/import-legacy-settings.ts` line 151 reads `board.members` through `getSetting`, which throws for a retired key. The script merges the legacy users into whatever roster exists, so it reads the roster itself:

```ts
  const existing =
    getSetting<RosterEntry[] | undefined>('mattstack.roster').value ?? [];
```

and passes `existing` where it passed `board` (rename the local; `mergeRoster`'s first parameter name follows).

- [ ] **Step 7: Run everything**

```bash
(cd packages/rt-client && bun run build) && (cd packages/settings-kit && bun run build)
bunx tsc --noEmit
bun run test
bun run board:typecheck && bun run board:test
bun run boxscore:typecheck && bun run boxscore:test
bun run console:test
rg -n "board\.defaultPack|board\.members|defaultPack" --glob '!docs/**' --glob '!**/dist/**' --glob '!**/node_modules/**' .
```

Expected: all green. The `rg` still prints, and only prints: `RETIRED_KEYS` and the breaking-changes entry; the registry test that pins both keys as retired; the two board tests that pass a legacy `defaultPack` on purpose; `lib/setup/migrations/` once Task 36 exists (not yet); `packages/rt-client/src/settings/schema.lock.json` must not appear; and the plugin files Task 19 fixes (`plugins/mattstack/README.md`). Anything else is a reader this task missed: fix it here.

- [ ] **Step 8: Look at the board and boxscore, both schemes**

Seed a scratch HOME as in Task 8 Step 8, adding a pack skeleton for `widgets` (`mattstack/teams/widgets/packs/widgets/pack/skills.jsonc` with `{}`) and `"board.projects": ["acme/widgets"]` in the org settings. Serve the board (`cd apps/board && bun run build:client && HOME="$RT_SCRATCH_HOME" bun run serve`) and boxscore (`cd apps/boxscore && bun run build && HOME="$RT_SCRATCH_HOME" bun run serve`) from this worktree, on free ports. With `fast-browser:fast-browsing`, screenshot each in light and dark and check:

- Board: the authors tab lists `dev1` only (the active team), not `dev2`; the settings modal's roster shows the same one member; no "no pack" pill.
- Board, after rewriting the record to `forgeUsername: "stranger"`: the "no pack" pill shows and the roster is everyone.
- Boxscore: the leaderboard's people are the active team's.

The board polls a forge; with no token it shows its own empty state, which is fine: the roster and the pill are what this check is about. Say plainly what looks wrong.

- [ ] **Step 9: Commit**

```bash
git status --short
git add packages/rt-client/src packages/settings-kit/src/shapes.ts packages/settings-kit/README.md lib/setup/steps/skills.ts lib/team/invite.ts lib/team/members.ts commands/team.ts apps/board/src apps/board/docs/configuration.md apps/board/docs/agent-actions.md apps/boxscore/src/server/config apps/boxscore/scripts/import-legacy-settings.ts lib/team/create.ts
git add $(git diff --name-only -- '*.test.ts' '*.test.tsx')
git commit -m "retire board.defaultPack and board.members: the board and boxscore read the active team's pack and roster"
```

### Task 19: The pack skills and docs

**Files:**
- Modify: `plugins/mattstack/plugin/skills/creating-a-pack/SKILL.md`, `plugins/mattstack/plugin/skills/extending-a-pack/SKILL.md`, `plugins/mattstack/docs/your-first-pack.md`, `plugins/mattstack/README.md`, `plugins/mattstack/attachments/parameterized-skills/references/convention.md`, `plugins/mattstack/plugin/skills/editing-skills/SKILL.md`
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (version bump)

- [ ] **Step 1: Load the skill-writing skills**

Invoke `superpowers:writing-skills` and `mattstack:editing-skills` and follow them: run the baseline they ask for before editing.

- [ ] **Step 2: Make these content changes**

1. Where a pack lives: `mattstack/teams/<team>/packs/<team>/` in the org repo; the pack is named after its team folder; one pack per team folder.
2. `rt skills init --team <name>` puts the pack in that team's folder (your own team when left out). After `rt team add`, the team already has a skeleton and `rt skills init` carries it on.
3. Which repos a pack binds: the team's `board.projects` (the org's list unless the team sets its own), on the org's forge host. `team.jsonc` is gone; remove every mention, including line 53 of `your-first-pack.md` and line 264 of the creating-a-pack skill.
4. The base pack: a folder the org admin adds by hand at `mattstack/org/packs/<org>-base/` holding `pack/skills.jsonc` with `"base": true`, `pack/surface.jsonc` with `{ "public": [] }`, and its fills under `attachments/` (never `skills/`: nothing installs a base pack, so its fills are always inlined). A team pack names it with `"extends": "<org>-base"`. It is never added to `claude.plugins` and has no marketplace entry.
5. An org-defined verb: a team lists it in its pack's verb roster (`pack/stubs.jsonc`) and compiles; with no team fill for a slot the org's fill lands; the verb is the team's (`widgets:watch-ci`).
6. Known drift: bindings follow the base at once on every Mac; compiled fills follow at the team owner's next `rt skills compile`.
7. `plugins/mattstack/README.md` line 128: "`MATTSTACK_PACK` set from the tab's `pack`, else your active team's pack".
8. `convention.md` line 360: drop the sentence that names `merge-manifests.sh` as the way to regenerate bindings if it describes `team.jsonc`; keep the wrapper's own description.

9. `editing-skills/SKILL.md`, "The two estates" table (near line 32): the team pack's source is `~/.mattstack/teams/acme/mattstack/teams/widgets/packs/widgets/skills/<name>/` (hand-authored) or `.../packs/widgets/attachments/<fill>/` (fills), its manifest `.../packs/widgets/.claude-plugin/plugin.json`, and the column heading reads "Team pack (widgets, in the acme org)". Keep the table's width formatting.

Placeholders only (`acme`, `widgets`, `gadgets`, `acme-base`).

- [ ] **Step 3: Bump, check, commit**

Bump the patch version in `plugins/mattstack/.claude-plugin/plugin.json`.

```bash
bun cli.ts skills check --pack-dir "$PWD/plugins/mattstack" --mattstack-dir "$PWD" --strict
sh plugins/mattstack/tests/certify.sh plugins/mattstack 2>/dev/null || true
bash plugins/mattstack/plugin/tests/test-merge-manifests-wrapper.sh
git add plugins/mattstack
git commit -m "mattstack plugin: pack skills and docs for team folders and the org base pack"
```

Run `git status --short plugins/mattstack` before the `git add` and stage only what you edited.

- [ ] **Step 4: PR 2 gate**

```bash
bun run test
bunx tsc --noEmit
bun run check
```

Open PR 2 from `org-teams-2-packs` against `org-teams-1-resolver`.

---
## PR 3: Writes, secrets and onboarding

Branch `org-teams-3-writes`, based on `org-teams-2-packs`.

### Task 20: Roles

**Files:**
- Create: `packages/rt-client/src/settings/org-roles.ts`
- Modify: `packages/rt-client/src/index.ts`
- Create: `lib/team/roles.ts`
- Test: `packages/rt-client/src/settings/__tests__/org-roles.test.ts` (new), `lib/team/__tests__/roles.test.ts` (new)

**Interfaces:**
- Consumes: `OrgRoles`, `rolesFrom`, `readOrgRoles`, `sameUser`, `readForgeUsername`, `parseStoreText` (Task 4).
- Produces, from rt-client:

```ts
export type OrgRole = { kind: "admin" } | { kind: "owner"; teams: string[] } | { kind: "member" } | { kind: "unknown" };
export const ORG_MANAGED_ROOTS: readonly string[]; // ["mattstack", ".sops.yaml", ".claude-plugin"]
export function roleOf(username: string | null, roles: OrgRoles): OrgRole;
export function ownedRoots(role: OrgRole): string[];            // clone-relative roots the role may write
export function mayWritePath(role: OrgRole, relPath: string): boolean;
export function writeRefusalFor(role: OrgRole, roles: OrgRoles, relPath: string): { message: string; why: string } | null;
export function currentRole(org: string): OrgRole;              // from disk: stored username plus mattstack.org
```

- Produces, from `lib/team/roles.ts` (the `Probes`-seamed twin the setup and team code uses):

```ts
export function roleFor(p: Pick<Probes, "readFile" | "home">, org: string): OrgRole;
export function rolesFor(p: Pick<Probes, "readFile" | "home">, org: string): OrgRoles;
/** Throws UserActionableError("team-pull-only", ...) when this Mac's role may not write `relPath` in the org clone. */
export function assertMayWrite(p: Pick<Probes, "readFile" | "home">, org: string, relPath: string): void;
```

The refusal keeps the error code `team-pull-only`: the tray and the `--json` callers already treat that code as "this Mac may not change the shared repo", and its meaning has not changed.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/rt-client/src/settings/__tests__/org-roles.test.ts
import { describe, expect, test } from "bun:test";
import type { OrgRoles } from "../active-team.ts";
import { mayWritePath, ownedRoots, roleOf, writeRefusalFor } from "../org-roles.ts";

const ROLES: OrgRoles = { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] }, gadgets: { owners: ["dev2", "dev3"] } } };

describe("roleOf", () => {
  test("an admin, an owner of one or several teams, a member, and nobody", () => {
    expect(roleOf("dev1", ROLES)).toEqual({ kind: "admin" });
    expect(roleOf("dev2", ROLES)).toEqual({ kind: "owner", teams: ["gadgets", "widgets"] });
    expect(roleOf("dev3", ROLES)).toEqual({ kind: "owner", teams: ["gadgets"] });
    expect(roleOf("dev4", ROLES)).toEqual({ kind: "member" });
    expect(roleOf(null, ROLES)).toEqual({ kind: "unknown" });
  });
  test("usernames compare without case", () => {
    expect(roleOf("DEV1", ROLES)).toEqual({ kind: "admin" });
    expect(roleOf("Dev3", ROLES)).toEqual({ kind: "owner", teams: ["gadgets"] });
  });
  test("an admin who is also an owner is an admin", () => {
    expect(roleOf("dev1", { admins: ["dev1"], teams: { widgets: { owners: ["dev1"] } } })).toEqual({ kind: "admin" });
  });
});

describe("what a role may write", () => {
  const admin = roleOf("dev1", ROLES);
  const owner = roleOf("dev3", ROLES);
  const member = roleOf("dev4", ROLES);
  const unknown = roleOf(null, ROLES);

  test("an admin owns everything rt manages in the clone, and nothing else", () => {
    expect(ownedRoots(admin)).toEqual(["mattstack", ".sops.yaml", ".claude-plugin"]);
    for (const path of ["mattstack/org/settings.org.jsonc", "mattstack/teams/widgets/settings.team.jsonc", ".sops.yaml", ".claude-plugin/marketplace.json", "mattstack/org/secrets/rt.json"]) {
      expect(mayWritePath(admin, path)).toBe(true);
    }
    expect(mayWritePath(admin, "src/index.ts")).toBe(false);
  });

  test("an owner owns their team folders only", () => {
    expect(ownedRoots(owner)).toEqual(["mattstack/teams/gadgets"]);
    expect(mayWritePath(owner, "mattstack/teams/gadgets/settings.team.jsonc")).toBe(true);
    expect(mayWritePath(owner, "mattstack/teams/gadgets/packs/gadgets/pack/skills.jsonc")).toBe(true);
    for (const path of ["mattstack/teams/widgets/settings.team.jsonc", "mattstack/org/settings.org.jsonc", ".claude-plugin/marketplace.json", ".sops.yaml", "mattstack/teams/gadgets-evil/x"]) {
      expect(mayWritePath(owner, path)).toBe(false);
    }
  });

  test("a member and an unidentified Mac own nothing", () => {
    expect(ownedRoots(member)).toEqual([]);
    expect(ownedRoots(unknown)).toEqual([]);
    expect(mayWritePath(member, "mattstack/teams/widgets/settings.team.jsonc")).toBe(false);
  });

  test("a path that climbs out is never owned", () => {
    expect(mayWritePath(admin, "mattstack/../../etc/passwd")).toBe(false);
    expect(mayWritePath(owner, "mattstack/teams/gadgets/../widgets/settings.team.jsonc")).toBe(false);
    expect(mayWritePath(admin, "/abs/mattstack/x")).toBe(false);
  });
});

describe("writeRefusalFor names the owner", () => {
  test("a team path names that team's owners and the admins", () => {
    expect(writeRefusalFor(roleOf("dev4", ROLES), ROLES, "mattstack/teams/gadgets/settings.team.jsonc")).toEqual({
      message: "The gadgets team's files belong to its owners",
      why: "Ask dev2 or dev3 (the team's owners) or dev1 (an org admin) to make this change.",
    });
  });
  test("an org path names the admins", () => {
    expect(writeRefusalFor(roleOf("dev3", ROLES), ROLES, "mattstack/org/settings.org.jsonc")).toEqual({
      message: "The org's shared files belong to its admins",
      why: "Ask dev1 (an org admin) to make this change.",
    });
  });
  test("an unidentified Mac is told to identify itself", () => {
    expect(writeRefusalFor(roleOf(null, ROLES), ROLES, "mattstack/org/settings.org.jsonc")).toEqual({
      message: "rt can't tell who you are, so it will not change the org's shared files",
      why: "Connect your forge account in Setup, then try again.",
    });
  });
  test("an org with no admins says so instead of naming nobody", () => {
    const refusal = writeRefusalFor(roleOf("dev4", { admins: [], teams: {} }), { admins: [], teams: {} }, "mattstack/org/settings.org.jsonc");
    expect(refusal?.why).toBe("This org names no admins yet. Its mattstack.org setting has to list one.");
  });
  test("an allowed write has no refusal", () => {
    expect(writeRefusalFor(roleOf("dev1", ROLES), ROLES, ".sops.yaml")).toBeNull();
  });
});
```

```ts
// lib/team/__tests__/roles.test.ts
import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { UserActionableError } from "../../errors.ts";
import { assertMayWrite, roleFor } from "../roles.ts";
import { teamLocalPath } from "../team-local.ts";

const HOME = "/fake-home";
const ORG_STORE = `${HOME}/.mattstack/teams/acme/mattstack/org/settings.org.jsonc`;
const roles = { "mattstack.org": { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } } };

function probes(username: string | null) {
  return fakeProbes({
    home: HOME,
    files: {
      [ORG_STORE]: `// org\n${JSON.stringify(roles)}`,
      ...(username ? { [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: username }) } : {}),
    },
  });
}

describe("roleFor", () => {
  test("reads the stored username and the org's roles through probes", () => {
    expect(roleFor(probes("dev1"), "acme")).toEqual({ kind: "admin" });
    expect(roleFor(probes("dev2"), "acme")).toEqual({ kind: "owner", teams: ["widgets"] });
    expect(roleFor(probes("dev9"), "acme")).toEqual({ kind: "member" });
    expect(roleFor(probes(null), "acme")).toEqual({ kind: "unknown" });
  });
  test("an org store that is missing or malformed leaves everyone a member", () => {
    expect(roleFor(fakeProbes({ home: HOME, files: { [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: "dev1" }) } }), "acme")).toEqual({ kind: "member" });
  });
});

describe("assertMayWrite", () => {
  test("passes for an owner inside their folder", () => {
    expect(() => assertMayWrite(probes("dev2"), "acme", "mattstack/teams/widgets/settings.team.jsonc")).not.toThrow();
  });
  test("refuses with team-pull-only, naming who can", () => {
    try {
      assertMayWrite(probes("dev2"), "acme", ".claude-plugin/marketplace.json");
      throw new Error("expected a refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(UserActionableError);
      expect((err as UserActionableError).code).toBe("team-pull-only");
      expect((err as UserActionableError).message).toBe("The org's shared files belong to its admins");
      expect((err as UserActionableError).why).toBe("Ask dev1 (an org admin) to make this change.");
    }
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/org-roles.test.ts lib/team/__tests__/roles.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// packages/rt-client/src/settings/org-roles.ts
/**
 * Who may write what in the org clone. The check catches accidents from
 * anyone using rt; it is not a security boundary, since the forge decides
 * who can actually push.
 */

import { posix } from "path";
import { readOrgRoles, sameUser, type OrgRoles } from "./active-team.ts";
import { TEAM_NAME_RE } from "./stores.ts";
import { readForgeUsername } from "./team-local-read.ts";

export type OrgRole = { kind: "admin" } | { kind: "owner"; teams: string[] } | { kind: "member" } | { kind: "unknown" };

export const ORG_MANAGED_ROOTS: readonly string[] = ["mattstack", ".sops.yaml", ".claude-plugin"];

export function roleOf(username: string | null, roles: OrgRoles): OrgRole {
  if (username === null) return { kind: "unknown" };
  if (roles.admins.some((admin) => sameUser(admin, username))) return { kind: "admin" };
  const teams = Object.entries(roles.teams)
    .filter(([, team]) => team.owners.some((owner) => sameUser(owner, username)))
    .map(([name]) => name)
    .sort();
  return teams.length > 0 ? { kind: "owner", teams } : { kind: "member" };
}

export function ownedRoots(role: OrgRole): string[] {
  if (role.kind === "admin") return [...ORG_MANAGED_ROOTS];
  if (role.kind === "owner") return role.teams.map((team) => `mattstack/teams/${team}`);
  return [];
}

function under(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function mayWritePath(role: OrgRole, relPath: string): boolean {
  const path = posix.normalize(relPath.split("\\").join("/"));
  if (path.startsWith("/") || path === ".." || path.startsWith("../")) return false;
  return ownedRoots(role).some((root) => under(root, path));
}

function names(list: string[]): string {
  return list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} or ${list[list.length - 1]}`;
}

function adminsClause(admins: string[]): string {
  return `${names(admins)} (${admins.length === 1 ? "an org admin" : "org admins"})`;
}

export function writeRefusalFor(role: OrgRole, roles: OrgRoles, relPath: string): { message: string; why: string } | null {
  if (mayWritePath(role, relPath)) return null;
  if (role.kind === "unknown") {
    return { message: "rt can't tell who you are, so it will not change the org's shared files", why: "Connect your forge account in Setup, then try again." };
  }
  const path = posix.normalize(relPath.split("\\").join("/"));
  const team = /^mattstack\/teams\/([^/]+)(\/|$)/.exec(path)?.[1];
  const noAdmins = "This org names no admins yet. Its mattstack.org setting has to list one.";
  if (team !== undefined && TEAM_NAME_RE.test(team)) {
    const owners = roles.teams[team]?.owners ?? [];
    const ask = [
      ...(owners.length > 0 ? [`${names(owners)} (the team's ${owners.length === 1 ? "owner" : "owners"})`] : []),
      ...(roles.admins.length > 0 ? [adminsClause(roles.admins)] : []),
    ];
    return {
      message: `The ${team} team's files belong to its owners`,
      why: ask.length > 0 ? `Ask ${ask.join(" or ")} to make this change.` : noAdmins,
    };
  }
  return {
    message: "The org's shared files belong to its admins",
    why: roles.admins.length > 0 ? `Ask ${adminsClause(roles.admins)} to make this change.` : noAdmins,
  };
}

export function currentRole(org: string): OrgRole {
  return roleOf(readForgeUsername(org), readOrgRoles(org));
}
```

Export from `index.ts`:

```ts
export { currentRole, mayWritePath, ORG_MANAGED_ROOTS, ownedRoots, roleOf, writeRefusalFor } from "./settings/org-roles.ts";
export type { OrgRole } from "./settings/org-roles.ts";
```

```ts
// lib/team/roles.ts
import { join } from "path";
import { rolesFrom, type OrgRoles } from "../../packages/rt-client/src/settings/active-team.ts";
import { roleOf, writeRefusalFor, type OrgRole } from "../../packages/rt-client/src/settings/org-roles.ts";
import { parseStoreText } from "../../packages/rt-client/src/settings/stores.ts";
import { UserActionableError } from "../errors.ts";
import type { Probes } from "../setup/probes.ts";
import { readTeamLocal } from "./team-local.ts";

type Reads = Pick<Probes, "readFile" | "home">;

export function rolesFor(p: Reads, org: string): OrgRoles {
  const file = join(p.home, ".mattstack", "teams", org, "mattstack", "org", "settings.org.jsonc");
  const raw = p.readFile(file);
  return raw === null ? { admins: [], teams: {} } : rolesFrom(parseStoreText(file, raw));
}

export function roleFor(p: Reads, org: string): OrgRole {
  return roleOf(readTeamLocal(p, org).forgeUsername ?? null, rolesFor(p, org));
}

/** The one refusal every verb that changes the org clone raises, so the wording cannot drift between them. */
export function assertMayWrite(p: Reads, org: string, relPath: string): void {
  const refusal = writeRefusalFor(roleFor(p, org), rolesFor(p, org), relPath);
  if (refusal) throw new UserActionableError("team-pull-only", refusal.message, {}, { why: refusal.why });
}
```

- [ ] **Step 4: Run and commit**

```bash
bun test packages/rt-client/src/settings/__tests__/org-roles.test.ts lib/team/__tests__/roles.test.ts
(cd packages/rt-client && bun run build)
bunx tsc --noEmit
git add packages/rt-client/src/settings/org-roles.ts packages/rt-client/src/index.ts packages/rt-client/src/settings/__tests__/org-roles.test.ts lib/team/roles.ts lib/team/__tests__/roles.test.ts
git commit -m "roles: org admin, team owner and member, and what each may write"
```

### Task 21: The write guard on settings writes

**Files:**
- Modify: `packages/rt-client/src/settings/write.ts` (replace `refuseIfJoined`)
- Test: `packages/rt-client/src/settings/__tests__/write.test.ts`

**Interfaces:**
- Consumes: Task 20 `currentRole`, `writeRefusalFor`, `readOrgRoles`.
- Produces: `setSetting`, `unsetSetting` and `pruneStoreName` at `org` or `team` scope refuse unless this Mac's role owns the target file. settings-kit's `/set`, `/unset` and `/prune` inherit it (they call these three).

- [ ] **Step 1: Write the failing tests**

In `write.test.ts`, replace the joined-clone test from Task 5 with:

```ts
  describe("write guard", () => {
    const roles = { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] }, gadgets: { owners: ["dev3"] } } };
    const roster = [
      { username: "dev1", teams: ["widgets"] },
      { username: "dev2", teams: ["widgets"] },
      { username: "dev3", teams: ["gadgets"] },
      { username: "dev4", teams: ["widgets"] },
    ];
    const seedAs = (username: string | undefined) =>
      seedOrg({ org: "acme", ...(username ? { username } : {}), roster, roles, teams: { widgets: { "board.title": "W" }, gadgets: { "board.title": "G" } } });

    test("an admin writes the org store and any team's store", () => {
      seedAs("dev1");
      setSetting("board.gitlabHost", "gitlab.example.com", "org");
      setSetting("board.title", "Gadgets", "team", { team: "gadgets" });
      expect(readStore(teamSettingsPath("acme", "gadgets")).global["board.title"]).toBe("Gadgets");
    });

    test("an owner writes their own team and is refused the org and another team, with the owner named", () => {
      seedAs("dev2");
      setSetting("board.title", "Widgets", "team");
      expect(() => setSetting("board.gitlabHost", "x", "org")).toThrow("The org's shared files belong to its admins. Ask dev1 (an org admin) to make this change.");
      expect(() => setSetting("board.title", "x", "team", { team: "gadgets" })).toThrow("The gadgets team's files belong to its owners. Ask dev3 (the team's owner) or dev1 (an org admin) to make this change.");
      expect(readStore(teamSettingsPath("acme", "gadgets")).global["board.title"]).toBe("G");
    });

    test("a member writes nothing shared, and unset and prune refuse the same way", () => {
      seedAs("dev4");
      expect(() => setSetting("board.title", "x", "team")).toThrow(/belong to its owners/);
      expect(() => unsetSetting("board.title", "team")).toThrow(/belong to its owners/);
      expect(readStore(teamSettingsPath("acme", "widgets")).global["board.title"]).toBe("W");
    });

    test("a Mac with no stored username is told rt can't tell who it is", () => {
      seedAs(undefined);
      writeFileSync(userSettingsPath(), JSON.stringify({ "mattstack.activeTeam": "widgets" }));
      expect(() => setSetting("board.title", "x", "team")).toThrow("rt can't tell who you are, so it will not change the org's shared files. Connect your forge account in Setup, then try again.");
    });

    test("having joined by invite no longer decides anything: an owner who joined still writes", () => {
      seedAs("dev2");
      writeFileSync(teamLocalPath("acme"), JSON.stringify({ joinedByRt: true, forgeUsername: "dev2" }));
      setSetting("board.title", "Widgets", "team");
      expect(readStore(teamSettingsPath("acme", "widgets")).global["board.title"]).toBe("Widgets");
    });

    test("user and machine writes are never guarded", () => {
      seedAs("dev4");
      setSetting("rt.logLevel", "debug", "user");
      setSetting("rt.logLevel", "debug", "machine");
    });
  });
```

(`mkdirSync(dirname(userSettingsPath()), { recursive: true })` before the `writeFileSync` if the directory is not there yet.)

settings-kit needs no new test: `server.test.ts` already pins that a throw from `setSetting` or `unsetSetting` answers 400 with rt's own message ("a setSetting refusal answers 400 with rt's own message"), and the refusal here is such a throw.

- [ ] **Step 2: Run to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/write.test.ts -t "write guard"`
Expected: FAIL (the owner-who-joined case is refused by `refuseIfJoined`; the member case is allowed).

- [ ] **Step 3: Implement**

In `write.ts`, drop the `isJoinedTeam` import and `refuseIfJoined`, and add:

```ts
import { relative, sep } from "path";
import { readOrgRoles } from "./active-team.ts";
import { currentRole, writeRefusalFor } from "./org-roles.ts";
```

```ts
/** A shared store is written only by a role that owns its file: an org admin, or the team's owner for a team folder. */
function refuseUnlessOwned(org: string, storePath: string): void {
  const relPath = relative(orgDir(org), storePath).split(sep).join("/");
  const refusal = writeRefusalFor(currentRole(org), readOrgRoles(org), relPath);
  if (refusal) refuse(`${refusal.message}. ${refusal.why}`);
}
```

In `resolveStorePath` and `resolveStorePathForUnset`, replace `refuseIfJoined(org);` with `refuseUnlessOwned(org, path);`.

`refuse()` prefixes `rt: `, so the thrown text is `rt: The org's shared files belong to its admins. Ask ...`. Update the module's header comment: the paragraph about pull-only joined clones becomes "A shared store is written only by a role that owns it (see org-roles.ts); the refusal names who can."

`team-local-read.ts`'s `isJoinedTeam` stays exported (the sync row still reads the record), but nothing in the write path calls it.

- [ ] **Step 4: Run and commit**

```bash
bun test packages/rt-client/src/settings packages/settings-kit
(cd packages/rt-client && bun run build)
bun run test
```

A test elsewhere that wrote a shared setting through `setSetting` now needs a role: seed it with `seedOrg({ ..., username: "dev1", roles: { admins: ["dev1"], teams: {} } })`. That includes the `org and team stores` describe in `write.test.ts` (Task 5) and the `org and team scopes` describe in `commands/__tests__/settings-set.test.ts` (Task 7): give their `seedOrg` calls that `roles` value. `lib/team/invite.ts` and `members.ts` tests inject `writeSetting`, so they are unaffected. The rule-6 tests from Task 5 (`dispose.test.ts`, `repo-tracking.test.ts`, `variations.test.ts` and the rest that write `"org"`) need the same role: where they seed through `seedOrg`, add `username` and `roles`; where they only call `setSetting(..., "org", ...)` against a bare clone, seed the org first with `seedOrg({ org: "acme", username: "dev1", roles: { admins: ["dev1"], teams: {} } })`.

```bash
git add packages/rt-client/src/settings/write.ts packages/rt-client/src/settings/__tests__/write.test.ts
git add $(git diff --name-only -- '*.test.ts')
git commit -m "settings: a shared store is written only by a role that owns it"
```

### Task 22: The guard on team verbs, secrets and skills

**Files:**
- Modify: `lib/team/team-local.ts` (delete `assertNotJoined`)
- Modify: `lib/team/publish.ts`, `lib/team/members.ts`, `lib/secrets/team-store.ts` (call `assertMayWrite`)
- Modify: `commands/skills.ts` (bind, compile and surface), `lib/skills/init.ts` and `commands/skills-init.ts` (init), `commands/skills-sync.ts` and `lib/skills/sync.ts` (a member's sync writes nothing into the pack)
- Modify: `lib/repo-reidentify.ts` (a shared store's repo section moves only on a Mac whose role owns that file)
- Test: `lib/team/__tests__/publish.test.ts`, `members.test.ts`, `lib/secrets/__tests__/team-store.test.ts`, `commands/__tests__/skills-bind.test.ts`, `commands/__tests__/skills.test.ts`, `commands/__tests__/skills-surface.test.ts`, `lib/skills/__tests__/init.test.ts`, `lib/skills/__tests__/sync.test.ts`, `lib/__tests__/repo-reidentify.test.ts`

**Interfaces:**
- Consumes: Task 20 `assertMayWrite`, `roleFor`, `mayWritePath`.
- Produces: `publishTeam` needs any owned root (an admin or an owner); `membersSync`, `membersRemove`, `writeTeamSecret`, `reencryptTeamSecrets` need the admin (`.sops.yaml`); `rt skills bind`, `compile` (when it writes) and `surface set|apply` (when they write) need the pack's directory; `rt repo reidentify` moves a shared store's section only where the role owns the file, and reports the rest as refused; `initPack` needs the team folder, and the marketplace file only when it has to add an entry. `InitDeps` gains `mayWrite(zone: ZoneInfo, relPath: string): { message: string; why: string } | null`. `SyncDeps` gains `mayCompile(packName: string): boolean`; when it answers false for a drifted pack, sync skips bump, compile, recheck and commit-push, so nothing in the clone changes.

- [ ] **Step 1: Write the failing tests**

`lib/team/__tests__/publish.test.ts` (replace the joined-clone refusal test):

```ts
  test("a member's Mac refuses to publish; an owner's and an admin's do not", async () => {
    const files = (username: string) => ({
      [`${HOME}/.mattstack/teams/acme/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } } }),
      [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: username, joinedByRt: true }),
      [`${HOME}/.mattstack/teams/acme/.git/config`]: `[remote "origin"]\n\turl = https://github.com/acme/org.git\n`,
    });
    await expect(publishTeam(fakeProbes({ home: HOME, files: files("dev9") }), "acme", null)).rejects.toMatchObject({ code: "team-pull-only" });
    for (const username of ["dev1", "dev2"]) {
      const p = fakeProbes({ home: HOME, files: files(username), exec: () => ({ code: 0, stdout: "", stderr: "" }) });
      await expect(publishTeam(p, "acme", null)).resolves.toMatchObject({ pushed: true });
    }
  });
```

(match `fakeProbes`' real `exec` option shape from `lib/setup/__tests__/fakes.ts`.)

`lib/team/__tests__/members.test.ts` and `lib/secrets/__tests__/team-store.test.ts`: the tests that asserted `assertNotJoined`'s refusal now seed a record with `forgeUsername: "dev2"` (an owner, not an admin) and assert `code: "team-pull-only"` with the message `The org's shared files belong to its admins`; add the mirror case that an admin who joined by invite (`joinedByRt: true, forgeUsername: "dev1"`) is allowed.

`lib/skills/__tests__/init.test.ts`:

```ts
  test("an owner whose team is not in the marketplace yet is refused before anything is written", async () => {
    const { deps, calls, fs } = world({
      mayWrite: (_zone, relPath) => (relPath === ".claude-plugin/marketplace.json" ? { message: "The org's shared files belong to its admins", why: "Ask dev1 (an org admin) to make this change." } : null),
    });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "not-yours", detail: "The org's shared files belong to its admins. Ask dev1 (an org admin) to make this change." });
    expect(calls.claims).toEqual([]);
    expect(fs.exists(`${HOME}/.mattstack/teams/acme/mattstack/teams/acme/packs/acme/pack/stubs.jsonc`)).toBe(false);
  });

  test("with the marketplace entry already there (rt team add wrote it), an owner needs only their own folder", async () => {
    const asked: string[] = [];
    const { deps } = world({
      files: orgFiles("acme", { "board.gitlabHost": "gitlab.com" }, { acme: {} }, {
        [`${HOME}/.mattstack/teams/acme/.claude-plugin/marketplace.json`]: `{ "name": "acme-market", "plugins": [{ "name": "acme", "source": "./mattstack/teams/acme/packs/acme" }] }`,
      }),
      mayWrite: (_zone, relPath) => { asked.push(relPath); return null; },
    });
    expect((await initPack({ repoDir: REPO, zone: null, team: null }, deps)).ok).toBe(true);
    expect(asked).toEqual(["mattstack/teams/acme"]);
  });
```

(the `world()` default gains `mayWrite: () => null`.)

`lib/skills/__tests__/sync.test.ts`:

```ts
  const NOT_YOURS = "This pack is out of date, but only its team's owners recompile it";

  test("a member's sync of a drifted pack writes nothing into it, and still updates a lagging install", async () => {
    const pack = fixturePack("acme", "local", "0.5.2");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps: SyncDeps = {
      ...makeDeps(pack, engine, { calls, installed: { [pluginId(pack)]: "0.5.1", [pluginId(engine)]: "2.0.0" }, drift: [true] }),
      mayCompile: () => false,
      compilePack: async () => { throw new Error("a member must not compile"); },
    };

    const report = await syncPack(pack, engine, deps);

    expect(readVersion(pack.dir)).toBe("0.5.2");
    const byName = Object.fromEntries(report.steps.map((s) => [s.name, s]));
    for (const name of ["bump", "compile", "recheck", "commit-push"]) {
      expect(byName[name]).toMatchObject({ status: "skipped", detail: NOT_YOURS });
    }
    expect(byName["update-pack"]!.status).toBe("ran");
    expect(calls.some((c) => c.cmd === "git" && ["add", "commit", "push"].includes(c.args[0]!))).toBe(false);
    expect(report.ok).toBe(true);
  });

  test("with the install already current, a member's sync of a drifted pack changes nothing at all", async () => {
    const pack = fixturePack("acme", "local", "0.5.2");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps: SyncDeps = {
      ...makeDeps(pack, engine, { calls, installed: { [pluginId(pack)]: "0.5.2", [pluginId(engine)]: "2.0.0" }, drift: [true] }),
      mayCompile: () => false,
    };
    const report = await syncPack(pack, engine, deps);
    const byName = Object.fromEntries(report.steps.map((s) => [s.name, s]));
    expect(byName["update-pack"]).toMatchObject({ status: "skipped", detail: "the installed copy already matches the source" });
    expect(readVersion(pack.dir)).toBe("0.5.2");
    expect(report.ok).toBe(true);
  });
```

`makeDeps` gains `mayCompile: () => true` in the object it returns, so the file's other tests keep their meaning. The `drift` fixture holds one answer on purpose: a second `checkPack` call (the recheck) would throw "ran out of configured drift answers".

`commands/__tests__/skills-surface.test.ts`: add a test that seeds an org through `seedOrg` with roles, records a member's username, runs `skillsSurface(["set", "<a hand-authored skill>", "--internal", "--pack-dir", <the team pack in the clone>])` and expects exit 2, stderr starting `The widgets team's files belong to its owners`, and the skill's folder still under `skills/`.

`lib/__tests__/repo-reidentify.test.ts` (seed the way that file's settings-store cases do, with `seedOrg`):

```ts
  test("a member's reidentify leaves the shared stores alone and says who can move them", async () => {
    seedOrg({
      org: "acme",
      username: "dev4",
      roles: { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } },
      roster: [{ username: "dev4", teams: ["widgets"] }],
      settings: { repos: { "gitlab.example.com/acme/widgets": { "rt.roles": { web: { devHook: "./dev.sh" } } } } },
      teams: { widgets: {} },
    });
    const report = await reidentify("gitlab.example.com/acme/widgets", "gitlab.example.com/acme/gadgets");
    if ("error" in report) throw new Error(report.error);
    const shared = report.stores.find((s) => s.store === "settings:shared:acme/mattstack/org/settings.org.jsonc");
    expect(shared).toEqual({ store: "settings:shared:acme/mattstack/org/settings.org.jsonc", status: "refused", count: 1, detail: "The org's shared files belong to its admins. Ask dev1 (an org admin) to make this change." });
    expect(readStore(orgSettingsPath("acme")).repos["gitlab.example.com/acme/widgets"]).toBeDefined();
  });

  test("an admin's reidentify moves the org store's section", async () => {
    seedOrg({ org: "acme", username: "dev1", roles: { admins: ["dev1"], teams: {} }, settings: { repos: { "gitlab.example.com/acme/widgets": { "rt.roles": {} } } }, teams: { widgets: {} } });
    const report = await reidentify("gitlab.example.com/acme/widgets", "gitlab.example.com/acme/gadgets");
    if ("error" in report) throw new Error(report.error);
    expect(report.stores.find((s) => s.store.startsWith("settings:shared:"))).toMatchObject({ status: "moved" });
  });
```

(`seedOrg`'s `settings` option is the org store's body, as Task 5 defined it; if that file's other tests open the state db through a helper, call `reidentify` inside the same helper.)

`commands/__tests__/skills-bind.test.ts`: add a test that seeds an org through `seedOrg` with roles, records a member's username, runs `bind` against the team pack, and expects exit 2 with stderr starting `The widgets team's files belong to its owners` and the fragment file unchanged.

- [ ] **Step 2: Run to see them fail**

Run: `bun test lib/team lib/secrets lib/skills commands/__tests__/skills-bind.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the team and secrets guards**

- `lib/team/team-local.ts`: delete `assertNotJoined`.
- `lib/team/publish.ts`: replace `assertNotJoined(p, slug);` with:

```ts
  if (ownedRoots(roleFor(p, slug)).length === 0) assertMayWrite(p, slug, "mattstack/org/settings.org.jsonc");
```

(an owner may publish their own folder's commits; a member or an unidentified Mac gets the org refusal). Import `ownedRoots` from rt-client's `org-roles.ts` and `assertMayWrite`, `roleFor` from `./roles.ts`.
- `lib/team/members.ts`: both `assertNotJoined(p, slug);` calls become `assertMayWrite(p, slug, ".sops.yaml");`.
- `lib/secrets/team-store.ts`: both `assertNotJoined(probes, slug);` calls become `assertMayWrite(probes, slug, ".sops.yaml");`, and the comment above `reencryptTeamSecrets` says "`assertMayWrite` runs here ... only an org admin re-encrypts" in place of the joined-machine sentence.

- [ ] **Step 4: Implement the skills guards**

`commands/skills.ts`: one helper and one error class:

```ts
/** A refusal by policy: drawn as a refused note on stderr, exit 2, never a failure. */
export class SkillsRefusal extends SkillsUsageError {}

/** A pack inside the org clone is written only by a role that owns its folder; a pack anywhere else (a checkout, --pack-dir) is the caller's own. */
function refuseUnlessPackOwned(packDir: string): void {
  const org = currentOrg();
  if (org === null) return;
  const rel = relativePath(canonicalPath(orgDir(org)), canonicalPath(packDir));
  if (rel === "" || rel.startsWith("..") || isAbsolutePath(rel)) return;
  const refusal = writeRefusalFor(currentRole(org), readOrgRoles(org), rel.split(sep).join("/"));
  if (refusal) throw new SkillsRefusal(`${refusal.message}. ${refusal.why}`, { title: refusal.message, why: refusal.why });
}
```

Use the file's existing `canonicalPath`, `relativePath`, `isAbsolutePath` and `sep` (the `isUnder` helper near line 405 already uses them). In `withCleanErrors`, ahead of the `SkillsUsageError` branch:

```ts
    if (err instanceof SkillsRefusal) {
      const shown = skillsFailure(err);
      out.note(out.line("refused", shown.title), ...(shown.why ? [out.callout("why", shown.why)] : []));
      process.exit(2);
    }
```

Call `refuseUnlessPackOwned` at every place the command writes into a pack:

| Site | Call |
|---|---|
| `performCompile`, first line | `if (write) refuseUnlessPackOwned(resolved.packDir);` This covers `rt skills compile`, and `compilePackAll` for sync, init and the surface recompile |
| `skillsBind`, after `resolve(...)` | `if (!bindFlags.dryRun) refuseUnlessPackOwned(resolved.packDir);` before `applyBind` |
| `runApply` and `runSet` (`rt skills surface`), after `resolveSurfacePaths(flags)` | `if (!flags.dryRun) refuseUnlessPackOwned(packDir);` before any move or `surface.jsonc` write |

`compilePackAll` returns its errors instead of throwing: wrap its `performCompile` call so a `SkillsRefusal` becomes `{ ok: false, errors: [err.message] }` (rethrow anything else). A `--json` caller of `compile`, `bind` or `surface` gets the refusal as that verb's existing error envelope with the message `<message>. <why>`, exit 2.

`lib/repo-reidentify.ts`: the shared-store loop from Task 5 calls a guarded report:

```ts
/** A shared store's repo section moves only on a Mac whose role owns that file; anywhere else the clone would carry an edit it can never push. */
function sharedSettingsReport(file: string, from: string, to: string, dryRun: boolean): StoreReport {
  const label = sharedLabel(file);
  const org = currentOrg();
  const refusal = org === null ? null : writeRefusalFor(currentRole(org), readOrgRoles(org), relative(orgDir(org), file).split(sep).join("/"));
  if (refusal === null) return settingsReport(label, file, from, to, dryRun);
  const store = `settings:${label}`;
  return Object.prototype.hasOwnProperty.call(readStore(file).repos, from)
    ? { store, status: "refused", count: 1, detail: `${refusal.message}. ${refusal.why}` }
    : { store, status: "none", count: 0 };
}
```

and the loop body becomes `add(\`settings:${sharedLabel(file)}\`, () => sharedSettingsReport(file, from.raw, to.raw, dryRun));`. Update that file's `no-settings-bypass` allowlist count for the added `readStore`.

`lib/skills/init.ts`: add `"not-yours"` to `InitRefusalCode` and `POLICY_REFUSALS`, add the `mayWrite` dep, and check before the write block (after `packIsCompiled`):

```ts
  const marketOnDiskEarly = deps.fs.readFile(join(zone.orgDir, ".claude-plugin", "marketplace.json"));
  const entryThere = marketOnDiskEarly !== null && addMarketplacePlugin(marketOnDiskEarly, pack, packDescription(pack), `./mattstack/teams/${zone.team}/packs/${zone.team}`) === marketOnDiskEarly;
  for (const relPath of [`mattstack/teams/${zone.team}`, ...(entryThere ? [] : [".claude-plugin/marketplace.json"])]) {
    const refusal = deps.mayWrite(zone, relPath);
    if (refusal) return refuse("not-yours", `${refusal.message}. ${refusal.why}`);
  }
```

`commands/skills-init.ts` `realDeps`:

```ts
    mayWrite: (zone, relPath) => writeRefusalFor(currentRole(zone.org), readOrgRoles(zone.org), relPath),
```

`lib/skills/sync.ts`: `SyncDeps` gains `mayCompile(packName: string): boolean;`. Directly after the `noOp` return:

```ts
  // A Mac whose role does not own the pack writes nothing into it: a bump
  // with no compile would leave a dirty manifest that blocks its own pulls.
  const mine = !drift || deps.mayCompile(pack.name);
  const NOT_YOURS = "This pack is out of date, but only its team's owners recompile it";
```

and each of the `bump`, `compile`, `recheck` and `commit-push` steps starts with:

```ts
    if (!mine) return skipped(NOT_YOURS);
```

(ahead of the `!drift` line; in `bump` that also puts it ahead of the shared-checkout refusal). `update-pack` starts with:

```ts
    if (!mine && installedPackBefore === packSourceVersion) return skipped("the installed copy already matches the source");
```

and the comment above it gains that case: a member's drifted pack reaches it with nothing to update when the install is current.

`commands/skills-sync.ts` supplies it: true when the pack's directory is outside the org clone or `mayWritePath(currentRole(org), <clone-relative pack dir>)` holds.

- [ ] **Step 5: Run and commit**

```bash
bunx tsc --noEmit
bun run test
git add lib/team/team-local.ts lib/team/publish.ts lib/team/members.ts lib/secrets/team-store.ts commands/skills.ts commands/skills-init.ts commands/skills-sync.ts lib/skills/init.ts lib/skills/sync.ts lib/repo-reidentify.ts lib/__tests__/no-settings-bypass.test.ts
git add $(git diff --name-only -- '*.test.ts')
git commit -m "team verbs, secrets and skills: writes are refused outside what your role owns"
```

### Task 23: Org secrets live under `mattstack/org/secrets`

**Files:**
- Modify: `lib/secrets/team-store.ts` (`TEAM_PATH_REGEX`, `teamSecretsFile`, `teamSecretsDir`, `teamLocation`, the header comment)
- Modify: `lib/team/create.ts` (the scaffold's `.gitignore` line)
- Modify: `lib/setup/team-slack-secret.ts` (the `board.json` path)
- Test: `lib/secrets/__tests__/team-store.test.ts`, `lib/team/__tests__/create.test.ts`, `lib/setup/__tests__` (the slack-secret tests)

**Interfaces:**
- Produces: `TEAM_PATH_REGEX = "mattstack/org/secrets/.*"`; `teamSecretsFile(slug, domain)` answers `<clone>/mattstack/org/secrets/<domain>.json`. The function names keep `team` (they are keyed by the clone slug, like the machine-local record).

- [ ] **Step 1: Write the failing tests**

In `lib/secrets/__tests__/team-store.test.ts`:

```ts
  test("org secrets live under mattstack/org/secrets, and the sops rule points there", () => {
    expect(teamSecretsFile("acme", "rt")).toBe(join(teamsDir(), "acme", "mattstack", "org", "secrets", "rt.json"));
    expect(TEAM_PATH_REGEX).toBe("mattstack/org/secrets/.*");
  });
```

and update every path the file's other tests seed or expect from `mattstack/secrets/` to `mattstack/org/secrets/`. In `create.test.ts`: `expect(files[".sops.yaml"]).toContain("mattstack/org/secrets/.*")` and `expect(files[".gitignore"]).toBe("mattstack/org/secrets/*.tmp\n.DS_Store\n")`.

- [ ] **Step 2: Run to see them fail, then implement**

Run: `bun test lib/secrets/__tests__/team-store.test.ts lib/team/__tests__/create.test.ts`
Expected: FAIL.

In `team-store.ts`:

```ts
export const TEAM_PATH_REGEX = "mattstack/org/secrets/.*";
```

```ts
export function teamSecretsFile(slug: string, domain: string): string {
  validateDomain(domain);
  return join(teamCloneRoot(slug), "mattstack", "org", "secrets", `${domain}.json`);
}
```

```ts
function teamSecretsDir(slug: string): string {
  return join(teamCloneRoot(slug), "mattstack", "org", "secrets");
}

function teamLocation(slug: string, domain: string): SecretsLocation {
  return {
    filePath: teamSecretsFile(slug, domain),
    filenameOverride: join("mattstack", "org", "secrets", `${domain}.json`),
    cwd: teamCloneRoot(slug),
  };
}
```

Reword the header comment's paths and the `TeamSopsYamlHandEditedError` message to the new rule. In `create.ts` the scaffold's `.gitignore` becomes `"mattstack/org/secrets/*.tmp\n.DS_Store\n"`. In `lib/setup/team-slack-secret.ts` the path becomes `join(p.home, ".mattstack", "teams", slug, "mattstack", "org", "secrets", "board.json")`.

- [ ] **Step 3: Sweep for the old path**

```bash
rg -n '"mattstack", "secrets"|mattstack/secrets' lib commands apps packages --glob '!**/dist/**' --glob '!**/node_modules/**'
```

Expected: nothing outside the conversion script's fixture (Task 35). Fix any other hit to the org path.

- [ ] **Step 4: Run and commit**

```bash
bun run test
git add lib/secrets/team-store.ts lib/team/create.ts lib/setup/team-slack-secret.ts
git add $(git diff --name-only -- '*.test.ts')
git commit -m "secrets: the org's secrets live under mattstack/org/secrets"
```

### Task 24: The sync engine follows the role

**Files:**
- Modify: `lib/daemon/home-snapshot.ts` (`SnapshotSpec.watch`, `SnapshotStatus.unownedDirty`, `teamSnapshotSpec`, `doPull`)
- Modify: `lib/daemon/team-snapshots.ts` (the mode comes from the role)
- Modify: `lib/setup/validators/rt-health.ts` (`teamSyncRow` names the files)
- Modify: `lib/setup/validators/access.ts` (the team repo row's wording follows the role)
- Test: `lib/daemon/__tests__/team-snapshots.test.ts`, `lib/daemon/__tests__/home-snapshot*.test.ts`, `lib/setup/__tests__/validators-rt-health.test.ts`

**Interfaces:**
- Consumes: Task 20 `roleFor`, `ownedRoots`.
- Produces:

```ts
export interface SnapshotSpec {
  // ...
  /** Every path rt manages in the clone; a dirty path here that `scope` rejects is one this Mac may not push. */
  watch?: (relPath: string) => boolean;
}
export interface SnapshotStatus {
  // ...
  /** Dirty paths rt manages but this Mac's role does not own, as of the last pull cycle. */
  unownedDirty: string[];
}
export function teamSnapshotSpec(slug: string, repoDir: string, opts: { /* existing */; ownedRoots: string[] }): SnapshotSpec;
```

`pullOnly` is `ownedRoots.length === 0`. The staged scope is the owned roots; the watched scope stays `teamScope` (`mattstack`, `.sops.yaml`, `.claude-plugin`).

- [ ] **Step 1: Write the failing tests**

`lib/daemon/__tests__/team-snapshots.test.ts`: replace the whole `describe("pull-only mode", ...)` block (four tests that derive the mode from `joinedByRt`) with the block below. The file's `harness()` puts clones at `h.root/<slug>` and gives the supervisor fake probes whose home is `h.root`, so the roles the supervisor reads live in those probes at the path `roleFor` builds from that home:

```ts
  describe("the role decides the mode", () => {
    const ROLES = { "mattstack.org": { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } } };

    function orgWith(h: ReturnType<typeof harness>, username: string | null): void {
      clone(h.root, "acme");
      h.deps.probes.writeFile(join(h.root, ".mattstack", "teams", "acme", "mattstack", "org", "settings.org.jsonc"), JSON.stringify(ROLES));
      if (username) writeTeamLocal(h.deps.probes, "acme", { createdByRt: false, joinedByRt: true, rtMayManageMembership: false, forgeUsername: username });
    }

    async function specFor(username: string | null): Promise<SnapshotSpec> {
      const h = harness();
      orgWith(h, username);
      const handle = startTeamSnapshots(h.deps);
      await handle.ready;
      const spec = h.startedSpecs().find((s) => s.id === "team:acme")!;
      handle.stop();
      h.cleanup();
      return spec;
    }

    test("an admin pushes everything rt manages, even on a Mac that joined by invite", async () => {
      const spec = await specFor("dev1");
      expect(spec.pullOnly).toBe(false);
      expect(spec.scope!(".claude-plugin/marketplace.json")).toBe(true);
      expect(spec.scope!("mattstack/teams/gadgets/settings.team.jsonc")).toBe(true);
    });

    test("an owner pushes only their team folder, and the engine still watches the rest", async () => {
      const spec = await specFor("dev2");
      expect(spec.pullOnly).toBe(false);
      expect(spec.scope!("mattstack/teams/widgets/settings.team.jsonc")).toBe(true);
      expect(spec.scope!("mattstack/org/settings.org.jsonc")).toBe(false);
      expect(spec.watch!("mattstack/org/settings.org.jsonc")).toBe(true);
    });

    test("a member only pulls, and so does a Mac rt cannot identify yet", async () => {
      expect((await specFor("dev9")).pullOnly).toBe(true);
      expect((await specFor(null)).pullOnly).toBe(true);
    });

    test("a role that changes under a running daemon restarts the instance in the new mode", async () => {
      const h = harness();
      orgWith(h, "dev9");
      const handle = startTeamSnapshots(h.deps);
      await handle.ready;
      expect(h.startedSpecs().at(-1)?.pullOnly).toBe(true);

      writeTeamLocal(h.deps.probes, "acme", { createdByRt: false, joinedByRt: true, rtMayManageMembership: false, forgeUsername: "dev2" });
      await handle.rescan();

      expect(h.startedSpecs().at(-1)?.pullOnly).toBe(false);
      expect(h.stoppedIds()).toContain("team:acme");
      handle.stop();
      h.cleanup();
    });
  });
```

The old block's "a clone with no record at all keeps pushing" is gone on purpose: an unidentified Mac owns nothing, so it only pulls until `team.identity` (or a forge connect) records who it is. Any other test in the file that asserts `pullOnly` falsy for a bare `clone(h.root, ...)` now seeds an admin with `orgWith(h, "dev1")`. `TeamLocalRecord` gained `forgeUsername` in Task 4.

`lib/setup/__tests__/validators-rt-health.test.ts`, inside `describe("teamSyncRow", ...)` (it has `const now = () => 1_000_000`):

```ts
  const inSync = { slug: "acme", lastPullAt: 900_000, lastPushError: null, conflicted: null };

  test("a hand edit this Mac may not push is named", async () => {
    const entry = { ...inSync, pullOnly: true, unownedDirty: ["mattstack/org/settings.org.jsonc"] };
    const row = await teamSyncRow(["acme"], async () => [entry as never], now, 300);
    expect(row?.status).toBe("needs-you");
    expect(row?.detail).toBe("acme: changed on this Mac but not yours to push: mattstack/org/settings.org.jsonc. Undo the change, or ask who owns it to make it");
  });

  test("the same edit is named as the reason a pull stopped", async () => {
    const entry = { ...inSync, pullOnly: true, lastPullSkipped: "error: Your local changes would be overwritten", unownedDirty: ["mattstack/org/settings.org.jsonc"] };
    const row = await teamSyncRow(["acme"], async () => [entry as never], now, 300);
    expect(row?.detail).toBe("acme: a pull stopped on a change that is not yours to push: mattstack/org/settings.org.jsonc. Undo the change, then pull again");
  });

  test("an entry from a daemon that predates the field reads as nothing stray", async () => {
    expect((await teamSyncRow(["acme"], async () => [inSync as never], now, 300))?.status).toBe("ready");
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `bun test lib/daemon/__tests__/team-snapshots.test.ts lib/setup/__tests__/validators-rt-health.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the engine half**

`lib/daemon/home-snapshot.ts`:

- Add `watch` to `SnapshotSpec` and `unownedDirty: string[]` to `SnapshotStatus` as in the Interfaces block.
- `teamSnapshotSpec` takes `ownedRoots: string[]` in its opts (replacing `pullOnly?`):

```ts
  const owns = (relPath: string) => opts.ownedRoots.some((root) => relPath === root || relPath.startsWith(`${root}/`));
  return {
    id: `team:${slug}`,
    repoDir,
    kvNamespace: `team-snapshot:${slug}`,
    eventPrefix: "team",
    scope: (relPath) => teamScope(relPath) && owns(relPath),
    watch: teamScope,
    pull: { intervalSec: opts.pullIntervalSec, onPulled: opts.onPulled },
    pullOnly: opts.ownedRoots.length === 0,
    tokenFor: () => readToken(opts.probes, opts.originUrl),
    originUrl: opts.originUrl,
  };
```

- In `startSnapshot`, beside the other state variables: `let unownedDirty: string[] = [];`. In `doPull`, directly after `lastPullError = null;`:

```ts
    if (spec.watch) {
      const dirty = await deps.exec(["git", "status", "--porcelain=v1", "-uall", "-z"], { cwd: deps.repoDir, timeoutMs: GIT_TIMEOUT_MS, stderr: "pipe" });
      if (dirty.exitCode === 0) {
        unownedDirty = parsePorcelainZ(dirty.stdout)
          .map((entry) => entry.path)
          .filter((path) => spec.watch!(path) && !(spec.scope?.(path) ?? true))
          .sort();
      }
    }
```

- `status()` returns `unownedDirty: [...unownedDirty]`.
- The `pullOnly` doc comment on `SnapshotSpec` says "This Mac's role owns nothing in the clone, so the engine only fetches and fast-forwards".

`lib/daemon/team-snapshots.ts`: replace `pullOnlyFor` and the mode tracking:

```ts
  /** The roots this Mac's role may push. The record and the roles can change under a running daemon, so each rescan re-reads them. */
  function ownedFor(slug: string): string[] {
    return ownedRoots(roleFor(probes, slug));
  }
```

`instances` holds `{ handle, dir, owned: string }` where `owned` is `ownedFor(slug).join("\n")`; the "mode changed; restarting" branch compares that string; `teamSnapshotSpec` is called with `ownedRoots: ownedFor(slug)`. Imports: `ownedRoots` from rt-client's `org-roles.ts`, `roleFor` from `../team/roles.ts`; drop `readTeamLocal`.

- [ ] **Step 4: Implement the row half**

In `teamSyncRow`, before the `e.conflicted` check inside the loop:

```ts
    const stray = e.unownedDirty ?? [];
    if (stray.length > 0) {
      const files = stray.join(", ");
      problems.push(
        e.lastPullSkipped
          ? `${slug}: a pull stopped on a change that is not yours to push: ${files}. Undo the change, then pull again`
          : `${slug}: changed on this Mac but not yours to push: ${files}. Undo the change, or ask who owns it to make it`,
      );
      continue;
    }
```

(`?? []` because a daemon that predates the field omits it.) The two remedies that say "ask the team's owner" now say "ask an org admin".

`lib/setup/validators/access.ts`: `const pullOnly = ownedRoots(roleFor(p, team.slug)).length === 0;` and the member's `why` ends "Only the org's admins and your team's owners write it."

- [ ] **Step 5: Run and commit**

```bash
bunx tsc --noEmit
bun test lib/daemon lib/setup commands/__tests__/team-status.test.ts
git add lib/daemon/home-snapshot.ts lib/daemon/team-snapshots.ts lib/setup/validators/rt-health.ts lib/setup/validators/access.ts
git add $(git diff --name-only -- '*.test.ts')
git commit -m "team sync: push and stage only what this Mac's role owns, and name what it does not"
```

### Task 25: `rt team create` makes the creator admin, owner and roster member

The creator's roles are written under their forge login, never a guess (spec section 8, Create). With `--create-repo` the forge CLI is already signed in, so the login is known at once. With `--remote` on a recognized forge the token is connected later, on the checklist: create then writes no username, admin, owner or roster entry, and Install's `team.create` rerun writes them. Only a host that is no recognized forge uses `$USER`.

**Files:**
- Modify: `lib/team/create.ts` (`CreateTeamOpts`, `CreateTeamResult`, `createTeam`, new `withCreator`)
- Modify: `lib/setup/intent.ts` (`SetupIntent.team.firstTeam?`), `lib/setup/steps/team.ts` (`resolveCreateOpts`, `teamCreateRun`)
- Modify: `commands/team.ts` (`teamCreate`), `lib/command-tree-def.ts` (the `team create` args)
- Test: `lib/team/__tests__/create.test.ts`, `commands/__tests__/team.test.ts`, `lib/setup/__tests__/steps-a.test.ts`

**Interfaces:**
- Consumes: `TEAM_NAME_RE`, `forgeLogin` (`lib/team/forge.ts`), `storedForgeToken`, `forgeFromRemote`, `readTeamLocal`, `updateTeamLocal`.
- Produces:

```ts
export interface CreateTeamOpts { name: string; remote: string | null; createRepoOwner?: string; others: boolean; /** The first team folder's name; the org slug (or team-<slug>) when left out. */ firstTeam?: string }
export interface CreateTeamSeams { forgeLogin: typeof forgeLogin; forgeToken: typeof storedForgeToken }
export interface CreateTeamResult { slug: string; team: string; name: string; remote: string; dir: string; created: boolean; gitDeferred?: true; /** The creator's forge login is not known yet, so the org names no admin; a later run writes it. */ rolesDeferred?: true }
/** The org store's text with `creator` as admin, the first team's owner and the first roster member. Unchanged when the store already names an admin. */
export function withCreator(storeText: string, team: string, creator: { username: string; agePublicKey?: string }): string;
export async function createTeam(p: Probes, opts: CreateTeamOpts, ageKeySeam?: AgeKeySeam, seams?: CreateTeamSeams): Promise<CreateTeamResult>;
```

`scaffoldFiles` keeps the signature Task 10 gave it: the creator is written by `withCreator` after the scaffold, in one code path for a first run and a rerun.

`rt team create <name> [--first-team <name>] (--remote <url> | --create-repo <owner>) [--others] [--json]`. The flag is `--first-team` because `--team` names the clone on every org-level `rt team` verb.

- [ ] **Step 1: Write the failing tests**

In `lib/team/__tests__/create.test.ts` (import `withCreator` from `../create.ts` and `readTeamLocal` from `../team-local.ts`):

```ts
describe("the creator", () => {
  const seams = { forgeLogin: async () => "dev1", forgeToken: async () => null };
  const unknown = { forgeLogin: async () => null, forgeToken: async () => null };
  const ORG_STORE = `${HOME}/.mattstack/teams/acme/mattstack/org/settings.org.jsonc`;
  const GITHUB = { name: "Acme", remote: "https://github.com/acme/repo.git", others: false };
  const orgStore = (p: ReturnType<typeof gitAwareFakeProbes>) => parseSettingsBody(p.readFile(ORG_STORE)!);

  test("withCreator makes them the org's admin, the first team's owner, and the first roster member, and keeps the header", () => {
    const before = scaffoldFiles("acme", "Acme", "https://github.com/acme/repo.git", [FAKE_PUBLIC_KEY], "widgets")["mattstack/org/settings.org.jsonc"]!;
    const after = withCreator(before, "widgets", { username: "dev1", agePublicKey: FAKE_PUBLIC_KEY });
    expect(after.split("\n")[0]).toBe(before.split("\n")[0]!);
    const org = parseSettingsBody(after);
    expect(org["mattstack.org"]).toEqual({ admins: ["dev1"], teams: { widgets: { owners: ["dev1"] } } });
    expect(org["mattstack.roster"]).toEqual([{ username: "dev1", agePublicKey: FAKE_PUBLIC_KEY, teams: ["widgets"] }]);
  });

  test("withCreator never replaces an admin the store already names", () => {
    const once = withCreator(`{ "board.title": "Acme" }`, "widgets", { username: "dev1" });
    expect(withCreator(once, "widgets", { username: "someone-else" })).toBe(once);
  });

  test("a create whose forge login is known records it and writes the roles", async () => {
    const p = gitAwareFakeProbes(HOME);
    const result = await createTeam(p, GITHUB, new FakeAgeKeySeam(), seams);
    expect(result.team).toBe("acme");
    expect(result.rolesDeferred).toBeUndefined();
    expect(readTeamLocal(p, "acme").forgeUsername).toBe("dev1");
    expect(orgStore(p)["mattstack.org"]).toEqual({ admins: ["dev1"], teams: { acme: { owners: ["dev1"] } } });
    expect(orgStore(p)["mattstack.roster"]).toEqual([{ username: "dev1", agePublicKey: FAKE_PUBLIC_KEY, teams: ["acme"] }]);
  });

  test("--first-team names the first team folder and its owner entry", async () => {
    const p = gitAwareFakeProbes(HOME);
    const result = await createTeam(p, { ...GITHUB, firstTeam: "widgets" }, new FakeAgeKeySeam(), seams);
    expect(result.team).toBe("widgets");
    expect(p.exists(`${HOME}/.mattstack/teams/acme/mattstack/teams/widgets/settings.team.jsonc`)).toBe(true);
    expect((orgStore(p)["mattstack.org"] as { teams: object }).teams).toEqual({ widgets: { owners: ["dev1"] } });
  });

  test("a first team name that is not a folder name is refused before anything is written", async () => {
    const p = gitAwareFakeProbes(HOME);
    await expect(createTeam(p, { ...GITHUB, firstTeam: "Widgets!" }, new FakeAgeKeySeam(), seams)).rejects.toMatchObject({ code: "bad-team-name" });
    expect(p.exists(`${HOME}/.mattstack/teams/acme`)).toBe(false);
  });

  test("on a recognized forge whose login is not known yet, create writes no username, admin, owner or roster entry, and never falls back to $USER", async () => {
    const p = gitAwareFakeProbes(HOME);
    p.env.USER = "localdev";
    const result = await createTeam(p, GITHUB, new FakeAgeKeySeam(), unknown);
    expect(result.rolesDeferred).toBe(true);
    expect(readTeamLocal(p, "acme").forgeUsername).toBeUndefined();
    expect("mattstack.org" in orgStore(p)).toBe(false);
    expect("mattstack.roster" in orgStore(p)).toBe(false);
  });

  test("the rerun after the forge connects writes the roles, records the username and commits the change", async () => {
    const commits: string[] = [];
    const p = gitAwareFakeProbes(HOME, (argv) => {
      if (argv[0] === "git" && argv[1] === "commit") commits.push(argv[argv.indexOf("-m") + 1]!);
      return null;
    });
    await createTeam(p, { ...GITHUB, firstTeam: "widgets" }, new FakeAgeKeySeam(), unknown);
    const second = await createTeam(p, { ...GITHUB, firstTeam: "widgets" }, new FakeAgeKeySeam(), seams);
    expect(second).toMatchObject({ created: false, team: "widgets" });
    expect(second.rolesDeferred).toBeUndefined();
    expect(readTeamLocal(p, "acme").forgeUsername).toBe("dev1");
    expect(orgStore(p)["mattstack.org"]).toEqual({ admins: ["dev1"], teams: { widgets: { owners: ["dev1"] } } });
    expect(commits).toEqual(["team: scaffold acme", "team: dev1 is the acme org's admin"]);
  });

  test("an org on no recognized forge records $USER, so its creator is still its admin", async () => {
    const p = gitAwareFakeProbes(HOME);
    p.env.USER = "localdev";
    const never = { forgeLogin: async () => { throw new Error("must not ask a forge"); }, forgeToken: async () => null };
    await createTeam(p, { name: "Acme", remote: "https://git.example.com/acme/repo.git", others: false }, new FakeAgeKeySeam(), never);
    expect(readTeamLocal(p, "acme").forgeUsername).toBe("localdev");
    expect((orgStore(p)["mattstack.org"] as { admins: string[] }).admins).toEqual(["localdev"]);
  });

  test("a second run keeps the roles and the username it already wrote", async () => {
    const p = gitAwareFakeProbes(HOME);
    await createTeam(p, GITHUB, new FakeAgeKeySeam(), seams);
    await createTeam(p, GITHUB, new FakeAgeKeySeam(), { forgeLogin: async () => "someone-else", forgeToken: async () => null });
    expect(readTeamLocal(p, "acme").forgeUsername).toBe("dev1");
    expect((orgStore(p)["mattstack.org"] as { admins: string[] }).admins).toEqual(["dev1"]);
  });
});
```

`gitAwareFakeProbes`' `intercept` returns an exec result to override or a falsy value to fall through; match its declared `Intercept` type (return `undefined` if it does not admit `null`). If `fakeProbes` freezes `env`, pass `env: { USER: "localdev" }` through `gitAwareFakeProbes` instead of assigning. Every other `createTeam` call in the file passes `seams` as its fourth argument so none reaches a real `gh`.

In `lib/setup/__tests__/steps-a.test.ts`, beside the existing `team.create` tests (use the file's `makeCtx` and the create intent those tests build):

```ts
  test("team.create writes the creator's roles under the forge login the run resolves", async () => {
    const remote = "https://github.com/acme/mattstack-team-personal.git";
    const p = fakeProbes({ home: "/fake-home", env: { RT_TEAM_REMOTE: remote }, exec: gitExecFor(remote) });
    const { ctx } = makeCtx(p, { teamOfOne: true, intent: null, team: { slug: "", name: "", mode: "none" } });

    expect((await teamCreateStep.run(ctx)).state).toBe("done");
    expect(readTeamLocal(p, "personal").forgeUsername).toBe("alice");
    const org = JSON.parse(p.readFile("/fake-home/.mattstack/teams/personal/mattstack/org/settings.org.jsonc")!.split("\n").filter((l) => !l.startsWith("//")).join("\n"));
    expect(org["mattstack.org"].admins).toEqual(["alice"]);
  });

  test("with no forge login yet, team.create ends partial and does not push", async () => {
    const remote = "https://github.com/acme/mattstack-team-personal.git";
    const pushes: string[][] = [];
    const base = gitExecFor(remote);
    const p = fakeProbes({
      home: "/fake-home",
      env: { RT_TEAM_REMOTE: remote, USER: "localdev" },
      exec: async (argv, opts) => {
        if (argv[0] === "gh") return { code: 1, stdout: "", stderr: "not logged in" };
        if (argv[0] === "git" && argv[1] === "push") pushes.push(argv);
        return base(argv, opts);
      },
    });
    const { ctx } = makeCtx(p, { teamOfOne: true, intent: null, team: { slug: "", name: "", mode: "none" } });

    expect(await teamCreateStep.run(ctx)).toEqual({
      state: "partial",
      detail: "The org is created, but rt could not read your forge login, so it has no admin yet",
      remedy: "Connect your forge account in Setup, then Retry",
    });
    expect(pushes).toEqual([]);
    expect(readTeamLocal(p, "personal").forgeUsername).toBeUndefined();
  });
```

(`gitExecFor` already answers `gh api` with the login `alice`, so the file's existing `team.create` tests keep ending `done`. Import `readTeamLocal` from `../../team/team-local.ts`.)

- [ ] **Step 2: Run to see them fail**

Run: `bun test lib/team/__tests__/create.test.ts lib/setup/__tests__/steps-a.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `create.ts` (`jsonc-parser`'s `applyEdits`, `modify` and `parse` join the imports):

```ts
export interface CreateTeamSeams {
  forgeLogin: typeof forgeLogin;
  forgeToken: typeof storedForgeToken;
}

const REAL_SEAMS: CreateTeamSeams = { forgeLogin, forgeToken: storedForgeToken };

const JSONC_EDIT = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

export function withCreator(storeText: string, team: string, creator: { username: string; agePublicKey?: string }): string {
  const current = parse(storeText, [], { allowTrailingComma: true }) as Record<string, unknown> | undefined;
  const admins = (current?.["mattstack.org"] as { admins?: unknown } | undefined)?.admins;
  if (Array.isArray(admins) && admins.length > 0) return storeText;
  const roles = { admins: [creator.username], teams: { [team]: { owners: [creator.username] } } };
  const entry = { username: creator.username, ...(creator.agePublicKey ? { agePublicKey: creator.agePublicKey } : {}), teams: [team] };
  const withRoles = applyEdits(storeText, modify(storeText, ["mattstack.org"], roles, JSONC_EDIT));
  return applyEdits(withRoles, modify(withRoles, ["mattstack.roster"], [entry], JSONC_EDIT));
}

/**
 * The creator's username, or null when it cannot be known yet. A recognized
 * forge answers with its login or not at all: a local account name written
 * in its place would not match the login a later restore records, and the
 * creator would lose admin. Only a host that is no forge rt knows uses $USER.
 */
async function creatorUsername(p: Probes, slug: string, remote: string, seams: CreateTeamSeams): Promise<string | null> {
  const recorded = readTeamLocal(p, slug).forgeUsername;
  if (recorded) return recorded;
  const forge = forgeFromRemote(remote);
  if (!forge) return p.env.USER ?? null;
  return seams.forgeLogin(p, forge.provider, forge.host, await seams.forgeToken(p, remote));
}
```

In `createTeam` (new fourth parameter `seams: CreateTeamSeams = REAL_SEAMS`):

- Right after `const slug = slugify(opts.name);`:

```ts
  const team = opts.firstTeam ?? defaultTeamName(slug);
  if (!TEAM_NAME_RE.test(team)) {
    throw new UserActionableError("bad-team-name", `${JSON.stringify(team)} cannot be a team name`, {}, { why: "A team name uses lowercase letters, digits and dashes, and starts with a letter." });
  }
```

- One helper inside `createTeam`, used by the first run and by a rerun:

```ts
  const orgStorePath = join(dir, "mattstack", "org", "settings.org.jsonc");
  /** Writes the creator into an org store that names no admin yet. Answers whether the file changed, and whether the roles are still waiting on a login. */
  const recordCreator = async (remote: string): Promise<{ changed: boolean; deferred: boolean; username: string | null }> => {
    const before = p.readFile(orgStorePath);
    if (before === null) return { changed: false, deferred: false, username: null };
    const username = await creatorUsername(p, slug, remote, seams);
    if (username === null) {
      const named = withCreator(before, team, { username: "x" }) === before;
      return { changed: false, deferred: !named, username: null };
    }
    const { publicKey } = await ensureAgeKey(ageKeySeam);
    const after = withCreator(before, team, { username, agePublicKey: publicKey });
    if (after !== before) p.writeFile(orgStorePath, after);
    if (!readTeamLocal(p, slug).forgeUsername) updateTeamLocal(p, slug, { forgeUsername: username });
    return { changed: after !== before, deferred: false, username };
  };
```

- The already-set-up branch (`originConfigured !== null && scaffolded`) records the creator before it returns, and commits the one file when it changed:

```ts
    const creator = await recordCreator(originConfigured);
    if (creator.changed) {
      const add = await p.exec(["git", "add", "--", "mattstack/org/settings.org.jsonc"], { cwd: dir });
      if (add.code !== 0) throw gitStepError("git-add-failed", "git add", add);
      const commit = await p.exec(["git", "commit", "-m", `team: ${creator.username} is the ${slug} org's admin`], { cwd: dir });
      if (commit.code !== 0) throw gitStepError("git-commit-failed", "git commit", commit);
    }
    // ... the existing writeIntent(...), with firstTeam: team added to its team object
    return { slug, team, name: opts.name, remote: stripUserinfo(originConfigured), dir, created: false, ...(creator.deferred ? { rolesDeferred: true as const } : {}) };
```

- In the build path, `writeScaffold()` is followed by `const creator = await recordCreator(remote);` in both places it is called (the git-deferred branch and the normal path, where it sits before `git add -A` so the scaffold commit carries the roles). Both returns gain `team` and `...(creator.deferred ? { rolesDeferred: true as const } : {})`.
- `scaffoldFiles` is called with the first team: `scaffoldFiles(slug, opts.name, remote, [publicKey], team)`.
- `recordIntent` and the early-return intent carry the first team: `team: { slug, name: opts.name, remote, others: opts.others, firstTeam: team }`.

`lib/setup/intent.ts`: `team?: { slug: string; name: string; remote: string; others: boolean; firstTeam?: string };`.

`lib/setup/steps/team.ts`: `resolveCreateOpts`' intent branch returns `{ name: intentTeam.name, remote: intentTeam.remote || null, createRepoOwner, others: intentTeam.others, ...(intentTeam.firstTeam ? { firstTeam: intentTeam.firstTeam } : {}) }`. `teamCreateRun` gives create the run's own forge token, as `teamJoinRun` does for join:

```ts
    created = await createTeam(ctx.p, opts, ctx.secrets.ageKeySeam, {
      forgeLogin,
      forgeToken: (_p, remote) => forgeTokenFor(ctx, remote),
    });
```

When `created.rolesDeferred` is set, the step ends `{ state: "partial", detail: "The org is created, but rt could not read your forge login, so it has no admin yet", remedy: "Connect your forge account in Setup, then Retry" }` instead of publishing: a publish would be refused, since nobody owns the clone yet.

`commands/team.ts` `teamCreate`: read `const firstTeam = flagValue(args, "--first-team");`, add `"--first-team"` to the `positional(args, [...])` value-flag list, pass `firstTeam` in the opts, and the usage string becomes `rt team create <name> [--first-team <name>] (--remote <url> | --create-repo <owner>) [--others] [--json]`. The human line reads `Created the ${result.slug} org` / `The ${result.slug} org is already set up`; when `result.rolesDeferred` is set, add `out.callout("next", "Connect your forge account in Setup so rt can make you this org's admin")`. Add a test in `commands/__tests__/team.test.ts`: `teamCreate(["Acme", "--remote", "https://github.com/acme/repo.git", "--first-team", "widgets", "--json"], {}, deps)` prints a flat envelope whose `team` is `"widgets"`, and `"widgets"` is not mistaken for the name positional.

`lib/command-tree-def.ts`, `team create`: description `"Start an org for your team, with its first team inside"`, the `Name` hint `"The org's display name; its folder name is made from it"`, and a new arg `{ name: "First team", flag: "--first-team", type: "text", placeholder: "widgets", hint: "The first team's name; the org's own name when left out" }`.

- [ ] **Step 4: Run, regenerate docs, commit**

```bash
bun test lib/team/__tests__/create.test.ts commands/__tests__/team.test.ts lib/setup
bunx tsc --noEmit
bun run docs:gen
git add lib/team/create.ts lib/setup/intent.ts lib/setup/steps/team.ts commands/team.ts lib/command-tree-def.ts
git add $(git diff --name-only -- '*.test.ts' docs)
git commit -m "rt team create: the creator is the org's admin, the first team's owner and on its roster, under their forge login"
```

### Task 26: `rt team add`

**Files:**
- Create: `lib/team/add.ts`
- Modify: `commands/team.ts` (`teamAdd`), `lib/command-tree-def.ts` (the `team add` node)
- Test: `lib/team/__tests__/add.test.ts` (new), `commands/__tests__/team.test.ts`

**Interfaces:**
- Consumes: `assertMayWrite`, `rolesFor` (Task 20), `renderPackFiles`, `packDescription`, `addMarketplacePlugin` (`lib/skills/init.ts`), `TEAM_NAME_RE`.
- Produces:

```ts
export interface AddTeamOpts { org: string; team: string; owners: string[] }
export interface AddTeamSeams {
  /** Writes one org-scope setting; `setSetting(key, value, "org")` in production. */
  writeOrgSetting: (key: string, value: unknown) => void;
  /** The `work` engine's description from the installed mattstack plugin, or null when it is not installed. */
  engineDescription: (engine: string) => string | null;
}
export interface AddTeamResult { org: string; team: string; dir: string; owners: string[]; wrote: string[] }
export function addTeam(p: Probes, opts: AddTeamOpts, seams: AddTeamSeams): AddTeamResult;
```

`rt team add <team> --owner <username>[,<username>] [--json]`, admin only.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/team/__tests__/add.test.ts
import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { addTeam, type AddTeamSeams } from "../add.ts";
import { teamLocalPath } from "../team-local.ts";

const HOME = "/home";
const ROOT = `${HOME}/.mattstack/teams/acme`;
const roles = { admins: ["dev1"], teams: { widgets: { owners: ["dev1"] } } };

function world(username = "dev1") {
  const p = fakeProbes({
    home: HOME,
    // The fake knows a folder only when it is listed here; it does not infer one from the files under it.
    dirs: { [`${ROOT}/mattstack/teams`]: ["widgets"], [`${ROOT}/mattstack/teams/widgets`]: ["settings.team.jsonc"] },
    files: {
      [`${ROOT}/mattstack/mattstack.jsonc`]: `{ "role": "org", "org": "acme" }`,
      [`${ROOT}/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": roles }),
      [`${ROOT}/mattstack/teams/widgets/settings.team.jsonc`]: "{}",
      [`${ROOT}/.claude-plugin/marketplace.json`]: JSON.stringify({ name: "acme", owner: { name: "Acme" }, plugins: [{ name: "widgets", source: "./mattstack/teams/widgets/packs/widgets" }] }, null, 2),
      [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: username }),
    },
  });
  const writes: [string, unknown][] = [];
  const seams: AddTeamSeams = { writeOrgSetting: (key, value) => { writes.push([key, value]); }, engineDescription: (e) => (e === "work" ? "Use when running a unit of work." : null) };
  return { p, seams, writes };
}

describe("addTeam", () => {
  test("creates the team folder, its settings, a pack skeleton, the marketplace entry and the owners", () => {
    const { p, seams, writes } = world();
    const out = addTeam(p, { org: "acme", team: "gadgets", owners: ["dev2"] }, seams);
    const dir = `${ROOT}/mattstack/teams/gadgets`;
    expect(out).toMatchObject({ org: "acme", team: "gadgets", dir, owners: ["dev2"] });
    expect(JSON.parse(p.readFile(`${dir}/settings.team.jsonc`)!.split("\n").filter((l) => !l.startsWith("//")).join("\n"))).toEqual({ "board.title": "gadgets" });
    expect(JSON.parse(p.readFile(`${dir}/packs/gadgets/.claude-plugin/plugin.json`)!)).toMatchObject({ name: "gadgets", version: "0.1.0" });
    expect(p.exists(`${dir}/packs/gadgets/pack/skills.jsonc`)).toBe(true);
    expect(p.exists(`${dir}/packs/gadgets/pack/stubs.jsonc`)).toBe(true);
    const market = JSON.parse(p.readFile(`${ROOT}/.claude-plugin/marketplace.json`)!) as { plugins: { name: string; source: string }[] };
    expect(market.plugins.map((x) => [x.name, x.source])).toEqual([["widgets", "./mattstack/teams/widgets/packs/widgets"], ["gadgets", "./mattstack/teams/gadgets/packs/gadgets"]]);
    expect(writes).toEqual([["mattstack.org", { admins: ["dev1"], teams: { widgets: { owners: ["dev1"] }, gadgets: { owners: ["dev2"] } } }]]);
  });

  test("only an org admin adds a team", () => {
    const { p, seams, writes } = world("dev2");
    expect(() => addTeam(p, { org: "acme", team: "gadgets", owners: ["dev2"] }, seams)).toThrow("The org's shared files belong to its admins");
    expect(p.exists(`${ROOT}/mattstack/teams/gadgets`)).toBe(false);
    expect(writes).toEqual([]);
  });

  test("a team that already exists, a bad name, no owner, or no mattstack plugin is refused before any write", () => {
    const { p, seams } = world();
    expect(() => addTeam(p, { org: "acme", team: "widgets", owners: ["dev2"] }, seams)).toThrow("The widgets team already exists");
    expect(() => addTeam(p, { org: "acme", team: "Gadgets", owners: ["dev2"] }, seams)).toThrow("cannot be a team name");
    expect(() => addTeam(p, { org: "acme", team: "gadgets", owners: [] }, seams)).toThrow("A team needs at least one owner");
    expect(() => addTeam(p, { org: "acme", team: "gadgets", owners: ["dev2"] }, { ...seams, engineDescription: () => null })).toThrow("The mattstack plugin is not installed");
    expect(p.exists(`${ROOT}/mattstack/teams/gadgets`)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `bun test lib/team/__tests__/add.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// lib/team/add.ts
import { dirname, join } from "path";
import { TEAM_NAME_RE } from "../settings/stores.ts";
import { UserActionableError } from "../errors.ts";
import type { Probes } from "../setup/probes.ts";
import { addMarketplacePlugin, packDescription, renderPackFiles } from "../skills/init.ts";
import { assertMayWrite, rolesFor } from "./roles.ts";

export interface AddTeamOpts {
  org: string;
  team: string;
  owners: string[];
}

export interface AddTeamSeams {
  writeOrgSetting: (key: string, value: unknown) => void;
  engineDescription: (engine: string) => string | null;
}

export interface AddTeamResult {
  org: string;
  team: string;
  dir: string;
  owners: string[];
  wrote: string[];
}

const SETTINGS_HEADER = "// mattstack team settings. Created by `rt team add`. JSONC: comments and trailing commas are fine.\n";

/**
 * Everything a new team needs before its owners take over: the folder, its
 * settings, a pack skeleton and the marketplace entry. The entry is written
 * here because root files belong to the admin, so an owner could never add it.
 */
export function addTeam(p: Probes, opts: AddTeamOpts, seams: AddTeamSeams): AddTeamResult {
  const { org, team, owners } = opts;
  assertMayWrite(p, org, ".claude-plugin/marketplace.json");
  if (!TEAM_NAME_RE.test(team)) {
    throw new UserActionableError("bad-team-name", `${JSON.stringify(team)} cannot be a team name`, {}, { why: "A team name uses lowercase letters, digits and dashes, and starts with a letter." });
  }
  if (owners.length === 0) throw new UserActionableError("team-needs-owner", "A team needs at least one owner", {}, { next: `rt team add ${team} --owner <username>` });

  const root = join(p.home, ".mattstack", "teams", org);
  const dir = join(root, "mattstack", "teams", team);
  if (p.exists(dir)) throw new UserActionableError("team-exists", `The ${team} team already exists`);
  const workDescription = seams.engineDescription("work");
  if (workDescription === null) {
    throw new UserActionableError("mattstack-missing", "The mattstack plugin is not installed, so rt cannot write the team's pack", {}, { next: "rt setup pack" });
  }

  const wrote: string[] = [];
  const write = (path: string, text: string) => {
    p.mkdirp(dirname(path));
    p.writeFile(path, text);
    wrote.push(path);
  };

  write(join(dir, "settings.team.jsonc"), `${SETTINGS_HEADER}${JSON.stringify({ "board.title": team }, null, 2)}\n`);
  const packDir = join(dir, "packs", team);
  for (const [rel, text] of Object.entries(renderPackFiles({ pack: team, workDescription }))) write(join(packDir, rel), text);

  const marketPath = join(root, ".claude-plugin", "marketplace.json");
  const marketBefore = p.readFile(marketPath) ?? `${JSON.stringify({ name: org, owner: { name: org }, plugins: [] }, null, 2)}\n`;
  write(marketPath, addMarketplacePlugin(marketBefore, team, packDescription(team), `./mattstack/teams/${team}/packs/${team}`));

  const roles = rolesFor(p, org);
  seams.writeOrgSetting("mattstack.org", { admins: roles.admins, teams: { ...roles.teams, [team]: { owners } } });

  return { org, team, dir, owners, wrote };
}
```

`commands/team.ts`:

```ts
export async function teamAdd(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");
  const team = positional(args, ["--owner", "--team"])[0];
  const owners = (flagValue(args, "--owner") ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
  if (!team || owners.length === 0) {
    usageError(deps, json, "team add", "Name the new team and who owns it", "rt team add <team> --owner <username>[,<username>] [--json]");
  }
  try {
    const org = resolveTeamSlug(args, "team add");
    const result = addTeam(deps.probes, { org, team, owners }, deps.addTeamSeams ?? realAddTeamSeams());
    if (json) {
      deps.print(JSON.stringify(envelope(result)));
      return;
    }
    out.print(
      out.line("done", `Added the ${team} team`, `owned by ${owners.join(", ")}`),
      out.callout("next", [`Put people on it with `, out.cmd(`rt team members set <username> --teams ${team}`)]),
    );
  } catch (err) {
    if (err instanceof UserActionableError) exitTeamError(err, json, "team add", deps);
    throw err;
  }
}
```

with `addTeamSeams?: AddTeamSeams` on `TeamDeps` and:

```ts
function realAddTeamSeams(): AddTeamSeams {
  return {
    writeOrgSetting: (key, value) => setSetting(key, value, "org"),
    engineDescription: (engine) => {
      try {
        return loadStepSource(engine, resolvePluginRoots()).description;
      } catch {
        return null;
      }
    },
  };
}
```

Add `"team-exists"`, `"team-needs-owner"` and `"bad-team-name"` to `REFUSAL_CODES` only if they should draw as refusals; they are usage slips, so leave them as failures.

`lib/command-tree-def.ts`, inside `team.subcommands`:

```ts
      add: {
        description: "Add a team to your org, with its owners",
        module: "./commands/team.ts",
        fn: "teamAdd",
        omitBehavior: { exempt: "a new team's name cannot be listed" },
        args: [
          { name: "Team", type: "text", placeholder: "gadgets", hint: "The new team's name: lowercase letters, digits and dashes" },
          { name: "Owner", flag: "--owner", type: "text", placeholder: "dev2", hint: "Forge usernames who may change this team's settings and pack, comma separated" },
          SETUP_JSON_ARG,
        ],
      },
```

`commands/team.ts` is already in `lib/module-registry.ts`; no registry change.

- [ ] **Step 4: Run and commit**

```bash
bun test lib/team/__tests__/add.test.ts commands/__tests__/team.test.ts lib/__tests__/picker-conformance.test.ts
bun run picker:check
bun run docs:gen
git add lib/team/add.ts lib/team/__tests__/add.test.ts commands/team.ts lib/command-tree-def.ts
git add $(git diff --name-only -- '*.test.ts' docs)
git commit -m "rt team add: an admin adds a team folder, its pack skeleton, its marketplace entry and its owners"
```

### Task 27: Invites: admin only, `--teams`, and a pointer that carries who and which teams

**Files:**
- Modify: `lib/setup/intent.ts` (`InvitePointer`)
- Modify: `lib/team/invite-crypto.ts` (`assertInvitePointerShape` admits both pointer versions)
- Modify: `lib/team/invite.ts` (`MintInviteOpts`, `MintInviteSeams.publishRoster`, `mintInvite`, `addToRoster`)
- Modify: `lib/team/members.ts` (`withRosterKey`, `withoutMember`: usernames compare without case)
- Modify: `commands/team.ts` (`teamInvite`), `lib/command-tree-def.ts` (the `team invite` args)
- Test: `lib/team/__tests__/invite.test.ts`, `lib/team/__tests__/invite-crypto.test.ts`, `lib/team/__tests__/members.test.ts`, `commands/__tests__/team.test.ts`

**Interfaces:**
- Produces:

```ts
export interface InvitePointer {
  v: 2;
  team: string;      // the org slug (the field keeps its name: it is the clone's folder)
  name: string;
  remote: string;
  owner: string;
  forge: string;
  createdAt: string;
  /** The invited forge username; join refuses a different login. */
  username: string;
  /** The team folders the roster entry lists, first team first. */
  teams: string[];
  switchboard?: { url: string; token: string };
}
export const INVITE_POINTER_VERSION = 2;
export interface MintInviteOpts { slug: string; handle: string; teams: string[]; now: Date; requirePeering?: boolean }
// MintInviteSeams gains:
/** Commits the org store and pushes it now. The invite is made only after this returns. */
publishRoster: (p: Probes, slug: string, handle: string, remote: string, token: string | null) => Promise<void>;

// lib/team/members.ts
export function withRosterKey(roster: RosterMember[], handle: string, agePublicKey: string): RosterMember[];
export function withoutMember(roster: RosterMember[], handle: string): { roster: RosterMember[]; removed: RosterMember | null };
```

The invite is useless until the invitee's roster entry is in the org repo: join clones the repo, and a clone without the entry puts the joiner on no team. So `mintInvite` writes the entry and pushes it first, and makes the invite only once the push succeeded (spec section 8, Join).

`rt team invite --handle <h> [--teams <team>[,<team>]] [--team <org>] [--require-peering] [--json]`. With no `--teams`, the inviter's active team.

- [ ] **Step 1: Write the failing tests**

In `lib/team/__tests__/invite-crypto.test.ts`, beside the existing `seal`/`open` round-trip tests (use the key and id helpers those tests use):

```ts
  test("open admits a version 1 and a version 2 pointer: which versions join accepts is validatePointer's call", async () => {
    const key = generateKey();
    const idHex = generateId();
    const base = { team: "acme", name: "Acme", remote: "https://github.com/acme/org.git", owner: "dev1", forge: "github.com", createdAt: "2026-10-01T00:00:00.000Z" };
    for (const pointer of [{ v: 1, ...base }, { v: 2, ...base, username: "zaphod", teams: ["widgets"] }]) {
      expect(await open(await seal(pointer as never, key, idHex), key, idHex)).toMatchObject({ v: pointer.v, team: "acme" });
    }
    await expect(open(await seal({ v: 3, ...base } as never, key, idHex), key, idHex)).rejects.toMatchObject({ code: "invite-unreadable" });
  });
```

Without this, every new invite fails to open: `fetchPointer` maps the shape error to `invite-unknown`, and Task 28's `invite-outdated` is never reached.

In `lib/team/__tests__/members.test.ts` (pure functions, no harness):

```ts
describe("roster edits compare usernames without case", () => {
  const roster = [{ username: "Zaphod", name: "Z", teams: ["widgets"] }, { username: "trillian" }];

  test("recording a key for a member already listed in another case updates that entry", () => {
    expect(withRosterKey(roster, "zaphod", "age1zzz")).toEqual([{ username: "Zaphod", name: "Z", teams: ["widgets"], agePublicKey: "age1zzz" }, { username: "trillian" }]);
  });
  test("recording a key for someone new adds an entry", () => {
    expect(withRosterKey(roster, "ford", "age1fff").at(-1)).toEqual({ username: "ford", agePublicKey: "age1fff" });
  });
  test("removing finds the member in any case and hands back what it removed", () => {
    expect(withoutMember(roster, "ZAPHOD")).toEqual({ roster: [{ username: "trillian" }], removed: roster[0] });
    expect(withoutMember(roster, "ford")).toEqual({ roster, removed: null });
  });
});
```

In `lib/team/__tests__/invite.test.ts` (every existing `mintInvite` call gains `teams: ["widgets"]`; `baseSeams`' `readTeamStore` default becomes `() => ({ "mattstack.roster": [] })`, and it gains `publishRoster: async () => {}`):

```ts
  describe("teams", () => {
    test("the pointer carries the invited username and the teams, at version 2", async () => {
      const p = probesWithRemote(REMOTE);
      const relay = fakeRelayClient();
      const { seams } = baseSeams();
      const result = await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets", "gadgets"], now: NOW }, seams);
      const { idHex, key } = decodeCode(result.code);
      const pointer = await open(relay.createCalls[0]!.ciphertext, key, idHex);
      expect(pointer).toMatchObject({ v: 2, team: "acme", username: "zaphod", teams: ["widgets", "gadgets"] });
    });

    test("a new roster entry carries the teams, first team first, written at org scope", async () => {
      const { seams, writeCalls } = baseSeams();
      await mintInvite(probesWithRemote(REMOTE), fakeRelayClient().client, { slug: SLUG, handle: "zaphod", teams: ["widgets", "gadgets"], now: NOW }, seams);
      expect(writeCalls).toEqual([{ key: "mattstack.roster", value: [{ username: "zaphod", teams: ["widgets", "gadgets"] }], scope: "org", opts: undefined }]);
    });

    test("re-inviting someone already on the roster adds the new teams after their own and keeps their first team", async () => {
      const { seams, writeCalls } = baseSeams({ readTeamStore: () => ({ "mattstack.roster": [{ username: "Zaphod", name: "Z", teams: ["gadgets"] }] }) });
      await mintInvite(probesWithRemote(REMOTE), fakeRelayClient().client, { slug: SLUG, handle: "zaphod", teams: ["widgets", "gadgets"], now: NOW }, seams);
      expect(writeCalls[0]!.value).toEqual([{ username: "Zaphod", name: "Z", teams: ["gadgets", "widgets"] }]);
    });

    test("an invite with no team, or a team name that is not a folder name, is refused before anything is minted", async () => {
      const relay = fakeRelayClient();
      const { seams } = baseSeams();
      await expect(mintInvite(probesWithRemote(REMOTE), relay.client, { slug: SLUG, handle: "zaphod", teams: [], now: NOW }, seams)).rejects.toMatchObject({ code: "invite-needs-team" });
      await expect(mintInvite(probesWithRemote(REMOTE), relay.client, { slug: SLUG, handle: "zaphod", teams: ["../x"], now: NOW }, seams)).rejects.toMatchObject({ code: "bad-team-name" });
      expect(relay.createCalls).toEqual([]);
    });

    test("the roster entry is written and pushed before the invite exists", async () => {
      const relay = fakeRelayClient();
      const order: string[] = [];
      const { seams } = baseSeams({
        writeSetting: (() => { order.push("roster"); }) as unknown as MintInviteSeams["writeSetting"],
        publishRoster: async (_p, slug, handle) => { order.push(`publish ${slug} ${handle}, invites so far: ${relay.createCalls.length}`); },
      });
      await mintInvite(probesWithRemote(REMOTE), relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);
      expect(order).toEqual(["roster", "publish acme zaphod, invites so far: 0"]);
      expect(relay.createCalls.length).toBe(1);
    });

    test("a re-invite whose entry needs no change still pushes: an earlier write may never have left this Mac", async () => {
      let pushed = 0;
      const { seams, writeCalls } = baseSeams({
        readTeamStore: () => ({ "mattstack.roster": [{ username: "zaphod", teams: ["widgets"] }] }),
        publishRoster: async () => { pushed++; },
      });
      await mintInvite(probesWithRemote(REMOTE), fakeRelayClient().client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);
      expect(writeCalls).toEqual([]);
      expect(pushed).toBe(1);
    });

    test("a push that fails makes no invite, and says what to do", async () => {
      const relay = fakeRelayClient();
      const { seams } = baseSeams({ publishRoster: async () => { throw new UserActionableError("push-denied", "The org repo refused the push"); } });
      await expect(mintInvite(probesWithRemote(REMOTE), relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams)).rejects.toMatchObject({
        code: "roster-not-published",
        message: "rt could not push zaphod's roster entry, so it made no invite",
        why: "The org repo refused the push",
      });
      expect(relay.createCalls).toEqual([]);
    });

    test("a team with no folder in the org is refused", async () => {
      const relay = fakeRelayClient();
      const { seams } = baseSeams();
      const p = probesWithRemote(REMOTE, { "/home/.mattstack/teams/acme/mattstack/teams/widgets/settings.team.jsonc": "{}" });
      await expect(mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["sprockets"], now: NOW }, seams)).rejects.toMatchObject({ code: "no-such-team" });
      expect(relay.createCalls).toEqual([]);
    });
  });
```

`probesWithRemote(REMOTE)` in the other tests gains the `widgets` (and where used, `gadgets`) team settings file through its `extraFiles` argument; the simplest change is to add both files to `probesWithRemote`'s own default file map.

In `commands/__tests__/team.test.ts`, inside the describe that holds `inviteDeps` (it has `home`, `teamDir` and `GIT_CONFIG`). The verb gains a `mintInvite` seam on `TeamDeps`, so these tests check what the verb decides without minting:

```ts
  describe("who may invite, and to which team", () => {
    const MINTED = { code: "C", expiresAt: "2026-01-08T00:00:00.000Z", pasteBlock: "x", forgeAccess: "skipped", manualSteps: [], link: "l", peering: "none" } as unknown as InviteResult;

    function orgDeps(username: string, minted: MintInviteOpts[]): TeamDeps & { lines: string[]; exitCodes: number[] } {
      const probes = fakeProbes({
        home,
        files: {
          [join(teamDir, ".git", "config")]: GIT_CONFIG,
          [join(teamDir, "mattstack", "org", "settings.org.jsonc")]: JSON.stringify({
            "mattstack.org": { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } },
            "mattstack.roster": [{ username: "dev1", teams: ["widgets"] }, { username: "dev2", teams: ["widgets"] }],
          }),
          [teamLocalPath(home, "acme")]: JSON.stringify({ forgeUsername: username }),
        },
      });
      return baseDeps({ probes, mintInvite: async (_p, _relay, opts) => { minted.push(opts); return MINTED; } });
    }

    test("only an org admin invites; an owner is told who can", async () => {
      const minted: MintInviteOpts[] = [];
      const deps = orgDeps("dev2", minted);
      const code = await runExpectingProcessExit(() => teamInvite(["--handle", "zaphod", "--team", "acme", "--json"], {}, deps));
      expect(code).toBe(2);
      expect(JSON.parse(deps.lines[0]!).error).toMatchObject({ code: "team-pull-only", message: "Only an org admin invites" });
      expect(minted).toEqual([]);
    });

    test("with no --teams the invite is for the inviter's own team, so the app's Invite button needs no new flag", async () => {
      const minted: MintInviteOpts[] = [];
      await teamInvite(["--handle", "zaphod", "--team", "acme", "--json"], {}, orgDeps("dev1", minted));
      expect(minted[0]).toMatchObject({ slug: "acme", handle: "zaphod", teams: ["widgets"] });
    });

    test("--teams names the team folders, in order", async () => {
      const minted: MintInviteOpts[] = [];
      await teamInvite(["--handle", "zaphod", "--team", "acme", "--teams", "gadgets,widgets", "--json"], {}, orgDeps("dev1", minted));
      expect(minted[0]!.teams).toEqual(["gadgets", "widgets"]);
    });
  });
```

Import `type InviteResult`, `type MintInviteOpts` from `../../lib/team/invite.ts` and `teamLocalPath` from `../../lib/team/team-local.ts`. The two tests that pinned the joined-clone refusal ("a joined machine refuses before the relay is ever touched" and "human mode: a pull-only clone refuses to invite, as a refused line") are replaced by the owner test above; keep a human-mode twin of it that expects stderr `[refused] Only an org admin invites\n  why: Ask dev1 to invite zaphod.\n`.

The file's other invite tests run the real mint through `inviteDeps`. Its fake probes gain what an admin's Mac has: the org store above (roles and roster), the record with `forgeUsername: "dev1"`, `mattstack/teams/widgets/settings.team.jsonc` holding `{}`, and `dirs: { [teamDir]: [] }` so the publish step finds the clone. The real mint writes the roster through `setSetting`, which reads the role from disk, so `inviteDeps` also calls `seedOrg({ org: "acme", username: "dev1", roles: { admins: ["dev1"], teams: {} }, roster: [{ username: "dev1", teams: ["widgets"] }], teams: { widgets: {} } })` under the test's HOME first. `ghExec()` already answers every git command with success, which is all the roster push needs.

- [ ] **Step 2: Run to see them fail**

Run: `bun test lib/team/__tests__/invite.test.ts commands/__tests__/team.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the pointer and the mint**

`lib/setup/intent.ts`: replace `InvitePointer` with the Interfaces block's shape and add `export const INVITE_POINTER_VERSION = 2;`.

`lib/team/invite.ts`:

- `MintInviteOpts` gains `teams: string[]`.
- At the top of `mintInvite`, after `assertValidHandle`:

```ts
  if (opts.teams.length === 0) {
    throw new UserActionableError("invite-needs-team", "Say which team the invite is for", {}, { next: "rt team invite --handle <username> --teams <team>" });
  }
  for (const team of opts.teams) {
    if (!TEAM_NAME_RE.test(team)) throw new UserActionableError("bad-team-name", `${JSON.stringify(team)} is not a team name`);
    if (!p.exists(join(p.home, ".mattstack", "teams", opts.slug, "mattstack", "teams", team, "settings.team.jsonc"))) {
      throw new UserActionableError("no-such-team", `This org has no ${team} team`, {}, { next: `rt team add ${team} --owner <username>` });
    }
  }
  const teams = [...new Set(opts.teams)];
```

- The pointer literal: `v: INVITE_POINTER_VERSION, ..., username: opts.handle, teams,`.
- Move the roster write from after `resolveForgeAccess` to directly before `const key = generateKey();`, and push it there:

```ts
  // The entry is in the org repo before the invite exists: a joiner whose
  // clone lacks it lands on no team, and the sync engine's debounce is no
  // promise the push happened.
  addToRoster(seams, opts.slug, opts.handle, teams);
  try {
    await seams.publishRoster(p, opts.slug, opts.handle, remote, token);
  } catch (err) {
    throw new UserActionableError("roster-not-published", `rt could not push ${opts.handle}'s roster entry, so it made no invite`, {}, {
      why: err instanceof Error ? err.message : String(err),
      next: "rt team pull",
    });
  }
```

- `realMintInviteSeams()` supplies the push:

```ts
    publishRoster: async (p, slug, handle, remote, token) => {
      const dir = join(p.home, ".mattstack", "teams", slug);
      const file = "mattstack/org/settings.org.jsonc";
      const add = await p.exec(["git", "add", "--", file], { cwd: dir });
      if (add.code !== 0) throw new UserActionableError("git-add-failed", "rt could not stage the roster change", {}, { log: add.stderr });
      const commit = await p.exec(["git", "commit", "-m", `team: invite ${handle}`, "--", file], { cwd: dir });
      // "nothing to commit" is fine: the sync engine committed it first, or the entry was already there.
      if (commit.code !== 0 && !/nothing to commit|no changes added/i.test(`${commit.stdout}\n${commit.stderr}`)) {
        throw new UserActionableError("git-commit-failed", "rt could not commit the roster change", {}, { log: commit.stderr });
      }
      await publishTeam(p, slug, null, { token, tokenRemote: remote });
    },
```

Import `publishTeam` from `./publish.ts`. The seam takes the probes as its first argument, like `forgeToken` and `grantRead`, so `realMintInviteSeams()` keeps taking none.

- `addToRoster(seams, opts.slug, opts.handle, teams)`:

```ts
/** Adds the handle to the org roster with its teams. Someone already there keeps their order and gains the new teams after their own. */
function addToRoster(seams: MintInviteSeams, slug: string, handle: string, teams: string[]): void {
  const store = seams.readTeamStore(slug);
  const roster = Array.isArray(store["mattstack.roster"]) ? (store["mattstack.roster"] as RosterEntryLike[]) : [];
  const existing = roster.find((m) => typeof m.username === "string" && sameUser(m.username, handle));
  if (!existing) {
    seams.writeSetting("mattstack.roster", [...roster, { username: handle, teams }], "org");
    return;
  }
  const had = Array.isArray(existing.teams) ? (existing.teams as unknown[]).filter((t): t is string => typeof t === "string") : [];
  const next = [...had, ...teams.filter((t) => !had.includes(t))];
  if (next.length === had.length) return;
  seams.writeSetting("mattstack.roster", roster.map((m) => (m === existing ? { ...m, teams: next } : m)), "org");
}
```

Import `sameUser` from rt-client's `active-team.ts`, `TEAM_NAME_RE` from `../settings/stores.ts`, `join` from `path`.

`lib/team/invite-crypto.ts`, `assertInvitePointerShape`: `p.v === 1` becomes `(p.v === 1 || p.v === 2)`. The shape check only says "this is an invite pointer"; `validatePointer` in `join.ts` decides which version a join accepts and what a refusal says.

`lib/team/members.ts`: the roster edits become two exported pure functions, and `recordRosterKey` and `membersRemove` call them (Task 18 already reduced both to the one `mattstack.roster` key):

```ts
/** `handle`'s entry with this key, matched without case (forge usernames are case-insensitive); a new entry when nobody matches. */
export function withRosterKey(roster: RosterMember[], handle: string, agePublicKey: string): RosterMember[] {
  return roster.some((m) => sameUser(m.username, handle))
    ? roster.map((m) => (sameUser(m.username, handle) ? { ...m, agePublicKey } : m))
    : [...roster, { username: handle, agePublicKey }];
}

export function withoutMember(roster: RosterMember[], handle: string): { roster: RosterMember[]; removed: RosterMember | null } {
  const removed = roster.find((m) => sameUser(m.username, handle)) ?? null;
  return { roster: removed ? roster.filter((m) => m !== removed) : roster, removed };
}
```

`recordRosterKey` writes `withRosterKey(readRoster(seams, slug), handle, agePublicKey)`; `membersRemove` takes its roster entry (the one whose `agePublicKey` it un-shares) and the list it writes from `withoutMember(...)`, replacing both `m.username === handle` comparisons near lines 156 and 157 and the ones in `membersRemove`.

`commands/team.ts` `teamInvite`: replace the `local.joinedByRt` refusal with the admin check, and resolve the teams:

```ts
    if (roleFor(deps.probes, slug).kind !== "admin") {
      const admins = rolesFor(deps.probes, slug).admins;
      throw new UserActionableError("team-pull-only", "Only an org admin invites", {}, {
        why: admins.length > 0 ? `Ask ${admins.join(" or ")} to invite ${handle}.` : "This org names no admins yet.",
      });
    }
    const named = (flagValue(args, "--teams") ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
    const own = activeTeamFor(deps.probes, slug).team;
    const teams = named.length > 0 ? named : own ? [own] : [];
```

and pass `teams` to the mint, called as `(deps.mintInvite ?? mintInvite)(deps.probes, relay, { slug, handle, teams, now: deps.probes.now(), requirePeering: args.includes("--require-peering") })`. `TeamDeps` gains `mintInvite?: typeof mintInvite`. The active team is read through the probes (`activeTeamFor`, Task 17), like the role. The usage string becomes `rt team invite --handle <h> [--teams <team>[,<team>]] [--team <org>] [--require-peering] [--json]`.

`lib/command-tree-def.ts`, `team invite`: description `"Invite someone to your org and put them on a team"`; add `{ name: "Teams", flag: "--teams", type: "text", placeholder: "widgets", hint: "The teams to put them on, comma separated; your own team when left out" }`; the `Team` arg's hint becomes `"Which org clone; leave out, since a Mac holds one"`. Give the other org-level verbs' `Team` args (`publish`, `manage-membership`, `members sync`, `members remove`, `status`, `pull`) that same hint: the flag keeps its meaning (the clone's slug) because the Mac app passes it.

- [ ] **Step 4: Run and commit**

```bash
bun test lib/team commands/__tests__/team.test.ts
bunx tsc --noEmit
bun run docs:gen
git add lib/setup/intent.ts lib/team/invite.ts lib/team/invite-crypto.ts lib/team/members.ts commands/team.ts lib/command-tree-def.ts
git add $(git diff --name-only -- '*.test.ts' docs)
git commit -m "rt team invite: admin only, --teams, and a pointer that names the invitee and their teams"
```

`tsc` will flag `lib/team/join.ts` and its tests for the pointer's new fields; fix only the type errors here (the `POINTER` fixture gains `v: 2, username: "zaphod", teams: ["widgets"]`). Task 28 gives join its behavior.

### Task 28: Join checks the pointer, the login, and lands you on your first team

**Files:**
- Modify: `lib/team/join.ts` (`validatePointer`, `JoinResult`, `joinDryRun`, `joinRedeem`)
- Modify: `lib/setup/steps/team.ts` (`outcomeFromJoinError`)
- Modify: `lib/setup/plan.ts` (the pre-Install active team comes from the pointer)
- Modify: `commands/team.ts` (`joinBlocks`)
- Test: `lib/team/__tests__/join.test.ts`, `lib/setup/__tests__/plan.test.ts`, `lib/setup/__tests__/steps-a.test.ts`

**Interfaces:**
- Consumes: Task 27 `InvitePointer`, `INVITE_POINTER_VERSION`; `sameUser`; `updateTeamLocal`.
- Produces: `JoinResult` gains `teams: string[]` (the pointer's teams; `[]` when no pointer was read). Error codes: `invite-outdated` (a pointer from before version 2), `invite-login-mismatch` (the signed-in login is not the invited one), `roster-not-ready` (the clone's roster does not list the invitee, even after one more pull). All three are raised before the invite is redeemed, and `roster-not-ready` keeps the intent so a rerun resumes.
- Produces, from `lib/setup/plan.ts`: `pendingJoinTeam(intent: SetupIntent | null, orgs: string[]): string | null | undefined`.

The Mac app shows a refused dry run as the error's message alone (`RtUserError` carries only `code` and `message`), so a message a person has to act on carries its remedy in the sentence itself.

- [ ] **Step 1: Write the failing tests**

In `lib/team/__tests__/join.test.ts` (`POINTER` is already `v: 2, username: "zaphod", teams: ["widgets"]` from Task 27; `baseJoinRedeemSeams`' `forgeLogin` answers `"zaphod"`). The file's `redeemProbes` fakes the clone with an exec that writes nothing, so it now seeds what a real clone would bring, merged under whatever a test passes:

```ts
  const ORG_STORE = `${TEAM_DIR}/mattstack/org/settings.org.jsonc`;
  const rosterWith = (...usernames: string[]) => JSON.stringify({ "mattstack.roster": usernames.map((username) => ({ username, teams: ["widgets"] })) });

  function redeemProbes(overrides: Parameters<typeof fakeProbes>[0] = {}): ReturnType<typeof fakeProbes> {
    return fakeProbes({ home: HOME, now: NOW, exec: () => ({ code: 0, stdout: "", stderr: "" }), ...overrides, files: { [ORG_STORE]: rosterWith("zaphod"), ...(overrides.files ?? {}) } });
  }
```

```ts
  describe("pointer version", () => {
    test("an invite made before teams is refused: ask for a new one", async () => {
      const old = { ...POINTER, v: 1 } as unknown as InvitePointer;
      const p = fakeProbes({ home: HOME, now: NOW });
      await expect(joinDryRun(p, relayWith(old), CODE)).rejects.toMatchObject({ code: "invite-outdated", message: "That invite was made by an older mattstack. Ask for a new invite." });
      expect(readIntent(p)).toBeNull();
      expect(p.exists(TEAM_DIR)).toBe(false);
    });

    test("a pointer whose username or teams are not what they claim is malformed", async () => {
      const p = fakeProbes({ home: HOME, now: NOW });
      for (const bad of [{ ...POINTER, teams: ["../x"] }, { ...POINTER, teams: [] }, { ...POINTER, username: "bad handle!" }]) {
        await expect(joinDryRun(p, relayWith(bad as InvitePointer), CODE)).rejects.toMatchObject({ code: "invite-malformed" });
      }
    });
  });

  describe("teams", () => {
    test("the dry run reports the pointer's teams before any clone exists", async () => {
      const p = redeemProbes();
      const result = await joinDryRun(p, relayWith({ ...POINTER, teams: ["widgets", "gadgets"] }), CODE);
      expect(result.teams).toEqual(["widgets", "gadgets"]);
    });

    test("a redeem records the login as this Mac's username and makes the first team active", async () => {
      const p = redeemProbes();
      const { seams, calls } = baseJoinRedeemSeams();
      const result = await joinRedeem(p, fakeRelay({ fetch: relayServing({ ...POINTER, teams: ["gadgets", "widgets"] }) }).client, () => NO_SECRETS, { code: CODE }, seams);
      expect(result).toMatchObject({ access: "ok", teams: ["gadgets", "widgets"] });
      expect(readTeamLocal(p, "acme").forgeUsername).toBe("zaphod");
      expect(calls.userSettingWrites).toContainEqual({ key: "mattstack.activeTeam", value: "gadgets" });
    });
  });

  describe("the login has to be the invited one", () => {
    test("a different login is refused before the invite is redeemed, naming both and the fix", async () => {
      const p = redeemProbes();
      const relay = fakeRelay();
      const { seams, calls } = baseJoinRedeemSeams({ forgeLogin: (async () => "trillian") as JoinRedeemSeams["forgeLogin"] });
      await expect(joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams)).rejects.toMatchObject({
        code: "invite-login-mismatch",
        message: "This invite is for zaphod; you're signed in as trillian.",
        why: "Ask for an invite for trillian, or connect zaphod's token.",
      });
      expect(relay.redeemCalls).toEqual([]);
      expect(readTeamLocal(p, "acme").forgeUsername).toBeUndefined();
      expect(calls.userSettingWrites).toEqual([]);
    });

    test("the same login in another case is the same person", async () => {
      const p = redeemProbes();
      const { seams } = baseJoinRedeemSeams({ forgeLogin: (async () => "Zaphod") as JoinRedeemSeams["forgeLogin"] });
      const result = await joinRedeem(p, fakeRelay().client, () => NO_SECRETS, { code: CODE }, seams);
      expect(result.access).toBe("ok");
      expect(readTeamLocal(p, "acme").forgeUsername).toBe("Zaphod");
    });
  });
```

```ts
  describe("the roster entry has to be in the clone", () => {
    test("a clone whose roster lacks the invitee pulls once, and joins when the pull brings the entry", async () => {
      const p = redeemProbes({
        files: { [ORG_STORE]: rosterWith() },
        exec: (argv) => {
          if (argv[0] === "git" && argv.includes("pull")) p.writeFile(ORG_STORE, rosterWith("zaphod"));
          return { code: 0, stdout: "", stderr: "" };
        },
      });
      const { seams, calls } = baseJoinRedeemSeams();
      const result = await joinRedeem(p, fakeRelay().client, () => NO_SECRETS, { code: CODE }, seams);
      expect(result.access).toBe("ok");
      expect(calls.userSettingWrites).toContainEqual({ key: "mattstack.activeTeam", value: "widgets" });
    });

    test("still missing after the pull: refused before the invite is used, with the intent kept so a rerun resumes", async () => {
      const p = redeemProbes({ files: { [ORG_STORE]: rosterWith("trillian") } });
      const relay = fakeRelay();
      const { seams, calls } = baseJoinRedeemSeams();
      await expect(joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams)).rejects.toMatchObject({
        code: "roster-not-ready",
        message: "Your admin's roster change has not reached the org repo yet; try again in a minute",
      });
      expect(p.calls.exec.filter((argv) => argv[0] === "git" && argv.includes("pull")).length).toBe(1);
      expect(relay.redeemCalls).toEqual([]);
      expect(readIntent(p)?.mode).toBe("join");
      expect(readTeamLocal(p, "acme").forgeUsername).toBeUndefined();
      expect(calls.userSettingWrites).toEqual([]);
    });

    test("the invitee is found whatever the case of the roster entry", async () => {
      const p = redeemProbes({ files: { [ORG_STORE]: rosterWith("Zaphod") } });
      const result = await joinRedeem(p, fakeRelay().client, () => NO_SECRETS, { code: CODE }, baseJoinRedeemSeams().seams);
      expect(result.access).toBe("ok");
      expect(p.calls.exec.some((argv) => argv.includes("pull"))).toBe(false);
    });
  });
```

(`readIntent` comes from `../../setup/intent.ts`. The mismatch test above gains `expect(readIntent(p)?.mode).toBe("join");` too: a refused login keeps the invite and the intent.)

In `lib/setup/__tests__/steps-a.test.ts`, beside the other `outcomeFromJoinError` tests:

```ts
  test("a login mismatch is a failed step whose detail names both logins and whose remedy is the fix", () => {
    const err = new UserActionableError("invite-login-mismatch", "This invite is for zaphod; you're signed in as trillian.", {}, { why: "Ask for an invite for trillian, or connect zaphod's token." });
    expect(outcomeFromJoinError(err)).toEqual({ state: "failed", detail: "This invite is for zaphod; you're signed in as trillian.", remedy: "Ask for an invite for trillian, or connect zaphod's token." });
  });

  test("a roster that has not arrived is a failed step that says no new code is needed", () => {
    const err = new UserActionableError("roster-not-ready", "Your admin's roster change has not reached the org repo yet; try again in a minute");
    expect(outcomeFromJoinError(err)).toEqual({ state: "failed", detail: "Your admin's roster change has not reached the org repo yet; try again in a minute", remedy: "Retry in a minute. You do not need a new code" });
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `bun test lib/team/__tests__/join.test.ts lib/setup/__tests__/steps-a.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`lib/team/join.ts`, `validatePointer`, before the slug check:

```ts
  if ((pointer as { v?: unknown }).v !== INVITE_POINTER_VERSION) {
    throw new UserActionableError("invite-outdated", "That invite was made by an older mattstack. Ask for a new invite.");
  }
```

and after the remote check:

```ts
  const teams = Array.isArray(pointer.teams) ? pointer.teams : [];
  if (typeof pointer.username !== "string" || !HANDLE_PATTERN.test(pointer.username) || teams.length === 0 || !teams.every((t) => typeof t === "string" && TEAM_NAME_RE.test(t))) {
    throw new UserActionableError("invite-malformed", "rt could not read that invite", {}, { log: "invite pointer's username or teams are not valid" });
  }
```

(export `HANDLE_PATTERN` from `invite.ts` and import it; `fetchPointer`'s catch already lets `UserActionableError`s other than connectivity ones through, but it wraps `open()` failures as `invite-unknown`: make sure `validatePointer` runs outside that inner `try`, as it does today.)

`JoinResult` gains `teams: string[]`. Every place that builds one from a pointer adds `teams: pointer.teams`; `NO_TEAM` results add `teams: []`. The cleanest way is in `teamRefFrom`'s callers: `{ team: teamRefFrom(pointer), teams: pointer.teams, ... }`, and in `unreachableResult` / `deniedResult` a `teams` parameter defaulting to `[]`.

In `joinRedeem`, directly after the clone branch (the `if (existingOrigin !== null) { ... } else { ... }` block), before the snapshot is read:

```ts
  // The invite's roster entry has to be in this clone, or the active team
  // ignores the setting written below and the joiner lands on no team. The
  // inviter pushes it before the invite exists; one pull covers a clone that
  // predates the push (a resumed join, a re-join).
  if (!rosterLists(p, pointer.team, pointer.username)) {
    const pull = gitWithToken(["pull", "--ff-only"], token, GIT_ENV, { remote: pointer.remote });
    await p.exec(pull.argv, { cwd: dir, env: pull.env });
    if (!rosterLists(p, pointer.team, pointer.username)) {
      throw new UserActionableError("roster-not-ready", "Your admin's roster change has not reached the org repo yet; try again in a minute", {}, { log: `mattstack.roster in ${dir} does not list ${pointer.username}` });
    }
  }
```

with, beside the file's other helpers:

```ts
function rosterLists(p: Pick<Probes, "readFile" | "home">, org: string, username: string): boolean {
  const file = join(p.home, ".mattstack", "teams", org, "mattstack", "org", "settings.org.jsonc");
  const raw = p.readFile(file);
  return raw !== null && rosterFrom(parseStoreText(file, raw)).some((entry) => sameUser(entry.username, username));
}
```

(`rosterFrom` and `sameUser` from rt-client's `active-team.ts`, `parseStoreText` from its `stores.ts`.) The intent written at the top of `joinRedeem` is left in place by the throw, which is what lets a bare rerun resume.

Then, directly after the `if (!handle) { throw ... }` block:

```ts
  if (!sameUser(handle, pointer.username)) {
    throw new UserActionableError("invite-login-mismatch", `This invite is for ${pointer.username}; you're signed in as ${handle}.`, {}, {
      why: `Ask for an invite for ${handle}, or connect ${pointer.username}'s token.`,
    });
  }
```

and directly after the `relay.redeem` block succeeds (before `peerBoard`):

```ts
  updateTeamLocal(p, pointer.team, { forgeUsername: handle });
  // Before plugins.install runs, so the first Install lands this team's pack.
  seams.writeUserSetting("mattstack.activeTeam", pointer.teams[0]!);
```

`lib/setup/steps/team.ts` needs no change for the mismatch (`outcomeFromJoinError` already maps a `UserActionableError`'s `why` to the remedy through `remedyFrom`); the new test pins it. For the roster case add, beside the `secrets-store-not-ready` branch:

```ts
  if (err instanceof UserActionableError && err.code === "roster-not-ready") {
    return { state: "failed", detail: err.message, remedy: "Retry in a minute. You do not need a new code" };
  }
```

`commands/team.ts` `joinBlocks`: when `result.teams.length > 0`, add `out.kv("teams", result.teams.join(", "))` under the status line.

`lib/setup/plan.ts`: the clone does not exist before Install, so the pre-Install plan takes the active team from the pointer. One exported pure function decides it, so a test can hold it without a marketplace on disk:

```ts
/** The team whose pack the plan lists before the org is cloned: a join's pointer names it, since no settings can yet. Undefined once the clone exists: read it from there. */
export function pendingJoinTeam(intent: SetupIntent | null, orgs: string[]): string | null | undefined {
  const pointer = intent?.mode === "join" ? intent.join?.pointer : undefined;
  if (!pointer || orgs.includes(pointer.team)) return undefined;
  return pointer.teams[0] ?? null;
}
```

and where `composePlan` calls `toolRows(...)`, its opts gain `activeTeam: pendingJoinTeam(intent, i.orgs)` (Task 17 gave `toolRows` the option; `undefined` means "read the clone").

Add to `lib/setup/__tests__/plan.test.ts` (its `joinIntent()` builder gains `v: 2, username: "zaphod", teams: ["gadgets", "widgets"]` on the pointer):

```ts
  describe("pendingJoinTeam", () => {
    test("a join with no clone yet takes the pointer's first team", () => {
      expect(pendingJoinTeam(joinIntent(), [])).toBe("gadgets");
    });
    test("once the org is cloned, the clone decides", () => {
      expect(pendingJoinTeam(joinIntent(), [joinIntent().join!.pointer.team])).toBeUndefined();
    });
    test("no intent, or a create intent, has no pending team", () => {
      expect(pendingJoinTeam(null, [])).toBeUndefined();
      expect(pendingJoinTeam(createIntent(), [])).toBeUndefined();
    });
  });
```

- [ ] **Step 4: Run and commit**

```bash
bun test lib/team lib/setup commands/__tests__/team-join.test.ts commands/__tests__/team.test.ts
bunx tsc --noEmit
git add lib/team/join.ts lib/team/invite.ts lib/setup/plan.ts lib/setup/steps/team.ts commands/team.ts
git add $(git diff --name-only -- '*.test.ts')
git commit -m "rt team join: refuse an old or mismatched invite, record who you are, start on your first team"
```

The `--json` envelope of `rt team join` and `rt team join --dry-run` gains `teams`; existing fields keep their shape. Name it in the PR body.

### Task 29: `rt team members set --teams`

**Files:**
- Modify: `lib/team/members.ts` (`membersSetTeams`)
- Modify: `commands/team.ts` (`teamMembersSet`), `lib/command-tree-def.ts` (`team members set`)
- Test: `lib/team/__tests__/members.test.ts`, `commands/__tests__/team.test.ts`

**Interfaces:**
- Produces:

```ts
export interface MembersSetResult { username: string; teams: string[]; previous: string[] }
export function membersSetTeams(p: Probes, seams: MembersSeams, slug: string, handle: string, teams: string[]): MembersSetResult;
```

`rt team members set <username> --teams <team>[,<team>] [--team <org>] [--json]`, admin only. The first team listed is the member's primary team.

- [ ] **Step 1: Write the failing tests**

In `lib/team/__tests__/members.test.ts` (it builds `MembersSeams` with a `writeSetting` spy and a `readTeamStore` fake; the probes need the org store with roles and an admin's record, plus the team folders' settings files):

```ts
  describe("membersSetTeams", () => {
    const roster = [{ username: "dev1", teams: ["widgets"] }, { username: "Dev2", name: "Dev Two", teams: ["widgets"] }];

    test("replaces a member's teams, keeping the rest of their entry, and reports the old ones", () => {
      const { p, seams, writes } = membersWorld({ username: "dev1", roster });
      expect(membersSetTeams(p, seams, "acme", "dev2", ["gadgets", "widgets"])).toEqual({ username: "Dev2", teams: ["gadgets", "widgets"], previous: ["widgets"] });
      expect(writes).toEqual([{ key: "mattstack.roster", value: [roster[0], { username: "Dev2", name: "Dev Two", teams: ["gadgets", "widgets"] }], scope: "org" }]);
    });

    test("only an org admin changes teams", () => {
      const { p, seams, writes } = membersWorld({ username: "dev2", roster });
      expect(() => membersSetTeams(p, seams, "acme", "dev1", ["gadgets"])).toThrow("The org's shared files belong to its admins");
      expect(writes).toEqual([]);
    });

    test("someone not on the roster, a team with no folder, and a bad name are refused", () => {
      const { p, seams } = membersWorld({ username: "dev1", roster });
      expect(() => membersSetTeams(p, seams, "acme", "stranger", ["widgets"])).toThrow("stranger is not in this org yet");
      expect(() => membersSetTeams(p, seams, "acme", "dev2", ["sprockets"])).toThrow("This org has no sprockets team");
      expect(() => membersSetTeams(p, seams, "acme", "dev2", ["../x"])).toThrow("is not a team name");
    });

    test("an empty list takes someone off every team but leaves them in the org", () => {
      const { p, seams, writes } = membersWorld({ username: "dev1", roster });
      expect(membersSetTeams(p, seams, "acme", "dev2", []).teams).toEqual([]);
      expect((writes[0]!.value as { teams: string[] }[])[1]!.teams).toEqual([]);
    });
  });
```

Add a small `membersWorld({ username, roster })` helper to the test file: fake probes with the org store (`mattstack.org` roles `{ admins: ["dev1"], teams: {} }`), the record for `username`, `widgets` and `gadgets` team settings files, `readTeamStore: () => ({ "mattstack.roster": roster })`, and a `writeSetting` spy that records `{ key, value, scope }`.

- [ ] **Step 2: Run to see them fail**

Run: `bun test lib/team/__tests__/members.test.ts -t membersSetTeams`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
export interface MembersSetResult {
  username: string;
  teams: string[];
  previous: string[];
}

/** The first team listed is the member's primary team: the one they use until they pick another. */
export function membersSetTeams(p: Probes, seams: MembersSeams, slug: string, handle: string, teams: string[]): MembersSetResult {
  assertMayWrite(p, slug, "mattstack/org/settings.org.jsonc");
  for (const team of teams) {
    if (!TEAM_NAME_RE.test(team)) throw new UserActionableError("bad-team-name", `${JSON.stringify(team)} is not a team name`);
    if (!p.exists(join(p.home, ".mattstack", "teams", slug, "mattstack", "teams", team, "settings.team.jsonc"))) {
      throw new UserActionableError("no-such-team", `This org has no ${team} team`, {}, { next: `rt team add ${team} --owner <username>` });
    }
  }
  const roster = readRoster(seams, slug);
  const entry = roster.find((m) => sameUser(m.username, handle));
  if (!entry) throw new UserActionableError("not-a-member", `${handle} is not in this org yet`, {}, { next: `rt team invite --handle ${handle} --teams <team>` });
  const previous = Array.isArray(entry.teams) ? (entry.teams as unknown[]).filter((t): t is string => typeof t === "string") : [];
  const next = [...new Set(teams)];
  seams.writeSetting("mattstack.roster", roster.map((m) => (m === entry ? { ...m, teams: next } : m)), "org");
  return { username: entry.username, teams: next, previous };
}
```

`commands/team.ts`:

```ts
export async function teamMembersSet(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");
  let handle = positional(args, ["--teams", "--team"])[0];
  const teamsFlag = flagValue(args, "--teams");
  try {
    const slug = resolveTeamSlug(args, "team members set");
    if (!handle && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
      const candidates = readOrgRosterNames(deps.probes, slug);
      if (candidates.length > 0) {
        const { filterableSelect } = await import("../lib/pick-wrappers.ts");
        handle = (await filterableSelect({ message: "Whose teams?", options: candidates.map((name) => ({ value: name, label: name })) })) ?? undefined;
        if (!handle) process.exit(0);
      }
    }
    if (!handle || teamsFlag === undefined) {
      usageError(deps, json, "team members set", "Say whose teams, and which", "rt team members set <username> --teams <team>[,<team>] [--json]");
    }
    const teams = teamsFlag.split(",").map((s) => s.trim()).filter((s) => s !== "");
    const result = membersSetTeams(deps.probes, deps.membersSeams ?? realMembersSeams(), slug, handle, teams);
    if (json) {
      deps.print(JSON.stringify(envelope(result)));
      return;
    }
    out.print(out.line("done", `${result.username} is on ${result.teams.length > 0 ? result.teams.join(", ") : "no team"}`, result.previous.length > 0 ? `was on ${result.previous.join(", ")}` : undefined));
  } catch (err) {
    if (err instanceof UserActionableError) exitTeamError(err, json, "team members set", deps);
    throw err;
  }
}
```

`readOrgRosterNames(p, slug)` reads the org store through probes (`parseStoreText` plus `rosterFrom`) and returns the usernames; match `filterableSelect`'s real option shape from `lib/pick-wrappers.ts` (the `members remove` picker in this file is the model). Add `membersSeams?: MembersSeams` to `TeamDeps` if `teamMembersRemove` does not already have such a seam.

`lib/command-tree-def.ts`, inside `team.members.subcommands`:

```ts
          set: {
            description: "Change which teams someone is on",
            module: "./commands/team.ts",
            fn: "teamMembersSet",
            omitBehavior: "picker",
            args: [
              { name: "Username", type: "text", placeholder: "dev2", hint: "The member's forge username" },
              { name: "Teams", flag: "--teams", type: "text", placeholder: "widgets,gadgets", hint: "Their teams, comma separated; the first is the one they start on" },
              { name: "Team", flag: "--team", type: "text", placeholder: "acme", hint: "Which org clone; leave out, since a Mac holds one" },
              SETUP_JSON_ARG,
            ],
          },
```

and the `members` branch description becomes `"Members: collect keys, change teams, remove someone"`.

- [ ] **Step 4: Run and commit**

```bash
bun test lib/team/__tests__/members.test.ts commands/__tests__/team.test.ts lib/__tests__/picker-conformance.test.ts
bun run picker:check && bun run docs:gen
git add lib/team/members.ts commands/team.ts lib/command-tree-def.ts
git add $(git diff --name-only -- '*.test.ts' docs)
git commit -m "rt team members set: an admin changes which teams someone is on"
```

### Task 30: `rt team use`

**Files:**
- Create: `lib/team/use.ts`
- Modify: `commands/team.ts` (`teamUse`), `lib/command-tree-def.ts` (`team use`)
- Test: `lib/team/__tests__/use.test.ts` (new), `commands/__tests__/team.test.ts`

**Interfaces:**
- Consumes: `ActiveTeam` (Task 4), `installPlugins` (`lib/setup/steps/plugins.ts`), `materializeSkills` (`lib/setup/skills-materialize.ts`), `claudeConfigDirs` (`lib/setup/tools-install.ts`), `resolveTool`, `bundledToolPath` (`lib/deps/resolve.ts`).
- Produces:

```ts
export interface UseTeamSeams {
  activeTeam: () => ActiveTeam;
  writeUserSetting: (key: string, value: unknown) => void;
  /** Installs the new team's pack the way an update run does (it never re-enables a plugin the member turned off), then rewrites the bindings. `ok` is whether the plugins step did not fail. */
  installPack: () => Promise<{ ok: boolean; detail: string }>;
  /** `claude plugin enable|disable <id>` in every Claude config folder; false when claude refused. */
  setPackEnabled: (pluginId: string, enabled: boolean) => Promise<boolean>;
  /** The org marketplace's name, for the plugin id. */
  marketplace: (org: string) => string;
  restartApp: (app: "board" | "boxscore") => Promise<boolean>;
}
export interface UseTeamResult { team: string; previous: string | null; pack: { installed: boolean; enabled: boolean; detail: string }; disabled: string | null; restarted: string[] }
export async function useTeam(team: string, seams: UseTeamSeams): Promise<UseTeamResult>;
```

`rt team use <team> [--json]`. With no team at a terminal, a picker over the teams the roster lists you on.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/team/__tests__/use.test.ts
import { describe, expect, test } from "bun:test";
import type { ActiveTeam } from "../../../packages/rt-client/src/settings/active-team.ts";
import { UserActionableError } from "../../errors.ts";
import { useTeam, type UseTeamSeams } from "../use.ts";

function world(active: Partial<ActiveTeam>, overrides: Partial<UseTeamSeams> = {}) {
  const log: string[] = [];
  const seams: UseTeamSeams = {
    activeTeam: () => ({ org: "acme", team: "widgets", reason: "first-team", username: "dev2", listedOn: ["widgets", "gadgets"], ...active }),
    writeUserSetting: (key, value) => { log.push(`set ${key}=${String(value)}`); },
    installPack: async () => { log.push("install"); return { ok: true, detail: "1 pack" }; },
    setPackEnabled: async (id, enabled) => { log.push(`${enabled ? "enable" : "disable"} ${id}`); return true; },
    marketplace: () => "acme-market",
    restartApp: async (app) => { log.push(`restart ${app}`); return true; },
    ...overrides,
  };
  return { seams, log };
}

describe("useTeam", () => {
  test("switches, installs and enables the new pack, disables the old one, and restarts the apps, in that order", async () => {
    const { seams, log } = world({});
    const result = await useTeam("gadgets", seams);
    expect(log).toEqual(["set mattstack.activeTeam=gadgets", "install", "enable gadgets@acme-market", "disable widgets@acme-market", "restart board", "restart boxscore"]);
    expect(result).toEqual({ team: "gadgets", previous: "widgets", pack: { installed: true, enabled: true, detail: "1 pack" }, disabled: "widgets@acme-market", restarted: ["board", "boxscore"] });
  });

  test("a team the roster does not list you on is refused, and nothing changes", async () => {
    const { seams, log } = world({});
    await expect(useTeam("sprockets", seams)).rejects.toMatchObject({ code: "not-on-team", message: "The roster does not list you on the sprockets team" });
    expect(log).toEqual([]);
  });

  test("a Mac rt cannot identify is refused", async () => {
    const { seams } = world({ username: null, listedOn: [], team: null, reason: "identity" });
    await expect(useTeam("widgets", seams)).rejects.toMatchObject({ code: "forge-login-unknown" });
  });

  test("no org on this Mac is refused", async () => {
    const { seams } = world({ org: null, team: null, reason: "no-org", username: null, listedOn: [] });
    await expect(useTeam("widgets", seams)).rejects.toBeInstanceOf(UserActionableError);
  });

  test("choosing the team you are already on still makes sure its pack is installed and enabled, and disables nothing", async () => {
    const { seams, log } = world({ team: "gadgets", reason: "chosen" });
    const result = await useTeam("gadgets", seams);
    expect(log).toEqual(["set mattstack.activeTeam=gadgets", "install", "enable gadgets@acme-market", "restart board", "restart boxscore"]);
    expect(result.disabled).toBeNull();
  });

  test("a failed install or restart is reported, never thrown: the switch itself stands", async () => {
    const { seams } = world({}, { installPack: async () => ({ ok: false, detail: "claude is not installed" }), restartApp: async () => false });
    const result = await useTeam("gadgets", seams);
    expect(result.pack).toEqual({ installed: false, enabled: false, detail: "claude is not installed" });
    expect(result.restarted).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `bun test lib/team/__tests__/use.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// lib/team/use.ts
import type { ActiveTeam } from "../../packages/rt-client/src/settings/active-team.ts";
import { UserActionableError } from "../errors.ts";

export interface UseTeamSeams {
  activeTeam: () => ActiveTeam;
  writeUserSetting: (key: string, value: unknown) => void;
  installPack: () => Promise<{ ok: boolean; detail: string }>;
  setPackEnabled: (pluginId: string, enabled: boolean) => Promise<boolean>;
  marketplace: (org: string) => string;
  restartApp: (app: "board" | "boxscore") => Promise<boolean>;
}

export interface UseTeamResult {
  team: string;
  previous: string | null;
  pack: { installed: boolean; enabled: boolean; detail: string };
  disabled: string | null;
  restarted: string[];
}

/**
 * The setting is written first: everything after reads the active team, so
 * the install lands the new team's pack. A team pack is otherwise never
 * enabled by rt; here the member asked for the switch, so it is.
 */
export async function useTeam(team: string, seams: UseTeamSeams): Promise<UseTeamResult> {
  const before = seams.activeTeam();
  if (before.org === null) throw new UserActionableError("no-team", "This Mac has no org yet", {}, { next: "rt team join" });
  if (before.username === null) {
    throw new UserActionableError("forge-login-unknown", "rt can't tell who you are, so it cannot tell which teams you are on", {}, { why: "Connect your forge account in Setup, then try again." });
  }
  if (!before.listedOn.includes(team)) {
    throw new UserActionableError("not-on-team", `The roster does not list you on the ${team} team`, {}, {
      why: before.listedOn.length > 0 ? `You are on ${before.listedOn.join(", ")}. An org admin adds you to another.` : "An org admin adds you to a team.",
    });
  }

  seams.writeUserSetting("mattstack.activeTeam", team);
  const marketplace = seams.marketplace(before.org);
  const installed = await seams.installPack();
  const enabled = installed.ok ? await seams.setPackEnabled(`${team}@${marketplace}`, true) : false;

  let disabled: string | null = null;
  if (before.team !== null && before.team !== team) {
    const previousId = `${before.team}@${marketplace}`;
    if (await seams.setPackEnabled(previousId, false)) disabled = previousId;
  }

  const restarted: string[] = [];
  for (const app of ["board", "boxscore"] as const) if (await seams.restartApp(app)) restarted.push(app);

  return { team, previous: before.team, pack: { installed: installed.ok, enabled, detail: installed.detail }, disabled, restarted };
}
```

`commands/team.ts` (`teamUse`), with the real seams built from the pieces `setupPack` already uses:

```ts
export async function teamUse(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");
  let team = positional(args, [])[0];
  try {
    const seams = deps.useTeamSeams ?? (await realUseTeamSeams(deps));
    if (!team) {
      const choices = seams.activeTeam().listedOn;
      if (choices.length > 0 && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
        const { filterableSelect } = await import("../lib/pick-wrappers.ts");
        team = (await filterableSelect({ message: "Which team?", options: choices.map((name) => ({ value: name, label: name })) })) ?? undefined;
        if (!team) process.exit(0);
      } else {
        usageError(deps, json, "team use", "Which team do you want to work as?", "rt team use <team> [--json]");
      }
    }
    const result = await useTeam(team, seams);
    if (json) {
      deps.print(JSON.stringify(envelope(result)));
      return;
    }
    out.print(
      out.line("done", `You are working as the ${result.team} team`, result.previous && result.previous !== result.team ? `was ${result.previous}` : undefined),
      result.pack.enabled
        ? out.line("done", `The ${result.team} pack is on`)
        : out.line("needs-you", `The ${result.team} pack is not on yet`, result.pack.detail),
      ...(result.pack.enabled ? [out.callout("next", "Restart Claude Code sessions to pick up the new pack")] : [out.callout("next", out.cmd("rt setup pack"))]),
    );
  } catch (err) {
    if (err instanceof UserActionableError) exitTeamError(err, json, "team use", deps);
    throw err;
  }
}
```

`realUseTeamSeams(deps)`:

- `activeTeam`: rt-client's `activeTeam`.
- `writeUserSetting`: `(key, value) => setSetting(key, value, "user")`.
- `installPack`: an update-mode plugins install, then the bindings. Not `setupPackFlow`: that also checks the pipeline's stage bindings, and an unbound stage in a team's pack is no reason to leave the pack the member just asked for switched off. And not a full-install context: without `update`, the plugins step re-enables every trusted plugin the member disabled.

```ts
    installPack: async () => {
      const { realApplyDeps } = await import("./setup.ts");
      const apply = realApplyDeps();
      const ctx = await createApplyContext({
        probes: deps.probes,
        emit: () => {},
        secrets: apply.secrets,
        relay: apply.relay,
        secretPresence: apply.secretPresence,
        flags: { nonInteractive: true, teamOfOne: false, ci: false, update: true },
        needOpts: apply.needOpts,
      });
      const plugins = await installPlugins(ctx);
      if (plugins.state === "failed") return { ok: false, detail: plugins.detail };
      await materializeSkills(ctx.p, {});
      return { ok: true, detail: plugins.detail };
    },
```

Every side effect of this verb sits behind `UseTeamSeams`, and no test below the seam runs it: the compiled binary would find the machine's real `claude` on PATH and the installed app's real `deck` (`bundledToolPath` resolves `/Applications`, whatever HOME is). Task 34 drives the real seams over fake `exec`; the e2e suite never runs this verb (Task 37 says how it switches teams instead).
- `setPackEnabled`: for each `dir` of `claudeConfigDirs(deps.probes, [])`, `deps.probes.exec([...claude.exec, "plugin", enabled ? "enable" : "disable", id], { env: { CLAUDE_CONFIG_DIR: dir }, timeoutMs: PACK_EXEC_TIMEOUT_MS })`; success is exit 0 or an "already enabled" / "already disabled" stderr; return false when `resolveTool(deps.probes, "claude").exec` is null.
- `marketplace`: `readServedPacks`' marketplace name: parse `<clone>/.claude-plugin/marketplace.json`'s `name`, falling back to the org slug.
- `restartApp`: `const deck = (deps.deckPath ?? ((probes) => bundledToolPath(probes, "deck")))(deps.probes);` (the installed app's own deck, as `deckManagedRun` in `lib/setup/steps/deck.ts` resolves it; never `update-machine.ts`'s private `bundleDeck`, which is the dev app's). `deck === null` answers false; else `(await deps.probes.exec([deck, "restart", app])).code === 0`.

Add `"not-on-team"` to `REFUSAL_CODES` (it is a refusal by policy, drawn as a `refused` note), and to `TeamDeps`: `useTeamSeams?: UseTeamSeams` and `/** Test seam: where the installed app's deck is. A test cannot resolve the real bundle. */ deckPath?: (p: Probes) => string | null`.

`lib/command-tree-def.ts`:

```ts
      use: {
        description: "Switch which of your teams you work as",
        module: "./commands/team.ts",
        fn: "teamUse",
        omitBehavior: "picker",
        args: [
          { name: "Team", type: "text", placeholder: "gadgets", hint: "One of the teams the org put you on" },
          SETUP_JSON_ARG,
        ],
      },
```

In `commands/__tests__/team.test.ts`, add (with `useTeamSeams` on the file's deps builder set to recording fakes shaped like `world()` in `use.test.ts`): `teamUse(["gadgets", "--json"], {}, deps)` prints a flat envelope (`const { contract, at, ...body } = JSON.parse(line)`) whose `body` equals the `UseTeamResult`; `teamUse(["--json"], ...)` with no team exits 2 with the usage title "Which team do you want to work as?"; a `not-on-team` refusal without `--json` writes `[refused] The roster does not list you on the sprockets team` to stderr and exits 2.

- [ ] **Step 4: Run and commit**

```bash
bun test lib/team/__tests__/use.test.ts commands/__tests__/team.test.ts lib/__tests__/picker-conformance.test.ts
bun run picker:check && bun run docs:gen
bunx tsc --noEmit
git add lib/team/use.ts lib/team/__tests__/use.test.ts commands/team.ts lib/command-tree-def.ts
git add $(git diff --name-only -- '*.test.ts' docs)
git commit -m "rt team use: switch your active team, install and enable its pack, restart the apps"
```

### Task 31: `rt team status --json` says your role and your teams

**Files:**
- Modify: `commands/team.ts` (`teamStatus`)
- Test: `commands/__tests__/team-status.test.ts`

**Interfaces:**
- Consumes: `roleFor` (Task 20), `activeTeamFor` (Task 17), `TEAM_NAME_RE`.
- Produces: the flat envelope gains `role: "admin" | "owner" | "member" | "unknown"`, `activeTeam: string | null`, `teams: string[]` (the teams the roster lists you on, first team first), and `orgTeams: string[]` (every team folder in the org, so the Mac app can offer a team picker to an admin). Every existing field keeps its name and shape. The solo envelope gains `role: null, activeTeam: null, teams: [], orgTeams: []`.

Everything new is read through `deps.probes` and the `statusRead` seam, never rt-client's disk readers: this verb's tests run over fake probes at a home that does not exist.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/team-status.test.ts`, beside `clonedDeps` (the file's fake probes know a folder only when `dirs` lists it):

```ts
  describe("role and teams", () => {
    const ORG_STORE = join(TEAM_DIR, "mattstack", "org", "settings.org.jsonc");
    const roster = [{ username: "dev1", teams: ["widgets"] }, { username: "dev2", teams: ["gadgets", "widgets"] }, { username: "dev3", teams: ["gadgets"] }];
    const roles = { admins: ["dev1"], teams: { gadgets: { owners: ["dev2"] } } };

    function depsFor(username: string | null): TeamDeps & { lines: string[] } {
      return baseDeps({
        probes: fakeProbes({
          home: HOME,
          dirs: { [TEAM_DIR]: [], [join(TEAM_DIR, "mattstack", "teams")]: ["widgets", "gadgets", ".DS_Store"] },
          files: {
            [join(TEAM_DIR, ".git", "config")]: GIT_CONFIG,
            [ORG_STORE]: JSON.stringify({ "mattstack.roster": roster, "mattstack.org": roles }),
            ...(username ? { [join(HOME, ".mattstack", "rt", "teams", `${SLUG}.json`)]: JSON.stringify({ forgeUsername: username }) } : {}),
          },
        }),
        statusRead: fakeRead({ "board.title": "Acme Team", "mattstack.roster": roster }),
        daemon: async () => null,
      });
    }

    async function status(username: string | null): Promise<Record<string, unknown>> {
      const deps = depsFor(username);
      await teamStatus(["--team", SLUG, "--json"], {}, deps);
      const { at: _at, ...body } = JSON.parse(deps.lines[0]!);
      return body;
    }

    test("an admin on one team sees their team's members and every team in the org", async () => {
      expect(await status("dev1")).toMatchObject({
        slug: "acme",
        role: "admin",
        activeTeam: "widgets",
        teams: ["widgets"],
        orgTeams: ["gadgets", "widgets"],
        members: [{ username: "dev1" }, { username: "dev2" }],
      });
    });

    test("an owner on two teams starts on the first in their roster entry", async () => {
      expect(await status("dev2")).toMatchObject({ role: "owner", activeTeam: "gadgets", teams: ["gadgets", "widgets"], members: [{ username: "dev2" }, { username: "dev3" }] });
    });

    test("someone on no team is a member with no active team and sees the whole org", async () => {
      expect(await status("stranger")).toMatchObject({ role: "member", activeTeam: null, teams: [], members: [{ username: "dev1" }, { username: "dev2" }, { username: "dev3" }] });
    });

    test("a Mac rt cannot identify reports an unknown role", async () => {
      expect(await status(null)).toMatchObject({ role: "unknown", activeTeam: null, teams: [] });
    });

    test("the existing fields keep their shape", async () => {
      const body = await status("dev1");
      for (const key of ["contract", "slug", "name", "remote", "lastPush", "members", "lastPull", "lastPushAt", "lastPullSkipped", "conflicted", "pullOnly"]) expect(key in body).toBe(true);
    });
  });
```

The file's first test pins the exact envelope with `toEqual`: add `role: "unknown", activeTeam: null, teams: [], orgTeams: []` to what it expects (its probes hold no record and no team folders), and change its roster seed from `board.members` to `mattstack.roster`. The solo-envelope test gains `role: null, activeTeam: null, teams: [], orgTeams: []`.

- [ ] **Step 2: Run to see them fail, then implement**

Run: `bun test commands/__tests__/team-status.test.ts`
Expected: FAIL.

In `teamStatus`:

- The solo result: `{ mode: "solo" as const, slug: null, name: null, remote: null, lastPush: null, members: [] as never[], role: null, activeTeam: null, teams: [] as never[], orgTeams: [] as never[] }`.
- Replace the members read:

```ts
    const active = activeTeamFor(deps.probes, slug);
    const role = roleFor(deps.probes, slug).kind;
    const orgTeams = deps.probes.readDir(join(dir, "mattstack", "teams")).filter((name) => TEAM_NAME_RE.test(name)).sort();
    const rosterValue = read<unknown>("mattstack.roster");
    const everyone = Array.isArray(rosterValue) ? rosterValue : [];
    const onTeam = active.team === null
      ? everyone
      : everyone.filter((m) => Array.isArray((m as { teams?: unknown } | null)?.teams) && (m as { teams: unknown[] }).teams.includes(active.team));
    const members = toRosterMembers(onTeam, (skipped) =>
      warn("team", `skipped ${skipped} malformed mattstack.roster entr${skipped === 1 ? "y" : "ies"} (missing or non-string username)`, {
        show: { title: "Some team members could not be read", hint: `${skipped} left out` },
      }),
    );
```

(Task 18 already removed the `board.members` fallback from this read.)
- `const result = { slug, name, remote, lastPush, members, role, activeTeam: active.team, teams: active.listedOn, orgTeams, ...sync };`
- The human section gains two rows after `members`: `out.kv("your team", active.team ?? "none")` and `out.kv("your role", role === "admin" ? "org admin" : role === "owner" ? "team owner" : role === "member" ? "member" : "unknown")`; its title stays the org's display name.

`name` stays what `read<string>("board.title")` resolves to (the active team's title, else the org's, else the slug): the Mac app shows it as the pane's heading, and a member thinks of "their team" by that name.

- [ ] **Step 3: Run and commit**

```bash
bun test commands/__tests__/team-status.test.ts commands/__tests__/team.test.ts
git add commands/team.ts commands/__tests__/team-status.test.ts
git commit -m "rt team status: report your role, your active team and your teams"
```

### Task 32: Setup pulls the org and records who you are

**Files:**
- Modify: `lib/setup/contract.ts` (`STEP_IDS`)
- Create: `lib/setup/steps/org.ts` (`orgPullStep`, `teamIdentityStep`)
- Modify: `lib/setup/steps/index.ts` (`STEPS`), `lib/setup/apply.ts` (`reloadTeam`)
- Modify: `lib/setup/steps/skills.ts` (nothing to seed any more; confirm Task 18 left no `board.defaultPack` write)
- Modify: `commands/setup.ts` (`connectCredential` records the username after a forge connect; `ConnectDeps.forgeLogin`)
- Test: `lib/setup/__tests__/steps-org.test.ts` (new), `lib/setup/__tests__/update-safe.test.ts`, `lib/setup/__tests__/apply.test.ts`, `lib/setup/__tests__/contract.test.ts` (the pinned `STEP_IDS`), `commands/__tests__/setup-connect.test.ts`, `commands/__tests__/setup-copy.test.ts` (snapshot)

**Interfaces:**
- Consumes: `forgeLogin`, `resolveForge` (`lib/setup/steps/forge-identity.ts`), `readTeamLocal`, `updateTeamLocal`, `forgeFromRemote`.
- Produces: step ids `org.pull` and `team.identity`, in that order, directly after `team.join`. Both are update-safe (`kind: "rt"`, `applies: () => true`, never `ctx.need`), so they are the first two steps of an update run, after the migrations.

```ts
export const orgPullStep: StepDef;       // id "org.pull", title "Pull your org"
export const teamIdentityStep: StepDef;  // id "team.identity", title "Record who you are"
/** Clone folders under ~/.mattstack/teams that are git repos, whatever layout they hold. */
export function cloneSlugs(p: Pick<Probes, "readDir" | "exists" | "home">): string[];
/** Records this Mac's forge username for the org while none is stored. The team.identity step and the forge connect both call it, so connecting the account clears the row at once. */
export async function recordForgeIdentity(
  p: Probes,
  slug: string,
  forge: { provider: "github" | "gitlab"; host: string } | null,
  token: string | null,
  login?: typeof forgeLogin,
): Promise<{ username: string | null; outcome: "already" | "recorded" | "unknown" }>;
```

`org.pull` never ends `failed`. A full Install stops at a failed step (`runApplyWith` in `lib/setup/apply.ts`), and a pull that could not run is no reason to stop an Install: the clone was just made, or team sync is off, or the network is down. Trouble is `skipped` or `partial` with the reason; an update run reports a `partial` item the same way it reports a failed one.

`org.pull` lists clones by their `.git`, never through `discoverOrgs`: on a member's first update after the conversion the clone still holds the old layout, so `discoverOrgs` sees nothing, and the pull is exactly what brings the new layout in.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/setup/__tests__/steps-org.test.ts
import { describe, expect, test } from "bun:test";
import { readTeamLocal, teamLocalPath } from "../../team/team-local.ts";
import { cloneSlugs, orgPullStep, teamIdentityStep } from "../steps/org.ts";
import { fakeProbes } from "./fakes.ts";

const HOME = "/h";
const CLONE = `${HOME}/.mattstack/teams/acme`;
const gitConfig = (remote: string) => `[remote "origin"]\n\turl = ${remote}\n`;
// The fake lists a folder only when `dirs` names it; it does not infer one from the files under it.
const TEAMS_DIR = { [`${HOME}/.mattstack/teams`]: ["acme", "notes"] };

describe("org.pull", () => {
  test("pulls every clone that is a git repo, even one still on the old layout", async () => {
    const pulled: string[] = [];
    const p = fakeProbes({
      home: HOME,
      dirs: TEAMS_DIR,
      files: { [`${CLONE}/.git/config`]: gitConfig("https://github.com/acme/org.git"), [`${CLONE}/mattstack/settings.team.jsonc`]: "{}", [`${HOME}/.mattstack/teams/notes/readme.md`]: "x" },
      daemon: async (cmd, payload) => { pulled.push(`${cmd} ${(payload as { slug: string }).slug}`); return { ok: true, data: { outcome: "fast-forwarded", detail: null } }; },
    });
    expect(cloneSlugs(p)).toEqual(["acme"]);
    let reloaded = 0;
    const { ctx } = makeCtx(p, { reloadTeam: () => { reloaded += 1; } });
    expect(await orgPullStep.run(ctx)).toEqual({ state: "done", detail: "Pulled acme" });
    expect(pulled).toEqual(["team:pull acme"]);
    expect(reloaded).toBe(1);
  });

  const files = { [`${CLONE}/.git/config`]: gitConfig("https://github.com/acme/org.git") };
  const pullWith = (daemon: Parameters<typeof fakeProbes>[0]["daemon"]) => orgPullStep.run(makeCtx(fakeProbes({ home: HOME, dirs: TEAMS_DIR, files, daemon })).ctx);

  test("no clone is a skip, and a stopped daemon is a skip that says so", async () => {
    expect(await orgPullStep.run(makeCtx(fakeProbes({ home: HOME })).ctx)).toEqual({ state: "skipped", detail: "No org on this Mac" });
    expect(await pullWith(async () => null)).toEqual({ state: "skipped", detail: "The rt daemon is not running, so the org is pulled once it is" });
  });

  test("team sync that is off, or has not started for this clone yet, is a skip: Install must not stop on it", async () => {
    const noTeam = async () => ({ ok: false, error: "no team", failure: { code: "no-team", message: "The acme team is not syncing on this Mac" } });
    expect(await pullWith(noTeam)).toEqual({ state: "skipped", detail: "Team sync has not started for acme yet, so it is pulled once it does" });
  });

  test("a pull that could not finish is partial with the reason, never failed", async () => {
    expect(await pullWith(async () => ({ ok: true, data: { outcome: "skipped", detail: "fetch failed: could not resolve host" } }))).toEqual({
      state: "partial",
      detail: "acme was not pulled: fetch failed: could not resolve host",
      remedy: "Run rt team status to see what is in the way",
    });
    expect(await pullWith(async () => ({ ok: true, data: { outcome: "conflict", detail: "mattstack/org/settings.org.jsonc" } }))).toMatchObject({ state: "partial", detail: "acme was not pulled: mattstack/org/settings.org.jsonc" });
    expect(await pullWith(async () => ({ ok: false, error: "daemon threw" }))).toMatchObject({ state: "partial", detail: "acme was not pulled: daemon threw" });
  });

  test("an up-to-date clone is done and says so", async () => {
    expect(await pullWith(async () => ({ ok: true, data: { outcome: "up-to-date", detail: null } }))).toEqual({ state: "done", detail: "acme is already up to date" });
  });
});

describe("team.identity", () => {
  const orgFiles = { [`${CLONE}/.git/config`]: gitConfig("https://github.com/acme/org.git"), [`${CLONE}/mattstack/org/settings.org.jsonc`]: "{}" };

  test("records the forge login while none is stored", async () => {
    const p = fakeProbes({ home: HOME, files: orgFiles });
    const { ctx } = makeCtx(p, { team: { slug: "acme", name: "Acme", mode: "none" }, identity: { login: async () => "dev1" } });
    expect(await teamIdentityStep.run(ctx)).toEqual({ state: "done", detail: "You are dev1" });
    expect(readTeamLocal(p, "acme").forgeUsername).toBe("dev1");
  });

  test("never overwrites a stored username", async () => {
    const p = fakeProbes({ home: HOME, files: { ...orgFiles, [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: "dev1" }) } });
    const { ctx } = makeCtx(p, { team: { slug: "acme", name: "Acme", mode: "none" }, identity: { login: async () => { throw new Error("must not ask"); } } });
    expect(await teamIdentityStep.run(ctx)).toEqual({ state: "skipped", detail: "Already recorded" });
  });

  test("an org on no recognized forge records $USER", async () => {
    const p = fakeProbes({ home: HOME, env: { USER: "localdev" }, files: { ...orgFiles, [`${CLONE}/.git/config`]: gitConfig("https://git.example.com/acme/org.git") } });
    const { ctx } = makeCtx(p, { team: { slug: "acme", name: "Acme", mode: "none" }, identity: { login: async () => { throw new Error("must not ask"); } } });
    expect(await teamIdentityStep.run(ctx)).toEqual({ state: "done", detail: "You are localdev" });
  });

  test("a recognized forge that will not say who you are needs you, and records nothing", async () => {
    const p = fakeProbes({ home: HOME, files: orgFiles });
    const { ctx } = makeCtx(p, { team: { slug: "acme", name: "Acme", mode: "none" }, identity: { login: async () => null } });
    expect(await teamIdentityStep.run(ctx)).toEqual({ state: "needs-you", detail: "rt can't tell who you are on GitHub. Connect your GitHub account in Setup" });
    expect(readTeamLocal(p, "acme").forgeUsername).toBeUndefined();
  });

  test("a clone still on the old layout is identified too, so its admin can push the conversion", async () => {
    const p = fakeProbes({ home: HOME, dirs: TEAMS_DIR, files: { [`${CLONE}/.git/config`]: gitConfig("https://github.com/acme/org.git"), [`${CLONE}/mattstack/settings.team.jsonc`]: "{}" } });
    const { ctx } = makeCtx(p, { identity: { login: async () => "dev1" } });
    expect(await teamIdentityStep.run(ctx)).toEqual({ state: "done", detail: "You are dev1" });
    expect(readTeamLocal(p, "acme").forgeUsername).toBe("dev1");
  });

  test("no org is a skip", async () => {
    expect(await teamIdentityStep.run(makeCtx(fakeProbes({ home: HOME })).ctx)).toEqual({ state: "skipped", detail: "No org on this Mac" });
  });
});
```

`makeCtx(p, overrides)` is the context builder each `steps-*.test.ts` file defines for itself; copy the one from `lib/setup/__tests__/steps-c.test.ts` (with its `fakeSecrets` and `fakeRelay` constants) into this file. `fakeProbes` already takes `daemon`. The `identity` override is the seam Step 3 adds.

In `lib/setup/__tests__/contract.test.ts`, the `STEP_IDS` test pins every id in order: rename it "matches the contract's 28 ids in order" and insert `"org.pull",` and `"team.identity",` after `"team.join",` in its list.

In `commands/__tests__/setup-connect.test.ts`, inside `describe("integrationConnect: forge token scopes", ...)` (it has `gitlabWithScopes` and `baseDeps`):

```ts
  test("connecting the org's forge records who you are, so the team.identity row clears without waiting for an update run", async () => {
    const probes = fakeProbes({
      fetch: gitlabWithScopes(["api", "read_user"]),
      dirs: { "/fake-home/.mattstack/teams": ["acme"] },
      files: { "/fake-home/.mattstack/teams/acme/.git/config": `[remote "origin"]\n\turl = https://gitlab.com/acme/org.git\n` },
    });
    const asked: unknown[][] = [];
    const deps = baseDeps({
      probes,
      stdin: async () => ({ token: "glpat-x" }),
      writer: { storeReady: async () => false, write: neverCalled("writer.write") },
      writeSetting: () => {},
      teamSnapshot: () => ({ ...slackTeamSnapshot(), slug: "acme", remote: "https://gitlab.com/acme/org.git", integrations: { forge: { host: "gitlab.com", provider: "gitlab" } } }),
      forgeLogin: async (...args: unknown[]) => { asked.push(args.slice(1)); return "dev2"; },
    });

    await integrationConnect("gitlab", ["--json"], deps);

    expect((JSON.parse(deps.lines[0]!) as { status: string }).status).toBe("ready");
    expect(asked).toEqual([["gitlab", "gitlab.com", "glpat-x"]]);
    expect(readTeamLocal(probes, "acme").forgeUsername).toBe("dev2");
  });

  test("a connect never replaces a stored username, and a different forge than the org's records nothing", async () => {
    const stored = fakeProbes({
      fetch: gitlabWithScopes(["api", "read_user"]),
      files: { "/fake-home/.mattstack/rt/teams/acme.json": JSON.stringify({ forgeUsername: "dev1" }) },
    });
    const deps = baseDeps({
      probes: stored,
      stdin: async () => ({ token: "glpat-x" }),
      writer: { storeReady: async () => false, write: neverCalled("writer.write") },
      writeSetting: () => {},
      teamSnapshot: () => ({ ...slackTeamSnapshot(), slug: "acme", integrations: { forge: { host: "gitlab.com", provider: "gitlab" } } }),
      forgeLogin: neverCalled("forgeLogin"),
    });
    await integrationConnect("gitlab", ["--json"], deps);
    expect(readTeamLocal(stored, "acme").forgeUsername).toBe("dev1");

    const github = baseDeps({
      probes: fakeProbes({ fetch: gitlabWithScopes(["api", "read_user"]) }),
      stdin: async () => ({ token: "glpat-x" }),
      writer: { storeReady: async () => false, write: neverCalled("writer.write") },
      writeSetting: () => {},
      teamSnapshot: () => ({ ...slackTeamSnapshot(), slug: "acme", integrations: { forge: { host: "github.com", provider: "github" } } }),
      forgeLogin: neverCalled("forgeLogin"),
    });
    await integrationConnect("gitlab", ["--json"], github);
    expect(readTeamLocal(github.probes, "acme").forgeUsername).toBeUndefined();
  });
```

(the staging write a not-yet-ready store triggers goes through the probes, as the file's other scope tests show; if `slackTeamSnapshot()` has no `remote`, the spread values above supply what `connectCredential` reads. Import `readTeamLocal` from `../../lib/team/team-local.ts`.)

In `lib/setup/__tests__/update-safe.test.ts`, the pinned list starts with the two new ids:

```ts
const UPDATE_SAFE: StepId[] = [
  "org.pull",
  "team.identity",
  "path.link",
  "settings.seed",
  "skills.materialize",
  "skills.link",
  "intercepts.install",
  "plugins.install",
  "claude.permissions",
  "fastbrowser.setup",
  "herdr.integration",
  "extension.install",
  "verify",
];
```

In `lib/setup/__tests__/apply.test.ts`, add an update-run ordering test with fake steps and one fake migration:

```ts
  test("an update run is the migrations, then org.pull, then team.identity, then the rest", async () => {
    const ran: string[] = [];
    const step = (id: StepId): StepDef => ({ id, title: id, kind: "rt", updateSafe: true, applies: () => true, run: async () => { ran.push(id); return { state: "done", detail: "" }; } });
    const migration = fakeMigration("2026-10-01-example", async () => { ran.push("migration"); return { state: "done", detail: "" }; });
    const { ctx } = testCtx();
    await runUpdateWith([step("org.pull"), step("team.identity"), step("plugins.install"), step("skills.materialize"), step("verify")], [migration], ctx);
    expect(ran).toEqual(["migration", "org.pull", "team.identity", "plugins.install", "skills.materialize", "verify"]);
  });

  test("reloadTeam finds an org that appeared during the run", () => {
    // a context built with no clone; then the clone's org settings file is written; reloadTeam() must set ctx.team.slug
  });
```

Write the second test with the file's real context builder: create the context over fake probes with no org, write `${CLONE}/mattstack/org/settings.org.jsonc` and `${CLONE}/.git/config` through the probes, call `ctx.reloadTeam!()`, and expect `ctx.team.slug` to be `"acme"` and `ctx.snapshot?.remote` to be the origin.

- [ ] **Step 2: Run to see them fail**

Run: `bun test lib/setup/__tests__/steps-org.test.ts lib/setup/__tests__/update-safe.test.ts lib/setup/__tests__/apply.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`lib/setup/contract.ts`: insert `"org.pull",` and `"team.identity",` after `"team.join",` in `STEP_IDS`.

```ts
// lib/setup/steps/org.ts
/**
 * `org.pull` and `team.identity`: the two steps that make a Mac catch up with
 * its org before anything reads it. Both are update-safe, so they also open
 * every update run.
 */

import { join } from "path";
import { forgeLogin } from "../../team/forge.ts";
import { readTeamLocal, updateTeamLocal } from "../../team/team-local.ts";
import type { ApplyContext, StepDef, StepOutcome } from "../apply.ts";
import type { Probes } from "../probes.ts";
import { discoverOrgs, forgeFromRemote, parseOriginUrl } from "../team-settings.ts";
import { resolveForge } from "./forge-identity.ts";
import { toFailedOutcome } from "./step-utils.ts";

const PULL_TIMEOUT_MS = 180_000;

interface PullReply {
  ok: boolean;
  data?: { outcome: string; detail: string | null };
  error?: string;
  failure?: { code: string; message: string };
}

/** Listed by `.git`, never by layout: a clone that has not pulled the org layout yet still has to be pulled. */
export function cloneSlugs(p: Pick<Probes, "readDir" | "exists" | "home">): string[] {
  const teams = join(p.home, ".mattstack", "teams");
  return p.readDir(teams).filter((name) => p.exists(join(teams, name, ".git", "config"))).sort();
}

async function orgPullRun(ctx: ApplyContext): Promise<StepOutcome> {
  const slugs = cloneSlugs(ctx.p);
  if (slugs.length === 0) return { state: "skipped", detail: "No org on this Mac" };
  const notes: string[] = [];
  for (const slug of slugs) {
    const res = (await ctx.p.daemon("team:pull", { slug }, PULL_TIMEOUT_MS)) as PullReply | null;
    if (res === null) return { state: "skipped", detail: "The rt daemon is not running, so the org is pulled once it is" };
    // The daemon answers no-team while team sync is off or its engine for a clone made a moment ago has not started.
    if (!res.ok && res.failure?.code === "no-team") return { state: "skipped", detail: `Team sync has not started for ${slug} yet, so it is pulled once it does` };
    const stuck = !res.ok || !res.data ? (res.error ?? "the daemon gave no reason") : res.data.outcome === "conflict" || res.data.outcome === "skipped" ? (res.data.detail ?? res.data.outcome) : null;
    // Never `failed`: a failed step stops a full Install, and a pull that did not happen is no reason to.
    if (stuck !== null) return { state: "partial", detail: `${slug} was not pulled: ${stuck}`, remedy: "Run rt team status to see what is in the way" };
    notes.push(res.data!.outcome === "up-to-date" ? `${slug} is already up to date` : `Pulled ${slug}`);
  }
  ctx.reloadTeam?.();
  return { state: "done", detail: notes.join("; ") };
}

/** Seamed so a test never spawns gh or glab. */
export const identitySeams = { login: forgeLogin };

function remoteOf(ctx: ApplyContext, slug: string): string | null {
  const raw = ctx.p.readFile(join(ctx.p.home, ".mattstack", "teams", slug, ".git", "config"));
  return raw === null ? null : parseOriginUrl(raw);
}

export async function recordForgeIdentity(
  p: Probes,
  slug: string,
  forge: { provider: "github" | "gitlab"; host: string } | null,
  token: string | null,
  login: typeof forgeLogin = identitySeams.login,
): Promise<{ username: string | null; outcome: "already" | "recorded" | "unknown" }> {
  const stored = readTeamLocal(p, slug).forgeUsername;
  if (stored) return { username: stored, outcome: "already" };
  // Only an org on no forge rt knows falls back to the local account name.
  const username = forge ? await login(p, forge.provider, forge.host, token) : (p.env.USER ?? null);
  if (!username) return { username: null, outcome: "unknown" };
  updateTeamLocal(p, slug, { forgeUsername: username });
  return { username, outcome: "recorded" };
}

async function teamIdentityRun(ctx: ApplyContext): Promise<StepOutcome> {
  // The last fallback is a clone that has not been converted yet: the admin's Mac
  // must know who it is before the conversion, or it could not push the result.
  const slug = ctx.team.slug || discoverOrgs(ctx.p)[0] || cloneSlugs(ctx.p)[0] || "";
  if (slug === "") return { state: "skipped", detail: "No org on this Mac" };

  const remote = remoteOf(ctx, slug);
  const declared = ctx.snapshot?.integrations.forge ?? (remote ? forgeFromRemote(remote) : null);
  const token = declared && !readTeamLocal(ctx.p, slug).forgeUsername ? ((await resolveForge(ctx))?.token ?? null) : null;
  const result = await recordForgeIdentity(ctx.p, slug, declared, token, ctx.identity?.login);
  if (result.outcome === "already") return { state: "skipped", detail: "Already recorded" };
  if (result.outcome === "recorded") return { state: "done", detail: `You are ${result.username}` };
  if (!declared) return { state: "needs-you", detail: "rt can't tell who you are, and this org is on no forge it knows" };
  const name = declared.provider === "gitlab" ? "GitLab" : "GitHub";
  return { state: "needs-you", detail: `rt can't tell who you are on ${name}. Connect your ${name} account in Setup` };
}

const safe = (run: (ctx: ApplyContext) => Promise<StepOutcome>) => async (ctx: ApplyContext): Promise<StepOutcome> => {
  try {
    return await run(ctx);
  } catch (err) {
    return toFailedOutcome(err);
  }
};

export const orgPullStep: StepDef = {
  id: "org.pull",
  title: "Pull your org",
  kind: "rt",
  updateSafe: true,
  applies: () => true,
  run: safe(orgPullRun),
};

export const teamIdentityStep: StepDef = {
  id: "team.identity",
  title: "Record who you are",
  kind: "rt",
  updateSafe: true,
  applies: () => true,
  run: safe(teamIdentityRun),
};
```

`ApplyContext` gains an optional test seam: `identity?: { login: typeof forgeLogin };` with the comment `/** Test seam for team.identity's forge lookup. */`. If `Probes.daemon` takes no timeout argument today, call it with two arguments (drop `PULL_TIMEOUT_MS`) and note in the step's doc that the probe's own timeout applies; match the real signature in `lib/setup/probes.ts`.

`lib/setup/steps/index.ts`: import both steps and insert `orgPullStep, teamIdentityStep,` after `teamJoinStep,` in `STEPS`.

`commands/setup.ts`, `connectCredential`: the `team.identity` row's action is the forge connect, and `rt setup update` runs once per app version, so the connect itself has to record the username or the row never clears. After the credential is stored (after the `storeCredential` block, before the result is printed):

```ts
  if (id === "github" || id === "gitlab") {
    const team = snapshotFor(deps);
    const slug = team.slug || cloneSlugs(deps.probes)[0] || "";
    const orgForge = team.integrations.forge ?? (team.remote ? forgeFromRemote(team.remote) : null);
    // Only the org's own forge says who you are in the org, and the token goes only to the host it was just validated against.
    if (slug !== "" && orgForge?.provider === id) {
      const host = id === "github" ? "github.com" : (ctx.host ?? "gitlab.com");
      await recordForgeIdentity(deps.probes, slug, { provider: id, host }, value, deps.forgeLogin);
    }
  }
```

with `forgeLogin?: typeof forgeLogin` on `ConnectDeps` (a test seam; production leaves it out and `recordForgeIdentity` uses the real lookup). A lookup that answers nothing records nothing and changes no output: the row stays, as it should.

`lib/setup/apply.ts`, `reloadTeam`:

```ts
    reloadTeam() {
      // An update run can start before the clone holds the org layout; org.pull brings it in.
      if (!ctx.team.slug) ctx.team = orgRefFromIntent(ctx.intent, discoverOrgs(p));
      if (!ctx.team.slug) return;
      ctx.snapshot = readTeamSnapshot(p, ctx.team.slug);
      ctx.reqs = readPackRequirements(p, ctx.team.slug);
    },
```

In a full `rt setup apply` the two steps run right after `team.join`: `org.pull` is a no-op pull of a clone that was just made, and `team.identity` fills the username in on a restored Mac, whose machine-local record is not part of the home repo.

- [ ] **Step 4: Update the copy snapshot on purpose**

Run: `bun test commands/__tests__/setup-copy.test.ts`
The plan event now lists two more steps. Read the diff, confirm it is exactly the two new step rows (ids `org.pull`, `team.identity`, titles above), then `bun test commands/__tests__/setup-copy.test.ts --update-snapshots`.

- [ ] **Step 5: Run and commit**

```bash
bun test lib/setup commands/__tests__/setup-apply.test.ts commands/__tests__/setup-connect.test.ts commands/__tests__/setup-copy.test.ts
bunx tsc --noEmit
git add lib/setup/contract.ts lib/setup/steps/org.ts lib/setup/steps/index.ts lib/setup/apply.ts commands/setup.ts lib/setup/__tests__/steps-org.test.ts
git add $(git diff --name-only -- '*.test.ts' '*.snap' lib/setup/__tests__/fakes.ts)
git commit -m "setup: org.pull and team.identity open every update run and follow a join or restore"
```

### Task 33: Setup rows for no team, no identity and no push access; token scopes follow the role

**Files:**
- Create: `lib/setup/validators/org.ts` (`orgRows`)
- Modify: `lib/setup/plan.ts` (add the rows to the `accounts` group)
- Modify: `lib/setup/token-create.ts` (`forgeRole`), `lib/setup/validators/accounts.ts`, `commands/setup.ts` (its two callers)
- Test: `lib/setup/__tests__/validators-org.test.ts` (new), `lib/setup/__tests__/token-create.test.ts`, `commands/__tests__/setup-connect.test.ts`

**Interfaces:**
- Consumes: `activeTeamFor` (Task 17, `lib/team/active-team.ts`), `roleFor`, `rolesFor` (Task 20), `tokenField`, `tokenCreateLink` (`token-create.ts`), `TeamSnapshotEntry.lastPushError`.
- Produces:

```ts
// lib/setup/token-create.ts
export function forgeRole(input: { intentMode: string | null; role: OrgRole["kind"] | null; hasTeam: boolean }): ForgeRole;

// lib/setup/validators/org.ts
export async function orgRows(p: Probes, org: string, opts: { forge: { provider: "github" | "gitlab"; host: string } | null; readStatus: () => Promise<TeamSnapshotEntry[] | null> }): Promise<Row[]>;
export function isPushRefusal(stderr: string): boolean;
```

Rows, all `kind: "access"`, `required: false`, never finish-gated, emitted only when they have something to say:

| Row | When | Action |
|---|---|---|
| `team.identity` | no stored username | the forge `connect` with the token field for this role (Task 32 made that connect record the username, so the row clears as soon as it succeeds); `steps` when the org is on no forge rt knows |
| `team.none` | a username is stored and the roster lists it on no team | `steps` (so the Mac app lists it on Done) |
| `team.push-access` | this Mac's role owns something and the last sync push was refused | the forge `connect` with owner scopes prefilled; `steps` when no forge |

- [ ] **Step 1: Write the failing tests**

```ts
// lib/setup/__tests__/validators-org.test.ts
import { describe, expect, test } from "bun:test";
import { teamLocalPath } from "../../team/team-local.ts";
import { isPushRefusal, orgRows } from "../validators/org.ts";
import { fakeProbes } from "./fakes.ts";

const HOME = "/h";
const ROOT = `${HOME}/.mattstack/teams/acme`;
const GITHUB = { provider: "github" as const, host: "github.com" };
const noStatus = async () => [];

function probes(opts: { username?: string; roster?: unknown[]; roles?: unknown }) {
  return fakeProbes({
    home: HOME,
    files: {
      [`${ROOT}/mattstack/org/settings.org.jsonc`]: JSON.stringify({
        "mattstack.roster": opts.roster ?? [{ username: "dev1", teams: ["widgets"] }],
        "mattstack.org": opts.roles ?? { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } },
      }),
      [`${ROOT}/mattstack/teams/widgets/settings.team.jsonc`]: "{}",
      ...(opts.username ? { [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: opts.username }) } : {}),
    },
  });
}

describe("orgRows", () => {
  test("a member on a team with nothing wrong gets no rows", async () => {
    expect(await orgRows(probes({ username: "dev1" }), "acme", { forge: GITHUB, readStatus: noStatus })).toEqual([]);
  });

  test("team.identity: no stored username offers the forge connect", async () => {
    const [row] = await orgRows(probes({}), "acme", { forge: GITHUB, readStatus: noStatus });
    expect(row).toMatchObject({
      id: "team.identity", kind: "access", required: false, status: "needs-you",
      title: "Who you are", detail: "rt can't tell who you are on GitHub yet, so it does not know your team",
    });
    expect(row!.action).toMatchObject({ type: "connect", integration: "github", label: "Connect" });
    expect(row!.finishGated).toBeUndefined();
  });

  test("team.identity on an org with no known forge shows steps", async () => {
    const [row] = await orgRows(probes({}), "acme", { forge: null, readStatus: noStatus });
    expect(row!.action).toEqual({ type: "steps", label: "Show steps…", steps: ["Run: rt setup apply --only team.identity", "Then run: rt setup status"] });
  });

  test("team.none names the login rt looked for and carries steps, so it shows on Done", async () => {
    const [row] = await orgRows(probes({ username: "dev9" }), "acme", { forge: GITHUB, readStatus: noStatus });
    expect(row).toMatchObject({ id: "team.none", status: "needs-you", title: "Your team", detail: "No team lists dev9 yet, so you only get the org's shared settings" });
    expect(row!.action).toEqual({
      type: "steps",
      label: "Show steps…",
      steps: ["Ask an org admin (dev1) to put dev9 on a team: rt team members set dev9 --teams <team>", "If dev9 is not your forge username, ask them to fix your name on the roster", "Then run: rt team pull"],
    });
  });

  test("team.push-access: an owner whose push was refused is told to ask the admin and offered a token with owner scopes", async () => {
    const status = async () => [{ slug: "acme", lastPushError: "remote: Permission to acme/org.git denied to dev2.\nfatal: unable to access: The requested URL returned error: 403", pullOnly: false } as never];
    const rows = await orgRows(probes({ username: "dev2", roster: [{ username: "dev2", teams: ["widgets"] }] }), "acme", { forge: GITHUB, readStatus: status });
    const row = rows.find((r) => r.id === "team.push-access")!;
    expect(row).toMatchObject({ status: "needs-you", title: "Push access", detail: "Your changes to the widgets team are saved on this Mac, but the org repo refused the push. Ask an org admin (dev1) for write access" });
    expect(row.action).toMatchObject({ type: "connect", integration: "github" });
    expect((row.action as { create?: { url: string } }).create?.url).toContain("scopes=repo");
  });

  test("a member never gets team.push-access, and a network failure is not a refusal", async () => {
    const refused = async () => [{ slug: "acme", lastPushError: "error: 403", pullOnly: true } as never];
    expect((await orgRows(probes({ username: "dev1", roles: { admins: [], teams: {} } }), "acme", { forge: GITHUB, readStatus: refused })).some((r) => r.id === "team.push-access")).toBe(false);
    const offline = async () => [{ slug: "acme", lastPushError: "fatal: unable to access: Could not resolve host: github.com", pullOnly: false } as never];
    expect((await orgRows(probes({ username: "dev1" }), "acme", { forge: GITHUB, readStatus: offline })).some((r) => r.id === "team.push-access")).toBe(false);
  });
});

describe("isPushRefusal", () => {
  test("permission and protection failures are refusals; network and conflict failures are not", () => {
    for (const s of ["error: 403", "remote: Permission to x denied", "remote: GitLab: You are not allowed to push code to protected branches on this project.", "! [remote rejected] main -> main (protected branch hook declined)", "fatal: Authentication failed"]) expect(isPushRefusal(s)).toBe(true);
    for (const s of ["Could not resolve host", "! [rejected] main -> main (fetch first)", "connection timed out", ""]) expect(isPushRefusal(s)).toBe(false);
  });
});
```

In `lib/setup/__tests__/token-create.test.ts`, replace the `forgeRole` cases:

```ts
  test("forgeRole follows the intent first, then this Mac's role", () => {
    expect(forgeRole({ intentMode: "create", role: null, hasTeam: false })).toBe("owner");
    expect(forgeRole({ intentMode: "join", role: null, hasTeam: false })).toBe("member");
    expect(forgeRole({ intentMode: null, role: "admin", hasTeam: true })).toBe("owner");
    expect(forgeRole({ intentMode: null, role: "owner", hasTeam: true })).toBe("owner");
    expect(forgeRole({ intentMode: null, role: "member", hasTeam: true })).toBe("member");
    expect(forgeRole({ intentMode: null, role: "unknown", hasTeam: true })).toBe("member");
    expect(forgeRole({ intentMode: null, role: null, hasTeam: false })).toBe("member");
  });
```

In `commands/__tests__/setup-connect.test.ts`, the test "no intent (after Install): the owner of a team rt did not join is held to the owner's scopes" decided the role from `joinedByRt`. It now decides from this Mac's role: give its probes the org store and the record of an admin,

```ts
      files: {
        "/fake-home/.mattstack/teams/acme/mattstack/org/settings.org.jsonc": JSON.stringify({ "mattstack.org": { admins: ["dev1"], teams: {} } }),
        "/fake-home/.mattstack/rt/teams/acme.json": JSON.stringify({ forgeUsername: "dev1" }),
      },
```

set `slug: "acme"` on its snapshot, and rename it "no intent (after Install): an org admin is held to the owner's scopes". Add its mirror: the same probes with `forgeUsername: "dev9"` (a member) are held to the member's scopes, whatever `joinedByRt` says.

- [ ] **Step 2: Run to see them fail**

Run: `bun test lib/setup/__tests__/validators-org.test.ts lib/setup/__tests__/token-create.test.ts commands/__tests__/setup-connect.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`lib/setup/token-create.ts`:

```ts
/**
 * Install clears the setup intent, so a reconnect after it has only this
 * Mac's role to go on: an org admin or a team owner pushes, a member does not.
 */
export function forgeRole(input: { intentMode: string | null; role: "admin" | "owner" | "member" | "unknown" | null; hasTeam: boolean }): ForgeRole {
  if (input.intentMode === "create") return "owner";
  if (input.intentMode === "join") return "member";
  return input.hasTeam && (input.role === "admin" || input.role === "owner") ? "owner" : "member";
}
```

Its two callers pass `role: team.slug ? roleFor(p, team.slug).kind : null` in place of `joinedByRt`.

```ts
// lib/setup/validators/org.ts
import type { TeamSnapshotEntry } from "../../daemon/team-snapshots.ts";
import { ownedRoots } from "../../../packages/rt-client/src/settings/org-roles.ts";
import { activeTeamFor } from "../../team/active-team.ts";
import { roleFor, rolesFor } from "../../team/roles.ts";
import { row, type Action, type Row } from "../contract.ts";
import type { Probes } from "../probes.ts";
import { tokenCreateLink, tokenField, type ForgeProvider, type ForgeRole } from "../token-create.ts";

const FORGE_NAME: Record<ForgeProvider, string> = { github: "GitHub", gitlab: "GitLab" };

/** A push the forge turned down for who you are or what the branch allows; never a network failure or a non-fast-forward. */
export function isPushRefusal(stderr: string): boolean {
  return /\b403\b|permission to .* denied|not allowed to push|protected branch|authentication failed|access denied|insufficient permission/i.test(stderr);
}

function connect(forge: { provider: ForgeProvider; host: string }, role: ForgeRole): Action {
  return { type: "connect", label: "Connect", integration: forge.provider, fields: [tokenField(forge.provider, role)], create: tokenCreateLink(forge.provider, role, forge.host) };
}

function steps(lines: string[]): Action {
  return { type: "steps", label: "Show steps…", steps: lines };
}

function adminsNote(admins: string[]): string {
  return admins.length > 0 ? `an org admin (${admins.join(", ")})` : "an org admin";
}

export async function orgRows(
  p: Probes,
  org: string,
  opts: { forge: { provider: ForgeProvider; host: string } | null; readStatus: () => Promise<TeamSnapshotEntry[] | null> },
): Promise<Row[]> {
  const rows: Row[] = [];
  const active = activeTeamFor(p, org);
  const roles = rolesFor(p, org);
  const role = roleFor(p, org);
  const base = { kind: "access" as const, required: false, recheck: "on-activate" as const };

  if (active.username === null) {
    const where = opts.forge ? ` on ${FORGE_NAME[opts.forge.provider]}` : "";
    rows.push(row({
      ...base,
      id: "team.identity",
      title: "Who you are",
      why: "Your team, and what you may change, come from your username on the org's forge.",
      status: "needs-you",
      detail: `rt can't tell who you are${where} yet, so it does not know your team`,
      action: opts.forge ? connect(opts.forge, "member") : steps(["Run: rt setup apply --only team.identity", "Then run: rt setup status"]),
    }));
    return rows;
  }

  if (active.reason === "no-team") {
    const who = active.username;
    rows.push(row({
      ...base,
      id: "team.none",
      title: "Your team",
      why: "Your team's settings and pack apply once the org puts you on a team.",
      status: "needs-you",
      detail: `No team lists ${who} yet, so you only get the org's shared settings`,
      action: steps([
        `Ask ${adminsNote(roles.admins)} to put ${who} on a team: rt team members set ${who} --teams <team>`,
        `If ${who} is not your forge username, ask them to fix your name on the roster`,
        "Then run: rt team pull",
      ]),
    }));
  }

  if (ownedRoots(role).length > 0) {
    const entry = (await opts.readStatus())?.find((e) => e.slug === org);
    if (entry?.lastPushError != null && isPushRefusal(entry.lastPushError)) {
      const what = role.kind === "owner" ? `the ${role.teams.join(" and ")} team${role.teams.length === 1 ? "" : "s"}` : "the org";
      rows.push(row({
        ...base,
        id: "team.push-access",
        title: "Push access",
        why: "An org admin grants write access on the forge; rt never changes access on a repo it did not create.",
        status: "needs-you",
        detail: `Your changes to ${what} are saved on this Mac, but the org repo refused the push. Ask ${adminsNote(roles.admins)} for write access`,
        action: opts.forge ? connect(opts.forge, "owner") : steps([`Ask ${adminsNote(roles.admins)} for write access to the org repo`, "Then run: rt team publish"]),
      }));
    }
  }

  return rows;
}
```

`lib/setup/plan.ts`: in `composePlan`, when an org clone exists (`team.slug` is in `inputs.orgs`), append `await orgRows(p, team.slug, { forge: snapshot.integrations.forge ?? (snapshot.remote ? forgeFromRemote(snapshot.remote) : null), readStatus })` to the `accounts` group's rows, where `readStatus` is the same `team:snapshot-status` daemon read `rtHealthRows` builds (lift that small closure into a shared helper in `rt-health.ts` and use it from both). Wrap the call the way the other groups are wrapped, so a throw degrades to that group's error row.

- [ ] **Step 4: Run, update the copy snapshot if it changed, commit**

```bash
bun test lib/setup lib/team commands/__tests__/setup-copy.test.ts commands/__tests__/setup-plan.test.ts commands/__tests__/setup-connect.test.ts
bunx tsc --noEmit
git add lib/setup/validators/org.ts lib/setup/validators/accounts.ts lib/setup/validators/rt-health.ts lib/setup/token-create.ts lib/setup/plan.ts commands/setup.ts lib/setup/__tests__/validators-org.test.ts
git add $(git diff --name-only -- '*.test.ts' '*.snap')
git commit -m "setup: rows for no team, no identity and no push access, and token scopes that follow your role"
```

### Task 34: Onboarding, end to end through the verbs the Mac app spawns

**Files:**
- Create: `commands/__tests__/onboarding-org.test.ts`
- Modify: `commands/__tests__/team-join.test.ts` (one exit-code test)
- Modify: `AGENTS.md`
- Modify: `docs/home-repo.md` or the setup docs only if a step's wording there is now wrong (check with `rg -n "team create|team join" docs/*.md`)

No production code. Every scenario runs the real setup steps through `runApplyWith` or `runUpdateWith`, and the real team functions, against real files under a scratch HOME. Only the outside world is faked, in one place: `exec` (git, the forge CLI, `claude`, deck), the daemon, the tray, `fetch` and the relay. A `git clone` is faked by copying a fixture tree, because `isAllowedRemote` refuses a `file://` remote.

- [ ] **Step 1: Write the harness**

```ts
// commands/__tests__/onboarding-org.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { activeTeam, currentRole, readForgeUsername, readStore, setSetting } from "../../packages/rt-client/src/index.ts";
import { orgSettingsPath, userSettingsPath } from "../../lib/rt-paths.ts";
import type { SecretsSeams } from "../../lib/secrets/store.ts";
import { createApplyContext, runApplyWith, runUpdateWith, type ApplyContext, type StepDef } from "../../lib/setup/apply.ts";
import type { ApplyEvent } from "../../lib/setup/contract.ts";
import { readIntent } from "../../lib/setup/intent.ts";
import type { MigrationDef } from "../../lib/setup/migrations/index.ts";
import { composePlan } from "../../lib/setup/plan.ts";
import { createRealProbes, type Probes } from "../../lib/setup/probes.ts";
import { orgPullStep, recordForgeIdentity, teamIdentityStep } from "../../lib/setup/steps/org.ts";
import { pluginsInstallStep } from "../../lib/setup/steps/plugins.ts";
import { teamCreateStep, teamJoinStep } from "../../lib/setup/steps/team.ts";
import { orgRows } from "../../lib/setup/validators/org.ts";
import { createTeam } from "../../lib/team/create.ts";
import { encodeCode, seal } from "../../lib/team/invite-crypto.ts";
import { joinDryRun } from "../../lib/team/join.ts";
import type { RelayClient } from "../../lib/team/relay-client.ts";
import { updateTeamLocal } from "../../lib/team/team-local.ts";
import type { InvitePointer } from "../../lib/setup/intent.ts";
import { teamUse, type TeamDeps } from "../team.ts";

const REMOTE = "https://github.com/acme/org.git";
const GITHUB = { provider: "github" as const, host: "github.com" };
const NOW = new Date("2026-10-01T00:00:00.000Z");
const ID_HEX = "0102030405060708090a0b0c0d0e0f10";
const KEY = new Uint8Array(32).fill(7);
const CODE = encodeCode(ID_HEX, KEY);
const FAKE_PUBLIC_KEY = "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
const DECK = "/Applications/mattstack.app/Contents/Helpers/deck";
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const origin = (remote: string) => `[remote "origin"]\n\turl = ${remote}\n`;

const POINTER: InvitePointer = {
  v: 2, team: "acme", name: "Acme", remote: REMOTE, owner: "dev1", forge: "github.com",
  createdAt: "2026-10-01T00:00:00.000Z", username: "dev2", teams: ["gadgets", "widgets"],
};

/** The keychain holds a key and age-keygen derives its public half; the sops side does nothing. */
const SECRETS: SecretsSeams = {
  ageKeySeam: {
    run: async (cmd) => {
      if (cmd[1] === "find-generic-password") return { code: 0, stdout: "AGE-SECRET-KEY-1QQQ\n", stderr: "" };
      if (cmd[0] === "age-keygen" && cmd[1] === "-y") return { code: 0, stdout: `${FAKE_PUBLIC_KEY}\n`, stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  },
  execSeam: {
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
    fileExists: () => false, statFile: () => null, readFile: () => "", writeFile: () => {},
    ensureDir: () => {}, chmod: () => {}, fsyncAndRename: () => {}, removeFile: () => {},
  },
};

const ORIG_HOME = process.env.HOME;
let home: string;
let scratch: string[];
let execCalls: string[][];
/** What the forge CLI answers; null is "not signed in". */
let login: string | null;
/** The tree a faked `git clone` copies into place. */
let remoteTree: string | null;
let daemon: Probes["daemon"];
let redeemCalls: string[];

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-onboarding-")));
  process.env.HOME = home;
  scratch = [home];
  execCalls = [];
  login = "dev1";
  remoteTree = null;
  daemon = async () => null;
  redeemCalls = [];
  mkdirSync(join(home, "bin"), { recursive: true });
  writeFileSync(join(home, "bin", "claude"), "#!/bin/sh\n", { mode: 0o755 });
});

afterEach(() => {
  process.env.HOME = ORIG_HOME;
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** Real files, fake outside world. Nothing under /Applications exists, so a developer's installed app never leaks in. */
function probes(): Probes {
  const real = createRealProbes();
  return {
    ...real,
    home,
    env: { HOME: home, PATH: join(home, "bin"), USER: "localdev" },
    now: () => NOW,
    exists: (path) => !path.startsWith("/Applications/") && real.exists(path),
    exec: async (argv, opts) => {
      execCalls.push(argv);
      const bin = basename(argv[0]!);
      if (bin === "gh") return login === null ? { code: 1, stdout: "", stderr: "not logged in" } : ok(JSON.stringify({ login }));
      if (bin === "git" && argv.includes("clone")) {
        const dir = argv.at(-1)!;
        if (remoteTree === null) return { code: 128, stdout: "", stderr: "fatal: repository not found" };
        cpSync(remoteTree, dir, { recursive: true });
        mkdirSync(join(dir, ".git"), { recursive: true });
        writeFileSync(join(dir, ".git", "config"), origin(REMOTE));
        return ok();
      }
      if (bin === "git" && argv[1] === "init" && opts?.cwd) mkdirSync(join(opts.cwd, ".git"), { recursive: true });
      if (bin === "git" && argv[1] === "remote" && argv[2] === "add" && opts?.cwd) writeFileSync(join(opts.cwd, ".git", "config"), origin(argv[4]!));
      if (bin === "claude" && argv[2] === "list") return ok("[]");
      return ok();
    },
    daemon: (cmd, payload, timeoutMs) => daemon(cmd, payload, timeoutMs),
    tray: async () => ({ status: 0, json: null }),
    fetch: async () => ({ status: 0, body: "", headers: {} }),
  };
}

function relayServing(pointer: InvitePointer): RelayClient {
  return {
    create: async () => { throw new Error("create is not used by join"); },
    fetch: async () => ({ ciphertext: await seal(pointer, KEY, ID_HEX) }),
    redeem: async (id) => { redeemCalls.push(id); return "redeemed"; },
    reply: async () => {},
    readReply: async () => { throw new Error("readReply is not used by join"); },
    delete: async () => { throw new Error("delete is not used by join"); },
  };
}

const NO_RELAY = relayServing(POINTER);

async function context(p: Probes, events: ApplyEvent[], opts: { relay?: RelayClient; update?: true } = {}): Promise<ApplyContext> {
  return createApplyContext({
    probes: p,
    emit: (event) => { events.push(event); },
    secrets: SECRETS,
    teamSecrets: () => SECRETS,
    relay: opts.relay ?? NO_RELAY,
    secretPresence: { has: async () => null },
    flags: { nonInteractive: true, teamOfOne: false, ci: false, ...(opts.update ? { update: true as const } : {}) },
  });
}

/** The last thing a step said: its final state, detail and remedy. */
function settled(events: ApplyEvent[], id: string): { state: string; detail?: string; remedy?: string } | undefined {
  const steps = events.filter((e): e is Extract<ApplyEvent, { event: "step" }> => e.event === "step" && e.id === id && e.state !== "running");
  const last = steps.at(-1);
  return last ? { state: last.state, ...(last.detail !== undefined ? { detail: last.detail } : {}), ...(last.remedy !== undefined ? { remedy: last.remedy } : {}) } : undefined;
}

/** An org repo's working tree with two teams, each with a pack and a marketplace entry. */
function orgTree(roster: { username: string; teams: string[] }[]): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-onboarding-org-")));
  scratch.push(dir);
  const write = (rel: string, value: unknown) => {
    const file = join(dir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  };
  write("mattstack/mattstack.jsonc", { role: "org", org: "acme" });
  write("mattstack/org/settings.org.jsonc", {
    "mattstack.integrations": { forge: GITHUB },
    "mattstack.org": { admins: ["dev1"], teams: { widgets: { owners: ["dev1"] }, gadgets: { owners: ["dev1"] } } },
    "mattstack.roster": roster,
  });
  for (const team of ["widgets", "gadgets"]) {
    write(`mattstack/teams/${team}/settings.team.jsonc`, { "board.title": team });
    write(`mattstack/teams/${team}/packs/${team}/.claude-plugin/plugin.json`, { name: team, version: "0.1.0" });
    write(`mattstack/teams/${team}/packs/${team}/pack/skills.jsonc`, {});
  }
  write(".claude-plugin/marketplace.json", {
    name: "acme",
    owner: { name: "Acme" },
    plugins: ["widgets", "gadgets"].map((team) => ({ name: team, source: `./mattstack/teams/${team}/packs/${team}` })),
  });
  return dir;
}

/** Puts an org clone on this Mac without a join: the state a restored or already-joined Mac is in. */
function cloneHere(tree: string): string {
  const dir = join(home, ".mattstack", "teams", "acme");
  cpSync(tree, dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, ".git", "config"), origin(REMOTE));
  return dir;
}

const packInstalls = () => execCalls.filter((a) => basename(a[0]!) === "claude" && a[1] === "plugin" && a[2] === "install").map((a) => a.at(-1)!).filter((id) => id.endsWith("@acme"));
const activeTeamSetting = () => readStore(userSettingsPath()).global["mattstack.activeTeam"];
```

- [ ] **Step 2: Write the scenarios**

```ts
describe("onboarding in an org", () => {
  test("create: roles wait for the forge login, then the creator is admin, owner and on the roster with the first team active", async () => {
    const p = probes();
    login = null; // the team screen: --remote on a recognized forge, before the checklist connects it
    const first = await createTeam(p, { name: "Acme", remote: REMOTE, others: false }, SECRETS.ageKeySeam);
    expect(first.rolesDeferred).toBe(true);
    expect(readForgeUsername("acme")).toBeNull();

    login = "dev1"; // Install, after the forge connect
    const events: ApplyEvent[] = [];
    const result = await runApplyWith([teamCreateStep, orgPullStep, teamIdentityStep], await context(p, events));
    expect(result).toEqual({ ok: true });

    const org = readStore(orgSettingsPath("acme")).global;
    expect(org["mattstack.org"]).toEqual({ admins: ["dev1"], teams: { acme: { owners: ["dev1"] } } });
    expect(org["mattstack.roster"]).toEqual([{ username: "dev1", agePublicKey: FAKE_PUBLIC_KEY, teams: ["acme"] }]);
    expect(readForgeUsername("acme")).toBe("dev1");
    expect(activeTeam()).toMatchObject({ org: "acme", team: "acme", reason: "first-team" });
    expect(currentRole("acme")).toEqual({ kind: "admin" });
    expect(settled(events, "team.identity")).toEqual({ state: "skipped", detail: "Already recorded" });
    expect(settled(events, "org.pull")?.state).not.toBe("failed");

    const plan = await composePlan({ p, secrets: { has: async () => null }, ci: false, mode: "status", orgs: ["acme"] });
    const ids = plan.groups.flatMap((g) => g.rows.map((r) => r.id));
    for (const id of ["team.none", "team.identity", "team.push-access"]) expect(ids).not.toContain(id);
  });

  test("join dry run: the teams come from the pointer, and nothing is cloned", async () => {
    const p = probes();
    const result = await joinDryRun(p, relayServing(POINTER), CODE);
    expect(result.teams).toEqual(["gadgets", "widgets"]);
    expect(existsSync(join(home, ".mattstack", "teams", "acme"))).toBe(false);
    expect(readIntent(p)?.mode).toBe("join");
  });

  test("join: Install records who you are, starts you on the invite's first team, and installs that team's pack alone", async () => {
    const p = probes();
    login = "dev2";
    remoteTree = orgTree([{ username: "dev1", teams: ["widgets"] }, { username: "dev2", teams: ["gadgets", "widgets"] }]);
    const relay = relayServing(POINTER);
    await joinDryRun(p, relay, CODE);

    const events: ApplyEvent[] = [];
    const result = await runApplyWith([teamJoinStep, orgPullStep, teamIdentityStep, pluginsInstallStep], await context(p, events, { relay }));
    expect(result).toEqual({ ok: true });

    expect(readForgeUsername("acme")).toBe("dev2");
    expect(activeTeamSetting()).toBe("gadgets");
    expect(activeTeam()).toMatchObject({ team: "gadgets", reason: "chosen" });
    expect(packInstalls()).toEqual(["gadgets@acme"]);
    expect(redeemCalls).toEqual([ID_HEX]);
  });

  test("join: a clone whose roster does not list the invitee stops before the invite is used, and a rerun resumes", async () => {
    const p = probes();
    login = "dev2";
    remoteTree = orgTree([{ username: "dev1", teams: ["widgets"] }]);
    const relay = relayServing(POINTER);
    await joinDryRun(p, relay, CODE);

    const events: ApplyEvent[] = [];
    const result = await runApplyWith([teamJoinStep, pluginsInstallStep], await context(p, events, { relay }));
    expect(result).toEqual({ ok: false, failedStep: "team.join" });
    expect(settled(events, "team.join")).toEqual({
      state: "failed",
      detail: "Your admin's roster change has not reached the org repo yet; try again in a minute",
      remedy: "Retry in a minute. You do not need a new code",
    });
    expect(redeemCalls).toEqual([]);
    expect(readIntent(p)?.mode).toBe("join");
    expect(activeTeamSetting()).toBeUndefined();
    expect(packInstalls()).toEqual([]);
  });

  test("join: a different forge login is refused at Install, naming both, with the invite unspent and nothing recorded", async () => {
    const p = probes();
    login = "trillian";
    remoteTree = orgTree([{ username: "dev2", teams: ["gadgets", "widgets"] }]);
    const relay = relayServing(POINTER);
    await joinDryRun(p, relay, CODE);

    const events: ApplyEvent[] = [];
    const result = await runApplyWith([teamJoinStep, pluginsInstallStep], await context(p, events, { relay }));
    expect(result).toEqual({ ok: false, failedStep: "team.join" });
    expect(settled(events, "team.join")).toEqual({
      state: "failed",
      detail: "This invite is for dev2; you're signed in as trillian.",
      remedy: "Ask for an invite for trillian, or connect dev2's token.",
    });
    expect(redeemCalls).toEqual([]);
    expect(readForgeUsername("acme")).toBeNull();
    expect(activeTeamSetting()).toBeUndefined();
    expect(readIntent(p)?.mode).toBe("join");
  });

  test("join: an invite from before teams is refused, leaving no intent and no clone", async () => {
    const p = probes();
    const old = { ...POINTER, v: 1 } as unknown as InvitePointer;
    await expect(joinDryRun(p, relayServing(old), CODE)).rejects.toMatchObject({
      code: "invite-outdated",
      message: "That invite was made by an older mattstack. Ask for a new invite.",
    });
    expect(readIntent(p)).toBeNull();
    expect(existsSync(join(home, ".mattstack", "teams", "acme"))).toBe(false);
  });

  test("a second team: your first team holds until you switch, and the switch turns the packs over and restarts the apps", async () => {
    const p = probes();
    const dir = cloneHere(orgTree([{ username: "dev2", teams: ["gadgets"] }]));
    updateTeamLocal(p, "acme", { forgeUsername: "dev2" });
    expect(activeTeam()).toMatchObject({ team: "gadgets", listedOn: ["gadgets"] });

    // What a pull brings once the admin runs `rt team members set dev2 --teams gadgets,widgets`.
    const store = join(dir, "mattstack", "org", "settings.org.jsonc");
    const org = JSON.parse(p.readFile(store)!) as Record<string, unknown>;
    writeFileSync(store, JSON.stringify({ ...org, "mattstack.roster": [{ username: "dev2", teams: ["gadgets", "widgets"] }] }));
    expect(activeTeam()).toMatchObject({ team: "gadgets", listedOn: ["gadgets", "widgets"] });

    const lines: string[] = [];
    const deps: TeamDeps = { probes: p, print: (line) => { lines.push(line); }, deckPath: () => DECK };
    await teamUse(["widgets", "--json"], {}, deps);

    const { contract: _contract, at: _at, ...body } = JSON.parse(lines[0]!);
    expect(body).toMatchObject({ team: "widgets", previous: "gadgets", disabled: "gadgets@acme", restarted: ["board", "boxscore"] });
    expect(activeTeamSetting()).toBe("widgets");
    const claude = execCalls.filter((a) => basename(a[0]!) === "claude").map((a) => a.slice(1).join(" "));
    expect(claude).toContain("plugin enable widgets@acme");
    expect(claude).toContain("plugin disable gadgets@acme");
    expect(execCalls).toContainEqual([DECK, "restart", "board"]);
    expect(execCalls).toContainEqual([DECK, "restart", "boxscore"]);
  });

  test("the update run from the old layout: the migration, then the pull that brings the org layout, then identity, then the install against what the pull brought", async () => {
    const p = probes();
    const dir = join(home, ".mattstack", "teams", "acme");
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, ".git", "config"), origin(REMOTE));
    mkdirSync(join(dir, "mattstack"), { recursive: true });
    writeFileSync(join(dir, "mattstack", "settings.team.jsonc"), JSON.stringify({ "board.title": "Acme" }));

    const converted = orgTree([{ username: "dev2", teams: ["gadgets", "widgets"] }]);
    login = "dev2";
    daemon = async (cmd) => {
      if (cmd !== "team:pull") return null;
      rmSync(join(dir, "mattstack"), { recursive: true, force: true });
      cpSync(converted, dir, { recursive: true });
      return { ok: true, data: { outcome: "fast-forwarded", detail: null } };
    };

    const ran: string[] = [];
    const migration: MigrationDef = { id: "2026-10-01-example", title: "Example", run: async () => { ran.push("migration"); return { state: "done", detail: "" }; } };
    const verify: StepDef = { id: "verify", title: "Verify", kind: "rt", updateSafe: true, applies: () => true, run: async () => ({ state: "done", detail: "" }) };

    const events: ApplyEvent[] = [];
    await runUpdateWith([orgPullStep, teamIdentityStep, pluginsInstallStep, verify], [migration], await context(p, events, { update: true }));

    const order = events.filter((e) => e.event === "step" && e.state === "running").map((e) => (e as { id: string }).id);
    expect(order).toEqual(["migration.2026-10-01-example", "org.pull", "team.identity", "plugins.install", "verify"]);
    expect(settled(events, "org.pull")).toEqual({ state: "done", detail: "Pulled acme" });
    expect(settled(events, "team.identity")).toEqual({ state: "done", detail: "You are dev2" });
    expect(settled(events, "plugins.install")?.state).not.toBe("failed");
    // The marketplace file did not exist before the pull, so this install can only have read the reloaded org.
    expect(packInstalls()).toEqual(["gadgets@acme"]);
  });

  test("restore: a Mac with no machine-local record gets its role back from the roster", async () => {
    const p = probes();
    cloneHere(orgTree([{ username: "dev1", teams: ["widgets"] }]));
    expect(readForgeUsername("acme")).toBeNull();
    expect(() => setSetting("board.gitlabHost", "gitlab.example.com", "org")).toThrow("rt can't tell who you are");

    login = "dev1";
    const events: ApplyEvent[] = [];
    await runApplyWith([teamIdentityStep], await context(p, events));
    expect(settled(events, "team.identity")).toEqual({ state: "done", detail: "You are dev1" });
    expect(currentRole("acme")).toEqual({ kind: "admin" });
    setSetting("board.gitlabHost", "gitlab.example.com", "org");
    expect(readStore(orgSettingsPath("acme")).global["board.gitlabHost"]).toBe("gitlab.example.com");
  });

  test("restore with no forge token: the row says so, and it clears once the forge is connected", async () => {
    const p = probes();
    cloneHere(orgTree([{ username: "dev1", teams: ["widgets"] }]));
    login = null;
    const events: ApplyEvent[] = [];
    await runApplyWith([teamIdentityStep], await context(p, events));
    expect(settled(events, "team.identity")).toEqual({ state: "needs-you", detail: "rt can't tell who you are on GitHub. Connect your GitHub account in Setup" });

    const noStatus = async () => [];
    expect((await orgRows(p, "acme", { forge: GITHUB, readStatus: noStatus })).map((r) => r.id)).toEqual(["team.identity"]);

    // What the forge connect does once the token validates (its wiring is pinned in setup-connect.test.ts).
    await recordForgeIdentity(p, "acme", GITHUB, "token", async () => "dev1");
    expect(await orgRows(p, "acme", { forge: GITHUB, readStatus: noStatus })).toEqual([]);
    expect(currentRole("acme")).toEqual({ kind: "admin" });
  });
});
```

Three things the harness leans on, each one line to change if the code names it differently:

- `TeamDeps.deckPath?: (p: Probes) => string | null` (Task 30's `restartApp` resolves deck through it; the default is `(p) => bundledToolPath(p, "deck")`). The bundled path cannot be resolved in a test: it needs a real app bundle and its `deps.lock`, which is why the harness also hides `/Applications`. Add the seam to Task 30's code if it is not there yet.
- The create scenario's plan check names the three rows this work adds. The plan still carries the rows every org has (`team.sync` and the like); those are not what "no team rows" means here.
- `composePlan`'s input is `orgs` after Task 9. If a scenario fails on a `claude` answer the fake does not give, add that answer to the one `exec` function, the way `lib/setup/__tests__/steps-c.test.ts`'s `plugins.install` tests script it.

In `commands/__tests__/team-join.test.ts`, with that file's own harness (its relay that serves a sealed pointer and its exit capture), add one test: a version 1 pointer makes `teamJoin([CODE, "--dry-run", "--json"], ...)` exit 2 with the error code `invite-outdated`, the message "That invite was made by an older mattstack. Ask for a new invite.", and no intent file.

- [ ] **Step 3: Run them**

Run: `bun test commands/__tests__/onboarding-org.test.ts commands/__tests__/team-join.test.ts`
Expected: PASS. A failure here is a real gap between two tasks (for example join recording the username but the plan still showing `team.identity`); fix it in the task that owns the code and say so in the commit.

- [ ] **Step 4: Bring `AGENTS.md` up to date**

`AGENTS.md` is the contract other agents read, so it has to describe the code as it now is. Three edits, current mechanics only:

1. Under "Settings architecture", add one paragraph: shared settings live in an org clone (`~/.mattstack/teams/<org>/`) as an org store plus one store per team folder; the resolver reads the org layer and the active team's layer (`activeTeam()` in rt-client); a shared write is refused unless this Mac's role owns the file (`packages/rt-client/src/settings/org-roles.ts`, `lib/team/roles.ts`). Point at `docs/settings-architecture.md` and the spec.
2. Under "Setup after an update", say the update run is pending migrations, then `org.pull` and `team.identity`, then the other update-safe steps, then `verify`.
3. Under "Switchboard and `rt team join`", say join refuses an invite whose `username` is not the signed-in forge login, checks the cloned roster lists that username, records `forgeUsername`, and sets `mattstack.activeTeam` to the invite's first team; and that `rt team invite` pushes the roster entry before it makes the invite.

- [ ] **Step 5: PR 3 gate**

```bash
bun run test
bunx tsc --noEmit
bun run check
bun run picker:check
bun run test:all
git add commands/__tests__/onboarding-org.test.ts commands/__tests__/team-join.test.ts AGENTS.md
git commit -m "tests and docs: onboarding through create, join, a second team, the update run and restore"
```

Open PR 3 from `org-teams-3-writes` against `org-teams-2-packs`. Its body names the envelope additions (`team status`, `team join`), the new verbs, and the two new setup step ids.

---
## PR 4: The conversion and the migration

Branch `org-teams-4-conversion`, based on `org-teams-3-writes`.

### Task 35: The one-off conversion script

**Files:**
- Create: `scripts/lib/convert-team-repo.ts` (the pure plan)
- Create: `scripts/convert-team-repo-to-org.ts` (the wrapper that reads a clone, prints the plan, and applies it)
- Test: `scripts/__tests__/convert-team-repo.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ConvertInput {
  /** Text files of the old clone, keyed by clone-relative path. */
  files: Record<string, string>;
  /** Folder names under mattstack/packs. */
  packs: string[];
  /** Whether mattstack/secrets exists. */
  hasSecrets: boolean;
}
export interface ConvertOpts {
  org: string;          // the clone's folder name
  admin: string;        // the forge username that becomes org admin and team owner
  team?: string;        // defaults to the one non-base pack's name
  teamRepos?: string[]; // repo identities whose settings section stays with the team
}
export interface ConvertPlan {
  team: string;
  writes: Record<string, string>;
  moves: [from: string, to: string][];
  deletes: string[];
  /** Lines for the admin to read before anything is written. */
  report: string[];
  /** Every roster username, for the admin to confirm each is that member's forge username. */
  rosterUsernames: string[];
}
export function planConversion(input: ConvertInput, opts: ConvertOpts): ConvertPlan;
```

`bun scripts/convert-team-repo-to-org.ts <clone-dir> --admin <username> [--team <name>] [--team-repo <identity>]... [--write --roster-confirmed]`. Without `--write` it only prints. It never pushes.

Three guards, each from the spec's section 9:

- `--write` refuses unless team sync is off on this Mac (`rt.teamSnapshot.enabled` is `false`). The clone's sync engine stages and pushes `mattstack/`, `.sops.yaml` and `.claude-plugin/` by itself (a debounced commit, and a janitor that pushes unpushed commits), so with it on, a half-converted tree could be pushed, and "review the commit, then publish" would be no gate at all.
- A `--write` that throws partway puts the clone back exactly as it started (the start is clean, so a hard reset and a clean of the paths rt manages restore it).
- A store or manifest that does not parse is refused: the plan would otherwise split what it could read and delete the original.

- `--write` refuses unless this Mac's recorded forge username is the `--admin` it was given. The conversion writes `--admin` as the org's only admin; a Mac recorded as someone else, or as nobody, would own nothing afterwards, and the publish that follows would be refused. Before the conversion there is no `mattstack.org` to read a role from, so the record is the only thing to check.

`scripts/` is not in the app bundle, so the script runs from a checkout of this repo at the release tag the admin's app is on.

- [ ] **Step 1: Write the failing tests**

```ts
// scripts/__tests__/convert-team-repo.test.ts
import { describe, expect, test } from "bun:test";
import { parse } from "jsonc-parser";
import { planConversion, type ConvertInput } from "../lib/convert-team-repo.ts";

const SHARED = "gitlab.example.com/acme/widgets";
const OWN = "gitlab.example.com/acme/widgets-tools";

function oldClone(overrides: Partial<ConvertInput["files"]> = {}): ConvertInput {
  return {
    packs: ["widgets", "acme-base"],
    hasSecrets: true,
    files: {
      "mattstack/mattstack.jsonc": JSON.stringify({ role: "team", namespace: "widgets", org: "acme" }),
      "mattstack/team.jsonc": JSON.stringify({ gitlabHost: "https://gitlab.example.com", projects: ["acme/widgets"] }),
      "mattstack/settings.team.jsonc": `// team settings\n${JSON.stringify({
        "board.gitlabHost": "gitlab.example.com",
        "board.title": "Widgets",
        "board.tabs": [{ id: "team", label: "Team", source: { kind: "authors" } }],
        "board.ticketPrefixes": ["WID"],
        "board.botUsernames": ["acme-bot"],
        "board.slack": { appId: "A1", clientId: "C1", callbackPort: 1455, channel: "#widgets", singleTemplate: "{title}" },
        "board.members": [{ username: "dev1", name: "Dev One" }, { username: "DEV2", name: "Dev Two", agePublicKey: "age1bbb" }, { username: "dev3", hidden: true }],
        "board.reReview": { enabled: true },
        "boxscore.projects": ["acme/widgets"],
        "boxscore.botPatterns": ["bot$"],
        "mattstack.integrations": { forge: { host: "gitlab.example.com", provider: "gitlab" } },
        "mattstack.tracking": { repos: { [SHARED]: {} } },
        "mattstack.roster": [{ username: "dev1", name: "Dev One", agePublicKey: "age1aaa" }, { username: "dev2" }],
        "claude.marketplaces": ["acme/marketplace"],
        "claude.plugins": ["widgets@acme", "acme-tools@acme"],
        "skills.writingStyle": "mattstack:writing-style-conversational",
        "rt.sdmEnrichment": { staging: { label: "Staging" } },
        repos: {
          [SHARED]: { "rt.roles": { dev: { hook: "\${team:acme}/mattstack/packs/widgets/hooks/dev.sh" } }, "rt.worktrees": { onDeck: 2 } },
          [OWN]: { "rt.branchNaming": { template: "{ticket}" } },
        },
      })}`,
      ".sops.yaml": "creation_rules:\n  - path_regex: mattstack/secrets/.*\n    age: age1aaa,age1bbb\n",
      ".gitignore": "mattstack/secrets/*.tmp\n.DS_Store\n",
      ".claude-plugin/marketplace.json": JSON.stringify({ name: "acme", owner: { name: "Acme" }, plugins: [{ name: "widgets", source: "./mattstack/packs/widgets", description: "d" }] }, null, 2),
      "mattstack/packs/widgets/.claude-plugin/plugin.json": JSON.stringify({ name: "widgets", version: "1.4.2", skills: "./skills/" }, null, 2),
      "mattstack/packs/widgets/pack/skills.jsonc": "{}",
      "mattstack/packs/acme-base/pack/skills.jsonc": `{ "base": true }`,
      ...overrides,
    },
  };
}

const settings = (text: string) => parse(text) as Record<string, any>;
const run = (input = oldClone(), opts = {}) => planConversion(input, { org: "acme", admin: "dev1", teamRepos: [OWN], ...opts });

describe("planConversion", () => {
  test("the team is named after the one non-base pack, so plugin ids do not change", () => {
    expect(run().team).toBe("widgets");
    expect(() => run(oldClone(), { team: "gadgets" })).toThrow('The team has to be named "widgets", after its pack');
  });

  test("splits the settings by the table: shared keys to the org, how the team works to the team", () => {
    const plan = run();
    const org = settings(plan.writes["mattstack/org/settings.org.jsonc"]!);
    const team = settings(plan.writes["mattstack/teams/widgets/settings.team.jsonc"]!);
    for (const key of ["board.gitlabHost", "board.botUsernames", "boxscore.botPatterns", "mattstack.integrations", "mattstack.tracking", "claude.marketplaces", "mattstack.roster", "mattstack.org"]) {
      expect(key in org).toBe(true);
      expect(key in team).toBe(false);
    }
    for (const key of ["board.title", "board.tabs", "board.ticketPrefixes", "board.reReview", "boxscore.projects", "skills.writingStyle", "rt.sdmEnrichment"]) {
      expect(key in team).toBe(true);
      expect(key in org).toBe(false);
    }
  });

  test("board.slack keeps the app ids at the org and everything else at the team", () => {
    const plan = run();
    expect(settings(plan.writes["mattstack/org/settings.org.jsonc"]!)["board.slack"]).toEqual({ appId: "A1", clientId: "C1", callbackPort: 1455 });
    expect(settings(plan.writes["mattstack/teams/widgets/settings.team.jsonc"]!)["board.slack"]).toEqual({ channel: "#widgets", singleTemplate: "{title}" });
  });

  test("claude.plugins: the team's own pack goes to the team, the rest stays at the org", () => {
    const plan = run();
    expect(settings(plan.writes["mattstack/org/settings.org.jsonc"]!)["claude.plugins"]).toEqual(["acme-tools@acme"]);
    expect(settings(plan.writes["mattstack/teams/widgets/settings.team.jsonc"]!)["claude.plugins"]).toEqual(["widgets@acme"]);
  });

  test("board.projects comes from team.jsonc when the store has none, and lands at the org", () => {
    const org = settings(run().writes["mattstack/org/settings.org.jsonc"]!);
    expect(org["board.projects"]).toEqual(["acme/widgets"]);
  });

  test("a repo's section goes to the org unless it is named as the team's own", () => {
    const plan = run();
    expect(Object.keys(settings(plan.writes["mattstack/org/settings.org.jsonc"]!).repos)).toEqual([SHARED]);
    expect(Object.keys(settings(plan.writes["mattstack/teams/widgets/settings.team.jsonc"]!).repos)).toEqual([OWN]);
  });

  test("the roster moves to the org with teams, takes what only board.members knew, gains the admin, and board.members goes", () => {
    const plan = run(oldClone(), { admin: "dev9" });
    const org = settings(plan.writes["mattstack/org/settings.org.jsonc"]!);
    expect(org["mattstack.roster"]).toEqual([
      { username: "dev1", name: "Dev One", agePublicKey: "age1aaa", teams: ["widgets"] },
      { username: "dev2", name: "Dev Two", agePublicKey: "age1bbb", teams: ["widgets"] },
      { username: "dev3", teams: ["widgets"] },
      { username: "dev9", teams: ["widgets"] },
    ]);
    expect(org["mattstack.org"]).toEqual({ admins: ["dev9"], teams: { widgets: { owners: ["dev9"] } } });
    expect("board.members" in org).toBe(false);
    expect("board.members" in settings(plan.writes["mattstack/teams/widgets/settings.team.jsonc"]!)).toBe(false);
    expect(plan.rosterUsernames).toEqual(["dev1", "dev2", "dev3", "dev9"]);
  });

  test("secrets move under the org, and the sops rule and gitignore follow", () => {
    const plan = run();
    expect(plan.moves).toContainEqual(["mattstack/secrets", "mattstack/org/secrets"]);
    expect(plan.writes[".sops.yaml"]).toBe("creation_rules:\n  - path_regex: mattstack/org/secrets/.*\n    age: age1aaa,age1bbb\n");
    expect(plan.writes[".gitignore"]).toBe("mattstack/org/secrets/*.tmp\n.DS_Store\n");
  });

  test("the pack moves into its team folder, the base into the org, the marketplace follows and the version is bumped", () => {
    const plan = run();
    expect(plan.moves).toContainEqual(["mattstack/packs/widgets", "mattstack/teams/widgets/packs/widgets"]);
    expect(plan.moves).toContainEqual(["mattstack/packs/acme-base", "mattstack/org/packs/acme-base"]);
    expect(JSON.parse(plan.writes[".claude-plugin/marketplace.json"]!).plugins).toEqual([{ name: "widgets", source: "./mattstack/teams/widgets/packs/widgets", description: "d" }]);
    expect(JSON.parse(plan.writes["mattstack/teams/widgets/packs/widgets/.claude-plugin/plugin.json"]!).version).toBe("1.4.3");
  });

  test("a stored path through ${team:} is rewritten to where the file moved", () => {
    const org = settings(run().writes["mattstack/org/settings.org.jsonc"]!);
    expect(org.repos[SHARED]["rt.roles"].dev.hook).toBe("${team:acme}/mattstack/teams/widgets/packs/widgets/hooks/dev.sh");
  });

  test("the marker becomes the org marker and the old files go", () => {
    const plan = run();
    expect(JSON.parse(plan.writes["mattstack/mattstack.jsonc"]!)).toEqual({ role: "org", org: "acme" });
    expect(plan.deletes.sort()).toEqual(["mattstack/settings.team.jsonc", "mattstack/team.jsonc"]);
  });

  test("a member board.members hid is named in the report: hiding does not carry over to the roster", () => {
    expect(run().report).toContain("board.members hid dev3; the roster has no hidden flag, so dev3 shows in the apps until someone hides them there");
  });

  test("a roster entry keeps its own value where board.members disagrees", () => {
    const files = oldClone().files;
    const store = settings(files["mattstack/settings.team.jsonc"]!);
    store["board.members"] = [{ username: "dev1", name: "Someone Else", agePublicKey: "age1zzz" }];
    const org = settings(run(oldClone({ "mattstack/settings.team.jsonc": JSON.stringify(store) })).writes["mattstack/org/settings.org.jsonc"]!);
    expect(org["mattstack.roster"][0]).toEqual({ username: "dev1", name: "Dev One", agePublicKey: "age1aaa", teams: ["widgets"] });
  });

  test("a team named after the org, beside <org>-base: each stored path goes to its own new home", () => {
    const base = oldClone();
    const store = settings(base.files["mattstack/settings.team.jsonc"]!);
    store.repos[SHARED]["rt.roles"] = {
      dev: { hook: "${team:acme}/mattstack/packs/acme/hooks/dev.sh" },
      ci: { hook: "${team:acme}/mattstack/packs/acme-base/hooks/ci.sh" },
      bare: { hook: "${team:acme}/mattstack/packs/acme" },
    };
    const files = Object.fromEntries(Object.entries(base.files).filter(([rel]) => !rel.startsWith("mattstack/packs/widgets/")));
    const input = {
      packs: ["acme", "acme-base"],
      hasSecrets: true,
      files: {
        ...files,
        "mattstack/settings.team.jsonc": JSON.stringify(store),
        "mattstack/packs/acme/.claude-plugin/plugin.json": JSON.stringify({ name: "acme", version: "1.0.0" }),
        "mattstack/packs/acme/pack/skills.jsonc": "{}",
      },
    };
    const roles = settings(planConversion(input, { org: "acme", admin: "dev1" }).writes["mattstack/org/settings.org.jsonc"]!).repos[SHARED]["rt.roles"];
    expect(roles.dev.hook).toBe("${team:acme}/mattstack/teams/acme/packs/acme/hooks/dev.sh");
    expect(roles.ci.hook).toBe("${team:acme}/mattstack/org/packs/acme-base/hooks/ci.sh");
    expect(roles.bare.hook).toBe("${team:acme}/mattstack/teams/acme/packs/acme");
  });

  test("a store or manifest that does not parse is refused by name, and nothing is planned", () => {
    expect(() => run(oldClone({ "mattstack/settings.team.jsonc": `{ "board.title": "Widgets", ` }))).toThrow("mattstack/settings.team.jsonc is not valid JSONC");
    expect(() => run(oldClone({ ".claude-plugin/marketplace.json": "[]" }))).toThrow(".claude-plugin/marketplace.json is not a JSON object");
  });

  test("a clone that is already converted is refused and nothing is planned", () => {
    const converted = oldClone({ "mattstack/mattstack.jsonc": JSON.stringify({ role: "org", org: "acme" }) });
    expect(() => run(converted)).toThrow("This clone already has the org layout");
  });

  test("two team packs, or none, is refused: the script converts one team", () => {
    expect(() => planConversion({ ...oldClone(), packs: ["widgets", "gadgets", "acme-base"], files: { ...oldClone().files, "mattstack/packs/gadgets/pack/skills.jsonc": "{}" } }, { org: "acme", admin: "dev1" })).toThrow("exactly one team pack");
  });

  test("the report says what goes where, for review before writing", () => {
    const report = run().report.join("\n");
    expect(report).toContain("org: board.gitlabHost");
    expect(report).toContain("team widgets: board.title");
    expect(report).toContain("roster usernames to confirm as forge logins: dev1, dev2, dev3");
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `bun test scripts/__tests__/convert-team-repo.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the plan**

```ts
// scripts/lib/convert-team-repo.ts
/**
 * Plans the one conversion of the one existing team repo to the org layout.
 * Pure: it reads the old clone's text and answers what to write, move and
 * delete. No shipped rt code reads the old layout.
 */

import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";

export interface ConvertInput {
  files: Record<string, string>;
  packs: string[];
  hasSecrets: boolean;
}

export interface ConvertOpts {
  org: string;
  admin: string;
  team?: string;
  teamRepos?: string[];
}

export interface ConvertPlan {
  team: string;
  writes: Record<string, string>;
  moves: [from: string, to: string][];
  deletes: string[];
  report: string[];
  rosterUsernames: string[];
}

type Json = Record<string, unknown>;

const ORG_KEYS = new Set([
  "board.gitlabHost",
  "mattstack.integrations",
  "board.botUsernames",
  "boxscore.botPatterns",
  "board.projects",
  "mattstack.tracking",
  "claude.marketplaces",
  "mattstack.roster",
]);
const SLACK_ORG_FIELDS = new Set(["appId", "clientId", "callbackPort"]);
const ORG_HEADER = "// mattstack org settings, shared by every team. JSONC: comments and trailing commas are fine.\n";
const TEAM_HEADER = "// mattstack team settings. JSONC: comments and trailing commas are fine.\n";

/** The file's object, `{}` when the file is absent. A file that is there but does not parse stops the conversion: splitting what could be read and deleting the original would lose the rest. */
function objOf(files: Record<string, string>, rel: string): Json {
  const text = files[rel];
  if (text === undefined) return {};
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) throw new Error(`${rel} is not valid JSONC (${printParseErrorCode(errors[0]!.error)} at offset ${errors[0]!.offset}); fix it before converting`);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${rel} is not a JSON object; fix it before converting`);
  return value as Json;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sameUser(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function bumpPatch(version: unknown): string {
  const m = typeof version === "string" ? /^(\d+)\.(\d+)\.(\d+)$/.exec(version) : null;
  if (!m) throw new Error(`The team pack's version (${String(version)}) is not x.y.z, so the script cannot bump it`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

function rewritePaths(value: unknown, swaps: [string, string][], note: (from: string, to: string) => void): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const [from, to] of swaps) {
      // A folder name, not a prefix: `packs/acme` must not match inside `packs/acme-base`.
      const whole = new RegExp(`${escapeRegExp(from)}(?![A-Za-z0-9._-])`, "g");
      const next = out.replace(whole, () => to);
      if (next !== out) {
        note(out, next);
        out = next;
      }
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => rewritePaths(item, swaps, note));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, rewritePaths(v, swaps, note)]));
  }
  return value;
}

export function planConversion(input: ConvertInput, opts: ConvertOpts): ConvertPlan {
  const marker = objOf(input.files, "mattstack/mattstack.jsonc");
  if (marker.role === "org") throw new Error("This clone already has the org layout; there is nothing to convert");
  if (marker.role !== "team") throw new Error("This is not a mattstack team repo (mattstack/mattstack.jsonc does not say role: team)");

  const isBase = (pack: string) => objOf(input.files, `mattstack/packs/${pack}/pack/skills.jsonc`).base === true;
  const teamPacks = input.packs.filter((pack) => !isBase(pack));
  if (teamPacks.length !== 1) throw new Error(`The script converts one team, so it needs exactly one team pack; found ${teamPacks.length} (${teamPacks.join(", ") || "none"})`);
  const pack = teamPacks[0]!;
  if (opts.team !== undefined && opts.team !== pack) throw new Error(`The team has to be named "${pack}", after its pack, so plugin ids do not change`);
  const team = pack;

  const report: string[] = [];
  const old = objOf(input.files, "mattstack/settings.team.jsonc");
  const shim = objOf(input.files, "mattstack/team.jsonc");
  const { repos: oldRepos, $migrated: oldBaselines, ...global } = old as Json & { repos?: Json; $migrated?: Json };

  if (global["board.projects"] === undefined && Array.isArray(shim.projects)) {
    global["board.projects"] = shim.projects;
    report.push("board.projects was only in team.jsonc; copied to the org");
  }
  if (global["board.gitlabHost"] === undefined && typeof shim.gitlabHost === "string") {
    global["board.gitlabHost"] = shim.gitlabHost.replace(/^https?:\/\//, "").split("/")[0]!.toLowerCase();
    report.push("board.gitlabHost was only in team.jsonc; copied to the org");
  }

  const market = objOf(input.files, ".claude-plugin/marketplace.json");
  const marketName = typeof market.name === "string" ? market.name : opts.org;
  const ownPlugin = `${pack}@${marketName}`;

  const org: Json = {};
  const teamStore: Json = {};
  for (const [key, value] of Object.entries(global)) {
    if (key === "board.members") continue;
    if (key === "claude.plugins" && Array.isArray(value)) {
      const mine = value.filter((p) => p === ownPlugin);
      const shared = value.filter((p) => p !== ownPlugin);
      if (shared.length > 0) org[key] = shared;
      if (mine.length > 0) teamStore[key] = mine;
      continue;
    }
    if (key === "board.slack" && value !== null && typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value as Json);
      const atOrg = Object.fromEntries(entries.filter(([field]) => SLACK_ORG_FIELDS.has(field)));
      const atTeam = Object.fromEntries(entries.filter(([field]) => !SLACK_ORG_FIELDS.has(field)));
      if (Object.keys(atOrg).length > 0) org[key] = atOrg;
      if (Object.keys(atTeam).length > 0) teamStore[key] = atTeam;
      continue;
    }
    (ORG_KEYS.has(key) ? org : teamStore)[key] = value;
  }

  const roster: Json[] = (Array.isArray(global["mattstack.roster"]) ? (global["mattstack.roster"] as Json[]) : []).map((entry) => ({ ...entry, teams: [team] }));
  const has = (username: string) => roster.some((entry) => typeof entry.username === "string" && sameUser(entry.username, username));
  for (const member of Array.isArray(global["board.members"]) ? (global["board.members"] as Json[]) : []) {
    if (typeof member.username !== "string") continue;
    const { hidden, username, ...rest } = member;
    if (hidden === true) report.push(`board.members hid ${username}; the roster has no hidden flag, so ${username} shows in the apps until someone hides them there`);
    const at = roster.findIndex((entry) => typeof entry.username === "string" && sameUser(entry.username, username as string));
    // board.members sometimes carries a name or a key the roster entry lacks; the roster's own value wins where both have one.
    if (at === -1) roster.push({ username, ...rest, teams: [team] });
    else roster[at] = { ...rest, ...roster[at] };
  }
  if (!has(opts.admin)) roster.push({ username: opts.admin, teams: [team] });
  org["mattstack.roster"] = roster;
  org["mattstack.org"] = { admins: [opts.admin], teams: { [team]: { owners: [opts.admin] } } };

  const teamRepos = new Set(opts.teamRepos ?? []);
  const orgRepos: Json = {};
  const ownRepos: Json = {};
  for (const [identity, section] of Object.entries(oldRepos ?? {})) (teamRepos.has(identity) ? ownRepos : orgRepos)[identity] = section;
  if (Object.keys(orgRepos).length > 0) org.repos = orgRepos;
  if (Object.keys(ownRepos).length > 0) teamStore.repos = ownRepos;

  if (oldBaselines !== undefined) {
    const baseKey = (name: string) => name.replace(/@\d+$/, "");
    const split = (store: Json) => Object.fromEntries(Object.entries(oldBaselines).filter(([name]) => baseKey(name) in store));
    const orgBaselines = split(org);
    const teamBaselines = split(teamStore);
    if (Object.keys(orgBaselines).length > 0) org.$migrated = orgBaselines;
    if (Object.keys(teamBaselines).length > 0) teamStore.$migrated = teamBaselines;
  }

  const clone = `\${team:${opts.org}}/mattstack`;
  const swaps: [string, string][] = [
    [`${clone}/packs/${pack}`, `${clone}/teams/${team}/packs/${team}`],
    ...input.packs.filter(isBase).map((base): [string, string] => [`${clone}/packs/${base}`, `${clone}/org/packs/${base}`]),
    [`${clone}/secrets`, `${clone}/org/secrets`],
  ];
  const noteRewrite = (from: string, to: string) => report.push(`rewrote ${from} to ${to}`);
  const orgOut = rewritePaths(org, swaps, noteRewrite) as Json;
  const teamOut = rewritePaths(teamStore, swaps, noteRewrite) as Json;

  for (const key of Object.keys(orgOut)) if (key !== "repos" && key !== "$migrated") report.push(`org: ${key}`);
  for (const identity of Object.keys(orgRepos)) report.push(`org: repo section ${identity}`);
  for (const key of Object.keys(teamOut)) if (key !== "repos" && key !== "$migrated") report.push(`team ${team}: ${key}`);
  for (const identity of Object.keys(ownRepos)) report.push(`team ${team}: repo section ${identity}`);
  if (Array.isArray(global["board.members"])) report.push("board.members: retired; its usernames are on the roster");

  const rosterUsernames = roster.map((entry) => String(entry.username));
  report.push(`roster usernames to confirm as forge logins: ${rosterUsernames.join(", ")}`);

  const writes: Record<string, string> = {
    "mattstack/mattstack.jsonc": `${JSON.stringify({ role: "org", org: opts.org }, null, 2)}\n`,
    "mattstack/org/settings.org.jsonc": `${ORG_HEADER}${JSON.stringify(orgOut, null, 2)}\n`,
    [`mattstack/teams/${team}/settings.team.jsonc`]: `${TEAM_HEADER}${JSON.stringify(teamOut, null, 2)}\n`,
  };
  const moves: [string, string][] = [];
  const deletes = ["mattstack/settings.team.jsonc"];
  if (input.files["mattstack/team.jsonc"] !== undefined) deletes.push("mattstack/team.jsonc");

  if (input.hasSecrets) moves.push(["mattstack/secrets", "mattstack/org/secrets"]);
  const sops = input.files[".sops.yaml"];
  if (sops !== undefined) {
    if (sops.includes("mattstack/secrets/.*")) writes[".sops.yaml"] = sops.split("mattstack/secrets/.*").join("mattstack/org/secrets/.*");
    else report.push("warning: .sops.yaml has no mattstack/secrets/.* rule; fix its path_regex by hand");
  }
  const ignore = input.files[".gitignore"];
  if (ignore?.includes("mattstack/secrets/")) writes[".gitignore"] = ignore.split("mattstack/secrets/").join("mattstack/org/secrets/");

  const packTo = `mattstack/teams/${team}/packs/${team}`;
  moves.push([`mattstack/packs/${pack}`, packTo]);
  for (const base of input.packs.filter(isBase)) moves.push([`mattstack/packs/${base}`, `mattstack/org/packs/${base}`]);

  const manifest = objOf(input.files, `mattstack/packs/${pack}/.claude-plugin/plugin.json`);
  writes[`${packTo}/.claude-plugin/plugin.json`] = `${JSON.stringify({ ...manifest, version: bumpPatch(manifest.version) }, null, 2)}\n`;

  const plugins = (Array.isArray(market.plugins) ? (market.plugins as Json[]) : []).map((entry) => (entry.name === pack ? { ...entry, source: `./${packTo}` } : entry));
  writes[".claude-plugin/marketplace.json"] = `${JSON.stringify({ ...market, plugins }, null, 2)}\n`;

  return { team, writes, moves, deletes, report, rosterUsernames };
}
```

- [ ] **Step 4: Run the plan's tests**

Run: `bun test scripts/__tests__/convert-team-repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the wrapper**

`scripts/convert-team-repo-to-org.ts` (the shebang is the file's first line):

```ts
#!/usr/bin/env bun
/**
 * bun scripts/convert-team-repo-to-org.ts <clone-dir> --admin <username>
 *     [--team <name>] [--team-repo <identity>]... [--write --roster-confirmed]
 *
 * Prints what the conversion would do. With --write it applies the plan in
 * the clone and makes one commit; it never pushes. Run it from a checkout of
 * this repo at the release tag the admin's app is on: scripts/ is not in the
 * app bundle.
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { getSetting, readForgeUsername, sameUser } from "../packages/rt-client/src/index.ts";
import { planConversion, type ConvertInput } from "./lib/convert-team-repo.ts";

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

function flags(args: string[], name: string): string[] {
  return args.flatMap((arg, i) => (arg === name && args[i + 1] !== undefined ? [args[i + 1]!] : []));
}

const args = process.argv.slice(2);
const cloneArg = args[0];
const admin = flag(args, "--admin");
if (!cloneArg || cloneArg.startsWith("--") || !admin) {
  process.stderr.write("usage: bun scripts/convert-team-repo-to-org.ts <clone-dir> --admin <username> [--team <name>] [--team-repo <identity>]... [--write --roster-confirmed]\n");
  process.exit(2);
}
const clone = resolve(cloneArg);
const git = (...argv: string[]) => execFileSync("git", ["-C", clone, ...argv], { encoding: "utf8" });
const read = (rel: string) => (existsSync(join(clone, rel)) ? readFileSync(join(clone, rel), "utf8") : undefined);

const packsDir = join(clone, "mattstack", "packs");
const packs = existsSync(packsDir) ? readdirSync(packsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : [];
const wanted = ["mattstack/mattstack.jsonc", "mattstack/team.jsonc", "mattstack/settings.team.jsonc", ".sops.yaml", ".gitignore", ".claude-plugin/marketplace.json", ...packs.flatMap((p) => [`mattstack/packs/${p}/.claude-plugin/plugin.json`, `mattstack/packs/${p}/pack/skills.jsonc`])];
const files: ConvertInput["files"] = {};
for (const rel of wanted) {
  const text = read(rel);
  if (text !== undefined) files[rel] = text;
}

let plan;
try {
  plan = planConversion({ files, packs, hasSecrets: existsSync(join(clone, "mattstack", "secrets")) }, { org: basename(clone), admin, team: flag(args, "--team"), teamRepos: flags(args, "--team-repo") });
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

process.stdout.write(`${plan.report.join("\n")}\n`);
process.stdout.write(`moves:\n${plan.moves.map(([from, to]) => `  ${from} -> ${to}`).join("\n")}\n`);
process.stdout.write(`deletes:\n${plan.deletes.map((p) => `  ${p}`).join("\n")}\n`);

if (!args.includes("--write")) {
  process.stdout.write("Nothing was written. Review the split above, then run again with --write --roster-confirmed.\n");
  process.exit(0);
}
if (!args.includes("--roster-confirmed")) {
  process.stderr.write(`Confirm that each of these is that member's forge username, then add --roster-confirmed: ${plan.rosterUsernames.join(", ")}\n`);
  process.exit(2);
}
// The clone's sync engine commits and pushes what rt manages without asking.
// With it on, a half-converted tree could be pushed, and the review below
// would be no gate.
if (getSetting<{ enabled?: boolean }>("rt.teamSnapshot").value?.enabled !== false) {
  process.stderr.write(
    [
      "Team sync is on for this Mac, and it would commit and push the conversion while you are still reviewing it.",
      "Turn it off: rt settings set rt.teamSnapshot '{\"enabled\": false}' --scope machine",
      "Then: rt daemon restart",
      "Turn it back on after rt team publish.",
      "",
    ].join("\n"),
  );
  process.exit(2);
}
// The plan makes --admin the org's only admin. A Mac recorded as anyone else
// would own nothing once it is written, and could not publish it.
const recorded = readForgeUsername(basename(clone));
if (recorded === null || !sameUser(recorded, admin)) {
  process.stderr.write(
    [
      recorded === null
        ? "This Mac has no recorded forge username, so it would not be the org's admin after the conversion and could not publish it."
        : `This Mac is recorded as ${recorded}, not ${admin}, so it would not be the org's admin after the conversion and could not publish it.`,
      recorded === null ? "Record it: rt setup apply --only team.identity" : `Pass --admin ${recorded}, or run this on ${admin}'s Mac.`,
      "",
    ].join("\n"),
  );
  process.exit(2);
}
if (git("status", "--porcelain").trim() !== "") {
  process.stderr.write("The clone has uncommitted changes. Commit or discard them first.\n");
  process.exit(1);
}

const start = git("rev-parse", "HEAD").trim();
try {
  for (const [from, to] of plan.moves) {
    mkdirSync(dirname(join(clone, to)), { recursive: true });
    git("mv", from, to);
  }
  for (const rel of plan.deletes) git("rm", "-q", rel);
  for (const [rel, text] of Object.entries(plan.writes)) {
    mkdirSync(dirname(join(clone, rel)), { recursive: true });
    writeFileSync(join(clone, rel), text);
  }
  git("add", "--", ...Object.keys(plan.writes));
  git("commit", "-q", "-m", "org: convert to the org layout");
} catch (err) {
  // The start was clean, so everything now untracked under what rt manages is this run's own.
  git("reset", "-q", "--hard", start);
  git("clean", "-fdq", "--", "mattstack", ".claude-plugin");
  process.stderr.write(`The conversion stopped partway, and the clone is back as it was: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
process.stdout.write(`Converted ${clone} in one commit. Review it with git show, push it with rt team publish, then turn team sync back on.\n`);
```

The moves run before the writes, so the bumped `plugin.json` lands on the moved file.

- [ ] **Step 6: Test the wrapper against a real temp clone**

Add to `scripts/__tests__/convert-team-repo.test.ts`:

```ts
describe("the wrapper", () => {
  const origHome = process.env.HOME;
  let home: string;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-convert-home-")));
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  /** What `rt settings set rt.teamSnapshot '{"enabled": false}' --scope machine` leaves on disk. */
  function teamSyncOff(): void {
    mkdirSync(dirname(machineSettingsPath()), { recursive: true });
    writeFileSync(machineSettingsPath(), JSON.stringify({ "rt.teamSnapshot": { enabled: false } }));
  }

  /** The machine-local record `team.identity` writes for the clone named acme. */
  function recordedAs(username: string): void {
    const file = join(home, ".mattstack", "rt", "teams", "acme.json");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ forgeUsername: username }));
  }

  /** Everything a real run needs in place: team sync off, and this Mac recorded as the admin. */
  function ready(): void {
    teamSyncOff();
    recordedAs("dev1");
  }

  function tempClone(extra: Record<string, string> = {}): string {
    const dir = join(mkdtempSync(join(tmpdir(), "rt-convert-")), "acme");
    const input = oldClone();
    for (const [rel, text] of Object.entries({ ...input.files, ...extra })) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    mkdirSync(join(dir, "mattstack", "secrets"), { recursive: true });
    writeFileSync(join(dir, "mattstack", "secrets", "rt.json"), "{}");
    const git = (...argv: string[]) => execFileSync("git", ["-C", dir, ...argv], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
    git("init", "-q", "-b", "main");
    git("config", "user.name", "t");
    git("config", "user.email", "t@example.com");
    git("add", "-A");
    git("commit", "-q", "-m", "old layout");
    return dir;
  }
  const script = join(import.meta.dir, "..", "convert-team-repo-to-org.ts");
  const runScript = (dir: string, ...extra: string[]) => Bun.spawnSync(["bun", script, dir, "--admin", "dev1", ...extra], { env: childEnv(), stdout: "pipe", stderr: "pipe" });

  test("without --write it prints the split and changes nothing", () => {
    const dir = tempClone();
    const out = runScript(dir);
    expect(out.exitCode).toBe(0);
    expect(out.stdout.toString()).toContain("Nothing was written");
    expect(existsSync(join(dir, "mattstack", "settings.team.jsonc"))).toBe(true);
  });

  test("--write refuses while team sync is on, says how to turn it off, and changes nothing", () => {
    const dir = tempClone();
    const out = runScript(dir, "--write", "--roster-confirmed");
    expect(out.exitCode).toBe(2);
    expect(out.stderr.toString()).toContain("Team sync is on for this Mac");
    expect(out.stderr.toString()).toContain(`rt settings set rt.teamSnapshot '{"enabled": false}' --scope machine`);
    expect(existsSync(join(dir, "mattstack", "org"))).toBe(false);
    expect(execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" }).trim()).toBe("");
  });

  test("--write refuses on a Mac that is not recorded as the admin, since it could not publish the result", () => {
    teamSyncOff();
    const dir = tempClone();
    const nobody = runScript(dir, "--write", "--roster-confirmed");
    expect(nobody.exitCode).toBe(2);
    expect(nobody.stderr.toString()).toContain("This Mac has no recorded forge username");
    expect(nobody.stderr.toString()).toContain("rt setup apply --only team.identity");

    recordedAs("dev2");
    const other = runScript(dir, "--write", "--roster-confirmed");
    expect(other.exitCode).toBe(2);
    expect(other.stderr.toString()).toContain("This Mac is recorded as dev2, not dev1");
    expect(existsSync(join(dir, "mattstack", "org"))).toBe(false);

    recordedAs("DEV1");
    expect(runScript(dir, "--write", "--roster-confirmed").exitCode).toBe(0);
  });

  test("a write that fails partway puts the clone back exactly as it was", () => {
    ready();
    // A tracked file where the base pack's new folder has to go: the secrets and
    // the team pack move first, then this move throws.
    const dir = tempClone({ "mattstack/org/packs": "in the way" });
    const out = runScript(dir, "--write", "--roster-confirmed");
    expect(out.exitCode).toBe(1);
    expect(out.stderr.toString()).toContain("the clone is back as it was");
    expect(execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" }).trim()).toBe("");
    expect(execFileSync("git", ["-C", dir, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim()).toBe("1");
    expect(existsSync(join(dir, "mattstack", "settings.team.jsonc"))).toBe(true);
    expect(existsSync(join(dir, "mattstack", "secrets", "rt.json"))).toBe(true);
    expect(existsSync(join(dir, "mattstack", "packs", "widgets", "pack", "skills.jsonc"))).toBe(true);
    expect(existsSync(join(dir, "mattstack", "org", "secrets"))).toBe(false);
    expect(existsSync(join(dir, "mattstack", "teams"))).toBe(false);
  });

  test("--write without --roster-confirmed names the usernames and changes nothing", () => {
    teamSyncOff();
    const dir = tempClone();
    const out = runScript(dir, "--write");
    expect(out.exitCode).toBe(2);
    expect(out.stderr.toString()).toContain("dev1, dev2, dev3");
    expect(existsSync(join(dir, "mattstack", "org"))).toBe(false);
  });

  test("--write converts in one commit, and a second run refuses", () => {
    ready();
    const dir = tempClone();
    expect(runScript(dir, "--write", "--roster-confirmed").exitCode).toBe(0);
    expect(existsSync(join(dir, "mattstack", "org", "settings.org.jsonc"))).toBe(true);
    expect(existsSync(join(dir, "mattstack", "org", "secrets", "rt.json"))).toBe(true);
    expect(existsSync(join(dir, "mattstack", "teams", "widgets", "packs", "widgets", "pack", "skills.jsonc"))).toBe(true);
    expect(existsSync(join(dir, "mattstack", "team.jsonc"))).toBe(false);
    expect(execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" }).trim()).toBe("");
    expect(execFileSync("git", ["-C", dir, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim()).toBe("2");

    const again = runScript(dir, "--write", "--roster-confirmed");
    expect(again.exitCode).toBe(1);
    expect(again.stderr.toString()).toContain("already has the org layout");
    expect(execFileSync("git", ["-C", dir, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim()).toBe("2");
  });

  test("the converted clone reads as an org with the team's zone", () => {
    ready();
    const dir = tempClone();
    runScript(dir, "--write", "--roster-confirmed");
    const fs: InitFs = { exists: existsSync, readFile: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null), writeFile: () => {}, mkdirp: () => {}, readDir: (p) => (existsSync(p) ? readdirSync(p) : []) };
    const zones = readZonesFrom(fs, dirname(dir));
    expect(zones).toEqual([expect.objectContaining({ slug: "acme/widgets", host: "gitlab.example.com", projects: ["acme/widgets"], hasPack: true })]);
  });
});
```

with imports for `execFileSync`, the `fs`, `os`, `path` names used, `beforeEach` and `afterEach`, `machineSettingsPath` from `../../lib/rt-paths.ts`, `childEnv` from `../../lib/subprocess.ts` (it hands the child this process's environment, so the script reads the scratch HOME set above), and `readZonesFrom`, `type InitFs` from `../../lib/skills/init.ts`. In the partial-failure test the in-the-way path is listed in `packs`' sibling tree only; it is not under `mattstack/packs`, so the plan itself is unchanged.

Run: `bun test scripts/__tests__/convert-team-repo.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/convert-team-repo.ts scripts/convert-team-repo-to-org.ts scripts/__tests__/convert-team-repo.test.ts
git commit -m "scripts: one-off conversion of the team repo to the org layout"
```

### Task 36: The migration that removes `board.defaultPack`

**Files:**
- Modify: `lib/setup/migrations/index.ts`
- Test: `lib/setup/__tests__/migrations.test.ts` (new)

**Interfaces:**
- Produces: `MIGRATIONS` holds one entry, id `2026-10-01-unset-board-default-pack`. It runs before `org.pull` in an update run (migrations run first).

- [ ] **Step 1: Write the failing test**

```ts
// lib/setup/__tests__/migrations.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { userSettingsPath } from "../../rt-paths.ts";
import type { ApplyContext } from "../apply.ts";
import { MIGRATIONS } from "../migrations/index.ts";

describe("2026-10-01-unset-board-default-pack", () => {
  const origHome = process.env.HOME;
  let home: string;
  const migration = MIGRATIONS.find((m) => m.id === "2026-10-01-unset-board-default-pack")!;
  const ctx = {} as ApplyContext;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-migration-")));
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("removes a leftover value and keeps everything else in the file", async () => {
    mkdirSync(dirname(userSettingsPath()), { recursive: true });
    writeFileSync(userSettingsPath(), `// mine\n{\n  "board.defaultPack": "widgets",\n  "rt.logLevel": "debug"\n}\n`);
    expect(await migration.run(ctx)).toEqual({ state: "done", detail: "Removed the old default pack setting" });
    const text = readFileSync(userSettingsPath(), "utf8");
    expect(text).toStartWith("// mine\n");
    expect(text).not.toContain("board.defaultPack");
    expect(text).toContain('"rt.logLevel": "debug"');
  });

  test("with nothing to remove it is skipped, so it is recorded and never runs again", async () => {
    expect(await migration.run(ctx)).toEqual({ state: "skipped", detail: "There was no old default pack setting" });
  });
});
```

- [ ] **Step 2: Run to see it fail, then implement**

Run: `bun test lib/setup/__tests__/migrations.test.ts`
Expected: FAIL (`migration` is undefined).

In `lib/setup/migrations/index.ts`:

```ts
import { unsetSetting } from "../../settings/write.ts";

export const MIGRATIONS: MigrationDef[] = [
  {
    id: "2026-10-01-unset-board-default-pack",
    title: "Remove the old default pack setting",
    async run(): Promise<StepOutcome> {
      // The key is retired, which is what lets unsetSetting still remove it.
      return unsetSetting("board.defaultPack", "user")
        ? { state: "done", detail: "Removed the old default pack setting" }
        : { state: "skipped", detail: "There was no old default pack setting" };
    },
  },
];
```

- [ ] **Step 3: Run and commit**

```bash
bun test lib/setup/__tests__/migrations.test.ts lib/setup/__tests__/update-safe.test.ts commands/__tests__/onboarding-org.test.ts
git add lib/setup/migrations/index.ts lib/setup/__tests__/migrations.test.ts commands/__tests__/onboarding-org.test.ts
git commit -m "setup: a migration that removes the old board.defaultPack setting"
```

In `commands/__tests__/onboarding-org.test.ts`, the update-run scenario now passes the real `MIGRATIONS` (imported from `../../lib/setup/migrations/index.ts`) in place of its stand-in migration, and the order it expects starts with `migration.2026-10-01-unset-board-default-pack`, then `org.pull`, `team.identity`, `plugins.install`, `verify`. Stage that file with this commit.

### Task 37: End to end with two teams, and the PR 4 gate

**Files:**
- Create: `e2e/tests/org-teams.test.ts`
- Modify: `test-timings.json` only if the Timings workflow regenerates it (never by hand)

Runs the compiled binary under an isolated HOME (`createTestHome`, `rt` from `e2e/harness.ts`). No daemon is needed: every verb here reads and writes files.

`rt team use` is not run here. The compiled binary would run whatever `claude` is on the machine's PATH and the installed app's own `deck` (both are resolved outside HOME), so its side effects are tested in process, behind its seams (Tasks 30 and 34). This file switches teams the way that verb does underneath, by writing `mattstack.activeTeam`, and checks what the resolver then reads.

Every `--json` reply is flat: `rt settings get --json` prints `{ ok, key, value, provenance, migrated }`, `rt settings explain --json` prints `{ ok, key, rows, currentStore }`, and `rt team status --json` prints its fields beside `contract` and `at`.

- [ ] **Step 1: Write the test**

```ts
// e2e/tests/org-teams.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { createTestHome, rt } from "../harness.ts";

let home = "";
let cleanup = () => {};

const ORG = () => join(home, ".mattstack", "teams", "acme");
function write(rel: string, value: unknown, root = ORG()): void {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
}
function identifyAs(username: string): void {
  write(join("rt", "teams", "acme.json"), { forgeUsername: username }, join(home, ".mattstack"));
}
async function get(key: string, extra: string[] = []): Promise<unknown> {
  const out = await rt(["settings", "get", key, "--json", ...extra], { home });
  expect(out.exitCode).toBe(0);
  return (JSON.parse(out.stdout) as { value: unknown }).value;
}

beforeAll(() => {
  const made = createTestHome();
  home = made.path;
  cleanup = made.cleanup;
  write("mattstack/mattstack.jsonc", { role: "org", org: "acme" });
  write("mattstack/org/settings.org.jsonc", {
    "board.gitlabHost": "gitlab.example.com",
    "board.title": "Acme",
    "claude.plugins": ["acme-tools@acme"],
    "mattstack.roster": [
      { username: "dev1", teams: ["widgets"] },
      { username: "dev2", teams: ["gadgets"] },
      { username: "dev3", teams: ["widgets", "gadgets"] },
    ],
    "mattstack.org": { admins: ["dev1"], teams: { widgets: { owners: ["dev1"] }, gadgets: { owners: ["dev2"] } } },
  });
  write("mattstack/teams/widgets/settings.team.jsonc", { "board.title": "Widgets", "claude.plugins": ["widgets@acme"] });
  write("mattstack/teams/gadgets/settings.team.jsonc", { "board.title": "Gadgets" });
});

afterAll(() => cleanup());

describe("an org with two teams", () => {
  test("each member reads the org layer plus their own team's", async () => {
    identifyAs("dev1");
    expect(await get("board.title")).toBe("Widgets");
    expect(await get("board.gitlabHost")).toBe("gitlab.example.com");
    expect(await get("claude.plugins")).toEqual(["acme-tools@acme", "widgets@acme"]);
    identifyAs("dev2");
    expect(await get("board.title")).toBe("Gadgets");
    expect(await get("claude.plugins")).toEqual(["acme-tools@acme"]);
  });

  test("a member on both starts on their first team, and the active team setting switches them", async () => {
    identifyAs("dev3");
    expect(await get("board.title")).toBe("Widgets");

    const chosen = await rt(["settings", "set", "mattstack.activeTeam", '"gadgets"', "--scope", "user"], { home });
    expect(chosen.exitCode).toBe(0);
    expect(await get("board.title")).toBe("Gadgets");
    const status = JSON.parse((await rt(["team", "status", "--json"], { home })).stdout) as Record<string, unknown>;
    expect(status).toMatchObject({ activeTeam: "gadgets", teams: ["widgets", "gadgets"] });

    // A team the roster does not list them on is ignored: they are back on their first team.
    expect((await rt(["settings", "set", "mattstack.activeTeam", '"sprockets"', "--scope", "user"], { home })).exitCode).toBe(0);
    expect(await get("board.title")).toBe("Widgets");
    expect((await rt(["settings", "unset", "mattstack.activeTeam", "--scope", "user"], { home })).exitCode).toBe(0);
  });

  test("an owner writes their own team and is refused another team and the org; a member writes nothing shared", async () => {
    identifyAs("dev2");
    expect((await rt(["settings", "set", "board.title", '"Gadgets 2"', "--scope", "team"], { home })).exitCode).toBe(0);
    const other = await rt(["settings", "set", "board.title", '"x"', "--scope", "team", "--team", "widgets"], { home });
    expect(other.exitCode).not.toBe(0);
    expect(other.stderr).toContain("The widgets team's files belong to its owners");
    const org = await rt(["settings", "set", "board.gitlabHost", '"x"', "--scope", "org"], { home });
    expect(org.stderr).toContain("The org's shared files belong to its admins");
    identifyAs("dev3");
    expect((await rt(["settings", "set", "board.title", '"x"', "--scope", "team"], { home })).exitCode).not.toBe(0);
  });

  test("explain names the org layer and the team layer apart", async () => {
    identifyAs("dev1");
    const out = await rt(["settings", "explain", "board.title", "--json"], { home });
    const rows = (JSON.parse(out.stdout) as { rows: { scope: string; present: boolean }[] }).rows;
    expect(rows.filter((r) => r.present).map((r) => r.scope)).toEqual(["org", "team"]);
  });

  test("status reports the role and the teams", async () => {
    identifyAs("dev1");
    const out = await rt(["team", "status", "--json"], { home });
    expect(JSON.parse(out.stdout) as Record<string, unknown>).toMatchObject({ contract: 1, slug: "acme", role: "admin", activeTeam: "widgets", teams: ["widgets"], orgTeams: ["gadgets", "widgets"] });
  });
});
```

`rt team status` shells out to `git log` in the clone; the seeded clone is not a git repo, so `lastPush` is `null`, which the test does not assert. `rt team status` with no `--team` resolves the Mac's one org, so the seeded marker and org store are all it needs.

- [ ] **Step 2: Run this file against the compiled binary**

```bash
bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/org-teams.test.ts
```

Expected: PASS. The preload (`e2e/setup.ts`) builds `dist/rt` when it is missing or stale; there is no separate build script to run. (`bun run test:e2e` runs the whole `e2e/tests/` directory, whatever follows it.)

- [ ] **Step 3: PR 4 gate**

```bash
bun run test
bunx tsc --noEmit
bun run check
bun run test:all
git add e2e/tests/org-teams.test.ts
git commit -m "e2e: an org with two teams, a member on both, and the write guard"
```

Open PR 4 from `org-teams-4-conversion` against `org-teams-3-writes`.

---
## PR 5: The Mac app's Team pane

Branch `org-teams-5-app`, based on `org-teams-4-conversion`. Swift only. Nothing in this PR builds, launches, re-signs or replaces an app bundle: the pane is checked through `mattstack-checks` and a debug snapshot mode. Launching a second bundle, even under another HOME, would register its login item and launchd agents over the live dev app's.

### Task 38: The model decodes the new status fields and drives the new verbs

**Files:**
- Modify: `rt-tray/Sources-core/Settings/TeamSettingsModel.swift`
- Test: `rt-tray/Tests/MattstackCoreChecks/SettingsChecks.swift`, `rt-tray/Tests/MattstackCoreChecks/PlanModelsChecks.swift`, `rt-tray/Tests/MattstackCoreChecks/ReadinessModelChecks.swift`

**Interfaces:**
- Consumes: Task 31's `team status --json` fields; Task 30's `rt team use <team> --json`; Task 27's `rt team invite --teams`.
- Produces:

```swift
public struct TeamSettingsInfo {
    // existing fields, then:
    public var role: String?        // admin | owner | member | unknown; nil from an older rt
    public var activeTeam: String?
    public var teams: [String]?     // the teams the roster lists you on
    public var orgTeams: [String]?  // every team in the org
}
extension TeamSettingsInfo {
    public var isAdmin: Bool { get }             // role == "admin", or role is nil (an older rt: keep showing Invite)
    public var myTeams: [String] { get }
    public var canSwitchTeam: Bool { get }       // myTeams.count > 1
    public var inviteTeamChoices: [String] { get } // orgTeams when the org has more than one team, else []
}
extension TeamSettingsModel {
    public var isAdmin: Bool { get }             // info?.isAdmin ?? true
    public var canSwitchTeam: Bool { get }
    public var inviteTeamChoices: [String] { get }
    public func useTeam(_ team: String) async
    public func mintInvite(handle: String, team: String?) async
}
```

- [ ] **Step 1: Write the failing checks**

Add to `settingsChecks` in `SettingsChecks.swift`:

```swift
    Check("TeamSettingsInfo decodes role, activeTeam and teams, and reads nil from an rt that predates them") { c in
        let new = try JSONDecoder().decode(TeamSettingsInfo.self, from: Data(#"{"contract":1,"name":"Acme","slug":"acme","remote":null,"lastPush":null,"members":[{"username":"dev1"}],"role":"admin","activeTeam":"widgets","teams":["widgets","gadgets"],"orgTeams":["gadgets","widgets"]}"#.utf8))
        c.expectEqual(new.role, "admin")
        c.expectEqual(new.activeTeam, "widgets")
        c.expectEqual(new.teams, ["widgets", "gadgets"])
        c.expectEqual(new.orgTeams, ["gadgets", "widgets"])
        let old = try JSONDecoder().decode(TeamSettingsInfo.self, from: Data(#"{"contract":1,"name":"Acme","slug":"acme","remote":null,"lastPush":null,"members":[]}"#.utf8))
        c.expectEqual(old.role, nil)
        c.expectEqual(old.activeTeam, nil)
        c.expectEqual(old.teams, nil)
    },
    Check("an admin with two teams can switch and gets a team picker on invite; a member sees neither") { c in
        let rt = ScriptedRt()
        rt.answers["team status"] = (0, #"{"contract":1,"name":"Acme","slug":"acme","remote":null,"lastPush":null,"members":[],"role":"admin","activeTeam":"widgets","teams":["widgets","gadgets"],"orgTeams":["gadgets","widgets"]}"#)
        let m = await MainActor.run { makeTeamSettings(rt).0 }
        await m.load()
        await MainActor.run {
            c.expect(m.isAdmin)
            c.expect(m.canSwitchTeam)
            c.expectEqual(m.inviteTeamChoices, ["gadgets", "widgets"])
        }
        rt.answers["team status"] = (0, #"{"contract":1,"name":"Acme","slug":"acme","remote":null,"lastPush":null,"members":[],"role":"member","activeTeam":"widgets","teams":["widgets"],"orgTeams":["gadgets","widgets"]}"#)
        await m.load()
        await MainActor.run {
            c.expect(!m.isAdmin)
            c.expect(!m.canSwitchTeam)
        }
    },
    Check("an rt that reports no role keeps the Invite section, as the app showed before") { c in
        let rt = ScriptedRt()
        rt.answers["team status"] = (0, #"{"contract":1,"name":"Acme","slug":"acme","remote":null,"lastPush":null,"members":[]}"#)
        let m = await MainActor.run { makeTeamSettings(rt).0 }
        await m.load()
        await MainActor.run {
            c.expect(m.isAdmin)
            c.expectEqual(m.inviteTeamChoices, [])
        }
    },
    Check("useTeam runs rt team use and reloads; mintInvite passes --teams only when a team was picked") { c in
        let rt = ScriptedRt()
        rt.answers["team status"] = (0, #"{"contract":1,"name":"Acme","slug":"acme","remote":null,"lastPush":null,"members":[],"role":"admin","activeTeam":"widgets","teams":["widgets","gadgets"],"orgTeams":["gadgets","widgets"]}"#)
        rt.answers["team use gadgets"] = (0, #"{"contract":1,"team":"gadgets","previous":"widgets","pack":{"installed":true,"enabled":true,"detail":""},"disabled":"widgets@acme","restarted":["board"]}"#)
        rt.answers["team invite"] = (0, #"{"contract":1,"code":"ABCD","expiresAt":"2026-10-08T00:00:00Z","pasteBlock":"x","forgeAccess":"skipped"}"#)
        let m = await MainActor.run { makeTeamSettings(rt).0 }
        await m.load()
        await m.useTeam("gadgets")
        c.expectEqual(rt.calls[1].args, ["team", "use", "gadgets", "--json"])
        c.expectEqual(rt.calls[2].args, ["team", "status", "--json"])
        await m.mintInvite(handle: "bob", team: "gadgets")
        c.expectEqual(rt.calls[3].args, ["team", "invite", "--handle", "bob", "--teams", "gadgets", "--json"])
        await m.mintInvite(handle: "bob", team: nil)
        c.expectEqual(rt.calls[4].args, ["team", "invite", "--handle", "bob", "--json"])
    },
    Check("a refused team switch shows rt's message and leaves the pane on the old team") { c in
        let rt = ScriptedRt()
        rt.answers["team status"] = (0, #"{"contract":1,"name":"Acme","slug":"acme","remote":null,"lastPush":null,"members":[],"role":"member","activeTeam":"widgets","teams":["widgets","gadgets"],"orgTeams":["gadgets","widgets"]}"#)
        rt.answers["team use"] = (2, #"{"contract":1,"ok":false,"error":{"code":"not-on-team","message":"The roster does not list you on the sprockets team"}}"#)
        let m = await MainActor.run { makeTeamSettings(rt).0 }
        await m.load()
        await m.useTeam("sprockets")
        await MainActor.run {
            c.expect(m.error != nil)
            c.expectEqual(m.info?.activeTeam, "widgets")
        }
    },
```

The existing check that calls `m.mintInvite(handle: "bob")` becomes `m.mintInvite(handle: "bob", team: nil)`.

Add to `planModelsChecks` in `PlanModelsChecks.swift`:

```swift
    Check("the org rows decode, and only team.none routes to the Done screen") { c in
        let json = Data(#"""
        { "contract": 1, "at": "2026-10-01T00:00:00Z", "team": { "slug": "acme", "name": "Acme", "mode": "none" },
          "groups": [ { "id": "accounts", "title": "Accounts", "rows": [
            { "id": "team.none", "kind": "access", "title": "Your team", "why": "w", "required": false, "optionalNote": null, "status": "needs-you",
              "detail": "No team lists dev9 yet, so you only get the org's shared settings",
              "action": { "type": "steps", "label": "Show steps…", "steps": ["Ask an org admin (dev1) to put dev9 on a team: rt team members set dev9 --teams <team>", "Then run: rt team pull"] }, "recheck": "on-activate" },
            { "id": "team.identity", "kind": "access", "title": "Who you are", "why": "w", "required": false, "optionalNote": null, "status": "needs-you", "detail": "d",
              "action": { "type": "connect", "label": "Connect", "integration": "github", "fields": [ { "name": "token", "label": "GitHub token", "secret": true, "hint": "repo, read:org" } ] }, "recheck": "on-activate" },
            { "id": "team.push-access", "kind": "access", "title": "Push access", "why": "w", "required": false, "optionalNote": null, "status": "needs-you", "detail": "d",
              "action": { "type": "connect", "label": "Connect", "integration": "github", "fields": [], "create": { "label": "Create a token on GitHub…", "url": "https://github.com/settings/tokens/new?description=mattstack&scopes=repo%2Cread%3Aorg" } }, "recheck": "on-activate" } ] } ],
          "canInstall": true, "requiredMissing": [] }
        """#.utf8)
        let plan = try JSONDecoder().decode(Plan.self, from: json)
        let rows = plan.groups[0].rows
        try c.requireEqual(rows.map(\.id), ["team.none", "team.identity", "team.push-access"])
        c.expectEqual(rows[0].action.flatMap(DoneActions.route), .steps(["Ask an org admin (dev1) to put dev9 on a team: rt team members set dev9 --teams <team>", "Then run: rt team pull"]))
        c.expectEqual(rows[1].action.flatMap(DoneActions.route), nil)
        c.expectEqual(rows[2].action?.create?.url, "https://github.com/settings/tokens/new?description=mattstack&scopes=repo%2Cread%3Aorg")
    },
```

Add to `readinessModelChecks` in `ReadinessModelChecks.swift`, beside the other `outstandingManualRows` checks. `DoneActions.route` only says what a row's action opens; which rows the Done screen lists at all is this property's rule, so the new rows are pinned here too:

```swift
    Check("outstandingManualRows lists team.none, whose action is steps, and not the two org rows whose action is a connect") { c in
        let connect = RowAction(type: .connect, label: "Connect", integration: "github")
        let rows = [
            PlanRow(id: "team.none", kind: .access, title: "Your team", why: "w", required: false, status: .needsYou,
                    detail: "No team lists dev9 yet, so you only get the org's shared settings",
                    action: RowAction(type: .steps, label: "Show steps…", steps: ["Ask an org admin (dev1) to put dev9 on a team: rt team members set dev9 --teams <team>", "Then run: rt team pull"]),
                    recheck: .onActivate),
            PlanRow(id: "team.identity", kind: .access, title: "Who you are", why: "w", required: false, status: .needsYou, action: connect, recheck: .onActivate),
            PlanRow(id: "team.push-access", kind: .access, title: "Push access", why: "w", required: false, status: .needsYou, action: connect, recheck: .onActivate),
        ]
        let plan = Plan(at: "t", team: TeamInfo(slug: "acme", name: "Acme", mode: .join),
                        groups: [PlanGroup(id: "accounts", title: "Accounts", rows: rows)],
                        canInstall: true, requiredMissing: [], finishBlockedBy: [])
        let m = await MainActor.run { ReadinessModel(plans: FakePlans([plan]), permissions: FakePermissions(), ticker: FakeTicker()) }
        await m.load()
        await MainActor.run { c.expectEqual(m.outstandingManualRows.map(\.id), ["team.none"]) }
    },
```

(`RowAction`'s memberwise init takes `integration:` the way the file's connect fixtures pass it; match its parameter order. This check passes on today's `outstandingManualRows`: it holds the rule for the new rows, it does not drive a change.)

- [ ] **Step 2: Run to see them fail**

Run: `cd rt-tray && swift run mattstack-checks`
Expected: a compile failure on `role`, `useTeam` and the two-argument `mintInvite`.

- [ ] **Step 3: Implement**

In `TeamSettingsModel.swift`, add the four optional fields to `TeamSettingsInfo` (all `var ...: T?`, so `Codable` synthesis reads a missing key as nil). What the pane derives from them lives on the struct, so a view can ask without a model (Task 39's `TeamPaneForm`, Task 40's snapshots):

```swift
extension TeamSettingsInfo {
    /// An rt that reports no role predates orgs; the pane keeps what it showed then.
    public var isAdmin: Bool { role == nil || role == "admin" }
    public var myTeams: [String] { teams ?? [] }
    public var canSwitchTeam: Bool { myTeams.count > 1 }
    public var inviteTeamChoices: [String] {
        guard let all = orgTeams, all.count > 1 else { return [] }
        return all
    }
}
```

and on the model:

```swift
    public var isAdmin: Bool { info?.isAdmin ?? true }
    public var canSwitchTeam: Bool { info?.canSwitchTeam ?? false }
    public var inviteTeamChoices: [String] { info?.inviteTeamChoices ?? [] }

    public func useTeam(_ team: String) async {
        struct Switched: Decodable { var team: String }
        guard await runJSON(["team", "use", team, "--json"], verb: "team use", as: Switched.self) != nil else { return }
        await load()
    }

    public func mintInvite(handle: String, team: String?) async {
        let args = ["team", "invite", "--handle", handle] + (team.map { ["--teams", $0] } ?? []) + ["--json"]
        if let decoded = await runJSON(args, verb: "team invite", as: InviteResult.self) { invite = decoded }
    }
```

and delete the one-argument `mintInvite(handle:)`. `load()` clears `error` through `runJSON`, so `useTeam` must not call it after a failure (the guard above returns first) or the refusal would vanish before it is shown.

- [ ] **Step 4: Run and commit**

Run: `cd rt-tray && swift run mattstack-checks`
Expected: every check passes.

```bash
git add rt-tray/Sources-core/Settings/TeamSettingsModel.swift rt-tray/Tests/MattstackCoreChecks/SettingsChecks.swift rt-tray/Tests/MattstackCoreChecks/PlanModelsChecks.swift rt-tray/Tests/MattstackCoreChecks/ReadinessModelChecks.swift
git commit -m "tray: the team settings model reads your role and teams, switches teams, and invites to a team"
```

### Task 39: The Team pane

The pane is split in two so it can be drawn without a model: `TeamPane` owns the model and the actions, and `TeamPaneForm` is a plain view over values. Task 40's snapshot mode renders `TeamPaneForm` from fixtures, with no rt, no socket and no launchd.

**Files:**
- Modify: `rt-tray/Sources/Settings/TeamPane.swift`
- Modify: `rt-tray/Sources/AccessibilityIDs.swift`

- [ ] **Step 1: Add the identifiers**

In `AccessibilityIDs.swift`, beside the other `settingsTeam...` constants:

```swift
    static let settingsTeamYourTeam = "settings.team.yourTeam"
    static let settingsTeamInviteTeam = "settings.team.inviteTeam"
```

- [ ] **Step 2: Rewrite the pane**

Replace the body of `rt-tray/Sources/Settings/TeamPane.swift` with:

```swift
import SwiftUI
import MattstackCore

struct TeamPane: View {
    let env: SettingsEnvironment
    @ObservedObject private var model: TeamSettingsModel
    init(env: SettingsEnvironment) { self.env = env; self.model = env.team }

    var body: some View {
        TeamPaneForm(
            info: model.info,
            invite: model.invite,
            error: model.error,
            maskedRemote: model.maskedRemote,
            onCreateTeam: env.onCreateTeam,
            onJoin: env.onJoinAnotherTeam,
            onUseTeam: { team in Task { await model.useTeam(team) } },
            onInvite: { handle, team in Task { await model.mintInvite(handle: handle, team: team) } }
        )
        .task { await model.load() }
    }
}

/// The pane as a function of what rt reported. It holds no model, so a
/// snapshot can draw it from fixtures.
struct TeamPaneForm: View {
    let info: TeamSettingsInfo?
    let invite: InviteResult?
    let error: String?
    let maskedRemote: String
    let onCreateTeam: () -> Void
    let onJoin: () -> Void
    let onUseTeam: (String) -> Void
    let onInvite: (_ handle: String, _ team: String?) -> Void

    @State private var handle = ""
    @State private var inviteTeam = ""

    private var isAdmin: Bool { info?.isAdmin ?? true }
    private var teamChoices: [String] { info?.inviteTeamChoices ?? [] }
    private var trimmedHandle: String { handle.trimmingCharacters(in: .whitespaces) }
    /// The team an invite is for: the picked one, else your own. Nil sends no --teams, and rt uses your active team.
    private var inviteTarget: String? {
        if teamChoices.isEmpty { return nil }
        return inviteTeam.isEmpty ? info?.activeTeam : inviteTeam
    }

    var body: some View {
        Form {
            if info?.mode == "solo" {
                Section("Team") {
                    Text("You're set up as Just me: no team repo, no forge account.")
                    HStack {
                        Button("Create a team…", action: onCreateTeam).accessibilityIdentifier(AXID.settingsTeamCreate)
                        Button("Join a team…", action: onJoin).accessibilityIdentifier(AXID.settingsTeamJoinAnother)
                    }
                }
            } else {
                Section("Org") {
                    LabeledContent("Name") { Text(info?.name ?? "\u{2014}") }
                    LabeledContent("Your team") { yourTeam }
                    LabeledContent("Remote") {
                        HStack { Text(maskedRemote).textSelection(.enabled)
                            // Copies the masked form, never `info?.remote`,
                            // since an HTTPS remote can carry a token in its userinfo.
                            Button { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(maskedRemote, forType: .string) } label: { Image(systemName: "doc.on.doc") }
                                .buttonStyle(.borderless)
                                .accessibilityIdentifier(AXID.settingsTeamCopyRemote) }
                    }
                    LabeledContent("Backup") { Text(info?.lastPush.map { "last push \($0)" } ?? "no push recorded") }
                }
                Section(info?.activeTeam.map { "Members of \($0)" } ?? "Members") {
                    if let m = info?.members, !m.isEmpty { ForEach(m, id: \.username) { Text($0.username) } }
                    else { Text("Not visible with the current token.").foregroundStyle(.secondary) }
                }
                if isAdmin { inviteSection }
                Section {
                    Button("Rejoin this org…", action: onJoin).accessibilityIdentifier(AXID.settingsTeamJoinAnother)
                    Text("Use a new invite from your org admin. This Mac holds one org.").font(.caption).foregroundStyle(.secondary)
                }
            }
            if let e = error { Text(e).font(.caption).foregroundStyle(.red) }
        }
        .formStyle(.grouped)
        // `initial: true` because status is often loaded before this pane
        // appears (the Apps pane loads it first), and a plain onChange would
        // never fire for a value that does not change again.
        .onChange(of: info?.activeTeam, initial: true) { _, team in
            if inviteTeam.isEmpty, let team { inviteTeam = team }
        }
    }

    @ViewBuilder private var yourTeam: some View {
        if info?.canSwitchTeam == true {
            Picker("Your team", selection: Binding(get: { info?.activeTeam ?? "" }, set: onUseTeam)) {
                ForEach(info?.myTeams ?? [], id: \.self) { Text($0).tag($0) }
            }
            .labelsHidden()
            .accessibilityIdentifier(AXID.settingsTeamYourTeam)
        } else {
            Text(info?.activeTeam ?? "None yet").accessibilityIdentifier(AXID.settingsTeamYourTeam)
        }
    }

    private var inviteSection: some View {
        Section("Invite") {
            if !teamChoices.isEmpty {
                Picker("Team", selection: $inviteTeam) {
                    ForEach(teamChoices, id: \.self) { Text($0).tag($0) }
                }
                .accessibilityIdentifier(AXID.settingsTeamInviteTeam)
            }
            HStack {
                TextField("Forge handle", text: $handle, prompt: Text("teammate's GitHub/GitLab handle")).accessibilityIdentifier(AXID.settingsTeamInviteHandle)
                Button("Invite…") { onInvite(trimmedHandle, inviteTarget) }
                    // With a team picker on screen, an invite with no team would be sent as `--teams ""`.
                    .disabled(trimmedHandle.isEmpty || (!teamChoices.isEmpty && (inviteTarget ?? "").isEmpty))
                    .accessibilityIdentifier(AXID.settingsTeamInvite)
            }
            if let inv = invite { inviteResult(inv) }
        }
    }

    private func inviteResult(_ inv: InviteResult) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let link = inv.link {
                HStack {
                    Button("Copy invite link") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(link, forType: .string) }
                        .accessibilityIdentifier(AXID.settingsTeamCopyLink)
                    Button("Share…") { share(link) }
                        .accessibilityIdentifier(AXID.settingsTeamShareInvite)
                }
                Text(link).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
            }
            Text(inv.pasteBlock).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
            HStack {
                Button("Copy paste block") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(inv.pasteBlock, forType: .string) }
                    .accessibilityIdentifier(AXID.settingsTeamCopyPaste)
                Text("expires \(inv.expiresAt) · forge access: \(inv.forgeAccess)").font(.caption).foregroundStyle(.secondary)
            }
            if let steps = inv.manualSteps, !steps.isEmpty { ForEach(steps, id: \.self) { Text("• \($0)").font(.caption) } }
            if let warning = inv.peeringWarning {
                Label { Text(warning) } icon: { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
                    .font(.caption)
                    .accessibilityIdentifier(AXID.settingsTeamInvitePeeringWarning)
            }
        }
    }

    /// The picker is how the link reaches Messages, Mail or AirDrop without rt
    /// ever handling a recipient.
    private func share(_ link: String) {
        guard let view = NSApp.keyWindow?.contentView else { return }
        NSSharingServicePicker(items: [link]).show(relativeTo: .zero, of: view, preferredEdge: .minY)
    }
}
```

The invite result block, the remote row and the share helper are the code that was there, moved as they were. The placeholder for a missing name is the same character the pane shows today, written as an escape (`"\u{2014}"`). The solo branch's copy stays: "Create a team…" and "Join a team…" still open the wizard, and creating a team makes an org with that team in it. The target is macOS 14, which has the two-parameter `onChange(of:initial:)`.

- [ ] **Step 3: Build**

Run: `cd rt-tray && swift build`
Expected: builds clean. If the build stops on a missing vendored dependency, run `scripts/fetch-deps.sh arm64` in this worktree first, never in the shared checkout.

- [ ] **Step 4: Commit**

```bash
git add rt-tray/Sources/Settings/TeamPane.swift rt-tray/Sources/AccessibilityIDs.swift
git commit -m "tray: the Team pane shows your org and team, lets you switch teams, and shows Invite to admins"
```

### Task 40: Look at the pane, for three people, in both appearances

The pane is UI, so it is not done until it has been looked at. It is looked at through a debug snapshot mode, the way the setup checklist's rows are (`rt-tray/Sources/Setup/ChecklistRowSnapshot.swift`). No app bundle is launched for this, ever: a second bundle would register its own login item and launchd agents, whose labels are per user and not per HOME, and so would replace the live dev app's daemon and deck agents.

**Files:**
- Create: `rt-tray/Sources/SnapshotRenderer.swift`
- Create: `rt-tray/Sources/Settings/TeamPaneSnapshot.swift`
- Modify: `rt-tray/Sources/Setup/ChecklistRowSnapshot.swift` (use the shared renderer)
- Modify: `rt-tray/Sources/main.swift`

- [ ] **Step 1: Lift the offscreen renderer so two snapshot modes share it**

```swift
// rt-tray/Sources/SnapshotRenderer.swift
#if DEBUG
import AppKit
import SwiftUI

enum SnapshotRenderer {
    /// AppKit-backed controls (buttons, pickers, the progress spinner) only draw
    /// through a real view hierarchy, so this renders a hosting view in an offscreen window.
    @MainActor
    static func render<V: View>(_ view: V, appearance: NSAppearance.Name, to url: URL) {
        let host = NSHostingView(rootView: view)
        host.appearance = NSAppearance(named: appearance)
        let size = host.fittingSize
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: appearance)
        window.contentView = host
        host.frame = NSRect(origin: .zero, size: size)
        host.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { fatalError("no bitmap for \(url.lastPathComponent)") }
        host.cacheDisplay(in: host.bounds, to: rep)
        try! rep.representation(using: .png, properties: [:])!.write(to: url)
    }
}
#endif
```

In `ChecklistRowSnapshot.swift`, delete its private `render` and call `SnapshotRenderer.render(Rows(), appearance: ..., to: ...)`. Run its mode once before and once after (`swift run rt-tray --render-checklist-row-snapshots <dir>`) and confirm the two PNGs still come out.

- [ ] **Step 2: Add the Team pane's snapshot mode**

```swift
// rt-tray/Sources/Settings/TeamPaneSnapshot.swift
import AppKit
import SwiftUI
import MattstackCore

/// `rt-tray --render-team-pane-snapshots <out-dir>` renders Settings › Team
/// for an org admin on two teams, a team owner and a member, light and dark,
/// then exits before any window, status item, socket or daemon work exists.
/// DEBUG builds only.
enum TeamPaneSnapshot {
    @MainActor
    static func runIfRequested() -> Bool {
        #if DEBUG
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--render-team-pane-snapshots") else { return false }
        guard args.count > i + 1 else {
            FileHandle.standardError.write(Data("usage: --render-team-pane-snapshots <out-dir>\n".utf8))
            exit(64)
        }
        let out = URL(fileURLWithPath: args[i + 1])
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        _ = NSApplication.shared
        var count = 0
        for (name, json) in people {
            let info = try! JSONDecoder().decode(TeamSettingsInfo.self, from: Data(json.utf8))
            for scheme in ["light", "dark"] {
                let view = TeamPaneForm(info: info, invite: nil, error: nil, maskedRemote: "github.com/acme/org",
                                        onCreateTeam: {}, onJoin: {}, onUseTeam: { _ in }, onInvite: { _, _ in })
                    .frame(width: 560)
                SnapshotRenderer.render(view, appearance: scheme == "dark" ? .darkAqua : .aqua, to: out.appendingPathComponent("team-pane-\(name)-\(scheme).png"))
                count += 1
            }
        }
        print("wrote \(count) snapshots to \(out.path)")
        return true
        #else
        return false
        #endif
    }

    #if DEBUG
    /// What `rt team status --json` reports for each person. Decoded, not constructed: the struct's memberwise init is internal to MattstackCore.
    private static let people: [(String, String)] = [
        ("admin", #"{"contract":1,"name":"Acme","slug":"acme","remote":"https://github.com/acme/org.git","lastPush":"2026-10-01T10:00:00+00:00","members":[{"username":"dev1"},{"username":"dev4"}],"role":"admin","activeTeam":"widgets","teams":["widgets","gadgets"],"orgTeams":["gadgets","widgets"]}"#),
        ("owner", #"{"contract":1,"name":"Acme","slug":"acme","remote":"https://github.com/acme/org.git","lastPush":"2026-10-01T10:00:00+00:00","members":[{"username":"dev1"},{"username":"dev2"}],"role":"owner","activeTeam":"gadgets","teams":["gadgets"],"orgTeams":["gadgets","widgets"]}"#),
        ("member", #"{"contract":1,"name":"Acme","slug":"acme","remote":"https://github.com/acme/org.git","lastPush":null,"members":[{"username":"dev1"},{"username":"dev4"}],"role":"member","activeTeam":"widgets","teams":["widgets"],"orgTeams":["gadgets","widgets"]}"#),
    ]
    #endif
}
```

In `main.swift`, directly after the `ChecklistRowSnapshot.runIfRequested()` line:

```swift
if MainActor.assumeIsolated({ TeamPaneSnapshot.runIfRequested() }) { exit(0) }
```

- [ ] **Step 3: Render and look**

```bash
SCRATCH="$(mktemp -d)"
(cd rt-tray && env -i HOME="$SCRATCH/home" PATH="$PATH" swift run rt-tray --render-team-pane-snapshots "$SCRATCH/team-pane")
ls "$SCRATCH/team-pane"
```

Expected: `wrote 6 snapshots`, and six PNGs. The mode returns before the app starts anything; the isolated HOME is the standing rule for running a built binary all the same. Open each PNG with the Read tool and check, saying plainly what is wrong if anything is:

- Admin, light and dark: the first section is headed "Org"; "Your team" is a picker showing `widgets`; the members section is headed "Members of widgets"; the Invite section is there with a "Team" picker above the handle field, and its button is disabled (the handle is empty).
- Owner: "Your team" is plain text `gadgets`; the members section is headed "Members of gadgets"; there is no Invite section.
- Member: "Your team" is plain text `widgets`; there is no Invite section; "Backup" reads "no push recorded"; the last line reads "Use a new invite from your org admin. This Mac holds one org."
- Nothing is clipped at 560 points wide, and the pickers and secondary text read in both appearances.

A snapshot cannot click. That the picker runs `rt team use` and the pane reloads is held by Task 38's `useTeam` check, and that Invite sends the picked team by its `mintInvite` check.

- [ ] **Step 4: Commit, and the PR 5 gate**

```bash
git add rt-tray/Sources/SnapshotRenderer.swift rt-tray/Sources/Settings/TeamPaneSnapshot.swift rt-tray/Sources/Setup/ChecklistRowSnapshot.swift rt-tray/Sources/main.swift
git commit -m "tray: a debug snapshot mode for the Team pane"
(cd rt-tray && swift run mattstack-checks)
bun run test
bun run check
```

Open PR 5 from `org-teams-5-app` against `org-teams-4-conversion`, with the six snapshots in its body (upload them; do not commit them).

---

## Landing

Nothing merges to `main` until all five PRs are reviewed and green against their own bases.

1. Keep the stack current: whenever `main` moves, rebase `org-teams-1-resolver` on it and each later branch on the one before it (`git rebase --onto`), re-run each PR's gate, and push with the `git_push` tool (`forceWithLease: true`). Do this as `main` moves, not once at the end.
2. When all five are approved and green, land top down: merge PR 5 into `org-teams-4-conversion`, then PR 4 into `org-teams-3-writes`, PR 3 into `org-teams-2-packs`, PR 2 into `org-teams-1-resolver`. After each merge, re-run the receiving branch's gate.
3. Rebase `org-teams-1-resolver` on `main` one last time, run `bun run test:all`, `bun run check` and `swift run mattstack-checks`, then merge PR 1 to `main` as one squash commit. `main` goes from the old layout to the new one in that single commit.
4. Cut one release of its own for this change (the `rt:release` skill), separate from any release already in flight.
5. On the admin's Mac, once it runs that release, from a checkout of this repo at the release tag (`scripts/` is not in the app bundle):
   1. Confirm this Mac knows who it is: `rt setup apply --only team.identity` (the release's update run should already have recorded it, through the step's fallback to a clone found by its `.git`; this run then says "Already recorded"). The username it reports is the `--admin` to pass below. No role can be read yet: `mattstack.org` does not exist until the conversion writes it.
   2. Read the split: `bun scripts/convert-team-repo-to-org.ts ~/.mattstack/teams/<org> --admin <forge username>`.
   3. Turn team sync off, so the clone's sync engine cannot commit or push the conversion while it is being reviewed: `rt settings set rt.teamSnapshot '{"enabled": false}' --scope machine`, then `rt daemon restart` (a running daemon notices the change only on its next rescan). If `rt settings get rt.teamSnapshot` showed other fields set on this Mac, keep them in the JSON.
   4. Convert: the same command with `--write --roster-confirmed`. It refuses while team sync is on, refuses unless this Mac is recorded as that admin, and puts the clone back if it fails partway.
   5. Review `git -C ~/.mattstack/teams/<org> show`, and confirm `rt team status --json` now reports `"role": "admin"`. Anything else means the publish would be refused: stop and fix the record or the `mattstack.org` setting first.
   6. `rt team publish`.
   7. Turn team sync back on: `rt settings set rt.teamSnapshot '{"enabled": true}' --scope machine`, then `rt daemon restart`.
6. Members update the app. Their launch-time `rt setup update` runs the migration, `org.pull`, `team.identity`, `plugins.install` and `skills.materialize`, in that order.

Step 5 runs on a live org repo and step 3 moves `main`: both need the operator's go-ahead at the time, whatever was approved earlier.
