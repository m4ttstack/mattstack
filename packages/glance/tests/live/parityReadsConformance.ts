/**
 * Live cases for the parity reads: fetchCodeownerSections, fetchApprovalRules,
 * fetchDivergedCount(s) and fetchMergeRequestIndex.
 *
 * GitLab cases are read-only. GitHub cases open pull requests against
 * throwaway branches cut from the default branch, so nothing here writes to
 * the default branch, and every branch they create is deleted afterwards.
 */

import type { PullRequest } from '../../src/types.ts';
import { Inconclusive, assert, check, commitFile, createBranch, runPrefix } from './conformance.ts';
import { expectationFor, type ProviderMethod } from './expectations.ts';
import type { ProviderFixture } from './fixture.ts';
import { pollUntil } from './poll.ts';
import type { Reporter } from './report.ts';

const PARITY_READS = [
  'fetchCodeownerSections',
  'fetchApprovalRules',
  'fetchDivergedCount',
  'fetchDivergedCounts',
  'fetchMergeRequestIndex'
] as const satisfies readonly ProviderMethod[];

// A real repository other work depends on; no case here may write to it.
const FORBIDDEN_REPO = 'm4ttheweric/gitq-test-sandbox';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 25;

class Scratch {
  private readonly branches: string[] = [];

  constructor(private readonly fixture: ProviderFixture) {}

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

/** Cuts `target` from the default branch and `source` from `target`, with one commit on `source`. */
async function branchPair(
  fixture: ProviderFixture,
  scratch: Scratch,
  prefix: string,
  label: string
): Promise<{ target: string; source: string }> {
  const target = await scratch.branch(`${prefix}-${label}-target`);
  const source = await scratch.branch(`${prefix}-${label}-source`, target);
  await commitFile(fixture, source, `conformance-${label}-${Date.now()}.md`, `# ${label}\n`);
  return { target, source };
}

async function waitForMergeable(fixture: ProviderFixture, iid: number): Promise<void> {
  const raw = await pollUntil(
    `mergeability of #${iid}`,
    async () => {
      const res = await fixture.provider.restRequest('GET', `/repos/${fixture.projectPath}/pulls/${iid}`);
      if (!res.ok) return null;
      const body = (await res.json()) as { mergeable: boolean | null; mergeable_state: string };
      return body.mergeable === null ? null : body;
    },
    { timeoutMs: 30_000, intervalMs: 2_000 }
  );
  if (!raw.mergeable) {
    throw new Inconclusive(`#${iid} is not mergeable (mergeable_state "${raw.mergeable_state}")`);
  }
}

export async function runParityReadsConformance(
  fixture: ProviderFixture,
  report: Reporter
): Promise<void> {
  const { provider } = fixture;

  const absent: ProviderMethod[] = [];
  for (const method of PARITY_READS) {
    const expectation = expectationFor(fixture.name, method);
    if (expectation.support !== 'absent') continue;
    absent.push(method);
    await check(report, fixture, method, 'is absent, and its capability flag is false', async () => {
      assert(
        typeof (provider as unknown as Record<string, unknown>)[method] === 'undefined',
        `${method} is declared absent but is defined`
      );
      if (expectation.capability) {
        assert(
          provider.capabilities[expectation.capability] === false,
          `capabilities.${expectation.capability} should be false`
        );
      }
    });
  }

  if (fixture.name === 'gitlab') {
    await gitlabReadCases(fixture, report, absent);
    return;
  }
  await githubCases(fixture, report);
}

async function gitlabReadCases(
  fixture: ProviderFixture,
  report: Reporter,
  absent: ProviderMethod[]
): Promise<void> {
  const { provider, projectPath } = fixture;
  const checkPresent: typeof check = async (r, f, method, label, fn) => {
    if (absent.includes(method)) return;
    await check(r, f, method, label, fn);
  };
  const updatedAfter = new Date(Date.now() - 365 * DAY_MS).toISOString();

  await checkPresent(report, fixture, 'fetchCodeownerSections', 'returns an array or null', async () => {
    const sections = await provider.fetchCodeownerSections!({ projectPath });
    assert(
      sections === null || (Array.isArray(sections) && sections.every(s => typeof s === 'string')),
      `expected string[] or null, got ${JSON.stringify(sections)?.slice(0, 80)}`
    );
  });

  await checkPresent(report, fixture, 'fetchApprovalRules', 'returns well-formed entries', async () => {
    const entries = await provider.fetchApprovalRules!({ projectPath, updatedAfter });
    assert(Array.isArray(entries), 'expected an array');
    if (entries.length === 0) throw new Inconclusive('no MRs with approval rules in the last year');
    for (const entry of entries) {
      assert(Number.isInteger(entry.iid) && entry.iid > 0, `entry has a bad iid: ${JSON.stringify(entry).slice(0, 80)}`);
      assert(Array.isArray(entry.rules), `entry !${entry.iid} rules is not an array`);
      for (const rule of entry.rules) {
        assert(typeof rule.approved === 'boolean', `rule on !${entry.iid} has a non-boolean approved`);
        assert(rule.section === null || typeof rule.section === 'string', `rule on !${entry.iid} has a bad section`);
      }
    }
  });

  await checkPresent(report, fixture, 'fetchDivergedCount', 'reads a number or null for an open MR', async () => {
    const open = await provider.fetchMergeRequestIndex!({
      projectPaths: [projectPath],
      updatedAfter,
      states: ['opened']
    });
    const sample = open[0];
    if (!sample) throw new Inconclusive('the fixture has no open MR');
    const count = await provider.fetchDivergedCount!(projectPath, sample.iid);
    assert(
      count === null || (Number.isInteger(count) && count >= 0),
      `expected a non-negative integer or null, got ${count}`
    );
  });
}

async function githubCases(fixture: ProviderFixture, report: Reporter): Promise<void> {
  const { projectPath } = fixture;
  if (projectPath.trim().toLowerCase() === FORBIDDEN_REPO) {
    report.fail(
      fixture.name,
      'fetchMergeRequestIndex',
      'GitHub parity reads cases',
      `refused before any request: "${projectPath}" is ${FORBIDDEN_REPO}, which these cases must never write to`
    );
    return;
  }

  const prefix = `${runPrefix()}-parity`;
  const scratch = new Scratch(fixture);
  try {
    await indexCase(fixture, report, scratch, prefix);
    await behindCountCases(fixture, report, scratch, prefix);
    await rulesCases(fixture, report, scratch, prefix);
  } finally {
    await scratch.cleanup();
  }
}

async function indexCase(
  fixture: ProviderFixture,
  report: Reporter,
  scratch: Scratch,
  prefix: string
): Promise<void> {
  const { provider, projectPath } = fixture;
  await check(report, fixture, 'fetchMergeRequestIndex', 'a PR merged this run appears as a merged row with its source branch', async () => {
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const { target, source } = await branchPair(fixture, scratch, prefix, 'index');
    const pr = await openPr(fixture, source, target, 'merged index row');
    await waitForMergeable(fixture, pr.iid);
    await provider.mergePullRequest(projectPath, pr.iid);
    const row = await pollUntil(
      `merged index row for #${pr.iid}`,
      async () => {
        const rows = await provider.fetchMergeRequestIndex!({
          projectPaths: [projectPath],
          updatedAfter: startedAt
        });
        return rows.find(r => r.iid === pr.iid && r.state === 'merged') ?? null;
      },
      { timeoutMs: 60_000, intervalMs: 3_000 }
    );
    assert(row.sourceBranch === source, `expected source branch "${source}", got "${row.sourceBranch}"`);
    assert(row.projectPath === projectPath, `row names project "${row.projectPath}"`);
    assert(row.mergedAt !== null && Date.parse(row.mergedAt) >= Date.parse(startedAt), `mergedAt ${row.mergedAt} is outside the window`);
  });
}

async function behindCountCases(
  fixture: ProviderFixture,
  report: Reporter,
  scratch: Scratch,
  prefix: string
): Promise<void> {
  const { provider, projectPath } = fixture;
  let behindIid: number | null = null;
  let tipIid: number | null = null;

  await check(report, fixture, 'createPullRequest', 'opens a PR cut before its base advanced and one cut from the tip', async () => {
    const target = await scratch.branch(`${prefix}-behind-target`);
    const stale = await scratch.branch(`${prefix}-behind-stale`, target);
    await commitFile(fixture, stale, `conformance-stale-${Date.now()}.md`, '# stale\n');
    behindIid = (await openPr(fixture, stale, target, 'behind base')).iid;
    await commitFile(fixture, target, `conformance-advance-${Date.now()}.md`, '# advance\n');
    const fresh = await scratch.branch(`${prefix}-behind-fresh`, target);
    await commitFile(fixture, fresh, `conformance-fresh-${Date.now()}.md`, '# fresh\n');
    tipIid = (await openPr(fixture, fresh, target, 'cut from the tip')).iid;
  });

  if (behindIid === null || tipIid === null) {
    for (const method of ['fetchDivergedCounts', 'fetchDivergedCount'] as const) {
      report.skip(fixture.name, method, 'behind count', 'not run: its pull requests could not be opened');
    }
    return;
  }
  const behind: number = behindIid;
  const tip: number = tipIid;

  await check(report, fixture, 'fetchDivergedCounts', 'a PR behind its base reports at least 1 and one from the tip reports 0', async () => {
    const counts = await pollUntil(
      'diverged counts for the behind and tip PRs',
      async () => {
        const map = await provider.fetchDivergedCounts!(projectPath, [behind, tip]);
        const b = map.get(behind);
        return typeof b === 'number' && b >= 1 && map.has(tip) ? map : null;
      },
      { timeoutMs: 30_000, intervalMs: 3_000 }
    );
    assert(counts.get(tip) === 0, `expected 0 for the tip PR, got ${counts.get(tip)}`);
  });

  await check(report, fixture, 'fetchDivergedCount', 'agrees with the batched read for both PRs', async () => {
    const behindCount = await provider.fetchDivergedCount!(projectPath, behind);
    const tipCount = await provider.fetchDivergedCount!(projectPath, tip);
    assert(typeof behindCount === 'number' && behindCount >= 1, `expected at least 1 for the behind PR, got ${behindCount}`);
    assert(tipCount === 0, `expected 0 for the tip PR, got ${tipCount}`);
  });

  await check(report, fixture, 'fetchDivergedCounts', `records the time of a ${BATCH_SIZE}-PR batch`, async () => {
    const open = await provider.fetchMergeRequestIndex!({
      projectPaths: [projectPath],
      updatedAfter: new Date(Date.now() - 365 * DAY_MS).toISOString(),
      states: ['opened']
    });
    if (open.length < BATCH_SIZE) {
      throw new Inconclusive(`the fixture has ${open.length} open PRs, fewer than ${BATCH_SIZE}`);
    }
    const iids = open.slice(0, BATCH_SIZE).map(r => r.iid);
    const startedAt = Date.now();
    const map = await provider.fetchDivergedCounts!(projectPath, iids);
    console.log(`  fetchDivergedCounts: ${BATCH_SIZE} PRs in ${Date.now() - startedAt}ms`);
    assert(map.size <= BATCH_SIZE, `map has ${map.size} entries for ${BATCH_SIZE} PRs`);
  });
}

async function rulesCases(
  fixture: ProviderFixture,
  report: Reporter,
  scratch: Scratch,
  prefix: string
): Promise<void> {
  const { provider, projectPath } = fixture;
  let sections: string[] | null = null;

  await check(report, fixture, 'fetchCodeownerSections', 'returns lowercased @ owners, or null without a CODEOWNERS file', async () => {
    sections = await provider.fetchCodeownerSections!({ projectPath });
    if (sections === null) return;
    for (const section of sections) {
      assert(section.startsWith('@') && section === section.toLowerCase(), `section "${section}" is not a lowercased @ owner`);
    }
  });

  const teams = ((sections ?? []) as string[]).filter(s => s.includes('/'));

  await check(report, fixture, 'fetchApprovalRules', 'an unapproved team rule becomes approved after the approver approves then comments', async () => {
    if (sections === null) throw new Inconclusive('fixture has no CODEOWNERS');
    if (teams.length === 0) throw new Inconclusive('CODEOWNERS names no @org/team owner');
    const { target, source } = await branchPair(fixture, scratch, prefix, 'rules');
    const pr = await openPr(fixture, source, target, 'team approval rule');

    const teamRule = async (): Promise<{ approved: boolean } | null> => {
      const entries = await provider.fetchApprovalRules!({ projectPath, iids: [pr.iid] });
      const entry = entries.find(e => e.iid === pr.iid);
      if (!entry) return null;
      assert(entry.unknownReason === undefined, `rules for #${pr.iid} unread: ${entry.unknownReason}`);
      return entry.rules.find(r => r.section !== null && teams.includes(r.section)) ?? null;
    };

    let before: { approved: boolean } | null = null;
    for (let attempt = 0; attempt < 10 && !before; attempt++) {
      if (attempt > 0) await Bun.sleep(3_000);
      before = await teamRule();
    }
    if (!before) {
      throw new Inconclusive(
        'the PR adds a file at the repo root and no @org/team owner in CODEOWNERS covers it; add a root pattern owned by a team'
      );
    }
    assert(before.approved === false, 'the team rule read approved before any approval');

    if (!fixture.approver) throw new Inconclusive('no second identity to approve with');
    await fixture.approver.approvePullRequest(projectPath, pr.iid);
    await fixture.approver.submitReview(projectPath, pr.iid, {
      outcome: 'comment',
      summary: 'conformance: comment-only review after approving',
      comments: [],
      replies: []
    });
    const after = await pollUntil(
      `approved team rule on #${pr.iid}`,
      async () => {
        const rule = await teamRule();
        return rule?.approved ? rule : null;
      },
      { timeoutMs: 60_000, intervalMs: 3_000 }
    ).catch(err => {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`the team rule never read approved; the approver must be a member of the owning team (${cause})`);
    });
    assert(after.approved === true, 'the team rule did not read approved after approve then comment');
  });
}
