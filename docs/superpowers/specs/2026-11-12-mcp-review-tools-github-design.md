# MCP review and comment tools: finish GitHub support

Tickets: RT-321, RT-557, RT-559 (project P-RT-28, GitHub parity).

## Intent

A board review or a receive-review run on a GitHub PR should finish end to
end through the mattstack MCP tools, with no `gh` step and no classifier
denial, and the docs should stop telling people the tools are GitLab only.
Three gaps remain after PRs #1087, #1093, #1095 and #1106: review submit
cannot request changes or pin the head it reviewed, three composites refuse
GitHub, and an inline comment that times out gives no hint it may have
landed. Two phase 1b leftovers ride along: a warning for a very broad
upload root, and tests for the upload guard's rare refusals.

## Goals

1. `mr_review_submit` takes `outcome: "request_changes"` on both forges.
2. `mr_review_submit` takes an optional `expectedHeadSha` and refuses,
   posting nothing, when the MR's head has moved.
3. `mr_comment_inline` adds the landing hint to a timeout or
   daemon-unreachable error, on both forges, as `mr_comment` does.
4. `mr_posted_since`, `mr_map` and `respond_post_execute` work on a GitHub PR.
5. `rt settings set rt.mcp.uploadRoots` warns when an entry is `/`, the home
   folder, or an ancestor of it.
6. Tests force each of the upload guard's rare refusals, plus a handler test
   that swaps the file at the `repoContext` seam.
7. `sites/docs/docs/skills/mcp.mdx` and `.claude/rules/mcp-and-gates.md` say
   which tools cover both forges.

## Non-goals

- `mr_rebase` on GitHub beyond what already shipped, `pipeline_jobs`,
  `ci_watch`, `ci_triage` (RT-546), `mr_upload` on GitHub.
- Skills moving off `gh` (SKILLS-107). The review skill's
  `compose-review` block still maps `request_changes` to `comment`; switching
  it to the new outcome and to `expectedHeadSha` is a skill-block change for
  another lane (named in the report as a follow-up).
- Any change under `packages/glance`.

## Anti-goals

- Widening the `gitlab_get` / `forge:get` guard lists. The token's own login
  comes from a new daemon read, never from opening `user` on GitHub.
- Changing a GitLab reply or error string, except the two named below.
- Touching `MR_WRITE_TIMEOUT_MS`, `MR_ACTION_TIMEOUT_MS`,
  `DISCUSSIONS_TIMEOUT_MS`, `RT_VERB_TIMEOUT_MS`, or stating a timeout
  figure in any tool description.
- Any live forge call in a test.

## Constraints

- Standing rulings: Octokit and gitbeaker only; GitLab replies and error
  strings do not change; one forge per team.
- Matt's allowed exceptions to the GitLab string ruling, from gate
  6c15ab06: `mr_comment_inline`'s landing hint (goal 3), and
  `request_changes` as new GitLab behaviour (goal 1). The validation
  message `outcome must be comment or approve` necessarily becomes
  `outcome must be comment, approve or request_changes` on both forges.
- An MCP description or schema change means: regenerate
  `plugins/mattstack/attachments/mcp-tools/reference.md` with the
  checkout's code under an isolated HOME (`env -i HOME=<temp> ...`), set
  `plugins/mattstack/.claude-plugin/plugin.json` one past main right before
  the push, recompile, and put an engine-floor line in the PR body.
- Write fence: the files named in the brief, widened by the gate answer to
  `lib/daemon/handlers/` and `lib/daemon/freshness.ts` for the identity read.

## Decisions (gate 6c15ab06, answered by the shepherd, Matt's own picks on q1, q2, q4)

| Question | Decision |
|---|---|
| Composites on GitHub | A real GitHub path for all three, with a new daemon read for the token's login. |
| Request changes on GitLab | Pass through: glance publishes with reviewer state `requested_changes`. |
| Head pinning | Daemon-side check, no glance change. |
| Inline comment hint | `withLandingHint` on both forges. |

## Approaches

**Head pinning.** (a) Daemon reads the head right before `submitReview` and
refuses on a mismatch. (b) Add `expectedHeadSha` to glance's
`ReviewSubmission`, set GitHub's `commit_id` and GitLab's approve `sha`.
(a) was picked: it covers both forges now with no glance edit while other
lanes are in that package. Cost: a sub-second window between the read and
the post stays open; GitHub has no review-side sha refusal to close it.

**Token login.** (a) New daemon verb over `resolveSelfUsername`. (b) Allow
`user` through `forge:get` on GitHub. (b) loosens a guard list the rules
say only widens with a design review, and returns a whole user body. (a)
was picked; it returns one string.

**Composites.** (a) Port all three. (b) Port the two reads. (c) Keep
refusing with neutral words. Matt picked (a).

## Design

### 1. `request_changes` outcome

- `lib/daemon/review-submit.ts`: `ReviewSubmitInput.outcome` and
  `parseReviewSubmit` accept `"request_changes"`; error text
  `outcome must be comment, approve or request_changes`.
- `packages/rt-client/src/commands.ts`: the `mr:review-submit` payload's
  `outcome` widens to `"comment" | "approve" | "request_changes"`.
- `lib/mcp/tools.ts`: schema enum and handler check widen. The description
  says `outcome "request_changes"` posts the review as changes requested
  (GitHub: a changes-requested review; GitLab: the reviewer shows as having
  requested changes) and never approves.
- The daemon passes the outcome straight to `provider.submitReview`;
  glance 0.31 already maps it on both forges. GitLab's reviewer state
  read-back after publish needs no change.

### 2. `expectedHeadSha` on review submit

- Payload gains optional `expectedHeadSha: string`. The parser accepts only
  a full sha (40 or 64 hex characters, either case) and otherwise fails
  `expectedHeadSha must be a full commit sha`.
- In the `mr:review-submit` handler, immediately before
  `provider.submitReview` (after the diff anchoring), when the field is set:
  read the MR with `provider.fetchSingleMR(repoCtx.projectPath, iid, null)`
  and compare its `sha` case-insensitively. It takes the project path, never
  `writeRef`: GitLab's `fetchSingleMR` queries GraphQL by full path, so the
  numeric id would read as no MR.
  - A read that throws, returns null, or carries no `sha`: `ok: false`,
    `could not read the MR's head to check expectedHeadSha; nothing was
    posted (<reason>)`.
  - A mismatch: `ok: true`, data
    `{ published: false, reason: "head-moved", expectedHeadSha, headSha, mrUrl }`.
  - A match: submit as today.
  - The request's abort signal is checked after the read and before the
    submit, as after the diff read: an aborted request answers
    `request aborted before the review was posted` and posts nothing.
- `ThreadProvider` gains `fetchSingleMR` as an optional pick
  (`Partial<Pick<GitProvider, "fetchSingleMR">>`, like
  `fetchPullRequestDiffs`), so existing fakes still type-check; a provider
  without it reads as "could not read the MR's head". `ReviewSubmitData`
  gains the `head-moved` variant.
- `lib/mcp/tools.ts`: schema property, handler pass-through, and one
  description sentence: pass the sha you reviewed and a moved head returns
  `published: false, reason "head-moved"` with `headSha`; re-read the diff
  before reviewing again.
- With no `expectedHeadSha` nothing changes, on either forge.

### 3. `mr_comment_inline` landing hint

Wrap its reply in `withLandingHint(fromResponse(res), "the MR's discussions")`.
Only timeout and daemon-unreachable errors change.

### 4. `forge:self` daemon verb

- `packages/rt-client/src/commands.ts`: `"forge:self": { payload: { repoName: string }; data: { username: string } }`,
  added beside `forge:get` in the catalog and in any list that enumerates
  verbs the MCP server may call (the builder confirms which lists apply).
- Handler beside `forge:get` in `lib/daemon/handlers/mr.ts`: decode the
  identity the way `forge:get` does, look up `repoPath` in the repo index,
  call `resolveSelfUsername(repoName, repoPath)` from `freshness.ts` through
  an injectable seam. Null answers `ok: false`, `could not read the token's
  own user for <repo>`. It returns the login and nothing else.
- Callers use it on GitHub only. `selfUsername()` in
  `mr-composite-tools.ts` branches on `githubProjectOf(identity)`: GitHub
  calls `forge:self`; GitLab keeps `forge:get "user"` byte for byte.

### 5. `mr_posted_since` on GitHub

- Drop the two refusals; resolve with `resolveMrTarget(input, { github: true })`.
- `by: "me"` reads the login through item 4. `postedMatch` needs no logic
  change: GitHub notes carry `author.username` = login, `system: false`,
  numeric ids and ISO `createdAt`.
- Description and schema text name both forges and say what GitHub thread
  ids look like (`gh-review-thread-<id>`, `gh-issue-comment-<id>`,
  `gh-review-<id>`), that `items[].path`/`line` match only diff comments,
  and replace "A GitLab username" with "a forge username (a GitHub login)".

### 6. `mr_map` on GitHub

- Drop the two refusals; resolve with `resolveRepoTarget(input, { github: true })`
  so a GitHub PR URL in `mrUrl` names the repo.
- `defaultBranchOf` reads `forge:get ":repo"` on GitHub (same
  `default_branch` key) and `projects/:id` on GitLab; a failure still
  degrades to `stacked: null`.
- Rows on GitHub carry `ref: "#<iid>"`, rewritten in the composite after
  `joinMrsToWorktrees` (`lib/mr-map.ts` is outside the fence).
- `author: "me"` already maps to `@me` in glance. `ciStatus` stays
  best-effort from the synced cache.
- Description text: "read live from the forge".

### 7. `respond_post_execute` on GitHub

- Drop the refusals in `readMrUrl` and `executeRespondPost`. Resolve with
  `{ github: true }`: the default `resolveMr` dep binds it, and the seam
  type stays `(input: TargetInput) => Promise<MrTarget>`.
- The token's login comes through item 4 for the author rule.
- Fork guard: when a push is due and `sourceInRepo(identity, mr)` is false,
  no push is attempted and the fix rows go to `held` with `kind: "push"`,
  through the existing push-precondition path, with the reason `the PR's branch lives in another
  repository, so this tool will not push it`.
- A reply or resolve on an id GitHub cannot thread (`gh-issue-comment-*`,
  `gh-review-*`) fails in the daemon and lands in `held` through the
  existing write-failure path, with the daemon's text. No new planner rule.
- Description: drop "GitLab only" and "On GitHub it refuses", and add one
  sentence naming the held outcome for an issue comment or a fork.

### 8. Broad upload roots warning

In `packages/rt-client/src/settings/write.ts`, beside the
`mattstack.directory` notice: on a write of `rt.mcp.uploadRoots`, each
absolute entry that resolves (through `realpath` when it exists, else
`path.resolve`) to `/`, to the home folder (`HOME` read at call time), or
to an ancestor of the home folder gets one notice:
`<entry> is a very broad folder: mr_upload and evidence_attach may send any
image or video under it off this Mac. Name a narrower folder.` The write
still succeeds. Load `rt:settings` before touching this.

### 9. Upload guard refusal tests

`readVerified` in `lib/daemon/upload-guard.ts` reads through an injectable
set of fs calls (`openSync`, `fstatSync`, `readSync`, `closeSync`),
defaulting to the real ones. Tests reach it through a new optional `fs`
field on the `opts` that `checkUploadPath` and `checkTextPath` already
take; production callers never pass it. Tests force: identity mismatch
(fstat reports another dev/ino), a swap between check and open (open lands
on a different file), a short read, and a file that grew (the probe read
returns a byte). Each asserts the exact refusal text; the identity
mismatch and the swap both refuse with `file changed identity between
check and read` and differ only in which fake call they use.

A handler test in `lib/daemon/__tests__/mr-upload.test.ts` swaps the file
inside the `repoContext` seam. The handler has already read and verified
the bytes by then (`checkAttachment` runs before `repoContextFn`), so the
test asserts the multipart body sent through `fetchFn` carries the original
verified bytes and none of the swapped file's bytes: the upload sends what
was checked, never what is on disk later.

### 10. Docs and rules

- `mcp.mdx`: drop "(GitLab only)" from every tool that now covers both
  forges (each `mr_*` write except `mr_upload`, the reads except
  `pipeline_jobs`, `mr_job_trace`, `pipeline_list`, `project_labels` and
  `gitlab_get` as the code says, and the three composites); rewrite line 315.
  The builder checks each row against the code before editing it. Load
  `rt:docs` first.
- `.claude/rules/mcp-and-gates.md`: composites now cover both forges;
  `forge:self` is the login read; `mr_review_submit` takes
  `request_changes` and `expectedHeadSha`.

## Testing

Each behaviour gets a failing test first, in the file next to its code:
`lib/daemon/__tests__/discussions-review-submit.test.ts` (outcome, head pin
match / mismatch / unreadable, no field), `lib/mcp/__tests__/` for the
tool handlers and composites (stubbed `command`, a GitHub identity, a
GitHub PR URL), a handler test for `forge:self` with the seam stubbed,
`packages/rt-client` settings tests for the notice, and the guard tests in
item 9. The four existing refusal tests are rewritten to GitHub success
cases. No test makes a forge call.

Verification before the PR: `bun test <each touched test file>`,
`bun run typecheck`, `bun run purity`, `bun run docs:check`, and the
mcp-tools reference test and `rt skills check --strict` under an isolated
HOME through `env -i`.

## Left to the builder

- Which verb lists `forge:self` must join.
- Exact test fixtures and file splits.
