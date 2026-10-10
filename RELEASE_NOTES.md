An evidence and safety release: pipeline evidence moves to evidence@2, where every screenshot is captioned or waived and can carry a light and dark pair, and team packs now declare the mattstack engine they need, so a Mac never installs a pack its app can't run. Deck gains live mode, and glitter handles a pull blocked by local changes the way GitHub Desktop does.

From this release on, a team pack or mattstack plugin that needs a newer app than yours is held at the version you have, and setup shows one row asking you to update the app. Macs still on v2.23.0 or older don't check, so update when it's offered.

### Teams and packs

- team packs and the mattstack plugin carry an engine floor; a pack this app can't run is held at its installed version, and a fresh install skips it, until the app updates (#798)
- a held pack shows as a row in setup naming the app update that unlocks it; it never blocks Install (#798)
- `rt skills sync` and `rt skills init` refuse a pack whose engine floor this app can't run (#798)
- `rt --version --json` prints rt's version, the mattstack engine it runs and its flavor (#798)

### Evidence

- evidence@2: a run's evidence is a list of cases, each image captioned or waived with a reason, with an optional light and dark pair (#791)
- the evidence, ship and standalone ship stages record every image before anything uploads, and every evidence upload names its run (#794)
- an upload tied to a run refuses a file the run's evidence record does not list (#791)
- `runs:evidence` serves a v2 record's transcript (#797)

### Console

- the run page shows every evidence case with its captions and waivers, and a light and dark toggle, in the record, the story rows and the compare view (#796)

### Deck

- live mode in the dev app: run a mattstack app from source, from the shared checkout or one of your worktrees, reloading as you edit, from the LIVE column or `deck live <app> on` (#787)
- deck's live sources and `rt cd` pick worktrees by one shared rule (#788)

### Glitter

- a pull blocked by local changes opens GitHub Desktop's stash and continue dialog, and a failed pull reports git's own error and the files it lists (#795)

### Board

- review-request picks are labelled by the person's name
- the board says "no teammate left to ask" when no one else can be asked for review

### Skills

- model-tiering names a model and an effort for each kind of work: sonnet for mechanical work, reviews scaled to size and risk, fable kept for escalation (#789, #790)

### Bundled tools

- Fast Browser 0.1.11: its browser agent runs on haiku and escalates to sonnet only, never opus or fable, and can ask the session that started it for help (#792, #793)

### Release tooling

- the marketplace catalog is validated first and published just before the release is created, and never publishes an older mattstack plugin (#798)
- the release asserts the engine baked into rt matches the mattstack plugin (#798)
- update-machine says an unreadable notary profile may only mean a locked keychain
- the VM harness skips the forge connect when that setup row is already ready (#785)

### Held pins

- glab stays at 1.121.0 (1.122.0 is out), held to the next release
- bun stays at 1.4.2 (1.4.3 is out), held so this release changes only our own code

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.23.0...v2.24.0
