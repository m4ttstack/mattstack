// src/__tests__/skill-path.test.ts
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  makeCachedPluginListRunner,
  resolveSkillPath,
  runPluginList,
  skillBindMessage,
  type PluginEntry,
  type PluginListResult,
  type PluginListRunner,
} from '../skill-path.ts';

function fixturePlugin(
  installPath: string,
  extra: Partial<PluginEntry> = {}
): PluginEntry {
  return { id: 'acme@acme', enabled: true, installPath, ...extra };
}

function listed(plugins: PluginEntry[]): PluginListRunner {
  return async () => ({ ok: true, plugins });
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

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-path-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveSkillPath: found', () => {
  test('resolves a skills/<name>/SKILL.md path', async () => {
    writeSkillMd(join(root, 'skills', 'board-review'));
    expect(
      await resolveSkillPath('acme:board-review', listed([fixturePlugin(root)]))
    ).toEqual({
      ok: true,
      path: realpathSync(join(root, 'skills', 'board-review', 'SKILL.md')),
    });
  });

  test('resolves a skills/<category>/<name>/SKILL.md path', async () => {
    writeSkillMd(join(root, 'skills', 'board', 'board-doctor'));
    expect(
      await resolveSkillPath('acme:board-doctor', listed([fixturePlugin(root)]))
    ).toEqual({
      ok: true,
      path: realpathSync(
        join(root, 'skills', 'board', 'board-doctor', 'SKILL.md')
      ),
    });
  });

  test('resolves an attachments/<name>/SKILL.md path when not under skills/', async () => {
    writeSkillMd(join(root, 'attachments', 'board-respond'));
    expect(
      await resolveSkillPath(
        'acme:board-respond',
        listed([fixturePlugin(root)])
      )
    ).toEqual({
      ok: true,
      path: realpathSync(
        join(root, 'attachments', 'board-respond', 'SKILL.md')
      ),
    });
  });

  test('prefers skills/ over attachments/ when both exist', async () => {
    writeSkillMd(join(root, 'skills', 'dup'));
    writeSkillMd(join(root, 'attachments', 'dup'));
    expect(
      await resolveSkillPath('acme:dup', listed([fixturePlugin(root)]))
    ).toEqual({
      ok: true,
      path: realpathSync(join(root, 'skills', 'dup', 'SKILL.md')),
    });
  });

  test('skips a disabled install of the same plugin for an enabled one', async () => {
    writeSkillMd(join(root, 'skills', 'board-review'));
    const plugins = [
      fixturePlugin('/nowhere', { id: 'acme@old', enabled: false }),
      fixturePlugin(root),
    ];
    const result = await resolveSkillPath('acme:board-review', listed(plugins));
    expect(result.ok).toBe(true);
  });
});

describe('resolveSkillPath: reasons', () => {
  test.each(['no-colon-here', ':board-review', 'acme:', 'a:b:c'])(
    'bad-name for %p, without listing plugins',
    async name => {
      let calls = 0;
      const listPlugins: PluginListRunner = async () => {
        calls++;
        return { ok: true, plugins: [] };
      };
      expect(await resolveSkillPath(name, listPlugins)).toEqual({
        ok: false,
        failure: { reason: 'bad-name' },
      });
      expect(calls).toBe(0);
    }
  );

  test('claude-missing when Claude Code is not at the binary path', async () => {
    const listPlugins: PluginListRunner = async () => ({
      ok: false,
      failure: { kind: 'missing', claudeBin: '/x/claude' },
    });
    expect(await resolveSkillPath('acme:board-review', listPlugins)).toEqual({
      ok: false,
      failure: { reason: 'claude-missing', claudeBin: '/x/claude' },
    });
  });

  test('claude-failed when the plugin list call fails, carrying its detail', async () => {
    const listPlugins: PluginListRunner = async () => ({
      ok: false,
      failure: { kind: 'failed', claudeBin: '/x/claude', detail: 'exited 1' },
    });
    expect(await resolveSkillPath('acme:board-review', listPlugins)).toEqual({
      ok: false,
      failure: {
        reason: 'claude-failed',
        claudeBin: '/x/claude',
        detail: 'exited 1',
      },
    });
  });

  test('claude-failed when the list source throws', async () => {
    const listPlugins: PluginListRunner = async () => {
      throw new Error('boom');
    };
    const result = await resolveSkillPath('acme:board-review', listPlugins);
    expect(result).toMatchObject({
      ok: false,
      failure: { reason: 'claude-failed', detail: 'boom' },
    });
  });

  test("plugin-not-installed when no plugin id matches the name's prefix", async () => {
    const plugins = [fixturePlugin('/nowhere', { id: 'other@marketplace' })];
    expect(
      await resolveSkillPath('acme:board-review', listed(plugins))
    ).toEqual({
      ok: false,
      failure: { reason: 'plugin-not-installed', plugin: 'acme' },
    });
  });

  test('plugin-not-installed when installPath does not exist on disk', async () => {
    const plugins = [fixturePlugin('/definitely/not/a/real/path/xyz')];
    expect(
      await resolveSkillPath('acme:board-review', listed(plugins))
    ).toEqual({
      ok: false,
      failure: { reason: 'plugin-not-installed', plugin: 'acme' },
    });
  });

  test('plugin-disabled when the only matching plugin is turned off', async () => {
    writeSkillMd(join(root, 'skills', 'board-review'));
    const plugins = [fixturePlugin(root, { enabled: false })];
    expect(
      await resolveSkillPath('acme:board-review', listed(plugins))
    ).toEqual({
      ok: false,
      failure: {
        reason: 'plugin-disabled',
        plugin: 'acme',
        pluginId: 'acme@acme',
      },
    });
  });

  test('skill-missing when the plugin has no such skill anywhere', async () => {
    mkdirSync(join(root, 'skills'), { recursive: true });
    expect(
      await resolveSkillPath('acme:missing', listed([fixturePlugin(root)]))
    ).toEqual({
      ok: false,
      failure: { reason: 'skill-missing', plugin: 'acme', skill: 'missing' },
    });
  });
});

describe('resolveSkillPath: cached list', () => {
  test('a miss against the cached list retries once against a fresh one', async () => {
    writeSkillMd(join(root, 'skills', 'board-review'));
    const asked: Array<boolean | undefined> = [];
    const listPlugins: PluginListRunner = async opts => {
      asked.push(opts?.fresh);
      return {
        ok: true,
        plugins: opts?.fresh ? [fixturePlugin(root)] : [],
      };
    };
    const result = await resolveSkillPath('acme:board-review', listPlugins);
    expect(result.ok).toBe(true);
    expect(asked).toEqual([undefined, true]);
  });

  test('a Claude failure is not retried', async () => {
    let calls = 0;
    const listPlugins: PluginListRunner = async () => {
      calls++;
      return {
        ok: false,
        failure: { kind: 'missing', claudeBin: '/x/claude' },
      };
    };
    await resolveSkillPath('acme:board-review', listPlugins);
    expect(calls).toBe(1);
  });
});

describe('skillBindMessage', () => {
  const home = '/Users/someone';
  test.each([
    [
      { reason: 'claude-missing', claudeBin: `${home}/.local/bin/claude` },
      "Couldn't load acme:board-review: Claude Code isn't at ~/.local/bin/claude. Open Setup status to install it.",
    ],
    [
      {
        reason: 'claude-failed',
        claudeBin: '/opt/claude',
        detail: 'exited 2',
      },
      "Couldn't load acme:board-review: Claude Code at /opt/claude couldn't list its plugins (exited 2). Open Setup status to check it.",
    ],
    [
      { reason: 'plugin-not-installed', plugin: 'acme' },
      "Couldn't load acme:board-review: the acme plugin isn't installed. Run rt skills sync, then launch again.",
    ],
    [
      { reason: 'plugin-disabled', plugin: 'acme', pluginId: 'acme@acme' },
      "Couldn't load acme:board-review: the acme plugin is turned off. Run claude plugin enable acme@acme, then launch again.",
    ],
    [
      { reason: 'skill-missing', plugin: 'acme', skill: 'board-review' },
      "Couldn't load acme:board-review: the acme plugin has no board-review skill. Run rt skills sync, or fix the lane's skill binding.",
    ],
    [
      { reason: 'bad-name' },
      "Couldn't load acme:board-review: \"acme:board-review\" isn't a plugin:skill name. Fix the lane's skill binding.",
    ],
  ] as const)('%o', (failure, expected) => {
    expect(skillBindMessage('acme:board-review', failure, home)).toBe(expected);
  });
});

describe('runPluginList', () => {
  test('ok:true with the parsed array on a clean exit', async () => {
    const bin = fakeClaudeBin(
      root,
      JSON.stringify([{ id: 'acme@acme', enabled: true, installPath: '/x' }])
    );
    expect(await runPluginList(bin)).toEqual({
      ok: true,
      plugins: [{ id: 'acme@acme', enabled: true, installPath: '/x' }],
    });
  });

  test('failed with the exit code on a non-zero exit', async () => {
    const bin = fakeClaudeBin(root, 'boom', 1);
    expect(await runPluginList(bin)).toEqual({
      ok: false,
      failure: { kind: 'failed', claudeBin: bin, detail: 'exited 1' },
    });
  });

  test.each(['not json at all', JSON.stringify({ not: 'an array' })])(
    'failed on unreadable output %p',
    async stdout => {
      const bin = fakeClaudeBin(root, stdout);
      expect(await runPluginList(bin)).toEqual({
        ok: false,
        failure: {
          kind: 'failed',
          claudeBin: bin,
          detail: 'printed an unreadable plugin list',
        },
      });
    }
  );

  test("missing when the binary doesn't exist", async () => {
    const bin = '/definitely/not/a/real/binary/xyz';
    expect(await runPluginList(bin)).toEqual({
      ok: false,
      failure: { kind: 'missing', claudeBin: bin },
    });
  });
});

describe('makeCachedPluginListRunner', () => {
  const failure: PluginListResult = {
    ok: false,
    failure: { kind: 'missing', claudeBin: '/x' },
  };

  test('caches a successful result across calls', async () => {
    let calls = 0;
    const plugins = [fixturePlugin('/x')];
    const runner = makeCachedPluginListRunner(async () => {
      calls++;
      return { ok: true, plugins };
    });
    for (let i = 0; i < 3; i++)
      expect(await runner()).toEqual({ ok: true, plugins });
    expect(calls).toBe(1);
  });

  test('does NOT cache a failure: retries on the next call', async () => {
    let calls = 0;
    const runner = makeCachedPluginListRunner(async () => {
      calls++;
      return failure;
    });
    expect(await runner()).toEqual(failure);
    expect(await runner()).toEqual(failure);
    expect(calls).toBe(2);
  });

  test("a transient failure doesn't pin a later success out of the cache", async () => {
    let calls = 0;
    const plugins = [fixturePlugin('/x')];
    const runner = makeCachedPluginListRunner(async () => {
      calls++;
      return calls === 1 ? failure : { ok: true, plugins };
    });
    expect(await runner()).toEqual(failure);
    expect(await runner()).toEqual({ ok: true, plugins });
    expect(await runner()).toEqual({ ok: true, plugins });
    expect(calls).toBe(2);
  });

  test('caches a successful empty list (still a real answer)', async () => {
    let calls = 0;
    const runner = makeCachedPluginListRunner(async () => {
      calls++;
      return { ok: true, plugins: [] };
    });
    await runner();
    await runner();
    expect(calls).toBe(1);
  });

  test('fresh refetches and replaces the cached list', async () => {
    let calls = 0;
    const runner = makeCachedPluginListRunner(async () => {
      calls++;
      return { ok: true, plugins: [fixturePlugin(`/v${calls}`)] };
    });
    await runner();
    expect(await runner({ fresh: true })).toEqual({
      ok: true,
      plugins: [fixturePlugin('/v2')],
    });
    expect(await runner()).toEqual({
      ok: true,
      plugins: [fixturePlugin('/v2')],
    });
    expect(calls).toBe(2);
  });
});
