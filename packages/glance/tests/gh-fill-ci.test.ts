import { describe, expect, it } from 'bun:test';
import { mapPipeline, type GHFillContext } from '../src/githubFill.ts';

const PR = 'https://github.com/o/r/pull/1';

type CheckRun = Extract<GHFillContext, { __typename: 'CheckRun' }>;

const run = (databaseId: number) => ({
  workflowRun: { databaseId, runNumber: 1, workflow: { name: 'ci' } }
});

function check(id: number, over: Partial<CheckRun> = {}): GHFillContext {
  return {
    __typename: 'CheckRun',
    databaseId: id,
    name: `check-${id}`,
    status: 'COMPLETED',
    conclusion: 'SUCCESS',
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T00:01:00Z',
    detailsUrl: `https://github.com/o/r/runs/${id}`,
    isRequired: true,
    checkSuite: run(900 + id),
    ...over
  };
}

const map = (c: GHFillContext[]) => mapPipeline(c, PR, 'feat', 'abc123')!;

describe('mapPipeline', () => {
  it('returns null with no contexts', () => {
    expect(mapPipeline([], PR, 'feat', 'abc')).toBeNull();
  });

  it('required failure fails the pipeline', () => {
    const p = map([check(1, { conclusion: 'FAILURE' })]);
    expect(p.status).toBe('failed');
    expect(p.jobs[0]!.allowFailure).toBe(false);
    expect(p.jobs[0]!.duration).toBe(60);
  });

  it('optional failure is a warning, not a failure', () => {
    const p = map([check(1, { conclusion: 'FAILURE', isRequired: false }), check(2)]);
    expect(p.status).toBe('success');
    expect(p.jobs[0]!.allowFailure).toBe(true);
  });

  it('no required contexts: every check counts', () => {
    const p = map([
      check(1, { conclusion: 'FAILURE', isRequired: false }),
      check(2, { isRequired: false })
    ]);
    expect(p.status).toBe('failed');
  });

  it('commit statuses count', () => {
    const p = map([
      {
        __typename: 'StatusContext',
        context: 'ci/external',
        state: 'FAILURE',
        targetUrl: null,
        createdAt: '2026-01-01T00:00:00Z',
        isRequired: true
      }
    ]);
    expect(p.status).toBe('failed');
    expect(p.jobs[0]!.id).toBe('github:status:ci/external');
    expect(p.jobs[0]!.runId).toBeNull();
  });

  it('canceled reads canceled, not pending', () => {
    const p = map([check(1, { conclusion: 'CANCELLED' }), check(2)]);
    expect(p.status).toBe('canceled');
  });

  it('explicit job mappings', () => {
    const status = (over: Partial<CheckRun>) => map([check(1, over)]).jobs[0]!.status;
    expect(status({ conclusion: 'STALE' })).toBe('failed');
    expect(status({ conclusion: 'STARTUP_FAILURE' })).toBe('failed');
    expect(status({ conclusion: 'ACTION_REQUIRED' })).toBe('manual');
    for (const s of ['QUEUED', 'WAITING', 'REQUESTED', 'PENDING']) {
      expect(status({ status: s, conclusion: null })).toBe('pending');
    }
    expect(status({ status: 'IN_PROGRESS', conclusion: null })).toBe('running');
  });

  it('ids are real', () => {
    const p = map([
      check(1, { checkSuite: run(50) }),
      check(2, { checkSuite: run(50) }),
      check(3, { checkSuite: run(70) })
    ]);
    expect(p.jobs[0]!.id).toBe('github:check:1');
    expect(p.jobs[0]!.runId).toBe('50');
    expect(p.runIds).toEqual(['50', '70']);
    expect(p.id).toBe('github:run:70');
    expect(Number(p.id.slice(p.id.lastIndexOf(':') + 1))).toBe(70);
  });

  it('Pipeline.id prefers the run holding the first failed required job', () => {
    const p = map([
      check(1, { checkSuite: run(90) }),
      check(2, { conclusion: 'FAILURE', checkSuite: run(40) })
    ]);
    expect(p.id).toBe('github:run:40');
  });
});
