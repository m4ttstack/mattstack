#!/usr/bin/env bun
/**
 * Live probe for the GraphQL complexity score gitlab.com gives every
 * document GitLabProvider can send.
 *
 * An instrument, not a test: GitLab refuses a document scored over its cap
 * before running it, and nothing offline can compute the score. This asks
 * GitLab for it and records the answer in tests/gitlab-complexity-budget.json,
 * which the offline budget test holds the documents to.
 *
 * Run from packages/glance:
 *   bun run complexity:gitlab            # compare the scores to the budget file
 *   bun run complexity:gitlab --write    # record them in the budget file
 *   bun run complexity:gitlab --credentials <path to harness_credentials.json>
 *
 * Read-only: GitLab scores a document before running it, so nothing in the
 * fixture project is touched. Two variables move the score and are sent at
 * the worst case production sends: `first` (a page size passed as a
 * variable) at the provider's default of 100, and `iids` non-empty (an
 * empty list scores GlanceMRApprovalRulesByIid at 29 instead of 85).
 *
 * Exits 1 when any document is over the cap (and refuses to write then), or,
 * without --write, when gitlab.com now scores an unchanged document
 * differently from the budget file.
 */
import { fileURLToPath } from 'node:url';
import { GITLAB_GRAPHQL_DOCUMENTS } from '../../../src/GitLabProvider.ts';
import { gitlabRepo, loadCredentials, ownerUser } from '../credentials.ts';
import {
  documentDigest,
  PROBE_ONLY_DOCUMENT,
  readProbedScore,
  withComplexityProbe,
  type ComplexityBudget,
} from './gitlabComplexity.ts';

const BUDGET_PATH = fileURLToPath(new URL('../../gitlab-complexity-budget.json', import.meta.url));
const GITLAB_GRAPHQL_URL = 'https://gitlab.com/api/graphql';

function flagValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main(): Promise<number> {
  const creds = await loadCredentials(flagValue('--credentials'));
  if (!creds) {
    console.error('harness_credentials.json not found; pass --credentials <path>');
    return 1;
  }
  const token = ownerUser(creds).token;
  const projectPath = gitlabRepo(creds).path_with_namespace;
  if (!projectPath) {
    console.error('harness_credentials.json: the gitlab repo has no path_with_namespace');
    return 1;
  }

  const variables = {
    projectPath,
    fullPath: projectPath,
    iid: '1',
    iids: ['1'],
    author: ownerUser(creds).username,
    state: 'opened',
    ua: '2026-01-01T00:00:00Z',
    after: 'probe',
    first: 100,
    paths: ['CODEOWNERS'],
    branches: ['main'],
    notTarget: ['probe'],
  };

  const probe = async (document: string): Promise<{ score: number; limit: number | null }> => {
    const res = await fetch(GITLAB_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: document, variables }),
    });
    if (!res.ok) throw new Error(`GitLab answered ${res.status} ${res.statusText}`);
    return readProbedScore((await res.json()) as Parameters<typeof readProbedScore>[0]);
  };

  const probeOnly = await probe(PROBE_ONLY_DOCUMENT);
  if (probeOnly.limit === null) throw new Error('GitLab did not report its complexity limit');
  const limit = probeOnly.limit;

  const budget: ComplexityBudget = { limit, documents: {} };
  const over: string[] = [];
  for (const [label, document] of Object.entries(GITLAB_GRAPHQL_DOCUMENTS)) {
    const score = (await probe(withComplexityProbe(document))).score - probeOnly.score;
    budget.documents[label] = { digest: documentDigest(document), score };
    if (score > limit) over.push(label);
    console.log(`${String(score).padStart(4)}  ${score > limit ? 'OVER' : '    '}  ${label}`);
  }
  console.log(`cap ${limit} on gitlab.com; ${over.length} over`);

  if (over.length > 0) {
    console.error(`over the cap, nothing written: ${over.join(', ')}`);
    return 1;
  }
  if (process.argv.includes('--write')) {
    await Bun.write(BUDGET_PATH, `${JSON.stringify(budget, null, 2)}\n`);
    console.log(`wrote ${BUDGET_PATH}`);
    return 0;
  }

  const recorded = (await Bun.file(BUDGET_PATH).json()) as ComplexityBudget;
  const drifted = Object.entries(budget.documents)
    .filter(([label, now]) => {
      const before = recorded.documents[label];
      return before?.digest === now.digest && before.score !== now.score;
    })
    .map(([label, now]) => `${label}: ${recorded.documents[label]!.score} recorded, ${now.score} now`);
  if (recorded.limit !== limit) drifted.push(`cap: ${recorded.limit} recorded, ${limit} now`);
  if (drifted.length > 0) {
    console.error(`gitlab.com scores these differently from the budget file:\n  ${drifted.join('\n  ')}`);
    return 1;
  }
  return 0;
}

process.exit(await main());
