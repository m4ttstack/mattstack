import { chat } from './chat';
import { panes } from './panes';
import { viewer } from './viewer';

/**
 * chat's own routes, composed for `serveMattstackApp`. `/api/health` and
 * `/api/daemon` come from the package's `createApp`, not from here.
 */
export const routes = chat.route('/', panes).route('/', viewer);
export type AppType = typeof routes;
