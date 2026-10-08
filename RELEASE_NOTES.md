An organizations release: one org can hold several teams with shared settings, the org's skills and board fills live in an org base pack, each team's pack moves to its own `plugin/` folder, and members move onto the new layout on their own. The board gets an asks inbox, the docs site gets board and flock guides, and the StrongDM picker groups by tags.

Macs update to v2.21.1 first, then to this release: Sparkle offers v2.21.1 to a Mac still on v2.21.0 and this release only after it.

### Organizations and teams

- one org can hold several teams, with org and team settings and shared write permissions decided by role (#667)
- the org clone lives under `~/.mattstack/orgs/<org>`, and `rt setup update` moves an older clone there and keeps its folder named after the org (#727, #731)
- `rt team rename` renames your org on this Mac and for every member at their next update (#730)
- rt follows whatever branch the org clone has checked out, so an admin can try a breaking change on a branch (#722)
- `rt team join` refuses a stale invite and clones only the folders rt uses (#728, #741)
- the org marker carries a layout version: a member's Mac holds a pull onto a layout it cannot read, shows one calm row asking to update, and moves itself onto the new layout when the app and the org are both ready, in either order (#744)
- the org folder step no longer reports a clone already in place as a second copy (#739)
- `rt dev setup` and `rt dev update` for collaborators (#715)

### Skills

- an org base pack shares its attachments and board fills with every team pack that extends it, and compile copies them in with their provenance (#729, #733)
- a team's pack lives at `mattstack/teams/<team>/plugin/`, beside its settings; an older layout is converted once by the org admin (#737)
- compile warns about a link in a copied base attachment that the team pack cannot satisfy (#740)

### Console

- the Wiring page tells an org base pack apart from installed plugins, badges base copies and shows their history (#734)

### Board

- an asks inbox: an agent from another member's board asks before it acts on your MR, and waits for your OK (#721)
- one re-review latch per reviewer, and a bot's resolvable thread no longer waits on the author (#724, #738)
- your drafts stay off the All view and out of every count, and Show chip counts match what each chip shows (#714, #719)
- a long gate question collapses to a count on the row, and a thread's outcome chip stays whole beside a long path

### Boxscore

- viewer roles, and a preview of a member's Self view (#713, #717)

### Chat

- every speaker gets a distinct avatar colour and creature (#735, #736)

### StrongDM

- the sdm picker groups resources by StrongDM tags, read from the team's `sdm.*` settings (#742)

### Gates

- no false "answer not delivered", and focusing an MR's gate opens its live pane (#725)

### Docs

- docs.mattstack.dev, with new board and flock guide pages (#716, #720, #748)
- the orgs root, `rt team rename` and base pack attachments are documented (#732)

### Release

- a release can require an intermediate update, so Sparkle never skips it (#747)
- fast-browser 0.1.10, glab 1.121.0, cloudflared 2026.10.0 and portless 0.15.7 (#743)

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.21.0...v2.22.0
