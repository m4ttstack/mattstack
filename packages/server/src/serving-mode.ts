export type ServingModeDecision =
  { mode: 'embedded' } | { mode: 'disk' } | { mode: 'fatal'; message: string };

/**
 * A distributed build (the helper bundle, or a compiled binary) with no
 * manifest means `bun build` ran without `mattstack-embed-assets` first
 * (`build:bundle` runs both, in order, but nothing stops a bare `bun build`
 * from skipping the first step) -- there is no `dist/` on a user's machine
 * for that build to fall back to, so this combination must refuse to serve
 * rather than silently 404 everything. Every other combination is a normal,
 * expected mode.
 */
export function decideServingMode(params: {
  manifestLoaded: boolean;
  isCompiledBinary: boolean;
}): ServingModeDecision {
  if (params.manifestLoaded) return { mode: 'embedded' };
  if (params.isCompiledBinary) {
    return {
      mode: 'fatal',
      message:
        'FATAL: this build has no embedded static assets. ' +
        'src/server/embedded/manifest.ts (written by ' +
        '`mattstack-embed-assets`) did not exist when `bun build` ran, so ' +
        'no static assets were bundled and this build cannot serve the app. ' +
        'Build with `bun run build:bundle`, which runs codegen and the ' +
        'bundle step in order -- do not run `bun build` on ' +
        'src/server/index.ts directly.',
    };
  }
  return { mode: 'disk' };
}
