import { afterAll, mock } from 'bun:test';
import { GitShell, setCommandHook } from '../src/core/git-shell.ts';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';

// Snapshot taken before any mock.module runs: every mocking file imports this
// module, and a file's imports always evaluate before its own mock.module
// calls. Copying into a plain object pins the real functions even though the
// import bindings themselves are rebound once the module is mocked. Every
// export a mock anywhere in the suite overrides must appear here — an export
// a restore factory omits keeps whatever the last mock made it.
const real = {
  gitShell: { GitShell, setCommandHook },
  fsPromises: { mkdir, readFile, writeFile, rename, unlink },
  crypto: { randomUUID },
  childProcess: { execFile },
};

/**
 * bun's mock.module is process-global and outlives the test file that called
 * it — mock.restore() does NOT undo it — so a later, unmocked file (e.g. an
 * integration test writing real files into a sandbox repo) silently runs
 * against the mock. Re-mocking with the real implementations is the only way
 * to hand them back. Call once, at top level, from any file that mock.module's
 * git-shell or the node builtins mocked in this suite; exports the mocks never
 * touched are preserved by bun, so restoring the mocked subset is complete.
 */
export function restoreMockedModulesAfterAll(): void {
  afterAll(() => {
    mock.module('../src/core/git-shell.ts', () => real.gitShell);
    mock.module('node:fs/promises', () => real.fsPromises);
    mock.module('node:crypto', () => real.crypto);
    mock.module('node:child_process', () => real.childProcess);
  });
}
