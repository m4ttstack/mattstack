/**
 * discussions:diffs (S053 + S086): the outbound GitLab read must carry a
 * bound signal (so a stalled connection doesn't orphan the promise), and a
 * full page (100 rows) must be reported as `truncated` rather than silently
 * dropped.
 */
import { expect, test } from "bun:test";
import { fetchMrDiffs, type ThreadContext, type ThreadProvider } from "../handlers/discussions.ts";

type RestRequest = NonNullable<ThreadProvider["restRequest"]>;

function gitlab(restRequest: RestRequest): ThreadContext {
  return { provider: { baseURL: "https://gitlab.example.com", restRequest } as ThreadProvider, projectPath: "g/repo" };
}

function answering(body: unknown, status = 200): RestRequest {
  return async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

function fakeDiffs(n: number) {
  return Array.from({ length: n }, (_, i) => ({ new_path: `file${i}.ts`, diff: `@@ diff ${i}` }));
}

test("truncated is false when fewer than a full page comes back", async () => {
  const out = await fetchMrDiffs(gitlab(answering(fakeDiffs(3))), 7);
  expect(out.diffs).toHaveLength(3);
  expect(out.truncated).toBe(false);
});

test("truncated is true when exactly a full page (100) comes back", async () => {
  const out = await fetchMrDiffs(gitlab(answering(fakeDiffs(100))), 7);
  expect(out.diffs).toHaveLength(100);
  expect(out.truncated).toBe(true);
});

test("carries old_path, collapsed and too_large through", async () => {
  const raw = [{ new_path: "a.ts", old_path: "b.ts", diff: "", collapsed: true, too_large: false }];
  const out = await fetchMrDiffs(gitlab(answering(raw)), 7);
  expect(out.diffs).toEqual([{ newPath: "a.ts", oldPath: "b.ts", diff: "", collapsed: true, tooLarge: false }]);
});

test("maps new_path/diff to newPath/diff", async () => {
  const out = await fetchMrDiffs(gitlab(answering([{ new_path: "a.ts", diff: "@@" }])), 7);
  expect(out.diffs).toEqual([{ newPath: "a.ts", diff: "@@" }]);
});

test("a non-ok response throws with the status", async () => {
  await expect(fetchMrDiffs(gitlab(answering("", 502)), 7)).rejects.toThrow(/502/);
});

test("the read carries an AbortSignal", async () => {
  let sawSignal: AbortSignal | undefined;
  const restRequest: RestRequest = async (_m, _p, _b, _op, io) => {
    sawSignal = io?.signal;
    return new Response(JSON.stringify([]), { status: 200 });
  };
  await fetchMrDiffs(gitlab(restRequest), 7);
  expect(sawSignal).toBeInstanceOf(AbortSignal);
});

test("aborting the caller's own request signal cancels the in-flight read", async () => {
  const controller = new AbortController();
  let sawSignal: AbortSignal | undefined;
  const restRequest: RestRequest = async (_m, _p, _b, _op, io) => {
    sawSignal = io?.signal;
    return new Promise<Response>((_resolve, reject) => {
      io?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  };
  const promise = fetchMrDiffs(gitlab(restRequest), 7, { reqSignal: controller.signal });
  controller.abort();
  await expect(promise).rejects.toThrow();
  expect(sawSignal?.aborted).toBe(true);
});
