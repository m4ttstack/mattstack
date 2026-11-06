import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  cachedFlockMenu,
  loadFlockMenu,
  resetFlockMenuCache,
} from '../flock-menu-cache.ts';

const MR = {
  webUrl: 'https://gitlab.example/acme/app/-/merge_requests/7',
  iid: 7,
};
const MENU = {
  installed: true,
  tree: '/trees/app-7',
  resume: null,
  commands: [{ label: 'test', command: 'bun test' }],
};

const realFetch = globalThis.fetch;
let calls = 0;
let answer: () => Response;

beforeEach(() => {
  resetFlockMenuCache();
  calls = 0;
  answer = () => Response.json(MENU);
  globalThis.fetch = (async () => {
    calls++;
    return answer();
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('flock menu cache', () => {
  test('a warmed MR paints from the cache without another read', async () => {
    await loadFlockMenu(MR);
    expect(cachedFlockMenu(MR.webUrl)).toEqual(MENU);
    await loadFlockMenu(MR);
    expect(calls).toBe(1);
  });

  test('reads in flight share one request', async () => {
    await Promise.all([loadFlockMenu(MR), loadFlockMenu(MR, { force: true })]);
    expect(calls).toBe(1);
  });

  test('an opening refreshes a fresh copy', async () => {
    await loadFlockMenu(MR);
    answer = () => Response.json({ ...MENU, tree: null });
    await loadFlockMenu(MR, { force: true });
    expect(calls).toBe(2);
    expect(cachedFlockMenu(MR.webUrl)?.tree).toBeNull();
  });

  test('a failed refresh keeps the last good copy', async () => {
    await loadFlockMenu(MR);
    answer = () => new Response('boom', { status: 502 });
    await loadFlockMenu(MR, { force: true });
    expect(cachedFlockMenu(MR.webUrl)).toEqual(MENU);
  });
});
