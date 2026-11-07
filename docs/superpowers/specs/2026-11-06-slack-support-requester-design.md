# Slack support: requester, resume and SUPPORT tickets

**Status:** design, 2026-11-06. Builds on
`docs/superpowers/specs/2026-11-03-slack-support-chat-design.md` (the base design),
which stays true except where this document says otherwise.

## Intent

The operator wants to say "start a slack support session with Leath" to the agent
already in front of them, and have that agent run the chat's whole lifecycle: write
the support agent's brief, get the operator's go-ahead, hand the chat to a background
agent, and hear back when it opens, files a ticket, or closes. Today the only way in is
typing `/slack-support` or tapping through Flock, and the agent that asked learns nothing
afterwards.

Two gaps from the first real chats come with it. A teammate who remembers something after
a close has no way back in: it worked once only because the old background agent was still
alive. And tickets land as local markdown files the operator has to promote by hand.

Three bugs found on 2026-11-06 shaped the design (see Related fixes):

- A `/slack-support` line over about 800 characters arrives as a paste, and Claude Code
  never runs it as a command.
- Flock then dropped the chat's owner after 60 seconds with no chat.
- When the chat finally opened by hand, it had no owner, so Flock showed it on every tab.

## Goals

- **Requester-driven opens.** Any Claude pane the operator is talking to can start a
  support chat. That pane becomes the chat's requester.
- **Operator approval.** Nothing opens without the operator approving a gate. The gate
  shows in the asking pane and the console, never on the board.
- **Background agent.** The conversation runs in a background agent, so the requester's
  session stays quiet.
- **Milestone notices.** The requester gets lifecycle notices pushed to it: opened (or
  failed to open, with the reason), ticket filed, closed with the outcome, resume offered,
  resumed. It never sees the chat's messages unless it reads the room.
- **Resume.** A closed chat can resume, started by the operator, or offered when the
  teammate starts a message with the bot's trigger (`@Maude` by default) within 60 minutes of the close.
- **Linear tickets.** Bug and feature write-ups go straight to the mattstack Linear
  SUPPORT team.

## Non-goals

- Mirroring chat messages into the requester. Milestones only.
- A teammate reopening a chat with no operator approval.
- New peek UI. `rt chat read <room>` and the chat viewer cover it.
- Changing the support agent's rules beyond tickets (still no code changes, no other
  trackers).

## Anti-goals

It has failed, even if it works, if:

- An agent can open, or approve the opening of, a Slack chat without the operator's own
  tap. That includes the requester answering its own gate.
- A teammate's ordinary reply to the operator after a close starts anything.
- A mattstack ticket id or link appears in the Slack DM (work-org-visible).
- Work org MR or ticket ids land in mattstack Linear.
- The requester's code session fills with chat noise.

## Decisions made with the operator

| Question | Decision |
|---|---|
| Who holds the conversation | A background agent, as Flock's button does today |
| The requester's role | Starts it, writes the brief, gets the gate approved, and is keyed into the lifecycle |
| What the requester hears | Milestones only: opened or failed, ticket filed, closed with outcome, resume offered, resumed |
| Approval | A gate, shown in the pane and the console, never on the board |
| Resume memory | Reuse the old agent if its pane is alive, else a fresh agent seeded with the room history |
| Who starts a resume | The operator, or the teammate's trigger message inside the window, which raises a gate |
| On the trigger | A gate. The operator approves; nothing reopens by itself |
| Trigger phrase | The persona's `trigger` at the start of the teammate's message. Without one, `@<name>`, so `@Maude` by default |
| Persona | The `chat.slackSupport.persona` setting: `{ name, emoji, trigger? }`, default `{ name: "Maude", emoji: "🤖" }`, scopes org, team and user, deep merge. It names the bot in the prefix, the closing and holding lines, and the trigger |
| Tickets | Straight to Linear SUPPORT through a scoped API key; local markdown files go away |
| What the teammate hears about a ticket | "I wrote it up", no id or link. The id goes to the operator and the requester |
| Approach | A: the daemon owns the lifecycle |

## Approaches

**A. The daemon owns the lifecycle (chosen).** A request verb raises a `slack-open`
gate. On approval the daemon opens the chat and starts the background agent itself,
passing only short arguments. The conversation row records the requester. The daemon
pushes milestones to the requester, watches a closed DM for the trigger during the grace
window, and files tickets through a small Linear client. Flock's button and the operator's
resume become callers of the same verbs. Costs a schema bump and work across rt, Flock and
the mod, but every surface shares one path. Picked because it is the only option that
works without Flock open, avoids polling, and removes the typed long command.

**B. Flock drives it.** The requester asks Flock to run its button flow. It reuses working
UI, but needs Flock open and keeps the typed-command path that failed on 2026-11-06.

**C. The requesting agent orchestrates.** The requester runs `rt agent start`, then
`rt pane send`, then polls `chat_slack_status`. No rt changes, but it polls, which the base
design rules out. It also hits the paste bug, and loses the close if the requester exits.

## How it works

### A request

1. The operator tells a pane: "start a slack support session with Leath about X."
2. The requester writes a brief: teammate, problem, what "sorted" means, what is already
   known or ruled out.
3. The requester calls `chat_slack_request {person, brief}`. The daemon resolves the
   person (the same lookup as `slack-open`), saves the brief, and raises a `slack-open`
   gate. The gate shows the resolved person and the brief, with Approve and Decline.
4. The gate appears as a form in the requester's pane and in the console. The tool
   returns the gate id. The decision arrives later as a milestone; the requester does not
   block.
5. **Approve:** the daemon opens the conversation with `requester_session` set, and starts
   a background agent in the requester's repo. The agent's skill is started with the
   conversation id only (see Starting the support agent).
6. **Decline:** the requester gets a "declined" milestone and nothing opens.

The person may need picking. When the lookup is ambiguous, the request fails with the
candidates, the same as `slack-open` today, and the requester asks the operator which one.

### The gate

- **Kind.** A new gate kind, `slack-open`, used for requests and resumes. The board
  never shows it: `buildQueueExtras` and `countsForBadge` skip the kind, and
  `isBoardGateFrame` never admits it. The subject uses a `slack:` prefix (builder's
  call), never `mr:` or `run:`.
- **Console.** The console handles only run gates today: `listAllRunGates` filters on
  `run:`, `/gates/:id` redirects to a run page, and gate cards render inside `RunDetail`.
  A Slack gate needs new UI: a "Slack" gates list with Approve and Decline, a badge
  count, and a `/gates/:id` target for the desk notification's click. This is new UI, so
  the plan mocks it in pen.dev first, against the console's live tokens, before building.
- **Pane.** The pane shows the gate through the existing gate form presentation.
- **Human answers only, at the base design's bar.** The operator chose "stop accidents
  and misled panes", not a boundary against a determined local process. Today a pane
  gate's answer is written by the agent (`AskUserQuestion`, then `gate_answer`), so for
  `slack-open` gates:
  - The mattstack mod records the answer itself, from the `AskUserQuestion` result in the
    pane: an engine-stamped hook, not a tool call the model makes.
  - `gate_answer`, `herd_gate_answer` and `rt gate answer` refuse a `slack-open` gate,
    except from the console's own route.
  - The mod's Bash and Monitor deny grows to cover `rt gate answer` on these gates,
    `rt chat slack-resume` and `rt chat slack-request` run through a shell. Agents use the
    MCP tools, which always raise the gate.
  - The console answers through its existing route.
  - The mechanism is the builder's, as long as no model-issued tool call can answer one.
- **Expiry.** An unanswered gate expires after 30 minutes and sends a "not approved in
  time" milestone. This is the builder's call; adjust if it reads wrong.

### Starting the support agent

No `/slack-support` line is ever typed. The daemon starts the background agent
(`agent:start --bg`) and records the conversation as assigned to that agent. On
`session.start`, the mattstack mod asks the daemon whether this session's agent has an
assigned conversation. If so, it schedules `rt:slack-support` with
`$.command.run`, passing the conversation id only. The skill reads its brief with
`chat_slack_status` (extended to return the brief for this pane's own conversation), then
sends its first message. Short arguments keep it under the paste threshold, and the brief
stays out of the command line.

The `/slack-support` command and its `composer` origin check stay as the operator's
manual path. The command keeps its short form, `/slack-support <person> <problem>`. On
run, it goes through the same open as a request with no gate, because typing at the prompt
is the approval:
- The problem becomes the brief.
- The daemon starts a background agent, which holds the chat.
- The typing pane becomes the requester and Flock's owner. (My call: this matches the
  background model the operator chose, and no long line is ever typed into an agent.)

### The requester and milestones

The conversation row records `requester_session` and `requester_handle` (the requester
must be signed in to rt chat; the request signs it in if not, as the mod does today).
Milestones are DMs to the requester's chat handle, so they arrive by push as any rt chat
DM does, and the requester never polls. They come from a reserved daemon identity (a new
reserved prefix such as `rt.`, alongside `slack.`), never the operator's handle or the
support agent's (my call):
- From the operator's handle, they would read as the operator's instructions and trip
  the operator's own desk notification.
- From the support agent's handle, they would arrive in the cross-session frame that
  tells the model to act.
- The identity is excluded from the sweep the same way `slack.` handles are.
- The requester reports milestones to the operator and does not act on a close's
  leftovers unless the operator asks.

| Milestone | Carries |
|---|---|
| `declined` / `expired` | The person |
| `opened` | The person, the room, the support agent's pane |
| `open-failed` | The reason, from the open or from the agent never reaching the chat within 60 seconds |
| `ticket` | The SUPPORT id, title and URL |
| `closed` | The close reason and the support agent's outcome summary, plus what is left for the operator |
| `resume-offered` | The teammate's trigger message |
| `resumed` | Which agent took it (the old one or a fresh one) |

If the requester's session is gone, the milestone falls back to the operator's desk
notification, as the base design's close already does. To check in mid-chat, the
requester runs `rt chat read <room>`.

Flock's owner pane comes from the requester. A Flock button open makes the tapped pane the
requester, and the requester's herdr pane is Flock's owner. This replaces Flock's local
owner map and its 60-second guess (see Related fixes).

### Resume

**The grace window.** A closed conversation stays in grace until `closed_at` + 60
minutes. The fixed closing line gains one sentence:

`[<name> <emoji>]: This chat with <name> is closed. Anything you send now goes to <operator>.
To add something for <name> in the next hour, start your message with <trigger>`

With the default persona that is `[Maude 🤖]: This chat with Maude is closed. ... start your message with @Maude`.

**Detection.** The daemon's Slack sweep includes graced conversations at a slower
interval (30 seconds; builder may tune). Only a message from the teammate's Slack user
id, after `closed_at`, whose text starts with the trigger (leading whitespace allowed,
case-insensitive, then whitespace, the end of the text or one of `, : ! ?`) counts. Every other message is an ordinary DM to the operator, as
today. The first match raises a `slack-open` resume gate showing the message. A later
trigger message while that gate is open adds to it. Declining ends the grace window.

**Operator-started resume.** Flock's closed-chat list, the console, or the operator
telling an agent "resume with Leath" calls `chat_slack_resume {conversation}`. From an
agent, that goes through the same gate. From Flock or the console, the operator's own tap
is the approval.

**Reopening.** Approving opens a new conversation row with `resumed_from` set to the old
one. It reuses the old room so the history stays in one place, and sets `last_read_ts`
just before the triggering message so it is delivered first.

- **Old agent alive:** its pane exists and is signed in as the same handle. The daemon
  assigns the new conversation to it and delivers a `resumed` item, then the teammate's
  message. The session keeps its full memory.
- **Old agent gone:** the daemon starts a fresh background agent as in a request. Its
  brief names the old room and the SUPPORT tickets filed from it, so the agent's first step
  is to read the history. DM rooms are a hash of the two handles (`dmRoomFor`), so a new
  agent's `chat_dm` would land in a new room. Instead, a Slack conversation's room comes
  from its row: a `chat_dm` from the conversation's assigned agent to its teammate posts
  to `slack_conversations.room`, not the pair hash (my call; claiming the old handle was
  the alternative).

The requester of the old chat is the requester of the resumed one, and gets `resumed`.

### SUPPORT tickets

`chat_slack_ticket` keeps its input shape (`kind`, `title`, `problem`, `idea`,
`acceptance`) and stops writing files. The daemon creates the issue in the mattstack Linear
SUPPORT team through a small client in `lib/linear/` that reads the key with
`readSecret("rt", "linearSupportApiKey")`. The key is scoped to SUPPORT only, so the
team is fixed by the key; the tool takes no team argument.

- **Body.** Short sections in the operator's ticket shape: `## Problem`, `## Fix` (from
  `idea`), `## Acceptance`, and `## Source`. Source holds the kind, the teammate's display
  name, the date, and the chat room link, and says the text came from a Slack chat. A
  `kind` label (`Bug` or `Feature`) if the team has one.
- **Work org ids are refused.** Before sending, the daemon checks every field for
  three kinds of reference:
  - GitLab MR references (`!` followed by digits)
  - URLs on the org's forge host (`mattstack.integrations.forge.host`)
  - ticket ids whose key is a Linear key in the active org's `mattstack.directory`

  The active org on the operator's Mac is the work org's, so every key there counts. The
  public repo hardcodes no host or key. An empty or unreadable directory or forge host
  fails closed and refuses the ticket, naming why (my call). A hit fails the tool call,
  naming the offending text, so the agent rewrites without it.
- **Result.** The tool returns the SUPPORT id and URL to the support agent and sends the
  requester a `ticket` milestone. The skill tells the teammate only that it wrote it up,
  never the id or link.
- **Linear down.** The call fails with Linear's reason, and the agent retries or hands it
  to the operator in its close summary. No local fallback file.

### The skill

`rt:slack-support` changes in three places, through superpowers:writing-skills:

- Its arguments become a conversation id, and it reads the brief from
  `chat_slack_status`.
- The rule "Create nothing in Linear" becomes: tickets go through `chat_slack_ticket`
  only, and the teammate never hears an id or link.
- A resumed chat starts by reading the room (`rt chat read`) when the session lacks the
  history.

A new short section in an existing requester-facing skill (the rt:chat skill or a new
small one; builder's call) tells a pane how to request a chat: write the brief, call
`chat_slack_request`, and expect milestones.

## API

| Tool | CLI | Who | Does |
|---|---|---|---|
| `chat_slack_request` | `rt chat slack-request <person> --brief -` | Any signed-in pane | Raises the `slack-open` gate; returns the gate id or candidates |
| `chat_slack_resume` | `rt chat slack-resume <conversation>` | Any signed-in pane, Flock, console | Resume; from a pane it raises the gate |
| `chat_slack_status` (changed) | `rt chat slack-status` | Panes, Flock | Adds `requester`, `resumedFrom`, grace state, and the brief for the caller's own conversation |
| `chat_slack_ticket` (changed) | `rt chat slack-ticket` | The support agent | Files in SUPPORT; returns id and URL |

The daemon's `pane:send` guard against `/slack-support` text from panes stays. A request
is the supported way for an agent to ask.

## State

Claims the next `SCHEMA_VERSION` (17 today) under `.claude/rules/state.md`.
`slack_conversations` gains:

```sql
requester_session TEXT,      -- who asked (the typing pane for a manual open); null only for rows from before this change
requester_handle  TEXT,
brief             TEXT,      -- the requester's brief, read by the support agent
resumed_from      INTEGER,   -- the conversation this one resumed
grace_until       INTEGER,   -- closed_at + 60 min; null once resumed or declined
assigned_agent    TEXT       -- the background agent the daemon started for it
```

A pending request lives on the gate until approval. No conversation row exists before
the open.

### Session, pane and ticket tracking (added by the operator after approval)

Like a board review or a pipeline work run, every support conversation records the
Claude session and the herdr pane of the agent holding it (`assigned_session`,
`assigned_pane`, next to `assigned_agent`). `chat_slack_status`, `rt chat slack-status`
and the console show them, so the operator can find and open the pane.

When the conversation is done, the daemon closes that herdr pane. "Done" means the
grace window ended with no resume: grace expired, or the resume gate was declined. A
resume within grace reuses the live pane instead, so the pane must outlive the close
until then. A conversation that never opened (the 60 s open deadline) closes its pane
at once. A pane-close failure is logged and never blocks the bookkeeping.

Every Linear ticket filed in a conversation is recorded against it in a new
`slack_support_tickets` table (`conversation_id`, `issue_id`, `title`, `url`,
`created_at`). Status returns a conversation's tickets, the `closed` milestone lists
their ids, and a resumed chat (same or fresh agent) carries the tickets of the chain of
conversations it resumed. Ticket ids still never go to Slack.

## Related fixes (separate small changes)

1. **rt refuses an injected slash command over the paste threshold.** `injectIntoPane`
   (`lib/daemon/inject.ts`) refuses text whose first line starts with `/` and whose length
   is over 800 characters, naming the reason. The alternative is a silent paste that the
   model receives as a prompt. Measured on 2026-11-06: 790 characters ran, 810 fell
   through.
2. **Flock keeps a chat's owner while its agent lives.** `retire()` in
   `ChatStore.noteSlackChats` stops deleting the owner while the agent's pane still
   exists. This is superseded once Flock reads the owner from `requester`.
3. **Flock shows an unowned background chat on no tab.** `isLinked(toTab:)` returns false
   for an unowned `bg:` pane. This replaces `testAnUnlinkedBackgroundChatShowsOnEveryTab`.

## Constraints

- **The secret.** It lives only in the sops store (`rt.linearSupportApiKey`), never in
  settings.
- **The board.** It must never show a `slack-open` gate. Check all three board seams named
  above.
- **The working Mac.** The base design's rules still hold: no tunnels, and outward traffic
  goes only to Slack and now Linear.
- **Work-org-visible text.** No mattstack ticket ids in the Slack DM.

## Testing

- **Unit:**
  - the gate kind is filtered out of every board seam and included in the console list
  - `gate_answer` refuses a `slack-open` gate
  - the trigger matcher, including ordinary replies that must not match
  - the grace window expires on time
  - the resume picks the old agent when alive and a fresh agent when not
  - the work org id refusal, with hits and near-misses
  - the ticket body shape
- **Daemon:** a request through to approve, then the open, the assignment, the
  milestones to a fake requester, and the close; and a resume from a trigger message,
  with a fake Slack and a fake Linear behind the existing seams.
- **Live:** one real chat with the operator. Request from a pane, approve in the pane,
  file a ticket, close, send the trigger, approve the resume, close again. Check that the
  board showed nothing and the console showed both gates.

## Left to the builder

- The gate's expiry time and the graced sweep interval.
- Where the requester-facing instructions live.
- The milestone frame wording, written with rt:ui-copy.
- Whether `slack-open` gates reuse the existing form presentation as is.
- The Linear label mapping, if SUPPORT has labels.
