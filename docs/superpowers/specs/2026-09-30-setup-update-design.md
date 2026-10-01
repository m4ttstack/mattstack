# rt setup update: re-apply safe steps and run one-time migrations after an app update

Ticket: RT-366.

## Problem

An app update only restarts the background services
(`ServicesRegistrar.handleVersionChange`). No setup step re-runs, so
anything setup newly does reaches only people who set up after it shipped.
#606 seeds `crossSessionInbound: "accept"` into Claude settings; every
member set up before it never gets the key. One-time fixes (renaming a
setting, moving a file) have no home at all.

## Goals

- A machine set up before #606 gets `crossSessionInbound` after updating,
  with no manual step.
- A migration added in release N runs once on the update to N and never
  again.
- A re-applied step never overwrites a value the user set and never
  prompts.
- The verb is safe to run by hand and reports what it changed.
- Anything that needs a person surfaces as a notification that opens the
  checklist, never a blocking prompt.
- rt owns every decision. The tray spawns one verb at launch and maps one
  notification click to a window; nothing else lives in Swift.

## The verb: `rt setup update`

A visible leaf under `setup`, description "Re-apply setup after an app
update". Flags: `--json` (NDJSON, the apply stream), `--force` (run even
when this version is already stamped). No positional, so no
`omitBehavior`. `--from` and `--only` do not exist on it.

The handler (`setupUpdate` in `commands/setup.ts`) skips
`gateHardPreconditions` (the macOS and CLT rows gate a first Install, and
an updated Mac already passed them) and decides, in order:

1. **Never set up.** `~/.mattstack/rt/daemon.json` absent (the same file
   the tray's `FirstRunDetector` keys on): print
   `setup update: this Mac has not been set up yet` and exit 0. In `--json`
   the stream is a single `done` with `ok: true` and
   `skipped: "not-set-up"`. The tray can therefore call the verb blindly.
2. **Already applied.** `setup-state.json`'s `lastUpdate.version` equals
   the running rt version and `--force` is absent: print
   `setup update: already applied for <version>` and exit 0; `--json`
   emits `done` with `ok: true, skipped: "current"`. A source or dev build
   (version `dev`) never matches, so dev machines run every launch.
3. **Run.** Otherwise run the update plan (below), stamp
   `lastUpdate: { version, at }` whether or not every item passed, print
   the summary, post the notification when something needs a person, and
   exit 0 on all-clear or 2 when any item failed or is needs-you.

The version is the compile-time `RT_VERSION` define (`dev` from source),
read through one accessor in `lib/setup/update.ts` so tests can pin it.

### The update plan

Three phases, in this order, through the existing engine:

1. **Pending migrations**, in list order, skipping ids already in
   `setup-state.json`'s `migrations`.
2. **Update-safe steps**: every `STEPS` entry with `updateSafe: true`, in
   contract order, minus `verify`.
3. **`verify`**, last, as today's apply does. Its `needs-you` outcome is
   what names the rows only a person can clear.

`runApplyWith` gains a mode: `{ mode: "update" }`. In that mode a `failed`
item does not stop the run; the engine records the first failure in
`done.failedStep` as today and adds `failedSteps` with every failing id.
`--from`/`--only` combined with update mode throw the same exit-2
`UserActionableError` shape the other flag conflicts use.

The `plan` event lists migrations and steps together. A migration's event
id is `migration.<id>` (`EventId` gains a `MigrationEventId` template
member), `kind: "rt"`, title from its definition. Everything else on the
stream is unchanged, so the tray's existing `InstallRunModel` could render
an update run if it ever wanted to.

The human emitter's `done` line for an update run is one summary:
`changed: a, b · skipped: c · needs you: d · failed: e`, each group
omitted when empty. "Changed" is `done` or `partial`; `skipped` is
`skipped`.

### Stamps and ledgers (`setup-state.json`)

`SetupState` gains two fields, backfilled like the others:

- `migrations: string[]`: ids that completed `done` or `skipped`. A
  `failed` migration is not recorded and runs again on the next update
  run.
- `lastUpdate?: { version: string; at: string }`: written once at the end
  of every non-skipped run, regardless of outcome, so a persistently
  failing item nags once per release rather than every launch. `--force`
  is the hand retry; the checklist's own Retry is the other. The one
  exception is a step that throws a plain `Error` (an rt bug): the run
  ends without a stamp, as apply does, so the bug is retried at the next
  launch. A migration that throws is reported `failed` and the run goes
  on, so it never blocks the steps behind it.

`lastApplyAt` keeps its meaning (any apply engine run) and is written by
update runs too.

The stamp and ledger live in `setup-state.json`, an untracked runtime
file, on purpose: the machine settings store travels with a home-repo
restore, so a stamp there would follow the user onto a fresh Mac and
suppress the very run that Mac needs. `lib/daemon/boot-migrate.ts` is a
different mechanism (idempotent re-key steps at every daemon boot) and
stays separate; a migration here runs once and is recorded.

## Update-safe steps

`StepDef` gains `updateSafe?: true`. A step may carry it only when the
plan's audit finds all three: idempotent, never calls `ctx.need` or
prompts, never overwrites a value a user chose. The flag is the whole
mechanism; adding a step later is one line plus its audit.

Initial set, from the code read for this spec:

| Step | Why it is safe |
| --- | --- |
| `path.link` | symlinks and rc lines, each checked before written |
| `settings.seed` | writes `mattstack.appPath` only when it changed; promotes a staged root only if one is staged |
| `skills.materialize` | documented idempotent and re-callable |
| `skills.link` | relinks bundled skills, the case an update exists for |
| `intercepts.install` | rebuilds shims from the stores, skips occupied names |
| `plugins.install` | marketplaces and plugins via the `claude` CLI, diffed against state |
| `claude.permissions` | unions the baseline into each config dir, touches no other key |
| `verify` | read-only checks |

Audit in the plan, include when clean: `extension.install`,
`herdr.integration`, `fastbrowser.setup`. They deliver newly bundled
artifacts but run other tools' installers; each needs a read of what its
tool's setup verb does on a second run.

Never update-safe: `home.*`, `team.*`, `secrets.write`, `git.identity`,
`repos.clone`, `services.register`, `proxy.install`, `deck.managed`,
`board.keys`, `cron.triage`, `linear.mcp`, `services.start`,
`snapshot.push`. They create, prompt, do network work, or the tray already
does their job at launch.

Guard test (`lib/setup/__tests__/update-safe.test.ts`): every step with
`updateSafe` has `kind: "rt"`; the set is asserted verbatim so adding one
is a visible diff.

## Migrations

`lib/setup/migrations/index.ts` exports `MIGRATIONS: MigrationDef[]`, an
ordered list:

```ts
export interface MigrationDef {
  /** Stable id, never renamed once shipped: `<yyyy-mm-dd>-<slug>`. */
  id: string;
  title: string;
  run(ctx: ApplyContext): Promise<StepOutcome>;
}
```

A migration returns `done` (it changed something), `skipped` (nothing to
fix on this machine) or `failed`. `done` and `skipped` are recorded;
`failed` is not. It has the full `ApplyContext` (probes, settings, log,
redact) and the same rules as an update-safe step: no prompts, no
overwriting a user's choice.

The list ships empty. `MIGRATIONS` is asserted unique-by-id and sorted by
id prefix in the guard test, and the engine test drives a fake list.

The #606 case needs no migration: `claude.permissions` already checks
`missingCrossSessionInbound`, so the re-apply is the fix.

## Notification

When the run ends with any `needs-you` or `failed` item, rt posts one
event through `notifyEvent` in `lib/notifier.ts` (tray socket, osascript
fallback, muted by the prefs registry):

- `category: "setup_update"`, added to `NOTIFICATION_TYPES` as
  "Setup after an update: when a re-applied setup step needs you".
- `title: "Setup needs you after the update to <version>"`.
- `message`: the needs-you and failed items, `<id>: <detail>`, joined on
  ` · `.
- `id: "setup_update:<version>"`, so a `--force` rerun replaces the
  banner rather than stacking one.

No `url`, `paneId`, `team` or `handle`.

## Tray

Two changes, both macOS-only by nature:

1. **Launch hook.** In `AppDelegate.settleAgentsAfterLaunch`, after
   `recordAfterSettle` and off the launch task, when
   `coordinator.setupIsComplete` and not stub mode: `rt.run(["setup",
   "update", "--json"])`, log the `done` event's fields through `TrayLog`
   at info, or warn on a spawn error. No version check in Swift; rt's stamp
   decides. The `setupIsComplete` check only avoids a spawn during
   onboarding, when the Install stream owns the engine.
2. **Click route.** `NotificationClick` gains `setupUpdateCategory =
   "setup_update"` and `Route.showSetupStatus`, which `follow` maps to the
   existing `.rtShowSetupStatus` notification (the "Setup status…"
   window). `suppressesActivationShow` is false for it.

`MattstackCoreChecks` covers `bannerRoute` for the new category.

## Docs

- `docs/superpowers/specs/2026-08-21-rt-setup-contract.md`: a
  `rt setup update` section (the three decisions, the stream additions,
  `failedSteps`, migration event ids) and the two new `setup-state.json`
  fields. Its "Step ids" list is stale (no `claude.permissions`, wrong
  order) and is corrected in the same edit.
- `commands/post-install.ts`'s header, which says a Sparkle update never
  re-runs it, now points at `rt setup update` as the thing that does run.
- `AGENTS.md`: a short "Setup after an update" pointer: how to mark a step
  update-safe, how to add a migration, and that the tray only calls the
  verb.
- `bun run docs:gen` after the command-tree edit.

## Testing

- `apply.test.ts`: update mode runs pending migrations, then update-safe
  steps, then verify; skips recorded migrations; records `done` and
  `skipped` ids, not `failed`; continues past a failure and reports
  `failedSteps`; refuses `--from`/`--only`.
- `state.test.ts`: `migrations` and `lastUpdate` backfill and round-trip.
- `commands/__tests__/setup-update.test.ts` (or the existing setup command
  test file): not-set-up skip, current-version skip, `--force`, `dev`
  always runs, stamp written on a failed run, exit codes, notification
  posted only when needed, with `notifyEvent` faked.
- `update-safe.test.ts`: the guard above.
- Swift: `bannerRoute` for `setup_update`; the launch call is exercised by
  the existing stub-mode launch checks not spawning it.
- `bun run test:all` before the PR, per AGENTS.md.

## Out of scope

- A migration with real work. The first one ships with the release that
  needs it.
- `rt release update-machine`: the dev app relaunch after a rebuild
  triggers the same launch hook, and `dev` never matches the stamp, so
  no new leg is needed.
- Rendering the update run in the Setup window. The stream is compatible
  if that is ever wanted.
