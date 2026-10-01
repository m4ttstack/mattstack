# Design parity run

How to check one console board, in one scheme, against its design. Every UI
task on the Wiring page's Graph tab ends with this run for its boards in `dark`
and `light`, and the result must be **0 mismatches** outside the board-fix list
in `docs/apps/design/console/README.md`.

## What is compared

The board's content, not the chrome around it. The rail, app bar, PageShell
tab bar, Drawer frame, Modal frame and Select dropdown are the kit's and
Mantine's own (see "Kit chrome is not compared" in the design README). Inside
them, each board names its content roots in `boards.ts`:

| Board                                                                        | Roots                                                                              |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `template-work`, `template-plan`                                             | `Focus list`, `Stage`, `Focus header`                                              |
| `drawer-text-range`                                                          | `Focus list`, `Stage`, `Focus header`, `Drawer · compiled skill`                   |
| `drawer-include-row`, `drawer-input-card`, `drawer-history`, `drawer-rebind` | `Focus list`, `Stage`, `Focus header`, `Drawer`                                    |
| `unsynced-banner`                                                            | `Focus list`, `Stage`, `Focus header`, `Banner · unsynced`                         |
| `unsynced-confirm`                                                           | `Focus list`, `Stage`, `Focus header`, `Banner · unsynced`, `Modal · sync changes` |

`Focus header` sits inside `Stage` and is also compared as its own root.
`Focus list` is the content of the kit's `PageShell.Sidebar`, and it is
compared.

Every root is its own target with its own output stem (`<slug>.<root>`, e.g.
`template-plan.focus-header`), and boxes are relative to that root. The boards
are 1680 wide (`viewportWidth` in `harness.ts`); after the route loads the
runner resizes the app viewport until the widest root matches its design
width. Paths below are relative to the repo root unless they start with `~`.
The collector, runner, compare CLI and harness server are shared by every app
and live in `scripts/parity/`; the board table and harness config are
console's own.

## What is where

| Thing                                                      | Where                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| Board table (slug, route, scenario, roots, height, action) | `apps/console/scripts/parity/boards.ts`                     |
| Harness config (ports, design dir, pen path, output dir)   | `apps/console/scripts/parity/harness.ts`                    |
| Design exports, one per board and scheme                   | `docs/apps/design/console/parity/<slug>.<dark\|light>.html` |
| Design renders (what the boards look like)                 | `docs/apps/design/console/renders/<slug>.<scheme>.png`      |
| Fixture data the server answers from                       | `apps/console/src/server/fixtures/design/`                  |
| Collector, runner, harness server, diff CLI                | `scripts/parity/`                                           |
| Every output (JSON, PNG)                                   | `~/.fast-browser/output/parity/console/`, never the repo    |

The fixture is the invented `acme` pack the boards were drawn from: its
composition, check, anatomy, changes and history payloads are JSON files, and
the skill files the drawers show are under `files/`, at their path below
`/fixture`. `boards.test.ts` beside them fails when a fixture line stops
matching the text a drawer board draws.

`run.js` corrects the export's content-box sizes and re-sets the canvas fonts
in the app's own stacks before measuring, exactly as in boxscore's runbook
(`apps/boxscore/scripts/parity/run.md`, "What is compared"); the result reports
`fonts` and `unfrozen` the same way.

## How keys work (read before adding `data-parity`)

A node's key is the `/`-joined layer names of its **visible** ancestors plus
its own, relative to the content root. Visible means: text, an icon
(`svg`/`img`), or a layer with a fill or a stroke. Frames with neither are
skipped. When names repeat under the same visible parent, each gets `[i]`
(0-based, document order).

App components put `data-parity="<layer name>"` on exactly the elements that
correspond to visible design layers, nested the same way. Layer names are the
`data-pencil-name` values in the export (`line 288`, `placeholder · L140`,
`input · gate-protocol.md`, `seg · Rendered`). To see the design keys for a
board, run step 3 with `designOnly: true` and read
`<stem>.<scheme>.design.json` through `visibleOnly` from `compare.ts`.

## Ports

| Port  | What                                                             | Why this one                              |
| ----- | ---------------------------------------------------------------- | ----------------------------------------- |
| 11011 | console's own dev server                                         | Leave it alone.                           |
| 11001 | the installed console (deck)                                     | Taken. Never start anything on it.        |
| 11097 | Fixture API server (`src/server/index.ts` with `PORT`)           | `PORT` overrides the server's 11011       |
| 5307  | Vite dev client, proxying `/api` and `/ws` to `CONSOLE_API_PORT` | `vite.config.ts` reads `CONSOLE_API_PORT` |
| 11098 | `harness.ts` (config + uploads), `harnessPort` in its config     | `PARITY_HARNESS_PORT` overrides it        |

Always use a `http://localhost` origin. `.mattstack` URLs do not work in the
browser.

If those ports are taken, leave them alone and move all three: the fixture
server on another `PORT`, Vite on another `--port` with `CONSOLE_API_PORT`
pointing at it, and the harness with
`PARITY_HARNESS_PORT=<port> PARITY_APP_ORIGIN=http://localhost:<vite port>`;
then pass that `harness` URL to `run.js` in step 3. Run the parity page in its
own tab, since the runner navigates the current one.

## Steps for one board and scheme

`<slug>` is a slug from `boards.ts`, `<scheme>` is `dark` or `light`,
`<scenario>` is that board's `scenario` (`clean`, or `unsynced` for the two
`unsynced-*` boards).

### 1. Start three background processes

Run each with the Bash tool's `run_in_background: true`, from `apps/console`:

```bash
CONSOLE_FIXTURE=design CONSOLE_FIXTURE_SCENARIO=<scenario> PORT=11097 bun src/server/index.ts
```

```bash
CONSOLE_API_PORT=11097 bunx vite --port 5307 --strictPort
```

```bash
bun scripts/parity/harness.ts
```

Expect `console listening on http://127.0.0.1:11097`, `Local:
http://localhost:5307/`, and `parity harness on http://127.0.0.1:11098`. The
fixture server needs no rt, git or pack on the machine. Check the proxy
reaches the fixture:

```bash
curl -s 'http://localhost:5307/api/skills/composition?pack=acme' | head -c 200
```

It must mention `"packDir":"/fixture/packs/acme"`. If a port is taken, find
the owner with `lsof -nP -iTCP:<port> -sTCP:LISTEN`; stop it only if it is one
of yours.

The scenario is fixed per server process. The `unsynced-*` boards need the
fixture server restarted with `CONSOLE_FIXTURE_SCENARIO=unsynced`; the rest use
`clean`. Vite and the harness keep running across boards.

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
  "filename": "<absolute path to the repo root>/scripts/parity/run.js",
  "args": {
    "slug": "<slug>",
    "scheme": "<scheme>",
    "harness": "http://127.0.0.1:11098"
  }
}
```

It sets a `1680 x 1040` viewport and the scheme, opens the design export,
corrects it, and collects every root. Then it opens the app, sets the scheme
in localStorage, loads the board's route, disables transitions and
animations, waits for the first root (or the action's first layer), asserts
`data-mantine-color-scheme` is the scheme, does the board's action, waits for
every root, matches the content width, and collects and screenshots each root
with its side-by-side. Two boards have an action:

- `drawer-rebind` clicks `Select`, then `option · plan-policy-strict`, then
  `Select` again, and waits for `options`: the board draws the picker open on
  its new choice.
- `unsynced-confirm` clicks `button · Sync changes` in the banner and waits
  for `Modal · sync changes`.

It uploads everything to `~/.fast-browser/output/parity/console/`:

| File                                     | What                                                  |
| ---------------------------------------- | ----------------------------------------------------- |
| `<stem>.<scheme>.design.json`            | raw design collection (all named layers)              |
| `<stem>.<scheme>.app.json`               | app collection (`data-parity` elements)               |
| `<stem>.<scheme>.design.png`, `.app.png` | screenshots of the root                               |
| `<stem>.<scheme>.side.png`               | design, app, and their difference (black = identical) |

It returns `{ targets: [{ stem, design, app }], appViewportWidth }` on success,
or the same plus `failedStep`, `error` and `url`. A timeout at `app: load
<route>` means the first root's `data-parity` element never appeared.

### 4. Compare

From the repo root (`--app console` loads the `app` export of
`apps/console/scripts/parity/harness.ts`):

```bash
bun scripts/parity/compare.ts --app console --board <slug> <scheme>
```

or for one pair of files:

```bash
bun scripts/parity/compare.ts --app console ~/.fast-browser/output/parity/console/<stem>.<scheme>.design.json ~/.fast-browser/output/parity/console/<stem>.<scheme>.app.json <slug>
```

It prints `<title>: 0 mismatches` and exits 0, or a table (`key`, `field`,
`design`, `app`) and exits 1. Per design key it checks presence, one app node
per key, `x`, `y`, `h` within 1px, `w` within 1px except text, `fill`,
`stroke`, `color`, cumulative `opacity`, and `text`; then every app key must
exist in the design. No console board has time-based text, so every text is
compared as written.

### 5. Look at the side-by-side

Read `~/.fast-browser/output/parity/console/<stem>.<scheme>.side.png` and the
board's render in `docs/apps/design/console/renders/`. Say plainly what
differs, even with 0 mismatches: parity covers only elements that carry
`data-parity`, so anything unmarked (an edge, a handle, an icon glyph, a text
width) shows only here.

### 6. Report

The mismatch table (it must be empty, apart from the board-fix list) and what
the side-by-side shows, for each scheme.

### 7. Stop the servers

Stop each background process (TaskStop with its task id), or by port:

```bash
kill $(lsof -tiTCP:11097 -sTCP:LISTEN) $(lsof -tiTCP:5307 -sTCP:LISTEN) $(lsof -tiTCP:11098 -sTCP:LISTEN)
```

Never kill whatever holds 11001 or 11011.
