import type { Database } from 'bun:sqlite';

import { rtCommand } from '@mattstack/rt-client';
import { getStateDb } from '../state/index.ts';
import { getKvValue, setKvValue } from '../state/kv-blob.ts';

export const LATCH_IDENTITY_NS = 'latch-identity';
export const LATCH_IDENTITY_TTL_MS = 24 * 60 * 60_000;

export type LatchIdentity = { ok: true } | { ok: false; login: string | null };

/** Whether the daemon's GitHub login for `repoName` is `self`. Only a match
    is cached: the board finds its latches by root author, so a write under
    another login would be re-posted on every tick. */
export async function verifyLatchIdentity(
  repoName: string,
  self: string,
  deps: { command?: typeof rtCommand; now?: () => number; db?: Database } = {}
): Promise<LatchIdentity> {
  const db = deps.db ?? getStateDb();
  const now = (deps.now ?? Date.now)();
  const want = self.toLowerCase();
  const cached = getKvValue<{ login: string; at: number } | null>(
    LATCH_IDENTITY_NS,
    repoName,
    null,
    db
  );
  if (
    cached &&
    cached.login.toLowerCase() === want &&
    now - cached.at < LATCH_IDENTITY_TTL_MS
  )
    return { ok: true };
  let login: string | null = null;
  try {
    const res = await (deps.command ?? rtCommand)<{ username: string }>(
      'forge:self',
      { repoName }
    );
    if (res.ok && typeof res.data?.username === 'string' && res.data.username)
      login = res.data.username;
  } catch {
    login = null;
  }
  if (login === null) return { ok: false, login: null };
  if (login.toLowerCase() !== want) return { ok: false, login };
  setKvValue(LATCH_IDENTITY_NS, repoName, { login, at: now }, db);
  return { ok: true };
}

export function identityMismatchLine(
  repoName: string,
  self: string,
  login: string | null
): string {
  return login === null
    ? `latch: skipped ${repoName}, the daemon gave no GitHub login to check against ${self}`
    : `latch: skipped ${repoName}, the daemon signs in as ${login} but this team records ${self}`;
}
