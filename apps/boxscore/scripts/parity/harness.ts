/**
 * Local helper for run.js. The browser_run_code_unsafe sandbox has no fs, so
 * run.js fetches its per-board config here and PUTs every output file back.
 *
 *   bun scripts/parity/harness.ts
 *
 * GET /config?slug=<slug>&scheme=<dark|light>  run config for one board
 * PUT /out/<file>                              write <file> under OUTPUT_DIR
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  APP_NAME_ATTR,
  boardBySlug,
  DESIGN_NAME_ATTR,
  targetsOf,
  VIEWPORT_WIDTH,
} from './boards';
import { OUTPUT_DIR } from './compare';

export const HARNESS_PORT = Number(process.env.PARITY_HARNESS_PORT ?? 11096);
export const APP_ORIGIN =
  process.env.PARITY_APP_ORIGIN ?? 'http://localhost:5305';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');
const DESIGN_DIR = join(REPO_ROOT, 'docs/apps/design/boxscore/parity');
const COLLECT_PATH = join(import.meta.dir, 'collect.js');
const OUT_NAME = /^[\w.-]+\.(json|png)$/;

function config(slug: string, scheme: string) {
  if (scheme !== 'dark' && scheme !== 'light') {
    throw new Error(`scheme must be dark or light, got "${scheme}"`);
  }
  const board = boardBySlug(slug);
  return {
    ...board,
    scheme,
    width: VIEWPORT_WIDTH,
    designUrl: pathToFileURL(join(DESIGN_DIR, `${slug}.${scheme}.html`)).href,
    designAttr: DESIGN_NAME_ATTR,
    appAttr: APP_NAME_ATTR,
    appOrigin: APP_ORIGIN,
    targets: targetsOf(board),
    collectSource: readFileSync(COLLECT_PATH, 'utf8'),
    outDir: OUTPUT_DIR,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

if (import.meta.main) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const server = Bun.serve({
    port: HARNESS_PORT,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url);
      try {
        if (req.method === 'GET' && url.pathname === '/config') {
          return json(
            config(
              url.searchParams.get('slug') ?? '',
              url.searchParams.get('scheme') ?? ''
            )
          );
        }
        if (req.method === 'PUT' && url.pathname.startsWith('/out/')) {
          const name = decodeURIComponent(url.pathname.slice('/out/'.length));
          if (!OUT_NAME.test(name))
            return json({ error: `bad file name: ${name}` }, 400);
          const body = await req.text();
          const path = join(OUTPUT_DIR, name);
          // run.js sends PNGs as base64 text: its sandbox has no Buffer global to build a byte body.
          writeFileSync(
            path,
            name.endsWith('.png') ? Buffer.from(body, 'base64') : body
          );
          return json({ path });
        }
        return json({ error: 'not found' }, 404);
      } catch (err) {
        return json(
          { error: err instanceof Error ? err.message : String(err) },
          400
        );
      }
    },
  });
  console.log(
    `parity harness on http://127.0.0.1:${server.port}, writing ${OUTPUT_DIR}`
  );
}
