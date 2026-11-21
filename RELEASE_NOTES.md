The daemon's branch refresh works on GitLab repos again: gitlab.com had refused its MR read since v2.35.0. The gitq web UI is gone, and a new pr-usher skill keeps a repo's ready PRs moving.

### Daemon and forge reads

- the GitLab by-branch MR read fits gitlab.com's query complexity cap again, so the daemon's branch refresh, the CLI's fresh fetch, gap-fill and `gitq publish` work on GitLab repos (it showed as "Daemon: degraded (refresh: N enrich errors)" in v2.35.0 and v2.35.1) (#1220)
- every GitLab query is checked against a measured complexity score, so a query that grows past the cap fails a test before it ships (#1220)
- `worktree_provision` sets the upstream on a local branch that is already on origin (#1214)

### Skills

- new `mattstack:pr-usher` skill: an always-on agent that gets a repo's ready PRs reviewed, settles their threads with the author agent over rt chat, and merges them once CI is green; agents hand PRs to it through the new `pr-usher-handoff` rule (#1218)
- `mr_merge` takes `expectedHeadSha`, so a merge or enqueue is refused when the PR's head has moved since review (#1218)

### gitq

- the gitq web UI (`gitq board`) is removed; gitq is the CLI plus its five `/gitq:*` skills, and the `gitq.board` setting is retired (#1213)
- `absorb` run in a detached worktree returns it to its starting commit (#1217)

### Board

- the row spotlight follows its row through any re-layout (#1215)

### Tests and CI

- deck's DOM suite is green again and runs in CI (#1216)
- test files that went red on a loaded Mac wait on real events instead of the clock (#1212, #1219)
- `rt check` shows why a test failed (#1219)

### Held pins

- bun stays at 1.4.4 (1.4.5 is out), held for a later release
- Sparkle stays at 2.10.0 (2.10.1 is out); a Sparkle bump gets its own tested release

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.35.1...v2.35.2
