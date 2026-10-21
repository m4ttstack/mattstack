import { describe, expect, test } from 'bun:test';

import type { ForgeFileDiffData, RtResponse } from '@mattstack/rt-client';
import { fileDiffRoute, type FileDiffRouteDeps } from '../file-diff-route.ts';
import { isLocalRequest } from '../local.ts';

const MR_URL = 'https://gitlab.example.com/acme/radar/-/merge_requests/812';
const REPO = 'remote:gitlab.example.com%2Facme%2Fradar';
const url = (file = 'src/radar.ts', mr = MR_URL) =>
  `http://localhost:11006/review/file-diff?mr=${encodeURIComponent(mr)}&file=${encodeURIComponent(file)}`;

const loopback = { requestIP: () => ({ address: '127.0.0.1' }) };

const diffData = (
  file: Partial<NonNullable<ForgeFileDiffData['file']>> | null
): ForgeFileDiffData => ({
  forge: 'gitlab',
  headSha: 'head812',
  truncated: false,
  file: file && {
    oldPath: 'src/radar.ts',
    newPath: 'src/radar.ts',
    renamed: false,
    newFile: false,
    deletedFile: false,
    binary: false,
    tooLarge: false,
    diff: '@@ -1 +1 @@\n-a\n+b\n',
    webUrl: `${MR_URL}/diffs#abc`,
    ...file,
  },
});

/** The route over a fake daemon that records each forge:file-diff call. */
function route(
  answer: RtResponse<ForgeFileDiffData>,
  over: Partial<FileDiffRouteDeps> = {}
) {
  const calls: unknown[] = [];
  const deps: FileDiffRouteDeps = {
    isLocal: req => isLocalRequest(req, loopback),
    findMr: async u => (u === MR_URL ? { iid: 812, webUrl: MR_URL } : null),
    repoFor: () => REPO,
    readDiff: async payload => {
      calls.push(payload);
      return answer;
    },
    ...over,
  };
  return {
    calls,
    get: (u: string, headers: Record<string, string> = {}) =>
      fileDiffRoute(
        new Request(u, {
          headers: { host: new URL(u).host, ...headers },
        }),
        deps
      ),
  };
}

describe('GET /review/file-diff', () => {
  test("answers the file's diff for a tracked MR", async () => {
    const r = route({ ok: true, data: diffData({}) });
    const res = await r.get(url());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      path: 'src/radar.ts',
      oldPath: 'src/radar.ts',
      patch: '@@ -1 +1 @@\n-a\n+b\n',
      forge: 'gitlab',
      webUrl: `${MR_URL}/diffs#abc`,
      renamed: false,
      binary: false,
      tooLarge: false,
    });
    expect(r.calls).toEqual([
      { repoName: REPO, iid: 812, path: 'src/radar.ts' },
    ]);
  });

  test('a too-large file comes back flagged with an empty patch', async () => {
    const r = route({
      ok: true,
      data: diffData({ tooLarge: true, diff: null }),
    });
    expect(await (await r.get(url())).json()).toMatchObject({
      tooLarge: true,
      patch: '',
      webUrl: `${MR_URL}/diffs#abc`,
    });
  });

  test('refuses a request from the tunnel', async () => {
    const r = route({ ok: true, data: diffData({}) });
    const tunnelled = await r.get(url(), {
      'cf-connecting-ip': '203.0.113.9',
    });
    expect(tunnelled.status).toBe(403);
    const publicHost = await r.get(
      url().replace('localhost:11006', 'board.example.com')
    );
    expect(publicHost.status).toBe(403);
    expect(r.calls).toEqual([]);
  });

  test('refuses a request whose socket peer is not this machine', async () => {
    const r = route(
      { ok: true, data: diffData({}) },
      {
        isLocal: req =>
          isLocalRequest(req, { requestIP: () => ({ address: '10.0.0.4' }) }),
      }
    );
    expect((await r.get(url())).status).toBe(403);
  });

  test('an MR the board does not track is a 404', async () => {
    const r = route({ ok: true, data: diffData({}) });
    const res = await r.get(url('src/radar.ts', `${MR_URL}9`));
    expect(res.status).toBe(404);
    expect(r.calls).toEqual([]);
  });

  test('a file outside the MR diff is a 404', async () => {
    const res = await route({ ok: true, data: diffData(null) }).get(url());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "This file is not in the MR's diff.",
    });
  });

  test('a file the capped listing never reached says the diff was too long', async () => {
    const res = await route({
      ok: true,
      data: { ...diffData(null), truncated: true },
    }).get(url());
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: "This MR's diff is too long to search here.",
    });
  });

  test('a missing token reads as a short error', async () => {
    const res = await route({
      ok: false,
      error: 'Error: missing gitlabToken (run: rt secrets set rt gitlabToken)',
    }).get(url());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: 'No GitLab token is set up for rt.',
    });
  });

  test('a GitLab failure names its status, not its body', async () => {
    const res = await route({
      ok: false,
      error: 'GitLab returned 500 Internal Server Error: {"message":"boom"}',
    }).get(url());
    expect(await res.json()).toEqual({
      error: 'GitLab answered 500 for this diff.',
    });
  });

  test('a stopped daemon says so', async () => {
    const res = await route({
      ok: false,
      error: 'rt daemon unreachable at /tmp/rt.sock: ENOENT',
    }).get(url());
    expect(await res.json()).toEqual({
      error: 'The rt daemon is not running.',
    });
  });

  test('asks for both parameters', async () => {
    const r = route({ ok: true, data: diffData({}) });
    expect(
      (await r.get('http://localhost:11006/review/file-diff?mr=x')).status
    ).toBe(400);
  });

  test('an MR whose repo cannot be named is a 502', async () => {
    const res = await route(
      { ok: true, data: diffData({}) },
      { repoFor: () => null }
    ).get(url());
    expect(res.status).toBe(502);
  });
});
