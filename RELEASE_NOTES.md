Each org on the switchboard now has its own token, and the relay keeps every board inside its own org. This release also carries the rt that org owners and admins need for the move off the shared relay token.

### Switchboard

- each org on the relay gets its own switchboard token, minted by the relay operator; the relay records each board's org, and today's boards and invites move into one org without any board being cut off (#1292)
- people lists, direct messages, broadcasts, inbox waking and support stay inside the sender's org, and a username another org already holds is refused (#1292)
- rt picks the org's switchboard token and never uses or sends the relay operator's token kept on a Mac; joining no longer reads the member-wide team secrets (#1292)
- `rt team admin-secrets` shares only an org token, and `--token-stdin` reads it from standard input (#1292)
- `rt team create` says what it is waiting for (#1292)
- the **Admin-only secrets** setup row names each place this Mac keeps the relay operator's token and how to remove it, and says when the org shares the operator's token instead of its own; the **Board peering** row tells the two tokens apart too (#1292)

### rt

- `rt servers` finds servers it used to miss: ones started by an agent, with no working folder or a space in their path, in a worktree git no longer lists, or under fish with `-lC` or `--init-command=`; filtering matches each row's port and worktree name, and the command ends cleanly (#1287)
- the daemon names a node or bun agent by its script instead of its first interpreter flag (#1289)
- the daemon's org clone status reads no longer take `index.lock`, so they stop failing a git command another process starts meanwhile (#1285)

### Plugins

- the chat sign-in hook gives up after about 4 seconds when the rt daemon is down (#1288)
- **Force stop** on a Human Todos run in a herdr pane kills the run's process group, so a run that ignores Ctrl-C ends; a run started before this release falls back to Ctrl-C and says so (#1286)

### Dev app

- the dev app's automatic update holds with a reason when a status read, pull or install fails instead of quietly falling behind, skips when no dev app or a locally built one is installed, shares its lock with a hand-run `rt dev update`, and treats a failed release lookup as unchecked rather than current (#1290)

### Held pins

- zstd 1.5.7 (1.6.0 out), gh 2.105.0 (2.106.0 out), glab 1.131.0 (1.133.0 out), bun 1.4.4 (1.4.5 out) and cloudflared 2026.11.1 (2026.11.2 out) stay on their current pins
- Sparkle 2.10.0 (2.10.1 out) stays: a Sparkle bump ships in its own tested release

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.38.0...v2.39.0
