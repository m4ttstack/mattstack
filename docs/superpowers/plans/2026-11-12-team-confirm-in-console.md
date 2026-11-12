# Confirm New Teammates From Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin sees every teammate waiting to join, and confirms them, from console, without relying on the `member_joined` banner.

**Architecture:** `rt team status --json` gains an `invites` list read live from the switchboard. The console server lists the teams on this Mac (`listOrgs` from `@mattstack/rt-client`), runs `rt team status --team <slug> --json` for each one and `rt team members sync --team <slug> --json` on Confirm through `runRt`. The console client adds a Team page, a Team rail entry with a count badge, and a "Waiting to join" card on the runs page.

**Tech Stack:** Bun + TypeScript (rt CLI, `bun test`), Hono + React + `@mattstack/app-kit` + TanStack Query (console, vitest).

**Spec:** `docs/superpowers/specs/2026-11-12-team-confirm-in-console-design.md`

## Global Constraints

- `rt team status --json`: the envelope's existing keys stay as they are; `invites` is added, never renamed or moved.
- An invite's `state` is exactly `"invited" | "replied" | "expired"`. `replied` means the switchboard holds a reply that opens under the invite's key and carries a valid age key. It never comes from the daemon's `invite-replies` kv.
- `invites` is `[]` on a Mac with no invite records for the team. It is never omitted.
- Confirm runs `rt team members sync --team <slug> --json`, unchanged, with `WRITE_TIMEOUT_MS`.
- Confirm copy: "Add <handle>" with one replied invite in the team, "Add N people" with more.
- `rt` output goes through `lib/ui/out.ts` (`.claude/rules/output-layer.md`); the TS CLI stays UI-free.
- Console UI follows `docs/apps/ui-authoring.md`: kit components only, role tokens, no raw colours, no `·` separators, no coloured-border-plus-radius "fingernails".
- Console copy follows the `rt:ui-copy` skill: 2 to 6 word clauses on buttons and badges.
- Run `bun test` from the repo root; console tests with `bun run console:test`.

## Review Focus

1. **The relay is down or slow.** `rt team status` must still answer: each invite whose reply read throws reads as `invited`, and the human output says the switchboard did not answer. Pinned in Task 1.
2. **A poisoned reply** (a blob that does not open, or a key that is not age1). It reads `invited`, never `replied`, so console never offers to add it. Pinned in Task 1.
3. **More than one org on the Mac.** A bare `rt team status` refuses as ambiguous, so the console server passes `--team` for every org. One org's failure must not blank the others. Pinned in Task 3.
4. **Confirm while the sync fails or adds nobody** (the reply turned unusable between read and sync). Console shows the sync's own message and keeps the row. Pinned in Tasks 3 and 4.
5. **A double click on Confirm.** Only one sync runs; the button disables while it's in flight. Pinned in Task 4.

---

### Task 1: Invite states read live from the switchboard

**Files:**
- Create: `lib/team/invite-status.ts`
- Test: `lib/team/__tests__/invite-status.test.ts`

**Interfaces:**
- Consumes: `readInviteRecords(p, slug)` (`lib/team/invite-records.ts`), `RelayClient.readReply(id, creatorSecret)` (`lib/team/relay-client.ts`), `openReply(blob, key, id)` (`lib/team/invite-crypto.ts`), `base64ToKey`, `isValidAgePublicKey` (`lib/team/members.ts`).
- Produces:
  ```ts
  export type InviteState = "invited" | "replied" | "expired";
  export interface InviteStatus { handle: string; teams: string[]; expiresAt: string; state: InviteState }
  export interface InviteStatusResult { invites: InviteStatus[]; relayFailed: boolean }
  export async function readInviteStatuses(
    p: Pick<Probes, "readFile" | "home">,
    slug: string,
    deps: { relay: Pick<RelayClient, "readReply">; roster: { username: string; teams?: string[] }[]; now: number; open?: typeof openReply },
  ): Promise<InviteStatusResult>
  ```
  `teams` comes from the roster entry whose username matches the handle (`canonicalHandle`), `[]` if there is none. The list is sorted by handle.

- [ ] **Step 1: Write the failing tests.** Fake relay and a fake `open`, with records seeded in a temp-home invite file:
  - `replied when the reply opens to a valid age key`: `state === "replied"`, `teams` from the roster.
  - `invited when the relay has no reply` (`"none"`).
  - `expired when no reply and expiresAt is past`. A reply on an expired invite still reads `replied`, because sync adds it.
  - `invited when the reply does not open`: `open` throws, so the state is `invited`.
  - `invited when the opened key is not age1`.
  - `relay failure reads invited and sets relayFailed`: `readReply` throws on one of two invites; the other still resolves.
  - `no records file gives an empty list`: `{ invites: [], relayFailed: false }`.
- [ ] **Step 2: Run `bun test lib/team/__tests__/invite-status.test.ts`.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement `readInviteStatuses`.** Read every invite at once (`Promise.all`). It never writes kv and never warns.
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "team: read invite states live from the switchboard"`

### Task 2: `rt team status` reports invites

**Files:**
- Modify: `commands/team.ts` (`TeamDeps` near line 86, `teamStatus` near line 1160)
- Test: `commands/__tests__/team-status.test.ts`

**Interfaces:**
- Consumes: `readInviteStatuses` (Task 1).
- Produces: the `rt team status --json` envelope gains `invites: InviteStatus[]`. A new `TeamDeps` seam, `inviteStatuses?: (slug: string, roster: RosterMember[]) => Promise<InviteStatusResult>`, defaults to a real relay built as on line 785 (`createRelayClient(deps.probes.fetch, switchboardUrl(deps.probes.env))`) and `Date.now()`.

- [ ] **Step 1: Write the failing tests** in `team-status.test.ts`, following its existing fixtures:
  - `--json carries invites from the seam`: the envelope `invites` deep-equals the seam's list; every existing key is still present.
  - `--json carries an empty invites list with no records`.
  - `human output names who is waiting`: with one replied invite for `alice`, `renderPlain` output has a "waiting to join" row naming `alice`.
  - `human output notes an unreachable switchboard`: with `relayFailed: true`, the row's hint says the switchboard did not answer.
  - The solo branch (`mode: "solo"`) also carries `invites: []`.
- [ ] **Step 2: Run `bun test commands/__tests__/team-status.test.ts`.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Call the seam with the full roster (`everyone`, not `onTeam`). Add `invites` to `result` and to the solo result. Add one `out.kv("waiting to join", ...)` row inside the existing `out.section` call, shown only when an invite is replied: the value is the replied handles joined by ", ", and the hint is `rt team members sync` to add them. Use `pending` copy, never `failed`.
- [ ] **Step 4: Run the test file again, then `bun test lib/__tests__/no-raw-output.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "team status: report open invites and who is waiting"`

### Task 3: Console server team routes

**Files:**
- Create: `apps/console/src/server/team.ts`
- Create: `apps/console/src/shared/team.ts` (the wire types and `confirmLabel`)
- Modify: `apps/console/src/server/routes.ts` (chain `.route('/', teamRoutes(...))`)
- Test: `apps/console/src/server/team.test.ts`, `apps/console/src/shared/team.test.ts`

**Interfaces:**
- Consumes: `rt team status --team <slug> --json` (Task 2), `runRt`, `READ_TIMEOUT_MS`, `WRITE_TIMEOUT_MS`, `RtNotFoundError` (`rt-bin.ts`), `listOrgs` (`@mattstack/rt-client`), `parseJsonPayload` (as `skills.ts` uses it).
- Produces:
  ```ts
  // shared/team.ts
  export interface TeamInvite { handle: string; teams: string[]; expiresAt: string; state: 'invited' | 'replied' | 'expired' }
  export interface TeamMember { username: string; role?: string; peered: boolean | null }
  export interface TeamView { slug: string; name: string; role: string | null; members: TeamMember[]; invites: TeamInvite[] }
  export type TeamRead = { slug: string; ok: true; team: TeamView } | { slug: string; ok: false; error: string };
  export function confirmLabel(invites: TeamInvite[]): string | null // null when none replied
  // server/team.ts
  export function teamRoutes(deps?: { runRt?: RunRt; orgs?: () => string[]; fixture?: TeamRead[] | null }): Hono
  //   GET  /api/team          -> 200 { teams: TeamRead[] }
  //   POST /api/team/confirm  { slug } -> 200 { added: string[]; pending: string[] } | 4xx/5xx { error }
  ```

- [ ] **Step 1: Write the failing tests** with a fake `runRt` and `orgs`:
  - `lists every org with --team`: two orgs give two `rt team status --team <slug> --json` calls and two `ok: true` entries.
  - `one org failing keeps the others`: a non-zero exit for one org gives `ok: false` with its stderr, and the other stays `ok: true`.
  - `no orgs gives an empty list`.
  - `confirm runs members sync for the slug` with `['team','members','sync','--team','acme','--json']` and `WRITE_TIMEOUT_MS`, and returns the sync's added and pending handles.
  - `confirm surfaces the sync's error`: a non-zero exit gives 502 with stderr as `error`.
  - `confirm rejects an unknown slug` (one not in `orgs()`): 400, and `runRt` is never called.
  - `fixture answers reads and refuses confirm` (403).
  - `rt missing is 503` (`RtNotFoundError`).
  - In `shared/team.test.ts`, `confirmLabel`: `null` for none replied, `"Add alice"` for one, `"Add 2 people"` for two.
- [ ] **Step 2: Run `bun run console:test -- team`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Handlers stay inline and chained (`routes.ts`'s Hono RPC rule). Read the members sync `--json` envelope's shape from `teamMembersSync` in `commands/team.ts` before mapping `added`/`pending`. Under a design fixture (`fixtureMode`), pass one team with one replied invite and one invited one, so the mock and parity runs have data.
- [ ] **Step 4: Run `bun run console:test -- team` and `bun run console:typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "console: team read and confirm routes"`

### Task 4: Console Team page, rail badge and waiting toast

Revised 2026-11-12 after the mock review with Matt. The approved mock is in `docs/apps/design/console/console.pen`: frames "Team · waiting to join · light/dark" and "Runs · waiting toast · light/dark", plus "Runs toast · several waiting · light/dark". Read them (pencil MCP) before building; they win over this text on looks.

**Decisions from the review (binding):**
- Only org owners and admins see any of this. A team counts when its `TeamView.role` is `"org-owner"` or `"admin"` (rt's `isOrgAdmin`); every other team is dropped from the page, the badge and the toast. With no such team the rail entry is hidden and `/team` shows a short empty state.
- The Team page is one centred panel (about 880px) on the page background, never full-width card lists. Above it, a team switch (segmented control) when more than one team shows; a segment carries its waiting count as a badge, and a warning icon when its read failed (`ok: false`, whose error shows inside the panel instead of the table).
- The panel: a header ("<name> members" and the viewer's role in plain words), tabs "Members N" and "Invites N", then a compact table (Member, Role, Board). A replied invite is a row inside the Members table, with an amber "Waiting for approval" chip (warn tokens, never accent) and the Approve button right beside the name. Invited and expired invites list under the Invites tab (expired with a warn chip).
- The button reads "Approve" when one invite in that team replied, "Approve N" when N did (it runs the team's one `members sync`, which adds them all). Change `confirmLabel` in `apps/console/src/shared/team.ts` and its tests to that copy. Every replied row's button in a team runs the same confirm and disables together while it is in flight.
- The Runs page gets no card and no approve action. It gets a dark pill toast in the same style as the pack page's unsynced toast (`apps/console/src/app/wiring/graph/UnsyncedToast.tsx`, styles in `graph.module.css` `.toast*`): top right over the page, warn dot, "<handle> is waiting for approval" with the team as grey meta, or "N people are waiting for approval" when more than one, a "Review ›" chip that opens `/team`, and a dismiss ✕. Like that toast it shows once per waiting list (a localStorage signature of the replied handles), hides after 8 seconds unless hovered, and the rail badge carries the state afterwards. Do not copy the toast's markup and CSS: extract the shared pill into one component both toasts use.

**Files:**
- Create: `apps/console/src/app/team/useTeam.ts`, `TeamPage.tsx`, `TeamRailEntry.tsx`, `WaitingToast.tsx` (and `.module.css` where needed); the shared pill component (your call where it lives, outside `wiring/`)
- Modify: `apps/console/src/app/routes.ts` (add `{ name: 'team' }` at `/team`), `apps/console/src/app/App.tsx` (section `team`, label "Team", the rail entry after Slack chats, the route case), `apps/console/src/app/runs/runs-page/RunsPage.tsx` (mount the toast), `UnsyncedToast.tsx` (use the shared pill), `apps/console/src/shared/team.ts` (`confirmLabel` copy), `apps/console/src/server/team.ts` (the design fixture: an `org-owner` team with three members, one replied and two invites, one expired; a second admin team that fails to read)
- Test: `apps/console/src/app/team/*.test.tsx`, `apps/console/src/app/routes.test.tsx`, `apps/console/src/shared/team.test.ts`
- Docs: `apps/console/AGENTS.md` "Routes and chrome" (add `team` to the route list and one paragraph on `/team`)

**Interfaces:**
- Consumes: `GET /api/team`, `POST /api/team/confirm` → `ConfirmResult { added, pending, warnings }` (Task 3), `POLL_MS`/`retryOnce`/`readApiError` (`runs/useRuns`), the `SlackRailEntry` pattern (`Indicator` + `RailLink` + `useShellRail`).
- Produces: `useTeam(): { teams: TeamRead[]; waiting: number; loaded: boolean; failed: boolean; confirm(slug: string): Promise<void>; confirming: string | null }`, where `teams` holds only org-owner/admin teams (failed reads included) and `waiting` counts their replied invites.

- [x] **Step 1: Mock it in pen.dev.** Done and approved by Matt (see above).
- [ ] **Step 2: Write the failing tests:**
  - `routes`: `/team` gives `{ name: 'team' }`.
  - `confirmLabel`: `null` for none replied, `"Approve"` for one, `"Approve 2"` for two.
  - `useTeam` filter: a `member` or `owner` (team owner) team is dropped; `org-owner` and `admin` stay.
  - `TeamRailEntry`: hidden with no admin team; no badge at 0 waiting; a badge reading `1` at one.
  - `WaitingToast`: renders nothing at 0 waiting; one replied shows "alice is waiting for approval" and the team; two show "2 people are waiting for approval"; Review navigates to `/team`; it does not show again for the same handles after dismissal; it has no approve button.
  - `TeamPage`: a replied invite is a Members row with "Waiting for approval" and an "Approve" button; invited and expired list under Invites; an `ok: false` team shows its error in the panel without hiding the other team's segment.
  - `confirm disables while in flight`: a double click posts once, and both replied rows' buttons disable.
  - `confirm failure keeps the row and shows the error`: a notification error carrying the server's message; the row stays.
  - `confirm that adds nobody`: a 200 with `added: []` shows a notification error carrying `warnings[0]` (fallback copy when empty) and keeps the row.
- [ ] **Step 3: Run `bun run --filter mattstack-console test src/app/team src/app/routes.test.tsx src/shared/team.test.ts`.** Expected: FAIL.
- [ ] **Step 4: Implement against the mock.** `useTeam` is one query (`['team']`, `refetchInterval: POLL_MS`) shared by the page, the badge and the toast. `confirm` posts, then invalidates `['team']`, reports through `notifications.success` / `notifications.error`, and gates itself on `confirming`.
- [ ] **Step 5: Run `bun run console:test`, `bun run console:typecheck` and `bun run console:lint`.** Expected: PASS.
- [ ] **Step 6: Check it in Fast Browser.** Start the console dev server with `CONSOLE_FIXTURE=design`, open `/team` and `/`, and screenshot both in light and dark next to the mock frames. Say plainly what looks wrong; fix it before going on.
- [ ] **Step 7: Commit:** `git commit -m "console: Team page, rail badge and waiting toast"`

### Task 5: Offer to update admin secret access when the org's admins change

Added 2026-11-12 at Matt's request. Editing `mattstack.org` (in console Settings or anywhere) changes who the org's owners and admins are, but the admin-only secrets stay locked to the old set until `rt team admin-secrets` runs. rt already detects this drift: the `org.admin-secrets` setup row (`adminSecretsRowSafe` in `lib/setup/validators/admin-secrets.ts`). Console surfaces it and offers the fix.

**Files:**
- Modify: `commands/team.ts` (`teamStatus` envelope, a `TeamDeps` seam), `apps/console/src/shared/team.ts`, `apps/console/src/server/team.ts`, the Team page and toast from Task 4, the console Settings editor for `mattstack.org`
- Test: `commands/__tests__/team-status.test.ts`, `apps/console/src/server/team.test.ts`, the Team page tests, the Settings editor test that covers the key panel

**Interfaces:**
- `rt team status --json` gains `adminSecrets: { state: "current" | "needs-sync" | "needs-you" | "not-this-mac" | "unknown"; detail: string | null } | null`. It is `null` when the role is not `org-owner`/`admin`. Map from the row: no row → `current`; `needs-you` whose action is the plain `rt team admin-secrets` steps → `needs-sync`; any other `needs-you` (the token mismatch) → `needs-you`; `skipped` → `not-this-mac`; `error` → `unknown`. `detail` is the row's detail. Existing keys stay; the solo branch carries `adminSecrets: null`. New seam `adminSecretsState?: (slug) => Promise<...>` on `TeamDeps`; a throw reads `unknown`, never fails status. The human output adds one kv row "admin secrets" only when the state is not `current`, with pending copy and the `rt team admin-secrets` hint.
- `TeamView.adminSecrets` mirrors it. `POST /api/team/admin-secrets { slug }` runs `rt team admin-secrets --team <slug> --json` with `WRITE_TIMEOUT_MS`, with the same guards as confirm (non-local 403, fixture 403, unknown slug 400, rt missing 503, failure 502 through `failureMessage`), and returns the envelope's result.

- [ ] **Step 1: Write the failing tests:** status JSON carries `adminSecrets` per mapping (one test per state, plus `null` for a member and for solo) and the human row; server route tests mirroring confirm's; Team page: `needs-sync` shows an amber notice in the panel ("Admins changed" and what it means in a short clause) with an "Update access" button beside the text that posts once and refreshes; `needs-you` shows the detail and the command, no button; `current` shows nothing; toast: a team in `needs-sync` raises the same pill toast as Task 4 ("Admin access needs updating", Review › to `/team`), once per signature; Settings: the `mattstack.org` editor shows a warning when `admins` is non-empty and `owners` is missing or empty ("No owners listed, so every admin is an org owner"), and saving that key invalidates `['team']`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Reuse `adminSecretsRowSafe`; build its `SecretPresence` the way `rt setup status` does for that row. Reuse Task 4's pill component and amber tokens; no new visual pattern.
- [ ] **Step 4: Run `bun test commands/__tests__/team-status.test.ts`, `bun test lib/__tests__/no-raw-output.test.ts`, the e2e file covering `team status` (`bun test --preload ./e2e/setup.ts e2e/tests/org-teams.test.ts`), `bun run console:test`, `bun run console:typecheck`, `bun run console:lint`.** Expected: PASS.
- [ ] **Step 5: Check it in Fast Browser** with the design fixture (add a team in `needs-sync`): `/team`, `/` and the `mattstack.org` Settings editor with owners removed, light and dark. Say plainly what looks wrong; fix it.
- [ ] **Step 6: Commit:** `git commit -m "console: offer to update admin secret access when admins change"`
