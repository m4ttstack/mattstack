# Team pack at `mattstack/teams/<team>/plugin/` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move a team's pack from `mattstack/teams/<team>/packs/<team>/` to `mattstack/teams/<team>/plugin/` inside the org repo, with every rt reader following, a conversion script for the live org repo, one clear failure for an unconverted clone, and a guard test that keeps the old spelling out.

**Architecture:** One word, `plugin`, is spelled in `lib/rt-paths.ts` (authority), `packages/rt-client/src/settings/paths.ts` (mirror) and the new `lib/team/team-pack-path.ts`, which also carries the clone-relative strings, the unconverted-clone detector and its one error. Every other site derives from those. The conversion script becomes a planner (`scripts/lib/move-team-packs.ts`, pure) plus a wrapper (`scripts/move-team-packs-to-plugin.ts`) that keeps the current wrapper's safety rules.

**Tech Stack:** Bun, TypeScript, `bun:test`, jsonc-parser. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-07-team-pack-plugin-folder-design.md`

## Global Constraints

- Hard break: nothing reads `mattstack/teams/<team>/packs/<team>/` except `lib/team/team-pack-path.ts` and `scripts/lib/move-team-packs.ts`.
- The org base pack `mattstack/org/packs/<base>/` and everything that reads it do not change.
- No em dashes or en dashes anywhere, in code, comments, docs or commit messages.
- Placeholder names only in committed text, fixtures and the PR body: `acme`, `widgets`, `gadgets`, `dev1`, `dev2`, `gitlab.example.com`. Never the live org's names.
- Run `bun test` from the repo root only, one file (or `lib/__tests__`) at a time. Never the full suite locally.
- Tests never touch the real home: fixtures build under a temp HOME or fake probes, as the existing tests in each file do.
- `--json` envelopes and their keys do not change. The removed materialize "holds N packs" text was a `detail` string, not a key.
- Edits under `plugins/mattstack/` load `mattstack:editing-skills` and `superpowers:writing-skills` first, bump `plugins/mattstack/.claude-plugin/plugin.json` `version`, and append a `CERTIFICATION.md` row per edited skill. Edits under `website/docs/` load `rt:docs` first.
- Comments state only a constraint the code cannot show.
- Every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- After any change under `packages/rt-client/src`, run `bun run build` in `packages/rt-client` so the dist the apps and tests resolve is current.

## Review Focus

1. A team folder that has `plugin/` AND `packs/<team>/` (a half-done move by hand): rt must treat it as converted (reads `plugin/`), never as unconverted, and the script must refuse it. Test in Task 1 (detector false) and Task 10 (planner refuses).
2. A team folder with neither (settings-only team): `hasPack` false, no error, no requirements, as today. Test in Task 3.
3. A store value that spells the nested path for one team must not be rewritten for a team whose name is a prefix of another (`widgets` vs `widgets-extra`), and the base pack's path must never be touched. Test in Task 10.
4. A `UserActionableError` thrown from `readZonesFrom` inside the materialize step must reach the tray with its remedy, not just its title. Test in Task 7.
5. The `teamShaped` heuristic in `commands/skills.ts` must still refuse to take a team pack's `pack/skills.jsonc` as its manifest at the new path. Test in Task 6.

---

### Task 1: `lib/team/team-pack-path.ts`: the pack folder, the clone-relative strings, the detector and the error

**Files:**
- Create: `lib/team/team-pack-path.ts`
- Test: `lib/team/__tests__/team-pack-path.test.ts`

**Interfaces:**
- Produces:
  - `TEAM_PACK_FOLDER = "plugin"`
  - `teamPackRel(team: string): string` → `mattstack/teams/<team>/plugin`
  - `teamPackSource(team: string): string` → `./mattstack/teams/<team>/plugin`
  - `nestedTeamPackRel(team: string): string` → `mattstack/teams/<team>/packs/<team>`
  - `isUnconvertedTeamPack(fs: { exists(path: string): boolean }, teamFolder: string, team: string): boolean`
  - `unconvertedTeamPackError(orgDir: string, team: string): UserActionableError` (code `team-pack-unconverted`, `next` the script command, `thenRun` `rt setup update`)
  - `remedySentence(err: UserActionableError): string` → `<message>. Run <next>, then <thenRun>` (or just the message when `next` is absent)

- [ ] **Step 1: Write the failing test**

```ts
// lib/team/__tests__/team-pack-path.test.ts
import { describe, expect, test } from "bun:test";
import { UserActionableError } from "../../errors.ts";
import {
  TEAM_PACK_FOLDER,
  isUnconvertedTeamPack,
  nestedTeamPackRel,
  remedySentence,
  teamPackRel,
  teamPackSource,
  unconvertedTeamPackError,
} from "../team-pack-path.ts";

const fsOf = (present: string[]) => ({ exists: (path: string) => present.includes(path) });
const FOLDER = "/h/.mattstack/orgs/acme/mattstack/teams/widgets";

describe("the team pack path", () => {
  test("the pack folder is plugin, and the clone-relative strings follow it", () => {
    expect(TEAM_PACK_FOLDER).toBe("plugin");
    expect(teamPackRel("widgets")).toBe("mattstack/teams/widgets/plugin");
    expect(teamPackSource("widgets")).toBe("./mattstack/teams/widgets/plugin");
    expect(nestedTeamPackRel("widgets")).toBe("mattstack/teams/widgets/packs/widgets");
  });
});

describe("isUnconvertedTeamPack", () => {
  test("true only when the nested manifest is there and the plugin manifest is not", () => {
    expect(isUnconvertedTeamPack(fsOf([`${FOLDER}/packs/widgets/pack/skills.jsonc`]), FOLDER, "widgets")).toBe(true);
  });
  test("false for a converted folder, a half-moved folder, and a settings-only team", () => {
    expect(isUnconvertedTeamPack(fsOf([`${FOLDER}/plugin/pack/skills.jsonc`]), FOLDER, "widgets")).toBe(false);
    expect(isUnconvertedTeamPack(fsOf([`${FOLDER}/plugin/pack/skills.jsonc`, `${FOLDER}/packs/widgets/pack/skills.jsonc`]), FOLDER, "widgets")).toBe(false);
    expect(isUnconvertedTeamPack(fsOf([]), FOLDER, "widgets")).toBe(false);
  });
});

describe("unconvertedTeamPackError", () => {
  test("names the nested path, the new path, the script and rt setup update", () => {
    const err = unconvertedTeamPackError("/h/.mattstack/orgs/acme", "widgets");
    expect(err).toBeInstanceOf(UserActionableError);
    expect(err.code).toBe("team-pack-unconverted");
    expect(err.message).toBe("Your org repo still keeps the widgets pack at mattstack/teams/widgets/packs/widgets");
    expect(err.why).toBe("rt reads a team's pack from mattstack/teams/widgets/plugin now");
    expect(err.next).toBe("bun scripts/move-team-packs-to-plugin.ts /h/.mattstack/orgs/acme --admin <username> --write");
    expect(err.thenRun).toBe("rt setup update");
  });
  test("remedySentence joins the message and both commands into one sentence", () => {
    const err = unconvertedTeamPackError("/h/.mattstack/orgs/acme", "widgets");
    expect(remedySentence(err)).toBe(
      "Your org repo still keeps the widgets pack at mattstack/teams/widgets/packs/widgets. Run bun scripts/move-team-packs-to-plugin.ts /h/.mattstack/orgs/acme --admin <username> --write, then rt setup update",
    );
    expect(remedySentence(new UserActionableError("x", "Plain"))).toBe("Plain");
    expect(remedySentence(new UserActionableError("x", "One", {}, { next: "rt a" }))).toBe("One. Run rt a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/team/__tests__/team-pack-path.test.ts`
Expected: FAIL, cannot resolve `../team-pack-path.ts`.

- [ ] **Step 3: Write the module**

```ts
// lib/team/team-pack-path.ts
/**
 * A team's pack is the team's Claude plugin: the one folder under
 * mattstack/teams/<team>/ a member's Mac installs. Everything that spells
 * the pack's place in the org repo reads it from here; the pre-move path
 * is spelled here only for the detector, and in the conversion planner.
 */
import { join } from "path";
import { UserActionableError } from "../errors.ts";

export const TEAM_PACK_FOLDER = "plugin";

export function teamPackRel(team: string): string {
  return `mattstack/teams/${team}/${TEAM_PACK_FOLDER}`;
}

export function teamPackSource(team: string): string {
  return `./${teamPackRel(team)}`;
}

export function nestedTeamPackRel(team: string): string {
  return `mattstack/teams/${team}/packs/${team}`;
}

export function isUnconvertedTeamPack(fs: { exists(path: string): boolean }, teamFolder: string, team: string): boolean {
  const nested = join(teamFolder, "packs", team, "pack", "skills.jsonc");
  const moved = join(teamFolder, TEAM_PACK_FOLDER, "pack", "skills.jsonc");
  return fs.exists(nested) && !fs.exists(moved);
}

export function unconvertedTeamPackError(orgDir: string, team: string): UserActionableError {
  return new UserActionableError(
    "team-pack-unconverted",
    `Your org repo still keeps the ${team} pack at ${nestedTeamPackRel(team)}`,
    {},
    {
      why: `rt reads a team's pack from ${teamPackRel(team)} now`,
      next: `bun scripts/move-team-packs-to-plugin.ts ${orgDir} --admin <username> --write`,
      thenRun: "rt setup update",
    },
  );
}

/** The failure as one sentence, for a `detail` or `error` field that cannot carry next and thenRun apart. */
export function remedySentence(err: UserActionableError): string {
  if (!err.next) return err.message;
  return `${err.message}. Run ${err.next}${err.thenRun ? `, then ${err.thenRun}` : ""}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/team/__tests__/team-pack-path.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/team/team-pack-path.ts lib/team/__tests__/team-pack-path.test.ts
git commit -m "team: team-pack-path names the plugin folder and detects an unconverted clone

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `teamPackDir` points at `plugin/` in rt-paths and rt-client

**Files:**
- Modify: `lib/rt-paths.ts:263-266`
- Modify: `packages/rt-client/src/settings/paths.ts:88-91`
- Test: `lib/__tests__/settings-paths-parity.test.ts:117`
- Test: `packages/rt-client/src/settings/__tests__/paths.test.ts:171`
- Test: `packages/rt-client/src/settings/__tests__/active-team.test.ts` (no edit: it builds through `teamPackDir`)

**Interfaces:**
- Produces: `teamPackDir(org, team)` → `<orgDir>/mattstack/teams/<team>/plugin` on both sides.

- [ ] **Step 1: Change the two expectations**

In `lib/__tests__/settings-paths-parity.test.ts` line 117 replace
`teamPackDir: \`${org}/mattstack/teams/widgets/packs/widgets\`,`
with
`teamPackDir: \`${org}/mattstack/teams/widgets/plugin\`,`.

In `packages/rt-client/src/settings/__tests__/paths.test.ts` line 171 replace
`expect(teamPackDir("acme", "widgets")).toBe(\`${root}/mattstack/teams/widgets/packs/widgets\`);`
with
`expect(teamPackDir("acme", "widgets")).toBe(\`${root}/mattstack/teams/widgets/plugin\`);`.

- [ ] **Step 2: Run both tests to verify they fail**

Run: `bun test lib/__tests__/settings-paths-parity.test.ts packages/rt-client/src/settings/__tests__/paths.test.ts`
Expected: FAIL on the two changed expectations (the `/packs/widgets` path still comes back).

- [ ] **Step 3: Change both path modules**

`lib/rt-paths.ts` lines 263-266 become:

```ts
/** A team's pack is its Claude plugin, the one folder under the team a member's Mac installs. */
export function teamPackDir(org: string, team: string): string {
  return join(teamFolderDir(org, team), "plugin");
}
```

`packages/rt-client/src/settings/paths.ts` lines 88-91 become the same four lines (rt-client never imports from `lib/`, so the word is spelled here as well; the parity test pins the two together).

- [ ] **Step 4: Rebuild rt-client and run the tests**

Run: `(cd packages/rt-client && bun run build) && bun test lib/__tests__/settings-paths-parity.test.ts packages/rt-client/src/settings/__tests__/paths.test.ts packages/rt-client/src/settings/__tests__/active-team.test.ts packages/rt-client/test/dist-freshness.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rt-paths.ts packages/rt-client/src/settings/paths.ts lib/__tests__/settings-paths-parity.test.ts packages/rt-client/src/settings/__tests__/paths.test.ts
git commit -m "paths: teamPackDir is the team's plugin/ folder

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Zones read the pack at `plugin/`, refuse an unconverted folder, and init writes the new marketplace source

**Files:**
- Modify: `lib/skills/init.ts:138-140` (`zonePackDir`), `:174-175` (`readZonesFrom`), `:453` (`initPack` source)
- Test: `lib/skills/__tests__/init.test.ts`

**Interfaces:**
- Consumes: `TEAM_PACK_FOLDER`, `teamPackSource`, `isUnconvertedTeamPack`, `unconvertedTeamPackError` from Task 1.
- Produces: `zonePackDir(zone)` → `join(zone.dir, "plugin")`; `readZonesFrom` throws `UserActionableError` code `team-pack-unconverted` for the first unconverted team folder.

- [ ] **Step 1: Re-point the fixtures and add the two new tests**

In `lib/skills/__tests__/init.test.ts`, replace every `/packs/widgets/` with `/plugin/`, every `/packs/gadgets/` with `/plugin/`, every `/packs/acme/` with `/plugin/` where the segment before `packs` is `teams/<same name>`, and every marketplace source `./mattstack/teams/<t>/packs/<t>` with `./mattstack/teams/<t>/plugin` (lines 119, 120, 128-130, 138, 294, 380, 393, 403, 419, 421, 482, 521, 527, 539, 748, 749, 835, 958, 972, 973, 975). Rename the test at line 118 to `"a team folder with a plugin/pack/skills.jsonc has a pack; a plugin.json alone does not"` and the one at line 135 to `"a base pack at plugin/ does not occupy the team's pack slot"`.

Recipe (run from the repo root, then review the diff by eye):

```bash
sed -i '' -E 's#/teams/(widgets|gadgets|acme)/packs/\1(/|")#/teams/\1/plugin\2#g' lib/skills/__tests__/init.test.ts
```

Then add, inside the `describe` that holds the `hasPack` test:

```ts
  test("a team folder still holding packs/<team> and nothing at plugin/ is refused with the conversion remedy", () => {
    const fs = memFs(orgFiles("acme", {}, { widgets: {} }, {
      [`${ORG_ROOT("acme")}/mattstack/teams/widgets/packs/widgets/pack/skills.jsonc`]: `{}`,
    }));
    let thrown: unknown;
    try {
      readZones(fs, HOME);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UserActionableError);
    expect((thrown as UserActionableError).code).toBe("team-pack-unconverted");
    expect((thrown as UserActionableError).next).toBe(`bun scripts/move-team-packs-to-plugin.ts ${ORG_ROOT("acme")} --admin <username> --write`);
    expect((thrown as UserActionableError).thenRun).toBe("rt setup update");
  });

  test("a team folder with neither plugin/ nor packs/<team> is a settings-only team", () => {
    const fs = memFs(orgFiles("acme", {}, { widgets: {} }));
    expect(readZones(fs, HOME).map((z) => z.hasPack)).toEqual([false]);
  });
```

Add `import { UserActionableError } from "../../errors.ts";` if the file does not import it yet.

- [ ] **Step 2: Run the test file to verify it fails**

Run: `bun test lib/skills/__tests__/init.test.ts`
Expected: FAIL: the `hasPack` tests see `false` (code still reads `packs/<team>`), the marketplace source assertions see `./mattstack/teams/<t>/packs/<t>`, the new refusal test sees no throw.

- [ ] **Step 3: Change `init.ts`**

Add to the imports:

```ts
import { TEAM_PACK_FOLDER, isUnconvertedTeamPack, teamPackSource, unconvertedTeamPackError } from "../team/team-pack-path.ts";
```

Replace `zonePackDir`:

```ts
export function zonePackDir(zone: Pick<ZoneInfo, "dir">): string {
  return join(zone.dir, TEAM_PACK_FOLDER);
}
```

(Callers that pass `{ dir, team }` still type-check: `Pick<ZoneInfo, "dir">` accepts the wider object.)

In `readZonesFrom`, replace the two lines

```ts
      const packDir = zonePackDir({ dir, team });
      zones.push({ ... });
```

with

```ts
      if (isUnconvertedTeamPack(fs, dir, team)) throw unconvertedTeamPackError(orgDir, team);
      const packDir = zonePackDir({ dir });
      zones.push({ slug: `${org}/${team}`, org, team, orgDir, dir, host, projects, marketplace, hasPack: isPackDir(fs, packDir) && !isBasePack(fs, packDir), packCompiled: packIsCompiled(fs, packDir) });
```

In `initPack`, replace
`const packSource = \`./mattstack/teams/${zone.team}/packs/${zone.team}\`;`
with
`const packSource = teamPackSource(zone.team);`.

- [ ] **Step 4: Run the test file to verify it passes**

Run: `bun test lib/skills/__tests__/init.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/init.ts lib/skills/__tests__/init.test.ts
git commit -m "skills: zones read the team pack at plugin/ and refuse an unconverted folder

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Folder discovery finds the team pack at `plugin/`

**Files:**
- Modify: `lib/skills/packs.ts:156-161`
- Test: `lib/skills/__tests__/packs.test.ts:243,295`

**Interfaces:**
- Consumes: `TEAM_PACK_FOLDER`, `isUnconvertedTeamPack`, `unconvertedTeamPackError` from Task 1.
- Produces: `orgFolderPacks(root)` lists `<teamsDir>/<team>/plugin` and throws the unconverted error.

- [ ] **Step 1: Re-point the fixture and add the refusal test**

In `lib/skills/__tests__/packs.test.ts` line 243 replace
`const widgets = join(org, "mattstack", "teams", "widgets", "packs", "widgets");`
with
`const widgets = join(org, "mattstack", "teams", "widgets", "plugin");`
and line 295 replace
`writeFile(join(org, "mattstack", "teams", "Bad_Team", "packs", "Bad_Team", "pack", "surface.jsonc"), ...)`
with
`writeFile(join(org, "mattstack", "teams", "Bad_Team", "plugin", "pack", "surface.jsonc"), ...)`.

Add after the `"finds each team's pack and the org base pack, by folder"` test:

```ts
  test("a team folder still holding packs/<team> is refused with the conversion remedy", () => {
    const { root, org } = makeOrg();
    writeFile(join(org, "mattstack", "teams", "gadgets", "packs", "gadgets", "pack", "skills.jsonc"), `{}`);
    expect(() => orgFolderPacks(root)).toThrow("Your org repo still keeps the gadgets pack at mattstack/teams/gadgets/packs/gadgets");
  });
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `bun test lib/skills/__tests__/packs.test.ts`
Expected: FAIL: `widgets` is not found at `plugin/`, and no throw for `gadgets`.

- [ ] **Step 3: Change `orgFolderPacks`**

Add the import `import { TEAM_PACK_FOLDER, isUnconvertedTeamPack, unconvertedTeamPackError } from "../team/team-pack-path.ts";` and replace the team loop body:

```ts
    for (const team of subdirs(teamsDir)) {
      if (!TEAM_NAME_RE.test(team)) continue;
      const teamDir = join(teamsDir, team);
      if (isUnconvertedTeamPack({ exists: existsSync }, teamDir, team)) throw unconvertedTeamPackError(orgDir, team);
      const pack = packFromDir(team, join(teamDir, TEAM_PACK_FOLDER), marketplace);
      if (pack) found.push(pack);
    }
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `bun test lib/skills/__tests__/packs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/packs.ts lib/skills/__tests__/packs.test.ts
git commit -m "skills: folder discovery finds a team pack at plugin/

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Materialize reads the one pack at `plugin/`

**Files:**
- Modify: `lib/skills/materialize.ts:32-48` (`claimingPacksIn`), `:97` (the board-fill `pluginJson` path), the N-packs branch in `materializeRepo`
- Test: `lib/skills/__tests__/materialize.test.ts` (the `org` builder and its callers), `lib/skills/__tests__/base-attachments.test.ts:11`, `lib/skills/__tests__/sources.test.ts:663,677,686`

**Interfaces:**
- Consumes: `TEAM_PACK_FOLDER` from Task 1; `zonePackDir` from Task 3.
- Produces: `claimingPacksIn(fs, zone)` returns zero or one `ClaimingPack` named `zone.team`; the board-fill retarget reads the plugin name from `<zonePackDir>/.claude-plugin/plugin.json`.

- [ ] **Step 1: Rewrite the test builder and remove the multi-pack cases**

In `lib/skills/__tests__/materialize.test.ts` change the builder:

```ts
type TeamSpec = { projects?: string[]; pack?: object };

function org(root: string, name: string, opts: { projects: string[]; teams: Record<string, TeamSpec>; base?: Record<string, object> }): void {
  const dir = join(root, "orgs", name);
  write(join(dir, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "org", org: name }));
  write(join(dir, "mattstack", "org", "settings.org.jsonc"), JSON.stringify({ "board.gitlabHost": "https://gitlab.example.com", "board.projects": opts.projects }));
  for (const [team, spec] of Object.entries(opts.teams)) {
    const teamDir = teamFolder(root, name, team);
    write(join(teamDir, "settings.team.jsonc"), JSON.stringify(spec.projects ? { "board.projects": spec.projects } : {}));
    if (spec.pack) write(join(teamDir, "plugin", "pack", "skills.jsonc"), JSON.stringify(spec.pack));
  }
  for (const [base, fragment] of Object.entries(opts.base ?? {})) {
    write(join(dir, "mattstack", "org", "packs", base, "pack", "skills.jsonc"), JSON.stringify(fragment));
  }
}
```

Then, for every caller, turn `packs: { <team>: X }` into `pack: X` when the key equals the team, and:

- Delete the tests `"two packs in one team folder that claims the repo are both refused"`, `"a base pack is not counted when two claiming packs share a team folder"` (the shape no longer exists).
- `"a team that sets no projects holds the base pack without claiming anything"`: the `acme-base-team` entry becomes `{ projects: [], pack: { base: true } }`.
- `"a base pack beside a claiming pack in one zone claims nothing and gets no file"`: becomes `"a base pack in a team's plugin slot claims nothing and gets no file"` with teams `{ widgets: { pack: {} }, gadgets: { pack: { base: true } } }` and the same assertions.
- `"one base pack name in two declaring teams is not refused"`: give each of the two teams `pack: {}` and move `"acme-base": { base: true }` to `base: { "acme-base": { base: true } }`; the assertion stays that both team packs are written.
- Every literal `join(teamFolder(root, "acme", "<t>"), "packs", "<t>", ...)` becomes `join(teamFolder(root, "acme", "<t>"), "plugin", ...)` (lines 132 and 166 and any other).
- A test that referenced a pack whose name differed from its team (other than the base cases above) is rewritten so the pack is the team's.

In `lib/skills/__tests__/base-attachments.test.ts` line 11 and `lib/skills/__tests__/sources.test.ts` lines 663, 677, 686 replace the `teams/<t>/packs/<t>` segment with `teams/<t>/plugin`.

Add to `lib/skills/__tests__/materialize.test.ts` (the board-fill retarget from #733 has no materialize-level test, and its plugin.json path moves):

```ts
  test("a base fill bound only from a board slot is pointed at the team plugin named in plugin/.claude-plugin/plugin.json", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", {
      projects: ["acme/widgets"],
      teams: { widgets: { pack: { extends: "acme-base" } } },
      base: { "acme-base": { base: true, bindings: { "board:triage": { domain: "acme-base:triage-rules" } } } },
    });
    write(join(teamFolder(root, "acme", "widgets"), "plugin", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "widgets", version: "0.1.0" }));
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs[0]!.ok).toBe(true);
    expect(body(join(root, "repos", SLUG, "packs", "widgets", "skills.jsonc")).bindings["board:triage"]!.domain).toBe("widgets:triage-rules");
  });

  test("a board-only base fill with no plugin.json beside the pack is a per-pack error naming the file", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", {
      projects: ["acme/widgets"],
      teams: { widgets: { pack: { extends: "acme-base" } } },
      base: { "acme-base": { base: true, bindings: { "board:triage": { domain: "acme-base:triage-rules" } } } },
    });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs[0]).toMatchObject({ ok: false });
    if (!out.packs[0]!.ok) expect(out.packs[0]!.detail).toContain(join("widgets", "plugin", ".claude-plugin", "plugin.json"));
  });
```

- [ ] **Step 2: Run the three files to verify they fail**

Run: `bun test lib/skills/__tests__/materialize.test.ts lib/skills/__tests__/base-attachments.test.ts lib/skills/__tests__/sources.test.ts`
Expected: materialize FAILS (no pack found at `plugin/`); the other two pass or fail only on path strings that the next step does not change (sources and base-attachments walk up to the marker, so they should already pass; if they fail, the fixture edit is wrong).

- [ ] **Step 3: Change `materialize.ts`**

Replace `claimingPacksIn`:

```ts
/** The team's one pack at plugin/, when it is there and is not a base. */
function claimingPacksIn(fs: MaterializeFs, zone: ZoneInfo): ClaimingPack[] {
  const packDir = zonePackDir(zone);
  if (!isPackDir(fs, packDir)) return [];
  const path = join(packDir, "pack", "skills.jsonc");
  try {
    const own = readFragment(fs, path);
    if (!own) return [{ name: zone.team, own: { error: `${path} is missing` } }];
    return own.base === true ? [] : [{ name: zone.team, own }];
  } catch (err) {
    if (!(err instanceof FragmentError)) throw err;
    return [{ name: zone.team, own: { error: err.message } }];
  }
}
```

Add `zonePackDir` to the `./init.ts` import. In `materializePack`, the board-fill line

```ts
        const pluginJson = join(zone.dir, "packs", pack, ".claude-plugin", "plugin.json");
```

becomes

```ts
        const pluginJson = join(zonePackDir(zone), ".claude-plugin", "plugin.json");
```

In `materializeRepo`, delete the block

```ts
    const names = claiming.map((c) => c.name);
    if (names.length > 1) {
      ...
      continue;
    }
```

(it is unreachable now). Keep the `holders.length > 1` branch: two orgs' teams of the same name can still claim one repo.

- [ ] **Step 4: Run the three files to verify they pass**

Run: `bun test lib/skills/__tests__/materialize.test.ts lib/skills/__tests__/base-attachments.test.ts lib/skills/__tests__/sources.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/materialize.ts lib/skills/__tests__/materialize.test.ts lib/skills/__tests__/base-attachments.test.ts lib/skills/__tests__/sources.test.ts
git commit -m "skills: materialize reads the team's one pack at plugin/

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The skills command's team-shape heuristic and its fixtures

**Files:**
- Modify: `commands/skills.ts:516-520`
- Test: `commands/__tests__/skills.test.ts:210-211` (the helper) and lines 557-3945 (callers), `commands/__tests__/skills-bind.test.ts:837,877,960,1079,1115`, `commands/__tests__/skills-init.test.ts:333-334`, `commands/__tests__/skills-sync.test.ts:409,440`, `commands/__tests__/skills-surface.test.ts:1200,1231,1253,1280`, and the single hits in `skills-json-frozen.test.ts` and `skills-report-output.test.ts`

**Interfaces:**
- Consumes: `TEAM_PACK_FOLDER` from Task 1.

- [ ] **Step 1: Re-point the fixtures and add the heuristic test**

In `commands/__tests__/skills.test.ts` lines 210-211 the helper becomes:

```ts
const teamPackDir = (mattstackRoot: string, org: string, team: string) =>
  join(mattstackRoot, "orgs", org, "mattstack", "teams", team, "plugin");
```

Line 757 `teamPackDir(mattstackDir, "acme", "acme", "acme-base")` becomes `teamPackDir(mattstackDir, "acme", "acme")` (the base fragment written there makes it a base pack in the team's slot, which is what the test exercises). Every other caller drops nothing (they pass three arguments). Any literal `"packs", "<team>"` after a `teams/<team>` in this file or the other five test files becomes `"plugin"`:

```bash
rg -n 'teams/(widgets|gadgets|acme|t)/packs/\1|"teams", "(widgets|gadgets|acme|t)", "packs", "\2"' commands/__tests__/
```

fix each hit by hand (the path is `teams/<t>/plugin` or `"teams", "<t>", "plugin"`).

Add to `commands/__tests__/skills.test.ts`, next to the existing compile-with-`--pack-dir` tests:

```ts
  test("a team pack's pack/skills.jsonc at plugin/ is a fragment, never taken as its manifest", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = teamPackDir(mattstackDir, "acme", "widgets");
    writeFile(join(packDir, "pack", "skills.jsonc"), JSON.stringify({ bindings: {} }));
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_JSONC);
    const { exitCode, stderr } = await runSkillsCapturing(["compile", "--pack-dir", packDir, "--mattstack-dir", mattstackDir]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("repos/*/packs/widgets/skills.jsonc");
  });
```

(`runSkillsCapturing` at line 2857, `makeMattstackDir` at line 179, `writeFile` at line 27 and `STUBS_JSONC` at line 75 are this file's existing helpers.)

- [ ] **Step 2: Run the six files to verify they fail**

Run: `bun test commands/__tests__/skills.test.ts commands/__tests__/skills-bind.test.ts commands/__tests__/skills-init.test.ts commands/__tests__/skills-sync.test.ts commands/__tests__/skills-surface.test.ts commands/__tests__/skills-json-frozen.test.ts commands/__tests__/skills-report-output.test.ts`
Expected: FAIL: the new heuristic test gets exit 0 (the fragment is taken as a standalone manifest), and zone-dependent tests find no pack.

- [ ] **Step 3: Change the heuristic**

`commands/skills.ts` lines 516-520 become:

```ts
  // Team packs sit at <repo>/mattstack/teams/<team>/plugin; that path shape
  // survives worktrees, unlike the clone's location, and a team pack's
  // pack/skills.jsonc is a merge fragment, never its manifest.
  const parts = resolvePath(packDir).split(sep);
  const teamShaped = parts.at(-1) === TEAM_PACK_FOLDER && parts.at(-3) === "teams" && parts.at(-4) === "mattstack";
```

with `import { TEAM_PACK_FOLDER } from "../lib/team/team-pack-path.ts";` added.

- [ ] **Step 4: Run the six files to verify they pass**

Run: the same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/skills.ts commands/__tests__/
git commit -m "skills: the team-pack shape is mattstack/teams/<team>/plugin

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Requirements and the materialize step carry the remedy

**Files:**
- Modify: `lib/setup/requirements.ts:1-6,41`
- Modify: `lib/setup/skills-materialize.ts:136-140`
- Test: `lib/setup/__tests__/requirements.test.ts:67,107-108`, `lib/setup/__tests__/skills-materialize.test.ts:64,112,122,141`, `lib/setup/__tests__/materialize-world.ts:12-13,20,24`, `lib/setup/__tests__/steps-c.test.ts:440-510`, `lib/setup/__tests__/steps-b.test.ts:895`, `lib/setup/__tests__/apply.test.ts:1137`, `lib/setup/__tests__/pack.test.ts:205-206`

**Interfaces:**
- Consumes: `TEAM_PACK_FOLDER`, `isUnconvertedTeamPack`, `unconvertedTeamPackError`, `remedySentence` from Task 1.
- Produces: `readPackRequirements` returns `[{ pack, tools: [], integrations: [], error }]` for an unconverted folder; the materialize step's per-repo `detail` is `remedySentence(err)` for a `UserActionableError`.

- [ ] **Step 1: Re-point the fixtures and add the two tests**

Replace every `teams/<t>/packs/<t>` with `teams/<t>/plugin` in the eight test files above (`materialize-world.ts`: the `dirs` entry `[\`${org}/teams/widgets/packs\`]: ["widgets"]` becomes `[\`${org}/teams/widgets\`]: ["plugin", "settings.team.jsonc"]` and likewise for gadgets; the `files` keys become `${org}/teams/widgets/plugin/pack/skills.jsonc`). In `skills-materialize.test.ts` lines 112 and 122 the `rmSync(..., "teams", "widgets", "packs")` becomes `rmSync(..., "teams", "widgets", "plugin")`. In `pack.test.ts` lines 205-206 the sources become `./mattstack/teams/widgets/plugin` and `./mattstack/teams/gadgets/plugin`.

Add to `lib/setup/__tests__/requirements.test.ts` inside `describe("readPackRequirements")`:

```ts
  test("an unconverted team folder is one error entry naming the fix, never a throw", () => {
    const nested = `${root}/mattstack/teams/widgets/packs/widgets/requirements.jsonc`;
    const manifest = `${root}/mattstack/teams/widgets/packs/widgets/pack/skills.jsonc`;
    const p = fakeProbes({ home: "/fake-home", files: { [nested]: '{ "tools":[], "integrations":[] }', [manifest]: "{}" } });
    expect(readPackRequirements(p, "acme")).toEqual([{
      pack: "widgets",
      tools: [],
      integrations: [],
      error: `Your org repo still keeps the widgets pack at mattstack/teams/widgets/packs/widgets. Run bun scripts/move-team-packs-to-plugin.ts ${root} --admin <username> --write, then rt setup update`,
    }]);
  });
```

(`root` in that describe is `/fake-home/.mattstack/orgs/acme`; the fake probes already resolve the active team to `widgets` in the first test, so the same seeding applies.)

Add to `lib/setup/__tests__/skills-materialize.test.ts`, beside `"a declaring zone that holds no pack is noManifest, not a success"`:

```ts
  test("an unconverted team folder fails the repo with the conversion remedy in its detail", async () => {
    seedRepo("https://gitlab.example.com/acme/widgets.git");
    seedZone();
    const teamDir = join(home, ".mattstack", "orgs", "acme", "mattstack", "teams", "widgets");
    rmSync(join(teamDir, "plugin"), { recursive: true });
    write(join(teamDir, "packs", "widgets", "pack", "skills.jsonc"), "{}");
    const p = { ...createRealProbes(), env: { ...process.env, RT_ENGINE_PACK_DIR: engine() } };
    const result = await materializeSkills(p, {});
    if (result.skipped) throw new Error("skipped");
    expect(result.repos[0]).toMatchObject({ ok: false });
    expect(result.repos[0]!.detail).toContain("Run bun scripts/move-team-packs-to-plugin.ts");
    expect(result.repos[0]!.detail).toContain(", then rt setup update");
  });
```

- [ ] **Step 2: Run the files to verify they fail**

Run: `bun test lib/setup/__tests__/requirements.test.ts lib/setup/__tests__/skills-materialize.test.ts lib/setup/__tests__/steps-c.test.ts lib/setup/__tests__/steps-b.test.ts lib/setup/__tests__/apply.test.ts lib/setup/__tests__/pack.test.ts`
Expected: FAIL: requirements reads nothing at `plugin/`; the unconverted test gets `[]`; the materialize detail lacks the remedy.

- [ ] **Step 3: Change the two modules**

`lib/setup/requirements.ts` header and reader:

```ts
/**
 * Pack requirements reader: parses the active team's pack requirements at
 * orgs/<org>/mattstack/teams/<team>/plugin/requirements.jsonc, the only
 * pack this Mac installs, so `rt setup` can fold pack-declared
 * tools/integrations into the plan.
 */
```

and

```ts
import { TEAM_PACK_FOLDER, isUnconvertedTeamPack, remedySentence, unconvertedTeamPackError } from "../team/team-pack-path.ts";
...
export function readPackRequirements(p: Pick<Probes, "readDir" | "readFile" | "exists" | "home">, org: string, team: string | null = activeTeamFor(p, org).team): PackRequirements[] {
  if (team === null) return [];
  const orgDir = orgDirUnder(p.home, org);
  const teamFolder = join(orgDir, "mattstack", "teams", team);
  // A throw here would fail the whole plan before any row draws, so the reader reports through `error`.
  if (isUnconvertedTeamPack(p, teamFolder, team)) {
    return [{ pack: team, tools: [], integrations: [], error: remedySentence(unconvertedTeamPackError(orgDir, team)) }];
  }
  const file = join(teamFolder, TEAM_PACK_FOLDER, REQUIREMENTS_FILE);
  if (!p.exists(file)) return [];
```

(the rest of the function is unchanged).

`lib/setup/skills-materialize.ts` per-repo catch:

```ts
    } catch (err) {
      repos.push({ ...target, ok: false, detail: err instanceof UserActionableError ? remedySentence(err) : err instanceof Error ? err.message : String(err) });
      continue;
    }
```

with `import { remedySentence } from "../team/team-pack-path.ts";` added (`UserActionableError` is already imported).

- [ ] **Step 4: Run the files to verify they pass**

Run: the same command as Step 2, plus `bun test lib/setup/__tests__/validators-tools.test.ts`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/requirements.ts lib/setup/skills-materialize.ts lib/setup/__tests__/
git commit -m "setup: requirements read plugin/ and both readers carry the conversion remedy

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `rt team add` scaffolds the pack at `plugin/`

**Files:**
- Modify: `lib/team/add.ts:63,90`
- Test: `lib/team/__tests__/add.test.ts:26,47,113,137,155,157,177`, `lib/team/__tests__/share-pack.test.ts` (the `packs/` lines), `commands/__tests__/team.test.ts:841-1010`, `commands/__tests__/onboarding-org.test.ts:208-215`

**Interfaces:**
- Consumes: `TEAM_PACK_FOLDER`, `teamPackSource` from Task 1.

- [ ] **Step 1: Re-point the fixtures**

In the four test files replace every `teams/<t>/packs/<t>` with `teams/<t>/plugin` (paths and marketplace sources). `onboarding-org.test.ts` line 215 becomes:

```ts
    plugins: ["widgets", "gadgets"].map((team) => ({ name: team, source: `./mattstack/teams/${team}/plugin` })),
```

Recipe, then review by eye:

```bash
sed -i '' -E 's#teams/(widgets|gadgets|acme)/packs/\1#teams/\1/plugin#g; s#teams/\$\{team\}/packs/\$\{team\}#teams/${team}/plugin#g' lib/team/__tests__/add.test.ts lib/team/__tests__/share-pack.test.ts commands/__tests__/team.test.ts commands/__tests__/onboarding-org.test.ts
```

- [ ] **Step 2: Run the four files to verify they fail**

Run: `bun test lib/team/__tests__/add.test.ts lib/team/__tests__/share-pack.test.ts commands/__tests__/team.test.ts commands/__tests__/onboarding-org.test.ts`
Expected: FAIL: `rt team add` still writes `packs/<team>/` and the old source.

- [ ] **Step 3: Change `add.ts`**

Add `import { TEAM_PACK_FOLDER, teamPackSource } from "./team-pack-path.ts";`. Line 63 becomes `const source = teamPackSource(team);`. Line 90 becomes `const packDir = join(dir, TEAM_PACK_FOLDER);`.

- [ ] **Step 4: Run the four files to verify they pass**

Run: the same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/team/add.ts lib/team/__tests__/ commands/__tests__/team.test.ts commands/__tests__/onboarding-org.test.ts
git commit -m "team: rt team add scaffolds the pack at plugin/

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The snapshot's janitor-only zone is `plugin/`

**Files:**
- Modify: `lib/daemon/home-snapshot.ts:397`
- Test: `lib/daemon/__tests__/home-snapshot.test.ts:2167,2181,2273,2308,2338-2348,2380,2446,2478,2511,2522,2531,2541`

**Interfaces:**
- Consumes: `TEAM_PACK_FOLDER` from Task 1.
- Produces: `claimedZones` lists `mattstack/teams/<team>/plugin/`.

- [ ] **Step 1: Re-point the fixture**

In `lib/daemon/__tests__/home-snapshot.test.ts`:

```bash
sed -i '' -E 's#mattstack/teams/(widgets|gadgets)/packs/\1#mattstack/teams/\1/plugin#g; s#mattstack/teams/(widgets|gadgets)/packs/#mattstack/teams/\1/plugin/#g' lib/daemon/__tests__/home-snapshot.test.ts
```

Review the diff: `WIDGETS_PACK` is now `"mattstack/teams/widgets/plugin/"`, `GADGETS` is `"mattstack/teams/gadgets/plugin"`, the `firstSeenDirty` key `"mattstack/teams/gadgets/plugin/"`, every `?? mattstack/teams/<t>/plugin/...` status line, and the janitor commit's `:(literal)mattstack/teams/widgets/plugin/skills/x/SKILL.md`. The `settings.team.jsonc` lines are untouched.

- [ ] **Step 2: Run the test file to verify it fails**

Run: `bun test lib/daemon/__tests__/home-snapshot.test.ts`
Expected: FAIL on `claimedZones` (still `.../packs/`) and the janitor commit paths.

- [ ] **Step 3: Change the zone**

`lib/daemon/home-snapshot.ts` line 397 becomes:

```ts
  const zones = [...legacy, "mattstack/org/packs/", ...teams.map((team) => `${teamPackRel(team)}/`)];
```

with `import { teamPackRel } from "../team/team-pack-path.ts";` added. The doc comment above the function that says "its packs get no zone" keeps its words.

- [ ] **Step 4: Run the test file to verify it passes**

Run: `bun test lib/daemon/__tests__/home-snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/home-snapshot.ts lib/daemon/__tests__/home-snapshot.test.ts
git commit -m "daemon: the team pack's janitor-only zone is mattstack/teams/<team>/plugin/

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: The conversion script moves `packs/<team>/` to `plugin/`

**Files:**
- Create: `scripts/lib/move-team-packs.ts` (planner)
- Create: `scripts/move-team-packs-to-plugin.ts` (wrapper)
- Create: `scripts/__tests__/move-team-packs.test.ts`
- Delete: `scripts/lib/convert-team-repo.ts`, `scripts/convert-team-repo-to-org.ts`, `scripts/__tests__/convert-team-repo.test.ts`
- Modify: `lib/__tests__/no-settings-bypass.test.ts:66-67`

**Interfaces:**
- Consumes: `nestedTeamPackRel`, `teamPackRel`, `teamPackSource` from Task 1.
- Produces:

```ts
export interface MoveInput {
  /** Repo-relative text of: the marker, the marketplace, the org store, every team store, and every nested pack's plugin.json and pack/skills.jsonc. Absent files are absent keys. */
  files: Record<string, string>;
  /** Folder names under mattstack/teams/. */
  teams: string[];
  /** Per team: the folder names under mattstack/teams/<team>/packs/ (absent or [] when there is no packs/). */
  nested: Record<string, string[]>;
  /** Per team: whether mattstack/teams/<team>/plugin exists. */
  hasPlugin: Record<string, boolean>;
}
export interface MovePlan {
  moves: [from: string, to: string][];
  writes: Record<string, string>;
  report: string[];
}
export function planMove(input: MoveInput): MovePlan;
```

- [ ] **Step 1: Write the planner test**

```ts
// scripts/__tests__/move-team-packs.test.ts (planner half; the wrapper half is Step 6)
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { parse } from "jsonc-parser";
import { machineSettingsPath } from "../../lib/rt-paths.ts";
import { childEnv } from "../../lib/subprocess.ts";
import { planMove, type MoveInput } from "../lib/move-team-packs.ts";

const ORG_STORE = "mattstack/org/settings.org.jsonc";
const WIDGETS_STORE = "mattstack/teams/widgets/settings.team.jsonc";
const NESTED = "mattstack/teams/widgets/packs/widgets";
const MOVED = "mattstack/teams/widgets/plugin";

function orgRepo(overrides: Partial<MoveInput> = {}): MoveInput {
  return {
    teams: ["gadgets", "widgets"],
    nested: { widgets: ["widgets"] },
    hasPlugin: { widgets: false, gadgets: false },
    files: {
      "mattstack/mattstack.jsonc": JSON.stringify({ role: "org", org: "acme" }),
      ".claude-plugin/marketplace.json": JSON.stringify({ name: "acme", owner: { name: "Acme" }, plugins: [
        { name: "widgets", source: "./mattstack/teams/widgets/packs/widgets", description: "d" },
        { name: "widgets-extra", source: "./mattstack/teams/widgets/packs/widgets-extra" },
      ] }, null, 2),
      [ORG_STORE]: JSON.stringify({
        "board.projects": ["acme/widgets"],
        repos: { "gitlab.example.com/acme/widgets": { "rt.roles": { dev: { hook: "${org}/mattstack/teams/widgets/packs/widgets/hooks/dev.sh" } } } },
      }),
      [WIDGETS_STORE]: JSON.stringify({ "board.title": "Widgets", "rt.endpoint": { script: "${team:acme}/mattstack/teams/widgets/packs/widgets/scripts/run.ts" } }),
      "mattstack/teams/gadgets/settings.team.jsonc": "{}",
      [`${NESTED}/.claude-plugin/plugin.json`]: JSON.stringify({ name: "widgets", version: "1.4.2", skills: "./skills/" }, null, 2),
      [`${NESTED}/pack/skills.jsonc`]: "{}",
      ...overrides.files,
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== "files")),
  };
}

describe("planMove", () => {
  test("moves each nested pack to plugin/, bumps its version and points the marketplace at it", () => {
    const plan = planMove(orgRepo());
    expect(plan.moves).toEqual([[NESTED, MOVED]]);
    expect(JSON.parse(plan.writes[`${MOVED}/.claude-plugin/plugin.json`]!)).toEqual({ name: "widgets", version: "1.4.3", skills: "./skills/" });
    expect(JSON.parse(plan.writes[".claude-plugin/marketplace.json"]!).plugins).toEqual([
      { name: "widgets", source: "./mattstack/teams/widgets/plugin", description: "d" },
      { name: "widgets-extra", source: "./mattstack/teams/widgets/packs/widgets-extra" },
    ]);
  });

  test("a marketplace entry that carries its own version gets the bumped version", () => {
    const market = JSON.stringify({ name: "acme", plugins: [{ name: "widgets", source: `./${NESTED}`, version: "1.4.2" }] });
    const plan = planMove(orgRepo({ files: { ".claude-plugin/marketplace.json": market } }));
    expect(JSON.parse(plan.writes[".claude-plugin/marketplace.json"]!).plugins[0]).toEqual({ name: "widgets", source: `./${MOVED}`, version: "1.4.3" });
  });

  test("rewrites stored values that spell the nested path under ${org} and ${team:}, and nothing else", () => {
    const plan = planMove(orgRepo());
    expect(parse(plan.writes[ORG_STORE]!).repos["gitlab.example.com/acme/widgets"]["rt.roles"].dev.hook).toBe("${org}/mattstack/teams/widgets/plugin/hooks/dev.sh");
    expect(parse(plan.writes[WIDGETS_STORE]!)["rt.endpoint"].script).toBe("${team:acme}/mattstack/teams/widgets/plugin/scripts/run.ts");
    expect(plan.writes["mattstack/teams/gadgets/settings.team.jsonc"]).toBeUndefined();
    expect(plan.report).toContain("rewrote ${org}/mattstack/teams/widgets/packs/widgets/hooks/dev.sh to ${org}/mattstack/teams/widgets/plugin/hooks/dev.sh");
  });

  test("a store with nothing to rewrite is not written, and comments in a rewritten store are reported", () => {
    const plan = planMove(orgRepo({ files: { [WIDGETS_STORE]: `// team\n${JSON.stringify({ x: "${org}/mattstack/teams/widgets/packs/widgets/a" })}` } }));
    expect(plan.writes[ORG_STORE]).toBeDefined();
    expect(plan.report).toContain(`comments in ${WIDGETS_STORE} are not carried over`);
  });

  test("the report names each move, bump and settings-only team", () => {
    const { report } = planMove(orgRepo());
    expect(report).toContain(`move ${NESTED} to ${MOVED}`);
    expect(report).toContain("widgets: version 1.4.2 to 1.4.3");
    expect(report).toContain("gadgets: no pack, left alone");
  });

  test("a repo that is not an org, or has nothing nested, is refused", () => {
    expect(() => planMove(orgRepo({ files: { "mattstack/mattstack.jsonc": JSON.stringify({ role: "team" }) } }))).toThrow("not a mattstack org repo");
    expect(() => planMove(orgRepo({ nested: {}, hasPlugin: { widgets: true, gadgets: false } }))).toThrow("nothing to move");
  });

  test("a team with both packs/<team> and plugin/, or a packs/ folder not named for the team, is refused", () => {
    expect(() => planMove(orgRepo({ hasPlugin: { widgets: true, gadgets: false } }))).toThrow("widgets has both");
    expect(() => planMove(orgRepo({ nested: { widgets: ["widgets", "other"] } }))).toThrow("packs/other");
  });

  test("a nested pack without a parseable plugin.json, or a store that does not parse, is refused by name", () => {
    expect(() => planMove(orgRepo({ files: { [`${NESTED}/.claude-plugin/plugin.json`]: "{ nope" } }))).toThrow(`${NESTED}/.claude-plugin/plugin.json`);
    expect(() => planMove(orgRepo({ files: { [ORG_STORE]: "{ nope" } }))).toThrow(ORG_STORE);
  });

  test("a version that is not x.y.z cannot be bumped", () => {
    expect(() => planMove(orgRepo({ files: { [`${NESTED}/.claude-plugin/plugin.json`]: JSON.stringify({ name: "widgets", version: "2" }) } }))).toThrow("not x.y.z");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test scripts/__tests__/move-team-packs.test.ts`
Expected: FAIL, cannot resolve `../lib/move-team-packs.ts`.

- [ ] **Step 3: Write the planner**

```ts
// scripts/lib/move-team-packs.ts
import { parse, parseTree, printParseErrorCode, visit, type Node, type ParseError } from "jsonc-parser";
import { nestedTeamPackRel, teamPackRel, teamPackSource } from "../../lib/team/team-pack-path.ts";

export interface MoveInput {
  files: Record<string, string>;
  teams: string[];
  nested: Record<string, string[]>;
  hasPlugin: Record<string, boolean>;
}

export interface MovePlan {
  moves: [from: string, to: string][];
  writes: Record<string, string>;
  report: string[];
}

type Json = Record<string, unknown>;

export const ORG_STORE_REL = "mattstack/org/settings.org.jsonc";
export const teamStoreRel = (team: string): string => `mattstack/teams/${team}/settings.team.jsonc`;

/** The file's object, `{}` when absent. A file that is there but does not parse stops the move: rewriting what could be read would lose the rest. */
function objOf(files: Record<string, string>, rel: string): Json {
  const text = files[rel];
  if (text === undefined) return {};
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) throw new Error(`${rel} is not valid JSONC (${printParseErrorCode(errors[0]!.error)} at offset ${errors[0]!.offset}); fix it before moving`);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${rel} is not a JSON object; fix it before moving`);
  const check = (node: Node): void => {
    if (node.type === "object") {
      const seen = new Set<string>();
      for (const property of node.children ?? []) {
        const key = String(property.children?.[0]?.value);
        if (seen.has(key)) throw new Error(`${rel} has a duplicate key ${key}; fix it before moving`);
        seen.add(key);
      }
    }
    for (const child of node.children ?? []) check(child);
  };
  check(parseTree(text)!);
  return value as Json;
}

function hasComments(text: string): boolean {
  let found = false;
  visit(text, { onComment: () => { found = true; } });
  return found;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bumpPatch(team: string, version: unknown): string {
  const m = typeof version === "string" ? /^(\d+)\.(\d+)\.(\d+)$/.exec(version) : null;
  if (!m) throw new Error(`The ${team} pack's version (${String(version)}) is not x.y.z, so the script cannot bump it`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

function rewritePaths(value: unknown, swaps: [string, string][], note: (from: string, to: string) => void): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const [from, to] of swaps) {
      // A folder name, not a prefix: `packs/widgets` must not match inside `packs/widgets-extra`.
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

export function planMove(input: MoveInput): MovePlan {
  const marker = objOf(input.files, "mattstack/mattstack.jsonc");
  if (marker.role !== "org") throw new Error("This is not a mattstack org repo (mattstack/mattstack.jsonc does not say role: org)");
  const report: string[] = [];
  const moving: string[] = [];
  for (const team of [...input.teams].sort()) {
    const nested = input.nested[team] ?? [];
    if (nested.length === 0) {
      report.push(`${team}: no pack, left alone`);
      continue;
    }
    const strangers = nested.filter((name) => name !== team);
    if (strangers.length > 0) throw new Error(`${team} has ${strangers.map((name) => `packs/${name}`).join(", ")}, which the script does not know how to place; a team's pack is named after the team`);
    if (input.hasPlugin[team]) throw new Error(`${team} has both ${nestedTeamPackRel(team)} and ${teamPackRel(team)}; keep one before moving`);
    objOf(input.files, `${nestedTeamPackRel(team)}/.claude-plugin/plugin.json`);
    moving.push(team);
  }
  if (moving.length === 0) throw new Error("Every team's pack is already at plugin/ (or there is none): nothing to move");

  const moves: [string, string][] = [];
  const writes: Record<string, string> = {};
  const swaps: [string, string][] = [];
  const versions = new Map<string, string>();
  for (const team of moving) {
    const from = nestedTeamPackRel(team);
    const to = teamPackRel(team);
    moves.push([from, to]);
    report.push(`move ${from} to ${to}`);
    const manifest = objOf(input.files, `${from}/.claude-plugin/plugin.json`);
    const version = bumpPatch(team, manifest.version);
    versions.set(team, version);
    report.push(`${team}: version ${String(manifest.version)} to ${version}`);
    writes[`${to}/.claude-plugin/plugin.json`] = `${JSON.stringify({ ...manifest, version }, null, 2)}\n`;
    swaps.push([`/${from}`, `/${to}`]);
  }

  const noteRewrite = (before: string, after: string) => report.push(`rewrote ${before} to ${after}`);
  for (const rel of [ORG_STORE_REL, ...input.teams.map(teamStoreRel)]) {
    if (input.files[rel] === undefined) continue;
    const before = objOf(input.files, rel);
    const after = rewritePaths(before, swaps, noteRewrite) as Json;
    if (JSON.stringify(after) === JSON.stringify(before)) continue;
    const header = input.files[rel]!.startsWith("//") ? `${input.files[rel]!.split("\n")[0]}\n` : "";
    writes[rel] = `${header}${JSON.stringify(after, null, 2)}\n`;
    if (hasComments(input.files[rel]!)) report.push(`comments in ${rel} are not carried over`);
  }

  const market = objOf(input.files, ".claude-plugin/marketplace.json");
  const plugins = (Array.isArray(market.plugins) ? (market.plugins as Json[]) : []).map((entry) => {
    const team = typeof entry.name === "string" && versions.has(entry.name) ? entry.name : null;
    if (team === null) return entry;
    return { ...entry, source: teamPackSource(team), ...(entry.version !== undefined ? { version: versions.get(team) } : {}) };
  });
  writes[".claude-plugin/marketplace.json"] = `${JSON.stringify({ ...market, plugins }, null, 2)}\n`;

  return { moves, writes, report };
}
```

Note on the `header`: the test for comments writes a `// team` first line and expects the comment report; the planner keeps a leading `//` header line (the store headers `rt team add` writes) and drops every other comment, reporting it, as the old planner did.

- [ ] **Step 4: Run the planner tests to verify they pass**

Run: `bun test scripts/__tests__/move-team-packs.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the wrapper**

```ts
#!/usr/bin/env bun
// scripts/move-team-packs-to-plugin.ts
import { execFileSync } from "child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { UserActionableError, failureFor, logFailureDetail } from "../lib/errors.ts";
import { shellQuote } from "../lib/herdr-launch.ts";
import { getSetting } from "../lib/settings/resolve.ts";
import { childEnv } from "../lib/subprocess.ts";
import { nestedTeamPackRel, teamPackRel } from "../lib/team/team-pack-path.ts";
import * as out from "../lib/ui/out.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { readForgeUsername, sameUser } from "../packages/rt-client/src/index.ts";
import { ORG_STORE_REL, planMove, teamStoreRel, type MoveInput } from "./lib/move-team-packs.ts";

const USAGE = "bun scripts/move-team-packs-to-plugin.ts <clone-dir> --admin <username> [--write]";

function refuse(title: string, why?: string, next?: string | string[]): never {
  const commands = next === undefined ? [] : Array.isArray(next) ? next : [next];
  out.note(out.line("refused", title), ...(why ? [out.callout("why", why)] : []), ...(commands.length ? [out.callout("next", ...commands.map(out.cmd))] : []));
  process.exit(2);
}

function main(): void {
  const args = process.argv.slice(2);
  const cloneArg = args.shift();
  if (!cloneArg || cloneArg.startsWith("--")) {
    out.fail(usageFailure("Name the org clone whose team packs you want to move", USAGE));
    process.exit(2);
  }
  let admin: string | undefined;
  let write = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--write") write = true;
    else if (arg === "--admin" && args[i + 1] && !args[i + 1]!.startsWith("--") && admin === undefined) admin = args[++i]!;
    else {
      out.fail(usageFailure("Check the arguments", USAGE));
      process.exit(2);
    }
  }
  if (!admin) {
    out.fail(usageFailure("Name the org admin who will publish the move", USAGE));
    process.exit(2);
  }
  const clone = resolve(cloneArg);
  const git = (...argv: string[]) => execFileSync("git", ["-C", clone, ...argv], { encoding: "utf8", env: childEnv(), stdio: "pipe" });
  if (resolve(git("rev-parse", "--show-toplevel").trim()) !== clone) throw new UserActionableError("not-clone-root", "Choose the root of the clone");
  const assertNoLink = (rel: string): void => {
    let path = clone;
    for (const part of rel.split("/")) {
      path = join(path, part);
      let stat;
      try { stat = lstatSync(path); } catch (err) {
        if (["ENOENT", "ENOTDIR"].includes((err as NodeJS.ErrnoException).code ?? "")) break;
        throw err;
      }
      if (stat.isSymbolicLink()) refuse("The move paths contain a symbolic link", "Use ordinary files and folders so the move stays inside this clone.");
    }
  };
  const read = (rel: string) => {
    assertNoLink(rel);
    return existsSync(join(clone, rel)) ? readFileSync(join(clone, rel), "utf8") : undefined;
  };
  const dirs = (rel: string) => {
    assertNoLink(rel);
    return existsSync(join(clone, rel)) ? readdirSync(join(clone, rel), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : [];
  };
  const teams = dirs("mattstack/teams");
  const input: MoveInput = { files: {}, teams, nested: {}, hasPlugin: {} };
  const wanted = ["mattstack/mattstack.jsonc", ".claude-plugin/marketplace.json", ORG_STORE_REL, ...teams.map(teamStoreRel)];
  for (const team of teams) {
    input.nested[team] = dirs(`mattstack/teams/${team}/packs`);
    input.hasPlugin[team] = existsSync(join(clone, teamPackRel(team)));
    if (input.nested[team]!.includes(team)) wanted.push(`${nestedTeamPackRel(team)}/.claude-plugin/plugin.json`, `${nestedTeamPackRel(team)}/pack/skills.jsonc`);
  }
  for (const rel of wanted) {
    const text = read(rel);
    if (text !== undefined) input.files[rel] = text;
  }
  let plan;
  try {
    plan = planMove(input);
  } catch (err) {
    throw new UserActionableError("invalid-move", "This clone's team packs cannot be moved", {}, { why: err instanceof Error ? err.message : String(err) });
  }
  for (const rel of [...plan.moves.flat(), ...Object.keys(plan.writes)]) assertNoLink(rel);
  out.print(out.section("Move plan", undefined, ...plan.report.map((line) => out.paragraph(line))), out.section("Moves", undefined, out.table(plan.moves.map(([from, to]) => [from, to]))));
  if (!write) {
    out.print(out.line("off", "Nothing was written", "Review the plan, then run again with --write"), out.callout("next", out.cmd(USAGE)));
    return;
  }
  if (getSetting<{ enabled?: boolean }>("rt.teamSnapshot").value?.enabled !== false) {
    refuse("Team sync is on for this Mac", "It could push the move before you review it. Turn sync off, restart the daemon, and turn it back on after you publish.", ["rt settings set rt.teamSnapshot '{\"enabled\": false}' --scope machine", "rt daemon restart"]);
  }
  const recorded = readForgeUsername(basename(clone));
  if (recorded === null || !sameUser(recorded, admin)) {
    refuse(recorded === null ? "This Mac has no recorded forge username" : `This Mac is recorded as ${recorded}`, `The recorded username must match ${admin} so you can publish as this org's admin.`, recorded === null ? "rt setup apply --only team.identity" : USAGE);
  }
  if (git("status", "--porcelain", "--untracked-files=all").trim() !== "") refuse("The clone has uncommitted changes", "Commit or discard them before moving.");
  if (git("status", "--porcelain", "--untracked-files=all", "--ignored", "--", "mattstack", ".claude-plugin").trim() !== "") refuse("The clone has ignored files in its managed folders", "Move them aside before moving so a failed move can restore the clean start.");
  let branch: string | null;
  try {
    branch = git("symbolic-ref", "-q", "--short", "HEAD").trim() || null;
  } catch {
    branch = null;
  }
  if (branch === null) refuse("The clone has no branch checked out", "The move commits to the branch you are on, and rt publishes that branch.", `git -C ${shellQuote(clone)} switch main`);
  const quoted = shellQuote(clone);
  const newTargets = new Set([...plan.moves.map(([, to]) => to), ...Object.keys(plan.writes).filter((rel) => input.files[rel] === undefined && !plan.moves.some(([, to]) => rel.startsWith(`${to}/`)))]);
  const createdRoots = new Set<string>();
  const existingDirectories = new Set<string>();
  for (const rel of [...plan.moves.map(([, to]) => to), ...Object.keys(plan.writes)]) {
    if (newTargets.has(rel) && existsSync(join(clone, rel))) refuse("A move destination already exists", "Move the existing destination aside before moving so its content is preserved.");
    const parts = rel.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const path = join(clone, ...parts.slice(0, i));
      if (!existsSync(path)) {
        // Only an absent path can be removed on rollback, including ignored output.
        createdRoots.add(path);
        break;
      }
      if (i < parts.length) {
        if (!lstatSync(path).isDirectory()) refuse("A file blocks a move destination", "Move it aside before moving so its content is preserved.");
        existingDirectories.add(path);
      }
    }
  }
  const rememberDirectories = (path: string): void => {
    if (!lstatSync(path).isDirectory()) return;
    existingDirectories.add(path);
    for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) rememberDirectories(join(path, entry.name));
  };
  for (const [from] of plan.moves) rememberDirectories(join(clone, from));
  try {
    execFileSync("git", ["-C", clone, "fetch", "-q", "origin"], { encoding: "utf8", env: { ...childEnv(), GIT_TERMINAL_PROMPT: "0" }, stdio: "pipe" });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr;
    throw new UserActionableError("fetch-failed", "Could not fetch origin to check that the clone is current", {}, { next: `git -C ${quoted} fetch origin`, log: stderr || (err instanceof Error ? err.message : String(err)) });
  }
  let originBranch: string;
  try {
    originBranch = git("rev-parse", "--verify", "-q", `refs/remotes/origin/${branch}`).trim();
  } catch {
    refuse(`Origin has no ${branch} branch`, "rt publishes the branch you are on, so origin needs it before moving. Push it once.", `git -C ${quoted} push -u origin ${shellQuote(branch)}`);
  }
  const [ahead, behind] = git("rev-list", "--left-right", "--count", `HEAD...${originBranch}`).trim().split(/\s+/).map(Number);
  if (ahead === 0 && behind! > 0) refuse("The clone is behind origin", `Origin has ${behind} commit${behind === 1 ? "" : "s"} this clone does not. Moving now would leave them out, and the publish would be refused.`, `git -C ${quoted} pull --ff-only`);
  if (ahead! > 0) refuse("The clone has commits origin does not have", "Publish or drop them first, so the move is the only change you publish.", `git -C ${quoted} log --oneline ${shellQuote(`origin/${branch}..HEAD`)}`);
  const start = git("rev-parse", "HEAD").trim();
  try {
    for (const [from, to] of plan.moves) {
      mkdirSync(dirname(join(clone, to)), { recursive: true });
      git("mv", "--", from, to);
    }
    for (const [rel, text] of Object.entries(plan.writes)) {
      mkdirSync(dirname(join(clone, rel)), { recursive: true });
      writeFileSync(join(clone, rel), text);
    }
    git("add", "--", ...Object.keys(plan.writes));
    git("commit", "-q", "-m", "org: move team packs to plugin/");
  } catch (err) {
    git("reset", "-q", "--hard", start);
    for (const path of createdRoots) rmSync(path, { recursive: true, force: true });
    // Git restores tracked files, but can prune their preexisting empty parents.
    for (const path of existingDirectories) mkdirSync(path, { recursive: true });
    throw new UserActionableError("move-stopped", "The move stopped partway, and the clone is back as it was", {}, { log: err instanceof Error ? err.message : String(err) });
  }
  out.print(out.line("done", "Moved this clone's team packs in one commit", "Review the commit before publishing, then turn team sync back on"), out.callout("next", out.cmd("git show"), out.cmd("rt team publish")));
}

try {
  main();
} catch (err) {
  const failure = err instanceof UserActionableError ? err : new UserActionableError("move-failed", "The move could not continue", {}, { log: err instanceof Error ? err.message : String(err) });
  logFailureDetail(failure);
  out.fail(failureFor(failure));
  process.exit(1);
}
```

The `newTargets` set excludes the moved pack's own `plugin.json` write, which lands inside the moved folder after `git mv` and so exists at write time by design.

- [ ] **Step 6: Add the wrapper tests**

Append to `scripts/__tests__/move-team-packs.test.ts`, re-using the harness shape from the old test file (temp HOME, `teamSyncOff`, `recordedAs`, `tempClone` that writes `orgRepo().files` plus the nested pack's extra files, inits git with a bare origin, `publish`, `snapshot`):

```ts
describe("the wrapper", () => {
  const origHome = process.env.HOME;
  let home: string;
  let cloneCount = 0;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-move-home-")));
    process.env.HOME = home;
  });
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });
  function teamSyncOff(): void {
    mkdirSync(dirname(machineSettingsPath()), { recursive: true });
    writeFileSync(machineSettingsPath(), JSON.stringify({ "rt.teamSnapshot": { enabled: false } }));
  }
  function recordedAs(username: string): void {
    const file = join(home, ".mattstack", "rt", "teams", "acme.json");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ forgeUsername: username }));
  }
  function ready(): void {
    teamSyncOff();
    recordedAs("dev1");
  }
  function tempClone(extra: Record<string, string> = {}): string {
    const dir = join(home, `clone-${cloneCount++}`, "acme");
    const files = { ...orgRepo().files, [`${NESTED}/skills/work/SKILL.md`]: "# work\n", [`${NESTED}/attachments/.keep`]: "", ...extra };
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    const git = (...argv: string[]) => execFileSync("git", ["-C", dir, ...argv], { env: { ...childEnv(), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
    git("init", "-q", "-b", "main");
    git("config", "user.name", "t");
    git("config", "user.email", "t@example.com");
    git("add", "--", ".");
    git("commit", "-q", "-m", "nested layout");
    const origin = join(dirname(dir), "origin.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env: childEnv() });
    git("remote", "add", "origin", origin);
    git("push", "-q", "origin", "main");
    return dir;
  }
  const script = join(import.meta.dir, "..", "move-team-packs-to-plugin.ts");
  const runScript = (dir: string, ...extra: string[]) => Bun.spawnSync(["bun", script, dir, "--admin", "dev1", ...extra], { env: childEnv(), stdout: "pipe", stderr: "pipe" });
  function snapshot(dir: string): string {
    const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: childEnv() });
    const files: string[][] = [];
    const walk = (parent: string): void => {
      for (const name of readdirSync(join(dir, parent)).sort()) {
        if (parent === "" && name === ".git") continue;
        const rel = parent ? `${parent}/${name}` : name;
        const stat = lstatSync(join(dir, rel));
        if (stat.isSymbolicLink()) files.push([rel, "link", readlinkSync(join(dir, rel))]);
        else if (stat.isDirectory()) {
          files.push([rel, "directory"]);
          walk(rel);
        } else files.push([rel, "file", readFileSync(join(dir, rel), "base64")]);
      }
    };
    walk("");
    return JSON.stringify({ head: git("rev-parse", "HEAD"), index: git("ls-files", "-s"), status: git("status", "--porcelain", "--ignored"), files });
  }

  test("--write moves the pack, bumps the version, rewrites the stores and the marketplace, and commits once", () => {
    ready();
    const dir = tempClone();
    const result = runScript(dir, "--write");
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(dir, MOVED, "skills", "work", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, "mattstack", "teams", "widgets", "packs"))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, MOVED, ".claude-plugin", "plugin.json"), "utf8")).version).toBe("1.4.3");
    expect(JSON.parse(readFileSync(join(dir, ".claude-plugin", "marketplace.json"), "utf8")).plugins[0].source).toBe(`./${MOVED}`);
    expect(parse(readFileSync(join(dir, ORG_STORE), "utf8")).repos["gitlab.example.com/acme/widgets"]["rt.roles"].dev.hook).toBe("${org}/mattstack/teams/widgets/plugin/hooks/dev.sh");
    const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: childEnv() });
    expect(git("log", "--format=%s", "-1").trim()).toBe("org: move team packs to plugin/");
    expect(git("rev-list", "--count", "origin/main..HEAD").trim()).toBe("1");
    expect(git("status", "--porcelain").trim()).toBe("");
  });

  test("without --write it prints the plan and changes nothing", () => {
    ready();
    const dir = tempClone();
    const before = snapshot(dir);
    const result = runScript(dir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain(`move ${NESTED} to ${MOVED}`);
    expect(snapshot(dir)).toBe(before);
  });

  test("--write refuses while team sync is on, says how to turn it off, and changes nothing", () => {
    recordedAs("dev1");
    const dir = tempClone();
    const before = snapshot(dir);
    const result = runScript(dir, "--write");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("Team sync is on");
    expect(result.stderr.toString()).toContain("rt.teamSnapshot");
    expect(snapshot(dir)).toBe(before);
  });

  test("--write refuses on a Mac not recorded as the admin", () => {
    teamSyncOff();
    recordedAs("dev2");
    const dir = tempClone();
    const before = snapshot(dir);
    const result = runScript(dir, "--write");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("recorded as dev2");
    expect(snapshot(dir)).toBe(before);
  });

  test("an existing plugin/ destination is refused before changing anything", () => {
    ready();
    const dir = tempClone({ [`${MOVED}/.keep`]: "keep these original bytes" });
    const before = snapshot(dir);
    const result = runScript(dir, "--write");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("has both");
    expect(snapshot(dir)).toBe(before);
  });

  test("a symlink on a move path is refused before anything is read through it", () => {
    ready();
    const dir = tempClone();
    const packs = join(dir, "mattstack", "teams", "widgets", "packs");
    const outside = join(home, "outside");
    // The whole packs/ folder moves outside the clone and a link takes its place, so every read of the nested pack would cross it.
    execFileSync("mv", [packs, outside]);
    symlinkSync(outside, packs);
    execFileSync("git", ["-C", dir, "add", "-A"], { env: childEnv() });
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "link"], { env: { ...childEnv(), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
    execFileSync("git", ["-C", dir, "push", "-q", "origin", "main"], { env: childEnv() });
    const before = snapshot(dir);
    const outsideBefore = readdirSync(join(outside, "widgets")).sort();
    const result = runScript(dir, "--write");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("symbolic link");
    expect(snapshot(dir)).toBe(before);
    expect(readdirSync(join(outside, "widgets")).sort()).toEqual(outsideBefore);
    expect(existsSync(join(dir, MOVED))).toBe(false);
  });

  test("a clone with uncommitted changes, or one behind origin, is refused and left alone", () => {
    ready();
    const dir = tempClone();
    writeFileSync(join(dir, "mattstack", "teams", "gadgets", "settings.team.jsonc"), "{ \"x\": 1 }");
    let before = snapshot(dir);
    let result = runScript(dir, "--write");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("uncommitted changes");
    expect(snapshot(dir)).toBe(before);
    execFileSync("git", ["-C", dir, "checkout", "--", "."], { env: childEnv() });
    const other = join(home, "other");
    execFileSync("git", ["clone", "-q", join(dirname(dir), "origin.git"), other], { env: childEnv() });
    writeFileSync(join(other, "README.md"), "x");
    execFileSync("git", ["-C", other, "add", "README.md"], { env: childEnv() });
    execFileSync("git", ["-C", other, "commit", "-q", "-m", "ahead"], { env: { ...childEnv(), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
    execFileSync("git", ["-C", other, "push", "-q", "origin", "main"], { env: childEnv() });
    before = snapshot(dir);
    result = runScript(dir, "--write");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("behind origin");
    expect(snapshot(dir)).toBe(before);
  });

  test("a commit failure restores the start: bytes, index, history and empty folders", () => {
    ready();
    const dir = tempClone();
    const before = snapshot(dir);
    const hooks = join(dir, ".git", "hooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const result = runScript(dir, "--write");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("back as it was");
    expect(snapshot(dir)).toBe(before);
    expect(existsSync(join(dir, NESTED, "attachments"))).toBe(true);
  });
});
```

- [ ] **Step 7: Delete the old files, re-point the bypass guard, run the tests**

```bash
git rm -q scripts/lib/convert-team-repo.ts scripts/convert-team-repo-to-org.ts scripts/__tests__/convert-team-repo.test.ts
```

In `lib/__tests__/no-settings-bypass.test.ts` replace lines 66-67 with:

```ts
    "scripts/lib/move-team-packs.ts": { count: 2, reason: "plans the one-off move of each team pack to plugin/; it rewrites the org and team stores' path values by name, never through the resolver" },
    "scripts/move-team-packs-to-plugin.ts": { count: 1, reason: "reads the explicit org clone's stores as files for the move planner" },
```

Run: `bun test lib/__tests__/no-settings-bypass.test.ts`. If the counts the guard reports differ (it prints the count it found), set the rows to the found counts; a count is the number of times that file's text matches a store-file pattern or names a per-rung reader, not a judgment.

Run: `bun test scripts/__tests__/move-team-packs.test.ts lib/__tests__/no-settings-bypass.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/move-team-packs.ts scripts/move-team-packs-to-plugin.ts scripts/__tests__/move-team-packs.test.ts lib/__tests__/no-settings-bypass.test.ts
git commit -m "scripts: move-team-packs-to-plugin moves each team pack from packs/<team>/ to plugin/

Replaces the legacy team-repo conversion, whose one input converted already.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Live docs and AGENTS.md

**Files:**
- Modify: `docs/home-repo.md:125-126`, `docs/settings-architecture.md:52`, `AGENTS.md` (the settings-architecture paragraph), `website/docs/start/teams.mdx:13`, `website/docs/skills/packs.mdx:93,95`, `apps/console/src/server/effectiveInputs.ts:220`

Load `rt:docs` before touching `website/docs/`.

- [ ] **Step 1: Edit each line**

`docs/home-repo.md` lines 125-126: `each \`mattstack/teams/<team>/packs/\`` becomes `each \`mattstack/teams/<team>/plugin/\``.

`docs/settings-architecture.md` line 52: `leaving the org's and each team's \`packs/\` folder to the janitor` becomes `leaving the org's \`packs/\` and each team's \`plugin/\` folder to the janitor`.

`AGENTS.md`: after the sentence ending `for the layout, selection and ownership rules.` in the settings paragraph, add:

```
A team's pack is its Claude plugin at `mattstack/teams/<team>/plugin/`
(`teamPackDir`, `lib/team/team-pack-path.ts`); the older
`mattstack/teams/<team>/packs/<team>/` is read by nothing but the
detector that names the conversion, and
`lib/__tests__/no-nested-team-pack.test.ts` keeps that spelling out of
source and live docs.
```

`website/docs/start/teams.mdx` line 13: `- \`mattstack/teams/<team>/\` holds one team's settings and its pack, under \`packs/<team>/\`.` becomes `- \`mattstack/teams/<team>/\` holds one team's settings and its pack, the team's Claude plugin, under \`plugin/\`.`

`website/docs/skills/packs.mdx` line 93: `.../teams/<team>/packs/<team>/` becomes `.../teams/<team>/plugin/`; line 95: `.../packs/<team>/attachments/<name>/` becomes `.../plugin/attachments/<name>/`.

`website/docs/skills/packs.mdx`, the board-only exception (PR #733 shipped it and no doc says so). In "Fills the whole org shares", the sentence `The base is never installed.` becomes:

```
The base is never installed, so a base fill reaches a team's verbs by being compiled in. One exception: a fill that only `board:*` slots bind is copied into the team pack as well, because the board opens a fill by `<plugin>:<name>` while it runs and compile never inlines a board slot; materialize then points those board bindings at `<team plugin>:<name>`.
```

In "Files the whole org shares", the "What is copied" bullet's parenthesis `(a fill's \`SKILL.md\` carries \`metadata.provides\`; compile inlines it instead)` becomes `(a fill's \`SKILL.md\` carries \`metadata.provides\`; compile inlines it instead, unless only \`board:*\` slots bind it, in which case it is copied too)`, and a new bullet follows it:

```
- **A board fill the base cannot deliver is refused:** compile stops when the base binds a `board:*` slot to a fill it has no `attachments/<name>/` for, or keeps that fill one group deep, since the board finds `attachments/<name>` only.
```

`apps/console/src/server/effectiveInputs.ts` line 220: `(orgs/<org>/mattstack/teams/<team>/packs/<team>)` becomes `(orgs/<org>/mattstack/teams/<team>/plugin)`.

- [ ] **Step 2: Check for leftovers in the live docs**

Run: `rg -n 'teams/[^/ ]+/packs/|packs/<team>' docs/*.md website/docs AGENTS.md apps/console/src`
Expected: no output.

Run: `rg -n 'board:\*' website/docs/skills/packs.mdx`
Expected: the two edited passages.

- [ ] **Step 3: Commit**

```bash
git add docs/home-repo.md docs/settings-architecture.md AGENTS.md website/docs/start/teams.mdx website/docs/skills/packs.mdx apps/console/src/server/effectiveInputs.ts
git commit -m "docs: the team pack lives at mattstack/teams/<team>/plugin/

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: The mattstack plugin's pack skills and docs

**Files:**
- Modify: `plugins/mattstack/README.md:375`, `plugins/mattstack/docs/your-first-pack.md:56-60,133,199`, `plugins/mattstack/plugin/skills/creating-a-pack/SKILL.md:13`, `plugins/mattstack/plugin/skills/extending-a-pack/SKILL.md:179-180`, `plugins/mattstack/plugin/skills/editing-skills/SKILL.md:32-33`, `plugins/mattstack/attachments/parameterized-skills/references/convention.md:338,345`, `plugins/mattstack/plugin/schemas/org-marker.schema.json:4`, `plugins/mattstack/.claude-plugin/plugin.json` (version), `plugins/mattstack/CERTIFICATION.md` (three rows)

Load `mattstack:editing-skills` and `superpowers:writing-skills` first; this task is a skill edit and follows their RED baseline, edit, GREEN, certify loop for each of the three skills.

- [ ] **Step 1: RED baseline**

For each of `creating-a-pack`, `extending-a-pack` and `editing-skills`, ask a fresh subagent (with the current skill text) one question: "In the acme org, where on disk is the widgets team's pack, and what is the marketplace entry's source?" For `extending-a-pack` also ask: "The acme-base pack binds `board:triage` to `acme-base:triage-rules` and nothing else binds that fill. After the widgets pack compiles, where does the fill live and what does the widgets bindings file point `board:triage` at?" Record that each answers `.../teams/widgets/packs/widgets` (the stale path), and that the board question gets "inlined only, never copied" (stale), in your notes for the certification rows.

- [ ] **Step 2: Edit every line**

Every `mattstack/teams/<t>/packs/<t>` and `.../packs/<t>/` becomes `mattstack/teams/<t>/plugin` and `.../plugin/`:

- `README.md:375`: `(\`mattstack/teams/<team>/plugin/\`, the team's Claude plugin)`.
- `your-first-pack.md:56-60`: the five tree lines start `mattstack/teams/widgets/plugin/`; line 133: `mattstack/teams/widgets/plugin/attachments/ship-lint/SKILL.md`; line 199: `~/.mattstack/orgs/<org>/mattstack/teams/<team>/plugin/`.
- `creating-a-pack/SKILL.md:13`: `~/.mattstack/orgs/acme/mattstack/teams/widgets/plugin/`.
- `extending-a-pack/SKILL.md:179-180`: `.../teams/widgets/plugin/skills/context/SKILL.md` and `.../plugin/attachments/<fill>/SKILL.md`.
- `editing-skills/SKILL.md:32`: `.../teams/widgets/plugin/skills/<name>/` and `.../plugin/attachments/<fill>/`; line 33: `.../plugin/.claude-plugin/plugin.json`.
- `convention.md:338`: `holding at most one pack, \`plugin/\` (the team's Claude plugin), named after the team:`; line 345: `with its source under \`mattstack/teams/<team>/plugin\``.
- `org-marker.schema.json:4`: `each holding at most one pack, at plugin/, named after the team.`

The board-only base-fill exception (PR #733) in the same files, where they say a base's fills are never copied:

- `extending-a-pack/SKILL.md:314-316`: the bullet ending `so its fills are always inlined into a team's compiled verbs.` becomes `so its fills are inlined into a team's compiled verbs. The one exception is a fill that only \`board:*\` slots bind: compile copies it into the team pack too, because the board opens a fill by \`<plugin>:<name>\` while it runs, and materialize points those board bindings at \`<team plugin>:<name>\`. Compile refuses a base that binds a board slot to a fill it has no \`attachments/<name>/\` for, or keeps that fill one group deep: the board finds \`attachments/<name>\` only.`
- `extending-a-pack/SKILL.md:338-340` ("Files the whole org shares", the first copy bullet): `and is not a fill (no \`metadata.provides\`)` becomes `and is not a fill (no \`metadata.provides\`), plus every fill that only \`board:*\` slots bind,`.
- `README.md:388`: `and is never installed: a team's compile inlines its fills.` becomes `and is never installed: a team's compile inlines its fills, except a fill only \`board:*\` slots bind, which it copies into the team pack for the board to open.`
- `your-first-pack.md:172-174`: the bullet ending `so its fills are always inlined into each team's compiled verbs.` becomes `so its fills are inlined into each team's compiled verbs (a fill only \`board:*\` slots bind is copied into the team pack as well, since the board opens it by name while it runs).`
- `convention.md:370`: `claims no repo, gets no file, and is never installed.` becomes `claims no repo, gets no file, and is never installed; a base fill only \`board:*\` slots bind is copied into the team pack at compile and its board bindings are rewritten to \`<team plugin>:<name>\` at materialize.`

Bump `plugins/mattstack/.claude-plugin/plugin.json` `version` from `0.30.20` to `0.30.21` (or the next patch if main has moved).

- [ ] **Step 3: GREEN and certify**

Re-ask the questions from Step 1 with the edited skills; each must answer `.../teams/widgets/plugin` and the source `./mattstack/teams/widgets/plugin`, and the board question must answer that the fill is copied to `plugin/attachments/triage-rules/` and the binding reads `widgets:triage-rules`. Then:

```bash
(cd plugins/mattstack && for d in plugin/skills/creating-a-pack/ plugin/skills/extending-a-pack/ plugin/skills/editing-skills/; do sh tests/certify.sh "$d"; done)
mkdir -p /tmp/rt-plugin-check && bun cli.ts skills check --pack-dir "$PWD/plugins/mattstack" --mattstack-dir /tmp/rt-plugin-check --strict
```

Expected: certify exit 0 for each, `skills check --strict` current.

Append three rows to `plugins/mattstack/CERTIFICATION.md` above the closing ledger note, in the table's format, dated today, one per skill, each ending with the RED and GREEN counts and `certify exit 0; skills check --strict exit 0`, naming the move of the team pack to `mattstack/teams/<team>/plugin/`.

- [ ] **Step 4: Check for leftovers**

Run: `rg -n 'teams/[^/ ]+/packs/|packs/<team>|packs/widgets' plugins/mattstack --glob '!CERTIFICATION.md'`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add plugins/mattstack
git commit -m "plugin: pack skills and docs name the team pack at mattstack/teams/<team>/plugin/ (0.30.21)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: The guard test

**Files:**
- Create: `lib/__tests__/no-nested-team-pack.test.ts`

- [ ] **Step 1: Write the guard**

```ts
// lib/__tests__/no-nested-team-pack.test.ts
/**
 * A team's pack is mattstack/teams/<team>/plugin/. The older
 * mattstack/teams/<team>/packs/<team>/ is spelled only by the detector in
 * lib/team/team-pack-path.ts and the conversion planner. Named no-* so it
 * runs on every PR.
 */

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";

const ROOT = resolve(import.meta.dir, "..", "..");
const SCAN = [
  "cli.ts",
  "commands",
  "lib",
  "scripts",
  "packages/rt-client/src",
  "packages/settings-kit/src",
  "apps/board/src",
  "apps/board/bin",
  "apps/board/scripts",
  "apps/boxscore/src",
  "apps/console/src",
];
const SKIP_DIRS = new Set(["node_modules", "dist", "__tests__", "fixtures"]);
const ALLOWED = new Set(["lib/team/team-pack-path.ts", "scripts/lib/move-team-packs.ts"]);
// "packs" joined after a team variable or a team folder, or a teams/<x>/packs/
// path. The base pack's join("org", "packs", name) and the bindings path
// join("packs", pack, "skills.jsonc") never match.
const PATTERNS = [
  /"packs",\s*(team|zone\.team)\b/,
  /zone\.dir,\s*"packs"/,
  /teams\/(\$\{[^}]*\}|<[^>]*>|[a-z0-9-]+)\/packs\//,
];

const DOC_SCAN = ["docs", "website/docs", "plugins/mattstack", "skills", "AGENTS.md"];
const DOC_SKIP = new Set(["node_modules", "superpowers", "CERTIFICATION.md"]);
const DOC_PATTERNS = [/teams\/[^/\s`]+\/packs\//, /\bpacks\/<team>\b/];

function files(path: string, keep: (name: string) => boolean, skip: Set<string>): string[] {
  if (statSync(path).isFile()) return keep(path) ? [path] : [];
  return readdirSync(path)
    .filter((name) => !skip.has(name))
    .flatMap((name) => files(join(path, name), keep, skip));
}

function exists(path: string): boolean {
  try {
    statSync(join(ROOT, path));
    return true;
  } catch {
    return false;
  }
}

function offenders(roots: string[], keep: (name: string) => boolean, skip: Set<string>, allowed: Set<string>, patterns: RegExp[]): string[] {
  return roots.filter(exists)
    .flatMap((p) => files(join(ROOT, p), keep, skip))
    .map((file) => relative(ROOT, file))
    .filter((rel) => !allowed.has(rel))
    .filter((rel) => patterns.some((re) => re.test(readFileSync(join(ROOT, rel), "utf8"))));
}

test("no source names the team pack at mattstack/teams/<team>/packs/<team>", () => {
  const found = offenders(SCAN, (p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p), SKIP_DIRS, ALLOWED, PATTERNS);
  expect(found, "a team's pack is mattstack/teams/<team>/plugin (teamPackDir, teamPackRel); only the detector and the conversion planner may spell the old path").toEqual([]);
});

test("no live doc teaches the team pack at mattstack/teams/<team>/packs/", () => {
  const found = offenders(DOC_SCAN, (p) => /\.mdx?$/.test(p), DOC_SKIP, new Set(), DOC_PATTERNS);
  expect(found, "live docs name mattstack/teams/<team>/plugin/; historical specs and plans under docs/superpowers and the certification ledger are not scanned").toEqual([]);
});
```

- [ ] **Step 2: Run it**

Run: `bun test lib/__tests__/no-nested-team-pack.test.ts`
Expected: PASS. If it lists an offender, that file still spells the old path: fix it in place the way the task that owns it says (never by widening `ALLOWED`), then run again.

- [ ] **Step 3: Commit**

```bash
git add lib/__tests__/no-nested-team-pack.test.ts
git commit -m "guard: no-nested-team-pack keeps mattstack/teams/<team>/packs/<team> out of source and live docs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Whole-branch gates

**Files:** none new.

- [ ] **Step 1: Typecheck and the static gates**

Run: `bun run typecheck && bun run check`
Expected: both exit 0. A typecheck error names a caller of a changed signature (for example `zonePackDir` now taking `Pick<ZoneInfo, "dir">`); fix the call, not the signature.

- [ ] **Step 2: The guard directory and every touched test file**

Run:

```bash
bun test lib/__tests__
bun test lib/team/__tests__/team-pack-path.test.ts lib/skills/__tests__/init.test.ts lib/skills/__tests__/packs.test.ts lib/skills/__tests__/materialize.test.ts lib/skills/__tests__/base-attachments.test.ts lib/skills/__tests__/sources.test.ts
bun test commands/__tests__/skills.test.ts commands/__tests__/skills-bind.test.ts commands/__tests__/skills-init.test.ts commands/__tests__/skills-sync.test.ts commands/__tests__/skills-surface.test.ts commands/__tests__/skills-json-frozen.test.ts commands/__tests__/skills-report-output.test.ts commands/__tests__/team.test.ts commands/__tests__/onboarding-org.test.ts
bun test lib/setup/__tests__/requirements.test.ts lib/setup/__tests__/skills-materialize.test.ts lib/setup/__tests__/steps-b.test.ts lib/setup/__tests__/steps-c.test.ts lib/setup/__tests__/apply.test.ts lib/setup/__tests__/pack.test.ts lib/setup/__tests__/validators-tools.test.ts
bun test lib/team/__tests__/add.test.ts lib/team/__tests__/share-pack.test.ts lib/daemon/__tests__/home-snapshot.test.ts scripts/__tests__/move-team-packs.test.ts
bun test packages/rt-client/src/settings/__tests__/paths.test.ts packages/rt-client/src/settings/__tests__/active-team.test.ts packages/rt-client/test/dist-freshness.test.ts
```

Expected: every file PASS.

- [ ] **Step 3: One last sweep for the old spelling anywhere the guard does not scan**

Run: `rg -n 'packs/\$\{(team|zone\.team)\}|"packs", (team|zone\.team)|teams/[a-z<$][^/ ]*/packs/' --glob '!docs/superpowers/**' --glob '!plugins/mattstack/CERTIFICATION.md' --glob '!**/__tests__/**' --glob '!**/*.test.ts' --glob '!node_modules' .`
Expected: hits only in `lib/team/team-pack-path.ts` and `scripts/lib/move-team-packs.ts`.

- [ ] **Step 4: Commit anything the gates changed**

If a gate (formatter, `docs:gen`) rewrote a file, commit it:

```bash
git add -A && git commit -m "chore: gate output after the team pack move

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
