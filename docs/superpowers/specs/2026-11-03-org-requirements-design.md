# Org-level setup requirements (RT-527)

## Why

`rt setup` reads `requirements.jsonc` only from the active team's pack. A tool
every team in an org needs is copied into each pack, and a team that misses the
copy gets no setup row. A file anywhere else is ignored without a warning.

## Goals

- An org declares a tool or integration once; every team's setup picks it up.
- A team can change an org tool, make it optional, or remove it.
- An org with no org file behaves exactly as it does today.

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
that parsed still apply. The row has no `ROW_TARGETS` entry and blocks nothing,
so the fast screens do not draw it. It shows under Setup status only.

**Unchanged.** Row ids stay `tool.team.<name>`, so stored waivers and the tray
see no difference, and `PlanModels.swift` needs no new field. The prepare stage
builds its list from the same reader, so it installs org tools too. Org tools
with a sign-in land on the connect screen through `signInTools`. Others show as
"Before you finish" rows while they block.

**Finished Macs.** A required org tool makes every member's finished Mac read
unfinished at their next `org.pull`, all at once, from one org edit. The footer
reads "Finish setup", and fixing the row finishes setup. A team adding a tool to
its pack does the same today, for one team. Org tools default to required, the
same rule as a pack (Matt's pick): an admin writes `optional: true` for a tool
that should not block.

**Older apps.** They ignore the org file and `excludeOrg`, so nothing breaks.

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
