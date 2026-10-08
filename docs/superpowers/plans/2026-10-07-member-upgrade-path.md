# Member Upgrade Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member's Mac on v2.21.0 with a one-team clone under `~/.mattstack/teams/` ends on the org layout at `~/.mattstack/orgs/<org>/` with no command from the member, whichever lands first: the new app or the converted org `main`; and the org marker gains a layout version the daemon refuses to fast-forward past.

**Architecture:** One classifier (`orgLayoutState`) tells every reader what shape the Mac's org is in. The update run reorders to move and pull before migrations. A clone on a layout this rt does not read is a waiting state: materialize writes nothing, the status row says why, nothing fails. The daemon's post-pull hook chain re-materializes after every moving pull, and its pull gate holds a clone whose fetched tip is above `ORG_LAYOUT`.

**Tech Stack:** Bun, TypeScript, `bun:test`, real git in temp dirs, `fakeProbes` for pure tests, `createRealProbes()` spread with a fake `claude` for end-to-end tests.

**Spec:** `docs/superpowers/specs/2026-10-07-member-upgrade-path-design.md`

## Global Constraints

- Placeholder names only, in code, tests and docs: `acme` (org), `widgets` (team), `dev1`/`dev2` (members), `gitlab.example.com` (forge). Never the real org, team, repo or member names.
- No em dashes or en dashes anywhere.
- Every message a person reads goes through `lib/ui/out.ts` or a step/row `detail`; no `console.*`, no `process.stdout` (the `no-raw-output` guard).
- A step marked `updateSafe` stays idempotent, never calls `ctx.need`, never overwrites a value the user chose.
- A migration is recorded on `done` or `skipped`, never on `failed`; none is left unrecorded to retry.
- Nothing runs against the real HOME: every test sets `process.env.HOME` to a temp dir (the preload does for unit tests; e2e-style tests set it themselves) and restores it.
- Run tests from the repo root. Targeted tests only; the full suite is CI's.
- Commit after every task with the attribution line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- `ORG_LAYOUT` is `2` and lives in `lib/team/org-marker.ts`; nothing else spells a layout number except `parseMarker`'s defaults.

## Review Focus

1. A marker whose `layout` is a string (`"2"`), zero, negative or a float: `markerState` answers `invalid`, so `org.folder` leaves the clone alone and names why. Pinned in Task 1.
2. A clone under `orgs/` whose marker reads `role: "team"` but whose org settings file also exists (a half-converted tree): `orgLayoutState` answers `waiting`, because `ready` needs the marker at `ORG_LAYOUT` and the settings file both. Pinned in Task 2.
3. The gate meets a `git show` that fails for a reason other than a missing marker (a corrupt object, a timeout): the pull passes and the failure is logged once at `warn`; a gate must never turn a transient git error into a permanent hold. Pinned in Task 7.
4. The materialize hook runs on a Mac whose mattstack plugin is not installed yet (`engine-pack-missing`): it logs at `debug` and returns; it never throws and never writes. Pinned in Task 8.
5. Two clones under `orgs/`, one ready and one waiting: the first by name decides, the same as `currentOrg`, so the row and materialize agree on which org the Mac is in. Pinned in Task 2.

---

### Task 1: The marker carries a layout

**Files:**
- Modify: `lib/team/org-marker.ts`
- Modify: `lib/team/create.ts:181`
- Test: `lib/team/__tests__/org-marker.test.ts`, `lib/team/__tests__/create.test.ts:84`

**Interfaces:**
- Produces: `export const ORG_LAYOUT = 2`; `export type MarkerState = { kind: "none" } | { kind: "invalid"; why: string } | { kind: "org"; org: string; layout: number }`; `export function parseMarker(raw: string | null): MarkerState`; `markerState(p, dir)` and `markerOrg(p, dir)` keep their signatures.

- [ ] **Step 1: Write the failing tests**

Add to `lib/team/__tests__/org-marker.test.ts`:

```ts
import { ORG_LAYOUT, parseMarker } from "../org-marker.ts";

describe("layout", () => {
  test("an org marker without the field reads as ORG_LAYOUT, a one-team marker as 1", () => {
    expect(markerState(at('{ "role": "org", "org": "acme" }'), dir)).toEqual({ kind: "org", org: "acme", layout: ORG_LAYOUT });
    expect(markerState(at('{ "role": "team", "namespace": "widgets", "org": "acme" }'), dir)).toEqual({ kind: "org", org: "acme", layout: 1 });
  });
  test("an explicit positive integer wins over the default", () => {
    expect(parseMarker('{ "role": "org", "org": "acme", "layout": 3 }')).toEqual({ kind: "org", org: "acme", layout: 3 });
    expect(parseMarker('{ "role": "team", "org": "acme", "layout": 2 }')).toEqual({ kind: "org", org: "acme", layout: 2 });
  });
  test("a layout that is not a positive integer is invalid", () => {
    for (const bad of ['"2"', "0", "-1", "2.5", "null", "[]"]) {
      expect(parseMarker(`{ "role": "org", "org": "acme", "layout": ${bad} }`)).toEqual({ kind: "invalid", why: "its layout is not a positive whole number" });
    }
  });
  test("parseMarker of null is none", () => {
    expect(parseMarker(null)).toEqual({ kind: "none" });
  });
  test("ORG_LAYOUT is 2", () => {
    expect(ORG_LAYOUT).toBe(2);
  });
});
```

Change the existing `markerState` assertion `toEqual({ kind: "org", org: "acme" })` to `toEqual({ kind: "org", org: "acme", layout: 2 })`.

In `lib/team/__tests__/create.test.ts:84` change the expectation to `{ role: "org", org: "acme", layout: 2 }`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/team/__tests__/org-marker.test.ts lib/team/__tests__/create.test.ts`
Expected: FAIL (`parseMarker` and `ORG_LAYOUT` not exported; `layout` missing from the marker).

- [ ] **Step 3: Implement**

Replace the body of `lib/team/org-marker.ts` after the imports with:

```ts
export const ORG_MARKER_REL = join("mattstack", "mattstack.jsonc");

/** The highest org layout this rt reads. Moves only with a breaking change to the org repo's shape, never with a release. */
export const ORG_LAYOUT = 2;

export type MarkerState = { kind: "none" } | { kind: "invalid"; why: string } | { kind: "org"; org: string; layout: number };

/**
 * An old clone may still carry a `role: "team"` marker with an `org` field; a
 * marker of any other role is not an org clone. `layout` is the marker's own
 * when present; else 2 for the org layout and 1 for the one-team layout, so
 * no repo converted before the field existed has to write it.
 */
export function parseMarker(raw: string | null): MarkerState {
  if (raw === null) return { kind: "none" };
  let marker: unknown;
  try {
    marker = JSON.parse(stripJsonc(raw));
  } catch {
    return { kind: "invalid", why: "it is not valid JSON" };
  }
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) return { kind: "invalid", why: "it is not a JSON object" };
  const { role, org, layout } = marker as Record<string, unknown>;
  if (role !== "org" && role !== "team") return { kind: "none" };
  if (typeof org !== "string") return { kind: "invalid", why: "it names no org" };
  try {
    validateSlug(org);
  } catch {
    return { kind: "invalid", why: `${JSON.stringify(org)} is not a valid org name` };
  }
  if (layout !== undefined && (typeof layout !== "number" || !Number.isInteger(layout) || layout < 1)) {
    return { kind: "invalid", why: "its layout is not a positive whole number" };
  }
  return { kind: "org", org, layout: typeof layout === "number" ? layout : role === "org" ? ORG_LAYOUT : 1 };
}

export function markerState(p: Pick<Probes, "readFile">, dir: string): MarkerState {
  return parseMarker(p.readFile(join(dir, ORG_MARKER_REL)));
}

export function markerOrg(p: Pick<Probes, "readFile">, dir: string): string | null {
  const state = markerState(p, dir);
  return state.kind === "org" ? state.org : null;
}
```

In `lib/team/create.ts:181` change the scaffold marker to `JSON.stringify({ role: "org", org: slug, layout: ORG_LAYOUT }, null, 2)` and import `ORG_LAYOUT` from `./org-marker.ts`.

- [ ] **Step 4: Run the tests and the other marker consumers**

Run: `bun test lib/team/__tests__/org-marker.test.ts lib/team/__tests__/create.test.ts lib/setup/__tests__/steps-org-folder.test.ts lib/daemon/__tests__/handlers-org.test.ts lib/setup/__tests__/steps-org.test.ts`
Expected: PASS. If any test asserts `toEqual({ kind: "org", org: ... })` on a `markerState` result, add `layout` to that expectation (grep: `rg 'kind: "org"' lib --glob '*.test.ts'`).

- [ ] **Step 5: Commit**

```bash
git add lib/team/org-marker.ts lib/team/create.ts lib/team/__tests__/org-marker.test.ts lib/team/__tests__/create.test.ts
git commit -m "org marker: carry a layout version; ORG_LAYOUT names the highest rt reads"
```

---

### Task 2: `orgLayoutState`, the one classifier

**Files:**
- Create: `lib/team/org-layout.ts`
- Test: `lib/team/__tests__/org-layout.test.ts`

**Interfaces:**
- Consumes: `markerState`, `ORG_LAYOUT` from Task 1; `orgsDirUnder`, `orgDirUnder` from `lib/rt-paths.ts`.
- Produces:

```ts
export type OrgLayoutState =
  | { kind: "none" }
  | { kind: "ready"; slug: string }
  | { kind: "waiting"; slug: string; dir: string; layout: number };
export function orgLayoutState(p: Pick<Probes, "readDir" | "readFile" | "exists" | "home">): OrgLayoutState;
/** The sentence a member reads while the org is on a layout this rt does not read. */
export function layoutSentence(state: Extract<OrgLayoutState, { kind: "waiting" }>): string;
export const WAITING_SENTENCE = "Your org has not moved to its new layout yet. rt finishes the move when it does.";
export function updateSentence(layout: number): string; // "Your org uses layout 3 and this app reads up to 2. Update the app."
export function orgLayoutWaitingError(state: Extract<OrgLayoutState, { kind: "waiting" }>): UserActionableError;
```

- [ ] **Step 1: Write the failing tests**

`lib/team/__tests__/org-layout.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { ORG_MARKER_REL } from "../org-marker.ts";
import { layoutSentence, orgLayoutState, orgLayoutWaitingError, updateSentence, WAITING_SENTENCE } from "../org-layout.ts";

const H = "/h";
const orgs = `${H}/.mattstack/orgs`;
const marker = (role: "org" | "team", org: string, layout?: number) => JSON.stringify({ role, org, ...(layout !== undefined ? { layout } : {}) });

function home(clones: Record<string, { marker: string; orgStore?: boolean }>) {
  const files: Record<string, string> = {};
  const dirs: Record<string, string[]> = { [orgs]: Object.keys(clones) };
  for (const [name, c] of Object.entries(clones)) {
    files[`${orgs}/${name}/.git/config`] = "[remote \"origin\"]\n";
    files[`${orgs}/${name}/${ORG_MARKER_REL}`] = c.marker;
    if (c.orgStore) files[`${orgs}/${name}/mattstack/org/settings.org.jsonc`] = "{}";
  }
  return fakeProbes({ home: H, files, dirs });
}

describe("orgLayoutState", () => {
  test("none without a clone", () => {
    expect(orgLayoutState(fakeProbes({ home: H }))).toEqual({ kind: "none" });
  });
  test("ready for a converted clone", () => {
    expect(orgLayoutState(home({ acme: { marker: marker("org", "acme"), orgStore: true } }))).toEqual({ kind: "ready", slug: "acme" });
  });
  test("waiting for the one-team layout moved under orgs/", () => {
    expect(orgLayoutState(home({ acme: { marker: marker("team", "acme") } }))).toEqual({ kind: "waiting", slug: "acme", dir: `${orgs}/acme`, layout: 1 });
  });
  test("waiting for a layout above ORG_LAYOUT", () => {
    expect(orgLayoutState(home({ acme: { marker: marker("org", "acme", 3), orgStore: true } }))).toEqual({ kind: "waiting", slug: "acme", dir: `${orgs}/acme`, layout: 3 });
  });
  test("a one-team marker beside an org store is still waiting", () => {
    expect(orgLayoutState(home({ acme: { marker: marker("team", "acme"), orgStore: true } })).kind).toBe("waiting");
  });
  test("an org marker without its store is waiting on layout 2", () => {
    expect(orgLayoutState(home({ acme: { marker: marker("org", "acme") } }))).toEqual({ kind: "waiting", slug: "acme", dir: `${orgs}/acme`, layout: 2 });
  });
  test("the first clone by name decides", () => {
    const p = home({ zeta: { marker: marker("team", "zeta") }, acme: { marker: marker("org", "acme"), orgStore: true } });
    expect(orgLayoutState(p)).toEqual({ kind: "ready", slug: "acme" });
  });
  test("a folder without .git/config or without a marker is not a clone", () => {
    const p = fakeProbes({ home: H, dirs: { [orgs]: ["stray", "half"] }, files: { [`${orgs}/half/.git/config`]: "" } });
    expect(orgLayoutState(p)).toEqual({ kind: "none" });
  });
});

describe("sentences", () => {
  test("below ORG_LAYOUT is the waiting sentence", () => {
    expect(layoutSentence({ kind: "waiting", slug: "acme", dir: "/x", layout: 1 })).toBe(WAITING_SENTENCE);
  });
  test("above names both numbers", () => {
    expect(updateSentence(3)).toBe("Your org uses layout 3 and this app reads up to 2. Update the app.");
    expect(layoutSentence({ kind: "waiting", slug: "acme", dir: "/x", layout: 3 })).toBe(updateSentence(3));
  });
  test("the error carries the sentence and no next command", () => {
    const err = orgLayoutWaitingError({ kind: "waiting", slug: "acme", dir: "/x", layout: 1 });
    expect(err.code).toBe("org-layout-waiting");
    expect(err.message).toBe(WAITING_SENTENCE);
    expect(err.next).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/team/__tests__/org-layout.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/team/org-layout.ts`**

```ts
/**
 * What shape this Mac's org is in, for every reader that must agree on it:
 * the update steps, materialize, the skills verbs, the migrations and the
 * `org.layout` status row. A clone on a layout this rt does not read is a
 * waiting state, never a failure: the files on disk stay as they are until
 * the pull (or the app update) that resolves it.
 */
import { join } from "path";
import { UserActionableError } from "../errors.ts";
import { orgDirUnder, orgsDirUnder } from "../rt-paths.ts";
import type { Probes } from "../setup/probes.ts";
import { markerState, ORG_LAYOUT } from "./org-marker.ts";

export type OrgLayoutState =
  | { kind: "none" }
  | { kind: "ready"; slug: string }
  | { kind: "waiting"; slug: string; dir: string; layout: number };

export const WAITING_SENTENCE = "Your org has not moved to its new layout yet. rt finishes the move when it does.";

export function updateSentence(layout: number): string {
  return `Your org uses layout ${layout} and this app reads up to ${ORG_LAYOUT}. Update the app.`;
}

export function layoutSentence(state: Extract<OrgLayoutState, { kind: "waiting" }>): string {
  return state.layout > ORG_LAYOUT ? updateSentence(state.layout) : WAITING_SENTENCE;
}

export function orgLayoutWaitingError(state: Extract<OrgLayoutState, { kind: "waiting" }>): UserActionableError {
  return new UserActionableError("org-layout-waiting", layoutSentence(state));
}

/** The first clone by name, the way currentOrg picks; a folder without .git/config or a readable marker is not a clone. */
export function orgLayoutState(p: Pick<Probes, "readDir" | "readFile" | "exists" | "home">): OrgLayoutState {
  const root = orgsDirUnder(p.home);
  for (const slug of [...p.readDir(root)].sort()) {
    const dir = orgDirUnder(p.home, slug);
    if (!p.exists(join(dir, ".git", "config"))) continue;
    const marker = markerState(p, dir);
    if (marker.kind !== "org") continue;
    const storePresent = p.exists(join(dir, "mattstack", "org", "settings.org.jsonc"));
    if (marker.layout === ORG_LAYOUT && storePresent) return { kind: "ready", slug };
    return { kind: "waiting", slug, dir, layout: marker.layout };
  }
  return { kind: "none" };
}
```

Check `UserActionableError`'s constructor in `lib/errors.ts` for the argument order (`code, message, extra?, opts?`) and match it.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test lib/team/__tests__/org-layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/team/org-layout.ts lib/team/__tests__/org-layout.test.ts
git commit -m "add lib/team/org-layout.ts: one classifier for the org's layout state"
```

---

### Task 3: The update run moves and pulls before the migrations

**Files:**
- Modify: `lib/setup/apply.ts` (`updateItems`, lines 354-360)
- Modify: `AGENTS.md` ("Setup after an update")
- Test: `lib/setup/__tests__/apply.test.ts:1546-1552`

**Interfaces:**
- Produces: `updateItems` returns `[org.folder, org.pull, ...pending migrations, team.identity, ...other update-safe steps, verify]`.

- [ ] **Step 1: Rewrite the failing order test**

In `lib/setup/__tests__/apply.test.ts` replace the test at line 1547 with:

```ts
  test("org.folder and org.pull precede the migrations, which precede identity, the rest and verify", async () => {
    const ran: string[] = [];
    // The same inline factory the current test uses: a StepDef with updateSafe: true whose run records its id.
    const step = (id: StepId): StepDef => ({ id, title: id, kind: "rt", updateSafe: true, applies: () => true, run: async () => { ran.push(id); return { state: "done" }; } });
    await runUpdateWith(
      [step("org.folder"), step("org.pull"), step("team.identity"), step("plugins.install"), step("skills.materialize"), step("verify")],
      [fakeMigration("2026-10-01-example", async () => { ran.push("migration"); return { state: "done" }; })],
      testCtx().ctx,
    );
    expect(ran).toEqual(["org.folder", "org.pull", "migration", "team.identity", "plugins.install", "skills.materialize", "verify"]);
  });
```

`updateStep`'s third parameter is already `updateSafe`, so do not pass a callback to it; the inline `step` factory above is what the current test at line 1547 uses (copy its exact shape, including the `StepDef` import). `fakeMigration` keeps its signature.

Also update the test at line 1553 ("runs pending migrations, then update-safe steps..."): its expected event order `["migration.2026-09-30-move-file", "path.link", "claude.permissions", "verify"]` stays the same because it has no org steps; add a comment that org steps would lead.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/setup/__tests__/apply.test.ts -t "precede"`
Expected: FAIL (migration first).

- [ ] **Step 3: Reorder `updateItems`**

```ts
const LEADS_UPDATE: readonly StepId[] = ["org.folder", "org.pull"];

/** Move and pull first, so a migration that reads the org sees the clone where the resolver looks and what main holds now; then the migrations; then every other update-safe step in contract order; then verify. */
function updateItems(steps: StepDef[], migrations: MigrationDef[], applied: readonly string[]): UpdateItem[] {
  const item = (s: StepDef): UpdateItem => ({ id: s.id, title: s.title, run: (ctx) => s.run(ctx) });
  const safe = steps.filter((s) => s.updateSafe && s.id !== "verify");
  const leads = safe.filter((s) => LEADS_UPDATE.includes(s.id)).map(item);
  const pending = migrations.filter((m) => !applied.includes(m.id)).map<UpdateItem>((m) => ({ id: migrationEventId(m.id), title: m.title, run: (ctx) => m.run(ctx), migrationId: m.id }));
  const rest = safe.filter((s) => !LEADS_UPDATE.includes(s.id)).map(item);
  const verify = steps.find((s) => s.id === "verify" && s.updateSafe);
  return [...leads, ...pending, ...rest, ...(verify ? [item(verify)] : [])];
}
```

Update the doc comment above `runUpdateWith` to the same order. The `migrationId` branch in the run loop ("Migrations run first, so rethrowing here would skip every step") keeps its behaviour; reword the comment to "Migrations run before most steps".

- [ ] **Step 4: Update AGENTS.md**

In the "Setup after an update" section replace "A run is pending migrations, then `org.pull` and `team.identity`, then the other `StepDef`s with `updateSafe: true`, then `verify`" with "A run is `org.folder` and `org.pull`, then pending migrations, then `team.identity` and the other `StepDef`s with `updateSafe: true`, then `verify`, so a migration that reads the org sees the clone at `orgs/<org>` holding what `main` holds now".

- [ ] **Step 5: Run the apply and update tests**

Run: `bun test lib/setup/__tests__/apply.test.ts lib/setup/__tests__/update-safe.test.ts commands/__tests__/setup-update.test.ts commands/__tests__/onboarding-org.test.ts`
Expected: PASS. If `onboarding-org.test.ts`'s update test asserts a plan order with the migration first, update it to the new order.

- [ ] **Step 6: Commit**

```bash
git add lib/setup/apply.ts lib/setup/__tests__/apply.test.ts AGENTS.md
git commit -m "setup update: org.folder and org.pull run before the migrations"
```

---

### Task 4: The sdm migration answers honestly per layout state

**Files:**
- Modify: `lib/setup/migrations/sdm-resources-key.ts`
- Test: `lib/setup/__tests__/migration-sdm-resources-key.test.ts`

**Interfaces:**
- Consumes: `orgLayoutState`, `WAITING_SENTENCE` (Task 2); `createRealProbes` from `lib/setup/probes.ts`.

- [ ] **Step 1: Write the failing test**

Add to the describe block:

```ts
  test("a clone still on the one-team layout is skipped with the waiting words, and the key is left alone", async () => {
    const dir = join(home, ".mattstack", "orgs", "acme");
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, ".git", "config"), "");
    mkdirSync(join(dir, "mattstack"), { recursive: true });
    writeFileSync(join(dir, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "team", namespace: "widgets", org: "acme" }));
    writeFileSync(join(dir, "mattstack", "settings.team.jsonc"), JSON.stringify({ "rt.sdmEnrichment": ENR }));
    const result = await run();
    expect(result.state).toBe("skipped");
    expect(result.detail).toBe("Your org has not moved to its new layout yet; nothing to move on this Mac");
    expect(JSON.parse(readFileSync(join(dir, "mattstack", "settings.team.jsonc"), "utf8"))["rt.sdmEnrichment"]).toEqual(ENR);
  });
```

Add `mkdirSync, readFileSync, writeFileSync` to the `fs` import.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/setup/__tests__/migration-sdm-resources-key.test.ts -t "one-team layout"`
Expected: FAIL (detail is "This Mac is in no org").

- [ ] **Step 3: Implement**

At the top of `run(ctx)`:

```ts
  async run(ctx) {
    const layout = orgLayoutState(ctx.p);
    if (layout.kind === "none") return { state: "skipped", detail: "This Mac is in no org" };
    if (layout.kind === "waiting") return { state: "skipped", detail: "Your org has not moved to its new layout yet; nothing to move on this Mac" };
    const org = layout.slug;
    ...
```

Remove the `currentOrg()` call (keep its import only if still used). Import `orgLayoutState` from `../../team/org-layout.ts`. `MigrationDef.run` receives the full `ApplyContext`, so `ctx.p` is always set; the existing test's `run()` helper passes `{} as ApplyContext`, so give it a real-probes context for the new test: `sdmResourcesKeyMigration.run({ p: { ...createRealProbes(), home } } as Partial<ApplyContext> as ApplyContext)` and update the older tests' helper the same way (import `createRealProbes` from `../probes.ts` in the test).

- [ ] **Step 4: Run the migration tests**

Run: `bun test lib/setup/__tests__/migration-sdm-resources-key.test.ts lib/setup/__tests__/migrations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/migrations/sdm-resources-key.ts lib/setup/__tests__/migration-sdm-resources-key.test.ts
git commit -m "sdm-resources-key: skip with the waiting words on a one-team clone"
```

---

### Task 5: Materialize and the skills verbs treat a waiting org as waiting

**Files:**
- Modify: `lib/setup/skills-materialize.ts` (`materializeSkills`, `MaterializeSkillsResult`)
- Modify: `lib/skills/init.ts` (`readZonesFrom`, line 153)
- Modify: `lib/setup/steps/skills.ts` (`skillsMaterializeRun`)
- Test: `lib/setup/__tests__/skills-materialize.test.ts`, `lib/skills/__tests__/init.test.ts` (or the file that tests `readZonesFrom`; find it with `rg readZonesFrom lib --glob '*.test.ts'`)

**Interfaces:**
- Produces: `MaterializeSkillsResult` gains `{ skipped: true; waiting: true; reason: string; repos: [] }` as a third member; `readZonesFrom` throws `orgLayoutWaitingError` for a clone whose marker is `kind: "org"` with `layout !== ORG_LAYOUT`.

- [ ] **Step 1: Write the failing tests**

In `lib/setup/__tests__/skills-materialize.test.ts` inside `describe("materializeSkills")`:

```ts
  test("a clone on the one-team layout is a waiting skip that writes nothing and sets nothing aside", async () => {
    const dir = join(home, ".mattstack", "orgs", "acme");
    write(join(dir, ".git", "config"), "");
    write(join(dir, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "team", namespace: "widgets", org: "acme" }));
    const repo = seedRepo("https://gitlab.example.com/acme/widgets.git");
    const bindings = join(home, ".mattstack", "repos", "gitlab.example.com-acme-widgets", "packs", "widgets", "skills.jsonc");
    write(bindings, '{ "board-review": "widgets:board-review" }');
    const engine = join(home, "engine");
    write(join(engine, "pack", "skills.jsonc"), "{}");
    const p = { ...createRealProbes(), home, env: { RT_ENGINE_PACK_DIR: engine } };
    const result = await materializeSkills(p, {});
    expect(result).toEqual({ skipped: true, waiting: true, reason: "Your org has not moved to its new layout yet. rt finishes the move when it does.", repos: [] });
    expect(readFileSync(bindings, "utf8")).toBe('{ "board-review": "widgets:board-review" }');
    expect(existsSync(`${bindings}.stale`)).toBe(false);
    void repo;
  });
```

Add `existsSync, readFileSync` to the `node:fs` import. Check how the existing tests construct probes with `RT_ENGINE_PACK_DIR` and copy that shape exactly.

In the `readZonesFrom` test file add:

In `lib/skills/__tests__/init.test.ts`, inside `describe("readZones")`, using that file's `memFs`, `orgFiles` and `ORG_ROOT` helpers (a later key in the spread overrides the marker `orgFiles` wrote):

```ts
  test("a clone whose marker is on a layout above ORG_LAYOUT throws the update sentence", () => {
    const fs = memFs({ ...orgFiles("acme", {}, { widgets: {} }), [`${ORG_ROOT("acme")}/mattstack/mattstack.jsonc`]: '{ "role": "org", "org": "acme", "layout": 3 }' });
    expect(() => readZonesFrom(fs, `${HOME}/.mattstack/orgs`)).toThrow("Your org uses layout 3 and this app reads up to 2. Update the app.");
  });
  test("a one-team marker throws the waiting sentence rather than skipping the clone", () => {
    const fs = memFs({ ...orgFiles("acme", {}, { widgets: {} }), [`${ORG_ROOT("acme")}/mattstack/mattstack.jsonc`]: '{ "role": "team", "namespace": "widgets", "org": "acme" }' });
    expect(() => readZonesFrom(fs, `${HOME}/.mattstack/orgs`)).toThrow("Your org has not moved to its new layout yet. rt finishes the move when it does.");
  });
  test("a folder with no marker or a marker of another role is still skipped", () => {
    const fs = memFs({ ...orgFiles("acme", {}, { widgets: {} }), [`${ORG_ROOT("acme")}/mattstack/mattstack.jsonc`]: '{ "role": "pack", "org": "acme" }' });
    expect(readZonesFrom(fs, `${HOME}/.mattstack/orgs`)).toEqual([]);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/setup/__tests__/skills-materialize.test.ts lib/skills/__tests__/init.test.ts`
Expected: FAIL (materialize prunes; `readZonesFrom` skips the clone silently).

- [ ] **Step 3: Implement**

`lib/skills/init.ts`, inside `readZonesFrom`'s org loop, replace `if (marker?.role !== "org") continue;` with:

```ts
    const state = parseMarker(readRaw(fs, join(orgDir, "mattstack", "mattstack.jsonc")));
    if (state.kind !== "org") continue;
    if (state.layout !== ORG_LAYOUT) throw orgLayoutWaitingError({ kind: "waiting", slug: org, dir: orgDir, layout: state.layout });
```

where `readRaw` is whatever the file already uses to read text through `InitFs` (`fs.readFile` returning `string | null`; add a two-line helper if only `readJsonc` exists). Import `parseMarker`, `ORG_LAYOUT` from `../team/org-marker.ts` and `orgLayoutWaitingError` from `../team/org-layout.ts`. A folder whose marker is `none` or `invalid` keeps being skipped.

`lib/setup/skills-materialize.ts`:

```ts
export type MaterializeSkillsResult =
  | { skipped: true; waiting?: undefined; reason: string; repos: [] }
  | { skipped: true; waiting: true; reason: string; repos: [] }
  | { skipped: false; repos: MaterializeRepoResult[] };
```

and in `materializeSkills`, before the engine pack lookup:

```ts
  const layout = orgLayoutState(p);
  if (layout.kind === "waiting") return { skipped: true, waiting: true, reason: layoutSentence(layout), repos: [] };
```

`lib/setup/steps/skills.ts`: `skillsMaterializeRun` already maps `result.skipped` to `{ state: "skipped", detail: result.reason }`; nothing to change, but add a test in `lib/setup/__tests__/steps-skills.test.ts` (create it if absent, modelled on `steps-org.test.ts`) that a waiting org yields `{ state: "skipped", detail: WAITING_SENTENCE }` from `skillsMaterializeStep.run(ctx)` with `materializeWorld`-style fake probes whose marker is `role: "team"`.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/setup/__tests__/skills-materialize.test.ts lib/skills/__tests__ lib/setup/__tests__/steps-skills.test.ts commands/__tests__/skills.test.ts commands/__tests__/skills-check-strict.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/skills-materialize.ts lib/skills/init.ts lib/setup/steps/skills.ts lib/setup/__tests__ lib/skills/__tests__
git commit -m "materialize: a clone on another layout is a waiting skip, never a prune"
```

---

### Task 5b: The skills verbs refuse a waiting org, never fail it

**Files:**
- Modify: `commands/skills.ts` (`withCleanErrors` at line 129; the `skillsMaterialize` catch at line 2305)
- Test: `commands/__tests__/skills-failures.test.ts`

**Interfaces:**
- Consumes: `UserActionableError` code `org-layout-waiting` thrown by `readZonesFrom` (Task 5); `out.note`, `out.line` from `lib/ui/out.ts`; `captureOut` from the test helpers the file already uses.
- Produces: `function refuseLayoutWaiting(err: UserActionableError, json: boolean): never` in `commands/skills.ts`.

- [ ] **Step 1: Write the failing test**

In `commands/__tests__/skills-failures.test.ts`, following the file's own pattern: it drives verbs through `runExpectingCleanExit` (which returns `{ exitCode, errors }`) and reads output through `captureSkills`, not `captureOut()` and an exit sentinel. Rewrite the snippet below to that shape (copy a neighbouring test's setup for HOME and the two helpers); the assertions to keep are the sentence on stderr, the word `refused`, no `[failed]`, exit 2, and the `--json` envelope's `error`:

```ts
  test("a clone on another layout is a refused note with the sentence, exit 2, never a failure", async () => {
    const dir = join(home, ".mattstack", "orgs", "acme");
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, ".git", "config"), "");
    mkdirSync(join(dir, "mattstack"), { recursive: true });
    writeFileSync(join(dir, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "team", namespace: "widgets", org: "acme" }));
    const captured = captureOut();
    await expect(skillsCheck(["--team", "widgets"])).rejects.toThrow("exit 2");
    const stderr = captured.stderr();
    expect(stderr).toContain("Your org has not moved to its new layout yet. rt finishes the move when it does.");
    expect(stderr).toContain("refused");
    expect(stderr).not.toContain("[failed]");
  });
  test("under --json the envelope carries the sentence as its error", async () => {
    // same fixture
    const captured = captureOut();
    await expect(skillsCheck(["--team", "widgets", "--json"])).rejects.toThrow("exit 2");
    expect(JSON.parse(captured.stdout())).toMatchObject({ ok: false, error: expect.stringContaining("has not moved to its new layout") });
  });
```

Use whichever verb the file already drives (`skillsCheck`, `skillsCompile` or `skillsMaterialize`); the fixture is the same. Read how that file spies `process.exit` (it throws an "exit N" sentinel) and match it.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test commands/__tests__/skills-failures.test.ts -t "another layout"`
Expected: FAIL (a coral failure block is drawn, and `[failed]` or the failure title appears).

- [ ] **Step 3: Implement**

In `commands/skills.ts`:

```ts
/** A layout the admin has not moved yet is a refusal by policy, never a failure: one refused line with the sentence, no command. */
function refuseLayoutWaiting(err: UserActionableError, json: boolean): never {
  if (json) exitUserError(err, json);
  out.note(out.line("refused", err.message));
  process.exit(2);
}
```

In `withCleanErrors`, before the `SkillsRefusal` branch:

```ts
    if (err instanceof UserActionableError && err.code === "org-layout-waiting") refuseLayoutWaiting(err, args.includes("--json"));
```

`withCleanErrors` has no `args` today: give it an optional second parameter `opts: { json?: boolean } = {}` and pass `{ json }` from each verb that parses a `--json` flag (`skillsCheck`, `skillsCompile`, `skillsSurface`, `skillsBind`, `skillsChanges`, `skillsDiscard`, `skillsComposition`, `skillsAnatomy`); a verb that passes nothing draws the note. In `skillsMaterialize`'s catch (line 2305) replace `exitUserError(err, json)` with `err.code === "org-layout-waiting" ? refuseLayoutWaiting(err, json) : exitUserError(err, json)`.

- [ ] **Step 4: Run the skills tests**

Run: `bun test commands/__tests__/skills-failures.test.ts commands/__tests__/skills.test.ts commands/__tests__/skills-json-frozen.test.ts commands/__tests__/skills-check-strict.test.ts`
Expected: PASS (the frozen `--json` bytes are untouched: a waiting org is a new input, not a changed envelope).

- [ ] **Step 5: Commit**

```bash
git add commands/skills.ts commands/__tests__/skills-failures.test.ts
git commit -m "skills verbs: refuse a waiting org layout with one note, never a failure"
```

---

### Task 6: The `org.layout` status row

**Files:**
- Modify: `lib/setup/validators/rt-health.ts` (beside `orgFolderRow`, and `rtHealthRows`)
- Modify: `lib/daemon/home-snapshot.ts:84-107` (`SnapshotStatus.layoutHold`), status field only in this task
- Test: `lib/setup/__tests__/validators-rt-health.test.ts`

**Interfaces:**
- Consumes: `orgLayoutState`, `layoutSentence`, `updateSentence` (Task 2); `TeamSnapshotEntry` from `lib/daemon/team-snapshots.ts`.
- Produces: `export const ORG_LAYOUT_ROW_ID = "org.layout"`; `export function orgLayoutRow(p: Probes, readStatus: () => Promise<TeamSnapshotEntry[] | null>): Promise<Row | null>`; `SnapshotStatus.layoutHold?: { layout: number; reads: number } | null`.

- [ ] **Step 1: Write the failing tests**

In `validators-rt-health.test.ts`, add `"org.layout"` to `ROW_ORDER` right after `"org.folder"` (match the position `rtHealthRows` will emit it), and:

```ts
describe("orgLayoutRow", () => {
  const legacy = JSON.stringify({ role: "team", namespace: "widgets", org: "acme" });
  const converted = JSON.stringify({ role: "org", org: "acme" });
  const status = (hold: { layout: number; reads: number } | null) => async () => [{ slug: "acme", layoutHold: hold } as unknown as TeamSnapshotEntry];
  const at = (marker: string, store: boolean) =>
    fakeProbes({
      home: "/h",
      files: {
        "/h/.mattstack/orgs/acme/.git/config": "",
        "/h/.mattstack/orgs/acme/mattstack/mattstack.jsonc": marker,
        ...(store ? { "/h/.mattstack/orgs/acme/mattstack/org/settings.org.jsonc": "{}" } : {}),
      },
      dirs: { "/h/.mattstack/orgs": ["acme"] },
    });

  test("null with no clone", async () => {
    expect(await orgLayoutRow(fakeProbes({ home: "/h" }), status(null))).toBeNull();
  });
  test("ready names the org and layout", async () => {
    const r = await orgLayoutRow(at(converted, true), status(null));
    expect(r).toMatchObject({ id: ORG_LAYOUT_ROW_ID, status: "ready", detail: "acme on layout 2" });
  });
  test("a one-team clone is skipped with the waiting sentence and no action", async () => {
    const r = await orgLayoutRow(at(legacy, false), status(null));
    expect(r).toMatchObject({ status: "skipped", detail: "Your org has not moved to its new layout yet. rt finishes the move when it does." });
    expect(r?.action).toBeUndefined();
  });
  test("a clone above ORG_LAYOUT is needs-you with the update step", async () => {
    const r = await orgLayoutRow(at(JSON.stringify({ role: "org", org: "acme", layout: 3 }), true), status(null));
    expect(r).toMatchObject({ status: "needs-you", detail: "Your org uses layout 3 and this app reads up to 2. Update the app." });
    expect(r?.action).toMatchObject({ type: "steps", steps: ["Update mattstack from its menu bar icon, then reopen Setup status"] });
  });
  test("a daemon hold reads needs-you even though the clone itself is ready", async () => {
    const r = await orgLayoutRow(at(converted, true), status({ layout: 3, reads: 2 }));
    expect(r).toMatchObject({ status: "needs-you", detail: "Your org uses layout 3 and this app reads up to 2. Update the app." });
  });
  test("a daemon that is not running does not hide a ready clone", async () => {
    const r = await orgLayoutRow(at(converted, true), async () => null);
    expect(r?.status).toBe("ready");
  });
});
```

Import `ORG_LAYOUT_ROW_ID, orgLayoutRow` from the validator and `TeamSnapshotEntry` as a type.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/setup/__tests__/validators-rt-health.test.ts -t "orgLayoutRow|row order"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `lib/daemon/home-snapshot.ts`'s `SnapshotStatus` add after `lastPullSkipped`:

```ts
  /** A fetched tip on a layout above what this rt reads: the pull stays at the last commit it can read until the app updates. Absent from a daemon that predates it. */
  layoutHold?: { layout: number; reads: number } | null;
```

and in `status()` return `layoutHold: null` for now (Task 7 wires the real value).

In `lib/setup/validators/rt-health.ts`:

```ts
export const ORG_LAYOUT_ROW_ID = "org.layout";
const UPDATE_APP_ACTION: Action = { type: "steps", label: "Show steps…", steps: ["Update mattstack from its menu bar icon, then reopen Setup status"] };

/** The org's layout against what this rt reads. A clone still on the one-team layout waits for the admin's conversion; one past this rt, or a daemon holding the pull, needs the app update. */
export async function orgLayoutRow(p: Probes, readStatus: () => Promise<TeamSnapshotEntry[] | null>): Promise<Row | null> {
  const state = orgLayoutState(p);
  if (state.kind === "none") return null;
  const base = {
    id: ORG_LAYOUT_ROW_ID,
    kind: "tool" as const,
    title: "Org layout",
    why: "The org repo says what shape its files are in, and rt reads the shapes it knows. A newer shape waits for an app update; an older one waits for the org to move.",
    required: false,
    recheck: "on-activate" as const,
  };
  const hold = (await readStatus())?.find((e) => e.slug === state.slug)?.layoutHold ?? null;
  if (hold) return row({ ...base, status: "needs-you", detail: updateSentence(hold.layout), action: UPDATE_APP_ACTION });
  if (state.kind === "waiting") {
    return state.layout > ORG_LAYOUT
      ? row({ ...base, status: "needs-you", detail: layoutSentence(state), action: UPDATE_APP_ACTION })
      : row({ ...base, status: "skipped", detail: layoutSentence(state) });
  }
  return row({ ...base, status: "ready", detail: `${state.slug} on layout ${ORG_LAYOUT}` });
}
```

In `rtHealthRows`, compute `const orgLayout = await orgLayoutRow(p, () => readTeamSnapshotStatus(p));` and emit it right after `orgFolder` in the returned list. Import `ORG_LAYOUT` from `../../team/org-marker.ts` and the three names from `../../team/org-layout.ts`. Use the same `steps` label (`"Show steps…"`) the other rows use; copy it verbatim from `ORG_FOLDER_CONVERGE_ACTION`.

- [ ] **Step 4: Run the validator tests**

Run: `bun test lib/setup/__tests__/validators-rt-health.test.ts lib/setup/__tests__/plan.test.ts commands/__tests__/setup-copy.test.ts`
Expected: PASS. If `setup-copy.test.ts` snapshots the status rows, update the snapshot deliberately with `bun test --update-snapshots commands/__tests__/setup-copy.test.ts` and read the diff.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/validators/rt-health.ts lib/daemon/home-snapshot.ts lib/setup/__tests__/validators-rt-health.test.ts commands/__tests__
git commit -m "setup status: an org.layout row that waits calmly or asks for the app update"
```

---

### Task 7: The daemon's pull gate

**Files:**
- Modify: `lib/daemon/home-snapshot.ts` (`SnapshotSpec.pull`, `doPull`, `pullNow`, `status()`, `teamSnapshotSpec`)
- Test: `lib/daemon/__tests__/home-snapshot.test.ts`

**Interfaces:**
- Consumes: `parseMarker`, `ORG_LAYOUT` (Task 1); `updateSentence` (Task 2).
- Produces: `SnapshotSpec.pull.gate?: (ref: string) => Promise<{ layout: number } | null>` (a non-null answer holds); `PullResult` gains `hold?: { layout: number; reads: number }`, set only on a held pull; `SnapshotStatus.layoutHold` set on a hold and cleared on a passing pull; `export async function layoutGate(exec: Probes["exec"], repoDir: string, ref: string, log: Pick<Logger, "warn">): Promise<{ layout: number } | null>`.

- [ ] **Step 1: Write the failing tests**

In `lib/daemon/__tests__/home-snapshot.test.ts`, after the team pull tests that use `teamSpecFor()` and `pullResponders()` (around line 2627), add a describe in the same fake-exec style. `teamSpecFor()` returns a spec with `pull: { intervalSec: 300 }`; spread it and replace `pull` to add a gate:

```ts
describe("the layout gate", () => {
  const gated = (gate: () => Promise<{ layout: number } | null>) => ({ ...teamSpecFor(null), pull: { intervalSec: 300, gate } });

  test("a hold: skipped with the update sentence, no merge, lastPullAt stamped, layoutHold set", async () => {
    const { deps, execCalls, log } = baseDeps({ exec: makeFakeExec(defaultResponders({ pull: pullResponders({ behind: 1, ahead: 0 }) })) });
    const handle = startSnapshot(gated(async () => ({ layout: 3 })), deps);
    await handle.ready;
    const result = await handle.pullNow();
    expect(result).toEqual({ outcome: "skipped", detail: "Your org uses layout 3 and this app reads up to 2. Update the app.", hold: { layout: 3, reads: 2 } });
    expect(execCalls.some((argv) => gitVerb(argv) === "merge")).toBe(false);
    const status = handle.status();
    expect(status.lastPullAt).toBe(1_000_000);
    expect(status.layoutHold).toEqual({ layout: 3, reads: 2 });
    expect(status.lastPullSkipped).toBe(result.detail);
    await handle.pullNow();
    expect(log.calls.filter((c) => c.level === "info" && JSON.stringify(c.args).includes("holding the pull")).length).toBe(1);
    handle.stop();
  });

  test("a passing gate fast-forwards and clears an earlier hold", async () => {
    let layout: number | null = 3;
    const { deps } = baseDeps({ exec: makeFakeExec(defaultResponders({ pull: pullResponders({ behind: 1, ahead: 0 }) })) });
    const handle = startSnapshot(gated(async () => (layout === null ? null : { layout })), deps);
    await handle.ready;
    await handle.pullNow();
    expect(handle.status().layoutHold).toEqual({ layout: 3, reads: 2 });
    layout = null;
    const result = await handle.pullNow();
    expect(result.outcome).toBe("fast-forwarded");
    expect(handle.status().layoutHold).toBeNull();
    handle.stop();
  });

  test("a gate that throws passes the pull and warns once", async () => {
    const { deps, log } = baseDeps({ exec: makeFakeExec(defaultResponders({ pull: pullResponders({ behind: 1, ahead: 0 }) })) });
    const handle = startSnapshot(gated(async () => { throw new Error("object corrupt"); }), deps);
    await handle.ready;
    expect((await handle.pullNow()).outcome).toBe("fast-forwarded");
    await handle.pullNow();
    expect(log.calls.filter((c) => c.level === "warn" && JSON.stringify(c.args).includes("layout gate")).length).toBe(1);
    handle.stop();
  });

  test("nothing to pull runs no gate", async () => {
    let asked = 0;
    const { deps } = baseDeps({ exec: makeFakeExec(defaultResponders({ pull: pullResponders({ behind: 0, ahead: 0 }) })) });
    const handle = startSnapshot(gated(async () => { asked++; return { layout: 3 }; }), deps);
    await handle.ready;
    expect((await handle.pullNow()).outcome).toBe("up-to-date");
    expect(asked).toBe(0);
    handle.stop();
  });
});

describe("layoutGate", () => {
  const exec = (res: { code: number; stdout: string; stderr: string }) => (async () => res) as unknown as Probes["exec"];
  test("reads the marker at the ref through git show", async () => {
    expect(await layoutGate(exec({ code: 0, stdout: '{ "role": "org", "org": "acme", "layout": 3 }', stderr: "" }), "/clone", "refs/remotes/origin/main", fakeLog())).toEqual({ layout: 3 });
  });
  test("a one-team marker, an org marker at ORG_LAYOUT or an unparsable one passes", async () => {
    for (const stdout of ['{ "role": "team", "org": "acme" }', '{ "role": "org", "org": "acme" }', "{ nope"]) {
      expect(await layoutGate(exec({ code: 0, stdout, stderr: "" }), "/clone", "ref", fakeLog())).toBeNull();
    }
  });
  test("a missing marker passes silently; any other git failure passes with a warning", async () => {
    const quiet = fakeLog();
    expect(await layoutGate(exec({ code: 128, stdout: "", stderr: "fatal: path 'mattstack/mattstack.jsonc' does not exist in 'refs/remotes/origin/main'" }), "/clone", "ref", quiet)).toBeNull();
    expect(quiet.calls.filter((c) => c.level === "warn").length).toBe(0);
    const loud = fakeLog();
    expect(await layoutGate(exec({ code: 128, stdout: "", stderr: "fatal: bad object" }), "/clone", "ref", loud)).toBeNull();
    expect(loud.calls.filter((c) => c.level === "warn").length).toBe(1);
  });
});
```

Check how `defaultResponders` takes its pull responders (its `opts` signature at line 37) and pass `pullResponders(...)` the way the neighbouring team pull tests do. Add `layoutGate` to the `../home-snapshot.ts` import and `type Probes` from `../../setup/probes.ts`. Also add the `git show` responder to the real-spec path later in the file only if a test there drives `teamSnapshotSpec` with a pull; otherwise `layoutGate`'s own tests cover the spec's gate.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/daemon/__tests__/home-snapshot.test.ts -t "layout"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`PullResult` (line 83):

```ts
export interface PullResult {
  outcome: "up-to-date" | "fast-forwarded" | "rebased" | "conflict" | "skipped";
  detail: string | null;
  /** Set only on a pull the layout gate held; a caller tells a hold from any other skip by this, never by the sentence. */
  hold?: { layout: number; reads: number };
}
```

`SnapshotSpec.pull`:

```ts
  pull?: {
    intervalSec: number;
    onPulled?: (outcome: "fast-forwarded" | "rebased") => Promise<void>;
    /** Runs after the fetch with the remote-tracking ref; a non-null answer holds the pull at the current commit. */
    gate?: (ref: string) => Promise<{ layout: number } | null>;
  };
```

Module-level, exported:

```ts
/** The org layout at `ref`, when it is one this rt does not read. A tip with no marker, a marker rt cannot parse, or a layout at or below ORG_LAYOUT passes. */
export async function layoutGate(exec: Probes["exec"], repoDir: string, ref: string, log: Pick<Logger, "warn">): Promise<{ layout: number } | null> {
  const shown = await exec(["git", "-C", repoDir, "show", `${ref}:${ORG_MARKER_REL}`], { timeoutMs: GIT_TIMEOUT_MS });
  if (shown.code !== 0) {
    if (!/does not exist|exists on disk, but not in|not in the index/i.test(shown.stderr)) {
      log.warn({ repoDir, ref, stderr: shown.stderr.trim() }, "layout gate: could not read the marker at the fetched tip; passing");
    }
    return null;
  }
  const marker = parseMarker(shown.stdout);
  return marker.kind === "org" && marker.layout > ORG_LAYOUT ? { layout: marker.layout } : null;
}
```

Note the `exec` here is the `Probes["exec"]` shape (`code`, not `exitCode`); `teamSnapshotSpec` has `opts.probes.exec`, so the spec's gate is `gate: (ref) => layoutGate(opts.probes.exec, repoDir, ref, log)` where `log` is a module logger (`teamSnapshotSpec` has none today: pass `opts.log ?? console`-free: add `log?: Pick<Logger, "warn">` to its opts, default to a no-op `{ warn() {} }`, and have `startTeamSnapshots` pass `rawDeps.log.child({ team: slug })`).

In the engine state add `let layoutHold: { layout: number; reads: number } | null = null;` and `let loggedHold: number | null = null;`. In `doPull`, after the `counts` check and before `if (behind === 0)`:

```ts
    if (spec.pull?.gate && behind > 0) {
      let hold: { layout: number } | null = null;
      try {
        hold = await spec.pull.gate(`refs/remotes/origin/${branch}`);
      } catch (err) {
        if (loggedGateError !== String(err)) {
          deps.log.warn({ err, id: spec.id }, `${label}: layout gate threw; passing`);
          loggedGateError = String(err);
        }
      }
      if (hold) {
        layoutHold = { layout: hold.layout, reads: ORG_LAYOUT };
        if (loggedHold !== hold.layout) {
          deps.log.info({ id: spec.id, layout: hold.layout, reads: ORG_LAYOUT }, `${label}: holding the pull; the org is on a layout this rt does not read`);
          loggedHold = hold.layout;
        }
        return { outcome: "skipped", detail: updateSentence(hold.layout), hold: layoutHold };
      }
      layoutHold = null;
      loggedHold = null;
    }
```

Declare `let loggedGateError: string | null = null;` with the other state. Also clear `layoutHold = null` on the `behind === 0` path when it was set and the tip is now readable (run the gate even when `behind === 0`? No: with nothing to pull there is nothing to hold; clear only when a gate passes, so a hold persists while the held tip is still the tip). Return `layoutHold` from `status()`.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/daemon/__tests__/home-snapshot.test.ts lib/daemon/__tests__/team-snapshots.test.ts lib/daemon/__tests__/handlers-team-snapshot.test.ts`
Expected: PASS (`home-snapshot.test.ts` takes a while; that is normal).

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/home-snapshot.ts lib/daemon/team-snapshots.ts lib/daemon/__tests__/home-snapshot.test.ts
git commit -m "team pull: hold a clone whose fetched tip is on a layout this rt does not read"
```

---

### Task 8: The post-pull chain re-materializes

**Files:**
- Create: `lib/daemon/materialize-pull-hook.ts`
- Create: `lib/daemon/pull-hooks.ts` (`composePullHooks`)
- Modify: `lib/daemon/team-snapshots.ts` (export `createOnPulled`, pass `log` to the spec)
- Modify: `lib/daemon.ts:1158-1162`
- Test: `lib/daemon/__tests__/materialize-pull-hook.test.ts`, `lib/daemon/__tests__/pull-hooks.test.ts`, `lib/daemon/__tests__/team-snapshots.test.ts`

**Interfaces:**
- Produces:

```ts
// materialize-pull-hook.ts
export interface MaterializePullHookDeps { log: Pick<Logger, "debug" | "info" | "warn">; probes?: Probes; materialize?: typeof materializeSkills }
export function createMaterializePullHook(deps: MaterializePullHookDeps): (slug: string) => Promise<void>;
// pull-hooks.ts
export function composePullHooks(hooks: ((slug: string) => Promise<void>)[]): (slug: string) => Promise<void>;
// team-snapshots.ts
export function createOnPulled(opts: { probes: Probes; slug: string; log: Logger; converge: typeof convergePackCache; afterPull?: (slug: string) => Promise<void> }): () => Promise<void>;
```

- [ ] **Step 1: Write the failing tests**

`lib/daemon/__tests__/materialize-pull-hook.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createMaterializePullHook } from "../materialize-pull-hook.ts";
import type { MaterializeSkillsResult } from "../../setup/skills-materialize.ts";

function fakeLog() {
  const calls: { level: string; args: unknown[] }[] = [];
  const mk = (level: string) => (...args: unknown[]) => { calls.push({ level, args }); };
  return { calls, debug: mk("debug"), info: mk("info"), warn: mk("warn") };
}
const written: MaterializeSkillsResult = { skipped: false, repos: [{ name: "widgets", path: "/r", ok: true, detail: "Wrote 1 pack file: widgets", packs: [{ pack: "widgets", ok: true, detail: "", path: "/x" } as never] }] };

describe("createMaterializePullHook", () => {
  test("materializes every repo and logs the tally at info when something was written", async () => {
    const log = fakeLog();
    const hook = createMaterializePullHook({ log, materialize: async () => written });
    await hook("acme");
    expect(log.calls.some((c) => c.level === "info" && JSON.stringify(c.args).includes("Materialized 1 pack file"))).toBe(true);
  });
  test("a waiting or engine-pack-missing skip logs at debug and writes nothing", async () => {
    const log = fakeLog();
    const hook = createMaterializePullHook({ log, materialize: async () => ({ skipped: true, reason: "engine-pack-missing: install the mattstack plugin first, then run this again", repos: [] }) });
    await hook("acme");
    expect(log.calls.map((c) => c.level)).toEqual(["debug"]);
  });
  test("never throws", async () => {
    const log = fakeLog();
    const hook = createMaterializePullHook({ log, materialize: async () => { throw new Error("disk full"); } });
    await expect(hook("acme")).resolves.toBeUndefined();
    expect(log.calls.some((c) => c.level === "warn")).toBe(true);
  });
  test("a repo-level failure is logged at warn with the repo name", async () => {
    const log = fakeLog();
    const hook = createMaterializePullHook({ log, materialize: async () => ({ skipped: false, repos: [{ name: "widgets", path: "/r", ok: false, detail: "bad fragment" }] }) });
    await hook("acme");
    expect(log.calls.some((c) => c.level === "warn" && JSON.stringify(c.args).includes("widgets"))).toBe(true);
  });
});
```

`lib/daemon/__tests__/pull-hooks.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { composePullHooks } from "../pull-hooks.ts";

describe("composePullHooks", () => {
  test("runs each hook in order and a throw does not stop the next", async () => {
    const order: string[] = [];
    const hook = composePullHooks([
      async (slug) => { order.push(`a:${slug}`); throw new Error("a broke"); },
      async (slug) => { order.push(`b:${slug}`); },
    ]);
    await expect(hook("acme")).resolves.toBeUndefined();
    expect(order).toEqual(["a:acme", "b:acme"]);
  });
});
```

In `team-snapshots.test.ts` add after the existing `afterPull` test:

```ts
  test("createOnPulled runs the converge, then afterPull, even when the converge throws", async () => {
    const order: string[] = [];
    const onPulled = createOnPulled({
      probes: fakeProbes({ home: "/h" }),
      slug: "acme",
      log: fakeLog(),
      converge: async () => { order.push("converge"); throw new Error("broke"); },
      afterPull: async (slug) => { order.push(`after:${slug}`); },
    });
    await expect(onPulled()).rejects.toThrow("broke");
    expect(order).toEqual(["converge", "after:acme"]);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/daemon/__tests__/materialize-pull-hook.test.ts lib/daemon/__tests__/pull-hooks.test.ts lib/daemon/__tests__/team-snapshots.test.ts`
Expected: FAIL, modules and export missing.

- [ ] **Step 3: Implement**

`lib/daemon/pull-hooks.ts`:

```ts
/** Runs post-pull hooks one after another; a hook that throws is already logged by itself, and must not stop the next. */
export function composePullHooks(hooks: ((slug: string) => Promise<void>)[]): (slug: string) => Promise<void> {
  return async (slug) => {
    for (const hook of hooks) {
      try {
        await hook(slug);
      } catch {
        // Each hook logs its own failure; the chain only guarantees the next one runs.
      }
    }
  };
}
```

`lib/daemon/materialize-pull-hook.ts`:

```ts
/**
 * Runs after a team pull moved the clone: rewrites every registered repo's
 * per-pack bindings from what the clone holds now, so a pulled pack edit, a
 * changed project list or the org layout conversion reaches the board
 * without a launch. Idempotent, a file walk plus a few JSON writes.
 */
import type { Logger } from "pino";
import { createRealProbes, type Probes } from "../setup/probes.ts";
import { materializeSkills, materializeTally } from "../setup/skills-materialize.ts";

export interface MaterializePullHookDeps {
  log: Pick<Logger, "debug" | "info" | "warn">;
  probes?: Probes;
  materialize?: typeof materializeSkills;
}

/** The returned hook never throws: a failed materialize must not fail the pull that drove it. */
export function createMaterializePullHook(deps: MaterializePullHookDeps): (slug: string) => Promise<void> {
  const materialize = deps.materialize ?? materializeSkills;
  return async (slug) => {
    try {
      const result = await materialize(deps.probes ?? createRealProbes(), {});
      if (result.skipped) {
        deps.log.debug({ team: slug, reason: result.reason }, "team pull: skills not materialized");
        return;
      }
      for (const repo of result.repos.filter((r) => !r.ok && !r.noManifest)) deps.log.warn({ team: slug, repo: repo.name, detail: repo.detail }, "team pull: materialize failed for a repo");
      const written = result.repos.flatMap((r) => r.packs ?? []).some((pk) => pk.ok) || result.repos.some((r) => (r.pruned?.length ?? 0) > 0);
      (written ? deps.log.info : deps.log.debug).call(deps.log, { team: slug, tally: materializeTally(result.repos) }, "team pull: skills materialized");
    } catch (err) {
      deps.log.warn({ err, team: slug }, "team pull moved the clone, but materializing skills failed; run rt skills materialize");
    }
  };
}
```

`lib/daemon/team-snapshots.ts`: lift the `onPulled` closure into an exported `createOnPulled(opts)` returning `async () => { try { await opts.converge(opts.probes, opts.slug, opts.log); } finally { await opts.afterPull?.(opts.slug); } }` and call it from `rescan` with `log: rawDeps.log.child({ team: slug })`; pass that same child logger as `log` to `teamSnapshotSpec` (Task 7's new option).

`lib/daemon.ts` around line 1161:

```ts
        const interceptLog = loggerHandle.childLogger("intercepts");
        teamSnapshots = startTeamSnapshots({
          log: loggerHandle.childLogger("team-snapshots"),
          broadcast: emit,
          afterPull: composePullHooks([
            createInterceptPullHook({ log: interceptLog }),
            createMaterializePullHook({ log: loggerHandle.childLogger("materialize") }),
          ]),
        });
```

with the two imports added. Check `lib/__tests__/no-eager-tui.test.ts` and `no-raw-output.test.ts` still pass (the new files print nothing).

- [ ] **Step 4: Run the tests**

Run: `bun test lib/daemon/__tests__/materialize-pull-hook.test.ts lib/daemon/__tests__/pull-hooks.test.ts lib/daemon/__tests__/team-snapshots.test.ts lib/daemon/__tests__/intercept-pull-hook.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/materialize-pull-hook.ts lib/daemon/pull-hooks.ts lib/daemon/team-snapshots.ts lib/daemon.ts lib/daemon/__tests__
git commit -m "daemon: re-materialize skills after every team pull that moves the clone"
```

---

### Task 9: `org.pull` names a layout change

**Files:**
- Modify: `lib/setup/steps/org.ts` (`orgPullRun`)
- Test: `lib/setup/__tests__/steps-org.test.ts`

**Interfaces:**
- Consumes: `markerState` (Task 1).

- [ ] **Step 1: Write the failing test**

Find the existing `org.pull` tests in `steps-org.test.ts` and copy their fixture shape (a clone under `/h/.mattstack/orgs/acme` with a marker, a `daemon` fake answering `team:pull`). Add:

```ts
  test("a pull that moved the clone onto the org layout says so", async () => {
    // marker reads { role: "team", org: "acme" } before; the fake daemon's team:pull rewrites it to { role: "org", org: "acme" } and answers fast-forwarded
    const outcome = await orgPullStep.run(ctx);
    expect(outcome.state).toBe("done");
    expect(outcome.detail).toBe("Pulled acme, now on the org layout");
  });
```

The fake daemon's `team:pull` handler writes the new marker through `p.writeFile` before returning `{ ok: true, data: { outcome: "fast-forwarded", detail: null } }`; `fakeProbes` reads back what `writeFile` wrote.

Also add:

```ts
  test("a held pull ends skipped with the update sentence and no remedy", async () => {
    // the fake daemon's team:pull answers { ok: true, data: { outcome: "skipped", detail: "Your org uses layout 3 and this app reads up to 2. Update the app.", hold: { layout: 3, reads: 2 } } }
    const outcome = await orgPullStep.run(ctx);
    expect(outcome).toEqual({ state: "skipped", detail: "Your org uses layout 3 and this app reads up to 2. Update the app." });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/setup/__tests__/steps-org.test.ts -t "org layout|held pull"`
Expected: FAIL (the layout detail is "Pulled acme"; the hold ends `partial` with the `rt team status` remedy).

- [ ] **Step 3: Implement**

In `orgPullRun`, record `before` as the full marker state (`markerState`) per slug instead of just the org, keep the rename detection on `org`, and build each pulled note as:

```ts
      else {
        const after = markerState(ctx.p, orgDirUnder(ctx.p.home, slug));
        const prior = before.get(slug);
        const moved = after.kind === "org" && prior?.kind === "org" && after.layout !== prior.layout;
        notes.push(res.data.outcome === "up-to-date" ? `${slug} is already up to date` : moved ? `Pulled ${slug}, now on ${after.layout === ORG_LAYOUT ? "the org layout" : `layout ${after.layout}`}` : `Pulled ${slug}`);
      }
```

Adjust `renamed` to read `after.org !== slug && after.org !== prior.org` from the states. Import `markerState, ORG_LAYOUT` (drop `markerOrg` if unused).

The hold branch goes before the `stuck` mapping. Widen `PullReply.data` to `{ outcome: string; detail: string | null; hold?: { layout: number; reads: number } }` and add a `held: string[]` list:

```ts
      else if (res.ok && res.data?.hold) held.push(res.data.detail ?? updateSentence(res.data.hold.layout));
      else if (!res.ok || !res.data || ["conflict", "skipped"].includes(res.data.outcome))
        stuck.push(...)
```

and before the final returns: `if (held.length && stuck.length === 0 && !converge) return { state: "skipped", detail: [...notes, ...skips, ...held].join("; ") };`. A hold beside a real stuck clone keeps the `partial` path, with the hold sentence in the detail. Import `updateSentence` from `../../team/org-layout.ts`.

- [ ] **Step 4: Run the step tests**

Run: `bun test lib/setup/__tests__/steps-org.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/steps/org.ts lib/setup/__tests__/steps-org.test.ts
git commit -m "org.pull: say when a pull moved the clone onto a new layout"
```

---

### Task 10: End to end, both orders

**Files:**
- Create: `commands/__tests__/member-upgrade.test.ts`
- Reuse: the probe and `claude` fake shape from `commands/__tests__/onboarding-org.test.ts:82-146`, `createApplyContext`, `runUpdate` from `lib/setup/apply.ts`, `startSnapshot`/`teamSnapshotSpec` from `lib/daemon/home-snapshot.ts`, `createOnPulled` (Task 8), `convergePackCache`, `createMaterializePullHook`, `composePullHooks`, `rtHealthRows`, `openStateDb` from `lib/state/db.ts`.

**Interfaces:**
- Consumes everything above; produces nothing new.

- [ ] **Step 1: Write the fixture and the first failing order**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { childEnv } from "../../lib/subprocess.ts";
import { createApplyContext, runUpdate, type ApplyEvent } from "../../lib/setup/apply.ts";
import { createRealProbes, type Probes } from "../../lib/setup/probes.ts";
import { readSetupState, updateSetupState } from "../../lib/setup/state.ts";
import { updateRepoIndex } from "../../lib/repo-index.ts";
import { writeTeamLocal } from "../../lib/team/team-local.ts";
import { rtHealthRows } from "../../lib/setup/validators/rt-health.ts";
import { composePlan } from "../../lib/setup/plan.ts";
import { startSnapshot, teamSnapshotSpec } from "../../lib/daemon/home-snapshot.ts";
import { createOnPulled } from "../../lib/daemon/team-snapshots.ts";
import { convergePackCache } from "../../lib/setup/pack-cache.ts";
import { createMaterializePullHook } from "../../lib/daemon/materialize-pull-hook.ts";
import { composePullHooks } from "../../lib/daemon/pull-hooks.ts";
import { openStateDb } from "../../lib/state/db.ts";
import { closeStateDb } from "../../lib/state/index.ts";

const ORIG_HOME = process.env.HOME;
let home: string;
let origin: string;
let execCalls: string[][] = [];
const marketplaces = new Map<string, string>();
const installed = new Map<string, { enabled: boolean; version: string }>();
const GIT_ENV = { ...childEnv(), GIT_AUTHOR_NAME: "dev1", GIT_AUTHOR_EMAIL: "dev1@example.com", GIT_COMMITTER_NAME: "dev1", GIT_COMMITTER_EMAIL: "dev1@example.com" };
const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const writeJson = (file: string, value: unknown) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); };

/** The one-team layout as v2.21.0 wrote it, committed to a bare origin. */
function seedOrigin(): void {
  origin = join(home, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin], { env: GIT_ENV });
  const work = join(home, "seed");
  execFileSync("git", ["clone", "-q", origin, work], { env: GIT_ENV });
  writeJson(join(work, "mattstack", "mattstack.jsonc"), { role: "team", namespace: "widgets", org: "acme" });
  writeJson(join(work, "mattstack", "settings.team.jsonc"), { "mattstack.integrations": { forge: { provider: "gitlab", host: "gitlab.example.com" } }, "board.projects": ["acme/widgets"], "board.gitlabHost": "https://gitlab.example.com", "rt.sdmEnrichment": { "acme-db-qa": { label: "QA" } } });
  writeJson(join(work, "mattstack", "team.jsonc"), { projects: ["acme/widgets"] });
  writeJson(join(work, "mattstack", "packs", "widgets", ".claude-plugin", "plugin.json"), { name: "widgets", version: "0.1.0" });
  writeJson(join(work, "mattstack", "packs", "widgets", "pack", "skills.jsonc"), { "board-review": { skill: "widgets:board-review" } });
  writeJson(join(work, ".claude-plugin", "marketplace.json"), { name: "widgets", owner: { name: "Acme" }, plugins: [{ name: "widgets", source: "./mattstack/packs/widgets" }] });
  git(work, ["add", "-A"]); git(work, ["commit", "-q", "-m", "one-team layout"]); git(work, ["push", "-q", "origin", "main"]);
  rmSync(work, { recursive: true, force: true });
}

/** The converted org layout pushed onto origin main. Stands in for the admin's conversion commit: sdm.resources is written here because that is where the key moves; a member's Mac only reads it. */
function convertOrigin(): void {
  const work = join(home, "convert");
  execFileSync("git", ["clone", "-q", origin, work], { env: GIT_ENV });
  rmSync(join(work, "mattstack"), { recursive: true, force: true });
  writeJson(join(work, "mattstack", "mattstack.jsonc"), { role: "org", org: "acme" });
  writeJson(join(work, "mattstack", "org", "settings.org.jsonc"), { "mattstack.integrations": { forge: { provider: "gitlab", host: "gitlab.example.com" } }, "mattstack.org": { admins: ["admin1"], teams: { widgets: { owners: ["admin1"] } } }, "mattstack.roster": [{ username: "dev1", teams: ["widgets"] }], "board.projects": ["acme/widgets"], "board.gitlabHost": "https://gitlab.example.com" });
  writeJson(join(work, "mattstack", "org", "packs", "acme-base", "pack", "skills.jsonc"), { base: true });
  writeJson(join(work, "mattstack", "org", "packs", "acme-base", "attachments", "shared-note", "SKILL.md"), "# shared");
  writeJson(join(work, "mattstack", "teams", "widgets", "settings.team.jsonc"), { "sdm.resources": { "acme-db-qa": { label: "QA" } } });
  writeJson(join(work, "mattstack", "teams", "widgets", "plugin", ".claude-plugin", "plugin.json"), { name: "widgets", version: "0.1.1" });
  writeJson(join(work, "mattstack", "teams", "widgets", "plugin", "pack", "skills.jsonc"), { extends: "acme-base", "board-review": { skill: "widgets:board-review" } });
  writeJson(join(work, ".claude-plugin", "marketplace.json"), { name: "widgets", owner: { name: "Acme" }, plugins: [{ name: "widgets", source: "./mattstack/teams/widgets/plugin" }] });
  git(work, ["add", "-A"]); git(work, ["commit", "-q", "-m", "org layout"]); git(work, ["push", "-q", "origin", "main"]);
  rmSync(work, { recursive: true, force: true });
}

/** A member's ~/.mattstack as v2.21.0 left it. */
function legacyMemberHome(): { clone: string; bindings: string } {
  const clone = join(home, ".mattstack", "teams", "widgets");
  execFileSync("git", ["clone", "-q", origin, clone], { env: GIT_ENV });
  const p = { ...createRealProbes(), home };
  writeTeamLocal(p, "widgets", { joinedByRt: true, createdByRt: false, rtMayManageMembership: false, agePublicKey: "age1placeholder" });
  updateSetupState(p, (s) => ({ ...s, finishedAt: "2026-09-01T00:00:00.000Z", lastApplyOk: true, lastUpdate: { version: "2.21.0", at: "2026-09-01T00:00:00.000Z" } }));
  const repo = join(home, "src", "widgets");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q"]); git(repo, ["remote", "add", "origin", "https://gitlab.example.com/acme/widgets.git"]);
  updateRepoIndex("remote:gitlab.example.com%2Facme%2Fwidgets", repo);
  const bindings = join(home, ".mattstack", "repos", "gitlab.example.com-acme-widgets", "packs", "widgets", "skills.jsonc");
  writeJson(bindings, { "board-review": "widgets:board-review" });
  marketplaces.set("widgets", clone);
  installed.set("widgets@widgets", { enabled: true, version: "0.1.0" });
  mkdirSync(join(home, "bin"), { recursive: true });
  writeFileSync(join(home, "bin", "claude"), "#!/bin/sh\n", { mode: 0o755 });
  return { clone, bindings };
}
```

Check `updateSetupState`'s probe type (`StateWriteProbes`) and `updateRepoIndex`'s identity argument shape (`serializeIdentity({ kind: "remote", id: "gitlab.example.com/acme/widgets" })` is the safe way; import `serializeIdentity` from `lib/settings/identity.ts`). Build `probes()` in the shape of `onboarding-org.test.ts:100-146` (spread `createRealProbes()`, set `home`, `env: { HOME: home, PATH: join(home, "bin"), USER: "dev1", RT_ENGINE_PACK_DIR: <this checkout>/plugins/mattstack }`, make `daemon` answer `null` for every command so `org.folder` moves in process and `org.pull` reports "The rt daemon is not running"), but with one difference that matters: **every `git` invocation passes through to the real `exec`** (`return real.exec(argv, opts)`), because this fixture uses real repositories and the one-team clone; only `claude`, `gh` and `glab` are intercepted (`gh`/`glab` answer the login `dev1`). Do not copy that file's `expect()`s on git argv. Give the fake `claude` these answers: `plugin list --json` from `installed`; `plugin marketplace list --json` from `marketplaces` as `{ name, source: "directory", path }`; `plugin marketplace add <dir>` registers the name from that dir's `marketplace.json`; `plugin marketplace remove <name>` deletes it and every installed id ending `@<name>`; `plugin install <id>` sets enabled true at the served version read from the marketplace dir; `plugin update <id> -y` bumps the version to the served one; `plugin disable|enable <id>` flips `enabled`.

The first order:

```ts
describe("member upgrade: app first, org main converts later", () => {
  test("the update run moves the clone and waits; the daemon pull finishes the move", async () => {
    const { clone, bindings } = legacyMemberHome();
    const before = readFileSync(bindings, "utf8");
    const events: ApplyEvent[] = [];
    const p = probes();
    const ctx = await context(p, events, { update: true });
    const run1 = await runUpdate(ctx);

    expect(run1.failedSteps).toEqual([]);
    const states = Object.fromEntries(run1.outcomes.map((o) => [o.id, o.state]));
    expect(states["org.folder"]).toBe("done");
    expect(states["migration.2026-10-07-sdm-resources-key"]).toBe("skipped");
    expect(run1.outcomes.find((o) => o.id === "migration.2026-10-07-sdm-resources-key")?.detail).toBe("Your org has not moved to its new layout yet; nothing to move on this Mac");
    expect(states["skills.materialize"]).toBe("skipped");
    expect(Object.values(states)).not.toContain("failed");
    expect(Object.values(states)).not.toContain("needs-you");
    expect(existsSync(clone)).toBe(false);
    const moved = join(home, ".mattstack", "orgs", "acme");
    expect(existsSync(join(moved, ".git"))).toBe(true);
    expect(existsSync(join(home, ".mattstack", "rt", "teams", "acme.json"))).toBe(true);
    expect(existsSync(join(home, ".mattstack", "rt", "teams", "widgets.json"))).toBe(false);
    expect(marketplaces.get("widgets")).toBe(moved);
    expect(installed.get("widgets@widgets")?.version).toBe("0.1.0");
    expect(readFileSync(bindings, "utf8")).toBe(before);
    expect(existsSync(`${bindings}.stale`)).toBe(false);
    const rows = await rtHealthRows(p, { ci: false });
    expect(rows.find((r) => r.id === "org.layout")).toMatchObject({ status: "skipped", detail: "Your org has not moved to its new layout yet. rt finishes the move when it does." });
    // Only the org rows: the rt link, shell, intercepts, home backup and daemon rows read needs-you in a temp HOME with no app.
    expect(rows.find((r) => r.id === "org.folder")?.status).toBe("ready");
    expect(rows.find((r) => r.id === "team.sync")?.status).not.toBe("error");

    convertOrigin();
    const db = openStateDb(join(home, ".mattstack", "rt", "state.db"), "cli");
    const log = fakeLog();
    const onPulled = createOnPulled({ probes: p, slug: "acme", log, converge: convergePackCache, afterPull: composePullHooks([createMaterializePullHook({ log, probes: p })]) });
    const handle = startSnapshot(
      teamSnapshotSpec("acme", moved, { pullIntervalSec: 300, originUrl: origin, probes: p, ownedRoots: [], readToken: async () => null, onPulled, log }),
      { log, broadcast: () => {}, db, readSettings: () => ({ enabled: true, debounceSec: 20, pushDelaySec: 60, janitorThresholdHours: 6, janitorIntervalMin: 30 }) },
    );
    await handle.ready;
    const pull = await handle.pullNow();
    handle.stop();
    closeStateDb(db);

    expect(pull.outcome).toBe("fast-forwarded");
    expect(installed.get("widgets@widgets")?.version).toBe("0.1.1");
    expect(JSON.parse(readFileSync(bindings, "utf8"))).toMatchObject({ "board-review": expect.stringContaining("widgets:board-review") });
    const after = await rtHealthRows(p, { ci: false });
    expect(after.find((r) => r.id === "org.layout")).toMatchObject({ status: "ready", detail: "acme on layout 2" });

    const run2 = await runUpdate(await context(p, [], { update: true }));
    expect(run2.failedSteps).toEqual([]);
    expect(readSetupState(p).migrations).toContain("2026-10-07-sdm-resources-key");
  });
});
```

The `fakeLog` and `context` helpers are copied from `team-snapshots.test.ts:11-14` and `onboarding-org.test.ts:188-198`; `context` takes `{ update: true }` so the run is the launch-time update, not an apply. Check `composePlan`'s input type in `lib/setup/plan.ts` and pass what it needs (the `secrets` seam is `SecretPresence`). If the real `startSnapshot` needs more deps than listed (check `HomeSnapshotDeps`), supply them from `home-snapshot.test.ts`'s own `deps()` helper. The bindings assertion checks what materialize writes in this checkout's format: run `rt skills materialize` once by hand on a converted fixture, read the file, and pin the real shape (the `widgets:board-review` id must appear).

- [ ] **Step 2: Run to verify it fails**

Run: `bun test commands/__tests__/member-upgrade.test.ts`
Expected: FAIL on whichever piece is still missing; if Tasks 1 to 9 are all merged, it should PASS. A failure here is a real integration gap: read the step detail in `events` before touching the test.

- [ ] **Step 3: Add the second order**

```ts
describe("member upgrade: org main converts first, app updates later", () => {
  test("one update run lands everything", async () => {
    const { clone, bindings } = legacyMemberHome();
    convertOrigin();
    git(clone, ["pull", "-q", "--ff-only"]);
    const events: ApplyEvent[] = [];
    const p = probes();
    const run = await runUpdate(await context(p, events, { update: true }));
    expect(run.failedSteps).toEqual([]);
    const states = Object.fromEntries(run.outcomes.map((o) => [o.id, o.state]));
    expect(states["org.folder"]).toBe("done");
    expect(states["skills.materialize"]).toBe("done");
    expect(states["plugins.install"]).toBe("done");
    expect(Object.values(states)).not.toContain("needs-you");
    const moved = join(home, ".mattstack", "orgs", "acme");
    expect(existsSync(join(moved, "mattstack", "teams", "widgets", "plugin"))).toBe(true);
    expect(installed.get("widgets@widgets")?.version).toBe("0.1.1");
    expect(JSON.parse(readFileSync(bindings, "utf8"))).toMatchObject({ "board-review": expect.stringContaining("widgets:board-review") });
    expect(readSetupState(p).migrations).toContain("2026-10-07-sdm-resources-key");
    const rows = await rtHealthRows(p, { ci: false });
    expect(rows.find((r) => r.id === "org.layout")?.status).toBe("ready");
    expect(rows.find((r) => r.id === "org.folder")?.status).toBe("ready");
    expect(rows.find((r) => r.id === "team.sync")?.status).not.toBe("error");
    const orgRowsDrawn = (await composePlan({ p, secrets: { has: async () => null }, ci: false, mode: "status", orgs: ["acme"] })).groups.flatMap((g) => g.rows);
    expect(orgRowsDrawn.filter((r) => ["team.identity", "team.none"].includes(r.id) && r.status === "needs-you").map((r) => r.id)).toEqual([]);
  });
});
```

`beforeEach`: `home = realpathSync(mkdtempSync(join(tmpdir(), "rt-member-upgrade-")))`, `process.env.HOME = home`, `marketplaces.clear()`, `installed.clear()`, `execCalls = []`, `seedOrigin()`. `afterEach`: restore HOME, `rmSync(home, ...)`.

- [ ] **Step 4: Run both orders**

Run: `bun test commands/__tests__/member-upgrade.test.ts`
Expected: PASS, both orders.

- [ ] **Step 5: Commit**

```bash
git add commands/__tests__/member-upgrade.test.ts
git commit -m "test: member upgrade end to end in both orders"
```

---

### Task 11: Docs and gates

**Files:**
- Modify: `AGENTS.md` (one paragraph on the layout gate, in "Settings architecture" after the org-clone paragraph)
- Modify: `docs/settings-architecture.md` (the marker paragraph at line 65)
- Test: `bun run typecheck`, `bun run check`

- [ ] **Step 1: AGENTS.md**

After the paragraph that starts "The branch an org clone has checked out", add:

> The org marker carries a layout version (`layout` in `mattstack/mattstack.jsonc`; absent reads as 2 for `role: "org"` and 1 for the one-team `role: "team"`). `ORG_LAYOUT` in `lib/team/org-marker.ts` is the highest layout this rt reads and moves only with a breaking change to the repo's shape, never with a release. `orgLayoutState` (`lib/team/org-layout.ts`) is the one classifier every reader uses: a clone on another layout is a `waiting` state, so materialize writes nothing, the skills verbs refuse with the waiting sentence, the migrations that read the org skip honestly, and `rt setup status` draws the `org.layout` row. The daemon's team pull holds a clone whose fetched tip is above `ORG_LAYOUT` (`layoutGate` in `lib/daemon/home-snapshot.ts`), so an older app never fast-forwards onto a layout it cannot read; the next breaking layout bumps `ORG_LAYOUT`, writes `layout: 3` in the conversion commit, and every older rt holds while every newer one converts. After every team pull that moves a clone the daemon runs `convergePackCache`, the intercept hook and `createMaterializePullHook` (`composePullHooks` in `lib/daemon/pull-hooks.ts`), so a pulled pack, project list or layout change reaches the board without a launch.

- [ ] **Step 2: docs/settings-architecture.md**

Extend the marker paragraph at line 65 with one sentence: "The marker also carries the org's layout version (`layout`, read by `orgLayoutState`); an rt reads layouts up to `ORG_LAYOUT` and the daemon holds a clone whose `main` moved past that until the app updates."

- [ ] **Step 3: Run the static gates**

Run: `bun run typecheck && bun run check`
Expected: both exit 0. Fix anything they name before committing.

- [ ] **Step 4: Run every targeted test once more**

Run: `bun test lib/team/__tests__ lib/setup/__tests__/apply.test.ts lib/setup/__tests__/migration-sdm-resources-key.test.ts lib/setup/__tests__/skills-materialize.test.ts lib/setup/__tests__/validators-rt-health.test.ts lib/setup/__tests__/steps-org.test.ts lib/daemon/__tests__/team-snapshots.test.ts lib/daemon/__tests__/materialize-pull-hook.test.ts lib/daemon/__tests__/pull-hooks.test.ts lib/daemon/__tests__/home-snapshot.test.ts commands/__tests__/member-upgrade.test.ts commands/__tests__/onboarding-org.test.ts commands/__tests__/setup-update.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md docs/settings-architecture.md
git commit -m "docs: the org layout version, the pull gate and the post-pull chain"
```
