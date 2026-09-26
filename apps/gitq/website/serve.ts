/**
 * Static file server for the built docs site.
 *
 * Docusaurus emits a plain static tree, so this only needs to map a URL path to
 * a file. With `trailingSlash: false` a page lands at `<path>.html`, while the
 * home page and the generated category indexes land at `<path>/index.html`, so
 * both shapes are tried before giving up.
 *
 * Build with DOCS_BASE_URL=/ so the site's asset paths match being served at
 * the root of its own domain rather than under the GitHub Pages /gitq/ prefix.
 */
import { join, normalize } from 'node:path';

const BUILD_DIR = join(import.meta.dir, 'build');
const port = Number(process.env.PORT) || 11009;

async function firstExisting(paths: string[]): Promise<Response | null> {
  for (const path of paths) {
    const file = Bun.file(path);
    if (await file.exists()) return new Response(file);
  }
  return null;
}

Bun.serve({
  port,
  async fetch(req) {
    const { pathname } = new URL(req.url);

    // Reject traversal before touching the filesystem: normalize resolves any
    // ".." segments, so anything still escaping BUILD_DIR is not ours to serve.
    const target = normalize(join(BUILD_DIR, decodeURIComponent(pathname)));
    if (!target.startsWith(BUILD_DIR)) {
      return new Response('not found', { status: 404 });
    }

    const hit = await firstExisting([
      ...(pathname.endsWith('/') ? [] : [target, `${target}.html`]),
      join(target, 'index.html'),
    ]);
    if (hit) return hit;

    const notFound = Bun.file(join(BUILD_DIR, '404.html'));
    return (await notFound.exists())
      ? new Response(notFound, { status: 404 })
      : new Response('not found', { status: 404 });
  },
});

console.log(`gitq docs on http://localhost:${port}`);
