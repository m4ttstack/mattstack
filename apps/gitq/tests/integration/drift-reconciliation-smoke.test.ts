/**
 * Drift reconciliation smoke test — mirrors the real-world acme-1231/acme-1233/acme-1234
 * stacking scenario where a parent branch receives review commits after children
 * branched, then is squash-merged.
 *
 * Uses real sandbox git repos with a local bare remote, and a mock forge provider
 * to simulate MR detection and merge status changes.
 *
 * Scenario modeled:
 *   main → feat/refactor (parent)
 *        → feat/extract  (child, branches before parent's review commits)
 *        → feat/images   (grandchild, branches from extract)
 *
 *   1. Parent gets review commits that child never picked up
 *   2. Parent is squash-merged into main
 *   3. ForgeSync detects the merge
 *   4. cascadeRebase reconciles child drift, then restacks child + grandchild
 *   5. All content survives, branches push cleanly
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { writeFile, readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { GitProvider, PullRequest } from '@workforge/glance-sdk';
import { GitShell } from '../../src/core/git-shell.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
import { ForgeSync } from '../../src/core/forge-sync.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import {
  createSandboxRepoWithRemote,
  cleanupRepo,
  commit,
} from './helpers.ts';

const dirs: string[] = [];

async function commitNested(
  dir: string,
  git: (...args: string[]) => string,
  filename: string,
  content: string,
  message: string,
): Promise<string> {
  const fullPath = join(dir, filename);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf-8');
  git('add', filename);
  git('commit', '-m', message);
  return git('rev-parse', 'HEAD');
}

afterEach(async () => {
  for (const d of dirs) await cleanupRepo(d);
  dirs.length = 0;
});

// ── Mock forge helpers ───────────────────────────────────────────────────────

function mockPR(
  overrides: Partial<PullRequest> & { sourceBranch: string; targetBranch: string },
): PullRequest {
  return {
    id: `gitlab:${overrides.iid ?? 1}`,
    iid: overrides.iid ?? 1,
    repositoryId: 'gitlab:42',
    title: overrides.title ?? `MR for ${overrides.sourceBranch}`,
    description: null,
    state: overrides.state ?? 'opened',
    draft: false,
    conflicts: false,
    webUrl: `https://gitlab.com/-/mr/${overrides.iid ?? 1}`,
    sourceBranch: overrides.sourceBranch,
    targetBranch: overrides.targetBranch,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    sha: overrides.sha ?? 'abc123',
    author: {
      id: 'gitlab:user:1',
      username: 'dev',
      name: 'Dev',
      avatarUrl: null,
    },
    assignees: [],
    reviewers: [],
    roles: ['author'],
    pipeline: overrides.pipeline ?? null,
    unresolvedThreadCount: 0,
    approvalsLeft: 0,
    approved: false,
    approvedBy: [],
    diffStats: overrides.diffStats ?? { additions: 10, deletions: 5, filesChanged: 3 },
    detailedMergeStatus: null,
    autoMergeEnabled: false,
    autoMergeStrategy: null,
    mergeUser: null,
    mergeAfter: null,
    divergedCommitsCount: null,
    rebaseInProgress: false,
    mergeOngoing: false,
    inProgressMergeCommitSha: null,
    mergeError: null,
    shouldBeRebased: false,
    mergeabilityChecks: [],
    blockingMergeRequestsCount: 0,
    approvalsRequired: 0,
    squash: false,
    squashOnMerge: false,
    mergeTrainIndex: null,
  };
}

function mockProvider(prs: PullRequest[]): GitProvider {
  return {
    providerName: 'gitlab',
    baseURL: 'https://gitlab.com',
    validateToken: () =>
      Promise.resolve({ id: 'gitlab:user:1', username: 'dev', name: 'Dev', avatarUrl: null }),
    fetchPullRequests: () => Promise.resolve(prs),
    fetchSingleMR: (_, mrIid) => {
      const pr = prs.find((p) => p.iid === mrIid);
      return Promise.resolve(pr ?? null);
    },
    fetchPullRequestByBranch: () => Promise.resolve(null),
    createPullRequest: () => Promise.reject(new Error('not implemented')),
    updatePullRequest: () => Promise.reject(new Error('not implemented')),
    fetchBranchProtectionRules: () => Promise.resolve([]),
    deleteBranch: () => Promise.resolve(),
    fetchMRDiscussions: () =>
      Promise.resolve({ mrIid: 0, repositoryId: '', discussions: [] }),
    restRequest: () => Promise.reject(new Error('not implemented')),
    capabilities: {
      canMerge: true,
      canApprove: true,
      canUnapprove: true,
      canRebase: true,
      canAutoMerge: true,
      canResolveDiscussions: true,
      canRetryPipeline: true,
      canRequestReReview: true,
    },
    mergePullRequest: () => Promise.reject(new Error('not implemented')),
    approvePullRequest: () => Promise.reject(new Error('not implemented')),
    unapprovePullRequest: () => Promise.reject(new Error('not implemented')),
    rebasePullRequest: () => Promise.reject(new Error('not implemented')),
    setAutoMerge: () => Promise.reject(new Error('not implemented')),
    cancelAutoMerge: () => Promise.reject(new Error('not implemented')),
    resolveDiscussion: () => Promise.reject(new Error('not implemented')),
    unresolveDiscussion: () => Promise.reject(new Error('not implemented')),
    retryPipeline: () => Promise.reject(new Error('not implemented')),
    retryJob: () => Promise.reject(new Error('not implemented')),
    fetchJobTrace: () => Promise.reject(new Error('not implemented')),
    fetchDownstreamPipeline: () => Promise.resolve(null),
    fetchJobDetail: () => Promise.reject(new Error('not implemented')),
    requestReReview: () => Promise.reject(new Error('not implemented')),
    watchMR: () => () => {},
  };
}

// ── Simulate squash-merge on the remote ──────────────────────────────────────

async function squashMergeOnRemote(
  remoteDir: string,
  branchName: string,
  squashMessage: string,
) {
  const cloneDir = await mkdtemp(join(tmpdir(), 'gitq-squash-'));
  try {
    execFileSync('git', ['clone', remoteDir, cloneDir], { stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'ci@gitq.dev'], {
      cwd: cloneDir,
      stdio: 'pipe',
    });
    execFileSync('git', ['config', 'user.name', 'CI Bot'], {
      cwd: cloneDir,
      stdio: 'pipe',
    });
    execFileSync('git', ['merge', '--squash', `origin/${branchName}`], {
      cwd: cloneDir,
      stdio: 'pipe',
    });
    execFileSync('git', ['commit', '-m', squashMessage], {
      cwd: cloneDir,
      stdio: 'pipe',
    });
    execFileSync('git', ['push', 'origin', 'main'], {
      cwd: cloneDir,
      stdio: 'pipe',
    });
  } finally {
    await cleanupRepo(cloneDir);
  }
}

// ── Full scenario ────────────────────────────────────────────────────────────

describe('Stacked MR drift reconciliation: end-to-end smoke test', () => {
  test('parent gets review commits, squash-merges, children reconcile and restack', async () => {
    const r = await createSandboxRepoWithRemote();
    dirs.push(r.dir, r.remoteDir);

    // ── Phase 1: Build the initial 3-branch stack ──────────────────────
    // Mirrors: acme-1231 (refactor) → acme-1233 (extract) → acme-1234 (images)

    // feat/refactor: VehicleImage truth-table rewrite + dark mode story
    r.git('checkout', '-b', 'feat/refactor');
    await commit(
      r.dir, r.git,
      'VehicleImage.tsx',
      'export function VehicleImage() { return <div>truth-table</div>; }\n',
      'refactor: rewrite VehicleImage as truth-table',
    );
    await commit(
      r.dir, r.git,
      'VehicleImage.stories.tsx',
      'export const DarkMode = { args: { theme: "dark" } };\n',
      'refactor: add dark mode Storybook story',
    );

    // feat/extract branches from feat/refactor — extracts into a package
    r.git('checkout', '-b', 'feat/extract');
    await commitNested(
      r.dir, r.git,
      'packages/vehicle-image/package.json',
      '{ "name": "@app/vehicle-image", "version": "1.0.0" }\n',
      'extract: create vehicle-image package',
    );
    await commitNested(
      r.dir, r.git,
      'packages/vehicle-image/codegen.ts',
      'export const codegen = { plugin: "graphql-codegen" };\n',
      'extract: replace schema script with codegen plugin',
    );

    // feat/images branches from feat/extract — adds new images
    r.git('checkout', '-b', 'feat/images');
    await commitNested(
      r.dir, r.git,
      'packages/vehicle-image/assets/commercial.svg',
      '<svg>commercial vehicle</svg>\n',
      'images: add commercial vehicle images',
    );
    await commitNested(
      r.dir, r.git,
      'packages/vehicle-image/assets/motorcycle.svg',
      '<svg>motorcycle</svg>\n',
      'images: add motorcycle images',
    );

    // Push all branches to remote
    r.git('checkout', 'main');
    for (const branch of ['feat/refactor', 'feat/extract', 'feat/images']) {
      r.git('push', '-u', 'origin', branch);
    }

    // ── Phase 2: Parent gets review commits AFTER children branched ────
    // Mirrors: acme-1231 got injury overlay and wireframe commits during review

    r.git('checkout', 'feat/refactor');
    await commitNested(
      r.dir, r.git,
      'components/wireframes.tsx',
      'export const SedanWireframe = () => <svg>sedan outline</svg>;\n' +
      'export const SUVWireframe = () => <svg>suv outline</svg>;\n',
      'refactor: add inline SVG wireframe components (review feedback)',
    );
    await commit(
      r.dir, r.git,
      'VehicleImage.tsx',
      'import { SedanWireframe } from "./components/wireframes";\n' +
      'export function VehicleImage() { return <SedanWireframe />; }\n',
      'refactor: use wireframe components in VehicleImage (review feedback)',
    );
    await commitNested(
      r.dir, r.git,
      'components/InjuryOverlay.tsx',
      'export function InjuryOverlay() { return <div>overlay</div>; }\n',
      'refactor: improve injury overlay theme rendering (review feedback)',
    );

    const refactorFinalHead = r.git('rev-parse', 'feat/refactor');
    r.git('push', 'origin', 'feat/refactor');

    // Record heads for the stack
    const extractHead = r.git('rev-parse', 'feat/extract');
    const imagesHead = r.git('rev-parse', 'feat/images');
    r.git('checkout', 'main');

    // ── Phase 3: Squash-merge feat/refactor into main on the remote ────
    await squashMergeOnRemote(
      r.remoteDir,
      'feat/refactor',
      'squash: VehicleImage architecture refactor (ACME-1231)',
    );

    // Fetch so local repo sees the merge
    r.git('fetch', 'origin');
    const mainHead = r.git('rev-parse', 'origin/main');

    // ── Phase 4: Build the stack model with forge sync ─────────────────

    let stack = StackManager.createStack('vehicle-stack', 'main');
    stack = StackManager.addNode(stack, 'feat/refactor', 'main');
    stack = StackManager.updateNode(stack, 'feat/refactor', {
      lastKnownHead: refactorFinalHead,
      mrIid: 100,
      status: 'synced',
    });
    stack = StackManager.addNode(stack, 'feat/extract', 'feat/refactor');
    stack = StackManager.updateNode(stack, 'feat/extract', {
      lastKnownHead: extractHead,
      mrIid: 101,
      status: 'synced',
    });
    stack = StackManager.addNode(stack, 'feat/images', 'feat/extract');
    stack = StackManager.updateNode(stack, 'feat/images', {
      lastKnownHead: imagesHead,
      mrIid: 102,
      status: 'synced',
    });

    // ForgeSync detects that feat/refactor is merged
    const forgePRs = [
      mockPR({
        iid: 100,
        sourceBranch: 'feat/refactor',
        targetBranch: 'main',
        state: 'merged',
      }),
      mockPR({
        iid: 101,
        sourceBranch: 'feat/extract',
        targetBranch: 'feat/refactor',
      }),
      mockPR({
        iid: 102,
        sourceBranch: 'feat/images',
        targetBranch: 'feat/extract',
      }),
    ];

    const syncResult = await ForgeSync.syncStack(mockProvider(forgePRs), stack);

    expect(syncResult.newlyMerged).toEqual(['feat/refactor']);
    expect(
      StackManager.findNode(syncResult.updatedStack, 'feat/refactor')!.status,
    ).toBe('merged');

    // ── Phase 5: Preflight should detect drift ────────────────────────

    const preflightStack = syncResult.updatedStack;
    const preflightReport = await RebaseEngine.preflight(
      r.dir, preflightStack, ['feat/extract', 'feat/images'],
    );

    expect(preflightReport.driftWarnings).toEqual([
      { branch: 'feat/extract', mergedParent: 'feat/refactor' },
    ]);

    // ── Phase 6: Cascade rebase with drift reconciliation ─────────────

    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      const cascadeResult = await RebaseEngine.cascadeRebase(
        r.dir, preflightStack, 'feat/refactor', mainHead,
      );

      expect(cascadeResult.state).toBe('completed');
      expect(cascadeResult.results.every((rr) => rr.success)).toBe(true);

      // ── Phase 7: Verify branch topology ─────────────────────────────

      // feat/extract sits on top of main
      const extractMB = await GitShell.getMergeBase(r.dir, 'origin/main', 'feat/extract');
      expect(extractMB).toBe(mainHead);

      // feat/images sits on top of feat/extract
      const newExtractHead = await GitShell.getBranchHead(r.dir, 'feat/extract');
      const imagesMB = await GitShell.getMergeBase(r.dir, 'feat/extract', 'feat/images');
      expect(imagesMB).toBe(newExtractHead);

      // ── Phase 8: Verify file content survival ───────────────────────

      // feat/extract should have:
      //   - Its own package files
      //   - Parent's review commits (wireframes, updated VehicleImage, InjuryOverlay)
      r.git('checkout', 'feat/extract');

      const packageJson = await readFile(
        join(r.dir, 'packages/vehicle-image/package.json'), 'utf-8',
      );
      expect(packageJson).toContain('@app/vehicle-image');

      const codegen = await readFile(
        join(r.dir, 'packages/vehicle-image/codegen.ts'), 'utf-8',
      );
      expect(codegen).toContain('graphql-codegen');

      // These files came from the parent's review commits (drift reconciliation)
      const wireframes = await readFile(
        join(r.dir, 'components/wireframes.tsx'), 'utf-8',
      );
      expect(wireframes).toContain('SedanWireframe');

      const vehicleImage = await readFile(join(r.dir, 'VehicleImage.tsx'), 'utf-8');
      expect(vehicleImage).toContain('SedanWireframe');

      const injuryOverlay = await readFile(
        join(r.dir, 'components/InjuryOverlay.tsx'), 'utf-8',
      );
      expect(injuryOverlay).toContain('overlay');

      // feat/images should have everything from extract + its own assets
      r.git('checkout', 'feat/images');

      const commercial = await readFile(
        join(r.dir, 'packages/vehicle-image/assets/commercial.svg'), 'utf-8',
      );
      expect(commercial).toContain('commercial vehicle');

      const motorcycle = await readFile(
        join(r.dir, 'packages/vehicle-image/assets/motorcycle.svg'), 'utf-8',
      );
      expect(motorcycle).toContain('motorcycle');

      // Grandchild also has the reconciled files from the parent's review
      const wireframesOnImages = await readFile(
        join(r.dir, 'components/wireframes.tsx'), 'utf-8',
      );
      expect(wireframesOnImages).toContain('SedanWireframe');
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });

  test('syncLocalStack handles the same scenario via the sync path', async () => {
    const r = await createSandboxRepoWithRemote();
    dirs.push(r.dir, r.remoteDir);

    // Build: main → feat/parent → feat/child
    r.git('checkout', '-b', 'feat/parent');
    await commit(r.dir, r.git, 'base.ts', 'base logic\n', 'parent: base');

    r.git('checkout', '-b', 'feat/child');
    await commit(r.dir, r.git, 'feature.ts', 'feature code\n', 'child: feature');

    // Parent gets review commits
    r.git('checkout', 'feat/parent');
    await commit(r.dir, r.git, 'review-fix.ts', 'review fix\n', 'parent: review fix');
    const parentFinal = r.git('rev-parse', 'HEAD');

    const childHead = r.git('rev-parse', 'feat/child');

    // Push everything
    r.git('checkout', 'main');
    for (const branch of ['feat/parent', 'feat/child']) {
      r.git('push', '-u', 'origin', branch);
    }

    // Squash-merge parent on remote
    await squashMergeOnRemote(r.remoteDir, 'feat/parent', 'squash: parent');

    // Build stack with parent marked as merged
    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/parent', 'main');
    stack = StackManager.updateNode(stack, 'feat/parent', {
      lastKnownHead: parentFinal,
      status: 'merged',
    });
    stack = StackManager.addNode(stack, 'feat/child', 'feat/parent');
    stack = StackManager.updateNode(stack, 'feat/child', {
      lastKnownHead: childHead,
    });

    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      const result = await RebaseEngine.syncLocalStack(r.dir, stack);

      expect(result.state).toBe('completed');

      // Child is on top of origin/main
      const remoteMain = await GitShell.getBranchHead(r.dir, 'origin/main');
      const mb = await GitShell.getMergeBase(r.dir, 'origin/main', 'feat/child');
      expect(mb).toBe(remoteMain);

      // Child has its own file + parent's review fix
      r.git('checkout', 'feat/child');
      expect(await readFile(join(r.dir, 'feature.ts'), 'utf-8')).toBe('feature code\n');
      expect(await readFile(join(r.dir, 'review-fix.ts'), 'utf-8')).toBe('review fix\n');
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });
});

// ── ACID test: old code vs new code on drifted stack ─────────────────────────

describe('ACID: old behavior vs new behavior on drifted stack', () => {
  test('old approach replays redundant parent commits; reconciliation produces clean history', async () => {
    const r = await createSandboxRepoWithRemote();
    dirs.push(r.dir, r.remoteDir);

    // When parent gets extra commits (review feedback) after child
    // branched, the tombstone is NOT an ancestor of the child. The old
    // approach uses tombstone as oldBase directly, which means git
    // computes merge-base(tombstone, child) for the commit range.
    //
    // This test verifies: old approach replays REDUNDANT parent commits
    // (git can't always skip them), while reconciliation produces a
    // clean history with only the child's unique commits above main.

    r.git('checkout', '-b', 'feat/parent');
    await commit(r.dir, r.git, 'parent-a.ts', 'parent work A\n', 'parent: work A');
    await commit(r.dir, r.git, 'parent-b.ts', 'parent work B\n', 'parent: work B');

    r.git('checkout', '-b', 'feat/child');
    await commit(r.dir, r.git, 'child.ts', 'child work\n', 'child: unique work');
    await commitNested(r.dir, r.git, 'packages/ui/index.ts',
      'export const ui = true;\n', 'child: create package');
    const childOriginal = r.git('rev-parse', 'HEAD');
    const childCommitCount = parseInt(
      r.git('rev-list', '--count', 'feat/parent..feat/child'), 10,
    );

    // Parent gets review commits AFTER child branched
    r.git('checkout', 'feat/parent');
    await commit(r.dir, r.git, 'review.ts', 'review fix\n', 'parent: review fix');
    const parentTombstone = r.git('rev-parse', 'HEAD');

    // Squash-merge parent into main
    r.git('checkout', 'main');
    r.git('merge', '--squash', 'feat/parent');
    r.git('commit', '-m', 'squash: parent work');
    const mainHead = r.git('rev-parse', 'HEAD');

    for (const b of ['main', 'feat/parent', 'feat/child']) {
      r.git('push', '-u', 'origin', b);
    }

    // Confirm drift exists
    let isAnc: boolean;
    try {
      r.git('merge-base', '--is-ancestor', parentTombstone, 'feat/child');
      isAnc = true;
    } catch { isAnc = false; }
    expect(isAnc).toBe(false);

    // ── OLD BEHAVIOR: direct --onto with stale tombstone ─────────────
    const oldResult = await RebaseEngine.rebaseSingle(
      r.dir, mainHead, parentTombstone, 'feat/child',
    );

    if (oldResult.success) {
      // Even when git "succeeds," the commit history above main may
      // include redundant parent commits that git couldn't skip.
      r.git('checkout', 'feat/child');
      const oldCommitsAboveMain = parseInt(
        r.git('rev-list', '--count', `${mainHead}..HEAD`), 10,
      );
      const oldLog = r.git('log', '--oneline', `${mainHead}..HEAD`);

      // Reset for new approach
      r.git('checkout', 'feat/child');
      r.git('reset', '--hard', childOriginal);
      r.git('checkout', 'main');

      // ── NEW BEHAVIOR: cascadeRebase with reconciliation ────────────
      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/parent', 'main');
      stack = StackManager.updateNode(stack, 'feat/parent', {
        lastKnownHead: parentTombstone,
        status: 'merged',
      });
      stack = StackManager.addNode(stack, 'feat/child', 'feat/parent');
      stack = StackManager.updateNode(stack, 'feat/child', {
        lastKnownHead: childOriginal,
      });

      const originalPush = GitShell.pushForceWithLease;
      GitShell.pushForceWithLease = async () => {};

      try {
        const newResult = await RebaseEngine.cascadeRebase(
          r.dir, stack, 'feat/parent', mainHead,
        );

        expect(newResult.state).toBe('completed');
        expect(newResult.results.every((rr) => rr.success)).toBe(true);

        r.git('checkout', 'feat/child');
        const newCommitsAboveMain = parseInt(
          r.git('rev-list', '--count', `${mainHead}..HEAD`), 10,
        );

        // New approach produces exactly the child's unique commits
        expect(newCommitsAboveMain).toBe(childCommitCount);

        // Old approach may have more commits (redundant parent replays)
        // or the same count (if git managed to skip them all).
        // Either way, new approach is provably correct.
        expect(newCommitsAboveMain).toBeLessThanOrEqual(oldCommitsAboveMain);

        // Content verification
        const childFile = await readFile(join(r.dir, 'child.ts'), 'utf-8');
        expect(childFile).toBe('child work\n');
        const reviewFile = await readFile(join(r.dir, 'review.ts'), 'utf-8');
        expect(reviewFile).toBe('review fix\n');
        const pkg = await readFile(join(r.dir, 'packages/ui/index.ts'), 'utf-8');
        expect(pkg).toContain('ui');
      } finally {
        GitShell.pushForceWithLease = originalPush;
      }
    } else {
      // Old approach FAILED — even better proof that reconciliation is needed
      try { r.git('rebase', '--abort'); } catch { /* safe */ }
      r.git('checkout', 'feat/child');
      r.git('reset', '--hard', childOriginal);
      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/parent', 'main');
      stack = StackManager.updateNode(stack, 'feat/parent', {
        lastKnownHead: parentTombstone,
        status: 'merged',
      });
      stack = StackManager.addNode(stack, 'feat/child', 'feat/parent');
      stack = StackManager.updateNode(stack, 'feat/child', {
        lastKnownHead: childOriginal,
      });

      const originalPush = GitShell.pushForceWithLease;
      GitShell.pushForceWithLease = async () => {};

      try {
        const newResult = await RebaseEngine.cascadeRebase(
          r.dir, stack, 'feat/parent', mainHead,
        );

        // New code succeeds where old code failed
        expect(newResult.state).toBe('completed');
        expect(newResult.results.every((rr) => rr.success)).toBe(true);

        r.git('checkout', 'feat/child');
        const childFile = await readFile(join(r.dir, 'child.ts'), 'utf-8');
        expect(childFile).toBe('child work\n');
      } finally {
        GitShell.pushForceWithLease = originalPush;
      }
    }
  });
});

// ── forkPoint-based reconciliation with rebased parent ───────────────────────

describe('forkPoint metadata: rebased parent scenario', () => {
  test('stored forkPoint enables precise reconciliation after parent rebase', async () => {
    const r = await createSandboxRepoWithRemote();
    dirs.push(r.dir, r.remoteDir);

    // Parent creates work
    r.git('checkout', '-b', 'feat/parent');
    await commit(r.dir, r.git, 'parent.ts', 'parent work\n', 'parent: initial');
    const forkPointSHA = r.git('rev-parse', 'HEAD');

    // Child branches — capture the fork point
    r.git('checkout', '-b', 'feat/child');
    await commit(r.dir, r.git, 'child.ts', 'child work\n', 'child: unique');
    const childOriginal = r.git('rev-parse', 'HEAD');

    // Main advances
    r.git('checkout', 'main');
    await commit(r.dir, r.git, 'other.ts', 'other\n', 'main: advance');

    // Parent rebases (changes hashes)
    r.git('checkout', 'feat/parent');
    r.git('rebase', 'main');

    // Parent gets review commit
    await commit(r.dir, r.git, 'review.ts', 'review\n', 'parent: review');
    const parentTombstone = r.git('rev-parse', 'HEAD');

    // Squash-merge parent
    r.git('checkout', 'main');
    r.git('merge', '--squash', 'feat/parent');
    r.git('commit', '-m', 'squash: parent');
    const mainHead = r.git('rev-parse', 'HEAD');

    for (const b of ['main', 'feat/parent', 'feat/child']) {
      r.git('push', '-u', 'origin', b);
    }

    // Build stack WITH forkPoint stored
    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/parent', 'main');
    stack = StackManager.updateNode(stack, 'feat/parent', {
      lastKnownHead: parentTombstone,
      status: 'merged',
    });
    stack = StackManager.addNode(stack, 'feat/child', 'feat/parent');
    stack = StackManager.updateNode(stack, 'feat/child', {
      lastKnownHead: childOriginal,
      forkPoint: forkPointSHA,
    });

    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      const result = await RebaseEngine.cascadeRebase(
        r.dir, stack, 'feat/parent', mainHead,
      );

      expect(result.state).toBe('completed');
      expect(result.results.every((rr) => rr.success)).toBe(true);

      // Child is on top of main
      const mb = await GitShell.getMergeBase(r.dir, 'main', 'feat/child');
      expect(mb).toBe(mainHead);

      // Exactly 1 commit above main (child's unique work)
      const commitCount = parseInt(
        r.git('rev-list', '--count', `${mainHead}..feat/child`), 10,
      );
      expect(commitCount).toBe(1);

      // Content survived
      r.git('checkout', 'feat/child');
      expect(await readFile(join(r.dir, 'child.ts'), 'utf-8')).toBe('child work\n');
      expect(await readFile(join(r.dir, 'review.ts'), 'utf-8')).toBe('review\n');
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });
});
