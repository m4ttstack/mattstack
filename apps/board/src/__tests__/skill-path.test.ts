// src/__tests__/skill-path.test.ts
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import {
  CODEX_PLUGIN_LIST_TIMEOUT_MS,
  codexBin,
  codexHomeFor,
  makeCachedPluginListRunner,
  resolveSkillPath,
  runCodexPluginList,
  runPluginList,
  type PluginEntry,
} from '../skill-path.ts';

function fixturePlugin(
  installPath: string,
  extra: Partial<PluginEntry> = {}
): PluginEntry {
  return { id: 'acme@acme', enabled: true, installPath, ...extra };
}

/** A fake "claude" binary: a shell script that prints `stdout` and exits `code`. */
function fakeClaudeBin(dir: string, stdout: string, code = 0): string {
  const path = join(dir, 'fake-claude.sh');
  writeFileSync(
    path,
    `#!/bin/sh\nprintf '%s' ${JSON.stringify(stdout)}\nexit ${code}\n`
  );
  chmodSync(path, 0o755);
  return path;
}

function writeSkillMd(dir: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    '---\nname: fixture\n---\n\nfixture body\n'
  );
}

describe('resolveSkillPath', () => {
  test('resolves a skills/<name>/SKILL.md path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-path-'));
    try {
      writeSkillMd(join(root, 'skills', 'board-review'));
      const listPlugins = async () => [fixturePlugin(root)];
      const path = await resolveSkillPath('acme:board-review', listPlugins);
      expect(path).toBe(
        realpathSync(join(root, 'skills', 'board-review', 'SKILL.md'))
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('resolves a skills/<category>/<name>/SKILL.md path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-path-'));
    try {
      writeSkillMd(join(root, 'skills', 'board', 'board-doctor'));
      const listPlugins = async () => [fixturePlugin(root)];
      const path = await resolveSkillPath('acme:board-doctor', listPlugins);
      expect(path).toBe(
        realpathSync(join(root, 'skills', 'board', 'board-doctor', 'SKILL.md'))
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('resolves an attachments/<name>/SKILL.md path when not under skills/', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-path-'));
    try {
      writeSkillMd(join(root, 'attachments', 'board-respond'));
      const listPlugins = async () => [fixturePlugin(root)];
      const path = await resolveSkillPath('acme:board-respond', listPlugins);
      expect(path).toBe(
        realpathSync(join(root, 'attachments', 'board-respond', 'SKILL.md'))
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('prefers skills/ over attachments/ when both exist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-path-'));
    try {
      writeSkillMd(join(root, 'skills', 'dup'));
      writeSkillMd(join(root, 'attachments', 'dup'));
      const listPlugins = async () => [fixturePlugin(root)];
      const path = await resolveSkillPath('acme:dup', listPlugins);
      expect(path).toBe(realpathSync(join(root, 'skills', 'dup', 'SKILL.md')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('returns null when the skill is not found anywhere in the plugin', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-path-'));
    try {
      mkdirSync(join(root, 'skills'), { recursive: true });
      const listPlugins = async () => [fixturePlugin(root)];
      const path = await resolveSkillPath('acme:missing', listPlugins);
      expect(path).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns null when no plugin id matches the name's prefix", async () => {
    const listPlugins = async () => [
      fixturePlugin('/nowhere', { id: 'other@marketplace' }),
    ];
    expect(await resolveSkillPath('acme:board-review', listPlugins)).toBeNull();
  });

  test('returns null when the matching plugin is disabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-path-'));
    try {
      writeSkillMd(join(root, 'skills', 'board-review'));
      const listPlugins = async () => [fixturePlugin(root, { enabled: false })];
      expect(
        await resolveSkillPath('acme:board-review', listPlugins)
      ).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('returns null for a name with no plugin prefix', async () => {
    const listPlugins = async () => [fixturePlugin('/nowhere')];
    expect(await resolveSkillPath('no-colon-here', listPlugins)).toBeNull();
  });

  test('returns null when the plugin list source throws', async () => {
    const listPlugins = async () => {
      throw new Error('claude: command not found');
    };
    expect(await resolveSkillPath('acme:board-review', listPlugins)).toBeNull();
  });

  test('returns null when installPath does not exist on disk', async () => {
    const listPlugins = async () => [
      fixturePlugin('/definitely/not/a/real/path/xyz'),
    ];
    expect(await resolveSkillPath('acme:board-review', listPlugins)).toBeNull();
  });
});

describe('runPluginList', () => {
  test('ok:true with the parsed array on a clean exit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-path-runner-'));
    try {
      const bin = fakeClaudeBin(
        dir,
        JSON.stringify([{ id: 'acme@acme', enabled: true, installPath: '/x' }])
      );
      const result = await runPluginList(bin);
      expect(result).toEqual({
        ok: true,
        plugins: [{ id: 'acme@acme', enabled: true, installPath: '/x' }],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('ok:false on a non-zero exit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-path-runner-'));
    try {
      const bin = fakeClaudeBin(dir, 'boom', 1);
      expect(await runPluginList(bin)).toEqual({ ok: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('ok:false on malformed JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-path-runner-'));
    try {
      const bin = fakeClaudeBin(dir, 'not json at all');
      expect(await runPluginList(bin)).toEqual({ ok: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ok:false on valid JSON that isn't an array", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-path-runner-'));
    try {
      const bin = fakeClaudeBin(dir, JSON.stringify({ not: 'an array' }));
      expect(await runPluginList(bin)).toEqual({ ok: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ok:false when the binary doesn't exist (spawn failure)", async () => {
    expect(await runPluginList('/definitely/not/a/real/binary/xyz')).toEqual({
      ok: false,
    });
  });
});

describe('makeCachedPluginListRunner', () => {
  test('caches a successful result across calls', async () => {
    let calls = 0;
    const plugins = [fixturePlugin('/x')];
    const run = async () => {
      calls++;
      return { ok: true as const, plugins };
    };
    const runner = makeCachedPluginListRunner(run);
    expect(await runner()).toEqual(plugins);
    expect(await runner()).toEqual(plugins);
    expect(await runner()).toEqual(plugins);
    expect(calls).toBe(1);
  });

  test('does NOT cache a failure -- retries on the next call', async () => {
    let calls = 0;
    const run = async () => {
      calls++;
      return { ok: false as const };
    };
    const runner = makeCachedPluginListRunner(run);
    expect(await runner()).toEqual([]);
    expect(await runner()).toEqual([]);
    expect(calls).toBe(2);
  });

  test("a transient failure doesn't pin a later success out of the cache", async () => {
    let calls = 0;
    const plugins = [fixturePlugin('/x')];
    const run = async () => {
      calls++;
      return calls === 1
        ? { ok: false as const }
        : { ok: true as const, plugins };
    };
    const runner = makeCachedPluginListRunner(run);
    expect(await runner()).toEqual([]); // transient failure, not cached
    expect(await runner()).toEqual(plugins); // succeeds and is now cached
    expect(await runner()).toEqual(plugins); // served from cache
    expect(calls).toBe(2);
  });

  test('caches a successful empty list (still a real answer)', async () => {
    let calls = 0;
    const run = async () => {
      calls++;
      return { ok: true as const, plugins: [] };
    };
    const runner = makeCachedPluginListRunner(run);
    expect(await runner()).toEqual([]);
    expect(await runner()).toEqual([]);
    expect(calls).toBe(1);
  });
});

/** A fake "codex" binary that records its CODEX_HOME, prints `stdout` and
    exits `code`, optionally after sleeping. */
function fakeCodexBin(
  dir: string,
  stdout: string,
  code = 0,
  sleepSeconds = 0
): string {
  const path = join(dir, 'fake-codex.sh');
  const sleep = sleepSeconds ? `sleep ${sleepSeconds}\n` : '';
  writeFileSync(
    path,
    `#!/bin/sh\nprintf '%s' "$CODEX_HOME" > ${JSON.stringify(join(dir, 'home-seen'))}\n${sleep}printf '%s' ${JSON.stringify(stdout)}\nexit ${code}\n`
  );
  chmodSync(path, 0o755);
  return path;
}

describe('runCodexPluginList', () => {
  const listing = JSON.stringify({
    installed: [
      {
        pluginId: 'acme@acme',
        name: 'acme',
        marketplaceName: 'acme',
        version: '1.2.0',
        installed: true,
        enabled: true,
      },
      {
        name: 'gone',
        marketplaceName: 'acme',
        version: '0.1.0',
        installed: false,
      },
    ],
  });

  test('reads the installed rows against exactly the given CODEX_HOME', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-list-'));
    try {
      const result = await runCodexPluginList(
        fakeCodexBin(dir, listing),
        '/codex-home'
      );
      expect(result).toEqual({
        ok: true,
        data: [
          {
            id: 'acme@acme',
            installPath: '/codex-home/plugins/cache/acme/acme/1.2.0',
            enabled: true,
          },
        ],
      });
      expect(readFileSync(join(dir, 'home-seen'), 'utf8')).toBe('/codex-home');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a non-zero exit says so', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-list-'));
    try {
      const result = await runCodexPluginList(fakeCodexBin(dir, '', 3), '/h');
      expect(result.ok ? '' : result.error.message).toContain('exited 3');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('output the board cannot read says so', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-list-'));
    try {
      const result = await runCodexPluginList(
        fakeCodexBin(dir, 'not json'),
        '/h'
      );
      expect(result.ok ? '' : result.error.message).toContain('cannot read');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a hung codex is killed at the timeout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-list-'));
    try {
      const started = Date.now();
      const result = await runCodexPluginList(
        fakeCodexBin(dir, listing, 0, 5),
        '/h',
        200
      );
      expect(result.ok ? '' : result.error.message).toContain('200ms');
      expect(Date.now() - started).toBeLessThan(4000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a missing binary is a failure, not an empty listing', async () => {
    const result = await runCodexPluginList('/nonexistent/codex', '/h');
    expect(result.ok).toBe(false);
  });

  test('the default timeout is rt plugin listing timeout', () => {
    expect(CODEX_PLUGIN_LIST_TIMEOUT_MS).toBe(10_000);
  });
});

describe('codexHomeFor', () => {
  test('unset CODEX_HOME is <HOME>/.codex', () => {
    expect(codexHomeFor({ HOME: '/u' })).toEqual({
      ok: true,
      data: '/u/.codex',
    });
  });
  test('~ and ~/ expand against HOME', () => {
    expect(codexHomeFor({ HOME: '/u', CODEX_HOME: '~' })).toEqual({
      ok: true,
      data: '/u',
    });
    expect(codexHomeFor({ HOME: '/u', CODEX_HOME: '~/c' })).toEqual({
      ok: true,
      data: '/u/c',
    });
  });
  test('an absolute home is resolved', () => {
    expect(codexHomeFor({ HOME: '/u', CODEX_HOME: '/x/../y' })).toEqual({
      ok: true,
      data: '/y',
    });
  });
  test('a relative home is refused', () => {
    const result = codexHomeFor({ HOME: '/u', CODEX_HOME: 'work' });
    expect(result.ok ? '' : result.error.code).toBe('invalid');
  });
});

describe('codexBin', () => {
  test('is looked up on each call, so a codex installed after the board started is found', () => {
    let found: string | null = null;
    const which = () => found;
    expect(codexBin({ HOME: '/u' }, which)).toBe('/u/.local/bin/codex');
    found = '/opt/homebrew/bin/codex';
    expect(codexBin({ HOME: '/u' }, which)).toBe('/opt/homebrew/bin/codex');
    expect(codexBin({ HOME: '/u', CODEX_BIN: '/x/codex' }, which)).toBe(
      '/x/codex'
    );
  });
});
