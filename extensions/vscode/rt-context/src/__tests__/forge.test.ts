import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { LinearTicket } from '../linear';
import type { CachedBranchData } from '../types';
import {
  branchDataFromDaemonEntry,
  forgeOfRemote,
  forgeWords,
  ownBranchData,
  prBelongsToRemote,
  clearRepoIdentityMemo,
  memoizeFor,
  repoIdentityOfRemote,
  repoIdentityToStore,
} from '../forge';

const origHome = process.env.HOME;
let home: string;

beforeEach(() => {
  clearRepoIdentityMemo();
  home = realpathSync(mkdtempSync(join(tmpdir(), 'rt-ext-forge-')));
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

const REMOTE = 'git@github.com:o/r.git';
const OWN_ID = 'remote:github.com%2Fo%2Fr';
const FOREIGN_ID = 'remote:github.com%2Fo%2Fother';
const BRANCH = 'feature/rt-1';
const TICKET = { identifier: 'RT-1' } as unknown as LinearTicket;
const OWN_PR = 'https://github.com/o/r/pull/7';
const FOREIGN_PR = 'https://github.com/o/other/pull/3';
const GITLAB_MR = 'https://gitlab.com/g/p/-/merge_requests/9';

describe('forgeOfRemote', () => {
  test('github.com over ssh and https is github', () => {
    expect(forgeOfRemote('git@github.com:o/r.git', null)).toBe('github');
    expect(forgeOfRemote('https://github.com/o/r', null)).toBe('github');
  });
  test('github.com over ssh://, git+ssh://, a .git https remote, a mixed-case host and a trailing slash is github', () => {
    expect(forgeOfRemote('ssh://git@github.com/o/r.git', null)).toBe('github');
    expect(forgeOfRemote('ssh://git@github.com:22/o/r.git', null)).toBe('github');
    expect(forgeOfRemote('git+ssh://git@github.com/o/r', null)).toBe('github');
    expect(forgeOfRemote('https://github.com/o/r.git', null)).toBe('github');
    expect(forgeOfRemote('https://GitHub.com/o/r', null)).toBe('github');
    expect(forgeOfRemote('https://github.com/o/r/', null)).toBe('github');
  });
  test('gitlab.com and the confirmed host are gitlab', () => {
    expect(forgeOfRemote('git@gitlab.com:g/p.git', null)).toBe('gitlab');
    expect(forgeOfRemote('https://gitlab.corp.example/g/p.git', 'gitlab.corp.example')).toBe('gitlab');
    expect(forgeOfRemote('ssh://git@gitlab.com/g/p.git', null)).toBe('gitlab');
  });
  test('an unconfirmed host, an ssh alias, garbage and no remote are null', () => {
    expect(forgeOfRemote('https://gitlab.corp.example/g/p.git', null)).toBeNull();
    expect(forgeOfRemote('git@work-github:o/r.git', null)).toBeNull();
    expect(forgeOfRemote('not a url', null)).toBeNull();
    expect(forgeOfRemote(null, null)).toBeNull();
  });
});

describe('forgeWords', () => {
  test('github', () =>
    expect(forgeWords('github')).toEqual({ site: 'GitHub', short: 'PR', long: 'pull request', title: 'Pull Request' }));
  test('gitlab and null keep the GitLab words', () => {
    const gl = { site: 'GitLab', short: 'MR', long: 'merge request', title: 'Merge Request' };
    expect(forgeWords('gitlab')).toEqual(gl);
    expect(forgeWords(null)).toEqual(gl);
  });
});

describe('repoIdentityOfRemote', () => {
  test('every spelling of one repo gives the key the daemon stores it under', () => {
    for (const remote of [
      'git@github.com:o/r.git',
      'https://github.com/o/r',
      'https://github.com/o/r.git',
      'https://GitHub.com/o/r/',
      'ssh://git@github.com/o/r.git',
      'git+ssh://git@github.com/o/r',
    ]) {
      expect(repoIdentityOfRemote(remote)).toBe(OWN_ID);
    }
  });
  test('a remote that yields no identity is null', () => {
    expect(repoIdentityOfRemote('/tmp/local/path')).toBeNull();
    expect(repoIdentityOfRemote('')).toBeNull();
  });
});

describe('memoizeFor', () => {
  test('calls through once per key inside the ttl, again after it, and clear forgets', () => {
    let now = 0;
    let calls = 0;
    const memo = memoizeFor((key: string) => `${key}:${++calls}`, 60_000, () => now);
    expect(memo.get('a')).toBe('a:1');
    now = 59_999;
    expect(memo.get('a')).toBe('a:1');
    expect(memo.get('b')).toBe('b:2');
    now = 60_000;
    expect(memo.get('a')).toBe('a:3');
    memo.clear();
    expect(memo.get('a')).toBe('a:4');
  });
  test('a null result is memoized too', () => {
    let calls = 0;
    const memo = memoizeFor((_key: string) => (++calls, null), 1000, () => 0);
    memo.get('x');
    memo.get('x');
    expect(calls).toBe(1);
  });
});

describe('repoIdentityToStore', () => {
  test('github keeps the entry identity, else stamps the repo own', () => {
    expect(repoIdentityToStore('github', FOREIGN_ID, REMOTE)).toBe(FOREIGN_ID);
    expect(repoIdentityToStore('github', undefined, REMOTE)).toBe(OWN_ID);
    expect(repoIdentityToStore('github', undefined, null)).toBeNull();
  });
  test('gitlab and null store no identity, whatever the entry carried', () => {
    expect(repoIdentityToStore('gitlab', FOREIGN_ID, 'git@gitlab.com:g/p.git')).toBeNull();
    expect(repoIdentityToStore(null, OWN_ID, REMOTE)).toBeNull();
  });
});

describe('prBelongsToRemote', () => {
  test('own repo, any case', () => {
    expect(prBelongsToRemote(OWN_PR, REMOTE)).toBe(true);
    expect(prBelongsToRemote('https://github.com/m4ttstack/mattstack/pull/7', 'git@github.com:M4ttstack/Mattstack.git')).toBe(true);
  });
  test('any remote spelling of the repo', () => {
    for (const remote of [
      'https://github.com/o/r.git',
      'https://GitHub.com/o/r',
      'https://github.com/o/r/',
      'ssh://git@github.com/o/r.git',
      'ssh://git@github.com:22/o/r.git',
      'git+ssh://git@github.com/o/r',
    ]) {
      expect(prBelongsToRemote(OWN_PR, remote)).toBe(true);
    }
  });
  test('another repo, a prefix repo, another host, garbage', () => {
    expect(prBelongsToRemote('https://github.com/o/r2/pull/7', REMOTE)).toBe(false);
    expect(prBelongsToRemote('https://github.com/o/r.evil/pull/1', 'https://github.com/o/r')).toBe(false);
    expect(prBelongsToRemote('https://gitlab.com/o/r/-/merge_requests/1', REMOTE)).toBe(false);
    expect(prBelongsToRemote('nonsense', REMOTE)).toBe(false);
  });
});

describe('branchDataFromDaemonEntry', () => {
  const ENTRY_OWN = { ticket: TICKET, mr: { webUrl: OWN_PR, provider: 'github' }, linearId: 'RT-9', fetchedAt: 5 };

  test('github, own PR (no identity, URL rule) maps across', () => {
    expect(branchDataFromDaemonEntry(ENTRY_OWN, 'github', REMOTE, BRANCH)).toEqual({
      ticket: TICKET,
      mrUrl: OWN_PR,
      linearId: 'RT-9',
      fetchedAt: 5,
    });
  });
  test('github, own identity maps across and is recorded', () => {
    const data = branchDataFromDaemonEntry({ ...ENTRY_OWN, repoName: OWN_ID }, 'github', REMOTE, BRANCH);
    expect(data).toEqual({ ticket: TICKET, mrUrl: OWN_PR, linearId: 'RT-9', fetchedAt: 5, repoIdentity: OWN_ID });
  });
  test('github, a renamed repo keeps its own PR by identity although the URL names the new path', () => {
    const renamed = { ...ENTRY_OWN, mr: { webUrl: 'https://github.com/o/renamed/pull/7', provider: 'github' }, repoName: OWN_ID };
    expect(branchDataFromDaemonEntry(renamed, 'github', REMOTE, BRANCH)?.mrUrl).toBe('https://github.com/o/renamed/pull/7');
  });
  test('github, a trailing-slash remote still owns its identity', () => {
    const entry = { ...ENTRY_OWN, repoName: OWN_ID };
    expect(branchDataFromDaemonEntry(entry, 'github', 'https://github.com/o/r/', BRANCH)?.mrUrl).toBe(OWN_PR);
  });
  test('github, an own-identity mr with no webUrl is kept', () => {
    const data = branchDataFromDaemonEntry({ ticket: TICKET, mr: { provider: 'github' }, repoName: OWN_ID }, 'github', REMOTE, BRANCH, 3);
    expect(data).toEqual({ ticket: TICKET, mrUrl: null, linearId: null, fetchedAt: 3, repoIdentity: OWN_ID });
  });
  test('github, a foreign identity is stripped even when the PR URL looks like ours', () => {
    const data = branchDataFromDaemonEntry({ ...ENTRY_OWN, repoName: FOREIGN_ID }, 'github', REMOTE, BRANCH);
    expect(data?.mrUrl).toBeNull();
    expect(data?.linearId).toBeNull();
  });
  test('github, another repo PR or a GitLab MR with no identity is stripped to a hit', () => {
    const foreign = branchDataFromDaemonEntry({ ticket: TICKET, mr: { webUrl: FOREIGN_PR, provider: 'github' }, linearId: 'RT-9', fetchedAt: 4 }, 'github', REMOTE, BRANCH);
    expect(foreign).toEqual({ ticket: TICKET, mrUrl: null, linearId: null, fetchedAt: 4 });
    const gitlab = branchDataFromDaemonEntry({ ticket: TICKET, mr: { webUrl: GITLAB_MR, provider: 'gitlab' } }, 'github', REMOTE, BRANCH, 8);
    expect(gitlab).toEqual({ ticket: TICKET, mrUrl: null, linearId: null, fetchedAt: 8 });
  });
  test('github, a stripped entry keeps its ticket only when the branch itself names it', () => {
    const other = { identifier: 'RT-2' } as unknown as LinearTicket;
    const foreign = { mr: { webUrl: FOREIGN_PR, provider: 'github' }, repoName: FOREIGN_ID };
    expect(branchDataFromDaemonEntry({ ...foreign, ticket: other }, 'github', REMOTE, BRANCH)?.ticket).toBeNull();
    expect(branchDataFromDaemonEntry({ ...foreign, ticket: TICKET }, 'github', REMOTE, BRANCH)?.ticket).toBe(TICKET);
    expect(branchDataFromDaemonEntry({ ...foreign, ticket: TICKET }, 'github', REMOTE, 'plain-branch')?.ticket).toBeNull();
  });
  test('github, an mr with no webUrl and no identity is stripped', () => {
    expect(branchDataFromDaemonEntry({ mr: { provider: 'github' }, linearId: 'RT-9' }, 'github', REMOTE, BRANCH, 6)).toEqual({
      ticket: null,
      mrUrl: null,
      linearId: null,
      fetchedAt: 6,
    });
  });
  test('github, no mr keeps the ticket with a null mrUrl', () => {
    expect(branchDataFromDaemonEntry({ ticket: TICKET, mr: null, linearId: 'RT-2', fetchedAt: 1 }, 'github', REMOTE, BRANCH)).toEqual({
      ticket: TICKET,
      mrUrl: null,
      linearId: 'RT-2',
      fetchedAt: 1,
    });
  });
  test('github with no remote and an mr is stripped', () => {
    expect(branchDataFromDaemonEntry({ mr: { webUrl: OWN_PR, provider: 'github' }, repoName: OWN_ID }, 'github', null, BRANCH)?.mrUrl).toBeNull();
  });
  test('gitlab and null forge map a foreign PR unchanged and record no identity', () => {
    const entry = { mr: { webUrl: FOREIGN_PR, provider: 'github' }, fetchedAt: 2, repoName: FOREIGN_ID };
    for (const forge of ['gitlab', null] as const) {
      expect(branchDataFromDaemonEntry(entry, forge, 'git@gitlab.com:g/p.git', BRANCH)).toEqual({
        ticket: null,
        mrUrl: FOREIGN_PR,
        linearId: null,
        fetchedAt: 2,
      });
    }
  });
  test('an empty linearId is null and a missing fetchedAt is now', () => {
    expect(branchDataFromDaemonEntry({ linearId: '' }, 'gitlab', null, BRANCH, 99)).toEqual({
      ticket: null,
      mrUrl: null,
      linearId: null,
      fetchedAt: 99,
    });
  });
});

describe('ownBranchData', () => {
  const data = (mrUrl: string | null, repoIdentity?: string): CachedBranchData => ({
    ticket: null,
    mrUrl,
    linearId: null,
    fetchedAt: 1,
    ...(repoIdentity ? { repoIdentity } : {}),
  });
  test('github drops a foreign mrUrl', () => {
    expect(ownBranchData(data(GITLAB_MR), 'github', REMOTE)).toBeNull();
    expect(ownBranchData(data(OWN_PR), 'github', null)).toBeNull();
  });
  test('github judges an entry with an identity by the identity, not the URL', () => {
    const renamed = data('https://github.com/o/renamed/pull/7', OWN_ID);
    expect(ownBranchData(renamed, 'github', REMOTE)).toBe(renamed);
    expect(ownBranchData(data(OWN_PR, FOREIGN_ID), 'github', REMOTE)).toBeNull();
  });
  test('github returns own and absent mrUrl as the same object', () => {
    const own = data(OWN_PR);
    const none = data(null);
    expect(ownBranchData(own, 'github', REMOTE)).toBe(own);
    expect(ownBranchData(none, 'github', REMOTE)).toBe(none);
  });
  test('gitlab and null return the foreign one unchanged', () => {
    const foreign = data(GITLAB_MR);
    expect(ownBranchData(foreign, 'gitlab', REMOTE)).toBe(foreign);
    expect(ownBranchData(foreign, null, null)).toBe(foreign);
  });
  test('undefined in gives null', () => {
    expect(ownBranchData(undefined, 'github', REMOTE)).toBeNull();
  });
});
