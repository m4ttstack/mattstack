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

- Payload `{ sessionId, repo, subject?, label? }`; data `AgentRecord`.
- Idempotent per session: when a record already carries `sessionId`, it
  returns that record unchanged. No pane is stored: the run's live agent
  mirror (`RunSummary.agent`) already answers whether a pane is open.
- Otherwise it locates the transcript `<sessionId>.jsonl` under
  `<config dir>/projects/*/` for `~/.claude` and each `cswapConfigDirs()`
  entry (`lib/cswap.ts`). The record's `cwd` is the transcript's first `cwd`
  value: Claude Code files a transcript under the folder the session
  launched in, and `--resume` must start there (a session that later
  entered a worktree with EnterWorktree still launched elsewhere).
- Account, in order: the `agent.claude.account` setting when that
  account's config dir holds the transcript (the same default `agent:start`
  reads); else none when `~/.claude` holds it (a bare `claude` reads that
  dir); else the account whose cswap dir holds the newest copy. A cswap dir
  is named `<number>-<slug>`, and `cswap list --json` maps the number to
  the account email `cswap run` takes. Most cswap dirs symlink `projects`
  to `~/.claude/projects`, so they all hold the one file; only an account
  with its own `projects` folder holds a separate copy.
- Saves `{ provider: "claude", surface: "herdr", sessionId, repo, cwd,
  account?, subject?, label? }` through `insertAgent`.
- The session id must match `^[A-Za-z0-9-]+$` before it is joined into a
  path.
- No transcript found: refuse with "no transcript for this session on this
  Mac". Launching anyway would silently start a fresh session.
- An adopted record stays off the daemon reconciler's roster until it
  first launches a pane (a resume), because until then it describes a pane
  you opened yourself: no attention gates, relocation key presses or
  answer-time relaunches for it.
- Not an MCP tool and not `agentSafe`. Its callers are rt's own run writes
  and console's server.
- Registered in `Commands` (`packages/rt-client/src/commands.ts`) with an
  `agentAdopt` wrapper in the client, and in the daemon command list.

### 2. Registering at run start (rt)

`recordIdentity` (`lib/runs/identity.ts`) is untouched. A new async
`adoptRunSession(runDb, env)` (`lib/runs/adopt.ts`) runs after the two write
verbs that call `recordIdentity` (`run-start` and `stage-start` in
`commands/runs-write.ts`), next to the existing `emitted` call:

- It reads the run's `claude-session` and `agent` fields. When a session is
  recorded and either no `agent` field exists or the session field is newer
  than the `agent` field, it calls `agent:adopt` with that session, the
  run's repo, `subject: "run:<runId>"`, the ticket (else the run id) as
  label.
- On success it writes the returned id as the run field `agent`
  (`produced_by: "run"`).
- Best effort, on `emitRunUpdated`'s contract: `RT_RUN_EMIT=0` skips it, a
  daemon that is down or refuses is swallowed, and the write's own output
  never changes. The daemon's command seam already logs every refusal.

Deriving the trigger from the DB rather than from the write means an
account hop or a new session taking over the run registers on its next
stage start, and an adopt that failed while the daemon was down retries on
the next one.

### 3. Resume in console

**Server** (`apps/console/src/server/runs.ts`): `POST
/api/runs/:repo/:runId/resume`, chained like the other run routes so
`AppType` keeps its inference.

1. Read the run (`getRun`). 404 when it is missing or recorded no
   `claude-session`; 409 when `status` is not `running`, or when
   `run.agent` is set at all: herdr lists only panes that exist, and
   `done` there is a finished turn on a live pane, so a resume would
   start a second Claude on the same transcript.
2. Agent id: the run's `agent` field, else `agentAdopt` with the run's
   session (a run that predates part 2). Console never writes a run DB, so
   nothing is written back; adopt's idempotence makes a second press cheap.
   When resume answers that the recorded agent no longer exists (the daemon
   prunes long-gone records), adopt again and resume once more.
3. `agentResume({ id, prompt })`, the prompt naming the run and its
   worktree and quoting the `hold` field when set: "Run `<id>` is no longer
   held (`<hold>`). Re-enter the worktree `<path>` and pick the run back
   up." Answer `{ resumed: true, agentId }`.
4. Daemon errors answer 502 with `{ error }` (the kit's error envelope).

**UI** (`RunDetail.tsx` header, beside the existing Focus pane button). The
run payload already carries what the button needs: `run.agent` is the live
herdr agent matched by the run's session (else its worktree), so no new
read field is added.

| State | Shown when | Button |
| --- | --- | --- |
| live | `run.agent` set | the existing Focus pane (not while it reads `done`) |
| resumable | run `running`, `claude-session` recorded, `run.agent` unset | Resume |
| neither | no session, or run finished | none |

Pressing Resume disables the button while the request runs, and a success
hides it until the page remounts, since the live agent mirror refreshes on a
short cache; a failure shows
`notifications.error` with the server's message, a success
`notifications.success("Resumed the run in a new pane")`.

## Testing

- `agent:adopt`: first-`cwd` extraction, account choice across several
  copies, setting preference, missing transcript refusal, a session id with
  a slash refused, and idempotence. Fixtures build transcripts in a temp HOME.
- `recordIdentity` returns the session only on change; `adoptRunSession`
  writes `agent` on success and leaves the write intact on a refused or
  unreachable daemon.
- Console route: resume with a recorded agent, adopt fallback, 404, 409
  (finished and live), 502; button state in `RunDetail.test.tsx`.
- Live check: a real held run whose session later entered a worktree
  resumes from console into a pane in the session's launch folder and
  continues the same conversation. This proves `claude --resume` from the transcript's launch
  folder. It needs the daemon change deployed, so it runs after merge.
- Fast Browser screenshots of the run header in light and dark.
