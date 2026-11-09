The mattstack download is about half its old size. console and boxscore take on chat's look, and any Claude pane can now ask for a Slack support chat with a teammate.

### Install and updates

- the dmg drops from 943 MB to 454 MB and the update zip from 957 MB to 445 MB: board, console, chat, boxscore, deck and gitq now run on the app's one bundled bun instead of each carrying its own (#1053)

### Apps

- chat, console and boxscore share one look from the kit: type, menus, dialogs and an inset page sheet, with each app keeping its own color (#1059)
- a color scheme picked in one app applies to the others on this Mac (#1059)
- the app window's viewer tints follow the app's color (#1059)

### Console

- **Packs** uses Config's terms, groups fills by the pack they come from, adds an org base pack view, and lists a block's files with their roles (#1059)
- **Compile Skill Pack** asks first, on the **Config** and **Changes** tabs alike
- **Changes** gains a **Waiting for compile** row that names the stale skills and the outside sources that moved, and opens the diff a compile would write
- **Discard** leaves the page: a hint beside **Publish** names `rt skills discard`
- a setting no layer sets opens on its default with a note, a save alert follows an edit, and a JSON error shows as an alert when you leave the field
- on **Usage**, each row shows its MR's state with a button to open it

### Board

- each tab remembers its own badge filters and roster pick

### Slack support

- any Claude pane can ask for a Slack support chat with a teammate: you approve it in a form, a background agent holds the DM, and it reports milestones back to the pane that asked (#1056)
- a closed chat can be picked back up: for 60 minutes, a teammate message that starts with the trigger offers you a resume, and you can resume one yourself at any time (#1056)
- Flock can resume a closed chat on your tap (#1057), and a chat started from Flock sends its milestones to you (#1058)
- the bot goes by **Maude** unless you set `chat.slackSupport.persona` (#1056)
- support agents open in a `support` workspace, one tab per teammate, and the start dialog can name an agent to keep posted

### rt

- `rt agent start` hands back the live Claude agent when its label's tab is already open, instead of failing, so Flock's Slack chat no longer reads "no agent" (#1051)
- agent panes run the repo's `.nvmrc` node on nvm machines (#1054)
- agent panes, `rt sync`, `rt git rebase` and `rt git reset` find an ssh-agent that holds your key when the pane's own has none (#1055)

### Held pins

- glab stays at 1.127.0 (1.128.0 is out), portless at 0.16.0 (0.17.0 is out) and Sparkle at 2.10.0 (2.10.1 is out); Sparkle gets its own release

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.30.1...v2.31.0
