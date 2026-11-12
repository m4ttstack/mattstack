import { describe, expect, it, vi, type Mock } from 'vitest';

import type { TeamRead } from '../shared/team';
import {
  READ_TIMEOUT_MS,
  RtNotFoundError,
  WRITE_TIMEOUT_MS,
  type RunRt,
} from './rt-bin';
import { teamRoutes } from './team';

const status = (slug: string) => ({
  contract: 1,
  slug,
  name: `${slug} Co`,
  role: 'admin',
  members: [
    { username: 'matt', role: 'owner', peered: true },
    { username: 'bo', peered: null },
  ],
  invites: [
    {
      handle: 'alice',
      teams: ['dev'],
      expiresAt: '2026-12-01T00:00:00.000Z',
      state: 'replied',
    },
  ],
});

const ok = (body: unknown) => ({
  code: 0,
  stdout: JSON.stringify(body),
  stderr: '',
});

function app(
  runRt: Mock<RunRt>,
  orgs: string[] = ['acme', 'beta'],
  fixture: TeamRead[] | null = null
) {
  return teamRoutes({ runRt, orgs: () => orgs, fixture });
}

describe('GET /api/team', () => {
  it('lists every org with --team', async () => {
    const runRt = vi.fn<RunRt>(async argv => ok(status(argv[3]!)));
    const res = await app(runRt).request('/api/team');
    const body = (await res.json()) as { teams: TeamRead[] };
    expect(res.status).toBe(200);
    expect(runRt.mock.calls.map(c => c[0])).toEqual([
      ['team', 'status', '--team', 'acme', '--json'],
      ['team', 'status', '--team', 'beta', '--json'],
    ]);
    expect(runRt.mock.calls[0]![1]).toEqual({ timeoutMs: READ_TIMEOUT_MS });
    expect(body.teams.map(t => t.ok)).toEqual([true, true]);
    const first = body.teams[0]!;
    if (!first.ok) throw new Error('expected ok');
    expect(first.team).toEqual({
      slug: 'acme',
      name: 'acme Co',
      role: 'admin',
      members: [
        { username: 'matt', role: 'owner', peered: true },
        { username: 'bo', peered: null },
      ],
      invites: status('acme').invites,
    });
  });

  it('keeps the other orgs when one fails', async () => {
    const runRt = vi.fn(async (argv: string[]) =>
      argv[3] === 'acme'
        ? {
            code: 2,
            stdout: JSON.stringify({
              error: { code: 'no-team', message: 'switchboard down' },
            }),
            stderr: '',
          }
        : ok(status('beta'))
    );
    const body = (await (await app(runRt).request('/api/team')).json()) as {
      teams: TeamRead[];
    };
    expect(body.teams[0]).toEqual({
      slug: 'acme',
      ok: false,
      error: 'switchboard down',
    });
    expect(body.teams[1]!.ok).toBe(true);
  });

  it('reads a solo or unparseable answer as a failed org', async () => {
    const runRt = vi.fn(async (argv: string[]) =>
      argv[3] === 'acme'
        ? ok({ mode: 'solo', invites: [] })
        : { code: 0, stdout: 'not json', stderr: '' }
    );
    const body = (await (await app(runRt).request('/api/team')).json()) as {
      teams: TeamRead[];
    };
    expect(body.teams).toEqual([
      {
        slug: 'acme',
        ok: false,
        error: 'this Mac has no team for that org',
      },
      { slug: 'beta', ok: false, error: 'rt produced no readable output' },
    ]);
  });

  it('gives an empty list with no orgs', async () => {
    const runRt = vi.fn();
    const res = await app(runRt, []).request('/api/team');
    expect(await res.json()).toEqual({ teams: [] });
    expect(runRt).not.toHaveBeenCalled();
  });

  it('answers 503 when rt is missing', async () => {
    const runRt = vi.fn(async () => {
      throw new RtNotFoundError(['/x/rt']);
    });
    const res = await app(runRt).request('/api/team');
    expect(res.status).toBe(503);
  });
});

describe('POST /api/team/confirm', () => {
  const post = (a: ReturnType<typeof app>, body: unknown) =>
    a.request('http://localhost/api/team/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'localhost' },
      body: JSON.stringify(body),
    });

  it('runs members sync for the slug', async () => {
    const runRt = vi.fn(async () =>
      ok({
        contract: 1,
        added: ['age1xyz'],
        addedHandles: ['alice'],
        pending: ['bob'],
        reencrypted: [],
      })
    );
    const res = await post(app(runRt), { slug: 'acme' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      added: ['alice'],
      pending: ['bob'],
      warnings: [],
    });
    expect(runRt).toHaveBeenCalledWith(
      ['team', 'members', 'sync', '--team', 'acme', '--json'],
      { timeoutMs: WRITE_TIMEOUT_MS }
    );
  });

  it("surfaces the sync's failure envelope from stdout", async () => {
    const runRt = vi.fn(async () => ({
      code: 2,
      stdout: JSON.stringify({
        error: { code: 'members-error', message: 'keychain locked' },
      }),
      stderr: '',
    }));
    const res = await post(app(runRt), { slug: 'acme' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'keychain locked' });
  });

  it('falls back to stderr when stdout has no envelope', async () => {
    const runRt = vi.fn(async () => ({
      code: 1,
      stdout: '',
      stderr: 'boom\n',
    }));
    const res = await post(app(runRt), { slug: 'acme' });
    expect(await res.json()).toEqual({ error: 'boom' });
  });

  it('passes rt warnings through when nobody was added', async () => {
    const runRt = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({
        addedHandles: [],
        added: [],
        pending: ['alice'],
        reencrypted: [],
      }),
      stderr: '\u001b[33mThe reply from alice could not be used\u001b[0m\n\n',
    }));
    const res = await post(app(runRt), { slug: 'acme' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      added: [],
      pending: ['alice'],
      warnings: ['The reply from alice could not be used'],
    });
  });

  it('refuses a non-local request', async () => {
    const runRt = vi.fn();
    const res = await app(runRt).request(
      'http://evil.example/api/team/confirm',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'evil.example' },
        body: JSON.stringify({ slug: 'acme' }),
      }
    );
    expect(res.status).toBe(403);
    expect(runRt).not.toHaveBeenCalled();
  });

  it('answers 502 when listing orgs throws', async () => {
    const res = await teamRoutes({
      runRt: vi.fn(),
      orgs: () => {
        throw new Error('orgs unreadable');
      },
    }).request('http://localhost/api/team/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'localhost' },
      body: JSON.stringify({ slug: 'acme' }),
    });
    expect(res.status).toBe(502);
  });

  it('rejects an unknown slug without running rt', async () => {
    const runRt = vi.fn();
    const res = await post(app(runRt), { slug: 'evil' });
    expect(res.status).toBe(400);
    expect(runRt).not.toHaveBeenCalled();
  });

  it('answers 503 when rt is missing', async () => {
    const runRt = vi.fn(async () => {
      throw new RtNotFoundError(['/x/rt']);
    });
    expect((await post(app(runRt), { slug: 'acme' })).status).toBe(503);
  });

  it('answers reads from the fixture and refuses confirm', async () => {
    const runRt = vi.fn();
    const fixture: TeamRead[] = [{ slug: 'acme', ok: false, error: 'x' }];
    const a = app(runRt, ['acme'], fixture);
    expect(await (await a.request('/api/team')).json()).toEqual({
      teams: fixture,
    });
    expect((await post(a, { slug: 'acme' })).status).toBe(403);
    expect(runRt).not.toHaveBeenCalled();
  });
});
