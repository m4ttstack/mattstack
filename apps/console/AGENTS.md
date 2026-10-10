# AGENTS.md

Contract for anyone (human or agent) working in this repo.

## UI colour and type

Colour and type follow the repo-wide authoring guide: `docs/apps/ui-authoring.md`.
Read it before writing any colour, contrast, or font
decision; tokens are picked by role there, and raw values fail lint and the
contrast gates.

## Kit contract lives upstream

This app consumes `@mattstack/app-kit` and `@mattstack/app-server` as workspace packages
(`workspace:*` in `package.json`; the packages live in `packages/` of this same repo). The kit's
own contract, covering the Mantine import walls, theme layering, facades (modals, notifications,
forms), the icon registry, `MattstackShell`, and the server package's `serveMattstackApp` surface,
is documented in `apps/AGENTS.md`. Read that before touching anything that imports
from `@mattstack/app-kit/*` or `@mattstack/app-server`.

This file covers only what's specific to console: its routes, its runs domain, the wiring map, and
how it wires up the shell and server packages.

## What this app is

A local web app for the mattstack pipeline: what's running, what needs you, and what a run
actually did. One `Bun.serve` process (Hono, via `@mattstack/app-server`) serves a built Vite SPA
and an `/api` + `/ws` surface backed by `@mattstack/rt-client`, called in-process, with no
shelling out to `rt` and nothing proxied through to another service. The dev server defaults to port `11011` (`PORT`, and the `vite.config.ts` proxy); the production
`deck` service runs on `11001` (`mattstack.deck.json`).

## Routes and chrome (`src/app/App.tsx`, `src/app/routes.ts`)

Routing is `wouter`, via `useAppRoute()` (`src/app/routes.ts`), which maps the current location to
a structured `AppRoute` union: `board`, `run`, `search`, `wiring`, `settings`, `settings-embed`,
`config`, `not-found`.
`/settings` is the grouped, filterable page over every registered key (`src/app/settings/`);
one row at a time opens in place on its Value | Where it's set panel (Value first, and a
structured value in its JSON editor first), kept in `?explain=<key>`
(with `?tab=where` and `?fix=<layer>` when they apply) through replaced history entries, so a
reload or a link reopens that row and scrolls to it; old `/config/:key` links redirect there. `/embed/settings/<group>` renders one group with no
shell for another app to frame in a modal (`SettingsEmbed.tsx`): it takes the host's `?scheme=`,
paints no background, and talks to the host only through `@mattstack/settings-kit/embed`'s
messages (`height`, `saved`, `close`). Run
detail's effective inputs open a key inline (its value per scope) and link
here through "Change it in Settings →"; nothing on a run opens a modal or a
second drawer over the inputs drawer. The
`/runs/:repo/:runId` route carries a percent-encoded, possibly `remote:`/`path:`-prefixed repo
identity in the `repo` segment; `canonicalRepo()` decodes and re-serializes it back to the exact
wire form `@mattstack/rt-client`'s `serializeIdentity` produces, because a repo identity containing
a slash would otherwise 404 every lookup. A malformed percent-escape reads as `not-found`, never a
thrown error.

`App.tsx` mounts `MattstackShell` (from `@mattstack/app-kit/app`) with `name="console"` and no
`appName` (the mattstack viewer owns app switching), a `MattstackShell.Rail` of `RailLink`s (Runs, Search) plus the app-specific
`WiringRailEntry`, and routes each `AppRoute` to its page component inside a per-path
`RouteErrorBoundary` (keyed on `path` so a caught error on one route doesn't linger after
navigating away, since Mantine has no error boundary of its own and the run-detail suspense query
throws on failure).

## Runs domain (`src/app/runs/`, `src/server/runs.ts`)

The runs page (`runs-page/`), run detail, search, and their supporting pieces (the `derive/`
selectors, aging, liveness, timeline, failure excerpts, command provenance, effective-inputs) all live under
`src/app/runs/`, backed by `src/server/runs.ts` and `src/server/effectiveInputs.ts` on the server
side. `src/server/routes.ts` chains these Hono sub-routers plus `enrich`, `settings`, and `skills`
into one `routes` export; handlers stay inline and routes stay chained because Hono's RPC type
inference (`AppType = typeof routes`, consumed by `src/app/api.ts`) breaks if a handler is lifted
into a named function or a route is registered unchained.

**The `run-updated` → `runs` relay**: `src/server/index.ts` configures `serveMattstackApp` with
`relay: [{ match: t => t === 'run-updated', topic: 'runs' }]`. `@mattstack/rt-client` emits
`run-updated` events; the relay re-broadcasts them over the app-kit WebSocket surface under the
`runs` topic, which is what `src/app/runs/useRuns.ts` subscribes to for live updates. If a new
server-side event needs to reach the client live, it goes through this relay list, not a bespoke
WebSocket wire-up.

## Wiring map (`src/app/wiring/`)

The Wiring page (`WiringMap.tsx`) shows the mattstack skill graph read from
`@mattstack/rt-client` in three tabs: Graph, Surface and Health. Its state lives in the URL
(`graph/useWiringUrl.ts`), so every view, selection and open drawer is a link.

- **Graph tab** (`graph/`). The focus list (`FocusList.tsx`: Pipeline, On-demand, Board and an
  Unwired row) is `PageShell.Sidebar` content. The focused skill draws on a React Flow template
  canvas (`TemplateCanvas.tsx`) in `PageShell.Content`, which sets its own `bg` and a dotted
  `Background`: the template's rows in the middle, the files that fill its placeholders on one
  side, and the steps it links to or its compiled output on the other. Selecting a row or card
  opens the compiled-skill drawer (`drawer/SkillDrawer.tsx`, with Text, Used by and History tabs),
  and a slot's Bind or Change opens the rebind panel (`drawer/RebindPanel.tsx`). A binding or
  surface change that is not synced yet shows the unsynced banner (`UnsyncedBanner.tsx`), docked
  in PageShell's `topNotch`, with Sync and Discard.
- **Template model** (`graph/model/*`). Pure functions from rt's payloads (composition, check,
  anatomy, changes) to what the tab draws: `focusModel` (the focus list), `templateModel` (rows,
  input cards, link cards, output card), `drawerContent` (what the drawer shows for a selection),
  `pendingChanges` (what the banner lists) and `statusTone`. `graph/layout/templateLayout.ts`
  places the nodes. A change to what the tab shows starts in the model and its tests.
- **Writes** (bind, surface, sync, discard) confirm through `modals.confirm` and report through
  `notifications`, and one write per pack runs at a time. The banner's Sync and Discard send the
  `signature` of the `changes` read their confirm listed; the server refuses a commit-pending sync
  or a discard without one, and rt refuses either once the pack no longer matches it.
- **Org base packs.** rt tags a fill, slot, binder slot or anatomy source from an org base pack with `origin: "base"`, `base` and `baseVersion` (a team-pack copy carrying `compiled.json` included), names the pack's base in composition's `extends`, and marks surface rows with `base`. Every view reads the owner through `ownerOf` (`owner.ts`), never by comparing plugin names or reading rt's `org` version token. History, diff and dirty files name a base path as `base:<name>/<path in the base>`. The design fixture's `org-base` and `org-base-drift` scenarios draw all of it.
- **Surface and Health tabs** (`SurfaceTab.tsx`, `HealthTab.tsx`). `VersionTimeline` and
  `SeamCompare` serve the drawer's History tab.

`WiringRailEntry` is the one component that reaches into the shell's rail context (`useShellRail`
from `@mattstack/app-kit/app`) to badge the rail entry with attention state.

### Design parity

The Graph tab is built against the boards in `docs/apps/design/console/`. Its README lists them
and the board-fix list of expected differences. Every UI change to the tab ends with a parity run
for its boards in light and dark, following `apps/console/scripts/parity/run.md`.

The parity data source is the design fixture: started with `CONSOLE_FIXTURE=design`, the server
answers the skills routes from the invented `acme` pack in `src/server/fixtures/design/`, with no
rt, git or pack on the machine. `CONSOLE_FIXTURE_SCENARIO` picks the data: `clean` (the default),
`unsynced` for the two unsynced boards, or one of the states no board draws (listed in
`scenarios.ts`). The runs and run pages have boards too: `runs` and `runs-empty` answer the runs,
gates and evidence routes from the invented `acme/web` runs (`runsFixture.ts`), with the board's
clock as `asOf`, which the pages read through `nowOf` (`src/app/runs/derive/clock.ts`). Under a
fixture scenario the server never calls the daemon and refuses every write.

## Embedded server / `build:binary`

```bash
bun run build         # tsc -p tsconfig.json && vite build -> dist/
bun run build:binary   # vite build && mattstack-embed-assets && bun build --compile
```

`mattstack-embed-assets` (the bin shipped by `@mattstack/app-server`) reads the built `dist/` and
generates `src/server/embedded/manifest.ts` (gitignored, build-time only, never hand-edited, and
never committed). `src/server/index.ts` imports it dynamically as `import('./embedded/manifest' as
string)`. The `as string` cast keeps `tsc` from trying to resolve the gitignored path at
typecheck time, while `bun build --compile` still sees the literal specifier and embeds the module
into the compiled binary. `serveMattstackApp`'s embedded-mode detection (`decideServingMode` /
`loadEmbeddedManifest`, both in the app-server package) is what lets the resulting
`dist-bin/console` binary serve its own assets with no `dist/` on disk next to it. See
`apps/console/scripts/serve-check.sh` (run by the `serve-check` task) for the end-to-end proof
(build the binary, hide `dist/`, curl it).

## Formatting, linting, testing

Same toolchain as any app built on the kit: `bun run format` / `format:check` (Prettier, import
order via `@ianvs/prettier-plugin-sort-imports`), `bun run lint` (ESLint over `src`, including the
kit's Mantine import wall), `bun run typecheck` (`tsc -p tsconfig.json`), `bun run test` (Vitest).
See `apps/AGENTS.md` for what each of those enforces and why.
