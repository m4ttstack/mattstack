import { describe, expect, test } from "bun:test";
import type { SupportDraft } from "../../../packages/rt-client/src/support.ts";
import { createSupportRelay } from "../relay.ts";

type Reply = { status: number; body?: unknown; text?: string } | "network";

function harness(...replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const r = replies.shift();
    if (r === undefined || r === "network") throw new TypeError("fetch failed");
    return new Response(r.text ?? JSON.stringify(r.body ?? {}), { status: r.status });
  }) as typeof fetch;
  return { calls, relay: createSupportRelay({ url: "https://relay.example", token: "tok", machine: "mac 1", fetch: fetchFn }) };
}

const draft: SupportDraft = { id: "r1", to: "alex", kind: "request", sentAt: 1, body: "{}", mac: "ab" };
const message = { ...draft, from: "ada", receivedAt: 5 };

describe("the support relay client", () => {
  test("every call carries the board token and never follows a redirect with it", async () => {
    const { relay, calls } = harness(
      { status: 201 },
      { status: 200, body: { messages: [] } },
      { status: 200, body: { woke: false, cursor: 0 } },
      { status: 200, body: { ok: true } },
      { status: 200 },
      { status: 200, body: { accepting: true, lastSeenAt: 1 } },
    );
    await relay.send(draft);
    await relay.list("request");
    await relay.wait("status", 7, new AbortController().signal);
    await relay.ack([{ from: "ada", id: "r1" }]);
    await relay.setHost(true);
    await relay.host("Al/ex");
    expect(calls.map((c) => `${c.init.method ?? "GET"} ${c.url}`)).toEqual([
      "POST https://relay.example/support/messages",
      "GET https://relay.example/support/messages?kind=request&machine=mac%201",
      "GET https://relay.example/support/wait?kind=status&since=7&timeout=25",
      "POST https://relay.example/support/ack",
      "PUT https://relay.example/support/host",
      "GET https://relay.example/support/host/Al%2Fex",
    ]);
    for (const c of calls) {
      expect((c.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
      expect(c.init.redirect).toBe("manual");
      expect(c.init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(draft);
    expect(JSON.parse(String(calls[4]!.init.body))).toEqual({ accepting: true, machine: "mac 1" });
  });

  test("a send says what became of it", async () => {
    const cases: [Reply, string][] = [
      [{ status: 201 }, "ok"],
      [{ status: 422 }, "unknown-recipient"],
      [{ status: 429 }, "full"],
      [{ status: 409 }, "changed"],
      [{ status: 401 }, "unauthorized"],
      [{ status: 400 }, "rejected"],
      [{ status: 413 }, "rejected"],
      [{ status: 404 }, "unreachable"],
      [{ status: 500 }, "unreachable"],
      [{ status: 302 }, "unreachable"],
      ["network", "unreachable"],
    ];
    for (const [reply, want] of cases) expect(await harness(reply).relay.send(draft)).toBe(want as never);
  });

  test("a list drops what is not a message, and is null when the relay did not answer", async () => {
    expect(await harness({ status: 200, body: { messages: [message, { id: 4 }, null] } }).relay.list("status")).toEqual([message]);
    for (const r of [{ status: 409 }, { status: 401 }, { status: 200, text: "nope" }, { status: 200, body: {} }, "network"] as Reply[])
      expect(await harness(r).relay.list("request")).toBeNull();
  });

  test("a wait that fails or answers nonsense is null", async () => {
    const signal = new AbortController().signal;
    expect(await harness({ status: 200, body: { woke: true, cursor: 9 } }).relay.wait("request", 0, signal)).toEqual({ woke: true, cursor: 9 });
    for (const r of [{ status: 409 }, { status: 200, body: { woke: "yes", cursor: 9 } }, "network"] as Reply[])
      expect(await harness(r).relay.wait("request", 0, signal)).toBeNull();
  });

  test("setHost tells another machine apart from a failure", async () => {
    expect(await harness({ status: 200 }).relay.setHost(true)).toBe("ok");
    expect(await harness({ status: 409 }).relay.setHost(true)).toBe("other-machine");
    expect(await harness({ status: 500 }).relay.setHost(true)).toBe("failed");
    expect(await harness("network").relay.setHost(true)).toBe("failed");
  });

  test("a host state that is not one is null", async () => {
    expect(await harness({ status: 200, body: { accepting: false, lastSeenAt: null } }).relay.host("alex")).toEqual({ accepting: false, lastSeenAt: null });
    for (const body of [{}, { accepting: "yes", lastSeenAt: 1 }, { accepting: true, lastSeenAt: "1" }])
      expect(await harness({ status: 200, body }).relay.host("alex")).toBeNull();
    expect(await harness("network").relay.host("alex")).toBeNull();
  });
});
