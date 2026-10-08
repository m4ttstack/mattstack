# Team directory

## Problem

The apps answer three questions in scattered, app-specific ways:

1. **What team am I on?** Explicit and solid: the roster plus
   `mattstack.activeTeam`.
2. **What is that team linked to?** Implied by board config:
   `board.slack.channel` is the team's review channel, a codeowners tab's
   `section` and `slackChannel` name the team's code owners section and the
   channel other teams ask it in, and the team-scope
   `mattstack.integrations.linear.teamKey` names its Linear team.
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

One org-level directory of teams mattstack should know about, including
teams that do not use mattstack. It declares each team's links to outside
tools once, in one place, for every app to read. The board's code owners
routing becomes a lookup instead of a guess.

Out of scope: chat tools other than Slack, owner handles (`@org/team`) for
CODEOWNERS files whose sections name no channel, and any per-team override of
the directory.

## The setting

A new registry key, `mattstack.directory`:

- `scopes: ["org"]`, `merge: "replace"`.
- Only org admins write it: the org store's existing ownership rule, nothing
  new.
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
| `teams.<name>` | One entry per team. A name that matches a team folder under `mattstack/teams/` is that mattstack team; any other name is a team outside mattstack. |
| `linear.team` | The team's own Linear team key. |
| `slack.codeOwnersChannel` | The channel where other teams ask this team for code owner review. It is also how a CODEOWNERS section is matched to this team (see below). |
| `slack.channels[]` | Any other channels, each a `name` and a free-string `kind`. Teams define their own kinds. An app reads only the kinds it knows and ignores the rest. A team may list several channels of one kind. |

Channel names are bare, with no `#`, matching `board.slack.channel` today.

Schema (`registry-schemas.ts`): a `looseObject` throughout, so a field a
newer rt adds survives an older one's write.

## Resolution rules

A pure helper in rt-client, `teamDirectory()`, with these reads:

- `myDirectoryTeam()`: the entry keyed by the active team's name, or `null`.
- `teamForChannel(channel)`: the entry whose `slack.codeOwnersChannel` equals
  `channel`, or `null`. Matching is exact and case-insensitive, like Slack
  channel names.
- `channelsOfKind(entry, kind)`: the names of that entry's channels with that
  `kind`.

### Board: posting a code owners request

For a CODEOWNERS section still waiting on approval, the board reads the
section's channel the way it does today (`channelFromCodeownerSection`), then:

| The section's channel belongs to | The request goes to |
|---|---|
| my team: my `codeOwnersChannel`, or any channel in my `slack.channels` | the team row: my team's channels of kind `board.slack.reviewKind` |
| another directory team | that team's `codeOwnersChannel` |
| no directory team | the channel named in the section, as today |

The board's team review channel is resolved in this order:

1. My team's first channel of kind `board.slack.reviewKind`.
2. `board.slack.channel`, the fallback for orgs with no directory entry yet.

`board.slack.reviewKind` is a new field inside `board.slack`. It is team
scope with deep merge, and the board reads a missing value as `"review"`
(app-side, since `board.*` rows carry no default).

The codeowners tab's role in deciding "ours" is dropped once the directory
names the team. It stays as the fallback while it does not.

### Board: the codeowners tab's channel

A codeowners tab's `slackChannel` is where the board finds and reacts to the
requests other teams post to us. That is my team's `codeOwnersChannel`. The
tab reads it from the directory when `slackChannel` is unset. A set
`slackChannel` still wins, for a tab that watches a different channel.

### Ticket prefixes

`board.ticketPrefixes` stays a board filter. When it is unset, the board
falls back to `[myDirectoryTeam().linear.team]`. A team adds extras (another
team's Linear key whose tickets it also works on) by setting it.

### Linear team key

`lib/daemon.ts` and setup read `mattstack.integrations.linear.teamKey`. They
read `myDirectoryTeam().linear.team` first and fall back to it.

## Validation

`rt settings set mattstack.directory` and the console form check:

- Two teams claiming the same `codeOwnersChannel` is refused, since matching
  would be ambiguous.
- A `kind` that no app reads is accepted with a warning, which catches typos
  (`reveiw`) without banning team-defined kinds. The known kinds list lives
  in rt-client beside `teamDirectory()`: `review` today.

## Editing

`rt settings set mattstack.directory '<json>' --scope org` works from day
one. The console's settings page draws the form from the schema, the same
way it draws other object keys. A dedicated directory editor is follow-up
work, not part of this spec.

## Migration

No data migration. Every new read falls back to the key it replaces, so an
org that never writes a directory behaves exactly as it does after #758.

To move an org over:

1. An admin writes `mattstack.directory`. For an org like Acme that is one team
   entry with its two channels and Linear key, plus entries for the other teams it
   posts code owner requests to, as known.
2. The board, daemon and setup pick it up through the fallback order above.
3. A later change retires the fallbacks and their keys:
   `board.slack.channel`, the codeowners tab's "ours" inference, and the
   team-scope `mattstack.integrations.linear.teamKey`. A dated
   `MigrationDef` copies any value still set into the directory. That
   happens only after every member runs an rt that reads the directory.

## Testing

- rt-client: `teamDirectory()` reads (active team match, channel match
  case-insensitive, kinds), the duplicate `codeOwnersChannel` refusal and the
  unknown-kind warning.
- board:
  - `ownersPostPlan` routes a section by directory (mine, another team's,
    unlisted).
  - The review channel resolves from `reviewKind`, with the
    `board.slack.channel` fallback.
  - The tab's channel falls back to `codeOwnersChannel`.
  - The ticket prefix fallback.
- daemon and setup: the Linear key read prefers the directory.

My own team matches on any of its channels so that a section naming my
review channel joins the team row, rather than posting to that channel a
second time (the double post #758 fixed). Other teams match only on
`codeOwnersChannel`.

## Open questions

- Should the directory hold people (a team's members), or stay with
  `mattstack.roster`? This spec leaves people in the roster.
