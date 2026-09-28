import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';

import { commit, gitRepo } from '../../test/git-fixture.ts';

const dir = mkdtempSync(join(tmpdir(), 'local-new-code-'));
process.env.LOCAL_REGISTRY_PATH = join(dir, 'registry.json');

const source = await import('../edge/source.ts');
const { getRecord, putRecord, reloadRegistry } = await import('./records.ts');
const { newCodeFor, resetNewCodeCache, stampDeploy, stampSelfOnBoot } =
  await import('./new-code.ts');

const MANIFEST = JSON.stringify({ name: 'x', commands: {}, dev: {} });

function setup(): { root: string; appDir: string; first: string } {
  const root = gitRepo({
    'apps/x/mattstack.deck.json': MANIFEST,
    'apps/x/a.ts': '1',
    'packages/y/b.ts': '1',
    'bun.lock': '1',
    'lib/other.ts': '1',
  });
  const first = commit(root, { 'apps/x/a.ts': '2' });
  const appDir = join(root, 'apps/x');
  putRecord({
    name: 'x',
    managedBy: 'rt',
    port: 4999,
    kind: 'service',
    createdAt: 'x',
    dev: { workingDirectory: appDir },
    lastDeploy: { sha: first, at: 'then' },
  });
  return { root, appDir, first };
}

beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  reloadRegistry();
  resetNewCodeCache();
});

let warn: ReturnType<typeof spyOn> | undefined;
let spawn: ReturnType<typeof spyOn> | undefined;
afterEach(() => {
  warn?.mockRestore();
  spawn?.mockRestore();
  rmSync(`${process.env.LOCAL_REGISTRY_PATH}.tmp`, {
    recursive: true,
    force: true,
  });
});

function breakRegistryWrites(): void {
  mkdirSync(`${process.env.LOCAL_REGISTRY_PATH}.tmp`);
}

test('no stamp baselines at HEAD and reports no new code', () => {
  const { first } = setup();
  const { lastDeploy: _, ...rest } = getRecord('x')!;
  putRecord(rest);
  expect(newCodeFor(getRecord('x')!)).toBeNull();
  expect(getRecord('x')!.lastDeploy?.sha).toBe(first);
});

test('HEAD equal to the stamp reports no new code', () => {
  setup();
  expect(newCodeFor(getRecord('x')!)).toBeNull();
});

test("a commit under the app's own dir is new code, with short shas", () => {
  const { root, first } = setup();
  const head = commit(root, { 'apps/x/a.ts': '3' });
  expect(newCodeFor(getRecord('x')!)).toEqual({
    deployed: first.slice(0, 7),
    head: head.slice(0, 7),
  });
});

test('a commit under packages/ is new code', () => {
  const { root } = setup();
  commit(root, { 'packages/y/b.ts': '2' });
  expect(newCodeFor(getRecord('x')!)).not.toBeNull();
});

test('a bun.lock change is new code', () => {
  const { root } = setup();
  commit(root, { 'bun.lock': '2' });
  expect(newCodeFor(getRecord('x')!)).not.toBeNull();
});

test('a commit touching only other paths is not new code', () => {
  const { root } = setup();
  commit(root, { 'lib/other.ts': '2' });
  expect(newCodeFor(getRecord('x')!)).toBeNull();
});

test('an unknown stamp sha reports nothing and warns once', () => {
  const { root } = setup();
  warn = spyOn(console, 'warn').mockImplementation(() => {});
  const rec = {
    ...getRecord('x')!,
    lastDeploy: { sha: 'f'.repeat(40), at: 'then' },
  };
  expect(newCodeFor(rec)).toBeNull();
  commit(root, { 'apps/x/a.ts': '9' });
  expect(newCodeFor(rec)).toBeNull();
  expect(warn).toHaveBeenCalledTimes(1);
});

test('newCodeFor outside a git checkout warns once and reports nothing', () => {
  setup();
  warn = spyOn(console, 'warn').mockImplementation(() => {});
  const rec = {
    ...getRecord('x')!,
    dev: { workingDirectory: mkdtempSync(join(tmpdir(), 'not-git-')) },
  };
  expect(newCodeFor(rec)).toBeNull();
  expect(newCodeFor(rec)).toBeNull();
  expect(warn).toHaveBeenCalledTimes(1);
});

test('a deleted working directory never throws', () => {
  const { root, appDir, first } = setup();
  warn = spyOn(console, 'warn').mockImplementation(() => {});
  rmSync(root, { recursive: true, force: true });
  const rec = getRecord('x')!;
  expect(newCodeFor(rec)).toBeNull();
  expect(() => stampDeploy('x', appDir)).not.toThrow();
  expect(() =>
    stampSelfOnBoot({ devMode: true, runMode: 'source', record: rec })
  ).not.toThrow();
  expect(getRecord('x')!.lastDeploy?.sha).toBe(first);
});

test('stampDeploy writes HEAD of the checkout', () => {
  const { root } = setup();
  const head = commit(root, { 'apps/x/a.ts': '4' });
  stampDeploy(
    'x',
    join(root, 'apps/x'),
    () => new Date('2026-09-28T00:00:00Z')
  );
  expect(getRecord('x')!.lastDeploy).toEqual({
    sha: head,
    at: '2026-09-28T00:00:00.000Z',
  });
});

test('stampDeploy outside a git checkout warns and writes nothing', () => {
  const { first } = setup();
  warn = spyOn(console, 'warn').mockImplementation(() => {});
  stampDeploy('x', mkdtempSync(join(tmpdir(), 'not-git-')));
  expect(getRecord('x')!.lastDeploy?.sha).toBe(first);
  expect(warn).toHaveBeenCalledTimes(1);
});

test('stampSelfOnBoot stamps only a dev deck running source', () => {
  const { root, first } = setup();
  const head = commit(root, { 'apps/x/a.ts': '5' });
  for (const [devMode, runMode] of [
    [false, 'source'],
    [true, 'pinned'],
    [true, 'standalone'],
  ] as const) {
    stampSelfOnBoot({ devMode, runMode, record: getRecord('x') });
    expect(getRecord('x')!.lastDeploy?.sha).toBe(first);
  }
  stampSelfOnBoot({ devMode: true, runMode: 'source', record: getRecord('x') });
  expect(getRecord('x')!.lastDeploy?.sha).toBe(head);
});

test('a registry write failure while baselining warns once and reports nothing', () => {
  setup();
  const { lastDeploy: _, ...rest } = getRecord('x')!;
  putRecord(rest);
  breakRegistryWrites();
  warn = spyOn(console, 'warn').mockImplementation(() => {});
  expect(newCodeFor(getRecord('x')!)).toBeNull();
  expect(newCodeFor(getRecord('x')!)).toBeNull();
  expect(warn).toHaveBeenCalledTimes(1);
});

test('stampDeploy survives a registry write failure', () => {
  const { root, appDir, first } = setup();
  commit(root, { 'apps/x/a.ts': '6' });
  breakRegistryWrites();
  warn = spyOn(console, 'warn').mockImplementation(() => {});
  expect(() => stampDeploy('x', appDir)).not.toThrow();
  expect(warn).toHaveBeenCalledTimes(1);
  reloadRegistry();
  expect(getRecord('x')!.lastDeploy?.sha).toBe(first);
});

test('a checkout that vanishes before the diff never throws', () => {
  const { root } = setup();
  commit(root, { 'apps/x/a.ts': '7' });
  const real = source.git;
  spawn = spyOn(source, 'git').mockImplementation((args, cwd) => {
    if (args[0] === 'diff') throw new Error(`ENOENT: ${cwd}`);
    return real(args, cwd);
  });
  warn = spyOn(console, 'warn').mockImplementation(() => {});
  expect(newCodeFor(getRecord('x')!)).toBeNull();
  expect(newCodeFor(getRecord('x')!)).toBeNull();
  expect(warn).toHaveBeenCalledTimes(1);
});
