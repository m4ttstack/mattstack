#!/usr/bin/env node
// Loads the built extension bundle in plain Node, the way the extension host
// requires it, with a stub `vscode` on the require path (the bundle marks it
// external). Exits non-zero when the bundle throws at load or exports no
// activate(), so a release cannot ship a VSIX that dies on load.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const bundle = resolve(process.argv[2] ?? 'dist/extension.js');

const VSCODE_STUB = `
const handler = {
  get: (_target, prop) => (prop === 'then' || prop === '__esModule' ? undefined : stub),
  apply: () => stub,
  construct: () => stub,
};
const stub = new Proxy(function () {}, handler);
module.exports = stub;
`;

const stubRoot = mkdtempSync(join(tmpdir(), 'rt-context-smoke-'));
try {
  const vscodeDir = join(stubRoot, 'node_modules', 'vscode');
  mkdirSync(vscodeDir, { recursive: true });
  writeFileSync(join(vscodeDir, 'index.js'), VSCODE_STUB);

  const probe = `
    const ext = require(${JSON.stringify(bundle)});
    if (typeof ext.activate !== 'function') throw new Error('bundle exports no activate()');
  `;
  const run = spawnSync(process.execPath, ['-e', probe], {
    env: { ...process.env, NODE_PATH: join(stubRoot, 'node_modules') },
    stdio: 'inherit',
  });
  if (run.status !== 0) {
    console.error(`load smoke failed: ${bundle} does not load in node ${process.version}`);
    process.exit(run.status ?? 1);
  }
  console.log(`load smoke ok: ${bundle} loads in node ${process.version}`);
} finally {
  rmSync(stubRoot, { recursive: true, force: true });
}
