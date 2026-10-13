---
paths:
  - "apps/{chat,console,boxscore}/package.json"
  - "apps/{chat,console,boxscore}/vite.config.ts"
  - "apps/{chat,console,boxscore}/src/app/**"
  - "apps/{chat,console,boxscore}/src/main.tsx"
---

# Kit contract: consumer requirements

## 10. Consumer requirements

These are rules a new app consuming `@mattstack/app-kit` must follow,
drawn from building `apps/chat`, `apps/console`, and `apps/boxscore` --
missing any of them breaks in a way that does not announce itself as
"the kit is wrong":

1. **The Mantine colour-name augmentation needs no `/// <reference>`
   line.** It lives in `packages/ui/src/design-system/colors.ts` (a
   `declare module '@mantine/core'` block) and reaches a consumer through
   any import of `@mattstack/app-kit/app`, `@mattstack/app-kit/design-system`,
   or `@mattstack/app-kit/test-utils` -- all three transitively pull in
   `design-system`. A consumer does NOT add its own reference line or
   duplicate the augmentation.

2. **Name an app-icon augmentation file so it does not share a basename
   with a sibling `.ts` file.** TypeScript drops a `foo.d.ts` when `foo.ts`
   exists next to it in the same directory, so the augmentation silently
   never loads and `IconName` never widens. `apps/chat/src/app/icons.ts`
   (the registration call) and `apps/chat/src/app/app-icons.d.ts` (the
   `declare module '@mattstack/app-kit/icons' { interface AppIcons {...}
}` block) are named to avoid exactly this collision -- do not name the
   augmentation file `icons.d.ts` next to an `icons.ts`.

3. **The vite preset ships as hand-authored JavaScript** (`presets/vite.js`,
   typed by `presets/vite.d.ts`, exported as `@mattstack/app-kit/vite`), the
   same way `presets/eslint.js` ships. A Vite config runs through Node's
   config loader before the consumer's own build pipeline, so a `.ts` file
   cannot be type-stripped from inside `node_modules`; shipping `.js`
   avoids that entirely. A consumer whose `vite.config.ts` imports
   `@mattstack/app-kit/vite` needs no special config-loading flag on any
   Vite invocation (`vite`, `vite build`, `vitest`; see
   `apps/chat/package.json`'s `dev`/`build`/`test` scripts).

4. **`bg.level2` can read as indistinguishable from a Mantine input's own
   background in dark mode.** `level2` ("the default surface sitting on
   the page") looks correctly distinct from `level1` in both schemes when
   judged against the bare page -- but a re-themed dark palette can put an
   input's own background close enough to `level2` that a card built from
   `level2` and containing form inputs reads as one flat surface in dark
   mode, even though light mode looks fine. Confirmed in `apps/console`:
   an `AgentDefaultsPage.tsx` settings card on `bg.level2` was fine in
   light, but its `TextInput`/`Select` fields were nearly invisible
   against the card in dark. `bg.level4` (the deliberate contrast step --
   lighter in dark, deeper in light) reliably reads as distinct from
   default input backgrounds in both schemes; reach for it over `level2`
   for any card/panel whose main job is to hold its own inputs. Verify
   both schemes in a real browser before calling a surface choice done --
   this is not visible from reading the token names or from light mode
   alone.

5. **Depend on `workspace:*`, not a packed tarball or a bare `file:` path,
   now that an app lives in this repo.** Every app under `apps/` declares
   `"@mattstack/app-kit": "workspace:*"` (and the same for `app-server`,
   `mantine-tokyo`) in its own `package.json`. `workspace:*` resolves
   through this repo's single `bun install`, so peers (`react`, `vite`,
   `wouter`) resolve once, the same as a registry install would. The
   packed-tarball mechanism (`bun pm pack`) is for a consumer OUTSIDE this workspace only -- an
   app that has not folded in yet. A bare `file:../packages/ui` dependency
   from outside the workspace still hits Bun 1.3's symlink-into-source
   behavior (contents symlink rather than copy, so peers resolve twice:
   once through the symlinked package's own `node_modules`, once through
   the consumer's), which is exactly the failure mode `workspace:*` and
   the tarball path both avoid, each in their own scope.

6. **A custom label/header over a kit input needs its own `aria-label`.**
   Building a denser form row (a shared label + status badge above the
   control, say) usually means dropping the input's own `label` prop so
   it doesn't render twice. But `label` is also what gives the input its
   accessible name -- drop it with nothing in its place and
   `getByLabelText`/`getByRole(..., { name })` (Testing Library) and
   screen readers alike lose the field's name. Pass `aria-label` matching
   the visual label text to the underlying control instead; it satisfies
   both without rendering a second visible label. `AgentDefaultsPage.tsx`
   in `apps/console` does this for every field with a custom row header.
