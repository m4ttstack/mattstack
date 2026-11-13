# Mod kit and mod build pipeline

## Why

Matt wants to build more Claude Code mods, and he does not want to rebuild the
same UI for each one. The gate-form spike (`plugins/gate-form/`, branch
`gate-form-spike`) produced a clack-styled UI he likes: buttons, lists, tabs, a
header bar, a hide-and-reopen band, hover and press states. Today that UI lives
inside one mod. The goal is one shared kit that every mod uses, so a new mod
writes only its own content and every mod looks and behaves the same.

## Goals

- A shared kit package that holds every reusable UI piece and pattern from the
  spike, including the hook-side patterns, not just the drawing widgets.
- Mods written as normal TypeScript packages that import the kit, with a build
  step that turns each one into the self-contained plugin folder Claude Code
  reads.
- A live catalog of every kit piece in every state, plus a short README of its
  API.
- gate-form moved onto the pipeline and the kit, behaving exactly as it does
  on the spike branch.

## Non-goals

- Moving human-todos onto the kit. That is the follow-up, once the kit has
  settled against gate-form.
- Wiring gate-form to the real gate registry or redirecting AskUserQuestion.
- Light-terminal colours. The palette stays dark-only for now.
- Publishing the kit to npm.

## Anti-goals

- A kit that still makes a mod author hand-wire hover, press, focus or the
  reopen band. If a new mod has to copy that code, the kit failed.
- Built plugin output that drifts from source without CI noticing.
- A gallery drawn from anything but the real kit code.

## Constraints (learned in the spike)

- A mod's modules may import only the mod's own files, so shared code must be
  inlined into each mod at build time.
- Client surface modules (the drawing code) have no access to `$`; the hooks
  module does. Client modules are named by a string-literal `module` path on the
  `Client` element.
- Claude Code reads the hooks module's source statically before running it:
  - `register` must be a top-level function declaration
    (`export function register(on)`); `export const register = on => ...`
    fails once bundled.
  - A function that receives `$` must be declared at the top of the same file.
    Bundling inlines kit helpers into that file, which satisfies this.
  - `atom({ plugin: '<name>', key: ... })` refs must be literals.
  - Matcher values the validator should read must be literals in the output;
    the bundler turns top-level `const` into `var`, which the validator reports
    as `?` (it still works at run time).
  - `import()` anywhere stops the module loading.
  - Found building the patterns (Task 5), each an error that stops the module
    loading:
    - A helper that receives `on` cannot return a value: `const x = helper(on)`
      is refused ("the value of helper(on) is kept"). A registrar returns void.
    - Two `on('<event>')` registrations without a matcher in one module are
      refused, and nothing can tell apart the hooks that would share `ui.message`
      (a Client post's `data` is not matchable). The mod owns the one hook and
      calls kit functions from it.
    - `$` may be passed only to a function declared at the top of the file, never
      to a function value reached through a property or parameter, so the kit
      takes no `$`-taking callbacks from a mod. The mod reads its own state and
      passes plain data in.
    - `read`, `update` and `$.state.*` need a reference with literal plugin and
      key, or an `atom(...)` const in the same file, so kit code never touches
      state and kit helpers never take atoms.
- `claude plugin test` fails on a mod with no `*.test.ts(x)`.
- `scripts/__tests__/no-plugin-ci-jobs.test.ts` requires a `plugin-<name>` CI job
  for every folder under `plugins/`.
- The probe on 2026-11-12 showed `bun build` (ESM, `target: 'browser'`,
  `external: ['claude-code']`, no splitting, no minify, the mod tsconfig's JSX
  factory `h`) produces a gate-form that validates and passes its tests, once
  `register` is a function declaration and Client paths are rewritten.

## Approaches considered

1. **One kit source, copied into each mod by a sync script, CI drift check.**
   Works today, but copies sit in every mod, and hook-side patterns still hit
   the `$` rule across files.
2. **A kit plugin other mods depend on (`$.kit`).** Shares only the hook side;
   Client drawing code cannot reach `$`, so widgets would still be copied.
3. **A new-mod template.** Every copy drifts from the moment it is made.
4. **Source packages plus a build step (picked).** Mods and the kit are normal
   packages; a build bundles each mod's entry points into self-contained files
   in the plugin folder. Matt proposed it: author in a Node-like environment,
   compile to what Claude reads. It removes copying, lets hook-side patterns
   live in the kit, and allows ordinary pure npm dependencies.

## Decided

- **Approach 4.** (Matt)
- **Built output is committed** to `plugins/<name>/`, and CI fails when a build
  would change it, like the compiled-skill freshness check. Marketplace and git
  installs keep working unchanged. (Matt)
- **Catalog = live gallery + README.** A `/kit-gallery` command opens a pane
  that draws every piece in every state with the real kit code; a README covers
  each piece's API. (Matt)
- **First project scope:** pipeline, kit package, gate-form moved over, gallery,
  README. human-todos follows separately. (Matt)
- **It lands on `main` through the merge queue.** The CI scoping for `mods/` and
  `packages/mod-kit` (`scripts/ci/test-scope.ts`, the `checks` job's needs) is
  part of the project. gate-form stays out of `marketplace/marketplace.json`
  until it is wired to real gates. (Matt)

## Layout (my call)

```
packages/mod-kit/            @mattstack/mod-kit (private workspace package)
  src/draw/                  text (spans, lines, wrap, hang, hit testing), theme, render
  src/widgets/               brandBar, selectList, inputField, textCursor, tabStrip,
                             buttons (tones + disabled), scroll chips
  src/interact/              Client pointer controller (hover, press-on-release,
                             drag-off cancel, click-to-focus), focus-post check
  src/patterns/              hideable pane helpers + reopen band Client, page
                             shell (fixed height, nav row, review list)
  README.md
mods/<name>/                 a mod's source package
  src/register.tsx           hooks module entry
  src/<client>.tsx           one file per Client module
  src/**/*.test.ts(x)        bun tests of the mod's pure logic
  harness/*.test.tsx         Claude Code harness tests, copied into the build
  mod.json                   plugin.json fields + the list of Client entry points
plugins/<name>/              built output, committed (what Claude Code reads)
scripts/mods/build.ts        the build
```

`mods/*` joins the root `workspaces`. The kit is not `packages/tui-kit` (that
one serves the Ink apps); mod elements come from Claude Code's own table.

## How a mod is written

TypeScript with JSX (`.tsx`), against Claude Code's element set (`Box`, `Text`,
`Button`, `Client`, ...), not React: no React runtime or hooks; hook-side state
is atoms, Client state is `surface.setState`.

**The kit's drawing API is JSX components** (Matt): `<BrandBar>`, `<SelectList>`,
`<InputField>`, `<TabStrip>`, `<ButtonRow>`, `<Button tone="brand">`, a page
shell, and the rest. A mod author never builds span or line arrays by hand.

```tsx
export default kitClient<Props, State>(
  (props, ui) => (
    <Panel width={ui.width}>
      <BrandBar title="mattstack my mod" onHide={ui.hide} />
      <SelectList choices={choices} cursor={ui.state.cursor} onPick={pick} />
      <ButtonRow>
        <Button tone="brand" onPress={save}>Save</Button>
      </ButtonRow>
    </Panel>
  ),
  { initial: props => ({ cursor: 0 }) },
)
```

Underneath, the components keep the spike's line model, which is what gives the
exact clack layout, hover keys per row, and press-on-release hit testing: a root
component (`<Panel>` above) lays its children out as lines, then draws them with
the kit renderer and wires the pointer controller. The hook-side patterns
(`showPane`, `paneMessage`) stay functions; they
draw nothing of their own.

**`h` runs function components at once (eager), probed 2026-11-12 on mod API
2.1.322.** `h(Fn, props, ...children)` calls `Fn(props)` inside `h` and returns
what `Fn` returned; the element it hands back has a string `type` (`'Text'`), never
the function. The same holds in a hooks module's `ui.render` hook and in a Client
module (`(props, surface)`), each probed under `claude plugin test` with
`<Outer><Inner label="x" /></Outer>`:

- `Outer` receives `children` already expanded: the child is an object whose
  `type` is the string `'Text'`, not `Inner`.
- `Inner` has run before `Outer` is entered, and `<Inner />` written alone is
  already a `Text` element (one call during `h`).

So the kit cannot have `Panel` walk a tree of unexpanded kit elements. A kit
component runs when its tag is evaluated, before its parent, and has only its own
props and its children's engine nodes. Kit components return engine nodes, and
where a parent must tell one kit child from another (`Panel` laying children out
as lines), the child returns a marker node that `Panel` recognises. No kit
factory is needed, and a mod's source still writes no pragma and declares nothing
named `h`.

**Markers, probed 2026-11-12 on 2.1.322 (Task 6), in a Client module.** A
component's `<Box key="kit:3" />` reaches its parent as the same object (a
`WeakSet` check holds), with `type: 'Box'` and `props.key` readable; a child
array is flattened into the parent's `children`; a plain object a component
returns comes back unchanged. So the kit takes the marker path:

- Each kit component (`kitComponent(tag, toLines)`) returns a `Box` keyed
  `kit:<n>` and leaves its props in a per-render table. `<Panel>` finds its kit
  children by that key and calls each one's `toLines(props, ctx)`, with `ctx`
  carrying the Panel's width and focus. It then draws the lines with
  `renderLines`. The markers are dropped and are never drawn.
- Handlers are closures on the components (`onPress`, `onPick`, `onHide`,
  `onSelect`, `onScroll`). `ctx.bind` turns each one into a string action key
  (`kit:<n>:<name>`), which stays stable while the tree keeps its shape. The
  pointer acts on that key.
- `kitClient(body, { initial, focused, isActive, engaged })` sets up the render,
  seeds `surface.state` on the first frame and attaches the pointer on that same
  frame. It reads its own copy of the state because the engine shows the seeded
  state only from the next frame. `ui.state` is a getter for the current state,
  pointer writes included, so a handler that runs after a release reads it
  unpressed. `ui` is `{ width, focused, state, setState, post, hide, onKey }`.
  The plan's `act(a)` and action type `A` were dropped: with closure handlers,
  nothing dispatches mod actions.
- Kit components draw only inside a `kitClient` body (they need its
  `surface.elements` and table); one `Panel` per Client, since the pointer hits
  its lines. `<Lines lines onAction>` draws lines a mod already builds (how
  gate-form's line-based `view.ts` is drawn); `<Row>` and `<Span>` set pieces
  side by side on one line (the reopen band). Focus is the whole Client's
  (`ui.focused`), except under `<Unfocused>`: its children lay out with
  `focused: false`, are drawn in the muted shades and lose their actions, so an
  unfocused variant can sit beside live controls in one Panel.

If a later engine copied or refused marker nodes, `Panel` would find no kit
children. The fallback is a kit factory: the build sets `jsxFactory` to a
kit-exported `kitH` (and `kitFragment`), which keeps kit components unexpanded
for `Panel` and passes every other tag to the engine's `h`. Mod source would
still write no pragma and declare nothing named `h`.

Bun tests use JSX under a stand-in `h` that mirrors the engine's eager calls
(`packages/mod-kit/test/jsx-preload.ts`). `mods:test` passes
`--tsconfig-override=./packages/mod-kit/tsconfig.json`, because bun's runtime
reads JSX settings from the cwd's tsconfig and the root one has none.

## The kit (my calls)

Everything in the spike's `hooks/kit/` moves in, plus what the spike wired by
hand in gate-form:

| Piece | From | Notes |
|---|---|---|
| Look: clack symbols, Nerd Font icons (codepoints verified against the installed font), brand pink/plum/pinkDeep, `FILL` tones (primary, secondary, neutral, caution, brand, chip, current, disabled, field), hover and press shades, unfocused muting | `kit/theme.ts` | Dark-only. |
| Text model: spans and lines carrying click actions, wrap, hanging indent, hit testing, hover keys that include the row | `kit/text.ts` | |
| Render: lines to `Text`, hover/pressed/unfocused styling | `kit/render.tsx` | |
| Widgets: `brandBar` (optional Hide), `selectList` (single, multi, 2-row options, write-in "Something else" with a filled input, windowing), `inputField`, `textCursor`, `tabStrip` (sticky window, one-tab scroll chips at fixed width), `buttonRow` / `buttonSpan` (five tones plus disabled) | `kit/widgets.ts` | |
| Pointer controller for a Client: `attachPointer(surface, lines, { focused, onAction, onEngage?, isActive? })` returns the `look` for `renderLines`: hover, press on down and act on release over the same control, drag-off cancel, first click on a dimmed surface only engages | `form.tsx`, `band.tsx` | The module seeds `surface.state` first; until it exists no listener is set, so a press cannot overwrite the module's own state. |
| Focus stand-in: a per-mod atom set by the Client's "engaged" post, cleared by `prompt.edit`, `prompt.submit` and `ui.focus`; combined with the pane's `isFocused` | `register.tsx` | Claude Code has no Client focus signal. The kit ships only `isEngaged(e)`; the mod declares the atom (`atom({ plugin: '<name>', key: 'keysInForm' } as const, false)`) and owns the set, the three clearing hooks and the read, because kit code cannot touch state. |
| Hideable pane: `showPane($, pane, title)`, `paneMessage($, e, pane, waiting)` (handles `{ type: 'hide' }` and `{ type: 'reopen', formId }`), `isPlaced($, pane)`, `bandAbovePrompt($, e, rest, waiting, pane)` (a Client with the brand Open button, falling back to the engine `Button` on surfaces without Client), `registerPaneRedraw(on)` (`ui.close` redraw), and `bandClient` in `patterns/band-client.tsx` | `register.tsx`, `band.tsx` | The engine's own `×` cannot be hidden; it behaves like Hide. A Client's `module` must be a string literal, so `bandAbovePrompt` writes `module="./band.tsx"` itself; a mod using the pattern has a `band.tsx` (`export { bandClient as default } from '@mattstack/mod-kit'`) listed in its `mod.json` clients. The mod reads its own state into a plain `Waiting` (`{ formId, title }`) and passes it in; it owns its atoms and its single `ui.message` hook, which calls `isEngaged`, `paneMessage` and its own handlers. |
| Page shell: `padToHeight` and `fitToRows(drawn, rows, withoutContext, pad?)` (pad pages to the tallest page so buttons keep their row, drop context first on overflow), `navRow({ back, next?, aside? }, width)` (the Back / Next / Review / Submit row with a side button such as the press-again confirm), `reviewList(items, width)` (entries clickable when they carry an action) | `form/view.ts` | Generic enough for any paged surface. The mod builds the buttons and items; the kit lays them out. |
| Components (`src/components/`): `kitClient`, `<Panel width?>`, `<BrandBar title onHide?>`, `<SelectList choices cursor multi? cursorIsChoice? isPicked? writeIn? onPick? maxShown?>`, `<InputField value placeholder? width? cursor?>`, `<TabStrip tabs current from? onSelect? onScroll?>`, `<ButtonRow right?>` with `<Button tone? disabled? onPress?>` children, `<Rail color? dim? bold?>`, `<PageShell rows head? context? foot? padTo?>`, `<Lines lines onAction?>`, `<Row>` and `<Span>`, `<ReopenBand label title onOpen>` (the band's one row: mark and label, the waiting title, the brand Open button; `bandClient` wraps it in a `Panel` and the gallery draws it directly), `<Unfocused>` (its children muted and unclickable beside live controls in the same Panel); `kitComponent` and `drawKit` for new components and bun tests | new | Each component's `toLines` calls the widget's line builder. gate-form's `form.tsx` and `bandClient` are drawn with them. |

Form-specific logic (gate questions, `gate_answer` shapes, Next semantics where
a single choice's cursor counts only when recommended, moved or answered) stays
in `mods/gate-form/`.

A mod uses the hook-side kit in two ways, both forced by the scan rules above:
`register*(on, plain data)` functions that return void and register an event no
other hook of the mod uses (`registerPaneRedraw`),
and top-level `async function name($, ...plain data)` helpers the mod's own hooks
call (`showPane`, `paneMessage`, `bandAbovePrompt`, `isPlaced`). They are inlined
at build, so the `$` rule holds. Kit code takes no atoms, no `$`-taking callbacks
and keeps no state.

## The build (my calls)

`bun run mods:build [name]` and `bun run mods:watch <name>`:

- Bundles `src/register.tsx` and each Client entry listed in `mod.json`, one
  output file each, with the settings the probe used.
- Writes `hooks/hooks.json`, `.claude-plugin/plugin.json` (from `mod.json`), and
  copies `types/` and any mod assets.
- Rewrites each Client `module` path to its built file name.
- Keeps validator-readable literals: either the build inlines top-level
  constant strings used in matchers, or a lint in the build fails on a matcher
  that is not a literal. Builder's choice.
- Fails if the output contains `import(`.
- Runs `claude plugin validate` on the output and fails on errors.
- `mods:watch <name>` builds into the session's dev-mods folder for hot reload;
  the folder is an argument because each session has its own.

CI:

- A freshness job: build every mod and fail if `plugins/` changes (mirrors the
  compiled-skill check).
- Each `plugin-<name>` job runs `claude plugin test` and `claude plugin validate`
  on the built folder, as `plugin-gate-form` does now.
- Test layout (my call): bun tests are `*.test.ts(x)` under a package's or mod's `src/`; tests that need the Claude Code harness (`claude-code/testing`) live in `mods/<name>/harness/`, are copied into the built `hooks/`, and run only through `claude plugin test`. Bun tests that use JSX get a stand-in `h`/`Fragment` from a test preload, since the engine's are not there.
- Tests (my call): the pure kit pieces (text, theme, widgets, page-shell layout)
  get plain bun unit tests in `packages/mod-kit`, run in CI. The pieces that
  need `claude-code` or the `claude-code/testing` harness (hideable pane,
  focus stand-in, render) are tested through
  `claude plugin test` in gate-form's harness tests, the first mod that uses
  them; the `kit-gallery` mod adds harness tests of the pointer's press-release
  cycle.
- Types (my call): kit and mod source is type-checked in CI. Claude Code writes
  its `claude-code` declarations into a plugin folder only when it loads it, so
  the repo commits a copy generated by the CLI version CI pins (2.1.322 today),
  with a script that refreshes it from that CLI. `packages/mod-kit` and `mods/*`
  type-check against that copy.

## The gallery (my call)

A `/kit-gallery` command, shipped as its own small mod built by the same
pipeline (`mods/kit-gallery/`), so it exercises the build too. It opens a pane
that draws, labelled, with real kit code:

- every button tone at rest, hover, pressed, disabled, and unfocused
- the brand bar with and without Hide
- `selectList` single and multi, with and without descriptions, the write-in
  empty, focused and filled, and a windowed list with "↑ N more"
- `inputField` empty and filled; `tabStrip` short, overflowing, scrolled
- the reopen band
- the page shell with its nav row

Hover and press in the gallery are live, through the same pointer controller.
Unfocused variants are drawn side by side rather than toggled.

## README

`packages/mod-kit/README.md`: one short section per piece (what it is, its
signature, one example), the rules from Constraints written for mod authors,
and how to start a new mod (`mods/<name>/`, `mod.json`, `mods:watch`).

## Moving gate-form

- Source moves from `plugins/gate-form/hooks/` to `mods/gate-form/src/`; its
  `kit/` folder is deleted in favour of the package.
- `plugins/gate-form/` becomes build output.
- Behaviour must match the spike branch at commit `2f04ad07f` and the live
  dev-mods copy, including every change listed under "the kit" above.

## Open risks

- Follow-up: the plugin-prompt row from a `ui.message`-driven submit is not a
  `UserMessage` the mod can rewrite in 2.1.322, so the transcript summary was
  dropped. Revisit if the API gains a hook for plugin-submitted prompts.
- The bundle probe covered gate-form only. The freshness check and validator
  run in the build are the guard for other mods.

## Left to the builder

- Exact kit module names and function signatures within the layout above.
- How the build keeps matcher values literal (inline or lint).
- Whether kit tests join `bun run test` or get their own script, as long as CI
  runs them.
- The gallery's layout.
