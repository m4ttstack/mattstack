# Team directory

## Problem

The apps answer three questions in scattered, app-specific ways:

1. **What team am I on?** Explicit and solid: the roster plus
   `mattstack.activeTeam`.
2. **What is that team linked to?** Implied by board config:
   - `board.slack.channel` is the team's review channel.
   - A codeowners tab's `section` and `slackChannel` name the team's code
     owners section and the channel other teams ask it in.
   - The team-scope `mattstack.integrations.linear.teamKey` names its Linear
     team.
3. **Which of those entities is which kind?** Not stated anywhere. The board
   guesses: since #758, a code owners section is "ours" when a codeowners tab
   shows it or when it names `board.slack.channel`.

So "post to slack" on the board decides "this code owners section is my
team's, send it to our internal channel instead" from a tab that exists for a
different reason. A team with no codeowners tab, or one that adds a tab to
watch another team's queue, gets the wrong answer. Other teams, the ones the
board asks for code owner review, exist only as `#channel` text in CODEOWNERS
section names. And nothing outside the board can ask "what are this team's
channels?"

## Goal

One org-level directory of the teams mattstack should know about, including
teams that do not use mattstack. It declares each team's links to outside
tools once, in one place, for every app to read. The board's code owners
routing becomes a lookup instead of a guess. The settings it replaces are
moved into it and deleted.

Out of scope:

- chat tools other than Slack;
- owner handles (`@org/team`) for CODEOWNERS files whose sections name no
  channel;
- any per-team override of the directory;
- nested-form editing in the console.

## The setting

A new registry key, `mattstack.directory`:

- `scopes: ["org"]`, `merge: "replace"`.
- Only org admins write it, under the org store's existing ownership rule.
- No `default`. A reader treats an absent directory as empty.

```jsonc
// org/settings.org.jsonc
"mattstack.directory": {
  "teams": {
    "acme": {
      "linear": { "team": "CV" },
      "slack": {
        "codeOwnersChannel": "pod-acme",
        "channels": [
          { "name": "acme-internal", "kind": "review" }
        ]
      }
    },
    "payments": {
      "slack": { "codeOwnersChannel": "pod-payments" }
    }
  }
}
```

| Field | Meaning |
|---|---|
| `teams.<name>` | One entry per team. A name that matches a team folder under `mattstack/teams/` is that mattstack team. Any other name is a team outside mattstack. |
| `linear.team` | The team's own Linear team key. |
| `slack.codeOwnersChannel` | Where other teams ask this team for code owner review. It is also how a CODEOWNERS section is matched to this team. |
| `slack.channels[]` | Any other channels, each a `name` and a free-string `kind`. Teams define their own kinds. An app reads only the kinds it knows and ignores the rest. A team may list several channels of one kind. |

Channel names are bare, with no `#`. Matching is case-insensitive and ignores
a leading `#`.

The schema (`registry-schemas.ts`) is a `looseObject` throughout, so a field a
newer rt adds survives an older rt's write. Its `.meta` titles and
descriptions are the help the console shows.

## Resolution rules

Pure reads in rt-client (`settings/team-directory.ts`):

- `myDirectoryTeam()`: the entry keyed by the active team's name, or `null`.
- `teamForChannel(dir, channel)`: the entry whose `slack.codeOwnersChannel`
  matches `channel`, or `null`. With duplicates already on disk, the first by
  key wins.
- `channelsOfKind(entry, kind)`: the names of that entry's channels of that
  kind.
- `teamChannels(entry)`: the entry's code owners channel plus every other
  channel.

### Board: posting a code owners request

For a CODEOWNERS section still waiting on approval, the board reads the
section's channel the way it does today (`channelFromCodeownerSection`), then:

| The section's channel belongs to | The request goes to |
|---|---|
| my team: my `codeOwnersChannel`, or any channel in my `slack.channels` | the team row: my team's first channel of kind `board.slack.reviewKind` |
| another directory team | that team's `codeOwnersChannel` |
| no directory team | the channel named in the section, as today |

My own team matches on any of its channels. A section naming my review
channel therefore joins the team row rather than posting there a second time,
the double post #758 fixed. Other teams match only on `codeOwnersChannel`.

`board.slack.reviewKind` is a new field inside `board.slack`. It is team scope
with deep merge. The board reads a missing value as `"review"`, app-side,
since `board.*` rows carry no default.

The directory is the only source:
- With no review channel for my team, posting refuses with "Add a review
  channel for your team to the team directory", and the code owners dialog
  has no team row.
- The codeowners tab no longer decides which sections are mine.

### Board: the codeowners tab's channel

A codeowners tab's `slackChannel` is where the board finds and reacts to the
requests other teams post to us. That is my team's `codeOwnersChannel`, which
the tab reads from the directory. `slackChannel` stays on a tab only when the
tab watches a different channel.

### Ticket prefixes

`board.ticketPrefixes` stays a board filter. When it is unset, the board uses
`[my linear.team]`. A team sets it only to add extras: another team's Linear
key whose tickets it also works on.

### Linear team key

`lib/daemon.ts`, setup and the accounts check read the Linear team key from my
directory entry. `mattstack.integrations.linear` keeps `workspace` (org) and
loses `teamKey`.

## Validation

`rt settings set mattstack.directory` and the console's save both go through
the write gate:

- Two teams claiming the same `codeOwnersChannel` is refused, since matching
  would be ambiguous.
- A `kind` that no app reads is accepted with a notice. That catches typos
  (`reveiw`) without banning team-defined kinds. The known kinds list lives in
  rt-client beside the directory reads: `review` today.

## Editing

Edit it with `rt settings set mattstack.directory '<json>' --scope org`, or on
the console's settings page. The shape nests deeper than the console's forms
draw, so the console edits it in its JSON editor, validated against the
schema.

## Migration: cut over, then delete

No fallbacks are kept. The org has two users today, and stale legacy settings
are worse than a one-time cutover. One dated `MigrationDef`,
`2026-10-08-team-directory`, runs in `rt setup update`.

**On a Mac that can write the org store (an admin's):**

1. For each team folder with no directory entry, build one from that team's
   store:
   - `linear.team` from `mattstack.integrations.linear.teamKey`;
   - a `review` channel from `board.slack.channel`, read from the team store
     first, then the org store;
   - `codeOwnersChannel` from the first codeowners tab with a `slackChannel`.

   It never overwrites an entry. It skips a team whose code owners channel
   another entry already claims.
2. Write the directory once, at org scope.
3. For every team now in the directory, delete the moved values from that
   team's store:
   - the `channel` field of `board.slack`;
   - the `teamKey` field of `mattstack.integrations.linear`;
   - `slackChannel` on each codeowners tab whose value equals the team's
     `codeOwnersChannel`;
   - `board.ticketPrefixes`, when it exactly equals `[linear.team]`.

   Then delete `board.slack.channel` from the org store.

**On every Mac:** delete `board.slack.channel` from that Mac's user and
machine stores.

Rules:
- A value is deleted only after its team's entry is in the directory.
- A Mac that cannot write a shared store skips that store. Sync brings the
  admin's changes to everyone else.
- The schema drops `board.slack.channel` and
  `mattstack.integrations.linear.teamKey`.
- `board.tabs`' `slackChannel` loses its `inherits: "board.slack.channel"`
  hint.

The migration ships in the same release as the code that reads the directory,
so a member's update brings both together. A member still on an older board
after the admin's Mac migrates loses their posting channel until they update.

## Testing

- **rt-client:**
  - the directory reads: active team match, case-insensitive channel match,
    kinds;
  - the duplicate `codeOwnersChannel` refusal;
  - the unknown-kind notice.
- **board:**
  - routing a section by directory: mine, another team's, unlisted;
  - the review channel from `reviewKind`;
  - the refusal when there is no review channel;
  - the tab's channel from `codeOwnersChannel`;
  - the ticket prefix default.
- **daemon and setup:** the Linear key comes from the directory.
- **migration:**
  - seeding, and never overwriting an existing entry;
  - deleting each moved value;
  - a Mac that cannot write shared stores;
  - user and machine store cleanup.

## Open questions

- Should the directory hold people (a team's members), or stay with
  `mattstack.roster`? This spec leaves people in the roster.
