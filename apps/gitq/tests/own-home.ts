import { beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Gives each test in the calling scope its own HOME. rt-client's settings
 * stores resolve HOME at call time, and an unset key still leaves its store
 * file behind, so a write under the preload's shared HOME would break
 * home-isolation.test.ts's "store file does not exist yet" check depending on
 * file order.
 */
export function useOwnHome(): void {
  let prev: string | undefined;
  let own: string | undefined;
  beforeEach(() => {
    prev = process.env.HOME;
    own = mkdtempSync(join(tmpdir(), 'gitq-own-home-'));
    if (own === homedir()) throw new Error('refusing to touch the real account home');
    process.env.HOME = own;
  });
  afterEach(() => {
    process.env.HOME = prev;
    if (own) rmSync(own, { recursive: true, force: true });
  });
}
