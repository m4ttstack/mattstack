import { describe, test, expect } from 'bun:test';
import { parseActionBody, shapeActivity, shapeStack } from '../src/server/data.ts';
import type { BoardMr } from '../src/server/data.ts';
import type { Stack, StackNode } from '../src/core/types.ts';
import type { NodeDirective } from '../src/core/stack-diagnostics.ts';
import type { OperationEntry } from '../src/core/operation-log.ts';
import type { RepoEntry } from '../src/server/config.ts';

function makeNode(branch: string, parent: string, extra: Partial<StackNode> = {}): StackNode {
  return {
    branch,
    parent,
    mrIid: null,
    mrUrl: null,
    mrTitle: null,
    status: 'local-only',
    lastKnownHead: null,
    forkPoint: null,
    diffStats: null,
    pipelineStatus: 'unknown',
    unresolvedThreads: 0,
    ...extra,
  };
}

const STACK: Stack = {
  id: 'id1',
  stackName: 'mystack',
  root: 'main',
  nodes: [makeNode('a', 'main'), makeNode('b', 'a', { mrIid: 12, mrUrl: 'https://x/mr/12', mrTitle: 'stored', pipelineStatus: 'success' })],
};

function directive(branch: string): NodeDirective {
  return {
    branch,
    situation: 'behind-parent',
    statusLine: 'behind its parent',
    badge: { label: 'Behind', variant: 'caution' },
    primaryAction: null,
    secondaryActions: [],
    blocked: null,
    removal: { allowed: true },
  };
}

function entry(id: string, timestamp: number, repoPath?: string): OperationEntry {
  return { id, timestamp, operation: 'sync', commands: [], branchSnapshots: { a: 'sha1' }, stackSnapshot: STACK, ...(repoPath ? { repoPath } : {}) };
}

describe('shapeStack', () => {
  test('maps directives onto nodes and defaults missing ones to synced', () => {
    const shaped = shapeStack(STACK, new Map([['a', directive('a')]]), null, [], [], new Map());
    expect(shaped.stackName).toBe('mystack');
    expect(shaped.root).toBe('main');
    expect(shaped.nodes[0]!).toMatchObject({
      branch: 'a',
      parent: 'main',
      situation: 'behind-parent',
      statusLine: 'behind its parent',
      badge: { label: 'Behind', variant: 'caution' },
    });
    expect(shaped.nodes[1]!.situation).toBe('synced');
    expect(shaped.nodes[1]!.badge).toBeNull();
  });

  test('live MR data wins; stored node fields are the fallback', () => {
    const live: BoardMr = { iid: 99, url: 'https://x/mr/99', title: 'live', state: 'opened', pipelineStatus: 'running' };
    const shaped = shapeStack(STACK, new Map(), null, [], [], new Map([['b', live]]));
    expect(shaped.nodes[1]!.mr).toEqual(live);
    const offline = shapeStack(STACK, new Map(), null, [], [], new Map());
    expect(offline.nodes[1]!.mr).toEqual({ iid: 12, url: 'https://x/mr/12', title: 'stored', state: 'unknown', pipelineStatus: 'success' });
    expect(offline.nodes[0]!.mr).toBeNull();
  });
});

describe('shapeActivity', () => {
  test('filters by repo (legacy entries without repoPath match), sorts desc, limits', () => {
    const entries = [entry('e1', 100, '/repo'), entry('e2', 300), entry('e3', 200, '/other'), entry('e4', 400, '/repo')];
    const shaped = shapeActivity(entries, '/repo');
    expect(shaped.map((e) => e.id)).toEqual(['e4', 'e2', 'e1']);
    expect(shaped[0]!).toMatchObject({ operation: 'sync', stackName: 'mystack', branches: ['a'] });
    expect(shapeActivity(entries, '/repo', 2).length).toBe(2);
  });
});

describe('parseActionBody', () => {
  const REPOS = [{ path: '/repo', name: 'repo' }];

  test('accepts a valid body', () => {
    expect(parseActionBody({ repoPath: '/repo', stack: 's', action: 'sync' }, REPOS)).toEqual({
      repoPath: '/repo',
      stack: 's',
      action: 'sync',
    });
  });

  test('rejects unknown actions, unconfigured repos, and bad shapes', () => {
    expect(parseActionBody({ repoPath: '/repo', stack: 's', action: 'rebase' }, REPOS)).toBeNull();
    expect(parseActionBody({ repoPath: '/nope', stack: 's', action: 'sync' }, REPOS)).toBeNull();
    expect(parseActionBody({ repoPath: '/repo', stack: '', action: 'sync' }, REPOS)).toBeNull();
    expect(parseActionBody('junk', REPOS)).toBeNull();
    expect(parseActionBody(null, REPOS)).toBeNull();
  });
});

describe('parseActionBody sourceSlot', () => {
  const repos = [{ path: '/repo/a', name: 'a' }] as RepoEntry[];

  test('accepts sourceSlot for absorb', () => {
    const parsed = parseActionBody(
      { repoPath: '/repo/a', stack: 's', action: 'absorb', sourceSlot: '/repo/a-pool/tonks' },
      repos,
    );
    expect(parsed?.sourceSlot).toBe('/repo/a-pool/tonks');
  });

  test('rejects sourceSlot on non-absorb actions', () => {
    expect(
      parseActionBody({ repoPath: '/repo/a', stack: 's', action: 'sync', sourceSlot: '/x' }, repos),
    ).toBeNull();
  });

  test('rejects a non-string sourceSlot', () => {
    expect(
      parseActionBody({ repoPath: '/repo/a', stack: 's', action: 'absorb', sourceSlot: 5 }, repos),
    ).toBeNull();
  });

  test('absent sourceSlot still parses', () => {
    expect(parseActionBody({ repoPath: '/repo/a', stack: 's', action: 'absorb' }, repos)).not.toBeNull();
  });
});

describe('shapeStack worktree columns', () => {
  const ONE_NODE_STACK: Stack = {
    id: 'id2',
    stackName: 'onestack',
    root: 'main',
    nodes: [makeNode('feature-a', 'main')],
  };

  test('marks nodes with their checkout slot and its dirtiness', () => {
    const slotByBranch = new Map([['feature-a', { name: 'tonks', dirty: true }]]);
    const shaped = shapeStack(ONE_NODE_STACK, new Map(), null, [], [], new Map(), slotByBranch);
    expect(shaped.nodes[0]!.checkedOutIn).toBe('tonks');
    expect(shaped.nodes[0]!.checkedOutDirty).toBe(true);
  });

  test('nodes not checked out anywhere get null/false', () => {
    const shaped = shapeStack(ONE_NODE_STACK, new Map(), null, [], [], new Map(), new Map());
    expect(shaped.nodes[0]!.checkedOutIn).toBeNull();
    expect(shaped.nodes[0]!.checkedOutDirty).toBe(false);
  });
});
