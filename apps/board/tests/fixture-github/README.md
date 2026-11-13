# GitHub fixture

`PORT=7942 BOARD_FIXTURE=$(pwd)/tests/fixture-github bun run src/server.ts`
boots an inert board for a GitHub team, shaped like the GitLab fixture in
`tests/fixture`: no tokens, no timers, no rt relay.

Every name, handle, repo, branch, ticket id, URL, SHA and comment body here
is invented. Nothing in this directory is a snapshot of a real board.

Fixture mode reads `config.json`, `data.json`, `meta.json`,
`discussions.json`, `review-report.md`, `respond-report.md` and
`flock-menu.json`. The seat is `mkeller`.

| PR    | owner    | carries                                                                                                                                    |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| #4101 | tobrandt | approved and mergeable, green checks, 12 behind main, two Slack posts (the Slack posts modal)                                              |
| #4102 | mkeller  | the seat's own draft, checks still running                                                                                                 |
| #4103 | mkeller  | the seat's own PR with an open structured review-post gate and a peer reviewing                                                            |
| #4104 | ivasco   | three threads (awaiting, replied, resolved), a failing check and a finished review lane (the review modal); its checks are commit statuses |
| #4105 | mkeller  | `behindTarget: null`, checks running, a held note draft (the draft modal and its post control)                                             |
| #4106 | mkeller  | the seat's own approved, mergeable PR: merge, auto-merge and the draft toggle all show                                                     |
| #4107 | mkeller  | the seat's own PR with a red workflow run, the auto-doctor's pipeline-red edge                                                             |
| #4108 | mkeller  | the seat's own PR that needs a rebase with green checks, the needs-rebase edge                                                             |

In `discussions.json`, thread ids take glance's `gh-review-thread-<id>` shape
and the general comment `gh-issue-comment-<id>`, so the drawer links end in
`#discussion_r<noteId>` and `#issuecomment-<noteId>`.

Rows are what `buildBoard` serves for a GitHub row: `provider: "github"`,
`repositoryId` as `github:<n>`, `rtRepo` `github.com/acme/webapp` and empty
`codeownerSections`. The button fields carry what glance derives for any
forge: merge and auto-merge are visible on open non-draft rows (merge
disabled unless the row is ready), and rebase shows only when a row needs
one, which #4108 does.
