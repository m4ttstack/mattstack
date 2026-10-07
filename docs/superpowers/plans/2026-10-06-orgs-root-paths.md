# Orgs root, PR B: roots and placeholders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rt reads org clones from `~/.mattstack/orgs/<org>/`, offers `${org}`, treats `${team:<name>}` as a deprecated alias, and reports an unmoved clone through a setup row.

**Architecture:** Two path modules (`lib/rt-paths.ts`, the authority, and its mirror `packages/rt-client/src/settings/paths.ts`) gain `orgsDir()` and lose `teamsDir()` in favour of `legacyTeamsDir()`, so every helper caller is found by the compiler. Every literal `join(home, ".mattstack", "teams")` becomes `"orgs"`, and a `no-*` guard test keeps the legacy root out of source from now on. The resolver gains `${org}` and re-points `${team:<name>}`. A new `org.folder` row in the rt-health validators reports the three states the spec names.

**Tech Stack:** Bun, TypeScript, `bun test` from the repo root.

**Spec:** `docs/superpowers/specs/2026-10-06-orgs-root-design.md` (sections 1, 2 and the first half of 7). The migration, the conversion script and the docs are later PRs and are out of scope here.

## Global Constraints

- No em or en dashes anywhere (code, comments, tests, docs).
- Placeholder names only in anything committed: `acme`, `widgets`, `gadgets`, `dev1`, `dev2`, `gitlab.example.com`. Never the real org, team or people.
- Run `bun test <file>` from the repo root only; targeted files per task, never the full suite locally.
- No `console.*`, no raw stream writes under `lib/` or `commands/` (`lib/__tests__/no-raw-output.test.ts`); rt-client's resolver already uses its own `emitSettingsWarning`.
- After touching `packages/rt-client/src`, run `bun run build` inside `packages/rt-client` (the `dist-freshness` test fails otherwise).
- Comments state only what the code cannot show. Update any comment that names `~/.mattstack/teams` next to a line you change.
- `legacyTeamsDir()` may be called only by `lib/home/init-plan.ts`, the future migration, and the future `org.folder` row (this plan's Task 8). Nothing else.
- Commit after each task with a plain subject line and the Co-Authored-By trailer the session requires.

## Review Focus

1. A Mac with one org under `orgs/` and the same clone still under `teams/` (a half-moved Mac): `listOrgs()` must return one org, never two, and the `org.folder` row must read `error`. Pinned in Task 8.
2. `${team:<name>}` inside a string that also carries a foreign `${port}`: the alias must expand and the foreign variable must still pass through. Pinned in Task 6.
3. `${org}` on a Mac with no org must throw the closed-set error, never emit `${org}` literally into a hook command. Pinned in Task 6.
4. A symlinked clone under `orgs/` (the resolver's `orgHolding` follows links): `listOrgs()` and a team write must keep working. Pinned in Task 2.
5. `rt home init` on a fresh Mac must create both `orgs/` and `teams/`, so an older rt on the same account still finds its folder. Pinned in Task 9.

---

## File structure

| File | Responsibility after this PR |
|---|---|
| `lib/rt-paths.ts` | authority: `orgsDir()`, `orgDir(org)`, `legacyTeamsDir()`, `orgsDirUnder(home)`, `orgDirUnder(home, org)` |
| `packages/rt-client/src/settings/paths.ts` | mirror of the three HOME-based helpers |
| `packages/rt-client/src/settings/stores.ts` | `listOrgs()` scans `orgsDir()` |
| `packages/rt-client/src/settings/resolve.ts` | `${org}`, the `${team:}` alias, `ExpandCtx.orgDir` |
| `lib/setup/team-settings.ts` | `discoverOrgs()` scans `orgsDirUnder(p.home)` |
| `lib/setup/validators/rt-health.ts` | the `org.folder` row |
| `lib/__tests__/no-legacy-teams-root.test.ts` | guard against the legacy root in source |
| `lib/home/init-plan.ts` | creates `orgs/` and `teams/` |
| every file in the Task 4 table | one literal each, now `orgs` |

---

### Task 1: The path helpers

**Files:**
- Modify: `lib/rt-paths.ts:215-223`
- Modify: `packages/rt-client/src/settings/paths.ts:49-57`
- Modify: `lib/__tests__/settings-paths-parity.test.ts` (whatever names it lists)
- Modify: `packages/rt-client/src/settings/__tests__/paths.test.ts`
- Modify (callers of `teamsDir()`): `packages/rt-client/src/settings/stores.ts:107`, `packages/rt-client/src/settings/resolve.ts:719`, `packages/rt-client/src/settings/write.ts:658`, `lib/secrets/team-store.ts:108`, `lib/repo-reidentify.ts:107,200`, `commands/skills-sync.ts:257`

**Interfaces:**
- Produces (both modules): `orgsDir(): string` is `join(home(), ".mattstack", "orgs")`; `orgDir(org: string): string` is `join(orgsDir(), org)`; `legacyTeamsDir(): string` is `join(home(), ".mattstack", "teams")`.
- Produces (`lib/rt-paths.ts` only): `orgsDirUnder(home: string): string` is `join(home, ".mattstack", "orgs")`; `orgDirUnder(home: string, org: string): string` is `join(orgsDirUnder(home), org)`. These serve Probes-seamed code that carries `p.home` instead of reading the ambient HOME.
- `teamsDir()` no longer exists in either module.

- [ ] **Step 1: Write the failing tests**

In `packages/rt-client/src/settings/__tests__/paths.test.ts`, replace the `teamsDir` import with `legacyTeamsDir, orgsDir` and add inside the existing describe that fakes HOME:

```ts
test("orgsDir and orgDir sit under ~/.mattstack/orgs", () => {
  expect(orgsDir()).toBe(join(home, ".mattstack", "orgs"));
  expect(orgDir("acme")).toBe(join(home, ".mattstack", "orgs", "acme"));
  expect(orgMarkerPath("acme")).toBe(join(home, ".mattstack", "orgs", "acme", "mattstack", "mattstack.jsonc"));
});

test("legacyTeamsDir is the old root and nothing else derives from it", () => {
  expect(legacyTeamsDir()).toBe(join(home, ".mattstack", "teams"));
  expect(orgDir("acme").startsWith(legacyTeamsDir())).toBe(false);
});
```

Fix every other assertion in that file that expects `teams` under the home to expect `orgs` instead.

In `lib/__tests__/settings-paths-parity.test.ts`, add `orgsDir` and `legacyTeamsDir` to whatever list of mirrored names it compares, and remove `teamsDir`. Add a test for the `Under` pair:

```ts
test("orgDirUnder agrees with orgDir for the ambient home", () => {
  expect(orgDirUnder(process.env.HOME!, "acme")).toBe(orgDir("acme"));
  expect(orgsDirUnder(process.env.HOME!)).toBe(orgsDir());
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/rt-client/src/settings/__tests__/paths.test.ts lib/__tests__/settings-paths-parity.test.ts`
Expected: FAIL, `orgsDir`/`legacyTeamsDir` are not exported.

- [ ] **Step 3: Change both path modules**

`lib/rt-paths.ts`, replacing lines 215-223:

```ts
/** ~/.mattstack/orgs: the container every org clone lives under. */
export function orgsDir(): string {
  return join(home(), ".mattstack", "orgs");
}

/** ~/.mattstack/orgs/<org>: the org clone. */
export function orgDir(org: string): string {
  return join(orgsDir(), org);
}

/** ~/.mattstack/teams: where org clones lived before the orgs root. Only the migration, the org.folder row and home init may name it. */
export function legacyTeamsDir(): string {
  return join(home(), ".mattstack", "teams");
}

/** `orgsDir()` for a home a Probes seam carries instead of the ambient HOME. */
export function orgsDirUnder(home: string): string {
  return join(home, ".mattstack", "orgs");
}

export function orgDirUnder(home: string, org: string): string {
  return join(orgsDirUnder(home), org);
}
```

`packages/rt-client/src/settings/paths.ts`, replacing lines 49-57 with the first three functions above (same bodies, same comments). Update the two docblocks at `paths.ts:25` and `rt-paths.ts:200` that spell `~/.mattstack/teams/<org>/...` to `~/.mattstack/orgs/<org>/...`.

- [ ] **Step 4: Fix the six callers**

- `packages/rt-client/src/settings/stores.ts:107`: `const dir = orgsDir();` (import changes accordingly). Leave the scan logic for Task 2.
- `packages/rt-client/src/settings/resolve.ts:719`: leave `teamsDir: teamsDir()` for Task 6 to replace; for now change it to `orgDir: null as string | null` only if the compiler demands it. Simplest: in this task rename the ctx field to `orgsDir: orgsDir()` and the `teamPath(ctx.orgsDir, ...)` call; Task 6 reshapes it.
- `packages/rt-client/src/settings/write.ts:658`: `names = readdirSync(orgsDir());`
- `lib/secrets/team-store.ts:108`: `return orgDir(slug);` with the import from `../rt-paths.ts`; update the two comments at :111 and :117 to `~/.mattstack/orgs/<slug>/...`.
- `lib/repo-reidentify.ts:107`: `const dir = orgsDir();` and the report's store label at the `teamsOrRefusal` return stays `settings:teams` only if a test pins it; otherwise `settings:orgs`. `:200`: `relative(orgsDir(), file)`.
- `commands/skills-sync.ts:257`: `orgsRoot: orgsDir(),`

- [ ] **Step 5: Build rt-client and run the tests**

Run: `(cd packages/rt-client && bun run build)` then `bun test packages/rt-client/src/settings/__tests__/paths.test.ts lib/__tests__/settings-paths-parity.test.ts packages/rt-client/test/dist-freshness.test.ts`
Expected: PASS. Then `bun run typecheck` (or `bunx tsc -p tsconfig.json --noEmit` if no script) must be clean, so no caller of `teamsDir()` remains.

- [ ] **Step 6: Commit**

```bash
git add lib/rt-paths.ts packages/rt-client/src/settings/paths.ts packages/rt-client/src/settings/stores.ts packages/rt-client/src/settings/resolve.ts packages/rt-client/src/settings/write.ts lib/secrets/team-store.ts lib/repo-reidentify.ts commands/skills-sync.ts lib/__tests__/settings-paths-parity.test.ts packages/rt-client/src/settings/__tests__/paths.test.ts
git commit -m "paths: org clones live under ~/.mattstack/orgs"
```

---

### Task 2: The org scanners

**Files:**
- Modify: `packages/rt-client/src/settings/stores.ts:106-131` (`listOrgs`)
- Modify: `lib/setup/team-settings.ts:90-94,98,119` (`discoverOrgs`, `legacyDeclaredForge`, `readTeamSnapshot`)
- Test: `packages/rt-client/src/settings/__tests__/stores.test.ts` (or wherever `listOrgs` is tested; find it with `grep -rln "listOrgs" packages/rt-client/src/settings/__tests__`)
- Test: `lib/setup/__tests__/team-settings.test.ts` (find the `discoverOrgs` tests with `grep -rln discoverOrgs lib/setup/__tests__`)

**Interfaces:**
- Consumes: `orgsDir()`, `orgsDirUnder(home)`, `orgDirUnder(home, org)` from Task 1.
- Produces: unchanged signatures. `listOrgs(): string[]`, `currentOrg(): string | null`, `discoverOrgs(p: Probes): string[]`.

- [ ] **Step 1: Write the failing tests**

In the `listOrgs` test file, under a fake HOME:

```ts
test("listOrgs reads orgs/ and ignores a clone left under teams/", () => {
  mkdirSync(join(home, ".mattstack", "orgs", "acme", "mattstack", "org"), { recursive: true });
  writeFileSync(join(home, ".mattstack", "orgs", "acme", "mattstack", "org", "settings.org.jsonc"), "{}\n");
  mkdirSync(join(home, ".mattstack", "teams", "acme", "mattstack", "org"), { recursive: true });
  writeFileSync(join(home, ".mattstack", "teams", "acme", "mattstack", "org", "settings.org.jsonc"), "{}\n");
  expect(listOrgs()).toEqual(["acme"]);
  expect(currentOrg()).toBe("acme");
});

test("listOrgs follows a symlinked clone under orgs/", () => {
  const real = join(home, "elsewhere", "acme");
  mkdirSync(join(real, "mattstack", "org"), { recursive: true });
  writeFileSync(join(real, "mattstack", "org", "settings.org.jsonc"), "{}\n");
  mkdirSync(join(home, ".mattstack", "orgs"), { recursive: true });
  symlinkSync(real, join(home, ".mattstack", "orgs", "acme"));
  expect(listOrgs()).toEqual(["acme"]);
});
```

In the `discoverOrgs` test file, with the fake `Probes` the existing tests build:

```ts
test("discoverOrgs reads orgs/ only", () => {
  const p = fakeProbes({
    dirs: { "/h/.mattstack/orgs": ["acme"], "/h/.mattstack/teams": ["widgets"] },
    files: ["/h/.mattstack/orgs/acme/mattstack/org/settings.org.jsonc", "/h/.mattstack/teams/widgets/mattstack/org/settings.org.jsonc"],
  });
  expect(discoverOrgs(p)).toEqual(["acme"]);
});
```

Adapt `fakeProbes` to whatever helper the file already uses; the point is one marked clone in each root and only the `orgs/` one returned.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test <the two test files>`
Expected: the `listOrgs` test fails with `["acme"]` expected but a result that includes the `teams/` clone or none; `discoverOrgs` returns `["widgets"]` or `[]`.

- [ ] **Step 3: Change the scanners**

`stores.ts`: `listOrgs` already reads `orgsDir()` after Task 1; update its docblock ("an unreadable orgs dir means no orgs") and nothing else.

`lib/setup/team-settings.ts`:

```ts
/** Every org clone's slug: subdirectories of `<home>/.mattstack/orgs` that hold `mattstack/org/settings.org.jsonc`. Deliberately built off `Probes` (`p.home`/`p.readDir`/`p.exists`) rather than `listOrgs()`, which resolves `process.env.HOME` at call time: a context built from a fake `Probes` must never leak the real ambient HOME into which team it resolves. */
export function discoverOrgs(p: Probes): string[] {
  const dir = orgsDirUnder(p.home);
  return p.readDir(dir).filter((name) => p.exists(join(dir, name, "mattstack", "org", "settings.org.jsonc")));
}
```

`legacyDeclaredForge` (:98): `const file = join(orgDirUnder(p.home, slug), "mattstack", "settings.team.jsonc");`
`readTeamSnapshot` (:119): `p.readFile(join(orgDirUnder(p.home, slug), ".git", "config"))`.

- [ ] **Step 4: Run the tests, then the files' whole suites**

Run: `bun test <the two test files> lib/setup/__tests__/team-settings.test.ts`
Expected: PASS. Existing fixtures in those files that build `teams/` must be switched to `orgs/` in the same step.

- [ ] **Step 5: Commit**

```bash
git add packages/rt-client/src/settings/stores.ts lib/setup/team-settings.ts <test files>
git commit -m "orgs: the scanners read ~/.mattstack/orgs"
```

---

### Task 3: The guard test

**Files:**
- Create: `lib/__tests__/no-legacy-teams-root.test.ts`

**Interfaces:**
- Produces: a `no-*` test that fails any source file outside the allowed set that names the legacy root. It is written now, expected red, and goes green at the end of Task 4.

- [ ] **Step 1: Write the test**

```ts
/**
 * Org clones live under ~/.mattstack/orgs. The old ~/.mattstack/teams root
 * is named only by home init, the org.folder row and the migration that
 * moves clones out of it. Named no-* so it runs on every PR.
 */

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";

const ROOT = resolve(import.meta.dir, "..", "..");
const SCAN = ["cli.ts", "commands", "lib", "scripts", "packages/rt-client/src", "packages/settings-kit/src", "apps/board/src", "apps/board/bin", "apps/board/scripts", "apps/boxscore/src", "apps/console/src"];
const SKIP_DIRS = new Set(["node_modules", "dist", "__tests__", "fixtures"]);
const ALLOWED = new Set(["lib/rt-paths.ts", "packages/rt-client/src/settings/paths.ts", "lib/home/init-plan.ts", "lib/setup/validators/rt-health.ts", "lib/setup/migrations/orgs-root.ts"]);
// The literal root, or "teams" joined straight after the mattstack home. A
// clone-relative join(clone, "mattstack", "teams") never matches.
const PATTERNS = [/\.mattstack\/teams\b/, /["']\.mattstack["']\s*,\s*["']teams["']/, /mattstackHome\(\)\s*,\s*["']teams["']/, /\blegacyTeamsDir\(\)/];

function sourceFiles(path: string): string[] {
  if (statSync(path).isFile()) return /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  return readdirSync(path)
    .filter((name) => !SKIP_DIRS.has(name))
    .flatMap((name) => sourceFiles(join(path, name)));
}

test("no source names the legacy ~/.mattstack/teams root", () => {
  const offenders = SCAN.filter((p) => { try { statSync(join(ROOT, p)); return true; } catch { return false; } })
    .flatMap((p) => sourceFiles(join(ROOT, p)))
    .map((file) => relative(ROOT, file))
    .filter((rel) => !ALLOWED.has(rel))
    .filter((rel) => PATTERNS.some((re) => re.test(readFileSync(join(ROOT, rel), "utf8"))));
  expect(offenders, "org clones live under orgsDir(); only the migration, home init and the org.folder row may name the old root").toEqual([]);
});
```

Note: `lib/setup/migrations/orgs-root.ts` does not exist yet; listing it now means the migration PR needs no guard change.

- [ ] **Step 2: Run it to see the current offenders**

Run: `bun test lib/__tests__/no-legacy-teams-root.test.ts`
Expected: FAIL, listing the Task 4 files (and comment-only hits such as `lib/daemon/command-router.ts`). Keep the list: it is Task 4's checklist.

- [ ] **Step 3: Commit**

```bash
git add lib/__tests__/no-legacy-teams-root.test.ts
git commit -m "guard: no source names the legacy teams root"
```

---

### Task 4: Every literal under lib, commands, apps and packages

**Files (one literal each unless noted):**

| File:line | Change to |
|---|---|
| `lib/team/add.ts:45` | `orgDirUnder(p.home, org)` |
| `lib/team/active-team.ts:20` | `join(orgDirUnder(p.home, org), "mattstack", "teams")` |
| `lib/team/invite.ts:222,241,401` | `orgDirUnder(p.home, slug)` / `orgDirUnder(p.home, opts.slug)` |
| `lib/team/create.ts:97,141,190,207,314` | `orgDirUnder(p.home, slug)`; its docblock at :2 |
| `lib/team/join.ts:507,544` | `orgDirUnder(p.home, pointer.team)`; `p.mkdirp(orgsDirUnder(p.home))`; the comment above :515 says `~/.mattstack/orgs/<slug>` |
| `lib/team/publish.ts:59,64` | `orgDirUnder(p.home, slug)` and its comment |
| `lib/team/members.ts:203` | ``p.readFile(join(orgDirUnder(p.home, slug), ".git", "config"))`` |
| `lib/team/org-store.ts:5` | `join(orgDirUnder(home, org), "mattstack", "org", "settings.org.jsonc")` |
| `lib/team/share-pack.ts:66` | `orgDirUnder(p.home, org)` |
| `lib/team/team-names.ts:17` | `join(orgDirUnder(p.home, org), "mattstack", "teams", team, "settings.team.jsonc")` |
| `lib/setup/requirements.ts:3,40` | `join(orgDirUnder(p.home, org), "mattstack", "teams", team, "packs", team, REQUIREMENTS_FILE)` and the comment |
| `lib/setup/pack-cache.ts:71` | `return orgDirUnder(home, slug);` |
| `lib/setup/team-slack-secret.ts:49` | `join(orgDirUnder(p.home, slug), "mattstack", "org", "secrets", "board.json")` |
| `lib/setup/steps/org.ts:22,57` | `orgsDirUnder(p.home)`; `join(orgDirUnder(p.home, slug), ".git", "config")` |
| `lib/setup/steps/team.ts:172` | `join(orgDirUnder(ctx.p.home, ctx.team.slug), ".git", "config")` |
| `lib/setup/steps/plugins.ts:143,166` | `join(orgDirUnder(home, slug), ".claude-plugin", "marketplace.json")`; `orgDirUnder(p.home, slug)` |
| `lib/setup/steps/secrets.ts:6` and `commands/setup.ts:848-849` | comments: `orgs/<slug>/mattstack/org/secrets` |
| `lib/skills/init.ts:97,111` | `orgsDirUnder(home)` |
| `lib/skills/materialize.ts:135` | `join(deps.mattstackRoot, "orgs")` |
| `lib/skills/packs.ts:133` | `join(mattstackRoot, "orgs")` |
| `commands/skills.ts:200,491,520` | `join(mattstackRoot, "orgs")` |
| `commands/team.ts:816,904,939` | `orgDirUnder(deps.probes.home, ...)` |
| `commands/setup.ts:547` | `` `~/.mattstack/orgs/${slug}` `` |
| `lib/setup/validators/rt-health.ts:657` | step text "Move every other org's folder out of ~/.mattstack/orgs" |
| `lib/daemon/team-snapshots.ts:75` | `const orgsRoot = rawDeps.orgsDir ?? orgsDir();` rename the dep `teamsDir` to `orgsDir` everywhere in the file, including the warn at :222 ("cannot watch orgs/") |
| `lib/daemon/command-router.ts:113` | comment: `~/.mattstack/orgs` |
| `lib/daemon/home-snapshot.ts` | any comment naming `teams/` as the root (grep it) |
| `packages/rt-client/src/settings/registry-defs.ts:172` | description: `every clone under ~/.mattstack/orgs`, then `bun run docs:gen` |
| `apps/console/src/server/effectiveInputs.ts:220` | comment |
| `apps/board/src/client/board/gate-gallery.fixtures.ts:2101,2125`, `apps/console/src/app/settings/fixtures/repos.ts` | fixture paths `/.mattstack/orgs/acme` |

**Interfaces:**
- Consumes: `orgsDir`, `orgDirUnder`, `orgsDirUnder` from Task 1.
- Produces: `startTeamSnapshots`'s deps take `orgsDir?: string` instead of `teamsDir?: string` (the only signature change; its one caller is in `lib/daemon.ts` or the command router, found by the compiler).

- [ ] **Step 1: Make the edits**

Work through the table top to bottom. Each is a one-line replacement plus the import `import { orgDirUnder, orgsDirUnder } from "../rt-paths.ts"` (path relative to the file). For a file whose function already receives a `home` string rather than `p`, use that variable.

- [ ] **Step 2: Update the tests those files own**

For each file in the table, open its `__tests__` twin and switch every fixture path from `".mattstack", "teams"` or `.mattstack/teams` to `orgs`. The heavy files, with hit counts from the sweep: `lib/daemon/__tests__/home-snapshot.test.ts` (34), `lib/setup/__tests__/steps-c.test.ts` (26), `lib/skills/__tests__/sources.test.ts` (23), `commands/__tests__/skills-init.test.ts` (22), `lib/team/__tests__/invite.test.ts` (21), `commands/__tests__/setup-connect.test.ts` (21), `commands/__tests__/skills.test.ts` (18), `lib/team/__tests__/create.test.ts` (17), `lib/setup/__tests__/apply.test.ts` (12), `lib/setup/__tests__/steps-a.test.ts` (10), `lib/team/__tests__/members.test.ts` (9), `lib/skills/__tests__/init.test.ts` (9), `lib/setup/__tests__/validators-rt-health.test.ts` (9), `commands/__tests__/skills-bind.test.ts` (8), `e2e/tests/org-teams.test.ts` (:10, :20), plus every other file `grep -rln -e '"\.mattstack", "teams"' -e '\.mattstack/teams' lib commands packages apps e2e scripts --include='*.test.ts'` lists. A test that passes `teamsDir:` into `startTeamSnapshots` passes `orgsDir:` now.

Do this with one careful search-and-replace over the test files, then read the diff: a test whose subject IS the legacy root (none exist yet) must not change.

- [ ] **Step 3: Run the guard and the touched suites**

Run: `bun test lib/__tests__/no-legacy-teams-root.test.ts` then `bun test lib/team lib/setup lib/skills lib/daemon commands packages/rt-client/src/settings e2e/tests/org-teams.test.ts`
Expected: the guard passes; every touched suite passes. (`e2e/tests` needs `--preload ./e2e/setup.ts`; run `bun run test:e2e -- e2e/tests/org-teams.test.ts` or the script's own form.)

- [ ] **Step 4: Build rt-client, regenerate docs, typecheck**

Run: `(cd packages/rt-client && bun run build) && bun run docs:gen && bun run typecheck`
Expected: clean; `docs:gen` changes the generated reference for `rt.teamSnapshot`, which is committed with this task.

- [ ] **Step 5: Commit**

```bash
git add -A lib commands apps packages docs e2e
git commit -m "orgs: every reader of the org clone uses the orgs root"
```

---

### Task 5: The daemon watches the new root

**Files:**
- Modify: `lib/daemon/team-snapshots.ts:143-153,214-224` (already renamed in Task 4; this task covers the behaviour and its test)
- Test: `lib/daemon/__tests__/team-snapshots.test.ts`

**Interfaces:**
- Consumes: `orgsDir` dep from Task 4.
- Produces: no new interface.

- [ ] **Step 1: Write the failing test**

```ts
test("scans and watches the orgs root, not teams/", async () => {
  const home = mkdtempSync(join(tmpdir(), "orgs-"));
  mkdirSync(join(home, ".mattstack", "orgs", "acme", ".git"), { recursive: true });
  mkdirSync(join(home, ".mattstack", "teams", "widgets", ".git"), { recursive: true });
  const started: string[] = [];
  const watched: string[] = [];
  const handle = startTeamSnapshots({
    ...baseDeps(home),
    orgsDir: join(home, ".mattstack", "orgs"),
    start: (opts) => { started.push(opts.repoDir); return fakeHandle(); },
    watch: (dir) => { watched.push(dir); return { close() {} }; },
  });
  await handle.rescan();
  expect(started).toEqual([join(home, ".mattstack", "orgs", "acme")]);
  expect(watched).toEqual([join(home, ".mattstack", "orgs")]);
  await handle.stop();
});
```

Use the file's existing `baseDeps`/fake-handle helpers under their real names.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test lib/daemon/__tests__/team-snapshots.test.ts`
Expected: FAIL only if Task 4 left a default at `teams`; otherwise PASS already, which is fine: the test pins the behaviour.

- [ ] **Step 3: Make it pass if needed, then commit**

```bash
git add lib/daemon/team-snapshots.ts lib/daemon/__tests__/team-snapshots.test.ts
git commit -m "daemon: team snapshots watch the orgs root"
```

---

### Task 6: `${org}` and the `${team:<name>}` alias

**Files:**
- Modify: `packages/rt-client/src/settings/resolve.ts:175-245,712-721`
- Modify: `packages/rt-client/src/settings/write.ts:157` (the hint)
- Modify: `lib/endpoint/config.ts:25`, `lib/worktree/config.ts:35` (comments listing the placeholders)
- Test: `packages/rt-client/src/settings/__tests__/resolve.test.ts:660-700`
- Test: `e2e/tests/settings.test.ts:239-259,398-404`

**Interfaces:**
- Produces: `ExpandCtx` is `{ repoRoot?: string; worktree?: string; home: string; orgDir: string | null }`. `expandVariables(value, ctx)` expands `${org}` to `ctx.orgDir` and `${team:<name>}` to the same value; both throw `rt: cannot expand ${org} — ...` wording below when `ctx.orgDir` is null. The warning text for the alias is exactly `rt: ${team:<name>} is deprecated; use ${org}` with the real name substituted.

- [ ] **Step 1: Write the failing tests**

Replace the `ctx()` helper and the three `${team:...}` tests at `resolve.test.ts:660-700` with:

```ts
const orgRoot = join(home, ".mattstack", "orgs", "acme");
const ctx = (orgDir: string | null = orgRoot) => ({ home, orgDir, repoRoot: "/repos/x", worktree: "/repos/x/.wt/a" });

test("expands exactly the closed set", () => {
  expect(expandVariables("${home}/bin", ctx())).toBe(`${home}/bin`);
  expect(expandVariables("${org}/packs", ctx())).toBe(`${orgRoot}/packs`);
  expect(expandVariables("${repoRoot}/.worktrees", ctx())).toBe("/repos/x/.worktrees");
  expect(expandVariables("${worktree}/node_modules", ctx())).toBe("/repos/x/.wt/a/node_modules");
});

test("${team:<name>} is an alias for the current org clone whatever the name", () => {
  const seen: string[] = [];
  setSettingsWarnSink((m) => seen.push(m));
  expect(expandVariables("${team:acme}/packs", ctx())).toBe(`${orgRoot}/packs`);
  expect(expandVariables("${team:old-name}/packs", ctx())).toBe(`${orgRoot}/packs`);
  expect(seen).toEqual(["rt: ${team:acme} is deprecated; use ${org}", "rt: ${team:old-name} is deprecated; use ${org}"]);
  setSettingsWarnSink(null);
});

test("${org} and the alias throw on a Mac with no org, never pass through", () => {
  expect(() => expandVariables("${org}/x", ctx(null))).toThrow(/cannot expand \$\{org\}/);
  expect(() => expandVariables("${team:acme}/x", ctx(null))).toThrow(/cannot expand \$\{org\}/);
});

test("${team:<name>} still refuses a name that is not one segment", () => {
  for (const name of ["../..", "../../.ssh", "a/b", "a\\b", "..", "cv/../.."]) {
    expect(() => expandVariables(`\${team:${name}}/x`, ctx())).toThrow(/single directory segment/);
  }
});

test("a foreign variable passes through verbatim in the SAME string as the alias", () => {
  const out = expandVariables("bun ${team:acme}/hook.ts --port ${port} --keys ${envKeys}", ctx());
  expect(out).toBe(`bun ${orgRoot}/hook.ts --port \${port} --keys \${envKeys}`);
});
```

Import `setSettingsWarnSink` from `../resolve.ts`. Remove the old lexical test.

In `e2e/tests/settings.test.ts`, the assertions at :239-259 and :398-404 expect `${team:e2eteam}` to expand to `<home>/.mattstack/teams/e2eteam`; change the expected path to `<home>/.mattstack/orgs/e2eteam` (the e2e fixture must clone or build the org under `orgs/` too; follow how that test seeds its home) and add one assertion that `${org}` expands to the same path.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/rt-client/src/settings/__tests__/resolve.test.ts`
Expected: FAIL on `${org}` (passes through verbatim today) and on the alias.

- [ ] **Step 3: Change the resolver**

`ExpandCtx`:

```ts
export interface ExpandCtx {
  repoRoot?: string;
  worktree?: string;
  home: string;
  /** The current org clone's root, or null on a Mac with no org. */
  orgDir: string | null;
}
```

Docblock of `expandVariables`: replace the `${team:<name>}` sentence with: "`${org}` is the current org clone's root, and `${team:<name>}` is a deprecated alias for the same path: the name is ignored, because a shared store may still spell the org's old folder name, but it must be a single directory segment (see `teamSegment`). Both throw on a Mac with no org."

`expandString`:

```ts
function expandString(input: string, ctx: ExpandCtx): string {
  return input.replace(VAR_RE, (match, name: string) => {
    if (name === "home") return ctx.home;
    if (name === "repoRoot") return required(ctx.repoRoot, "repoRoot", "a repo path");
    if (name === "worktree") return required(ctx.worktree, "worktree", "a worktree path");
    if (name === "org") return orgRoot(ctx);
    const team = TEAM_VAR_RE.exec(name);
    if (team) {
      teamSegment(team[1] as string);
      emitSettingsWarning(`rt: \${team:${team[1]}} is deprecated; use \${org}`);
      return orgRoot(ctx);
    }
    return match; // not ours — pass through verbatim
  });
}

function orgRoot(ctx: ExpandCtx): string {
  if (ctx.orgDir === null || ctx.orgDir === "") {
    throw new Error("rt: cannot expand ${org} — this Mac has no org clone");
  }
  return ctx.orgDir;
}

/** `${team:<name>}` keeps its segment guard: a traversing name was a store value that reached outside the clone, and the alias must not quietly accept one. */
function teamSegment(name: string): void {
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error(
      `rt: cannot expand \${team:${name}} — a team name must be a single directory segment (no "/", "\\" or "..")`,
    );
  }
}
```

(The two existing error strings in this file use the em-dash character already; keep those two literal strings byte-identical, since tests match on them, and write no new dash anywhere else.)

`expandCtxFrom`:

```ts
function expandCtxFrom(opts: ResolveOpts): ExpandCtx {
  const org = currentOrg();
  return {
    repoRoot: opts.expandCtx?.repoRoot,
    worktree: opts.expandCtx?.worktree,
    home: process.env.HOME ?? homedir(),
    orgDir: org === null ? null : orgDir(org),
  };
}
```

`emitSettingsWarning` already dedupes per message and per process. `write.ts:157`: change the hint to "use ${org} or ${repoRoot} instead". The two comments in `lib/endpoint/config.ts:25` and `lib/worktree/config.ts:35`: list `${org}` and say `${team:<name>}` is a deprecated alias.

- [ ] **Step 4: Run the tests, build, typecheck**

Run: `bun test packages/rt-client/src/settings/__tests__/resolve.test.ts && (cd packages/rt-client && bun run build) && bun run typecheck && bun run test:e2e -- e2e/tests/settings.test.ts`
Expected: PASS. Any other test that built an `ExpandCtx` with `teamsDir:` now fails to typecheck; fix each to `orgDir:`.

- [ ] **Step 5: Commit**

```bash
git add packages/rt-client/src/settings/resolve.ts packages/rt-client/src/settings/write.ts packages/rt-client/src/settings/__tests__/resolve.test.ts e2e/tests/settings.test.ts lib/endpoint/config.ts lib/worktree/config.ts
git commit -m "settings: add \${org}; \${team:<name>} becomes an alias for it"
```

---

### Task 7: The `rt home init` state dirs

**Files:**
- Modify: `lib/home/init-plan.ts:13`
- Test: `lib/home/__tests__/init-plan.test.ts` (find the test that pins `STATE_DIR_NAMES` or the gitignore render with `grep -rn STATE_DIR_NAMES lib/home/__tests__`)

- [ ] **Step 1: Write the failing test**

```ts
test("home init creates the orgs root and keeps the legacy teams root", () => {
  expect(STATE_DIR_NAMES).toContain("orgs");
  expect(STATE_DIR_NAMES).toContain("teams");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test lib/home/__tests__/init-plan.test.ts`
Expected: FAIL, `orgs` missing.

- [ ] **Step 3: Change the list**

```ts
/** ~/.mattstack state-zone directories: no repo, never travel. `teams` stays so an older rt on this account still finds its folder. */
export const STATE_DIR_NAMES = ["rt", "deck", "shepherdr", "repos", "ci-attendants", "work", "orgs", "teams"];
```

If `renderHomeGitignore` or a snapshot test lists these names, update the snapshot deliberately (`bun test --update-snapshots <file>`) and read the diff.

- [ ] **Step 4: Run the test and commit**

```bash
bun test lib/home/__tests__/init-plan.test.ts
git add lib/home/init-plan.ts lib/home/__tests__
git commit -m "home init: create the orgs root"
```

---

### Task 8: The `org.folder` setup row

**Files:**
- Modify: `lib/setup/validators/rt-health.ts` (new `orgFolderRow`, wired in `rtHealthRows`)
- Test: `lib/setup/__tests__/validators-rt-health.test.ts`

**Interfaces:**
- Consumes: `discoverOrgs(p)` from Task 2; `legacyTeamsDir()` only through `join(p.home, ".mattstack", "teams")` (this file is on the guard's allow list); `row()` from `lib/setup/contract.ts`; the org marker read: parse `mattstack/mattstack.jsonc` with `readJsoncObject` the way `lib/skills/sources.ts:245-255` does (import the same helper).
- Produces: `export const ORG_FOLDER_ROW_ID = "org.folder"` and `export function orgFolderRow(p: Probes, orgs: string[]): Row | null`; `rtHealthRows` includes it after `oneTeam`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("org.folder row", () => {
  const marker = (org: string) => JSON.stringify({ role: "org", org });

  test("ready when the one org's marker matches its folder and teams/ is empty", () => {
    const p = fakeProbes({
      files: { "/h/.mattstack/orgs/acme/mattstack/mattstack.jsonc": marker("acme") },
      dirs: { "/h/.mattstack/orgs": ["acme"], "/h/.mattstack/teams": [] },
    });
    expect(orgFolderRow(p, ["acme"])?.status).toBe("ready");
  });

  test("needs-you when a marked clone still sits under teams/", () => {
    const p = fakeProbes({
      files: { "/h/.mattstack/teams/acme/mattstack/mattstack.jsonc": marker("acme") },
      dirs: { "/h/.mattstack/orgs": [], "/h/.mattstack/teams": ["acme"] },
    });
    const r = orgFolderRow(p, []);
    expect(r?.status).toBe("needs-you");
    expect(r?.detail).toContain("has not moved yet");
    expect(r?.action).toMatchObject({ type: "steps", steps: ["Run: rt setup update --force"] });
  });

  test("error when a marker names a different org than its folder", () => {
    const p = fakeProbes({
      files: { "/h/.mattstack/orgs/widgets/mattstack/mattstack.jsonc": marker("acme") },
      dirs: { "/h/.mattstack/orgs": ["widgets"], "/h/.mattstack/teams": [] },
    });
    const r = orgFolderRow(p, ["widgets"]);
    expect(r?.status).toBe("error");
    expect(r?.detail).toContain("acme");
    expect(r?.detail).toContain("widgets");
  });

  test("error when the same clone sits in both roots", () => {
    const p = fakeProbes({
      files: {
        "/h/.mattstack/orgs/acme/mattstack/mattstack.jsonc": marker("acme"),
        "/h/.mattstack/teams/acme/mattstack/mattstack.jsonc": marker("acme"),
      },
      dirs: { "/h/.mattstack/orgs": ["acme"], "/h/.mattstack/teams": ["acme"] },
    });
    expect(orgFolderRow(p, ["acme"])?.status).toBe("error");
  });

  test("null on a Mac with no org and nothing under teams/", () => {
    const p = fakeProbes({ dirs: { "/h/.mattstack/orgs": [], "/h/.mattstack/teams": [] } });
    expect(orgFolderRow(p, [])).toBeNull();
  });
});
```

Use the `Probes` fake the file already uses (its name and shape), not a new one. An unmarked folder under `teams/` (a leaked fixture) is ignored: add one assertion to the first test with `"/h/.mattstack/teams": ["stray"]` and no marker, expecting `ready`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/setup/__tests__/validators-rt-health.test.ts`
Expected: FAIL, `orgFolderRow` is not exported.

- [ ] **Step 3: Write the row**

```ts
/** The org clone's folder is its identity, and the marker inside must agree. A marked clone still under the old teams root has not been moved by the orgs-root migration. */
export const ORG_FOLDER_ROW_ID = "org.folder";

function markerOrg(p: Probes, dir: string): string | null {
  const raw = p.readFile(join(dir, "mattstack", "mattstack.jsonc"));
  if (raw === null) return null;
  const marker = parseJsoncObject(raw);
  const org = marker?.org;
  return typeof org === "string" && org !== "" ? org : null;
}

export function orgFolderRow(p: Probes, orgs: string[]): Row | null {
  const legacyRoot = join(p.home, ".mattstack", "teams");
  const legacy = p.readDir(legacyRoot).filter((name) => markerOrg(p, join(legacyRoot, name)) !== null);
  const mismatched = orgs.flatMap((org) => {
    const named = markerOrg(p, orgDirUnder(p.home, org));
    return named !== null && named !== org ? [{ org, named }] : [];
  });
  const base = { id: ORG_FOLDER_ROW_ID, kind: "tool" as const, title: "Org folder", why: "rt reads the org clone from ~/.mattstack/orgs/<org>, and the folder name must match the org the clone's marker names.", required: false, recheck: "on-activate" as const };
  if (orgs.length === 0 && legacy.length === 0) return null;
  if (mismatched.length > 0) {
    const m = mismatched[0]!;
    return row({ ...base, status: "error", detail: `the clone at ~/.mattstack/orgs/${m.org} says it is the ${m.named} org. Move the folder to match the marker.` });
  }
  const inBoth = legacy.filter((name) => orgs.includes(name));
  if (inBoth.length > 0) {
    return row({ ...base, status: "error", detail: `${inBoth.join(", ")} sits in both ~/.mattstack/orgs and ~/.mattstack/teams. Move the old copy aside.` });
  }
  if (legacy.length > 0) {
    return row({
      ...base,
      status: "needs-you",
      detail: `your org has not moved yet: ${legacy.join(", ")} still sits under ~/.mattstack/teams`,
      action: { type: "steps", label: "Show steps…", steps: ["Run: rt setup update --force"] },
    });
  }
  return row({ ...base, status: "ready", detail: `${orgs.join(", ")} under ~/.mattstack/orgs` });
}
```

Use whatever JSONC object parser the file (or `lib/skills/sources.ts`) already imports for the marker; name it exactly as imported. `p.readDir` on a missing directory must return `[]`; check the `Probes` contract and guard with `p.exists` if it throws.

Wire it in `rtHealthRows`: `const orgFolder = orgFolderRow(p, slugs);` and include it in the returned array right after `oneTeam`, dropping nulls the way the array already does for `oneTeam`.

- [ ] **Step 4: Run the tests and the copy snapshot**

Run: `bun test lib/setup/__tests__/validators-rt-health.test.ts commands/__tests__/setup-copy.test.ts`
Expected: the row tests pass; `setup-copy` may need `bun test --update-snapshots commands/__tests__/setup-copy.test.ts` if it pins the plan's row list. Read the snapshot diff: only the new row may appear.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/validators/rt-health.ts lib/setup/__tests__/validators-rt-health.test.ts commands/__tests__
git commit -m "setup: report an org clone that has not moved to the orgs root"
```

---

### Task 9: Repo contract text and the whole-branch gates

**Files:**
- Modify: `AGENTS.md:21` (the org clone path) and the sentence in the same paragraph
- Modify: `docs/settings-architecture.md:37-38,49-50,68` (the path only; the fuller docs pass is a later PR)

- [ ] **Step 1: Edit the two contract lines**

`AGENTS.md`: "Shared settings live in an org clone (`~/.mattstack/orgs/<org>/`) as an org store and one store per team folder." Add one sentence after the branch-following paragraph: "The old `~/.mattstack/teams/` root is legacy: `lib/__tests__/no-legacy-teams-root.test.ts` keeps it out of source, and the orgs-root migration moves a clone found there."

`docs/settings-architecture.md`: replace each `~/.mattstack/teams/<org>` with `~/.mattstack/orgs/<org>` and delete the clause "the folder keeps the name teams/".

- [ ] **Step 2: Run the static gates**

Run: `bun run check` (turbo static gates: format, lint, typecheck, picker conformance) and `bun test lib/__tests__` (every `no-*` guard).
Expected: clean.

- [ ] **Step 3: Commit and push**

```bash
git add AGENTS.md docs/settings-architecture.md
git commit -m "docs: the org clone lives under ~/.mattstack/orgs"
git push -u origin orgs-root
```

Then open the PR (title "org clones move to ~/.mattstack/orgs"), body per the repo's PR template, listing the contract changes: `${org}`, the `${team:}` alias and its warning, the `org.folder` row, the `orgsDir` dep on `startTeamSnapshots`. CI runs the full suite because fixtures changed.

---

## Self-review

- **Spec coverage.** Section 1 (helpers, literals, guard, home init, scanners, org.folder row): Tasks 1-5, 7, 8. Section 2 (`${org}`, alias, hint, comments, Just-me consequence): Task 6. Rollout step 2's "test fixtures": Task 4 step 2 and Task 6. Sections 3-6 are the later PRs by design.
- **Placeholders.** None: every step carries its code or its exact edit.
- **Type consistency.** `orgsDir`, `orgDir`, `legacyTeamsDir` (both modules); `orgsDirUnder`, `orgDirUnder` (lib only); `ExpandCtx.orgDir: string | null`; `startTeamSnapshots` dep `orgsDir`; `ORG_FOLDER_ROW_ID`, `orgFolderRow(p, orgs)`.
- **Review Focus.** 1 is Task 8's fourth test and Task 2's first test; 2 and 3 are Task 6; 4 is Task 2's second test; 5 is Task 7.
