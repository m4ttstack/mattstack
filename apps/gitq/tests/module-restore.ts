import { afterAll, mock } from 'bun:test';
import { GitShell, setCommandHook } from '../src/core/git-shell.ts';

// Snapshot taken before any mock.module runs: every mocking file imports this
// module, and a file's imports always evaluate before its own mock.module
// calls. Copying into a plain object pins the real functions even though the
// import bindings themselves are rebound once the module is mocked. Every
// export a mock anywhere in the suite overrides must appear here: an export
// a restore factory omits keeps whatever the last mock made it.
const real = { GitShell, setCommandHook };

/**
 * bun's mock.module is process-global and outlives the test file that called
 * it (mock.restore() does NOT undo it), so a later, unmocked file silently
 * runs against the mock. Re-mocking with the real implementation is the only
 * way to hand it back. Call once, at top level, from any file that
 * mock.module's git-shell. Mock a node builtin nowhere: point the code at a
 * temp dir (setConfigDir) or mock the gitq module that wraps the builtin.
 */
export function restoreMockedModulesAfterAll(): void {
  afterAll(() => {
    mock.module('../src/core/git-shell.ts', () => real);
  });
}
