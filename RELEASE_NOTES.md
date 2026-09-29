A teammate's first install surfaced a run of setup snags; this release fixes them. Setup finds tools installed off PATH, asks forge and Slack tokens for the scopes the board actually uses, clones big repos reliably, and a fresh install serves deck and opens View Logs on the first try. Boxscore also gets its redesign.

### Setup and joining a team

- checklist row actions that run a setup step now answer the prompts that step asks for, so installing the proxy from its row no longer hangs (#579)
- the join note stays readable before Continue, and the Fast Browser row passes the marketplace source to its setup (#577)
- a mattstack marketplace added from the same repo counts as present, and the plugins row shows claude's own error (#578)
- plugins that are already enabled are no longer errors; verify lists accounts still to connect as "to connect" instead of failing; uninstall removes marketplaces by name (#580)
- the Slack account row shows wherever verify needs it (#583)
- team tools installed in `/opt/homebrew/bin`, `/usr/local/bin` or `~/.local/bin` are found even under the app's minimal PATH (#584)
- repo access rows probe with rt's stored forge token, and offer Connect when there is none (#584)
- a Slack redirect mismatch says exactly which Redirect URL to add to the Slack app (#584)
- the clone step survives big repos, names what failed, and reuses a clone that is already there (#581)
- member GitLab tokens ask for `api`, so the board can post reviews (#589)
- Slack connect asks for the user scopes the board reads and reacts with (#590)
- clones rt makes keep a remote they can fetch from: rt's token is offered to git only for that forge's host and only when git's own credentials fail, and a clone uses SSH when your key works (#591)

### Apps

- boxscore is rebuilt on the app-kit chrome with five metric groups, a person page and evidence panels; its settings move to the console (#573)
- console and chat drop their own app switcher, and board gets the System/Light/Dark control (#573)
- board's default stale window follows each repo's rt sync window, so a fresh install no longer shows the "align configs" banner (#588)
- a bundled deck creates its own record and routes on boot, so `deck.mattstack` answers on a fresh install, and it finds portless, cloudflared and railway off PATH (#586)
- View Logs bundles logdy, finds it off PATH, opens exactly one tab, and never opens a dead page (#576)

### Release and build

- `rt release apps` replaces `rt release app <name>` and releases every served app that changed in one patch, kit changes included (RT-307, #575)
- the clean-room walkthrough covers the proxy row and a `join` scenario for joining an existing team (#585)

### Bundled

- fast-browser 0.1.9; the catalog's fast-browser plugin moves to match (#587)
- when the bundled fast-browser is in use, rt owns `~/.local/bin/fast-browser` and repairs a launcher left pointing at a deleted copy (#582)
- glab 1.120.0 (#592)

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.17.0...v2.18.0
