import type { Context, Hono, Next } from 'hono';

import { mountEmbeddedStatic } from './embedded/mount';
import {
  toResponse as bunToResponse,
  type ResolvedAsset,
} from './embedded/serve';
import type { EmbeddedManifest } from './embedded/types';
import { injectHostSignal } from './host-signal';
import { ICON_FILES } from './icon-files';
import { buildIdOf, type HealthState } from './instance';
import {
  createMemoryStatic,
  nodeSnapshotFs,
  type SnapshotFs,
} from './memory-static';

export interface MountStaticOptions {
  /** Present in a compiled binary; null or absent means serve `distRoot` off disk. */
  embedded?: EmbeddedManifest | null;
  /** @default './dist', relative to the process cwd (the app root). */
  distRoot?: string;
  /** Test seam for embedded mode; defaults to the Bun.file-backed response. */
  toResponse?: (asset: ResolvedAsset) => Response;
  /** Test seam; defaults to node:fs. */
  fs?: SnapshotFs;
}

/**
 * Disk mode holds `dist/` in memory, so a page keeps loading while the
 * folder is mid-rebuild or unreadable. The SPA fallback checks the request
 * path itself rather than relying on registration order: a bare '*'
 * fallback would answer an unmatched /api route with 200 and index.html, and
 * /ws with 200 instead of an upgrade.
 */
export function mountStatic(
  app: Hono,
  opts: MountStaticOptions = {}
): { health(): HealthState } {
  const fs = opts.fs ?? nodeSnapshotFs;
  let serveIndex: () => Response | null;
  let health: () => HealthState;

  if (opts.embedded) {
    mountEmbeddedStatic(app, opts.embedded, opts.toResponse ?? bunToResponse);
    try {
      const raw = new TextDecoder().decode(
        fs.read(opts.embedded.indexHtmlPath)
      );
      const buildId = buildIdOf(raw);
      const html = injectHostSignal(raw, buildId);
      serveIndex = () =>
        new Response(html, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      health = () => ({ ok: true, buildId });
    } catch {
      serveIndex = () => null;
      health = () => ({ ok: false, buildId: null });
    }
  } else {
    const memory = createMemoryStatic(opts.distRoot ?? './dist', fs);
    const serveOrNext = async (c: Context, next: Next) =>
      memory.serve(c.req.path) ?? next();
    app.use('/assets/*', serveOrNext);
    app.use('/fonts/*', serveOrNext);
    for (const icon of ICON_FILES) app.get(`/${icon}`, serveOrNext);
    serveIndex = memory.index;
    health = memory.health;
  }

  app.use('*', async (c, next) => {
    if (c.req.path.startsWith('/api')) return c.notFound();
    if (c.req.path === '/ws') return next();
    const page = serveIndex();
    if (page) return page;
    // A loaded error page would read as a ready tab; a 503 marks it not ready.
    return health().ok
      ? c.notFound()
      : c.json({ error: 'app files unreadable' }, 503);
  });
  return { health };
}

export { decideServingMode } from './serving-mode';
export type { ServingModeDecision } from './serving-mode';
export {
  isCompiledBinary,
  isCompiledBinaryMain,
} from './embedded/compiled-binary';
export { loadEmbeddedManifest } from './embedded/manifest-loader';
export type { EmbeddedManifestModule } from './embedded/manifest-loader';
export type { EmbeddedManifest } from './embedded/types';
export type { ResolvedAsset } from './embedded/serve';
