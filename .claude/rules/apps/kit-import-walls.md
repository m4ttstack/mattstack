---
paths:
  - "apps/{chat,console,boxscore}/src/**"
  - "packages/ui/src/**"
  - "packages/ui/presets/**"
  - "eslint.config.mjs"
  - "apps/*/eslint.config.js"
---

# Kit contract: import walls

## 1. Why the import walls exist, and how to satisfy them

Two separate walls, at two separate scopes.

**A consuming app's own code** (`apps/chat`, `apps/console`,
`apps/boxscore` -- the three Mantine-based apps; `apps/board` and
`apps/deck` consume `@mattstack/tui-kit` instead and are not subject to
this wall) is not allowed to import Mantine packages directly. Every
Mantine import goes through `@mattstack/app-kit/*` subpath barrels
instead, so the kit's fixed defaults and overrides (a shadowed `Table`, a
themed `Modal`, a typed `notifications.show`, ...) are the only way
anything Mantine-shaped enters the app. This wall ships AS the
`mattstackEslint()` preset (`packages/ui/presets/eslint.js`, exported as
`@mattstack/app-kit/eslint`) -- a consumer spreads it into its own
`eslint.config.js`, taking the default `src/**/*.{ts,tsx}` app glob.
`apps/chat/eslint.config.js` does exactly that; it is the reference
wiring a new app copies. The root `eslint.config.mjs` carries no app-level
glob and does not lint app code at all: each app is linted through its
own config via its own `<app>:lint` root script, not the root `lint`
script (which only points `eslint` at `packages .storybook`).

```js
const wall = (pkg, subpath) => ({
  name: pkg,
  message: `Import from '@mattstack/app-kit/${subpath}' instead. The kit barrel adds fixed defaults and overrides.`,
});
```

| Import this (banned in app code) | Use this instead                                                               |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `@mantine/core`                  | `@mattstack/app-kit/core`                                                      |
| `@mantine/hooks`                 | `@mattstack/app-kit/hooks`                                                     |
| `@mantine/form`                  | `@mattstack/app-kit/forms`                                                     |
| `@mantine/modals`                | `@mattstack/app-kit/modals`                                                    |
| `@mantine/notifications`         | `@mattstack/app-kit/notifications`                                             |
| `@mantine/spotlight`             | `@mattstack/app-kit/spotlight`                                                 |
| `@mantine/code-highlight`        | `@mattstack/app-kit/lazy`                                                      |
| `@mantine/dates`                 | `@mattstack/app-kit/core` (dates re-exports live in the core barrel, see §2)   |
| `lucide-react`                   | `@mattstack/app-kit/icons` (`import { Icon } from '@mattstack/app-kit/icons'`) |

Two `patterns` entries extend the wall to package families:
`react-icons`/`react-icons/*` is banned outright, and
`codemirror`/`@codemirror/*` is banned everywhere except inside the kit's
own `./lazy` CodeMirror loader. A third pattern bans `@ui/*` outright (the
old mantine-kit alias does not exist here), and a fourth bans any value
import from `**/server/**` (type imports allowed), so a server module
never reaches the browser bundle.

If ESLint reports `Import from '@mattstack/app-kit/core' instead...` on a
`@mantine/core` import, the fix is always the same: change the import
specifier to the matching `@mattstack/app-kit/*` barrel. Never disable the
rule at the call site in app code -- the whole point is that app code
never needs to. The one sanctioned exception is an app's own
icon-registration file (e.g. `src/app/icons.ts`): it may
`eslint-disable-next-line no-restricted-imports` to import `lucide-react`
directly for the `registerIcons` call -- see §8's `AppIcons` augmentation
contract and `apps/chat/src/app/icons.ts` for the reference wiring.

**Inside `packages/ui/src/**` itself**, a second, stricter rule applies --
this one is NOT shipped in the `@mattstack/app-kit/eslint` preset (a
consumer never sees it); it lives only in this repo's own root
`eslint.config.mjs`, scoped to `packages/ui/src/**`:

```js
{
  files: ['packages/ui/src/**/*.{ts,tsx}'],
  ignores: ['packages/ui/src/core/index.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [{
        name: '@mantine/core',
        importNames: ['Table', 'TextInput', 'CopyButton'],
        message: 'Use the shadowed versions from @mattstack/app-kit/core.',
      }],
    }],
  },
}
```

Every file under `packages/ui/src/**` (including other kit components) is
banned from importing the _named_ `Table`/`TextInput`/`CopyButton` exports
straight from `@mantine/core` -- those three are shadowed
(`packages/ui/src/core/table/Table.tsx`,
`packages/ui/src/core/text-input/TextInput.tsx`,
`packages/ui/src/core/copy-button/CopyButton.tsx`) and any other kit code
that needs one must go through `@mattstack/app-kit/core`'s own version.
The shadow definition files document their own exception inline:

```ts
// eslint-disable-next-line no-restricted-imports -- shadow definition site: this IS the
// `@mattstack/app-kit/core` Table the eslint wall (eslint.config.js) points everything else at.
import { Table as MantineTable, Paper } from '@mantine/core';
```

`packages/ui/src/core/index.ts` itself is `ignores`-listed from this
second rule too, because its job is to `export * from '@mantine/core'`
(and `@mantine/dates`) wholesale before layering the two named shadow
exports on top -- see §2 for why export order there matters.

**Heads up, the `TextInput` shadow changes autofill behavior**: the kit's
`TextInput` (`packages/ui/src/core/text-input/TextInput.tsx`) defaults
`autoComplete="off"`. That is a real behavior change when porting existing
forms: fields that used to autofill silently stop. Opt back in per field
where autofill is actually wanted: `autoComplete="on"`, or a specific
token (`autoComplete="email"`, `"current-password"`, ...) on real
login/signup/profile fields.

### Token namespaces (lint)

`local/token-namespaces` (style objects) and `local/token-namespaces-css`
(stylesheets) enforce the ramp namespaces: `--text-*` only in `color`,
`--surface-*` only in backgrounds and `fill`, `--border-*` only in border
and outline properties, `--fill-*` never in `color`, and the numeric
ramp steps `--surface-N` / `--line-N` never outside the tokens package.
An app that uses `mattstackEslint()` gets the first rule; add the CSS
block from the root `eslint.config.mjs` to lint its stylesheets.
