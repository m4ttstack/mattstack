# GitHub path for the review, respond, doctor and pipeline skills

Tickets: SKILLS-105, SKILLS-106, SKILLS-107 (project P-RT-28, GitHub parity).

## Intent

Main now has `mr_*` MCP tools that work on a GitHub pull request: reads,
create, update, ready, merge, approve, comments, inline comments, thread
reply and resolve, and `mr_review_submit` as one review. The skills still
reach GitHub through `gh` (which has no permission rule, so an unattended
pane blocks), tell agents GitHub has no inline comments, and carry
GitLab-only wording. This change gives every GitHub branch in those skills
the forge-aware tools, so a GitHub team gets the same review, respond and
ship as a GitLab team.

## Goals

- The plugin review posts a GitHub review as one `mr_review_submit`, with
  each finding that has a file and line as an inline comment (SKILLS-105).
- No `gh` command remains in the review, receive-review, ship, stage-ship
  or stage-evidence sources (SKILLS-107).
- A resumed GitHub review never posts twice (SKILLS-107).
- A ticket id or a branch resolves to a GitHub PR through the read tools
  (SKILLS-107).
- Board review and respond finish on a GitHub PR; their wording names the
  forge, not GitLab (SKILLS-106).
- Board doctor on a GitHub PR stops at once with a plain reason instead of
  walking into refused tools (SKILLS-106, partial).

## Non-goals

- `watch-ci` and `stage-watch-ci` stay as they are: `ci_watch` and
  `ci_triage` are GitLab only until RT-546 lands in another lane.
- No change to any MCP tool, the daemon, glance, `lib/`, or
  `lib/setup/base-permissions.ts` (other lanes; SKILLS-107's permission
  and `ci-forge@1` notes are reported, not done).
- No request-changes outcome on GitHub (RT-321 adds it to
  `mr_review_submit`).
- No GitHub path for `respond_post_execute`, `mr_map`, `mr_posted_since`
  (RT-321) or `mr_rebase` (GLANCE-45).

## Anti-goals

- Any change to what a GitLab run does. Where a forge branch collapses into
  a shared node, the GitLab edges, inputs and results stay exactly as
  today.
- A skill that names a tool the reader's app cannot run (see Engine floor).
- A second post path on GitHub beside `mr_review_submit`.

## Constraints

- Standing rulings: GitLab behaviour does not change; one forge per team.
- Every skill edit goes through mattstack:editing-skills and
  superpowers:writing-skills (RED baseline, edit the block source, compile,
  GREEN, certify, bump), with process graphs per mattstack:process-digraphs.
  Compiled output is never edited by hand.
- Board skills are edited only in `apps/board/skills-src/`; `apps/board/skills/`
  comes from `bun run skills:expand:board`.
- RED and GREEN runs make no live forge call and post to no real PR.

## Tool facts this design rests on (GitHub, read from main)

- `mr_threads` returns three kinds, told apart only by id:
  `gh-review-thread-<n>` (inline thread, resolvable, notes carry
  `position.newPath`/`newLine`), `gh-issue-comment-<n>` (PR-level comment,
  `resolvable: null`) and `gh-review-<n>` (a submitted review's summary,
  `resolvable: false`). Ids are stable across calls. The
  `unresolved-human` filter works on GitHub and keeps the last two kinds.
- `mr_reply_thread` and `mr_resolve_thread` accept only
  `gh-review-thread-<n>` and refuse the other two kinds.
- `mr_review_submit` takes `outcome` `comment` or `approve` only. It
  returns `bad-anchors` and `pending-drafts` as on GitLab; on GitHub a
  `bad-anchors` from GitHub's own 422 lists every comment, and
  `replyErrors` lists replies that did not post.
- `mr_create` refuses `squash` on GitHub; `mr_update` likewise. `mr_ready`,
  `mr_view`, `mr_list` (with `search`) and `mr_for_branch` work.
- No tool returns a GitHub diff as a unified diff; `git fetch origin
  +pull/<n>/head` and a local `git diff` give it.

## Approaches

1. **Route every GitHub branch through the `mr_*` tools (picked).** Where
   the GitHub branch did what a GitLab node already does with a forge-aware
   tool, the branch joins that node; where GitHub needs its own step (the
   PR-head fetch, the per-thread respond walk, the resume read), it keeps a
   GitHub node that calls the tools. One post path, no `gh`.
2. **Swap `gh` commands one for one, keep every forge diamond.** Smaller
   diffs, but leaves duplicate GitHub nodes that do what the GitLab nodes
   now do, and two places to change for every later fix.
3. **Keep `gh` for what the tools lack (request changes, resume check).**
   Keeps today's GitHub outcomes but leaves `gh` writes, which block
   unattended panes.

Approach 1, with the four calls below made through the shepherd
(2026-11-11 gate `ff837941`).

## Decided calls

1. **Request changes on GitHub is dropped until RT-321.** The GitHub gate
   offers `comment` and `approve`, exactly like GitLab, and posts through
   `mr_review_submit`. The `request_changes` key leaves `summary.comments`
   and the extras' `outcome` options. Matt's pick; the PR body names it as
   a behaviour change pointing at RT-321.
2. **A resumed GitHub review checks by text in a thread read.** On GitHub
   the review-already-posted step reads `mr_threads {mrUrl, refresh:
   true}`: the summary counts as posted when a `gh-review-<n>` entry's
   note contains the first line of the summary Compose built; each
   comment counts when a `gh-review-thread-<n>` note at its `path` and
   `line` contains the first line of its body. All posted is yes, some is
   partly, none is no; a read error holds. GitLab keeps
   `mr_posted_since`. Whether an approval is still outstanding comes from
   the latest hold's reason on both forges, as today: the GitHub read
   checks no approval state.
3. **A reply to a GitHub PR-level comment or review summary posts as a new
   PR comment.** For a `gh-issue-comment-<n>` or `gh-review-<n>` row, the
   reply posts with `mr_comment {mrUrl, body, resolvable: false}`, its body
   opening with the comment's first line as a Markdown quote and the
   author's `@username`, then the reply. It is never resolved, so its Gate
   2 question offers `post:` alone (as an Overview comment does on
   GitLab). This applies in receive-review and board respond. The posted
   check for such a row looks for a PR-level comment (a `gh-issue-comment`
   entry) carrying the reply text, since the reply is not in the original
   comment's note chain. Shepherd's call; the PR body names it as a
   behaviour change.
4. **Board doctor stops at entry on GitHub.** On a `github.com` mrUrl the
   doctor writes its error status saying CI watch (RT-546) and server-side
   rebase (GLANCE-45) are not on GitHub yet, and ends. Its "the GitLab CLI"
   STOP labels become forge-neutral ("the forge CLI"). The stop comes out
   when those land.

## Changes by skill

### Plugin review (`plugins/mattstack/attachments/review/review/`)

- `one-review-on-gitlab.block.md`: one forge-neutral section: the one
  review is `mr_review_submit` on both forges; the false "GitHub has no
  inline mechanism" text and every `gh pr review`/`gh pr comment` mention
  go. File name may stay (a block's file name is not shown); the heading
  and label become forge-neutral.
- `the-review-graph/index.block.md`:
  - Target: a GitHub PR URL or number goes to `mr_view` like a GitLab
    one; a GitHub branch to `mr_for_branch`; a ticket id to `mr_list`
    (works on both). `gh_pr_view` and `pr_view_found` go. STOP labels
    about "the GitLab CLI" read "the forge CLI".
  - Diff: the GitHub branch fetches `+pull/<n>/head:refs/remotes/origin/pr-<n>`
    (and the target branch) and runs `git diff
    origin/<targetBranch>...origin/pr-<n>`; `gh_pr_diff` goes.
  - Posting: `posting_forge` goes; both forges reach `compose_review`. The
    resume read branches by forge: GitLab `mr_posted_since` as today,
    GitHub the `mr_threads` read of call 2. `gh_pr_review`,
    `pr_review_result`, `gh_off_answer`, `gh_pr_comment` and
    `gate_off_script_gh` (and its block) go.
- `compose-review`, `write-post-extras`, `write-report`, `end-with-link`,
  `what-the-graph-cannot-show`, `review-already-posted`: drop `gh` and
  `request_changes` text; add the GitHub read rule to
  `review-already-posted`.
- `take-earlier-threads`: already reads `mr_threads`; check it states
  `origin/pr-<n>` as the GitHub head and nothing else needs to change.
  On GitHub only `gh-review-thread-<n>` ids may go into
  `mr_review_submit`'s `replies` (others land in `replyErrors`): an earlier
  round's threads are the review's own inline threads, so say that a
  PR-level id is never handed to `replies`.
- `attachments/review-posting/` (included by the review skill through
  `review-posting.block.md`): `posting-mechanics-by-disposition`,
  `quick-reference`, `close-hard-gate`, `red-flags`, `caller-inputs` and
  `tacit-approval-rule` drop `gh pr review`, `gh pr view` and the
  GitHub-only Request changes: Request changes is unavailable on both
  forges and posts as the blocking-framed Comment GitLab already uses.
  The shepherd widened the write fence to this folder (gate `11469618`).
  No team pack fill includes it directly: a team org's packs reach it
  only through compiled copies of the mattstack review engine, which pick
  the change up on their next compile; their GitLab text is unchanged.

### Receive-review (`plugins/mattstack/attachments/review/receive-review/`)

- Thread reads: `read_pr_threads_gh` becomes `mr_threads {mrUrl, filter:
  unresolved-human}`, the same filtered read GitLab uses, so
  `keep_unresolved_human` applies on GitHub too (the hand filter goes
  where the tool filter now covers it). `read_handed_threads_gh` becomes
  an unfiltered `mr_threads` read. Where both forges now make the same
  call, the nodes merge.
- Post side on GitHub stays a per-thread walk (`respond_post_execute`
  refuses GitHub): `read_posted_threads_gh` is a fresh `mr_threads {refresh:
  true}` read with the posted rule (plus call 3's PR-level rule);
  `post_reply` is `mr_reply_thread` for a `gh-review-thread-<n>` row and
  call 3's `mr_comment` for the other two kinds; `resolve_thread` is
  `mr_resolve_thread`, never for a PR-level row. Push before a Fixed reply
  stays `git_push`.
- The `post_forge` edge label "GitHub: never respond_post_execute or an
  mr_ tool" becomes "GitHub: never respond_post_execute" (the walk now
  uses `mr_*` tools; `respond_post_execute` still refuses GitHub).
- Change resolution: `change_forge` goes; a GitHub change joins
  `mr_ref_in_hand`, so with no PR URL in hand `mr_for_branch` finds it,
  as on GitLab (`resolve-change.block.md` loses "On GitHub it is the PR's
  URL").
- `snapshot-records`, `run`, `what-the-graph-cannot-show`, `red-flags`:
  drop `gh` wording.

### Pipeline (`plugins/mattstack/attachments/pipeline/`)

- `ship/flow` and `stage-ship`: the GitHub create is `mr_create` with
  the same inputs as GitLab minus `squash` (GitHub refuses it), so
  `squashApplied`/`mr_update_squash` are GitLab only. Read back is
  `mr_view`, write back `mr_update {mrUrl, title, description}`, draft
  check `mr_view`, mark ready `mr_ready`. Where a forge diamond then picks
  the same tool on both sides, it goes; where inputs differ (squash) it
  stays, routing to the same tool. Prose mentioning `--base`/`--draft`
  becomes the tool's `targetBranch`/`draft`.
- `stage-evidence`: `gh pr view <branch>` becomes `mr_for_branch`.
- `watch-ci`, `stage-watch-ci` and ship's `run-watch-ci` hand-off: no
  change.

### Board (`apps/board/skills-src/`)

- `review/SKILL.md`: "the GitLab CLI" becomes "the forge CLI"; GitLab-only
  phrases ("a GitLab fetch failure", "finishes the review in GitLab",
  "pending comments ... in GitLab") name the forge or both. The Posted
  already note on GitHub is the review's `gh-review-<n>` entry; say so.
- `respond/`: wording as above; an Overview row on GitHub
  (`gh-issue-comment-<n>` or `gh-review-<n>`) replies through call 3's
  `mr_comment` instead of `mr_reply_thread`, and the Posted already rule
  gains call 3's PR-level check.
- `doctor/`: the entry stop of call 4; "the GitLab CLI" wording becomes
  forge-neutral.
- Regenerate `apps/board/skills/` with `bun run skills:expand:board`;
  `bun run skills:check:board` passes.

## Engine floor and version

The new skill text calls `mr_*` tools on GitHub, which only an app carrying
PRs #1087, #1093 and #1095 can serve (none is released yet). So
`plugins/mattstack/pack/requires.json` `minEngine` rises to the version this
change bumps the plugin to, in the same commit. Right before the push the
plugin version is set one past main's, and `minEngine` moves with it in
the same commit, followed by a recompile and strict check.

## Verification

- RED: a fresh agent given today's compiled review skill and a GitHub PR
  reaches for `gh pr review` and posts findings as body text; given
  receive-review, uses `gh` for threads; given ship, uses `gh pr create`.
- GREEN: the same scenarios on the recompiled skills reach only the `mr_*`
  tools, post inline comments in one `mr_review_submit`, and run no
  `gh` command. No real PR is touched: the agents describe their calls
  against a stated fixture, they never execute forge calls.
- Certify on every revised skill folder; `rt skills check --strict` on a
  scratch compile; `bun run skills:check:board`; `bun test` on any test
  file touched; `bun run purity`.

## Left to the builder

- Exact node ids and labels in the collapsed graphs, kept short-id and
  passing `check-dot.py --short-ids`.
- Whether `one-review-on-gitlab.block.md` is renamed (only if nothing keys
  on the file name).
- Which receive-review nodes merge versus stay forge-labelled, as long as
  GitLab's path is unchanged.
