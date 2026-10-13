> Scope: `apps/*` and the apps platform packages (`packages/gate-kit`,
> `packages/server`, `packages/tokens`, `packages/tokyo`,
> `packages/tui-kit`, `packages/ui`). rt's own contract is the root
> `AGENTS.md`; this file was the apps repo's before the fold-in.

# AGENTS.md

Contract for anyone (human or agent) working in this repo: editing
`packages/ui/src/**`, wiring up a form/modal/notification, adding a
component, touching `packages/server/src/**`, or consuming
`@mattstack/app-kit` / `@mattstack/app-server` from another app. Sections
1-7 are the kit contract (`packages/ui/src`), unchanged in substance from
`mantine-kit`'s own `AGENTS.md` (mattstack apps absorbed `src/ui` from
mantine-kit; see `docs/superpowers/specs/2026-08-26-app-kit-design.md`).
"The mattstack layer", "The server package", and "Consumer requirements"
are new to this repo. Colour and type decisions are NOT made here:
`docs/apps/ui-authoring.md` owns them, for this package and every app. "Working
in this repo" right below is the repo-wide reading order and layout notes;
it precedes the numbered kit contract sections.

## Working in this repo

### Reading order

1. `docs/apps/README.md` -- what the four platform packages are, the
   subpath tables, the consumer snippets, the repository layout, and local
   development.
2. `docs/superpowers/specs/2026-08-26-app-kit-design.md` -- historical: why
   these packages exist and the decisions taken during brainstorming.
3. `docs/superpowers/specs/2026-09-06-apps-fold-in-design.md` -- historical:
   why the five apps (chat, console, boxscore, board, deck) moved into this
   repo as `apps/<name>` and the rename to `m4ttstack/apps`. The fold-in
   this spec describes is complete; all five apps already live here.
4. The kit contract below (sections 1 to 10): import walls, theme and icon
   extension points, the boot family, and the consumer requirements a new
   app must not skip.
5. `docs/apps/ui-authoring.md` -- MANDATORY before writing any UI
   anywhere in this repo: kit chrome and components over design boards,
   the rail and `PageShell` rule, the Mantine styling ladder, the Radix
   step model, the role tokens, the contrast bars and their ledger, and
   the type rules. Each app's own
   `apps/<name>/AGENTS.md` points back here and carries that app's
   specifics.

### Repository layout

`packages/{ui,server,tokyo,tui-kit,tokens,gate-kit}` and
`apps/{chat,console,boxscore,board,deck}` are the two workspace roots; see
`docs/apps/README.md`'s "Repository layout" section for what each package/app is.
`packages/gate-kit` (`@mattstack/gate-kit`, the gate sheet primitives
console and board share) is a private workspace member like
`packages/tokens`, not one of the four versioned platform packages. The
five old standalone app repos
(chat, console, board, deck, boxscore, plus tui-kit) are deleted from
GitHub -- their branch history lives here as `archive/<app>/*` refs, and
their pre-fold-in releases are re-tagged byte-identical under
app-prefixed tags (`chat-v0.1.0` style).

### Workspace and catalog rules

The root `package.json`'s `workspaces.catalog` is the single home for
shared dependency versions; every member declares `"catalog:"` rather than
pinning its own version. `packages/tui-kit` and `apps/board` each pin
`"typescript": "^7"` as deliberate exceptions -- the catalog's `~6` line
would downgrade their compiler, so both opt out on purpose, for the same
reason. Do not add a further exception without the same kind of reason.
`packages/glance` and `packages/glance-react` pin TypeScript 5.9, vite 7 and
`@vitejs/plugin-react` 5 explicitly, and `apps/gitq` keeps the same
TypeScript 5.9 line explicitly, the third documented exception, until they
are bumped in their own PR; `extensions/vscode/rt-context` pins the same
TypeScript 5.9 line for its esbuild path, a fourth.
Member-level lockfiles are forbidden: the root
`bun.lock` is the only lockfile that owns resolution, so a workspace
member never runs `bun install` scoped to itself in a way that would
produce its own lock.

### Per-app root scripts

Each app gets `<app>:typecheck`, `<app>:test`, `<app>:lint`, and
`<app>:build` root scripts in `package.json` where that gate applies to
the app (e.g. board has no `:lint` script). Each is
`scripts/turbo.sh <task> --filter=<package>`, so it builds what the app
depends on and caches the result. Run an app's own gates with these rather
than `cd`-ing into `apps/<name>` by hand; they match what CI runs.

### Deck serving note

`deck` (the local supervisor, `apps/deck`) dev-links each app via
`deck register --dir` pointed at `apps/<name>`. In serve mode, deck's
health check only proves `/api` is up -- it does not build the app's UI.
If a Mantine app's `dist/` is stale or missing, `bun run <app>:build`
inside that app, or the UI 404s while `/api` stays healthy (DECK-61).
Rebuild after any change you want to see served, not just after changes
that fail typecheck.

### rt identity note

This is about the pre-fold-in `m4ttstack/apps` remote, not the `apps/`
directory you are reading this in: on a machine that has not yet cut over,
rt still shows that remote under the identity label `app-kit`, via a
machine-settings `rt.repoIdentityOverrides` bridge. That override is
machine state, not something this repo owns, and it retires along with the
rest of that remote's tracking once the remote itself is removed. Nothing
in this repo needs to change for it.

### Mantine: look it up, don't recall it

`@mattstack/app-kit` pins Mantine on the 9.5 line (`^9.5.2` across every
`@mantine/*` peer in `packages/ui/package.json`). Before using a Mantine
component you have not already used in this session, or any prop you are
not certain of, look it up rather than guessing: a guessed prop compiles
and renders and is still wrong (the variant that does not exist, the prop
that moved, a size off the scale). If your session has the `mantine` MCP
server available (mantine-kit's own `.mcp.json` configures it,
`npx -y @mantine/mcp-server@9.5.2`), use `get_item_props` /
`get_item_doc` / `search_docs` / `list_items` the same way mantine-kit's
`AGENTS.md` describes. This repo does not vendor its own `.mcp.json` or a
`docs/mantine-llms.txt` index; absent MCP, check the installed
`@mantine/core` / `@mantine/dates` type declarations directly (they match
the pinned `^9.5.2` range) rather than recalling a prop from memory or
from a different Mantine version.

## Where the numbered sections live

Sections 1 to 10, "CI shape" and "Publishing" are rule files under
`.claude/rules/apps/`. Each loads by itself when you read or edit a file
matching its paths; the root `AGENTS.md` index lists them.
