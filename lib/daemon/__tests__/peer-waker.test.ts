import { describe, expect, test } from "bun:test";
import { acceptedRelayUrl, nextBackoffMs, PEER_INBOX_EVENT, startPeerWaker, type PeerWakerDeps } from "../peer-waker.ts";

type Reply = { status: number; body?: unknown } | "network" | "hang";

function harness(replies: Reply[], over: Partial<PeerWakerDeps> = {}) {
  const emitted: Array<{ type: string; data: unknown }> = [];
  const urls: string[] = [];
  const auths: string[] = [];
  const sleeps: number[] = [];
  const warns: unknown[] = [];
  let next = 0;
  let handle: ReturnType<typeof startPeerWaker> | undefined;
  const stop = () => handle?.stop();
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
    auths.push(String((init?.headers as Record<string, string> | undefined)?.authorization));
    const r = replies[next++];
    if (r === undefined) {
      stop();
      throw new Error("stopped");
    }
    if (r === "network") throw new TypeError("fetch failed");
    if (r === "hang") {
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true }),
      );
    }
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  }) as typeof fetch;
  handle = startPeerWaker({
    log: { debug() {}, info() {}, warn: (ctx: unknown) => void warns.push(ctx) } as unknown as PeerWakerDeps["log"],
    emit: (type, data) => void emitted.push({ type, data }),
    readUrl: () => "https://relay.example",
    readToken: async () => "tok",
    fetch: fetchFn,
    sleep: async (ms) => {
      sleeps.push(ms);
      if (sleeps.length > 50) stop();
    },
    ...over,
  });
  return { done: handle.done, emitted, urls, auths, sleeps, warns };
}

const ok = (woke: boolean, cursor: number) => ({ status: 200, body: { woke, cursor } });

describe("peer waker", () => {
  test("broadcasts peer-inbox on a wake and carries the cursor forward", async () => {
    const h = harness([ok(true, 1500), ok(false, 1500)]);
    await h.done;
    expect(h.emitted).toEqual([{ type: PEER_INBOX_EVENT, data: { cursor: 1500 } }]);
    expect(h.urls[0]).toBe("https://relay.example/inbox/wait?since=0&timeout=25");
    expect(h.urls[1]).toBe("https://relay.example/inbox/wait?since=1500&timeout=25");
  });

  test("a subscriber that throws on one wake does not stop the next", async () => {
    const cursors: unknown[] = [];
    const h = harness([ok(true, 1), ok(true, 2)], {
      emit: (_type, data) => {
        cursors.push(data);
        if (cursors.length === 1) throw new Error("subscriber blew up");
      },
    });
    await h.done;
    expect(cursors).toEqual([{ cursor: 1 }, { cursor: 2 }]);
    expect(h.warns).toHaveLength(1);
  });

  test("a timed-out wait loops straight back without sleeping", async () => {
    const h = harness([ok(false, 0), ok(false, 0)]);
    await h.done;
    expect(h.sleeps).toEqual([]);
    expect(h.emitted).toEqual([]);
  });

  test("backs off on failures and resets after a good reply", async () => {
    const h = harness(["network", "network", { status: 503 }, ok(false, 0), "network"]);
    await h.done;
    expect(h.sleeps).toEqual([1000, 2000, 4000, 1000]);
    expect(h.warns).toHaveLength(3);
  });

  test("a half-open connection is cut by the request timeout", async () => {
    const h = harness(["hang", ok(true, 7)], { requestTimeoutMs: 20 });
    await h.done;
    expect(h.emitted).toEqual([{ type: PEER_INBOX_EVENT, data: { cursor: 7 } }]);
    expect(h.sleeps).toEqual([1000]);
  });

  test("a 401 re-reads the token", async () => {
    let reads = 0;
    const h = harness([{ status: 401 }, ok(true, 5)], { readToken: async () => `tok${++reads}` });
    await h.done;
    expect(reads).toBe(2);
    expect(h.auths.slice(0, 2)).toEqual(["Bearer tok1", "Bearer tok2"]);
    expect(h.emitted).toHaveLength(1);
  });

  test("the token is read once while it keeps working", async () => {
    let reads = 0;
    const h = harness([ok(false, 0), ok(false, 0), ok(false, 0)], { readToken: async () => (reads++, "tok") });
    await h.done;
    expect(reads).toBe(1);
  });

  test("stays idle while unpeered and starts once a token appears", async () => {
    let reads = 0;
    const h = harness([ok(true, 9)], {
      readToken: async () => (++reads === 1 ? null : "tok"),
      unconfiguredRecheckMs: 300_000,
    });
    await h.done;
    expect(h.sleeps[0]).toBe(300_000);
    expect(h.emitted).toEqual([{ type: PEER_INBOX_EVENT, data: { cursor: 9 } }]);
  });

  test("never fetches a plain-http relay that is not this machine", async () => {
    const h = harness([], { readUrl: () => "http://relay.example" });
    await h.done;
    expect(h.urls).toEqual([]);
  });

  test("a readUrl that throws counts as unpeered", async () => {
    const h = harness([], {
      readUrl: () => {
        throw new Error("store unreadable");
      },
    });
    await h.done;
    expect(h.urls).toEqual([]);
  });

  test("stop ends the loop", async () => {
    const h = startPeerWaker({
      log: { debug() {}, info() {}, warn() {} } as unknown as PeerWakerDeps["log"],
      emit: () => {},
      readUrl: () => null,
      readToken: async () => null,
    });
    h.stop();
    await h.done;
  });
});

describe("helpers", () => {
  test("nextBackoffMs doubles from 1s and caps at 60s", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(nextBackoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  });

  test("acceptedRelayUrl takes https anywhere and http only on this machine", () => {
    expect(acceptedRelayUrl("https://relay.example/")).toBe("https://relay.example");
    expect(acceptedRelayUrl("http://127.0.0.1:7940")).toBe("http://127.0.0.1:7940");
    expect(acceptedRelayUrl("http://localhost:7940")).toBe("http://localhost:7940");
    expect(acceptedRelayUrl("http://relay.example")).toBeNull();
    expect(acceptedRelayUrl("not a url")).toBeNull();
    expect(acceptedRelayUrl(undefined)).toBeNull();
  });
});
