# Org-level setup requirements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An org declares tools once in `org/requirements.jsonc`, and every team's setup picks them up, with a team able to override or remove each one.

**Architecture:** `readPackRequirements` reads the org file and folds it into the active team's single entry through one pure function. Every caller gets the merged list unchanged. Two pack-only readers skip an entry that has no pack file behind it, and `toolRows` draws one new status row for org file errors.

**Tech Stack:** TypeScript on Bun, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-11-03-org-requirements-design.md`

## Global Constraints

- The org file path is `orgs/<org>/mattstack/org/requirements.jsonc`.
- Org errors never reach `PackRequirements.error`: `lib/setup/pack.ts:41` fails the pack stage on it.
- The reader always returns at most one entry. `pack` is the team's name, never the org's.
- No active team, or an empty org slug, returns `[]`.
- Row ids stay `tool.team.<name>`.
- Screen copy is fixed by the spec's "A new tool on a finished Mac" section. Mock: `docs/apps/design/setup/setup.pen`, section T, frames T1 to T7.
- UI is validated by rendering both schemes and looking at them.
- No employer names or real team slugs in code, tests or docs. Fixtures use `acme` and `widgets`.
- Run `bun test` from the repo root, and only the files each task names.
- Comments state a constraint the code cannot show, or do not exist.

## Review Focus

- A team that declares a tool with `optional: true` when the org's `integrations` list also names that tool's integration: the integration must not stay required. Pinned in Task 1.
- An org file that is valid JSON but has one malformed tool: the good tools apply and `orgError` names the bad one. Pinned in Task 1.
- An unconverted team folder with an org file present: the team's error entry stays first and keeps its error, and org tools still fold in. Pinned in Task 1.
- `excludeOrg` naming something the org does not declare: nothing happens, with no error on either field. Pinned in Task 1.
- A team with no pack file on a real toolRows pass: no `pack.<team>` row, and the org tool's `tool.team.<name>` row is present. Pinned in Task 2.

---

### Task 1: Read and merge the org file

**Files:**
- Modify: `lib/setup/requirements.ts`
- Test: `lib/setup/__tests__/requirements.test.ts`, `lib/setup/__tests__/sign-in-tools.test.ts`

**Interfaces:**
- Produces:
  - `PackRequirements` gains `excludeOrg?: string[]`, `orgOnly?: true` and `orgError?: string`.
  - `export function mergeOrgRequirements(team: PackRequirements | null, teamName: string, org: PackRequirements): PackRequirements`
  - `readPackRequirements(p, org, team?)` keeps its signature and returns the merged entry.

- [ ] **Step 1: Write the failing tests**

In `requirements.test.ts`, new `describe("mergeOrgRequirements")`:

```ts
const doppler = { name: "doppler", why: "secrets", connect: { integration: "doppler" as const } };
const orgReq = { pack: "org", tools: [doppler], integrations: ["doppler" as const] };

test("team tools come first and a tool the team names is replaced whole, taking its integration with it", () => {
  const team = { pack: "widgets", tools: [{ ...doppler, optional: true }], integrations: [] };
  const merged = mergeOrgRequirements(team, "widgets", orgReq);
  expect(merged.tools).toEqual([{ ...doppler, optional: true }]);
  expect(merged.integrations).toEqual([]);
});

test("excludeOrg removes the org tool and the integration it connects", () => {
  const team = { pack: "widgets", tools: [], integrations: [], excludeOrg: ["doppler"] };
  const merged = mergeOrgRequirements(team, "widgets", orgReq);
  expect(merged.tools).toEqual([]);
  expect(merged.integrations).toEqual([]);
});

test("an excludeOrg name matching nothing changes nothing and reports nothing", () => {
  const team = { pack: "widgets", tools: [], integrations: [], excludeOrg: ["nope"] };
  const merged = mergeOrgRequirements(team, "widgets", orgReq);
  expect(merged.tools).toEqual([doppler]);
  expect(merged.error).toBeUndefined();
  expect(merged.orgError).toBeUndefined();
});

test("the team's pack, error, chrome and workType survive; org chrome and workType do not", () => {
  const team = { pack: "widgets", tools: [], integrations: [], error: "bad", workType: "feature" };
  const merged = mergeOrgRequirements(team, "widgets", { ...orgReq, workType: "other", chrome: { required: true } });
  expect(merged).toMatchObject({ pack: "widgets", error: "bad", workType: "feature" });
  expect(merged.chrome).toBeUndefined();
});

test("no team entry yields an orgOnly entry under the team's name", () => {
  expect(mergeOrgRequirements(null, "widgets", orgReq)).toMatchObject({ pack: "widgets", orgOnly: true, tools: [doppler] });
});

test("org parse errors land on orgError, never error", () => {
  const merged = mergeOrgRequirements(null, "widgets", { ...orgReq, error: "tools[1] is malformed" });
  expect(merged.error).toBeUndefined();
  expect(merged.orgError).toContain("tools[1]");
});
```

In `describe("readPackRequirements")`, using the file's existing `fakeProbes` setup and an active team `widgets` in org `acme`:

- `"reads org/requirements.jsonc and folds it into the team's one entry"`: both files present, `result.length` is 1, tool names are team's then org's.
- `"an org file and no team file yields one orgOnly entry"`.
- `"no org file returns what it returned before"`: team file only, `toEqual` the current shape, with no `orgOnly` or `orgError` key.
- `"no active team returns [] even with an org file"`.
- `"an empty org slug returns []"`: `readPackRequirements(p, "")`.
- `"an unreadable org file sets orgError and keeps the team's entry"`: `exists` true, `readFile` null, `orgError` contains `could not read`, `error` undefined.
- `"one malformed org tool keeps the rest and names the bad one on orgError"`.
- `"an unconverted team folder keeps its error entry and still folds org tools"`.

In `parseRequirements` tests: `"parses excludeOrg and reports a non-string entry"`, with `{ "excludeOrg": ["doppler", 3] }`, `excludeOrg` is `["doppler"]` and `error` contains `excludeOrg`. A file with no `excludeOrg` has no such key.

In `sign-in-tools.test.ts`: `"a team tool replaces an org tool of the same name through the merged entry"`, passing `[mergeOrgRequirements(team, "widgets", orgReq)]` to `signInTools` and expecting one tool, the team's.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/setup/__tests__/requirements.test.ts lib/setup/__tests__/sign-in-tools.test.ts`
Expected: FAIL, `mergeOrgRequirements` is not exported.

- [ ] **Step 3: Implement in `lib/setup/requirements.ts`**

- `parseRequirements` reads `excludeOrg`: strings kept, anything else pushes `excludeOrg entries must be strings` onto `errors`. Set the key only when the array is present.
- `mergeOrgRequirements`:
  - `removed` is the set of `team.excludeOrg`; `teamNames` is the set of team tool names.
  - `kept` is org tools in neither set.
  - `dropped` is `removed` plus each `connect.integration` of an org tool not in `kept`.
  - `integrations` is team's, then org's not in `dropped`, deduped.
  - The result spreads `team` when present, otherwise `{ pack: teamName, tools: [], integrations: [], orgOnly: true }`, with `tools: [...team.tools, ...kept]` and `integrations`, plus `orgError: org.error` only when set.
- `readPackRequirements`:
  - Return `[]` when `org` is empty, before resolving the active team. Change the parameter to `team?: string | null` and resolve inside.
  - Keep the `team === null` return.
  - Build today's `PackRequirements | null` from the existing branches.
  - Read `join(orgDir, "mattstack", "org", "requirements.jsonc")`. Absent: return today's result. Present but unreadable: fold an empty org with `error: "could not read <file>"`.
  - Parse with `parseRequirements("org", text)`, then return `[mergeOrgRequirements(...)]`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/setup/__tests__/requirements.test.ts lib/setup/__tests__/sign-in-tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/requirements.ts lib/setup/__tests__/requirements.test.ts lib/setup/__tests__/sign-in-tools.test.ts
git commit -m "setup: fold org requirements into the team's entry"
```

### Task 2: Pack readers and the org status row

**Files:**
- Modify: `lib/setup/pack.ts:60`, `lib/setup/validators/tools.ts:793-846`, `lib/setup/regroup.ts`, `.claude/rules/setup.md`
- Test: `lib/setup/__tests__/pack.test.ts`, `lib/setup/__tests__/validators-tools.test.ts`, `lib/setup/__tests__/regroup.test.ts`

**Interfaces:**
- Consumes: `orgOnly` and `orgError` from Task 1.
- Produces: row id `org.requirements`.

- [ ] **Step 1: Write the failing tests**

`pack.test.ts`:

- `"an orgOnly entry takes the same path as no entry"`: same fixture as the existing `reqs: []` case that reaches `NO_MANIFEST_DETAIL`, passing `[{ pack: "widgets", tools: [], integrations: [], orgOnly: true }]`. Assert the same result as `[]`.
- `"an orgError never fails the pack stage"`: `reqs: widgets("feature")` with `orgError: "bad"` on the entry, same result as without it.

`validators-tools.test.ts`:

- `"an orgOnly entry draws no pack row and still draws its tool"`: `toolRows` with `[{ pack: "widgets", tools: [{ name: "acme-cli", why: "x" }], integrations: [], orgOnly: true }]`. Expect no row with id `pack.widgets`, and a row `tool.team.acme-cli`.
- `"orgError draws one org.requirements row that blocks nothing"`: row has `status: "error"`, `required: false`, `detail` containing the error, no `finishGated`.
- `"no orgError draws no org.requirements row"`.

`regroup.test.ts`: `"org.requirements sits under Team"`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/setup/__tests__/pack.test.ts lib/setup/__tests__/validators-tools.test.ts lib/setup/__tests__/regroup.test.ts`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

- `pack.ts:60`: `packName` is `undefined` when `ctx.reqs[0]?.orgOnly`.
- `tools.ts`, in `toolRows`: the `names` list takes `reqs.filter((r) => !r.orgOnly).map((r) => r.pack)`. After the `team.marketplace` block, for the first entry with `orgError` push a row `{ id: "org.requirements", kind: "tool", title: "Org requirements", why: "Tools every team in this org needs.", required: false, status: "error", detail: orgError }`, following the `team.marketplace` row's shape. Check the copy against `rt:ui-copy`.
- `regroup.ts`: add `"org.requirements": "team"` to `HOME`, beside the other `org.*` rows.
- `.claude/rules/setup.md`: a short section, "Org requirements", stating that the reader folds `org/requirements.jsonc` into the team's one entry, that nothing may add a second entry (`pack.ts` reads `reqs[0]`, `toolRows` draws a `pack.*` row per entry), and that org errors stay on `orgError`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/setup/__tests__/pack.test.ts lib/setup/__tests__/validators-tools.test.ts lib/setup/__tests__/regroup.test.ts lib/setup/__tests__/prepare.test.ts lib/setup/__tests__/requirements.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the type check**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/setup/pack.ts lib/setup/validators/tools.ts lib/setup/regroup.ts .claude/rules/setup.md lib/setup/__tests__/pack.test.ts lib/setup/__tests__/validators-tools.test.ts lib/setup/__tests__/regroup.test.ts
git commit -m "setup: pack readers skip an org-only entry; org errors get a status row"
```

### Task 3: Notify once when a required tool arrives

**Files:**
- Create: `lib/setup/tool-notices.ts`
- Modify: `lib/setup/state.ts`, the `afterPull` wiring passed to `lib/daemon/team-snapshots.ts`
- Test: `lib/setup/__tests__/tool-notices.test.ts`

**Interfaces:**
- Consumes: `readPackRequirements` from Task 1.
- Produces:
  - `SetupState.toolNotices?: string[]`
  - `export function toolNotice(missing: { name: string; title: string }[], told: string[]): { notice: { title: string; message: string } | null; told: string[] }`, pure.
  - `export async function runToolNotices(p: Probes, slug: string, notify: (title: string, message: string, id: string) => void): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```ts
const dop = { name: "doppler", title: "Doppler" };
const ld = { name: "ldcli", title: "ldcli" };

test("one new tool names it", () => {
  expect(toolNotice([dop], [])).toEqual({
    notice: { title: "Your team needs Doppler", message: "Open setup to install it" },
    told: ["doppler"],
  });
});
test("several tools count and list", () => {
  expect(toolNotice([dop, ld], []).notice).toEqual({ title: "Your team needs 2 new tools", message: "Doppler and ldcli" });
});
test("a tool already told sends nothing", () => {
  expect(toolNotice([dop], ["doppler"])).toEqual({ notice: null, told: ["doppler"] });
});
test("a tool no longer missing drops off, so it can notify again", () => {
  expect(toolNotice([], ["doppler"])).toEqual({ notice: null, told: [] });
});
test("only the new name counts toward the notice", () => {
  expect(toolNotice([dop, ld], ["doppler"]).notice?.title).toBe("Your team needs ldcli");
});
```

`runToolNotices`, with `fakeProbes`: `"an unfinished Mac sends nothing"`, `"an optional tool sends nothing"`, `"a sent notice records its names in setup-state"`, `"a notify that throws records nothing"`.

`title` is `integrationDef(connect.integration).title` when the tool connects an integration, otherwise its `name` as written.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/setup/__tests__/tool-notices.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`runToolNotices` returns unless `isSetupFinished`, reads the merged requirements, filters to non-optional tools, finds missing binaries with the same check `prepare.ts` uses (export `missingBinary`), calls `toolNotice`, sends with id `setup_update:tools:<sorted names>`, then writes `toolNotices`. Wire it into the daemon's `afterPull`, using `notifyEnabled(SETUP_UPDATE_CATEGORY, ...)`, and keep any existing `afterPull` work running first. A failure logs and never breaks the pull.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/setup/__tests__/tool-notices.test.ts lib/setup/__tests__/prepare.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/tool-notices.ts lib/setup/state.ts lib/setup/prepare.ts lib/setup/__tests__/tool-notices.test.ts lib/daemon
git commit -m "setup: notify once when a required tool arrives on a finished Mac"
```

### Task 4: The `tools` stage and section

**Files:**
- Modify: `lib/setup/form.ts`, `commands/setup-form.ts`
- Test: the form suite beside `lib/setup/form.ts` (`lib/setup/__tests__/form*.test.ts`)

**Interfaces:**
- Consumes: `signInRow`, `extraRow` in `form.ts`.
- Produces:
  - `FormStage` gains `"tools"`.
  - `rt setup form --section tools` returns `{ heading: string; rows: FormRow[]; allDone: boolean }`.

- [ ] **Step 1: Write the failing tests**

- `"a finished Mac with only a missing team tool lands on tools"`: `formStage` returns `"tools"`.
- `"a team tool's own account counts as the tool"`: a missing `tool.team.doppler` plus an unconnected `account.doppler` still lands on `tools`.
- `"any other blocker keeps today's stage"`: a missing `account.slack` plus a team tool returns `"connect"`.
- `"an unfinished Mac never lands on tools"`.
- `"a run still going outranks tools"`.
- `"the tools section draws an Install row for a missing tool"`, with state `todo` and action `install`.
- `"a sign-in tool, once installed, offers its sign-in"`.
- `"a tool with no sign-in and no brew offers Download or Show steps"`.
- Heading: one row `"One new tool for your team"`, two `"2 new tools for your team"`, all done `"You're all set"` with `allDone: true`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/setup/__tests__/form`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

`StageInputs` gains `onlyTeamTools: boolean`, true when the blocking set is non-empty and every id is `tool.team.*` or the `account.<session>` of a sign-in tool. `finishedStage` returns `"tools"` after its `macos` check and before `connect`. Keep the copy in `FORM_COPY`. Add `tools` to the section list and `USAGE`. The section lists the blocking tools plus those named in `toolNotices`, so a resolved tool stays on screen as a done row, and "You're all set" can show before the window closes. Once nothing blocks, the stage reads `ready`; the tray holds the screen until Done.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/setup/__tests__/form`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/form.ts commands/setup-form.ts lib/setup/__tests__
git commit -m "setup: a tools stage for a new tool on a finished Mac"
```

### Task 5: The tray screen

**Files:**
- Create: `rt-tray/Sources/Setup/Fast/ToolsScreen.swift`
- Modify: the `FormStage` and `FastSetupScreen` enums, `FastSetupView.swift`, `FastSetupSnapshot.swift`
- Test: the `FastSetupFlow` suite in `rt-tray`

**Interfaces:**
- Consumes: `rt setup form --section tools` from Task 4.
- Produces: `FastSetupScreen.tools`.

- [ ] **Step 1: Write the failing test**

`FastSetupFlow`: `land(on: .tools)` shows `.tools`, and a read returning `.ready` while the screen is `.tools` holds it there until Done.

- [ ] **Step 2: Run the test to verify it fails**

Run the tray's core test target, per `.claude/rules/dev-app.md`.
Expected: FAIL, no `tools` case.

- [ ] **Step 3: Implement `ToolsScreen`**

Follow `ConnectScreen.swift`, reusing `FormCard`, `FormRowView` and `FastFooter`. Heading from the section, no sub line, step label "Setup status", footer note "Find this later in Setup status". Later closes the window. Done is off until `allDone`, then closes it. No decision in Swift about which rows show. Add snapshot pages for T2, T3, T4, T5, T6 and T7, in both schemes.

- [ ] **Step 4: Run the test and render both schemes**

Run the same test target, expected PASS. Render the snapshots in light and dark, compare with section T, and say plainly what looks wrong.

- [ ] **Step 5: Commit**

```bash
git add rt-tray
git commit -m "tray: a short screen for a new team tool"
```
