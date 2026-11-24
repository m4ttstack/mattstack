# Support host: teammates start a Maude chat

**Status:** approved by the operator, 2026-11-24. Builds on
`2026-11-03-slack-support-chat-design.md` and
`2026-11-06-slack-support-requester-design.md`, which stay true except where
this document says otherwise. "Maude" is the `agent.persona` default. "Alex" is
any host. Lines marked *My call* were not decided by the operator.

## Intent

Today only the operator starts a support chat, from a Claude pane or the chat
app. A teammate should be able to ask from mattstack, talk to the operator's
agent, and have a ticket filed the way it is today.

It must work for any organization that adopts mattstack: the org opts in and
designates one person's computer as the support agent. That person is the
**host**.

## Today

- A teammate's Slack DM starting with `@Maude` raises a `slack-open` gate on
  the operator's Mac (`lib/slack/trigger-offer.ts`). The search looks back 10
  minutes and the gate expires after 30.
- I found no control inside mattstack that offers help. The trigger is named
  in the closing line and the docs.
- Each open is approved by the operator. This design changes that for one path.

## Goals

- **Need help?** A floating button in a bottom corner of the MR board, the
  service most people live in.
- **Ask Maude…** in the mattstack app's menu, which works when the board does not.
- Org opt-in and a designated host, both in settings.
- A roster member's request opens by itself. The host gets a notice and can stop it.
- A request sent while the host is away waits, and the teammate is told.
- The conversation stays in the teammate's Slack DM with the host, and tickets
  are filed as they are now.

## Non-goals

- A Claude pane command for teammates.
- A support agent in the cloud, or a second or backup host.
- Orgs without Slack.
- Changing typed `@Maude` DMs, which still ask the host first.
- New enforcement of what the support agent may do. The operator chose to keep
  the skill's rules. The agent launches under the host's default permission
  settings, including permission skipping if the host set it.
- Attaching logs or screenshots. Withdrawing a sent request.

## Anti-goals

It has failed, even if it works, if:

- A request opens a chat for someone outside the org's roster.
- An org that did not opt in, or a Mac whose owner did not accept, shows the
  feature or opens anything.
- A request is lost while its sender believes it was received.
- Something is attached that the teammate did not see before sending.
- The teammate's text reaches the agent as the host's instruction.
- The host's Mac has to accept a connection from another machine.
- A ticket id or link reaches a teammate, or a work MR or ticket id reaches a
  ticket.

## Decisions made with the operator

| Question | Decision |
|---|---|
| Who may open a chat | Anyone on the org roster, automatically |
| Host control | A notice and Stop. Over the cap, the host approves |
| Cap | The operator picked an option suggesting one chat per person, two at once |
| Where teammates ask | The board's floating button and the app menu |
| Opt-in | By the org, in settings, with a designated person's computer |
| Host away | Queue, and say so |
| Transport | Switchboard (A below) |
| Read-only limits | Keep the skill rules; no new enforcement |
| Stop | Instant; the person's next request in 24 hours asks the host |

## Approaches

- **A. Switchboard carries the request, Slack carries the chat (picked).** The
  relay already queues undelivered envelopes for 7 days and stamps the sender
  from their token. Teammates need no new Slack permission and the host can
  report back. Costs: both people must be board-peered, both daemons must be
  new enough, and request text passes through the relay. Support uses its own
  relay queue, not the board inbox (see Transport).
- **B. The teammate's Mac sends the `@Maude` DM.** No relay, but by Slack's docs
  teammates likely need `im:write` and a reconnect, the host depends on
  `search.messages` (which Slack calls legacy), and queueing and host-away are
  new work.
- **C. The button copies a message and opens the DM.** Smallest, with the least
  context and no host-away notice.

## Settings and opt-in

| What | Scope | Who | Default |
|---|---|---|---|
| `support.enabled` | org | Org owner or admin | off |
| `support.host`, a roster username | org | Org owner or admin | unset |
| `support.acceptRequests` | machine | The host, on one Mac | off |
| `chat.slackSupport.defaultRepo` (exists) | user | The host | unset |

- **Two sides.** The org names the host and the host accepts on one Mac, since
  it uses their Claude account, Slack DM and disk. *My call.*
- **Ready** means support-chat Slack scopes, `rt.linearSupportApiKey`, a
  `defaultRepo` rt knows a folder for, `chat.humanHandle`, a working board token,
  the org's support key readable on this Mac, and what `lib/linear/org-ids.ts`
  needs (a forge host and a Linear team in `mattstack.directory`), without which
  every ticket is refused. Accepting is refused with the missing piece named.
  *My call:* a working ticket path is required. The host's Linear key decides
  which workspace tickets reach, as today.
- **Where:** org keys in the app's Settings > Team and the console's org
  settings; the host's accept switch and readiness in Settings > Team on the
  host's Mac. A setup row on the host's Mac reports a piece that stops working.
- **Hidden** when the org has not opted in or no Mac accepts, and for the host.
  Shown disabled, with the reason, when the teammate has no board token, no
  Slack connection, or cannot read the org's support key. *My call.*
- **Turning off** either side stops new requests. Open chats continue. A queued
  request gets `not-accepting`.

## Transport

*My calls in this section, made after a design check found the board inbox unsafe.*

- **Its own relay queue.** Requests and statuses go through new support routes
  on the switchboard, authenticated by the same board token, kept 7 days until
  acked, and pulled by each Mac's daemon over an outbound long-poll. The board
  inbox cannot carry them: the served board and the `board-peer` cron both read
  and ack it, they can be different builds, and an old one acks an unknown type
  and drops it. With its own queue, only a daemon that understands a request can
  ack it, after storing it, and neither board has to be running.
- **Availability.** A new opt-in flag on the relay, set by the accepting
  daemon. Not the asks flag, which is on by default. The relay also records when
  the host's daemon last polled, so the form can say "Alex's Mac is away" before
  sending. If it looks up but nothing answers in 2 minutes, it says so then.
- **Proof of org.** Relay usernames are global, with no org or forge in the key,
  so a username alone does not prove membership. Turning support on writes a
  random support key to the org's members secrets
  (`mattstack/org/secrets/`, which every member's age key opens). A request
  carries a keyed hash, made with that key, over its id, sender, host, text,
  context and Slack id. The host recomputes it with the relay-stamped sender and
  also requires that sender on the roster. Statuses back are checked the same
  way. Removing a member rotates the key.

Follow rt:settings for the registry checklist and for what an older rt does
with the new org keys.

## Asking

1. The teammate clicks **Need help?** or **Ask Maude…** and writes the problem.
2. The form shows everything attached, each part removable, and who answers.
   - Always offered: rt, app, board and macOS versions, and the ids of setup
     rows that are not ready.
   - From an MR's row menu ("Need help with this MR?"): the MR's link and its
     review or run state. *My call.*
   - Never: logs, file contents, env values, tokens, local paths. *My call.*
3. Send goes through one daemon verb, used by the board and the app. There is
   no CLI or MCP verb, and the mod denies agents a shell route to it: a person
   sends a request, from a form that showed it. It sends the text, the context,
   a stable id and the sender's Slack user id, read by the daemon from their own
   token's `auth.test`. Size-capped. A retry reuses the id.
4. The form reports status, and a later change is a desk notification.

| Status | Teammate reads |
|---|---|
| sent | Asked Alex's agent |
| received | Alex's Mac has it and Maude is starting |
| opened | Maude messaged you in Slack, with a link to the DM |
| already-waiting | You already have a request waiting; it is shown |
| waiting | Alex needs to OK this one; it will wait |
| no answer in 2 minutes | Alex's Mac is away. Your request will wait up to 7 days |
| already-open | You already have a chat open, with a link to the DM |
| declined, not-accepting, failed | What happened, and to message Alex directly |
| expired | It was never picked up after 7 days |

An accepted send is not "received": only the host's own status is. An
unreachable relay is a send failure that keeps the text. Status is the sender's
daemon's, so both surfaces read one state.

## On the host's Mac

1. **Receive.** The daemon stores the request, then acks it. An id already seen
   is a redelivery.
2. **Check** the keyed hash and the roster first. A failure is dropped and
   logged with no reply. Then: support is on, this person is the host, this Mac
   accepts; otherwise `not-accepting`.
3. **Slack account.** The claimed id must be an active person in the host's
   workspace, else `failed`. *My call:* no second match against the roster. The
   daemon has none, the board's is by display name, and only a proven member can
   reach this step.
4. **Already open** with that person: reply `already-open`. A request of theirs
   already waiting: `already-waiting`. *My call.*
5. **Under the cap:** reply `received`, open through `approveSlackOpen`'s path
   with no gate, and send the host a desk notification that opens the chat in the
   viewer, where Stop is. Reply `opened` only when Maude's first message is in
   Slack.
6. **Over the cap:** a `slack-open` gate, reply `waiting`. It expires with the
   request, not after 30 minutes. Decline replies `declined`.
7. **An open that fails,** including the agent never reaching the chat within 60
   seconds, replies `failed` with a plain reason and notifies the host.

A request is its own stored record, and its gate is keyed on the request id, not
`slack:<userId>`. It never supersedes or blocks a typed `@Maude`, pane or resume
gate for the same person, and a chat opened with them by any route settles their
waiting request as `already-open`. *My call.*

**Stop** is new UI in the chat viewer and a new operator-only verb, since the
viewer has no close today and Archive only hides the room. Decided with the
operator: it kills the agent's pane at once, tells the teammate in one fixed line
that the host will follow up, and leaves no resume window. That person's next
request within 24 hours is a gate, reply `waiting`, instead of opening by itself.
It is offered on any open support chat. *My call.*

*My calls:* the cap counts every open support chat, operator-started ones
included, and is enforced in one transaction so two requests cannot pass it
together. A request while the person's closed chat is in its grace window opens
a new chat and ends that window. Requests open in arrival order when a Mac comes
back, so the first two open and the rest wait for the host.

This is a deliberate exception to the requester design's rule that nothing
opens without the operator's tap. It exists only in this daemon path: no
model-issued tool call may reach it, `gate_answer` still refuses `slack-open`,
and the mod's shell denies grow to cover the new verbs.

## The chat

- The request and its context are the conversation's first item, framed as the
  teammate's text, and posted to the room under the teammate's handle. The brief
  says only who asked and when, as the trigger path does.
- The teammate's words are not in Slack, so Maude's first DM restates the
  problem. For a request over a day old, it asks whether help is still needed.
  *My call.*
- MR links are for the chat. The ticket guard already refuses them.
- Resume and the ordinary close are unchanged. With no requesting pane,
  milestones fall back to the host's desk notification. `closed` is skipped
  today when there is no requester, so these chats send it: the outcome, summary
  and ticket list reach the host. *My call.*
- `rt:slack-support` changes for the new opening, through
  superpowers:writing-skills. The closing line may name Need help? beside the
  trigger.

## Constraints

- Outbound only from the host's Mac: the relay long-poll, Slack, Linear and Claude.
- Request text sits in the relay, unencrypted by us, until acked or 7 days. The
  form says the request goes through mattstack's relay. *My call.*
- Version skew is normal: an older daemon never polls the support queue or sets
  the flag, and the relay ships before any client that needs it.
- Employer-visible surfaces carry no mattstack ticket ids.
- `slack-open` gates never appear on the board.

## UI

Mocked in pen.dev with the operator, then built live, last: the floating button
(bottom right proposed), the form and its statuses, the row menu entry, the app
menu item and its window, and the Settings > Team section. The button must clear
the selection bar, drawers and full-screen gate sheets. Copy follows rt:ui-copy.
Both colour schemes are rendered and looked at.

## Testing

- **Unit:** each host check, the hash and roster refusals (a same-named
  user from another org included), cap races, redelivery, the ack-after-store
  rule, gate lifetime, status mapping, what
  context is attached, visibility rules.
- **Daemon:** request to open to ticket to close with fake Slack, Linear and
  relay; host away then back after days; opt-out with requests queued.
- **Relay:** queue, availability, last-seen, and older clients.
- **Live:** a second account asks from the board and from the app menu, with the
  host's Mac awake, then asleep.

Docs: `slack-support-chat.mdx` gains asking for help, hosting, and org opt-in.

## Left to the builder

- Verb and route names, payload shapes, how the key rotates, storage (claim the next
  `SCHEMA_VERSION` per `.claude/rules/state.md`), and size caps.
- How the app reads status, and whether its form is native or a web view.
- The setup row's id and wording.
