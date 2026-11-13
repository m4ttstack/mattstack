# How the chat viewer fits together

The viewer is the human's window onto `rt chat`. Agents talk over the rt
daemon (the `rt` CLI in `~/Documents/GitHub/mattstack`); this app reads the
same daemon through `@mattstack/rt-client` and renders it. Read this before
touching anything under `src/server/` or wiring a new screen.

## Request path

```
browser ──HTTP/WS──▶ Bun + Hono (@mattstack/app-server + src/server) ──rt-client──▶ rt.sock ──▶ rt daemon ──▶ ~/.mattstack/rt/state.db
```

- `src/server/index.ts` calls `serveMattstackApp({ name: 'chat', routes,
port: 11002, relay: [...] })` from `@mattstack/app-server`. The package
  composes the Hono app (`/api/health`, `/api/daemon`, then `routes`), mounts
  static serving and the `/ws` upgrade, starts the relay, and `Bun.serve`s
  it; chat supplies only `src/server/routes.ts` (chat's own `/api/chat/*`
  handlers, from `src/server/chat.ts`) and the relay topic mapping.
- Every daemon call goes through `@mattstack/rt-client` (`chatRooms`,
  `chatWho`, `chatBuddies`, `chatMessages`, `chatPost`, `chatArchive`,
  `chatDmOpen`, `chatJoin`, `daemonHealth`, `createRelay`).
  **rt-client never throws**: a result is `{ ok, data }` or
  `{ ok: false, error }`, and a daemon that is down and a daemon that
  refused look the same to the caller. Routes turn `!ok` into a 502.
- The human is `chat.humanHandle` from the mattstack settings store, a fixed
  identity whose id is its name (it never mints), overridable per request
  with `?handle=` (`src/server/chat.ts`).

## The API

All under `/api`; JSON in and out, except the picture route. An unmatched `/api/*` is a JSON 404, never
the SPA shell (`@mattstack/app-server`'s `mountStatic`).

| Route                                       | Returns                                                                                                                                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/health`                           | `{ ok: true, name, version }` (from `@mattstack/app-server`'s `createApp`, not chat's own routes)                                                                                                                                                      |
| `GET /api/daemon`                           | `daemonHealth()`: `{ reachable, ... }`; never errors (also from `createApp`)                                                                                                                                                                           |
| `GET /api/chat/rooms`                       | `{ rooms: RoomSummary[] }`: the human's rooms including closed ones (`archivedAt` set; the rail hides them), then every room a fleet buddy is in that the human is not (`joined: false`)                                                               |
| `GET /api/chat/me`                          | `{ handle, name }`: the human, from `chat.humanHandle` and `chat.displayName`                                                                                                                                                                          |
| `GET /api/chat/slack-status`                | `{ conversations, closed }`: the rooms holding a Slack support chat, open or ended, from the daemon's `chat:slack-status`; 502 when the daemon lacks the verb. An open chat's composer says only its agent sees the message; an ended one is read-only |
| `GET /api/chat/slack-avatar/:person`        | the daemon's cached Slack picture for that person, from `chat:slack-avatar-file`; 404 when it has none. Cached for good, since the client's URL carries the picture's version                                                                          |
| `GET /api/chat/slack-face?name=`            | `{ url }`: the viewer's own Slack picture, matched by full name, or null unless exactly one Slack person has it                                                                                                                                        |
| `GET /api/chat/who/:room`                   | `{ members }` with status, cwd, pane                                                                                                                                                                                                                   |
| `GET /api/chat/buddies`                     | `{ buddies }`: the fleet roster with each buddy's room tags                                                                                                                                                                                            |
| `GET /api/chat/messages/:room?limit&before` | `{ messages }`, newest page by default; `before=<id>` pages older                                                                                                                                                                                      |
| `GET /api/chat/direct?limit&before`         | `{ messages }`: Messages to you, every DM the human is an end of, closed ones included, merged by id. Pages like `/messages/:room`, since ids run across rooms                                                                                         |
| `POST /api/chat/direct/read`                | marks those DMs read, which clears the sidebar's count                                                                                                                                                                                                 |
| `GET /api/chat/herd/:id/:room?`             | `{ messages }`: one herd (`herd:roster`), its shepherd's DMs with each worker plus its own room, merged by id. A trailing room narrows it to that one. `/api/chat/rooms` tags those rooms with `herd`, and the sidebar folds them into one row         |
| `POST /api/chat/herd/:id/read`              | marks the herd's rooms read                                                                                                                                                                                                                            |
| `POST /api/chat/post` `{ room, body }`      | posts as the human; joins the room first if needed                                                                                                                                                                                                     |
| `POST /api/chat/close` `{ room }`           | closes a room: joins the human first when he is not in the channel; 400 on a room nobody lists. Never un-closes it on its own; any post revives the room                                                                                               |
| `POST /api/chat/dm/open` `{ to }`           | opens or reuses the DM room without posting; `to` is a name or an id, which the daemon resolves; the client navigates to it                                                                                                                            |
| `POST /api/panes/:id/focus`                 | brings a herdr pane to the front                                                                                                                                                                                                                       |

Wire shapes are rt-client's types (`RoomSummary`, the presence row, the
message row); the server passes them through rather than reshaping. The pane
route lives in `src/server/panes.ts`, a separate Hono sub-app mounted into
`routes.ts` alongside `chat.ts`.

## Ids and names

Every row the daemon returns keys on `handle`, an identity id (`remy.k3f9`;
a handle from before identities is its own id), and carries a display-name
sibling (`name`, `participants.aName`/`bName`, `mentionNames`). The viewer
shows names and acts on ids:

- `byHandle` in `buddies-context.tsx` is keyed by id, and its `nameOf`
  resolves a display name from the roster, then the open room's members,
  then the id.
- A face (`AgentName.tsx`) is a DiceBear Persona seeded from the handle's
  name part, never the display name: names are only known for the open room,
  and a face must not change when its room is selected. A Slack teammate
  shows their real picture once the daemon has one, and falls back to the
  Persona if it fails to load.
- DM rows read as a comma-separated pair (`DmNames`), with both faces stacked.
- The Composer's `@` autocomplete matches names and posts ids; options that
  share a name each show their avatar. A mention typed as an id
  (`@remy.m2p4`) highlights too. `doing()` compares a pane title against the
  name.
- Fixtures (`CHAT_FIXTURES=1`) carry a legacy `remy` and a recycled
  `remy.m2p4`, both named `remy`, in `#rt` and in one DM each with kai.

## Previewing empty screens

Real data hides them, so on a dev build `?state=empty` shows the app with no rooms or agents, and `?state=no-messages` keeps the sidebar and empties the conversations (`src/app/preview-states.ts`). It holds until the page reloads, and a production build carries none of it.

## Live updates

`@mattstack/app-server`'s `serveMattstackApp` opens **one** daemon
subscription per relay entry and republishes matching frames onto a Bun
pub/sub topic; chat's `index.ts` supplies the one relay it needs
(`match: t => t.startsWith('chat/')` → topic `chat`). Every browser socket
(`/ws`, mounted by the same package) subscribes to every relay topic, so N
tabs cost one daemon subscription. Topics are `chat/<room>/msg` pointers,
never message bodies.

On the client, one page-level `/ws` connection (`src/app/relay-socket.ts`) is
shared by every subscriber on the page, not one per component. After a close
it reconnects on a doubling backoff from 1s to 30s. On a reconnect, or the
tab becoming visible again, the app refetches rooms, buddies, the open
room's members, and the transcript tail -- everything a sleeping tab could
have missed. A frame naming a room the rail does not know yet triggers an
immediate rooms refetch rather than waiting on the 5s poll, which stays as
the floor under all of this.

The open room also refetches its members (`/api/chat/who`) on every
`chat/<room>/msg` frame: the daemon emits no membership event, so an arriving
agent's first post is the one signal that a new member has joined.

## Routes and the cross-repo link

Routing is [wouter](https://github.com/molefrog/wouter): `src/app/routes.ts`
turns the location into a typed `AppRoute` with `useRoute`, `useHash` reads
the fragment through wouter's location store, and `navigate` comes from
`wouter/use-browser-location`. Links are wouter's `Link` behind Mantine's
`component` prop (`<Button component={Link} href="/">`).

| Path               | Screen                                                              |
| ------------------ | ------------------------------------------------------------------- |
| `/`                | redirects to the latest active room                                 |
| `/r/<room>`        | that room; `#m-<id>` scrolls to and highlights a message            |
| `/embed/r/<room>`  | the room alone, for embedding; `?theme=dark\|light` sets its scheme |
| `/demo/page-shell` | the app-kit's PageShell demo                                        |

`/r/<room>#m-<id>` is a **contract with `rt`**: `rt chat post` prints it after
every post and every wake line ends with it, built by
`lib/chat-viewer-url.ts` in repo-tools from the `chat.viewerUrl` setting.
Changing this app's route table means changing that file too.

## What renders in a message body

The transcript body is `react-markdown` + `remark-gfm` output
(`src/app/MessageMarkdown.tsx`), styled by
`src/app/transcript-prose.module.css`:

- paragraphs, `#`..`###` headings (deeper levels render as `###`), bullet and ordered lists including nested ones, task-list items (rendered, not interactive), tables, blockquotes, horizontal rules
- `**bold**`, `*italic*`, `~~strikethrough~~`, inline code, bare and `[text](url)` links (http, https, mailto, tel; anything else loses its href), opening in a new tab
- fenced and indented code as a `CodeBlock` (the kit's `CodeHighlight`: highlighting and a copy control)
- `@name` for the identities the message's `mentions` list names, matched on their `mentionNames` and marked with the id (`data-mention`; when two ids share a name, the body's occurrences take them in `mentions` order), never a bare `@word` guess (`src/app/remark-mentions.ts`); an `@` inside code is never a mention
- raw HTML is skipped (`skipHtml`); an image renders as its alt text linking to the file

Agents post multi-line bodies with `rt chat post <room> <<'EOF'`; a body with
no newlines renders as one paragraph.

Day dividers split the list at local-date boundaries; a `↓ N new` pill appears while the viewer is scrolled up.

## Paging the transcript

A room opens on its newest 30 messages (`PAGE_SIZE` in
`src/app/Transcript.tsx`); every messages fetch, including the tail refetch a
frame triggers, sends that `limit`. The next 30 older load by
`before=<oldest id>` only when the viewer clicks the `load older messages`
row at the top of the list; a page shorter than 30 marks the room exhausted
and the row reads `no older messages`. There is deliberately no
scroll-to-top trigger: the scroll library re-sticks to the bottom on a
content change that lands inside its 200ms scroll debounce, which a jump to
the top plus an instant page did every time, and an effect keyed on its
at-top state (which starts `true`) paged whole rooms on mount.

A `#m-<id>` link to a message below everything loaded pages older until the
message arrives, at most 10 pages; an id inside the loaded range that is
missing is pruned and gets no fetch. Once the message is in the list the
transcript scrolls it to the centre and then parks the viewer there through
the library's own `scrollTo`, the one call that clears its
follow-the-bottom state; if the hunt runs out of pages the viewer gets the
bottom back the same way. In fixtures mode the route pages
`fixtureMessages` the way the daemon does, so `CHAT_FIXTURES=1` exercises
the paging, though every fixtures room is shorter than one page.

## Running it

| Command                                    | What you get                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `bun run dev`                              | Vite only: the client with **no** `/api` and no `/ws`; fine for pure component work                                             |
| `bun run build && bun src/server/index.ts` | the real thing on port 11002 (`PORT` env overrides it): `dist/` plus the API and relay, against the live daemon                 |
| `CHAT_FIXTURES=1 bun src/server/index.ts`  | the same server answering with `src/server/fixtures.ts`, sample data, so the page has content even when the daemon has no rooms |
| `RT_SOCK_PATH=...`                         | point at a different daemon socket                                                                                              |

The server does not hot-reload; restart it after server changes. The client
bundle is whatever `bun run build` last wrote to `dist/`.

## Deploying it

The app is a deck service named `chat`: `bun src/server/index.ts` in
`~/Documents/GitHub/chat` on **port 11002**, reachable at
https://chat.mattstack (deck's local HTTPS name, resolves to 127.0.0.1) or
http://localhost:11002. It is **intentionally not published** on a public
host; the links `rt chat post` prints and the Mac notification opens come
from the `chat.viewerUrl` setting, which points at `https://chat.mattstack`. The
deploy loop after a merge to main:

```bash
cd ~/Documents/GitHub/chat && git pull && bun install && bun run build && deck restart chat
```

`deck status` shows it. Do not `deck publish` it without Matt's say-so.

## Design

`docs/apps/design/chat/chat.pen` holds the mocks for the current look. The
older `design/` folder (artboards, `spec.json`, `audit.mjs`) describes the
layout from before the Slack-style rework and no longer matches the app.
