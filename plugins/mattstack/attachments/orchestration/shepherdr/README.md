# shepherdr

fan work out across parallel claude agents, each in its own herdr pane and
its own git worktree. you talk to the shepherd; the shepherd talks to the
herd through `rt herd`.

`SKILL.md` is the instruction file the shepherd agent reads. this readme is
for you, the human driving it.

## the two modes

**visible** (default). agents land in the session you are looking at, one
tab each. you can watch them work and take over any pane by clicking into
it.

**hidden** (`--hidden` on `rt herd start`). agents land on the daemon's
shared background herdr server, whose panes never appear in your UI (rt
prints them as `bg:<pane>` refs, and `rt pane peek/send/focus` take those
refs directly). you see
nothing until something needs you. this is the mode to ask for when a
six-agent fan-out would bury your sidebar.

nothing else differs. same briefs, same herd, same rules.

## running a herd

the shepherd runs `rt herd start` to mint the herd (registry row, chat
room, herdr workspace, gate subscription) and `rt herd spawn` per worker
(worktree, herdr pane, claude agent). you watch it with
`rt herd status --herd <id>`: jobs, panes, gates, unread. lost the id?
`rt herd list` shows every herd on the machine.

## when an agent needs you

most questions never need a pane. a worker calls `rt herd ask`, which
opens a gate; the question arrives in the shepherd's conversation as a
form, and your answer is relayed back to the worker as a nudge. you answer
in the conversation you are already in.

a pane only comes forward when a job is `blocked` and someone has to look.
then, in hidden mode:

```bash
rt herd attend <job> --herd <id>
```

that opens the worker's pane in a tab of your own workspace, live and
writable. detach with `ctrl+b q`; the worker keeps running.

## reports and the record

the herd's chat room, `herd-<id>`, holds every report, ruling, and
lifecycle notice; open it in the chat viewer to read the whole run back.
the gate registry holds every question and its answer, so nothing a
worker asked or was told is lost once the pane closes.

## picking a herd back up

a herd outlives the session that started it. from any session:

```bash
rt herd resume <id>
```

that re-points the herd's gate subscription and chat handle at the session
you're in now, so new questions start arriving here.

## teardown

```bash
rt herd wrap-up <id> --close-panes --delete-job-dirs --archive-room
```

wrap-up only does what its flags name, so pick the ones that match what
you want gone (add `--dispose <job>` per worktree you want disposed too).
in hidden mode, stop the server itself after:

```bash
rt herd stop --hidden
```

the server is shared with other background work (runner boards, `rt agent
start --bg`); the stop refuses while any of it is still live, naming the
owners.

## things that bit us, so you don't rediscover them

**`HERDR_SESSION` alone does nothing from inside a pane.** herdr injects
`HERDR_SOCKET_PATH` into every managed pane and it silently outranks the
session variable, so the call lands in your visible session with no error.
the whole herd would spawn into the UI it is supposed to stay out of.
never call `herdr` directly against the herd.

**`terminal session control` is not a viewer.** the name reads like the
interactive one and it is not: it is the thin client's wire protocol, so
pointing a tab at it fills the screen with JSON frames of base64 ANSI. the
interactive primitive is `terminal attach`, which takes a terminal id (off
`pane get`) rather than a pane id. we shipped the wrong one first and it
looked exactly like a corrupted terminal.

**headless panes are born 53x23.** the server sizes panes for a client
that never attached. a claude TUI at that size is unusable and every
`pane read` comes back hard-wrapped. `spawn-agent.sh` used to fix it with
a one-shot `terminal session control --takeover --cols/--rows`, which
resized the pane in about 0.2s and the size persisted after the
controller detached. if hidden panes come up tiny under `rt herd spawn`,
that is the fix to reapply.

**panes cannot move between sessions.** separate server processes. there
is no "pull this agent into my UI", only `rt herd attend` streaming it into
a tab of your own.

## requirements

an rt build whose CLI has `rt herd` -- that is `@mattstack/rt-client`
0.17.0 or newer -- and herdr 0.7.5 or newer.
