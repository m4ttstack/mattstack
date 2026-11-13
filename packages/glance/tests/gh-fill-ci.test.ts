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
    expect(p.id).toBe('github:run:50');
    expect(Number(p.id.slice(p.id.lastIndexOf(':') + 1))).toBe(50);
  });

  it('Pipeline.id is the lowest run id, whichever run failed', () => {
    const p = map([
      check(1, { checkSuite: run(90) }),
      check(2, { conclusion: 'FAILURE', checkSuite: run(140) })
    ]);
    expect(p.id).toBe('github:run:90');
  });

  it('compares run ids numerically, not as strings', () => {
    const p = map([check(1, { checkSuite: run(1000) }), check(2, { checkSuite: run(99) })]);
    expect(p.id).toBe('github:run:99');
  });

  it('one head commit keeps one pipeline id while lint fails and then tests fail', () => {
    const tests = (over: Partial<CheckRun> = {}) =>
      check(1, { checkSuite: run(100), status: 'IN_PROGRESS', conclusion: null, ...over });
    const lint = (over: Partial<CheckRun> = {}) =>
      check(2, { checkSuite: run(101), status: 'IN_PROGRESS', conclusion: null, ...over });
    const failed: Partial<CheckRun> = { status: 'COMPLETED', conclusion: 'FAILURE' };

    const ids = [
      map([tests(), lint()]).id,
      map([tests(), lint(failed)]).id,
      map([tests(failed), lint(failed)]).id
    ];

    expect(ids).toEqual(['github:run:100', 'github:run:100', 'github:run:100']);
  });

  it('a new push changes the pipeline id', () => {
    const first = map([check(1, { checkSuite: run(100) }), check(2, { checkSuite: run(101) })]);
    const next = map([check(3, { checkSuite: run(200) }), check(4, { checkSuite: run(201) })]);

    expect(next.id).toBe('github:run:200');
    expect(next.id).not.toBe(first.id);
  });

  it('a run whose checks appear late moves the id at most once', () => {
    const failed: Partial<CheckRun> = { conclusion: 'FAILURE' };
    const a = map([check(2, { checkSuite: run(101) })]);
    const b = map([check(2, { checkSuite: run(101) }), check(1, { checkSuite: run(100) })]);
    const c = map([
      check(2, { checkSuite: run(101), ...failed }),
      check(1, { checkSuite: run(100), ...failed }),
      check(3, { checkSuite: run(102), ...failed })
    ]);

    const ids = [a.id, b.id, c.id];
    expect(ids).toEqual(['github:run:101', 'github:run:100', 'github:run:100']);
    expect(ids.filter((id, i) => i > 0 && id !== ids[i - 1])).toHaveLength(1);
  });

  it('statuses-only contexts keep the checks id', () => {
    const p = map([
      {
        __typename: 'StatusContext',
        context: 'ci/external',
        state: 'SUCCESS',
        targetUrl: null,
        createdAt: '2026-01-01T00:00:00Z',
        isRequired: true
      }
    ]);
    expect(p.id).toBe(`github:checks:${PR}`);
    expect(p.runIds).toEqual([]);
  });
});
