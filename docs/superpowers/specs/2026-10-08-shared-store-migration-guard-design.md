# Setup migrations never write shared stores

## Problem

rt has two tools for a one-time change:

- A **setup migration** (`MigrationDef`, `lib/setup/migrations/`). Every Mac
  runs it automatically during `rt setup update`, once each.
- A **layout conversion** (an `ORG_LAYOUT` bump plus a script). An admin runs
  it by hand, on a branch, against the org clone. Older apps hold their pull
  until they update.

Nothing tells an agent which to use. The team directory (#763) shipped as a
setup migration that deletes keys from the shared team store. On the first
admin Mac that launched, it would have changed main for everyone with no
review and no branch. Older apps would have pulled the result and posted to
the wrong Slack channel. `sdm-resources-key` (shipped) has the same shape.
The `AGENTS.md` line "add a one-time fix as a `MigrationDef`" is what led
there.

## Goal

1. An agent knows before it writes code which tool fits.
2. CI and the runtime refuse a setup migration that writes the shared org
   or team stores.
3. The team directory moves through a layout 3 conversion script instead of
   a migration.
4. CI fails a new setting that has no zod schema or no console help on its
   fields.

Out of scope: automatic org migrations (the runbook's planned follow-up),
and changing `sdm-resources-key`.

## The rule

A setup migration changes only this Mac: its user and machine settings,
local files, cron entries, app config. It never writes the shared org or
team stores. Any change to those is a layout change: an `ORG_LAYOUT` bump
plus a conversion script the admin runs, following the `rt:settings`
runbook. This holds even when the change only adds a key: the admin writes
it with `rt settings set`, or a script, never a migration.

Why: a migration runs unreviewed on the first admin Mac that launches, on
whatever branch the clone has checked out, and sync carries the result to
every member, including members on an older app.

## Guidance

- **`rt:settings` skill** (`skills/rt-settings/SKILL.md`): a short
  "migration or layout script?" test at the top of "Changing the org repo's
  layout", stating the rule and the why above. Edited through
  `superpowers:writing-skills`: a baseline run where an agent asked to
  "move a team setting to a new key" picks without the rule, then the same
  prompt with it, which must pick the layout path.
- **Root `AGENTS.md`**, "Setup after an update": after "Add a one-time fix
  as a `MigrationDef`", one sentence: a migration never writes the org or
  team stores; a change there is a layout change, see the `rt:settings`
  skill.

## Enforcement

Two layers, both exempting shipped migrations by id through one allowlist
(`SHARED_STORE_MIGRATIONS` in `lib/setup/migrations/index.ts`, today only
`2026-10-07-sdm-resources-key`, each with its reason).

**CI guard**: `lib/__tests__/no-shared-store-migrations.test.ts` (the `no-`
prefix makes it run on every PR). It reads each file under
`lib/setup/migrations/` (except `index.ts`) and fails when one, not on the
allowlist:

- calls `setSetting`, `unsetSetting` or `pruneStoreName` with `"org"` or
  `"team"` as the scope, or with a scope that is not a string literal;
- names `orgSettingsPath`, `teamSettingsPath` or `listTeamFolders`.

The failure names the file and the call, and says: "A setup migration only
changes this Mac. A change to the org or team stores is a layout change: see
the rt:settings skill, 'Changing the org repo's layout'."

**Runtime refusal**: the migration loop in `runUpdateWith`
(`lib/setup/apply.ts`) marks a migration as running for the length of its
`run()`, unless its id is on the allowlist. While marked, `setSetting`,
`unsetSetting` and `pruneStoreName` throw at `org` or `team` scope with the
same sentence. The throw makes the migration `failed`, which is not
recorded, so it runs again next update; tests that exercise a migration hit
it directly. The mark lives in rt-client's write module (a module-level flag
with a setter, cleared in a `finally`), so a write through any helper that
calls one of the module's four store-writing functions (`setSetting`,
`unsetSetting`, `pruneStoreName`, `renameRepoSection`) is caught. The refusal
is its own error class, so the run reports the sentence itself, not a bug.

## Team directory as layout 3

- **Remove** `2026-10-08-team-directory` from `MIGRATIONS` and delete
  `lib/setup/migrations/team-directory.ts`. It never shipped in a release.
  Update the tests that pin the migration list (`onboarding-org.test.ts`'s
  `expectedOrder`, the sdm test's membership check).
- **Bump** `ORG_LAYOUT` to 3 in `lib/team/org-marker.ts`. A `role: "org"`
  marker with no `layout` still reads 2 (`ORG_LAYOUT_ABSENT_DEFAULT`), so an
  unconverted clone reads as waiting.
- **Script**: `bun scripts/move-to-team-directory.ts <clone-dir> --admin
  <username> [--write]`, shaped like `scripts/move-team-packs-to-plugin.ts`:
  a pure planner in `scripts/lib/move-to-team-directory.ts` with tests in
  `scripts/__tests__/`, and a thin shell that prints through `lib/ui/out.ts`.
  - Refuses unless:
    - the path is the root of a git clone whose marker is `role: "org"`
      at layout 2;
    - the tree is clean;
    - team sync is off on this Mac;
    - `--admin` is one of the org's admins;
    - no path in the move is a symbolic link.
  - Without `--write`, prints the plan: each team's directory entry, and every
    key it deletes, per store.
  - With `--write`: writes `mattstack.directory` into the org store, deletes
    the moved values, rewrites `board.tabs` under its newest store name and
    removes the older name, sets `layout: 3` in the marker, and makes one
    commit.
  - Writes the stores through `setSetting`, `unsetSetting` and
    `pruneStoreName`, as the merged migration did, so versioned store names,
    `$migrated` baselines, comments and the write gate all behave as in any
    other write. That needs `<clone-dir>` to be the org clone rt reads
    (`~/.mattstack/orgs/<org>`), and the script refuses any other path. The
    resolver does not gate on layout, so these writes work on a clone the
    new rt reads as waiting. The marker's `layout: 3` is written the way the
    layout 2 script writes `layout: 2`.
  - Carries the merged migration's rules unchanged:
    - seed an entry from `linear.teamKey`, `board.slack.channel` (team
      store first, then org) and the first codeowners tab's `slackChannel`;
    - never overwrite an existing entry;
    - skip a team whose code owners channel another entry claims;
    - refuse when the directory already has a duplicate code owners
      channel;
    - copy channel names bare (trimmed, one leading `#` dropped, case kept);
    - delete a value only for a team now in the directory.
- **Readers on a waiting org**: with the clone at layout 2 under the new rt,
  the board resolves no directory and refuses to post with the review
  channel sentence, and `rt setup status` shows `org.layout` waiting.

## Every new setting is console-ready

Agents adding a setting miss the zod schema and the console help. Today:

- `schema-examples.test.ts` already fails a composite (object or array) key
  with no schema or no examples.
- The console's `groups.test.ts` already fails a key that lands in no
  console group, or in more than one.
- Nothing fails a scalar key with no schema: 50 of 115 keys are a bare
  `type`, so the console shows no title, allowed values or limits for them.
- Nothing fails a schema whose object properties carry no
  `.meta({ title, description })`: 43 keys have at least one, so the
  console's JSON editor has no hints to show for those fields.

A new test, `packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts`,
fails when a registry key:

1. has no zod schema in `registry-schemas.ts` (scalars included), or
2. has an object property, at any depth (through `properties`, `items`,
   `additionalProperties`, `anyOf` and `oneOf`), with neither a `title` nor a
   `description`. The key itself is described by its registry row's
   `description`, which `registry.test.ts` already requires.

Today's gaps sit on two allowlists in the test, one per rule. Each allowlist
can only shrink: the test also fails when a listed key no longer has the gap,
so a key that gains a schema or its annotations must leave the list. A new
key cannot join a list without a reviewer seeing that diff.

The `rt:settings` add-a-key checklist names all three rules (schema and
examples, annotated properties, console group) so an agent meets them
before the test does.

## Docs

- `docs/settings-architecture.md`: layout 3 and its script.
- `rt:settings`: the runbook's step 1 example names both conversion
  scripts.
- Robin updates the public docs' rollout note ("members update before the
  admin's Mac migrates") to the branch-and-hold flow.

## Testing

- The guard test passes on today's tree with the allowlist. It fails on a
  fixture migration that calls `setSetting(..., "team")`, and on one that
  names `teamSettingsPath`.
- The runtime refusal: a test migration that writes at `team` scope
  ends `failed` with the sentence. One at `user` scope ends `done`. An
  allowlisted id may write `team`.
- The script's planner: the merged migration's cases, ported:
  - an admin;
  - an existing entry left alone;
  - a claimed channel skipped;
  - a duplicate refused;
  - `#`-prefixed names;
  - `board.tabs` under either name;
  - a rerun that finds nothing to do.

  New cases:
  - the marker becomes layout 3;
  - each refusal;
  - plan mode writes nothing.
- `orgLayoutState` reads a layout 2 clone as waiting under `ORG_LAYOUT` 3,
  and a converted clone as ready.
