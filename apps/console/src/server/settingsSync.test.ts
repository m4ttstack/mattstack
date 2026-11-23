import { describe, expect, it, vi, type Mock } from 'vitest';

import type { OrgSync } from '../shared/settings-sync';
import { READ_TIMEOUT_MS, RtNotFoundError, type RunRt } from './rt-bin';
import { syncRoutes } from './settingsSync';

const ok = (body: unknown) => ({
  code: 0,
  stdout: JSON.stringify(body),
  stderr: '',
});

const teamStatus = (slug: string, over: Record<string, unknown> = {}) => ({
  contract: 1,
  slug,
  branch: 'mattstack',
  trial: false,
  lastPull: new Date().toISOString(),
  lastPushAt: '2026-11-23T11:50:00.000Z',
  conflicted: null,
  pullOnly: false,
  heldBack: [],
  pending: [{ store: 'team:web', key: 'board.slack', change: 'changed' }],
  lastPushError: null,
  lastCommitError: null,
  lastPullError: null,
  layoutHold: false,
  unownedDirty: ['mattstack/org/settings.org.jsonc'],
  pullIntervalSec: 300,
  ...over,
});

function app(
  runRt: Mock<RunRt>,
  orgs: string[] = ['acme', 'beta'],
  fixture: OrgSync[] | null = null
) {
  return syncRoutes({ runRt, orgs: () => orgs, fixture });
}

function post(a: ReturnType<typeof app>, org: string) {
  return a.request('http://localhost/api/settings/sync/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'localhost' },
    body: JSON.stringify({ org }),
  });
}

describe('GET /api/settings/sync', () => {
  it('GET returns one entry per org from rt team status', async () => {
    const runRt = vi.fn<RunRt>(async argv => ok(teamStatus(argv[3]!)));
    const res = await app(runRt).request('/api/settings/sync');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { orgs: OrgSync[] };
    expect(runRt.mock.calls.map(c => c[0])).toEqual([
      ['team', 'status', '--team', 'acme', '--sync', '--json'],
      ['team', 'status', '--team', 'beta', '--sync', '--json'],
    ]);
    expect(runRt.mock.calls[0]![1]).toEqual({ timeoutMs: READ_TIMEOUT_MS });
    expect(body.orgs).toEqual([
      {
        org: 'acme',
        state: { kind: 'waiting', count: 1 },
        pending: [{ store: 'team:web', key: 'board.slack', change: 'changed' }],
        cantPush: ['mattstack/org/settings.org.jsonc'],
        lastPushAt: Date.parse('2026-11-23T11:50:00.000Z'),
        pullIntervalSec: 300,
        trialBranch: null,
      },
      expect.objectContaining({ org: 'beta' }),
    ]);
  });

  it("GET lifts Bun's idle timeout, so a slow rt team status still answers", async () => {
    const runRt = vi.fn<RunRt>(async () => ok(teamStatus('acme')));
    const timeout = vi.fn();
    const res = await app(runRt, ['acme']).request(
      'http://localhost/api/settings/sync',
      {},
      { timeout }
    );
    expect(res.status).toBe(200);
    expect(timeout).toHaveBeenCalledWith(expect.any(Request), 0);
  });

  it('GET reads unknown when rt team status fails', async () => {
    const runRt = vi.fn<RunRt>(async () => ({
      code: 2,
      stdout: '{"error":{"code":"no-team","message":"gone"}}',
      stderr: '',
    }));
    const res = await app(runRt, ['acme']).request('/api/settings/sync');
    const body = (await res.json()) as { orgs: OrgSync[] };
    expect(res.status).toBe(200);
    expect(body.orgs).toEqual([
      {
        org: 'acme',
        state: { kind: 'unknown' },
        pending: [],
        cantPush: [],
        lastPushAt: null,
        pullIntervalSec: 300,
        trialBranch: null,
      },
    ]);
  });

  it('GET reads unknown when rt itself is missing', async () => {
    const runRt = vi.fn<RunRt>(async () => {
      throw new RtNotFoundError(['/x/rt']);
    });
    const body = (await (
      await app(runRt, ['acme']).request('/api/settings/sync')
    ).json()) as { orgs: OrgSync[] };
    expect(body.orgs[0]!.state).toEqual({ kind: 'unknown' });
  });

  it('GET in the fixture returns the fixture without running rt', async () => {
    const runRt = vi.fn<RunRt>();
    const fixture: OrgSync[] = [
      {
        org: 'acme',
        state: { kind: 'unknown' },
        pending: [],
        cantPush: [],
        lastPushAt: null,
        pullIntervalSec: 300,
        trialBranch: null,
      },
    ];
    const body = (await (
      await app(runRt, ['acme'], fixture).request('/api/settings/sync')
    ).json()) as { orgs: OrgSync[] };
    expect(body.orgs).toEqual(fixture);
    expect(runRt).not.toHaveBeenCalled();
  });
});

describe('POST /api/settings/sync/push', () => {
  it('POST runs rt team push for the org', async () => {
    const result = {
      committed: true,
      pushed: true,
      error: null,
      skipped: null,
    };
    const runRt = vi.fn<RunRt>(async () =>
      ok({ contract: 1, slug: 'acme', ...result })
    );
    const res = await post(app(runRt), 'acme');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result });
    expect(runRt.mock.calls[0]![0]).toEqual([
      'team',
      'push',
      '--team',
      'acme',
      '--json',
    ]);
  });

  it("POST lifts Bun's idle timeout, so a push longer than 10s still answers", async () => {
    const runRt = vi.fn<RunRt>(async () =>
      ok({
        contract: 1,
        slug: 'acme',
        committed: true,
        pushed: true,
        error: null,
        skipped: null,
      })
    );
    const timeout = vi.fn();
    const server = { timeout, requestIP: () => ({ address: '127.0.0.1' }) };
    const res = await app(runRt).request(
      'http://localhost/api/settings/sync/push',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'localhost' },
        body: JSON.stringify({ org: 'acme' }),
      },
      server
    );
    expect(res.status).toBe(200);
    expect(timeout).toHaveBeenCalledWith(expect.any(Request), 0);
  });

  it("POST maps a failed push to 409 with rt's message", async () => {
    const runRt = vi.fn<RunRt>(async () => ({
      code: 2,
      stdout: JSON.stringify({
        contract: 1,
        error: {
          code: 'team-push-failed',
          message: 'Your role no longer owns these pending changes',
        },
      }),
      stderr: '',
    }));
    const res = await post(app(runRt), 'acme');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Your role no longer owns these pending changes',
      code: 'team-push-failed',
    });
  });

  it('POST refuses in the fixture', async () => {
    const runRt = vi.fn<RunRt>();
    const res = await post(app(runRt, ['acme'], []), 'acme');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'the design fixture is read-only',
    });
    expect(runRt).not.toHaveBeenCalled();
  });

  it('POST refuses an org this Mac does not have', async () => {
    const runRt = vi.fn<RunRt>();
    const res = await post(app(runRt), 'nope');
    expect(res.status).toBe(400);
    expect(runRt).not.toHaveBeenCalled();
  });

  it('a POST while a push runs waits and shares one trailing push', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let calls = 0;
    const runRt = vi.fn<RunRt>(async () => {
      if (++calls === 1) await gate;
      return ok({
        contract: 1,
        slug: 'acme',
        committed: true,
        pushed: true,
        error: null,
        skipped: null,
      });
    });
    const a = app(runRt);
    const first = post(a, 'acme');
    await vi.waitFor(() => expect(runRt).toHaveBeenCalledTimes(1));
    const late = [post(a, 'acme'), post(a, 'acme'), post(a, 'acme')];
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(runRt).toHaveBeenCalledTimes(1);
    release();
    const results = await Promise.all([first, ...late]);
    expect(results.map(r => r.status)).toEqual([200, 200, 200, 200]);
    expect(runRt).toHaveBeenCalledTimes(2);
  });

  it('pushes for different orgs do not wait on each other', async () => {
    const runRt = vi.fn<RunRt>(async argv =>
      ok({
        contract: 1,
        slug: argv[3],
        committed: true,
        pushed: true,
        error: null,
        skipped: null,
      })
    );
    const a = app(runRt);
    const results = await Promise.all([post(a, 'acme'), post(a, 'beta')]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    expect(runRt.mock.calls.map(c => c[0][3])).toEqual(['acme', 'beta']);
  });
});
