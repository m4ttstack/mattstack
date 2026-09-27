# Releasing @mattstack/glance

glance is consumed inside this repo as `workspace:*`; a publish exists only
for a consumer outside it (the npm-installed `@mattstack/gitq` resolves it
from the registry). glance-react is private and publishes nowhere; its npm
versions are deprecated.
Publish from a checkout on `main`,
from the package directory, with `bun publish` and never `npm publish`:
bun rewrites `workspace:*` dependencies to the version in the tree and npm
ships them verbatim.

1. Bump `version` in the package's `package.json` and add a CHANGELOG entry.
2. `bun run build` in the package, then `bun run check-types`.
3. `bun publish` (OTP prompt).
4. Commit the bump: `glance: publish <version>`.
