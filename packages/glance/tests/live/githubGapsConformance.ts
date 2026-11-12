/**
 * Live cases for the GitHub gaps work: watchMR polling, rebase, the merge
 * method pick, the merge queue path, and the honest reads and writes.
 *
 * Every pull request here targets a throwaway branch cut from the default
 * branch, never the default branch itself, so a merge that lands (or an
 * auto-merge that fires) only ever writes to a branch this run created and
 * deletes. The one exception is the queue case, which runs against a
 * separate repository the operator names and dequeues its entry at once.
 */

import { MergeReadBackFailedError, PartialCreateError } from '../../src/errors.ts';
import type { WatcherStatus } from '../../src/RealtimeWatcher.ts';
import type { FetchPullRequestsWarning } from '../../src/GitProvider.ts';
import type { MergeMethod, PullRequest } from '../../src/types.ts';
import {
  Inconclusive,
  assert,
  check,
  commitFile,
  createBranch,
  runPrefix
} from './conformance.ts';
import type { ProviderFixture } from './fixture.ts';
import { pollUntil } from './poll.ts';
import type { Reporter } from './report.ts';
import { mutationTarget } from './sandboxTarget.ts';

const QUEUE_REPO_ENV = 'GLANCE_HARNESS_GITHUB_QUEUE_REPO';

// A real repository other work depends on; no case here may write to it.
const FORBIDDEN_REPO = 'm4ttheweric/gitq-test-sandbox';

const isForbiddenRepo = (projectPath: string): boolean =>
  projectPath.trim().toLowerCase() === FORBIDDEN_REPO;

const forbiddenReason = (projectPath: string): string =>
  `refused before any request: "${projectPath}" is ${FORBIDDEN_REPO}, which these cases must never write to`;

/** What a killed squash-only case is restored to: every method allowed. */
const BASELINE_MERGE_SETTINGS: MergeSettings = {
  allow_merge_commit: true,
  allow_squash_merge: true,
  allow_rebase_merge: true
};

interface MergeSettings {
  allow_merge_commit: boolean;
  allow_squash_merge: boolean;
  allow_rebase_merge: boolean;
}

interface CommitShape {
  sha: string;
  parents: string[];
}

interface MergeDefaults {
  viewerDefaultMergeMethod: string;
  mergeCommitAllowed: boolean;
  squashMergeAllowed: boolean;
  rebaseMergeAllowed: boolean;
}

/** Branches this run created, deleted in reverse order (sources before targets). */
class Scratch {
  readonly branches: string[] = [];

  constructor(readonly fixture: ProviderFixture) {}

  async branch(name: string, from?: string): Promise<string> {
    await createBranch(this.fixture, name, from);
    this.branches.push(name);
    return name;
  }

  async cleanup(): Promise<void> {
    const { provider, projectPath } = this.fixture;
    for (const branch of [...this.branches].reverse()) {
      await provider.deleteBranch(projectPath, branch).catch(err => {
        console.error(`  cleanup: could not delete ${branch}: ${err}`);
      });
    }
  }
}

async function readJson<T>(fixture: ProviderFixture, path: string, label: string): Promise<T> {
  const res = await fixture.provider.restRequest('GET', path);
  if (!res.ok) throw new Error(`${label} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function githubGraphql<T>(
  fixture: ProviderFixture,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await fixture.provider.restRequest('POST', '/graphql', { query, variables });
  if (!res.ok) throw new Error(`graphql failed: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) {
    throw new Error(`graphql failed: ${body.errors.map(e => e.message).join('; ')}`);
  }
  if (!body.data) throw new Error('graphql failed: no data');
  return body.data;
}

async function commitShape(fixture: ProviderFixture, sha: string): Promise<CommitShape> {
  const commit = await readJson<{ sha: string; parents: Array<{ sha: string }> }>(
    fixture,
    `/repos/${fixture.projectPath}/commits/${sha}`,
    `read commit ${sha}`
  );
  return { sha: commit.sha, parents: commit.parents.map(p => p.sha) };
}

async function branchHead(fixture: ProviderFixture, branch: string): Promise<CommitShape> {
  const ref = await readJson<{ object: { sha: string } }>(
    fixture,
    `/repos/${fixture.projectPath}/git/ref/heads/${branch}`,
    `read ref "${branch}"`
  );
  return commitShape(fixture, ref.object.sha);
}

async function openPr(
  fixture: ProviderFixture,
  sourceBranch: string,
  targetBranch: string,
  title: string
): Promise<PullRequest> {
  const pr = await fixture.provider.createPullRequest({
    projectPath: fixture.projectPath,
    title: `conformance: ${title}`,
    description: 'Opened by the glance conformance harness against a throwaway target branch. Safe to close.',
    sourceBranch,
    targetBranch
  });
  assert(pr.iid > 0, `expected a positive iid, got ${pr.iid}`);
  return pr;
}

/**
 * GitHub computes mergeability after a PR opens; a merge sent before that
 * answers 405 for a reason that says nothing about the merge itself.
 */
async function waitForGitHubMergeable(fixture: ProviderFixture, iid: number): Promise<void> {
  const pr = await pollUntil(
    `mergeability of #${iid}`,
    async () => {
      const raw = await readJson<{ mergeable: boolean | null; mergeable_state: string }>(
        fixture,
        `/repos/${fixture.projectPath}/pulls/${iid}`,
        `read #${iid}`
      );
      return raw.mergeable === null ? null : raw;
    },
    { timeoutMs: 30_000, intervalMs: 2_000 }
  );
  if (!pr.mergeable) {
    throw new Inconclusive(`#${iid} is not mergeable (mergeable_state "${pr.mergeable_state}")`);
  }
}

async function mergeCommitOf(fixture: ProviderFixture, iid: number): Promise<CommitShape> {
  const raw = await pollUntil(
    `merge commit of #${iid}`,
    async () => {
      const pr = await readJson<{ merged: boolean; merge_commit_sha: string | null }>(
        fixture,
        `/repos/${fixture.projectPath}/pulls/${iid}`,
        `read #${iid}`
      );
      return pr.merged && pr.merge_commit_sha ? pr : null;
    },
    { timeoutMs: 30_000, intervalMs: 2_000 }
  );
  return commitShape(fixture, raw.merge_commit_sha as string);
}

/** The SDK's own pick with no caller input, restated so a wrong pick shows. */
function expectedDefaultMethod(defaults: MergeDefaults): MergeMethod {
  const allowed: Record<MergeMethod, boolean> = {
    merge: defaults.mergeCommitAllowed,
    squash: defaults.squashMergeAllowed,
    rebase: defaults.rebaseMergeAllowed
  };
  const viewer = defaults.viewerDefaultMergeMethod.toLowerCase() as MergeMethod;
  if (allowed[viewer]) return viewer;
  const first = (['merge', 'squash', 'rebase'] as const).find(m => allowed[m]);
  if (!first) throw new Error('the repository allows no merge method');
  return first;
}

async function readMergeDefaults(fixture: ProviderFixture): Promise<MergeDefaults> {
  const [owner, name] = fixture.projectPath.split('/');
  const data = await githubGraphql<{ repository: MergeDefaults }>(
    fixture,
    `query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        viewerDefaultMergeMethod mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
      }
    }`,
    { owner, name }
  );
  return data.repository;
}

/**
 * Grades a merge commit against the method that should have produced it.
 * `oldTargetHead` is the target's head before the merge and `prCommits` the
 * number of commits on the PR, which is what tells squash from rebase.
 */
function assertMergeShape(
  method: MergeMethod,
  merged: CommitShape,
  oldTargetHead: string,
  prCommits: number
): void {
  if (method === 'merge') {
    assert(
      merged.parents.length === 2,
      `expected a merge commit with two parents, got ${merged.parents.length} on ${merged.sha}`
    );
    assert(
      merged.parents[0] === oldTargetHead,
      `merge commit's first parent ${merged.parents[0]} is not the old target head ${oldTargetHead}`
    );
    return;
  }
  assert(
    merged.parents.length === 1,
    `expected a ${method} result with one parent, got ${merged.parents.length} on ${merged.sha}`
  );
  if (method === 'squash') {
    assert(
      merged.parents[0] === oldTargetHead,
      `a squash of ${prCommits} commits should sit directly on the old target head ${oldTargetHead}, ` +
        `but ${merged.sha}'s parent is ${merged.parents[0]}`
    );
    return;
  }
  assert(
    merged.parents[0] !== oldTargetHead,
    `a rebase of ${prCommits} commits should put more than one commit on the target, ` +
      `but ${merged.sha} sits directly on the old target head`
  );
}

export async function runGitHubGapsConformance(
  fixture: ProviderFixture,
  report: Reporter
): Promise<void> {
  if (fixture.name !== 'github') return;
  if (isForbiddenRepo(fixture.projectPath)) {
    report.fail(fixture.name, 'mergePullRequest', 'GitHub gaps cases', forbiddenReason(fixture.projectPath));
    return;
  }

  const prefix = `${runPrefix()}-gaps`;
  const scratch = new Scratch(fixture);
  try {
    await watchAndBranchReadCases(fixture, report, scratch, prefix);
    await rebaseCase(fixture, report, scratch, prefix);
    await defaultMergeMethodCase(fixture, report, scratch, prefix);
    await squashOnlyCase(fixture, report, scratch, prefix);
    await partialCreateCase(fixture, report, scratch, prefix);
    await boundedRestRequestCase(fixture, report);
  } finally {
    await scratch.cleanup();
  }
  await queueCase(fixture, report, prefix);
}

async function watchAndBranchReadCases(
  fixture: ProviderFixture,
  report: Reporter,
  scratch: Scratch,
  prefix: string
): Promise<void> {
  const { provider, projectPath } = fixture;
  const source = `${prefix}-watch-source`;
  let iid: number | null = null;

  await check(report, fixture, 'createPullRequest', 'opens a PR for the watchMR and by-branch cases', async () => {
    const target = await scratch.branch(`${prefix}-watch-target`);
    await scratch.branch(source, target);
    await commitFile(fixture, source, `conformance-watch-${Date.now()}.md`, '# watched\n');
    iid = (await openPr(fixture, source, target, 'watchMR and by-branch reads')).iid;
  });

  if (iid === null) {
    for (const method of ['watchMR', 'fetchPullRequestByBranch'] as const) {
      report.skip(fixture.name, method, 'GitHub gaps watch cycle', 'not run: its pull request could not be opened');
    }
    return;
  }
  const prIid: number = iid;

  await check(report, fixture, 'watchMR', 'polls, delivers an update and reports polling', async () => {
    const statuses: WatcherStatus['connection'][] = [];
    let delivered: { pr: PullRequest; status: WatcherStatus['connection'] | undefined } | null = null;
    const dispose = provider.watchMR(
      projectPath,
      prIid,
      null,
      pr => {
        delivered ??= { pr, status: statuses.at(-1) };
      },
      {
        pollIntervalMs: 5_000,
        onStatusChange: s => statuses.push(s.connection)
      }
    );
    try {
      const first = await pollUntil('the first watchMR update', async () => delivered, {
        timeoutMs: 30_000,
        intervalMs: 500
      });
      assert(first.pr.iid === prIid, `update carried #${first.pr.iid}, expected #${prIid}`);
      assert(
        first.status === 'polling',
        `status at the first update was "${first.status}" (history ${JSON.stringify(statuses)}), expected "polling"`
      );
    } finally {
      dispose();
    }
  });

  await check(
    report,
    fixture,
    'fetchPullRequestByBranch',
    'a same-repo PR reports sourceProjectPath as the fixture repo, with no warnings',
    async () => {
      const warnings: FetchPullRequestsWarning[] = [];
      const pr = await provider.fetchPullRequestByBranch(projectPath, source, 'opened', {
        onWarning: w => warnings.push(w)
      });
      assert(pr !== null, `no PR found for "${source}" (warnings: ${JSON.stringify(warnings)})`);
      assert(pr.iid === prIid, `found #${pr.iid}, expected #${prIid}`);
      assert(
        pr.sourceProjectPath === projectPath,
        `sourceProjectPath is ${JSON.stringify(pr.sourceProjectPath)}, expected "${projectPath}"`
      );
      assert(warnings.length === 0, `a healthy read warned: ${JSON.stringify(warnings)}`);
    }
  );
}

async function rebaseCase(
  fixture: ProviderFixture,
  report: Reporter,
  scratch: Scratch,
  prefix: string
): Promise<void> {
  const { provider, projectPath } = fixture;
  const target = `${prefix}-rebase-target`;
  const source = `${prefix}-rebase-source`;

  await check(report, fixture, 'rebasePullRequest', 'moves a behind branch onto its advanced base', async () => {
    await scratch.branch(target);
    await scratch.branch(source, target);
    // One commit only: after the rebase the head's parent must be the
    // target's new head, which holds only for a single-commit branch.
    await commitFile(fixture, source, `conformance-rebase-${Date.now()}.md`, '# rebase source\n');
    const pr = await openPr(fixture, source, target, 'rebase');
    await commitFile(
      fixture,
      target,
      `conformance-target-moved-${Date.now()}.md`,
      '# the target moved under the pull request\n'
    );

    const targetHead = await branchHead(fixture, target);
    const before = await branchHead(fixture, source);
    assert(
      !before.parents.includes(targetHead.sha),
      `setup did not leave "${source}" behind "${target}"; a no-op rebase would pass`
    );

    await provider.rebasePullRequest(projectPath, pr.iid);

    let after: CommitShape;
    try {
      after = await pollUntil(
        `"${source}" rewritten onto ${targetHead.sha}`,
        async () => {
          const head = await branchHead(fixture, source);
          return head.sha !== before.sha && head.parents.includes(targetHead.sha) ? head : null;
        },
        { timeoutMs: 60_000, intervalMs: 2_000 }
      );
    } catch {
      const head = await branchHead(fixture, source).catch(() => null);
      throw new Error(
        `"${source}" is at ${head?.sha ?? 'unreadable'} with parents ${JSON.stringify(head?.parents ?? [])} ` +
          `after rebasePullRequest; expected a new head whose parent is "${target}"'s head ${targetHead.sha}`
      );
    }
    assert(after.parents.length === 1, `rebased head ${after.sha} has ${after.parents.length} parents`);
  });
}

async function defaultMergeMethodCase(
  fixture: ProviderFixture,
  report: Reporter,
  scratch: Scratch,
  prefix: string
): Promise<void> {
  const { provider, projectPath } = fixture;
  const target = `${prefix}-default-merge-target`;
  const source = `${prefix}-default-merge-source`;

  await check(
    report,
    fixture,
    'mergePullRequest',
    'with no method, the merge commit has the repository default method\'s shape',
    async () => {
      const defaults = await readMergeDefaults(fixture);
      const method = expectedDefaultMethod(defaults);
      await scratch.branch(target);
      await scratch.branch(source, target);
      const stamp = Date.now();
      await commitFile(fixture, source, `conformance-default-a-${stamp}.md`, '# a\n');
      await commitFile(fixture, source, `conformance-default-b-${stamp}.md`, '# b\n');
      const pr = await openPr(fixture, source, target, 'default merge method');
      const oldTargetHead = (await branchHead(fixture, target)).sha;

      await waitForGitHubMergeable(fixture, pr.iid);
      const result = await provider.mergePullRequest(projectPath, pr.iid);
      assert(result.state === 'merged', `expected state "merged", got "${result.state}"`);
      assert(result.queued === undefined, 'a direct merge reported a queue entry');

      const merged = await mergeCommitOf(fixture, pr.iid);
      console.log(
        `  default merge: viewerDefaultMergeMethod=${defaults.viewerDefaultMergeMethod}, ` +
          `expected "${method}", merge commit ${merged.sha} has ${merged.parents.length} parent(s)`
      );
      assertMergeShape(method, merged, oldTargetHead, 2);
    }
  );
}

async function readMergeSettings(fixture: ProviderFixture): Promise<MergeSettings | null> {
  const repo = await readJson<Partial<MergeSettings>>(
    fixture,
    `/repos/${fixture.projectPath}`,
    'read repository settings'
  );
  const { allow_merge_commit, allow_squash_merge, allow_rebase_merge } = repo;
  if (
    typeof allow_merge_commit !== 'boolean' ||
    typeof allow_squash_merge !== 'boolean' ||
    typeof allow_rebase_merge !== 'boolean'
  ) {
    return null;
  }
  return { allow_merge_commit, allow_squash_merge, allow_rebase_merge };
}

const isSquashOnly = (s: MergeSettings): boolean =>
  s.allow_squash_merge && !s.allow_merge_commit && !s.allow_rebase_merge;

/** Resolves null on success, or the reason the token may not change settings. */
async function patchMergeSettings(
  fixture: ProviderFixture,
  settings: MergeSettings
): Promise<string | null> {
  const res = await fixture.provider.restRequest('PATCH', `/repos/${fixture.projectPath}`, settings);
  if (res.status === 403 || res.status === 404) {
    const text = await res.text().catch(() => '');
    return `the token cannot change repository settings (HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''})`;
  }
  if (!res.ok) throw new Error(`PATCH repository settings failed: HTTP ${res.status}`);
  return null;
}

const METHOD_REFUSAL =
  /\b(?:merge method|merge commits?|squash merges?|squash merging|rebase merges?|rebase merging)\b[^.]*\bnot allowed\b/i;

const NEVER_REPORTED_CONTEXT = 'glance-conformance/never-reports';

/** Resolves null on success, or the reason the token may not protect the branch. */
async function protectWithUnreportedCheck(fixture: ProviderFixture, branch: string): Promise<string | null> {
  const res = await fixture.provider.restRequest(
    'PUT',
    `/repos/${fixture.projectPath}/branches/${branch}/protection`,
    {
      required_status_checks: { strict: false, contexts: [NEVER_REPORTED_CONTEXT] },
      enforce_admins: true,
      required_pull_request_reviews: null,
      restrictions: null
    }
  );
  if (res.status === 403 || res.status === 404) {
    const text = await res.text().catch(() => '');
    return `the token cannot protect "${branch}" (HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''})`;
  }
  if (!res.ok) throw new Error(`PUT branch protection failed: HTTP ${res.status}`);
  return null;
}

async function waitForBlocked(fixture: ProviderFixture, iid: number): Promise<void> {
  let last = 'unread';
  try {
    await pollUntil(
      `#${iid} to read as blocked`,
      async () => {
        const raw = await readJson<{ mergeable_state: string }>(
          fixture,
          `/repos/${fixture.projectPath}/pulls/${iid}`,
          `read #${iid}`
        );
        last = raw.mergeable_state;
        return raw.mergeable_state === 'blocked' ? raw : null;
      },
      { timeoutMs: 30_000, intervalMs: 2_000 }
    );
  } catch {
    throw new Inconclusive(`#${iid} never read as blocked under the required check (last mergeable_state "${last}")`);
  }
}

async function squashOnlyCase(
  fixture: ProviderFixture,
  report: Reporter,
  scratch: Scratch,
  prefix: string
): Promise<void> {
  const { provider, projectPath } = fixture;
  const target = `${prefix}-squash-target`;
  const mergeSource = `${prefix}-squash-merge-source`;
  const autoSource = `${prefix}-squash-auto-source`;
  let original: MergeSettings | null = null;
  let switched = false;
  let autoIid: number | null = null;
  let skipAutoMerge: string | null = 'not run: the squash-only setup did not complete';
  let protectedTarget = false;

  try {
    await check(
      report,
      fixture,
      'mergePullRequest',
      'squash-only repository: a merge with no method squashes',
      async () => {
        let settings = await readMergeSettings(fixture);
        if (settings === null) {
          skipAutoMerge = 'the token cannot read the repository merge settings';
          throw new Inconclusive(skipAutoMerge);
        }
        if (isSquashOnly(settings)) {
          const refused = await patchMergeSettings(fixture, BASELINE_MERGE_SETTINGS);
          if (refused) {
            skipAutoMerge = refused;
            throw new Inconclusive(refused);
          }
          report.skip(
            fixture.name,
            'mergePullRequest',
            'squash-only fixture settings at start',
            'a killed run left the fixture squash-only; every merge method was re-allowed before this case'
          );
          settings = BASELINE_MERGE_SETTINGS;
        }
        original = settings;

        await scratch.branch(target);
        await scratch.branch(mergeSource, target);
        await scratch.branch(autoSource, target);
        const stamp = Date.now();
        await commitFile(fixture, mergeSource, `conformance-squash-a-${stamp}.md`, '# a\n');
        await commitFile(fixture, mergeSource, `conformance-squash-b-${stamp}.md`, '# b\n');
        await commitFile(fixture, autoSource, `conformance-squash-auto-${stamp}.md`, '# auto\n');
        const pr = await openPr(fixture, mergeSource, target, 'squash-only merge');
        autoIid = (await openPr(fixture, autoSource, target, 'squash-only auto-merge')).iid;

        // Set before the PATCH: one applied server-side whose response is
        // lost must still be restored, and restoring is idempotent.
        switched = true;
        const refused = await patchMergeSettings(fixture, {
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false
        });
        if (refused) {
          switched = false;
          skipAutoMerge = refused;
          throw new Inconclusive(refused);
        }
        const now = await readMergeSettings(fixture);
        if (now === null || !isSquashOnly(now)) {
          skipAutoMerge = `the PATCH was accepted but the repository reads back as ${JSON.stringify(now)}, not squash-only`;
          throw new Inconclusive(skipAutoMerge);
        }
        skipAutoMerge = null;

        const oldTargetHead = (await branchHead(fixture, target)).sha;
        await waitForGitHubMergeable(fixture, pr.iid);
        const result = await provider.mergePullRequest(projectPath, pr.iid);
        assert(result.state === 'merged', `expected state "merged", got "${result.state}"`);
        const merged = await mergeCommitOf(fixture, pr.iid);
        assertMergeShape('squash', merged, oldTargetHead, 2);
      }
    );

    if (skipAutoMerge !== null || autoIid === null) {
      report.skip(
        fixture.name,
        'setAutoMerge',
        'squash-only repository: arms auto-merge with no method',
        skipAutoMerge ?? 'not run: the auto-merge pull request could not be opened'
      );
      return;
    }
    const iid: number = autoIid;

    await check(report, fixture, 'setAutoMerge', 'squash-only repository: arms auto-merge with no method', async () => {
      let armed = false;
      try {
        // GitHub arms auto-merge only on a blocked PR; a required context
        // that never reports keeps it blocked, and enforce_admins stops the
        // admin token from bypassing it, so the arm can never fire a merge.
        const refused = await protectWithUnreportedCheck(fixture, target);
        if (refused) throw new Inconclusive(refused);
        protectedTarget = true;
        await waitForBlocked(fixture, iid);

        try {
          await provider.setAutoMerge(projectPath, iid);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // A method refusal is the defect this case exists for. "Auto merge
          // is not allowed for this repository" is a repository setting and
          // must not match.
          if (METHOD_REFUSAL.test(message)) throw err;
          if (/\bis in (?:unstable|clean) status\b/.test(message)) {
            throw new Inconclusive(
              `GitHub refused on mergeability, not on the method, so the method pick is unproven: ${message}`
            );
          }
          throw err;
        }
        armed = true;
        const after = await provider.fetchSingleMR(projectPath, iid, null);
        assert(
          after?.autoMergeEnabled === true,
          `expected autoMergeEnabled true after setAutoMerge, got ${after?.autoMergeEnabled}`
        );
      } finally {
        if (armed) {
          await provider.cancelAutoMerge(projectPath, iid).catch(err => {
            console.error(`  cleanup: could not cancel auto-merge on #${iid}: ${err}`);
          });
        }
      }
    });
  } finally {
    if (protectedTarget) {
      const res = await provider
        .restRequest('DELETE', `/repos/${projectPath}/branches/${target}/protection`)
        .catch(() => null);
      if (!res?.ok) {
        console.error(`  cleanup: could not remove protection from ${target}: HTTP ${res?.status ?? 'none'}`);
      }
    }
    if (switched && original !== null) {
      const restore: MergeSettings = original;
      const refused = await patchMergeSettings(fixture, restore).catch(err => String(err));
      if (refused) {
        report.fail(
          fixture.name,
          'mergePullRequest',
          'squash-only repository: settings restored',
          `the fixture is still squash-only; restore ${JSON.stringify(restore)} by hand: ${refused}`
        );
      }
    }
  }
}

async function partialCreateCase(
  fixture: ProviderFixture,
  report: Reporter,
  scratch: Scratch,
  prefix: string
): Promise<void> {
  const { provider, projectPath } = fixture;
  const stamp = prefix.split('/').pop() ?? Date.now().toString(36);
  const reviewer = `glance-no-such-user-${stamp}`;

  await check(
    report,
    fixture,
    'createPullRequest',
    'a reviewer GitHub refuses throws PartialCreateError for a PR that exists',
    async () => {
      const target = await scratch.branch(`${prefix}-partial-target`);
      const source = await scratch.branch(`${prefix}-partial-source`, target);
      await commitFile(fixture, source, `conformance-partial-${Date.now()}.md`, '# partial\n');

      let caught: unknown;
      try {
        await provider.createPullRequest({
          projectPath,
          title: 'conformance: partial create',
          description: 'Opened by the glance conformance harness. Safe to close.',
          sourceBranch: source,
          targetBranch: target,
          reviewers: [reviewer]
        });
      } catch (err) {
        caught = err;
      }

      // Found by branch, not from the error, so a PR the SDK lost track of
      // is still closed.
      const opened = await provider.fetchPullRequestByBranch(projectPath, source, 'opened').catch(() => null);
      try {
        assert(caught !== undefined, `createPullRequest resolved although reviewer "${reviewer}" does not exist`);
        assert(
          caught instanceof PartialCreateError,
          `expected PartialCreateError, got ${caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught)}`
        );
        assert(
          caught.failedSteps.some(s => s.step === 'reviewers'),
          `failedSteps ${JSON.stringify(caught.failedSteps.map(s => s.step))} does not name reviewers`
        );
        assert(caught.writeApplied, 'PartialCreateError.writeApplied should be true');
        const raw = await readJson<{ state: string; number: number }>(
          fixture,
          `/repos/${projectPath}/pulls/${caught.iid}`,
          `read #${caught.iid}`
        );
        assert(raw.state === 'open', `#${caught.iid} is "${raw.state}", expected an open PR`);
        assert(opened?.iid === caught.iid, `the error names #${caught.iid} but the branch's PR is #${opened?.iid}`);
      } finally {
        const iid = caught instanceof PartialCreateError ? caught.iid : opened?.iid;
        if (iid !== undefined) {
          await provider.updatePullRequest(projectPath, iid, { stateEvent: 'close' }).catch(err => {
            console.error(`  cleanup: could not close #${iid}: ${err}`);
          });
        }
      }
    }
  );
}

const STREAM_CAP_BYTES = 4 * 1024;

async function boundedRestRequestCase(fixture: ProviderFixture, report: Reporter): Promise<void> {
  await check(report, fixture, 'restRequest', 'a reader stops a large response at its own cap', async () => {
    const res = await fixture.provider.restRequest('GET', `/repos/${fixture.projectPath}/commits?per_page=100`);
    assert(res.ok, `HTTP ${res.status}`);
    assert(res.body !== null, 'the response has no body stream');
    const reader = res.body.getReader();
    let bytes = 0;
    let ended = false;
    while (bytes < STREAM_CAP_BYTES) {
      const { done, value } = await reader.read();
      if (done) {
        ended = true;
        break;
      }
      bytes += value.byteLength;
    }
    if (ended) {
      throw new Inconclusive(
        `the whole response was ${bytes} bytes, under the ${STREAM_CAP_BYTES}-byte cap, so stopping early is unproven`
      );
    }
    await reader.cancel();
    const declared = Number(res.headers.get('content-length') ?? NaN);
    console.log(
      `  restRequest stream: stopped after ${bytes} bytes (content-length ${Number.isNaN(declared) ? 'absent' : declared})`
    );
    if (!Number.isNaN(declared)) {
      assert(bytes < declared, `read ${bytes} bytes of a ${declared}-byte body, so nothing was left unread`);
    }
  });
}

interface BranchRule {
  type: string;
  parameters?: { required_status_checks?: Array<{ context: string }> };
}

/** Throws Inconclusive unless the branch has an active merge queue and a required check. */
async function assertQueueGuarded(fixture: ProviderFixture, branch: string): Promise<void> {
  const rules = await readJson<BranchRule[]>(
    fixture,
    `/repos/${fixture.projectPath}/rules/branches/${branch}`,
    `read the active rules on ${fixture.projectPath}:${branch}`
  );
  if (!rules.some(r => r.type === 'merge_queue')) {
    throw new Inconclusive(
      `${fixture.projectPath}:${branch} has no active merge_queue rule, so a merge would land directly; nothing was written`
    );
  }
  const checks = rules
    .filter(r => r.type === 'required_status_checks')
    .flatMap(r => r.parameters?.required_status_checks ?? []);
  if (checks.length === 0) {
    throw new Inconclusive(
      `${fixture.projectPath}:${branch} requires no status check, so its queue could merge the PR before it is dequeued; nothing was written`
    );
  }
}

async function queueCase(fixture: ProviderFixture, report: Reporter, prefix: string): Promise<void> {
  const label = 'merge queue base: a merge with no input resolves queued';
  const raw = process.env[QUEUE_REPO_ENV];
  if (!raw?.trim()) {
    report.skip(fixture.name, 'mergePullRequest', label, `queue path not run: ${QUEUE_REPO_ENV} is unset`);
    return;
  }
  const target = mutationTarget(QUEUE_REPO_ENV, raw, 'repo');
  if (!target.ok) {
    report.fail(fixture.name, 'mergePullRequest', label, target.refusal);
    return;
  }
  if (isForbiddenRepo(target.projectPath)) {
    report.fail(fixture.name, 'mergePullRequest', label, forbiddenReason(target.projectPath));
    return;
  }

  const { provider } = fixture;
  const queueProject = target.projectPath;
  const branch = `${prefix}-queue-source`;
  let created = false;
  let nodeId: string | null = null;
  let queueFixture: ProviderFixture = { ...fixture, projectPath: queueProject };

  try {
    await check(report, fixture, 'mergePullRequest', label, async () => {
      const repo = await readJson<{ default_branch: string }>(
        queueFixture,
        `/repos/${queueProject}`,
        `read ${queueProject}`
      );
      queueFixture = { ...queueFixture, defaultBranch: repo.default_branch };
      // Without an active queue the SDK merges directly, into a real default
      // branch; without a required check the queue can land the PR before
      // the dequeue below runs. Either way nothing is written.
      await assertQueueGuarded(queueFixture, repo.default_branch);
      await createBranch(queueFixture, branch);
      created = true;
      await commitFile(queueFixture, branch, `conformance-queue-${Date.now()}.md`, '# queued\n');
      const pr = await openPr(queueFixture, branch, repo.default_branch, 'merge queue');
      nodeId = (
        await readJson<{ node_id: string }>(queueFixture, `/repos/${queueProject}/pulls/${pr.iid}`, `read #${pr.iid}`)
      ).node_id;

      const [owner, name] = queueProject.split('/');
      const live = await githubGraphql<{ repository: { pullRequest: { isMergeQueueEnabled: boolean } | null } }>(
        queueFixture,
        `query($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) { pullRequest(number: $number) { isMergeQueueEnabled } }
        }`,
        { owner, name, number: pr.iid }
      );
      if (live.repository.pullRequest?.isMergeQueueEnabled !== true) {
        throw new Inconclusive(
          `GitHub reports no active merge queue for #${pr.iid} on ${queueProject}:${repo.default_branch}, so merge was never called`
        );
      }

      let result;
      try {
        result = await provider.mergePullRequest(queueProject, pr.iid);
      } catch (err) {
        if (err instanceof MergeReadBackFailedError && err.queued) {
          throw new Error(`enqueued (position ${err.queued.position}) but the read-back failed: ${err.message}`);
        }
        throw err;
      }
      assert(result.queued !== undefined, `resolved without a queue entry (state "${result.state}")`);
      assert(result.state === 'opened', `a queued PR should still be opened, got "${result.state}"`);
      console.log(`  queue: #${pr.iid} queued at position ${result.queued.position} (${result.queued.state})`);
    });
  } finally {
    // Dequeued at once so the queue never lands this PR on the default branch.
    if (nodeId !== null) {
      await githubGraphql(
        queueFixture,
        'mutation($id: ID!) { dequeuePullRequest(input: { id: $id }) { clientMutationId } }',
        { id: nodeId }
      ).catch(err => {
        console.error(`  cleanup: could not dequeue ${queueProject} ${branch}: ${err}`);
      });
    }
    if (created) {
      await provider.deleteBranch(queueProject, branch).catch(err => {
        console.error(`  cleanup: could not delete ${queueProject} ${branch}: ${err}`);
      });
    }
  }
}
