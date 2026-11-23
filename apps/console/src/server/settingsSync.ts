import {
  isLocalRequest,
  type LocalServer,
} from '@mattstack/app-server/local-request';
import { listOrgs } from '@mattstack/rt-client';
import { Hono } from 'hono';

import {
  orgSyncOf,
  type OrgSync,
  type TeamStatusJson,
} from '../shared/settings-sync';
import {
  runRt as liveRunRt,
  READ_TIMEOUT_MS,
  RtNotFoundError,
  type RunRt,
} from './rt-bin';

const FIXTURE_READ_ONLY = 'the design fixture is read-only';
const BUSY = 'A push for this org is still running';
/** `rt team push` waits on the daemon's own fetch, rebase and push, up to its 180s client timeout. */
const PUSH_TIMEOUT_MS = 190_000;

interface SyncDeps {
  runRt?: RunRt;
  orgs?: () => string[];
  fixture?: OrgSync[] | null;
}

function parseJson(stdout: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(stdout.trim());
    return value !== null && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function readStatus(
  org: string,
  runRt: RunRt
): Promise<TeamStatusJson | null> {
  try {
    const { code, stdout } = await runRt(
      ['team', 'status', '--team', org, '--json'],
      {
        timeoutMs: READ_TIMEOUT_MS,
      }
    );
    const payload = parseJson(stdout);
    if (code !== 0 || payload === null || 'error' in payload) return null;
    return payload as unknown as TeamStatusJson;
  } catch {
    return null;
  }
}

export function syncRoutes({
  runRt = liveRunRt,
  orgs = () => listOrgs(),
  fixture = null,
}: SyncDeps = {}) {
  const pushing = new Set<string>();
  return new Hono()
    .get('/api/settings/sync', async c => {
      if (fixture) return c.json({ orgs: fixture }, 200);
      const now = Date.now();
      const synced = await Promise.all(
        orgs().map(async org =>
          orgSyncOf(org, await readStatus(org, runRt), now)
        )
      );
      return c.json({ orgs: synced }, 200);
    })
    .post('/api/settings/sync/push', async c => {
      if (fixture) return c.json({ error: FIXTURE_READ_ONLY }, 403);
      if (!isLocalRequest(c.req.raw, c.env as LocalServer | undefined)) {
        return c.json({ error: 'forbidden' }, 403);
      }
      const body = (await c.req.json().catch(() => null)) as {
        org?: unknown;
      } | null;
      const org = body?.org;
      if (typeof org !== 'string' || !orgs().includes(org)) {
        return c.json({ error: 'unknown org' }, 400);
      }
      if (pushing.has(org)) return c.json({ error: BUSY }, 409);
      pushing.add(org);
      try {
        const { code, stdout, stderr } = await runRt(
          ['team', 'push', '--team', org, '--json'],
          { timeoutMs: PUSH_TIMEOUT_MS }
        );
        const payload = parseJson(stdout);
        const error = payload?.error as
          { code?: unknown; message?: unknown } | undefined;
        if (code !== 0 || payload === null || error) {
          const message =
            typeof error?.message === 'string' && error.message.trim()
              ? error.message.trim()
              : stderr.trim() || 'rt team push failed';
          return c.json(
            {
              error: message,
              ...(typeof error?.code === 'string' ? { code: error.code } : {}),
            },
            409
          );
        }
        const {
          committed,
          pushed,
          error: pushError,
          skipped,
        } = payload as {
          committed: boolean;
          pushed: boolean;
          error: string | null;
          skipped: string | null;
        };
        return c.json(
          {
            ok: true as const,
            result: { committed, pushed, error: pushError, skipped },
          },
          200
        );
      } catch (err) {
        if (err instanceof RtNotFoundError)
          return c.json({ error: err.message }, 503);
        return c.json({ error: (err as Error).message }, 502);
      } finally {
        pushing.delete(org);
      }
    });
}
