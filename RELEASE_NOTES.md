The board's code owner Slack posts can carry a team prefix, and each channel gets its own editable message. Row notes are redesigned, and gitq smooths seven rough edges found while restructuring a real stack.

### Board

- code owner posts can start with a team-shared prefix (the new `board.slack.ownerPrefix` setting), and the post to Slack dialog gives each channel its own editable message (#1205)
- the row note is redesigned: one line on the row with how long ago it was saved, links shown by their site, and editing in place (#1206)
- **mark ready** leads the row menu on your own draft
- **open in Slack** rows end in an outside-link arrow, and the team review row gets its spacing back

### Console

- running stages show a spinning ring, and the app bar's separators are quieter (#1202)
- the waiting banner is tighter

### gitq

- `publish` links a branch's open MR instead of opening a duplicate, and falls back to the main checkout's token grant from an rt worktree (#1201)
- `fold` names the open MR and remote branch it leaves, and `fold --close-remote` retargets the children's MRs, closes the folded MR and deletes the remote branch (#1201)
- `split --at` restacks the children it reparents, `split --files` names the children it leaves, and `reparent` onto the current parent rebases a branch left behind (#1201)
- `gitq stacks` prints tree order, and `add` picks the only empty stack on a shared root (#1201)
- the restructure skill and usage now say `<lastKeptSha>` stays on the branch (#1201)

### App

- a window tab whose stylesheets failed to load retries on its own (#1200)

### Tests and CI

- a test run that ends with an exit code set now fails, and console tests pin UTC and en-US (#1208)
- e2e daemons bind port 0 and wait for their log lines instead of fixed sleeps (#1204, #1207)
- test runs keep the runs folder and herdr socket under their own HOME, and the preload scrubs agent and config env (#1203)

### Docs

- the deck README says deck installs with the mattstack app, not a curl installer

### Held pins

- bun stays at 1.4.4 (1.4.5 is out), held for a later release
- Sparkle stays at 2.10.0 (2.10.1 is out); a Sparkle bump gets its own tested release

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.34.0...v2.35.0
