---
paths:
  - "lib/state/**"
  - "commands/state*.ts"
---

# State

## State backup

Encrypted, compressed, off-machine backup of mattstack app state. Before
touching `lib/state/backup-*.ts`, `commands/state-backup-*.ts`, the daemon's
`state-backup` sweep, or anything under `~/.mattstack/user/state-backups/`,
read `docs/superpowers/specs/2026-09-13-state-backup-design.md`; it is the
reference for the pipeline, manifest, restore and prune. Three traps the spec
explains and the code enforces:

- Intermediates never touch the home repo working tree; only the final
  `.age` blob lands under `state-backups/<app>/`.
- The age private key is never written to disk; `readAgeKey` and
  `ensureAgeKey` require an `AgeKeySeam` from `createRealAgeKeySeam()`.
- `age`, `zstd` and `git-lfs` resolve via an explicit `{ PATH: process.env.PATH }`
  because the daemon's launchd PATH is minimal (RT-131 tracks bundling them).

### `SCHEMA_VERSION` is claimed across sessions, not chosen per branch

Several agents work this repo at once, and `runMigrations` only replays when
`user_version < SCHEMA_VERSION`. So the first branch whose daemon opens
`~/.mattstack/rt/state.db` stamps the new number, and every *other* branch's
schema for that same number then silently never applies. Its tables are
simply absent on that machine, with no error anywhere. This has already
happened once: two lanes both wrote a v4, one lane's daemon migrated the
real db minutes before the other merged, and the second lane's tables
never appeared.

Announce the version you are taking to the other sessions before you merge,
and renumber if you are second. To repair a db stamped by a schema that is
not the one on disk: stop the daemon, `PRAGMA user_version = <the previous
version>`, start it, and diff `sqlite_master` before and after to confirm
the other lane's tables survived (the replay is IF NOT EXISTS, so it is
data-preserving).

**Nothing but `IF NOT EXISTS` statements may appear in a `V*_SCHEMA` block.**
The runner execs `V1 + … + Vn` as one statement on *every* bump, so an
`ALTER TABLE … ADD COLUMN` that succeeded once throws `duplicate column
name` on the next bump, rolls the migration back, and makes every later
`openStateDb` call throw. Add a column by creating the table with it
(`IF NOT EXISTS`), or guard the add behind a `PRAGMA table_info` check.
