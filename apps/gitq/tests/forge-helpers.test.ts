import { describe, expect, test } from 'bun:test';
import type { PullRequest } from '@workforge/glance-sdk';
import {
  discoverStacksFromPRs,
  filterPRsToProject,
  projectPathFromRemoteUrl,
  projectPathFromWebUrl,
  projectScopeFromRemoteUrl,
} from '../src/core/forge-helpers.ts';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Build a PullRequest carrying only the fields these helpers read. */
function pr(overrides: {
  iid: number;
  sourceBranch: string;
  targetBranch: string;
  repositoryId?: string;
  webUrl?: string | null;
}): PullRequest {
  return {
    id: `gitlab:${overrides.iid}`,
    iid: overrides.iid,
    repositoryId: overrides.repositoryId ?? 'gitlab:42',
    title: `MR for ${overrides.sourceBranch}`,
    description: null,
    state: 'opened',
    draft: false,
    conflicts: false,
    webUrl: overrides.webUrl === undefined ? `https://gitlab.com/acme/web/-/merge_requests/${overrides.iid}` : overrides.webUrl,
    sourceBranch: overrides.sourceBranch,
    targetBranch: overrides.targetBranch,
    createdAt: null,
    updatedAt: null,
    sha: null,
    author: { id: 'gitlab:user:1', username: 'dev', name: 'Dev', avatarUrl: null },
    assignees: [],
    reviewers: [],
    roles: ['author'],
    pipeline: null,
    unresolvedThreadCount: 0,
    approvalsLeft: 0,
    approved: false,
    approvedBy: [],
    diffStats: null,
    detailedMergeStatus: null,
    autoMergeEnabled: false,
    autoMergeStrategy: null,
    mergeUser: null,
    mergeAfter: null,
    divergedCommitsCount: null,
    rebaseInProgress: false,
    mergeOngoing: false,
    inProgressMergeCommitSha: null,
    mergeError: null,
    shouldBeRebased: false,
    mergeabilityChecks: [],
    blockingMergeRequestsCount: 0,
    approvalsRequired: 0,
    squash: false,
    squashOnMerge: false,
    mergeTrainIndex: null,
  };
}

// ── projectPathFromRemoteUrl ─────────────────────────────────────────────────

describe('projectPathFromRemoteUrl', () => {
  test('reads an ssh remote', () => {
    expect(projectPathFromRemoteUrl('git@gitlab.com:acme/web.git')).toBe('acme/web');
  });

  test('reads an https remote', () => {
    expect(projectPathFromRemoteUrl('https://gitlab.com/acme/web.git')).toBe('acme/web');
  });

  test('keeps nested subgroups', () => {
    expect(projectPathFromRemoteUrl('git@gitlab.com:acme/team/web.git')).toBe('acme/team/web');
    expect(projectPathFromRemoteUrl('https://gitlab.com/acme/team/web')).toBe('acme/team/web');
  });

  test('reads a github remote', () => {
    expect(projectPathFromRemoteUrl('git@github.com:user/repo.git')).toBe('user/repo');
  });

  test('reads an ssh:// remote with a port, not the port', () => {
    expect(projectPathFromRemoteUrl('ssh://git@gitlab.com:2222/acme/web.git')).toBe('acme/web');
  });

  test('returns null when there is no project path to read', () => {
    expect(projectPathFromRemoteUrl('')).toBeNull();
    expect(projectPathFromRemoteUrl('https://gitlab.com/')).toBeNull();
  });
});

// ── projectScopeFromRemoteUrl ────────────────────────────────────────────────

describe('projectScopeFromRemoteUrl', () => {
  test('reads the host of an ssh remote', () => {
    expect(projectScopeFromRemoteUrl('git@gitlab.com:acme/web.git')).toEqual({ host: 'gitlab.com', path: 'acme/web' });
  });

  test('reads the host of an https remote, ignoring www. and case', () => {
    expect(projectScopeFromRemoteUrl('https://WWW.GitLab.com/acme/web.git')).toEqual({
      host: 'gitlab.com',
      path: 'acme/web',
    });
  });

  test('reads the host of an ssh:// remote with a port, not the port', () => {
    expect(projectScopeFromRemoteUrl('ssh://git@gitlab.selfhosted:2222/acme/web.git')).toEqual({
      host: 'gitlab.selfhosted',
      path: 'acme/web',
    });
  });

  test('a remote that names no host carries none', () => {
    expect(projectScopeFromRemoteUrl('/srv/git/acme/web.git')).toEqual({ host: null, path: 'srv/git/acme/web' });
  });

  test('an ssh config alias is not a forge host', () => {
    // `git@work:acme/web.git` resolves through ~/.ssh/config; no MR web url
    // will ever say "work", so treating it as an instance would filter out
    // every MR of a repo cloned that way.
    expect(projectScopeFromRemoteUrl('git@work:acme/web.git')).toEqual({ host: null, path: 'acme/web' });
  });

  test('returns null when there is no project path to read', () => {
    expect(projectScopeFromRemoteUrl('')).toBeNull();
    expect(projectScopeFromRemoteUrl('https://gitlab.com/')).toBeNull();
  });
});

// ── projectPathFromWebUrl ────────────────────────────────────────────────────

describe('projectPathFromWebUrl', () => {
  test('reads a GitLab merge request url', () => {
    expect(projectPathFromWebUrl('https://gitlab.com/acme/web/-/merge_requests/42')).toBe('acme/web');
  });

  test('reads a nested-subgroup merge request url', () => {
    expect(projectPathFromWebUrl('https://gitlab.com/acme/team/web/-/merge_requests/42')).toBe('acme/team/web');
  });

  test('reads a GitHub pull request url', () => {
    expect(projectPathFromWebUrl('https://github.com/user/repo/pull/42')).toBe('user/repo');
  });

  test('returns null for a missing or unparseable url', () => {
    expect(projectPathFromWebUrl(null)).toBeNull();
    expect(projectPathFromWebUrl('not a url')).toBeNull();
  });

  test('returns null rather than inventing a path for a url of no known shape', () => {
    // A project path is two segments before /-/merge_requests or /pull; a url
    // that has neither names no project we can place.
    expect(projectPathFromWebUrl('https://gitlab.com/project/-/merge_requests/1')).toBeNull();
    expect(projectPathFromWebUrl('https://github.com/pull/42')).toBeNull();
    expect(projectPathFromWebUrl('https://gitlab.com/acme/web')).toBeNull();
  });
});

// ── filterPRsToProject ───────────────────────────────────────────────────────

describe('filterPRsToProject', () => {
  const prs = [
    pr({ iid: 1, sourceBranch: 'fix-tests', targetBranch: 'main' }),
    pr({ iid: 2, sourceBranch: 'fix-tests', targetBranch: 'main', webUrl: 'https://gitlab.com/acme/api/-/merge_requests/2' }),
  ];

  test('keeps only MRs whose web url belongs to the project', () => {
    expect(filterPRsToProject(prs, 'acme/web').map((p) => p.iid)).toEqual([1]);
  });

  test('ignores case and a .git suffix on the project path', () => {
    expect(filterPRsToProject(prs, 'ACME/Web.git').map((p) => p.iid)).toEqual([1]);
  });

  test('drops MRs whose project cannot be established', () => {
    const unattributable = [...prs, pr({ iid: 3, sourceBranch: 'x', targetBranch: 'main', webUrl: null })];
    expect(filterPRsToProject(unattributable, 'acme/web').map((p) => p.iid)).toEqual([1]);
  });

  test('a bare project path matches on any host, since it names none', () => {
    const elsewhere = [pr({ iid: 9, sourceBranch: 'x', targetBranch: 'main', webUrl: 'https://gitlab.selfhosted/acme/web/-/merge_requests/9' })];
    expect(filterPRsToProject(elsewhere, 'acme/web').map((p) => p.iid)).toEqual([9]);
  });

  test('a scope that names a host keeps only that host, not the same path elsewhere', () => {
    const samePathEverywhere = [
      pr({ iid: 1, sourceBranch: 'a', targetBranch: 'main', webUrl: 'https://github.com/acme/web/pull/1' }),
      pr({ iid: 2, sourceBranch: 'b', targetBranch: 'main', webUrl: 'https://gitlab.com/acme/web/-/merge_requests/2' }),
      pr({ iid: 3, sourceBranch: 'c', targetBranch: 'main', webUrl: 'https://gitlab.selfhosted/acme/web/-/merge_requests/3' }),
    ];

    expect(filterPRsToProject(samePathEverywhere, projectScopeFromRemoteUrl('git@github.com:acme/web.git')!).map((p) => p.iid)).toEqual([1]);
    expect(filterPRsToProject(samePathEverywhere, projectScopeFromRemoteUrl('https://gitlab.com/acme/web.git')!).map((p) => p.iid)).toEqual([2]);
    expect(filterPRsToProject(samePathEverywhere, projectScopeFromRemoteUrl('git@gitlab.selfhosted:acme/web.git')!).map((p) => p.iid)).toEqual([3]);
  });

  test('a remote cloned through an ssh alias still matches its MRs', () => {
    const prs = [pr({ iid: 5, sourceBranch: 'x', targetBranch: 'main', webUrl: 'https://gitlab.com/acme/web/-/merge_requests/5' })];
    expect(filterPRsToProject(prs, projectScopeFromRemoteUrl('git@work:acme/web.git')!).map((p) => p.iid)).toEqual([5]);
  });

  test('a PR whose web url names no host is kept on path alone', () => {
    // Not reachable from a real forge; the invariant is that a missing host on
    // either side never turns into a mismatch.
    const hostless = [pr({ iid: 7, sourceBranch: 'x', targetBranch: 'main', webUrl: 'file:///acme/web/-/merge_requests/7' })];
    expect(filterPRsToProject(hostless, projectScopeFromRemoteUrl('git@gitlab.com:acme/web.git')!).map((p) => p.iid)).toEqual([7]);
  });
});

// ── discoverStacksFromPRs ────────────────────────────────────────────────────

describe('discoverStacksFromPRs', () => {
  test('never chains branches that live in different repositories', () => {
    const prs = [
      pr({ iid: 1, sourceBranch: 'fix-tests', targetBranch: 'main', repositoryId: 'gitlab:1' }),
      pr({ iid: 2, sourceBranch: 'update-deps', targetBranch: 'fix-tests', repositoryId: 'gitlab:2' }),
    ];

    expect(discoverStacksFromPRs(prs)).toEqual([]);
  });

  test('discovers one stack per repository when branch names collide', () => {
    const prs = [
      pr({ iid: 1, sourceBranch: 'fix-tests', targetBranch: 'main', repositoryId: 'gitlab:1' }),
      pr({ iid: 2, sourceBranch: 'web-only', targetBranch: 'fix-tests', repositoryId: 'gitlab:1' }),
      pr({ iid: 3, sourceBranch: 'fix-tests', targetBranch: 'main', repositoryId: 'gitlab:2' }),
      pr({ iid: 4, sourceBranch: 'api-only', targetBranch: 'fix-tests', repositoryId: 'gitlab:2' }),
    ];

    const stacks = discoverStacksFromPRs(prs);

    expect(stacks).toHaveLength(2);
    expect(stacks.map((s) => s.branches.sort())).toEqual([
      ['fix-tests', 'web-only'],
      ['api-only', 'fix-tests'],
    ]);
    // Each stack's MR map holds its own repository's MR for the shared branch.
    expect(stacks.map((s) => s.mrMap.get('fix-tests')!.iid)).toEqual([1, 3]);
  });

  test('never chains PRs the forge gave no repository id for', () => {
    // Two repos' MRs, repositoryId stripped: an empty id is not an identity,
    // so these must not pool into the one bucket the fix was meant to prevent.
    const prs = [
      pr({ iid: 1, sourceBranch: 'fix-tests', targetBranch: 'main', repositoryId: '', webUrl: 'https://gitlab.com/acme/web/-/merge_requests/1' }),
      pr({ iid: 2, sourceBranch: 'update-deps', targetBranch: 'fix-tests', repositoryId: '', webUrl: 'https://gitlab.com/acme/api/-/merge_requests/2' }),
    ];

    expect(discoverStacksFromPRs(prs)).toEqual([]);
  });

  test('an id-less PR does not extend a real repository\'s chain either', () => {
    const prs = [
      pr({ iid: 1, sourceBranch: 'fix-tests', targetBranch: 'main', repositoryId: 'gitlab:1' }),
      { ...pr({ iid: 2, sourceBranch: 'update-deps', targetBranch: 'fix-tests' }), repositoryId: undefined as unknown as string },
    ];

    expect(discoverStacksFromPRs(prs)).toEqual([]);
  });

  test('still walks a chain within a single repository', () => {
    const prs = [
      pr({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      pr({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'feat/a' }),
    ];

    const stacks = discoverStacksFromPRs(prs);

    expect(stacks).toHaveLength(1);
    expect(stacks[0]!.branches).toEqual(['feat/a', 'feat/b']);
  });
});
