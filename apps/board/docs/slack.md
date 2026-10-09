# Slack integration

Board plugs into a channel convention rather than inventing its own workflow.
The contract is two rules:

- Review requests are messages in **one channel** that contain the MR's URL,
  posted by the board's "post to slack" action or by hand. The board finds
  either; the earliest message containing the URL wins.
- Review state is signalled with **three reactions** on that message: one for
  "looking", one for "commented", one for "approved". A message asking for
  review of several MRs gets a threaded reply per MR, and the reactions go on
  the reply.

If your team already reviews this way, the board drops in as-is.

## One-time, per team: create the Slack app

At [api.slack.com/apps](https://api.slack.com/apps), choose **Create New App**
then **From an app manifest**, and paste
[`slack-app-manifest.yaml`](../slack-app-manifest.yaml). There is no bot and no
event subscription, just user-token OAuth scopes for reading the channel,
reacting, and posting.

The user token scopes, and the calls that need them:

| Scope | Board calls |
| --- | --- |
| `channels:read`, `groups:read` | `conversations.list` (finding the channel by name) |
| `channels:history`, `groups:history` | `conversations.history`, `conversations.replies` |
| `reactions:read` | `reactions.get` |
| `reactions:write` | `reactions.add`, `reactions.remove` |
| `chat:write` | `chat.postMessage` |

`rt setup slack create-app` declares the same set, and `rt setup slack connect`
asks for it. A team app created before rt asked for all of them grants a token
that fails with `missing_scope`: the Slack row in setup then says
`reconnect Slack to grant: <scopes>`, and if the reconnect still falls short,
the app's owner adds the named scopes under **User Token Scopes** at
`https://api.slack.com/apps/<appId>/oauth` first.

While the app is unlisted, add each teammate under **Settings > Collaborators**
so they can complete the OAuth flow, then share the app's client id and secret
with the team.

The client id is public, not a secret. `SLACK_CLIENT_ID` in `.env` still wins
first, but setting it once as `mattstack.integrations` on the team scope
(`slack.clientId`) defaults every other clone to it. The client secret is never
a team setting: setup reads and writes it only through
`.env`/`SLACK_CLIENT_SECRET`, prompting when it is unset.

## Per teammate: mint a token

`bun run setup` opens the browser, the teammate authorizes, and the resulting
`xoxp` token lands in their `.env`. Everything the board does in Slack (posts,
thread replies, reactions) appears as the person running the board, which is
the point: a 👀 from a reviewer means that reviewer.

## Per team: match the emoji to your convention

`slack.emoji` names the three reactions. Defaults are `eyes`,
`speech_balloon`, and `white_check_mark`. Any role can be overridden alone, so
a workspace with a custom `:comment:` emoji needs only:

```json
"slack": {
  "emoji": { "commented": "comment" }
}
```

Names are accepted with or without surrounding colons. The emoji names drive
everything downstream: the right-click mark and unmark actions, the reaction
chips on each row, and the reaction the board drops automatically when a
launched review starts (👀) or lands (💬 or ✅).

## Post templates

The channel the board posts to is your team's `review` channel in the org's
`mattstack.directory` (`rt settings set mattstack.directory ... --scope org`).
The board has no default channel.

| field | meaning |
|---|---|
| `singleTemplate` | template for one MR, used for both clipboard copy and posting. Default `{title}: {url}` |
| `multiHeader` | header line for a multi-MR summary. Default `{count} MR's ready for review :pray:` |
| `multiItem` | per-MR line under the header. Default `- {title}: {url}` |
| `autoResolveIntervalMinutes` | how often the server sweeps the board resolving missing Slack references. Default `15`; `0` disables the sweeper, and the client can still resolve on demand |

## Filtering to what has been posted

The Show menu in the header carries two Slack items: "Posted to #channel"
(MRs whose review request the board has found in the channel, the same rows
that carry the ✓ chip) and "Not Posted" (the rest). Unchecking Not Posted
narrows the board to what is actually asking for review, since an author
posting their own MR is often the signal it is ready for eyes. The state
lives in the URL as `?off=notPosted`; an older `?slack=posted` link still
reads the same way.

Unchecking Not Posted re-checks every unresolved MR against a fresh channel
index (one history call per channel, not one per MR), so a request posted
since the last sweep shows up right away. The same sweep otherwise runs every
`slack.autoResolveIntervalMinutes`.
