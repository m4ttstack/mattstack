import { readFileSync } from 'fs';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { parseConfig } from '../config.ts';

const dir = join(import.meta.dir, '..', '..', 'tests', 'fixture-github');
const read = (name: string) => readFileSync(join(dir, name), 'utf8');

type Row = {
  provider: string;
  webUrl: string;
  behindTarget: number | null;
  codeownerSections: unknown[];
};
const rows = () => (JSON.parse(read('data.json')) as { mrs: Row[] }).mrs;

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
    expect(row.codeownerSections).toEqual([]);
  }
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
