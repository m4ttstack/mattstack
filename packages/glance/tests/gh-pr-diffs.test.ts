import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { ForgeHttpError } from '../src/errors.ts';
import { jsonResponse, stubForge, useForgeStub, useInstantTimers } from './helpers/gh-fill-fixture.ts';

useForgeStub();
useInstantTimers();

let providers = 0;
function provider(): GitHubProvider {
  return new GitHubProvider('https://github.com', `tok-pr-diffs-${++providers}`);
}

function file(i: number, over: Record<string, unknown> = {}) {
  return { filename: `src/f${i}.ts`, status: 'modified', patch: `@@ -1 +1 @@\n-a${i}\n+b${i}`, ...over };
}

describe('fetchPullRequestDiffs', () => {
  test('maps a renamed file and a binary file with no patch', async () => {
    stubForge({
      rest: (url) =>
        url.includes('/repos/o/r/pulls/7/files')
          ? jsonResponse([
              file(1, { filename: 'src/new.ts', previous_filename: 'src/old.ts', status: 'renamed' }),
              { filename: 'logo.png', status: 'added' }
            ])
          : undefined
    });
    const out = await provider().fetchPullRequestDiffs!('o/r', 7);
    expect(out.truncated).toBe(false);
    expect(out.diffs).toEqual([
      { newPath: 'src/new.ts', oldPath: 'src/old.ts', diff: '@@ -1 +1 @@\n-a1\n+b1' },
      { newPath: 'logo.png', diff: '', tooLarge: true }
    ]);
    expect('oldPath' in out.diffs[1]!).toBe(false);
    expect('tooLarge' in out.diffs[0]!).toBe(false);
  });

  test('100 rows come back truncated, 99 do not, in one request each', async () => {
    for (const [count, truncated] of [
      [100, true],
      [99, false]
    ] as const) {
      const { urls } = stubForge({
        rest: () => jsonResponse(Array.from({ length: count }, (_, i) => file(i)))
      });
      const out = await provider().fetchPullRequestDiffs!('o/r', 7);
      expect(out.diffs).toHaveLength(count);
      expect(out.truncated).toBe(truncated);
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain('per_page=100');
    }
  });

  test('an aborted signal rejects with the abort', async () => {
    stubForge({ rest: () => jsonResponse([file(1)]) });
    const stub = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      return stub(input, init);
    }) as typeof fetch;
    const controller = new AbortController();
    controller.abort();
    const err = await provider()
      .fetchPullRequestDiffs!('o/r', 7, { signal: controller.signal })
      .catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
  });

  test('a non-2xx goes through the forge read error', async () => {
    stubForge({ rest: () => jsonResponse({ message: 'Not Found' }, 404) });
    const err = await provider().fetchPullRequestDiffs!('o/r', 7).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForgeHttpError);
    expect((err as ForgeHttpError).status).toBe(404);
  });
});
