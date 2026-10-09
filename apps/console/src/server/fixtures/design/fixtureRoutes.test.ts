// @vitest-environment node
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { runsFixture } from './runsFixture';

vi.mock('@mattstack/rt-client', async importOriginal => {
  const daemon = () => {
    throw new Error('a design-fixture route reached the daemon');
  };
  return {
    ...(await importOriginal<typeof import('@mattstack/rt-client')>()),
    listRuns: vi.fn(daemon),
    getRun: vi.fn(daemon),
    runEvidence: vi.fn(daemon),
    abandonRun: vi.fn(daemon),
    agentAdopt: vi.fn(daemon),
    agentResume: vi.fn(daemon),
    paneList: vi.fn(daemon),
    paneFocus: vi.fn(daemon),
    gateList: vi.fn(daemon),
    gateAnswer: vi.fn(daemon),
    readBranchCache: vi.fn(daemon),
  };
});

const { runsRoutes } = await import('../../runs');
const { gatesRoutes } = await import('../../gates');
const { enrichRoutes } = await import('../../enrich');
const { panesRoutes } = await import('../../panes');
const { mountEffectiveInputs } = await import('../../effectiveInputs');

const noRt = vi.fn(async () => {
  throw new Error('a design-fixture route ran rt or git');
});

function appFor(scenario: 'runs' | 'runs-empty' | 'runs-outage' | 'clean') {
  const fixture = runsFixture(scenario);
  return new Hono()
    .route('/', runsRoutes(fixture))
    .route('/', gatesRoutes(fixture))
    .route('/', enrichRoutes(fixture))
    .route('/', panesRoutes(fixture))
    .route('/', mountEffectiveInputs(new Hono(), noRt, noRt, fixture));
}

const app = appFor('runs');
const RUN = '/api/runs/remote%3Aacme%2Fweb';
const get = (path: string) => app.request(path);
const at = (local: string) => Date.parse(`2026-10-08T${local}-05:00`);

describe('the routes under the design fixture', () => {
  it('lists the runs with the runs pages’ clock', async () => {
    const res = await get('/api/runs');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: { id: string }[]; asOf: number };
    expect(body.asOf).toBe(at('16:23'));
    expect(body.runs).toHaveLength(9);
  });

  it('serves a run with its board’s clock, and 404s one it does not have', async () => {
    const res = await get(`${RUN}/20261008-1502`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: { id: string }; asOf: number };
    expect(body.run.id).toBe('20261008-1502');
    expect(body.asOf).toBe(at('15:11'));
    expect((await get(`${RUN}/nope`)).status).toBe(404);
  });

  it('links the live review run’s waiting post gate to an invented board, and no other run', async () => {
    const review = (await (await get(`${RUN}/20261008-1502`)).json()) as {
      boardUrl: string | null;
    };
    expect(review.boardUrl).toBe('http://localhost:11006/?gate=g-1502-post');
    const work = (await (await get(`${RUN}/20261008-1338`)).json()) as {
      boardUrl: string | null;
    };
    expect(work.boardUrl).toBeNull();
  });

  it('serves gates by run, linked and by subject, with the matching clock', async () => {
    const byRun = (await (
      await get('/api/gates?run=20261008-1340')
    ).json()) as {
      gates: { id: string }[];
      asOf: number;
    };
    expect(byRun.gates.map(g => g.id)).toEqual(['g-418-plan']);
    expect(byRun.asOf).toBe(at('16:21'));
    const linked = (await (await get('/api/gates?linked=1')).json()) as {
      gates: unknown[];
      asOf: number;
    };
    expect(linked.gates.length).toBeGreaterThan(40);
    expect(linked.asOf).toBe(at('16:23'));
  });

  it('counts the badge against the fixture clock', async () => {
    const res = await get('/api/badge');
    expect(await res.json()).toEqual({
      count: 1,
      path: '/runs/remote:acme%2Fweb/20261008-1340',
      ids: ['g-418-plan'],
    });
    expect(
      await (await appFor('runs-empty').request('/api/badge')).json()
    ).toEqual({
      count: 0,
    });
  });

  it('serves evidence bytes and the transcript as text', async () => {
    const image = await get(`${RUN}/20261008-1142/evidence/before`);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    const transcript = await get(`${RUN}/20261008-1142/evidence/transcript`);
    expect(transcript.headers.get('content-type')).toBe(
      'text/markdown; charset=utf-8'
    );
    expect(await transcript.text()).toContain('0 warnings, 0 errors');
    expect((await get(`${RUN}/20261008-1338/evidence/after`)).status).toBe(404);
  });

  it('serves a legacy run’s named image and refuses every other path', async () => {
    const path = (p: string) => encodeURIComponent(p);
    const dir = '/Users/acme/.mattstack/evidence/web-377';
    const ok = await get(
      `${RUN}/20261007-1520/evidence-file?path=${path(`${dir}/before.png`)}`
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    for (const refused of [
      `${RUN}/20261007-1520/evidence-file?path=${path(`${dir}/other.png`)}`,
      `${RUN}/20261007-1520/evidence-file?path=${path('/etc/passwd')}`,
      `${RUN}/20261007-1520/evidence-file`,
      `${RUN}/20261008-1142/evidence-file?path=${path(`${dir}/before.png`)}`,
    ]) {
      const res = await get(refused);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'no evidence' });
    }
  });

  it('serves the failure excerpt, enrichment, effective inputs and a stage doc', async () => {
    const excerpt = await get(
      `${RUN}/20261008-0900/artifact?path=${encodeURIComponent('/fixture/runs/20261008-0900/implement-1.txt')}`
    );
    expect(((await excerpt.json()) as { lines: string[] }).lines).toHaveLength(
      2
    );
    const outside = await get(`${RUN}/20261008-0900/artifact?path=/etc/hosts`);
    expect(outside.status).toBe(403);

    const enriched = await app.request('/api/runs/enrich', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ branches: ['web-418-assignee-filter'] }),
    });
    expect(await enriched.json()).toMatchObject({
      'web-418-assignee-filter': { ticket: { identifier: 'WEB-418' } },
    });

    const inputs = await get(`${RUN}/20261008-1338/effective-inputs`);
    expect(await inputs.json()).toMatchObject({
      pipeline: 'work',
      packDirty: false,
    });
    const doc = await get(`${RUN}/20261008-1338/stage-doc?stage=plan`);
    expect(await doc.json()).toEqual({
      text: expect.stringContaining('# Plan'),
      pack: 'acme',
      sha: '4c1d9e2b7a',
    });
    expect(
      (await get(`${RUN}/20261008-1338/stage-doc?stage=nope`)).status
    ).toBe(404);
    expect(noRt).not.toHaveBeenCalled();
  });

  it('refuses every write and reads no seen state', async () => {
    const post = (path: string, body: unknown = {}) =>
      app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const refused = async (res: Response | Promise<Response>) => {
      const r = await res;
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({
        error: 'the design fixture is read-only',
      });
    };
    await refused(post(`${RUN}/20261008-1338/abandon`));
    await refused(post(`${RUN}/20261008-1338/resume`));
    await refused(
      post('/api/gates/g-418-plan/answer', { answers: { approach: 'x' } })
    );
    await refused(post('/api/gates/g-418-plan/focus'));
    await refused(post('/api/panes/fixture-pane-molly/focus'));
    expect(await (await get('/api/seen')).json()).toEqual({});
    expect(await (await post('/api/seen/20261008-1338')).json()).toEqual({});
  });

  it('answers 502 daemon unreachable on the reads of the runs-outage scenario', async () => {
    const outage = appFor('runs-outage');
    for (const path of [
      '/api/runs',
      `${RUN}/20261008-1338`,
      '/api/gates',
      '/api/gates?run=20261008-1338',
      `${RUN}/20261008-1338/effective-inputs`,
    ]) {
      const res = await outage.request(path);
      expect(res.status, path).toBe(502);
      expect(await res.json(), path).toEqual({ error: 'daemon unreachable' });
    }
    expect(noRt).not.toHaveBeenCalled();
  });

  it('locates a gate’s run from the fixture', async () => {
    const res = await get('/api/gates/g-418-plan/locate');
    expect(await res.json()).toEqual({
      repo: 'remote:acme%2Fweb',
      runId: '20261008-1340',
    });
  });

  it('serves no runs under a skills scenario', async () => {
    const body = (await (
      await appFor('clean').request('/api/runs')
    ).json()) as {
      runs: unknown[];
    };
    expect(body.runs).toEqual([]);
  });
});
