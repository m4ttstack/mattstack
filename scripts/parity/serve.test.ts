import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { compareBoard } from './compare';
import type { Board, ParityApp, ParityNode } from './config';
import { harnessConfig, harnessHandler } from './serve';

// A stand-in for a second app: its own board table, ports, design dir, pen and output dir.
const board: Board<'live'> = {
  slug: '01-demo',
  frame: 'Demo Board',
  frameId: 'xyz',
  route: '/runs',
  storage: { 'demo-view': '"wide"' },
  scenario: 'live',
  roots: ['Header', 'Body'],
  height: 900,
  dynamicText: ['Clock'],
};

const pen = {
  type: 'frame',
  name: 'Doc',
  children: [
    {
      type: 'frame',
      name: 'Demo Board',
      children: [
        {
          type: 'frame',
          name: 'Header',
          children: [{ type: 'frame', name: 'Chip' }],
        },
        { type: 'frame', name: 'Body', width: 400 },
      ],
    },
  ],
};

let dir: string;
let app: ParityApp<'live'>;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'parity-serve-'));
  mkdirSync(join(dir, 'out'));
  writeFileSync(join(dir, 'demo.pen'), JSON.stringify(pen));
  app = {
    boards: [board],
    designDir: join(dir, 'design'),
    penPath: join(dir, 'demo.pen'),
    harnessPort: 11098,
    appOrigin: 'http://localhost:5307',
    outputDir: join(dir, 'out'),
  };
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('harnessConfig', () => {
  it('resolves one board and scheme against the app parameters', () => {
    const cfg = harnessConfig(app, '01-demo', 'dark');
    expect(cfg).toMatchObject({
      slug: '01-demo',
      scheme: 'dark',
      route: '/runs',
      storage: { 'demo-view': '"wide"' },
      height: 900,
      width: 1440,
      appOrigin: 'http://localhost:5307',
      designAttr: 'data-pencil-name',
      appAttr: 'data-parity',
      outDir: join(dir, 'out'),
      designUrl: pathToFileURL(join(dir, 'design', '01-demo.dark.html')).href,
    });
    expect(cfg.targets).toEqual([
      {
        stem: '01-demo.header',
        root: 'Header',
        route: '/runs',
        hugWidths: ['Chip'],
      },
      { stem: '01-demo.body', root: 'Body', route: '/runs', hugWidths: [] },
    ]);
    expect(cfg.collectSource).toContain('async (page');
  });

  it("reads a board's frame from the board's own pen when it names one", () => {
    const own = join(dir, 'own.pen');
    writeFileSync(
      own,
      JSON.stringify({
        type: 'frame',
        name: 'Doc',
        children: [
          {
            type: 'frame',
            name: 'Demo Board',
            children: [
              { type: 'frame', name: 'Header', width: 300 },
              {
                type: 'frame',
                name: 'Body',
                children: [{ type: 'frame', name: 'Row' }],
              },
            ],
          },
        ],
      })
    );
    const cfg = harnessConfig(
      { ...app, boards: [{ ...board, penPath: own }] },
      '01-demo',
      'light'
    );
    expect(cfg.targets.map(t => [t.root, t.hugWidths])).toEqual([
      ['Header', []],
      ['Body', ['Row']],
    ]);
  });

  it("passes a board's appRoots through to the runner", () => {
    const named = { ...board, appRoots: { Header: 'Hero' } };
    const cfg = harnessConfig(
      { ...app, boards: [named] },
      '01-demo',
      'light'
    );
    expect(cfg.appRoots).toEqual({ Header: 'Hero' });
    expect(harnessConfig(app, '01-demo', 'light').appRoots).toBeUndefined();
  });

  it('takes the design width from the app when it sets one', () => {
    expect(
      harnessConfig({ ...app, viewportWidth: 1280 }, '01-demo', 'light').width
    ).toBe(1280);
  });

  it('refuses an unknown scheme or board', () => {
    expect(() => harnessConfig(app, '01-demo', 'sepia')).toThrow(
      'scheme must be dark or light, got "sepia"'
    );
    expect(() => harnessConfig(app, 'nope', 'dark')).toThrow(
      'unknown board "nope"; one of: 01-demo'
    );
  });
});

describe('harnessHandler', () => {
  const handle = (method: string, path: string, body?: string) =>
    harnessHandler(app)(new Request(`http://harness${path}`, { method, body }));

  it('serves the config as JSON and reports a bad request as 400', async () => {
    const ok = await handle('GET', '/config?slug=01-demo&scheme=dark');
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { slug: string }).slug).toBe('01-demo');
    const bad = await handle('GET', '/config?slug=nope&scheme=dark');
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain(
      'unknown board'
    );
  });

  it('writes JSON as text and PNGs from base64 under the output dir', async () => {
    expect((await handle('PUT', '/out/a.design.json', '[1]')).status).toBe(200);
    expect(readFileSync(join(dir, 'out', 'a.design.json'), 'utf8')).toBe('[1]');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await handle('PUT', '/out/a.design.png', png.toString('base64'));
    expect(readFileSync(join(dir, 'out', 'a.design.png'))).toEqual(png);
  });

  it('refuses a file name that could leave the output dir, and unknown routes', async () => {
    const bad = await handle(
      'PUT',
      `/out/${encodeURIComponent('../x.json')}`,
      '{}'
    );
    expect(bad.status).toBe(400);
    expect((await handle('PUT', '/out/x.txt', '{}')).status).toBe(400);
    expect((await handle('GET', '/nowhere')).status).toBe(404);
  });
});

describe('compareBoard', () => {
  const node = (o: Partial<ParityNode>): ParityNode => ({
    key: 'Header',
    kind: 'box',
    x: 0,
    y: 0,
    w: 100,
    h: 20,
    fill: '#111113',
    stroke: null,
    color: null,
    text: null,
    name: 'Header',
    parent: -1,
    tag: 'div',
    ...o,
  });
  const write = (name: string, nodes: ParityNode[]) =>
    writeFileSync(join(dir, 'out', name), JSON.stringify(nodes));

  it('reads each target from the app output dir and applies the board dynamicText', () => {
    for (const stem of ['01-demo.header', '01-demo.body']) {
      const root = stem.endsWith('header') ? 'Header' : 'Body';
      write(`${stem}.dark.design.json`, [node({ key: root, name: root })]);
      write(`${stem}.dark.app.json`, [node({ key: root, name: root })]);
    }
    write('01-demo.body.dark.app.json', [
      node({ key: 'Body', name: 'Body', x: 3 }),
    ]);

    const results = [...compareBoard(app, '01-demo', 'dark')];
    expect(results.map(r => r.stem)).toEqual([
      '01-demo.header',
      '01-demo.body',
    ]);
    expect(results[0]!.mismatches).toEqual([]);
    expect(results[1]!.mismatches).toEqual([
      { key: 'Body', field: 'x', design: '0', app: '3' },
    ]);
  });

  it('names the missing file when a target was never collected', () => {
    expect(() => [...compareBoard(app, '01-demo', 'light')]).toThrow(
      /no such file: .*01-demo\.header\.light\.design\.json/
    );
  });
});
