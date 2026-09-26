/**
 * Binary files in stacks: rebase, split, fold, and absorb with binary content.
 * Verifies that non-text files (images, compiled assets) survive all operations.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitShell } from '../../src/core/git-shell.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import { foldBranch } from '../../src/core/branch-fold.ts';
import { BranchSplitter } from '../../src/core/branch-splitter.ts';
import { AbsorbEngine } from '../../src/core/absorb.ts';
import { createSandboxRepo, cleanupRepo, commit } from './helpers.ts';
import type { SandboxRepo } from './helpers.ts';

const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs) await cleanupRepo(d);
  dirs.length = 0;
});

function makePng(): Buffer {
  // Minimal valid 1x1 red PNG (67 bytes)
  return Buffer.from(
    '89504e470d0a1a0a0000000d494844520000000100000001080200000090' +
    '77530600000009704859730000000100000001013a286740000000' +
    '0c49444154789c6260f80f000001010000180dd8eb0000000049454e44ae426082',
    'hex',
  );
}

function makeJpeg(): Buffer {
  // Minimal JPEG header (not a valid image but exercises binary path)
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

async function commitBinary(
  dir: string,
  git: (...args: string[]) => string,
  filename: string,
  content: Buffer,
  message: string,
): Promise<string> {
  await writeFile(join(dir, filename), content);
  git('add', filename);
  git('commit', '-m', message);
  return git('rev-parse', 'HEAD');
}

// ── Cascade rebase with binary files ─────────────────────────────────────────

describe('Cascade rebase with binary files', () => {
  test('binary files survive cascade rebase unchanged', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const pngData = makePng();
    const jpegData = makeJpeg();

    git('checkout', '-b', 'feat/icons');
    const iconHead = await commitBinary(dir, git, 'icon.png', pngData, 'add icon');

    git('checkout', '-b', 'feat/photos');
    const photoHead = await commitBinary(dir, git, 'photo.jpg', jpegData, 'add photo');

    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/icons', 'main');
    stack = StackManager.updateNode(stack, 'feat/icons', { lastKnownHead: iconHead });
    stack = StackManager.addNode(stack, 'feat/photos', 'feat/icons');
    stack = StackManager.updateNode(stack, 'feat/photos', { lastKnownHead: photoHead });

    // Advance main
    git('checkout', 'main');
    await commit(dir, git, 'advance.txt', 'advance\n', 'advance main');

    const oldIconHead = iconHead;
    const forkPoint = git('merge-base', 'main', 'feat/icons');
    await GitShell.rebaseOnto(dir, 'main', forkPoint, 'feat/icons');

    let updatedStack = StackManager.updateNode(stack, 'feat/icons', { lastKnownHead: oldIconHead });

    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      const result = await RebaseEngine.cascadeRebase(dir, updatedStack, 'feat/icons', 'feat/icons');
      expect(result.results.every((r) => r.success)).toBe(true);

      // Verify binary content byte-for-byte
      git('checkout', 'feat/photos');
      const pngAfter = await readFile(join(dir, 'icon.png'));
      expect(Buffer.compare(pngAfter, pngData)).toBe(0);

      const jpegAfter = await readFile(join(dir, 'photo.jpg'));
      expect(Buffer.compare(jpegAfter, jpegData)).toBe(0);
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });
});

// ── Fold with binary files ───────────────────────────────────────────────────

describe('Fold with binary files', () => {
  test('binary files cherry-picked correctly during fold', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const pngData = makePng();

    git('checkout', '-b', 'feat/base');
    const baseHead = await commit(dir, git, 'base.txt', 'base\n', 'add base');

    git('checkout', '-b', 'feat/child');
    const childHead = await commitBinary(dir, git, 'asset.png', pngData, 'add binary asset');

    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/base', 'main');
    stack = StackManager.updateNode(stack, 'feat/base', { lastKnownHead: baseHead });
    stack = StackManager.addNode(stack, 'feat/child', 'feat/base');
    stack = StackManager.updateNode(stack, 'feat/child', { lastKnownHead: childHead });

    await foldBranch(dir, stack, 'feat/child');

    git('checkout', 'feat/base');
    const pngAfter = await readFile(join(dir, 'asset.png'));
    expect(Buffer.compare(pngAfter, pngData)).toBe(0);
  });
});

// ── Split with binary files ──────────────────────────────────────────────────

describe('Split by file with binary files', () => {
  test('binary files move to new branch during splitByFile', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const pngData = makePng();

    git('checkout', '-b', 'feat/mixed');
    await commit(dir, git, 'code.ts', 'export const x = 1;\n', 'add code');
    await commitBinary(dir, git, 'icon.png', pngData, 'add icon');
    const mixedHead = git('rev-parse', 'HEAD');

    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/mixed', 'main');
    stack = StackManager.updateNode(stack, 'feat/mixed', { lastKnownHead: mixedHead });

    const result = await BranchSplitter.splitByFile(dir, stack, 'feat/mixed', ['*.png'], 'feat/assets');

    expect(result.movedFiles).toContain('icon.png');
    expect(result.remainingFiles).toContain('code.ts');

    git('checkout', 'feat/assets');
    const pngAfter = await readFile(join(dir, 'icon.png'));
    expect(Buffer.compare(pngAfter, pngData)).toBe(0);
  });
});

// ── Absorb with binary file modifications ────────────────────────────────────

describe('Absorb with binary files', () => {
  test('modified binary file is absorbed into the correct branch', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const pngV1 = makePng();
    const pngV2 = Buffer.concat([makePng(), Buffer.from([0x00, 0x00])]);

    git('checkout', '-b', 'branch-1');
    const sha1 = await commitBinary(dir, git, 'icon.png', pngV1, 'add icon v1');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'branch-1', 'main');
    stack = StackManager.updateNode(stack, 'branch-1', { lastKnownHead: sha1 });

    git('checkout', 'branch-1');
    await writeFile(join(dir, 'icon.png'), pngV2);

    const result = await AbsorbEngine.absorb(dir, stack);
    expect(result.absorbed).toBe(true);

    git('checkout', 'branch-1');
    const pngAfter = await readFile(join(dir, 'icon.png'));
    expect(Buffer.compare(pngAfter, pngV2)).toBe(0);
    expect(await GitShell.isDirty(dir)).toBe(false);
  });
});

// ── Conflict with binary files ───────────────────────────────────────────────

describe('Binary file conflicts', () => {
  test('rebase conflict on binary file reports failure cleanly', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const forkPoint = git('rev-parse', 'HEAD');

    await commitBinary(dir, git, 'shared.bin', Buffer.from([0x01, 0x02]), 'main binary');

    git('checkout', '-b', 'feat/conflict', forkPoint);
    await commitBinary(dir, git, 'shared.bin', Buffer.from([0x03, 0x04]), 'child binary');

    const result = await RebaseEngine.rebaseSingle(dir, 'main', forkPoint, 'feat/conflict');
    expect(result.success).toBe(false);

    git('rebase', '--abort');
  });
});
