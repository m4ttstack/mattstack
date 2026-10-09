/**
 * Local helper for run.js. The browser_run_code_unsafe sandbox has no fs, so
 * run.js fetches its per-board config here and PUTs every output file back.
 * An app's `scripts/parity/harness.ts` exports a `ParityApp` and, when run
 * directly, calls `startHarness` with it.
 *
 * GET /config?slug=<slug>&scheme=<dark|light>[&panel=<label>]  run config for one board (or one of its panels)
 * PUT /out/<file>                              write <file> under the app's output dir
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  APP_NAME_ATTR,
  boardBySlug,
  DESIGN_NAME_ATTR,
  outputDirOf,
  targetsOf,
  VIEWPORT_WIDTH,
  type ParityApp,
} from './config';
import { hugWidthPaths, readPen } from './pen';

const COLLECT_PATH = join(import.meta.dirname, 'collect.js');
const OUT_NAME = /^[\w.-]+\.(json|png)$/;

export function harnessConfig(
  app: ParityApp,
  slug: string,
  scheme: string,
  panel?: string
) {
  if (scheme !== 'dark' && scheme !== 'light') {
    throw new Error(`scheme must be dark or light, got "${scheme}"`);
  }
  const board = boardBySlug(app.boards, slug);
  const pen = readPen(board.penPath ?? app.penPath);
  return {
    ...board,
    scheme,
    width: app.viewportWidth ?? VIEWPORT_WIDTH,
    designUrl: pathToFileURL(join(app.designDir, `${slug}.${scheme}.html`))
      .href,
    designAttr: DESIGN_NAME_ATTR,
    appAttr: APP_NAME_ATTR,
    appOrigin: app.appOrigin,
    targets: targetsOf(board, panel).map(t => ({
      ...t,
      hugWidths: hugWidthPaths(pen, t.root, board.frame),
    })),
    collectSource: readFileSync(COLLECT_PATH, 'utf8'),
    outDir: outputDirOf(app),
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export function harnessHandler(app: ParityApp) {
  const outDir = outputDirOf(app);
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    try {
      if (req.method === 'GET' && url.pathname === '/config') {
        return json(
          harnessConfig(
            app,
            url.searchParams.get('slug') ?? '',
            url.searchParams.get('scheme') ?? '',
            url.searchParams.get('panel') ?? undefined
          )
        );
      }
      if (req.method === 'PUT' && url.pathname.startsWith('/out/')) {
        const name = decodeURIComponent(url.pathname.slice('/out/'.length));
        if (!OUT_NAME.test(name))
          return json({ error: `bad file name: ${name}` }, 400);
        const body = await req.text();
        const path = join(outDir, name);
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
  };
}

export function startHarness(app: ParityApp) {
  const resolved: ParityApp = {
    ...app,
    appOrigin: process.env.PARITY_APP_ORIGIN ?? app.appOrigin,
  };
  const outDir = outputDirOf(resolved);
  mkdirSync(outDir, { recursive: true });
  const server = Bun.serve({
    port: Number(process.env.PARITY_HARNESS_PORT ?? app.harnessPort),
    hostname: '127.0.0.1',
    fetch: harnessHandler(resolved),
  });
  console.log(
    `parity harness on http://127.0.0.1:${server.port}, writing ${outDir}`
  );
  return server;
}
