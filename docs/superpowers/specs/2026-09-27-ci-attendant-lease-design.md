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
as MCP tools, and makes the board read the same lease. Editing the pack's
engine, scripts or team packs is out of scope (a follow-up switches them to the
tools), as is any general claim primitive.

## Decisions already ratified (gate b197c832)

1. The pipeline's `sha` and `ref` come from the forge layer: `packages/glance`
   gains them on `Pipeline`, filled by both providers.
2. The lease stays in per-MR JSON files under `~/.mattstack/ci-attendants/`
   with the current slug and fields plus an owner token. One TypeScript
   implementation lives in `packages/rt-client`, used by the MCP tools, the CLI
   and the board. No state db table, so no `SCHEMA_VERSION` claim.
3. `ci_watch` is a bounded call (default 600 s, cap 1800 s) that returns
   `running` when the pipeline has not settled, and heartbeats the caller's
   lease on every poll.

Shepherd notes on the same gate: writes are atomic (temp plus rename), claim is
a compare-and-set so two racing claimers cannot both win, and every `ci_watch`
call refuses once the caller no longer holds the lease.

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

A lease with no `owner` (written by the pack script) reads as owner
`legacy:<holder>`. The pack script keeps working against rt-written files: its
`read_fresh` and `status` read the same fields, and it refuses a fresh
`doctor` lease as before. Its own same-role takeover bug is unchanged until the
follow-up retires it.

### Operations

All take `(mrUrl, owner, now)` plus options; the iid comes from the URL's
trailing number (a URL without one is refused).

- `readCiLease(mrUrl, now)`: the fresh lease or null. Missing, malformed and
  stale all read as null. Also returns whether a stale lease is on disk, for
  reporting.
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
  `{ok: false, reason: "lost", holder}` or `"none"`.
- `releaseCiLease(mrUrl, owner)`: deletes the file only when it names this
  owner; otherwise a no-op that says why.

### Compare-and-set

A claim with no file is an exclusive create (`link` of a written temp file, the
same trick the script uses), so two first claimers cannot both win. Every
read-modify-write (claim over an existing file, heartbeat, release) runs under
a per-MR lock file `<slug>-<iid>.lock`, taken with an exclusive create and
removed after the write. A lock older than 10 seconds is broken by renaming it
aside (only one breaker's rename succeeds) and retrying. Inside the lock the
lease file is re-read, the rule applied, and the result written to a temp file
and renamed into place. The lock name does not end in `.json`, so the board's
branch scan never reads it. The pack script does not take the lock; that is
acceptable only because it is being retired.

### Owner tokens

- MCP tools: `session:<CLAUDE_CODE_SESSION_ID>` from the server's env. A call
  with no session id is refused (no identity, no lease). The tools take no
  owner input, so a caller can only ever write its own lease.
  `sessionLabel` is the chat handle when the session is signed in.
- CLI (`rt ci lease ...`): the same token when `CLAUDE_CODE_SESSION_ID` is set,
  else `user:<login>` for a human at a terminal.
- Board doctor: `board:doctor:<doctor state handle>`, stable across cron
  passes so each pass can heartbeat and release what an earlier pass claimed.

## 2. Pipeline sha and ref (`packages/glance`)

`Pipeline` gains `sha: string | null` and `ref: string | null`.

- GitLab: add `sha ref` to both `headPipeline` selections (dashboard and list
  fragments) and to `GQLPipeline`; `toPipeline` copies them. Downstream
  pipelines fill them when GitLab returns them, else null.
- GitHub: `sha` is the check runs' `head_sha`, `ref` is the PR's head ref.
- `glance` dist is rebuilt and its freshness confirmed, and `rt-client` dist
  after it, as AGENTS.md requires.

`mr_pipeline`'s result gains `pipeline.sha` and `pipeline.ref` with no other
change.

## 3. `ci_watch` (`lib/mcp/ci-tools.ts`)

Input: the MR target (`repoName` + `iid`, or `mrUrl`, as the `mr_*` tools
take), `sha` (the pushed commit, 7 to 40 hex), `maxWaitSeconds` (default 600,
cap 1800), `intervalSeconds` (default 30, floor 10), `leaseless` (default
false). It works wherever `mr_pipeline` does.

Loop, one iteration per interval until a result or `maxWaitSeconds`:

1. Unless `leaseless`, heartbeat the caller's lease on this MR. When the caller
   does not hold it, return `state: "lease_lost"` with the holder. A watcher
   that lost the lease learns it on its next call.
2. Read the MR live from the daemon's cache (the `mr_pipeline` path, small
   `maxAgeMs`).
3. If the MR's head sha is not `sha` (a newer push landed), return
   `superseded` with the new head sha.
4. If the head pipeline is missing or its `sha` is not `sha`, keep polling
   (`waiting`): this is the fix for the false green on a fresh push.
5. If the pipeline status is terminal (`success`, `success_with_warnings`,
   `failed`, `canceled`, `skipped`, `manual`), return it.

On timeout it returns the last seen state (`waiting` or `running`) so the
caller calls again.

Result (triage-ready, forge detail only; REAL or INFRA classification stays in
the pack's domain):

```
{ state, sha, headSha,
  pipeline: { id, status, sha, ref, webUrl, createdAt } | null,
  failedJobs: [{ jobId, name, stage, allowFailure, webUrl, traceTail? }],
  blockingFailures: <count of failed jobs without allowFailure>,
  lease: { owner, heartbeatAt, expiresAt } | null,
  waitedSeconds, polls, next }
```

On a terminal `failed`, the first five blocking failed jobs carry
`traceTail` (last 40 lines, ANSI stripped, the `mr_job_trace` tail helper).
When the cached pipeline was written at list weight and has no jobs, the watch
fetches the full MR once before reporting failures. `next` is a one-line hint
("call again", "claim the lease", "read more with mr_job_trace").

The result goes through `callTool`'s redaction like every tool.

## 4. MCP lease tools (`lib/mcp/ci-tools.ts`)

`ci_lease_claim`, `ci_lease_heartbeat`, `ci_lease_release`, `ci_lease_read`.
Input: `mrUrl` (required; the lease is forge-agnostic and needs no daemon),
plus for claim `holder` (`watch-ci` default, or `doctor`), `branch`,
`ttlSeconds` (60 to 3600). Owner and label come from the env as above. Results
are the operation's return shape as JSON; a refusal is an ordinary result
(`{claimed: false, holder}`), not a tool error, so the agent branches on it.

With `ci_watch`, a watch-ci stage or a doctor does claim, watch (which
heartbeats), fix, heartbeat, release with no Bash rt call.

## 5. CLI and lint

A new `ci` group: `rt ci lease claim|heartbeat|release|show <mr-url>` and
`rt ci watch <mr-url> --sha <sha>`, each with `--json`, registered in
`lib/module-registry.ts`, with `omitBehavior: { exempt }` (a free-text URL).
They are not `agentSafe`: the MCP tools cover them, and each tool's
`shellForms` names its verb (`rt ci lease claim`, and so on), so
`deriveRules` flags the Bash form in skill text. A test asserts the strict lint
flags each form.

## 6. Board (`apps/board`)

- `src/triage/attendant.ts` becomes a thin re-export of the rt-client lease
  (keeping `readLeaseByBranch`, which moves into rt-client too), so there is one
  implementation.
- `runTriage`'s auto-spawn claims the lease BEFORE launching the doctor, as
  holder `doctor` with the owner token above. A refused claim skips the edge as
  `attended` (so a live watch-ci lease, now kept fresh by heartbeats, blocks the
  doctor). A failed launch releases the claim. This closes today's gap where the
  board launched first and claimed after.
- The per-pass heartbeat and release loop keeps its role, using the owner
  token.
- The manual `/doctor` route is unchanged (out of scope).

## 7. Testing and verification

- rt-client unit tests: every claim rule, legacy-lease reads, heartbeat and
  release ownership, the CAS race (many concurrent claimers in child processes,
  exactly one wins), lock breaking, and a golden file the pack script's `jq`
  filters can read.
- glance tests for `sha` and `ref` in both providers; an `mr_pipeline` test.
- `ci_watch` tests with fake deps: `waiting` on a stale sha (the false-green
  case), `superseded`, each terminal state, `lease_lost`, timeout returning
  `running`, trace tails on failure.
- Board triage tests: claim-before-launch, refusal skips, launch failure
  releases.
- A lint test that each new verb's Bash form is flagged under strict.
- A describe-only test that the claim, watch, heartbeat, release flow resolves
  to MCP tools with no Bash rt call.
- Manual end-to-end under an isolated HOME: a second claim on a held MR is
  refused, and a lapsed heartbeat can be taken over.
- `bun run test`, board tests, `bunx tsc --noEmit`, `bun run picker:check`,
  `bash scripts/repo-purity.sh`, `rt mcp tools --json` lists the five tools.

## Docs

`docs/ci-attendant-lease.md`: the file format, owner tokens, claim rules and
the tools, for the follow-up that retires the pack scripts.
