# Agent GitLab reads go to GitLab, not the daemon cache

## Goal

An agent walking a mattstack skill can read whatever it needs from GitLab
through a tool on the mattstack MCP server, with no permission dialog and
no dependence on what the daemon happens to have cached. When GitLab
refuses or has nothing, the agent gets GitLab's own answer.

Success looks like this: a review of a teammate's MR, a checkout by
ticket id, a CI triage on a pipeline with eight failures, and a ship from
a stacked branch all run to their normal end without a hold, a "which
branch?" question, or a reach for the GitLab CLI.

## Why today fails

The tools were moved off Bash to skip the auto-mode classifier
(`2026-09-25-mcp-tools-over-bash-design.md`). That spec never asked for a
restriction on what agents may read. Three things added one anyway:

- **The read tools answer from the board's cache.** `mr_view`, plain
  `mr_list`, `mr_pipeline` and `ci_watch` read the daemon's open-MR store
  (`project-mrs:read`). A small `maxAgeMs` re-syncs it, but only for open
  MRs by the authors a board client demanded, inside a day window. An MR
  outside that set is "not found" however fresh the sync. glance's
  `fetchSingleMR` can fetch any MR, and no tool reaches it.
- **The skills turned a cache miss into a stop.** review records a hold
  ("rt's MR cache does not hold it"), checkout asks which branch,
  receive-review reports no open MR. The first of these arrived with the
  tool rewrite, the rest with the digraph conversion.
- **Nothing covers a fact the tools lack.** The start of a long job log,
  the project's labels, pipelines on a branch with no MR: no tool returns
  them, the pack rule says GitLab is read "only through rt's `mr_*`
  tools", and the off-script gate opens on a refused call, never on a
  missing fact.

The stack-parent check (fixed with a live `mr_list` by `targetBranch`) and
the child-pipeline failures in `ci_watch` were two instances of this.

## The rule

**Every agent-facing GitLab read on the mattstack server asks GitLab
through glance, never reads or writes the daemon's project-MRs store, and
returns GitLab's own error text when GitLab refuses.**

The cache stays what it is for: the board and the other surfaces. rt
decides nothing about which MRs an agent may fetch; GitLab's permissions
do.

One existing side effect stays: `mr_threads` runs the daemon's
`discussions:refresh`, which fetches from GitLab, stores the fetched
threads in the discussions store and tells the board. That is what
`refresh: true` does today, and it is not a read from a cache.

## Part 1: tools

All of these are daemon tools (the daemon holds the provider and token).
Each new or changed daemon command calls the glance provider directly, as
`mr:by-target` does today, and none calls `store().upsert`.

### Changed reads

| Tool | Today | After |
|---|---|---|
| `mr_view` | finds the iid in the open-MR store | fetches that MR (`fetchSingleMR`): any author, opened, merged or closed |
| `mr_pipeline` | head pipeline of the stored MR | head pipeline of the MR fetched live; `jobId` detail unchanged |
| `ci_watch` | each poll reads the stored MR | each poll fetches the MR live |
| `mr_list` | the store, filtered by state; live only with `targetBranch` | always live, with filters |
| `mr_for_branch` | store, then GitLab on a miss | GitLab only |
| `mr_threads` | stored discussions unless `refresh: true` | always fetches |

`mr_list` inputs: `author` (a username, or `me` for the authenticated
user), `sourceBranch`, `targetBranch`, `state` (default `opened`),
`search` (matches title and description, so a ticket id finds its MR) and
`limit` (default 50, maximum 200). Rows are ordered most recently updated
first. The result is `{mrs, truncated}`; `truncated` is true when GitLab
had more rows than `limit`. An unfiltered call returns the project's open
MRs up to the limit.

`ci_watch` already returns every failed job (`{jobId, name, stage,
allowFailure, webUrl}`) with a trace tail on the first five blocking
ones; that stays, pinned by a test, and its description says so plainly.
The only change is where it reads the MR. The watch's time limit and
budget are not touched.

`mr_job_trace` keeps `tailLines` and gains three ways to read the rest of
a log, one per call: `headLines` (the first N lines), `fromLine` with
`lineCount` (a range), and `grep` with `contextLines` (matching lines and
their neighbours, each with its line number). ANSI stripping and the
64 KiB cap apply to every mode. `totalLines` is always returned, so a
range can be chosen from a tail.

### Compatibility

Skills compiled before this change pass `maxAgeMs` to `mr_view`,
`mr_list` and `mr_pipeline`, and `refresh` to `mr_threads`. Both stay
accepted and are ignored, so installed packs keep working across the
tool release. They leave the schemas in a later cleanup once every pack
has recompiled. `mr_list`'s existing `{mrs, targetBranch, full: true}`
shape for a `targetBranch` call keeps `full: true` when `truncated` is
false.

One old caller depends on the shape of an unfiltered list:
rebase-worktree's manual stack check, as compiled today, calls `mr_list`
with only `maxAgeMs` and reads `syncedAt` to decide the read worked. A
50-row page of everyone's MRs could miss the branch's own MR and pass a
stacked branch as stack-free. So a call that carries `maxAgeMs` and no
filter is treated as that legacy call: it reads up to 200 open MRs, its
body carries `syncedAt` (the time of the read), and when GitLab has more
than 200 it fails with an error naming `sourceBranch` and `targetBranch`
instead of returning a partial list. The old skill then reports that the
stack check could not run, which is its safe path.

### New reads

- **`project_labels {repoName, search?}`**: the project's labels (name,
  description, color).
- **`pipeline_list {repoName, ref?, sha?, iid?, limit?}`**: pipelines for
  a branch, a commit or an MR, newest first, each with id, status, ref,
  sha, source and web URL. Works for a branch that has no MR.
- **`branch_stack {tree}`**: whether the tree's branch is a member of a
  tracked stack and, if so, its parent and root. In-process, over the
  gitq stack store that `lib/stack-guard.ts` already reads. It reads no
  forge.
- **`gitlab_get {repoName, path, query?, page?, perPage?}`**: the
  passthrough, below.

### The passthrough

`gitlab_get` exists so a fact with no purpose-built tool is still one
call away. It sends one GET through `provider.restRequest` and returns
the parsed JSON with GitLab's paging headers (`nextPage`, `totalPages`).

- **GET only.** The method is not an input.
- **Path** is relative to the API root. `:id` in the path is replaced
  with the target project, so `projects/:id/merge_requests/12/commits`
  works without the agent encoding a project path. A path naming another
  project or a group is allowed; GitLab decides access.
- **Size.** The response body is capped (256 KiB, counted in bytes while streaming) with `truncated: true`;
  paging is how an agent reads more.
- **Credential endpoints are refused.** The server runs on every estate
  machine with no permission check, and an agent may be reading untrusted
  MR text when it calls this. A GET of CI/CD variables returns secret
  values that `redact.ts` cannot recognise. The tool refuses path
  segments `variables`, `triggers`, `deploy_tokens`, `access_tokens`,
  `runners`, `hooks`, `secure_files`, `integrations`, `services`,
  `pipeline_schedules` (their variables carry values), `terraform`
  (raw state) and `application` (OAuth applications), at any depth,
  with an error naming the segment. A segment with a format suffix
  (`variables.json`) is refused as its base name, and a path
  percent-encoded more than once is refused. The query keys `sudo`,
  `private_token`, `access_token`, `job_token` and `bearer_token` are
  refused, including their bracketed forms. In any
  JSON it does return, a key named `token` or ending in `_token` (a
  project's `runners_token`, for one) has its value replaced with
  `[redacted]`. The path check also refuses dot segments, control
  characters, `?`, `#`, `://`, backslashes and malformed percent
  escapes. A redirect is never followed, because the token header
  would travel to the new host: the request asks the provider for
  manual redirect handling and any 3xx answer is refused, naming only
  the host of its `Location` (the full URL can carry a signed token).
  None of this is about which MRs or projects are readable;
  GitLab decides that.
- Results pass through `callTool` redaction like every other tool.

### What goes with the tools

- `shellForms`: the `glab api` catch-all note names `gitlab_get`; the
  strict lint is unchanged otherwise.
- `plugins/mattstack/attachments/mcp-tools/reference.md` is regenerated,
  and the plugin version bumps.
- `AGENTS.md`'s "Gates and the `rt_verb` MCP tool" section and the rt.cool
  MCP reference stop describing the read tools as cache readers.

## Part 2: engine skills

Every edit here loads `superpowers:writing-skills`,
`mattstack:editing-skills` and `mattstack:process-digraphs` first, and a
subagent doing the edit is told to load the same three.

- **review.** The edges "not found: hold, rt's MR cache does not hold it"
  and "null: hold" go. `mr_view` has two outcomes: the MR, or GitLab's
  error, which is reported as the reason on the existing hold or clarify
  path. The STOP "never read the MR with the GitLab CLI; hold the review
  instead" becomes a guard that redirects to `mr_view`.
- **checkout.** A ticket id resolves with `mr_list {search}`; the "cache
  may not hold every MR: an empty result means ask" text goes. Several
  matches or none still open the existing clarify gate.
- **receive-review.** A null `mr_for_branch` entry means GitLab has no
  open MR for the branch; the wording about rt's cache goes.
- **rebase-worktree.** The manual stack guard calls `mr_list` with
  `sourceBranch` and with `targetBranch`; the `scope` caveat and the
  "stack check covered <scope> only" line go, since the read is no longer
  scoped. "Read synced?" becomes "Read succeeded?".
- **map-open-mrs.** `mr_list {author: me}`; the cache caveat and the
  "never guess a username" filter go.
- **ship (standalone) and stage-ship.** Before `mr_create`, `branch_stack
  {tree}` decides the target: the stack parent for a member, the default
  branch otherwise.
- **watch-ci and stage-watch-ci.** Triage reads `failedJobs` for every
  failure and pulls a trace with `mr_job_trace` for any job past the
  first five; the "the rest are unclassified, so the red is not INFRA
  only" rule goes.
- **Missing-fact route.** Each graph that reads GitLab (review, checkout,
  receive-review, ship, stage-ship, watch-ci, stage-watch-ci,
  rebase-worktree, stage-evidence) gains one edge: a GitLab fact no
  listed tool returns goes to a `gitlab_get {repoName, path}` node and
  back to the node that needed it.
- **Read STOPs.** The STOPs that guard GitLab reads stay and are reworded
  to redirect to "the `mr_*` tools or `gitlab_get`". Every STOP on a
  write is unchanged.

The gate-protocol attachment is not edited, so `apps/board/skills` needs
no re-expand for that reason; the board's compiled skills are re-expanded
if any engine they inline changes.

## Part 3: acme pack

In `acme-tools` (`mattstack/packs/acme`): the `context` skill
and `ship-domain` replace "Read and write GitLab only through rt's
`mr_*` MCP tools" with a rule that writes go through the `mr_*` tools and
reads go through the mattstack server's GitLab read tools, `gitlab_get`
included. `ship-domain` checks preview label names with `project_labels`.
The pack recompiles against the new engine and its version bumps. No
mattstack ticket id appears in that repo.

## Part 4: Matt's own instructions

`~/work/acme/CLAUDE.md`, "GitLab operations": MR and CI
reads use the mattstack server's read tools; the `glab` command list
goes.

## Sequencing

1. Tools, in one rt release. Old argument names keep working, so nothing
   installed breaks.
2. Engine skills, compiled and certified against the released tools.
3. The acme pack, recompiled against the new engine.
4. Matt's `CLAUDE.md`.

The watch budget setting is already on `main`; this branch is rebased on
it, and the `ci_watch` change leaves the budget inputs alone.

## Testing

- **Tools.** Each changed handler is unit-tested with a fake provider and
  a write-back that throws: the read returns the provider's MR for an
  author outside any demand, for a merged MR and for a closed MR; the
  project-MRs store is never written; a provider 403 and 404 come back
  as GitLab's text.
  `gitlab_get` has one test per refused segment, one for `:id`
  substitution, one for the size cap and one proving no method but GET is
  reachable. `mr_job_trace` has a test per read mode. `mr_list` is tested
  per filter and at the truncation boundary.
- **Compatibility.** A test calls each changed tool with the old
  arguments and gets a result.
- **End to end.** `e2e/tests/mcp-serve.test.ts` gains the new tools in
  the roster and one call each over the real transport, against a target
  the test daemon does not know, proving each answers a tool error
  rather than failing the request.
- **Skills.** Before-and-after agent scenarios in the style of the
  earlier tool rewrite, run against the harness project: review of an MR
  by another author, review of a merged MR, checkout by ticket id of
  another author's MR, an MR GitLab refuses, CI triage with more than
  five failures, ship from a stacked branch, and one scenario that needs
  a fact only `gitlab_get` returns. Before: the hold, question or stall
  recorded today. After: the run reaches its normal end.
- `rt skills check --strict` and certify pass on the edited plugin.

## Out of scope

- GitHub paths, which already use the GitHub CLI directly.
- The board's cache: its scope, demands, sync and pruning.
- Every write tool.
- The watch time limit and retry budget.
- `the team repo AGENTS.md`, which is the team's file.
- The `glab` read rules in `settings.json`.
- Job artifacts, issues and merged-MR history as purpose-built tools;
  `gitlab_get` covers them until a skill needs one routinely.
