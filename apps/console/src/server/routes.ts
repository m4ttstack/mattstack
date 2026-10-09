import { Hono } from 'hono';

import { agentModels } from './agent-models';
import { mountEffectiveInputs } from './effectiveInputs';
import { enrichRoutes } from './enrich';
import { fixtureMode, fixtureRt } from './fixtures/design/fixtureRt';
import { runsFixture } from './fixtures/design/runsFixture';
import { gatesRoutes } from './gates';
import { panesRoutes } from './panes';
import { runsRoutes } from './runs';
import { settings } from './settings';
import { mountSkills } from './skills';

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
  .use('/embed/*', async (c, next) => {
    await next();
    c.header('Content-Security-Policy', EMBED_FRAME_ANCESTORS);
  })
  .route('/', runsRoutes(runsData))
  .route('/', enrichRoutes(runsData))
  .route('/', panesRoutes(runsData))
  .route('/', gatesRoutes(runsData))
  .route('/', settings)
  .route('/', agentModels)
  .route(
    '/',
    mountSkills(
      new Hono(),
      fixture?.runRt,
      fixture?.runGit,
      fixture?.readPackFile,
      fixture?.realpath
    )
  )
  .route('/', mountEffectiveInputs(new Hono(), undefined, undefined, runsData));

export type AppType = typeof routes;
