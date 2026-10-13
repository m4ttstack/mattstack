---
paths:
  - "packages/ui/src/design-system/**"
  - "packages/ui/src/styles/**"
  - "packages/tokyo/**"
  - "packages/tokens/**"
---

# Kit contract: theme

## 4. Theme override patterns

**The theme is three files, all kit-owned; a consuming app edits none of
them.** This is the one place app-kit's contract differs from
mantine-kit's: mantine-kit lets an app own `app-theme.ts` as its brand
extension point, but app-kit closes that off on purpose --
`app-theme.ts` and `app-colors.ts` permanently re-export
`@mattstack/mantine-tokyo`'s theme and colour names:

| File                          | Owner | What it holds                                                           |
| ----------------------------- | ----- | ----------------------------------------------------------------------- |
| `design-system/base-theme.ts` | kit   | `baseTheme`, the kit's unbranded defaults.                              |
| `design-system/app-theme.ts`  | kit   | `export { tokyoTheme as appTheme } from '@mattstack/mantine-tokyo'`.    |
| `design-system/theme.ts`      | kit   | `theme = mergeThemeOverrides(baseTheme, appTheme)`, i.e. Tokyo-branded. |

A mattstack app that needs a new named colour adds it to
`@mattstack/mantine-tokyo` (a kit-family change), never to itself or to
app-kit's `app-colors.ts`. A per-app runtime override goes through
`mountMattstackApp(node, { theme })` (merged on top of the already-branded
`theme`), not through editing any of the three files above.

This still buys the same two things mantine-kit's split buys:

- **The kit's unbranded look stays reachable.** `baseTheme` is still an
  importable object, so "make this subtree look like the kit, not Tokyo"
  is `<ThemeIsland theme={baseTheme} baseSurfaces>` -- one import, no
  transcription, no drift.
- **DEFAULT vs BRAND stays legible.** Everything in `base-theme.ts` is a
  considered default (the component ergonomics especially -- `Group`
  nowrap, `Select` allowDeselect, the Tooltip pop family); `app-theme.ts`
  is where the brand palette lives, separately.

**Write scalar-or-object theme options in their object form.**
`primaryShade` is `{ light, dark }` in `base-theme.ts` even though both
shades are 7 and Mantine accepts the scalar. Mantine's `deepMerge` recurses
into an object source without checking that the target is one too, so a
scalar target merged with an object override collapses to `{}` and blanks
the page with a `TypeError` from `isValidPrimaryShade` that names neither
`primaryShade` nor the theme that supplied it. `design-system/theme.test.tsx`
pins it.

**Kit-wide defaults** live in `packages/ui/src/design-system/base-theme.ts`,
via `createTheme`'s `components` map in Mantine's string-keyed form --
deliberately NOT each component's `.extend({ defaultProps })`:

```ts
type MantineExports = typeof import('@mantine/core');

const themeComponents = (entries: {
  [Name in ExtendableName]?: ExtendInput<Name>;
}) => entries as Record<string, MantineThemeComponent>;

export const baseTheme = createTheme({
  primaryColor: 'indigo',
  primaryShade: { light: 7, dark: 7 },
  defaultRadius: 'md',
  components: themeComponents({
    Paper: { defaultProps: flatSurfaceProps },
    Button: { defaultProps: { fw: 500 } },
  }),
});
```

Both forms merge identically at runtime, because `Component.extend` IS
Mantine's `identity` -- its only contribution is typing. But referencing
the component to reach `.extend` imports the component OBJECT into the
theme module, pinning that component (plus its dependency trees) into
every bundle. Keying off the component name (a type-level `typeof
import('@mantine/core')`) gets the same types with no value import.
`packages/ui/scripts/treeshake-check.sh` guards this.

**Per-subtree theming: to ADD a treatment, wrap with an override; to
SUBTRACT one, provide a baseline.**

| Ask                                                           | Use                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| "this section needs rounder cards / a different primaryColor" | `ThemeOverrideWrapper` (merges onto the ancestor theme)    |
| "make this route look like the unbranded kit again"           | `ThemeIsland theme={baseTheme} baseSurfaces` (replaces it) |
| "this preview must render exactly as production does"         | `ThemeIsland theme={appTheme} cssVariablesResolver={...}`  |

`ThemeOverrideWrapper` requires an ancestor `MantineProvider`
(`useMantineTheme()` throws otherwise), which is always true inside a
mattstack app since `mountMattstackApp` wraps the whole tree in one. It is
layout-transparent (`display: contents`).

**Never nest a bare `MantineProvider` for a subtree.** Both components
route through an internal `ScopedThemeProvider` because a nested provider
gets three things wrong, each silently: `cssVariablesSelector` defaults to
`:root` (a nested provider emits variables globally); Mantine composes
scheme blocks as `${selector}[data-mantine-color-scheme="..."]`, so that
attribute has to sit on the same element; and `MantineProvider` writes the
scheme attribute to `getRootElement()` seeded from its own
`defaultColorScheme` of `'light'`, which can flip the whole page light on
a dark-preference machine. `forceColorScheme` pins it to what the parent
already resolved. A nested provider also does NOT inherit the app's
`cssVariablesResolver`; both components take one and forward it.
`design-system/ThemeIsland.test.tsx` pins all of this.

**Per-call-site presets**: for Mantine's own factory components
(`Button`, `Badge`, `Paper`, `Container`, ...), use the typed static
`.withProps({...})` every factory component carries -- the kit's own
`ContentContainer` is exactly this (`Container.withProps({...})`). For kit
shadows and plain/`forwardRef` components with no static `.withProps`,
write a small wrapper component that spreads caller props after the
preset (caller props win), keeping the component's own concrete prop
type.

**The `--ui-bg-*` surface-slot contract**: the four background variables
(`--ui-bg-1..4`, exposed as `bg.level1..4` by `useSchemeColors`, see §6)
are **four scheme-aware surface slots**. The default mapping (in
`packages/ui/src/styles/scheme-vars.css`) is a monotonic "raised =
lighter" elevation ladder, but that ordering is a property of the default
values, not of the contract. A consumer may re-point the four vars per
scheme however its design needs, as long as each slot stays scheme-aware
-- restore the kit's surfaces on a subtree with the `.ui-base-surfaces`
class (what `ThemeIsland`'s `baseSurfaces` prop adds). **Never point a
`--ui-base-*` value at a live `--ui-*` slot**: that closes a CSS CYCLE,
which makes every custom property in it invalid at computed-value time
(both sides silently fall back to their initial values rather than
erroring). `styles/scheme-vars.test.ts` pins it. Kit components must not
assume the slots form an ordered ramp across a multi-slot effect; picking
a single slot for a single role is fine.

**Accent props on kit components**: a component with one accent takes
`color: MantineColor` (`Notch`, `CollapsibleAlertCard`); a component with
several takes a single `colors` tuple sized to its need
(`GradientBorder`'s `[left, mid, right]`, `AnimatedBorderBox`'s
`[primary, secondary]`). Scheme-tuning knobs stay separate props
(`AnimatedBorderBox`'s `shade`).

**`primaryShade` when re-theming**: `{ light: 7, dark: 7 }` is tuned for
the default indigo on the default ramp (Mantine's default 6 reads pale
against the level-2/3 surfaces). A Tokyo re-tune should generally pick a
_lighter_ shade for dark mode and consider `autoContrast` so filled
variants keep readable label colors across shades.

**Known Mantine escape hatches**: a few Mantine components hardcode a
pill radius in their own stylesheet instead of following
`theme.defaultRadius` (verified against Mantine 9: `Badge`, `Avatar`,
`Switch`, `Chip`). Rebranding radius globally needs an explicit default in
the theme's `components` map too, e.g. `Badge: { defaultProps: { radius:
'md' } }`.

**Where raw hex lives**: raw hex/rgb values only appear in the colour
definition layer -- `@mattstack/mantine-tokyo`'s ramp/colour files and the
scheme vars in `packages/ui/src/styles/scheme-vars.css` (which reference
Mantine's palette vars rather than literals). Component code is not part
of the hex home -- components consume theme colours, `--mantine-color-*`
vars, or the `--ui-bg-*` slots, never literals.
