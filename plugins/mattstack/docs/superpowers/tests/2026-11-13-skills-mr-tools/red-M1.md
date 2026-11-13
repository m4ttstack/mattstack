# RED M1: fails as expected (gh pr list, git worktree list)

# red-M1 reply

## Ordered calls

1. `git remote get-url origin` -> `git@github.com:acme/app.git`. This is GitHub, so I skip step 1 (`mr_map` is the GitLab path) and take steps 2-3.
2. `gh pr list --author @me --limit 200 --state open --json number,title,headRefName,baseRefName,isDraft` -> 2 rows (#12 feat-a, #15 feat-b). Fewer than 200, so no "cut at 200" note. I keep ref (`#number`), title, author (me, from the `@me` filter) and source branch (`headRefName`).
3. `rt_verb` with args `["worktree","list","--json"]`. The scenario gives no result for it, so I treat it as unavailable/errored. The skill allows the fallback.
4. `git worktree list --porcelain` (fallback, from the main checkout `/work/acme`) -> trees: `/work/acme` (main), `/work/acme-feat-a` (feat-a).

## Join (exact string equality on branch)

- feat-a == feat-a -> `/work/acme-feat-a`
- feat-b has no worktree -> NONE (expected, not an error)

## Final report

| MR ref | title | author | source branch | worktree path or NONE |
|--------|-------|--------|----------------|------------------------|
| #12 | Add feature A | me | feat-a | /work/acme-feat-a |
| #15 | Add feature B | me | feat-b | NONE |

One paired row, one NONE row. Stop (discovery only, nothing created, rebased or removed).
