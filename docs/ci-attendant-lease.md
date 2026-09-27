# The CI attendant lease

Only one agent should be attending an MR's CI at a time: pushing fixes,
watching the pipeline, deciding what to do about a failure. The CI attendant
lease is how rt enforces that. It is a small per-MR file that names who is
attending, and a set of MCP tools (and CLI verbs) that claim it, keep it
alive, read it, and release it.

An agent working an MR's CI normally does this:

1. `ci_lease_claim` the MR before touching it, passing `branch` (the MR's
   source branch) so the board's stack preflight sees this attendant.
2. Read the MR's current head pipeline (`mr_pipeline`) before pushing and
   keep its id as `priorPipelineId`: the numeric part of the
   `gitlab:pipeline:N` id `mr_pipeline` returns.
3. Push the fix.
4. `ci_watch` the pushed commit's pipeline until it settles. `ci_watch`
   heartbeats the lease on every poll, so a single long watch call keeps the
   lease alive without a separate heartbeat.
5. If more fixing follows a failure, call `ci_lease_heartbeat` directly
   during that work (there is no watch call in flight to do it), then
   `ci_watch` again.
6. `ci_lease_release` once the MR reaches a state that needs no more
   attention (merged, or handed off).

A claim that is refused, or a watch that comes back `lease_lost`, means
someone else is already attending this MR. Stand down rather than pushing
over them.

## Where the lease lives

One JSON file per MR, under `MATTSTACK_ATTENDANTS_DIR` if set, otherwise
`$HOME/.mattstack/ci-attendants` (`HOME` is read fresh on every call, not
cached). The file name is derived from the MR (or PR) URL's path. If the
path contains `/-/` (every GitLab merge request URL does), only the part
before it is used; otherwise the whole path is used, which is what happens
for a GitHub pull request URL, since GitHub's paths never contain `/-/`.
Either way, that path is lowercased, every run of non-alphanumeric
characters is collapsed to a single dash, and leading and trailing dashes
are trimmed, then `-<iid>.json` is appended, where `<iid>` is the same
merge request or pull number parsed out of the URL. On GitLab this gives the
number once:
`https://gitlab.example.com/grp/proj/-/merge_requests/42` becomes
`grp-proj-42.json`. On GitHub the number is already part of the path used
for the slug, so it appears twice:
`https://github.com/o/r/pull/7` becomes `o-r-pull-7-7.json`. A trailing
slash, a `/diffs` suffix or a query string on the MR URL does not change the
file name; a URL with no merge request or pull number is refused outright.

A per-MR lock file sits alongside it, named the same way but ending in
`.lock` instead of `.json`, so a directory scan for lease files never picks
it up.

### Fields

| Field | Type | Notes |
|---|---|---|
| `mr` | string | The MR's web URL. |
| `branch` | string, optional | The source branch. |
| `holder` | `"watch-ci"` or `"doctor"` | The role attending the MR. Does not affect claim rules: any other owner is refused the same way regardless of role. |
| `owner` | string, optional | The claimant's token (see Owner tokens below). A lease with no `owner` was written by the legacy pack script. |
| `sessionLabel` | string, optional | A display name, the chat handle when the claiming session is signed in to chat. |
| `pid` | number, optional | The writing process's pid. |
| `startedAt` | number | Milliseconds since epoch. Kept across heartbeats and re-claims by the same owner. |
| `heartbeatAt` | number | Milliseconds since epoch, refreshed by every heartbeat and re-claim. |
| `ttlSeconds` | number | How long after `heartbeatAt` the lease stays fresh. Default 600. |

A lease with no `owner` field reads as owned by `legacy:<holder>` everywhere
in rt, which is a token no rt caller ever holds, so it behaves like any
other stranger's lease.

## Claim rules

`ci_lease_claim` looks at what is on disk right now and does one of four
things:

- **No lease file, or one that cannot be parsed:** the claim wins outright.
- **A stale lease** (its `heartbeatAt` is more than `ttlSeconds` in the
  past) **owned by someone else:** the claim wins, and the response reports
  the stale lease's owner as `previousOwner` so the new holder knows who
  was last attending.
- **A lease, fresh or stale, owned by the caller:** the claim re-claims it,
  refreshing `heartbeatAt` and keeping the original `startedAt`, and reports
  no `previousOwner` (the caller was already the owner, so there is nobody
  to report).
- **A fresh lease owned by anyone else:** the claim is refused. The response
  carries the current holder's lease so the caller can see who has it and
  since when.

A refusal is an ordinary result, not an error, specifically so an agent can
branch on it in the normal flow.

A claim that omits `branch` keeps the branch already recorded on the lease,
on a re-claim and on a takeover alike, since the branch belongs to the MR
and the board's stack preflight finds a lease only by it. A re-claim that
omits `sessionLabel` keeps the caller's own label; a takeover never
inherits the previous owner's.

## Owner tokens

Every lease operation is scoped to an owner token; there is no input that
lets a caller name a different owner, so a caller can only ever act on its
own lease.

- **MCP tools:** `session:<id>`, where `<id>` is the calling session's
  `CLAUDE_CODE_SESSION_ID`. A call made with no session id set is refused
  outright: there is no identity to hold a lease under.
- **CLI, run by a human at a terminal:** `user:<login>`, where `<login>` is
  the shell user. The CLI falls back to this whenever
  `CLAUDE_CODE_SESSION_ID` is unset, so a human's `rt ci watch` heartbeats
  the same lease `rt ci lease claim` took.
- **The board's doctor:** `board:doctor:<lease file name>`. This is stable
  across the board's cron passes, so each pass can heartbeat or release what
  an earlier pass claimed under the same MR, and it is unique enough because
  there is one board and one automatic doctor per MR.

## The lock

Every write (claim, heartbeat, release, adopt) runs under the MR's lock file so two
writers can never race each other's read-modify-write:

- The lock is taken by creating the lock file exclusively (an `open` with
  `wx`), writing a random token and the current time into it. A second
  writer trying to create the same file fails immediately and either waits
  or breaks a stale lock (see below).
- A lock older than 10 seconds is treated as abandoned. The breaker reads
  the lock's token, renames the lock file aside, and checks whether the
  aside file still carries that same token. If it does, the lock truly was
  abandoned and the aside file is discarded, clearing the way. If it does
  not (another process broke and re-took the lock in the meantime), the
  aside file is linked back into place and the breaker retries against the
  lock that is actually live now.
- Right before its final write, a lock holder checks that the lock file
  still carries its own token. If it does not (the lock was broken as stale
  while the holder was working), the holder abandons that write and retries
  the whole operation from the top rather than writing over whoever holds
  the lock now.
- Releasing the lock checks the token first too, so a holder whose lock was
  broken never deletes the next holder's lock.

The lease file itself is written through a temp file: created by an
exclusive link when no lease file exists yet (so a lockless writer, like the
pack script described below, cannot be silently overwritten and two
claimers cannot both win), or by rename when one already exists (so a reader
never sees a half-written file).

## The tools

Every tool below takes `mrUrl`, the MR's (or PR's) `https://` URL; any
other scheme, or none, is refused, since a scheme-less URL would name a
different lease file. None of them take an owner: the owner always comes
from the caller's session.

### `ci_lease_claim`

Claims the lease. Optional input: `holder` (`watch-ci`, the default, or
`doctor`), `branch` (the MR's source branch; pass it so the board's stack
preflight sees this attendant), `ttlSeconds` (60 to 900, default 600, so one crashed
session blocks nobody for more than 15 minutes). Returns
`{claimed: true, lease, previousOwner?}` or `{claimed: false, holder}`.

CLI: `rt ci lease claim <mr-url> [--holder watch-ci|doctor] [--branch <b>] [--json]`.
Exits 3 when the claim is refused.

### `ci_lease_heartbeat`

Refreshes `heartbeatAt` on the caller's own lease. Returns `{ok: true,
lease}`, or `{ok: false, reason: "lost", holder}` when another owner holds
it now, or `{ok: false, reason: "none"}` when there is no lease at all. This
also revives a lease of the caller's own that went stale before anyone else
claimed it, since a heartbeat checks only ownership, not freshness.
`ci_watch` already heartbeats on every poll, so call this directly only
between watches, during a fix that is not itself inside a watch call.

CLI: `rt ci lease heartbeat <mr-url> [--json]`. Exits 3 on `lost` or `none`.

### `ci_lease_release`

Releases the caller's own lease. Returns `{released: true}`, or
`{released: false, reason: "not-owner", holder}`, or
`{released: false, reason: "none"}` when there was nothing to release.

CLI: `rt ci lease release <mr-url> [--json]`. Exits 3 on `not-owner`; exits 0
on `none` (releasing nothing is not an error).

### `ci_lease_read`

Reads the lease without touching it. Returns `{lease, stale, mine}`:
`lease` is the fresh lease or null, `stale` is a stale lease found on disk
(for reporting who was last attending), and `mine` is true only when
`lease` is fresh and owned by the caller. A stale lease of the caller's own
is not reported as `mine`; call `ci_lease_heartbeat` to revive it first.

CLI: `rt ci lease show <mr-url> [--json]`. Exits 0 when a fresh lease exists,
1 otherwise.

### `ci_watch`

GitLab only (refused with "ci_watch is GitLab only" against a GitHub MR).
Watches the MR's pipeline for one pushed commit until it settles or a
timeout passes, heartbeating the caller's lease on every poll.

Input: an MR target (`repoName` and `iid`, or `mrUrl`), `sha` (the pushed
commit, 7 to 40 hex characters, required), `maxWaitSeconds` (default 300,
capped at 1800), `intervalSeconds` (default 30, 10 to 120; the watch also
never polls less often than every half of the lease's `ttlSeconds`, so its
own heartbeat cannot let the lease go stale), `priorPipelineId` (the numeric
part of the `gitlab:pipeline:N` head pipeline id read before the push, so a
fast-forward merge train's new pipeline can be told apart from an old one),
and `underBoardLease` (default false, see below).

A merged-results pipeline counts only when its merge commit's parents
include the pushed sha; only a merge train falls back to "new since the
push". Without `priorPipelineId`, a train pipeline is proved new against the
head pipeline the call first saw; the result then carries that id as
`priorPipelineId`, and `next` says to pass it on the next call so the proof
survives across calls.

Returns `state`, `sha`, `headSha`, the matching `pipeline` (or null),
`failedJobs` (with a 40 line trace tail for up to five blocking failures on
a terminal `failed`), `blockingFailures`, `lease`, `waitedSeconds`, `polls`
and `next`, a one line hint for what to do next. A `failed` pipeline with no
failed job rows (a bridge job's downstream pipeline failed, and GitLab lists
bridges apart from jobs) points `next` at `mr_pipeline` with the bridge
job's `jobId` instead of `mr_job_trace`. The watch heartbeats once more right
before returning a settled state, since reading the failed jobs' traces can
take a while; if the lease was lost by then it returns `lease_lost` (with the
settled pipeline) instead.

`state` is one of:

- `success`, `success_with_warnings`, `failed`, `canceled`, `skipped`,
  `manual`: the pipeline settled.
- `running`: the pipeline for the pushed sha is in progress; call again.
- `waiting`: no matching pipeline yet, or the MR's head has not caught up to
  the pushed sha yet; call again.
- `superseded`: the MR's head stayed at another sha for the 120 second grace
  window before a matching pipeline settled (`next` names that head); watch
  the new head instead. A head the cache has not synced yet (no sha) keeps
  the watch `waiting`, never `superseded`.
- `lease_lost`: the caller no longer holds the lease (or never did). A
  watch under the caller's own lease says in `next` whether to stand down or
  claim first; with `underBoardLease` (a doctor the board launched) it always
  says stand down, since that doctor never claims.
- `aborted`: the call was cancelled (signal, or Ctrl-C at the CLI); call
  again to resume.

`maxWaitSeconds` running out returns whatever state the loop was in
(`running` or `waiting`) rather than an error, so the caller just calls
again.

CLI: `rt ci watch <mr-url> --sha <sha> [--max-wait <s>] [--interval <s>] [--prior-pipeline <id>] [--json]`.
Ctrl-C aborts the watch and exits 130; any other non-terminal-success state
exits 1; `success` and `success_with_warnings` exit 0.

## The doctor's lease

The board's automatic doctor never claims a lease itself. The board claims
on the doctor's behalf, as `board:doctor:<lease file name>`, before it
launches the doctor pane, and the board's own cron heartbeats that lease
while the doctor is in flight and releases it once the doctor reaches a
terminal status. Both the heartbeat and the release first adopt a doctor
lease a pre-upgrade board left without an `owner`, so it is kept alive and
then freed like the board's own. If the board's claim is refused (a live `watch-ci` lease is
already attending), the board skips that MR for this pass rather than
launching a doctor that would collide with it.

The doctor pane itself calls `ci_watch` with `underBoardLease: true`. That
flag makes `ci_watch` only read the lease, never write it, and treat the
watch as lost the instant there is no fresh lease owned by
`board:doctor:<lease file name>`. That is how a doctor pane notices the
board's lease lapsed (a laptop asleep through a cron pass, triage switched
off, a cron pass skipped by its own lock) and a `watch-ci` session has since
taken the MR.

A doctor started by hand, outside the board, is a `watch-ci`-style attendant
like any other: it claims with `ci_lease_claim {holder: "doctor"}` and
follows the same claim, watch, heartbeat, release flow as any other
attendant.

## Pack script interop, and what retires it

Until the watch-ci pack script (`ci-attendant.sh` and its `ci-watch.sh`
loop) is switched over, it reads and writes the same lease files rt does,
so both sides need to keep working during the transition:

- A lease the script wrote has no `owner` field, so rt reads it as owned by
  `legacy:<holder>` and refuses to claim over it while it is fresh, the
  same as it would refuse any other owner.
- The script reads only `heartbeatAt`, `ttlSeconds` and `holder`, all of
  which rt keeps, so an rt-written lease still looks correct to the script.
  The script still treats any fresh `watch-ci` lease as its own regardless
  of which session wrote it, since it has no notion of a per-session owner;
  that constant-holder behavior is expected to go away only when the script
  itself is retired.
- The script takes no lock of its own. It writes by exclusive create or by
  rename, so a script write racing an rt write can still lose one side's
  update. That window is accepted only because the script is on its way
  out, not because it is otherwise safe.

The follow-up that retires the script needs to: switch the pack's watch-ci
and doctor flows to call `ci_lease_claim`, `ci_lease_heartbeat`,
`ci_lease_release` and `ci_watch` instead of shelling out to the script,
regenerate the pack's `reference.md` so it reflects that switch, and then
delete `ci-attendant.sh` and `ci-watch.sh` once nothing reads or writes
through them.
