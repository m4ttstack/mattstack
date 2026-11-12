# GitHub fixture

`PORT=7942 BOARD_FIXTURE=$(pwd)/tests/fixture-github bun run src/server.ts`
boots an inert board for a GitHub team, shaped like the GitLab fixture in
`tests/fixture`: no tokens, no timers, no rt relay.

Every name, handle, repo, branch, ticket id, URL, SHA and comment body here
is invented. Nothing in this directory is a snapshot of a real board.

Fixture mode reads `config.json`, `data.json`, `meta.json`,
`discussions.json`, `review-report.md`, `respond-report.md` and
`flock-menu.json`. The seat is `mkeller`.

| PR    | owner    | carries                                                                                     |
| ----- | -------- | ------------------------------------------------------------------------------------------- |
| #4101 | tobrandt | approved and mergeable, green checks, 12 behind main                                        |
| #4102 | mkeller  | the seat's own draft, checks still running                                                  |
| #4103 | mkeller  | the seat's own PR with an open structured review-post gate and a peer reviewing             |
| #4104 | ivasco   | three threads (awaiting, replied, resolved in `discussions.json`) and a failing check       |
| #4105 | mkeller  | `behindTarget: null`, as a GitHub row serves it, checks running                             |

Rows are what `buildBoard` serves for a GitHub row: `provider: "github"`,
`repositoryId` as `github:<n>`, `rtRepo` `github.com/acme/webapp`, empty
`codeownerSections`, and no merge, rebase or auto-merge buttons to offer.
