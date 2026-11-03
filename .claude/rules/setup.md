---
paths:
  - "lib/setup/**"
  - "lib/skills/writing-style.ts"
  - "commands/setup.ts"
  - "commands/skills-writing-style.ts"
  - "rt-tray/Sources-core/Contract/PlanModels.swift"
  - "rt-tray/Sources/AppDelegate.swift"
  - "rt-tray/Sources/NotificationManager.swift"
  - "rt-tray/Sources/Setup/**"
  - "rt-tray/Sources-core/Launch/NotificationClick.swift"
  - "lib/home/restore.ts"
  - "commands/setup-form.ts"
  - "commands/setup-prepare.ts"
---

# Setup

## Writing-style presets

Every review or reply an agent drafts composes in one writing style, resolved
by `resolveWritingStyle` in `lib/skills/writing-style.ts`: the
`skills.writingStyle` setting (user scope beats team), else its registry
default, `mattstack:writing-style-conversational`. A Mac where no store sets
the key reads as not chosen yet (`source: "fallback"`), which the
`skills.writing-style` row reports in the tray's Settings, General.
`rt skills writing-style show`
prints the resolved skill and its source with the one wording the setup row
also uses (`WRITING_STYLE_SOURCE_LABEL`), so never restate it elsewhere.
`use` refuses a skill id that is not installed and `new` copies a preset into
the user's own skill, normalising CRLF and renaming the frontmatter so the
copy is a skill of its own. The presets themselves ship in the mattstack
plugin under `plugins/mattstack`; a preset id must exist there before
`use` will accept it. A new Mac gets sparse in its setup run: when no store sets
the key, `settings.seed` writes `mattstack:writing-style-sparse` at user
scope. It never writes one on an update run or on a finished Mac, so the
registry default stays as it is for anyone who never chose. The
`skills.writing-style` row never blocks Finish.

## Setup rows: the form, the bar and Finish

Setup is screens drawn from one verb and one run. `rt setup form` (hidden,
`commands/setup-form.ts`, `lib/setup/form.ts`) answers which screen setup is
on (`formStage`: macos, path, invite, waiting, connect, this-mac, running,
paused, ready) and each section's rows (`--section macos|invite|restore|connect|this-mac|create`).
The tray draws what it returns: no decision in Swift about which rows a
member needs, where setup resumes or a row's state. A run still going
outranks the macos stage, and P1 skips rt's read for the cards only on a Mac
the last whole read saw as fresh. A done row answered no (notifications
off) carries `tone: "off"`, drawn as a grey dash; the tray keys on `tone`,
never the detail's words. `rt setup prepare
<macos|accounts>` (`lib/setup/prepare.ts`) runs the installs setup can do
while the member answers: Command Line Tools at the macos stage; Claude
Code, herdr, the team's sign-in and required tools, then Fast Browser's
setup (so Add to Chrome is ready on the connect screen) at the accounts
stage, once the member is approved. Each stage keeps a record the form reads
to draw a row as installing. The bar is one `rt setup apply` holding
`setup-apply.lock` (`lib/setup/apply-run.ts`): it records every event and
finished step, so the app spawns `--resume --unattended` at a launch or
relaunch, which attaches to a live run or resumes a dead one. `--unattended`
makes a step that would raise an admin prompt pause the run instead; a
person's Retry runs without it, or with `--from <step>`. Nothing the bar runs
may raise a dialog or open a browser: a step that would must pause (the paused screen).

A row's `required` blocks Install (the run); `finishGated` blocks Finish and
never Install (`finalizePlan` and `finishBlockers` in
`lib/setup/contract.ts`), except a required `FINISH_GATED_ACCOUNT_IDS` row,
which blocks both, since Install steps such as `linear.mcp` read it. Finish waits on `tool.fast-browser-extension`
(`FINISH_GATED_ROW_IDS`), the team's accounts (`FINISH_GATED_ACCOUNT_IDS`,
`account.slack` and `account.linear`), the `repos.place` rows, the
approval-wait rows (`APPROVAL_DEPENDENT_IDS` in `lib/team/approval.ts`,
gated by `applyApprovalWait` in `lib/setup/plan.ts` while a join waits;
`account.board-peering` never), and every `finish` target in `ROW_TARGETS`
(`lib/setup/expectations.ts`), which are the rows Install sets up. Every row
that blocks Install or Finish must have a screen, or setup can never end:

- a form row its section draws as its own (`formOwnedIds`);
- an extra row on the connect screen, for a blocking row no section draws
  that the run cannot set up (`extraRows` with `afterRun: false`);
- a leftover on the this-mac screen after a run that ended ok, for a
  blocking row the run should have set up and did not (`runFixes`,
  `RUN_FIXES`, `extraRows` with `afterRun: true`). `formStage` lands such a
  run on this-mac, never back on the bar. An intent on disk means a choice
  made since that run (a team created from Settings on a Just me Mac), so
  no leftover shows: the coming run sets those rows up, and its team step
  publishes the repo `rt team create` never pushes.

A new blocking row that fits none of these strands the member. A `settings`
target (`tool.mission-control`, `tool.chrome-signin`, `skills.overrides`) is
never required and never finish-gated, carries no `waivable`, and shows only
in the tray's Settings (`SettingsExtras`: General's Keyboard and Skill
overrides sections, the Fast Browser pane), never in setup. Those three stay
in `WAIVABLE_ROW_IDS`, so a stored waiver still reads on the row and
`rt setup unwaive` can still clear it; `waived` is what the app keys on,
never the note's wording. A finish-gated row carries `waivable` on every
emit (an app reading a row without it treats the row as waivable).

A required row with a fault must offer an action that can clear it: an
actionless required row is an Install nobody can reach. On the fast screens
a `steps` action opens rt's steps in a sheet (`FormActionRunner.sheet`), a
`choose` wider than a two-option segment opens a picker sheet, and a todo
row shows its `detail` as rt's reason under the subtext. An action type the
app does not know draws "Needs a newer mattstack", and its row still holds
the footer while rt counts it open. A pack tool's Download link is offered
only over https; any other `install.url` falls back to steps. A connect action may
prefill a field through `ConnectField.value`; the tray renders it as the
field's initial text. It may also carry `create`, a link opened in the
browser: for the forges that is the new-token page with rt's scopes
pre-checked, and `lib/setup/token-create.ts` holds the required list (the
field hint and the post-paste check read it) and the link's extra pre-checked
scopes (the link alone reads them), the only place either lives, so a scope
rt newly needs is added there and nowhere else. A team's declared forge host
is shown, never trusted: Create token and the token check reach only a host
the member confirmed with `rt setup gitlab connect --host <host>`
(`rt.integrations` at user scope). Until then the forge token row offers that
command as steps, not a token field. Add a row by following an existing
validator in `lib/setup/validators/` and its `steps-*.test.ts` twin; the
tray's `PlanModels.swift` decodes the same contract, so a new field needs the
Swift side too.

On an unfinished Mac the tray asks macOS for nothing before the macos
screen: no notification prompt, login item or Mission Control notice at
launch (`LaunchPrompts`). The login item registers when setup finishes, or
whenever a run lands on ready. App updates are held while
setup runs, window or not.

## Setup after an update

`rt setup update` is what the app runs at every launch once its services
settle (`AppDelegate.settleAgentsAfterLaunch`); rt decides whether anything
happens (`lib/setup/update.ts`: setup not finished, already stamped for
this version, or run), and only one run at a time holds
`~/.mattstack/rt/setup-update.lock` (`lib/setup/update-lock.ts`); a second
one reports `skipped: "running"`. A run is `org.folder` and `org.pull`, then
pending migrations, then `team.identity` and the other `StepDef`s with
`updateSafe: true`, then `verify`, through `runUpdateWith` in
`lib/setup/apply.ts`, so a migration that reads the org sees the clone at
`orgs/<org>` holding what its checked-out branch holds on origin now. No failed outcome stops it, and a migration that
throws is one more failed item; only a step that throws a plain error
ends the run, as a bug (exit 1, no stamp). Otherwise the version is
stamped in `~/.mattstack/rt/setup-state.json` whatever the outcome. Two
other verbs feed that stamp: a full, `--from` or `--resume` `rt setup apply`
that ends ok stamps it too, unless a migration is still pending, and records
Finish once nothing blocks it, both before it lets go of the run lock and
sends `done`; `rt setup finish` starts an
update run of its own, since the launch-time one skipped the Mac while setup
was open. A whole `rt setup form` read (no `--section`) after a run that
ended ok records Finish the same way, so a leftover fixed by its own action
needs no second run; `lib/setup/form.ts` owns which screen setup is on
(`formStage`).

Every run that ends restarts every app deck serves for rt, so none keeps
code from before the run: `apps.restart` (`lib/setup/steps/apps-restart.ts`)
is the engine's end step, run after a failed step too, in a whole
`rt setup apply` (after Finish is recorded, before the run lock lets go) and
in an update run (after `verify`). It runs `deck restart --managed`, so deck
decides which apps count, and never fails a run: a restart deck refuses is
`partial`. Its wait for the apps to answer has one short deadline, so a hung
deck never holds a run's `done`. `board.restart` stands down in a run that
ends this way, and the end restart clears its pending mark once deck says it
restarted the board, so the board restarts once. An attach and a skipped update run restart
nothing. An `--only` run that ends ok restarts nothing either but sets
`appsRestartOwed` in setup-state. The end step clears it whatever its
outcome (Finish's own restart only on done or skipped), and `rt setup finish`
restarts only while it is still set after its own update run, so a whole
run's restart is never repeated as P7 opens the board. `rt uninstall` that ends ok and keeps `~/.mattstack` takes Finish,
the update stamp, the Install stamp (`installRanAt`) and the last run's record
(`run`) off the record, so a reinstalled app opens setup again with rows only
Install sets up waiting for it, and its form never finishes on the old run. Mark a
step update-safe only when it is idempotent, never calls `ctx.need`, and
never overwrites a value the user chose; under `ctx.update` it also leaves
alone what the member undid since rt put it there (a disabled or removed
plugin, an editor setup-state has no record of).
`lib/setup/__tests__/update-safe.test.ts` pins the set. Add a one-time fix as a `MigrationDef` in
`lib/setup/migrations/index.ts` with a dated id that is never renamed; a
migration changes only this Mac and never writes the org or team stores (a
change there is an admin's `rt settings set` or a layout change, see the
`rt:settings` skill); it
runs once per machine and is recorded when `done` or `skipped`. The tray
only spawns the verb and routes the `setup_update` notification click to the
Setup status window; put no decision in Swift.

## Your repos

The "Your repos" group is one `repos.place:<identity>` row per tracked repo,
from `lib/setup/validators/repos.ts`. The rows and `rt setup repo place`
resolve placements and clashes through `lib/setup/repo-placement.ts`, so they
never disagree; change a rule there, not in either caller. `rt setup repo-root
set` records the folder new clones go in. No plan row asks for it; on a Just
me Mac the this-mac screen draws it as the `repos.root` form row
(`repoRootRow` in `lib/setup/form.ts`), the only repos row that path has.

## Move from another Mac

The restore path's Restore runs `rt home restore <org>/<repo> --stdin`
(`lib/home/restore.ts`), the recovery key on stdin and never in argv: it
imports the key, clones the home repo through `rt home init`, then records
the restore intent, which moves `formStage` on to the bar. That order is
load-bearing (init with no key mints one and then cannot open the cloned
secrets), and every step skips what is already in place, so a rerun finishes
a partial one. A key already on this Mac that differs from the pasted one is
never overwritten, because it is also this Mac's team identity: the verb
refuses and names `rt home key import --force` for the person to run.
