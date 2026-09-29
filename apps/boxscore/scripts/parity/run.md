# Design parity run

How to check one boxscore board, in one scheme, against its design. Every
board task ends with this run for its board in `dark` and `light`, and the
result must be **0 mismatches** outside the pending board fixes listed for Matt.

## What is compared

Only page content. The chrome (rail, brand, scheme control, page header with
its switches, freshness, scope and Refresh) is the kit's `MattstackShell` and
`PageShell`, which outrank the boards, so it is never compared. Each board
names its content roots in `boards.ts` (`roots`, or `panels` for board 04):

| Board  | Content roots                                             |
| ------ | --------------------------------------------------------- |
| 01, 07 | `Stat Leaders`, `Standings`, `Footnote`                   |
| 02     | `Metric Grid`                                             |
| 03     | `Back Link`, `Profile Header`, `Summary`, `Body`          |
| 04     | each `Panel · <label>`, on its own route                  |
| 05     | `Refresh Status`, `Stat Leaders`, `Standings`, `Footnote` |
| 06     | `Refresh Status`, `Skeleton`                              |

Every root is its own target with its own output stem
(`<slug>.<root>`, e.g. `01-leaderboard-table.standings`), and boxes are
relative to that root, not the page frame. The kit sets the content width
(its rail is not the board's), so after the route loads the runner resizes the
app viewport until the widest root on the route matches its design width, and
reports the width it used as `appViewportWidth`. Paths below are relative to `apps/boxscore`
unless they start with `docs/` (repo root) or `~`.

## What is where

| Thing                                                               | Where                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------ |
| Board table (slug, route, storage, scenario, roots, height, action) | `scripts/parity/boards.ts`                                   |
| Design exports, one per board and scheme                            | `docs/apps/design/boxscore/parity/<slug>.<dark\|light>.html` |
| Design renders (what the boards look like)                          | `docs/apps/design/boxscore/renders/<slug>.<scheme>.png`      |
| Collector (browser function file)                                   | `scripts/parity/collect.js`                                  |
| One-call runner (browser function file)                             | `scripts/parity/run.js`                                      |
| Config and upload helper for the runner                             | `scripts/parity/harness.ts`                                  |
| Diff and CLI                                                        | `scripts/parity/compare.ts`                                  |
| Every output (JSON, PNG)                                            | `~/.fast-browser/output/parity/`, never the repo             |

The design exports came from `docs/apps/design/boxscore/boxscore.pen` through
the Pencil MCP, `Export([frameId], "html-css", path, { includeLayerNames: true })`
once per board frame, with the frame's `theme.mode` set to the scheme. The
layer name attribute is `data-pencil-name`; colours are resolved hex. Frame
ids: `WqX8t` 01, `iUxSO` 02, `bhvvQ` 03, `JPhZn` 04, `k6kFQA` 05, `ULlmd` 06,
`rmvgy` 07. Re-export only when the `.pen` changes, with Pencil open on it.

The export has one defect the runner corrects on load: a stroked layer is
written `box-sizing: content-box` with its padding still inside its stated
width and height, so it renders too big. `run.js` subtracts the padding before
collecting, after which the page matches the renders pixel for pixel in size.
Never collect a design page without that step (the plain `collect.js` file
does not do it).

The font is the one difference the spec allows, so `run.js` removes it at
the source before measuring the design:

1. It opens the app first and reads its sans stack (the body's computed
   `font-family`), its monospace stack (`--mantine-font-family-monospace`)
   and its own `@font-face` rules, inlining each font file as a data URL.
2. It loads the export with Google Fonts blocked, injects the app's
   `@font-face` rules, and re-sets every layer that names a font: JetBrains
   Mono layers take the app's monospace stack, everything else the app's
   sans stack. It fails the run if any layer still computes another family,
   or if the app's faces did not load.
3. After the content-box correction, every layer the pen marks as hugging
   its width (a frame with no width, or `fit_content`; `scripts/parity/pen.ts`)
   that the export froze at a px width gets `width: fit-content`, so it
   reflows with the app's fonts instead of keeping Pencil's Inter width. The
   harness sends these paths per target (`hugWidths` in `/config`); a layer
   with a fixed pen width keeps it, and the app must match it.

The result reports `fonts` (both stacks and the face count) and `unfrozen`
(how many layers step 3 released). `pen.test.ts` checks that the pen paths
map one to one onto the export's named layers.

## How keys work (read before adding `data-parity`)

A node's key is the `/`-joined layer names of its **visible** ancestors plus
its own, relative to the content root. Visible means: text, an icon (`svg`/`img`),
or a layer with a fill or a stroke. Frames with neither are skipped, and
their children attach to the nearest visible ancestor. When names repeat under
the same visible parent, each gets `[i]` (0-based, document order). The root
itself is the node whose key is the root name.

App components put `data-parity="<layer name>"` on exactly the elements that
correspond to visible design layers, nested the same way. Unnamed wrapper
elements in the app are free: the collector looks through them. A text layer
is a `data-parity` element with no `data-parity` descendants and some text; its
text is `innerText` with whitespace collapsed.

To see the design keys for a board, run the design side (step 3 with
`designOnly: true`) and read `<stem>.<scheme>.design.json` through
`visibleOnly` from `compare.ts`.

## Ports

| Port  | What                                                              | Why this one                               |
| ----- | ----------------------------------------------------------------- | ------------------------------------------ |
| 11005 | The installed boxscore app                                        | Taken. Never start anything on it.         |
| 11095 | Fixture API server (`src/server/index.ts` with `PORT`)            | `PORT` overrides the app's 11005           |
| 5305  | Vite dev client, proxying `/api` and `/ws` to `BOXSCORE_API_PORT` | `vite.config.ts` reads `BOXSCORE_API_PORT` |
| 11096 | `harness.ts` (config + uploads)                                   | `PARITY_HARNESS_PORT` overrides it         |

Always use a `http://localhost` origin. `.mattstack` URLs do not work in the
browser.

If those ports are taken (a test-drive server someone else is using), leave
them alone and move all three: start the fixture server on another `PORT`,
Vite on another `--port` with `BOXSCORE_API_PORT` pointing at it, and the
harness with `PARITY_HARNESS_PORT=<port> PARITY_APP_ORIGIN=http://localhost:<vite port>`;
then pass `harness: "http://127.0.0.1:<port>"` to `run.js`. Run the parity
page in its own tab, since the runner navigates the current one.

## Steps for one board and scheme

`<slug>` is a slug from `boards.ts` (e.g. `01-leaderboard-table`), `<scheme>`
is `dark` or `light`, `<scenario>` is that board's `scenario` column.

### 1. Start three background processes

Run each with the Bash tool's `run_in_background: true`, from
`apps/boxscore`:

```bash
BOXSCORE_FIXTURE=design BOXSCORE_FIXTURE_SCENARIO=<scenario> BOXSCORE_DB=$TMPDIR/boxscore-parity.sqlite PORT=11095 bun src/server/index.ts
```

```bash
BOXSCORE_API_PORT=11095 bun run dev -- --port 5305 --strictPort
```

```bash
bun scripts/parity/harness.ts
```

Expect `boxscore listening on http://127.0.0.1:11095`, `Local:
http://localhost:5305/` (Vite also prints `Failed to resolve dependency`
warnings for kit packages boxscore does not use; ignore them), and `parity
harness on http://127.0.0.1:11096`. Check the proxy reaches the fixture:

```bash
curl -s http://localhost:5305/api/leaderboard | head -c 200
```

It must mention `"currentUser":"srivera"`. If a port is taken, find the owner
with `lsof -nP -iTCP:<port> -sTCP:LISTEN`; stop it only if it is one of
yours.

The scenario is fixed per server process. Boards 05 (`refreshing`) and 06
(`cold-stalled`) need the fixture server restarted with that scenario; the
rest use `warm`. Vite and the harness keep running across boards.

### 2. Load the browser tools

Load the Fast Browser tools with ToolSearch:

```
select:mcp__plugin_fast-browser_fast-browser__browser_run_code_unsafe,mcp__plugin_fast-browser_fast-browser__browser_tabs
```

and invoke the `fast-browser:fast-browsing` skill. If no page is open
(`browser_run_code_unsafe` fails with `Target page, context or browser has
been closed`), open one with `browser_tabs` `{ "action": "new", "url":
"about:blank" }`.

### 3. Run the board in one call

`browser_run_code_unsafe` with:

```json
{
  "filename": "<absolute path to apps/boxscore>/scripts/parity/run.js",
  "args": { "slug": "<slug>", "scheme": "<scheme>" }
}
```

It sets a `1440 x height` viewport and the scheme, opens the design export,
corrects it, and collects every target root. Then, once per route (the roots
of one board share a load, since a refresh or a stall cannot be replayed per
root): it opens the app, clears localStorage and sets the board's `storage`
plus the scheme, loads the route, disables transitions and animations, waits
for the first root (or, on a board with an action, the action's layer),
asserts `data-mantine-color-scheme` is the scheme, does the board's action
(05 clicks `Refresh Button` in the page header and waits for `Refresh
Status`, then for `Fresh Label` to show a two-digit elapsed time; 06 waits up
to 90 s for `RS Sub` to contain `still waiting on GitLab`, the copy shown once
the reading has held past the 30 s request deadline), waits for every root,
matches the content width (see "What is compared"), then collects and
screenshots each root and composes its side-by-side. `Refresh Button` and
`Fresh Label` are the only `data-parity` names left on the chrome, and only
for this action. It uploads everything to `~/.fast-browser/output/parity/`:

| File                                     | What                                                  |
| ---------------------------------------- | ----------------------------------------------------- |
| `<stem>.<scheme>.design.json`            | raw design collection (all named layers)              |
| `<stem>.<scheme>.app.json`               | app collection (`data-parity` elements)               |
| `<stem>.<scheme>.design.png`, `.app.png` | screenshots of the root                               |
| `<stem>.<scheme>.side.png`               | design, app, and their difference (black = identical) |

`<stem>` is `<slug>.<root>` (e.g. `05-refreshing.refresh-status`); board 04
compares ten panels, each on its own route with root `Panel · <label>`, so its
stems are `04-stat-evidence-variants.<panel>` (e.g. `.coding-days`).

It returns `{ targets: [{ stem, design, app }], appViewportWidth }` (node
counts, and the app width used per route) on success, or
the same plus `failedStep`, `error` and `url`. A timeout at `app: load <route>`
means the root `data-parity` element never appeared.

Optional args: `designOnly: true` stops after the design side;
`harness` overrides `http://127.0.0.1:11096`.

### 4. Compare

From `apps/boxscore`:

```bash
bun scripts/parity/compare.ts --board <slug> <scheme>
```

or for one pair of files:

```bash
bun scripts/parity/compare.ts ~/.fast-browser/output/parity/<stem>.<scheme>.design.json ~/.fast-browser/output/parity/<stem>.<scheme>.app.json <slug>
```

It prints `<title>: 0 mismatches` and exits 0, or a table (`key`, `field`,
`design`, `app`) and exits 1. What it checks, per design key: present in the
app (`missing`), one app node per key (`duplicate`), `x`, `y`, `h` within 1px,
`w` within 1px except text, `fill`, `stroke`, `color` equal as rgb/rgba (1
unit per channel of rounding slack), cumulative `opacity` within 0.01, and
`text` equal. Text on a `Fresh Label` or `RS Sub` layer is compared with every
digit run masked, so elapsed times and counts may differ but the words may
not. Then every app key must exist in the design (`extra`).

### 5. Look at the side-by-side

Read `~/.fast-browser/output/parity/<stem>.<scheme>.side.png`. Say plainly
what differs, even with 0 mismatches: parity covers only elements that carry
`data-parity`, so anything unmarked (a chart's inner marks, a wrong icon
glyph, a text width) shows only here.

### 6. Report

The mismatch table (it must be empty) and what the side-by-side shows, for
each scheme.

### 7. Stop the servers

Stop each background process (TaskStop with its task id), or by port:

```bash
kill $(lsof -tiTCP:11095 -sTCP:LISTEN) $(lsof -tiTCP:5305 -sTCP:LISTEN) $(lsof -tiTCP:11096 -sTCP:LISTEN)
```

Never kill whatever holds 11005.
