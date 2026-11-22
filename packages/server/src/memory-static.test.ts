import { expect, test } from 'vitest';

import { buildIdOf } from './instance';
import { createMemoryStatic, type SnapshotFs } from './memory-static';

const INDEX = '<html><head><title>app</title></head><body></body></html>';

function fsError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function fakeFs(files: Record<string, string> = {}) {
  const disk = new Map(
    Object.entries(files).map(([p, body]) => [p, { body, mtime: 1 }])
  );
  const state = { broken: false, present: true };
  const guard = () => {
    if (state.broken) throw fsError('EACCES');
    if (!state.present) throw fsError('ENOENT');
  };
  const fs: SnapshotFs = {
    list(root) {
      guard();
      return [...disk.keys()]
        .filter(p => p.startsWith(`${root}/`))
        .map(p => p.slice(root.length + 1));
    },
    read(path) {
      guard();
      const file = disk.get(path);
      if (!file) throw fsError('ENOENT');
      return new TextEncoder().encode(file.body);
    },
    mtimeMs(path) {
      guard();
      const file = disk.get(path);
      if (!file) throw fsError('ENOENT');
      return file.mtime;
    },
  };
  const write = (path: string, body: string) =>
    disk.set(path, { body, mtime: (disk.get(path)?.mtime ?? 0) + 1 });
  return { fs, state, write };
}

test('serves assets and index from memory after the folder becomes unreadable', async () => {
  const { fs, state } = fakeFs({
    'dist/index.html': INDEX,
    'dist/assets/app.js': 'console.log(1)',
  });
  const mem = createMemoryStatic('dist', fs);
  state.broken = true;

  const asset = mem.serve('/assets/app.js');
  expect(await asset?.text()).toBe('console.log(1)');
  expect(asset?.headers.get('content-type')).toContain('javascript');
  const index = mem.index();
  expect(index?.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(await index?.text()).toContain('<title>app</title>');
  expect(mem.health()).toEqual({ ok: true, buildId: buildIdOf(INDEX) });
});

test('index html carries the host signal script with the build id', async () => {
  const { fs } = fakeFs({ 'dist/index.html': INDEX });
  const html = await createMemoryStatic('dist', fs).index()?.text();
  expect(html).toMatch(/^<html><head><script>/);
  expect(html).toContain(JSON.stringify(buildIdOf(INDEX)));
});

test('no dist folder is healthy with a null build id and no index', () => {
  const { fs, state } = fakeFs();
  state.present = false;
  const mem = createMemoryStatic('dist', fs);
  expect(mem.health()).toEqual({ ok: true, buildId: null });
  expect(mem.index()).toBeNull();
  expect(mem.serve('/assets/app.js')).toBeNull();
});

test('a dist folder that cannot be read is not ok', () => {
  const { fs, state } = fakeFs({ 'dist/index.html': INDEX });
  state.broken = true;
  const mem = createMemoryStatic('dist', fs);
  expect(mem.health()).toEqual({ ok: false, buildId: null });
  expect(mem.index()).toBeNull();
});

test('a rebuilt dist is picked up on the next index request', async () => {
  const { fs, write } = fakeFs({
    'dist/index.html': INDEX,
    'dist/assets/a.js': 'a',
  });
  const mem = createMemoryStatic('dist', fs);
  const rebuilt = INDEX.replace('app', 'app v2');
  write('dist/index.html', rebuilt);
  write('dist/assets/b.js', 'b');

  expect(await mem.index()?.text()).toContain('app v2');
  expect(mem.health()).toEqual({ ok: true, buildId: buildIdOf(rebuilt) });
  expect(await mem.serve('/assets/b.js')?.text()).toBe('b');
});

test('a dist folder that appears after boot is picked up', async () => {
  const { fs, state } = fakeFs({ 'dist/index.html': INDEX });
  state.present = false;
  const mem = createMemoryStatic('dist', fs);
  state.present = true;
  expect(await mem.index()?.text()).toContain('<title>app</title>');
  expect(mem.health()).toEqual({ ok: true, buildId: buildIdOf(INDEX) });
});

test('a failed re-read keeps the last good copy', async () => {
  const { fs, write } = fakeFs({ 'dist/index.html': INDEX });
  const mem = createMemoryStatic('dist', fs);
  write('dist/index.html', INDEX.replace('app', 'half written'));
  const read = fs.read;
  fs.read = () => {
    throw fsError('EIO');
  };

  expect(await mem.index()?.text()).toContain('<title>app</title>');
  expect(mem.health()).toEqual({ ok: true, buildId: buildIdOf(INDEX) });
  fs.read = read;
  expect(await mem.index()?.text()).toContain('half written');
});
