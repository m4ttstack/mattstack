---
paths:
  - "lib/setup/**"
  - "commands/setup.ts"
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

## Setup rows: the form, the bar and Finish

Setup is screens drawn from one verb and one run. `rt setup form` (hidden,
`commands/setup-form.ts`, `lib/setup/form.ts`) answers which screen setup is
on (`formStage`: macos, path, invite, waiting, connect, this-mac, tools, running,
paused, ready) and each section's rows (`--section macos|invite|restore|connect|this-mac|tools|create`).
`tools` holds a finished Mac whose only blockers are team tools or their
accounts, or that was told about a tool, until Done acknowledges it (`--ack-tools`).
A first run can land there too, since an ok run records Finish with such a tool
open; only a status window closes on Done, any other goes on to rt's stage.
The tray draws what it returns: no decision in Swift about which rows a
member needs, where setup resumes or a row's state. A run still going
outranks the macos stage, and P1 skips rt's read for the cards only on a Mac
the last whole read saw as fresh. A done row answered no (notifications
off) carries `tone: "off"`, drawn as a grey dash; the tray keys on `tone`,
never the detail's words. A tools row whose install failed carries
`tone: "failed"`: its `action` is the same install labelled Retry, its
optional `secondary` opens the manual steps (`teamToolManualSteps`; left out
when the team declared no install route), and its `detail` is the failure,
drawn in the failure colour beside the buttons in place of the subtext. The
app's own error is not drawn under it, since rt's re-read carries the failure.
It stays open and holds Done. An app older than `failed` reads the tone as
unknown, skips `secondary` and draws Retry with the failure as a plain
reason. `rt tools install` records its outcome in the accounts prepare
record's `pressFailed` list (`recordToolInstall` in `lib/setup/prepare.ts`), so
a press reaches that row the way a background install does: a failure adds or
replaces the tool's entry, a success removes it, a missing record is written as
already ended, and a running one is left to its owner. `failed` belongs to
`runPrepare` and `pressFailed` to the press; `installFailure` reads only
`failed`, so connect rows never change for a press, `toolRow` reads
`pressFailed` first, and `runPrepare` re-reads `pressFailed` right before its
first write and carries it across the rest. The press write has no lock. Two
presses or a starting run can lose an entry, which leaves a plain Install row.
A press landing on a run's first write can also make the record read ended
until the run's next write. The window is a few file calls, and the tools screen
starts no run. Neither list counts once the tool reads ready. A tools row whose action is an install
also carries `waiting`, so a press shows Installing. `detail` is a string in the tray, never null: a plain tools row (a
tool simply missing or signed out) sends an empty one, so no reason repeats
its button. `toolsRows` does that itself, since `extraRow` and `signInRow`
also draw the connect screen, whose rows keep their reason. `rt setup prepare
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
- a leftover on the this-mac screen after an ok run with no intent since, for a
  blocking row the run should have set up and did not (`runFixes`, `RUN_FIXES`,
  `extraRows` with `afterRun: true`); `formStage` lands it on this-mac, not the bar.

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
row with a `detail` shows it as rt's reason under the subtext. An action type the
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
whenever a run lands on ready or tools. App updates are held while
setup runs, window or not.

## Setup after an update

`rt setup update` is what the app runs at every launch once its services
settle (`AppDelegate.settleAgentsAfterLaunch`); rt decides whether anything
happens (`lib/setup/update.ts`: setup not finished, already stamped for
this version with no migration pending, or run), and only one run at a time holds
`~/.mattstack/rt/setup-update.lock` (`lib/setup/update-lock.ts`); a second
one reports `skipped: "running"`. A run is `org.folder` and `org.pull`, then
pending migrations, then `team.identity` and the other `StepDef`s with
`updateSafe: true`, then `verify`, through `runUpdateWith` in
`lib/setup/apply.ts`, so a migration that reads the org sees the clone at
`orgs/<org>` holding what its checked-out branch holds on origin now. No failed outcome stops it, and a migration that
throws is one more failed item; only a step that throws a plain error
ends the run, as a bug (exit 1, no stamp). Otherwise the version is
stamped in `~/.mattstack/rt/setup-state.json` whatever the outcome. A
stamped version runs again at each launch while any migration is still
unrecorded on this Mac (`decideUpdate`'s `retry`), so one that failed or
waited finishes without a release or `--force`. A retry runs only
`org.folder`, `org.pull` and the pending migrations: no other step, no
`verify`, no `apps.restart`, no stamp change and no notification, so a
stuck migration costs little per launch and a broken item still nags once
per release. Two
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
runs once per machine and is recorded when `done` or `skipped`. One that
must wait for something outside this Mac (an org layout this rt does not
read) returns `partial`: unrecorded, so it runs again, and no notification. The tray
only spawns the verb and routes the `setup_update` notification click to the
Setup status window; put no decision in Swift.

## Org requirements

`readPackRequirements` folds `org/requirements.jsonc` into the team's one
`PackRequirements` entry. Nothing may add a second entry: `setupPackFlow`
(`lib/setup/pack.ts`) reads `reqs[0]`, and `toolRows` draws a `pack.*` row per
entry. A team with no pack file gets an `orgOnly` entry, which both readers
skip as a pack. An org file's error stays on `orgError`, drawn as the
non-blocking `org.requirements` row; it never reaches `error`, which fails the
pack stage. A pack's `excludeOrg` removes the org tool of that name, the
integration it connects and an org integration of that name; a name matching
nothing is ignored, so a tool the org later drops is no error. A whole form
read carries that row as `orgNotice`, which the Setup status window draws as a
note on ready; it never moves a stage, a button or Finish.

A finished Mac hears about a new required tool from the daemon's pull hook
(`lib/setup/tool-notices.ts`). What was said lives in
`~/.mattstack/rt/tool-notices.json`, not `setup-state.json`: `updateSetupState`
has no lock, and a daemon write during a run could lose a migration id. A tool
must read `missing` on two pulls in a row before it notifies, because a false
result reaches every member at once; an error or a timeout is unknown, not
missing. A told name drops off once Done acknowledges it or the team no longer
requires it, unless the read failed, so a tool that returns notifies again.

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
