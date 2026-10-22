import { describe, expect, test } from 'bun:test';

import {
  detectEdges,
  markHandled,
  observe,
  rearm,
  type OwnMrFacts,
} from '../triage/edge.ts';
import {
  emptyMrMemory,
  liveHandoffs,
  rollDay,
  type DispatchMemory,
  type Handoff,
} from '../triage/memory.ts';

const DAY = '2026-08-08';
const mr = (over: Partial<OwnMrFacts> = {}): OwnMrFacts => ({
  mrUrl: 'https://x/mr/1',
  iid: 1,
  pipelineId: 100,
  pipelineState: 'failed',
  needsRebase: false,
  author: 'matt',
  sourceBranch: 'feat',
  targetBranch: 'master',
  isStacked: false,
  ...over,
});
const fresh = (): DispatchMemory => ({ identity: null, mrs: {} });

describe('edge detection', () => {
  test('a failed pipeline with an unhandled id is a pipeline-red edge', () => {
    const mem = fresh();
    observe(mem, [mr()], DAY);
    expect(detectEdges(mem, [mr()])).toEqual([
      {
        mrUrl: 'https://x/mr/1',
        iid: 1,
        kind: 'pipeline-red',
        pipelineId: 100,
        author: 'matt',
      },
    ]);
  });

  test('a handled pipeline id does not re-fire; a NEW failed pipeline does', () => {
    const mem = fresh();
    observe(mem, [mr()], DAY);
    markHandled(mem, {
      mrUrl: 'https://x/mr/1',
      iid: 1,
      kind: 'pipeline-red',
      pipelineId: 100,
      author: 'matt',
    });
    expect(detectEdges(mem, [mr()])).toEqual([]);
    expect(detectEdges(mem, [mr({ pipelineId: 101 })])).toHaveLength(1);
  });

  test('needs-rebase fires on the flip, not while it stays true; re-arms when clean', () => {
    const mem = fresh();
    const conflicted = mr({ pipelineState: 'passed', needsRebase: true });
    observe(mem, [conflicted], DAY);
    expect(detectEdges(mem, [conflicted])).toEqual([
      {
        mrUrl: 'https://x/mr/1',
        iid: 1,
        kind: 'needs-rebase',
        pipelineId: 100,
        author: 'matt',
      },
    ]);
    markHandled(mem, {
      mrUrl: 'https://x/mr/1',
      iid: 1,
      kind: 'needs-rebase',
      pipelineId: 100,
      author: 'matt',
    });
    expect(detectEdges(mem, [conflicted])).toEqual([]); // handled, still true: quiet
    observe(mem, [mr({ pipelineState: 'passed' })], DAY); // clean observation re-arms
    observe(mem, [conflicted], DAY);
    expect(detectEdges(mem, [conflicted])).toHaveLength(1); // fresh flip fires again
  });

  test('running/passed/none pipelines and null ids emit nothing', () => {
    const mem = fresh();
    const quiet = [
      mr({ pipelineState: 'running' }),
      mr({
        mrUrl: 'https://x/mr/2',
        iid: 2,
        pipelineState: 'failed',
        pipelineId: null,
      }),
    ];
    observe(mem, quiet, DAY);
    expect(detectEdges(mem, quiet)).toEqual([]);
  });

  test('author carries through from facts onto the edge (MAT-351 gate needs it)', () => {
    const mem = fresh();
    const theirs = mr({ author: 'teammate' });
    observe(mem, [theirs], DAY);
    expect(detectEdges(mem, [theirs])[0]!.author).toBe('teammate');
  });
});

const handoff = (over: Partial<Handoff> = {}): Handoff => ({
  runId: 'run-1',
  session: 'sess-1',
  stage: 'ship',
  pipelineId: 100,
  viaMr: 'https://x/mr/1',
  viaBranch: 'feat',
  at: 1,
  ...over,
});

describe('rearm and handoffs', () => {
  test('rearm lets the same red pipeline fire again', () => {
    const mem = fresh();
    observe(mem, [mr()], DAY);
    const [edge] = detectEdges(mem, [mr()]);
    markHandled(mem, edge!);
    expect(detectEdges(mem, [mr()])).toEqual([]);
    rearm(mem, edge!.mrUrl, 'pipeline-red');
    expect(mem.mrs[edge!.mrUrl]!.lastHandledPipelineId).toBeNull();
    expect(detectEdges(mem, [mr()])).toHaveLength(1);
  });

  test('rearm lets a held rebase fire again', () => {
    const mem = fresh();
    const f = mr({ pipelineState: 'passed', needsRebase: true });
    observe(mem, [f], DAY);
    markHandled(mem, detectEdges(mem, [f])[0]!);
    expect(detectEdges(mem, [f])).toEqual([]);
    rearm(mem, f.mrUrl, 'needs-rebase');
    expect(detectEdges(mem, [f])).toHaveLength(1);
  });

  test('rollDay keeps handoffs', () => {
    const m = {
      ...emptyMrMemory(DAY),
      handoffs: { 'pipeline-red': handoff() },
    };
    expect(rollDay(m, '2026-08-09').handoffs).toEqual(m.handoffs);
  });

  test('two kinds keep two handoffs', () => {
    const m = {
      ...emptyMrMemory(DAY),
      handoffs: {
        'pipeline-red': handoff(),
        'needs-rebase': handoff({ runId: 'run-2', pipelineId: null }),
      },
    };
    const live = liveHandoffs(m, {
      pipelineId: 100,
      pipelineFailed: true,
      needsRebase: true,
    });
    expect(Object.keys(live).sort()).toEqual(['needs-rebase', 'pipeline-red']);
  });

  test('liveHandoffs drops a pipeline-red handoff once the pipeline id changes or goes green', () => {
    const m = {
      ...emptyMrMemory(DAY),
      handoffs: { 'pipeline-red': handoff() },
    };
    const f = { pipelineId: 100, pipelineFailed: true, needsRebase: false };
    expect(liveHandoffs(m, f)['pipeline-red']).toBeDefined();
    expect(liveHandoffs(m, { ...f, pipelineId: 101 })).toEqual({});
    expect(liveHandoffs(m, { ...f, pipelineFailed: false })).toEqual({});
    expect(liveHandoffs(undefined, f)).toEqual({});
  });
});
