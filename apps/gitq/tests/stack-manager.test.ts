import { describe, expect, test } from 'bun:test';
import { StackManager, StackError } from '../src/core/stack-manager.ts';

describe('StackManager', () => {
  // ── createStack ──────────────────────────────────────────────────────────

  test('creates an empty stack with root', () => {
    const stack = StackManager.createStack('auth', 'main');
    expect(stack.stackName).toBe('auth');
    expect(stack.root).toBe('main');
    expect(stack.nodes).toEqual([]);
  });

  // ── addNode ──────────────────────────────────────────────────────────────

  test('adds a node with root as parent', () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/auth-base', 'main');

    expect(stack.nodes).toHaveLength(1);
    expect(stack.nodes[0]!.branch).toBe('feat/auth-base');
    expect(stack.nodes[0]!.parent).toBe('main');
    expect(stack.nodes[0]!.status).toBe('local-only');
  });

  test('adds a child node', () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/auth-base', 'main');
    stack = StackManager.addNode(stack, 'feat/auth-oauth', 'feat/auth-base');

    expect(stack.nodes).toHaveLength(2);
    expect(stack.nodes[1]!.parent).toBe('feat/auth-base');
  });

  test('throws on duplicate branch', () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    expect(() => StackManager.addNode(stack, 'feat/a', 'main')).toThrow(StackError);
  });

  test('throws when parent does not exist', () => {
    const stack = StackManager.createStack('auth', 'main');
    expect(() => StackManager.addNode(stack, 'feat/a', 'nonexistent')).toThrow(StackError);
  });

  // ── removeNode ───────────────────────────────────────────────────────────

  test('removes a leaf node', () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.removeNode(stack, 'feat/a');

    expect(stack.nodes).toHaveLength(0);
  });

  test('throws when removing a node with children', () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');

    expect(() => StackManager.removeNode(stack, 'feat/a')).toThrow(StackError);
  });

  test('throws when removing a non-existent node', () => {
    const stack = StackManager.createStack('auth', 'main');
    expect(() => StackManager.removeNode(stack, 'nope')).toThrow(StackError);
  });

  // ── moveNode ─────────────────────────────────────────────────────────────

  test('moves a node to a new parent', () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'main');
    stack = StackManager.addNode(stack, 'feat/c', 'feat/a');

    stack = StackManager.moveNode(stack, 'feat/c', 'feat/b');

    const moved = StackManager.findNode(stack, 'feat/c');
    expect(moved!.parent).toBe('feat/b');
  });

  test('throws on cycle', () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');

    // trying to move A under B would create A→B→A
    expect(() => StackManager.moveNode(stack, 'feat/a', 'feat/b')).toThrow(StackError);
  });

  // ── getChildren / getDescendants ─────────────────────────────────────────

  test('getChildren returns direct children', () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'main');
    stack = StackManager.addNode(stack, 'feat/c', 'feat/a');

    const children = StackManager.getChildren(stack, 'main');
    expect(children.map((n) => n.branch).sort()).toEqual(['feat/a', 'feat/b']);
  });

  test('getDescendants returns all transitive descendants in topo-order', () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
    stack = StackManager.addNode(stack, 'feat/c', 'feat/b');
    stack = StackManager.addNode(stack, 'feat/d', 'feat/a');

    const descs = StackManager.getDescendants(stack, 'main');
    const branches = descs.map((n) => n.branch);

    // feat/a must come before feat/b and feat/d
    expect(branches.indexOf('feat/a')).toBeLessThan(branches.indexOf('feat/b'));
    expect(branches.indexOf('feat/a')).toBeLessThan(branches.indexOf('feat/d'));
    // feat/b must come before feat/c
    expect(branches.indexOf('feat/b')).toBeLessThan(branches.indexOf('feat/c'));
    // all 4 present
    expect(branches).toHaveLength(4);
  });

  // ── toposort ──────────────────────────────────────────────────────────────

  test('toposort returns all nodes', () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'a', 'main');
    stack = StackManager.addNode(stack, 'b', 'a');
    stack = StackManager.addNode(stack, 'c', 'a');

    const sorted = StackManager.toposort(stack);
    expect(sorted).toHaveLength(3);
    expect(sorted[0]!.branch).toBe('a');
  });

  // ── updateNodeStatus ──────────────────────────────────────────────────────

  test('updates node status', () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNodeStatus(stack, 'feat/a', 'synced');

    const node = StackManager.findNode(stack, 'feat/a');
    expect(node!.status).toBe('synced');
  });

  // ── updateNode ────────────────────────────────────────────────────────────

  test('patches a node with partial data', () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', {
      mrIid: 142,
      lastKnownHead: 'abc123',
      pipelineStatus: 'success',
    });

    const node = StackManager.findNode(stack, 'feat/a');
    expect(node!.mrIid).toBe(142);
    expect(node!.lastKnownHead).toBe('abc123');
    expect(node!.pipelineStatus).toBe('success');
    // unchanged fields preserved
    expect(node!.status).toBe('local-only');
  });

  // ── validate ──────────────────────────────────────────────────────────────

  test('validates a well-formed tree', () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'a', 'main');
    stack = StackManager.addNode(stack, 'b', 'a');

    expect(StackManager.validate(stack)).toEqual([]);
  });

  test('detects missing parent', () => {
    const stack: ReturnType<typeof StackManager.createStack> = {
      id: 'bad',
      stackName: 'bad',
      root: 'main',
      nodes: [
        {
          branch: 'a',
          parent: 'nonexistent',
          mrIid: null,
          mrUrl: null,
          mrTitle: null,
          status: 'local-only',
          lastKnownHead: null,
          forkPoint: null,
          diffStats: null,
          pipelineStatus: 'unknown',
          unresolvedThreads: 0,
        },
      ],
    };

    const issues = StackManager.validate(stack);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain('missing parent');
  });

  // ── renameBranch ──────────────────────────────────────────────────────────

  test('renameBranch updates node and children parentBranch', () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/old', 'main');
    stack = StackManager.addNode(stack, 'feat/child', 'feat/old');

    stack = StackManager.renameBranch(stack, 'feat/old', 'feat/new');

    const renamed = StackManager.findNode(stack, 'feat/new');
    expect(renamed).toBeDefined();
    expect(renamed!.branch).toBe('feat/new');

    const child = StackManager.findNode(stack, 'feat/child');
    expect(child!.parent).toBe('feat/new');

    expect(StackManager.findNode(stack, 'feat/old')).toBeUndefined();
  });

  test('renameBranch throws on nonexistent branch', () => {
    const stack = StackManager.createStack('auth', 'main');
    expect(() => StackManager.renameBranch(stack, 'nope', 'new')).toThrow(StackError);
  });

  test('renameBranch throws when newBranch already exists', () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'main');

    expect(() => StackManager.renameBranch(stack, 'feat/a', 'feat/b')).toThrow(StackError);
  });

  // ── toggleUnmanaged ─────────────────────────────────────────────────────

  test('toggleUnmanaged sets unmanaged to true', () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');

    stack = StackManager.toggleUnmanaged(stack, 'feat/a');

    const node = StackManager.findNode(stack, 'feat/a');
    expect(node!.unmanaged).toBe(true);
  });

  test('toggleUnmanaged on already-unmanaged node clears the flag', () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');

    stack = StackManager.toggleUnmanaged(stack, 'feat/a');
    expect(StackManager.findNode(stack, 'feat/a')!.unmanaged).toBe(true);

    stack = StackManager.toggleUnmanaged(stack, 'feat/a');
    expect(StackManager.findNode(stack, 'feat/a')!.unmanaged).toBe(false);
  });

  test('toggleUnmanaged throws on nonexistent branch', () => {
    const stack = StackManager.createStack('auth', 'main');
    expect(() => StackManager.toggleUnmanaged(stack, 'nope')).toThrow(StackError);
  });

  // ── Immutability ──────────────────────────────────────────────────────────

  test('mutations do not modify the original stack', () => {
    const original = StackManager.createStack('auth', 'main');
    const withNode = StackManager.addNode(original, 'a', 'main');

    expect(original.nodes).toHaveLength(0);
    expect(withNode.nodes).toHaveLength(1);
  });
});
