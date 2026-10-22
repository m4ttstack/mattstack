import { describe, expect, test } from "bun:test";
import { createInboxHandlers } from "../handlers/inbox.ts";
import type { InboxBinding } from "../../claude-registry.ts";

const binding = (over: Partial<InboxBinding> = {}): InboxBinding => ({
  pid: 1, socketPath: "/tmp/s.sock", status: "idle", ...over,
});

function setup(opts: { binding?: InboxBinding | null; deliver?: "ok" | "fail"; probe?: "reachable" | "unreachable" } = {}) {
  const delivered: Array<{ socketPath: string; content: string }> = [];
  const handlers = createInboxHandlers({
    resolve: () => (opts.binding === undefined ? binding() : opts.binding),
    deliver: async (socketPath, content) => {
      delivered.push({ socketPath, content });
      return opts.deliver === "fail" ? { ok: false, error: "boom" } : { ok: true };
    },
    probe: async () => opts.probe ?? "reachable",
  });
  return { handlers, delivered };
}

const ring = { session: "s1", label: "board", text: "CI failed on your MR" };

describe("inbox:ring", () => {
  test("ring delivers the wrapped frame to the resolved socket", async () => {
    const { handlers, delivered } = setup();
    const res = await handlers["inbox:ring"](ring);
    expect(res).toEqual({ ok: true, data: { delivered: true } });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.socketPath).toBe("/tmp/s.sock");
    expect(delivered[0]!.content).toContain("board");
    expect(delivered[0]!.content).toContain("CI failed on your MR");
  });

  test("ring reports no-session when the session does not resolve", async () => {
    const { handlers, delivered } = setup({ binding: null });
    const res = await handlers["inbox:ring"](ring);
    expect(res).toEqual({ ok: true, data: { delivered: false, reason: "no-session" } });
    expect(delivered).toHaveLength(0);
  });

  test("ring reports failed when delivery fails", async () => {
    const { handlers } = setup({ deliver: "fail" });
    const res = await handlers["inbox:ring"](ring);
    expect(res).toEqual({ ok: true, data: { delivered: false, reason: "failed" } });
  });

  test("ring rejects a payload without session, label or text", async () => {
    const { handlers } = setup();
    for (const bad of [{ ...ring, session: "" }, { ...ring, label: "" }, { ...ring, text: "" }, {}, null]) {
      const res = await handlers["inbox:ring"](bad as never);
      expect(res.ok).toBe(false);
    }
  });
});

describe("inbox:probe", () => {
  test("probe is reachable only for a live binding whose socket accepts", async () => {
    expect(await setup({ binding: null }).handlers["inbox:probe"]({ session: "s1" })).toEqual({ ok: true, data: { reachable: false } });
    expect(await setup({ probe: "unreachable" }).handlers["inbox:probe"]({ session: "s1" })).toEqual({ ok: true, data: { reachable: false } });
    expect(await setup({ probe: "reachable" }).handlers["inbox:probe"]({ session: "s1" })).toEqual({ ok: true, data: { reachable: true } });
  });

  test("probe returns a user-chosen session name", async () => {
    const { handlers } = setup({ binding: binding({ name: "ship-it", nameSource: "user" }) });
    expect(await handlers["inbox:probe"]({ session: "s1" })).toEqual({ ok: true, data: { reachable: true, name: "ship-it" } });
  });

  test("probe omits a derived session name", async () => {
    const { handlers } = setup({ binding: binding({ name: "repo-c6", nameSource: "derived" }) });
    expect(await handlers["inbox:probe"]({ session: "s1" })).toEqual({ ok: true, data: { reachable: true } });
  });

  test("probe rejects a payload without a session", async () => {
    const res = await setup().handlers["inbox:probe"]({} as never);
    expect(res.ok).toBe(false);
  });
});
