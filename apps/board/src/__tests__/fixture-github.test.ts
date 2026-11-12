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
