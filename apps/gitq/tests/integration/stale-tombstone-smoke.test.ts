/**
 * Stale tombstone smoke test — replicates the EXACT real-world acme-1231/acme-1233/acme-1234
 * scenario where:
 *
 *   1. Parent branch (acme-1231) is created from master, adds commits
 *   2. Child (acme-1233) branches from parent early on
 *   3. Parent gets rebased onto updated master (SHA rewrite)
 *   4. Parent gets review commits after child branched
 *   5. Child carries OLD copies of parent's commits (pre-rebase SHAs)
 *   6. Parent is squash-merged to master
 *   7. Stored lastKnownHead points to a stale SHA (pre-rebase)
 *   8. syncLocalStack must:
 *      a. Skip the merged parent (no replay)
 *      b. Resolve the LIVE branch tip as tombstone (not stale lastKnownHead)
 *      c. Use reflog fork-point to detect where child diverged from parent
 *      d. Only replay child's own commits onto the tombstone
 *      e. Cascade the result onto master
 *
 * The key challenge: git cherry (patch-ID comparison) FAILS here because
 * the parent was rebased, changing patch context. It marks inherited parent
 * commits as unique (+) since the rebased versions have different diffs.
 * The fix: use `git merge-base --fork-point` which uses reflogs to
 * determine the exact divergence point regardless of rebasing.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { writeFile, readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitShell } from '../../src/core/git-shell.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
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

describe('Stale tombstone: real-world acme-1231/acme-1233/acme-1234 replication', () => {
  /**
   * This test precisely replicates the topology that caused repeated rebase
   * failures in the user's real repo. The key elements:
   *
   * - Parent has commits that touch VehicleImage files
   * - Child branches from parent BEFORE parent's review commits
   * - Child carries old copies of parent's commits (pre-rebase SHAs)
   * - Parent then gets review commits + is rebased onto updated master
   * - git cherry shows interleaved +/- pattern for child's commits
   * - syncLocalStack with a STALE lastKnownHead for the parent must
   *   still resolve correctly by reading the live branch tip
   */
  test('syncLocalStack handles stale lastKnownHead with interleaved cherry pattern', async () => {
    const r = await createSandboxRepoWithRemote();
    dirs.push(r.dir, r.remoteDir);

    // ── Phase 1: Set up master with some initial work ─────────────────
    await commit(r.dir, r.git, 'app.ts', 'initial app\n', 'main: initial app');
    r.git('push', 'origin', 'main');

    // ── Phase 2: Parent branch (acme-1231) — initial commits ───────────
    r.git('checkout', '-b', 'feat/parent');

    // Parent commit 1: backend fix (will be a duplicate on child)
    await commitNested(
      r.dir, r.git,
      'backend/extraction.ts',
      'export function extractVehicleType(data: any) {\n  return data.vehicleType ?? "sedan";\n}\n',
      'fix: preserve van vehicle type in extraction',
    );

    // Parent commit 2: VehicleImage refactor (will be unique on child — different patch)
    await commitNested(
      r.dir, r.git,
      'components/VehicleImage/VehicleImage.tsx',
      'import React from "react";\n' +
      'export function VehicleImage({ type }: { type: string }) {\n' +
      '  const Component = TRUTH_TABLE[type] ?? Sedan;\n' +
      '  return <Component />;\n' +
      '}\n' +
      'const TRUTH_TABLE: Record<string, React.FC> = {};\n',
      'refactor: rewrite VehicleImage as truth-table',
    );
    await commitNested(
      r.dir, r.git,
      'components/VehicleImage/components/VehicleWireframe.tsx',
      'export function VehicleWireframe() {\n  return <svg>basic wireframe</svg>;\n}\n',
      'refactor: add VehicleWireframe component',
    );

    // Parent commit 3: dark mode story (will be a duplicate on child)
    await commitNested(
      r.dir, r.git,
      'components/VehicleImage/VehicleImage.stories.tsx',
      'export const DarkMode = {\n  args: { theme: "dark" },\n  render: () => <VehicleImage type="sedan" />,\n};\n',
      'feat: add dark mode Storybook story',
    );

    // ── Phase 3: Child branch (acme-1233) branches from parent HERE ────
    // Child sees parent's first 4 commits but NOT any future review commits
    r.git('checkout', '-b', 'feat/child');

    // Child commit 1: extract into package (unique work)
    await commitNested(
      r.dir, r.git,
      'packages/vehicle-image/package.json',
      '{ "name": "@acme/vehicle-image", "version": "0.0.1" }\n',
      'feat: extract VehicleImage into @acme/vehicle-image package',
    );
    // Child also moves VehicleImage.tsx to package (modifies the file parent also changed)
    await commitNested(
      r.dir, r.git,
      'packages/vehicle-image/src/VehicleImage.tsx',
      'import React from "react";\n' +
      '// Extracted to @acme/vehicle-image package\n' +
      'export function VehicleImage({ type }: { type: string }) {\n' +
      '  const Component = TRUTH_TABLE[type] ?? Sedan;\n' +
      '  return <Component />;\n' +
      '}\n' +
      'const TRUTH_TABLE: Record<string, React.FC> = {};\n',
      'feat: move VehicleImage to package',
    );

    // Child commit 2: codegen plugin (unique work)
    await commitNested(
      r.dir, r.git,
      'packages/vehicle-image/codegen.config.ts',
      'export default {\n  generates: { "./src/generated/graphql.ts": { plugins: ["typescript"] } },\n};\n',
      'refactor: replace custom schema script with codegen plugin',
    );

    const childHead = r.git('rev-parse', 'feat/child');

    // ── Phase 4: Record a STALE lastKnownHead for the parent ─────────
    // This simulates what happens when the stack store saved lastKnownHead
    // before the parent was rebased or got review commits
    r.git('checkout', 'feat/parent');
    const staleParentHead = r.git('rev-parse', 'HEAD');

    // ── Phase 5: Master advances (other team merges) ─────────────────
    r.git('checkout', 'main');
    await commit(r.dir, r.git, 'unrelated.ts', 'team work\n', 'main: unrelated team merge');

    // ── Phase 6: Parent gets REBASED onto updated master ─────────────
    // This changes all commit SHAs on the parent, making staleParentHead
    // point to a pre-rebase commit
    r.git('checkout', 'feat/parent');
    r.git('rebase', 'main');

    // ── Phase 7: Parent gets REVIEW COMMITS after child branched ─────
    await commitNested(
      r.dir, r.git,
      'components/VehicleImage/components/VehicleWireframe.tsx',
      '// Rewrote based on review feedback\n' +
      'export function SedanWireframe() {\n  return <svg viewBox="0 0 200 100">sedan outline</svg>;\n}\n' +
      'export function SUVWireframe() {\n  return <svg viewBox="0 0 200 120">suv outline</svg>;\n}\n',
      'refactor: replace runtime SVG fetch with inline wireframe components (review)',
    );
    await commitNested(
      r.dir, r.git,
      'components/VehicleImage/VehicleImage.tsx',
      'import React from "react";\n' +
      'import { SedanWireframe } from "./components/VehicleWireframe";\n' +
      'export function VehicleImage({ type }: { type: string }) {\n' +
      '  const Component = TRUTH_TABLE[type] ?? SedanWireframe;\n' +
      '  return <Component />;\n' +
      '}\n' +
      'const TRUTH_TABLE: Record<string, React.FC> = {\n' +
      '  sedan: SedanWireframe,\n' +
      '};\n',
      'refactor: use wireframe components in VehicleImage (review)',
    );
    await commit(
      r.dir, r.git,
      'theme.ts',
      'export const darkModeVehicle = { bg: "#1a1a1a", stroke: "#fff" };\n',
      'feat: dark mode via tailwind',
    );

    // The LIVE branch tip — this is the real tombstone
    const liveTombstone = r.git('rev-parse', 'feat/parent');

    // Push all branches
    r.git('checkout', 'main');
    for (const branch of ['feat/parent', 'feat/child']) {
      r.git('push', '-u', 'origin', branch);
    }

    // ── Phase 8: Squash-merge parent into main on remote ─────────────
    await squashMergeOnRemote(
      r.remoteDir,
      'feat/parent',
      'squash: Van Images + Dark Mode Vehicle Images (ACME-1231)',
    );
    r.git('fetch', 'origin');

    // ── Phase 9: Verify the interleaved cherry pattern ────────────────
    const cherryOutput = r.git('cherry', '-v', 'feat/parent', 'feat/child');
    const lines = cherryOutput.trim().split('\n');
    const pattern = lines.map((l: string) => l.startsWith('+') ? '+' : '-');

    // We expect a mix of + and - (interleaved, not all contiguous)
    const hasPlus = pattern.includes('+');
    const hasMinus = pattern.includes('-');
    expect(hasPlus).toBe(true);
    expect(hasMinus).toBe(true);

    // ── Phase 10: Build the stack with STALE lastKnownHead ────────────
    let stack = StackManager.createStack('vehicle-stack', 'main');
    stack = StackManager.addNode(stack, 'feat/parent', 'main');
    stack = StackManager.updateNode(stack, 'feat/parent', {
      // STALE: points to pre-rebase, pre-review parent head
      lastKnownHead: staleParentHead,
      status: 'merged',
    });
    stack = StackManager.addNode(stack, 'feat/child', 'feat/parent');
    stack = StackManager.updateNode(stack, 'feat/child', {
      lastKnownHead: childHead,
    });

    // ── Phase 11: syncLocalStack should handle everything ─────────────
    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      const result = await RebaseEngine.syncLocalStack(r.dir, stack);

      // Should complete without conflicts
      expect(result.state).toBe('completed');
      expect(result.results.every((rr) => rr.success)).toBe(true);

      // ── Phase 12: Verify topology ─────────────────────────────────
      const remoteMain = await GitShell.getBranchHead(r.dir, 'origin/main');

      // Child is on top of origin/main
      const mb = await GitShell.getMergeBase(r.dir, 'origin/main', 'feat/child');
      expect(mb).toBe(remoteMain);

      // ── Phase 13: Verify content survival ─────────────────────────
      r.git('checkout', 'feat/child');

      // Child's own unique work: package extraction
      const pkg = await readFile(
        join(r.dir, 'packages/vehicle-image/package.json'), 'utf-8',
      );
      expect(pkg).toContain('@acme/vehicle-image');

      // Child's own unique work: codegen config
      const codegen = await readFile(
        join(r.dir, 'packages/vehicle-image/codegen.config.ts'), 'utf-8',
      );
      expect(codegen).toContain('graphql');

      // Parent's review commits should be present (from tombstone reconciliation)
      const wireframes = await readFile(
        join(r.dir, 'components/VehicleImage/components/VehicleWireframe.tsx'), 'utf-8',
      );
      expect(wireframes).toContain('SedanWireframe');

      // Parent's dark mode theme from review
      const theme = await readFile(join(r.dir, 'theme.ts'), 'utf-8');
      expect(theme).toContain('darkModeVehicle');

      // The VehicleImage should have the updated version from parent's review
      const vehicleImage = await readFile(
        join(r.dir, 'components/VehicleImage/VehicleImage.tsx'), 'utf-8',
      );
      expect(vehicleImage).toContain('SedanWireframe');
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });

  /**
   * Same scenario but via cascadeRebase (the merge-triggered path)
   */
  test('cascadeRebase handles stale tombstone with interleaved cherry pattern', async () => {
    const r = await createSandboxRepoWithRemote();
    dirs.push(r.dir, r.remoteDir);

    // Simplified version of the same scenario — NO file content conflicts
    r.git('checkout', '-b', 'feat/parent');
    await commit(r.dir, r.git, 'parent-a.ts', 'parent work A\n', 'parent: work A');
    await commit(r.dir, r.git, 'parent-b.ts', 'parent work B\n', 'parent: work B');

    // Child branches — carries both parent commits
    r.git('checkout', '-b', 'feat/child');
    await commit(r.dir, r.git, 'child.ts', 'child work\n', 'child: unique work');
    await commit(r.dir, r.git, 'child-extra.ts', 'child extra\n', 'child: extra work');
    await commit(r.dir, r.git, 'child-pkg.ts', 'child package\n', 'child: package extraction');
    const childHead = r.git('rev-parse', 'feat/child');

    // Stale parent head (before review commits)
    r.git('checkout', 'feat/parent');
    const staleHead = r.git('rev-parse', 'HEAD');

    // Parent gets review commits (no file conflicts with child)
    await commit(r.dir, r.git, 'review-fix.ts', 'review fix\n', 'parent: review fix');
    await commit(r.dir, r.git, 'review-note.ts', 'review note\n', 'parent: add review note');

    // Squash-merge parent into main
    r.git('checkout', 'main');
    r.git('merge', '--squash', 'feat/parent');
    r.git('commit', '-m', 'squash: parent');
    const mainHead = r.git('rev-parse', 'HEAD');

    for (const b of ['main', 'feat/parent', 'feat/child']) {
      r.git('push', '-u', 'origin', b);
    }

    // Build stack with STALE lastKnownHead
    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/parent', 'main');
    stack = StackManager.updateNode(stack, 'feat/parent', {
      lastKnownHead: staleHead,
      status: 'merged',
    });
    stack = StackManager.addNode(stack, 'feat/child', 'feat/parent');
    stack = StackManager.updateNode(stack, 'feat/child', {
      lastKnownHead: childHead,
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

      // Content survived
      r.git('checkout', 'feat/child');
      expect(await readFile(join(r.dir, 'child.ts'), 'utf-8')).toBe('child work\n');
      expect(await readFile(join(r.dir, 'child-pkg.ts'), 'utf-8')).toBe('child package\n');
      expect(await readFile(join(r.dir, 'review-note.ts'), 'utf-8')).toBe('review note\n');
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });
});
