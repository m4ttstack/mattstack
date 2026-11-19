import { describe, expect, test } from 'bun:test';
import type { AgentRecord, ChatPane, RunSummary } from '@mattstack/rt-client';
import { ownerOf, worktreeAgentRows } from '../agentRows';

const WT = '/r/.claude/worktrees/a';
const MAIN = '/r';
const ROOTS = [MAIN, WT];

function pane(over: Partial<ChatPane>): ChatPane {
  return { paneId: 'w1-1', workspace: 'w1', agentStatus: 'working', cwd: WT, ...over };
}
function record(over: Partial<AgentRecord>): AgentRecord {
  return {
    id: 'ag1', repo: 'gh:o/r', cwd: WT, provider: 'claude', surface: 'visible' as AgentRecord['surface'],
    sessionId: 's9', createdAt: 1, ...over,
  };
}
function run(over: Partial<RunSummary>): RunSummary {
  return { id: 'run1', branch: 'feat', session: null, work_type: 'work', ...over } as RunSummary;
}
function rows(input: Partial<Parameters<typeof worktreeAgentRows>[0]>) {
  return worktreeAgentRows({
    worktreePath: WT, worktreeRoots: ROOTS, branch: 'feat', panes: [], agents: [], runs: [], ...input,
  });
}

describe('ownerOf', () => {
  test('ownerOf picks the longest containing root', () => {
    expect(ownerOf('/r/.claude/worktrees/a/src', ROOTS)).toBe(WT);
    expect(ownerOf('/r/lib', ROOTS)).toBe(MAIN);
  });

  test('ownerOf does not match a sibling with a shared prefix', () => {
    expect(ownerOf('/x/goldberry-2', ['/x/goldberry', '/x/goldberry-2'])).toBe('/x/goldberry-2');
    expect(ownerOf('/x/goldberry-2', ['/x/goldberry'])).toBeNull();
  });
});

describe('worktreeAgentRows', () => {
  test('a live pane and its record make one running row', () => {
    const out = rows({
      panes: [pane({ paneId: 'w1-3', sessionId: 's1', agentStatus: 'working' })],
      agents: [record({ sessionId: 's1', caller: 'board:review' })],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      group: 'running', status: 'working', startedBy: 'board:review', target: { kind: 'pane', paneId: 'w1-3' },
    });
  });

  test('a finished record makes a recent resume row', () => {
    const out = rows({ agents: [record({ id: 'ag7', finishedAt: 5 })] });
    expect(out).toEqual([
      expect.objectContaining({ group: 'recent', status: 'ended', at: 5, target: { kind: 'resume', agentId: 'ag7' } }),
    ]);
  });

  test('a gate makes the row waiting', () => {
    const out = rows({ panes: [pane({ agentStatus: 'working', gate: { id: 'g1', question: 'ok?' } })] });
    expect(out[0].status).toBe('waiting');
  });

  test('blocked maps to waiting and unknown to idle', () => {
    const out = rows({
      panes: [pane({ paneId: 'p1', agentStatus: 'blocked' }), pane({ paneId: 'p2', agentStatus: 'unknown' })],
    });
    expect(out.map((r) => r.status)).toEqual(['waiting', 'idle']);
  });

  test('a run labels its record\'s row and adds none', () => {
    const out = rows({
      agents: [record({ sessionId: 's2' })],
      runs: [run({ session: 's2', work_type: 'work' }), run({ id: 'run2', session: 'other', work_type: 'review' })],
    });
    expect(out).toHaveLength(1);
    expect(out[0].startedBy).toBe('work run');
  });

  test('a run on another branch does not label the row', () => {
    const out = rows({ agents: [record({ sessionId: 's2' })], runs: [run({ branch: 'other', session: 's2' })] });
    expect(out[0].startedBy).toBe('rt agent');
  });

  test('a hand-started live pane says by hand', () => {
    const out = rows({ panes: [pane({ presence: { handle: 'sasha', name: 'Sasha', status: 'online' as never, rooms: [] } })] });
    expect(out[0]).toMatchObject({ title: 'sasha', startedBy: 'by hand', at: 0 });
  });

  test('panes and records in other worktrees are left out', () => {
    const out = worktreeAgentRows({
      worktreePath: MAIN, worktreeRoots: ROOTS, branch: 'main',
      panes: [pane({ paneId: 'nested', cwd: `${WT}/src` }), pane({ paneId: 'mine', cwd: '/r/lib' })],
      agents: [record({ cwd: WT })],
      runs: [],
    });
    expect(out.map((r) => r.key)).toEqual(['mine']);
  });

  test('a session live in another worktree is not a recent row here', () => {
    const out = rows({
      panes: [pane({ paneId: 'elsewhere', cwd: '/r/lib', sessionId: 's5' })],
      agents: [record({ sessionId: 's5', cwd: WT })],
    });
    expect(out).toEqual([]);
  });

  test('a record live in a pane with no session id is not a recent row', () => {
    const out = rows({
      panes: [pane({ paneId: 'w1-4', sessionId: undefined, agent: { id: 'ag3', provider: 'claude', startedAt: 2 } })],
      agents: [record({ id: 'ag3', sessionId: 's6' })],
    });
    expect(out.map((r) => r.group)).toEqual(['running']);
  });

  test('recent rows are newest first', () => {
    const out = rows({
      agents: [
        record({ id: 'old', sessionId: 'a', finishedAt: 10 }),
        record({ id: 'new', sessionId: 'b', finishedAt: 30 }),
        record({ id: 'mid', sessionId: 'c', createdAt: 20 }),
      ],
      panes: [pane({ paneId: 'live', sessionId: 'z' })],
    });
    expect(out.map((r) => r.target.kind === 'resume' ? r.target.agentId : r.target.paneId)).toEqual(['live', 'new', 'mid', 'old']);
  });
});
