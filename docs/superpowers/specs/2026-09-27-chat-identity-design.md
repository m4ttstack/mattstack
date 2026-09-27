# rt chat identity: a hidden id behind every handle

## Problem

rt chat keys everything on the bare handle string. The name pool (253
names, least-recently-used draw) ran dry in 27 days at about 10 draws a
day (peaks of 30), so names now recycle. A recycled name inherits the old
holder's room memberships (never pruned), DM rooms (the DM room id is a
hash of the two handles), unread backlog and history. On 2026-09-27 a
brand-new pane drew "remy", last held on 2026-09-01, and its welcome
frame handed it remy's DM with kai as a catch-up, including a message
remy had written itself. `2026-08-23-rt-chat-design.md` (lines 196-198)
predicted exactly this for recycled pool slots.

## Goal

- Every new session is a new identity with an empty chat footprint,
  unless it explicitly continues an existing one.
- The name is display only. flock, herdr-chat's UI and the chat viewer
  never show the id.
- Names are freed as soon as no live session holds them, and the pool is
  large enough that reuse is rare.
- One coordinated change across rt, herdr-chat, flock and the skills,
  built in parallel lanes.

## The model

- **Identity id** (`handle` on the wire and in every table): the key for
  membership, messages, DMs, mentions, acks, claims, delivery and presence.
- **Name** (`name` on the wire): what people and agents see and type.

An id is `<base>.<suffix>`: the base display name, a dot, and 4 lowercase
base36 characters from `sha256(sessionId + mintedAt)`. Example
`remy.k3f9`. The dot keeps ids inside the existing `[a-z0-9._-]+` handle
charset, so no validator, delivery key or topic changes. `#` is not used:
it already means a room (`#rt`), a message number (`remy #530:`) and a URL
fragment (`/r/<room>#m-<id>`).

**Every existing handle is its own id.** No row is rewritten. The old
remy's rows keep the key `remy`; a new remy is `remy.k3f9`. An id with no
row in `chat_identities` has itself as its name.

Minting checks the new id against every id already known
(`chat_identities`, `chat_presence`, `chat_members`, authors in
`chat_messages`, `chat_dms`), and lengthens the suffix to 6 characters on
a clash. It never relies on "no dot means legacy": some old derived
handles may contain a dot.

**Fixed identities** never mint and keep id = name: the human
(`chat.humanHandle`, default `matt`) and the herd system poster
(`SYSTEM_HANDLE`, `herdr`). The shepherd and herd workers do mint (below),
so a new herd's shepherd does not inherit an old herd's DMs.

## When a session gets a new id

| Sign-in | Result |
|---|---|
| Fresh session, no request (pool draw) | new id |
| Name chosen for the session (`claude --name`, `/rename`, registry `nameSource: "user"`) | new id, that display name |
| `chat.handle` setting | new id, that display name |
| Restarted process on the same cwd and pane (today's "seat reclaim") | new id; the display name may be reused |
| Same session signing in again (`ownPriorRow`) | same id |
| `claude --resume` of the same session | same id |
| **Continuation** (below) | the continued id |

The pane pin (`chat_pane_handles`, `paneHandleFor`, `rememberPaneHandle`)
is removed: a new session in the same pane is a new identity with a fresh
draw. The kv rows are left in place and no longer read.

## Continuation: the only way to inherit

`chat:sign-in` gains `continue?: string` (an id or a name). Three callers
set it:

1. **Herd.** `herd:start` mints the shepherd's id and stores it as
   `shepherdHandle`; `herd:spawn` mints each worker's id (display name =
   job name) and stores it on `herd_jobs.handle`. `herd:resume` and a
   worker re-sign-in pass `continue: <stored id>`. The existing columns
   hold the id; no schema change in herds.db.
2. **`rt agent start` reservations.** `reserveAgentHandle` mints the id at
   reservation (an identities row with no session) and stores it on
   `agents.handle`; the agent's sign-in passes `continue`.
3. **`--as <x>`** (CLI) and `as` (MCP `chat_sign_in`). `x` resolves as in
   "Resolving a typed name" below. If that identity has no live session,
   the caller continues it. If it is live in another session, the caller
   gets a new id with the next free display suffix (`remy-2`).

Continuing an id that is live in another session is refused (the same
rule `assertSessionOwnsHandle` enforces today), except `herd:resume`,
which takes over the shepherd's id from a dead or replaced session as it
does now.

## Resolving a typed name

Every input that names someone (`rt chat dm <x>`, `chat_dm {to}`, `@x`
mentions, `--as x`, herdr-chat `jump --handle x` and `quick-send --to @x`,
the viewer's DM open) resolves in this order:

1. `x` is a known id: that id.
2. A live session's display name is `x`: its id. Live display names are
   unique, so this is exact.
3. The most recently minted identity named `x`: its id. A DM to someone
   who has left waits in their own inbox and never reaches a newcomer.
4. Otherwise `x` itself, treated as a legacy id (today's behaviour for an
   unknown handle, unchanged).

**Replies bind to the id.** Delivery frames keep showing names
(`from-name="remy (#rt)"`, `[#rt] remy #530:`), but the reply hint they
carry names the sender's id (`rt chat dm remy.k3f9 "..."`). A reply goes
to the exact agent even if the name has since changed hands. The hint is
agent-facing text, not UI.

**Mentions** are resolved at post time: each `@x` in the body is resolved
to an id and stored in `mentions`. The body text is not rewritten.
Messages carry `mentionNames` (parallel to `mentions`) so the viewer can
highlight `@remy` in the text.

## Names: pool, freeing, suffixes

- The pool grows from 253 to about 1,000 short, common first names
  (valid chat names, no suffix-like endings). At current demand a name
  returns roughly every three months.
- A name is free when no live session holds it. The draw stays
  least-recently-used over free names (`pickAgentName`, the `chat`/`names`
  kv ledger).
- `-N` suffixes stay, but only for display, when two live sessions want
  the same name.
- Last names are out of scope. Colour and avatar are seeded from the id,
  so the viewer already tells an old remy from a new one.

## Schema (v14)

One new table, `IF NOT EXISTS` only (no `ALTER`; see AGENTS.md):

```sql
CREATE TABLE IF NOT EXISTS chat_identities (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,   -- display name, suffix included (remy-2)
  base_name   TEXT NOT NULL,   -- remy
  minted_at   INTEGER NOT NULL,
  session_id  TEXT             -- null for a reservation not yet signed in
);
CREATE INDEX IF NOT EXISTS chat_identities_name ON chat_identities(name, minted_at);
```

`chat_presence.handle` holds the id; `base_handle` holds the base name.
Live display-name uniqueness is enforced in `signIn` through the identities
join. `SCHEMA_VERSION` 13 becomes 14: announce it in `#rt` before merging
and renumber if another lane has taken 14.

## Wire contract

Every handle-bearing field keeps its name and meaning (the id) and gains a
display-name sibling. A consumer that ignores the new fields keeps working
and shows the id for new identities, which is why everything ships together.

**rt-client `commands.ts`**

| Type or command | Added |
|---|---|
| `ChatMember` | `name` |
| `ChatMessage` | `name`, `mentionNames` (and the missing `quiet`) |
| `ChatClaimOutcome` | `authorName`, `holderName`, `previousHolderName` |
| `RoomSummary.participants` | `aName`, `bName` |
| `PresenceRow` | `name` |
| `ChatPane.presence` | `name` |
| `AgentRecord` | `name` |
| `HerdInfo` | `shepherdName` |
| `HerdJobInfo` | `name` |
| `chat:sign-in` | payload `continue?`; data `name` |
| `chat:post`, `chat:dm` | data `recipientNames` |

Payload `handle`, `from` and `to` fields accept an id or a name (resolved
as above). Each response resolves names once per request, using a
`chat_identities` lookup that falls back to the id.

**Session file** `~/.mattstack/rt/chat/sessions/<id>.json`:
`{ handle, baseHandle, name }`. Readers use `name ?? handle` for display.

**herdr-chat `--json` output**: `Status`, `PeekBuddy` and `Jump` gain
`name`. `targets.people` stays `@<name>` (live names are unique, and the
send resolves the name). `broadcasts.json` `Recipient` stores `handle`
(the id) and `name`.

**flock `ChatShapes`**: `ChatStatus`, `ChatBuddy` and `ChatJump` gain an
optional `name`; display is `name ?? handle`.

## Display rules

- Every screen shows `name`. Anything that acts (jump, DM, send, "is this
  me", React keys, maps, filters, "title equals the handle" checks) uses
  `handle`, except "title equals" checks, which compare against `name`.
- Chat viewer: `byHandle` keyed by id; hue and avatar seeded from the id
  (legacy ids equal their names, so existing colours do not change); DM
  labels `aName ↔ bName`; mention highlighting from `mentionNames`;
  Composer autocomplete matches names and stores ids.
- flock: one `@` rule. Identity text never shows `@`, except as the target
  prefix on quick-send chips (`@remy` next to `#rt`).
- CLI output and the welcome frame print names; `rt chat who`/`buddies`
  print names.

## Also fixed: your own messages as unread

Posting never advances the author's own read cursor, and `peekUnread` /
`readUnread` do not skip the reader's messages, so a welcome catch-up can
show a handle its own last post. The unread queries exclude
`handle = <reader>`.

## Lanes

All lanes build against this spec's contract at once and merge together.

1. **rt core**: `lib/state` (identities table, `signIn` minting and
   continuation, resolution, pool, pane-pin removal, self-unread),
   `lib/daemon` (chat, pane, herd, agent handlers, inbox frames and reply
   hint, watchdog), `commands/` (chat, pane, herd, agent output),
   `lib/mcp` (chat tools, `whoami`, `as`), tests including e2e
   `chat-inbox-delivery` and `chat-presence-roster`.
2. **rt-client and the chat viewer**: the types above, wrappers, README
   "Chat"; `apps/chat` client and server per the display rules; its
   `ARCHITECTURE.md`, `README.md` and `design/ANATOMY.md`. Rebuild
   `packages/rt-client/dist`.
3. **herdr-chat**: parse `name`, key on `handle`, show `name`, extend its
   JSON output, README and AGENTS.md; install the rebuilt plugin.
4. **flock**: `ChatShapes`, display sites, the `@` rule, fixtures, docs.
   flock work goes straight on main in the main checkout, with a dev build
   through `Scripts/dev-build.sh`.
5. **Skills, plugins, docs**: `skills/rt-chat`, `skills/rt-repo-identity`,
   the marketplace chat plugin (skills, `session-start.sh` reads `name`,
   "memberships are kept for next time" becomes "your identity ends with
   your session"), the shepherdr source under
   `mattstack-skills/attachments/orchestration/shepherdr/` then recompile,
   regenerate `attachments/mcp-tools/reference.md` from `rt mcp tools
   --json`, `docs/repo-identity.md`, and a "superseded by" note on each
   older chat spec listed below. Skill edits go through
   `superpowers:writing-skills`.

## Testing

- The incident, as a failing test first: session A draws `remy`, DMs
  kai, posts, signs out and is pruned; session B is forced to draw
  `remy`. B's id differs from A's, B has no rooms besides its derived
  room, its welcome carries no catch-up, and kai's DM room with A is
  unchanged. `rt chat dm remy` from kai reaches B; a reply using A's reply
  hint reaches A.
- Continuation: `herd:resume` keeps the shepherd's id; `--as remy` with
  remy offline continues it; with remy live it mints `remy-2`.
- Resolution order, id-collision lengthening, self-unread exclusion, the
  pool draw over about 1,000 names.
- Wire: every type above carries `name`; consumers fall back to `handle`.
- UI (mandatory, per the Fast Browser rule): the viewer with a legacy
  remy and a new remy in one room, both colour schemes, screenshots.
  flock rendered in both schemes.

## Out of scope

- Last names.
- Rewriting legacy rows or merging past identities.
- `mattstack-apps` (a stale copy of the viewer from before the fold-in).

## Supersedes

Handle-as-identity statements in `2026-08-23-rt-chat-design.md`,
`2026-08-24-rt-chat-presence-design.md`, `2026-08-26-rt-chat-qol-design.md`,
`2026-08-26-rt-chat-invite-design.md`,
`2026-08-28-rt-chat-delivery-v2-design.md`,
`2026-09-26-mcp-chat-tools-design.md` and `2026-09-08-rt-herd-design.md`.
