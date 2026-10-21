import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';

import {
  clientChunkResponse,
  parseChunkManifest,
  withEarlierChunks,
  writeClientBundle,
} from '../client-assets.ts';
import { buildClientBundle, type ClientBundle } from '../client-bundle.ts';

const CHUNK_REF = /chunk-[a-z0-9]+\.js/g;

describe('the split client bundle', () => {
  let bundle: ClientBundle;

  test('builds an entry with the diff renderer left out as chunks', async () => {
    bundle = await buildClientBundle();
    const names = Object.keys(bundle.chunks);
    expect(names.length).toBeGreaterThan(1);
    for (const name of names) expect(name).toMatch(/^chunk-[a-z0-9]+\.js$/);
    // The fence theme's name is a string only the renderer module holds.
    expect(bundle.appJs).not.toContain('board-code-fence');
    expect(
      Object.values(bundle.chunks).some(c => c.includes('board-code-fence'))
    ).toBe(true);
  }, 60_000);

  test('every chunk the entry or a chunk imports is in the bundle', () => {
    const wanted = new Set<string>();
    for (const text of [bundle.appJs, ...Object.values(bundle.chunks)])
      for (const m of text.matchAll(CHUNK_REF)) wanted.add(m[0]);
    expect(wanted.size).toBeGreaterThan(0);
    for (const name of wanted) expect(bundle.chunks[name]).toBeDefined();
  });

  test('the compiled build reads back every chunk it was written with', () => {
    const dir = mkdtempSync(join(tmpdir(), 'board-client-'));
    try {
      writeClientBundle(dir, bundle);
      expect(readFileSync(join(dir, 'app.js.txt'), 'utf8')).toBe(bundle.appJs);
      expect(readFileSync(join(dir, 'app.css'), 'utf8')).toBe(bundle.appCss);
      const chunks = parseChunkManifest(
        readFileSync(join(dir, 'chunks.json.txt'), 'utf8')
      );
      expect(chunks).toEqual(bundle.chunks);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('clientChunkResponse', () => {
  const chunks = { 'chunk-abc123.js': 'export const a = 1;' };

  test('serves a known chunk as javascript, cached for good', async () => {
    const res = clientChunkResponse('/chunk-abc123.js', chunks)!;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(
      'text/javascript; charset=utf-8'
    );
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable'
    );
    expect(await res.text()).toBe('export const a = 1;');
  });

  test('answers 404 for a chunk name it does not hold', () => {
    expect(clientChunkResponse('/chunk-ffff.js', chunks)!.status).toBe(404);
  });

  test('passes on every path that is not a chunk', () => {
    expect(clientChunkResponse('/app.js', chunks)).toBeNull();
    expect(clientChunkResponse('/chunk-abc123.css', chunks)).toBeNull();
    expect(clientChunkResponse('/x/chunk-abc123.js', chunks)).toBeNull();
    expect(clientChunkResponse('/chunk-../app.js', chunks)).toBeNull();
  });
});

test('a rebuild keeps the chunks an open page may still ask for', () => {
  const prev = {
    appJs: 'a',
    appCss: 'c',
    chunks: { 'chunk-old.js': 'old', 'chunk-same.js': 'same' },
  };
  const next = {
    appJs: 'b',
    appCss: 'd',
    chunks: { 'chunk-new.js': 'new', 'chunk-same.js': 'same' },
  };
  expect(withEarlierChunks(prev, next)).toEqual({
    appJs: 'b',
    appCss: 'd',
    chunks: {
      'chunk-old.js': 'old',
      'chunk-same.js': 'same',
      'chunk-new.js': 'new',
    },
  });
});
