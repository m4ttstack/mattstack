/**
 * The type-level assertions only compile when `hc` infers each body from the
 * route table; the root `bun run typecheck` is what checks them.
 */
import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import { createDaemonClient, runsGetRoute, runsListRoute, sdmReconnectRoute } from "../src/daemon-api/index.ts";

const c = createDaemonClient("http://127.0.0.1:1");

// Mutual assignability, not exact equality: hc wraps bodies in JSONParsed.
type Runs = Awaited<ReturnType<Awaited<ReturnType<typeof c.api.runs.$get>>["json"]>>;
type ExpectedRuns = z.infer<(typeof runsListRoute)["success"]>;
const _runsA: ExpectedRuns = null as unknown as Runs;
const _runsB: Runs = null as unknown as ExpectedRuns;
// Fails to compile if inference collapsed to `any`.
// @ts-expect-error a runs body is not a failure body
const _runsNotAny: { ok: false } = null as unknown as Runs;

type Run = Awaited<ReturnType<Awaited<ReturnType<(typeof c.api.runs)[":repo"][":runId"]["$get"]>>["json"]>>;
type ExpectedRun = z.infer<(typeof runsGetRoute)["success"]>;
const _runA: ExpectedRun = null as unknown as Run;
const _runB: Run = null as unknown as ExpectedRun;
// @ts-expect-error a run body is not a failure body
const _runNotAny: { ok: false } = null as unknown as Run;

type Reconnect = Awaited<ReturnType<Awaited<ReturnType<typeof c.api.sdm.reconnect.$post>>["json"]>>;
type ExpectedReconnect = z.infer<(typeof sdmReconnectRoute)["success"]>;
const _reconnectA: ExpectedReconnect = null as unknown as Reconnect;
const _reconnectB: Reconnect = null as unknown as ExpectedReconnect;

describe("createDaemonClient", () => {
  test("builds request urls from the route table", () => {
    expect(c.api.runs.$url().href).toBe("http://127.0.0.1:1/api/runs");
    expect(c.api.runs[":repo"][":runId"].$url({ param: { repo: "r", runId: "1" } }).href).toBe(
      "http://127.0.0.1:1/api/runs/r/1",
    );
  });

  test("sends the token and client headers it is given", async () => {
    const seen: Headers[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        seen.push(req.headers);
        return Response.json({ ok: true, data: { runs: [] } });
      },
    });
    try {
      const client = createDaemonClient(`http://127.0.0.1:${server.port}`, { token: "tok", client: "console" });
      const res = await client.api.runs.$get({ query: {} });
      expect(await res.json()).toEqual({ ok: true, data: { runs: [] } });
      expect(seen[0]?.get("x-rt-token")).toBe("tok");
      expect(seen[0]?.get("x-rt-client")).toBe("console");
    } finally {
      server.stop(true);
    }
  });
});
