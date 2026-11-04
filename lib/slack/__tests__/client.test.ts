import { describe, expect, test } from "bun:test";
import { SlackError, createSlackClient } from "../client.ts";

type Reply = { status?: number; headers?: Record<string, string>; body: unknown };

function fakeFetch(replies: Reply[]) {
  const calls: { url: string; params: URLSearchParams; auth: string | null }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, params: new URLSearchParams(String(init.body)), auth: new Headers(init.headers).get("authorization") });
    const r = replies.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("slack client", () => {
  test("throws SlackError with retryAfterMs on 429", async () => {
    const f = fakeFetch([{ status: 429, headers: { "retry-after": "7" }, body: { ok: false, error: "ratelimited" } }]);
    const err = await createSlackClient("xoxp-TEST", f.impl).post("D0TEST", "hi").catch((e) => e);
    expect(err).toBeInstanceOf(SlackError);
    expect(err.code).toBe("ratelimited");
    expect(err.retryAfterMs).toBe(7000);
    expect(String(err.message)).not.toContain("xoxp-TEST");
  });

  test("a fetch that rejects or times out surfaces as a SlackError", async () => {
    const rejecting = (async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    const e1 = await createSlackClient("t", rejecting).post("D0TEST", "hi").catch((e) => e);
    expect(e1).toBeInstanceOf(SlackError);
    expect(e1.code).toBe("network_error");

    let seen: AbortSignal | undefined;
    const hanging = ((_url: string, init: RequestInit) => {
      seen = init.signal ?? undefined;
      return new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)));
    }) as unknown as typeof fetch;
    const e2 = await createSlackClient("t", hanging, 20).post("D0TEST", "hi").catch((e) => e);
    expect(seen).toBeDefined();
    expect(e2).toBeInstanceOf(SlackError);
    expect(e2.code).toBe("timeout");
  });

  test("throws SlackError carrying Slack's error code", async () => {
    const f = fakeFetch([{ body: { ok: false, error: "missing_scope" } }]);
    const err = await createSlackClient("t", f.impl).openDm("U0TEST").catch((e) => e);
    expect(err.code).toBe("missing_scope");
  });

  test("reads granted scopes from the x-oauth-scopes header", async () => {
    const f = fakeFetch([{ headers: { "x-oauth-scopes": "im:history, chat:write" }, body: { ok: true, user_id: "U0TEST" } }]);
    const r = await createSlackClient("t", f.impl).authTest();
    expect(r).toEqual({ userId: "U0TEST", scopes: ["im:history", "chat:write"] });
    expect(f.calls[0]!.auth).toBe("Bearer t");
  });

  test("history returns messages oldest first across pages", async () => {
    const f = fakeFetch([
      { body: { ok: true, messages: [{ ts: "3.0", text: "c" }, { ts: "2.0", text: "b", reply_count: 2, latest_reply: "2.5" }], response_metadata: { next_cursor: "N1" } } },
      { body: { ok: true, messages: [{ ts: "1.0", text: "a", files: [{ name: "x.png" }] }], response_metadata: { next_cursor: "" } } },
    ]);
    const msgs = await createSlackClient("t", f.impl).history("D0TEST", "0");
    expect(msgs.map((m) => m.text)).toEqual(["a", "b", "c"]);
    expect(msgs[1]).toMatchObject({ replyCount: 2, latestReply: "2.5" });
    expect(msgs[0]!.files).toEqual([{ name: "x.png" }]);
    expect(f.calls[1]!.params.get("cursor")).toBe("N1");
  });

  test("newestTs asks for one message and follows no pages", async () => {
    const f = fakeFetch([{ body: { ok: true, messages: [{ ts: "9.5", text: "z" }], response_metadata: { next_cursor: "N1" } } }]);
    expect(await createSlackClient("t", f.impl).newestTs("D0TEST")).toBe("9.5");
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.params.get("limit")).toBe("1");
    expect(f.calls[0]!.params.get("channel")).toBe("D0TEST");
  });

  test("newestTs is undefined for an empty DM", async () => {
    const f = fakeFetch([{ body: { ok: true, messages: [] } }]);
    expect(await createSlackClient("t", f.impl).newestTs("D0TEST")).toBeUndefined();
  });

  test("post, openDm and listUsers map Slack's shapes", async () => {
    const f = fakeFetch([
      { body: { ok: true, ts: "9.1" } },
      { body: { ok: true, channel: { id: "D0TEST" } } },
      { body: { ok: true, members: [{ id: "U0TEST", name: "alex", real_name: "Alex", deleted: false, is_bot: false, profile: { display_name: "alex" } }] } },
    ]);
    const c = createSlackClient("t", f.impl);
    expect(await c.post("D0TEST", "hi")).toEqual({ ts: "9.1" });
    expect(await c.openDm("U0TEST")).toBe("D0TEST");
    expect(await c.listUsers()).toEqual([{ id: "U0TEST", name: "alex", displayName: "alex", realName: "Alex", deleted: false, isBot: false }]);
  });
});
