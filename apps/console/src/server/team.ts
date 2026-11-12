import {
  isLocalRequest,
  type LocalServer,
} from '@mattstack/app-server/local-request';
import { listOrgs } from '@mattstack/rt-client';
import { Hono } from 'hono';

import type { TeamInvite, TeamMember, TeamRead } from '../shared/team';
import {
  runRt as liveRunRt,
  READ_TIMEOUT_MS,
  RtNotFoundError,
  WRITE_TIMEOUT_MS,
  type RunRt,
} from './rt-bin';

const FIXTURE_READ_ONLY = 'the design fixture is read-only';

interface TeamDeps {
  runRt?: RunRt;
  orgs?: () => string[];
  fixture?: TeamRead[] | null;
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

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

async function readOrg(slug: string, runRt: RunRt): Promise<TeamRead> {
  try {
    const { code, stdout, stderr } = await runRt(
      ['team', 'status', '--team', slug, '--json'],
      { timeoutMs: READ_TIMEOUT_MS }
    );
    const payload = parseJson(stdout);
    if (code !== 0) {
      return {
        slug,
        ok: false,
        error: stderr.trim() || 'rt team status failed',
      };
    }
    if (payload === null) {
      return { slug, ok: false, error: 'rt produced no readable output' };
    }
    if (payload.mode === 'solo') {
      return { slug, ok: false, error: 'this Mac has no team for that org' };
    }
    const members: TeamMember[] = (
      Array.isArray(payload.members) ? payload.members : []
    ).flatMap((m: unknown) => {
      const row = m as { username?: unknown; role?: unknown; peered?: unknown };
      if (typeof row?.username !== 'string') return [];
      return [
        {
          username: row.username,
          ...(typeof row.role === 'string' ? { role: row.role } : {}),
          peered: typeof row.peered === 'boolean' ? row.peered : null,
        },
      ];
    });
    const invites: TeamInvite[] = (
      Array.isArray(payload.invites) ? payload.invites : []
    ).flatMap((i: unknown) => {
      const row = i as Partial<TeamInvite> | null;
      if (
        typeof row?.handle !== 'string' ||
        typeof row.expiresAt !== 'string' ||
        (row.state !== 'invited' &&
          row.state !== 'replied' &&
          row.state !== 'expired')
      ) {
        return [];
      }
      return [
        {
          handle: row.handle,
          teams: asStrings(row.teams),
          expiresAt: row.expiresAt,
          state: row.state,
        },
      ];
    });
    return {
      slug,
      ok: true,
      team: {
        slug,
        name: typeof payload.name === 'string' ? payload.name : slug,
        role: typeof payload.role === 'string' ? payload.role : null,
        members,
        invites,
      },
    };
  } catch (err) {
    if (err instanceof RtNotFoundError) throw err;
    return { slug, ok: false, error: (err as Error).message };
  }
}

/** Never cached: the page polls and must see a confirm at once. */
export function teamRoutes({
  runRt = liveRunRt,
  orgs = listOrgs,
  fixture = null,
}: TeamDeps = {}) {
  return new Hono()
    .get('/api/team', async c => {
      if (fixture) return c.json({ teams: fixture }, 200);
      try {
        const teams = await Promise.all(
          orgs().map(slug => readOrg(slug, runRt))
        );
        return c.json({ teams }, 200);
      } catch (err) {
        if (err instanceof RtNotFoundError) {
          return c.json({ error: err.message }, 503);
        }
        return c.json({ error: (err as Error).message }, 502);
      }
    })
    .post('/api/team/confirm', async c => {
      if (fixture) return c.json({ error: FIXTURE_READ_ONLY }, 403);
      if (!isLocalRequest(c.req.raw, c.env as LocalServer | undefined)) {
        return c.json({ error: 'forbidden' }, 403);
      }
      const body = (await c.req.json().catch(() => null)) as {
        slug?: unknown;
      } | null;
      const slug = body?.slug;
      if (typeof slug !== 'string' || !orgs().includes(slug)) {
        return c.json({ error: 'unknown team' }, 400);
      }
      try {
        const { code, stdout, stderr } = await runRt(
          ['team', 'members', 'sync', '--team', slug, '--json'],
          { timeoutMs: WRITE_TIMEOUT_MS }
        );
        const payload = parseJson(stdout);
        if (code !== 0 || payload === null) {
          const detail =
            typeof payload?.error === 'string' ? payload.error : '';
          return c.json(
            { error: stderr.trim() || detail || 'rt team members sync failed' },
            502
          );
        }
        return c.json(
          {
            added: asStrings(payload.addedHandles),
            pending: asStrings(payload.pending),
          },
          200
        );
      } catch (err) {
        if (err instanceof RtNotFoundError) {
          return c.json({ error: err.message }, 503);
        }
        return c.json({ error: (err as Error).message }, 502);
      }
    });
}
