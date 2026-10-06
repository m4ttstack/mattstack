# Boxscore viewer roles

Ticket: BOXSCR-3. Status: approved in brainstorming 2026-10-06, awaiting spec review.

## Goal

A team owner decides, per member, whether that member sees the whole team in
boxscore or only their own person page. Team view is a grant: a member sees it
only when the owner has given it to them.

| Role | What the member sees |
|---|---|
| **Team view** | Today's boxscore: leaderboard, every person's page, ranks. |
| **Self view** (default) | Only their own person page, with every rank, leader and team comparison removed. |

This is a courtesy boundary, not a security one. Boxscore runs on each member's
own Mac with their own GitLab token and their own sqlite store, so a determined
member can read the store or query GitLab directly. The console copy says so.
A real boundary would need a shared, server-side boxscore, which is out of scope.

## Decisions

- **Default is Self view.** A roster member not listed in `boxscore.roles` gets Self view.
- **The owner's Mac and a Mac with no team always get Team view**, listed or not.
  The owner's Mac is a Mac whose team clone was not joined by invite.
- **No rank on a Self view page.** Only the member's own values and their own
  trend against the prior window. No "#3 of 8", no team size, no median.
- **Evidence keeps teammates' names** where they are part of the member's own
  work (their reviewers, authors of MRs they reviewed). Other people's stats and
  ranks are never shown.
- **The project chip stays.** Only the person switcher goes.
- **The key is boxscore-owned** (`boxscore.roles`), so `mattstack.roster` stays app-neutral.
- **The server narrows its response**, rather than refusing the leaderboard and
  adding a new endpoint, so the existing person page renders from the same shape.

## Settings

New registry row in `packages/rt-client/src/settings/registry-defs.ts`, beside
the other boxscore rows:

```ts
{
  key: "boxscore.roles",
  type: "object",
  scopes: ["team"],
  merge: "replace",
  description: "Who sees the whole team in boxscore: { \"<gitlab username>\": \"team\" | \"self\" }. A roster member not listed sees only their own page. The team owner's Mac always sees the whole team. A courtesy boundary, not a security one.",
}
```

- Team scope only, so no user or machine layer can override it. Members are
  pull-only on the team repo, so only the owner's write reaches the team.
- No `default` in the registry, matching the other boxscore rows; the fallback
  (Self view) lives in boxscore.
- Values other than `"team"` and `"self"` fail the row's schema. A username not
  on the roster is ignored.
- Follow the registry checklist in `docs/settings-architecture.md` and the
  `rt-settings` skill. Rebuild `packages/rt-client/dist` after the change.

`isJoinedTeam` (`packages/rt-client/src/settings/team-local-read.ts`) is
exported from rt-client's index so boxscore and console can ask whether this
Mac is a member's (joined) or the owner's.

## Viewer resolution

A pure function in `apps/boxscore/src/server/config/viewer.ts`:

```ts
type ViewerRole = 'team' | 'self';
interface Viewer {
  username: string | null; // null = could not identify the viewer
  role: ViewerRole;
}
resolveViewer(input: {
  currentUser: string | null;      // GitLab /user, already fetched and cached per process
  roster: RosterEntry[];
  roles: Record<string, ViewerRole>;
  team: { slug: string; joined: boolean } | null; // null = no team on this Mac
}): Viewer
```

Rules, in order:

1. No team on this Mac, or a team this Mac did not join (the owner's): `role: 'team'`.
2. `currentUser` is null (lookup failed) or not on the roster: `{ username: null, role: 'self' }`, the locked state.
3. Otherwise `roles[currentUser] ?? 'self'`.

`readSettings()` adds `roles` (read from `boxscore.roles`, `{}` when unset) and
`team` (from rt-client's `listTeams()` and `isJoinedTeam()`; one team per Mac).
Every request resolves fresh, so a role change takes effect on the member's
next page load after their team clone pulls.

## Server

`viewer: Viewer` is added to `LeaderboardResponse` and `UserDetailResponse`
(`apps/boxscore/src/shared/types.ts`).

A pure function `narrowForViewer(response, viewer)` in
`apps/boxscore/src/server/viewer-scope.ts`:

- Team view: returns the response unchanged.
- Self view with a username: `users` holds only the viewer's row; every
  metric's `rank` is `null`; `leaders` is `{}`. Values and prior-window deltas
  are kept.
- Locked state: `users` is `[]`, `leaders` is `{}`.

Routes (`apps/boxscore/src/server/routes.ts`):

- `GET /api/leaderboard`: the built response passes through `narrowForViewer`.
- `GET /api/detail?user=X`: for a Self view viewer, `X` other than the viewer
  (or any `X` in the locked state) answers `403 { error }`, checked before any
  evidence is built. The viewer's own detail has its `user` row's ranks blanked.
- `GET /api/links`, refresh and cache routes: unchanged. None returns a person's stats.

CLI (`apps/boxscore/src/server/cli.ts`): `bun run report` resolves the viewer
the same way and prints the narrowed standings. `--detail X` for someone else
exits non-zero with the same message as the 403. `--format json` prints the
narrowed response.

Fixture mode (`apps/boxscore/src/server/fixture/`) gains two scenarios:
`self-view` (the fixture's current user as a Self view viewer) and `locked`.

## UI: boxscore

Boards come first. Two new boards are drawn in
`docs/apps/design/boxscore/boxscore.pen` and approved before any UI code:

- **08 Person, self view**: the person page with the pieces below removed. The
  board settles what the summary strip becomes when only Coding days is left.
- **09 Not available / can't identify you**: the page for someone else's URL,
  and the locked state's message (who boxscore couldn't identify, what to check:
  the GitLab token, the roster).

Behavior, keyed off `viewer.role` in the response:

- `/` redirects to `/user/<viewer>`. In the locked state it shows the locked message.
- `/user/<someone else>` and `/user/<someone else>/<stat>` show the not-available page.
- The person page in Self view removes:
  - the "← Leaderboard" link and the person switcher (`ProfileHeader`)
  - the Leads, Top 3 and Median rank cards (`PersonSummary`)
  - the rank pills in the stat list (`StatRail`)
  - Rank, Leader and "Where the team sits" (`StatPanel`)
- It keeps the header bar (project chip, Refresh, gear), the "you" badge, stat
  values, Coding days, the stat description and its counted/excluded chips,
  and the evidence. The person page draws no deltas today and gains none; the
  response keeps the viewer's own deltas for a later trend view.

The same components serve both views through a `self` prop, so the two cannot
drift. The breadcrumb stays `boxscore / <name> / <stat>`.

## UI: console

In console's boxscore settings group (`apps/console/src/app/settings/groups.ts`,
also framed in boxscore's gear modal), `boxscore.roles` renders as one row per
`mattstack.roster` member with a Team / Self segmented control (kit component),
Self selected for anyone unlisted.

- On a joined Mac (`isJoinedTeam`), the control is read-only with the note
  "Only the team owner can change roles."
- Helper copy: "Team view sees everyone's stats. Self view sees only their own
  page. This is a courtesy: each member's boxscore runs on their own Mac."

## Rollout note

Existing teams change on upgrade: every member's Mac except the owner's drops
to Self view until the owner grants Team view. The release note for v2.21 says
so, and names the console group where roles are set.

## Testing

Targeted tests only locally; the full suite runs in CI.

- `resolveViewer`: no team, owner's Mac, joined + listed team, joined + listed
  self, joined + unlisted, lookup failed, viewer not on roster.
- `narrowForViewer`: team passthrough, self narrowing (ranks null, leaders
  empty, deltas kept), locked.
- Routes: leaderboard narrowed for self; detail 403 for another user and in the
  locked state; own detail has blanked ranks.
- CLI: narrowed standings; `--detail` another user exits non-zero.
- Components: each removed piece absent under `self`, present under team.
- Console: the per-member control renders, defaults to Self, and is read-only on a joined Mac.
- Registry: the row validates; a bad value fails the schema.
- Parity run (`apps/boxscore/scripts/parity/run.md`) for boards 08 and 09, dark
  and light, using the fixture scenarios, with Fast Browser screenshots in both schemes.

## Out of scope

- A real access boundary (shared or server-side boxscore).
- Hiding names inside evidence.
- Roles for any app other than boxscore.
