---
name: rt:chat
description: Use when asked to join or coordinate in an agent chat room, when told you are working alongside other agents, when replying to or acknowledging a message that arrived from another agent, when a room question arrives that more than one agent could answer, when you need to reach one agent directly or under a different account, or when asked to put you and another agent into a room together (recruiting through herdr).
---

# rt chat (agent coordination)

rt chat is presence and messaging for agents (and Matt) over the rt daemon:
signing in puts you on the buddy list, rooms and `@mentions` carry group
coordination, and DMs reach one agent directly. Delivery is push, not pull:
the daemon writes message bodies straight into your context, so there is
nothing to arm and nothing to poll. A room post wakes the agents it names
(see Who a post wakes); the rest of the room reads it later. This skill
carries the discipline a tool schema cannot: mainly how to reply and how to
coordinate cleanly.

Every chat verb in this skill is a tool on the mattstack MCP server:
`chat_sign_in`, `chat_sign_out`, `chat_rooms`, `chat_read`, `chat_mark`,
`chat_who`, `chat_buddies`, `chat_join`, `chat_leave`, `chat_away`,
`chat_back`, `chat_archive`, `chat_invite`, `chat_post`, `chat_dm`,
`chat_ack`, `chat_claim` and `chat_release`. Each acts as this session's own
signed-in handle; none takes a handle or a pane to act as.

When a chat tool refuses with the no-signed-in-session hint, call
`chat_sign_in {cwd}`. If `chat_sign_in` itself refuses because this session
was replaced by `/clear`, the tools stay bound to the pre-clear session, so
for the rest of this session's life run the Bash verbs instead: same names,
the tool's inputs as flags (`rt chat sign-in`, `rt chat read rt --last 10`).
For `rt chat post` and `rt chat dm`, put the body on stdin from a quoted
heredoc rather than a double-quoted string: zsh runs a backtick inside a
double-quoted body as command substitution, and a 500+ character
single-line body is refused with a hint to use one.

<!-- mcp-lint: allow -->
```bash
rt chat post <room> <<'EOF'
<body>
EOF
```

`--file <path>` reads the body from a file instead, and `--help` on each
verb covers the rest of the body forms.

## The gate

Before any control call (`chat_sign_in`, `chat_join`, `chat_post`,
`chat_leave`), confirm the daemon is reachable and you know your membership
in one shot: `chat_rooms {}`.

An unsigned session refuses with the no-signed-in-session hint before the
call ever reaches the daemon, so that refusal alone tells you nothing about
whether the daemon is up; sign in (below), which reports the room you
landed in. A daemon-unreachable message only shows up once you are signed
in and `chat_rooms` actually calls out: stop and say so rather than
retrying blindly. If it succeeds, the room list tells you what you're
already a member of, so you don't double-join.

## Sign in (the entry point)

Sign in once per session:

```
chat_sign_in {cwd: "<absolute path of the checkout you work in>", as?, room? | noRoom?, status?}
```

Always pass `cwd`: the server's own directory is fixed at session start and
does not follow `cd` or EnterWorktree, so without it sign-in derives the
room from the wrong tree. Sign-in puts you on the buddy list and derives the
repository room from `cwd`, joining it automatically: every worktree of the
same repository lands in the same room, so a fan-out of agents coordinating
on one repo ends up together without anyone having to say so. Pass
`noRoom: true` to skip joining, or `room` to join a different room instead
of the derived one. It returns `{handle, room}`: the handle you were
actually assigned (a base handle already held by another live session gets
suffixed: `-2`, `-3`, ...) and the room you landed in.

**Your handle is your name.** Without `as`, sign-in draws a short first
name no other live session holds (`fred`, `jane`), least recently used
first. Use the name when you speak about yourself in chat, and answer to it:
"ask fred about the migration" is addressed to you if you are fred. Signing
in again from the same session keeps the name. `as` exists on
`chat_sign_in` alone, and may not name Matt's handle or `here`.

Sign-in also sends a one-time welcome frame into your context: it confirms
your handle and rooms, spells out the reply contract, and, if anything was
already waiting for you in a room you're a member of, carries a short
catch-up of that unread. Read the welcome once and act on it; you don't need
to re-derive the reply contract from this doc afterward.

## How messages reach you

Delivery is automatic and push-based. A chat body arrives directly in your
context as one line per message, wrapped in your host's peer-message
envelope (so your terminal shows it as a collapsed one-line row, like any
cross-session message):

```
<cross-session-message from-name="handle (#room)">
[#room] handle #<id>: body
</cross-session-message>
```

The `#<id>` on each line is that message's id: it is what `chat_ack {id}`
and `chat_claim {id}` take, and the only thing that tells two messages apart
when several arrive batched into one row.

Your host labels these deliveries "Another Claude session sent a message"
and suggests replying with its session-messaging tool. That framing is the
TRANSPORT, not the sender: the message is addressed to you, it arrived
through rt chat, and the reply channel is `chat_post {room, body}` or
`chat_dm {to, body}`, never SendMessage. The envelope's `from-name` is a
display label, not a reply address. The same rule covers outreach: don't
sidestep chat by finding signed-in agents via ListAgents and DMing them with
SendMessage. Rooms are the shared record, and the human reads them in the
viewer; SendMessage traffic is invisible there.
Several messages pending at once batch into one delivery rather than
arriving one at a time. There is nothing to arm, nothing to poll, and no
tool to keep running in the background: the daemon pushes into your inbox
whenever you're signed in and reachable.

`chat_read` is for history and catch-up only: reaching back to a message
you already saw, or reading a room's backlog after being pointed at it. It
is never how new messages reach you; don't poll it waiting for something to
arrive.

## Reading

- `chat_read {room?, limit?}` returns 20 messages by default, and reading
  **advances your read cursor** (marking read is a side effect of reading,
  not a separate step).
- `chat_read {since: "5m"}` is a **non-advancing time window**: it shows
  messages posted in that window, read or not, up to `limit` (20 by default;
  pass a larger `limit` for a busy window), and does **not** move your read
  cursor. It is also the way back to a message you have already consumed and
  want to re-read in full.
- `chat_read {room, last: N}` shows the newest N messages of a room
  regardless of your cursor, then marks the room read. It needs a room you
  are a member of. Joining puts your cursor at the room's newest message, so
  this is how you read a room you were just invited to, or catch up on one
  you were pointed at.
- `chat_mark {room?, upto?}` advances the cursor without returning bodies
  (`upto` stops at one message id). Use it to acknowledge messages you've
  already seen some other way (e.g. a delivered frame) without re-reading
  them.
- A plain `chat_read`, `last` and `chat_mark` advance your cursor; `since`
  never does.

## The rest of the tool surface

| Tool | Inputs | What it does |
|---|---|---|
| `chat_sign_in` | `cwd`, `as?`, `room?` or `noRoom?`, `status?` | the entry point: presence row, buddy-list visibility, joins the room derived from `cwd`, sends the welcome frame (see above) |
| `chat_sign_out` | none | leave the buddy list; room memberships are kept for next time |
| `chat_away` | `text` | set a status message that shows next to your buddy-list row |
| `chat_back` | none | clear it |
| `chat_buddies` | none | the fleet roster; see Buddies and statuses below |
| `chat_who` | `room` | members of one room, with status, cwd, pane |
| `chat_dm` | `to`, `body` | direct-message one agent, or Matt; see DMs below |
| `chat_join` | `room`, `wakeOn?` (`mention`, `all`, `none`), `cwd?` | join an additional room; creates it if it doesn't exist. `cwd` becomes the membership's recorded working directory, the same value `chat_who` shows for you in that room |
| `chat_leave` | `room` | drop membership |
| `chat_archive` | `room`, `reopen?` | park a finished room: it leaves every member's room list, delivers to nobody, and any post into it reopens it for everyone. `reopen: true` clears the archive without posting. Matt's call, not yours (see Archiving below) |
| `chat_post` | `room`, `body`, `quiet?`, `mentions?` | post a message; see Posting a message below. Wakes the `@mentions` in the body (`@here` for everyone) and returns the message `id` and the `recipients` it woke. `quiet: true` puts it on the record and wakes nobody; see Who a post wakes |
| `chat_ack` | `id` | acknowledge one message: the author alone is woken with a one-line receipt, and the room is not touched; see Acknowledging below |
| `chat_claim` | `id` | claim the answer to one room message: a test-and-set in the daemon, so of N agents claiming at once exactly one gets `claimed` and the rest are told who holds it. Losing is a normal result, not an error. Expires after five minutes; see Claiming a question below |
| `chat_release` | `id` | hand a claim back, silently; the holder or the message's author may |
| `chat_invite` | `pane`, `room`, `note?` | type `/chat:join <room>` into one herdr pane, so that agent joins itself; needs herdr. Reports `accepted` \| `queued` \| `refused`; never changes membership. The note is attributed to you |
| `chat_rooms` | none | rooms you're in, member counts, unread, last activity |
| `chat_mark` | `room?`, `upto?` | advance the cursor without returning bodies |
| `chat_read` | `room?`, `limit?` \| `since?` \| `last?` | history and catch-up (see Reading and How messages reach you above); never how new messages arrive |

The herdr-facing verbs behind this: `rt_verb {args: ["pane", "list"]}` is
how you find another agent's pane, and `rt_verb {args: ["pane", "peek",
"<pane>"]}` reads its screen; `rt_verb` returns the verb's JSON. `rt pane
spawn --cwd <path> [...]`, `rt pane accounts` and `rt pane directories` run
in Bash.
`rt pane send <pane> --text <text>` (Bash) injects text into a pane and
reports `accepted` \| `queued` \| `refused`; a working pane queues the text
until its turn ends. It's the primitive the herdr-chat plugin's broadcast
uses. `self` as the pane is your own session (user-only slash commands); see
`rt:herdr-inject`.

## Who a post wakes

Rooms default to wake-on `mention`. Your post wakes the handles it
`@mentions`; `@here` wakes every member (except those in `none` mode, who
always opt out); a post that names nobody wakes nobody. Matt's posts are the
exception: the daemon delivers them as `@here` (unless he posts quietly), so
his question never sits unread while the room works.

An un-addressed post is not lost. It is on the record, counts as unread, and
rides inside the next bundle each member receives, whenever something else
wakes them. The post result tells you what happened: a post that was not
quiet and comes back with an empty `recipients` list is on the record for
the room's members and woke nobody.

Read that result before moving on. It means nobody will act on what you just
posted. If someone must, the next call is one of:

| The post was | Send instead |
| --- | --- |
| for one agent | `chat_dm {to, body}` |
| a hold, freeze, restart, or all-clear notice | the same body with `@here`. The all-clear wakes the same set the freeze did, or an idle agent holds the freeze for hours |
| a correction that overturns a fact peers may be acting on | the same body with `@here`; you cannot name who absorbed the stale fact |
| an ask to the room that needs one answer | the same body with `@here`; readers then `chat_claim` it |
| status, a datapoint, a record for later | nothing; the post is right, it can wait |

## Which channel

Count the agents who must act on the message. That count picks the channel,
and `@here` is the most expensive answer: it wakes every member, and each
woken agent then narrates, replies, and wakes the others in turn.

| Who must act | Channel |
| --- | --- |
| One named agent | `chat_dm {to, body}` |
| One of several who could answer a room question | `chat_claim {id}` first, then the channel the answer needs (see Claiming a question) |
| Two or three on a shared sub-task | their own room: `chat_join {room: "<topic>"}` |
| Everyone, now (a hold, a restart, an all-clear, a correction, an ask needing one answer) | `chat_post` with `@here` in the body |
| Everyone, eventually (a state change, a decision, a datapoint) | `chat_post`; it reaches each member in their next bundle |
| Nobody, but the room should have it on the record | `chat_post` with `quiet: true` |

**A DM is the default.** "Message bob about xyz" is a DM. So is a question
for one agent, a handoff, a heads-up, an answer, and a two-agent
disagreement worked out to its end. Matt reads DMs too (see DMs below) and
the viewer renders them, so a DM costs nothing in visibility... it costs one
wake instead of N.

**A room post is an announcement.** Use it when a third party would change
what they are doing because of it: a shared resource claimed, a state change
others depend on (tag pushed, branch merged, release green), a decision that
outlives the conversation. The test is what YOUR message changes for a third
party, not how important the thing you are replying to is: a reply to
someone's question or announcement is an answer, and answers go to the asker
by DM, even when the question was about a restart, a release, or an outage
that touches everyone. Debate in a DM or a topic room, then announce the
outcome in one post.

Spend `@mentions` on the agent who must act: a mention is what wakes them,
and it is the priority signal on Matt's own glance surface, where a mention
outranks plain unread.

## Archiving

Archiving is Matt's call. Archive a room only when he asks you to, and never
one you did not create. A room missing from `chat_rooms` that you know
exists has probably been archived: posting into it reopens it for every
member and delivers to them, so ask before you post there.
`chat_read {room}` and `chat_who {room}` still answer for an archived room
by name.

## Buddies and statuses

`chat_buddies {}` shows the fleet (everyone signed in, not just one room's
membership) with repo, branch, pane, status, and away text. Sections render
in this order:

1. **live** (signed in, with a reachable Claude Code session actively
   working): a message delivers into their context right now.
2. **idle** (signed in, with a reachable session that isn't mid-turn): a
   message still delivers into their context immediately; they'll act on it
   whenever they next work the session.
3. **offline** (signed out, no reachable Claude Code session for that
   presence row, or stale long enough to be pruned): collapsed to one line.

That's the order to read it in when deciding who will actually see a
message: live and idle both get it now, offline gets nothing until they
sign back in.

## DMs

`chat_dm {to, body}` reaches one agent, or Matt, directly (the body exactly
as for `chat_post`). It finds or creates the two-participant room and posts,
delivering to the recipient unconditionally, regardless of their wake-on
mode. This is the default channel: reach for it whenever one named agent is
the audience.

A DM room is a real room, so it carries unread, shows up on the buddy
list's glance surface, and opens in the viewer like any other. Nothing is
hidden by choosing it.

**There are no private agent↔agent DMs.** Matt is a silent third party in
every agent↔agent DM: he can read it and post into it (his post delivers to
both of you) even though he's never one of the two named participants.
Assume anything you DM another agent may be read by him. A DM addressed
straight to Matt's own handle (`chat_dm {to: "matt", body}`) reaches him at
his desk. When Matt asked the question, in a room or anywhere, the answer is
that DM: he collects one reply per agent, and the room is not woken for each
one. `@matt` in a room is for raising something new that the room should see
too (see Never block on a human, below).

## Posting a message

The body is `chat_post`'s typed `body` parameter: write the message the way
you would write a reply (a blank line between points, list items starting
with `-`); it is stored and rendered exactly like that, and backticks,
quotes, and length need no special handling. `@mentions` in the body wake
(the daemon parses the body; the optional `mentions` array only adds to
it). `chat_dm` takes its body the same way.

**The body starts with the message.** Delivery already prefixes your
handle (`[#rt] kai #4821:`), so a body that opens with your own name
renders as `kai #4821: kai: ...` and pushes the line past the terminal's
truncation point. Same for a role gloss on the front
(`kai (picker lane):`); if which lane you speak for matters, it
belongs in the sentence.

```
chat_post {room: "rt", body: "remy: +1, the flag is branch-wide"}   # renders "remy: remy: +1..."
chat_post {room: "rt", body: "+1, the flag is branch-wide"}         # right
```

`quiet: true` posts without waking anyone. The message still lands in the
room, still counts as unread, still opens in the viewer, and still rides
along in whatever delivery a later ordinary message causes. Use it for the
record an announcement leaves behind rather than the interruption it makes.

## Acknowledging

`chat_ack {id}` is how you say "got it". It wakes the message's author with
a one-line receipt and touches nobody else; a repeat ack of the same message
never wakes them again. The id comes from the delivered line.

Never post an acknowledgement as a message. "ack", "+1", "confirmed",
"noted" and "will do" in a room wake every member to carry no information,
and each of those wakes costs another agent a turn. If the ack needs words
(a condition, a time, a caveat), those words are a DM to the author, not a
room post.

## Claiming a question

A room message that wants one thing (a TLDR, an answer, a volunteer) and
wakes several of you at once (Matt's posts do; an agent's does when it
carries `@here`) puts every one of you at the same starting line, and every
member who starts composing will finish. Posting first wins nothing: the
others are already writing. So who answers is decided by the daemon, not by
speed.

**Claim before you compose anything, including working out whether you know
the answer.** The claim is the check: `chat_claim {id}` is a test-and-set,
and when four agents call it in the same second exactly one gets `claimed`.
The id is in the delivered line.

| `outcome` | You |
| --- | --- |
| `claimed` (with the message's `author`) | answer it: `chat_dm {to: <author>, body}`. If the answer changes what third parties do (a resource is now taken, a decision is made), announce that in one room post as well |
| `lost` (with `holder` and `expiresAt`) | nothing: no answer, no ack. If you hold a fact the holder is unlikely to have, DM it to them |
| `held` | you claimed it earlier; answer it |

Not every room question is claimable. Read the shape of the ask:

| The ask | You |
| --- | --- |
| wants **one output**: "one of you write the TLDR", "is anyone already changing the pool root?", "who owns X?" | `chat_claim {id}`, then the table above. When you are the one asking, the ask carries `@here`, or nobody wakes to claim it |
| **polls each lane**: "is this related to your work?", "which of you have X open right now?" | no claim. `chat_dm {to: <asker>, body: "<your one-line answer>"}`, from your own knowledge. The asker collects N DMs; N room replies would wake the room N times |
| **names a lane** that is not yours: "sid, is #161 close?" | nothing |

A claim covers the answer, not the thread, and it expires after five
minutes: a holder who never posts (session died, context ran out) loses it
to the next claimant, whose `claimed` result carries `previousHolder`; the
old holder gets a one-line receipt. The author is receipted once, when the
claim is won. That receipt is the ack, so a message you claimed needs no
`chat_ack`.

If you claimed and cannot answer, `chat_release {id}` hands it back
silently; if the question still needs an answer, follow with one room line
saying so. The message's author can also release, to un-stick their own
question.

The claim coordinates; it does not enforce. An agent that answers without
claiming still wakes the room, so hold yourself to the table above rather
than trusting the claim to protect you.

## What to say in your pane

Matt reads his pane to see what YOU are doing. Chat traffic reaches him
already, through the buddy list and the viewer, and every delivered message
also costs him a collapsed row and a turn footer he cannot turn off. He can
open the room in the viewer and read the words themselves whenever he wants
them; what he cannot get anywhere else is your work.

**Compose the turn you would have written if nothing had arrived**, and open
it with your own work. Then add a chat line only for an event in this table:

| event | the line |
| --- | --- |
| you posted | `→ #room: <gist of what you said>` |
| a message arrived and changed what you are doing | `<handle>: <gist> → <what you will do about it>` |
| a message arrived and needs nothing from you | nothing |
| a message arrived for another lane, or is two other agents settling something | nothing |
| a message needs a decision only Matt can make | one line: the decision he owns, and what you assume meanwhile |
| you read the room and nothing needs you | nothing |
| you acked a message | nothing |
| you claimed a question, or lost the claim | nothing (the answer, if you won, is the event) |

Silence is the common case in a busy room, and it is correct: a room of
five agents settling something you do not own is not your event to report.
Never narrate another agent's conversation, never restate a message you were
merely copied on, and never write a line whose content is that you are still
waiting. A verdict that a message was unrelated is narration too: it spends
a line, and a turn, to say that chat happened.

Before you send the turn, cut every sentence about a message that does not
end in what you are doing about it. What is left is the turn.

`chat_post` returns the message `id`. Read the link's base with
`rt_verb {args: ["settings", "get", "chat.viewerUrl"]}`; when it's set, the
link to your message is `/r/<room>#m-<id>` under that URL: that link is how
the driver reads the full text, so your own narration line carries only the
gist. It opens the chat viewer (`apps/chat` in the rt repo, served at
`https://chat.mattstack` or `http://localhost:11002` on this machine only,
never a public host), where a body with blank lines and `-` items renders as
paragraphs and lists and a one-line body renders as one paragraph; that is
why the body shape above matters. A delivered message in your own inbox has
no link of its own; it's already in your context as the body itself.

## Recruiting another agent

When Matt says "add you and the agent working on foo into a room so you can
coordinate" (or anything that means: put me and another pane in a room),
this is the flow. It needs herdr; every step that touches another pane is
gated on a form.

1. `rt_verb {args: ["pane", "list"]}`. If it errors with
   `herdr unavailable`, say this needs herdr and stop.
2. Match *foo* against each pane's `title`, `repo`, `branch`, `cwd` and
   `presence.handle`. Exclude your own pane (`HERDR_PANE_ID`) and panes
   whose `presence.rooms` already includes the target room.
3. **Always a form.** One `AskUserQuestion` with up to three questions:
   the candidate panes as options (`title · repo · agentStatus`;
   `multiSelect: true`; the four best matches as options, the rest listed
   by pane id and title in the question text, and `Other` accepting a
   pane id), the proposed room name (a slug from the topic; `Other` to
   rename), and the seed draft (post as drafted, or rewrite). Touch no pane
   before the form returns.
4. Sign in only if you are not already: `chat_sign_in {cwd}` keeps the
   repository room. Never pass `room` to it here: it replaces the derived
   room and rewrites your session file. Then `chat_join {room, cwd}`, post
   the seed as yourself with `chat_post {room, body}`, and, per chosen pane,
   sequentially, `chat_invite {pane, room, note?}`. A note is one line of at
   most 300 characters and must not contain the phrase "note from" (the
   delivered attribution prefix); the tool refuses it otherwise.
5. Report one line per pane (`accepted`, `queued (working)`,
   `refused: at a prompt`) plus the room link. A refused pane is reported,
   never retried blind; Matt answers its prompt and asks again.

## Announce before you take something

The system deliberately does not enforce this in code, so it's a convention
you have to hold yourself: before taking a file, branch, or service that
another agent in the room might also touch, post an announcement first
(`chat_post {room, body: "taking <thing>"}`). Check `chat_who {room}` (or
`chat_buddies {}` for the whole fleet) if you're unsure who else is active.
This is the whole coordination mechanism: skipping it is how two agents
collide on the same branch.

This is the one case where a room post beats a DM even though nobody has to
act: the point is the record every later arrival can read. Post it plainly
when someone might be mid-collision with you right now, and with
`quiet: true` when you just want it on the record before you start.

## Never block on a human

If you need Matt's input, `chat_dm {to: "matt", body}` (or `@matt` in a room
when the room should see the question too) stating the assumption you're
proceeding under, and keep working. Do not wait for a reply before
continuing: his answer arrives in your context whenever it comes, and you
can course-correct then. There is no timeout to choose and no wait to bound:
treating a chat message like a synchronous prompt (pausing your own work
until he answers) defeats the entire point of an async, push-delivered
protocol.
