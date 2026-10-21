import { afterEach, expect, test } from 'bun:test';

import { boardDiffSource } from '../board-diff-source.ts';

const realFetch = globalThis.fetch;
let asked: string[] = [];

function answer(status: number, body: unknown) {
  asked = [];
  (globalThis as { fetch: unknown }).fetch = async (url: string) => {
    asked.push(url);
    return Response.json(body, { status });
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const MR = 'https://gitlab.example.com/acme/radar/-/merge_requests/812';

test("asks the board server's file-diff route and returns its diff", async () => {
  const diff = {
    path: 'src/a b.ts',
    patch: '@@ -1 +1 @@\n-a\n+b\n',
    forge: 'gitlab',
  };
  answer(200, diff);
  expect(
    await boardDiffSource.fetchFileDiff({ mr: MR, file: 'src/a b.ts' })
  ).toEqual(diff as never);
  expect(asked).toEqual([
    `/review/file-diff?mr=${encodeURIComponent(MR)}&file=src%2Fa%20b.ts`,
  ]);
});

test('a refusal over the tunnel or a file outside the diff is no diff', async () => {
  answer(403, { error: 'local only' });
  expect(
    await boardDiffSource.fetchFileDiff({ mr: MR, file: 'a.ts' })
  ).toBeNull();
  answer(404, { error: "This file is not in the MR's diff." });
  expect(
    await boardDiffSource.fetchFileDiff({ mr: MR, file: 'a.ts' })
  ).toBeNull();
});

test("a failure rejects with the route's short message", async () => {
  answer(502, { error: 'No GitLab token is set up for rt.' });
  await expect(
    boardDiffSource.fetchFileDiff({ mr: MR, file: 'a.ts' })
  ).rejects.toThrow('No GitLab token is set up for rt.');
});
