# rt pane attach: pick an agent and attach to it

## Intent

`herdr agent attach <target>` drops you into an agent's terminal, but you
have to know the pane id. Matt wants to run it from a picker: see every Claude
agent pane with everything mattstack knows about it (who it is in chat, its
face, what started it, what it is waiting on), pick one, and land in it.

The mock is `docs/design/pane-attach/pane-attach.pen`, frame
**A · List + preview**. Frame B (a face per row) was considered and dropped.

## Goals

- `rt pane attach [pane]`: with no pane at a terminal, show the picker;
  with a pane, attach straight away.
- Each row shows what mattstack knows about that pane, and the preview pane
  shows all of it plus the chat face.
- `rt pane list` gets the same added data, so agents and the console can
  read it too.

## Non-goals

- Live refresh while the picker is open. The list is a snapshot taken when
  the picker opens.
- A light palette. rt-ui's interactive views always paint their own dark
  palette (`ui/internal/theme`), and this picker does the same.
- A GUI version (tray or console).
- Codex or other non-Claude agent panes. Listing them is a later change.

## Anti-goals

- Changing the bytes `rt pane list` prints off a terminal. Agents read that
  output, and `commands/__tests__/fixtures/herd-pane-agent-bytes.json` pins
  it. New data is additive in `--json` only, plus the person-facing table.
- A picker that hangs or prints an empty list when called by an agent or
  script. Gate the picker on `process.stdin.isTTY && !json &&
  !process.env.RT_BATCH`, and leave the non-TTY path a usage error, as the
  command-tree rule requires.

## What the picker shows

Layout per the mock: header (`rt · pane attach`, the agent count and how many
are waiting on you), a filter line, the list on the left, the preview on the
right, and a key bar.

**Rows**, grouped by herdr workspace, with background (`bg:`) panes in a
last group called "background":

- the status glyph and word (working, waiting on you, idle, done), using the
  status roles `rt pane list` already uses
- the chat handle, or "not signed in" in a faint tone
- repo · branch
- herdr tab (or the herd job for a background pane)
- one badge, highest first: open gate (`? gate`), herd (`herd <id>`),
  caller (`board:review`), first chat room (`#room`)

Filtering matches the handle, repo, branch, tab and rooms.

**Preview** for the highlighted row:

- the face, 16 × 8 cells, beside the handle, presence, rooms and
  provider · model · effort
- WHERE: repo · branch, folder, herdr workspace › tab · pane id
- STARTED BY: the `rt agent` record (id, caller, account, start time), or
  "started by hand" when there is no record
- HERD: herd id, job number and title, or "not in a herd"
- GATE: the open question's text, shown above HERD, only when the pane has
  an open gate
- ON SCREEN: the last 3 lines of the pane (what `rt pane peek` returns)

A pane with no chat identity shows a plain `?` tile where the face goes.

When the terminal is too narrow for both columns (under about 100 columns),
hide the preview and keep the list.

**Keys:** ↵ attach · ctrl-t attach, taking over · ctrl-f just focus it
(`rt pane focus`) · ↑↓ move · esc quit.

## The face

The face is the chat face: the PNG `rt chat avatar <handle> --json` writes
(`commands/chat-avatar.ts`, `generatedFace` and `chatFacePng`). The TS side
resolves one PNG path per signed-in handle and passes the path to the Go
picker with the row's preview data.

The tile behind the face is the handle's own tile (`ownTile` in
`packages/rt-client/src/face-tiles.ts`, what `rt chat avatar` draws with no
`--alongside`), so a handle looks the same here as anywhere else it is drawn
alone. *(My call.)*

A face not yet cached is drawn by `Bun.WebView` (`lib/chat-face-png.ts`, up
to 15 s each). The verb renders missing faces in parallel and waits at most
about a second before opening the picker; any face still missing shows the
`?` tile for this run and is cached for the next. No patching faces in
after the picker opens. *(My call.)*

The Go side draws it in a 16 × 8 cell box:

- **Kitty graphics protocol** when the terminal supports it. herdr 0.9.5
  renders kitty images from its panes by default (`terminal.kitty_graphics`,
  default true) when the outer terminal supports them, so this works inside
  herdr on Ghostty. Detect support by sending the kitty graphics query and
  waiting briefly for the reply, not by guessing from environment variables.
- **Half-blocks** otherwise: decode the PNG, box-filter it down to 16 × 16
  pixels, and draw 8 rows of `▀` with truecolor foreground and background.

The mock's **Face rendering** frame shows both.

## Data: what the daemon adds to each pane

`pane:list` (`lib/daemon/handlers/pane.ts`, `paneRow`) already joins
herdr's panes to chat presence. Each `ChatPane`
(`packages/rt-client/src/commands.ts`) gains optional fields, present only
when there is data:

- `agent`: from the agents store (`lib/state/agents-store.ts`): id, caller,
  label, provider, model, effort, account, start time. Match by session id
  first; fall back to pane id only for a record that has not finished and
  whose server (visible or background) matches the pane's. herdr renumbers
  panes, records live 30 days, and a bare id like `w1-3` can exist on both
  servers, so a looser match shows a stale "started by". *(My call.)*
- `herd`: the herd and job the pane is a worker for: herd id and the job's
  `name` (the slug in `HerdJobRow`, via `jobsByPane`). There is no job
  number or title in the herd store, and adding one is out of scope; the
  row and preview show the slug. *(My call.)*
- `gate`: the open gate whose pane (`origin.paneId`, else the row's `pane`)
  is this pane: gate id and the question text

**Which panes.** Claude panes only for now, decided by Matt: the same set
`pane:list` already returns on both servers. No change to that filter.

The rows and the preview read these fields. `rt pane list`'s person-facing
table gains the badge column. Its off-terminal text stays byte-identical, and
`--json` only gains keys.

The ON SCREEN lines and the face paths are fetched by the attach verb when
the picker opens, not added to `pane:list`.

## Attaching

- A visible-server pane: run `herdr agent attach <pane>` in the current
  terminal with inherited stdio, adding `--takeover` for ctrl-t. rt exits
  with herdr's exit code.
- A background (`bg:`) pane lives on the hidden herdr server, which a plain
  `herdr agent attach` cannot reach. Attach to it in the current terminal
  through that server, using the same pane and terminal lookup
  `lib/daemon/attend.ts` does, but in place rather than in a new tab.
  *(My call: the picker never opens a new tab, so ↵ means the same thing
  for every row.)*
- ctrl-f calls the existing `pane:focus` and exits.
- The pane the picker runs in (`HERDR_PANE_ID`) is left out of the list, so
  you cannot attach into yourself. *(My call.)*
- Nothing in rt uses `herdr agent attach` yet. The plan's first task is a
  short manual check that it works from inside a herdr pane against a pane
  of the same server, with and without `--takeover`. If herdr refuses
  nested attach, stop and bring it back to Matt: the fallback would be
  ↵ = `pane:focus`, which changes what the verb is.

## Approaches considered

1. **List + preview** (chosen): dense rows, a big face and full detail for
   the highlighted pane. Needs a preview pane in the Go picker, which the
   file navigator or mission views could reuse later.
2. **A tiny face per row** (frame B): 8 × 4-cell faces and three lines per
   pane, with no preview. Dropped: the faces barely read, and the detail does
   not fit.
3. **Text first, faces later**: dropped, because the face is part of what
   Matt asked for.

## Constraints

- No UI code on the TS side (`lib/__tests__/no-ui-in-cli.test.ts`). The
  picker, the preview layout and the image drawing all live in `ui/` (Go).
  TS only gathers data and drives rt-ui.
- All printing goes through `lib/ui/out.ts`. Failures are
  `UserActionableError`s.
- The new leaf goes in `lib/command-tree-def.ts` under `pane`, with
  `omitBehavior: "picker"` and a plain-language description. Then run `bun run
  docs:gen` and `bun run picker:check`. `commands/pane.ts` is already in
  `lib/module-registry.ts`.
- The picker is a person-facing surface: verify it in a real terminal
  inside herdr, both with kitty graphics and with them turned off (the
  half-block path), and screenshot both before calling it done.

## Left to the builder

- How rt-ui's picker protocol carries per-item preview data (blocks, image
  path) and how the Go picker lays out the two columns.
- How long to wait for the kitty query's reply, and caching the answer.
- Whether the ON SCREEN lines come from one daemon call per pane or a
  batched call.
- Exact column widths, truncation and the narrow-terminal cutoff.
