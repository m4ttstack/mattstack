# Board writes and identity follow the team's forge (BOARD-63, BOARD-68)

Status: draft for review, 2026-11-12. Project: GitHub parity (P-RT-28).

## Why

BOARD-59 (PR #1103) made the board read GitHub PRs and hid every action
that still called GitLab directly. PR #1108 then gave rows one rebase
action that works on GitHub through the daemon's `mr:action rebase`. What
is left: a GitHub team's board shows its PRs but cannot merge, arm
auto-merge, flip draft or post a held doctor note on them, does not know
who its own user is, and has a few small gaps (comment links, bots, Slack,
row refresh, one refusal message). This change closes them, so a GitHub
team gets the same author actions a GitLab team has.

Verified on main at 07805cc48:

- `server.ts` refuses merge, set and cancel auto-merge, the draft toggle
  and the held-note post on GitHub with `FORGE_NOT_YET` (`/mr/action`,
  `/draft`, `/drafts`, each at the team check and again after the row
  lookup).
- The row menu leaves out merge, auto-merge, mark ready and mark as draft
  on GitHub rows (`row-actions.ts`, one `!github` block); `canMerge`
  (`row-status.ts`) excludes GitHub rows, so the status line never offers
  merge; the bulk menu follows the per-row items.
- `DraftModal` renders no post button on GitHub.
- Comment links are `<mr url>#note_<id>` (`CommentsDrawer.tsx`, two
  sites). On GitHub that opens the PR without jumping to the comment.
- `isBotUsername` (`discussions.ts`) misses GitHub's `login[bot]` and never
  reads the `bot` flag glance sets on GitHub note authors. Bot reviewers
  count toward a row's review state.
- `slack.ts`'s `MR_URL_RE` matches only `/-/merge_requests/N`, so a Slack
  message linking several GitHub PRs reads as a single-PR post.
- Row refresh is hidden on GitHub rows and labelled "refresh from gitlab".
  The route itself works: the daemon's `mr:get` with `refresh: true` now
  writes GitHub PRs back to its store.
- A refused respond ask on a GitHub team (`bin/triage.ts` declines it in
  peer mode with the `FORGE_NOT_YET` sentence as the reason) reads "Held
  back by a board limit" in the refusing board's ask history, because
  `plainReason` (`triage/nudge.ts`) words any unknown reason that way.
- The `#N` copy in the review modal and the Slack posts modal already
  renders through `mrRef`; it was never seen in a browser because the
  GitHub fixture opens neither modal.
- On GitHub the board's identity is null: the seat is `board.defaultMember`
  with no cross-check, and the manual doctor launch gets no branch-writing
  fix classes.

## Goals

- Merge, set auto-merge, cancel auto-merge, mark ready, mark as draft and
  the held doctor note post work on a GitHub PR, from the row menu, the
  bulk menu, the status line and `DraftModal`, exactly where GitLab rows
  offer them today.
- A merge on a queue-protected branch enters the merge queue and the board
  says so. It never reports a queued PR as merged.
- On a GitHub team the board knows its own forge username, so a seat set to
  someone else's name owns nothing, and the manual doctor launch licenses
  the same fix classes it does on GitLab.
- A comment link on a GitHub row lands on that comment.
- Bot accounts do not count as reviewers on GitHub rows.
- A Slack message linking several GitHub PRs is detected as a multi-PR
  post.
- Row refresh works on GitHub rows and names the row's forge.
- A refused respond ask on GitHub says why in plain words.
- Both modals render the `#N` title against the GitHub fixture, checked in
  light and dark.

## Non-goals

- The re-review latch on GitHub (BOARD-65) and codeowner tabs (BOARD-66).
- Auto-doctor and the triage pass on GitHub (BOARD-64, the
  board-auto-doctor lane), including `bin/triage.ts` and everything under
  `src/triage/` except the one `plainReason` case below.
- A row badge for "in the merge queue". glance's PR shape has no queue
  field, so showing it would need a new forge read per row.
- Roster display names from GitHub profiles. No daemon verb looks up a
  GitHub user, and the roster already carries each member's name, which
  the board shows today on a GitHub team.
- GitHub Enterprise.

## Anti-goals

- GitLab behaviour changes. Every GitLab write keeps its glance call, its
  request, its error text and its HTTP status, byte for byte.
- The board building or holding a GitHub client or token. Every GitHub
  read and write goes through a daemon verb.
- A new poll or a change to any interval.
- A test, fixture or browser check that reaches a real PR or MR, or the
  daemon.
- Reporting a queued merge as merged, or an unanswered write as failed.

## Constraints

- Standing rulings: one forge per team; GitLab behaviour does not change;
  new per-MR actions go in the right-click menu, never a card button (this
  change adds none, it only shows existing ones on GitHub rows); the
  board's fetch cadence is deliberate.
- Write fence: `apps/board/` except `src/triage/`, `bin/triage.ts` and
  `skills-src/`, with one exception granted by the shepherd: one case in
  `plainReason` in `src/triage/nudge.ts`.
- Daemon replies (`packages/rt-client/src/commands.ts`): `mr:action`
  answers `{ok: true}`, or `{ok: true, data: {queued: {position, state}}}`
  for a merge that entered a queue, or `data.sourceBranchNotDeleted`;
  `mr:comment` answers `{noteId, discussionId, resolvable, url, mrUrl}`;
  `mr:get` answers `{mr, fetchedAt}`. A daemon that gives no answer in
  time returns an error starting with `DAEMON_UNREACHABLE_PREFIX`.
- The daemon's own `mr:action` budget is being raised from 30 to 90
  seconds (PR #1110). The board's client-side wait must not assume 30.
- Fixture mode refuses every non-GET with 501, so a browser check cannot
  fire a write.
- UI copy follows rt:ui-copy; no em or en dashes; no dot separators.

## Approaches

**A. One `forge-writes.ts` module (picked).** Beside `forge-rebase.ts`,
following PR #1108's split: one function per write, a GitLab side that
keeps today's glance calls and a GitHub side over daemon verbs. Routes
pick the side by the row's forge. Tested without booting `server.ts`.

**B. A GitHub branch inside each route.** Smallest diff, but `server.ts`
boots on import, so the GitHub paths could not be unit tested.

**C. Both forges through daemon verbs.** One path, but it changes GitLab's
requests, against the standing ruling.

## Decided (shepherd, 2026-11-12)

1. Identity on a GitHub team is the team record's forge username,
   `activeTeam().username` from rt-client, the same source the auto-doctor
   lane uses. A follow-up moves the board and auto-doctor together to the
   daemon's `forge:self` verb (being added by the mcp-review-tools lane)
   once it lands; the PR body names it.
2. One case in `plainReason`, keyed on the `FORGE_NOT_YET` constant. The
   board-auto-doctor lane keeps the peer-mode decline in `bin/triage.ts`
   and is not editing `nudge.ts` (confirmed in chat, 2026-11-12).
3. Approach A.

## Design

### 1. Identity

A server helper, `forgeSelf()`, answers the board's own forge username:

- GitLab team: `readMemory().identity?.username ?? null`, exactly today's
  read.
- GitHub team: `activeTeam().username`, read through rt-client. Null when
  the team record has none (a team set up by hand), which leaves the seat
  uncross-checked, the same as a GitLab board with no token.
- Fixture mode: null, so a fixture never reads the real team record.

It replaces the two `readMemory().identity?.username` reads that feed the
seat: `actingSeat()` and the `tokenUser` field `/data.json` sends the
client. `effectiveSeat` is unchanged, so on GitHub a seat whose name
differs from the team record's username becomes null and owns nothing.

The manual doctor launch (`/doctor`) passes `forgeSelf()` straight to
`manualDoctorFields` on a GitHub team, where it passes null today. It does
not go through `resolveDispatchIdentity` or its cache in
`state/auto-dispatch.json`: that cache can hold a username up to a day old
(from the team's GitLab days, say), which would license fix classes
against a different user than the seat check uses, and the file is the
triage pass's. GitLab keeps today's cached `validateToken` path. *(My call,
from the builder check.)*

`activeTeam()` reads three small local files. `forgeSelf()` memoizes its
GitHub answer and drops it on the same settings-change reload that
already reloads the board's config.

### 2. `src/forge-writes.ts`

One module, two sides, one shape:

```ts
type ForgeWriteResult =
  | { kind: 'done'; queued?: { position: number | null; state: string };
      sourceBranchNotDeleted?: string; title?: string; noteId?: number }
  | { kind: 'refused'; reason: string }      // the forge said no
  | { kind: 'unanswered'; message: string }  // no answer; outcome unknown
  | { kind: 'failed'; message: string };
```

Functions: `runMrWrite(target, action)` for merge, rebase, set and cancel
auto-merge; `setDraft(target, draft)`; `postNote(target, body)`.

**GitLab side.** The route bodies' current calls move here unchanged:
`runMrAction` from `mr-action.ts` for the four actions (its
`ReadBackFailedError` rule included), `updatePullRequest(path, iid,
{draft})` for the toggle, `NoteMutator.createNote` for the note.
`mergeRefusalReason` keeps producing `refused` for a merge. The route
keeps every GitLab status and message it returns today; the GitLab tests
that pin them stay green unchanged.

**GitHub side.** Every call goes through `rtCommand` with the row's
serialized rt identity (`repoIdentityField(mr.rtRepo)`):

| Write | Daemon call |
|---|---|
| merge, rebase, set and cancel auto-merge | `mr:action {action, args: []}` (merge sends no input, so the repo's own merge method and queue decide, as GitLab's merge does) |
| mark ready, mark as draft | `mr:action {action: 'toggleDraft', args: [draft]}` |
| held note post | `mr:comment {body, resolvable: false}` |

- A merge reply with `data.queued` is `done` with `queued`; with
  `data.sourceBranchNotDeleted` it carries that sentence.
- A daemon error is `refused` with the forge's own sentence, its leading
  `Error: ` and `<operation> failed: ` stripped, so the client shows it as
  a reason.
- A merge with no answer (`DAEMON_UNREACHABLE_PREFIX`) reads the PR back
  once through `mr:get {refresh: true}`: `state === 'merged'` is `done`,
  anything else is `unanswered` ("no answer from rt; the merge may still
  land"). The board never retries a write. Other writes with no answer
  are `unanswered` without the read-back.
- Every write uses one board constant, `FORGE_WRITE_TIMEOUT_MS`, 120 s,
  above `mr:action`'s 90 s budget after PR #1110, with a comment saying it
  must stay above the daemon's.

The daemon follows every `mr:action` with a fetch and store write-back, so
after a GitHub write the route only drops its snapshot cache, as GitLab
routes do now.

### 3. Server routes

`/mr/action`, `/draft` and the `/drafts` post lose their two
`FORGE_NOT_YET` refusals and call `forge-writes.ts`:

- The team check before the token check goes. The GitLab token check stays
  in its current position, gated on the board's forge
  (`config.forge.kind === 'gitlab'`), so a GitLab board's error order is
  unchanged and a GitHub board never sees "gitlab token not configured".
  One forge per team makes the board's forge and the row's forge the same.
- A GitHub row with no rt repo answers 400 "this MR has no rt repo", as
  `/mr/refresh` does.
- `done` answers 200 `{ok: true}` plus `queued`, `sourceBranchNotDeleted`,
  `title` (draft) or `noteId` (note) when present.
- `refused` answers 409 `{reason}`, the shape GitLab's merge refusal
  already uses. `/draft` and `/drafts` keep their GitLab failure statuses
  and gain the same 409 for a GitHub refusal.
- `unanswered` answers 504 `{reason}`.
- `failed` comes only from the GitLab side, and each route answers it
  with today's status and message (`gitlab <action> failed: …` 502,
  `note post failed: …` 502, and `/draft`'s existing recovered and
  unchanged replies).
- `/drafts` records `postedNoteId` from the GitHub reply's `noteId` just
  as it does from GitLab's note. An unanswered note post may have landed,
  so the draft stays `held` and the toast says it may have posted and to
  check the PR before posting again; the board never posts it a second
  time on its own.

Ownership (`requireOwnMr`), the iid check, the local-request check and the
JSON-body check run on both forges exactly as today.

A GitHub write can wait up to `FORGE_WRITE_TIMEOUT_MS`, past `Bun.serve`'s
60 second `idleTimeout`, so each of the three routes lifts the idle
timeout for its own request (`server.timeout(req, 0)`, as the rebase and
doctor routes already do) before it calls the daemon.

`FORGE_NOT_YET` and `gitlabOnly` stay: the latch and other GitLab-only
paths still use them.

### 4. The client

On a GitHub row, with the same conditions as a GitLab row:

- The row menu's forge section offers merge, set or cancel auto-merge
  (auto-merge still leads the top section when approved with only CI
  left), mark ready or mark as draft, and refresh. The `!github` gate
  goes; the bulk menu follows.
- `canMerge` drops `!onGitHub(mr)`, so the status line offers merge.
- `DraftModal` shows its post control, or "only the author posts", on both
  forges.
- Refresh's label and pending toast name the row's forge
  (`refresh from github`, `refreshing #12 from github…`).

**Merge outcome wording** (rt:ui-copy, exact words left to the builder):

- merged: today's "merge accepted #N".
- queued: "#N joined the merge queue", with the position when GitHub gives
  one. A queued reply releases the row's "merging…" hold at once, since a
  queued PR can stay open far longer than the hold's three minutes.
- refused: today's "couldn't merge #N: <reason>".
- unanswered: "no answer for #N; it may still merge". The row keeps its
  "merging…" hold, as after an accepted merge, so a merge that lands late
  shows within the hold. This is the cadence every fired merge already
  gets (the hold's faster refresh, lapsing at three minutes), not a new
  one. Today any non-ok reply drops the hold; a 504 from a merge stops
  doing that. *(My call, from the builder check.)*
- bulk: a queued PR counts as done, and the summary says how many queued.

The same `reason` body serves `/draft` and the note post's toasts.

### 5. Comment links

A pure helper beside `mrRef` in `mr-ref.ts`,
`commentUrl(mr, discussionId, noteId)`:

- GitLab: `<mr url>#note_<noteId>`, unchanged.
- GitHub, by the glance discussion id's prefix:
  `gh-issue-comment-` gives `#issuecomment-<noteId>`,
  `gh-review-thread-` gives `#discussion_r<noteId>`,
  `gh-review-` gives `#pullrequestreview-<noteId>`.
  `gh-review-thread-` is tested before `gh-review-`, which is its prefix.
  An unknown prefix gives the PR URL with no anchor, never a guessed one.

Both `CommentsDrawer` links use it (each note's time link and a thread's
"open" link); both already have the discussion id in hand.

### 6. Bots

- `isBotUsername` also matches a trailing `[bot]`. GitLab usernames cannot
  contain `[`, so GitLab results do not change.
- `isBotAuthor` returns true when the author's `bot` flag is true. GitLab
  leaves it absent.
- `buildBoard` drops bot reviewers from a GitHub row's
  `reviews.reviewers` (a `[bot]` login, or a name in `config.botUsernames`)
  before any review state reads them, so a bot's review never makes a row
  read "commented" or "changes requested". GitLab rows keep their reviewer
  list as served. The forge's own approval verdict (`isApproved`) is not
  touched.

### 7. Slack

`MR_URL_RE` also matches `https://<host>/<owner>/<repo>/pull/<n>`, and its
doc comment says "MR or PR". The multi-post check counts distinct URLs of
either shape.

### 8. The refusal wording

`plainReason` gains one case keyed on the imported `FORGE_NOT_YET`
constant, worded by rt:ui-copy (along the lines of "Replies on GitHub
aren't supported yet"). Nothing else under `src/triage/` changes.

### 9. Request volume

A write costs the daemon the same calls `mr_merge` and the MCP tools make
for the same write, plus one `mr:get` only after a merge got no answer.
No poll, no interval, no background read. Identity reads local files.

## Testing

- **forge-writes:** each GitHub write sends the expected verb and payload
  to a fake `rtCommand`; `queued` and `sourceBranchNotDeleted` pass
  through; a daemon error becomes `refused` with the prefixes stripped; an
  unanswered merge reads back once and maps merged to `done` and anything
  else to `unanswered`; the timeout is `FORGE_WRITE_TIMEOUT_MS`. Each
  GitLab write calls the same fake provider methods `runMrAction`'s tests
  pin today, with the same results.
- **Routes:** the existing GitLab route tests stay green unchanged.
  `src/__tests__/server-github-team.test.ts` already boots the real board
  for a GitHub team against a fake daemon on the test HOME's `rt.sock`;
  its "refuses the GitLab-only writes" cases flip to: each write reaches
  the fake daemon with the expected verb and payload, a GitHub board never
  answers "gitlab token not configured", ownership still refuses another
  author's PR, and each result kind (queued, refused, unanswered) maps to
  its status.
- **Identity:** `forgeSelf()` gives the memory identity on GitLab, the
  team record's username on GitHub, and null in fixture mode; on GitHub a
  seat that differs from it owns nothing.
- **Client:** row-actions tests that a GitHub own row offers merge,
  auto-merge, the draft toggle and refresh with a forge-aware label, the
  bulk menu includes them, and `canMerge` holds on a GitHub row; GitLab
  menus unchanged. Action-runner tests for each merge outcome's toast and
  that a queued reply releases the merging hold.
- **Comment links, bots, Slack, plainReason:** unit tests per rule above,
  with GitLab inputs giving today's outputs.
- **Fixture:** `tests/fixture-github/` gains what opens both modals (a row
  with a finished review report, a row with several Slack posts), and its
  discussion ids take glance's `gh-...` shapes. Everything stays invented.
- **Fast Browser:** the GitHub fixture rendered in light and dark: the own
  row's menu showing merge, auto-merge, the draft toggle and refresh; the
  comments drawer's links; the review modal and the Slack posts modal with
  `#N` titles; `DraftModal`'s post control. No write is fired.
- **Before the PR:** the board's suite from `apps/board`, the board's type
  check, and `bun run purity` from the worktree root.

## Left to the builder

- Exact names beyond those above, and how `forge-writes.ts` splits its
  GitLab and GitHub sides into helpers.
- Exact toast, label and refusal wording, by rt:ui-copy.
- Which fixture rows carry the modal data, and whether the capture
  baselines gain the GitHub fixture or the check stays Fast Browser only.
