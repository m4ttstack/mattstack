import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { expect, test } from 'bun:test';

import { resolveTool } from './tool-resolve.ts';

function executable(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '#!/bin/sh\nexit 0\n');
  chmodSync(path, 0o755);
  return path;
}

function bundle(tools: unknown[]): string {
  const root = join(mkdtempSync(join(tmpdir(), 'deck-tool-')), 'm.app');
  mkdirSync(join(root, 'Contents', 'Resources'), { recursive: true });
  writeFileSync(
    join(root, 'Contents', 'Resources', 'deps.lock'),
    JSON.stringify({ schema: 1, tools })
  );
  return root;
}

const portlessRow = {
  name: 'portless',
  kind: 'helper',
  status: 'bundled',
  exec: [
    'Contents/Helpers/node/bin/node',
    'Contents/Helpers/portless-dist/dist/cli.js',
  ],
};

function scratchHome(): string {
  return mkdtempSync(join(tmpdir(), 'deck-tool-home-'));
}

test('outside a bundle there is nothing to resolve', () => {
  expect(resolveTool('portless', { bundleRoot: null })).toBeNull();
});

test("a bundled tool runs from the bundle's own exec, interpreter and script", () => {
  const root = bundle([portlessRow]);
  const node = executable(join(root, 'Contents/Helpers/node/bin/node'));
  const script = executable(
    join(root, 'Contents/Helpers/portless-dist/dist/cli.js')
  );
  const home = scratchHome();
  executable(join(home, '.local', 'bin', 'portless'));

  expect(
    resolveTool('portless', { bundleRoot: root, home, dirs: [], path: '' })
  ).toEqual([node, script]);
});

test('a bundle row whose files are missing falls through to ~/.local/bin', () => {
  const root = bundle([portlessRow]);
  const home = scratchHome();
  const linked = executable(join(home, '.local', 'bin', 'portless'));

  expect(
    resolveTool('portless', { bundleRoot: root, home, dirs: [], path: '' })
  ).toEqual([linked]);
});

test('an unbundled tool is found in the fixed dirs, in order, before PATH', () => {
  const root = bundle([]);
  const home = scratchHome();
  const brew = join(scratchHome(), 'opt-homebrew-bin');
  const usrLocal = join(scratchHome(), 'usr-local-bin');
  const onPath = join(scratchHome(), 'path-bin');
  executable(join(usrLocal, 'railway'));
  const fromBrew = executable(join(brew, 'railway'));
  executable(join(onPath, 'railway'));

  expect(
    resolveTool('railway', {
      bundleRoot: root,
      home,
      dirs: [brew, usrLocal],
      path: onPath,
    })
  ).toEqual([fromBrew]);
});

test('PATH is the last resort, and a tool found nowhere keeps its bare name', () => {
  const root = bundle([]);
  const home = scratchHome();
  const onPath = join(scratchHome(), 'path-bin');
  const found = executable(join(onPath, 'railway'));

  expect(
    resolveTool('railway', { bundleRoot: root, home, dirs: [], path: onPath })
  ).toEqual([found]);
  expect(
    resolveTool('cloudflared', { bundleRoot: root, home, dirs: [], path: '' })
  ).toEqual(['cloudflared']);
});

test('an unreadable deps.lock falls through to the fixed dirs', () => {
  const root = join(mkdtempSync(join(tmpdir(), 'deck-tool-')), 'm.app');
  const home = scratchHome();
  const linked = executable(join(home, '.local', 'bin', 'portless'));

  expect(
    resolveTool('portless', { bundleRoot: root, home, dirs: [], path: '' })
  ).toEqual([linked]);
});
