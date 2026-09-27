import { describe, expect, test } from 'bun:test';

import {
  adoptHelperPath,
  composeCommandPath,
  composeServicePath,
  resolveProgram,
  stablePathDirs,
} from './exec-env.ts';

const HOME = '/home/t';

describe('composeServicePath', () => {
  test('keeps only directories that exist, in precedence order', () => {
    const present = new Set(['/home/t/.local/bin', '/usr/bin', '/bin']);

    const path = composeServicePath({
      home: HOME,
      exists: p => present.has(p),
    });

    expect(path).toBe('/home/t/.local/bin:/usr/bin:/bin');
  });

  test('puts extras ahead of the stable set', () => {
    const present = new Set(['/opt/shims', '/usr/bin']);

    const path = composeServicePath({
      home: HOME,
      extraDirs: ['/opt/shims'],
      exists: p => present.has(p),
    });

    expect(path).toBe('/opt/shims:/usr/bin');
  });

  test('dedupes an extra that is already in the stable set', () => {
    const present = new Set(['/usr/bin', '/bin']);

    const path = composeServicePath({
      home: HOME,
      extraDirs: ['/usr/bin'],
      exists: p => present.has(p),
    });

    expect(path).toBe('/usr/bin:/bin');
  });

  test('never contains a per-shell version-manager directory', () => {
    // The failure this module exists to prevent: a shell's PATH carries
    // fnm_multishells/<pid>_<ts>, which is dead once that shell exits.
    const shellPath = '/home/t/.local/state/fnm_multishells/123_456/bin';
    const present = new Set([shellPath, '/usr/bin']);

    const path = composeServicePath({
      home: HOME,
      exists: p => present.has(p),
    });

    expect(path).not.toContain('fnm_multishells');
    expect(path).toBe('/usr/bin');
  });

  test("puts the bundle's Helpers dir first when running inside mattstack.app", () => {
    const present = new Set([
      '/App.app/Contents/Helpers',
      '/home/t/.local/bin',
      '/usr/bin',
    ]);

    const path = composeServicePath({
      home: HOME,
      bundleHelpers: '/App.app/Contents/Helpers',
      exists: p => present.has(p),
    });

    expect(path).toBe('/App.app/Contents/Helpers:/home/t/.local/bin:/usr/bin');
  });

  test('omits the bundle Helpers dir outside a bundle (bundleHelpers: null)', () => {
    const present = new Set(['/home/t/.local/bin', '/usr/bin']);

    const path = composeServicePath({
      home: HOME,
      bundleHelpers: null,
      exists: p => present.has(p),
    });

    expect(path).not.toContain('Contents/Helpers');
  });

  test("is independent of the calling process's PATH", () => {
    const saved = process.env.PATH;
    try {
      process.env.PATH = '/poisoned/bin';
      const path = composeServicePath({ home: HOME, exists: () => true });
      expect(path).not.toContain('/poisoned/bin');
      expect(path).toBe(stablePathDirs(HOME).join(':'));
    } finally {
      process.env.PATH = saved;
    }
  });
});

describe('composeCommandPath', () => {
  const HELPERS = '/App.app/Contents/Helpers';

  test("puts the user's tool dirs ahead of the bundle Helpers dir", () => {
    const present = new Set([
      HELPERS,
      '/home/t/.bun/bin',
      '/opt/homebrew/bin',
      '/usr/bin',
      '/bin',
    ]);

    const path = composeCommandPath({
      home: HOME,
      bundleHelpers: HELPERS,
      exists: p => present.has(p),
      inherited: `${HELPERS}:/usr/bin:/bin`,
    });

    expect(path).toBe(
      `/home/t/.bun/bin:/opt/homebrew/bin:${HELPERS}:/usr/bin:/bin`
    );
  });

  test('a tool only the bundle ships still resolves through Helpers', () => {
    const present = new Set([HELPERS, '/home/t/.bun/bin', '/usr/bin']);
    const execs = new Set([
      '/home/t/.bun/bin/bun',
      `${HELPERS}/bun`,
      `${HELPERS}/cloudflared`,
    ]);

    const path = composeCommandPath({
      home: HOME,
      bundleHelpers: HELPERS,
      exists: p => present.has(p),
      inherited: '',
    });

    expect(resolveProgram('bun', path, p => execs.has(p))).toBe(
      '/home/t/.bun/bin/bun'
    );
    expect(resolveProgram('cloudflared', path, p => execs.has(p))).toBe(
      `${HELPERS}/cloudflared`
    );
  });

  test('keeps the OS dirs after Helpers and inherited extras last', () => {
    const present = new Set([
      HELPERS,
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ]);

    const path = composeCommandPath({
      home: HOME,
      bundleHelpers: HELPERS,
      exists: p => present.has(p),
      inherited: `${HELPERS}:/usr/bin:/custom/bin`,
    });

    expect(path).toBe(
      `/usr/local/bin:${HELPERS}:/usr/bin:/bin:/usr/sbin:/sbin:/custom/bin`
    );
  });

  test('outside a bundle the inherited PATH is used as is', () => {
    const inherited = '/home/t/.nvm/bin:/usr/bin:/bin';

    const path = composeCommandPath({
      home: HOME,
      bundleHelpers: null,
      exists: () => true,
      inherited,
    });

    expect(path).toBe(inherited);
  });

  test('outside a bundle a launchd deck keeps its service path', () => {
    const present = new Set(['/home/t/.local/bin', '/usr/bin', '/bin']);
    const opts = {
      home: HOME,
      bundleHelpers: null,
      exists: (p: string) => present.has(p),
    };
    const service = composeServicePath(opts);

    expect(composeCommandPath({ ...opts, inherited: service })).toBe(service);
  });

  test('leaves the service path with Helpers first', () => {
    const present = new Set([HELPERS, '/home/t/.bun/bin', '/usr/bin']);

    const path = composeServicePath({
      home: HOME,
      bundleHelpers: HELPERS,
      exists: p => present.has(p),
    });

    expect(path).toBe(`${HELPERS}:/home/t/.bun/bin:/usr/bin`);
  });
});

describe('resolveProgram', () => {
  const execs = new Set(['/opt/shims/node', '/usr/bin/node']);
  const isExec = (p: string) => execs.has(p);

  test('resolves a bare name against the path, first match wins', () => {
    expect(resolveProgram('node', '/opt/shims:/usr/bin', isExec)).toBe(
      '/opt/shims/node'
    );
  });

  test('skips directories that do not hold the executable', () => {
    expect(resolveProgram('node', '/nope:/usr/bin', isExec)).toBe(
      '/usr/bin/node'
    );
  });

  test('returns null when a bare name resolves to nothing', () => {
    expect(resolveProgram('ghost', '/opt/shims:/usr/bin', isExec)).toBeNull();
  });

  test('passes an absolute path through untouched', () => {
    expect(resolveProgram('/custom/bin/node', '/usr/bin', isExec)).toBe(
      '/custom/bin/node'
    );
  });

  test('passes an explicitly relative path through untouched', () => {
    expect(resolveProgram('./server', '/usr/bin', isExec)).toBe('./server');
  });

  test('re-resolves to the new location when the interpreter moves', () => {
    // The DECK-57 case: a stored bare name survives the move; a stored
    // absolute manager path would not have.
    const moved = new Set(['/opt/newmgr/shims/node']);
    expect(
      resolveProgram('node', '/opt/newmgr/shims:/usr/bin', p => moved.has(p))
    ).toBe('/opt/newmgr/shims/node');
  });
});

describe('adoptHelperPath', () => {
  const composed = () => '/opt/homebrew/bin:/usr/bin:/bin';

  test("a bundle helper swaps launchd's bare PATH for the composed one", () => {
    const env: Record<string, string | undefined> = {
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    };

    adoptHelperPath(env, '/Applications/m.app', composed);

    expect(env.PATH).toBe('/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin');
  });

  test('keeps an inherited dir the composed set lacks, after it', () => {
    const env: Record<string, string | undefined> = {
      PATH: '/custom/bin:/usr/bin',
    };

    adoptHelperPath(env, '/Applications/m.app', composed);

    expect(env.PATH).toBe('/opt/homebrew/bin:/usr/bin:/bin:/custom/bin');
  });

  test('outside a bundle the inherited PATH is left alone', () => {
    const env: Record<string, string | undefined> = { PATH: '/usr/bin:/bin' };

    adoptHelperPath(env, null, composed);

    expect(env.PATH).toBe('/usr/bin:/bin');
  });
});
