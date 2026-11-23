import {
  hasLocalOrigin,
  isLocalRequest,
  type LocalServer,
} from '@mattstack/app-server/local-request';
import { Hono } from 'hono';

import { agentModels } from './agent-models';
import { mountEffectiveInputs } from './effectiveInputs';
import { enrichRoutes } from './enrich';
import { fixtureMode, fixtureRt } from './fixtures/design/fixtureRt';
import { runsFixture } from './fixtures/design/runsFixture';
import { syncFixture, syncScenario } from './fixtures/design/syncFixture';
import { teamFixture } from './fixtures/design/teamFixture';
import { gatesRoutes } from './gates';
import { panesRoutes } from './panes';
import { runsRoutes } from './runs';
import { settings } from './settings';
import { syncRoutes } from './settingsSync';
import { mountSkills } from './skills';
import { teamRoutes } from './team';
import { usageRoutes } from './usage';

// The embed page writes settings, so only the suite's own pages may frame it.
export const EMBED_FRAME_ANCESTORS =
  "frame-ancestors 'self' https://*.mattstack http://*.mattstack https://*.localhost http://*.localhost http://localhost:* http://127.0.0.1:*";

const scenario = fixtureMode(process.env);
const fixture = scenario ? fixtureRt(scenario) : null;
const runsData = scenario ? runsFixture(scenario) : null;

/**
 * Routes are CHAINED and handlers INLINE, both load-bearing for Hono's RPC
 * inference: a handler lifted into a named function loses path-param typing,
 * and an unchained `app.get(...)` never reaches `typeof routes`.
 */
export const routes = new Hono()
  // Every API write acts on this Mac (a run, a pane, a pack, a setting), so
  // none answers a request from a public edge or from another site's page;
  // a route may still add a stricter check of its own.
  .use('/api/*', async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
    const req = c.req.raw;
    if (
      !isLocalRequest(req, c.env as LocalServer | undefined) ||
      !hasLocalOrigin(req)
    )
      return c.json({ error: 'forbidden' }, 403);
    return next();
  })
  .use('/embed/*', async (c, next) => {
    await next();
    c.header('Content-Security-Policy', EMBED_FRAME_ANCESTORS);
  })
  .route('/', runsRoutes(runsData))
  .route('/', enrichRoutes(runsData))
  .route('/', panesRoutes(runsData))
  .route('/', gatesRoutes(runsData))
  .route('/', usageRoutes(runsData))
  .route('/', teamRoutes({ fixture: scenario ? teamFixture : null }))
  .route(
    '/',
    syncRoutes({
      fixture: scenario
        ? syncFixture(
            syncScenario(process.env),
            process.env.CONSOLE_FIXTURE_SYNC_ORG,
            process.env.CONSOLE_FIXTURE_SYNC_TEAM
          )
        : null,
    })
  )
  .route('/', settings)
  .route('/', agentModels)
  .route(
    '/',
    mountSkills(
      new Hono(),
      fixture?.runRt,
      fixture?.runGit,
      fixture?.readPackFile,
      fixture?.realpath,
      fixture?.skillsDir
    )
  )
  .route('/', mountEffectiveInputs(new Hono(), undefined, undefined, runsData));

export type AppType = typeof routes;
