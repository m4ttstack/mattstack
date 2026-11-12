import {
  isLocalRequest,
  type LocalServer,
} from '@mattstack/app-server/local-request';
import { listOrgs } from '@mattstack/rt-client';
import { Hono } from 'hono';

import {
  ADMIN_SECRETS_STATES,
  MEMBER_ROLES,
  type AdminSecretsUpdate,
  type AdminSecretsView,
  type ConfirmResult,
  type TeamInvite,
  type TeamMember,
  type TeamRead,
} from '../shared/team';
import {
  runRt as liveRunRt,
  READ_TIMEOUT_MS,
  RtNotFoundError,
  WRITE_TIMEOUT_MS,
  type RunRt,
} from './rt-bin';

const FIXTURE_READ_ONLY = 'the design fixture is read-only';
const BUSY = 'Another change to this team is still running';

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

/** With --json rt writes a failure as `{error: {code, message}}` on stdout and nothing on stderr. */
function failureMessage(
  payload: Record<string, unknown> | null,
  stderr: string,
  fallback: string
): string {
  const err = payload?.error;
  const message =
    err !== null && typeof err === 'object'
      ? (err as { message?: unknown }).message
      : err;
  if (typeof message === 'string' && message.trim()) return message.trim();
  return stderr.trim() || fallback;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

function asAdminSecrets(value: unknown): AdminSecretsView | null {
  const row = value as { state?: unknown; detail?: unknown } | null;
  const state = ADMIN_SECRETS_STATES.find(s => s === row?.state);
  if (!state) return null;
  return {
    state,
    detail: typeof row?.detail === 'string' ? row.detail : null,
  };
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
        error: failureMessage(payload, stderr, 'rt team status failed'),
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
      const role = MEMBER_ROLES.find(r => r === row.role);
      return [
        {
          username: row.username,
          ...(role ? { role } : {}),
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
        activeTeam:
          typeof payload.activeTeam === 'string' ? payload.activeTeam : null,
        relayFailed: payload.relayFailed === true,
        members,
        invites,
        adminSecrets: asAdminSecrets(payload.adminSecrets),
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
  // Lazy: routes.ts builds this at import, where a suite's rt-client mock may lack listOrgs.
  orgs = () => listOrgs(),
  fixture = null,
}: TeamDeps = {}) {
  // Both writes rewrite the org's .sops.yaml and re-encrypt its admin files,
  // and rt holds no lock of its own across them.
  const writing = new Set<string>();
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
      let held = false;
      try {
        if (typeof slug !== 'string' || !orgs().includes(slug)) {
          return c.json({ error: 'unknown team' }, 400);
        }
        if (writing.has(slug)) return c.json({ error: BUSY }, 409);
        writing.add(slug);
        held = true;
        const { code, stdout, stderr } = await runRt(
          ['team', 'members', 'sync', '--team', slug, '--json'],
          { timeoutMs: WRITE_TIMEOUT_MS }
        );
        const payload = parseJson(stdout);
        if (code !== 0 || payload === null) {
          return c.json(
            {
              error: failureMessage(
                payload,
                stderr,
                'rt team members sync failed'
              ),
            },
            502
          );
        }
        const result: ConfirmResult = {
          added: asStrings(payload.addedHandles),
          pending: asStrings(payload.pending),
          warnings: stderr
            .replace(ANSI, '')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line !== ''),
        };
        return c.json(result, 200);
      } catch (err) {
        if (err instanceof RtNotFoundError) {
          return c.json({ error: err.message }, 503);
        }
        return c.json({ error: (err as Error).message }, 502);
      } finally {
        if (held) writing.delete(slug as string);
      }
    })
    .post('/api/team/admin-secrets', async c => {
      if (fixture) return c.json({ error: FIXTURE_READ_ONLY }, 403);
      if (!isLocalRequest(c.req.raw, c.env as LocalServer | undefined)) {
        return c.json({ error: 'forbidden' }, 403);
      }
      const body = (await c.req.json().catch(() => null)) as {
        slug?: unknown;
      } | null;
      const slug = body?.slug;
      let held = false;
      try {
        if (typeof slug !== 'string' || !orgs().includes(slug)) {
          return c.json({ error: 'unknown team' }, 400);
        }
        if (writing.has(slug)) return c.json({ error: BUSY }, 409);
        writing.add(slug);
        held = true;
        const { code, stdout, stderr } = await runRt(
          ['team', 'admin-secrets', '--team', slug, '--json'],
          { timeoutMs: WRITE_TIMEOUT_MS }
        );
        const payload = parseJson(stdout);
        if (code !== 0 || payload === null) {
          return c.json(
            {
              error: failureMessage(
                payload,
                stderr,
                'rt team admin-secrets failed'
              ),
            },
            502
          );
        }
        const state = payload.state;
        const result: AdminSecretsUpdate = {
          state: state === 'unused' || state === 'current' ? state : 'updated',
          holders: asStrings(payload.holders),
          withoutKey: asStrings(payload.withoutKey),
          removed: asStrings(payload.removed).length,
          token: typeof payload.token === 'string' ? payload.token : 'none',
        };
        return c.json(result, 200);
      } catch (err) {
        if (err instanceof RtNotFoundError) {
          return c.json({ error: err.message }, 503);
        }
        return c.json({ error: (err as Error).message }, 502);
      } finally {
        if (held) writing.delete(slug as string);
      }
    });
}
