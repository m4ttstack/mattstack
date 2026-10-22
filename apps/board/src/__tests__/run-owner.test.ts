import { describe, expect, test } from 'bun:test';

import type { RunSummary } from '@mattstack/rt-client';
import { firstLiveOwner, ownerCandidates, ringText } from '../run-owner';

function run(over: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 'run-1',
    repo: 'repos/acme-widgets',
    work_type: 'feature',
    pipeline: 'work',
    status: 'running',
    current_stage: 'build',
    spawned_by: null,
    started_at: 1,
    ended_at: null,
    pack_commits: null,
    pack_dirty: 0,
    attention: 'none',
    last_event_at: 100,
    ticket: null,
    branch: 'feat/x',
    session: 'sess-1',
    mr: null,
    ...over,
  } as RunSummary;
}

const q = { repoSlug: 'repos/acme-widgets', branch: 'feat/x' };
const MR = 'https://git.example.test/acme/widgets/-/merge_requests/7';

describe('ownerCandidates', () => {
  test('matches a running work run by mr url', () => {
    const out = ownerCandidates({ ...q, branch: 'other', mrUrl: MR }, [run({ mr: MR })]);
    expect(out).toEqual([{ runId: 'run-1', session: 'sess-1', stage: 'build' }]);
  });

  test('ignores trailing slashes on either url', () => {
    expect(ownerCandidates({ ...q, mrUrl: `${MR}/` }, [run({ mr: MR })])).toHaveLength(1);
    expect(ownerCandidates({ ...q, mrUrl: MR }, [run({ mr: `${MR}//` })])).toHaveLength(1);
  });

  test('matches by repo slug and branch only while the run has no mr', () => {
    expect(ownerCandidates(q, [run()])).toHaveLength(1);
    expect(ownerCandidates(q, [run({ repo: 'repos/other' })])).toHaveLength(0);
    expect(ownerCandidates(q, [run({ branch: 'feat/y' })])).toHaveLength(0);
  });

  test('a run whose mr names another MR does not match on branch', () => {
    const other = 'https://git.example.test/acme/widgets/-/merge_requests/8';
    expect(ownerCandidates({ ...q, mrUrl: MR }, [run({ mr: other })])).toHaveLength(0);
    expect(ownerCandidates(q, [run({ mr: other })])).toHaveLength(0);
  });

  test('matches a branch-only query (parent outside the board)', () => {
    expect(ownerCandidates(q, [run({ mr: null })])).toHaveLength(1);
  });

  test('skips finished runs, runs with no session, and review or receive-review runs', () => {
    const runs = [
      run({ id: 'a', status: 'done' }),
      run({ id: 'b', session: null }),
      run({ id: 'c', session: undefined }),
      run({ id: 'd', session: '-' }),
      run({ id: 'e', work_type: 'review' }),
      run({ id: 'f', work_type: 'receive-review' }),
    ];
    expect(ownerCandidates(q, runs)).toEqual([]);
  });

  test('orders two matching runs most recent first', () => {
    const out = ownerCandidates(q, [
      run({ id: 'old', last_event_at: 1 }),
      run({ id: 'new', last_event_at: 9 }),
    ]);
    expect(out.map((o) => o.runId)).toEqual(['new', 'old']);
  });
});

describe('firstLiveOwner', () => {
  const cands = [
    { runId: 'new', session: 's-new', stage: null },
    { runId: 'old', session: 's-old', stage: 'build' },
  ];

  test('skips a dead newer run for a live older one', async () => {
    const owner = await firstLiveOwner(cands, async (s) =>
      s === 's-old' ? { reachable: true, name: 'worker-a' } : { reachable: false },
    );
    expect(owner).toEqual({ ...cands[1], name: 'worker-a' });
  });

  test('returns null when none probe live', async () => {
    expect(await firstLiveOwner(cands, async () => ({ reachable: false }))).toBeNull();
  });
});

describe('ringText', () => {
  test('pipeline-red names the MR, pipeline and that no doctor was launched', () => {
    const t = ringText({ kind: 'pipeline-red', iid: 4127, pipelineId: 731 });
    expect(t).toContain('!4127');
    expect(t).toContain('731');
    expect(t).toContain('no doctor was launched');
  });

  test('needs-rebase names the target branch', () => {
    const t = ringText({ kind: 'needs-rebase', iid: 5, targetBranch: 'main' });
    expect(t).toContain('!5');
    expect(t).toContain('main');
    expect(t).toContain('no doctor was launched');
  });

  test('downstream pipeline-red says stacked on your branch', () => {
    const t = ringText({ kind: 'downstream', childIid: 6, childEdge: 'pipeline-red', pipelineId: 99 });
    expect(t).toContain('!6');
    expect(t).toContain('stacked on your branch');
    expect(t).toContain('99');
  });

  test('downstream needs-rebase never claims failing CI', () => {
    const t = ringText({ kind: 'downstream', childIid: 6, childEdge: 'needs-rebase', pipelineId: null });
    expect(t).toContain('needs a rebase');
    expect(t).not.toContain('failing CI');
  });
});
