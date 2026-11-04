# Org-level setup requirements (RT-527)

## Why

`rt setup` reads `requirements.jsonc` only from the active team's pack. A tool
every team in an org needs is copied into each pack, and a team that misses the
copy gets no setup row. A file anywhere else is ignored without a warning.

## Goals

- An org declares a tool or integration once; every team's setup picks it up.
- A team can change an org tool, make it optional, or remove it.
- An org with no org file behaves exactly as it does today.
- A member on a finished Mac hears about a new required tool when it arrives, and
  resolves it on a screen that shows only that tool.

Non-goals: new action kinds for tool rows (RT-414), removing the copies teams
already carry, and org-level `chrome` or `workType`.

Anti-goal: one bad org file must never stop a member installing. A member cannot
fix the org's data.

## Approaches

- **A: `org/requirements.jsonc`, merged in `readPackRequirements` (picked).**
  Same format and parser as a pack's file. Reaches every team, keeps per-entry
  error reporting, and needs no org layout bump because older rt ignores the
  file.
- **B: a settings key.** Settings layering replaces a whole value, so per-tool
  merging would still be written, and error reporting is weaker.
- **C: a file in the base pack, through `extends`.** Fits shared fills, but a
  team that does not extend the base misses it, which is the gap this closes.

## Design

**File.** `orgs/<org>/mattstack/org/requirements.jsonc`, beside
`settings.org.jsonc`, in the pack format. The org file reads `tools` and
`integrations`; its `chrome` and `workType` are ignored (my call).

**Merge.** It happens inside `readPackRequirements`, so plan, form, prepare,
apply and `rt tools` all get it unchanged. Org tools fold into the team's one
entry. A second entry is not safe: `pack.ts` reads `reqs[0]` for the pack's
error, name and work type, and `toolRows` draws a `pack.<name>` row for every
entry, which would be an install row nothing can clear.

- Team tools come first, then org tools the team does not name.
- A team entry replaces the org tool whole. The integration the org tool
  connected goes with it, because `declaredIntegrations` lets a required source
  win over an optional one, and the team's entry alone must decide.
- Integrations are the union of both files, minus anything removed.
- The entry keeps the team's `pack`, `error`, `chrome` and `workType`.

**A team with no pack file.** Today that reads as `[]`. With an org file it
gains an entry, marked `orgOnly: true`. `pack.ts` and the `pack.*` names in
`toolRows` skip an `orgOnly` entry, so such a team behaves as it does today:
no false `pack.<team>` row, and the pack stage takes the same path.

**Removing a tool.** A pack's `requirements.jsonc` gains an optional
`excludeOrg` string array (the name is my call). Each entry removes the org tool
of that name, the integration it connects, and an org integration of that name.
A name that matches nothing is ignored, because a tool the org later drops would
otherwise turn a team's old entry into an error.

**No active team, or no org.** The reader returns `[]`, as it does today, and
says so explicitly for an empty slug, which plan and form pass on a Just me Mac.
Org tools appear once a team is active. This changes the ticket, which asked for
org tools on a Mac with no active team (my call, from Lawson's review): it keeps
reads during the waiting and approval stages unchanged, and it keeps the
Just me branch in `accounts.ts`, which tests `reqs.length === 0`.

**Errors.** Org file errors travel in a new `orgError` field, never in `error`:
`pack.ts` fails the whole pack stage on `reqs[0].error`, and a member cannot fix
the org's data. `toolRows` draws a row `org.requirements` from it, with
`required: false` and status `error`, homed under Team in `regroup.ts`. Entries
that parsed still apply. The row has no `ROW_TARGETS` entry and blocks nothing.
The Setup status window draws it as a note on the ready screen, from the
`orgNotice` a whole form read carries.

**Unchanged.** Row ids stay `tool.team.<name>`, so stored waivers and the tray
see no difference, and `PlanModels.swift` needs no new row field. The prepare stage
builds its list from the same reader, so it installs org tools too. Org tools
with a sign-in land on the connect screen through `signInTools`. Others show as
"Before you finish" rows while they block.

**Required by default.** Org tools default to required, the same rule as a pack
(Matt's pick): an admin writes `optional: true` for a tool that should not
block. One org edit reaches every member at their next pull.

## A new tool on a finished Mac

Today a member hears nothing until the next app update, because `rt setup
update` runs once per version, and then the notification blames the update. The
fix applies to any new required tool, from a pack or the org, since both come
through the same reader. Mock: `docs/apps/design/setup/setup.pen`, section T.

**Notification.** The daemon checks after each team pull on a finished Mac,
through `afterPull` when the pull moved the clone and `afterUpToDatePull` when it
did not, and stands down while a setup run or `rt setup update` is going, trying
again at the next pull. It reads the merged requirements and judges each
required tool with `teamToolRow`, the same builder the plan uses, so the notice
and the screen cannot disagree. Only status `missing` counts: an error or a
timeout is unknown, and unknown is not missing. A tool must read missing on two
pulls in a row before it notifies, because a false result reaches every member at
once. Category `setup_update`, so a click opens Setup status and the member's
notification setting applies. It never asks for notification permission.

- One tool: "Your team needs Doppler", "Open setup to install it".
- Several: "Your team needs 2 new tools", "Doppler and ldcli".

The record lives in its own file, `~/.mattstack/rt/tool-notices.json`, holding
`pending`, `told` and `acked` name lists. It stays out of `setup-state.json`
because `updateSetupState` has no lock, and a daemon write during a run could lose
a migration id. A told name stays until Done acknowledges it, then drops off, so a
tool removed and added back later notifies again. It also drops off once the team
no longer requires it, unless the read failed. Later never re-notifies; the
update run's existing "Setup needs you" notification stays as the per-release
reminder.

**Screen (T2).** rt owns the stage. `finishedStage` returns a new stage `tools`
while every blocking row is a `tool.team.*` row or that tool's account, or while
`told` holds a name not yet in `acked`. A `pack.*` row or any other blocker keeps
today's route, because this screen cannot fix them. `rt setup form --section tools`
returns the rows, built by the connect section's `signInRow` and `extraRow`, so
Install, Download, Show steps and sign-in behave as they do on the connect screen.
The stage never records Finish.

- Heading: "One new tool for your team", or "2 new tools for your team".
- Footer: "Find this later in Setup status", with Later and Done.
- Later closes the window and writes nothing, so Setup status lands here again.
- Done is off until every row is done. It runs `rt setup form --ack-tools`, which
  adds the names to `acked`, then closes the window. On a first run, Done goes on
  to rt's stage instead.
- Once the rows clear, the heading reads "You're all set" and Later goes away.
- The tray's step label reads "Setup status". There is no sub line.

**Older apps.** They ignore the org file and `excludeOrg`, so nothing breaks. The
`tools` stage ships in the same bundle as the rt that returns it.

## Left to the builder

- Whether `readPackRequirements` is renamed now that it reads two files.
- Tests in `lib/setup/__tests__/requirements.test.ts` and the tool rows' suite,
  covering each acceptance bullet on RT-527 plus removal. Required cases: org
  and team declare the same tool (team wins in `signInTools` and the rows), a
  null team, a team with no pack file, and a malformed org file with the pack
  stage still installing.
- `.claude/rules/setup.md`. No user docs describe `requirements.jsonc` today, so
  none change.

## After it ships

Packs can drop a copied tool only once every member's app reads the org file:
an older app ignores it and would lose the row. That cleanup is a separate
change.
