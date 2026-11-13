import { describe, expect, test } from 'bun:test';
import type { LinearTicket } from '../linear';
import type { CachedBranchData } from '../types';
import { branchDataFromDaemonEntry, forgeOfRemote, forgeWords, ownBranchData, prBelongsToRemote } from '../forge';

const REMOTE = 'git@github.com:o/r.git';
const TICKET = { identifier: 'RT-1' } as unknown as LinearTicket;
const OWN_PR = 'https://github.com/o/r/pull/7';
const FOREIGN_PR = 'https://github.com/o/other/pull/3';
const GITLAB_MR = 'https://gitlab.com/g/p/-/merge_requests/9';

describe('forgeOfRemote', () => {
  test('github.com over ssh and https is github', () => {
    expect(forgeOfRemote('git@github.com:o/r.git', null)).toBe('github');
    expect(forgeOfRemote('https://github.com/o/r', null)).toBe('github');
  });
  test('gitlab.com and the confirmed host are gitlab', () => {
    expect(forgeOfRemote('git@gitlab.com:g/p.git', null)).toBe('gitlab');
    expect(forgeOfRemote('https://gitlab.corp.example/g/p.git', 'gitlab.corp.example')).toBe('gitlab');
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

describe('prBelongsToRemote', () => {
  test('own repo, any case', () => {
    expect(prBelongsToRemote(OWN_PR, REMOTE)).toBe(true);
    expect(prBelongsToRemote('https://github.com/m4ttstack/mattstack/pull/7', 'git@github.com:M4ttstack/Mattstack.git')).toBe(true);
  });
  test('another repo, a prefix repo, another host, garbage', () => {
    expect(prBelongsToRemote('https://github.com/o/r2/pull/7', REMOTE)).toBe(false);
    expect(prBelongsToRemote('https://github.com/o/r.evil/pull/1', 'https://github.com/o/r')).toBe(false);
    expect(prBelongsToRemote('https://gitlab.com/o/r/-/merge_requests/1', REMOTE)).toBe(false);
    expect(prBelongsToRemote('nonsense', REMOTE)).toBe(false);
  });
});

describe('branchDataFromDaemonEntry', () => {
  test('github, own PR maps across', () => {
    const entry = { ticket: TICKET, mr: { webUrl: OWN_PR, provider: 'github' }, linearId: 'RT-1', fetchedAt: 5 };
    expect(branchDataFromDaemonEntry(entry, 'github', REMOTE)).toEqual({
      ticket: TICKET,
      mrUrl: OWN_PR,
      linearId: 'RT-1',
      fetchedAt: 5,
    });
  });
  test('github, another repo PR or a GitLab MR is rejected', () => {
    expect(branchDataFromDaemonEntry({ ticket: TICKET, mr: { webUrl: FOREIGN_PR, provider: 'github' } }, 'github', REMOTE)).toBeNull();
    expect(branchDataFromDaemonEntry({ ticket: TICKET, mr: { webUrl: GITLAB_MR, provider: 'gitlab' } }, 'github', REMOTE)).toBeNull();
  });
  test('github, an mr with no webUrl is rejected', () => {
    expect(branchDataFromDaemonEntry({ mr: { provider: 'github' } }, 'github', REMOTE)).toBeNull();
  });
  test('github, no mr keeps the ticket with a null mrUrl', () => {
    expect(branchDataFromDaemonEntry({ ticket: TICKET, mr: null, linearId: 'RT-2', fetchedAt: 1 }, 'github', REMOTE)).toEqual({
      ticket: TICKET,
      mrUrl: null,
      linearId: 'RT-2',
      fetchedAt: 1,
    });
  });
  test('github with no remote and an mr is rejected', () => {
    expect(branchDataFromDaemonEntry({ mr: { webUrl: OWN_PR, provider: 'github' } }, 'github', null)).toBeNull();
  });
  test('gitlab and null forge map a foreign PR unchanged', () => {
    const entry = { mr: { webUrl: FOREIGN_PR, provider: 'github' }, fetchedAt: 2 };
    for (const forge of ['gitlab', null] as const) {
      expect(branchDataFromDaemonEntry(entry, forge, 'git@gitlab.com:g/p.git')?.mrUrl).toBe(FOREIGN_PR);
    }
  });
  test('an empty linearId is null and a missing fetchedAt is now', () => {
    expect(branchDataFromDaemonEntry({ linearId: '' }, 'gitlab', null, 99)).toEqual({
      ticket: null,
      mrUrl: null,
      linearId: null,
      fetchedAt: 99,
    });
  });
});

describe('ownBranchData', () => {
  const data = (mrUrl: string | null): CachedBranchData => ({ ticket: null, mrUrl, linearId: null, fetchedAt: 1 });
  test('github drops a foreign mrUrl', () => {
    expect(ownBranchData(data(GITLAB_MR), 'github', REMOTE)).toBeNull();
    expect(ownBranchData(data(OWN_PR), 'github', null)).toBeNull();
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
