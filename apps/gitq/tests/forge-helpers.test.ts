import { describe, expect, test } from 'bun:test';
import type { PullRequest } from '@workforge/glance-sdk';
import {
  discoverStacksFromPRs,
  filterPRsToProject,
  projectPathFromRemoteUrl,
  projectPathFromWebUrl,
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

  test('returns null when there is no project path to read', () => {
    expect(projectPathFromRemoteUrl('')).toBeNull();
    expect(projectPathFromRemoteUrl('https://gitlab.com/')).toBeNull();
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
