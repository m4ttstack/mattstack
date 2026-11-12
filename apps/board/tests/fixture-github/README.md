# GitHub fixture

`PORT=7942 BOARD_FIXTURE=$(pwd)/tests/fixture-github bun run src/server.ts`
boots an inert board for a GitHub team, shaped like the GitLab fixture in
`tests/fixture`: no tokens, no timers, no rt relay.

Every name, handle, repo, branch, ticket id, URL, SHA and comment body here
is invented. Nothing in this directory is a snapshot of a real board.

Fixture mode reads `config.json`, `data.json`, `meta.json`,
`discussions.json`, `review-report.md`, `respond-report.md` and
`flock-menu.json`. The seat is `mkeller`.

| PR    | owner    | carries                                                                               |
| ----- | -------- | ------------------------------------------------------------------------------------- |
| #4101 | tobrandt | approved and mergeable, green checks, 12 behind main                                  |
| #4102 | mkeller  | the seat's own draft, checks still running                                            |
| #4103 | mkeller  | the seat's own PR with an open structured review-post gate and a peer reviewing       |
| #4104 | ivasco   | three threads (awaiting, replied, resolved in `discussions.json`) and a failing check |
| #4105 | mkeller  | `behindTarget: null`, as a GitHub row serves it, checks running                       |

Rows are what `buildBoard` serves for a GitHub row: `provider: "github"`,
`repositoryId` as `github:<n>`, `rtRepo` `github.com/acme/webapp` and empty
`codeownerSections`. The button fields carry what glance derives for any
forge: merge and auto-merge are visible on open non-draft rows (merge
disabled unless the row is ready), and rebase shows only when a row needs
one, which none here do. The client hides merge, rebase, auto-merge and the
draft toggle on GitHub rows, so the render shows none of them even though
the data offers them.
