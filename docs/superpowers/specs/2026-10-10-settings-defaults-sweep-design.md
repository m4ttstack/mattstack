# Settings defaults sweep (RT-487)

## Why

The console's settings page is now where people read and change settings,
but it can only show what the registry knows. 80 of 115 keys have no
registry `default`, so the page says `default: not set` even when the app
has a real built-in value (`boxscore.defaultRange` falls back to `30d`,
`board.triage` to a full object). The page also files every unset key under
its first allowed scope's block, so an unset key looks set at `user` or
`team`.

Two things keep defaults out of the registry today:

- **Convention.** Several registry blocks say "fallbacks live app-side".
  Nothing depends on it.
- **Ownership latches.** Ported keys stay unset so an app's old config file
  can still own the value. A registry default makes `getSetting` return a
  value on every install, which would flip every latch.

Nobody still runs a pre-store app, so the latches can go once the few live
legacy values on a Mac are copied into the stores.

## Outcome

- Every key's console `default` line says what the app uses when nothing is
  set: a value, or a short note saying why there is none.
- The registry is the one home of a key's default. Apps stop carrying their
  own copy.
- No app reads an old per-app config file as a settings fallback.
- A key's scope block on the settings page means "this layer sets it".
- With nothing set, every app behaves as it does today.

## Design

### 1. Registry: four kinds of key

Every row falls into one kind, recorded in the appendix table.

| Kind | Registry | Console default line |
|---|---|---|
| **Real default**: the app falls back to a fixed value | `default: <value>` | the value |
| **Empty means none**: `[]` or `{}` means "no config" | `default: []` or `{}` | the value |
| **No default**: identity, trust, a flag left off, a required value | no `default`; `defaultNote` | the note |
| **Computed**: the fallback depends on the machine or another key | no `default`; `defaultNote` | the note |

`defaultNote` is a new optional `SettingDef` field: one short plain sentence
written in the `rt:ui-copy` style ("Omitted, so the agent picks its own
model.", "Your login shell's PATH.", "Nobody has approved a ladder yet.").
It rides the wire to the console as `SettingDefWire.defaultNote`. A row with
neither `default` nor `defaultNote` fails `registry-console-ready.test.ts`,
so every new key must answer the question.

The trust and identity keys never get a default, because a default there
would grant something nobody chose: `rt.integrations`,
`rt.worktreeReadyApproval`, `rt.repoIdentityOverrides`, `chat.handle`,
`chat.push.target`, `mattstack.activeTeam`, and the per-harness
`agent.*.{model,effort,account,extraArgs}` (unset omits the flag).

### 2. Apps read the default from the registry

For a real-default or empty-default key, the app drops its
`?? fallback` and reads `getSetting(k).value`, which now carries the
default. Every consumer links rt-client in-tree (board, boxscore, console,
chat, deck, gitq) or bundles it at build (deck, gitq), so the default ships
with each app.

Where a deep-merged object's app fallback filled the whole object only when
the key was absent (`boxscore.sizeBand`), the registry default fills each
missing field, which fixes a stored partial value losing its other field.

Where an app parses a value and fills defaults per field (board's
`parseTriageBlock`, `resolveTurnConfig`, rt's runaway scanner), the parser
stays as the validator, and the registry default is that parser's output for
an empty input. A unit test per such key pins
`parse(undefined)` equal to the registry default, so the two cannot drift.

### 3. Presence checks move to provenance

Code that asks "has anyone set this?" must stop testing
`.value === undefined`, which a default makes always false. It asks
`unwritten(key)` (`lib/setup/steps/step-utils.ts`: true when every
provenance row is the default) instead. Known sites:

- `lib/setup/steps/skills.ts` `isUnset` for `board.cwds`, `gitq.board`,
  `gitq.workSlots`: replaced by `unwritten`, and `isUnset` deleted.
- `commands/home.ts:605` (`claude.marketplaces` / `claude.plugins` both
  unset): uses `unwritten`.
- `lib/daemon/cron.ts:63`, `lib/daemon/doppler-sync.ts:43`: read the default
  like any other value; `rt.dopplerTemplate` keeps no default (kind "no
  default"), so its "no template" skip stays.

Every remaining `=== undefined` presence check on a registered key is either
a latch (section 4, deleted) or listed in the plan with its fix.

### 4. Latches: import, then retire

**One-time import.** A setup migration, `2026-10-10-import-legacy-settings`,
copies any live legacy value into the store before the fallback code goes.
It writes only user and machine scope (migrations never write the org or
team stores), skips a key the store already sets, and leaves the old file in
place renamed `<name>.imported` so nothing is lost. What it imports:

| Legacy source | Key | Scope |
|---|---|---|
| `~/.mattstack/rt/repos/<repo>/hooks.json` | `rt.hooks` for that repo | user.repo |
| `~/.mattstack/user/skills/preferences.md` `writing-style:` line | `skills.writingStyle` | user |
| `~/.mattstack/rt/sdm/enrichment.jsonc` | `sdm.resources` | **org** (not a migration's to write: see below) |
| `<dataDir>/branch-naming.json` (VS Code) | `rt.branchNaming` | **org.repo** (same) |
| board `config.json` (absent here) | the board keys it holds | user / machine as each row allows |
| gitq `settings.json` / `config.json` (absent here) | `gitq.workSlots`, `gitq.forges`, `gitq.board` | machine / user |
| deck `settings.json`, `platform.json`, `access.json`: migrated fields only | `deck.apps`, `deck.platform`, `deck.access` | user / machine |

`sdm.resources` and `rt.branchNaming` live in shared stores, which a
migration may not write. Neither legacy file exists on this Mac, so their
retirement drops the fallback and prints, once, the `rt settings set` an
admin would run if a file turns up. No import for them.

**Retire.** After the import, the fallback code is deleted:

- **board**: every `config.json` read and write in `apps/board/src/config.ts`
  and `triage/config.ts` (`CONFIG_PATH`, `parseConfig` as a file reader,
  `loadConfigFrom`, `withBoardStoreFallback`, the store-owns-required-fields
  check, the tabs/roster/hidden save routing, `setHiddenInRaw`, the
  `config.json` watcher, the unconfigured page's file test), and in rt
  `legacyConfigTracksProjects` (`lib/team/board-token.ts`). The
  `account.board-peering` row reads only `board.projects`. `rtRepos`
  overrides, which only the file carried, are dropped unless the plan finds
  a live reader. `retire-switchboard-url.ts`'s file edit stays as a
  migration that has already run.
- **gitq**: the `settings.json` and `config.json` fallbacks
  (`core/worktrees.ts`, `core/forges.ts`, `server/config.ts`), the error
  text that points at them, and the README section.
- **deck**: the `is*StoreOwned` latches and `stripMigratedFields` in
  `core/settings.ts`, `api/platform-settings.ts`, `edge/oauth.ts`. Migrated
  fields read and write the store only; file-only fields (the secret,
  password hash, live state, `tlds`, `secrets`) stay in deck's files by
  design. `access.json` is no longer written.
- **rt**: the `rt.hooks` legacy branch in `commands/hooks.ts` (the derived
  `hooks.json` the git hook scripts read stays, regenerated from the store),
  and `rt hooks on/off` writes user scope instead of machine
  (`HOOKS_WRITE_SCOPE`), so a repo's hook choices follow you to every Mac,
  the `sdm.resources` / `rt.sdmEnrichment` file fallback in
  `lib/sdm/enrichment.ts`, the `skills.writingStyle` `preferences.md` read in
  `lib/skills/writing-style.ts`, and the VS Code extension's
  `branch-naming.json` import.
- **Registry**: `rt.sdmEnrichment` joins `RETIRED_KEYS`; the
  `migrated`/`legacyFile` row fields lose any row that no longer has a
  legacy reader.

`skills.writingStyle` becomes a real-default key
(`mattstack:writing-style-conversational`). The setup row's "not chosen yet"
state keys on `unwritten("skills.writingStyle")` instead of the resolver's
`fallback` source.

### 5. Console

- **Default line.** The `default` layer shows the registry default (a
  composite opens its JSON in a popover, shipped in d2d682ea8) or, with no
  default, the `defaultNote` in muted text in place of `not set`.
- **Scope blocks.** `subheadOf` (`view.ts`) files a key whose value comes
  from `default`, or from nothing, in a new "Not set" block at the end of the
  section, with no scope badge. A scope block then holds only keys that
  layer sets. The scope filter still finds an unset key under the scopes it
  allows, as today.
- The row's `default` / `unset` source text stays.

### 6. Docs and skills

- `rt:settings` skill (`skills/rt-settings/SKILL.md`), through
  `superpowers:writing-skills`: rule 5 says a key's default lives in the
  registry, a key with none carries `defaultNote`, and presence is asked with
  provenance, never `.value === undefined`. The ownership-latch text goes.
- `docs/settings-architecture.md`: the add-a-key checklist gains the default
  or `defaultNote` step; the porting and latch section is replaced by a short
  history note.
- Registry block comments that forbid defaults are removed.
- `apps/deck/AGENTS.md`, gitq's README: drop the fallback descriptions.

### 7. Also fixed

- `lib/setup/steps/skills.ts` seeds `gitq.board.repos` as a list of names,
  which gitq's validator rejects (it wants objects with `path`). The seed
  writes `{ path, name }` entries.
- `apps/console/src/app/settings/fixtures/repos.ts` uses an unregistered
  `rt.worktreePool`; it becomes `rt.worktrees`.

## Testing

- `registry-console-ready.test.ts`: every row has `default` or
  `defaultNote`; every `default` passes the key's schema.
- Per parser-backed key: `parse(undefined)` equals the registry default.
- A guard test (`no-presence-by-undefined`) fails on
  `getSetting(<registered key>).value === undefined` (and `!== undefined`)
  outside an allowlist with reasons.
- The import migration: a fixture home per legacy source, run twice
  (idempotent), a store value already present is kept, the old file is
  renamed.
- Each app's existing suite, with the legacy-file tests deleted or rewritten
  against the store.
- Console: `view.test.ts` for the neutral block; `KeyPanel.test.tsx` for the
  note; then a Fast Browser pass of the settings page in light and dark.

## Delivery

One PR per area, each green on its own, in this order:

1. Registry `defaultNote` + every default and note + console-ready test +
   console default line and neutral block. Apps still carry their
   fallbacks, which now agree with the registry, so behaviour is unchanged.
2. Import migration, then rt latch retirements (hooks, sdm, writing style,
   VS Code branch naming) and presence-check fixes.
3. Board retirement.
4. gitq and deck retirements, plus the `gitq.board` seed fix.
5. Skill and docs.

Deck and gitq bundle rt-client, so the new defaults reach those binaries at
the next release; the in-tree apps pick them up on the next install or turbo
build.

## Appendix: every key without a default today

Kind: **R** real default, **E** empty means none, **N** no default (note),
**C** computed (note). **L** marks a latch retired in section 4.

| Key | Kind | Default or note |
|---|---|---|
| rt.roles | E | `{}` |
| rt.intercepts | E | `[]` |
| rt.worktreeReadyApproval | N | Nobody has approved a ladder yet. |
| rt.ignoredMrs | E | `{ "targetBranches": [], "authors": [] }` |
| rt.repoIdentityOverrides | N | No overrides; repo names come from the remote. |
| rt.cron | E | `{ "triggers": [] }` |
| rt.repoTracking | E | `{}` |
| rt.runaway | R | `{ "cpuThreshold": 80, "sustainMs": 300000, "graceMs": 120000 }` |
| rt.workspacePrefs | E | `{}` |
| rt.sync | E | `{ "autoResolve": [] }` |
| rt.branchNaming | R, L | `{ "template": "${identifier}-${titleSlug}" }` (shape per schema) |
| rt.variations | E | `{}` |
| rt.presets | E | `{}` |
| rt.dopplerTemplate | N | No template, so Doppler sync skips this repo. |
| rt.sdmEnrichment | retired | joins `RETIRED_KEYS` |
| sdm.resources | E, L | `{}` |
| sdm.carriers | E | `{}` |
| rt.hooks | R, L | `{ "enabled": true }` (every hook on) |
| rt.daemonPath | C | Your login shell's PATH. |
| mattstack.integrations | E | `{}` |
| mattstack.tracking | E | `{}` |
| mattstack.appPath | C | Found in /Applications or ~/Applications. |
| rt.integrations | N | No forge host confirmed yet. |
| mattstack.roster | E | `[]` |
| mattstack.org | E | `{ "admins": [], "teams": {} }` |
| mattstack.directory | E | `{}` |
| mattstack.activeTeam | N | Your first team on the roster. |
| claude.marketplaces | E | `[]` |
| claude.plugins | E | `[]` |
| chat.handle | N | Taken from the pane title, the repo, or this Mac. |
| chat.push.provider | N | Push alerts are off. |
| chat.push.target | N | Push alerts are off. |
| agent.claude.model / .effort / .extraArgs | N | Omitted, so Claude uses its own. |
| agent.claude.account | N | Your default Claude profile. |
| agent.claude.yolo | R | `false` |
| agent.codex.model / .effort / .extraArgs | N | Omitted, so Codex uses its own. |
| agent.codex.yolo | R | `false` |
| skills.writingStyle | R, L | `"mattstack:writing-style-conversational"` |
| deck.apps | E, L | `{}` |
| deck.access | E, L | `{}` |
| deck.platform | R, L | `{ "publicDomain": null, "legacyPrefixes": [], "railway": null, "tunnel": null }` |
| gitq.workSlots | R, L | `{ "workSlotLocation": "auto", "maxWorkSlots": 3 }` |
| gitq.forges | E, L | `{}` |
| gitq.board | N, L | Set up by rt setup with the repos it finds. |
| board.gitlabHost | N, L | Required: the team's GitLab host. |
| board.projects | N, L | Required: the projects the board tracks. |
| board.title | R, L | `"MRs ready for review"` |
| board.botUsernames | E, L | `[]` |
| board.ticketPrefixes | C, L | The active team's Linear key. |
| board.slack | R, L | the board's `DEFAULT_SLACK` (channel comes from the directory) |
| board.doctorSkill | R, L | `""` |
| board.triage.doctorSkill | R, L | `""` |
| board.tabs | R, L | `[{ "id": "team", "label": "Team", "source": { "kind": "authors" } }]` |
| board.turn | R | every author and reviewer signal (`ALL_TURN`) |
| board.staleAfterDays | C, L | Each project's rt MR sync window. |
| board.gateGraceMinutes | R, L | `90` |
| board.workspaces | R, L | `{ "reviews": "reviews", "responds": "responses", "doctors": "doctors" }` |
| board.defaultMember | R, L | `"all"` |
| board.hiddenMembers | E, L | `[]` |
| board.triage | R, L | `parseTriageBlock(undefined)` |
| board.peerAsksAlwaysAllow | E | `[]` |
| board.codeowners | R | `{ "slack": { "fromSectionName": false } }` (shape per schema) |
| board.agent.account | N | Your default Claude profile. |
| board.agent.model / .effort | N | Omitted, so Claude uses its own. |
| board.cwds | E | `{}` |
| board.triageMaxConcurrent | R, L | `2` |
| boxscore.projects | N | Required: the projects boxscore scores. |
| boxscore.linearDoneStates | E | `[]` |
| boxscore.sizeBand | R | `{ "tooSmall": 10, "tooLarge": 400 }` |
| boxscore.excludeFilePatterns | E | `[]` |
| boxscore.ignoredMrs | E | `[]` |
| boxscore.botPatterns | E | `[]` |
| boxscore.hiddenMembers | E | `[]` |
| boxscore.roles | E | `{}` |
| boxscore.defaultRange | R | `"30d"` |

Shapes marked "per schema" are confirmed against `registry-schemas.ts` in
the plan; a default that fails its schema fails the console-ready test.
