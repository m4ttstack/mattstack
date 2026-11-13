import { readFileSync } from 'fs';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { rowStatus } from '../client/board/row-status.ts';
import type { BoardMRWithReview } from '../client/types.ts';
import { parseConfig, type TabConfig } from '../config.ts';
import { sectionStatus } from '../sections.ts';

const dir = join(import.meta.dir, '..', '..', 'tests', 'fixture-github');
const read = (name: string) => readFileSync(join(dir, name), 'utf8');

type Row = {
  iid: number;
  provider: string;
  webUrl: string;
  behindTarget: number | null;
  author: { username: string };
  codeownerSections: string[];
  ownerTeams?: Array<{
    person?: string;
    team?: string;
    section?: string;
    approved: boolean;
  }>;
  reviewerLatches?: Array<{
    reviewer: string;
    discussionId: string;
    requested: boolean;
  }>;
  gates?: Array<{ kind: string }>;
};
type Board = {
  mrs: Row[];
  tabs: TabConfig[];
  scopeKnownSections: string[];
  members: Array<{ username: string }>;
  peers: string[];
  teams: Array<{ name: string; members: Array<{ username: string }> }>;
};
const board = () => JSON.parse(read('data.json')) as Board;
const rows = () => board().mrs;

test('the config follows a GitHub forge', () => {
  const config = parseConfig(read('config.json'));
  expect(config.forge).toEqual({ kind: 'github', host: 'https://github.com' });
  expect(config.projects).toEqual(['acme/webapp']);
});

test('every row is a GitHub pull request with the shape buildBoard serves', () => {
  expect(rows().length).toBeGreaterThanOrEqual(5);
  for (const row of rows()) {
    expect(row.provider).toBe('github');
    expect(row.webUrl.startsWith('https://github.com/acme/webapp/pull/')).toBe(
      true
    );
  }
});

const sections = () =>
  board().tabs.flatMap(t =>
    t.source.kind === 'codeowners' ? [t.source.section] : []
  );

test('the config and the served board declare the same tabs', () => {
  const config = parseConfig(read('config.json'));
  expect(config.tabs.map(t => t.source)).toEqual(
    board().tabs.map(t => t.source)
  );
});

test('the tabs hold three CODEOWNERS owners and one that is not there', () => {
  const { scopeKnownSections } = board();
  expect(scopeKnownSections).toEqual(['@acme/api', '@acme/web', '@ellie-dev']);
  const unknown = sections().filter(
    s => sectionStatus(s, scopeKnownSections, 'github').unknown
  );
  expect(unknown).toEqual(['@acme/payments']);
});

test('a row is tagged only with a tab section, spelled as the tab spells it', () => {
  const tagged = rows().filter(row => row.codeownerSections.length > 0);
  expect(tagged.length).toBeGreaterThanOrEqual(3);
  for (const row of tagged)
    for (const tag of row.codeownerSections) expect(sections()).toContain(tag);
  const members = new Set(board().members.map(m => m.username));
  expect(tagged.some(row => !members.has(row.author.username))).toBe(true);
});

test('the seat has a row owned by a person, a claimed team and an unclaimed team', () => {
  const row = rows().find(r => r.iid === 4109)!;
  expect(row.author.username).toBe('mkeller');
  const [person, claimed, unclaimed] = row.ownerTeams!;
  expect(person).toMatchObject({ person: 'ellie-dev', section: '@ellie-dev' });
  expect(claimed).toMatchObject({ team: 'web', section: '@acme/web' });
  expect(unclaimed).toEqual({ section: '@acme/api', approved: false });
  const { peers, teams } = board();
  expect(peers).toContain('ellie-dev');
  expect(teams.map(t => t.name)).toContain('web');
});

test('the seat has a row whose respond sheet offers a re-review pick', () => {
  const row = rows().find(r => r.iid === 4110)!;
  expect(row.author.username).toBe('mkeller');
  expect(row.gates!.map(g => g.kind)).toEqual(['respond-post']);
  expect(row.reviewerLatches).toEqual([
    {
      reviewer: 'lnorth',
      discussionId: 'gh-review-thread-3203',
      requested: false,
    },
  ]);
});

test('a row has no behind count, as a GitHub row serves it', () => {
  expect(rows().some(row => row.behindTarget === null)).toBe(true);
});

test('no fixture file carries a GitLab merge request url', () => {
  for (const name of [
    'config.json',
    'data.json',
    'discussions.json',
    'meta.json',
    'flock-menu.json',
    'review-report.md',
    'respond-report.md',
  ])
    expect(read(name)).not.toContain('/-/merge_requests/');
});

type Pipeline = {
  id: string;
  runIds: string[];
  jobs: { runId: string | null }[];
};

test('every pipeline id is the glance 0.33 stable GitHub id', () => {
  const ids = rows().map(row => ({
    row,
    pipeline: (row as unknown as { pipeline: Pipeline }).pipeline,
  }));
  for (const { row, pipeline } of ids) {
    const runIds = [
      ...new Set(pipeline.jobs.flatMap(j => (j.runId ? [j.runId] : []))),
    ];
    expect([...pipeline.runIds].sort()).toEqual(runIds.sort());
    const lowest = runIds.reduce<string | null>(
      (best, id) => (best === null || Number(id) < Number(best) ? id : best),
      null
    );
    expect(pipeline.id).toBe(
      lowest ? `github:run:${lowest}` : `github:checks:${row.webUrl}`
    );
  }
  expect(
    ids.some(({ pipeline }) => pipeline.id.startsWith('github:run:'))
  ).toBe(true);
  expect(
    ids.some(({ pipeline }) => pipeline.id.startsWith('github:checks:'))
  ).toBe(true);
});

test('every row carries the keys of the plain reference row, with gates an array', () => {
  const all = rows() as unknown as Array<Record<string, unknown>>;
  const reference = Object.keys(all.find(row => row.iid === 4102)!);
  for (const row of all) {
    expect(
      reference.filter(key => !(key in row)),
      `PR ${row.iid} lacks keys`
    ).toEqual([]);
    expect(Array.isArray(row.gates)).toBe(true);
  }
});

test('the client builds a row status for every row without throwing', () => {
  for (const row of rows())
    expect(() =>
      rowStatus(
        row as unknown as BoardMRWithReview,
        1755603600000,
        new Map(),
        'mkeller'
      )
    ).not.toThrow();
});
