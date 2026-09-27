import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { repoIdentityFromRemote } from '../repoIdentity';

describe('repoIdentityFromRemote', () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'rt-ext-identity-')));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test('returns the bare host/path string a repo settings section is keyed by', () => {
    expect(repoIdentityFromRemote('git@github.com:example/repo.git')).toBe('github.com/example/repo');
  });

  test('returns null for a remote that is not a recognized host form', () => {
    expect(repoIdentityFromRemote('/tmp/some/local/path')).toBeNull();
  });
});
