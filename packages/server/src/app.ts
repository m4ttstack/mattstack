import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { daemonHealth, getSetting, setSetting } from '@mattstack/rt-client';
import { canonicalHostRedirect } from './canonical-host';
import {
  hasLocalOrigin,
  isLocalRequest,
  type LocalServer,
} from './local-request';
import { shellHandoff as defaultShellHandoff } from './shell-handoff';

const SCHEME_KEY = 'mattstack.colorScheme';
const SCHEMES = ['auto', 'light', 'dark'] as const;
type Scheme = (typeof SCHEMES)[number];
const isScheme = (v: unknown): v is Scheme =>
  typeof v === 'string' && (SCHEMES as readonly string[]).includes(v);

export interface CreateAppOptions {
  name: string;
  version: string;
  /** The app's own Hono chain; `typeof routes` stays the RPC AppType. */
  routes: Hono;
  /** Test seam; production always uses the real helper. */
  shellHandoff?: (req: Request) => Promise<Response | null>;
}

/**
 * The JSON floor under every failure and every miss: an RPC client checks
 * `res.ok` then parses JSON, so a text/plain 500 or an HTML 404 makes it
 * throw on the parse instead of surfacing the real error.
 */
export function createApp({
  name,
  version,
  routes,
  shellHandoff = defaultShellHandoff,
}: CreateAppOptions): Hono {
  const app = new Hono()
    .use(async (c, next) => {
      const redirect = canonicalHostRedirect(c.req.raw);
      if (redirect) return redirect;
      const handoff = await shellHandoff(c.req.raw);
      if (handoff) return handoff;
      await next();
    })
    .get('/api/health', c => c.json({ ok: true, name, version }, 200))
    .get('/api/daemon', async c =>
      c.json(await daemonHealth({ sockPath: process.env.RT_SOCK_PATH }), 200)
    )
    // One light / dark / auto choice for every mattstack app on this Mac.
    .get('/api/color-scheme', c =>
      c.json({ scheme: getSetting<Scheme>(SCHEME_KEY).value }, 200)
    )
    .put('/api/color-scheme', async c => {
      const req = c.req.raw;
      // Bun.serve hands Hono its server as the env; tests have none.
      const env = c.env as Partial<LocalServer> | undefined;
      const server = env?.requestIP ? (env as LocalServer) : undefined;
      if (!isLocalRequest(req, server) || !hasLocalOrigin(req))
        return c.json({ error: 'local requests only' }, 403);
      const body = (await c.req.json().catch(() => ({}))) as {
        scheme?: unknown;
      };
      if (!isScheme(body.scheme))
        return c.json({ error: 'scheme must be auto, light or dark' }, 400);
      setSetting(SCHEME_KEY, body.scheme, 'machine');
      return c.json({ scheme: body.scheme }, 200);
    })
    .route('/', routes);

  app.notFound(c => c.json({ error: 'not found' }, 404));
  app.onError((err, c) => {
    const status = err instanceof HTTPException ? err.status : 500;
    if (status >= 500) console.error(err);
    return c.json({ error: err.message }, status);
  });
  return app;
}
