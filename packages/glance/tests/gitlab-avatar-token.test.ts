/**
 * A GitLab avatar URL carries `private_token` only when it points at the
 * GitLab host's own origin. A user with no upload gets a gravatar URL, and
 * rendering that with the token appended would send it to gravatar.com.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

const BASE = 'https://gitlab.example.com';
const GRAVATAR = 'https://secure.gravatar.com/avatar/abc?s=80&d=identicon';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function withUser(avatar_url: string | null): GitLabProvider {
  const provider = new GitLabProvider(BASE, 'tok');
  const user = { id: 7, username: 'ada', name: 'Ada', avatar_url };
  (provider as any).gb.Users.all = async () => [user];
  (provider as any).gb.Users.showCurrentUser = async () => user;
  return provider;
}

/** One MR whose author has `avatarUrl`, served to the author-batch GraphQL read. */
function serveAuthorAvatar(avatarUrl: string | null): void {
  const author = { id: 'gid://gitlab/User/7', username: 'ada', name: 'Ada', avatarUrl };
  const mr = {
    id: 'gid://gitlab/MergeRequest/1',
    iid: '1',
    projectId: 42,
    title: 'MR',
    description: null,
    state: 'opened',
    draft: false,
    conflicts: false,
    detailedMergeStatus: 'MERGEABLE',
    webUrl: `${BASE}/g/p/-/merge_requests/1`,
    sourceBranch: 'feat',
    targetBranch: 'main',
    createdAt: '2026-11-12T00:00:00Z',
    updatedAt: '2026-11-12T00:00:00Z',
    diffHeadSha: 'abc',
    author,
    assignees: { nodes: [author] },
    reviewers: { nodes: [] },
    approvedBy: { nodes: [] },
    headPipeline: null,
    mergeabilityChecks: [],
  };
  globalThis.fetch = (async () =>
    Response.json({ data: { project: { mergeRequests: { nodes: [mr] } } } })) as unknown as typeof fetch;
}

const mrAuthor = async (avatarUrl: string | null) => {
  serveAuthorAvatar(avatarUrl);
  const [pr] = await new GitLabProvider(BASE, 'tok').fetchPullRequests({ authorUsernames: ['ada'], projectPath: 'g/p' });
  return pr!;
};

describe('a GitLab avatar on another origin', () => {
  test('fetchUser leaves a gravatar URL without the token', async () => {
    expect((await withUser(GRAVATAR).fetchUser('ada'))?.avatarUrl).toBe(GRAVATAR);
  });

  test('validateToken leaves a gravatar URL without the token', async () => {
    expect((await withUser(GRAVATAR).validateToken()).avatarUrl).toBe(GRAVATAR);
  });

  test('an MR read leaves a gravatar URL without the token', async () => {
    const pr = await mrAuthor(GRAVATAR);
    expect(pr.author.avatarUrl).toBe(GRAVATAR);
    expect(pr.assignees[0]?.avatarUrl).toBe(GRAVATAR);
  });

  test.each([
    ['http on an https host', 'http://gitlab.example.com/uploads/a.png'],
    ['another port', 'https://gitlab.example.com:8443/uploads/a.png'],
    ['a subdomain', 'https://cdn.gitlab.example.com/uploads/a.png'],
  ])('%s gets no token', async (_name, url) => {
    expect((await withUser(url).fetchUser('ada'))?.avatarUrl).toBe(url);
  });
});

describe('a GitLab avatar on the host itself', () => {
  test('an absolute URL gets the token', async () => {
    expect((await withUser(`${BASE}/uploads/a.png`).fetchUser('ada'))?.avatarUrl).toBe(
      `${BASE}/uploads/a.png?private_token=tok`,
    );
  });

  test('a relative path is made absolute and gets the token', async () => {
    expect((await withUser('/uploads/a.png?w=1').validateToken()).avatarUrl).toBe(
      `${BASE}/uploads/a.png?w=1&private_token=tok`,
    );
  });

  test('an MR read gives a relative avatar the host and the token', async () => {
    expect((await mrAuthor('/uploads/a.png')).author.avatarUrl).toBe(`${BASE}/uploads/a.png?private_token=tok`);
  });

  test('a null avatar stays null', async () => {
    expect((await mrAuthor(null)).author.avatarUrl).toBeNull();
  });
});
