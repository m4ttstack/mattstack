# CI attendant lease and CI watch in rt (RT-331)

## Goal

Only one agent attends an MR's CI at a time. Today the lease is two copies of
the same file format (the watch-ci pack's `ci-attendant.sh` and the board's
`apps/board/src/triage/attendant.ts`), the holder is a constant role name so
two watch-ci sessions can overwrite each other, nothing heartbeats during a
watch, and the 10 minute TTL lets the board's doctor take the MR mid-work. The
watch loop (`ci-watch.sh`) locks onto the newest pipeline for the ref, which can
be the previous push's green pipeline.

This change puts one lease implementation and one CI watch in rt, exposes both
as MCP tools, and makes the board read the same lease.

Out of scope: editing the pack's engine, scripts or team packs (a follow-up
switches them to the tools); any general claim primitive; `ci_watch` on GitHub
(the `mr_*` target resolution and MR cache reads are GitLab only today, so
GitHub is an explicit follow-up); watching a branch that has no MR; the board's
manual `/doctor` route.

## Decisions already ratified (gate b197c832)

1. The pipeline's `sha` and `ref` come from the forge layer: `packages/glance`
   gains them on `Pipeline`.
2. The lease stays in per-MR JSON files under `~/.mattstack/ci-attendants/`
   with the current slug and fields plus an owner token. One TypeScript
   implementation lives in `packages/rt-client`, used by the MCP tools, the CLI
   and the board. No state db table, so no `SCHEMA_VERSION` claim.
3. `ci_watch` is a bounded call that returns `running` when the pipeline has not
   settled, heartbeats the caller's lease on every poll, and refuses once the
   caller no longer holds it.

## 1. The lease (`packages/rt-client/src/ci-lease.ts`)

### File format

One file per MR: `<dir>/<slug>-<iid>.json`, where `dir` is
`MATTSTACK_ATTENDANTS_DIR` or `~/.mattstack/ci-attendants` (HOME read at call
time) and `slug` is today's `leaseFileName()` rule (URL pathname before `/-/`,
lowercased, non-alphanumeric runs collapsed to `-`, trimmed). The body keeps
every current field and adds one:

| Field | Type | Notes |
|---|---|---|
| `mr` | string | MR web URL |
| `branch` | string? | source branch |
| `holder` | `"watch-ci" \| "doctor"` | the role; unchanged meaning |
| `owner` | string | NEW: the claimant's token |
| `sessionLabel` | string? | display name (chat handle when known) |
| `pid` | number? | writer pid |
| `startedAt` | number | ms epoch, kept across heartbeats and re-claims |
| `heartbeatAt` | number | ms epoch |
| `ttlSeconds` | number | default 600 |

The iid is parsed from the URL's `/merge_requests/<n>` or `/pull/<n>` segment,
so a trailing slash, `/diffs` or a query string does not change it; a URL with
neither is refused.

### Interop with the pack script (until it is retired)

- rt reads script-written leases: a lease with no `owner` reads as owner
  `legacy:<holder>`, so it is foreign to every rt caller and blocks a claim
  while fresh.
- The script reads rt-written leases: its `read_fresh` and `status` use only
  `heartbeatAt`, `ttlSeconds` and `holder`, all kept. It refuses a fresh
  `doctor` lease as before. It still treats any fresh `watch-ci` lease as its
  own (the constant-holder bug), which stays until the follow-up retires it.
- The script takes no lock and writes by exclusive create or rename. A script
  write racing an rt write can still lose one side's update; that window is
  accepted only because the script is being retired.

### Operations

All take the MR URL and the caller's owner token.

- `readCiLease(mrUrl)`: the fresh lease or null (missing, malformed and stale
  all read as null), plus whether a stale lease is on disk, for reporting.
- `claimCiLease({mrUrl, owner, holder, branch?, sessionLabel?, ttlSeconds?})`:
  - no file, a malformed file, or a stale lease: the claim wins (a stale
    lease's owner is reported as `previousOwner`);
  - a fresh lease with the same owner: re-claim, refreshing `heartbeatAt` and
    keeping `startedAt`;
  - a fresh lease with any other owner: refused, returning the holder's lease.
    Role does not matter: a second watch-ci session is refused exactly like a
    doctor would be.
- `heartbeatCiLease(mrUrl, owner)`: refreshes `heartbeatAt` only when the file
  names this owner (fresh or stale, so a holder that overslept its TTL
  revives its own lease when nobody took it). Otherwise returns
  `{ok: false, reason: "lost", holder}` or `{ok: false, reason: "none"}`.
- `releaseCiLease(mrUrl, owner)`: deletes the file only when it names this
  owner; otherwise a no-op that says why.
- `adoptLegacyCiLease(mrUrl, owner, holder)`: rewrites a lease with no `owner`
  and the given `holder` to carry `owner`, keeping its times. Used once by the
  board at upgrade (section 5).

### Compare-and-set

Every mutating operation (claim, heartbeat, release, adopt) runs under a per-MR
lock file `<slug>-<iid>.lock`:

- The lock is taken by exclusive create (`open` with `wx`) of a file holding a
  random token and the time. Inside the lock the lease file is re-read and the
  rule applied.
- When the rule says create and no lease file exists, the write is a temp file
  plus exclusive `link` into place, never a rename, so a concurrent lockless
  creator (the pack script) cannot be overwritten and two claimers cannot both
  win. When a lease file exists, the write is temp plus rename, so a reader
  never sees a partial file.
- A lock older than 10 seconds is broken: read its token T, rename the lock
  aside to a unique name, read the aside file's token. When it is T, delete it
  and retry the take. When it is not T (another process broke and re-took the
  lock in between), put it back with an exclusive `link` and retry; if that
  link fails, a newer lock exists and the retry waits on it.
- The holder re-reads the lock's token immediately before its final write
  (rename or link) and abandons the operation, retrying from the take, when
  the token is no longer its own (its lock was broken as stale).
- Release of the lock checks the token first and deletes the lock only when it
  is still the holder's, so a holder whose lock was broken never deletes the
  next holder's lock. Its name does not end in `.json`, so the board's branch
  scan never reads it.

### Owner tokens

- MCP tools: `session:<CLAUDE_CODE_SESSION_ID>` from the server's env. A call
  with no session id is refused (no identity, no lease). The tools take no
  owner input, so a caller can only ever write its own lease. `sessionLabel`
  is the chat handle when the session is signed in.
- CLI (`rt ci lease ...`): the same token when `CLAUDE_CODE_SESSION_ID` is set,
  else `user:<login>` for a human at a terminal.
- Board doctor: `board:doctor:<lease file name>`, from `boardDoctorOwner(mrUrl)`,
  stable across cron passes so each pass can heartbeat and release what an
  earlier pass claimed. There is one board and one auto doctor per MR, so the
  lease file name is unique enough.

## 2. Pipeline sha, ref and event type (`packages/glance`)

`Pipeline` gains `sha: string | null`, `ref: string | null` and
`mergeRequestEventType: "merged_result" | "detached" | "merge_train" | null`.

- GitLab: add `sha ref mergeRequestEventType` to both `headPipeline` selections
  (dashboard and list fragments) and to `GQLPipeline`; `toPipeline` copies them.
  GitLab's GraphQL `Pipeline` has no source sha, so for a merged-results or
  merge-train pipeline `sha` is the synthetic merge commit.
- GitLab gains `fetchCommitParents(projectPath, sha): Promise<string[]>` (REST
  `repository/commits/:sha`, `parent_ids`), optional on the `GitProvider`
  interface, behind a daemon verb `mr:commit-parents`.
- GitHub: `sha` is the check runs' `head_sha`, `ref` is the PR's head ref,
  event type null.
- `glance` dist is rebuilt and its freshness confirmed, and `rt-client` dist
  after it, as AGENTS.md requires.

`mr_pipeline`'s result gains `pipeline.sha`, `pipeline.ref` and
`pipeline.mergeRequestEventType` with no other change.

## 3. `ci_watch` (`lib/mcp/ci-tools.ts`)

GitLab only, like the other `mr_*` reads. Input: the MR target (`repoName` +
`iid`, or `mrUrl`), `sha` (the pushed commit, 7 to 40 hex), `maxWaitSeconds`
(default 300, cap 1800), `intervalSeconds` (default 30, 10 to 120, and at most half the lease's `ttlSeconds` at run time),
`priorPipelineId` (the head pipeline id read before the push, optional), and
`underBoardLease` (default false).

### Matching a pipeline to the pushed sha

A head pipeline is "for" `sha` when:

- a branch or detached pipeline (event type null or `detached`): its `sha`
  equals `sha` (prefix match when `sha` is short);
- a merged-results or merge-train pipeline (event type `merged_result` or
  `merge_train`, or a `ref` of `refs/merge-requests/<iid>/merge` or `/train`):
  its merge commit's parents include `sha`. Fast-forward and squash merge
  trains build a commit whose parents never include `sha`, so when a merge
  train's parents do not match (event type `merge_train` or a `/train` ref),
  the fallback applies: the pipeline is new since the push, meaning its id is
  greater than `priorPipelineId` when that is given, else its id is greater
  than the head pipeline id seen on the first poll of this call where
  `diffHeadSha` equalled `sha` (any pipeline counts when that first poll saw
  none, since head pipeline ids only grow). Without `priorPipelineId`, a
  pipeline that already existed when the call first saw the head at `sha`
  cannot be proved new, so it stays `waiting` with a `next` hint to pass
  `priorPipelineId`. A match proved against the first-seen id returns, as
  `priorPipelineId` in the result, the bound to pass on the next call: the
  first-seen pipeline id, or one less than the matched id when the first poll
  saw no pipeline. `next` says to pass it, so the next call keeps the proof.
  A merged-results pipeline whose parents miss `sha` is no match, since its
  commit always has the source head as a parent.
- Parents are fetched once per pipeline id per call, and only a successful
  fetch is cached: a failed fetch is retried on the next poll, never cached as
  "no match".

### Loop

One iteration per interval until a result, `maxWaitSeconds`, or cancellation:

1. Lease check. Normally, heartbeat the caller's lease on this MR; when the
   caller does not hold it, return `state: "lease_lost"` with the holder. With
   `underBoardLease`, read the lease without writing it and return
   `lease_lost` unless a fresh lease is owned by `boardDoctorOwner(mrUrl)`.
   That read is what tells a board-launched doctor that the board's lease lapsed
   (laptop asleep, a cron pass skipped by the cron lock, triage switched off)
   and a watch-ci session took the MR.
2. Read the MR live from the daemon's cache (the `mr_pipeline` path, small
   `maxAgeMs`).
3. If the MR's head sha (`diffHeadSha`) is not `sha`, the state is `waiting`
   for a grace window of 120 seconds of continuous mismatch within the call
   (the head lags a push by seconds). After the window it returns
   `superseded` with the head sha.
4. If the head pipeline is missing or not for `sha`, keep polling (`waiting`).
   This is the fix for the false green on a fresh push.
5. If the pipeline status is terminal (`success`, `success_with_warnings`,
   `failed`, `canceled`, `skipped`, `manual`), return it.

On `maxWaitSeconds` it returns the last state (`waiting` or `running`) so the
caller calls again.

### Cancellation and call length

The MCP server passes the request's abort signal to tool handlers (the
`McpToolDef` handler gains an optional `signal` argument). `ci_watch` checks it
between polls and during its sleep, and returns at once when aborted, so an
interrupted call stops heartbeating immediately. The 300 second default is the
tradeoff between tool-call overhead and responsiveness: chat messages and a
stand-down reach the agent only between tool calls, so one call can delay them
by up to `maxWaitSeconds`. A caller that wants fewer round trips raises it.

### Result

Triage-ready forge detail; REAL or INFRA classification stays in the pack's
domain:

```
{ state, sha, headSha,
  pipeline: { id, status, sha, ref, mergeRequestEventType, webUrl, createdAt } | null,
  failedJobs: [{ jobId, name, stage, allowFailure, webUrl, traceTail? }],
  blockingFailures: <count of failed jobs without allowFailure>,
  lease: { owner, heartbeatAt, expiresAt } | null,
  holder?: <the other lease, present only on state "lease_lost">,
  priorPipelineId?: <the bound to pass on the next call, present only when a
    merge-train match was proved against a first-seen pipeline id>,
  waitedSeconds, polls, next }
```

`state` is one of `success`, `success_with_warnings`, `failed`, `canceled`,
`skipped`, `manual`, `running`, `waiting`, `superseded`, `lease_lost`,
`aborted` (the call was cancelled; distinct from the pipeline's `canceled`). On a terminal `failed`, the first five blocking failed jobs carry
`traceTail` (last 40 lines, ANSI stripped, the `mr_job_trace` tail helper).
When the cached pipeline was written at list weight and has no jobs, the watch
fetches the pipeline's failed jobs once (GitLab REST, a new optional
`fetchPipelineFailedJobs` on the provider behind a daemon verb
`mr:pipeline-failed-jobs`) before reporting failures. `next` is a one-line hint
("call again", "claim the lease", "read more with mr_job_trace"). The result
goes through `callTool`'s redaction like every tool.

## 4. MCP lease tools (`lib/mcp/ci-tools.ts`)

`ci_lease_claim`, `ci_lease_heartbeat`, `ci_lease_release`, `ci_lease_read`.
Input: `mrUrl` (required; the lease is forge-agnostic and needs no daemon),
plus for claim `holder` (`watch-ci` default, or `doctor`), `branch`, and
`ttlSeconds` (60 to 900, default 600, so one crashed session blocks the doctor
for at most 15 minutes). Owner and label come from the env. Results are the
operation's return shape as JSON; a refusal is an ordinary result
(`{claimed: false, holder}`), not a tool error, so the agent branches on it.

With `ci_watch`, a watch-ci stage does claim, watch (which heartbeats), fix,
heartbeat, release with no Bash rt call.

### The doctor

A doctor the board launches runs under the board's lease: the board claims
before launch and its cron heartbeats while the doctor is in flight and
releases at a terminal status. The doctor pane never claims; it watches with
`ci_watch {underBoardLease: true}`, which only reads the lease and returns
`lease_lost` as soon as the board's lease is gone or someone else holds the MR. A doctor started any other way (by hand, outside the board) claims
with `ci_lease_claim {holder: "doctor"}` and runs the same flow as a watch-ci
stage. The board's doctor skill text is not changed here; the follow-up that
switches the pack also updates the doctor's domain skill.

## 5. Board (`apps/board`)

- `src/triage/attendant.ts` becomes a thin re-export of the rt-client lease
  (`readLeaseByBranch` moves into rt-client too), so there is one
  implementation.
- `runTriage`'s auto-spawn claims the lease as holder `doctor`, owner
  `boardDoctorOwner(mrUrl)`, BEFORE `writeDoctorState('queued')`. A refused claim
  skips the edge as `attended` and writes no state row, so no orphan `queued`
  row reads as a doctor in flight. A live watch-ci lease, now kept fresh by
  heartbeats, therefore blocks the doctor. A launch that throws releases the
  claim.
- The per-pass heartbeat and release loop keeps its role, using the owner
  token. At upgrade, the loop first adopts a `legacy:doctor` lease (no owner)
  on any MR with an in-flight doctor, so a doctor that was mid-fix when the
  board updated does not lapse.

## 6. CLI and lint

A new `ci` group: `rt ci lease claim|heartbeat|release|show <mr-url>` and
`rt ci watch <mr-url> --sha <sha>`, each with `--json`, registered in
`lib/module-registry.ts`, with `omitBehavior: { exempt }` (a free-text URL).
They are not `agentSafe`: the MCP tools cover them, and each tool's
`shellForms` names its verb (`rt ci lease claim`, and so on), so
`deriveRules` flags the Bash form in skill text.

## 7. Testing and verification

- rt-client lease unit tests: every claim rule, heartbeat and release
  ownership, adopt, iid parsing (trailing slash, `/diffs`, query, `/pull/<n>`,
  none), TTL bounds.
- Race tests in child processes spawned with `childEnv()`: many concurrent
  claimers, exactly one wins; a lockless exclusive-create claimer racing an rt
  claimer, exactly one wins; stale lock breaking, including the put-back path;
  a holder whose lock was broken neither deletes the next holder's lock nor
  completes its write.
- Pack interop in both directions against a fixture copy of `ci-attendant.sh`:
  the script reads and refuses an rt `doctor` lease; rt reads a script lease as
  `legacy:watch-ci` and refuses to claim over it while fresh.
- glance tests for `sha`, `ref` and event type in both providers, and for
  `fetchCommitParents`; an `mr_pipeline` test.
- `ci_watch` tests with fake deps: `waiting` on a stale sha (the false-green
  case); a merged-results pipeline matched through its merge commit's parents;
  head lag inside the grace window reads `waiting`, and past it `superseded`;
  a fast-forward merge-train pipeline matched by the fallback (with and
  without `priorPipelineId`); a failed parent fetch retried rather than cached;
  each terminal state; `lease_lost`; `underBoardLease` never writes the lease,
  continues under a fresh `boardDoctorOwner(mrUrl)` lease and returns
  `lease_lost` when that lease is stale or held by another owner; abort
  returns `aborted` at once and stops heartbeating; timeout returns
  `running`; trace tails on failure.
- Board triage tests: claim before the queued write; a refused claim writes no
  row; a launch failure releases; legacy doctor leases are adopted.
- A lint test that each new verb's Bash form is flagged under strict.
- A describe-only test that the claim, watch, heartbeat, release flow resolves
  to MCP tools with no Bash rt call.
- An automated end-to-end under an isolated HOME through `rt mcp` over stdio
  with two different `CLAUDE_CODE_SESSION_ID` values: the second claim is
  refused, and after the lease lapses (the test backdates the file's
  `heartbeatAt`, since the TTL floor is 60 seconds) the second session takes
  over and the first session's heartbeat reports `lost`.
- `bun run test`, board tests, `bunx tsc --noEmit`, `bun run picker:check`,
  `bash scripts/repo-purity.sh`, `rt mcp tools --json` lists the five tools.

## Docs

`docs/ci-attendant-lease.md`: the file format, owner tokens, claim rules, the
doctor's lease, and the tools, for the follow-up that retires the pack scripts.
