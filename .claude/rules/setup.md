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
---

# Setup

## Writing-style presets

Every review or reply an agent drafts composes in one writing style, resolved
by `resolveWritingStyle` in `lib/skills/writing-style.ts`: the
`skills.writingStyle` setting (user scope beats team), else its registry
default, `mattstack:writing-style-conversational`. A Mac where no store sets
the key reads as not chosen yet (`source: "fallback"`), which is what the
setup row asks about. rt no longer reads `~/.mattstack/user/skills/preferences.md`;
the `2026-10-10-import-legacy-settings` migration copied its `writing-style:`
line into the user store.
`rt skills writing-style show`
prints the resolved skill and its source with the one wording the setup row
also uses (`WRITING_STYLE_SOURCE_LABEL`), so never restate it elsewhere.
`use` refuses a skill id that is not installed and `new` copies a preset into
the user's own skill, normalising CRLF and renaming the frontmatter so the
copy is a skill of its own. The presets themselves ship in the mattstack
plugin under `plugins/mattstack`; a preset id must exist there before
`use` will accept it, and the `skills.writing-style` setup row is
finish-gated and not waivable, so a machine with no resolvable style cannot
Finish.

## Setup checklist rows: required vs finish-gated

A row's `required` blocks Install; `finishGated` blocks the wizard's Finish
and never Install (`finalizePlan` and `finishBlockers` in
`lib/setup/contract.ts`). A finish-gated row must carry `waivable` on every
emit (an app reading a row without it treats the row as waivable) and only
ids in `WAIVABLE_ROW_IDS` may be waived by `rt setup waive`; `waived` is what
the app's Un-skip keys on, never the note's wording. A required row with a
fault must offer an action that can clear it: an actionless required row is
an Install nobody can reach (RT-260). A connect action may prefill a field
through `ConnectField.value`; the tray renders it as the field's initial
text. It may also carry `create`, a link the sheet opens in the browser
without closing: for the forges that is the new-token page with rt's scopes
pre-checked, and `lib/setup/token-create.ts` holds the required list (the
field hint and the post-paste check read it) and the link's extra pre-checked
scopes (the link alone reads them), still the only place either lives, so a
scope rt newly needs is added there and nowhere else. Add a row by following an existing validator in `lib/setup/validators/`
and its `steps-*.test.ts` twin; the tray's `PlanModels.swift` decodes the
same contract, so a new field needs the Swift side too.

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
other verbs feed that stamp: a full `rt setup apply` that ends ok stamps it
too, unless a migration is still pending, and `rt setup finish` starts an
update run of its own, since the launch-time one skipped the Mac while setup
was open. `rt uninstall` that ends ok and keeps `~/.mattstack` takes Finish
and the update stamp off the record, so a reinstalled app opens setup again. Mark a
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
set` stays as a CLI verb for the folder new clones go in, but no row asks for
it.
