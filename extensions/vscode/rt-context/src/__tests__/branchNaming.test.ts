import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getDef } from '@mattstack/rt-client';
import { loadBranchNamingConfig } from '../branchNaming';

// @mattstack/rt-client does not export its store-path helpers (paths.ts is
// an internal detail); these are the documented layout from
// docs/settings-architecture.md's store table.
const userSettingsPath = (home: string) => join(home, '.mattstack', 'user', 'settings.user.jsonc');

// Every test repoints HOME at a fresh temp dir (call-time HOME resolution,
// same convention as rt-client's own settings tests) so the settings store
// this exercises is never the real ~/.mattstack.
const IDENTITY = 'github.com/acme/widgets';

describe('loadBranchNamingConfig', () => {
  const origHome = process.env.HOME;
  let home: string;
  let errorSpy: ReturnType<typeof spyOn<Console, 'error'>>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'rt-context-branch-naming-')));
    process.env.HOME = home;
    // setSetting prints a "wrote to the local store" reminder via console.error
    // on every successful write; not under test here, just noise.
    errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  const DEFAULT = { template: '${identifier}-${titleSlug}' };
  const writeStore = (value: unknown) => {
    mkdirSync(join(home, '.mattstack', 'user'), { recursive: true });
    writeFileSync(userSettingsPath(home), JSON.stringify({ repos: { [IDENTITY]: { 'rt.branchNaming': value } } }));
  };

  test('nothing set -> the registry default', () => {
    expect(getDef('rt.branchNaming')!.default).toEqual(DEFAULT);
    expect(loadBranchNamingConfig(IDENTITY)).toEqual(DEFAULT);
    expect(loadBranchNamingConfig(null)).toEqual(DEFAULT);
  });

  test('a store value wins', () => {
    writeStore({ template: 'feature/${identifier}' });
    expect(loadBranchNamingConfig(IDENTITY)).toEqual({ template: 'feature/${identifier}' });
  });

  test('a malformed store value -> the default', () => {
    writeStore({ template: '' });
    expect(loadBranchNamingConfig(IDENTITY)).toEqual(DEFAULT);
  });

  test('never throws: an unexpandable stored variable -> the default', () => {
    writeStore({ template: '${worktree}/x' });
    expect(loadBranchNamingConfig(IDENTITY)).toEqual(DEFAULT);
  });
});
