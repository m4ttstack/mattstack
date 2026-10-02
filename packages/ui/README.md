# @mattstack/app-kit

The Mantine-based component kit for mattstack apps, plus the mattstack
layer on top of it: app shell, boot, router helpers, icon registry, config
presets. Tokyo theme (`@mattstack/mantine-tokyo`) pre-wired -- a consuming
app never carries its own theme file. Source-shipped: `exports` point at
`src/*.ts(x)` and `.css` directly, no build step.

See the repo root `README.md` and `AGENTS.md` for the full contract; this
file is the one-screen version for this package.

## Subpaths

| Subpath                | Contents                                                                                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./core`               | `export * from '@mantine/core'` and `@mantine/dates`, then the kit's shadows (`Table`, `TextInput`, `CopyButton`) and components (`PageShell`, `RailShell`, `Rail`, `RailEntry`, `SiteShell`, `HybridMenu`, `SelectableList`, `VirtualTable`, ...) |
| `./hooks`              | `useColorScheme`, `useLocalStorage`, `useSessionStorage`, `useUIState`, `useIsMobile`, `useSchemeColors`, `useHasOverflowX`, `useHoverableTextStyle`                                                                                               |
| `./forms`              | `FormContainer`, `useModalForm`, `useModalFormSubmit`, validation, types                                                                                                                                                                           |
| `./modals`             | `modals` facade (`confirm`, `prompt`), `ModalsProvider`                                                                                                                                                                                            |
| `./notifications`      | `notifications` facade, `TimedRingProgress`                                                                                                                                                                                                        |
| `./icons`              | `Icon`, `IconName`, `AnimatedChevron`, `registerIcons`                                                                                                                                                                                             |
| `./lazy`               | `LazyLoader`, `CodeHighlight`, `CodeMirror`                                                                                                                                                                                                        |
| `./spotlight`          | spotlight re-exports                                                                                                                                                                                                                               |
| `./design-system`      | `theme` (pre-branded), `baseTheme`, `ThemeIsland`, `ThemeInitializer`, `ThemeOverrideWrapper`, `getColorSchemeFromDocument`, `variantColorResolver`                                                                                                |
| `./boot`               | `registerSimpleAlerts`, `markMounted`; `./boot/simple-loading-bar.css` is the stylesheet                                                                                                                                                           |
| `./app`                | `mountMattstackApp`, `MattstackShell`, `AppLauncher`, `MattstackMark`, `DaemonBanner`, `useDaemonHealth`, `NotFoundPage`                                                                                                                           |
| `./router`             | `RailLink`, `Link`, `useHash`                                                                                                                                                                                                                      |
| `./utils`              | `createDynamicTable`, `identity`                                                                                                                                                                                                                   |
| `./test-utils`         | `renderWithProviders`, `spyableAction`, jsdom polyfills, `stubVirtualLayout`, `expectLoadingBarInSync(indexHtml: string)`                                                                                                                          |
| `./styles.css`         | kit styles entry (Mantine styles, scheme vars, overrides, Tokyo CSS)                                                                                                                                                                               |
| `./eslint`             | `mattstackEslint()`, the flat config array with the import wall                                                                                                                                                                                    |
| `./vite`               | `mattstackVite()`                                                                                                                                                                                                                                  |
| `./tsconfig.base.json` | the compiler options a consumer `tsconfig.json` extends                                                                                                                                                                                            |

## Snippets

```tsx
// src/main.tsx
import { mountMattstackApp } from '@mattstack/app-kit/app';
import { App } from './App';

mountMattstackApp(<App />);
```

```tsx
// src/App.tsx
import { MattstackShell, NotFoundPage } from '@mattstack/app-kit/app';
import { Icon } from '@mattstack/app-kit/icons';
import { RailLink } from '@mattstack/app-kit/router';

export function App() {
  return (
    <MattstackShell name="chat">
      <MattstackShell.Rail>
        <RailLink icon="users" label="Rooms" href="/" active />
      </MattstackShell.Rail>
      {/* routed page content, or <NotFoundPage /> */}
    </MattstackShell>
  );
}
```

```ts
// vite.config.ts -- the preset ships as hand-authored .js, so no
// special vite/vitest flags are needed
import { defineConfig } from 'vite';

import { mattstackVite } from '@mattstack/app-kit/vite';

export default defineConfig(mattstackVite({ apiPort: 11002 }));
```

```js
// eslint.config.js
import { mattstackEslint } from '@mattstack/app-kit/eslint';

export default mattstackEslint({ app: ['src/**/*.{ts,tsx}'] });
```

A page whose tab row is also its header row, above a sidebar, opts the
root-level tab bar into the title and actions with `tabBar`; without it the
root bar takes tabs only, and a `PageShell.TabBar` composed in
`PageShell.Main` sits beside the sidebar instead:

```tsx
<PageShell tabs={tabs} tabBar={{ title: 'Wiring', actions: <PackPicker /> }}>
  <PageShell.Sidebar>{/* ... */}</PageShell.Sidebar>
  <PageShell.Main>{/* ... */}</PageShell.Main>
</PageShell>
```

Such a page can also pass the root a `topNotch`: with compound children it
docks full width under that tab bar, above the sidebar and the content, and
both give up its measured height so neither scrolls. A `topNotch` on
`PageShell.Content` stays over the content column only, and in simple mode
the root's goes to the auto-wrapped content as before.

A `Badge` that sits on the page ground (`--tk-bg`) takes one of the kit's
opt-in quiet tones, `variant="quiet"` (raised fill) or
`variant="quiet-outline"` (card fill with the kit border); Mantine's gray
`light` fill is the ground itself there. A chip inside a card can take
`variant="panel-outline"` (panel fill, soft rule, body label), and a control
that takes the surface it sits on, such as an `ActionIcon` in a drawer
header, `variant="soft-outline"` (no fill, soft rule, muted glyph).

A `Paper` on the page ground (a card on a dotted canvas) can take
`variant="ground"`: the card surface in both schemes and, with `withBorder`,
a rule in the kit border rather than Mantine's lighter separator gray, drawn
as an outline inside the edge so it sits over a full-width header or row. A
ground card marked `data-selected` rings in the accent instead. Inside a
card, a `Paper` can take `variant="soft-outline"` (no fill of its own, so the
card shows through, under a soft rule) or `variant="panel-outline"` (the
panel surface under the same rule, for a note), and a `Table` can take
`variant="soft"`: its rules in the soft line step, its header row on the
panel, and its own `Paper` a soft-outline card. A secondary `Button` on a
card can take `variant="card-outline"` (card fill, the kit border and a body
label, where Mantine's `default` draws its own black or white label), and a
`Combobox.Option` in a list on a card can take `variant="wash"`: body text,
and the option marked `active` (the one picked) in the thin accent wash with
the accent text step. A
`Progress` that splits a whole into parts can take `variant="segmented"`: no
track, a gap between the sections that shows the surface beneath, `gray`
parts in the soft line step, and the part marked `data-active` in the strong
one.

On a panel surface, a selected `NavLink` can take `variant="wash"` (a thin
wash of its kit hue behind a label in that hue), and a `Switch` can take
`variant="contrast"` (an off track that holds against the panel in both
schemes). A `SegmentedControl` there can take `variant="quiet"`: a raised
track, the active segment a card ruled in the soft line step with no shadow,
and muted labels until active.

Something that needs attention takes a tint of its kit hue, lighter in dark
than a selection's wash. A status tag (`Badge`) can take `variant="tint"`
(the tint behind a label in the hue's text step, no rule), a banner (`Alert`)
`variant="tint-outline"` (the same tint, ruled in the hue's fill), and a
status chip on a card `variant="hue-outline"` (a card fill ringed in the
hue's fill, the label in its text step). A ground card marked
`data-attention` rings in the warn fill; a selection ring wins over it.

`CodeLines` can take `variant="wash"`: the highlighted range in the thin
accent wash with accent line numbers and body text, the text outside it
muted, and a muted band ruled in the soft line step. Its `classNames` size
each part of a row (gutter, number cell, number, code), and `rowAttributes`
puts data attributes on each part from what that row shows, including
whether it is in the viewport. Every row is as wide as the longest line, so
a highlight follows a sideways scroll, and `scrollbarType` passes a
ScrollArea `type` (`hover` keeps the scrollbars out of sight at rest). With
`wrap`, a long line breaks at the viewport's width and its row grows to fit,
instead of the rows scrolling sideways. A band's label is a tag that sticks to
the top of the viewport while its lines are in view, drawn through
`VirtualList`'s opt-in `renderOverlay`, a layer over the rows that knows where
each row sits.

An app that registers its own icon adds a `declare module
'@mattstack/app-kit/icons' { interface AppIcons { hash: true } }` block in
a `.d.ts` file that does NOT share a basename with a sibling `.ts` file in
the same directory (TypeScript drops `foo.d.ts` when `foo.ts` sits next to
it). See the root `AGENTS.md`'s "Consumer requirements" section for this
and the other real failure modes a migrating app hits.
