Evidence boards go to you before upload, the board responds to one reviewer at a time, a root pointer for the org's data branch, version telemetry, and fixes for team packs and pipeline runs.

### Before you update

- **Version reporting is on by default.** So the mattstack admin can see who is on which version, the rt daemon sends a small report to the mattstack switchboard when it starts, about every 50 minutes, and when the app or rt version changes. It holds your username for each team and a random install id; the app, rt and plugin versions and the app flavor; your macOS version; which setup steps have run; the names of any leftover legacy folders; and your org names and layouts, team packs and their versions. It never sends your repos, files, paths or commands. Turn it off with the "Share version info with the mattstack admin" switch in Settings, General, Privacy, or with `rt settings set telemetry.enabled false --scope user`. [Version reporting](https://docs.mattstack.dev/start/settings#version-reporting) has the details (#886)
- **Team packs need this release.** The mattstack plugin's engine floor rises to 0.32.9, so a team pack compiled after this release installs only on Macs running v2.25.2 or later. A teammate on an older app keeps the pack version they have until they update (#883, #889)

### Evidence

- Ship shows you every evidence board it is about to upload, as thumbnails in the console or opened from the terminal, and nothing is attached until you answer. The redaction check shows the whole board (#889)
- A board that hides nothing must be confirmed before upload too (#888)
- A ticket image a run saved keeps its ticket mark when a later `evidence_record` call leaves out `source`, so a copy of the same bytes is refused on upload; `mr_upload` checks every run's ticket images, with or without `runId` (#877)
- An imported capture of a ticket image is refused as a copy too, even after the browser re-encodes it (#879)
- Ship's pair recording keeps a standalone import board as the before's cover, so it reaches the record and the MR (#881)
- `mr_upload`'s check for ticket-image copies reads only each run's evidence and compares recorded hashes, so it stays fast as runs pile up (#882)

### Board

- Respond answers one person at a time: their open review threads and Overview comments, with a round count per person. The row menu reads "respond to dev2 (round 2)", or opens a list of people when more than one has something open, and the lane line and decision header name the person. Overview comments get a reply, never a resolve. [Respond](https://docs.mattstack.dev/apps/board#respond) has the details (#892)

### Pipeline runs

- A finished run can be reopened on purpose: `run_stage start` with `reopen: true` (`--reopen` on the CLI), and ship re-captures the AFTER on a shipped MR without pushing or opening the MR again (#883)
- `run_stage start` refuses a stage that is already running and names the tool to use instead, and `rt skills compile` fails when a pack reads a run field nothing in the pack writes (#875)
- One budget convention across hosts, and the forge checkout and rebase gates move onto the gate tools (#878)

### Org and team packs

- The org's pointer on `main` moves to a single `.mattstack.jsonc` file at the repo root; rt reads it or the old `mattstack/mattstack.jsonc`. Each Mac also remembers which branch holds the org's data. An admin moves an existing org's pointer in two phases with `bun scripts/move-pointer-to-root.ts` (#880)
- New setup rows for the data branch: one when the branch is gone from the forge while your copy still has it, which an owner or admin restores with `rt team restore-data-branch`, and one when org data has been merged into `main` (#880)
- The org clone's daemon never commits or pushes a team pack's edits. Pack edits left unpublished for hours are saved to a copy on that Mac, and a new **Unpublished packs** row in setup status names the pack and how to publish it (`rt skills sync --pack <name> --commit-pending`) or throw it away (#876)
- The console's Surface tab lists only real skills, explains its switch and badges, and `rt skills surface set` refuses to make a template public (#885)
- `mattstack:model-tiering` is now a skill you can call (#884)

### Version reporting

- The switchboard keeps each Mac's latest report, and the mattstack admin opens the page with `rt telemetry open` (#886, #890)

### Worktrees

- Worktree ready steps load nvm and switch to the tree's `.nvmrc` Node, so pnpm and npm find Node on Macs where nvm is set up only in `~/.zshrc` (#887)

### Release tooling and bundled tools

- Fast Browser 0.1.16: compose confirms a board with no redaction marks (#891, #888)
- `rt release update-machine` retries when Apple's notary service can't be reached or answers with a server error, instead of reporting a missing profile (#874)
- The release skill reruns failures outside our code without counting them against the rerun budget (#873)

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.25.1...v2.25.2
