# One built-in switchboard URL

Date: 2026-10-02. Branch: `switchboard-url-constant`. Status: design approved
in brainstorming.

## Problem

There is one switchboard relay, `https://switchboard.mattstack.dev`, yet its
URL lives in four places, and members keep having to confirm or fix it:

- `mattstack.integrations.switchboard.url` (team file). Nothing writes it;
  its presence also decides whether the switchboard setup rows exist.
- `rt.integrations.switchboardUrl` (user latch), set by the `account.switchboard`
  row's Confirm sheet, `rt setup switchboard connect --host`, or `rt team join`.
- `board.switchboardUrl` (machine), written by `rt team join`, the board's
  `/peer/join` and its setup script; read by the board, `board triage` and the
  daemon's peer waker. Old installs also carry `switchboard.url` in the
  board's `config.json`.
- `DEFAULT_INVITE_RELAY_URL` in `lib/team/relay-client.ts`, with the hidden
  `RT_INVITE_RELAY_URL` override, used by rt's invite relay.

## Goal

The switchboard URL is a built-in constant. No setting holds it, no setup row
asks for it, and the board token only ever goes to it.

## Decisions

| Decision | Ruling |
|---|---|
| Source of the URL | One constant in rt-client, `SWITCHBOARD_URL`, read through `switchboardUrl()`. |
| Override | Hidden env var `RT_SWITCHBOARD_URL` for local relay dev and tests; https, or http to localhost/127.0.0.1/[::1] only. Never written or shown. |
| Invite relay | `DEFAULT_INVITE_RELAY_URL` and `RT_INVITE_RELAY_URL` fold into the same constant and env var. |
| Applies when | Any Mac that belongs to a team uses the switchboard. |
| Stored values | Retired: `board.switchboardUrl` is unregistered through the settings chain, and a dated setup migration deletes the stored copies. Team-file leftovers are ignored. |
| Setup rows | `account.switchboard`, `access.switchboard` and `rt setup switchboard connect` are removed. `account.board-peering` stays. |
| Other relays | Not supported: a team cannot point at a different relay, and the board refuses a pasted invite from another host. |

## Design

### The constant

- `packages/rt-client` exports `SWITCHBOARD_URL` and `switchboardUrl(env =
  process.env)`. It returns the override when `RT_SWITCHBOARD_URL` is a
  valid https URL or loopback http, else the constant, with no trailing
  slash. An invalid override is ignored with a warning, never used.
- rt (`lib/team/relay-client.ts`, the daemon), the board (config, triage,
  server) and the waker all call it. `inviteRelayUrl()` becomes
  `switchboardUrl()`.

### rt team invite and join

- `rt team invite` mints the board token against `switchboardUrl()` when the
  team holds the switchboard admin token; peering in the invite pointer
  depends only on that. The pointer stops carrying a URL; a pointer from an
  older rt that still carries one is accepted only if it equals
  `switchboardUrl()`.
- `rt team join` stores the board token as today and writes no URL setting.
  The `peeringFix` that told the user to set `board.switchboardUrl` goes.
- `lib/team/board-token.ts` drops `declaresHttpsSwitchboard`; peering
  applies to every team this Mac joined.

### Setup

- Removed: the `account.switchboard` row, the `access.switchboard` row, the
  switchboard integration's connect flow and `--host` flag in
  `rt setup switchboard connect`, its command-tree node and generated docs,
  and the duplicate `ctxFor`/`credentialHealthCtxFor` switchboard branches.
- `account.board-peering` applies whenever this Mac is in a team. States:
  `ready` when a board token is stored and `GET switchboardUrl()/healthz`
  answers 200; `needs-you` with the re-invite steps when no token is stored;
  `error` with a re-check when the relay does not answer. Never required,
  never finish-gated (unchanged).
- A dated `MigrationDef`, `2026-10-02-retire-switchboard-url`, deletes
  `board.switchboardUrl` (machine), `switchboardUrl` from the user's
  `rt.integrations` (keeping `forgeHost`), and `switchboard.url` from the
  board's legacy `config.json`. Idempotent; skipped when none exist.

### Settings registry

- `board.switchboardUrl` is unregistered through the settings migration chain
  (`docs/settings-architecture.md`, breaking schema changes), since it
  shipped.
- `rt.integrations` drops `switchboardUrl` from its schema and description;
  `mattstack.integrations` drops `switchboard`. Both stay loose objects, so a
  stray stored value never fails a read.
- `schema.lock.json`, `schema-examples.ts` and the registry key-count test
  are updated.

### Board

- `BoardConfig.switchboard.url` resolves from `switchboardUrl()`. Removed:
  the `board.switchboardUrl` read, `saveSwitchboardUrl`,
  `isSwitchboardUrlOwned`, the `config.json` `switchboard` field and
  `parseSwitchboard`'s URL parsing.
- `/peer/join` and `scripts/setup.ts` accept an invite link only when its
  origin equals `switchboardUrl()`'s, and stop persisting a URL (the token
  persist and its rollback stay). The bare-URL manual setup answer goes.
- Example configs and `apps/board/docs/peer-boards.md`,
  `apps/board/docs/configuration.md` drop the URL.

### Daemon

- The peer waker's `readUrl` returns `switchboardUrl()`. Its token and cursor
  reset on a URL change stays (the override can change between runs).

### Docs

- AGENTS.md "Switchboard and rt team join" is rewritten: the board token is
  only ever sent to `switchboardUrl()`; join, invite and the board-peering
  row change together.
- `website/docs/guides/teams-and-invites.mdx` and the generated setup
  reference drop the switchboard Confirm flow; `bun run docs:gen`.
- The VM kitchen-sink team fixture and `check-vm-scripts.sh` drop the
  declared URL.

## Testing

- `switchboardUrl()`: default, override honoured, non-loopback http override
  refused, trailing slash stripped.
- Join writes no URL setting; invite peering follows the admin token; an old
  pointer URL that differs is refused.
- The board refuses a pasted invite on a foreign host; accepts one on the
  switchboard host.
- Setup: no `account.switchboard` row; `account.board-peering` in its three
  states and absent when the Mac is in no team.
- The migration deletes all three stored copies and the `config.json` field,
  keeps `forgeHost`, and is idempotent.
- Tests and fixtures that set the old keys move to `RT_SWITCHBOARD_URL`; the
  peer-waker relay test points it at its loopback relay.
- `setup-copy` snapshots update for the removed rows and the migration.

## Rollout

One PR, shipped in the next release. No relay change. Until a Mac updates,
its stored copies keep working, since they all hold the same URL.

## Out of scope

- Running a different relay for a team.
- `RT_JOIN_BASE_URL` / `https://mattstack.dev/join` (a different host).
