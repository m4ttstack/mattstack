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

**Merge.** It happens inside `readPackRequirements`, so every caller gets it
unchanged, and it returns one entry rather than a second one. A separate org
entry would draw a false `pack.<name>` row, and would keep its integrations
required after a team made the tool optional, since `declaredIntegrations` lets
a required source win.

- Team tools come first, then org tools the team does not name.
- A team entry replaces the org tool whole. The integration the org tool
  connected goes with it, so the team's entry alone decides whether that
  integration is required.
- Integrations are the union of both files, minus anything removed.

**Removing a tool.** A pack's `requirements.jsonc` gains an optional
`excludeOrg` string array (the name is my call). Each entry removes the org tool
of that name, the integration it connects, and an org integration of that name.
A name that matches nothing is reported through `error`, so a typo does not
quietly keep a tool required.

**No active team.** The reader returns the org's tools with `pack` set to the
org name, and `toolRows` draws no `pack.<org>` row for it. An org with no org
file still returns `[]`.

**Errors.** Org file errors travel in a new `orgError` field, separate from
`error`, and draw a row `org.requirements` with `required: false` and status
`error`. Entries that parsed still apply. The row is not required and not
finish-gated, so it needs no setup screen and blocks nothing. The same applies
when the file cannot be read. An `excludeOrg` typo stays in the pack's `error`.

**Unchanged.** Row ids stay `tool.team.<name>`, so a stored waiver or a tray
reading a row sees no difference, and `PlanModels.swift` needs no new field.

## Left to the builder

- Whether `readPackRequirements` is renamed now that it reads two files.
- Tests in `lib/setup/__tests__/requirements.test.ts` and the tool rows' suite,
  covering each acceptance bullet on RT-527 plus removal.
- `.claude/rules/setup.md`, and a docs site line where team requirements are
  described.

## After it ships

Packs can drop a copied tool only once every member's app reads the org file:
an older app ignores it and would lose the row. That cleanup is a separate
change.
