import { Hono } from 'hono';
import { expect, test } from 'vitest';

import { buildIdOf } from './instance';
import type { SnapshotFs } from './memory-static';
import { mountStatic } from './static';

const ICONS = [
  'favicon.svg',
  'favicon-32.png',
  'apple-touch-icon.png',
  'favicon.ico',
];

function fakeFs(files: Record<string, string>): SnapshotFs {
  return {
    list: root =>
      Object.keys(files)
        .filter(p => p.startsWith(`${root}/`))
        .map(p => p.slice(root.length + 1)),
    read: path => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return new TextEncoder().encode(files[path]);
    },
    mtimeMs: () => 1,
  };
}

const distFiles: Record<string, string> = {
  './dist/index.html': '<html><head></head><body>index.html</body></html>',
  './dist/assets/index.js': 'ASSET:./dist/assets/index.js',
  './dist/fonts/x.woff2': 'FONT:./dist/fonts/x.woff2',
  ...Object.fromEntries(ICONS.map(i => [`./dist/${i}`, `STATIC:./dist/${i}`])),
};

function disk() {
  const app = new Hono();
  mountStatic(app, { fs: fakeFs(distFiles) });
  app.get('/ws', c => c.text('UPGRADE'));
  return app;
}

test('an unknown page path falls through to the SPA shell', async () => {
  const res = await disk().request('/some/client/route');
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('index.html');
});

test('an unmatched /api path is a 404, never the SPA shell', async () => {
  const res = await disk().request('/api/does-not-exist');
  expect(res.status).toBe(404);
  expect(await res.text()).not.toContain('index.html');
});

test('/ws reaches its route instead of the fallback', async () => {
  expect(await (await disk().request('/ws')).text()).toBe('UPGRADE');
});

test('assets, fonts, favicon and the raster icons come from dist', async () => {
  const app = disk();
  expect(await (await app.request('/assets/index.js')).text()).toContain(
    './dist'
  );
  expect(await (await app.request('/fonts/x.woff2')).text()).toContain(
    './dist'
  );
  expect(await (await app.request('/favicon.svg')).text()).toBe(
    'STATIC:./dist/favicon.svg'
  );
  for (const icon of [
    'favicon-32.png',
    'apple-touch-icon.png',
    'favicon.ico',
  ]) {
    expect(await (await app.request(`/${icon}`)).text()).toBe(
      `STATIC:./dist/${icon}`
    );
  }
});

test('a missing asset falls through to the SPA shell, as before', async () => {
  const res = await disk().request('/assets/gone.js');
  expect(await res.text()).toContain('index.html');
});

test('with no dist the page is a 404 and health is ok with no build id', async () => {
  const app = new Hono();
  const { health } = mountStatic(app, { fs: fakeFs({}) });
  expect((await app.request('/some/page')).status).toBe(404);
  expect(health()).toEqual({ ok: true, buildId: null });
});

test('disk mode reports the build id of the index it serves', () => {
  const { health } = mountStatic(new Hono(), { fs: fakeFs(distFiles) });
  expect(health()).toEqual({
    ok: true,
    buildId: buildIdOf(distFiles['./dist/index.html']),
  });
});

test('embedded mode serves from the manifest and falls back to its index', async () => {
  const app = new Hono();
  const manifest = {
    indexHtmlPath: '/$bunfs/root/index.html',
    files: { '/assets/a.js': '/$bunfs/root/assets/a.js' },
  };
  mountStatic(app, {
    embedded: manifest,
    toResponse: asset => new Response(`EMBEDDED:${asset.path}`),
    fs: fakeFs({ '/$bunfs/root/index.html': 'INDEX' }),
  });
  expect(await (await app.request('/assets/a.js')).text()).toBe(
    'EMBEDDED:/$bunfs/root/assets/a.js'
  );
  expect(await (await app.request('/anything')).text()).toBe('INDEX');
  expect((await app.request('/api/nope')).status).toBe(404);
});

test('embedded mode serves the same icons as disk mode, falling back to its index on a miss', async () => {
  const app = new Hono();
  mountStatic(app, {
    embedded: {
      indexHtmlPath: '/$bunfs/root/index.html',
      files: {
        '/favicon.ico': '/$bunfs/root/favicon.ico',
        '/favicon-32.png': '/$bunfs/root/favicon-32.png',
        '/apple-touch-icon.png': '/$bunfs/root/apple-touch-icon.png',
      },
    },
    toResponse: asset => new Response(`EMBEDDED:${asset.path}`),
    fs: fakeFs({ '/$bunfs/root/index.html': 'INDEX' }),
  });
  for (const icon of [
    'favicon.ico',
    'favicon-32.png',
    'apple-touch-icon.png',
  ]) {
    expect(await (await app.request(`/${icon}`)).text()).toBe(
      `EMBEDDED:/$bunfs/root/${icon}`
    );
  }
  expect(await (await app.request('/icon-512.png')).text()).toBe('INDEX');
});

test('embedded index html carries the host signal script', async () => {
  const app = new Hono();
  const indexHtml =
    '<html><head><meta name="mattstack-host-signal"><title>e</title></head></html>';
  const { health } = mountStatic(app, {
    embedded: { indexHtmlPath: '/$bunfs/root/index.html', files: {} },
    toResponse: asset => new Response(`EMBEDDED:${asset.path}`),
    fs: fakeFs({ '/$bunfs/root/index.html': indexHtml }),
  });
  const buildId = buildIdOf(indexHtml);
  const res = await app.request('/anything');
  expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
  const html = await res.text();
  expect(html).toMatch(/^<html><head><script>/);
  expect(html).toContain(JSON.stringify(buildId));
  expect(health()).toEqual({ ok: true, buildId });
});

test('an embedded index without the opt-in marker is served unchanged', async () => {
  const app = new Hono();
  const indexHtml = '<html><head><title>e</title></head></html>';
  mountStatic(app, {
    embedded: { indexHtmlPath: '/$bunfs/root/index.html', files: {} },
    toResponse: asset => new Response(`EMBEDDED:${asset.path}`),
    fs: fakeFs({ '/$bunfs/root/index.html': indexHtml }),
  });
  expect(await (await app.request('/anything')).text()).toBe(indexHtml);
});

const unreadable: SnapshotFs = {
  list: () => {
    throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
  },
  read: () => {
    throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
  },
  mtimeMs: () => {
    throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
  },
};

test('disk mode with dist unreadable at boot answers pages with a 503 envelope', async () => {
  const app = new Hono();
  const { health } = mountStatic(app, { fs: unreadable });
  expect(health().ok).toBe(false);
  const res = await app.request('/some/page');
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: expect.any(String) });
});

test('embedded mode with an unreadable index answers pages with a 503 envelope', async () => {
  const app = new Hono();
  const { health } = mountStatic(app, {
    embedded: { indexHtmlPath: '/$bunfs/root/index.html', files: {} },
    toResponse: asset => new Response(`EMBEDDED:${asset.path}`),
    fs: unreadable,
  });
  expect(health().ok).toBe(false);
  const res = await app.request('/anything');
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: expect.any(String) });
});
