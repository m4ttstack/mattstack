#!/usr/bin/env bun
/**
 * restRequest hands back the fetch body as a stream so a caller can stop
 * reading early, over the real Octokit client with `fetch` stubbed.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { useInstantTimers } from './helpers/gh-fill-fixture.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
useInstantTimers();

const CHUNK = 16 * 1024;
const CHUNKS = 64;

function stubFetch(respond: (url: string) => Response): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    urls.push(url);
    return respond(url);
  }) as typeof fetch;
  return urls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

/** Records the options of every Octokit request while still sending it. */
function recordRequestOptions(provider: GitHubProvider): Array<{ route: string; options: any }> {
  const calls: Array<{ route: string; options: any }> = [];
  const octokit = (provider as any).octokit;
  const real = octokit.request;
  const wrapped = (route: string, options?: any) => {
    calls.push({ route, options });
    return real(route, options);
  };
  Object.assign(wrapped, real);
  octokit.request = wrapped;
  return calls;
}

describe('GitHub restRequest streams its body', () => {
  test('a reader can stop early', async () => {
    let pulls = 0;
    stubFetch(() => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls++;
          if (pulls > CHUNKS) {
            controller.close();
            return;
          }
          controller.enqueue(new Uint8Array(CHUNK).fill(120));
        }
      });
      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(CHUNK * CHUNKS)
        }
      });
    });

    const provider = new GitHubProvider('https://github.com', 'tok');
    const res = await provider.restRequest('GET', '/repos/acme/repo/actions/jobs/1/logs');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(CHUNK * CHUNKS));
    const reader = res.body!.getReader();
    let read = 0;
    while (read < 256 * 1024) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
    }
    await reader.cancel();

    expect(read).toBeGreaterThanOrEqual(256 * 1024);
    expect(pulls).toBeLessThan(CHUNKS);
  });

  test('a JSON body still parses', async () => {
    const served = { id: 7, name: 'repo', nested: { ok: true } };
    stubFetch(() => jsonResponse(served));

    const provider = new GitHubProvider('https://github.com', 'tok');
    const res = await provider.restRequest('GET', '/repos/acme/repo');

    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual(served);
  });

  test('a 404 still resolves with ok false and a readable body', async () => {
    stubFetch(() => jsonResponse({ message: 'Not Found' }, 404));

    const provider = new GitHubProvider('https://github.com', 'tok');
    const res = await provider.restRequest('GET', '/repos/acme/repo/branches/missing');

    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: 'Not Found' });
  });

  test('a 204 and a 304 resolve with a null body', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');

    stubFetch(() => new Response(null, { status: 204 }));
    const noContent = await provider.restRequest('DELETE', '/repos/acme/repo/git/refs/heads/x');
    expect(noContent.status).toBe(204);
    expect(noContent.body).toBeNull();

    stubFetch(() => new Response(null, { status: 304, headers: { etag: '"abc"' } }));
    const notModified = await provider.restRequest('GET', '/repos/acme/repo');
    expect(notModified.status).toBe(304);
    expect(notModified.body).toBeNull();
    expect(notModified.headers.get('etag')).toBe('"abc"');
  });

  test('restRequest asks Octokit for the unparsed body', async () => {
    stubFetch(() => jsonResponse({}));
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = recordRequestOptions(provider);

    await provider.restRequest('GET', '/repos/acme/repo');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.options.request.parseSuccessResponseBody).toBe(false);
  });

  test('other api() callers keep parsed bodies', async () => {
    const urls = stubFetch(url => {
      if (url.endsWith('/repositories/12345')) return jsonResponse({ full_name: 'acme/repo' });
      return jsonResponse([]);
    });
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = recordRequestOptions(provider);

    const detail = await provider.fetchMRDiscussions('github:12345', 3);

    expect(detail).toEqual({ mrIid: 3, repositoryId: 'github:12345', discussions: [] });
    expect(urls.some(u => u.includes('/repos/acme/repo/pulls/3/reviews'))).toBe(true);
    const repoRead = calls.find(c => c.route === 'GET /repositories/12345');
    expect(repoRead).toBeDefined();
    expect(repoRead!.options?.request?.parseSuccessResponseBody).toBeUndefined();
  });
});
