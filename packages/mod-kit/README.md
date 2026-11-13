# @mattstack/mod-kit

The shared UI kit for Claude Code mods. A mod writes its own content. The kit
draws it in the clack look (brand bar, lists, tabs, buttons, input fields), and
wires hover, press, focus and the hide-and-reopen band. Private workspace
package, API 2.1.322, dark terminals only.

Two mods show it in use. Read them before writing a new one:

- `mods/gate-form/`: a paged question form. The full worked example.
- `mods/kit-gallery/`: every piece in every state. Run `/kit-gallery` in a
  session that loaded it. The smallest complete mod.

## Start a new mod

1. Make `mods/<name>/` with these files:
   - `mod.json`: `{ "plugin": { "name", "version", "description", "types"? }, "clients": ["<client>.tsx", ...] }`. `clients` lists every Client module file in `src/`. `files` (optional) lists files or folders in the mod folder, such as `LICENSE`, `README.md` or `docs`, that the build copies to the plugin root.
   - `package.json`: copy gate-form's, with `"@mattstack/mod-kit": "workspace:*"`.
   - `tsconfig.json`: copy gate-form's.
   - `src/register.tsx`: the hooks module.
   - `types/index.d.ts`: only when the mod declares typed atoms. It augments `PluginState` under the mod's name; copy the shape from `mods/gate-form/types/index.d.ts`. The build copies `types/` into the plugin.
   - `harness/*.test.tsx`: Claude Code harness tests. The build copies all of `harness/`, helpers included, into `hooks/`.
2. Run `bun install` at the repo root.
3. Live reload: `bun run mods:watch <name> --into ~/.claude/dev-mods/<session>/`. It rebuilds into `<dir>/<name>/` whenever the mod or the kit changes. Each session has its own dev-mods folder.
4. Build: `bun run mods:build [name]` (no name builds every mod; `--no-validate` skips `claude plugin validate`). Commit the output in `plugins/<name>/`. CI fails when a build would change it.
5. CI needs a `plugin-<name>` job in `.github/workflows/checks.yml`. Copy `plugin-gate-form`. Then add the job to the `checks` job's `needs`, to its `env` (`NAME: ${{ needs.plugin-<name>.result }}`) and to its result lines (the echo and the `[ ... ] || { echo ...; exit 1; }` line). `scripts/__tests__/no-plugin-ci-jobs.test.ts` fails for a plugin folder without a job, and the gate test fails when `checks` does not need every job.
6. Bump `plugin.version` in `mod.json` whenever the built output changes. A PR fails if it does not move.

Tests:

- Bun tests live under `src/` as `*.test.ts(x)`. Run them with `bun run mods:test`.
- Tests that need the Claude Code harness (`claude-code/testing`) live in `harness/`. They are copied into the build and run only with `claude plugin test`. A mod with no test file fails that command.
- Type-check with `bun run mods:typecheck`.

### Bumping the Claude Code version

The `claude-code` type declarations are a committed copy, because Claude Code
writes them only when it loads a plugin. To refresh them after a CLI bump:

1. Bump the version in the `plugin-gate-form` job of `checks.yml`.
2. Load any mod with that CLI so it writes `.claude-plugin/types/`.
3. Run `bun scripts/mods/refresh-types.ts <loaded-mod-dir>`.

The script copies both declaration files into `packages/mod-kit/types/`. It
refuses when the loaded copy was written by a version other than the one the
job pins.

## Rules for a mod

Claude Code reads a hooks module's source statically before it runs it. Each of
these stops the module loading if broken. The build inlines the kit, so most
only constrain your own files.

- `register` is a top-level `export function register(on)`. Never `export const register = ...`.
- One matcherless `on(event)` per event. The kit never registers a hook that shares an event with yours. Where kit and mod would both want `ui.message`, the mod owns the one hook and calls kit functions from it.
- A helper that receives `on` returns nothing. `const x = helper(on)` is refused.
- Pass `$` only to function declarations at the top of the file. Never to a function reached through a property, a parameter or a callback. Read your own state, then pass plain data into kit functions.
- State refs are literals or `atom(...)` consts in the mod's own file. The kit never touches state and never takes an atom.
- `atom({ plugin: '<name>', key: '...' } as const, ...)` refs must be literals.
- A Client's `module` is a string literal naming a file listed in `mod.json` `clients`. The build rewrites it to the built file.
- No `import(` anywhere.
- Never declare `h` or `Fragment`, and never write an `@jsx` pragma. The tsconfig sets the factory and the engine provides it.
- A mod imports only its own files and `@mattstack/mod-kit`. The kit is inlined at build.
- Matcher values the validator reads should be string literals.
- Dark terminals only. The palette has no light variant.

### How drawing works

`h` in the engine is eager: a function component runs when its tag is
evaluated, before its parent. So kit components return a marker node, and
`<Panel>` finds them by key and lays them out as lines. Two consequences:

- Kit components draw only inside a `kitClient` body.
- Use exactly one `<Panel>` per Client. The pointer hit-tests its lines.

Handlers are closures (`onPress`, `onPick`, `onHide`, `onSelect`, `onScroll`).
The kit turns each into an action key. Nothing dispatches mod actions.

## Components (draw)

A Client module's default export is a `kitClient`. Write the body as JSX.

### `kitClient`

```tsx
kitClient<Props, State>(body: (props, ui) => JSX.Element, options?: KitOptions<Props, State>)
```

Types: `KitOptions`, `KitUi`. Returns the Client function (`(props, surface) => tree`). It seeds
`surface.state`, draws the body, and attaches the pointer on the first frame.
Options:

- `initial(props)`: the first state. `State` extends `PointerState` (`hover`, `pressed`).
- `focused(props)`: defaults to the `focused` prop, true when absent.
- `isActive(state)`: false while the surface takes no clicks (a form already sent).
- `engaged(props)`: a message posted on every press and key. The hooks module uses it to learn the pointer or keyboard is in the Client.

`ui` is `{ width, focused, state, setState, post, hide, onKey, keyboard, keyPressing, pressFor }`. `ui.state`
is a getter for the current state, pointer writes included. `ui.hide()` posts
`{ type: 'hide' }`, which `paneMessage` handles. `ui.onKey(fn)` registers a key
handler that also reports engagement. A handler that returns `true` handled the
key, and that puts the surface in keyboard mode (`ui.keyboard`) until any pointer
event, so a mod can show its keyboard marks only then. `ui.pressFor(run, ms?)`
is for a key that activates a control: it sets `ui.keyPressing` for about 150 ms
(the module draws the control pressed meanwhile), ignores keys until then, and
then calls `run`.

```tsx
export default kitClient<Props, { cursor: number } & PointerState>(
  (props, ui) => (
    <Panel width={ui.width}>
      <BrandBar title="mattstack my mod" onHide={ui.hide} />
      <SelectList choices={props.choices} cursor={ui.state.cursor} onPick={i => ui.setState({ ...ui.state, cursor: i })} />
    </Panel>
  ),
  { initial: () => ({ cursor: 0 }) },
)
```

### `Panel`

`<Panel width?>`. The root of a kit drawing. It lays its kit children out as
lines and draws them. One per Client.

### `BrandBar`

`<BrandBar title onHide?>`. The pink header bar. With `onHide` it shows a Hide
button.

### `Button` and `ButtonRow`

`<Button tone? disabled? onPress?>label</Button>`. Tones: `primary`,
`secondary`, `neutral`, `caution`, `brand`, and `quiet` (a faint fill that
brightens under the pointer). Alone it is a row of one button.

`<ButtonRow right?>`: children are the left buttons. `right` is one button
pushed to the right edge.

```tsx
<ButtonRow right={<Button tone="brand" onPress={send}>Submit</Button>}>
  <Button onPress={back}>Back</Button>
</ButtonRow>
```

### `SelectList`

`<SelectList choices cursor multi? cursorIsChoice? isPicked? writeIn? onPick? maxShown?>`.
Clack's select and multiselect. `choices` are `{ label, description?, isWriteIn? }`.
The focused choice shows in full, the rest in one row each. `maxShown` defaults
to 8 and the list windows around the cursor ("N more"). `writeIn` is the text of
the "Something else" row. `cursorIsChoice` draws the single-select cursor as
chosen.

### `InputField`

`<InputField value placeholder? width? cursor?>`. A filled text field. `cursor`
defaults to the Client's focus.

### `TabStrip`

`<TabStrip tabs current from? onSelect? onScroll?>`. Tabs are
`{ label, mark?, isDone? }`. Too many tabs scroll with one-tab chips. `from` is
the first tab shown. Use `revealTab(tabs, current, width, from)` to compute it
when the current tab moves.

### `Rail`

`<Rail color? dim? bold?>`. Clack's vertical rail: the bar alone, or the text children hung beside it and wrapped to the Panel's width.

### `PageShell`

`<PageShell rows head? context? foot? padTo?>`. A fixed-height page: `head` and
`context` on top, `foot` at the bottom, the children between. On overflow it
drops `context` first. `padTo` pads short pages to the tallest page so buttons keep
their row. For mods that build the lines themselves, the same logic is in
`fitToRows`, `padToHeight`, `navRow` and `reviewList` (see Layout helpers).

### `Lines`, `Row` and `Span`

`<Lines lines onAction?>` draws lines a mod already builds. gate-form's
`view.ts` works this way. `<Row>` sets pieces side by side on one line.
`<Span color? bold? dim? ...>text</Span>` is a styled run of text inside a Row.

### `Unfocused`

`<Unfocused>` draws its children in the muted shades with no actions, whatever
the Client's focus. Use it for an unfocused variant beside live controls in one
Panel.

### `ReopenBand`

`<ReopenBand label title onOpen>`. The band's one row: the mark and label, the
waiting title, and a brand Open button (props type `ReopenBandProps`). `bandClient` wraps it. The gallery
draws it directly.

### `kitComponent` and `drawKit`

For a new component, or a bun test that draws kit components without a Client.

```tsx
const Chip = kitComponent('Chip', (props: { text: string }, ctx) => [[sp(props.text, { color: BRAND.pink })]])
```

`toLines(props, ctx)` returns lines. `ctx` has `width`, `focused`,
`bind(name, run)` (a handler into an action key), `parts` and `layout` (lay out
child nodes). `drawKit(frame, () => tree)` runs a draw and returns
`{ tree, lines, handlers }`. Types: `KitComponent`, `KitCtx`, `KitLine`.

## Pane patterns (hooks module)

These run in the hooks module. They draw nothing themselves. Functions that take
`$` are top-level declarations, inlined at build, so call them from your own
hooks.

### `HideablePane`

`{ id: string, label?: string }`. The pane's id, and the band's lead-in after
the mark ("mattstack <label>"). A mod declares one const and passes it to the
functions below.

### `showPane`

`showPane($, pane, title): Promise<void>`. Opens the pane.

### `paneMessage`

`paneMessage($, e, pane, waiting): Promise<void>`. Call it from your single
`ui.message` hook. It handles `{ type: 'hide' }` and `{ type: 'reopen', formId }`
from the pane's Clients. `waiting` is `undefined` or a `Waiting`. A hide closes
the pane only when `e.requestId` equals `pane.id`, so a Client mounted in a pane
with another id never hides.

### `Waiting`

`{ formId: string, title: string }`. What the pane is waiting on while closed.
The mod reads its own state into this plain object.

### `isPlaced`

`isPlaced($, pane): Promise<boolean>`. Whether the pane is on screen.

### `bandAbovePrompt`

`bandAbovePrompt($, e, rest, waiting, pane): Promise<RenderElement>`. Call it from your `ui.render`
hook for the prompt's AbovePrompt slot when `waiting` is set and the pane is
not placed: it returns `rest` with the reopen band above it. Falls back to the
engine's `Button` where Client is unavailable. It writes `module="./band.tsx"`
itself, because a Client `module` must be a literal, so the mod needs a
`band.tsx` and lists it in `mod.json` `clients`:

```ts
export { bandClient as default } from '@mattstack/mod-kit'
```

### `bandClient`

The Client behind `bandAbovePrompt`: a `kitClient` that draws a `ReopenBand` in
a `Panel`. Re-exported as `band.tsx`'s default (above).

### `registerPaneRedraw`

`registerPaneRedraw(on): void`. Registers a matcherless `ui.close` hook that
redraws `ui.render` after a close, so the band follows the engine's pane list.
Register no other matcherless `ui.close` hook in the mod.

### `isEngaged`

`isEngaged(e): boolean`. True when a `ui.message` event carries the Client's
engaged post. The Client must return exactly `{ type: 'engaged' }` (plus any
other fields) from its `engaged` option, as in `mods/gate-form/src/form.tsx`;
any other value never matches. Claude Code has no Client focus signal, so the
mod keeps its own atom:

```ts
const keysAtom = atom({ plugin: '<name>', key: 'keysInForm' } as const, false)
```

The mod sets it when `isEngaged` is true, clears it in its `prompt.edit`,
`prompt.submit` and `ui.focus` hooks, and combines it with the pane's focus.
See `mods/gate-form/src/register.tsx`.

## Layout helpers (line builders)

Used by `Lines`-based mods and by the components themselves. A line is an array
of spans; a span may carry an action.

### `fitToRows`, `padToHeight`, `navRow` and `reviewList`

- `padToHeight(page, height, filler)`: pads a page to a height.
- `fitToRows(drawn, rows, withoutContext, pad?)`: fits `{ head, page, foot }` into `rows`. On overflow it calls `withoutContext()` for a version with the context dropped.
- `navRow({ back, next?, aside? }, width)`: the Back / Next row with a side button such as a press-again confirm.
- `reviewList(items, width)`: review entries `{ label, summary?, action? }`, clickable when they carry an action.

Types: `Drawn`, `NavSpec`, `ReviewItem`.

### `brandBar`, `buttonRow`, `buttonSpan`, `selectList`, `inputField`, `tabStrip`, `textCursor`

The line builders under the components. A component's `toLines` calls the
matching builder. Reach for them when you build lines by hand for `<Lines>`.

- `brandBar(label, width, hide?)`
- `buttonRow(left, right, width, indent?)` (`indent` replaces the row's own lead-in, in cells) and `buttonSpan(button, pad?)`, with `Button` data `{ label, action, tone?, disabled? }` and `ButtonTone`
- `selectList(spec)` with `SelectSpec` and `Choice`
- `inputField(value, placeholder, width, showCursor)` and `textCursor(value, placeholder, showCursor)`
- `tabStrip(spec)` with `Tab` and `TabStripSpec`, and `revealTab`
- `scrollBar(rows, total, offset)`: a scroll bar for a window of `rows` over `total`, one three-cell line per row (a blank, the track or thumb, a blank). Blank lines when the list fits. Colours in `SCROLL`.

## Draw layer

### `sp`, `wrap`, `hang` and `widthOf`

- `sp(text, style?)`: a span.
- `wrap(text, width)`: wraps text to lines of strings.
- `hang(first, rest, text, width, style?)`: wraps with a hanging indent.
- `widthOf(spans)`: display width of a line, in terminal cells.
- `withAction(lines, action)`: attaches an action to every line.

Types: `Line`, `Style`.

### `cellWidth`, `cutCells` and `padCells`

Every width in the kit counts terminal cells, not characters: an emoji or a
CJK character takes two, a combining mark none. `wrap`, `hang`, `hitAt`, hover
keys and the widgets all measure this way, so a mod that cuts or pads its own
text should too.

- `cellWidth(text)`: the cells `text` takes.
- `cutCells(text, cells)`: the longest start of `text` that fits. It never
  splits a grapheme and never leaves half a wide character in.
- `padCells(text, cells)`: `text` padded with spaces to `cells`.

### `hitAt`, `hoverKeyAt`, `lineHoverKey` and `spanHoverKey`

Hit testing. `hitAt(line, x)` returns the action under a column.
`hoverKeyAt(lines, row, x)` returns the hover key, which includes the row, so
two identical buttons on different rows hover separately. `spanHoverKey(span, row)`
is that key for one span. `lineHoverKey(line)` is the key for a whole-line
action, with no row, so every row of the line lights together.

### `renderLines` and `Look`

`renderLines(lines, elements, look)` draws lines as engine `Box` and `Text`,
styled by `Look` (`{ focused, hover?, pressed? }`). `kitClient` calls it for
you.

### `attachPointer` and `lookOf`

`attachPointer(surface, lines, { focused, onAction, onEngage?, isActive? })`
wires hover, press on down and act on release over the same control, drag-off
cancel, and click-to-focus (the first click on a dimmed surface only engages).
`lookOf(state, focused)` turns pointer state into a `Look`. `PointerState` is
`{ hover?, pressed? }`. The Client must seed `surface.state` before the first
call. `kitClient` does all of this.

### Theme

`BRAND`, `FILL`, `QUIET`, `SCROLL`, `SYMBOL`, `ICON`, `PLACEHOLDER`, `ACCENT`, `GRAY`, `DONE`,
`WARN`, `DIM` are the palette and glyph tables. `rail(style)` is the left rail
spans. `hovered(span)`, `pressed(span)` and `muted(span)` give the state
shades. `keySelected(span)` marks the button the keyboard selected: its own
look with a pink `SYMBOL.selectEdge` in its left edge cell, as two spans of the
same width. The edge is a `mark`, a foreground the pointer states keep, so it
takes the button's hover and press fills. Icons are Nerd Font codepoints.

## Checks

Run `bun run mods:check-readme` after editing this file. It fails when a section heading, a JSX tag or a function call in inline code
names something `src/index.ts` does not export.
