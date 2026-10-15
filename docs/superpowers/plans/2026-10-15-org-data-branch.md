# Org data branch (plan 2 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move an org's data onto its own from-scratch branch with a pointer on `main`, give each Mac a one-branch sparse clone of only what its role reaches, auto-commit only on an approved branch, and add trial branches for layout work.

**Architecture:** Layout 4 keeps today's paths and adds `dataBranch` to the marker (plan 1 Task 9 already parses it and provides `dataBranchOf`). The daemon's layout gate gains a "moved" verdict that holds a pull of `main` once `main` names a data branch, and one function, `moveCloneToDataBranch`, switches a clone in place; the `org.folder` step, `rt team pull` and the daemon all call it. The sparse cone is computed from the role and the roster after every pull. Join, invite and create learn the data branch; a script converts an existing org.

**Tech Stack:** Bun, TypeScript, bun:test, git (sparse-checkout cone mode, single-branch clones).

**Spec:** `docs/superpowers/specs/2026-10-15-org-data-branch-and-roles-design.md` (sections "The data branch", "Create and join", "Conversion", "Testing"). Depends on plan 1 (`docs/superpowers/plans/2026-10-15-org-roles.md`), which must be merged first. Runs in parallel with plans 3 and 4.

## Global Constraints

- Runs in its own worktree on its own branch, in parallel with plans 3 (forge access) and 4 (admin-only secrets). In `lib/team/invite.ts` and `lib/team/join.ts`, change only branch and clone logic; plan 4 edits their switchboard token reading. In `commands/team.ts` and `lib/command-tree-def.ts`, add new verbs only.
- Use plan 1's `dataBranchOf` and `MarkerState.dataBranch`; never parse `dataBranch` a second way.
- Never hard-code `main` for the org clone's data; `main` is named only where the pointer is read or written.
- Layouts 3 and 4 are both readable by this rt: the paths are identical, so a layout 3 clone keeps working until its org converts. `ORG_LAYOUT` is 4.
- A clone with uncommitted changes is never switched, re-coned or reset: git's own refusal plus an explicit status check keep the edit, and the `org.layout` row names the files.
- Every git command that reaches the remote goes through `gitWithToken` and has its output passed through `withoutUrls` before it is logged or shown.
- No em or en dashes. Public repo: placeholders only (`acme`, `widgets`, `dev1`). Output copy follows AGENTS.md's output layer rules.
- Run bun tests from the repo root. Commit after each task, only the files it touched.

## Review Focus

1. A member's clone that has unpushed commits on `main` when the pointer lands: the move must not discard them. Expected: held, with the `org.layout` row saying to run `rt team publish` first (Task 3 test).
2. A trial data branch made with `--no-pointer` must never be offered to joiners: invite checks against `main`'s pointer, not the clone's own marker (Task 8 test).
3. A team removed from a member's roster while they have edits in that folder: the folder stays, with a row naming it (Task 4 test).
4. An older rt joining with an invite after conversion clones `main`, sees layout 4 and waits; a new rt with an old invite (no `dataBranch`) reads `main`'s pointer and clones the data branch (Task 9 tests).
5. `main` moving between the script making the data branch and the pointer landing: the script re-copies the org files so nothing is lost (Task 11 test).

---

### Task 1: Layout 4, with layout 3 still readable

**Files:**
- Modify: `lib/team/org-marker.ts` (`ORG_LAYOUT`, new `READABLE_LAYOUTS`)
- Modify: `lib/team/org-layout.ts` (`pickedCloneReady`)
- Test: `lib/team/__tests__/org-layout.test.ts`

**Interfaces:**
- Produces: `ORG_LAYOUT = 4`; `READABLE_LAYOUTS: readonly number[] = [3, 4]`; `pickedCloneReady` true for a clone with its store on any readable layout.

- [ ] **Step 1: Write the failing tests**

```ts
test("layouts 3 and 4 are both ready; 2 and 5 wait", () => {
  expect(pickedCloneReady({ layout: 3, hasStore: true })).toBe(true);
  expect(pickedCloneReady({ layout: 4, hasStore: true })).toBe(true);
  expect(pickedCloneReady({ layout: 2, hasStore: true })).toBe(false);
  expect(pickedCloneReady({ layout: 5, hasStore: true })).toBe(false);
  expect(pickedCloneReady({ layout: 4, hasStore: false })).toBe(false);
});
test("a tip on layout 4 is not above this rt; 5 is", () => {
  expect(layoutAbove({ code: 0, stdout: '{"role":"org","org":"acme","layout":4}', stderr: "" })).toBeNull();
  expect(layoutAbove({ code: 0, stdout: '{"role":"org","org":"acme","layout":5}', stderr: "" })).toEqual({ layout: 5 });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/team/__tests__/org-layout.test.ts`
Expected: FAIL (layout 4 waits; 3 is not ready once ORG_LAYOUT moves).

- [ ] **Step 3: Implement**

`org-marker.ts`: `export const ORG_LAYOUT = 4;` and

```ts
/** Layouts this rt reads. 3 and 4 share every path; 4 only adds the data branch. */
export const READABLE_LAYOUTS: readonly number[] = [3, 4];
```

`org-layout.ts`:

```ts
export function pickedCloneReady(picked: { layout: number; hasStore: boolean }): boolean {
  return picked.hasStore && READABLE_LAYOUTS.includes(picked.layout);
}
```

Fix existing tests that assumed `ORG_LAYOUT === 3` (search `rg "ORG_LAYOUT|layout: 3" lib/team/__tests__ lib/setup/__tests__ lib/daemon/__tests__`). `rt team create` keeps writing `ORG_LAYOUT` (now 4); Task 10 adds `dataBranch` to what it writes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/team/__tests__/ lib/setup/__tests__/ lib/daemon/__tests__/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/team/org-marker.ts lib/team/org-layout.ts lib/team/__tests__ lib/setup/__tests__ lib/daemon/__tests__
git commit -m "org layout 4; layout 3 stays readable"
```

---

### Task 2: The layout gate's "moved" verdict

**Files:**
- Modify: `lib/team/org-layout.ts` (new `gateVerdict`)
- Modify: `lib/daemon/home-snapshot.ts` (`layoutGate`, the `pull.gate` type, `doPull`'s hold handling, new `pull.onMoved`)
- Test: `lib/team/__tests__/org-layout.test.ts`, `lib/daemon/__tests__/home-snapshot-pull.test.ts` (the existing pull/gate test file; `rg -l "layoutGate|gate:" lib/daemon/__tests__`)

**Interfaces:**
- Produces: `type GateVerdict = { kind: "above"; layout: number } | { kind: "moved"; dataBranch: string }`; `gateVerdict(shown, checkedOut: string): GateVerdict | null`; `layoutGate(exec, repoDir, ref, checkedOut): Promise<GateVerdict | null>`; `SnapshotSpec.pull.onMoved?: (dataBranch: string) => Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```ts
const shown = (marker: object) => ({ code: 0, stdout: JSON.stringify(marker), stderr: "" });
test("main naming another data branch is a move", () => {
  expect(gateVerdict(shown({ role: "org", org: "acme", layout: 4, dataBranch: "mattstack" }), "main")).toEqual({ kind: "moved", dataBranch: "mattstack" });
});
test("a clone already on its data branch passes", () => {
  expect(gateVerdict(shown({ role: "org", org: "acme", layout: 4, dataBranch: "mattstack" }), "mattstack")).toBeNull();
});
test("a layout above this rt still holds as before", () => {
  expect(gateVerdict(shown({ role: "org", org: "acme", layout: 5 }), "main")).toEqual({ kind: "above", layout: 5 });
});
test("no dataBranch on layout 4 or below passes", () => {
  expect(gateVerdict(shown({ role: "org", org: "acme", layout: 3 }), "main")).toBeNull();
});
```

In the snapshot pull test: a fetched tip whose marker names another data branch holds the pull (no fast-forward, `HEAD` unchanged, the working tree keeps the org files), reports `detail` = `"Your org's data moved to the mattstack branch. rt switches this Mac over when your copy has no unsaved changes."`, and calls `onMoved("mattstack")` once per distinct verdict.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/team/__tests__/org-layout.test.ts lib/daemon/__tests__/home-snapshot-pull.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`org-layout.ts`:

```ts
export type GateVerdict = { kind: "above"; layout: number } | { kind: "moved"; dataBranch: string };

export const MOVED_SENTENCE = (branch: string) => `Your org's data moved to the ${branch} branch. rt switches this Mac over when your copy has no unsaved changes.`;

/** What a pull must do given the marker at the fetched tip and the branch this clone has checked out. */
export function gateVerdict(shown: { code: number; stdout: string; stderr: string }, checkedOut: string): GateVerdict | null {
  const above = layoutAbove(shown);
  if (above) return { kind: "above", layout: above.layout };
  if (shown.code !== 0) return null;
  const marker = parseMarker(shown.stdout);
  if (marker.kind === "org" && marker.dataBranch !== null && marker.dataBranch !== checkedOut) return { kind: "moved", dataBranch: marker.dataBranch };
  return null;
}
```

`home-snapshot.ts`: `layoutGate` takes `checkedOut` and returns `gateVerdict(...)`. In `teamSnapshotSpec`, `gate: (ref, branch) => layoutGate(opts.probes.exec, repoDir, ref, branch)` and `onMoved: opts.onMoved`. In `doPull`, pass `branch` to `spec.pull.gate(ref, branch)`; an `above` verdict keeps today's `layoutHold` path unchanged; a `moved` verdict returns `{ outcome: "skipped", detail: MOVED_SENTENCE(v.dataBranch), hold: ... }` without merging, logs once per distinct branch (as the layout hold logs once per layout), and then awaits `spec.pull.onMoved?.(v.dataBranch)` outside the git lock (the same way `onPulled` runs). Extend the `hold` field's type to carry `{ moved: string }` beside `{ layout, reads }`; every reader of `hold` (`rg "\.hold\b|layoutHold" lib`) treats a `moved` hold as held, with `MOVED_SENTENCE` as its words.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/team/__tests__/ lib/daemon/__tests__/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/team/org-layout.ts lib/daemon/home-snapshot.ts lib/team/__tests__/org-layout.test.ts lib/daemon/__tests__
git commit -m "layout gate: a main that names another data branch holds the pull"
```

---

### Task 3: Moving a clone onto its data branch

**Files:**
- Create: `lib/team/org-data-branch.ts`
- Test: `lib/team/__tests__/org-data-branch.test.ts` (real git in temp dirs: a bare origin, a layout 3 clone)

**Interfaces:**
- Consumes: `gitWithToken` (`lib/team/publish.ts` or its home; `rg "export function gitWithToken" lib`), `withoutUrls`, `Probes`.
- Produces:

```ts
export type MoveResult =
  | { kind: "moved"; branch: string }
  | { kind: "already"; branch: string }
  | { kind: "held"; why: "dirty"; files: string[] }
  | { kind: "held"; why: "unpushed"; commits: number }
  | { kind: "failed"; log: string };

export async function moveCloneToDataBranch(p: Pick<Probes, "exec">, dir: string, branch: string, token: string | null, remote: string): Promise<MoveResult>;
```

- [ ] **Step 1: Write the failing tests**

```ts
test("a clean layout 3 clone moves in place to the data branch", async () => {
  // origin: main with the pointer marker (layout 4, dataBranch mattstack); branch mattstack with the org files
  const r = await moveCloneToDataBranch(p, clone, "mattstack", null, origin);
  expect(r).toEqual({ kind: "moved", branch: "mattstack" });
  expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("mattstack");
  expect(git(clone, "config", "--get-all", "remote.origin.fetch")).toBe("+refs/heads/mattstack:refs/remotes/origin/mattstack");
  expect(existsSync(join(clone, "mattstack/org/settings.org.jsonc"))).toBe(true);
});
test("a clone with an unsaved edit is held and keeps it", async () => {
  writeFileSync(join(clone, "mattstack/teams/widgets/settings.team.jsonc"), "{ /* edit */ }");
  const r = await moveCloneToDataBranch(p, clone, "mattstack", null, origin);
  expect(r).toEqual({ kind: "held", why: "dirty", files: ["mattstack/teams/widgets/settings.team.jsonc"] });
  expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("main");
});
test("a clone with commits main never got is held", async () => {
  // commit locally on main, do not push
  expect(await moveCloneToDataBranch(p, clone, "mattstack", null, origin)).toEqual({ kind: "held", why: "unpushed", commits: 1 });
});
test("a clone already on the branch is left alone", async () => {
  await moveCloneToDataBranch(p, clone, "mattstack", null, origin);
  expect(await moveCloneToDataBranch(p, clone, "mattstack", null, origin)).toEqual({ kind: "already", branch: "mattstack" });
});
test("a branch the remote lacks fails without changing the clone", async () => {
  expect((await moveCloneToDataBranch(p, clone, "nope", null, origin)).kind).toBe("failed");
  expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("main");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/team/__tests__/org-data-branch.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
/**
 * Switches an org clone, in place, onto the branch its org's data lives on.
 * The two branches share no history, so this is a checkout of an unrelated
 * branch, never a merge; a clone with anything unsaved or unpushed is held.
 */

import { withoutUrls } from "../url-redact.ts"; // the module that exports withoutUrls today
import type { Probes } from "../setup/probes.ts";
import { checkedOutBranch } from "./org-branch.ts";
import { gitWithToken } from "./git-token.ts"; // wherever gitWithToken lives today

const ENV = { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };

export async function moveCloneToDataBranch(p: Pick<Probes, "exec">, dir: string, branch: string, token: string | null, remote: string): Promise<MoveResult> {
  const current = await checkedOutBranch(p, dir);
  if (current === branch) return { kind: "already", branch };
  const status = await p.exec(["git", "status", "--porcelain=v1", "--untracked-files=no"], { cwd: dir });
  if (status.code !== 0) return { kind: "failed", log: withoutUrls(status.stderr) };
  const files = status.stdout.split("\n").filter(Boolean).map((line) => line.slice(3));
  if (files.length > 0) return { kind: "held", why: "dirty", files };
  if (current !== null) {
    const ahead = await p.exec(["git", "rev-list", "--count", `refs/remotes/origin/${current}..HEAD`], { cwd: dir });
    const commits = ahead.code === 0 ? Number(ahead.stdout.trim()) : 0;
    if (commits > 0) return { kind: "held", why: "unpushed", commits };
  }
  const refspec = `+refs/heads/${branch}:refs/remotes/origin/${branch}`;
  const fetch = gitWithToken(["fetch", "-q", "origin", refspec], token, ENV, { remote });
  const fetched = await p.exec(fetch.argv, { cwd: dir, env: fetch.env });
  if (fetched.code !== 0) return { kind: "failed", log: withoutUrls(`${fetched.stdout}\n${fetched.stderr}`.trim()) };
  const checkout = await p.exec(["git", "checkout", "-q", "-B", branch, `refs/remotes/origin/${branch}`], { cwd: dir, env: ENV });
  if (checkout.code !== 0) return { kind: "failed", log: withoutUrls(checkout.stderr) };
  await p.exec(["git", "branch", "-q", "--set-upstream-to", `origin/${branch}`], { cwd: dir });
  await p.exec(["git", "config", "--replace-all", "remote.origin.fetch", refspec], { cwd: dir });
  return { kind: "moved", branch };
}
```

Fix the two import paths to wherever `withoutUrls` and `gitWithToken` live (`rg "export function (withoutUrls|gitWithToken)" lib`). The old local `main` branch is left in place: it costs nothing and is a way back. The sparse cone is reapplied by the callers (Task 5) through Task 4's `applyRoleCone`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/team/__tests__/org-data-branch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/team/org-data-branch.ts lib/team/__tests__/org-data-branch.test.ts
git commit -m "moveCloneToDataBranch: switch an org clone in place, holding anything unsaved"
```

---

### Task 4: The sparse cone follows the role

**Files:**
- Create: `lib/team/org-cone.ts`
- Modify: `lib/daemon/team-snapshots.ts` (`createOnPulled` reapplies the cone after a pull that moves the clone)
- Test: `lib/team/__tests__/org-cone.test.ts`

**Interfaces:**
- Consumes: `roleOf`, `isOrgAdmin` (plan 1), `readOrgRoster`/`rosterFrom`, `ORG_CLONE_FOLDERS` (`lib/team/org-clone.ts`).
- Produces: `coneFor(role: OrgRole, listedOn: string[]): string[]` (pure); `applyRoleCone(p: Pick<Probes, "exec" | "readFile" | "home">, dir: string, org: string): Promise<{ applied: string[]; kept: string[] }>`, where `kept` lists team folders left checked out because they hold unsaved or unpushed changes.

- [ ] **Step 1: Write the failing tests**

```ts
test("org owners and admins get every folder", () => {
  expect(coneFor({ kind: "org-owner" }, [])).toEqual([".claude-plugin", "mattstack"]);
  expect(coneFor({ kind: "admin" }, ["widgets"])).toEqual([".claude-plugin", "mattstack"]);
});
test("a member or team owner gets the org files and their own teams", () => {
  expect(coneFor({ kind: "member" }, ["widgets"])).toEqual([".claude-plugin", "mattstack/mattstack.jsonc", "mattstack/org", "mattstack/teams/widgets"]);
  expect(coneFor({ kind: "owner", teams: ["gadgets"] }, ["gadgets", "widgets"])).toEqual([".claude-plugin", "mattstack/mattstack.jsonc", "mattstack/org", "mattstack/teams/gadgets", "mattstack/teams/widgets"]);
});
test("someone on no team gets only the org files", () => {
  expect(coneFor({ kind: "member" }, [])).toEqual([".claude-plugin", "mattstack/mattstack.jsonc", "mattstack/org"]);
});
```

Cone mode takes directories, not files: confirm while implementing that `git sparse-checkout set --cone mattstack/org` keeps `mattstack/mattstack.jsonc` (cone mode keeps every file directly under each parent of a listed directory, so `mattstack/*` files stay). If it does, drop `mattstack/mattstack.jsonc` from `coneFor`'s output and from these expectations.

`applyRoleCone` against a real clone: a member on `widgets` loses `mattstack/teams/gadgets` from the working tree; with an unsaved edit in `gadgets`, the folder stays and `kept` is `["gadgets"]`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/team/__tests__/org-cone.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
export function coneFor(role: OrgRole, listedOn: string[]): string[] {
  if (isOrgAdmin(role)) return [...ORG_CLONE_FOLDERS];
  const teams = [...new Set(listedOn)].filter((t) => TEAM_NAME_RE.test(t)).sort();
  return [".claude-plugin", "mattstack/mattstack.jsonc", "mattstack/org", ...teams.map((t) => `mattstack/teams/${t}`)];
}
```

`applyRoleCone`: read the role (`roleOf(readTeamLocal(...).forgeUsername, rolesFor(...))`) and `listedOn` from the clone's own org store; for each team folder currently checked out but absent from the new cone, check `git status --porcelain -- mattstack/teams/<t>` and `git log origin/<branch>..HEAD -- mattstack/teams/<t>`; keep it in the cone when either is non-empty. Then `git sparse-checkout set --cone <dirs>`. Call it from `createOnPulled` after every pull that moved the clone; Task 5's `convergeDataBranch` and Task 9's join call it too. A non-empty `kept` surfaces on the `org.layout` row as `needs-you`: "You're no longer on <team>, but your copy has changes there. Publish or discard them and rt removes the folder."

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/team/__tests__/org-cone.test.ts lib/daemon/__tests__/team-snapshots.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/team/org-cone.ts lib/team/__tests__/org-cone.test.ts lib/daemon/team-snapshots.ts
git commit -m "each Mac checks out only the teams its role reaches"
```

---

### Task 5: Who runs the move

**Files:**
- Modify: `lib/setup/steps/org-folder.ts` (a new data-branch piece after the folder piece)
- Modify: `lib/daemon/team-snapshots.ts` (pass `onMoved` into `teamSnapshotSpec`)
- Modify: `lib/setup/validators/` (the `org.layout` row; `rg -l "org.layout" lib/setup/validators`)
- Modify: `lib/daemon/handlers/team-snapshot.ts` (`team:pull` runs the move when the hold is a `moved` one)
- Test: `lib/setup/__tests__/steps-org-folder.test.ts`, `lib/daemon/__tests__/team-snapshots.test.ts`, the `org.layout` validator test

**Interfaces:**
- Consumes: `moveCloneToDataBranch` (Task 3), `applyRoleCone` (Task 4), `gateVerdict` / `MOVED_SENTENCE` (Task 2).
- Produces: `convergeDataBranch(p: Probes, dir: string): Promise<MoveResult | null>` in `lib/team/org-data-branch.ts`: when the clone is on a branch whose marker names no `dataBranch` (a layout 3 clone, on `main`), fetches `origin/<that branch>` with `gitWithToken` and reads its marker with `gateVerdict` (Task 2); on a `moved` verdict runs the move, then `applyRoleCone`. Null when there is nothing to move.

- [ ] **Step 1: Write the failing tests**

- `org.folder` step: a layout 3 clone whose origin `main` now holds the pointer is moved during `rt setup update`; the step outcome detail is `"Moved your copy of the org to the mattstack branch"`.
- `org.folder` step: a dirty clone is not moved; outcome `needs-you` naming the files, remedy `"Save or discard those changes, then run rt team pull"`.
- daemon: a `moved` hold calls the move once the clone is clean; a dirty clone stays held and the next pull after it is cleaned moves it.
- `team:pull`: on a `moved` hold, runs the move and returns `{ outcome: "moved", detail: "Moved your copy of the org to the mattstack branch" }`.
- `org.layout` row: a `moved` hold on a dirty clone reads `needs-you` with the files and the `rt team pull` remedy; an unpushed hold names `rt team publish` first.

- [ ] **Step 2: Run them to verify they fail**

Run each test file listed above.
Expected: FAIL.

- [ ] **Step 3: Implement**

Write `convergeDataBranch` in `org-data-branch.ts` as described in Interfaces. Wire:
- `org-folder.ts`: after the folder and marketplace pieces, for the picked clone, call `convergeDataBranch`; map `moved` to a `done` piece, `held` to `needs-you` with the remedy above, `failed` to the step's failed outcome with the log.
- `team-snapshots.ts`: build each team spec with `onMoved: async () => { await convergeDataBranch(probes, dir); }`, then let the next scheduled pull continue on the new branch (the engine reads the checked-out branch on every pull).
- `team:pull`: when the result carries a `moved` hold, call `convergeDataBranch` and return its outcome; the `PullResult` type gains `"moved"` (update `lib/daemon/handlers/types.ts` line ~131 and the CLI's `teamPull` copy).
- The `org.layout` validator reads the hold and prints the sentences above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/setup/__tests__/ lib/daemon/__tests__/ lib/team/__tests__/`
Expected: PASS. Then `bun test commands/__tests__/setup-copy.test.ts --update-snapshots` only if the new copy is the reason it fails, and review the snapshot diff.

- [ ] **Step 5: Commit**

```bash
git add lib/team/org-data-branch.ts lib/setup lib/daemon commands/team.ts
git commit -m "move a held clone to its data branch from org.folder, team pull and the daemon"
```

---

### Task 6: Auto-commit only on an approved branch

**Files:**
- Modify: `lib/team/team-local.ts` (`TeamLocalRecord.trialBranch?: string`)
- Modify: `lib/daemon/home-snapshot.ts` (`teamSnapshotSpec.readAuthorization`)
- Create: `lib/team/approved-branch.ts`
- Modify: `lib/setup/validators/` (new `org.branch` row beside `org.layout`)
- Test: `lib/team/__tests__/approved-branch.test.ts`, the snapshot spec test, the validator test

**Interfaces:**
- Consumes: `MarkerState.dataBranch` (plan 1).
- Produces: `approvedBranches(p: Pick<Probes, "readFile" | "home">, slug: string, dir: string): string[]` (sync: the marker's `dataBranch`, else `"main"` for a pre-layout-4 clone, plus `trialBranch`); `currentBranchSync(dir: string): string | null` (reads `.git/HEAD`).

- [ ] **Step 1: Write the failing tests**

```ts
test("the data branch and a recorded trial are approved", () => {
  expect(approvedBranches(pWith({ dataBranch: "mattstack", trialBranch: "mattstack-layout-5" }), "acme", dir)).toEqual(["mattstack", "mattstack-layout-5"]);
});
test("a pre-layout-4 clone approves main", () => {
  expect(approvedBranches(pWith({}), "acme", dir)).toEqual(["main"]);
});
test("currentBranchSync reads HEAD and is null when detached", () => {
  writeFileSync(join(dir, ".git/HEAD"), "ref: refs/heads/mattstack\n");
  expect(currentBranchSync(dir)).toBe("mattstack");
  writeFileSync(join(dir, ".git/HEAD"), "0123abcd\n");
  expect(currentBranchSync(dir)).toBeNull();
});
```

Snapshot spec: on an unapproved branch, `readAuthorization()` returns `pullOnly: true` and `scope` false for every path; on the data branch, today's behaviour. Validator: `org.branch` reads `needs-you` with `"Auto-commit is paused: your copy of the org is on <branch>."` and remedy `rt team branch use <dataBranch>`; `ready` on an approved branch.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/team/__tests__/approved-branch.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`approved-branch.ts` holds both functions (read `.git/HEAD` with `readFileSync`; `ref: refs/heads/<name>` gives the name). In `readAuthorization`, first `const branch = currentBranchSync(repoDir); if (branch === null || !approvedBranches(opts.probes, slug, repoDir).includes(branch)) return { scope: () => false, pullOnly: true };`. Deliberate verbs (`rt skills sync`, `rt team publish`) are not changed. Add `org.branch` following an existing validator and its `steps-*.test.ts` twin (AGENTS.md "Setup checklist rows"); it is neither required nor finish-gated.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/team/__tests__/ lib/daemon/__tests__/ lib/setup/__tests__/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/team/approved-branch.ts lib/team/team-local.ts lib/daemon/home-snapshot.ts lib/setup lib/team/__tests__/approved-branch.test.ts
git commit -m "daemon auto-commits only on the data branch or a chosen trial branch"
```

---

### Task 7: `rt team branch use`

**Files:**
- Modify: `lib/command-tree-def.ts` (new `team.branch.use`)
- Modify: `commands/team.ts` (new `teamBranchUse`)
- Create: `lib/team/trial-branch.ts`
- Test: `lib/team/__tests__/trial-branch.test.ts`, `commands/__tests__/team-branch.test.ts`

**Interfaces:**
- Consumes: `moveCloneToDataBranch` (Task 3, it switches to any remote branch), `dataBranchOf`, `isOrgAdmin`, `updateTeamLocal`.
- Produces: `useBranch(p, slug, name): Promise<{ branch: string; created: boolean; trial: boolean }>`.

- [ ] **Step 1: Write the failing tests**

- An admin on `mattstack` runs `useBranch(p, "acme", "mattstack-layout-5")`: the branch is created from `mattstack`, pushed, checked out, and `trialBranch` is recorded; `created: true, trial: true`.
- The same name existing on the remote (a `--no-pointer` trial from the script) is fetched and switched to with unrelated history; `created: false`.
- `useBranch(p, "acme", "mattstack")` (the data branch) clears `trialBranch`; `trial: false`.
- A team owner or member is refused: `"Only an org admin switches the org to a trial branch"`.
- A dirty clone is held with the files named (Task 3's result).

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/team/__tests__/trial-branch.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`useBranch`: refuse unless `isOrgAdmin(roleFor(p, slug))`; `ls-remote` the name; if absent, `git branch <name>` from the current data branch tip and push it with `gitWithToken`; then `moveCloneToDataBranch(p, dir, name, token, remote)`; then `applyRoleCone` (Task 4); record or clear `trialBranch` with `updateTeamLocal`. Command tree:

```ts
branch: {
  description: "Choose which branch your copy of the org is on",
  subcommands: {
    use: {
      description: "Switch your copy of the org to a branch, for trying a change before everyone gets it",
      module: "./commands/team.ts",
      fn: "teamBranchUse",
      omitBehavior: { exempt: "a new branch name cannot be enumerated" },
      args: [
        { name: "Branch", type: "text", placeholder: "mattstack-layout-5", hint: "The branch to switch to; created from the org's data branch when it doesn't exist" },
        { name: "Team", flag: "--team", type: "text", placeholder: "acme", hint: "Which org clone; your only one when left out" },
        SETUP_JSON_ARG,
      ],
    },
  },
},
```

`teamBranchUse` prints `out.line("done", "Your copy of the org is on <branch>", trial ? "auto-commit runs here on this Mac only" : undefined)`.

- [ ] **Step 4: Run tests, picker gate and docs**

Run: `bun test lib/team/__tests__/trial-branch.test.ts commands/__tests__/team-branch.test.ts && bun run picker:check && bun run docs:gen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/team/trial-branch.ts commands/team.ts lib/command-tree-def.ts lib/team/__tests__/trial-branch.test.ts commands/__tests__/team-branch.test.ts website/docs/rt/reference/team
git commit -m "rt team branch use: try an org change on a branch of your own"
```

---

### Task 8: Invite reads main's pointer

**Files:**
- Create: `lib/team/main-pointer.ts`
- Modify: `lib/team/invite.ts` (only `pullOrg`'s branch check, `settleTheClash`, and the pointer it seals; leave the switchboard token code to plan 4)
- Test: `lib/team/__tests__/main-pointer.test.ts`, `lib/team/__tests__/invite.test.ts`

**Interfaces:**
- Produces: `readMainPointer(p: Pick<Probes, "exec" | "mkdtemp" | "removeDir">, remote: string, token: string | null): Promise<{ dataBranch: string | null; layout: number } | null>`; the sealed invite pointer gains optional `dataBranch?: string`.

- [ ] **Step 1: Write the failing tests**

- `readMainPointer` against a bare origin whose `main` has the layout 4 pointer returns `{ dataBranch: "mattstack", layout: 4 }`; with a layout 3 marker, `{ dataBranch: null, layout: 3 }`; with no marker, `null`.
- Invite on the data branch seals `dataBranch: "mattstack"`.
- Invite on a trial branch made by `--no-pointer` (its own marker names the trial) is refused: `"Your copy of the org is on mattstack-trial, so rt made no invite"`, why `"The people you invite clone mattstack. Switch to it to invite."`, next `rt team branch use mattstack`.
- An org with no pointer (layout 3) keeps today's rule: invite only from `main`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/team/__tests__/main-pointer.test.ts lib/team/__tests__/invite.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`readMainPointer`: make a temp dir, `git init -q --bare`, then through `gitWithToken`: `git -C <tmp> fetch -q --depth 1 --filter=blob:none <remote> main`, then `git -C <tmp> show FETCH_HEAD:mattstack/mattstack.jsonc`, parse with `parseMarker`, remove the temp dir in `finally`. In `pullOrg`, replace the `branch !== "main"` check with: `const pointer = await readMainPointer(...); const wanted = pointer?.dataBranch ?? "main"; if (branch !== wanted) throw ...` (copy above), and pass `wanted` into `settleTheClash` in place of the literal `main`. Seal `dataBranch: pointer?.dataBranch ?? undefined` into the invite pointer; it is optional, so `INVITE_POINTER_VERSION` does not change.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/team/__tests__/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/team/main-pointer.ts lib/team/invite.ts lib/team/__tests__/main-pointer.test.ts lib/team/__tests__/invite.test.ts
git commit -m "invite checks the branch against main's pointer and seals the data branch"
```

---

### Task 9: Join clones the data branch

**Files:**
- Modify: `lib/team/join.ts` (only the clone block around lines 560-580)
- Test: `lib/team/__tests__/join.test.ts`

**Interfaces:**
- Consumes: `readMainPointer` (Task 8), `applyRoleCone` (Task 4).

- [ ] **Step 1: Write the failing tests**

- An invite carrying `dataBranch: "mattstack"`: join runs `git clone --sparse --single-branch --branch mattstack`, then `applyRoleCone`; the clone is on `mattstack` and holds only the joiner's teams.
- An invite with no `dataBranch` against an org whose `main` holds a pointer: join reads it with `readMainPointer` and clones `mattstack`.
- An invite with no `dataBranch` against a layout 3 org: join clones as today (`--sparse`, default branch, `ORG_CLONE_FOLDERS` cone).

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/team/__tests__/join.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Before the clone: `const branch = pointer.dataBranch ?? (await readMainPointer(p, pointer.remote, token))?.dataBranch ?? null;`. Clone argv becomes `["clone", "--sparse", ...(branch ? ["--single-branch", "--branch", branch] : []), pointer.remote, dir]`. Keep the existing `sparse-checkout set --cone ...ORG_CLONE_FOLDERS` step for the initial checkout (the roster is not readable until the clone exists), then call `applyRoleCone(p, dir, org)` after `clonedOrgName` succeeds; a cone failure there is a warning, not a join failure, since the full cone is a working state.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/team/__tests__/join.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/team/join.ts lib/team/__tests__/join.test.ts
git commit -m "join clones only the org's data branch, then narrows to the joiner's teams"
```

---

### Task 10: Create makes the data branch and the pointer

**Files:**
- Modify: `lib/team/create.ts` (around `git init -b main`, line ~397)
- Test: `lib/team/__tests__/create.test.ts`

- [ ] **Step 1: Write the failing tests**

- `rt team create` against an empty origin pushes two branches: `mattstack`, holding the org files and a layout 4 marker with `dataBranch: "mattstack"`, and `main`, holding only that marker. The local clone is on `mattstack` with the one-branch refspec.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/team/__tests__/create.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`git init -b mattstack` (the name `DEFAULT_DATA_BRANCH = "mattstack"`, exported from `org-data-branch.ts`); write the marker with `layout: ORG_LAYOUT, dataBranch: DEFAULT_DATA_BRANCH`; commit and push as today. Then make `main` from scratch: `git checkout -q --orphan main`, `git rm -rq --cached .`, write only `mattstack/mattstack.jsonc`, commit, push `main`, `git checkout -q mattstack`, `git branch -D main`, and set the one-branch refspec. Every other create step (roster, roles, secrets, peer) is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/team/__tests__/create.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/team/create.ts lib/team/org-data-branch.ts lib/team/__tests__/create.test.ts
git commit -m "team create starts an org on its own data branch with a pointer on main"
```

---

### Task 11: The conversion script

**Files:**
- Create: `scripts/move-to-data-branch.ts`
- Test: `scripts/__tests__/move-to-data-branch.test.ts`

**Interfaces:**
- Model it on `scripts/move-to-team-directory.ts` (plan by default, `--write` acts, `--admin <username>` required, refuses a clone that is not on layout 3 or is dirty).
- Flags: `--data-branch <name>` (default `mattstack`), `--no-pointer`.

- [ ] **Step 1: Write the failing tests**

- Plan mode prints what it would do and changes nothing.
- `--write` on a layout 3 clone of a repo that also holds `apps/` code: pushes `mattstack` holding exactly `mattstack/`, `.sops.yaml`, `.claude-plugin/`, `.gitignore` and a `README.md` (the never-merge note), with a layout 4 marker naming `mattstack`; then commits the pointer to `main`, deleting those paths and leaving `apps/` untouched, and pushes `main`.
- A refused push of `main` (a protected branch fake: the bare origin with a pre-receive hook that rejects `main`) pushes the pointer commit to `mattstack-pointer` instead and prints that the admin lands it by the repo's own rules.
- `main` changing under `mattstack/` between the data branch push and the pointer commit: the script re-copies the changed files to `mattstack`, pushes, and only then commits the pointer.
- `--no-pointer --data-branch mattstack-trial`: pushes only `mattstack-trial`, whose marker names `mattstack-trial`; `main` is untouched.
- The script prints the forge access grant step last (`rt team access grant`, the verb plan 3 adds; if plan 3 has not merged, print the sentence only).

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test scripts/__tests__/move-to-data-branch.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Work in a temporary worktree of the clone so the admin's own checkout is never disturbed: `git worktree add --detach <tmp>`, `git checkout --orphan <data>`, `git rm -rq --cached .`, copy the four paths from `main`'s tree (`git checkout main -- mattstack .sops.yaml .claude-plugin .gitignore`), write the README and rewrite the marker, commit `"org data moves to its own branch"`, push. Record `main`'s sha. Unless `--no-pointer`: fetch `main`; if `git diff --quiet <recorded> origin/main -- mattstack .sops.yaml .claude-plugin` fails, re-copy and push again; then on a detached `origin/main` worktree, `git rm -rq mattstack .sops.yaml .claude-plugin`, write only the pointer marker, commit `"mattstack: org data lives on the <data> branch"`, push `HEAD:main`, and on rejection push `HEAD:refs/heads/<data>-pointer` and print the landing note. Remove the temp worktrees in `finally`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test scripts/__tests__/move-to-data-branch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/move-to-data-branch.ts scripts/__tests__/move-to-data-branch.test.ts
git commit -m "scripts: move an org's data to its own branch, with a trial mode"
```

---

### Task 12: Docs and the release VM scenarios

**Files:**
- Modify: `skills/rt-settings/SKILL.md` (layout runbook: layout 4's script, `--no-pointer` trials, `rt team branch use`)
- Modify: `.claude/rules/settings.md` and `AGENTS.md`'s org paragraph (the branch an org clone reads is its data branch; invite refuses off it; layouts 3 and 4 readable)
- Modify: the release VM team-join scenario (`rg -l "team join" e2e scripts/vm 2>/dev/null`) to clone the data branch, plus a new scenario: a member's Mac holds only their teams

- [ ] **Step 1: Write the doc and scenario changes**

Follow `superpowers:writing-skills` for the skill edit. The scenario asserts `git -C <clone> sparse-checkout list` names only the member's teams.

- [ ] **Step 2: Check and commit**

Run: `bun run docs:check && scripts/repo-purity.sh`
Expected: PASS.

```bash
git add skills/rt-settings/SKILL.md .claude/rules/settings.md AGENTS.md <scenario files>
git commit -m "docs and VM scenarios: org data branch, sparse checkouts, trial branches"
```
