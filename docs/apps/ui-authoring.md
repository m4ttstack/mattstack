# UI authoring: kit, colour and type

How to write UI code in this repo without improvising. The kit decides
chrome and components (next section); every colour and
type decision below is already made; new UI picks tokens by ROLE and
inherits the system. If a situation genuinely is not covered here, the
authority of record is radix-ui/themes (how Radix's own components use
these same scales), then a human decision -- never a guessed hex.

Single source: `packages/tokens/src/values.ts` builds every value from
Radix Colors 12-step scales and emits them through
`packages/tokyo/src/tokyo-theme.css` as `--tk-*` custom properties and
Mantine theme colours. Apps consume tokens only; `local/token-namespaces`
(eslint) fails anything else, and the tui-kit ramps matrix test enforces
the contrast bars below on every emitted pair.

## Kit first: boards guide page content

**The rule: never alter the app-kit rail, and every page renders inside
`PageShell`.** The rail is `MattstackShell.Rail` with `RailLink`
entries; an app adds entries through that API and never replaces, wraps
or restyles the rail. The one sanctioned exception is the kit's own
rail-less mode, `MattstackShell rail={false}`, for an app with one page.
A page is `PageShell`, with `PageShell.Content` for the body.

How many pages the app has decides the chrome:

- **One page** (boxscore): `MattstackShell rail={false}`. The kit drops
  the rail and puts the colour-scheme control at the right end of the
  app bar. The page context (breadcrumb, status, page actions) goes in
  the app bar through `MattstackShell.Header` (`children` for the
  breadcrumb, `actions` for the rest), and `PageShell` gets no
  `PageShell.Header`.
- **Several pages** (console has four): the kit rail, one `RailLink`
  per page. Each page may add a `PageShell.Header` title bar under the
  app bar.

Either way each title shows once: nothing in a title bar repeats the app
bar.

| Excuse | Reality |
|---|---|
| "The board's rail looks different" | The board is wrong there. List the difference as a pending board fix. |
| "Parity needs exact geometry" | Parity covers page content. A mismatch on kit chrome goes on the board-fix list. |
| "The kit is fixed and I shouldn't change `packages/ui` for one app" | Right, so the app keeps the kit piece as it ships. |
| "The board specifies a two-state toggle" | The scheme control is the kit's System / Light / Dark control. |
| "The board keeps the app name in the app bar and draws a title bar under it" | In a one-page app the page context replaces the app name through `MattstackShell.Header`. The extra bar is a board fix. |
| "The board draws a rail for a one-page app" | One page means `rail={false}`. The board's rail is a board fix. |
| "A one-page app with no rail needs its own scheme toggle" | `rail={false}` already puts the kit control in the app bar. |

Kit chrome and kit components outrank a design board. A board decides
what a page shows and how its content is laid out. Each job below is
built from the kit piece named, whatever the board draws:

| job | build it from |
|---|---|
| app frame, rail, rail entries and their tooltips | `MattstackShell` with `RailLink` (`apps/AGENTS.md` §8); a one-page app passes `rail={false}` |
| app mark | the app's own brand mark, passed as `mark` |
| colour-scheme control | the System / Light / Dark control `MattstackShell` pins to the rail, or to the app bar's right end with `rail={false}` |
| app switcher | nothing: the mattstack viewer owns it, so pass no `appName` and render no launcher |
| page title and page body | the title as above; the body in `PageShell.Content` |
| switch, tooltip, table, input, select, badge, chip, menu | the Mantine component from `@mattstack/app-kit/core` |
| icons | `Icon` with a Lucide icon; a new one is registered in the app's `icons.ts` |

When the board and the kit differ, build the kit piece and list the
difference for Matt as a pending board fix. A parity mismatch on a kit
piece is an entry on that list, not work for the app.

### Styling a component: the ladder

Before building, read the component's API and Styles API: the Mantine
MCP server (`@mantine/mcp-server@9.5.2`: `get_item_doc`,
`get_item_props`, `search_docs`) when the session has it, otherwise its
page in `https://mantine.dev/llms.txt` (for example
`https://mantine.dev/llms/core-segmented-control.md`; all pages in one
file: `https://mantine.dev/llms-full.txt`). Then take the first rung
that meets the need:

1. **The component as it ships**, set by props: `size` (the default
   `sm` or larger; an `xs` already in the file goes up to `sm`; a dense
   floating surface such as a hover card's action row uses `compact-sm`),
   `variant`, and `color` as a theme hue name. A board's numbers for a
   control's height, padding, border, font size and indicator are not
   targets.
2. **The Styles API**: a CSS module whose classes go in through
   `classNames` (`classNames={{ root: classes.root }}`), for layout and
   spacing only (width, gaps, alignment). Never an inline `style` or
   `styles` object, and never a global `.mantine-*` selector. The one
   inline `style` allowed sets only non-colour CSS custom properties that
   a module reads, such as the motion index (`style={{ '--grow-i': i }}`);
   it never sets a property directly and never carries a colour.
3. **Stop and raise a kit question with Matt**, leaving the component
   at rung 1.

Colour comes from the theme, so every app looks alike: on a kit
component, colour is chosen only through the `color` and `variant`
props, never set as a value (`style`, `styles`, `classNames`, `--tk-*`
or `--mantine-*`). The one surface an app picks is the page body's:
`PageShell.Content` takes `bg`, the kit's documented surface override,
set to a surface role from the table below (`bg="var(--tk-panel)"`),
never a hue or a raw value.

When a kit control reads wrong (it blends into the page, or its contrast
is low), check where it sits. Kit controls are drawn for `PageShell`
surfaces: a `SegmentedControl` track is `--tk-inset`, the same step as
`--tk-bg`, so it vanishes on the bare page and reads on
`PageShell.Content` (`--tk-card` by default, or the role its `bg`
names). Move the control into `PageShell`, and never set that `bg` to
`--tk-bg`, which puts the body back on the bare page. If it still reads
wrong there, that is rung 3.

### Hover and motion

Hover lives in the CSS module. A clickable row that is not a kit `Table`
row takes `:hover` and `:focus-within` on the row, painted with the
colour `Table`'s `highlightOnHover` uses. `:hover` sits inside
`@media (hover: hover)`, as the kit rail's does, so a tap on a touch
screen leaves no stuck highlight; `:focus-within` stays outside it.
Anything else that reacts to the hover is styled from the same
selectors:

```css
:where([data-mantine-color-scheme='light']) .row { --row-hover: var(--mantine-color-gray-1); }
:where([data-mantine-color-scheme='dark']) .row { --row-hover: var(--mantine-color-dark-5); }
@media (hover: hover) {
  .row:hover { background-color: var(--row-hover); }
  .row:hover .spark { opacity: 1; }
}
.row:focus-within { background-color: var(--row-hover); }
.row:focus-within .spark { opacity: 1; }
```

Hover never goes through React state or a hover hook (`useHover`,
`onMouseEnter`); a JS hover lags the pointer.

Motion is one shared grow-in, a CSS module the whole app imports: 400ms,
`ease-out`, a light stagger (25ms per item through an index custom
property set with `style`, the carve-out in rung 2, the index capped at
12 so the last item starts by 300ms),
`transform-origin` at the baseline, and `animation: none`
under `prefers-reduced-motion: reduce`. Every bar, column and chart
entrance takes its class from that module; no component writes its own
keyframes or timing.

## The step model (Radix)

Each scale has 12 steps per scheme. What each step is FOR:

| steps | job |
|---|---|
| 1-2 | app backgrounds |
| 3-5 | component backgrounds (rest, hover, active) |
| 6-8 | borders and separators |
| 9 | solid fill (the one step that is the same hex in light and dark) |
| 10 | solid fill, hover |
| 11 | text on tinted or app backgrounds (the DEFAULT text step) |
| 12 | high-contrast text |

You will rarely touch steps directly; the role tokens below already
picked them. The table exists so a token's choice reads as a decision,
not a mystery.

## Role tokens: pick by job

| job | token | notes |
|---|---|---|
| surface behind everything | `--tk-bg` | page ground |
| card / panel / chrome / inset / overlay / raised | `--tk-card`, `--tk-panel`, `--tk-chrome`, `--tk-inset`, `--tk-overlay`, `--tk-raised` | roles map to different surface steps per scheme (dark inverts card and page); never assume a role's step |
| raw surface ramp | `--tk-surface-1..4` | prefer the role tokens above |
| body text | `--tk-text-1..4` | 1 is high-contrast (slate 12), 2-4 are slate 11 in muted shades; bars: 7.0 / 4.5 / 4.8 / 4.8 |
| status/hue text at body size | `--tk-text-<hue>` | step 11; bars: 4.5 as text, 3.0 floor as a glyph |
| status/hue text at small size | `--tk-text-<hue>-small` | step 12; bar 7.0; use at roughly 12px and under |
| status glyphs and emphasis | `--tk-text-<hue>-vivid` | today an alias of `--tk-text-<hue>`; use the vivid name for glyphs so intent survives future re-tuning |
| solid fills (buttons, badges, dots) | `--tk-fill-<hue>` / `--tk-fill-<hue>-hover` | the solid steps, picked per scheme in values.ts |
| label ON a fill | `--tk-on-fill-<hue>` | white for every hue except gold (a pale scale), which takes a dark neutral; NEVER pair a text token with a fill |
| separators | `--tk-line-1..3` | line-1 clears the 3.0 non-text bar |
| borders | `--tk-border`, `--tk-border-soft`, `--tk-border-on-card` | |
| status dots | `--tk-dot-ok/warn/bad` | |

Hues: accent, ok, bad, warn, gold, purple, cyan (Mantine names:
accent/ok/bad/warn/gold/purple/cyan; virtual aliases blue/green/red/
yellow/violet map onto them). "Amber-ish / attention" is `warn`; `gold`
is a distinct hue, not warn's synonym.

Three consumption surfaces are sanctioned, all fed by the same values:

- the `--tk-*` custom properties above (CSS and inline styles);
- the app-kit scheme-colors hook (`useSchemeColors`) and the `--ui-*`
  variables it wraps, for component code that wants named roles;
- the Mantine virtual-colour variables (`--mantine-color-<hue>-light`,
  `-filled`, `-text`, ...) and `color="<hue>"` props on Mantine
  components.

Pick whichever the surrounding file already uses; they agree with each
other. Anything not in these three families is improvisation.

The five rules that prevent 90% of improvisation:

1. Text on a tint or surface: `--tk-text-*` by size band, never a fill
   token, never a step you picked yourself.
2. Anything on a fill: `--tk-on-fill-<hue>`, even when a darker label
   "looks fine".
3. A glyph that carries status: `-vivid`, judged at the 3.0 glyph bar.
4. No raw colour values in app code, ever. The lint gate agrees.
5. Never print a raw hex "equivalent" either -- not "for a design tool",
   not "in case you need it", not as a commented alternative. Snippets
   get pasted whole; an aside hex becomes shipped colour. Point at the
   token name and, for design tools, at `values.ts` as the place to read
   a current value.

Mantine's own colour conveniences are off-system: `c="dimmed"`,
`--mantine-color-dimmed`, and the stock gray scale do not track these
ramps. Muted text is `--tk-text-3` / `--tk-text-4` (or the scheme-colors
hook's muted role above), nothing else.

## The contrast gates

`packages/tui-kit/test/ramps.matrix.test.tsx` measures every emitted
pair against: text-1 7.0, text-2 4.5, text-3/4 4.8, hue text 4.5 (3.0 as
a glyph), hue-small 7.0, line-1 3.0. Button cells run in
`Button.matrix.test.tsx` against 4.5.

When a NEW pair legitimately fails a bar, the answer is a ledger entry in
`packages/tui-kit/src/a11y/known-contrast-debt.ts` with a reason and
human sign-off -- read that file's header first; its ratchet contract is
the rule (entries may be removed or improved, never silently worsened,
and never used to admit a new below-floor cell). Do not weaken a bar, do
not "fix" a failure by picking a darker one-off colour.

## Type

- Font weights follow radix-ui/themes: 400 regular, 500 medium, 700
  bold. There is no 600. Headings are 700, control labels 500. A
  neighbouring `fw={600}` is a pre-Radix straggler, not precedent: new
  code picks 500 or 700, and fixing the straggler in passing is welcome.
- chat has its own four-step ladder (xs 12 / sm 13 / md 14 / lg 16 /
  xl 20, mounted at the root provider so portals agree) -- inside chat,
  never size text with a raw px or an off-ladder token; see
  `apps/chat/src/app/chat-font-theme.ts`.
- In every app: a sizeless Mantine `Text` resolves to `md`, it does NOT
  inherit. State a size.

## Dark mode

Comes free when you use role tokens; both schemes are generated from the
same specs. Never branch on scheme in app code to pick a colour --
if a pair only works in one scheme, that is a values.ts/ledger question,
not an app-level override.

## Background

- Spec: `docs/superpowers/specs/2026-09-20-text-and-surface-ramps-design.md`
  (why the ramps are what they are).
- `AGENTS.md` (repo root): the import walls and theme extension points
  for `packages/ui` -- the component-level contract this guide's colour
  rules sit inside.
