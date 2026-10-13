---
paths:
  - "packages/ui/src/core/**"
  - "packages/ui/src/icons/**"
  - "packages/ui/scripts/**"
---

# Kit contract: components and icons

## 2. Adding a component: kit vs. app

**Add it to the kit (`packages/ui/src/core/<name>/`)** when the component
is generic -- no product-specific copy, no product-specific business
logic. Every kit component follows the same shape:

- `packages/ui/src/core/<name>/<Name>.tsx` -- the component.
- `packages/ui/src/core/<name>/<Name>.stories.tsx` -- a Storybook story
  (`Meta`/`StoryObj` from `@storybook/react-vite`).
- A named export added to `packages/ui/src/core/index.ts`.

If the component's name collides with something `@mantine/core` (or
`@mantine/dates`, also star-exported there) already exports, the barrel's
export order is a deliberate convention:

```ts
export * from '@mantine/core';
export * from '@mantine/dates';

// Shadows (Table, TextInput, CopyButton -- see the eslint wall in
// packages/ui/src/**). Named exports placed AFTER the `export *` above, so
// they win over the star-exported Mantine originals...
export { Table } from './table/Table';
export type { TableProps } from './table/Table';
export { TextInput } from './text-input/TextInput';
export type { TextInputProps } from './text-input/TextInput';
```

Per the ES module spec, a named export always wins over a colliding name
introduced by a `export *` elsewhere in the same module, regardless of
statement order -- but the convention here is still to place the named
shadow export _after_ the star line, so the barrel reads top-to-bottom as
"everything from Mantine, then the kit's own overrides on top."
(`@mattstack/app-kit/modals` and `@mattstack/app-kit/notifications` follow
the identical pattern for their own colliding `modals`/`notifications`
names -- see §5.) If a new component's name does _not_ collide with
anything in `@mantine/core`/`@mantine/dates`, it is a plain named export
anywhere in the barrel -- e.g. `PageShell`, `SelectableList`,
`HybridMenu`. A colliding name is fine when the shadow is _deliberate_:
the kit intentionally shadows Mantine's headless render-prop `CopyButton`
with its own labeled, batteries-included `CopyButton`, while
`CopyActionIcon` keeps the icon-only variant under a collision-free name.
Only rename or namespace a component if a bare name would shadow an
existing Mantine export _unintentionally_.

**Adding a component family**: sibling components that belong together
still live in **one** folder, `packages/ui/src/core/<family>/`, with one
`.tsx` + `.stories.tsx` per sibling. Shared data or helpers backing the
family go in a plain module inside that same folder, imported relatively
by the siblings. Export the data module's contents through
`packages/ui/src/core/index.ts` only if consumers genuinely need them --
by default only the components (and their prop types) cross the barrel.

**Add it to an app** when the component is product-specific: product
copy, product data, or otherwise only makes sense for one app rather than
any app built on the kit. See "The mattstack layer" below for what the
kit itself ships as app-level chrome (`MattstackShell`, `RailLink`) versus
what stays app-owned.

**App chrome recipe**: the double-nav app chrome ships as a kit component,
composed from `RailShell` (`packages/ui/src/core/rail-shell/`, a
`SiteShell` in `layout="alt"` whose navbar is a mini icon rail) plus
`Rail`/`RailEntry` in its `rail` slot, wired by `useRailState`. `RailShell`

- `PageShell` compose the same way as in mantine-kit: host a `PageShell`
  in `children` (passing the chrome's header height as its `topOffset`) for
  the page-level sidebar. The z-index contract is fixed inside `RailShell`
  and pairs with `PageShell`: desktop rail navbar 5, under the `PageShell`
  root's 10, header 100 (Mantine's default), mobile click-to-close overlay
  999, mobile-open chrome 1000. `RailShell.stories.tsx` is the live
  Storybook reference; `MattstackShell` (see "The mattstack layer") is the
  higher-level, whitelabeled shell apps actually mount, and composes
  `RailShell` internally.

**Keep kit modules tree-shakeable.** Consumers vendor all of
`packages/ui/src` but may render a fraction of it; a module is only
droppable from their bundles if its top level is provably
side-effect-free. Three patterns silently pin a module (and its whole
import tree) into every consumer build:

1. **Top-level mutations** -- `Component.displayName = ...`, compound
   statics (`PageShell.Sidebar = Sidebar`). Instead: name the inner
   function, and attach compound statics via a single
   `/* @__PURE__ */ Object.assign(Root, { ... })` export (see
   `PageShell.tsx`, `Table.tsx`).
2. **Unannotated top-level factory calls** -- `forwardRef(...)`,
   `createPolymorphicComponent(...)`, `Container.withProps(...)`,
   registry-builder calls. Annotate each with `/* @__PURE__ */`. If the
   call's arguments contain property reads (`MantineTable.Thead`), wrap
   call and reads together in a `/* @__PURE__ */ (() => ...)()` IIFE.
3. **Top-level property reads and spreads** -- `const X = Menu.Item as
...`, object spreads of imported records. Wrap in a PURE IIFE (see
   `SearchableMenu.tsx`, `Icons.ts`).

`packages/ui/scripts/treeshake-check.sh` (CI: `bun run treeshake`)
enforces this: it builds a minimal probe that imports only `Button` + the
theme through the barrels and fails if any kit module outside the
documented floor survives in the bundle. If a new component trips it, one
of the three patterns above is the reason.

## 3. Icon registry workflow

All icons go through the registry in `packages/ui/src/icons/Icons.ts` --
nothing imports `lucide-react` directly outside that file (the wall bans
it: `import { Icon } from '@mattstack/app-kit/icons'`), with one sanctioned
exception: an app's own icon-registration file, which disables the rule
locally to call `registerIcons` -- see §8.

**Adding a lucide icon**: import it from `lucide-react` at the top of
`Icons.ts`, wrap it with `lucideWrapperFn` (adapts a `LucideIcon` to the
kit's fixed prop surface -- `size` defaulting to 16, plus
`color`/`className` passthrough), and add it to whichever category object
fits, spread into the exported `Icons` map:

```ts
import { Trash2 } from 'lucide-react';

import { lucideWrapperFn } from './lucideWrapperFn';

const ActionIcons = {
  trash: lucideWrapperFn(Trash2),
  // ...
};

export const Icons = {
  ...ActionIcons,
  // ...
  ...BrandIcons,
};
```

`packages/ui/src/icons/Icons.test.ts` guards the registry against any
entry that resolves to `undefined` (a typo'd lucide import name silently
imports `undefined`), and that `ICON_NAMES` enumerates the registry
exactly. `IconName` (in `types.ts`) is `keyof typeof Icons | (keyof
AppIcons & string)` -- derived from the registry itself plus whatever an
app has augmented (see "Extension points" under "The mattstack layer"),
so adding a kit entry automatically makes it a valid `<Icon name="...">`
value with no separate list to update.

**Brand icons**: `packages/ui/src/icons/brand-icons/index.ts` is an
intentionally empty slot (`BrandIcons`) for a product's own logo/brand
SVGs, spread into `Icons` _last_ so a brand icon can shadow a generic name
if it ever needs to. Using `satisfies Record<string, IconComponent>`
(rather than a type annotation) is deliberate: it keeps the inferred type
as the literal object with no index signature, so spreading `BrandIcons`
into `Icons` does not widen `IconName` to a bare `string`.
