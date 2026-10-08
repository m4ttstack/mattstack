# Console run resume

## Problem

A pipeline run you hold on purpose (a work run parked until a rollout soaks)
has no way back in from console. The board resumes its lanes through
`agent:resume`, which needs an rt agent record, and only `agent:start`
(`lib/daemon/handlers/agent.ts`) ever writes one. A run started from a pane
you opened yourself records `claude-session` and `herdr-pane` in its run DB
(`lib/runs/identity.ts`) but has no agent behind it, so nothing can resume it
once its pane is gone.

## Goal

Every run that goes through mattstack runs registers its Claude session as an
rt agent, and console's run detail offers Resume (pane gone) or Focus (pane
alive) for it. Runs that started before this change get the same button
through a one-time adopt.

Out of scope: registering sessions that never start a run, and Resume on the
run board's list rows.

## Design

### 1. `agent:adopt` (daemon, rt-client)

A new daemon verb that turns an existing Claude session into an agent record
without launching anything.

- Payload `{ sessionId, repo, subject?, label?, paneId? }`; data `AgentRecord`.
- Idempotent per session: when a record already carries `sessionId`, it
  returns that record, and refreshes `paneId` when the payload names one.
- Otherwise it locates the transcript `<sessionId>.jsonl` under
  `<config dir>/projects/*/` for `~/.claude` and each `cswapConfigDirs()`
  entry (`lib/cswap.ts`). The record's `cwd` is the transcript's first `cwd`
  value: Claude Code files a transcript under the folder the session
  launched in, and `--resume` must start there (a session that later
  entered a worktree with EnterWorktree still launched elsewhere).
- Account: the `agent.claude.account` setting when its config dir holds the
  transcript (the same default `agent:start` reads), else the account of
  the config dir holding the newest copy, else none (default profile).
  Account hops copy the transcript, so several dirs often hold it.
- Saves `{ provider: "claude", surface: "herdr", sessionId, repo, cwd,
  account?, subject?, label?, paneId? }` through `insertAgent`.
- No transcript found: refuse with "no transcript for this session on this
  Mac". Launching anyway would silently start a fresh session.
- Not an MCP tool and not `agentSafe`. Its callers are rt's own run writes
  and console's server.
- Registered in `Commands` (`packages/rt-client/src/commands.ts`) with an
  `agentAdopt` wrapper in the client, and in the daemon command list.

### 2. Registering at run start (rt)

`recordIdentity` stays a synchronous, change-guarded sqlite write and starts
returning the session it newly wrote (`string | null`). The write verbs in
`commands/runs-write.ts` that call it (`run-start`, `stage-start`, and any
other path through `recordIdentity`) pass that result to a new async
`adoptRunSession` next to the existing `emitted` call:

- When a new `claude-session` was written, call `agent:adopt` with that
  session, the run's repo, `subject: "run:<runId>"`, a label from the
  ticket or run id, and the `herdr-pane` value.
- On success, write the returned id as the run field `agent`
  (`produced_by: "run"`), change-guarded like the identity fields.
- Best effort: a daemon that is down or an adopt that refuses never fails
  the run write. The failure is logged at `warn` through `lib/ui/warn.ts`
  with no `show`, so a pipeline never sees it.

Because the hook fires on change, an account hop or a new session taking
over a run registers too.

### 3. Resume in console

**Server** (`apps/console/src/server/runs.ts`): `POST
/api/runs/:repo/:runId/resume`, chained like the other run routes so
`AppType` keeps its inference.

1. Read the run. Refuse 409 unless `status` is `running`; refuse 404 when
   it recorded no `claude-session`.
2. Agent id: the run's `agent` field, else `agentAdopt` with the run's
   session (a run that predates part 2), writing nothing back (console
   never writes a run DB).
3. If the agent's pane is alive (`pane:list`), `paneFocus` it and answer
   `{ focused: true }`.
4. Otherwise `agentResume({ id, prompt })`, the prompt naming the run and
   its worktree and quoting the `hold` field when set: "Run `<id>` is no
   longer held (`<hold>`). Re-enter the worktree `<path>` and pick the run
   back up." Answer `{ resumed: true }`.
5. Daemon errors answer 502 with `{ error }` (the kit's error envelope).

**Read side**: the run detail payload gains `resume: { state: "focus" |
"resume" | "none" }`, computed on the server from the same checks, so the
client renders without a second round trip.

**UI** (`RunDetail.tsx` header, beside the status badge): one kit `Button`.

| State | Shown when | Label |
| --- | --- | --- |
| `focus` | the agent's pane is alive | Focus |
| `resume` | run `running`, session recorded, pane gone | Resume |
| `none` | no session, or run finished | no button |

Pressing it disables the button while the request runs; a failure shows
`notifications.error` with the server's message, a success
`notifications.success` ("Resumed in a new pane" / "Focused the pane").

## Testing

- `agent:adopt`: first-`cwd` extraction, account choice across several
  copies, setting preference, missing transcript refusal, idempotence and
  `paneId` refresh. Fixtures build transcripts in a temp HOME.
- `recordIdentity` returns the session only on change; `adoptRunSession`
  writes `agent` on success and leaves the write intact on a refused or
  unreachable daemon.
- Console route: focus, resume, adopt fallback, 404, 409, 502; button state
  from the payload in `RunDetail.test.tsx`.
- Live check: a real held run whose session later entered a worktree
  resumes from console into a pane in the session's launch folder and
  continues the same conversation. This proves `claude --resume` from the transcript's launch
  folder; it is the first plan task, before the UI.
- Fast Browser screenshots of the run header in light and dark.
