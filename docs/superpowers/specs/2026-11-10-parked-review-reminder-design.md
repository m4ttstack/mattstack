# Parked review reminders

## Why

A peer's re-review reached their own approval gate and parked; the author's
board went quiet. Nobody answered the gate, so the reviewer's gate sweep parked
it after the grace window and closed the pane. The author's board had no way to
say "parked": peer review status crosses the switchboard as `queued`,
`reviewing`, `done` or `error` only, so the round only finished when the author
noticed and messaged the reviewer on Slack by hand.

Success: the author sees, on the row, that a reviewer is waiting on their own
gate and for how long, and can remind them in one click with a Slack DM sent as
the author's agent ("Maude"). Person to person goes over Slack; desktop pushes
stay app to person (a board notifying its own user).

## Goals

- A reviewer's parked review gate shows on the author's row as "waiting on
  <name>" with how long it has been parked.
- The author's Remind sends a Slack DM to the reviewer from the author's Slack
  account, prefixed with the agent persona (`[Maude 🤖]:`, then a space).
- The persona's name and emoji become one general setting every surface reads,
  and old setting names keep answering outside callers with a deprecation
  notice.

## Non-goals

- Respond and doctor lanes. Only a peer's review gate gets the parked status
  here.
- Showing the reviewer's gate content (the question they are stuck on) to the
  author.
- Reminding a reviewer who has not started (an unanswered ask). That is the
  existing ask flow.
- A board-to-board reminder (a new envelope, a desktop push on the reviewer's
  Mac, reordering their decision queue). Matt ruled reminders between people
  go over Slack only.

## Anti-goals

- Never send anything to a teammate's Slack without the author's click. No
  automatic Slack step.
- Never guess "parked" from silence or a closed pane. Only the reviewer's board
  reports it.
- A parked review must not read as a failure ("stopped: pane closed") on the
  author's board.
- A board on an older version must not break. One accepted loss (Matt's
  ruling): a new reviewer board no longer sends "stopped: pane closed" for a
  parked review, so an old author board's row goes quiet for it, with no Retry,
  until it updates.

## Approaches considered

- **A. The reviewer's board reports `parked` (picked).** A new review-state
  status, sent when the sweep parks a review gate, cleared by the next
  `reviewing`/`done`/`error`. Honest, small protocol change, degrades to today
  on version skew.
- **B. The author's board infers it.** Treat a quiet or "pane closed" peer
  review as probably waiting. Cheap, but it guesses and is wrong when a run
  really died.
- **C. Mirror the gate.** Relay the reviewer's gate events to the author.
  Most informative, but it ships the reviewer's undecided review to the author
  and is a much larger protocol change.

Matt picked A. For the setting, he picked a split (name and emoji to a general
key, trigger stays with Slack support) plus a deprecation alias for old names,
and one project rather than two. After the builder check he ruled that Remind
is a Slack DM only (no board-to-board push), that a stored trigger resets
rather than carries over, and that the old-author-board loss is acceptable.

## Design

### 1. The `parked` status (reviewer's board)

- `ReviewStatePayload.status` gains `parked`, plus `parkedAt` (the reviewer
  board's clock). The local `ReviewStatus` type is unchanged: parking stays a
  gate fact, not a lane status.
- When the gate sweep parks a review-domain gate (`executeSweepAction`, `park`
  branch, after `gatePark` returns ok) on an MR this board does not author, the
  board sends `parked` to the same recipients `reviewSyncEnvelopes` uses, with
  the ask id echoed when the run answers an ask (`askIdForRun`).
- What clears `parked` on the author's side is the resumed pane's own first
  `review-status reviewing` call (`skills-src/review/SKILL.md`), which feeds
  `handleAgentSignal` and the existing sync. The board's own resume write
  (`gates/resume.ts`, `resumedStatus`) goes straight to the state file and
  sends nothing, so the author sees `parked` until the pane starts. `done` and
  `error` clear it the same way.
- A parked review gate that ends without a resume (closed as abandoned,
  superseded or pruned, `gates/cache.ts` and `pruneOffBoardGates`, or answered
  on a path that never resumes the pane) sends a new status `stopped` with the
  reason. A new author board drops the band on `stopped`; an older one stores
  it and shows nothing, as for any status it does not know. *My call:* `done`
  would fire the author's done-side effects, and `error` would read as a
  failure.
- `closedPaneReports` skips a lane whose review gate is parked. The pane was
  closed by the park, and the lane is resumable, so it is not an error.

### 2. Showing it (author's board)

- `isFreshPeerReview` and `activePeerReviewer` treat `parked` as live. It does
  not age out at `PEER_REVIEW_STALE_MS` (2h), since a park can last a day. It
  ages out at `NUDGE_NO_RESPONSE_MS` (48h) instead. *My call.*
- A sent ask whose reviewer reports `parked` gets a new `SentNudgeDisplay`,
  `parked`, which takes precedence over the 30 minute `no-update`.
- The ask band (`ask-band.ts`) gets a `parked` model: warn tone, hourglass,
  label "waiting on <name>", hover trail Requested → Started → Parked (with the
  time). Actions: Remind, Dismiss.
- A parked review the author did not ask for (the reviewer's board started it)
  shows the same band through `bandSource`'s peer branch, which today only
  takes `error`.
- Copy follows rt:ui-copy.

### 3. Remind (a Slack DM)

- The band's Remind is a Slack DM and nothing else: no envelope to the
  reviewer's board and no desktop push on their Mac. Nothing is sent without
  the author's click.
- The author's band records the reminder time, shows "reminded 5m ago", and
  rate-limits Remind to once per 15 minutes. *My call.*
- Remind sends a DM from the author's Slack account to the reviewer's Slack user,
  prefixed with the persona: `[Maude 🤖]: Matt is waiting on your review of
  !123 (Fix the cache). It's parked at your approval gate: <MR URL>`. The link is
  the MR's web URL. *My call:* the reviewer's own board or gate sheet lives at
  a URL on their Mac that the author's board cannot know.
- Sending goes through a new rt daemon verb that opens the DM and posts
  (`lib/slack/client.ts` already does `conversations.open` and
  `chat.postMessage`). The daemon's Slack client reads the board's Slack token
  (`lib/slack/daemon-client.ts`), so the token is unchanged. The verb adds the
  prefix with `slackPrefix` (`lib/slack/format.ts`); `post` adds none. `post`
  escapes its text, so the URL goes in bare, not as `<url|text>` markup.
  *My call:* one place owns posting as the user.
- The reviewer's Slack user comes from the board's existing Slack face match
  (`slack-face-names.ts`). No match: the button is disabled with a reason.

### 4. The persona setting

- New key `agent.persona` `{ name, emoji }`, scopes user/team/org, merge deep,
  default `{ name: "Maude", emoji: "🤖" }`.
- New key `chat.slackSupport.trigger` (string, the resume words), with the
  current behaviour as its default note: `@<persona name>` when unset.
- `RENAMES` names `chat.slackSupport.persona` as an old name of
  `agent.persona` (`"agent.persona": ["chat.slackSupport.persona"]`), with a
  migration step that drops `trigger`. A stored trigger is not carried over
  (Matt's ruling): everyone falls back to `@<name>` until they set
  `chat.slackSupport.trigger`. Migrations cannot move a value between keys, and
  this Mac stores none. Full registry checklist per rt:settings: schema,
  examples, console group, lock.
- Readers move: `lib/slack/persona.ts` (daemon), `apps/chat/src/server/chat.ts`,
  `apps/console/src/server/gates.ts`, the board's new Slack reminder, and docs
  (`slack-support-chat.mdx`, `apps/chat.mdx`).
- Moving a key in the org or team store is a shape older apps would misread;
  follow rt:settings for whether this needs an `ORG_LAYOUT` bump or the
  store-version/`RENAMES` path covers it.

### 5. Deprecation alias for renamed keys

- Today an explicit read of a renamed key's old name throws
  `unknown setting`. New: `getSetting(oldName)` resolves through the key that
  `RENAMES` names as its heir, projected to the old shape where a migration
  step exists, and returns `deprecated: { use: "<new key>" }` on the resolved
  value.
- `rt settings get <old> --json` carries `"deprecated": {"use": "..."}` and
  prints one warning line on stderr. In-repo readers are a lint failure
  (a `no-*` test), so only outside callers ever hit the alias.
- flock (`Sources/FlockCore/Chat/ChatSlackPersona.swift`, in the flock repo)
  reads the persona only by running
  `rt settings get chat.slackSupport.persona --json`, and reads only `name`.
  So the alias only has to project `name` (and `emoji`), with no reverse join
  of `trigger`. On any failure flock falls back to "Slack support" copy, which
  is the silent break the alias prevents. flock moves to `agent.persona` in
  its own PR; until then it works through the alias.

## Constraints

- Version skew between teammates' boards is normal. Every new status and
  envelope kind must be ignorable by an older board.
- The board never waits on the network in a request path. Sends go through the
  existing outbox.
- The Slack DM is outward-facing under Matt's name; it stays click-only.
- Board visual changes need Storybook stories and capture baselines per
  `apps/board/AGENTS.md`, and a Fast Browser look in both schemes.

## Left to the builder

- Exact band copy (through rt:ui-copy) and the Slack message wording.
- How `parked` and `stopped` ride the existing `review-state` plumbing, as
  long as old boards ignore them.
- The daemon verb's name and shape for the Slack DM.
- Test shape: unit tests for presence, band models, closed-pane skip, the
  Slack DM verb and the alias; one e2e for the `rt settings get --json`
  deprecation reply.
