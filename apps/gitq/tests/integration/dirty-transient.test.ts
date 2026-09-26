import { afterEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitShell } from '../../src/core/git-shell.ts';
import { cleanupRepo, commit, createSandboxRepo } from './helpers.ts';

mock.restore();

/**
 * Watchman drops `.watchman-cookie-*` files into watched trees continuously,
 * so a dirtiness check that counts them can never win the delete-then-check
 * race. They are transient junk: untracked, regenerated, never content.
 */

let repos: string[] = [];

afterEach(async () => {
  await Promise.all(repos.map(cleanupRepo));
  repos = [];
});

describe('GitShell.isDirty transient-untracked filtering', () => {
  test('a watchman cookie at the root does not count as dirty', async () => {
    const repo = await createSandboxRepo();
    repos.push(repo.dir);
    await writeFile(join(repo.dir, '.watchman-cookie-host-123'), '');

    expect(await GitShell.isDirty(repo.dir)).toBe(false);
  });

  test('a watchman cookie nested in a subdirectory does not count as dirty', async () => {
    const repo = await createSandboxRepo();
    repos.push(repo.dir);
    await mkdir(join(repo.dir, 'sub'), { recursive: true });
    await commit(repo.dir, repo.git, 'sub/file.txt', 'content\n', 'add sub file');
    await writeFile(join(repo.dir, 'sub', '.watchman-cookie-host-456'), '');

    expect(await GitShell.isDirty(repo.dir)).toBe(false);
  });

  test('a real untracked file still counts as dirty alongside a cookie', async () => {
    const repo = await createSandboxRepo();
    repos.push(repo.dir);
    await writeFile(join(repo.dir, '.watchman-cookie-host-789'), '');
    await writeFile(join(repo.dir, 'notes.txt'), 'real work\n');

    expect(await GitShell.isDirty(repo.dir)).toBe(true);
  });

  test('a tracked modification still counts as dirty alongside a cookie', async () => {
    const repo = await createSandboxRepo();
    repos.push(repo.dir);
    await commit(repo.dir, repo.git, 'file.txt', 'v1\n', 'add file');
    await writeFile(join(repo.dir, '.watchman-cookie-host-abc'), '');
    await writeFile(join(repo.dir, 'file.txt'), 'v2\n');

    expect(await GitShell.isDirty(repo.dir)).toBe(true);
  });

  test('dirtyPaths lists real paths and excludes cookies', async () => {
    const repo = await createSandboxRepo();
    repos.push(repo.dir);
    await mkdir(join(repo.dir, 'sub'), { recursive: true });
    await commit(repo.dir, repo.git, 'sub/file.txt', 'content\n', 'add sub file');
    await writeFile(join(repo.dir, '.watchman-cookie-host-def'), '');
    await writeFile(join(repo.dir, 'sub', '.watchman-cookie-host-ghi'), '');
    await writeFile(join(repo.dir, 'notes.txt'), 'real work\n');

    expect(await GitShell.dirtyPaths(repo.dir)).toEqual(['notes.txt']);
  });
});
