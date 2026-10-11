import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getDef, getSetting } from '@mattstack/rt-client';
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
  let dataDir: string;
  let warnSpy: ReturnType<typeof spyOn<Console, 'warn'>>;
  let errorSpy: ReturnType<typeof spyOn<Console, 'error'>>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'rt-context-branch-naming-')));
    process.env.HOME = home;
    dataDir = join(home, 'data');
    mkdirSync(dataDir, { recursive: true });
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    // setSetting prints a "wrote to the local store" reminder via console.error
    // on every successful write; not under test here, just noise.
    errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  const legacyPath = () => join(dataDir, 'branch-naming.json');
  const writeLegacy = (contents: string) => writeFileSync(legacyPath(), contents);

  const DEFAULT = { template: '${identifier}-${titleSlug}' };
  const writeStore = (value: unknown) => {
    mkdirSync(join(home, '.mattstack', 'user'), { recursive: true });
    writeFileSync(userSettingsPath(home), JSON.stringify({ repos: { [IDENTITY]: { 'rt.branchNaming': value } } }));
  };

  test('nothing set -> the registry default', () => {
    expect(getDef('rt.branchNaming')!.default).toEqual(DEFAULT);
    expect(loadBranchNamingConfig(dataDir, IDENTITY)).toEqual(DEFAULT);
    expect(loadBranchNamingConfig(dataDir, null)).toEqual(DEFAULT);
  });

  test('a store value wins', () => {
    writeStore({ template: 'feature/${identifier}' });
    expect(loadBranchNamingConfig(dataDir, IDENTITY)).toEqual({ template: 'feature/${identifier}' });
  });

  test('an old branch-naming.json is not read or moved, and the warning names the command once', () => {
    writeLegacy(JSON.stringify({ template: 'legacy/${identifier}' }));
    expect(loadBranchNamingConfig(dataDir, IDENTITY)).toEqual(DEFAULT);
    expect(loadBranchNamingConfig(dataDir, IDENTITY)).toEqual(DEFAULT);
    expect(existsSync(legacyPath())).toBe(true);
    expect(getSetting('rt.branchNaming', { repoIdentity: IDENTITY }).provenance.every((p) => p.scope === 'default')).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]![0])).toContain(`rt settings set rt.branchNaming '{"template":"legacy/\${identifier}"}' --scope org --repo ${IDENTITY}`);
  });

  test('an old file says nothing once the store sets the key', () => {
    writeStore({ template: 'feature/${identifier}' });
    writeLegacy(JSON.stringify({ template: 'legacy/${identifier}' }));
    loadBranchNamingConfig(dataDir, IDENTITY);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('a malformed store value -> the default', () => {
    writeStore({ template: '' });
    expect(loadBranchNamingConfig(dataDir, IDENTITY)).toEqual(DEFAULT);
  });

  test('never throws: an unexpandable stored variable -> the default', () => {
    writeStore({ template: '${worktree}/x' });
    expect(loadBranchNamingConfig(join(home, 'missing'), IDENTITY)).toEqual(DEFAULT);
  });
});
