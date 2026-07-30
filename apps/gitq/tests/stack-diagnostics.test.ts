import { describe, test, expect } from 'bun:test';
import { diagnoseStack } from '../src/core/stack-diagnostics.ts';
import type { StackSnapshot, BranchSnapshot, StackDiagnostics } from '../src/core/stack-diagnostics.ts';
import type { Stack, StackNode } from '../src/core/types.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNode(branch: string, parent: string, overrides: Partial<StackNode> = {}): StackNode {
  return {
    branch,
    parent,
    status: 'synced',
    lastKnownHead: '',
    forkPoint: '',
    mrIid: null,
    mrUrl: null,
    mrTitle: null,
    diffStats: null,
    unresolvedThreads: 0,
    pipelineStatus: 'unknown',
    unmanaged: false,
    ...overrides,
  };
}

function makeStack(root: string, nodes: StackNode[]): Stack {
  return {
    id: 'test-stack-id',
    stackName: 'test-stack',
    root,
    nodes,
  };
}

function makeBranchSnapshot(branch: string, overrides: Partial<BranchSnapshot> = {}): BranchSnapshot {
  return {
    branch,
    existsOnRemote: true,
    upToDateWithParent: true,
    tombstoneDrifted: null,
    divergence: { state: 'identical', ahead: 0, behind: 0 },
    ...overrides,
  };
}

function makeSnapshot(
  branches: BranchSnapshot[],
  overrides: Partial<Omit<StackSnapshot, 'branches'>> = {},
): StackSnapshot {
  return {
    currentBranch: '',
    isDirty: false,
    hasStagedChanges: false,
    rebaseInProgress: false,
    branches: new Map(branches.map((b) => [b.branch, b])),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('diagnoseStack', () => {
  test('all synced — no actions needed', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main'),
      makeNode('feat/oauth', 'feat/auth'),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth'),
      makeBranchSnapshot('feat/oauth'),
    ]);

    const result = diagnoseStack(snapshot, stack);

    const auth = result.nodes.get('feat/auth')!;
    expect(auth.situation).toBe('synced');
    expect(auth.badge).toBeNull();
    expect(auth.primaryAction).toBeNull();
    expect(auth.removal.allowed).toBe(false); // has children

    const oauth = result.nodes.get('feat/oauth')!;
    expect(oauth.situation).toBe('synced');
    expect(oauth.removal.allowed).toBe(true); // leaf
  });

  test('parent merged — child gets cascade action', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main', { status: 'merged', lastKnownHead: 'abc123' }),
      makeNode('feat/oauth', 'feat/auth'),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth'),
      makeBranchSnapshot('feat/oauth'),
    ]);

    const result = diagnoseStack(snapshot, stack);

    // The merged node itself
    const auth = result.nodes.get('feat/auth')!;
    expect(auth.situation).toBe('parent-merged');
    expect(auth.badge!.label).toBe('Merged');
    expect(auth.primaryAction!.id).toBe('cascade-merged');

    // The child whose parent is merged
    const oauth = result.nodes.get('feat/oauth')!;
    expect(oauth.situation).toBe('parent-merged');
    expect(oauth.primaryAction!.id).toBe('cascade-merged');
    expect(oauth.removal.allowed).toBe(false);
  });

  test('parent merged + tombstone drifted — needs reconciliation', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main', { status: 'merged', lastKnownHead: 'abc123' }),
      makeNode('feat/oauth', 'feat/auth'),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth'),
      makeBranchSnapshot('feat/oauth', { tombstoneDrifted: true }),
    ]);

    const result = diagnoseStack(snapshot, stack);

    const oauth = result.nodes.get('feat/oauth')!;
    expect(oauth.situation).toBe('parent-merged-drifted');
    expect(oauth.statusLine).toContain('drift reconciliation');
  });

  test('merged leaf — safe to remove', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main', { status: 'merged', lastKnownHead: 'abc123' }),
    ]);
    const snapshot = makeSnapshot([makeBranchSnapshot('feat/auth')]);

    const result = diagnoseStack(snapshot, stack);

    const auth = result.nodes.get('feat/auth')!;
    expect(auth.situation).toBe('parent-merged');
    expect(auth.statusLine).toContain('safe to remove');
    expect(auth.primaryAction!.id).toBe('remove-branch');
    expect(auth.removal.allowed).toBe(true);
  });

  test('behind parent — needs rebase', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main'),
      makeNode('feat/oauth', 'feat/auth'),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth'),
      makeBranchSnapshot('feat/oauth', { upToDateWithParent: false }),
    ]);

    const result = diagnoseStack(snapshot, stack);

    const oauth = result.nodes.get('feat/oauth')!;
    expect(oauth.situation).toBe('behind-parent');
    expect(oauth.badge!.label).toBe('Behind');
    expect(oauth.primaryAction!.id).toBe('sync-stack');
  });

  test('drift — MR target mismatch', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main'),
      makeNode('feat/oauth', 'feat/auth', { status: 'drift' }),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth'),
      makeBranchSnapshot('feat/oauth'),
    ]);

    const result = diagnoseStack(snapshot, stack);

    const oauth = result.nodes.get('feat/oauth')!;
    expect(oauth.situation).toBe('drift');
    expect(oauth.badge!.label).toBe('Drift');
    expect(oauth.primaryAction!.id).toBe('retarget-mr');
  });

  test('drift + parent merged — needs sync not retarget', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main', { status: 'merged', lastKnownHead: 'abc123' }),
      makeNode('feat/oauth', 'feat/auth', { status: 'drift' }),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth'),
      makeBranchSnapshot('feat/oauth'),
    ]);

    const result = diagnoseStack(snapshot, stack);

    const oauth = result.nodes.get('feat/oauth')!;
    expect(oauth.situation).toBe('drift-parent-merged');
    expect(oauth.primaryAction!.id).toBe('sync-stack');
  });

  test('local-only — needs publish', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main', { status: 'local-only' }),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth', {
        existsOnRemote: false,
        divergence: { state: 'remote-gone', ahead: 0, behind: 0 },
      }),
    ]);

    const result = diagnoseStack(snapshot, stack);

    const auth = result.nodes.get('feat/auth')!;
    expect(auth.situation).toBe('local-only');
    expect(auth.badge!.label).toBe('Local');
    expect(auth.primaryAction!.id).toBe('publish-stack');
  });

  test('local/remote diverged — force-push detection', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main'),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth', {
        divergence: { state: 'diverged', ahead: 2, behind: 3 },
      }),
    ]);

    const result = diagnoseStack(snapshot, stack);

    const auth = result.nodes.get('feat/auth')!;
    expect(auth.situation).toBe('local-remote-diverged');
    expect(auth.badge!.label).toBe('Diverged');
    expect(auth.primaryAction!.id).toBe('reset-to-remote');
    expect(auth.statusLine).toContain('2 ahead');
    expect(auth.statusLine).toContain('3 behind');
  });

  test('branch deleted on remote — needs removal', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main'),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth', {
        existsOnRemote: false,
        divergence: { state: 'remote-gone', ahead: 0, behind: 0 },
      }),
    ]);

    const result = diagnoseStack(snapshot, stack);

    const auth = result.nodes.get('feat/auth')!;
    expect(auth.situation).toBe('branch-deleted-remote');
    expect(auth.badge!.label).toBe('Deleted');
    expect(auth.primaryAction!.id).toBe('remove-branch');
  });

  test('branch deleted on remote but live MR state is merged... reads as merged', () => {
    // Stored status lags until a reconcile runs; the board already holds the
    // live MR state, and a freshly merged branch must not scare as Deleted.
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main'),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth', {
        existsOnRemote: false,
        divergence: { state: 'remote-gone', ahead: 0, behind: 0 },
      }),
    ]);

    const result = diagnoseStack(snapshot, stack, new Map([['feat/auth', 'merged']]));

    const auth = result.nodes.get('feat/auth')!;
    expect(auth.situation).toBe('branch-deleted-remote');
    expect(auth.badge!.label).toBe('Merged');
    expect(auth.badge!.variant).toBe('merge');
    expect(auth.statusLine).toBe('Merged and removed from remote');
    expect(auth.primaryAction!.id).toBe('remove-branch');
    expect(auth.secondaryActions).toEqual([]);
  });

  test('branch deleted on remote with live MR state closed... stays Deleted', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main'),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth', {
        existsOnRemote: false,
        divergence: { state: 'remote-gone', ahead: 0, behind: 0 },
      }),
    ]);

    const result = diagnoseStack(snapshot, stack, new Map([['feat/auth', 'closed']]));

    const auth = result.nodes.get('feat/auth')!;
    expect(auth.badge!.label).toBe('Deleted');
    expect(auth.secondaryActions.some((a) => a.id === 'sync-stack')).toBe(true);
  });

  test('rebase in progress — shows continue/abort', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main'),
    ]);
    const snapshot = makeSnapshot(
      [makeBranchSnapshot('feat/auth')],
      { currentBranch: 'feat/auth', rebaseInProgress: true },
    );

    const result = diagnoseStack(snapshot, stack);

    const auth = result.nodes.get('feat/auth')!;
    expect(auth.situation).toBe('rebase-in-progress');
    expect(auth.primaryAction!.id).toBe('continue-rebase');
    expect(auth.secondaryActions).toHaveLength(1);
    expect(auth.secondaryActions[0]!.id).toBe('abort-rebase');
  });

  test('CI failed — warning badge', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main', { pipelineStatus: 'failed' }),
    ]);
    const snapshot = makeSnapshot([makeBranchSnapshot('feat/auth')]);

    const result = diagnoseStack(snapshot, stack);

    const auth = result.nodes.get('feat/auth')!;
    expect(auth.situation).toBe('ci-failed');
    expect(auth.badge!.label).toBe('CI Failed');
  });

  test('unresolved threads — warning badge', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main', { unresolvedThreads: 3 }),
    ]);
    const snapshot = makeSnapshot([makeBranchSnapshot('feat/auth')]);

    const result = diagnoseStack(snapshot, stack);

    const auth = result.nodes.get('feat/auth')!;
    expect(auth.situation).toBe('has-threads');
    expect(auth.badge!.label).toBe('3 threads');
  });

  test('unknown thread count — flagged as unknown, not as resolved', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main', { unresolvedThreads: null }),
    ]);
    const snapshot = makeSnapshot([makeBranchSnapshot('feat/auth')]);

    const result = diagnoseStack(snapshot, stack);

    const auth = result.nodes.get('feat/auth')!;
    expect(auth.situation).toBe('has-threads');
    expect(auth.statusLine).toBe('unresolved threads: unknown');
    expect(auth.badge!.label).toBe('threads?');
  });

  test('dirty working tree — adds global block', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main'),
    ]);
    const snapshot = makeSnapshot(
      [makeBranchSnapshot('feat/auth')],
      { isDirty: true },
    );

    const result = diagnoseStack(snapshot, stack);

    expect(result.globalBlocks).toContain('Working tree has uncommitted changes');
    const auth = result.nodes.get('feat/auth')!;
    expect(auth.blocked!.reason).toContain('uncommitted');
  });

  // ── Banner tests ──

  test('banner: merged with children → non-dismissable', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main', { status: 'merged', lastKnownHead: 'abc' }),
      makeNode('feat/oauth', 'feat/auth'),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth'),
      makeBranchSnapshot('feat/oauth'),
    ]);

    const result = diagnoseStack(snapshot, stack);
    expect(result.banner).not.toBeNull();
    expect(result.banner!.kind).toBe('merged');
    if (result.banner!.kind === 'merged') {
      expect(result.banner!.canDismiss).toBe(false);
    }
  });

  test('banner: merged leaf → dismissable', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main', { status: 'merged', lastKnownHead: 'abc' }),
    ]);
    const snapshot = makeSnapshot([makeBranchSnapshot('feat/auth')]);

    const result = diagnoseStack(snapshot, stack);
    expect(result.banner!.kind).toBe('merged');
    if (result.banner!.kind === 'merged') {
      expect(result.banner!.canDismiss).toBe(true);
    }
  });

  test('banner: rebase in progress takes priority', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main', { status: 'merged' }),
    ]);
    const snapshot = makeSnapshot(
      [makeBranchSnapshot('feat/auth')],
      { rebaseInProgress: true, currentBranch: 'feat/auth' },
    );

    const result = diagnoseStack(snapshot, stack);
    expect(result.banner!.kind).toBe('rebase-in-progress');
  });

  test('banner: behind-trunk when children are behind parent', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main'),
      makeNode('feat/oauth', 'feat/auth'),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth', { upToDateWithParent: false }),
      makeBranchSnapshot('feat/oauth', { upToDateWithParent: false }),
    ]);

    const result = diagnoseStack(snapshot, stack);
    expect(result.banner!.kind).toBe('behind-trunk');
  });

  // ── Edge tests ──

  test('edge: synced → emphasis, solid, no badge', () => {
    const stack = makeStack('main', [makeNode('feat/auth', 'main')]);
    const snapshot = makeSnapshot([makeBranchSnapshot('feat/auth')]);

    const result = diagnoseStack(snapshot, stack);
    expect(result.edges).toHaveLength(1);
    const edge = result.edges[0]!;
    expect(edge.source).toBe('main');
    expect(edge.target).toBe('feat/auth');
    expect(edge.dashed).toBe(false);
    expect(edge.dimmed).toBe(false);
    expect(edge.badge).toBeNull();
  });

  test('edge: local-only → dashed', () => {
    const stack = makeStack('main', [makeNode('feat/auth', 'main', { status: 'local-only' })]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth', {
        existsOnRemote: false,
        divergence: { state: 'remote-gone', ahead: 0, behind: 0 },
      }),
    ]);

    const result = diagnoseStack(snapshot, stack);
    expect(result.edges[0]!.dashed).toBe(true);
  });

  test('edge: parent-merged → merge badge', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main', { status: 'merged', lastKnownHead: 'abc' }),
      makeNode('feat/oauth', 'feat/auth'),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth'),
      makeBranchSnapshot('feat/oauth'),
    ]);

    const result = diagnoseStack(snapshot, stack);
    const oauthEdge = result.edges.find((e) => e.target === 'feat/oauth')!;
    expect(oauthEdge.badge!.icon).toBe('git-merge');
    expect(oauthEdge.badge!.variant).toBe('merge');
  });

  // ── Removal tests ──

  test('removal: node with children → blocked', () => {
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main'),
      makeNode('feat/oauth', 'feat/auth'),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth'),
      makeBranchSnapshot('feat/oauth'),
    ]);

    const result = diagnoseStack(snapshot, stack);
    expect(result.nodes.get('feat/auth')!.removal.allowed).toBe(false);
    expect(result.nodes.get('feat/oauth')!.removal.allowed).toBe(true);
  });

  // ── Edge case tests ──

  test('edge case: unmanaged branch still gets classified', () => {
    // Unmanaged branches are skipped by the *rebase engine*, but the
    // diagnostics should still classify them so the UI can show their state.
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main', { unmanaged: true }),
    ]);
    const snapshot = makeSnapshot([makeBranchSnapshot('feat/auth')]);

    const result = diagnoseStack(snapshot, stack);
    const auth = result.nodes.get('feat/auth')!;
    // Should still get a situation, not be silently skipped
    expect(auth.situation).toBe('synced');
    expect(auth).toBeDefined();
  });

  test('edge case: behind-parent overrides ci-failed (priority)', () => {
    // When a branch is both behind parent AND has CI failure,
    // behind-parent should win because it's a structural issue that
    // blocks all other work. CI failure is cosmetic in comparison.
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main', { pipelineStatus: 'failed' }),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth', { upToDateWithParent: false }),
    ]);

    const result = diagnoseStack(snapshot, stack);
    const auth = result.nodes.get('feat/auth')!;
    expect(auth.situation).toBe('behind-parent');
    // CI failure is a secondary concern when structural issues exist
  });

  test('edge case: chain of 3 merged parents (A→B→C all merged)', () => {
    // When multiple parents in a chain are merged, the deepest child
    // should still see parent-merged and get the cascade action.
    const stack = makeStack('main', [
      makeNode('feat/a', 'main', { status: 'merged', lastKnownHead: 'sha-a' }),
      makeNode('feat/b', 'feat/a', { status: 'merged', lastKnownHead: 'sha-b' }),
      makeNode('feat/c', 'feat/b'),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/a'),
      makeBranchSnapshot('feat/b'),
      makeBranchSnapshot('feat/c'),
    ]);

    const result = diagnoseStack(snapshot, stack);

    // A is merged with children → cascade
    expect(result.nodes.get('feat/a')!.situation).toBe('parent-merged');
    expect(result.nodes.get('feat/a')!.primaryAction!.id).toBe('cascade-merged');

    // B: its parent A is merged. B's own status is also merged, but the
    // drift-parent-merged check comes first (B has status drift? no, merged).
    // Actually B's parent (A) is merged → B gets parent-merged situation
    const b = result.nodes.get('feat/b')!;
    expect(b.situation).toBe('parent-merged');

    // C: its parent B is merged → C gets parent-merged
    const c = result.nodes.get('feat/c')!;
    expect(c.situation).toBe('parent-merged');
    expect(c.primaryAction!.id).toBe('cascade-merged');
  });

  test('edge case: missing snapshot data — branch not in snapshot map', () => {
    // If collectSnapshot fails for a specific branch, that branch shouldn't
    // crash the whole classification — it should degrade gracefully.
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main'),
      makeNode('feat/missing', 'feat/auth'),
    ]);
    // Only put auth in the snapshot, not feat/missing
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth'),
    ]);

    const result = diagnoseStack(snapshot, stack);

    // feat/missing should still get classified (with no snapshot data)
    const missing = result.nodes.get('feat/missing')!;
    expect(missing).toBeDefined();
    // With no snapshot data, it should default to synced (no evidence of problems)
    expect(missing.situation).toBe('synced');
  });

  test('edge case: deep 10-branch linear stack — all synced', () => {
    const nodes = [];
    const snapshots = [];
    for (let i = 1; i <= 10; i++) {
      const parent = i === 1 ? 'main' : `feat/layer-${i - 1}`;
      nodes.push(makeNode(`feat/layer-${i}`, parent));
      snapshots.push(makeBranchSnapshot(`feat/layer-${i}`));
    }
    const stack = makeStack('main', nodes);
    const snapshot = makeSnapshot(snapshots);

    const result = diagnoseStack(snapshot, stack);

    // All should be synced
    for (let i = 1; i <= 10; i++) {
      expect(result.nodes.get(`feat/layer-${i}`)!.situation).toBe('synced');
    }
    // Only the deepest leaf should allow removal
    expect(result.nodes.get('feat/layer-10')!.removal.allowed).toBe(true);
    expect(result.nodes.get('feat/layer-9')!.removal.allowed).toBe(false);

    // Should have 10 edges
    expect(result.edges).toHaveLength(10);
  });

  test('edge case: diverged + behind-parent — diverged wins', () => {
    // A branch that is both diverged from remote AND behind its parent.
    // Diverged is higher priority because it's a more fundamental problem —
    // you can't rebase a diverged branch without resolving divergence first.
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main'),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth', {
        upToDateWithParent: false,
        divergence: { state: 'diverged', ahead: 1, behind: 2 },
      }),
    ]);

    const result = diagnoseStack(snapshot, stack);
    const auth = result.nodes.get('feat/auth')!;
    expect(auth.situation).toBe('local-remote-diverged');
    // The behind-parent issue is masked by the higher-priority divergence
  });

  test('edge case: rebase-in-progress but on a DIFFERENT branch', () => {
    // If a rebase is in progress on branch X, branch Y should NOT get
    // the rebase-in-progress situation. It should get a global block instead.
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main'),
      makeNode('feat/other', 'main'),
    ]);
    const snapshot = makeSnapshot(
      [makeBranchSnapshot('feat/auth'), makeBranchSnapshot('feat/other')],
      { currentBranch: 'feat/auth', rebaseInProgress: true },
    );

    const result = diagnoseStack(snapshot, stack);

    // The branch WITH the rebase gets rebase-in-progress
    expect(result.nodes.get('feat/auth')!.situation).toBe('rebase-in-progress');

    // The OTHER branch should NOT get rebase-in-progress situation,
    // but should have a global block
    const other = result.nodes.get('feat/other')!;
    expect(other.situation).not.toBe('rebase-in-progress');
    expect(other.blocked).not.toBeNull();
    expect(other.blocked!.reason).toContain('Rebase in progress');
  });

  test('edge case: single-node stack', () => {
    const stack = makeStack('main', [
      makeNode('feat/solo', 'main'),
    ]);
    const snapshot = makeSnapshot([makeBranchSnapshot('feat/solo')]);

    const result = diagnoseStack(snapshot, stack);
    expect(result.nodes.size).toBe(1);
    expect(result.edges).toHaveLength(1);
    expect(result.nodes.get('feat/solo')!.situation).toBe('synced');
    expect(result.nodes.get('feat/solo')!.removal.allowed).toBe(true);
  });

  test('edge case: behind-parent + unresolved threads — behind-parent wins', () => {
    // Structural issues (behind-parent) should always take priority over
    // cosmetic issues (threads). The user needs to sync before worrying
    // about review threads.
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main', { unresolvedThreads: 5 }),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth', { upToDateWithParent: false }),
    ]);

    const result = diagnoseStack(snapshot, stack);
    const auth = result.nodes.get('feat/auth')!;
    expect(auth.situation).toBe('behind-parent');
    // Threads are a secondary concern
  });

  test('edge case: drift + behind-parent — different priorities', () => {
    // When a branch has both drift (MR target mismatch) AND is behind parent,
    // behind-parent should win since drift might be resolved by the sync.
    const stack = makeStack('main', [
      makeNode('feat/auth', 'main', { status: 'drift' }),
    ]);
    const snapshot = makeSnapshot([
      makeBranchSnapshot('feat/auth', { upToDateWithParent: false }),
    ]);

    const result = diagnoseStack(snapshot, stack);
    const auth = result.nodes.get('feat/auth')!;
    expect(auth.situation).toBe('behind-parent');
  });
});

