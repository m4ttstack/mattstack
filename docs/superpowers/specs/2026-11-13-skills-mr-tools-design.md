# Forge skills on the mr tools (RT-569)

## Intent

The mattstack plugin's forge skills reach GitHub through `gh pr list`,
`gh pr view` and `gh pr create`. The mattstack MCP tools (`mr_map`,
`mr_resolve_branch`, `mr_list`, `mr_create`) now answer on GitHub too, so
those skills walk a different path on each forge, and their GitLab-only
wording stays. This change moves the GitHub steps onto the tools, so both
forges walk one path, and makes the copy say PR on GitHub and MR on GitLab.
It finishes the follow-up PR #1123 (RT-549) left, after PRs #1100 and #1119
moved the review, respond, ship, evidence and watch-ci skills.

## Goals

- No direct `gh pr` call in a plugin skill source where a tool covers it.
- One walk on both forges wherever GitLab already uses the tool.
- Forge-aware copy: PR and `#12` on GitHub, MR and `!12` on GitLab, "MR or
  PR" where the skill cannot know. Internal names (verb names such as
  `map-open-mrs`, tool names, node ids, stored values) stay.
- Compiled output, the strict check, certify and the MCP tools reference
  regenerated and passing.

## Non-goals

- The watch-ci and stage-watch-ci skills (the ci-watch-budget lane), and
  `apps/board/skills-src` (the board lane).
- `lib/`, `apps/`, `packages/`: no tool changes. A field a skill needs that
  a tool lacks is a question, not an edit.
- Retiring `ci-forge-gitlab` (SKILLS-108 follow-up from #1119).

## Anti-goals

- Any change to what a GitLab walk does. Every GitLab tool call and its
  arguments stay, and GitLab reaches the same tools, gates and terminals
  in the same order. The only GitLab-side graph changes allowed are: the
  forge diamonds that no longer decide anything are deleted (checkout's
  `mr_forge_host` and `ticket_forge_host`, sync-open-mrs's `forge_host`),
  the origin read that fed sync-open-mrs's diamond (`git_remote_url`) goes,
  and the STOP and error edges are relabelled forge-neutral.
- A behaviour change on GitHub that is not listed under "Behaviour changes"
  below.

## Inventory

Every `gh ` call in `plugins/mattstack` skill sources (skills, attachments,
blocks, engines, references). Historical RED/GREEN transcripts under
`plugins/mattstack/docs/`, lint fixtures in
`plugin/skills/process-digraphs/test-check-dot.sh`, `CERTIFICATION.md`
and compiled output are not sources and are left alone.

| # | Where | `gh` call today | Replaced by | Notes |
|---|---|---|---|---|
| 1 | `attachments/forge/map-open-mrs/2-github-list-the-open-prs.block.md`, index `allowed-tools` | `gh pr list --author @me --limit 200` | `mr_map {repoName, author: me}` | Block 3 (worktree join) goes too: `mr_map` joins |
| 2 | `attachments/forge/sync-open-mrs/` (index `allowed-tools`, `follow-map-open-mrs`, `plan-sweep`, `all-selected`) | `gh pr list` (through map-open-mrs) | `mr_map {repoName, author: me}`, the same edge GitLab takes | The `git -C <tree> status --porcelain` read goes: the row's `dirty` replaces it |
| 3 | `attachments/forge/checkout/index.block.md` graph and `allowed-tools`; `checkout-and-open/index.block.md` `allowed-tools` | `gh pr view <ref>` | `mr_resolve_branch {repoName, mrUrl or iid}` | Adds the fork check (below) |
| 4 | `attachments/forge/checkout/index.block.md` graph and `allowed-tools` | `gh pr list --search <id>` | `mr_list {repoName, search, state: all, limit: 200}`, then the unfiltered second read, as on GitLab | Then the picked row goes through `mr_resolve_branch` on GitHub |
| 5 | `attachments/orchestration/shepherdr/references/job-template.md` (graph node and the Git section) | `gh pr create` | `mr_create {repoName, sourceBranch, targetBranch, title, description, draft: false}` on GitHub | GitLab's `mr_create` node stays as it is |

Calls that stay, with the reason:

| Where | Call | Why it stays |
|---|---|---|
| `attachments/ci-forge-gitlab/references/ci-forge-contract.md`, "Implementing GitHub" | `gh run list`, `gh run view`, `gh run rerun`, `gh pr view --json baseRefName` | A design note for a GitHub adapter that never shipped, inside watch-ci's forge adapter. It belongs to the watch-ci lane and to the ci-forge retirement (SKILLS-108). |
| `attachments/mcp-tools/reference.md` | prose naming gh (evidence_attach's daemon path) | Generated from the tools' own descriptions; regenerated, never hand-edited. |
| `docs/your-first-pack.md` | `gh auth login` | An install step, not a skill call; `evidence_attach` still needs gh on PATH. |

Evidence uploads through `gh --attach` already go through
`evidence_attach`; no skill source calls `gh` for them.

## Behaviour differences, gh call against tool

| # | gh today | Tool | Effect |
|---|---|---|---|
| 1, 2 | `gh pr list --author @me --limit 200`: open PRs, drafts included; "exactly 200 rows" taken as cut | `mr_map`: open PRs, drafts included (`state: opened`), up to 200; `complete` is false when more exist (paged count, and GitHub's search total) | Same rows; the cut is now reported exactly instead of guessed from a count of 200 |
| 1 | Join by `rt_verb worktree list --json`, `git worktree list` as fallback, exact branch equality | `mr_map` joins registered trees by exact branch equality (the last tree when two share a branch) | Same match rule. An `mr_map` error ends the map with the error quoted, as GitLab does; the `git worktree list` fallback goes. A fork PR still joins by branch name only (a known #1115 follow-up; unchanged from today) |
| 2 | Dirty tree: non-empty `git -C <tree> status --porcelain` | Row `dirty`: `true` dirty, `null` with a tree means the read failed and the tree is skipped as not known clean | GitHub now follows GitLab's rule, including the skip on a failed read |
| 3 | `gh pr view <ref>`: branch name only; then `git worktree list` and `worktree_provision` | `mr_resolve_branch`: `sourceBranch`, `state` (`opened`, `merged`, `closed`), `author`, `trees` on that branch, and on GitHub `sourceProjectPath` | Skips `git worktree list` as GitLab does. A merged or closed PR takes the same checkout and the report names the state, as on GitLab. Errors quote GitHub's text (for example `GitHub has no pull request #N in owner/repo, or the token cannot read it`) |
| 3 | Fork PR: the fork's branch name goes to `worktree_provision`, which finds no such branch on origin and silently makes a NEW branch from the default branch | Fork PR: `sourceProjectPath` is not this repo (or null for a deleted fork, or absent when the token cannot see the head repo), and `trees` is empty | Behaviour change B1 |
| 4 | `gh pr list --search <id>`: open PRs only, gh's default 30 rows, no cut signal | `mr_list` with `search`, `state: all`, `limit: 200`; `truncated` when more exist; GitHub search matches title, body and comments | Behaviour change B2. The skill keeps only rows whose `sourceBranch` or `title` carries the id, so comment-only matches drop out |
| 5 | `gh pr create`: ready PR (not draft); errors when a PR for the branch exists | `mr_create`: `draft` defaults to true, so the GitHub node passes `draft: false`; without `ifExists` an existing PR comes back as GitHub's 422 error | Ready PRs as today (CodeRabbit skips drafts by default). `title` is required and the node passes `description` too; the worker writes both |

## Behaviour changes (labelled, agreed through herd_ask gate f1d1097e)

- **B1. Fork PRs in checkout stop instead of checking out the wrong
  branch.** On GitHub, when `mr_resolve_branch` shows the PR's branch lives
  outside this repo, checkout ends at a new terminal, **Fork PR: reported**,
  saying the branch lives in a fork and is not on origin, so nothing was
  checked out. A ticket search that picks a GitHub row (directly or through
  the clarify gate) first resolves that row with
  `mr_resolve_branch {repoName, iid}`, so it gets the same check and the
  trees on its branch.
- **B2. GitHub ticket search follows GitLab's rules.** `mr_list` with
  `search`, `state: all` and `limit: 200`, the truncated check, and the
  second unfiltered read when no row names the ticket. Merged and closed
  PRs are found; a cut list goes to the clarify gate instead of being
  quietly short.
- **B3. map-open-mrs on GitHub has no `git worktree list` fallback.** An
  `mr_map` error is the whole result, quoted, with no table, as on GitLab.
- **B4. sync-open-mrs on GitHub skips a tree whose dirty read failed**
  (`dirty: null` with a tree), saying so, as on GitLab.

## Approaches

- **A. One path on both forges (picked).** Where GitLab already calls the
  tool, GitHub takes that edge. Forge diamonds that no longer decide
  anything and the GitHub-only blocks are deleted.
- B. Swap `gh` for the tool on the GitHub edge only. Smallest diff, but it
  leaves two identical paths behind a diamond that decides nothing.
- C. A, and retire `map-open-mrs`. Rejected: it is still a verb a person
  invokes to list their open PRs with worktrees.

## Design, per skill

### checkout (`attachments/forge/checkout/`)

- Graph: `what_given`'s MR edge goes straight to `mr_resolve_branch` (label
  "an MR or PR link, !iid, #number, or number"); `mr_forge_host`,
  `gh_pr_view` and its edge go. The ticket edge goes straight to
  `mr_list_search`; `ticket_forge_host` and `gh_pr_list_search` go.
- The two STOP nodes become forge-neutral: "STOP: MR and PR reads go
  through the read tools", reached from `what_given` by "tempted to read
  the MR or PR with the GitLab CLI or gh", and "STOP: ticket searches go
  through the read tools", reached by "tempted to search with the GitLab
  CLI or gh". The two labels differ so the edges read apart. Each returns
  to the tool it guards.
- `mr_resolve_result` gains the edge "a GitHub PR whose branch lives in a
  fork" to a new terminal `fork_pr` **Fork PR: reported**. A result is a
  GitHub one when the origin URL `git_remote_origin` read is on
  github.com (the same host as the result's `webUrl`); only then do the
  fork rules below apply. GitLab results carry no `sourceProjectPath`, and
  that absence never means a fork on GitLab.
- A new diamond after a pick, "A GitHub PR row picked?", sits on
  `one_branch` yes and on the clarify gate's candidate answer: yes goes to
  `mr_resolve_branch {repoName, iid}` (then `mr_resolve_result` as above);
  no (GitLab, or a branch name) goes to `git_worktree_list` as today.
- Blocks: `mr-resolve-result` gains the fork rule (a GitHub result whose
  `sourceProjectPath` is not the repo in its `webUrl`, is null, or is
  absent, with `trees` empty: never `worktree_provision`). `pick-branch`
  states the `mr_list` reads for both forges ("the forge's search never
  looks at the source branch"). `gate-which-branch`, `reading-gitlab-facts`
  and the error edges say "the forge's error" and quote it as the forge
  wrote it. `reading-gitlab-facts` names `gitlab_get`'s GitHub path form
  (under `:repo/`) beside GitLab's `:id`.
- `allowed-tools`: drop `Bash(gh pr view:*)` and `Bash(gh pr list:*)`.
- A new terminal needs a short judgment section only if the report has
  content to define; the fork report sentence lives in the
  `mr-resolve-result` block.

### checkout-and-open (`attachments/forge/checkout-and-open/`)

- `allowed-tools`: drop `Bash(gh pr view:*)`. Copy: "open this MR or PR
  locally".

### map-open-mrs (`attachments/forge/map-open-mrs/`)

- Block 1 becomes "1. One `mr_map` call" for both forges; blocks 2 and 3
  are deleted; "Emit" becomes step 2. The cut sentence says "open MRs" or
  "open PRs" by the rows' `ref` marker.
- The table header's first column reads "MR or PR ref".
- `allowed-tools`: drop `Bash(gh pr list:*)` and `Bash(git worktree
  list:*)`.
- Text that still names sync-open-mrs as its caller is updated: the index
  description ("The discovery step of sync-open-mrs" goes; it is a
  listing verb a person runs), the Emit block's "contract a caller
  downstream reads" line, `tests/graph-roster.jsonc`'s description, and
  `plugins/mattstack/README.md`'s map-open-mrs and sync-open-mrs rows
  (sync-open-mrs maps with `mr_map` on both forges).

### sync-open-mrs (`attachments/forge/sync-open-mrs/`)

- Graph: `git_remote_url`, `forge_host` and `follow_map_open_mrs` go; the
  run-entry edges lead to `mr_map` directly. The STOP guard says "forge
  reads go through mr_map", reached by "tempted to use the GitLab CLI or
  gh", from the node before `mr_map` (placement is the builder's, within
  certify's structure rules).
- `mr_map_result`'s error edge reads "forge error: quoted".
- Blocks: `follow-map-open-mrs` is deleted. `plan-sweep` and
  `all-selected` keep only the `mr_map` rules (`dirty`, `complete`).
  `mr-map-result` and `report-branch-buckets` say "the forge's error".
  The intro says the sweep covers the open MRs or PRs `mr_map` returns.
- The report's noun follows the rows' `ref` marker (`#` is GitHub).
- `allowed-tools`: drop `Bash(gh pr list:*)`, `Bash(git worktree
  list:*)`, `Bash(git -C * status:*)` and `Bash(git -C * remote
  get-url:*)`, none of which the skill runs any more; keep `Bash(git -C *
  log:*)` (`record-branch-bucket` still reads a log).

### rebase-worktree

- Copy only, where it still says MR alone for something both forges have
  ("a stale MR branch", "an open MR others may have pulled"): "MR or PR".

### shepherdr job template (`attachments/orchestration/shepherdr/references/job-template.md`)

- The GitHub edge of `forge_host` goes to a new node
  `mr_create_github` "mr_create {repoName, sourceBranch, targetBranch,
  title, description, draft: false}"; `gh_pr_create` goes. The GitLab node
  is unchanged.
- The Git section: "then `mr_create` (with `draft: false` on a GitHub
  origin)". The job brief my lane received was rendered from this template,
  so the change reaches briefs written after the next plugin release.

## Constraints

- Every skill edit follows mattstack:editing-skills, superpowers:writing-skills
  and mattstack:process-digraphs: RED with a fresh agent, edit, GREEN,
  sources only.
- Compile the engines the CI way in a scratch dir (graph roster), and the
  pack's own verbs with `rt skills compile --pack mattstack --pack-dir
  <worktree>/plugins/mattstack`, all under an isolated temp HOME. Regenerate
  the MCP tools reference the same way.
- Certify every skill folder written: `attachments/forge/checkout`,
  `checkout-and-open`, `map-open-mrs`, `sync-open-mrs`, `rebase-worktree`
  if touched, and `attachments/orchestration/shepherdr`.
- Plugin version one past main's at PR time (merge main first if it
  moved). `pack/requires.json` `minEngine` rises to that version, since
  the skill text now relies on `mr_map`, `mr_resolve_branch` and `mr_list`
  answering on GitHub (`mr_map` took GitHub targets in #1115, after
  today's floor of 0.32.60). The floor follows the convention of #1100:
  the PR's own version.
- No live forge calls in tests; scenarios use fixture tool results.
- No em or en dashes.

## Verification

RED and GREEN scenarios, each run by a fresh agent reading the compiled
skill with fixture tool results:

1. checkout, a same-repo GitHub PR URL: calls `mr_resolve_branch`, then
   `worktree_provision` with `sourceBranch`; no `gh`.
2. checkout, a GitHub fork PR: stops at **Fork PR: reported**; no
   `worktree_provision`.
3. checkout, a ticket id on GitHub: `mr_list` with `search`, `state: all`,
   `limit: 200`; the picked row goes through `mr_resolve_branch`.
4. map-open-mrs on GitHub: one `mr_map` call; table from its rows.
5. sync-open-mrs on GitHub: `mr_map`; dirty from the row; no porcelain read.
6. Job template on a GitHub origin: `mr_create` with `draft: false`.
7. GitLab regression, checkout: a GitLab MR link walks today's calls in
   today's order, and a GitLab result is never treated as a fork.
8. GitLab regression, sync-open-mrs: `mr_map {repoName, author: me}` then
   the same plan, gates and sweep as today.
9. GitLab regression, map-open-mrs: one `mr_map` call and the same table
   (bar the planned "MR or PR ref" header).

Then: the strict skills check, certify on each folder, the MCP tools
reference test, `bun run docs:check`, `bun run typecheck`, `bun run
purity`, all under an isolated temp HOME where they touch rt.

## Left to the builder

- Exact node ids for new nodes (short ids, per certify).
- Where the sync-open-mrs STOP edge hangs, within the structure rules.
- Wording of each copy edit, within the forge-aware rule.
