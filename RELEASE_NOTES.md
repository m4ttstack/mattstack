Every rt command now speaks through one output layer, and setup keeps itself current after an app update: the first launch on a new version re-applies the safe setup steps and runs one-time migrations. The switchboard address is built in, a Mac belongs to one team, team packs bind per pack in shared repos, and board reviews land as real GitLab reviews.

### Output

- every command's output and failures go through one output layer rendered by `rt-ui`, so text, tables, callouts and errors look the same everywhere; `--json` output is unchanged (#630, #639, #641, #643, #646, #648, #649, #651, #654, #655, #657, #659, #660, #661, #663, #672)
- static output picks its tones from the terminal's background; the new `rt.ui.background` setting (`auto`, `dark` or `light`) overrides the guess (#672)
- rows break at words and long refs, and tables, trees and diffs fit a narrow pane (#672)
- a CI guard fails any new command code that prints around the output layer (#630)

### Setup

- after an app update, the first launch runs `rt setup update`: pending migrations, then the setup steps that are safe to repeat, then the setup check, which notifies when something needs you (#613, #615, #616, #626)
- the update runs only where setup has finished, one run at a time; Finish starts one, and uninstall clears Finish so a reinstall opens setup again (#609, #626, #627)
- the app reopens setup until Finish is on record (#609)
- two migrations ship: peer asks start as soon as they arrive on Macs that have them on (#664), and the stored switchboard addresses are removed (#671)
- `--only` runs the step's prerequisites first, and a terminal `rt setup apply` talks to the app directly (#607)
- Claude settings get `crossSessionInbound: accept`, so messages from other sessions arrive without a prompt (#606)
- the plugins step skips the team marketplace until the team is cloned (#604)
- the Slack row waits for the team owner to accept a new member (#640)
- a board that did not peer is never silent: join says so and the Board peering row reports it (#608, #623)
- the proxy row offers no action on a build without the proxy installer (#624)
- bare `rt setup` shows its subcommand picker (#602)
- onboarding fixes: neutral not-yet states, share tips, and pack sync against an installed engine (#611)

### Teams and switchboard

- the switchboard URL is built into rt; invite, join, the peer waker and the board all use it, and the stored URL keys are retired (#671)
- one team per machine: a second team join or create is refused, setup reports an existing second team, and the console names the team (#634)
- the team pane's join button reads Rejoin this team (#637)

### Skills and packs

- each team pack keeps its own stage bindings in a shared repo, at `~/.mattstack/repos/<repo>/packs/<pack>/skills.jsonc`; the old merged file is renamed `.migrated`, and setup sets `board.defaultPack` when nobody has chosen one (#614, #622)
- review resolves a ticket id by search and guards the checkout ticket (#633)
- ship records the consented MR target and reopens its gate on resume only when the target changed (#631)
- board skills send the done write alone and last (#638)

### MCP tools

- GitLab reads go to GitLab directly instead of a cache; new `gitlab_get`, `project_labels`, `pipeline_list` and `branch_stack` tools (#628)
- `mr_comment_inline` resolves its anchor against the diff, and `mr_update_note` edits a note (#647)
- `mr_upload` trusts rt's evidence folder `~/.mattstack/evidence` (#618)
- `ci_watch` fails fast on blocking failures, child pipelines included, and its budget is a team setting, `ci.watch.budgetMinutes` (#612, #617)

### Board

- reviews land as GitLab reviews, round after round (#652)
- merge, rebase, auto-merge, doctor, respond, Slack post and resolve stay with the MR's author (#620)
- peer asks start in seconds, and the board shows what happened to an ask you sent (#653, #664)
- post an MR to its code owners' Slack channels (#645)
- a shorter row menu with flyouts and no hidden actions; one toast per row action, pending then done (#665, #669)
- launch, herdr lookup, switchboard token and ask hint fixes (#601, #610)

### Console

- a Graph tab shows how each skills pack is wired, with a skill drawer and an unsynced banner (#670)
- each settings row is one disclosure with a Value and Where it's set panel (#650, #658)
- gate context sits beside the form (#605)

### Chat

- herdr-aware agent cards, a members pill and docked cards in the room dropdown and sidebar (#629, #632, #636)
- a pane's session is read from its Claude process when herdr has none (#674)

### Menu bar app

- one readable daemon status line, a fuller app menu and a Help menu; the gear menu is gone and Troubleshoot is a submenu (#625, #635)
- the setup checklist shows a loading state (#625)
- the app watches deck and restarts it (#656)
- the Worktrees panel frees herd-held trees (#668)
- a dev app rebuild uses your own node (#619)

### Also

- `rt cron` refuses duplicate trigger names (#666)
- the default branch is never a stack member (#600)
- failed toasts get a coral edge and a cross (#673)
- boxscore drops the raw metric notes line (#603)

### Held pins

- portless stays at 0.15.6 (0.15.7 is out); it moves in a later release

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.19.0...v2.20.0
