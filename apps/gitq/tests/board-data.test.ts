import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  fetchMrsByBranch,
  parseActionBody,
  resolveRepoForge,
  resolveRtRepo,
  shapeActivity,
  shapeStack,
} from '../src/server/data.ts';
import type { BoardMr } from '../src/server/data.ts';
import type { ForgeProviderContext } from '../src/cli/provider.ts';
import type { Stack, StackNode, StackStore } from '../src/core/types.ts';
import type { ForgeOverrides } from '../src/core/forges.ts';
import type { GitProvider, PullRequest } from '@workforge/glance-sdk';
import type { RtResponse, MrByBranchData } from '@mattstack/rt-client';
import type { NodeDirective } from '../src/core/stack-diagnostics.ts';
import type { OperationEntry } from '../src/core/operation-log.ts';
import type { RepoEntry } from '../src/server/config.ts';

function makeNode(branch: string, parent: string, extra: Partial<StackNode> = {}): StackNode {
  return {
    branch,
    parent,
    mrIid: null,
    mrUrl: null,
    mrTitle: null,
    status: 'local-only',
    lastKnownHead: null,
    forkPoint: null,
    diffStats: null,
    pipelineStatus: 'unknown',
    unresolvedThreads: 0,
    ...extra,
  };
}

const STACK: Stack = {
  id: 'id1',
  stackName: 'mystack',
  root: 'main',
  nodes: [makeNode('a', 'main'), makeNode('b', 'a', { mrIid: 12, mrUrl: 'https://x/mr/12', mrTitle: 'stored', pipelineStatus: 'success' })],
};

function directive(branch: string): NodeDirective {
  return {
    branch,
    situation: 'behind-parent',
    statusLine: 'behind its parent',
    badge: { label: 'Behind', variant: 'caution' },
    primaryAction: null,
    secondaryActions: [],
    blocked: null,
    removal: { allowed: true },
  };
}

function entry(id: string, timestamp: number, repoPath?: string): OperationEntry {
  return { id, timestamp, operation: 'sync', commands: [], branchSnapshots: { a: 'sha1' }, stackSnapshot: STACK, ...(repoPath ? { repoPath } : {}) };
}

describe('shapeStack', () => {
  test('maps directives onto nodes and defaults missing ones to synced', () => {
    const shaped = shapeStack(STACK, new Map([['a', directive('a')]]), null, [], [], new Map());
    expect(shaped.stackName).toBe('mystack');
    expect(shaped.root).toBe('main');
    expect(shaped.nodes[0]!).toMatchObject({
      branch: 'a',
      parent: 'main',
      situation: 'behind-parent',
      statusLine: 'behind its parent',
      badge: { label: 'Behind', variant: 'caution' },
    });
    expect(shaped.nodes[1]!.situation).toBe('synced');
    expect(shaped.nodes[1]!.badge).toBeNull();
  });

  test('live MR data wins; stored node fields are the fallback', () => {
    const live: BoardMr = { iid: 99, url: 'https://x/mr/99', title: 'live', state: 'opened', pipelineStatus: 'running' };
    const shaped = shapeStack(STACK, new Map(), null, [], [], new Map([['b', live]]));
    expect(shaped.nodes[1]!.mr).toEqual(live);
    const offline = shapeStack(STACK, new Map(), null, [], [], new Map());
    expect(offline.nodes[1]!.mr).toEqual({ iid: 12, url: 'https://x/mr/12', title: 'stored', state: 'unknown', pipelineStatus: 'success' });
    expect(offline.nodes[0]!.mr).toBeNull();
  });
});

describe('shapeActivity', () => {
  test('filters by repo (legacy entries without repoPath match), sorts desc, limits', () => {
    const entries = [entry('e1', 100, '/repo'), entry('e2', 300), entry('e3', 200, '/other'), entry('e4', 400, '/repo')];
    const shaped = shapeActivity(entries, '/repo');
    expect(shaped.map((e) => e.id)).toEqual(['e4', 'e2', 'e1']);
    expect(shaped[0]!).toMatchObject({ operation: 'sync', stackName: 'mystack', branches: ['a'] });
    expect(shapeActivity(entries, '/repo', 2).length).toBe(2);
  });
});

describe('parseActionBody', () => {
  const REPOS = [{ path: '/repo', name: 'repo' }];

  test('accepts a valid body', () => {
    expect(parseActionBody({ repoPath: '/repo', stack: 's', action: 'sync' }, REPOS)).toEqual({
      repoPath: '/repo',
      stack: 's',
      action: 'sync',
    });
  });

  test('rejects unknown actions, unconfigured repos, and bad shapes', () => {
    expect(parseActionBody({ repoPath: '/repo', stack: 's', action: 'rebase' }, REPOS)).toBeNull();
    expect(parseActionBody({ repoPath: '/nope', stack: 's', action: 'sync' }, REPOS)).toBeNull();
    expect(parseActionBody({ repoPath: '/repo', stack: '', action: 'sync' }, REPOS)).toBeNull();
    expect(parseActionBody('junk', REPOS)).toBeNull();
    expect(parseActionBody(null, REPOS)).toBeNull();
  });
});

describe('parseActionBody sourceSlot', () => {
  const repos = [{ path: '/repo/a', name: 'a' }] as RepoEntry[];

  test('accepts sourceSlot for absorb', () => {
    const parsed = parseActionBody(
      { repoPath: '/repo/a', stack: 's', action: 'absorb', sourceSlot: '/repo/a-pool/tonks' },
      repos,
    );
    expect(parsed?.sourceSlot).toBe('/repo/a-pool/tonks');
  });

  test('rejects sourceSlot on non-absorb actions', () => {
    expect(
      parseActionBody({ repoPath: '/repo/a', stack: 's', action: 'sync', sourceSlot: '/x' }, repos),
    ).toBeNull();
  });

  test('rejects a non-string sourceSlot', () => {
    expect(
      parseActionBody({ repoPath: '/repo/a', stack: 's', action: 'absorb', sourceSlot: 5 }, repos),
    ).toBeNull();
  });

  test('absent sourceSlot still parses', () => {
    expect(parseActionBody({ repoPath: '/repo/a', stack: 's', action: 'absorb' }, repos)).not.toBeNull();
  });
});

describe('shapeStack worktree columns', () => {
  const ONE_NODE_STACK: Stack = {
    id: 'id2',
    stackName: 'onestack',
    root: 'main',
    nodes: [makeNode('feature-a', 'main')],
  };

  test('marks nodes with their checkout slot and its dirtiness', () => {
    const slotByBranch = new Map([['feature-a', { name: 'tonks', dirty: true }]]);
    const shaped = shapeStack(ONE_NODE_STACK, new Map(), null, [], [], new Map(), slotByBranch);
    expect(shaped.nodes[0]!.checkedOutIn).toBe('tonks');
    expect(shaped.nodes[0]!.checkedOutDirty).toBe(true);
  });

  test('nodes not checked out anywhere get null/false', () => {
    const shaped = shapeStack(ONE_NODE_STACK, new Map(), null, [], [], new Map(), new Map());
    expect(shaped.nodes[0]!.checkedOutIn).toBeNull();
    expect(shaped.nodes[0]!.checkedOutDirty).toBe(false);
  });
});

// ── Per-repo provider resolution (MAT-19) ────────────────────────────────────
//
// The board shows several repos at once and they need not share a forge. Every
// case below is offline: `createProvider` builds a client without a request, and
// a store carrying `remoteUrl` means no git call either.

function storeWith(remoteUrl: string, stacks: Stack[] = [STACK]): StackStore {
  return { repoPath: '/repo', remoteUrl, stacks };
}

const GITLAB_ENV = { GITLAB_TOKEN: 'glpat-test' };
const GITHUB_ENV = { GITHUB_TOKEN: 'ghp-test' };

function resolve(store: StackStore, env: Record<string, string | undefined>, overrides: ForgeOverrides = {}) {
  return resolveRepoForge('/repo', store, { env, overrides, secretsFile: '/nonexistent' });
}

describe('resolveRepoForge', () => {
  test('resolves a GitLab remote to the gitlab provider', async () => {
    const forge = await resolve(storeWith('git@gitlab.com:acme/web.git'), GITLAB_ENV);
    const ctx = await forge.getProvider();

    expect(ctx?.provider.providerName).toBe('gitlab');
    expect(ctx?.projectPath).toBe('acme/web');
    expect(forge.slug).toBe('gitlab');
  });

  test('resolves a GitHub remote to the github provider', async () => {
    // The whole point of the ticket: this repo needs no GitLab token, and gets
    // the right client rather than none.
    const forge = await resolve(storeWith('git@github.com:acme/web.git'), GITHUB_ENV);
    const ctx = await forge.getProvider();

    expect(ctx?.provider.providerName).toBe('github');
    expect(ctx?.provider.baseURL).toBe('https://github.com');
    expect(forge.slug).toBe('github');
  });

  test('a board holding both forges resolves each repo independently', async () => {
    const env = { ...GITLAB_ENV, ...GITHUB_ENV };

    const gitlab = await resolve(storeWith('https://gitlab.com/acme/web.git'), env);
    const github = await resolve(storeWith('https://github.com/acme/api.git'), env);

    expect((await gitlab.getProvider())?.provider.providerName).toBe('gitlab');
    expect((await github.getProvider())?.provider.providerName).toBe('github');
  });

  test('resolves a self-hosted host through the forges override', async () => {
    const forge = await resolve(storeWith('git@gitlab.acme.com:acme/web.git'), GITLAB_ENV, {
      'gitlab.acme.com': { provider: 'gitlab' },
    });
    const ctx = await forge.getProvider();

    expect(ctx?.provider.baseURL).toBe('https://gitlab.acme.com');
  });

  test('degrades to no provider when this forge has no token', async () => {
    // A GitLab token is not a GitHub credential. Before MAT-19 the presence of
    // one was what decided whether ANY repo got enrichment.
    const forge = await resolve(storeWith('git@github.com:acme/web.git'), GITLAB_ENV);

    expect(await forge.getProvider()).toBeNull();
    // The forge is still known, which is what keeps the UI showing `#42` rather
    // than GitLab's `!42` for a repo whose MRs it could not fetch.
    expect(forge.slug).toBe('github');
  });

  test('degrades to no provider when the remote names no forge gitq knows', async () => {
    const noHost = await resolve(storeWith('git@git.acme.com:acme/web.git'), GITLAB_ENV);
    expect(await noHost.getProvider()).toBeNull();
    expect(noHost.slug).toBeNull();

    const noRemote = await resolve(storeWith('/srv/git/acme/web.git'), GITLAB_ENV);
    expect(await noRemote.getProvider()).toBeNull();
    expect(noRemote.slug).toBeNull();
  });

  test('resolves nothing for a repo with no tracked stacks', async () => {
    // No stacks means nothing to enrich, so the remote is never even read.
    const forge = await resolve(storeWith('git@gitlab.com:acme/web.git', []), GITLAB_ENV);
    expect(await forge.getProvider()).toBeNull();
    expect(forge.slug).toBeNull();
  });

  test('memoizes the provider: repeated calls to getProvider do not build a second one', async () => {
    // The whole point of Step 3b: a stacked repo's board render should read
    // secrets/build a client at most once, no matter how many stacks it has.
    const forge = await resolve(storeWith('git@gitlab.com:acme/web.git'), GITLAB_ENV);

    const first = await forge.getProvider();
    const second = await forge.getProvider();

    expect(second).toBe(first);
  });

  test("one repo's missing token does not withhold another repo's MRs", async () => {
    const env = GITLAB_ENV;

    const ok = await resolve(storeWith('git@gitlab.com:acme/web.git'), env);
    const notOk = await resolve(storeWith('git@github.com:acme/api.git'), env);

    expect((await ok.getProvider())?.provider.providerName).toBe('gitlab');
    expect(await notOk.getProvider()).toBeNull();
  });
});

// ── fetchMrsByBranch: rt store path, provider-capability fallback, laziness ──
//
// `getProvider` stands in for `resolveRepoForge`'s memoized thunk (MAT-19 /
// Step 3b): tests assert on whether it was *invoked* at all, since that call
// is exactly the one that would otherwise read ~/.rt/secrets.json.

function mockPR(iid: number, sourceBranch: string) {
  return {
    iid,
    webUrl: `https://gitlab.com/acme/web/-/merge_requests/${iid}`,
    title: `MR ${iid}`,
    state: 'opened',
    sourceBranch,
    pipeline: null,
  } as unknown as PullRequest;
}

function spyProvider(ctx: ForgeProviderContext | null) {
  let calls = 0;
  const getProvider = () => {
    calls++;
    return Promise.resolve(ctx);
  };
  return { getProvider, callCount: () => calls };
}

function spyReadMrs(response: RtResponse<MrByBranchData>) {
  const calls: Array<{ repoName: string; branches: string[] }> = [];
  const readMrs = (repoName: string, branches: string[]) => {
    calls.push({ repoName, branches });
    return Promise.resolve(response);
  };
  return { readMrs, calls };
}

describe('fetchMrsByBranch: provider-capability fallback (no rt repo)', () => {
  test('uses the batch fetch when the provider offers one', async () => {
    const calls: string[][] = [];
    const provider = {
      fetchPullRequestsByBranches: (_p: string, branches: string[]) => {
        calls.push(branches);
        return Promise.resolve(new Map([['a', mockPR(1, 'a')], ['b', null]]));
      },
      fetchPullRequestByBranch: () => Promise.reject(new Error('should not be called')),
    } as unknown as GitProvider;

    const out = await fetchMrsByBranch(() => Promise.resolve({ provider, projectPath: 'acme/web' }), ['a', 'b'], null);

    expect(calls).toEqual([['a', 'b']]);
    expect([...out.keys()]).toEqual(['a']);
    expect(out.get('a')!.iid).toBe(1);
  });

  test('falls back to one call per branch when it does not', async () => {
    // GitHubProvider does not implement the batch method, and the guard is
    // feature detection on an optional interface member, not a slug check.
    const asked: string[] = [];
    const provider = {
      fetchPullRequestByBranch: (_p: string, branch: string) => {
        asked.push(branch);
        return Promise.resolve(branch === 'a' ? mockPR(7, 'a') : null);
      },
    } as unknown as GitProvider;

    const out = await fetchMrsByBranch(() => Promise.resolve({ provider, projectPath: 'acme/web' }), ['a', 'b'], null);

    expect(asked).toEqual(['a', 'b']);
    expect([...out.keys()]).toEqual(['a']);
    expect(out.get('a')!.iid).toBe(7);
  });

  test('asks for nothing when there are no branches, and never calls the provider factory', async () => {
    const { getProvider, callCount } = spyProvider(null);

    expect((await fetchMrsByBranch(getProvider, [], null)).size).toBe(0);
    expect(callCount()).toBe(0);
  });
});

describe('fetchMrsByBranch: rt store path (Task 5)', () => {
  test('an ok rt read maps pr -> BoardMr and never touches the provider factory', async () => {
    const { getProvider, callCount } = spyProvider({ provider: {} as GitProvider, projectPath: 'acme/web' });
    const { readMrs, calls } = spyReadMrs({
      ok: true,
      data: {
        byBranch: { a: { pr: mockPR(5, 'a'), source: 'store' }, b: null },
        syncedAt: 111,
      },
    });

    const out = await fetchMrsByBranch(getProvider, ['a', 'b'], 'acme-web', readMrs);

    expect(calls).toEqual([{ repoName: 'acme-web', branches: ['a', 'b'] }]);
    expect([...out.keys()]).toEqual(['a']);
    expect(out.get('a')).toEqual({
      iid: 5,
      url: mockPR(5, 'a').webUrl,
      title: 'MR 5',
      state: 'opened',
      pipelineStatus: 'unknown',
    });
    // The point of Step 3b: a repo the rt store fully answers for never pays
    // for a forge client (and never reads ~/.rt/secrets.json).
    expect(callCount()).toBe(0);
  });

  test('a grant-error rt read falls through to the provider path', async () => {
    const provider = {
      fetchPullRequestsByBranches: () => Promise.resolve(new Map([['a', mockPR(9, 'a')]])),
    } as unknown as GitProvider;
    const { getProvider, callCount } = spyProvider({ provider, projectPath: 'acme/web' });
    const { readMrs } = spyReadMrs({ ok: false, error: 'not granted for acme-web' });

    const out = await fetchMrsByBranch(getProvider, ['a'], 'acme-web', readMrs);

    expect(callCount()).toBe(1);
    expect(out.get('a')!.iid).toBe(9);
  });

  test('an unreachable-daemon rt read falls through to the provider path', async () => {
    const provider = {
      fetchPullRequestsByBranches: () => Promise.resolve(new Map([['a', mockPR(11, 'a')]])),
    } as unknown as GitProvider;
    const { getProvider, callCount } = spyProvider({ provider, projectPath: 'acme/web' });
    const { readMrs } = spyReadMrs({ ok: false, error: 'rt daemon unreachable at /tmp/rt.sock: connection refused' });

    const out = await fetchMrsByBranch(getProvider, ['a'], 'acme-web', readMrs);

    expect(callCount()).toBe(1);
    expect(out.get('a')!.iid).toBe(11);
  });

  test('a malformed ok response (no data) falls through to the provider path', async () => {
    const provider = {
      fetchPullRequestsByBranches: () => Promise.resolve(new Map([['a', mockPR(13, 'a')]])),
    } as unknown as GitProvider;
    const { getProvider, callCount } = spyProvider({ provider, projectPath: 'acme/web' });
    const { readMrs } = spyReadMrs({ ok: true } as RtResponse<MrByBranchData>);

    const out = await fetchMrsByBranch(getProvider, ['a'], 'acme-web', readMrs);

    expect(callCount()).toBe(1);
    expect(out.get('a')!.iid).toBe(13);
  });

  test('an unresolvable repo path skips the rt call entirely and runs the provider path', async () => {
    const provider = {
      fetchPullRequestByBranch: (_p: string, branch: string) => Promise.resolve(branch === 'a' ? mockPR(3, 'a') : null),
    } as unknown as GitProvider;
    const { getProvider, callCount } = spyProvider({ provider, projectPath: 'acme/web' });
    const { readMrs, calls } = spyReadMrs({ ok: true, data: { byBranch: {}, syncedAt: 1 } });

    const out = await fetchMrsByBranch(getProvider, ['a'], null, readMrs);

    expect(calls.length).toBe(0);
    expect(callCount()).toBe(1);
    expect(out.get('a')!.iid).toBe(3);
  });

  test('asks for nothing when there are no branches, even with a resolved rt repo', async () => {
    const { getProvider, callCount } = spyProvider(null);
    const { readMrs, calls } = spyReadMrs({ ok: true, data: { byBranch: {}, syncedAt: 1 } });

    expect((await fetchMrsByBranch(getProvider, [], 'acme-web', readMrs)).size).toBe(0);
    expect(calls.length).toBe(0);
    expect(callCount()).toBe(0);
  });
});

// ── resolveRtRepo (Task 5 test seam over @mattstack/rt-client#repoNameForPath) ─

describe('resolveRtRepo', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  function reposJsonWith(contents: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'gitq-rt-repos-test-'));
    dirs.push(dir);
    const path = join(dir, 'repos.json');
    writeFileSync(path, JSON.stringify(contents));
    return path;
  }

  test('resolves the repo name on an exact path match', () => {
    const path = reposJsonWith({ 'acme-web': '/Users/matt/Documents/GitHub/acme/web' });
    expect(resolveRtRepo('/Users/matt/Documents/GitHub/acme/web', path)).toBe('acme-web');
  });

  test('returns null when no entry matches, or the file is missing/corrupt', () => {
    const path = reposJsonWith({ 'acme-web': '/Users/matt/Documents/GitHub/acme/web' });
    expect(resolveRtRepo('/somewhere/else', path)).toBeNull();
    expect(resolveRtRepo('/anything', join(tmpdir(), 'gitq-rt-repos-does-not-exist.json'))).toBeNull();
  });
});
