# Boxscore Viewer Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A team owner sets each roster member to Team view or Self view (the default); a Self view member's boxscore serves and shows only their own person page, with no ranks and no one else's stats.

**Architecture:** A new team-scope-only setting `boxscore.roles` holds the grants. Boxscore resolves the viewer (GitLab `/user`, already fetched) plus this Mac's team membership into a `Viewer { username, role }`, and the shared server core (`buildLeaderboard`/`getUserDetail`) narrows every response for a Self viewer, so the API routes and the CLI report enforce the same rule. The UI keys off `viewer.role` in the response to hide navigation and ranking; console gets a per-member Team/Self control.

**Tech Stack:** Bun, TypeScript, Hono, React 19 + Mantine 9.5 through `@mattstack/app-kit`, wouter, vitest, zod (authoring-only) for setting schemas, Pencil MCP for boards, Fast Browser for parity.

**Spec:** `docs/superpowers/specs/2026-10-06-boxscore-viewer-roles-design.md`

## Global Constraints

- Work only in the worktree `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-mattstack/shadowfax` on branch `boxscore-viewer-roles`. Never the shared checkout.
- Run only targeted tests for the files you touch; the full suite is CI's job. Boxscore tests: `cd apps/boxscore && bun --bun vitest run <file>`. Console tests: `cd apps/console && bun --bun vitest run <file>`. rt-client tests: `bun test packages/rt-client/src/settings/__tests__/<file>` from the repo root (bun reads `bunfig.toml` only from the cwd).
- After any change under `packages/rt-client/src`, run `cd packages/rt-client && bun run build`.
- App code never imports `@mantine/*` directly; use `@mattstack/app-kit/*` barrels. Look Mantine props up (installed `@mantine/core` types) rather than recalling them.
- UI colour and type follow `docs/apps/ui-authoring.md`: role tokens (`--tk-*`), never raw values.
- Comments only state a constraint the code cannot show.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Role values are exactly `"team"` and `"self"`. An unlisted roster member is `"self"`. The owner's Mac (team not joined by invite) and a Mac with no team are always `"team"`.
- A Self view response never carries another person's row, any metric `rank`, or any `leaders` entry.
- Evidence keeps teammates' names (reviewers, MR authors); that is not narrowed.
- No new trend widget on the person page; deltas stay in the response.

## Review Focus

1. **GitLab username case differs from the roster** (`Alice` vs `alice`): the viewer still matches their roster entry and their role; `/user/alice` and `/user/Alice` are both "own page". Pinned in Task 2 and Task 3.
2. **A Self viewer listed in their own `boxscore.hiddenMembers`**: their own page still renders (Self view computes over the viewer alone, ignoring hidden). Pinned in Task 3.
3. **The viewer's row has `resolved: false`** (identity not yet stored): Self view still shows their page rather than Not found. Pinned in Task 6.
4. **A hand-edited invalid role** (`"admin"`, or a non-object): the member is treated as Self view, never Team. Pinned in Task 2.
5. **A Mac with two team clones, one joined**: treated as joined (fail closed: roles apply). Pinned in Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/rt-client/src/settings/registry-defs.ts` | Registry row for `boxscore.roles` |
| `packages/rt-client/src/settings/registry-schemas.ts` | Its zod schema |
| `packages/rt-client/src/settings/__tests__/schema-examples.ts` | Good/bad examples |
| `packages/rt-client/src/settings/__tests__/registry.test.ts` | Key list |
| `packages/rt-client/src/settings/schema.lock.json` | Regenerated lock |
| `packages/rt-client/src/index.ts` | Export `isJoinedTeam` |
| `apps/boxscore/src/server/config/viewer.ts` (new) | Pure `resolveViewer` |
| `apps/boxscore/src/server/config/team.ts` (new) | This Mac's team membership, with a test seam |
| `apps/boxscore/src/server/config/index.ts` | `roles` in `readSettings()` |
| `apps/boxscore/src/server/config/current-user.ts` | `__setCurrentUser` test seam |
| `apps/boxscore/src/server/viewer-scope.ts` (new) | Pure `narrowForViewer`, `canSeeUser`, `ViewerForbiddenError` |
| `apps/boxscore/src/shared/types.ts` | `Viewer`, `ViewerRole`, `viewer` on both responses |
| `apps/boxscore/src/server/metrics/trend.ts` | `viewer` in `BuildContext` and response |
| `apps/boxscore/src/server/leaderboard.ts` | Resolve viewer, narrow, refuse |
| `apps/boxscore/src/server/routes.ts` | 403 mapping |
| `apps/boxscore/src/server/cli.ts` | Refusal message |
| `apps/boxscore/src/server/fixture/index.ts` | `viewer` field, `self-view` and `locked` scenarios |
| `apps/boxscore/scripts/parity/boards.ts` | Scenario type, boards 08 and 09 |
| `docs/apps/design/boxscore/boxscore.pen` + `renders/` + `parity/` | Boards 08 and 09 |
| `apps/boxscore/src/app/detail/*.tsx` | `self` prop on the four page components |
| `apps/boxscore/src/app/App.tsx` + `src/app/access/*.tsx` (new) | Routing for Self view, not-available and locked pages |
| `apps/console/src/server/settings.ts` | `/api/settings/boxscore-roles` |
| `apps/console/src/app/settings/BoxscoreRoles.tsx` (new) | The per-member control |
| `apps/console/src/app/settings/CompositeControls.tsx` | Route `boxscore.roles` to it |
| `apps/boxscore/README.md` | Roles section |

---

### Task 1: The `boxscore.roles` setting

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (after the `boxscore.hiddenMembers` row, ~line 667)
- Modify: `packages/rt-client/src/settings/registry-schemas.ts:249`
- Modify: `packages/rt-client/src/settings/__tests__/schema-examples.ts:356`
- Modify: `packages/rt-client/src/settings/__tests__/registry.test.ts:352`
- Modify: `packages/rt-client/src/index.ts:200`
- Regenerate: `packages/rt-client/src/settings/schema.lock.json`

**Interfaces:**
- Produces: setting key `boxscore.roles`, value `Record<string, "team" | "self">`, scopes `["team"]`; `isJoinedTeam(team: string): boolean` and `listTeams(): string[]` exported from `@mattstack/rt-client`.

Read `docs/settings-architecture.md` "Adding a key (the checklist)" and `skills/rt-settings/SKILL.md` before starting.

- [ ] **Step 1: Add the examples entry (the failing test)**

In `schema-examples.ts`, after the `boxscore.hiddenMembers` line:

```ts
  "boxscore.roles": {
    good: [{}, { alice: "team", bob: "self" }],
    bad: [{ value: { alice: "admin" }, path: ["alice"] }],
  },
```

In `registry.test.ts`, insert `"boxscore.roles",` after `"boxscore.hiddenMembers",` in the key list.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-examples.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts`
(If the examples suite file has another name, find it with `ls packages/rt-client/src/settings/__tests__/ | grep -i example`.)
Expected: FAIL (unknown key `boxscore.roles` / key list mismatch).

- [ ] **Step 3: Add the registry row and schema**

`registry-defs.ts`, after the `boxscore.hiddenMembers` row:

```ts
  {
    key: "boxscore.roles",
    type: "object",
    scopes: ["team"],
    merge: "replace",
    description:
      "Who sees the whole team in boxscore: { \"<gitlab username>\": \"team\" | \"self\" }. A roster member not listed sees only their own page. The team owner's Mac always sees the whole team. A courtesy boundary, not a security one: each member's boxscore runs on their own Mac.",
  },
```

`registry-schemas.ts`, after `"boxscore.hiddenMembers"`:

```ts
  "boxscore.roles": z
    .record(z.string(), z.enum(["team", "self"]))
    .meta({ labels: { key: "member", value: "role" } }),
```

`index.ts` line 200 becomes:

```ts
export { readStore, listTeams } from "./settings/stores.ts";
export { isJoinedTeam } from "./settings/team-local-read.ts";
```

- [ ] **Step 4: Regenerate the lock and build**

```bash
bun run cli.ts settings schema lock
cd packages/rt-client && bun run build && cd ../..
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-examples.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts packages/rt-client/test/dist-freshness.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/rt-client/src packages/rt-client/src/settings/schema.lock.json
git commit -m "rt-client: register boxscore.roles (team scope only)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Viewer resolution

**Files:**
- Create: `apps/boxscore/src/server/config/viewer.ts`
- Create: `apps/boxscore/src/server/config/team.ts`
- Modify: `apps/boxscore/src/server/config/index.ts`
- Modify: `apps/boxscore/src/server/config/current-user.ts`
- Modify: `apps/boxscore/src/shared/types.ts`
- Test: `apps/boxscore/test/viewer.test.ts` (new), `apps/boxscore/test/config-settings.test.ts`

**Interfaces:**
- Consumes: `isJoinedTeam`, `listTeams` from `@mattstack/rt-client` (Task 1).
- Produces (in `shared/types.ts`):
  ```ts
  export type ViewerRole = 'team' | 'self';
  export interface Viewer { username: string | null; role: ViewerRole }
  ```
- Produces (`config/viewer.ts`): `resolveViewer(input: ViewerInput): Viewer`, with
  ```ts
  export interface ViewerInput {
    currentUser: string | null;
    roster: RosterEntry[];
    roles: unknown;
    team: TeamMembership | null;
  }
  ```
- Produces (`config/team.ts`): `interface TeamMembership { joined: boolean }`, `readTeamMembership(): TeamMembership | null`, `__setTeamReader(r: (() => TeamMembership | null) | null): void`.
- Produces (`config/current-user.ts`): `__setCurrentUser(u: CurrentUser | null): void`.
- Produces (`config/index.ts`): `BoxscoreSettings.roles: unknown` (the raw stored value; `resolveViewer` validates it).

- [ ] **Step 1: Write the failing tests**

`apps/boxscore/test/viewer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { resolveViewer } from '../src/server/config/viewer.js';

const roster = [{ username: 'alice' }, { username: 'bob', name: 'Bob B' }];
const member = { joined: true };
const owner = { joined: false };

describe('resolveViewer', () => {
  it('gives a Mac with no team Team view', () => {
    expect(
      resolveViewer({ currentUser: 'bob', roster, roles: {}, team: null })
    ).toEqual({ username: 'bob', role: 'team' });
  });

  it("gives the owner's Mac Team view whatever the roles say", () => {
    expect(
      resolveViewer({
        currentUser: 'bob',
        roster,
        roles: { bob: 'self' },
        team: owner,
      })
    ).toEqual({ username: 'bob', role: 'team' });
  });

  it('gives the owner Team view even when the lookup failed', () => {
    expect(
      resolveViewer({ currentUser: null, roster, roles: {}, team: owner })
    ).toEqual({ username: null, role: 'team' });
  });

  it('defaults an unlisted member to Self view', () => {
    expect(
      resolveViewer({ currentUser: 'bob', roster, roles: {}, team: member })
    ).toEqual({ username: 'bob', role: 'self' });
  });

  it('grants Team view to a member listed as team', () => {
    expect(
      resolveViewer({
        currentUser: 'bob',
        roster,
        roles: { bob: 'team' },
        team: member,
      })
    ).toEqual({ username: 'bob', role: 'team' });
  });

  it('locks a member whose lookup failed', () => {
    expect(
      resolveViewer({
        currentUser: null,
        roster,
        roles: { bob: 'team' },
        team: member,
      })
    ).toEqual({ username: null, role: 'self' });
  });

  it('locks a viewer who is not on the roster', () => {
    expect(
      resolveViewer({
        currentUser: 'mallory',
        roster,
        roles: { mallory: 'team' },
        team: member,
      })
    ).toEqual({ username: null, role: 'self' });
  });

  it("matches the roster and roles case-insensitively, answering the roster's spelling", () => {
    expect(
      resolveViewer({
        currentUser: 'Bob',
        roster,
        roles: { BOB: 'team' },
        team: member,
      })
    ).toEqual({ username: 'bob', role: 'team' });
  });

  it('treats an invalid role value as Self view', () => {
    expect(
      resolveViewer({
        currentUser: 'bob',
        roster,
        roles: { bob: 'admin' },
        team: member,
      })
    ).toEqual({ username: 'bob', role: 'self' });
    expect(
      resolveViewer({ currentUser: 'bob', roster, roles: 'team', team: member })
    ).toEqual({ username: 'bob', role: 'self' });
  });
});
```

Append to `apps/boxscore/test/config-settings.test.ts` inside `describe('readSettings', ...)`:

```ts
  it('passes boxscore.roles through raw, {} when unset', () => {
    store({ 'boxscore.roles': { ada: 'team' } });
    expect(readSettings().roles).toEqual({ ada: 'team' });
    store({});
    expect(readSettings().roles).toEqual({});
  });
```

Create `apps/boxscore/test/team-membership.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';

import { joinedOf } from '../src/server/config/team.js';

describe('joinedOf', () => {
  it('is null with no team', () => {
    expect(joinedOf([], () => false)).toBeNull();
  });
  it('is not joined for a created team', () => {
    expect(joinedOf(['acme'], () => false)).toEqual({ joined: false });
  });
  it('is joined when any of two teams was joined', () => {
    expect(joinedOf(['acme', 'beta'], t => t === 'beta')).toEqual({
      joined: true,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/boxscore && bun --bun vitest run test/viewer.test.ts test/team-membership.test.ts test/config-settings.test.ts`
Expected: FAIL (modules not found; `roles` undefined).

- [ ] **Step 3: Implement**

`apps/boxscore/src/shared/types.ts`, after `UserRow`:

```ts
export type ViewerRole = 'team' | 'self';

/** Who is looking, and what they may see. `username: null` = not identified. */
export interface Viewer {
  username: string | null;
  role: ViewerRole;
}
```

`apps/boxscore/src/server/config/team.ts`:

```ts
import { isJoinedTeam, listTeams } from '@mattstack/rt-client';

export interface TeamMembership {
  /** true = this Mac joined by invite (a member); false = it created the team (the owner). */
  joined: boolean;
}

/** One team per Mac is the rule, but two clones can exist; any joined one counts as joined. */
export function joinedOf(
  teams: string[],
  isJoined: (team: string) => boolean
): TeamMembership | null {
  if (teams.length === 0) return null;
  return { joined: teams.some(isJoined) };
}

let reader: (() => TeamMembership | null) | null = null;

/** Test seam. Under vitest the default reads no team, so no test touches the real ~/.mattstack. */
export function __setTeamReader(r: (() => TeamMembership | null) | null): void {
  reader = r;
}

export function readTeamMembership(): TeamMembership | null {
  if (reader) return reader();
  if (process.env.VITEST) return null;
  return joinedOf(listTeams(), isJoinedTeam);
}
```

`apps/boxscore/src/server/config/viewer.ts`:

```ts
import type { Viewer, ViewerRole } from '../../shared/types.js';
import type { RosterEntry } from './index.js';
import type { TeamMembership } from './team.js';

export interface ViewerInput {
  currentUser: string | null;
  roster: RosterEntry[];
  roles: unknown;
  team: TeamMembership | null;
}

function roleOf(roles: unknown, username: string): ViewerRole {
  if (typeof roles !== 'object' || roles === null || Array.isArray(roles))
    return 'self';
  const want = username.toLowerCase();
  const hit = Object.entries(roles as Record<string, unknown>).find(
    ([name]) => name.toLowerCase() === want
  );
  return hit?.[1] === 'team' ? 'team' : 'self';
}

export function resolveViewer(input: ViewerInput): Viewer {
  const want = input.currentUser?.toLowerCase();
  const entry =
    want === undefined
      ? undefined
      : input.roster.find(r => r.username.toLowerCase() === want);
  if (!input.team || !input.team.joined)
    return { username: entry?.username ?? input.currentUser, role: 'team' };
  if (!entry) return { username: null, role: 'self' };
  return { username: entry.username, role: roleOf(input.roles, entry.username) };
}
```

`apps/boxscore/src/server/config/index.ts`: add to `BoxscoreSettings`:

```ts
  /** Raw `boxscore.roles`; resolveViewer validates it. */
  roles: unknown;
```

and in `readSettings()`'s return object:

```ts
    roles: read<unknown>('boxscore.roles') ?? {},
```

`apps/boxscore/src/server/config/current-user.ts`, after `__resetCurrentUser`:

```ts
export function __setCurrentUser(u: CurrentUser | null): void {
  cached = u;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/boxscore && bun --bun vitest run test/viewer.test.ts test/team-membership.test.ts test/config-settings.test.ts test/config-current-user.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/boxscore/src/server/config apps/boxscore/src/shared/types.ts apps/boxscore/test/viewer.test.ts apps/boxscore/test/team-membership.test.ts apps/boxscore/test/config-settings.test.ts
git commit -m "boxscore: resolve the viewer's role from boxscore.roles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Server enforcement (API and CLI)

**Files:**
- Create: `apps/boxscore/src/server/viewer-scope.ts`
- Modify: `apps/boxscore/src/shared/types.ts` (`viewer` on `LeaderboardResponse`, `UserDetailResponse`)
- Modify: `apps/boxscore/src/server/metrics/trend.ts`
- Modify: `apps/boxscore/src/server/leaderboard.ts`
- Modify: `apps/boxscore/src/server/routes.ts`
- Modify: `apps/boxscore/src/server/cli.ts`
- Modify: every `LeaderboardResponse` / `UserDetailResponse` literal the typecheck flags (at least `apps/boxscore/src/app/App.test.tsx`'s `EMPTY`, `apps/boxscore/src/server/fixture/index.ts`)
- Test: `apps/boxscore/test/viewer-scope.test.ts` (new), `apps/boxscore/test/leaderboard.test.ts`, `apps/boxscore/test/endpoints.test.ts`

**Interfaces:**
- Consumes: `Viewer`, `resolveViewer`, `readTeamMembership`, `__setTeamReader`, `__setCurrentUser`, `readSettings().roles` (Task 2).
- Produces (`viewer-scope.ts`):
  ```ts
  export class ViewerForbiddenError extends Error {}
  export function canSeeUser(viewer: Viewer, username: string): boolean;
  export function narrowForViewer<R extends { users: UserRow[]; leaders: LeaderboardResponse['leaders'] }>(response: R, viewer: Viewer): R;
  ```
- Produces: `viewer: Viewer` on `LeaderboardResponse` and `UserDetailResponse`; `BuildContext.viewer: Viewer`.
- Produces: `/api/detail` answers `403 { error }` for a user the viewer may not see.

- [ ] **Step 1: Write the failing unit tests**

`apps/boxscore/test/viewer-scope.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { fixtureLeaderboard } from '../src/server/fixture/index.js';
import { canSeeUser, narrowForViewer } from '../src/server/viewer-scope.js';

const board = () => fixtureLeaderboard(true);

describe('narrowForViewer', () => {
  it('passes Team view through unchanged', () => {
    const res = board();
    expect(narrowForViewer(res, { username: 'srivera', role: 'team' })).toEqual(
      res
    );
  });

  it("keeps only the viewer's row, with every rank blanked and no leaders", () => {
    const out = narrowForViewer(board(), { username: 'srivera', role: 'self' });
    expect(out.users.map(u => u.username)).toEqual(['srivera']);
    expect(out.leaders).toEqual({});
    for (const v of Object.values(out.users[0]!.metrics))
      if (typeof v === 'object' && v !== null && 'rank' in v)
        expect(v.rank).toBeNull();
  });

  it('keeps the viewer\'s own values and deltas', () => {
    const before = board().users.find(u => u.username === 'srivera')!;
    const out = narrowForViewer(board(), { username: 'srivera', role: 'self' });
    expect(out.users[0]!.metrics.mrsMerged.value).toBe(
      before.metrics.mrsMerged.value
    );
    expect(out.users[0]!.metrics.mrsMerged.delta).toBe(
      before.metrics.mrsMerged.delta
    );
  });

  it('matches the viewer case-insensitively', () => {
    const out = narrowForViewer(board(), { username: 'SRivera', role: 'self' });
    expect(out.users.map(u => u.username)).toEqual(['srivera']);
  });

  it('empties the board in the locked state', () => {
    const out = narrowForViewer(board(), { username: null, role: 'self' });
    expect(out.users).toEqual([]);
    expect(out.leaders).toEqual({});
  });
});

describe('canSeeUser', () => {
  it('lets Team view see anyone', () => {
    expect(canSeeUser({ username: 'a', role: 'team' }, 'b')).toBe(true);
  });
  it('lets Self view see only themselves, case-insensitively', () => {
    const v = { username: 'alice', role: 'self' } as const;
    expect(canSeeUser(v, 'Alice')).toBe(true);
    expect(canSeeUser(v, 'bob')).toBe(false);
  });
  it('lets the locked state see no one', () => {
    expect(canSeeUser({ username: null, role: 'self' }, 'alice')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/boxscore && bun --bun vitest run test/viewer-scope.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `viewer-scope.ts` and the type fields**

`apps/boxscore/src/shared/types.ts`: add `viewer: Viewer;` to both `UserDetailResponse` (after `currentUser`) and `LeaderboardResponse` (after `currentUser`).

`apps/boxscore/src/server/viewer-scope.ts`:

```ts
import type {
  LeaderboardResponse,
  UserMetrics,
  UserRow,
  Viewer,
} from '../shared/types.js';

/** A Self view viewer asked for someone else (or anyone, unidentified). Routes answer 403. */
export class ViewerForbiddenError extends Error {
  override readonly name = 'ViewerForbiddenError';
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function canSeeUser(viewer: Viewer, username: string): boolean {
  if (viewer.role === 'team') return true;
  return viewer.username !== null && same(viewer.username, username);
}

function unranked(metrics: UserMetrics): UserMetrics {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(metrics))
    out[key] =
      typeof v === 'object' && v !== null && 'rank' in v
        ? { ...v, rank: null }
        : v;
  return out as unknown as UserMetrics;
}

export function unrankedRow(row: UserRow): UserRow {
  return { ...row, metrics: unranked(row.metrics) };
}

export function narrowForViewer<
  R extends { users: UserRow[]; leaders: LeaderboardResponse['leaders'] },
>(response: R, viewer: Viewer): R {
  if (viewer.role === 'team') return response;
  return {
    ...response,
    leaders: {},
    users: response.users
      .filter(u => canSeeUser(viewer, u.username))
      .map(unrankedRow),
  };
}
```

- [ ] **Step 4: Run to verify the unit tests pass**

First add `viewer: { username: CURRENT_USER, role: 'team' }` to `fixtureLeaderboard`'s return and `viewer: board.viewer` to `fixtureDetail`'s return in `apps/boxscore/src/server/fixture/index.ts` (the test builds from the fixture, which must satisfy the new required field; Task 4 extends this).

Run: `cd apps/boxscore && bun --bun vitest run test/viewer-scope.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing integration tests**

In `apps/boxscore/test/leaderboard.test.ts`, add imports at the top-level dynamic-import block:

```ts
const { getUserDetail } = await import('../src/server/leaderboard.js');
const { __setCurrentUser, __resetCurrentUser } = await import(
  '../src/server/config/current-user.js'
);
const { __setTeamReader } = await import('../src/server/config/team.js');
const { ViewerForbiddenError } = await import('../src/server/viewer-scope.js');
```

and a new describe block (it reuses the file's existing `SETTINGS`, `__setSettingReader`, `__setProviderFactory` and `fakeProvider` setup; give `SETTINGS['mattstack.roster']` a second member `{ username: 'bob' }` inside this block via a local settings object):

```ts
describe('viewer roles', () => {
  const ROLES_SETTINGS: Record<string, unknown> = {
    ...SETTINGS,
    'mattstack.roster': [{ username: 'alice' }, { username: 'bob' }],
    'boxscore.hiddenMembers': ['alice'],
  };
  const window = resolvePreset('30d', new Date('2026-06-01T00:00:00Z'));

  beforeEach(() => {
    __setSettingReader(<T>(k: string) => ROLES_SETTINGS[k] as T | undefined);
    __setProviderFactory(() => fakeProvider().provider);
    __setTeamReader(() => ({ joined: true }));
    __setCurrentUser({ username: 'Alice', name: null });
  });
  afterEach(() => {
    __setTeamReader(null);
    __resetCurrentUser();
    __setSettingReader(<T>(k: string) => SETTINGS[k] as T | undefined);
  });

  it("serves an unlisted member only their own unranked row, even when they hid themselves", async () => {
    const res = await getLeaderboard({ window, refresh: false, trend: false });
    expect(res.viewer).toEqual({ username: 'alice', role: 'self' });
    expect(res.users.map(u => u.username)).toEqual(['alice']);
    expect(res.leaders).toEqual({});
    expect(res.users[0]!.metrics.mrsMerged.rank).toBeNull();
  });

  it('serves the full board to a member granted team', async () => {
    ROLES_SETTINGS['boxscore.roles'] = { alice: 'team' };
    try {
      const res = await getLeaderboard({ window, refresh: false, trend: false });
      expect(res.viewer.role).toBe('team');
      expect(res.users.map(u => u.username)).toEqual(['bob']);
    } finally {
      delete ROLES_SETTINGS['boxscore.roles'];
    }
  });

  it("refuses a Self viewer someone else's detail", async () => {
    await expect(
      getUserDetail({ window, refresh: false, trend: false, user: 'bob' })
    ).rejects.toBeInstanceOf(ViewerForbiddenError);
  });

  it('serves a Self viewer their own detail with ranks blanked, any case', async () => {
    const res = await getUserDetail({
      window,
      refresh: false,
      trend: false,
      user: 'ALICE',
    });
    expect(res.user.username).toBe('alice');
    expect(res.user.metrics.mrsMerged.rank).toBeNull();
  });

  it('locks a viewer the lookup could not identify', async () => {
    __resetCurrentUser();
    const res = await getLeaderboard({ window, refresh: false, trend: false });
    expect(res.viewer).toEqual({ username: null, role: 'self' });
    expect(res.users).toEqual([]);
  });
});
```

Notes for the implementer: if `fakeProvider`, `resolvePreset`, `afterEach` or `beforeEach` are not already imported/defined in `leaderboard.test.ts` under those names, use the names that file already uses for the same things (read the file first). Under vitest with no `fetchImpl`, `getCurrentUser` returns `null` unless `__setCurrentUser` seeded the cache, which is why the last test resets it.

In `apps/boxscore/test/endpoints.test.ts`, add:

```ts
const { __setCurrentUser, __resetCurrentUser } = await import(
  '../src/server/config/current-user.js'
);
const { __setTeamReader } = await import('../src/server/config/team.js');

describe('viewer roles over HTTP', () => {
  beforeEach(() => {
    __setTeamReader(() => ({ joined: true }));
    __setCurrentUser({ username: 'alexrivera', name: 'Alex Rivera' });
  });
  afterEach(() => {
    __setTeamReader(null);
    __resetCurrentUser();
  });

  it("answers 403 for someone else's detail", async () => {
    const res = await app.request('/api/detail?user=someoneelse&range=30d');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /only your own/i
    );
  });
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `cd apps/boxscore && bun --bun vitest run test/leaderboard.test.ts test/endpoints.test.ts`
Expected: FAIL (`viewer` undefined, no 403).

- [ ] **Step 7: Wire the viewer through the server**

`apps/boxscore/src/server/metrics/trend.ts`: import `Viewer` in the type import, add `viewer: Viewer;` to `BuildContext`, and add `viewer: ctx.viewer,` to the returned object after `currentUser`.

`apps/boxscore/src/server/leaderboard.ts`:

1. Imports:
   ```ts
   import { readTeamMembership } from './config/team.js';
   import { resolveViewer } from './config/viewer.js';
   import {
     canSeeUser,
     narrowForViewer,
     unrankedRow,
     ViewerForbiddenError,
   } from './viewer-scope.js';
   ```
   and add `Viewer` to the `../shared/types.js` type import.
2. `metricOptionsFromSettings` takes the comparison set:
   ```ts
   function metricOptionsFromSettings(users?: string[]) {
     const s = readSettings();
     return {
       users: users ?? s.users,
       sizeBand: s.sizeBand,
       doneStates: s.doneStates,
       extraBotPatterns: s.botPatterns,
       excludeFilePatterns: s.excludeFilePatterns,
       ignoredMrs: s.ignoredMrs,
     };
   }
   ```
   and `snapshotFor` passes it through:
   ```ts
   const snapshotFor = (
     result: FetchResult,
     window: TimeWindow,
     users?: string[]
   ): Snapshot =>
     computeSnapshot(result, { window, ...metricOptionsFromSettings(users) });
   ```
3. In `buildLeaderboard`, move the `getCurrentUser` call and its warning to just after the refresh block (before `rosterUsernames`), then resolve the viewer and the comparison set:
   ```ts
   const viewer: Viewer = resolveViewer({
     currentUser: who?.username ?? null,
     roster: settings.roster,
     roles: settings.roles,
     team: readTeamMembership(),
   });
   // A Self viewer is computed alone: hiddenMembers is a Team view overlay.
   const compared =
     viewer.role === 'team'
       ? undefined
       : viewer.username === null
         ? []
         : [viewer.username];
   ```
   Pass `compared` as the third argument to both `snapshotFor` calls, add `viewer` to `ctx`, and change the return to:
   ```ts
   return {
     response: narrowForViewer(
       buildResponse(snapshotFor(current, opts.window, compared), priorSnapshot, ctx),
       viewer
     ),
     current,
     env,
   };
   ```
   (`priorSnapshot` is built with `snapshotFor(buildFetchResult(store, pw, rosterUsernames), pw, compared)`.)
4. In `getUserDetail`, refuse before matching, and match case-insensitively:
   ```ts
   const { response, current, env } = await buildLeaderboard(opts);
   if (!canSeeUser(response.viewer, opts.user)) {
     throw new ViewerForbiddenError(
       'You can see only your own page in boxscore. Ask your team owner for Team view.'
     );
   }
   const want = opts.user.toLowerCase();
   const userRow = response.users.find(u => u.username.toLowerCase() === want);
   ```
   Build evidence for `userRow.username` (not `opts.user`), call `metricOptionsFromSettings()` unchanged for evidence, return `user: response.viewer.role === 'team' ? userRow : unrankedRow(userRow)` (narrowing already blanked it; this keeps the intent explicit) and add `viewer: response.viewer,`.

`apps/boxscore/src/server/routes.ts`: import `ViewerForbiddenError` from `./viewer-scope.js`; in the `/api/detail` catch, before the `UnknownUserError` check:

```ts
      if (err instanceof ViewerForbiddenError)
        return c.json({ error: err.message }, 403);
```

`apps/boxscore/src/server/cli.ts`: no change needed for narrowing (it calls the same core). The `main().catch` already prints `cli failed: <message>` and exits 1 for `ViewerForbiddenError`.

Fix any remaining type errors from the new required `viewer` field: run `cd apps/boxscore && bun run typecheck` (or `bunx tsc --noEmit -p .`) and add `viewer: { username: '', role: 'team' }` to each test literal it flags, e.g. `EMPTY` in `src/app/App.test.tsx`.

- [ ] **Step 8: Run to verify they pass**

Run: `cd apps/boxscore && bun --bun vitest run test/viewer-scope.test.ts test/leaderboard.test.ts test/endpoints.test.ts test/validate.test.ts test/fixture.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/boxscore/src apps/boxscore/test
git commit -m "boxscore: narrow responses for Self view and refuse other people's detail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Fixture scenarios for Self view and locked

**Files:**
- Modify: `apps/boxscore/src/server/fixture/index.ts`
- Modify: `apps/boxscore/src/server/routes.ts` (fixture branches)
- Modify: `apps/boxscore/scripts/parity/boards.ts` (`Scenario` type only)
- Test: `apps/boxscore/test/fixture.test.ts`

**Interfaces:**
- Consumes: `narrowForViewer`, `canSeeUser` (Task 3).
- Produces: `FixtureScenario = 'warm' | 'refreshing' | 'cold-stalled' | 'self-view' | 'locked'`; `fixtureViewer(): Viewer`; `fixtureLeaderboard` and `fixtureDetail` honour it; `fixtureDetail` returns `'forbidden'` for a user the fixture viewer cannot see.

- [ ] **Step 1: Write the failing test**

Append to `apps/boxscore/test/fixture.test.ts` (add `afterEach` to its vitest import if missing):

```ts
describe('viewer scenarios', () => {
  afterEach(() => {
    delete process.env.BOXSCORE_FIXTURE_SCENARIO;
  });

  it('serves the current user alone in self-view', () => {
    process.env.BOXSCORE_FIXTURE_SCENARIO = 'self-view';
    const res = fixtureLeaderboard(false);
    expect(res.viewer).toEqual({ username: 'srivera', role: 'self' });
    expect(res.users.map(u => u.username)).toEqual(['srivera']);
    expect(fixtureDetail('srivera', false)).not.toBe('forbidden');
    expect(fixtureDetail('someone-else', false)).toBe('forbidden');
  });

  it('serves no one when locked', () => {
    process.env.BOXSCORE_FIXTURE_SCENARIO = 'locked';
    const res = fixtureLeaderboard(false);
    expect(res.viewer).toEqual({ username: null, role: 'self' });
    expect(res.users).toEqual([]);
  });

  it('stays Team view by default', () => {
    expect(fixtureLeaderboard(false).viewer.role).toBe('team');
  });
});
```

(Import `fixtureDetail` alongside `fixtureLeaderboard` if the file doesn't already.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/boxscore && bun --bun vitest run test/fixture.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`fixture/index.ts`:

```ts
export type FixtureScenario =
  | 'warm'
  | 'refreshing'
  | 'cold-stalled'
  | 'self-view'
  | 'locked';

const SCENARIOS: FixtureScenario[] = [
  'refreshing',
  'cold-stalled',
  'self-view',
  'locked',
];

export function fixtureScenario(): FixtureScenario {
  const s = process.env.BOXSCORE_FIXTURE_SCENARIO as FixtureScenario | undefined;
  return s && SCENARIOS.includes(s) ? s : 'warm';
}

export function fixtureViewer(): Viewer {
  const s = fixtureScenario();
  if (s === 'self-view') return { username: CURRENT_USER, role: 'self' };
  if (s === 'locked') return { username: null, role: 'self' };
  return { username: CURRENT_USER, role: 'team' };
}
```

Import `Viewer` in the type import and `canSeeUser, narrowForViewer, unrankedRow` from `'../viewer-scope.js'` (pure module, no runtime imports, so component tests can still import the fixture). `fixtureLeaderboard` builds as today, then returns `narrowForViewer({ ...built, viewer: fixtureViewer() }, fixtureViewer())`. `fixtureDetail(user, trend)` returns type `UserDetailResponse | null | 'forbidden'`: first `if (!canSeeUser(fixtureViewer(), user)) return 'forbidden';`, then finds the row case-insensitively in `fixtureLeaderboard(trend).users` and returns it with `viewer: board.viewer`.

`routes.ts` `/api/detail` fixture branch:

```ts
    if (fixtureMode()) {
      const detail = fixtureDetail(user, boolQuery(c, 'trend'));
      if (detail === 'forbidden')
        return c.json(
          {
            error:
              'You can see only your own page in boxscore. Ask your team owner for Team view.',
          },
          403
        );
      return detail
        ? c.json(detail)
        : c.json({ error: `unknown user: ${user}` }, 404);
    }
```

Move that message into one exported constant `SELF_ONLY_MESSAGE` in `viewer-scope.ts` and use it in `leaderboard.ts`, here, and the endpoint test's regex stays valid.

Fix every other `fixtureDetail` caller the typecheck flags (component tests mock `useUserDetail` with it: treat `'forbidden'` like `null`, e.g. `const detail = fixtureDetail(username, false); return detail && detail !== 'forbidden' ? {...} : {...error}`).

`scripts/parity/boards.ts`: `export type Scenario = 'warm' | 'refreshing' | 'cold-stalled' | 'self-view' | 'locked';`

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/boxscore && bun --bun vitest run test/fixture.test.ts test/endpoints.test.ts src/app/detail/detail.test.tsx && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/boxscore
git commit -m "boxscore: self-view and locked fixture scenarios

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Boards 08 and 09 (controller task, Matt's approval gate)

This task is done by the controlling session, not a subagent: it needs Pencil open on the `.pen` and Matt's sign-off. No UI code (Tasks 6 and 7) starts before Matt approves both boards.

**Files:**
- Modify: `docs/apps/design/boxscore/boxscore.pen`
- Create: `docs/apps/design/boxscore/renders/08-person-self-view.{dark,light}.png`, `09-not-available.{dark,light}.png`
- Create: `docs/apps/design/boxscore/parity/08-person-self-view.{dark,light}.html`, `09-not-available.{dark,light}.html`
- Modify: `docs/apps/design/boxscore/README.md` (Boards list), `apps/boxscore/scripts/parity/run.md` (roots table, frame ids)

- [ ] **Step 1:** In Pencil, duplicate board 03 (`Person · Stat detail`, frame `bhvvQ`) as `Person · Self view`. Remove `Back Link`, the switcher group in `Profile Header`, the `Sum Leads`, `Sum Top 3` and `Sum Median rank` cells from `Summary`, every `Rank` pill in `Stat Rail`, and `Rank Block`, `Leader Block` and `Field` from the panel hero. Decide the `Summary` strip with only Coding days left (draw it, and one alternative if it is a real choice, as separate boards for Matt to pick). Keep layer names unchanged for everything that remains.
- [ ] **Step 2:** Draw `Not available` as one board with two frames side by side: someone else's page (a centred message, "This page isn't available to you", with a link to your own page) and the locked state ("boxscore couldn't tell who you are", naming the two things to check: your GitLab token and that your username is on the team roster). Use kit components (`NotFoundPage`-style layout) and role-token variables only.
- [ ] **Step 3:** Export renders (both schemes) and the `html-css` parity exports with `includeLayerNames: true`, per `apps/boxscore/scripts/parity/run.md`.
- [ ] **Step 4:** Show Matt the renders and wait for approval. Record his choices in the README's Boards list.
- [ ] **Step 5:** Add boards to `apps/boxscore/scripts/parity/boards.ts`:

```ts
  {
    slug: '08-person-self-view',
    frame: 'Person · Self view',
    frameId: '<id from Pencil>',
    route: '/user/srivera/issuesCompleted',
    storage: {},
    scenario: 'self-view',
    roots: ['Crumbs', 'Top Right', 'Profile Header', 'Summary', 'Body'],
    height: 1300,
    dynamicText: DYNAMIC_TEXT,
    settleText: SETTLE_TEXT,
  },
  {
    slug: '09-not-available',
    frame: 'Not available',
    frameId: '<id from Pencil>',
    route: '/user/someone-else',
    storage: {},
    scenario: 'self-view',
    roots: ['Crumbs', 'Top Right', 'Not Available'],
    height: 800,
    dynamicText: DYNAMIC_TEXT,
    settleText: SETTLE_TEXT,
  },
```

- [ ] **Step 6:** Commit the `.pen`, renders, exports, README, run.md and boards.ts.

---

### Task 6: Self view on the person page

**Files:**
- Modify: `apps/boxscore/src/app/detail/ProfileHeader.tsx`, `PersonSummary.tsx`, `StatRail.tsx`, `StatPanel.tsx`, `DetailPage.tsx`
- Test: `apps/boxscore/src/app/detail/self-view.test.tsx` (new)

**Interfaces:**
- Consumes: `viewer` on `LeaderboardResponse` (Task 3); fixture `self-view` scenario (Task 4); board 08 (Task 5).
- Produces: each of the four components takes `self?: boolean` (default `false`); `DetailPage` passes `self={data.viewer.role === 'self'}`.

- [ ] **Step 1: Write the failing test**

`apps/boxscore/src/app/detail/self-view.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fixtureDetail, fixtureLeaderboard } from '../../server/fixture/index';
import { App } from '../App';

const { useLeaderboard, useUserDetail } = vi.hoisted(() => ({
  useLeaderboard: vi.fn(),
  useUserDetail: vi.fn(),
}));
vi.mock('../hooks/useLeaderboard', () => ({ useLeaderboard, useUserDetail }));

beforeEach(() => {
  process.env.BOXSCORE_FIXTURE_SCENARIO = 'self-view';
  useLeaderboard.mockReturnValue({
    data: fixtureLeaderboard(false),
    error: null,
    isFetching: false,
  });
  useUserDetail.mockImplementation((username: string) => {
    const d = fixtureDetail(username, false);
    return d && d !== 'forbidden'
      ? { data: d, error: null, isLoading: false }
      : { data: undefined, error: new Error('forbidden'), isLoading: false };
  });
});
afterEach(() => {
  delete process.env.BOXSCORE_FIXTURE_SCENARIO;
});

const layer = (root: ParentNode, name: string) =>
  root.querySelector<HTMLElement>(`[data-parity="${name}"]`);

function renderAt(path: string) {
  const location = memoryLocation({ path, record: true });
  return renderWithProviders(
    <Router hook={location.hook}>
      <App />
    </Router>
  );
}

describe('person page in Self view', () => {
  it('drops navigation and every ranking, keeping the values', async () => {
    const { container } = renderAt('/user/srivera/issuesCompleted');
    await waitFor(() => expect(layer(container, 'Profile Header')).not.toBeNull());
    expect(layer(container, 'Back Link')).toBeNull();
    expect(screen.queryByRole('button', { name: /choose a person/i })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Previous person' })).toBeNull();
    expect(layer(container, 'Sum Leads')).toBeNull();
    expect(layer(container, 'Sum Top 3')).toBeNull();
    expect(layer(container, 'Sum Median rank')).toBeNull();
    expect(screen.getByText('Coding days')).toBeInTheDocument();
    const rail = layer(container, 'Stat Rail')!;
    expect(within(rail).queryAllByText(/^#\d+$|^–$/)).toHaveLength(0);
    expect(layer(container, 'Rank Block')).toBeNull();
    expect(layer(container, 'Leader Block')).toBeNull();
    expect(layer(container, 'Field')).toBeNull();
    expect(layer(container, 'Big Value')).not.toBeNull();
  });

  it("shows the page even when the viewer's identity is unresolved", async () => {
    const board = fixtureLeaderboard(false);
    board.users[0] = { ...board.users[0]!, resolved: false };
    useLeaderboard.mockReturnValue({ data: board, error: null, isFetching: false });
    const { container } = renderAt('/user/srivera');
    await waitFor(() => expect(layer(container, 'Profile Header')).not.toBeNull());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/boxscore && bun --bun vitest run src/app/detail/self-view.test.tsx`
Expected: FAIL (back link and ranks still present).

- [ ] **Step 3: Implement**

- `DetailPage.tsx`: `const self = data.viewer.role === 'self';` and `const people = data.users.filter(u => u.resolved || (self && u.isCurrentUser) || (self && u.username === data.viewer.username));`. Pass `self` to `ProfileHeader`, `PersonSummary`, `StatRail`, `StatPanel`.
- `ProfileHeader.tsx`: add `self = false` prop; render the `<Link ... Back Link>` and the whole `<div className={classes.switcher}>` only when `!self`.
- `PersonSummary.tsx`: add `self = false`; render the Leads, Top 3 and Median rank `Cell`s only when `!self`. Apply the layout board 08 settled for the strip with Coding days alone (a CSS module class on `section`, e.g. `classes.summarySingle`, defined in `detail.module.css` with role tokens only).
- `StatRail.tsx`: add `self = false`; render `<RankPill>` only when `!self`.
- `StatPanel.tsx`: add `self = false`; render the `Rank Block` div, `<Leader>` and the `Field` div only when `!self`, and skip computing `ranked`/`points` when `self` (they are empty anyway).

- [ ] **Step 4: Run to verify it passes, plus the existing person tests**

Run: `cd apps/boxscore && bun --bun vitest run src/app/detail/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/boxscore/src/app/detail
git commit -m "boxscore: Self view person page drops navigation and ranking

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Routing for Self view, not-available and locked pages

**Files:**
- Create: `apps/boxscore/src/app/access/NotAvailablePage.tsx`, `apps/boxscore/src/app/access/LockedPage.tsx`
- Modify: `apps/boxscore/src/app/App.tsx`
- Test: `apps/boxscore/src/app/access/access.test.tsx` (new)

**Interfaces:**
- Consumes: `data.viewer` (Task 3), fixtures (Task 4), board 09 (Task 5), `statHref` from `../leaderboard/StandingsTable`.
- Produces: `<NotAvailablePage own={string} />`, `<LockedPage />`, each root carrying `data-parity="Not Available"`.

- [ ] **Step 1: Write the failing test**

`apps/boxscore/src/app/access/access.test.tsx` (same mock and `renderAt` scaffolding as Task 6's test, with `memoryLocation({ path, record: true })` returned so the test can read `location.history`):

```tsx
describe('Self view routing', () => {
  it('redirects / to your own page', async () => {
    const { location } = renderAt('/');
    await waitFor(() =>
      expect(location.history.at(-1)).toBe('/user/srivera')
    );
  });

  it("shows not-available for someone else's page, linking to yours", async () => {
    renderAt('/user/someone-else/issuesCompleted');
    expect(
      await screen.findByText("This page isn't available to you")
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /your page/i })).toHaveAttribute(
      'href',
      '/user/srivera'
    );
  });

  it('treats a different-case URL as your own page', async () => {
    const { container } = renderAt('/user/SRivera');
    await waitFor(() =>
      expect(container.querySelector('[data-parity="Profile Header"]')).not.toBeNull()
    );
  });

  it('shows the locked page when the viewer is unidentified', async () => {
    process.env.BOXSCORE_FIXTURE_SCENARIO = 'locked';
    useLeaderboard.mockReturnValue({
      data: fixtureLeaderboard(false),
      error: null,
      isFetching: false,
    });
    renderAt('/');
    expect(
      await screen.findByText("boxscore couldn't tell who you are")
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/boxscore && bun --bun vitest run src/app/access/access.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`NotAvailablePage.tsx` and `LockedPage.tsx` follow board 09 exactly (copy, spacing, tokens), built from kit components (`Stack`, `Title`, `Text`, `Button` with `component={Link}` from `@mattstack/app-kit/core` and `/router`). Locked copy: title "boxscore couldn't tell who you are", body "Check that your GitLab token is set and that your GitLab username is on the team roster in console." with a console link from `/api/links` if the board shows one.

`App.tsx`, after `data` is known and before `page` is chosen:

```tsx
  const viewer = data?.viewer;
  const self = viewer?.role === 'self';
  const own = viewer?.username ?? null;
  const isOwn = (name: string) =>
    own !== null && name.toLowerCase() === own.toLowerCase();

  useEffect(() => {
    if (self && own && route.name === 'leaderboard') navigate(`/user/${own}`, { replace: true });
  }, [self, own, route.name, navigate]);
```

(Use the `navigate` the file already has; if it comes from `useLocation`, its second argument takes `{ replace: true }`.) Then in the page selection: when `self && own === null` render `<LockedPage />`; when `self && isPerson && !isOwn(route.username)` render `<NotAvailablePage own={own} />`; when `self && isPerson`, pass `username={own}` to `DetailPage` so a different-case URL resolves to the viewer's row. Crumbs for the not-available and locked pages: `['boxscore', 'Not available']`.

- [ ] **Step 4: Run to verify it passes, plus App tests**

Run: `cd apps/boxscore && bun --bun vitest run src/app/access/access.test.tsx src/app/App.test.tsx src/app/routes.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/boxscore/src/app
git commit -m "boxscore: Self view lands on your page; others and locked show a message

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Console role control

**Files:**
- Modify: `apps/console/src/server/settings.ts`
- Create: `apps/console/src/server/boxscore-roles.ts`
- Create: `apps/console/src/app/settings/BoxscoreRoles.tsx`
- Modify: `apps/console/src/app/settings/CompositeControls.tsx` (stringMap branch, ~line 936)
- Test: `apps/console/src/server/boxscore-roles.test.ts` (new), `apps/console/src/app/settings/BoxscoreRoles.test.tsx` (new)

**Interfaces:**
- Consumes: `boxscore.roles` (Task 1), `isJoinedTeam`, `listTeams`, `getSetting` from `@mattstack/rt-client`.
- Produces: `GET /api/settings/boxscore-roles` → `{ members: { username: string; name: string | null }[]; access: 'owner' | 'member' | 'no-team' }`; `rolesAccess(deps): RolesInfo`; `<BoxscoreRolesBody def row />`.

- [ ] **Step 1: Write the failing server test**

`apps/console/src/server/boxscore-roles.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { rolesInfo } from './boxscore-roles';

const deps = (teams: string[], joined: string[], roster: unknown) => ({
  teams: () => teams,
  isJoined: (t: string) => joined.includes(t),
  roster: () => roster,
});

describe('rolesInfo', () => {
  it('lists the roster and marks the owner', () => {
    expect(
      rolesInfo(deps(['acme'], [], [{ username: 'ada', name: 'Ada' }, { username: 'bob' }]))
    ).toEqual({
      members: [
        { username: 'ada', name: 'Ada' },
        { username: 'bob', name: null },
      ],
      access: 'owner',
    });
  });
  it('marks a joined Mac as a member', () => {
    expect(rolesInfo(deps(['acme'], ['acme'], [])).access).toBe('member');
  });
  it('marks a Mac with no team', () => {
    expect(rolesInfo(deps([], [], [])).access).toBe('no-team');
  });
  it('drops roster entries with no username', () => {
    expect(rolesInfo(deps(['acme'], [], [{ name: 'x' }, 'junk'])).members).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/console && bun --bun vitest run src/server/boxscore-roles.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the server side**

`apps/console/src/server/boxscore-roles.ts`:

```ts
import { getSetting, isJoinedTeam, listTeams } from '@mattstack/rt-client';

export interface RolesInfo {
  members: { username: string; name: string | null }[];
  /** owner: this Mac created the team and may write team settings. */
  access: 'owner' | 'member' | 'no-team';
}

export interface RolesDeps {
  teams: () => string[];
  isJoined: (team: string) => boolean;
  roster: () => unknown;
}

const realDeps: RolesDeps = {
  teams: listTeams,
  isJoined: isJoinedTeam,
  roster: () => getSetting<unknown>('mattstack.roster').value,
};

export function rolesInfo(deps: RolesDeps = realDeps): RolesInfo {
  const teams = deps.teams();
  const raw = deps.roster();
  const members = (Array.isArray(raw) ? raw : []).flatMap(e =>
    typeof e === 'object' && e !== null && typeof e.username === 'string'
      ? [{ username: e.username as string, name: typeof e.name === 'string' ? (e.name as string) : null }]
      : []
  );
  const access =
    teams.length === 0 ? 'no-team' : teams.some(deps.isJoined) ? 'member' : 'owner';
  return { members, access };
}
```

`apps/console/src/server/settings.ts`: import `rolesInfo` and add, before the `suggest` route:

```ts
      /** The roster and whether this Mac may set boxscore.roles (owner only). */
      .get('/api/settings/boxscore-roles', c => c.json(rolesInfo(), 200))
```

- [ ] **Step 4: Run to verify the server test passes**

Run: `cd apps/console && bun --bun vitest run src/server/boxscore-roles.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing component test**

`apps/console/src/app/settings/BoxscoreRoles.test.tsx`:

```tsx
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoxscoreRolesBody } from './BoxscoreRoles';

const def = (value: unknown): SettingDefWire => ({
  key: 'boxscore.roles',
  type: 'object',
  scopes: ['team'],
  merge: 'replace',
  secret: false,
  teamLocked: false,
  repoScoped: false,
  writable: true,
  description: 'Who sees the whole team in boxscore.',
  hasDefault: false,
  defaultValue: null,
  effective: value === undefined
    ? { scope: null, file: null, value: undefined }
    : { scope: 'team', file: '/t/settings.team.jsonc', value },
  storeVersion: 1,
});

const row = () => ({
  status: 'idle' as const,
  error: null,
  target: { scope: 'team' },
  save: vi.fn(async () => true),
  setAt: vi.fn(),
  clear: vi.fn(),
  move: vi.fn(),
});

function serve(access: 'owner' | 'member' | 'no-team') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          members: [
            { username: 'ada', name: 'Ada L' },
            { username: 'bob', name: null },
          ],
          access,
        })
      )
    )
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('BoxscoreRolesBody', () => {
  it('shows every roster member, unlisted as Self', async () => {
    serve('owner');
    renderWithProviders(<BoxscoreRolesBody def={def({ ada: 'team' })} row={row() as never} />);
    expect(await screen.findByText('Ada L')).toBeInTheDocument();
    const ada = screen.getByRole('radiogroup', { name: 'Role for ada' });
    expect(within(ada).getByRole('radio', { name: 'Team' })).toBeChecked();
    const bob = screen.getByRole('radiogroup', { name: 'Role for bob' });
    expect(within(bob).getByRole('radio', { name: 'Self' })).toBeChecked();
  });

  it('saves a grant for the owner', async () => {
    serve('owner');
    const r = row();
    renderWithProviders(<BoxscoreRolesBody def={def(undefined)} row={r as never} />);
    const bob = await screen.findByRole('radiogroup', { name: 'Role for bob' });
    await userEvent.click(within(bob).getByRole('radio', { name: 'Team' }));
    await waitFor(() => expect(r.save).toHaveBeenCalledWith({ bob: 'team' }));
  });

  it('is read-only on a member Mac, saying who can change it', async () => {
    serve('member');
    renderWithProviders(<BoxscoreRolesBody def={def({})} row={row() as never} />);
    expect(
      await screen.findByText('Only the team owner can change roles.')
    ).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
  });

  it('says this is a courtesy boundary', async () => {
    serve('owner');
    renderWithProviders(<BoxscoreRolesBody def={def({})} row={row() as never} />);
    expect(
      await screen.findByText(/each member's boxscore runs on their own Mac/)
    ).toBeInTheDocument();
  });
});
```

(Mantine's `SegmentedControl` renders `radio` inputs; confirm against the installed `@mantine/core` that the root takes the `radiogroup` role and accessible name used here, and adjust the queries, not the behavior, if they differ.)

- [ ] **Step 6: Run to verify it fails**

Run: `cd apps/console && bun --bun vitest run src/app/settings/BoxscoreRoles.test.tsx`
Expected: FAIL.

- [ ] **Step 7: Implement the component and hook it in**

`apps/console/src/app/settings/BoxscoreRoles.tsx`:

```tsx
import { useEffect, useState } from 'react';

import { Group, SegmentedControl, Stack, Text } from '@mattstack/app-kit/core';
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import type { useRowSave } from './useRowSave';

type Row = ReturnType<typeof useRowSave>;
type Role = 'team' | 'self';
interface RolesInfo {
  members: { username: string; name: string | null }[];
  access: 'owner' | 'member' | 'no-team';
}

export const ROLES_KEY = 'boxscore.roles';

const NOTE: Record<Exclude<RolesInfo['access'], 'owner'>, string> = {
  member: 'Only the team owner can change roles.',
  'no-team': 'Roles live in team settings, and this Mac has no team.',
};

export function BoxscoreRolesBody({ def, row }: { def: SettingDefWire; row: Row }) {
  const [info, setInfo] = useState<RolesInfo | null>(null);
  useEffect(() => {
    let live = true;
    void fetch('/api/settings/boxscore-roles')
      .then(r => (r.ok ? (r.json() as Promise<RolesInfo>) : null))
      .catch(() => null)
      .then(v => live && setInfo(v));
    return () => {
      live = false;
    };
  }, []);

  const stored = (def.effective.value ?? {}) as Record<string, Role>;
  const editable = info?.access === 'owner' && row.status !== 'saving';
  const roleOf = (u: string): Role => (stored[u] === 'team' ? 'team' : 'self');

  return (
    <Stack gap={8} py={8}>
      <Text fz={12} c="dimmed">
        Team view sees everyone&apos;s stats. Self view sees only their own page. This is a
        courtesy: each member&apos;s boxscore runs on their own Mac.
      </Text>
      {info && info.access !== 'owner' && (
        <Text fz={12} c="dimmed">
          {NOTE[info.access]}
        </Text>
      )}
      {info?.members.map(m => (
        <Group key={m.username} justify="space-between" wrap="nowrap">
          <Text fz={13}>{m.name ?? m.username}</Text>
          <SegmentedControl
            size="xs"
            aria-label={`Role for ${m.username}`}
            disabled={!editable}
            value={roleOf(m.username)}
            data={[
              { value: 'team', label: 'Team' },
              { value: 'self', label: 'Self' },
            ]}
            onChange={v => void row.save({ ...stored, [m.username]: v as Role })}
          />
        </Group>
      ))}
    </Stack>
  );
}
```

If `SegmentedControl` does not forward `aria-label` to its radiogroup root in the installed Mantine 9.5 types, wrap it in `<div role="radiogroup" aria-label=...>` per the test, or set the label through the prop Mantine documents; verify with the installed types first.

`CompositeControls.tsx`: import `{ BoxscoreRolesBody, ROLES_KEY } from './BoxscoreRoles'` and change the stringMap branch body to:

```tsx
  if (shape.kind === 'stringMap')
    return {
      control: summary,
      body:
        def.key === ROLES_KEY ? (
          <BoxscoreRolesBody def={def} row={row} />
        ) : (
          <StringMapBody
            def={def}
            row={row}
            labels={shape.labels}
            onEditJson={onEditJson}
          />
        ),
    };
```

- [ ] **Step 8: Run to verify everything passes**

Run: `cd apps/console && bun --bun vitest run src/server/boxscore-roles.test.ts src/app/settings/BoxscoreRoles.test.tsx src/app/settings/CompositeControls.test.tsx src/app/settings/groups.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/console/src
git commit -m "console: Team/Self role control for boxscore.roles, owner only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Docs, parity and visual verification

**Files:**
- Modify: `apps/boxscore/README.md`
- Modify: `apps/boxscore/AGENTS.md` (one Gotchas bullet)

- [ ] **Step 1: Docs.** Add a `## Viewer roles` section to `apps/boxscore/README.md`: the two roles, the default (Self), the owner exception, where the owner sets roles (console's Boxscore group, or boxscore's gear), the `locked` state, and the courtesy-boundary sentence. Add one Gotchas bullet to `apps/boxscore/AGENTS.md`: "**`viewer.role` narrows every response.** A Self view viewer's `/api/leaderboard` carries only their own row with ranks blanked; to debug the full board locally, run on the owner's Mac or grant yourself `team` in `boxscore.roles`." Commit.
- [ ] **Step 2: Build and serve.** `cd apps/boxscore && bun run build`, then run the fixture server per `scripts/parity/run.md` with `BOXSCORE_FIXTURE_SCENARIO=self-view`, and again with `locked`.
- [ ] **Step 3: Parity.** Run the parity run for boards 08 and 09, dark and light. Result must be 0 mismatches outside pending board fixes listed for Matt. Re-run boards 03 and 04 (warm) to confirm Team view is unchanged.
- [ ] **Step 4: Screenshots.** Fast Browser screenshots of `/user/srivera/issuesCompleted` (self-view), `/user/someone-else` (self-view) and `/` (locked), in both schemes; and console's Boxscore group with the role control as owner. Look at each and list anything that reads wrong.
- [ ] **Step 5: CLI check.** The CLI calls the same `getLeaderboard`/`getUserDetail` core that Task 3's integration tests cover, so no separate CLI test is added. On this Mac (the owner's), run `bun run report -- --range 30d` and confirm the standings print unchanged (Team view). Say in the PR that the Self view CLI path is covered through the shared core.
- [ ] **Step 6: Push and PR.** Push the branch, open a PR on `m4ttstack/mattstack` titled `boxscore: viewer roles (BOXSCR-3)`, body per the repo template, noting the upgrade behavior change (members drop to Self view until granted). Wait for CodeRabbit and CI per the standing PR rules.
