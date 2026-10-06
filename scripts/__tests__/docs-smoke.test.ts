import { expect, test } from "bun:test";
import {
  SMOKE_CHECKS,
  SMOKE_RETRY_DELAY_MS,
  type SmokeCheck,
  type SmokeFetch,
  evaluate,
  probe,
  runSmoke,
} from "../lib/docs-smoke.ts";

test("checks the docs home, an rt page, a gitq page and an rt.cool redirect", () => {
  expect(SMOKE_CHECKS.map((c) => c.url)).toEqual([
    "https://docs.mattstack.dev/",
    "https://docs.mattstack.dev/rt/reference/cd/",
    "https://docs.mattstack.dev/gitq/",
    "https://rt.cool/reference/cd",
  ]);
  expect(SMOKE_CHECKS.map((c) => c.status)).toEqual([200, 200, 200, 301]);
  expect(SMOKE_CHECKS[3]?.location).toBe("https://docs.mattstack.dev/rt/reference/cd");
});

test("a page passes on 200", () => {
  expect(evaluate({ url: "u", status: 200 }, { status: 200, location: null })).toBeNull();
  expect(evaluate({ url: "u", status: 200 }, { status: 404, location: null })).toBe("u: expected 200, got 404");
});

test("a redirect must name the right location, not only the right status", () => {
  const c = { url: "r", status: 301, location: "https://docs.mattstack.dev/rt/reference/cd" };
  expect(evaluate(c, { status: 301, location: "https://docs.mattstack.dev/rt/reference/cd" })).toBeNull();
  expect(evaluate(c, { status: 301, location: "https://docs.mattstack.dev/" })).toBe(
    "r: redirects to https://docs.mattstack.dev/, expected https://docs.mattstack.dev/rt/reference/cd",
  );
});

const page: SmokeCheck = { url: "https://example.test/", status: 200 };

test("a fetch that throws becomes one fetch failed line", async () => {
  const fetchFn: SmokeFetch = async () => {
    throw new Error("getaddrinfo ENOTFOUND example.test");
  };
  expect(await probe(page, fetchFn)).toBe("https://example.test/: fetch failed (getaddrinfo ENOTFOUND example.test)");
});

test("each request asks for no redirects and carries a timeout signal", async () => {
  const seen: RequestInit[] = [];
  const fetchFn: SmokeFetch = async (_url, init) => {
    seen.push(init);
    return new Response(null, { status: 200 });
  };
  expect(await probe(page, fetchFn)).toBeNull();
  expect(seen[0]?.redirect).toBe("manual");
  expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
});

test("a failing check is retried once after the grace delay and passes", async () => {
  const calls: string[] = [];
  const slept: number[] = [];
  let n = 0;
  const fetchFn: SmokeFetch = async (url) => {
    calls.push(url);
    n += 1;
    return new Response(null, { status: n === 1 ? 404 : 200 });
  };
  const failures = await runSmoke([page], { fetch: fetchFn, sleep: async (ms) => void slept.push(ms) });
  expect(failures).toEqual([]);
  expect(calls).toEqual([page.url, page.url]);
  expect(slept).toEqual([SMOKE_RETRY_DELAY_MS]);
});

test("a check still failing after its retry is reported once; passing checks are not retried", async () => {
  const calls: string[] = [];
  const bad: SmokeCheck = { url: "https://example.test/bad/", status: 200 };
  const fetchFn: SmokeFetch = async (url) => {
    calls.push(url);
    return new Response(null, { status: url === bad.url ? 500 : 200 });
  };
  const failures = await runSmoke([page, bad], { fetch: fetchFn, sleep: async () => {} });
  expect(failures).toEqual(["https://example.test/bad/: expected 200, got 500"]);
  expect(calls).toEqual([page.url, bad.url, bad.url]);
});

test("all checks passing skips the grace delay", async () => {
  const slept: number[] = [];
  const fetchFn: SmokeFetch = async () => new Response(null, { status: 200 });
  expect(await runSmoke([page], { fetch: fetchFn, sleep: async (ms) => void slept.push(ms) })).toEqual([]);
  expect(slept).toEqual([]);
});
