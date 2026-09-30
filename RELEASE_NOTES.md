A team can now turn the worktree pool on for everyone who joins, and intercept shims stay installed without a manual step. Settings writes stop printing a warning-looking line when the daemon will sync them.

### Worktree pool

- a team can set `rt.worktreeApp` `{"enabled":true}` to turn the worktree pool on for its members; a member's user or machine setting still overrides it (#594, #596)
- `rt.worktreeApp` resolves through the normal settings resolver, so `rt settings get`, the console and the daemon always agree; the pool is on only where a setting says `enabled: true` (#596)
- answering the Claude hook offer records only that answer, and no longer saves the pool as off (#594)

### Setup and settings

- rerunning a single setup step that feeds intercept rules (such as `repos.clone`) reinstalls the shims afterwards, and the daemon reinstalls them after a team pull that changes the rules (#595)
- a settings write prints nothing when the daemon will sync it; a short note appears only when a change cannot sync (no remote, or sync turned off) (#594)
- a CI guard fails any new code that reads settings layer by layer or opens a settings file directly outside the resolver (#597)

### Apps and build

- boxscore caps its page content at 1680px, centred (#593)
- a dev app rebuild writes the app-build and install output into its log, so a failure shows the real error (#598)

### Bundled

- gh 2.102.0; the catalog's fast-browser plugin moves to fast-browser main (#599)

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.18.0...v2.19.0
