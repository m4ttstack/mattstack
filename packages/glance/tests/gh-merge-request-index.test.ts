#!/usr/bin/env bun
/**
 * GitHub fetchMergeRequestIndex: the REST pulls listing mapped straight to
 * index rows, walked newest-updated first until the window closes.
 */
import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { jsonResponse, stubForge, useForgeStub, useInstantTimers } from './helpers/gh-fill-fixture.ts';

useForgeStub();
useInstantTimers();

const provider = () => new GitHubProvider('https://github.com', 'tok');
const UA = '2026-01-01T00:00:00Z';

interface Row {
  number: number;
  title: string;
  state: string;
  merged_at: string | null;
  created_at: string;
  updated_at: string;
  user: { login: string } | null;
  head: { ref: string };
  base: { ref: string };
  labels: Array<{ name: string }>;
}

function row(over: Partial<Row> = {}): Row {
  return {
    number: 5,
    title: 'Add thing',
    state: 'closed',
    merged_at: '2026-02-02T00:00:00Z',
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-02T00:00:00Z',
    user: { login: 'Bob' },
    head: { ref: 'feat' },
    base: { ref: 'main' },
    labels: [{ name: 'x' }],
    ...over
  };
}

/** `count` rows numbered from `first`, updated a minute apart going back from `from`. */
function rows(first: number, count: number, from = Date.parse('2026-06-01T00:00:00Z')): Row[] {
  return Array.from({ length: count }, (_, i) =>
    row({ number: first + i, updated_at: new Date(from - i * 60_000).toISOString() })
  );
}

const pageOf = (url: string) => Number(new URL(url).searchParams.get('page'));

function servePages(pages: Record<number, Row[]>): { urls: string[] } {
  return stubForge({
    rest: url => (url.includes('/pulls?') ? jsonResponse(pages[pageOf(url)] ?? []) : undefined)
  });
}

describe('GitHubProvider.fetchMergeRequestIndex', () => {
  test('capability flag is on', () => {
    expect(provider().capabilities.canFetchMergeRequestIndex).toBe(true);
  });

  test('merged and closed ask for the closed listing, newest updated first', async () => {
    const { urls } = servePages({ 1: [row()] });
    await provider().fetchMergeRequestIndex({
      projectPaths: ['o/r'],
      updatedAfter: UA,
      states: ['merged', 'closed']
    });
    expect(urls).toHaveLength(1);
    const q = new URL(urls[0]!);
    expect(q.pathname).toBe('/repos/o/r/pulls');
    expect(q.search).toBe('?state=closed&sort=updated&direction=desc&per_page=100&page=1');
  });

  test('opened alone asks for open; absent or mixed states ask for all', async () => {
    const stateOf = async (states?: Array<'opened' | 'merged' | 'closed'>) => {
      const { urls } = servePages({ 1: [] });
      await provider().fetchMergeRequestIndex({ projectPaths: ['o/r'], updatedAfter: UA, states });
      return new URL(urls[0]!).searchParams.get('state');
    };
    expect(await stateOf(['opened'])).toBe('open');
    expect(await stateOf()).toBe('all');
    expect(await stateOf([])).toBe('all');
    expect(await stateOf(['opened', 'merged'])).toBe('all');
  });

  test('maps a merged row', async () => {
    servePages({ 1: [row()] });
    const out = await provider().fetchMergeRequestIndex({ projectPaths: ['o/r'], updatedAfter: UA });
    expect(out).toEqual([
      {
        iid: 5,
        projectPath: 'o/r',
        title: 'Add thing',
        state: 'merged',
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-02T00:00:00Z',
        mergedAt: '2026-02-02T00:00:00Z',
        authorUsername: 'Bob',
        sourceBranch: 'feat',
        labels: ['x']
      }
    ]);
  });

  test('closed without merged_at is closed, open is opened, a deleted user is null', async () => {
    servePages({
      1: [
        row({ number: 1, merged_at: null }),
        row({ number: 2, state: 'open', merged_at: null }),
        row({ number: 3, user: null })
      ]
    });
    const out = await provider().fetchMergeRequestIndex({ projectPaths: ['o/r'], updatedAfter: UA });
    expect(out.map(r => [r.iid, r.state, r.mergedAt, r.authorUsername])).toEqual([
      [1, 'closed', null, 'Bob'],
      [2, 'opened', null, 'Bob'],
      [3, 'merged', '2026-02-02T00:00:00Z', null]
    ]);
  });

  test('states: merged sends the closed listing and drops rows that never merged', async () => {
    const { urls } = servePages({
      1: [row({ number: 1 }), row({ number: 2, merged_at: null }), row({ number: 3, state: 'open', merged_at: null })]
    });
    const out = await provider().fetchMergeRequestIndex({
      projectPaths: ['o/r'],
      updatedAfter: UA,
      states: ['merged']
    });
    expect(new URL(urls[0]!).searchParams.get('state')).toBe('closed');
    expect(out.map(r => r.iid)).toEqual([1]);
  });

  test('stops inside a page at the cutoff and reports each page', async () => {
    const cutoff = Date.parse('2026-03-01T00:00:00Z');
    const page2 = rows(101, 100, cutoff + 39 * 60_000);
    // Row 40 is exactly at the cutoff and kept; row 41 onward is older.
    expect(page2[39]!.updated_at).toBe('2026-03-01T00:00:00.000Z');
    const { urls } = servePages({ 1: rows(1, 100, cutoff + 10_000_000), 2: page2, 3: rows(201, 100) });
    const seen: number[] = [];
    const out = await provider().fetchMergeRequestIndex({
      projectPaths: ['o/r'],
      updatedAfter: '2026-03-01T00:00:00Z',
      onPage: n => seen.push(n)
    });
    expect(urls).toHaveLength(2);
    expect(out).toHaveLength(140);
    expect(out.at(-1)!.iid).toBe(140);
    expect(seen).toEqual([100, 140]);
  });

  test('a short page ends the walk', async () => {
    const { urls } = servePages({ 1: rows(1, 99) });
    const out = await provider().fetchMergeRequestIndex({ projectPaths: ['o/r'], updatedAfter: UA });
    expect(urls).toHaveLength(1);
    expect(out).toHaveLength(99);
  });

  test('walks each project path in turn and names it on its rows', async () => {
    stubForge({
      rest: url => (url.includes('/pulls?') ? jsonResponse(url.includes('/o/a/') ? [row({ number: 1 })] : [row({ number: 2 })]) : undefined)
    });
    const out = await provider().fetchMergeRequestIndex({ projectPaths: ['o/a', 'o/b'], updatedAfter: UA });
    expect(out.map(r => [r.projectPath, r.iid])).toEqual([['o/a', 1], ['o/b', 2]]);
  });

  test('excludeTargetBranches drops rows by base ref', async () => {
    servePages({
      1: [row({ number: 1, base: { ref: 'main' } }), row({ number: 2, base: { ref: 'release' } })]
    });
    const out = await provider().fetchMergeRequestIndex({
      projectPaths: ['o/r'],
      updatedAfter: UA,
      excludeTargetBranches: ['main']
    });
    expect(out.map(r => r.iid)).toEqual([2]);
  });

  test('groupPath is GitLab-only', async () => {
    stubForge({});
    await expect(
      provider().fetchMergeRequestIndex({ groupPath: 'g', updatedAfter: UA })
    ).rejects.toThrow(/GitLab-only/);
  });

  test('exactly one of groupPath or projectPaths, and updatedAfter must parse', async () => {
    const { urls } = stubForge({});
    const p = provider();
    await expect(p.fetchMergeRequestIndex({ updatedAfter: UA } as never)).rejects.toThrow(
      'exactly one of groupPath or projectPaths'
    );
    await expect(
      p.fetchMergeRequestIndex({ groupPath: 'g', projectPaths: ['o/r'], updatedAfter: UA })
    ).rejects.toThrow('exactly one of groupPath or projectPaths');
    await expect(
      p.fetchMergeRequestIndex({ projectPaths: ['o/r'], updatedAfter: 'yesterday' })
    ).rejects.toThrow('fetchMergeRequestIndex: updatedAfter must be an ISO-8601 instant');
    await expect(p.fetchMergeRequestIndex({ projectPaths: ['o/r'] } as never)).rejects.toThrow(
      'fetchMergeRequestIndex: updatedAfter must be an ISO-8601 instant'
    );
    expect(urls).toHaveLength(0);
  });

  test('past 100 full in-window pages it throws naming the path, without a 101st request', async () => {
    const urls: string[] = [];
    stubForge({
      rest: url => {
        if (!url.includes('/pulls?')) return undefined;
        urls.push(url);
        return jsonResponse(rows((pageOf(url) - 1) * 100 + 1, 100));
      }
    });
    await expect(
      provider().fetchMergeRequestIndex({ projectPaths: ['o/r'], updatedAfter: UA })
    ).rejects.toThrow(/o\/r/);
    expect(urls).toHaveLength(100);
    expect(pageOf(urls.at(-1)!)).toBe(100);
  });

  test('a pre-aborted signal rejects with its reason and sends nothing', async () => {
    const { urls } = servePages({ 1: [row()] });
    const controller = new AbortController();
    controller.abort(new Error('already stopped'));
    await expect(
      provider().fetchMergeRequestIndex({ projectPaths: ['o/r'], updatedAfter: UA, signal: controller.signal })
    ).rejects.toThrow('already stopped');
    expect(urls).toHaveLength(0);
  });

  test('an abort from onPage ends the walk with that reason before the next page', async () => {
    const { urls } = servePages({ 1: rows(1, 100), 2: rows(101, 100) });
    const controller = new AbortController();
    await expect(
      provider().fetchMergeRequestIndex({
        projectPaths: ['o/r'],
        updatedAfter: UA,
        signal: controller.signal,
        onPage: () => controller.abort(new Error('stop'))
      })
    ).rejects.toThrow('stop');
    expect(urls).toHaveLength(1);
  });

  test('an abort during a request surfaces the signal reason after exactly one request', async () => {
    const controller = new AbortController();
    const { urls } = stubForge({
      rest: () => {
        controller.abort(new Error('cancelled mid-request'));
        return jsonResponse({ message: 'boom' }, 500);
      }
    });
    await expect(
      provider().fetchMergeRequestIndex({ projectPaths: ['o/r'], updatedAfter: UA, signal: controller.signal })
    ).rejects.toThrow('cancelled mid-request');
    expect(urls).toHaveLength(1);
  });

  test('a failed page names the operation and status', async () => {
    stubForge({ rest: () => jsonResponse({ message: 'Not Found' }, 404) });
    await expect(
      provider().fetchMergeRequestIndex({ projectPaths: ['o/r'], updatedAfter: UA })
    ).rejects.toThrow(/fetchMergeRequestIndex failed: 404/);
  });
});
