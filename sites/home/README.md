# mattstack.dev

The front door: a static landing page that resolves the latest mattstack.app DMG
from m4ttstack/mattstack releases at view time. It is a workspace member
(`mattstack-home`), so turbo runs its `build` and `test` with the rest of the
monorepo.

- `bun run build` assembles `dist/` from an allowlist, so repo internals
  (`docs/`, the `.pen` design source, tests) are never served.
- `bun run test` runs the join page's tests.
- `bun run deploy` builds and deploys to Cloudflare Pages (project
  `mattstack-dev`).

The app marks in `assets/` are written by `bun scripts/gen-app-icons.ts` from
`@mattstack/app-icons`; never edit them by hand.
