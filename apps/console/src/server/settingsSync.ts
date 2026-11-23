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

/** Bun's server, as Hono passes it in `c.env`; 0 seconds lifts the idle timeout for one request. */
interface BunTimeout {
  timeout?: (req: Request, seconds: number) => void;
}
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
      ['team', 'status', '--team', org, '--sync', '--json'],
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

type PushOutcome =
  | {
      status: 200;
      body: {
        ok: true;
        result: {
          committed: boolean;
          pushed: boolean;
          error: string | null;
          skipped: string | null;
        };
      };
    }
  | { status: 409 | 502 | 503; body: { error: string; code?: string } };

async function runPush(org: string, runRt: RunRt): Promise<PushOutcome> {
  try {
    const { code, stdout, stderr } = await runRt(
      ['team', 'push', '--team', org, '--json'],
      {
        timeoutMs: PUSH_TIMEOUT_MS,
      }
    );
    const payload = parseJson(stdout);
    const error = payload?.error as
      { code?: unknown; message?: unknown } | undefined;
    if (code !== 0 || payload === null || error) {
      const message =
        typeof error?.message === 'string' && error.message.trim()
          ? error.message.trim()
          : stderr.trim() || 'rt team push failed';
      return {
        status: 409,
        body: {
          error: message,
          ...(typeof error?.code === 'string' ? { code: error.code } : {}),
        },
      };
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
    return {
      status: 200,
      body: {
        ok: true,
        result: { committed, pushed, error: pushError, skipped },
      },
    };
  } catch (err) {
    if (err instanceof RtNotFoundError)
      return { status: 503, body: { error: err.message } };
    return { status: 502, body: { error: (err as Error).message } };
  }
}

export function syncRoutes({
  runRt = liveRunRt,
  orgs = () => listOrgs(),
  fixture = null,
}: SyncDeps = {}) {
  const running = new Map<string, Promise<PushOutcome>>();
  const trailing = new Map<string, Promise<PushOutcome>>();

  const startPush = (org: string): Promise<PushOutcome> => {
    const p = runPush(org, runRt).finally(() => {
      if (running.get(org) === p) running.delete(org);
    });
    running.set(org, p);
    return p;
  };

  // Saves close together share one round: a push asked for while one runs
  // waits for it, then every such caller shares one trailing push, which takes
  // what the running round did not.
  const pushOrg = (org: string): Promise<PushOutcome> => {
    const current = running.get(org);
    if (!current) return startPush(org);
    let next = trailing.get(org);
    if (!next) {
      next = current.then(() => {
        trailing.delete(org);
        return startPush(org);
      });
      trailing.set(org, next);
    }
    return next;
  };

  return new Hono()
    .get('/api/settings/sync', async c => {
      if (fixture) return c.json({ orgs: fixture }, 200);
      // rt team status can outlast Bun.serve's 10s idle timeout on a busy Mac.
      (c.env as BunTimeout | undefined)?.timeout?.(c.req.raw, 0);
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
      // A push here can wait out a running push and then its own round, up to
      // twice rt's 190s, past the server's 255s idle timeout.
      (c.env as BunTimeout | undefined)?.timeout?.(c.req.raw, 0);
      const { status, body: reply } = await pushOrg(org);
      return c.json(reply, status);
    });
}
