import { describe, expect, test } from 'bun:test';

import type { RunSummary } from '@mattstack/rt-client';
import { boardRepoSlug } from '../manifest-bindings';
import {
  attachActiveRuns,
  createRunOwnerRefresher,
} from '../run-owner-refresh';
import type { OwnMrFacts } from '../triage/edge';

const HOST = 'https://git.example.test/acme/widgets/-/merge_requests';
const PARENT = `${HOST}/7`;
const CHILD = `${HOST}/8`;
const SLUG = boardRepoSlug('https://git.example.test', 'acme/widgets');

function run(over: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 'run-1',
    repo: SLUG,
    work_type: 'feature',
    pipeline: 'work',
    status: 'running',
    current_stage: 'implement',
    spawned_by: null,
    started_at: 1,
    ended_at: null,
    pack_commits: null,
    pack_dirty: 0,
    attention: 'none',
    last_event_at: 100,
    ticket: null,
    branch: null,
    session: 'sess-1',
    mr: null,
    ...over,
  } as RunSummary;
}

function facts(over: Partial<OwnMrFacts> & { mrUrl: string }): OwnMrFacts {
  return {
    iid: Number(over.mrUrl.split('/').pop()),
    pipelineId: null,
    pipelineState: 'success',
    needsRebase: false,
    author: 'cosmo',
    sourceBranch: 'feat/x',
    targetBranch: 'main',
    isStacked: false,
    ...over,
  } as OwnMrFacts;
}

const STACK = [
  facts({ mrUrl: PARENT, sourceBranch: 'feat/parent' }),
  facts({
    mrUrl: CHILD,
    sourceBranch: 'feat/child',
    targetBranch: 'feat/parent',
    isStacked: true,
  }),
];

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

function io(over: Partial<Parameters<typeof createRunOwnerRefresher>[0]> = {}) {
  let t = 1000;
  return {
    listRuns: async () => [] as RunSummary[],
    probe: async () => ({ reachable: true, name: 'Pip' }),
    mrs: () => STACK,
    repoSlugForMr: () => SLUG,
    now: () => t,
    advance: (ms: number) => (t += ms),
    ...over,
  };
}

describe('createRunOwnerRefresher', () => {
  test('poke never blocks and ownerFor fills after the refresh resolves', async () => {
    const runs = deferred<RunSummary[] | null>();
    const r = createRunOwnerRefresher(io({ listRuns: () => runs.promise }));
    expect(r.poke()).toBeUndefined();
    expect(r.ownerFor(PARENT)).toBeUndefined();
    runs.resolve([run({ mr: PARENT })]);
    await r.settled();
    expect(r.ownerFor(PARENT)).toEqual({
      runId: 'run-1',
      stage: 'implement',
      name: 'Pip',
    });
  });

  test('a dead session is not an owner', async () => {
    const r = createRunOwnerRefresher(
      io({
        listRuns: async () => [run({ mr: PARENT })],
        probe: async () => ({ reachable: false }),
      })
    );
    r.poke();
    await r.settled();
    expect(r.ownerFor(PARENT)).toBeUndefined();
  });

  test("an ancestor's live run shows with viaIid", async () => {
    const r = createRunOwnerRefresher(
      io({ listRuns: async () => [run({ mr: PARENT })] })
    );
    r.poke();
    await r.settled();
    expect(r.ownerFor(CHILD)).toEqual({
      runId: 'run-1',
      stage: 'implement',
      name: 'Pip',
      viaIid: 7,
    });
  });

  test("the MR's own run wins over its ancestor's", async () => {
    const r = createRunOwnerRefresher(
      io({
        listRuns: async () => [
          run({ id: 'parent-run', mr: PARENT, session: 'sess-p' }),
          run({ id: 'child-run', mr: CHILD, session: 'sess-c' }),
        ],
      })
    );
    r.poke();
    await r.settled();
    expect(r.ownerFor(CHILD)?.runId).toBe('child-run');
    expect(r.ownerFor(CHILD)?.viaIid).toBeUndefined();
  });

  test('a parent known only by branch shows with viaBranch', async () => {
    const r = createRunOwnerRefresher(
      io({
        mrs: () => [STACK[1]!],
        listRuns: async () => [run({ branch: 'feat/parent' })],
      })
    );
    r.poke();
    await r.settled();
    expect(r.ownerFor(CHILD)).toEqual({
      runId: 'run-1',
      stage: 'implement',
      name: 'Pip',
      viaBranch: 'feat/parent',
    });
  });

  test('listRuns null keeps the last known owners', async () => {
    let answer: RunSummary[] | null = [run({ mr: PARENT })];
    const base = io({ listRuns: async () => answer });
    const r = createRunOwnerRefresher(base, 10_000);
    r.poke();
    await r.settled();
    expect(r.ownerFor(PARENT)?.runId).toBe('run-1');
    answer = null;
    base.advance(10_001);
    r.poke();
    await r.settled();
    expect(r.ownerFor(PARENT)?.runId).toBe('run-1');
  });

  test('three failed refreshes in a row drop the last known owners', async () => {
    let answer: RunSummary[] | null = [run({ mr: PARENT })];
    const base = io({ listRuns: async () => answer });
    const r = createRunOwnerRefresher(base, 10_000);
    const refresh = async () => {
      base.advance(10_001);
      r.poke();
      await r.settled();
    };
    await refresh();
    answer = null;
    await refresh();
    await refresh();
    expect(r.ownerFor(PARENT)?.runId).toBe('run-1');
    await refresh();
    expect(r.ownerFor(PARENT)).toBeUndefined();
  });

  test('a success between failures resets the failure count', async () => {
    let answer: RunSummary[] | null = [run({ mr: PARENT })];
    const base = io({ listRuns: async () => answer });
    const r = createRunOwnerRefresher(base, 10_000);
    const refresh = async () => {
      base.advance(10_001);
      r.poke();
      await r.settled();
    };
    await refresh();
    answer = null;
    await refresh();
    await refresh();
    answer = [run({ mr: PARENT })];
    await refresh();
    answer = null;
    await refresh();
    await refresh();
    expect(r.ownerFor(PARENT)?.runId).toBe('run-1');
  });

  test('a refresh that changes owners calls onChange once; one that does not, never', async () => {
    let changes = 0;
    let answer: RunSummary[] | null = [run({ mr: PARENT })];
    const base = io({
      listRuns: async () => answer,
      onChange: () => changes++,
    });
    const r = createRunOwnerRefresher(base, 10_000);
    r.poke();
    await r.settled();
    expect(changes).toBe(1);
    base.advance(10_001);
    r.poke();
    await r.settled();
    expect(changes).toBe(1);
    answer = null;
    base.advance(10_001);
    r.poke();
    await r.settled();
    expect(changes).toBe(1);
    answer = [run({ mr: PARENT, current_stage: 'ship' })];
    base.advance(10_001);
    r.poke();
    await r.settled();
    expect(changes).toBe(2);
  });

  test('a poke inside the ttl does not refresh again', async () => {
    let calls = 0;
    const base = io({
      listRuns: async () => {
        calls++;
        return [];
      },
    });
    const r = createRunOwnerRefresher(base, 10_000);
    r.poke();
    await r.settled();
    base.advance(5_000);
    r.poke();
    await r.settled();
    expect(calls).toBe(1);
    base.advance(5_001);
    r.poke();
    await r.settled();
    expect(calls).toBe(2);
  });

  test('a session shared by several MRs is probed once per refresh', async () => {
    let probes = 0;
    const r = createRunOwnerRefresher(
      io({
        listRuns: async () => [run({ mr: PARENT })],
        probe: async () => {
          probes++;
          return { reachable: true };
        },
      })
    );
    r.poke();
    await r.settled();
    expect(probes).toBe(1);
  });
});

describe('attachActiveRuns', () => {
  test('stamps activeRun only on rows with an owner', async () => {
    const r = createRunOwnerRefresher(
      io({
        mrs: () => [STACK[0]!],
        listRuns: async () => [run({ mr: PARENT })],
      })
    );
    r.poke();
    await r.settled();
    const rows = attachActiveRuns(
      [{ webUrl: PARENT }, { webUrl: `${HOST}/99` }, { webUrl: null }],
      r
    );
    expect(rows[0]).toEqual({
      webUrl: PARENT,
      activeRun: { runId: 'run-1', stage: 'implement', name: 'Pip' },
    });
    expect(rows[1]).toEqual({ webUrl: `${HOST}/99` });
    expect(rows[2]).toEqual({ webUrl: null });
  });
});
