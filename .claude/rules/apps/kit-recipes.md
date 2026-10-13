---
paths:
  - "apps/{chat,console,boxscore}/src/**"
  - "packages/ui/src/hooks/**"
---

# Kit contract: recipes and hooks

## 5. Facade usage recipes

**Shells own their own frames.** Three defaults are deliberate:
`PageShell.Content` is the page's scroll frame (a `ScrollArea.Autosize`
capped at the available height, tune with `scrollAreaProps` or take the
frame over with `scrollClamp`), `PageShell.Sidebar` scrolls its own
children, and `PageShell.Content` wraps children in `ContentContainer`
(capped, centered column; opt out with `contentContainer={false}`).

**`RailShell` + `PageShell` is the normal case, and they wire themselves.**
The rail publishes its `headerHeight` on context and a hosted `PageShell`
defaults its `topOffset` to it, so the fixed header's height lives in one
place. An explicit `topOffset` still wins.

**Modals** (`@mattstack/app-kit/modals`): `modals.open` is a typed
pass-through to `@mantine/modals`' `openModal`; `modals.confirm` /
`modals.prompt` are the kit's own higher-level helpers.

```tsx
import { modals } from '@mattstack/app-kit/modals';

modals.confirm({
  title: 'Remove item',
  message: `Remove "${name}"? This can't be undone.`,
  destructive: true,
  onConfirm: () => remove(name),
});

modals.prompt({
  title: `Rename "${name}"`,
  label: 'New name',
  required: true,
  initialValue: name,
  onSubmit: newName => notifications.info(`Renamed to ${newName}`),
});
```

`destructive: true` on `confirm` renders a warning icon and a red confirm
button; `hideCancelButton: true` removes the cancel button entirely.
`prompt`'s `required` rejects an empty/whitespace submit before
`validate` runs; `message` is prose above the whole form, not the input's
label.

**Notifications** (`@mattstack/app-kit/notifications`): per-level
shorthands (`success`/`error`/`warning`/`info`) each pick a
level-appropriate icon, colour, and `autoClose` default -- `error` does
not auto-close. Each shorthand also accepts a full props object instead of
a bare string, and `color`/`icon`/`autoClose` can still be overridden per
call. `TimedRingProgress` is a countdown ring that calls `onComplete`
exactly once, typically used as a notification's own `icon`.

**Forms** (`@mattstack/app-kit/forms`): `FormContainer` wraps a `useForm`
instance (validated with `zodResolver`) in a `Paper` + submit-row layout
with a built-in loading overlay and error summary. `identifierRegex`
(`/^[A-Za-z_][A-Za-z0-9_]*$/`) is the kit's shared "safe identifier"
validator. For a form that lives entirely inside a modal, `useModalForm`
owns the modal, the zod schema, loading state, and success notification --
on a valid submit it calls `onSubmit` with the **zod-parsed** values
(`schema.parse(values)`), not the raw form values.

## 6. Storage and color-scheme hooks

**Always import storage hooks from `@mattstack/app-kit/hooks`, never
`@mantine/hooks` directly.** The shadow's whole reason to exist: Mantine's
own `getInitialValueInEffect` defaults to `true` (a guaranteed flash of
the default value); the shadow hard-codes `false` so every caller reads
localStorage/sessionStorage synchronously on first render.

**Color scheme**: `useColorScheme()` returns `{ colorScheme,
computedColorScheme, toggle, setColorScheme }`, backed by the same
anti-flicker `useLocalStorage` shadow. `colorScheme` is the raw stored
preference (can be `'auto'`); `computedColorScheme` resolves `'auto'`
against the OS preference and is what most components should render off
of. `useLightDark(light, dark)` is a convenience built on
`computedColorScheme`.

**`useSchemeColors()`** exposes the layered background tokens as
`bg.level1..level4`, plus `text.normal`/`text.muted`/`text.dimmed`,
defined per-scheme in `packages/ui/src/styles/scheme-vars.css`:

- **`level1`** -- the page itself.
- **`level2`** -- the default surface sitting on the page (cards, panels).
- **`level3`** -- a surface nested inside that (wells, content areas).
- **`level4`** -- the contrast/accent surface (hover/active states;
  `Table`'s shadow uses it for its `headerAccent`).

Levels 1-3 step progressively away from the page in the quiet direction
(light: gradually deeper greys; dark: gradually deeper darks), while
`level4` is the deliberate contrast step (deeper still in light, lighter
in dark). Use `bg.level1..4` (or the raw CSS vars) instead of hardcoding a
Mantine gray/dark shade directly.

### Text slots and sizes

`--ui-text-1` is primary text at every size; `--ui-text-2` is secondary text at body sizes and above; `--ui-text-3` at meta (about 13px); `--ui-text-4` at small and micro (under 12.5px) and shares `--ui-text-2`/`--ui-text-3`'s colour rather than `--ui-text-1`'s, since that step measures legible at small sizes too (`packages/tokens/src/values.ts`).

In JSX, `c="dimmed"` reads Mantine's `--mantine-color-dimmed` (slate 11, the same value as `--ui-text-muted` and now `--ui-text-dimmed` too), and is safe at every Mantine size including `xs`.
