import { describe, expect, test } from "bun:test";
import { waitForAnswers, type ProbeDeps } from "../readiness";

function clock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
  };
}

function deps(c: ReturnType<typeof clock>, f: (url: string, init?: RequestInit) => Promise<Response>): ProbeDeps {
  return { fetch: f as unknown as typeof fetch, sleep: c.sleep, now: c.now };
}

describe("waitForAnswers", () => {
  test("the response body is cancelled once the status is read, and a failing cancel is ignored", async () => {
    const c = clock();
    let cancelled = 0;
    const res = (fail: boolean) => ({ status: 200, body: { cancel: () => { cancelled++; return fail ? Promise.reject(new Error("gone")) : Promise.resolve(); } } }) as unknown as Response;
    const r = await waitForAnswers(
      [{ role: "web", url: "http://x/" }, { role: "api", url: "http://y/" }],
      { waitMs: 0 },
      deps(c, async (url) => res(url === "http://y/")),
    );
    expect(cancelled).toBe(2);
    expect(r.outcomes.web!.answered).toBe(true);
    expect(r.outcomes.api!.answered).toBe(true);
  });

  test("any status counts as answered after one round", async () => {
    const c = clock();
    const r = await waitForAnswers(
      [{ role: "web", url: "http://x/" }],
      { waitMs: 6000 },
      deps(c, async () => new Response("", { status: 404 })),
    );
    expect(r.outcomes.web).toEqual({ answered: true, status: 404, answeredAfterMs: 0 });
    expect(c.sleeps).toEqual([]);
  });

  test("rejections until round 3 then 200 reports 4000ms", async () => {
    const c = clock();
    let calls = 0;
    const r = await waitForAnswers(
      [{ role: "web", url: "http://x/" }],
      { waitMs: 10000, intervalMs: 2000 },
      deps(c, async () => {
        calls++;
        if (calls < 3) throw new Error("ECONNREFUSED");
        return new Response("", { status: 200 });
      }),
    );
    expect(r.outcomes.web).toEqual({ answered: true, status: 200, answeredAfterMs: 4000 });
    expect(calls).toBe(3);
  });

  test("one answers, one never does", async () => {
    const c = clock();
    const seen: string[] = [];
    const r = await waitForAnswers(
      [
        { role: "web", url: "http://web/" },
        { role: "api", url: "http://api/" },
      ],
      { waitMs: 6000 },
      deps(c, async (url) => {
        seen.push(url);
        if (url === "http://web/") return new Response("", { status: 200 });
        throw new Error("refused");
      }),
    );
    expect(r.waitedMs).toBeGreaterThanOrEqual(6000);
    expect(r.outcomes.api).toEqual({ answered: false, status: null, answeredAfterMs: null });
    expect(r.outcomes.web!.answered).toBe(true);
    expect(seen.filter((u) => u === "http://web/")).toHaveLength(1);
  });

  test("waitMs 0 probes once without sleeping", async () => {
    const c = clock();
    let calls = 0;
    const r = await waitForAnswers(
      [{ role: "web", url: "http://x/" }],
      { waitMs: 0 },
      deps(c, async () => {
        calls++;
        throw new Error("refused");
      }),
    );
    expect(calls).toBe(1);
    expect(c.sleeps).toEqual([]);
    expect(r.outcomes.web!.answered).toBe(false);
  });

  test("pre-aborted signal stops after one round", async () => {
    const c = clock();
    let calls = 0;
    const ac = new AbortController();
    ac.abort();
    await waitForAnswers(
      [{ role: "web", url: "http://x/" }],
      { waitMs: 60000, signal: ac.signal },
      deps(c, async () => {
        calls++;
        throw new Error("refused");
      }),
    );
    expect(calls).toBeLessThanOrEqual(1);
    expect(c.sleeps).toEqual([]);
  });

  test("progress fires once per round", async () => {
    const c = clock();
    let n = 0;
    await waitForAnswers(
      [{ role: "web", url: "http://x/" }],
      { waitMs: 4000, progress: () => n++ },
      deps(c, async () => {
        throw new Error("refused");
      }),
    );
    expect(n).toBe(3);
  });

  test("fetch gets redirect manual and a signal", async () => {
    const c = clock();
    let init: RequestInit | undefined;
    await waitForAnswers(
      [{ role: "web", url: "http://x/" }],
      { waitMs: 0 },
      deps(c, async (_u, i) => {
        init = i;
        return new Response("");
      }),
    );
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("a hung request is aborted by the request timeout", async () => {
    const c = clock();
    const r = await waitForAnswers(
      [{ role: "web", url: "http://x/" }],
      { waitMs: 0, requestTimeoutMs: 5 },
      deps(
        c,
        (_u, i) =>
          new Promise<Response>((_res, rej) => {
            i?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
          }),
      ),
    );
    expect(r.outcomes.web!.answered).toBe(false);
  });
});
