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

# Setup: org requirements and the tools stage

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

A tool's `name` must be a bare command (`BARE_COMMAND` in
`lib/setup/requirements.ts`), since the daemon runs `<name> --version` after a
pull with no click. A name carrying a path is a malformed entry, so a file in
the pulled clone is never what runs.

## New tool notices

A finished Mac hears about a new required tool from the daemon's pull hook
(`lib/setup/tool-notices.ts`). What was said lives in
`~/.mattstack/rt/tool-notices.json`, not `setup-state.json`: `updateSetupState`
has no lock, and a daemon write during a run could lose a migration id. A tool
must read `missing` on two pulls in a row before it notifies, because a false
result reaches every member at once; an error or a timeout is unknown, not
missing. A told name drops off once Done acknowledges it or the team no longer
requires it, unless the read failed, so a tool that returns notifies again.

## The tools stage

`tools` holds a finished Mac whose only blockers are team tools or their
accounts, or that was told about a tool, until Done acknowledges it
(`--ack-tools`). A first run can land there too, since an ok run records Finish
with such a tool open; only a status window closes on Done, any other goes on to
rt's stage.

`detail` is a string in the tray, never null: a plain tools row (a tool simply
missing or signed out) sends an empty one, so no reason repeats its button.
`toolsRows` does that itself, since `extraRow` and `signInRow` also draw the
connect screen, whose rows keep their reason. A tools row whose action is an
install also carries `waiting`, so a press shows Installing.

A tools row whose install failed carries `tone: "failed"`: its `action` is the
same install labelled Retry, its optional `secondary` opens the manual steps
(`teamToolManualSteps`; left out when the team declared no install route), and
its `detail` is the failure, drawn in the failure colour beside the buttons in
place of the subtext. The app's own error is not drawn under it, since rt's
re-read carries the failure. It stays open and holds Done. An app older than
`failed` reads the tone as unknown, skips `secondary` and draws Retry with the
failure as a plain reason.

`rt tools install` records its outcome in the accounts prepare record's
`pressFailed` list (`recordToolInstall` in `lib/setup/prepare.ts`), so a press
reaches that row the way a background install does: a failure adds or replaces
the tool's entry, a success removes it, a missing record is written as already
ended, and a running one is left to its owner. `failed` belongs to `runPrepare`
and `pressFailed` to the press; `installFailure` reads only `failed`, so connect
rows never change for a press, `toolRow` reads `pressFailed` first, and
`runPrepare` re-reads `pressFailed` right before its first write and carries it
across the rest. Neither list counts once the tool reads ready.

The press write has no lock. Two presses or a starting run can lose an entry,
which leaves a plain Install row. A press landing on a run's first write can
also make the record read ended until the run's next write. The window is a few
file calls, and the tools screen starts no run.
