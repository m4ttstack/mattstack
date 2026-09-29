import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { PortlessCli } from './portless.ts';
import { RailwayCli } from './railway.ts';
import { CloudflaredCli } from './tunnel.ts';

function executable(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '#!/bin/sh\nexit 0\n');
  chmodSync(path, 0o755);
  return path;
}

let root = '';
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {
    DECK_BUNDLE_ROOT: process.env.DECK_BUNDLE_ROOT,
    HOME: process.env.HOME,
    LOCAL_RAILWAY_BIN: process.env.LOCAL_RAILWAY_BIN,
    LOCAL_CLOUDFLARED_BIN: process.env.LOCAL_CLOUDFLARED_BIN,
  };
  delete process.env.LOCAL_RAILWAY_BIN;
  delete process.env.LOCAL_CLOUDFLARED_BIN;
  root = join(mkdtempSync(join(tmpdir(), 'deck-bundled-tools-')), 'm.app');
  mkdirSync(join(root, 'Contents', 'Resources'), { recursive: true });
  writeFileSync(join(root, 'Contents', 'Info.plist'), '<plist/>');
  writeFileSync(
    join(root, 'Contents', 'Resources', 'deps.lock'),
    JSON.stringify({
      schema: 1,
      tools: [
        {
          name: 'portless',
          kind: 'helper',
          status: 'bundled',
          exec: [
            'Contents/Helpers/node/bin/node',
            'Contents/Helpers/portless-dist/dist/cli.js',
          ],
        },
        {
          name: 'cloudflared',
          kind: 'helper',
          status: 'bundled',
          exec: ['Contents/Helpers/cloudflared'],
        },
      ],
    })
  );
  process.env.DECK_BUNDLE_ROOT = root;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'deck-bundled-home-'));
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test('a bundled deck runs portless as node plus the bundled script', async () => {
  const node = executable(join(root, 'Contents/Helpers/node/bin/node'));
  const script = executable(
    join(root, 'Contents/Helpers/portless-dist/dist/cli.js')
  );
  const calls: string[][] = [];
  const cli = new PortlessCli(async argv => {
    calls.push(argv);
    return { code: 0, output: '' };
  });

  await cli.alias('board', 11006);

  expect(calls).toEqual([[node, script, 'alias', 'board', '11006']]);
});

test("a bundled deck runs the bundle's cloudflared", async () => {
  const cloudflared = executable(join(root, 'Contents/Helpers/cloudflared'));
  const calls: string[][] = [];
  const cli = new CloudflaredCli(async argv => {
    calls.push(argv);
    return { code: 0, stdout: '[]', stderr: '' };
  });

  await cli.list();

  expect(calls[0]).toEqual([cloudflared, 'tunnel', 'list', '-o', 'json']);
});

test('a bundled deck finds an unbundled railway in ~/.local/bin', async () => {
  const railway = executable(
    join(process.env.HOME!, '.local', 'bin', 'railway')
  );
  const calls: string[][] = [];
  const cli = new RailwayCli({
    apiToken: 'a',
    projectToken: 'p',
    projectId: 'id',
    environmentId: 'e',
    exec: async (argv: string[]) => {
      calls.push(argv);
      return { code: 0, stdout: '' };
    },
  } as never);

  await cli.up('svc', { cwd: tmpdir(), token: 't' });

  expect(calls[0]![0]).toBe(railway);
});
