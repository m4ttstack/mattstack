A small safety update ahead of a change to how team settings are laid out. A Mac on this version keeps its team settings as they are when the team's repo moves to a newer layout, and asks you to update the app instead of pulling something it cannot read.

### Teams

- the background team sync holds when the team repo's next commit uses a newer org layout than this app reads, and keeps your current settings, board and skills in place (#745)
- `rt skills sync` holds the same way before it pulls a team pack (#746)
- Setup status shows one row asking you to update the app while a pull is held, and never suggests resetting your team folder (#745)
- `rt team pull --json` names the hold when there is one (#746)

### Held pins

- fast-browser 0.1.9, glab 1.120.0, cloudflared 2026.9.3 and portless 0.15.6 stay as they were in v2.21.0; their updates ship in the next release

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.21.0...v2.21.1
