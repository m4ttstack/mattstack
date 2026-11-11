import { afterEach, describe, expect, test } from 'bun:test';
import { ForgeHttpError, RateLimitedError } from '../src/errors.ts';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import { jsonResponse, stubForge, useForgeStub, useInstantTimers } from './helpers/gh-fill-fixture.ts';

useForgeStub();
useInstantTimers();

let providers = 0;
const github = () => new GitHubProvider('https://github.com', `tok-label-edits-${++providers}`);

type Call = { method: string; url: URL; body: string | undefined };

describe('GitHub label edits', () => {
  function stub(reply: (call: Call) => Response | undefined): Call[] {
    const calls: Call[] = [];
    stubForge({
      rest: (url, method, body) => {
        const call = { method, url: new URL(url), body };
        calls.push(call);
        return reply(call);
      }
    });
    return calls;
  }

  test('add is one POST with the labels body', async () => {
    const calls = stub(() => jsonResponse([]));
    await github().addPullRequestLabels!('o/r', 7, ['bug', 'docs']);
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual(['POST /repos/o/r/issues/7/labels']);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ labels: ['bug', 'docs'] });
  });

  test('remove is one DELETE per label with the name encoded', async () => {
    const calls = stub(() => jsonResponse([]));
    await github().removePullRequestLabels!('o/r', 7, ['bug', 'needs review/ui']);
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      'DELETE /repos/o/r/issues/7/labels/bug',
      'DELETE /repos/o/r/issues/7/labels/needs%20review%2Fui'
    ]);
  });

  test('a 404 on remove is not an error and the next label is still removed', async () => {
    const calls = stub((c) =>
      c.url.pathname.endsWith('/labels/gone') ? jsonResponse({ message: 'Label does not exist' }, 404) : jsonResponse([])
    );
    await github().removePullRequestLabels!('o/r', 7, ['gone', 'bug']);
    expect(calls).toHaveLength(2);
  });

  test('a 404 Not Found on remove (a missing PR or repository) is a ForgeHttpError', async () => {
    const calls = stub(() => jsonResponse({ message: 'Not Found' }, 404));
    const err = await github().removePullRequestLabels!('o/r', 9999, ['bug', 'docs']).catch((e) => e);
    expect(err).toBeInstanceOf(ForgeHttpError);
    expect((err as ForgeHttpError).status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  test('a non-404 failure on remove is a ForgeHttpError', async () => {
    stub(() => jsonResponse({ message: 'Forbidden' }, 403));
    const err = await github().removePullRequestLabels!('o/r', 7, ['bug']).catch((e) => e);
    expect(err).toBeInstanceOf(ForgeHttpError);
    expect((err as ForgeHttpError).status).toBe(403);
  });

  test('a failed add is a ForgeHttpError', async () => {
    stub(() => jsonResponse({ message: 'Validation Failed' }, 422));
    const err = await github().addPullRequestLabels!('o/r', 7, ['bug']).catch((e) => e);
    expect(err).toBeInstanceOf(ForgeHttpError);
    expect((err as ForgeHttpError).status).toBe(422);
  });

  test('a rate limit is a RateLimitedError', async () => {
    stub(() =>
      jsonResponse({ message: 'API rate limit exceeded' }, 403, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600)
      })
    );
    const err = await github().addPullRequestLabels!('o/r', 7, ['bug']).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
  });

  test('an empty list makes no request', async () => {
    const calls = stub(() => jsonResponse([]));
    await github().addPullRequestLabels!('o/r', 7, []);
    await github().removePullRequestLabels!('o/r', 7, []);
    expect(calls).toHaveLength(0);
  });
});

describe('GitLab label edits', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function stub(status = 200, body: unknown = { iid: 7 }): Call[] {
    const calls: Call[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const req = input instanceof Request ? input : undefined;
      const raw = req ? req.url : input.toString();
      const sent = req ? await req.text() : typeof init?.body === 'string' ? init.body : undefined;
      calls.push({ method: (req?.method ?? init?.method ?? 'GET').toUpperCase(), url: new URL(raw), body: sent });
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
      });
    }) as typeof fetch;
    return calls;
  }
  const gitlab = () => new GitLabProvider('https://gitlab.example.com', 'token');

  test('add is one PUT with add_labels joined by commas', async () => {
    const calls = stub();
    await gitlab().addPullRequestLabels!('g/p', 7, ['bug', 'docs']);
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual(['PUT /api/v4/projects/g%2Fp/merge_requests/7']);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ add_labels: 'bug,docs' });
  });

  test('remove is one PUT with remove_labels joined by commas', async () => {
    const calls = stub();
    await gitlab().removePullRequestLabels!('g/p', 7, ['bug', 'needs review/ui']);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ remove_labels: 'bug,needs review/ui' });
  });

  test('a failed edit is a ForgeHttpError', async () => {
    stub(403, { message: '403 Forbidden' });
    const err = await gitlab().addPullRequestLabels!('g/p', 7, ['bug']).catch((e) => e);
    expect(err).toBeInstanceOf(ForgeHttpError);
    expect((err as ForgeHttpError).status).toBe(403);
  });

  test('an empty list makes no request', async () => {
    const calls = stub();
    await gitlab().addPullRequestLabels!('g/p', 7, []);
    await gitlab().removePullRequestLabels!('g/p', 7, []);
    expect(calls).toHaveLength(0);
  });
});
