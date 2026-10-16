# MR composite tools

Wave 1 of the digraph-to-MCP herd. Code and tests only: no skill edits, which
come in wave 3.

## Why

The review and forge skills draw outward-action bookkeeping in dot:
- the posted-already test, the push guard, reply/resolve with retry-once, the
  respond-post record and the hold field;
- the hand join of MRs to worktrees;
- the 200-row ticket scans;
- the sleep-20 rebase poll.

That text costs words in every compiled verb, and it is where agents drift:
- double posts;
- a "Fixed" reply with nothing pushed;
- pushes from the shell;
- thread keys mapped by position;
- picks acted on under Hold.

This lane moves those mechanics into MCP tools. The tools return results and
the skills keep the gates. Recon lives with the herd:
- `00-SYNTHESIS.md`, `03-review.md` (C1 and C2), `04-forge.md` (C5 and C8);
- `07-board.md` (C6 and C9).

## Goals

- `respond_post_execute`: receive-review's whole post side in one call. It
  acts only on what a gate recorded.
- `mr_posted_since`: one mechanical answer to "has this run or reviewer
  already posted here". receive-review, review and board-review all ask it.
- `mr_threads {filter: "unresolved-human"}`: the human-threads-only filter,
  with the bot rule decided in code.
- `mr_create {ifExists: "return"}`: return the open MR on the source branch
  instead of failing.
- `mr_map` extensions that replace map-open-mrs.
- `mr_rebase {wait: true}`: replaces the sleep-20 poll.
- `mr_resolve_branch`: an MR URL or iid to its branch and tree, for checkout.
- `mr_view`: drop the ignored `maxAgeMs`.

## Non-goals

- No skill text changes (wave 3), and no plugin skill edits.
- No GitHub support in any `mr_*` tool. Each new tool says what it does on
  GitHub (below).
- Not `mr_retry`'s `leaseMrUrl` (the ci-tools lane), and not `mr_upload` (the
  wave 2 evidence lane).
- No change to how gate decisions are recorded (the gate-tools lane), to the
  run store schema (the run-engine lane), or to `git_push` (the git-guards
  lane). This lane calls them.
- No ticket-id resolution in `mr_resolve_branch`. checkout's ticket scan
  stays in the skill this wave.

## Anti-goals

- A tool that pushes, posts or resolves from caller-supplied picks. That
  would be a way around the human gate.
- A tool that opens a gate, acts on a spent budget, or picks an answer.
- Hiding an outward move from the graph without a recorded human decision
  behind it. `respond_post_execute` is the one composite that pushes and
  posts, and only on a recorded decision.

## Constraints

- **Write fence:**
  - `lib/mcp/mr-read-tools.ts`, `lib/mcp/mr-target.ts`,
    `lib/mcp/forge-read-tools.ts`, a new `lib/mcp/mr-composite-tools.ts`;
  - the MR write handlers in `lib/mcp/tools.ts`, with their registration as
    one contiguous block;
  - `lib/mr-map.ts`, and the `__tests__` beside all of these;
  - this spec and its plan.
- **Herd-wide ruling:** this PR regenerates
  `plugins/mattstack/attachments/mcp-tools/reference.md` and bumps the patch
  version in `plugins/mattstack/.claude-plugin/plugin.json`. It changes only
  the generated file and the version line.
- Every result passes through `callTool`'s redaction. No tool answers around
  it.
- Run-db access goes through the existing run tools' handlers (`run_snapshot`,
  `run_decision`, `run_field_set` from `runToolDefs`). That reuses their
  runDb confinement and env handling, with no edit to `run-tools.ts`. The
  run-engine lane confirmed: no decisions-table change (it still upserts on
  run, contract and scope), `hold` keeps its meaning, and the snapshot gains
  only additive keys.
- The gate-tools lane's contract, which this lane codes against:
  - When a skill opens a gate with a runDb, `gate_open` stores the untrimmed
    source as field `extra.gate-source.<scope>`, as JSON
    `{"gate": "<gate id>" | null, "source": {context, questions}}`. Each
    open overwrites it, so it always names the latest gate on the scope.
  - `gate: null` is the hand-back path, where a board opens the gate itself.
  - A gate@1 decision on a scope counts only when its `decided_at` is at or
    after a threshold. The threshold is the registry row's `openedAt` when the
    field names a gate, else the field's own `at`. This copies gate-tools'
    `decisionForGate` rule until that PR lands.
  - The registry row is the truth for an answer. It is read by id with
    `gate:wait {id, waitMs: 0}`.
  - A reply body is the answer's `text` when the human edited it, else the
    card's text: `reply@1.text` for a respond-post card, or
    `thread@1.reply.text` (kind `verbatim`) for a respond-plan card.
- **Token identity:** "this account" is the token's own user. It is read
  through the existing `forge:get` with path `user`, so the daemon needs no
  change.

## What each tool does

### `respond_post_execute {runDb, tree, stage}`

The post side of receive-review. `tree` is the worktree root it pushes from.
`stage` is the stage the `hold` field is written under.

**Reads.** Everything comes from the run, never from the call:
- The `mr` field gives the target. A GitHub PR URL is refused (see GitHub).
- The `branch` field gives the expected source branch, else the MR's own
  `sourceBranch`.
- `run.started_at`, and the respond-plan decision's `decided_at` (less a
  one-minute grace for clock skew between this machine and GitLab).
- The gate@1 decisions `respond-plan` and `respond-post`.
- The fields `extra.gate-source.respond-plan` and
  `extra.gate-source.respond-post`.

**Which decisions it acts on:**
- `respond-plan` is required. It must be fresh against its gate-source field
  by the threshold rule.
- `respond-post` is required when a `respond-post` gate-source field exists
  that was written after the respond-plan decision. That means something was
  offered this round. It must also be fresh against that field. No such field
  means nothing was offered, and only the plan's reply rows act.
- When a gate-source field names a gate, the tool reads that registry row. It
  refuses before any outward move when any of these holds:
  - the row is not `answered`;
  - its `next` answer (when the open has one) is not `proceed`;
  - the recorded decision's picks differ from the registry answer's picks
    (each `post:`/`resolve:`/verb value and each `text`, keyed by the thread
    id in the option value, never by `thread-<n>`).

  A `gate: null` source (hand-back) has no registry row, so the recorded
  decision is the answer, as gate-tools specifies.
- **Who writes what first.** The skill calls gate-tools' `gate_record` right
  after each answer and before this tool runs. `gate_open` writes the
  gate-source field in both paths (`handBack: true` writes `gate: null`).
- **A run with no gate-source field is refused,** with an error naming
  `gate_open {runDb}`. That covers a `{plan}` or `{plan, post}` a caller
  collected without `gate_open`. Wave 3 moves every path onto `gate_open`.
  Until gate-tools merges nothing writes the field, so the tool refuses every
  run. That is the intended order: this PR can merge first and does nothing
  outward until then.
- **The respond-post selection needs one entry per offered thread.** Offered
  means the thread ids in the source's `post:`/`resolve:` option values. An
  empty-array answer is recorded as `{post: false, resolve: false}`, which is
  the skill's existing record rule. A missing entry is refused as a mismatch.
- **The retired shape is refused.** That is a selection with
  `replies`/`replies-<n>` or `disposition`, or one with no `threads` object.
  Honoring it would post every reply row the old shape left out.
- **No unseen words.** A reply row with no `texts[id]` posts the card text
  only when both checks pass:
  - the card's `reply.kind` is `verbatim`;
  - when the source names a gate, that text appears in the registry row's
    question context, i.e. the text the human was shown. A context the fit
    dropped fails this check.

  Failing either check means the skill should have made the thread an
  override. The whole call is refused before anything moves, naming the
  thread.

**What acts:**
- **Offered threads.** Each entry in the respond-post selection posts when it
  carries `post: true` and resolves when it carries `resolve: true`. Its body
  is the entry's `text`, else the card's `reply@1.text`.
- **Reply rows.** Each respond-plan `reply` thread that is not in `overrides`
  and not offered posts, and is never resolved. Its body is `texts[id]`, else
  the card's verbatim `reply.text`.
- A post pick with no body anywhere is refused before anything moves.

**Order and retries:**
1. **Posted-already read.** One `discussions:refresh` and one `forge:get user`.
   A thread carries this run's reply when either holds:
   - a note's body equals the reply due (trimmed, line endings normalized);
   - a note by the token's own user is dated at or after the later of
     `run.started_at` and the fresh respond-plan decision's `decided_at` less
     one minute (`decided_at` is this machine's clock, `createdAt` GitLab's,
     so the grace absorbs skew), so a reply this account left in an earlier
     review round does not count.

   A read error, or a thread GitLab no longer returns, holds every thread
   (kind `read`). Then nothing moves, no decision is recorded, and the hold
   field is set.
2. **Push.** Only when the picks post or resolve at least one fix row (a
   thread whose respond-plan verb is `fix`). The tree must pass
   `checkRegisteredTree`. An MR that is no longer `opened` (merged or closed)
   holds the picked fix rows (kind `mismatch`) with no git call, since a push
   would not reach it; reply rows still act. Two checks must both pass:
   - `git symbolic-ref` must name the expected branch;
   - `git rev-parse --abbrev-ref @{push}` must print `origin/<branch>`.

   Any other output, an error included, holds the picked fix rows (kind
   `mismatch`), with both outputs verbatim. Otherwise it calls `gitPush`
   (never force), retrying once. A second failure holds the picked fix rows
   (kind `push`), with git's error verbatim. Other threads still act.
   A failed MR read before the push holds the picked fix rows (kind `read`);
   reply rows still act.
3. **Replies.** Offered threads in their open order, then reply rows in plan
   order. Each step:
   - A held thread acts on nothing.
   - A thread that already carries the reply counts as `alreadyPosted`.
   - Otherwise `discussions:reply`. On an error it re-reads the thread; if
     the reply has landed it counts as posted, else it retries once. A second
     error holds the thread (kind `reply`, GitLab's text verbatim) and skips
     its resolve.
4. **Resolves.** A thread the read showed resolved counts as
   `alreadyResolved`. Otherwise `discussions:resolve`, retried once; a second
   error holds the thread (kind `resolve`).
5. **Record.** When a respond-post decision was acted on, it is re-recorded
   (an upsert on the same scope), keeping its `decidedBy`. The selection is
   unchanged except `held`, which lists the thread ids held this pass and is
   omitted when none were. With no respond-post decision there is no record,
   as the skill does today.
6. **Hold.** Any held thread sets `hold` = `held` under `stage`, with no
   `hold:<stage>:<attempt>` decision (no gate answered). It never clears
   `hold`; the skill's resume does.

**Returns:**
```
{mr, pushed: {branch} | null, posted: [id], alreadyPosted: [{threadId, noteId}],
 resolved: [id], alreadyResolved: [id],
 held: [{threadId, kind: read|mismatch|push|reply|resolve, error}],
 recorded: boolean, hold: "held" | null}
```

A refusal is an error. Nothing outward happened, so it is safe to fix and call
again. The refusals are:
- a missing or stale decision;
- a registry mismatch;
- a missing body, or a card that fails the unseen-words check;
- the retired shape;
- an unregistered tree when a push is due;
- a GitHub MR.

**A held resume.** When the respond-post record already carries `held`, the
tool acts only on those threads, as the skill does today. Every other thread
counts as done. A push is due only when a held thread is a fix row. The
re-recorded `held` replaces the old list with the threads still held. A
re-run is also safe on its own terms: the posted-already read finds posted
threads, and resolved threads are found by their state.

### `mr_posted_since {repoName | mrUrl, iid, since, by?, threads?, items?}`

`since` is epoch milliseconds or an ISO time. `by` defaults to `"me"`, which
is the token's user from `forge:get user`. It makes one `discussions:refresh`.
- **`threads: [{discussionId, body?}]`** (receive-review). Posted when the
  discussion has a note whose body equals `body`, or a note by `by` after
  `since`. Each row returns `{discussionId, found, posted, noteId, via:
  "body" | "author" | null}`. `found: false` means GitLab no longer returns
  the discussion.
- **`items: [{id, body?, contains?, path?, line?}]`** (review, board-review).
  Posted when a note by `by` after `since` matches:
  - its body equals `body`, or contains `contains`;
  - and, when `path` or `line` is given, the note's new-side position
    matches.

  Each row returns `{id, posted, noteId, discussionId}`.
- It always returns `notes`: every non-system note by `by` after `since`
  (`noteId`, `discussionId`, `createdAt`, `path`, `line`, and `body` cut at
  2000 characters). The skill can judge an `unmatched` item from the notes
  instead of re-reading.
- It returns `{by, since, threads, items, notes}`, posts nothing, and judges
  nothing beyond the match.

### `mr_threads {..., filter: "unresolved-human"}`

`filter` is an optional new value. It keeps discussions that are not
resolved and whose first note is not a system note and is not by a bot.
Inside a kept discussion, system notes are dropped. Non-resolvable human
comments are kept, flagged by their own `resolvable`.

The body adds `dropped: {resolved, system, bot}` counts. Without `filter`
the result is unchanged.

**The bot rule** (decided by the shepherd through `herd_ask`): a discussion
is a bot's when its first note's author username, case-insensitive, matches
any of these:
- `project_<n>_bot...` or `group_<n>_bot...` (GitLab access-token bots);
- `ghost`;
- a name ending in `bot` right after a `-` or `_` (`renovate-bot`,
  `danger_bot`);
- a name ending in `[bot]`.

The rule reads usernames only and makes no extra GitLab reads. A bot whose
name looks ordinary passes as human. That is the accepted cost.

### `mr_create {..., ifExists: "return"}`

With `ifExists: "return"` it reads `mr:live-by-branch` for `sourceBranch`
first:
- If an open MR exists, it returns `{iid, url, existing: true, targetBranch,
  draft, title}` and creates nothing. Title, description, labels and squash
  are not applied, and the result says so.
- If none exists, it creates as today and adds `existing: false`.
- If the create fails because GitLab says an open MR already exists (a race),
  it reads once more and returns that MR.
- If the lookup errors, it errors and never creates blind.

Without `ifExists`, behavior is unchanged.

### `mr_map {repoName, author?}`

Replaces map-open-mrs.
- `repoName` is resolved through `resolveRepoTarget`, like every other tool.
  The legacy `repo` is still accepted for one release (refused alongside
  `repoName`), and the private `resolveRepoIdentity` helper in `tools.ts`
  goes away.
- **Source moves from the daemon's synced cache to a live
  `mr:list-live`** (state opened, limit 200, `author` passed through, `"me"`
  allowed). `complete` is `!truncated`. The cache is still read
  best-effort, only for `ciStatus`, which is null when the cache lacks the MR.
- Each row:
  ```
  {ref, iid, title, author, sourceBranch, targetBranch, draft, stacked,
   worktree: path | null, dirty: boolean | null, mrState, ciStatus}
  ```
  - `stacked` is `targetBranch` not equal to the project's default branch,
    from one `forge:get projects/:id`. It is null when that read fails.
  - `dirty` comes from a live `git status --porcelain` per joined tree, in
    parallel. It is null with no tree or on a git error.
- The join keeps today's exact branch equality.

### `mr_rebase {..., wait?: true, maxWaitSeconds?}`

Without `wait`, it is unchanged. With `wait` it:
1. reads the MR (the sha before the rebase);
2. asks for the rebase;
3. polls `mr:get` every 5 seconds, sending a progress ping and honoring the
   abort signal, up to `maxWaitSeconds` (default 90, maximum 600).

The result is one of:
- `{status: "rebased", sha, previousSha}` when the sha moved;
- `{status: "failed", mergeError, conflicts, sha}` when GitLab reports a
  merge error, or conflicts with an unchanged sha once no rebase is in
  progress;
- `{status: "current", sha}` when the sha is unchanged, nothing is in
  progress and `divergedCommitsCount` is 0;
- `{status: "unchanged", sha}` when `divergedCommitsCount` is null and two
  polls in a row show the same sha, nothing in progress and no error. GitLab
  finished without a move, but rt cannot tell whether the branch was already
  current.
- `{status: "pending", sha, rebaseInProgress, lastError?}` when the budget
  ran out.

A poll error counts as a poll.

### `mr_resolve_branch {repoName | mrUrl, iid}`

It reads `mr:get` and `worktree:list`, and returns:
```
{iid, state, title, author, sourceBranch, targetBranch, webUrl,
 trees: [{name, path}]}
```
`trees` holds the registered trees whose branch is exactly the source branch:
usually zero or one, and more only for a duplicate branch. It never provisions
a tree; checkout still calls `worktree_provision`.

### `mr_view`

`maxAgeMs` leaves the schema and the handler.
- Claude Code passes undeclared arguments through, as checked on this
  session's `whoami`, and no handler rejects unknown keys. So the 22 board
  doctor calls that still pass `maxAgeMs: 5000` keep working until wave 3
  deletes them.
- `mr_list` and `mr_pipeline` keep their own `maxAgeMs`. `mr_list` still
  uses it for the legacy stack read.

## GitHub

Every `mr_*` tool stays GitLab-only. Each new or changed tool resolves the
identity first. A `github.com` host, or a `github.com/.../pull/<n>` URL in a
run's `mr` field, is refused up front with a GitHub-specific error that names
the `gh` move the skill keeps drawing:

| Tool | On GitHub |
|---|---|
| `respond_post_execute` | refuses; the skill keeps its `gh` reply/resolve boxes |
| `mr_posted_since` | refuses; read threads with `gh` |
| `mr_threads` filter | unchanged (GitLab-only today) |
| `mr_create` ifExists | refuses; `gh pr create` / `gh pr view` |
| `mr_map` | refuses; `gh pr list --author @me` and the worktree list |
| `mr_rebase` wait | refuses; no server-side rebase on GitHub |
| `mr_resolve_branch` | refuses; `gh pr view <n> --json headRefName` |

Today a GitHub repo falls through to a GitLab REST error. The up-front refusal
replaces that in the new paths only.

## Left to the builder

- Module layout inside `lib/mcp/mr-composite-tools.ts`, with a deps seam
  (`command`, `git`, `sleep`, run tools, gate read) so every path is unit
  tested without a daemon.
- Whether `mr_create` and `mr_rebase` stay in `tools.ts` (edited in place,
  calling helpers in the new file) or move. **My call:** they stay in place to
  keep the diff away from the ci-tools and evidence lanes' handlers. `mr_map`
  moves into the new file.
- Error wording, kept to the output-layer copy rules.

## My calls (flagged for review)

- `respond_post_execute` cross-checks the registry answer whenever a gate id
  exists, and refuses on any mismatch. That is defense in depth beyond the
  run-db read the brief names.
- "Nothing offered" is judged by whether a respond-post gate-source field is
  newer than the respond-plan decision.
- `mr_map` reads live, so the rule file's "mr_map reads the synced list"
  sentence goes stale. That file is outside this fence, so it is flagged to
  the shepherd for a follow-up.
- Non-resolvable human comments survive the human filter.
- A run with no gate-source field is refused. There is no fallback to an
  unchecked decision.
- A held resume acts only on the held threads, following the skill.
- The retired respond-post shape is refused.
- `mr_rebase` has an `unchanged` status for when `divergedCommitsCount` is
  null.

## Behaviour changes

**Changes to existing tools**

- `mr_view` no longer declares `maxAgeMs`. A caller that still passes it is not refused, since undeclared keys pass through, and nothing is sent.
- `mr_map` reads live (`mr:list-live`, open MRs, every author unless `author` is passed, up to 200) instead of the daemon's synced list. Rows gain author, targetBranch, stacked, dirty and ciStatus. The result is `{rows, complete}`. Input is `repoName`; legacy `repo` is still accepted, and both together are refused.
- `mr_create` and `mr_rebase` are unchanged unless the new `ifExists` or `wait` is passed. On those new paths only, a GitHub target refuses with the gh move. `maxWaitSeconds` without `wait: true` refuses.
- `mr_threads` is unchanged unless `filter` is passed.

**Decisions made during the build, beyond the text above** (each refuses unless noted)

- `respond_post_execute` refuses a respond-plan answered `revise`, and refuses an offered fix row unless code-changes is `approve`.
- Before a push, HEAD, `@{push}` and `@{u}` must all name `origin/<branch>`, and the pushed upstream is re-checked after. A branch with no upstream holds as `mismatch` with a `git_push {setUpstream: true}` remedy.
- The run's branch must equal the MR's source branch, and `tree` must be a checkout of the MR's repo.
- A fix push to an MR that is not open holds the fix rows as `mismatch`. Reply rows still act.
- A failed pre-push MR read holds only the fix rows (kind `read`). Reply rows still act.
- The author posted-already rule is anchored at the later of the run start and the respond-plan decision time minus one minute, so an earlier review round's own reply does not swallow this round's.
- The shown-text check matches the card's rendered marker line (`Will post as reply:` or the REPLY or FIX line), not any substring of the context.
- A respond-post gate source older than the respond-plan decision is not read from the registry.
- A gate the registry no longer holds refuses, naming `gate_open`. Failed run-db writes come back in `writeErrors`.
- `mr_rebase {wait}` counts a merge error as `failed` only when no rebase is running, and also stops at a wall-clock deadline.
