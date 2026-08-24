# shepherdr

fan work out across parallel claude agents, each in its own herdr pane and its
own git worktree. you talk to the shepherd; the shepherd talks to the herd.

`SKILL.md` is the instruction file the shepherd agent reads. this readme is for
you, the human driving it.

## the two modes

**visible** (default). agents land in the session you are looking at, one tab
each. you can watch them work and take over any pane by clicking into it.

**herd session**. agents land in a separate headless herdr server whose panes
never appear in your UI. you see nothing until something needs you. this is the
mode to ask for when a six-agent fan-out would bury your sidebar.

nothing else differs. same briefs, same herd DB contract, same relay.

## running a herd session

say "shepherdr this, keep the panes invisible" (or background / headless /
don't clutter my UI) and the shepherd sets it up. by hand it is two lines:

```bash
export SHEPHERDR_HERD_SESSION=herd
scripts/herd-session.sh start
```

`start` is idempotent. the session survives until you stop it, so a herd
outlives the shepherd's context and you can pick it back up later.

check on it without opening anything:

```bash
scripts/herd-session.sh status
# 3 workspace(s), 3 pane(s)
#    w1 done      app-repo
#    w2 working   gitq
```

## when an agent needs you

most questions never need a pane. agents publish a question row to the run's
herd DB, an event doorbell wakes the shepherd, it reads the row and asks you
as multiple choice, and your answer is relayed back. you answer in the
conversation you are already in.

a pane only comes forward when the agent sets `needs: pane`, or when it crashed
and someone has to look. then:

```bash
scripts/attend.sh <herd-pane-id> -l <job>
```

that opens a focused tab in your visible session attached to that one agent,
live and writable. it is a window, not a move: the agent stays in the herd
session and keeps running. detach with `ctrl+b q`, then close the tab.

attaching also resizes the herd pane to the tab you are viewing it in, and
that size sticks after you detach.

## teardown

```bash
scripts/herd-session.sh stop
```

kills the session and every pane in it. worktrees under
`~/.mattstack/shepherdr/worktrees/` and job dirs under `~/.mattstack/shepherdr/jobs/` are left
alone, so do this only after you have taken what you want off the branches.

## scripts

| script | what it does |
|---|---|
| `hrd` | herdr, routed to the herd session when one is configured. everything else calls this instead of `herdr` |
| `herd-session.sh` | `start` / `status` / `stop` the headless session |
| `herd-init.py` | mints (or resumes) a run: creates `herd.db`, snapshots the bus cursor |
| `spawn-agent.sh` | worktree + tab + claude + kickoff, in one call. records the job's DB row. prints the pane id |
| `herd-wait.sh` | the shepherd's single bus wait; re-arm on every exit |
| `herd-bridge.py` | turns pane lifecycle into `blocked`/`gone` bus events; the crash/stuck detector |
| `herd-read.py` / `herd-answer.py` / `herd-job.py` | the shepherd's only DB surface: render a question/report, record an answer, transition a job's status |
| `attend.sh` | stream one invisible pane into a visible tab so you can intervene |

(`herd-ask.py` and `herd-report.py` are the worker-side publish scripts,
called from inside a job's brief, not by the shepherd directly.)

## things that bit us, so you don't rediscover them

**`HERDR_SESSION` alone does nothing from inside a pane.** herdr injects
`HERDR_SOCKET_PATH` into every managed pane and it silently outranks the
session variable, so the call lands in your visible session with no error. the
whole herd would spawn into the UI it is supposed to stay out of. that is why
`scripts/hrd` exists and why it does `env -u HERDR_SOCKET_PATH`. never call
`herdr` directly against the herd.

**`terminal session control` is not a viewer.** the name reads like the
interactive one and it is not: it is the thin client's wire protocol, so
pointing a tab at it fills the screen with JSON frames of base64 ANSI. the
interactive primitive is `terminal attach`, which takes a terminal id (off
`pane get`) rather than a pane id. we shipped the wrong one first and it
looked exactly like a corrupted terminal.

**headless panes are born 53x23.** the server sizes panes for a client that
never attached. a claude TUI at that size is unusable and every `pane read`
comes back hard-wrapped. `spawn-agent.sh` fixes it with a one-shot
`terminal session control --takeover --cols/--rows`, which resizes the pane in
about 0.2s and the size persists after the controller detaches. override the
default 200x50 with `SHEPHERDR_HERD_COLS` / `SHEPHERDR_HERD_ROWS`.

**`done` is the only settled state you will see in a herd session.** herdr's
`idle` means "finished and someone has looked at the pane". nothing is ever
focused in a headless session, so agents stop at `done` and stay there. this is
what you want: the completion watcher already keys on `done`.

**panes cannot move between sessions.** separate server processes. there is no
"pull this agent into my UI", only `attend.sh` streaming it.

**spawn eats 45s on the readiness wait.** herdr does not classify the agent
until its integration hook fires, which seems to be after the first turn, so
`agent wait --until idle` times out and the prompt-match fallback carries it.
harmless, but it is a flat 45s per agent and worth shortening if it shows up in
visible mode too.

## requirements

herdr 0.7.5 or newer (`agent prompt`, `agent wait --until`, `pane wait-output`,
`terminal session control`). check with `herdr --version`, and if you have both
a homebrew herdr and `~/.local/bin/herdr`, delete the homebrew one: an agent's
shell and your shell resolve them differently and you will get protocol
mismatches on the older binary.
