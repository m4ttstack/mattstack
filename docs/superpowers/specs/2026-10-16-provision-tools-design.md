# Provision tools: structured codes, precheck, reuse and run recording on `worktree_provision`

## Why

The provision stage and both team provision fills carry mechanics in
English that rt can do in code:

- **An error catalog.** `worktree_provision` flattens the daemon's refusal
  codes to prose through `explainError` (`lib/mcp/shared.ts` `fromResponse`),
  so each fill keeps a copy of that prose and maps it back to graph edges
  ("`branch is already checked out in worktree "<tree>"` is the gate edge").
  The copy drifts whenever `lib/explain-error.ts` is reworded.
- **A branch pre-check.** Each fill runs `rt_verb {worktree list}` and
  matches trees whose branch starts with `<ticket-id>-` by hand, with its own
  retry budget and `precheck_refused` question. The pre-check exists because
  a ticket-mode provision never refuses an occupied branch: it silently
  disambiguates to `<branch>-2` (`disambiguate` in
  `lib/worktree/branch-name.ts`). Both fills also claim "worktree_provision
  reports any duplicate itself", which is false in ticket mode.
- **Resume in an existing tree.** A branch-mode provision refuses with
  `branch-attached:<tree>`; callers that want that tree (the pipeline's
  "resume in `<tree>`" answer, the checkout verb) then look it up again with
  `git worktree list`.
- **Run bookkeeping.** After a provision the stage writes `branch` and
  `worktree` with two `run_field_set` calls it can forget.
- **Retry counters in prose.** "Pre-check retries this stage pass = 2?" is
  agent memory, which resets on compaction.

This is wave 2 of the digraph-to-MCP work (recon candidate C5). It changes
code and tests only; wave 3 rewrites the skills to use it.

## Goals

1. `worktree_provision` returns the daemon's refusal code as data:
   `{kind: "refused", code, error, tree?, step?, detail?}`, `code` being the
   daemon's own (`branch-attached`, `busy`, `create-failed`, ...), `error`
   the same prose `explainError` gives today.
2. `worktree_provision {precheck: true}` reports, without touching any tree,
   the branch a provision would use and every tree already on it, on the
   ticket, or on the ticket and slug. It replaces the fills'
   `rt_verb worktree list` pre-check.
3. `worktree_provision {reuse: true}` returns the one tree already on the
   branch (`kind: "reused"`) instead of refusing or disambiguating.
4. `worktree_provision {runDb}` writes `branch` and `worktree` on the run
   when it provisions or reuses a tree.
5. `worktree_provision {runDb, budget: {key, limit}}` charges one unit of a
   persisted run budget on each refusal and returns the counter, through
   run-engine's `run_budget` (PR #843) when that tool exists, and works
   unchanged when it does not.

## Non-goals

- No skill edits (wave 3). The only plugin files this PR touches are the
  generated `plugins/mattstack/attachments/mcp-tools/reference.md` and the
  `.claude-plugin/plugin.json` version line.
- No new MCP tool. Every change is an option on `worktree_provision`, so the
  roster (`EXPECTED_TOOL_NAMES`, `lib/mcp/tools.ts`) does not change.
- No CLI changes. `rt worktree provision` keeps its flags and output.
- No change to `worktree_dispose` or `worktree_stop_holders` results.
- Worker mode's "adopt `$PWD`" path and the plain-branch fallback
  (`branch_create`) from recon C5 stay out; they are not in this lane's
  scope.
- No change to the daemon's error strings. Hooks, the CLI and the daemon's
  own retries match on them (`.claude/rules/output-layer.md`).

## Anti-goals

- **A tool that gates or acts on a budget.** A refusal, a pre-check match
  or a spent budget comes back as data; the skill's graph routes it.
  `worktree_provision` never refuses because a budget is spent, and never
  writes `hold`, `gate` or a decision.
- **A pre-check that can claim a tree.** `precheck: true` must be read-only
  even against a daemon that predates it.
- **Reuse that takes a tree over.** Reuse never re-claims, re-owns or
  changes the disposal mode of the tree it returns.
- **A failed run write that loses a tree.** A provisioned tree is returned
  even when recording it on the run fails.

## Design

### Result shape

Every daemon outcome is an ok tool result with a `kind`, the precedent set
by `branch_sync` (PR #842). Only a caller mistake (a missing or wrong-typed
input, an ambiguous `repoName` label, `precheck` with `reuse`, `budget`
without `runDb`, a `runDb` outside the runs root) stays an `isError` result.

| `kind` | Fields |
|---|---|
| `provisioned` | the daemon's `WorktreeProvisionData` unchanged (`tree`, `path`, `branch`, `wasOnDeck`, `readyAt`, `branchState`, `readyHeld`, `readyPending?`, `readySteps?`, `readyFailed?`, `failedStep?`, `hydratedFrom?`), plus `recorded`/`recordError` |
| `reused` | `tree`, `path`, `branch`, `treeKind`, `state?`, `owner?`, `disposal?`, plus `recorded`/`recordError` |
| `precheck` | `branch`, `base`, `attached`, `sameTicket`, `sameSlug` (below) |
| `refused` | `code`, `error`, and per code `tree`, `trees`, `step`, `detail`; plus `budget` when one was asked for |

*My call:* a refusal moves from `isError` text to an ok result. Compiled
skills read today's result by its words ("branch is already checked out",
"any other error"); `error` keeps exactly that prose, so they still route.
`kind` is the discriminant `branch_sync` uses; the tree's own registry kind
is `treeKind` so the two never clash.

### Refusal codes

The tool parses the daemon's error string; the daemon's strings stay as
they are. `error` is always `explainError(raw)`.

| Daemon error | `code` | Extra fields |
|---|---|---|
| `busy` | `busy` | |
| `repo-unknown` | `repo-unknown` | |
| `branch-unresolved` | `branch-unresolved` | |
| `branch-duplicated` | `branch-duplicated` | |
| `branch-attached:<tree>` | `branch-attached` | `tree` |
| `checkout-failed:<detail>` | `checkout-failed` | `detail` |
| `create-failed:<step>\n<tail>\n<note>` | `create-failed` | `step`, `detail` (tail and note) |
| `claim-write-failed`, `handoff-write-failed` | same | |
| `unsafe git ref ...` | `unsafe-ref` | `detail` |
| `rt daemon unreachable at ...` (rt-client transport) | `daemon-unreachable` | `detail` |
| `daemon at version ... does not know "..."` (`unknownCommandReply`) | `daemon-outdated` | `detail` |
| anything else | `error` | `detail` (the raw string) |

Repo resolution happens in the tool before the daemon is asked. A
`repoName` that matches no registered repo, or names a checkout of an
unregistered repo, is `refused` with `code: "repo-unknown"`, so the stage's
"repo not registered" edge and the daemon's `repo-unknown` read the same.
An ambiguous label stays an `isError` input mistake. *My call:* the tool
resolves with `tryResolveRepoArg` and `isRepoRegistered` directly (the
`repoName` half of `resolveRepoTarget`), since `lib/mcp/mr-target.ts`
returns only prose and sits outside this lane.

### Precheck: a new read-only daemon verb

`worktree_provision {repoName, ticket, ticketTitle?}` or `{repoName,
branch}` with `precheck: true` calls a new daemon verb,
`worktree:provision-check`, and returns `{kind: "precheck", ...}`.

*My call:* a separate verb, not a `precheck` flag on `worktree:provision`'s
payload. A daemon that predates the flag ignores unknown payload fields and
would provision a tree; an unknown verb is refused (`daemon-outdated`)
instead. It also keeps `Commands["worktree:provision"]["data"]` unchanged
for its four other callers.

The verb shares provision's step 1. Branch intent resolution (the explicit
branch, or `slugifyTicketTitle` plus `disambiguate` against local branches
and registered trees, then `validateGitRef`) moves into one helper that both
verbs call, so a pre-check and the provision after it can never disagree on
the branch. It runs no git write, no fetch and no lock.

Data (`WorktreeProvisionCheckData`):

- `branch`: the branch a provision called now would check out (after
  disambiguation).
- `base`: the branch before disambiguation: the explicit branch, or
  `slugifyTicketTitle(ticket, ticketTitle, format)` with trailing dashes
  trimmed.
- `attached`: registered trees whose branch is exactly `base`. Two or more
  is what provision calls `branch-duplicated`.
- `sameTicket` (ticket mode; empty in branch mode): registered trees whose
  branch belongs to the ticket. With the default `<ticket>-<slug>` format
  that is a branch starting with `<ticket-id>-` (lowercase), the fills' rule.
  Generally: the branch, lowercased, starts with the format's text before
  `<slug>` rendered with the ticket. *My call:* a format where `<slug>`
  comes first or `<ticket>` is missing has no ticket prefix, so the match
  falls back to the ticket id appearing in the branch as a whole token
  (bounded by the string's ends or a non-alphanumeric character).
- `sameSlug` (ticket mode with a non-empty title slug; empty otherwise):
  registered trees whose branch, lowercased, starts with `base`. This is
  the fills' re-check after a typed slug.

Each tree is `{tree, path, branch, treeKind, state?, owner?, disposal?,
claimedAt?}` from the registry. On-deck, creating and golden trees carry
rt-owned branches and so never match.

The skill decides what a match means (two or more `sameTicket` trees queue
the slug question; one `attached` tree is the resume question). The tool
never refuses on a match.

### Reuse

`reuse: true` (not with `precheck`) first calls `worktree:provision-check`:

- exactly one `attached` tree that is reusable: return `{kind: "reused",
  ...}` with no daemon write;
- exactly one `attached` tree that is not reusable: `refused`,
  `code: "branch-attached"`, `tree`, and `reason` (`main-checkout`,
  `disposable`, or the state);
- two or more: `refused`, `code: "branch-duplicated"`, `trees`;
- none: an ordinary `worktree:provision` call, whose own refusals stand.

Reusable means an `unmanaged` tree, or an `ephemeral` tree in state
`claimed`. *My call:* the main checkout is shared with other sessions and a
`disposable` tree can be disposed under the agent, so reuse refuses both
the way provision does today, and the skill's gate decides.

Without `reuse`, behavior is unchanged: branch mode refuses
`branch-attached`, ticket mode disambiguates. In ticket mode `reuse` matches
`base`, so a tree on `cv-12-fix-login` is reused instead of a new
`cv-12-fix-login-2` being cut. The check and the provision are two calls;
a tree that lands between them makes provision refuse or disambiguate as it
does today, which is safe.

`owner` and `disposal` are ignored when a tree is reused, as are they for
`precheck`. Reuse returns the tree's current `owner` and `disposal` so the
skill can see whose tree it is.

### Recording on the run

`runDb` (absolute, the value `run_start` returned) and `stage` (default
`provision`). When the outcome is `provisioned` or `reused`, the tool writes
`branch` = the result's branch, then `worktree` = the result's path, each
with that `stage`, and returns `recorded: true`. A write that fails stops
there and returns `recordError` (the run tool's message) beside the tree,
which is still the tool's ok result. Precheck and refused outcomes record
nothing.

*My call:* the writes go through the `run_field_set` handler from
`runToolDefs()`, not a direct DB write. That handler already confines a
`runDb` to the runs root (`checkRunDb`) and writes in-process through
`runWriteVerb`; reusing it keeps one confinement path and keeps
`lib/mcp/run-tools.ts` (outside this lane) untouched. `worktreeToolDefs`
gains a `runTools` dependency (default `runToolDefs()`) so tests inject
fakes. A `runDb` the confinement refuses is reported before the daemon is
asked, as an `isError` result, so a bad `runDb` never costs a tree.

### Retry budget through `run_budget`

`budget: {key, limit}` needs `runDb`. On a `refused` outcome the tool calls
`run_budget {runDb, key, limit, stage}` (increment 1, scoped to the stage's
latest attempt, so a new attempt starts at zero) and returns its body as
`budget`: `{key, spent, limit, remaining, exhausted}`. It is not charged on
success or on an `isError` input mistake.

`run_budget` is run-engine's tool (PR #843, unmerged), documented as
`{runDb|cwd, key, limit, increment?, stage?}` returning `{key, spent, limit,
remaining, exhausted}` and never refusing past its limit. The tool looks it
up by name in `runToolDefs()`:

- present: call it; a refusal from it (the stage has no row, a bad key)
  comes back as `budget: {error}`;
- absent (an rt without PR #843): `budget: {error: "run_budget is not
  available on this rt"}`.

So this PR merges before or after #843 with no follow-up change, and the
budget switches on when #843 lands. *My call:* wave 3 skills should read
`budget.error` as spent, so a missing counter can never loop a retry
forever; this is noted for wave 3, not enforced by the tool.

`precheck` with `runDb` is allowed (only `budget` uses it). `budget`
without `runDb` is an `isError` input mistake.

### Input schema

`worktree_provision` gains `precheck` (boolean), `reuse` (boolean),
`runDb` (string), `stage` (string), `budget` (object `{key: string, limit:
integer ≥ 1}`). The description is rewritten to name the four outcomes,
the refusal codes and each option, since `reference.md` is generated from
it.

### rt-client

`Commands` gains `"worktree:provision-check": {payload: {repoName, ticket?,
ticketTitle?, branch?}, data: WorktreeProvisionCheckData}` and
`COMMAND_NAMES` gains the name; `WorktreeProvisionCheckData` and the tree
ref type sit beside `WorktreeProvisionData`. `dist/` is rebuilt
(`.claude/rules/workspace-packages.md`).

## Where the code goes

- `lib/worktree/branch-name.ts`: pure ticket-match helpers (ticket head from
  the format, token fallback) beside `slugifyTicketTitle`.
- `lib/daemon/handlers/worktree.ts`: the shared intent helper, provision's
  step 1 calling it, and the `worktree:provision-check` handler.
- `packages/rt-client/src/commands.ts`: the verb's types and name; `dist`
  rebuild.
- `lib/mcp/worktree-tools.ts`: the code parser, the outcome shapes, repo
  resolution, precheck, reuse, recording and the budget call.
- Tests beside each: `lib/worktree/__tests__/`, `lib/daemon/__tests__/
  worktree-handlers.test.ts`, `lib/mcp/__tests__/worktree-tools.test.ts`.
- Generated: `plugins/mattstack/attachments/mcp-tools/reference.md`;
  `plugins/mattstack/.claude-plugin/plugin.json` takes the next patch above
  main's (0.31.8 or later).
- PR body: `engine-floor: unchanged <reason>` (no skill needs the new
  options until wave 3).

## Testing

- Pure helpers: ticket head for the default and custom formats, the token
  fallback, lowercase matching, `cv-1` not matching `cv-12-...`.
- Daemon: provision-check returns `branch`, `base`, `attached`,
  `sameTicket`, `sameSlug` against a temp registry and repo; it writes
  nothing to the registry and takes no lock; provision's step 1 behavior is
  unchanged (existing tests stay green).
- MCP tool, with an injected `command` and `runTools`:
  - each daemon error string maps to its `code` and fields, `error` equal to
    `explainError(raw)`;
  - an unregistered `repoName` is `refused` `repo-unknown` with no daemon
    call;
  - precheck calls only `worktree:provision-check`, never
    `worktree:provision`;
  - reuse returns `reused` with no provision call for a claimed or
    unmanaged tree, refuses a main checkout and a disposable tree, refuses
    two trees as `branch-duplicated`, and provisions when none;
  - `runDb` writes `branch` then `worktree` with the stage on `provisioned`
    and `reused`, nothing on `precheck` or `refused`; a failed write returns
    the tree with `recordError`; a refused `runDb` makes no daemon call;
  - `budget` charges on `refused` only, passes `stage`, returns the body;
    reports `{error}` when `run_budget` is absent or refuses; `budget`
    without `runDb` is an input error.
- `bun test lib/mcp/__tests__/worktree-tools.test.ts
  lib/mcp/__tests__/tools.test.ts`, `e2e/tests/mcp-serve.test.ts`,
  `bun run check`, `bun run purity`.

## Left to the builder

- Exact test names and fixture layout.
- The description wording, within the copy rules (`rt:ui-copy`).
- How the code parser and outcome builders are split into functions inside
  `worktree-tools.ts` (the lane may not add a module under `lib/mcp/`).
