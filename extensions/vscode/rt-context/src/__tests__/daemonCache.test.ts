import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { DaemonResponse } from '../daemonClient';
import { readDaemonCacheEntry } from '../daemonCache';
import { branchDataFromDaemonEntry, clearRepoIdentityMemo, repoIdentityOfRemote, type DaemonCacheEntry } from '../forge';

const origHome = process.env.HOME;
let home: string;

beforeEach(() => {
  clearRepoIdentityMemo();
  home = realpathSync(mkdtempSync(join(tmpdir(), 'rt-ext-daemon-cache-')));
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

const BRANCH = 'feature/shared';
const REMOTE_A = 'git@github.com:o/a.git';
const REMOTE_B = 'git@github.com:o/b.git';
const ID_A = 'remote:github.com%2Fo%2Fa';
const ID_B = 'remote:github.com%2Fo%2Fb';
const ENTRY_A: DaemonCacheEntry = { mr: { webUrl: 'https://github.com/o/a/pull/1' }, linearId: null, ticket: null, fetchedAt: 1, repoName: ID_A };
const ENTRY_B: DaemonCacheEntry = { mr: { webUrl: 'https://github.com/o/b/pull/2' }, linearId: null, ticket: null, fetchedAt: 2, repoName: ID_B };

/** A daemon that holds both repos' entries for one branch; `scoped` says whether it honors ?repoIdentity. */
function fakeDaemon(scoped: boolean, unscopedEntry: DaemonCacheEntry = ENTRY_B) {
  const paths: string[] = [];
  const query = async (path: string): Promise<DaemonResponse | null> => {
    paths.push(path);
    const url = new URL(path, 'http://daemon');
    const identity = url.searchParams.get('repoIdentity');
    if (scoped && identity !== null) {
      const entry = identity === ID_A ? ENTRY_A : identity === ID_B ? ENTRY_B : undefined;
      return { ok: true, data: entry ? { [BRANCH]: entry } : {} };
    }
    return { ok: true, data: { [BRANCH]: unscopedEntry } };
  };
  return { paths, query };
}

function prLinkFor(entry: DaemonCacheEntry | null, remoteUrl: string): string | null {
  if (!entry) return null;
  return branchDataFromDaemonEntry(entry, 'github', remoteUrl, BRANCH).mrUrl;
}

describe('readDaemonCacheEntry: a daemon that takes a repo identity', () => {
  test('two repos sharing a branch name each show their own PR link', async () => {
    const daemon = fakeDaemon(true);
    const a = await readDaemonCacheEntry(daemon.query, BRANCH, repoIdentityOfRemote(REMOTE_A));
    const b = await readDaemonCacheEntry(daemon.query, BRANCH, repoIdentityOfRemote(REMOTE_B));
    expect(prLinkFor(a, REMOTE_A)).toBe('https://github.com/o/a/pull/1');
    expect(prLinkFor(b, REMOTE_B)).toBe('https://github.com/o/b/pull/2');
  });

  test('asks once, with the serialized identity as a query parameter', async () => {
    const daemon = fakeDaemon(true);
    await readDaemonCacheEntry(daemon.query, BRANCH, ID_A);
    expect(daemon.paths).toEqual([`/api/cache/${encodeURIComponent(BRANCH)}?repoIdentity=${encodeURIComponent(ID_A)}`]);
  });

  test('a scoped miss asks once more without the identity, so a row with no identity still reads', async () => {
    const legacy: DaemonCacheEntry = { mr: { webUrl: 'https://github.com/o/a/pull/1' }, linearId: null, ticket: null, fetchedAt: 1 };
    const daemon = fakeDaemon(true, legacy);
    const entry = await readDaemonCacheEntry(daemon.query, BRANCH, 'remote:github.com%2Fo%2Fc');
    expect(daemon.paths).toEqual([
      `/api/cache/${encodeURIComponent(BRANCH)}?repoIdentity=${encodeURIComponent('remote:github.com%2Fo%2Fc')}`,
      `/api/cache/${encodeURIComponent(BRANCH)}`,
    ]);
    expect(entry).toEqual(legacy);
  });

  test("a scoped miss hands the unscoped entry back as it came, so a dropped entry never sends the caller to a forge lookup", async () => {
    const daemon = fakeDaemon(true, ENTRY_B);
    const entry = await readDaemonCacheEntry(daemon.query, BRANCH, 'remote:gitlab.com%2Fg%2Fc');
    expect(daemon.paths).toHaveLength(2);
    expect(entry).toEqual(ENTRY_B);
  });
});

describe('readDaemonCacheEntry: an older daemon that ignores the identity', () => {
  test("another repo's entry is still rejected, so no wrong PR link shows", async () => {
    const daemon = fakeDaemon(false, ENTRY_B);
    const entry = await readDaemonCacheEntry(daemon.query, BRANCH, repoIdentityOfRemote(REMOTE_A));
    expect(entry).toEqual(ENTRY_B);
    expect(prLinkFor(entry, REMOTE_A)).toBeNull();
    expect(daemon.paths).toHaveLength(1);
  });

  test('its own entry still shows its PR link', async () => {
    const daemon = fakeDaemon(false, ENTRY_A);
    const entry = await readDaemonCacheEntry(daemon.query, BRANCH, repoIdentityOfRemote(REMOTE_A));
    expect(prLinkFor(entry, REMOTE_A)).toBe('https://github.com/o/a/pull/1');
  });
});

describe('readDaemonCacheEntry: no identity or no daemon', () => {
  test('with no identity it reads the bare branch path, as before', async () => {
    const daemon = fakeDaemon(true);
    const entry = await readDaemonCacheEntry(daemon.query, BRANCH, null);
    expect(daemon.paths).toEqual([`/api/cache/${encodeURIComponent(BRANCH)}`]);
    expect(entry).toEqual(ENTRY_B);
  });

  test('an unreachable daemon is asked once and reads as null', async () => {
    const paths: string[] = [];
    const entry = await readDaemonCacheEntry(async (path) => { paths.push(path); return null; }, BRANCH, ID_A);
    expect(entry).toBeNull();
    expect(paths).toHaveLength(1);
  });

  test('an empty reply with no identity reads as null', async () => {
    const entry = await readDaemonCacheEntry(async () => ({ ok: true, data: {} }), BRANCH, null);
    expect(entry).toBeNull();
  });
});
