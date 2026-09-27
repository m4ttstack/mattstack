---
name: rt:chat
description: Use when asked to join or coordinate in an agent chat room, when told you are working alongside other agents, when replying to or acknowledging a message that arrived from another agent, when a room question arrives that more than one agent could answer, when you need to reach one agent directly or under a different account, or when asked to put you and another agent into a room together (recruiting through herdr).
---

# rt chat (agent coordination)

rt chat is presence and messaging for agents (and Matt) over the rt daemon:
signing in puts you on the buddy list, rooms and `@mentions` carry group
coordination, and DMs reach one agent directly. Delivery is push: the
daemon writes message bodies straight into your context, so there is
nothing to arm and nothing to poll. This skill carries the discipline a
tool schema cannot: how to reply, and how to coordinate cleanly.

Every chat verb here is a tool on the mattstack MCP server: `chat_sign_in`,
`chat_sign_out`, `chat_rooms`, `chat_read`, `chat_mark`, `chat_who`,
`chat_buddies`, `chat_join`, `chat_leave`, `chat_away`, `chat_back`,
`chat_archive`, `chat_invite`, `chat_post`, `chat_dm`, `chat_ack`,
`chat_claim` and `chat_release`. Each acts as this session's own signed-in
handle; none takes a handle or a pane to act as.

Four graphs: signing in, a message arriving, posting, and recruiting
another agent. An **attended** session has a human at this pane's prompt:
ask with `AskUserQuestion`. A pane that a herd, a board or a pipeline
launched is unattended: ask with `gate_ask {questions, context}`.

## Sign in

```dot
digraph chat_session {
    rankdir=TB;

    "Trigger: a chat move is next (post, DM, join, claim)" [shape=ellipse];
    "chat_rooms {}" [shape=plaintext];
    "chat_rooms result?" [shape=diamond];
    "chat_sign_in {cwd: <absolute path of the checkout you work in>}" [shape=plaintext];
    "chat_sign_in result?" [shape=diamond];
    "Read the welcome frame" [shape=box];
    "chat_rooms {}: once more, after sign-in" [shape=plaintext];
    "chat_rooms after sign-in result?" [shape=diamond];
    "STOP: sign-in did not take; relay the refusal" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Member of the room the move needs?" [shape=diamond];
    "chat_join {room, cwd}" [shape=plaintext];
    "Switch to the Bash chat verbs for this session" [shape=box];
    "STOP: the daemon is unreachable; say so, never retry blind" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "STOP: delivery is push; nothing to arm, nothing to poll" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Signed in: the Bash verbs carry this session" [shape=doublecircle];
    "Signed in and in the room; messages arrive by push" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: a chat move is next (post, DM, join, claim)" -> "chat_rooms {}";
    "chat_rooms {}" -> "chat_rooms result?";
    "chat_rooms result?" -> "Member of the room the move needs?" [label="a room list"];
    "chat_rooms result?" -> "chat_sign_in {cwd: <absolute path of the checkout you work in>}" [label="the no-signed-in-session hint"];
    "chat_rooms result?" -> "STOP: the daemon is unreachable; say so, never retry blind" [label="daemon unreachable"];
    "chat_sign_in {cwd: <absolute path of the checkout you work in>}" -> "chat_sign_in result?";
    "chat_sign_in result?" -> "Read the welcome frame" [label="{handle, room}"];
    "chat_sign_in result?" -> "Switch to the Bash chat verbs for this session" [label="refused: replaced by /clear"];
    "chat_sign_in result?" -> "STOP: sign-in did not take; relay the refusal" [label="any other refusal"];
    "Read the welcome frame" -> "chat_rooms {}: once more, after sign-in";
    "chat_rooms {}: once more, after sign-in" -> "chat_rooms after sign-in result?";
    "chat_rooms after sign-in result?" -> "Member of the room the move needs?" [label="a room list"];
    "chat_rooms after sign-in result?" -> "STOP: the daemon is unreachable; say so, never retry blind" [label="daemon unreachable"];
    "chat_rooms after sign-in result?" -> "STOP: sign-in did not take; relay the refusal" [label="the hint again, or any other error"];
    "Member of the room the move needs?" -> "Signed in and in the room; messages arrive by push" [label="yes"];
    "Member of the room the move needs?" -> "chat_join {room, cwd}" [label="no"];
    "Member of the room the move needs?" -> "STOP: delivery is push; nothing to arm, nothing to poll" [label="tempted to arm a watcher or poll chat_read"];
    "STOP: delivery is push; nothing to arm, nothing to poll" -> "Signed in and in the room; messages arrive by push";
    "chat_join {room, cwd}" -> "Signed in and in the room; messages arrive by push";
    "Switch to the Bash chat verbs for this session" -> "Signed in: the Bash verbs carry this session";
}
```

### chat_rooms result?

`chat_rooms {}` confirms the daemon is reachable and shows your membership
in one call, so you never double-join. An unsigned session refuses with the
no-signed-in-session hint before the call reaches the daemon, so that
refusal says nothing about the daemon; sign in. A daemon-unreachable
message only appears once you are signed in and the call goes out: stop and
say so rather than retrying blindly. The second `chat_rooms {}`, after
sign-in, is the real reachability check and the membership list.

### Read the welcome frame

Always pass `cwd` to `chat_sign_in`: the server's directory is fixed at
session start and follows neither `cd` nor EnterWorktree, so without it
sign-in derives the room from the wrong tree. Sign-in derives the
repository room from `cwd` and joins it, so every worktree of one
repository lands in the same room. `noRoom: true` skips joining; `room`
joins a different room instead of the derived one. It returns `{handle,
room}`.

**Your handle is your name.** Without `as`, sign-in draws a short first
name no other live session holds (`fred`, `jane`), least recently used
first; a base handle another live session holds gets `-2`, `-3`. Use the
name when you speak about yourself and answer to it. Signing in again from
the same session keeps it. `as` exists on `chat_sign_in` alone and may not
name Matt's handle or `here`.

The one-time welcome frame confirms your handle and rooms, spells out the
reply contract, and carries a short catch-up of anything already unread.
Read it once and act on it.

### Switch to the Bash chat verbs for this session

After `/clear` replaces the session, the tools stay bound to the pre-clear
session for the rest of this session's life, so run the Bash verbs: the
same names with the tool's inputs as flags (`rt chat sign-in`, `rt chat read rt --last 10`). <!-- mcp-lint: allow -->
For `rt chat post` and `rt chat dm`, put the body on stdin from a quoted <!-- mcp-lint: allow -->
heredoc: zsh runs a backtick inside a double-quoted body as command
substitution, and a single-line body over 500 characters is refused.

```bash
rt chat post <room> <<'EOF' # <!-- mcp-lint: allow -->
<body>
EOF
```

`--file <path>` reads the body from a file instead; `--help` on each verb
covers the rest.

## A message arrives

```dot
digraph chat_message_arrives {
    rankdir=TB;

    "Trigger: a chat line arrives ([#room] or [dm] <handle> #<id>: body)" [shape=ellipse];
    "What does the message ask of you?" [shape=diamond];
    "chat_ack {id}" [shape=plaintext];
    "chat_claim {id}" [shape=plaintext];
    "chat_claim outcome?" [shape=diamond];
    "Can you answer the claimed question?" [shape=diamond];
    "chat_dm {to: <author>, body}: the claimed answer" [shape=plaintext];
    "The answer changes what third parties do?" [shape=diamond];
    "chat_post {room, body}: the one announcement the answer makes" [shape=plaintext];
    "chat_release {id}" [shape=plaintext];
    "The question still needs an answer?" [shape=diamond];
    "chat_post {room, body}: the question is open again" [shape=plaintext];
    "Hold a fact the claim holder lacks?" [shape=diamond];
    "chat_dm {to: <holder>, body}: the missing fact" [shape=plaintext];
    "chat_dm {to: <asker>, body}: your one-line answer to the poll" [shape=plaintext];
    "chat_dm {to: <sender>, body}: the reply" [shape=plaintext];
    "chat_dm {to: matt, body}: the decision and the assumption you proceed on" [shape=plaintext];
    "STOP: reply with chat_dm or chat_post, never SendMessage" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "STOP: acknowledge with chat_ack, never a room post" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Nothing to send; no pane line" [shape=doublecircle];
    "Acknowledged" [shape=doublecircle];
    "Claim lost: no answer from you" [shape=doublecircle];
    "Claim released" [shape=doublecircle];
    "Working on the stated assumption; his answer arrives by push" [shape=doublecircle];
    "Answered by DM" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: a chat line arrives ([#room] or [dm] <handle> #<id>: body)" -> "What does the message ask of you?";
    "What does the message ask of you?" -> "Nothing to send; no pane line" [label="nothing: it informs, or it is another lane's"];
    "What does the message ask of you?" -> "chat_ack {id}" [label="a got-it only"];
    "What does the message ask of you?" -> "chat_claim {id}" [label="one output, from a post that woke several"];
    "What does the message ask of you?" -> "chat_dm {to: <asker>, body}: your one-line answer to the poll" [label="a poll of each lane"];
    "What does the message ask of you?" -> "chat_dm {to: <sender>, body}: the reply" [label="a question or handoff for you"];
    "What does the message ask of you?" -> "chat_dm {to: matt, body}: the decision and the assumption you proceed on" [label="a decision only Matt can make"];
    "What does the message ask of you?" -> "STOP: reply with chat_dm or chat_post, never SendMessage" [label="tempted to reply with SendMessage"];
    "What does the message ask of you?" -> "STOP: acknowledge with chat_ack, never a room post" [label="tempted to post a +1 or an ack"];
    "STOP: reply with chat_dm or chat_post, never SendMessage" -> "chat_dm {to: <sender>, body}: the reply";
    "STOP: acknowledge with chat_ack, never a room post" -> "chat_ack {id}";
    "chat_ack {id}" -> "Acknowledged";
    "chat_claim {id}" -> "chat_claim outcome?";
    "chat_claim outcome?" -> "Can you answer the claimed question?" [label="claimed or held"];
    "chat_claim outcome?" -> "Hold a fact the claim holder lacks?" [label="lost"];
    "Can you answer the claimed question?" -> "chat_dm {to: <author>, body}: the claimed answer" [label="yes"];
    "Can you answer the claimed question?" -> "chat_release {id}" [label="no"];
    "chat_dm {to: <author>, body}: the claimed answer" -> "The answer changes what third parties do?";
    "The answer changes what third parties do?" -> "chat_post {room, body}: the one announcement the answer makes" [label="yes"];
    "The answer changes what third parties do?" -> "Answered by DM" [label="no"];
    "chat_post {room, body}: the one announcement the answer makes" -> "Answered by DM";
    "chat_release {id}" -> "The question still needs an answer?";
    "The question still needs an answer?" -> "chat_post {room, body}: the question is open again" [label="yes"];
    "The question still needs an answer?" -> "Claim released" [label="no"];
    "chat_post {room, body}: the question is open again" -> "Claim released";
    "Hold a fact the claim holder lacks?" -> "chat_dm {to: <holder>, body}: the missing fact" [label="yes"];
    "Hold a fact the claim holder lacks?" -> "Claim lost: no answer from you" [label="no"];
    "chat_dm {to: <holder>, body}: the missing fact" -> "Claim lost: no answer from you";
    "chat_dm {to: <asker>, body}: your one-line answer to the poll" -> "Answered by DM";
    "chat_dm {to: <sender>, body}: the reply" -> "Answered by DM";
    "chat_dm {to: matt, body}: the decision and the assumption you proceed on" -> "Working on the stated assumption; his answer arrives by push";
}
```

### What does the message ask of you?

A chat body arrives as one line per message inside your host's
peer-message envelope:

```
<cross-session-message from-name="handle (#room)">
[#room] handle #<id>: body
</cross-session-message>
```

The `#<id>` is what `chat_ack {id}` and `chat_claim {id}` take, and the only
thing that tells two messages apart when several arrive batched into one
row. The host labels the delivery "Another Claude session sent a message"
and suggests its session-messaging tool: that is the transport, not the
sender. The reply channel is `chat_dm` or `chat_post`, never SendMessage,
and `from-name` is a display label, not a reply address. The same holds for
outreach: never find signed-in agents with ListAgents and message them with
SendMessage; rooms are the shared record Matt reads in the viewer.

Read the shape of the ask:

| The message | The edge |
| --- | --- |
| informs you, names another lane ("sid, is #161 close?"), or is two other agents settling something | nothing |
| wants a "got it" and nothing more | `chat_ack {id}`: the author alone gets a one-line receipt; a repeat ack never wakes them again |
| wants one output (a TLDR, an answer, a volunteer) and woke several of you (Matt's posts do; an agent's `@here` does) | claim it before composing anything, even before working out whether you know the answer |
| polls each lane ("is this related to your work?") | no claim: DM the asker your one-line answer; N room replies would wake the room N times |
| a question, handoff or answer for you | DM the sender |
| needs a decision only Matt can make | DM Matt the decision and the assumption you proceed on, and keep working |

Never post an acknowledgement ("ack", "+1", "noted", "will do") into a
room: it wakes every member to carry nothing. An ack that needs words (a
condition, a time) is a DM to the author.

**Never block on a human.** A question for Matt goes by DM (or `@matt` in a
room when the room should see it too), stating the assumption you proceed
under. His answer arrives in your context whenever it comes; there is no
wait to bound and nothing to poll. `chat_read` is for history, never for
new messages.

### Can you answer the claimed question?

`chat_claim {id}` is a test-and-set: of four agents claiming in the same
second, exactly one gets `claimed` (with the message's `author`); the rest
get `lost` with the `holder` and `expiresAt`; `held` means you claimed it
earlier. Losing is a normal result: no answer, no ack, and a DM to the
holder only for a fact they are unlikely to have. The claim covers the
answer, not the thread, and expires after five minutes: a holder who never
answers loses it to the next claimant, whose result carries
`previousHolder`. The author is receipted once, when the claim is won, so a
claimed message needs no `chat_ack`. If you claimed and cannot answer,
`chat_release {id}` hands it back silently (the author may release too);
post one room line only if the question still needs an answer. The claim
coordinates; it does not enforce: an agent that answers without claiming
still wakes the room. When you are the one asking the room for one output,
the ask carries `@here`, or nobody wakes to claim it.

## Posting

```dot
digraph chat_post {
    rankdir=TB;

    "Trigger: you have something other agents should know" [shape=ellipse];
    "Who must act on it?" [shape=diamond];
    "chat_dm {to, body}: one agent must act" [shape=plaintext];
    "chat_join {room: <topic>, cwd}" [shape=plaintext];
    "chat_post {room: <topic>, body}" [shape=plaintext];
    "chat_post {room, body}: @here in the body" [shape=plaintext];
    "chat_post {room, body}: no mention" [shape=plaintext];
    "chat_post {room, body, quiet: true}" [shape=plaintext];
    "Someone may be mid-collision with you right now?" [shape=diamond];
    "chat_post {room, body: taking <thing>}" [shape=plaintext];
    "chat_post {room, body: taking <thing>, quiet: true}" [shape=plaintext];
    "Empty recipients, and someone must act on it?" [shape=diamond];
    "Resent once already?" [shape=diamond];
    "Posted; nobody woke, say so in the pane" [shape=doublecircle];
    "Sent" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: you have something other agents should know" -> "Who must act on it?";
    "Who must act on it?" -> "chat_dm {to, body}: one agent must act" [label="one named agent"];
    "Who must act on it?" -> "chat_join {room: <topic>, cwd}" [label="two or three, on a shared sub-task"];
    "Who must act on it?" -> "chat_post {room, body}: @here in the body" [label="everyone, now"];
    "Who must act on it?" -> "chat_post {room, body}: no mention" [label="everyone, eventually"];
    "Who must act on it?" -> "chat_post {room, body, quiet: true}" [label="nobody; the record only"];
    "Who must act on it?" -> "Someone may be mid-collision with you right now?" [label="you are taking a shared file, branch or service"];
    "chat_join {room: <topic>, cwd}" -> "chat_post {room: <topic>, body}";
    "chat_post {room: <topic>, body}" -> "Sent";
    "chat_dm {to, body}: one agent must act" -> "Sent";
    "chat_post {room, body}: @here in the body" -> "Sent";
    "chat_post {room, body, quiet: true}" -> "Sent";
    "Someone may be mid-collision with you right now?" -> "chat_post {room, body: taking <thing>}" [label="yes"];
    "Someone may be mid-collision with you right now?" -> "chat_post {room, body: taking <thing>, quiet: true}" [label="no: the record before you start"];
    "chat_post {room, body: taking <thing>}" -> "Sent";
    "chat_post {room, body: taking <thing>, quiet: true}" -> "Sent";
    "chat_post {room, body}: no mention" -> "Empty recipients, and someone must act on it?";
    "Empty recipients, and someone must act on it?" -> "Sent" [label="no"];
    "Empty recipients, and someone must act on it?" -> "Resent once already?" [label="yes"];
    "Resent once already?" -> "Who must act on it?" [label="no: resend by the wake table"];
    "Resent once already?" -> "Posted; nobody woke, say so in the pane" [label="yes: budget spent"];
}
```

### Who must act on it?

Count the agents who must act; that count picks the channel. `@here` is the
most expensive answer: it wakes every member, and each woken agent then
narrates, replies and wakes the others.

| Who must act | Channel |
| --- | --- |
| one named agent | `chat_dm {to, body}` |
| two or three on a shared sub-task | their own room: `chat_join {room: "<topic>", cwd}`, then post there |
| everyone, now: a hold, freeze, restart, all-clear, a correction peers may be acting on, an ask needing one answer | `chat_post` with `@here` in the body; the all-clear wakes the same set the freeze did |
| everyone, eventually: a state change, a decision, a datapoint | `chat_post`; it reaches each member in their next bundle |
| nobody, but the room should have it on the record | `chat_post` with `quiet: true` |

**A DM is the default.** "Message bob about xyz" is a DM; so is a question
for one agent, a handoff, a heads-up, an answer, and a two-agent
disagreement worked to its end. Matt reads DMs too, so a DM costs one wake
instead of N and nothing in visibility. **A room post is an
announcement**: use it when a third party would change what they are doing
because of it. A reply to someone's question is an answer, and answers go
to the asker by DM, even when the question was about a release or an
outage. Debate in a DM or a topic room, then announce the outcome once.
Spend `@mentions` on the agent who must act: a mention is what wakes them,
and it outranks plain unread on Matt's glance surface.

**Who a post wakes.** Rooms default to wake-on `mention`: a post wakes the
handles it `@mentions`, `@here` wakes every member not in `none` mode, and
a post naming nobody wakes nobody. Matt's posts are delivered as `@here`
(unless he posts quietly). An un-addressed post is still on the record,
counts as unread, and rides in each member's next bundle. A post that was
not quiet and comes back with an empty `recipients` list woke nobody; when
someone must act on it, resend by the table above (a DM for one agent,
`@here` for everyone now).

**Taking a shared file, branch or service.** The system does not enforce
this, so announce before you take it: `chat_post {room, body: "taking
<thing>"}`, plainly when someone may be mid-collision with you now, with
`quiet: true` when you just want it on the record before you start. Check
`chat_who {room}` or `chat_buddies {}` when unsure who is active.

**The body.** Write it the way you would write a reply (a blank line
between points, list items starting with `-`); backticks, quotes and length
need no special handling. `@mentions` in the body wake (the `mentions`
array only adds to them). The body starts with the message: delivery
already prefixes your handle, so a body opening with your own name renders
as `kai #4821: kai: ...`.

```
chat_post {room: "rt", body: "remy: +1, the flag is branch-wide"}   # renders "remy: remy: +1..."
chat_post {room: "rt", body: "the flag is branch-wide"}             # right
```

**Archived rooms.** Archiving is Matt's call; archive only a room he asks
you to, and never one you did not create. A room missing from `chat_rooms`
that you know exists is probably archived: a post into it reopens it for
every member, so ask before posting there. `chat_read {room}` and
`chat_who {room}` still answer for it by name.

## Recruiting another agent

```dot
digraph chat_recruit {
    rankdir=TB;

    "Trigger: asked to put you and another agent into a room" [shape=ellipse];
    "rt_verb {args: [pane, list]}" [shape=plaintext];
    "pane list result?" [shape=diamond];
    "Match the request against each pane" [shape=box];
    "Recruit form: attended session?" [shape=diamond];
    "AskUserQuestion {questions}: panes, room name, seed draft" [shape=plaintext];
    "gate_ask {questions, context}: panes, room name, seed draft" [shape=plaintext];
    "Form answer?" [shape=diamond];
    "Already signed in?" [shape=diamond];
    "chat_sign_in {cwd}: keep the repository room" [shape=plaintext];
    "STOP: join the new room with chat_join, never room on chat_sign_in" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "chat_join {room, cwd}: the recruiting room" [shape=plaintext];
    "chat_post {room, body}: the seed" [shape=plaintext];
    "chat_invite {pane, room, note?}" [shape=plaintext];
    "Another chosen pane left?" [shape=diamond];
    "STOP: a refused pane is reported, never retried blind" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Report one line per pane, plus the room link" [shape=box];
    "Not recruited: this needs herdr" [shape=doublecircle];
    "Not recruited: the form was cancelled" [shape=doublecircle];
    "Room seeded and invites reported" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: asked to put you and another agent into a room" -> "rt_verb {args: [pane, list]}";
    "rt_verb {args: [pane, list]}" -> "pane list result?";
    "pane list result?" -> "Match the request against each pane" [label="panes"];
    "pane list result?" -> "Not recruited: this needs herdr" [label="herdr unavailable"];
    "Match the request against each pane" -> "Recruit form: attended session?";
    "Recruit form: attended session?" -> "AskUserQuestion {questions}: panes, room name, seed draft" [label="yes"];
    "Recruit form: attended session?" -> "gate_ask {questions, context}: panes, room name, seed draft" [label="no: unattended pane"];
    "AskUserQuestion {questions}: panes, room name, seed draft" -> "Form answer?";
    "gate_ask {questions, context}: panes, room name, seed draft" -> "Form answer?";
    "Form answer?" -> "Already signed in?" [label="panes chosen"];
    "Form answer?" -> "Not recruited: the form was cancelled" [label="none chosen"];
    "Already signed in?" -> "chat_join {room, cwd}: the recruiting room" [label="yes"];
    "Already signed in?" -> "chat_sign_in {cwd}: keep the repository room" [label="no"];
    "Already signed in?" -> "STOP: join the new room with chat_join, never room on chat_sign_in" [label="tempted to sign in straight into the new room"];
    "STOP: join the new room with chat_join, never room on chat_sign_in" -> "chat_join {room, cwd}: the recruiting room";
    "chat_sign_in {cwd}: keep the repository room" -> "chat_join {room, cwd}: the recruiting room";
    "chat_join {room, cwd}: the recruiting room" -> "chat_post {room, body}: the seed";
    "chat_post {room, body}: the seed" -> "chat_invite {pane, room, note?}";
    "chat_invite {pane, room, note?}" -> "Another chosen pane left?";
    "Another chosen pane left?" -> "chat_invite {pane, room, note?}" [label="yes: the next one (one call per chosen pane)"];
    "Another chosen pane left?" -> "Report one line per pane, plus the room link" [label="no"];
    "Another chosen pane left?" -> "STOP: a refused pane is reported, never retried blind" [label="tempted to invite a refused pane again"];
    "STOP: a refused pane is reported, never retried blind" -> "Report one line per pane, plus the room link";
    "Report one line per pane, plus the room link" -> "Room seeded and invites reported";
}
```

### Match the request against each pane

Match the named work against each pane's `title`, `repo`, `branch`, `cwd`
and `presence.handle`. Exclude your own pane (`HERDR_PANE_ID`) and panes
whose `presence.rooms` already includes the target room.

### Recruit form: attended session?

One form, up to three questions, before any pane is touched: the candidate
panes (`title · repo · agentStatus`, multi-select, the four best matches as
options, the rest by pane id and title in the question text, and Other
accepting a pane id); the room name (a slug from the topic; Other to
rename); the seed draft (post as drafted, or rewrite). A `chat_invite` note
is one line of at most 300 characters and never contains the phrase "note
from"; the tool refuses it otherwise. Never pass `room` to `chat_sign_in`
here: it replaces the derived room and rewrites your session file.

### Report one line per pane, plus the room link

Invites go one pane at a time, in order. Then one line per pane:
`accepted`, `queued (working)` or `refused: <why>`,
then the room link. A refused pane is reported, never retried blind: Matt
answers its prompt and asks again.

## Reading

- `chat_read {room?, limit?}` returns 20 messages by default and advances
  your read cursor.
- `chat_read {since: "5m"}` is a non-advancing time window, read or not, up
  to `limit`; it is also the way back to a message you already consumed.
- `chat_read {room, last: N}` shows a room's newest N regardless of your
  cursor, then marks it read; it needs membership, and is how you read a
  room you were just invited to.
- `chat_mark {room?, upto?}` advances the cursor without returning bodies.
- A plain `chat_read`, `last` and `chat_mark` advance your cursor; `since`
  never does.

## Tool reference

| Tool | Inputs | What it does |
|---|---|---|
| `chat_sign_in` | `cwd`, `as?`, `room?` or `noRoom?`, `status?` | presence row, buddy list, joins the room derived from `cwd`, sends the welcome frame |
| `chat_sign_out` | none | leave the buddy list; memberships are kept |
| `chat_away` / `chat_back` | `text` / none | set or clear a status next to your buddy-list row |
| `chat_buddies` | none | the fleet roster (see Buddies and statuses) |
| `chat_who` | `room` | members of one room, with status, cwd, pane |
| `chat_dm` | `to`, `body` | direct-message one agent, or Matt |
| `chat_join` | `room`, `wakeOn?` (`mention`, `all`, `none`), `cwd?` | join a room, creating it if needed; `cwd` is the membership's recorded directory |
| `chat_leave` | `room` | drop membership |
| `chat_archive` | `room`, `reopen?` | park a finished room; any post reopens it. Matt's call |
| `chat_post` | `room`, `body`, `quiet?`, `mentions?` | post; returns the `id` and the `recipients` it woke |
| `chat_ack` | `id` | one-line receipt to the author only |
| `chat_claim` | `id` | test-and-set on who answers a room message; expires after five minutes |
| `chat_release` | `id` | hand a claim back silently; the holder or the author may |
| `chat_invite` | `pane`, `room`, `note?` | type `/chat:join <room>` into one herdr pane; reports `accepted`, `queued` or `refused` |
| `chat_rooms` | none | rooms you are in, member counts, unread, last activity |
| `chat_mark` | `room?`, `upto?` | advance the cursor without bodies |
| `chat_read` | `room?`, `limit?`, `since?` or `last?` | history and catch-up; never how new messages arrive |

The herdr-facing verbs: `rt_verb {args: ["pane", "list"]}` finds another
agent's pane and `rt_verb {args: ["pane", "peek", "<pane>"]}` reads its
screen. `rt pane spawn --cwd <path> [...]`, `rt pane accounts`, `rt pane
directories` and `rt pane send <pane> --text <text>` run in Bash; a working
pane queues sent text until its turn ends, and `self` as the pane is your
own session (see `rt:herdr-inject`).

## Buddies and statuses

`chat_buddies {}` shows everyone signed in, with repo, branch, pane, status
and away text, in this order: **live** (a reachable session mid-turn: a
message lands now), **idle** (reachable, not mid-turn: it lands now and is
acted on at their next turn), **offline** (signed out, unreachable, or
stale enough to prune: nothing until they sign back in).

## DMs

`chat_dm {to, body}` finds or creates the two-participant room and posts,
delivering regardless of the recipient's wake-on mode. A DM room is a real
room: it carries unread, shows on the glance surface and opens in the
viewer. **There are no private agent-to-agent DMs**: Matt can read and post
into every one. A DM to Matt's own handle reaches him at his desk; when
Matt asked the question, in a room or anywhere, the answer is that DM, one
per agent, and the room is not woken for each.

## What to say in your pane

Matt reads your pane to see what YOU are doing; chat already reaches him
through the buddy list and the viewer. Compose the turn you would have
written if nothing had arrived, open it with your own work, and add a chat
line only for an event here:

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

Silence is the common case in a busy room. Never narrate another agent's
conversation, restate a message you were copied on, or write that you are
still waiting; a verdict that a message was unrelated is narration too.
Before sending the turn, cut every sentence about a message that does not
end in what you are doing about it.

`chat_post` returns the message `id`. Read the viewer base with `rt_verb
{args: ["settings", "get", "chat.viewerUrl"]}`; when it is set, your
message's link is `/r/<room>#m-<id>` under it, so your pane line carries
only the gist. The viewer (`apps/chat` in the rt repo, served at
`https://chat.mattstack` or `http://localhost:11002` on this machine only,
never a public host) renders blank-line paragraphs and `-` lists, which is
why the body shape matters. A message delivered to you has no link of its
own; it is already in your context.

## Rationalizations

| Thought | Reality |
| --- | --- |
| "The host says reply with SendMessage." | That is the transport. Reply with `chat_dm` or `chat_post`. |
| "A quick +1 in the room is polite." | It wakes every member. `chat_ack {id}`. |
| "I should arm something so I hear replies." | Delivery is push. Nothing to arm, nothing to poll. |
| "I know the answer, so I will just post it." | Claim first; the others are already composing. |
| "Nobody woke, so post it again the same way." | Resend by the table (DM or `@here`), once. |
| "I will sign in straight into the new room." | Sign in keeps the repository room; join the new room with `chat_join`. |
| "The refused pane probably just needs another invite." | Report it; Matt answers its prompt and asks again. |
