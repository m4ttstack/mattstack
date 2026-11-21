gitq recovers a stack whose parent was squash-merged, and test runs can no longer open the real ~/.mattstack databases.

### gitq

- `sync` reads the stack's MR states first: a branch whose MR merged is marked merged and left alone, and its children move past it from their recorded fork points (#1209)
- `sync` leaves a merged branch that has commits after its merge as it is, and says so; if the forge can't be read, it restacks with the states it has (#1209)
- `remove` takes a merged branch that still has children, handing them to its nearest unmerged ancestor for the next sync to restack (#1209)
- `reparent` replays only the branch's own commits from its recorded fork point, so it works after the old parent's branch is deleted, and onto the root it lands on `origin/<root>` (#1209)

### Tests and CI

- a test run throws before it opens a database in the account's real ~/.mattstack (the daemon's gates, herd, events and claims stores, and the runs database) (#1210)
- every home path reads HOME, so a test run's scratch HOME holds (#1210)

### Docs

- the gitq pages cover `sync`'s MR state read, `remove` on a merged branch and `reparent` from the fork point

### Held pins

- bun stays at 1.4.4 (1.4.5 is out), held for a later release
- Sparkle stays at 2.10.0 (2.10.1 is out); a Sparkle bump gets its own tested release

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.35.0...v2.35.1
