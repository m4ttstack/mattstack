/**
 * The type-level assertions only compile when `hc` infers each body from the
 * route table; the root `bun run typecheck` is what checks them.
 */
import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import {
  contractApp,
  createDaemonClient,
  type FailureEnvelopeSchema,
  type MalformedPathSchema,
  type UnauthorizedSchema,
  runsGetRoute,
  runsListRoute,
  sdmReconnectRoute,
} from "../src/daemon-api/index.ts";

const c = createDaemonClient("http://127.0.0.1:1");

type Failure = z.infer<typeof FailureEnvelopeSchema>;

// Mutual assignability, not exact equality: hc wraps bodies in JSONParsed.
type Runs = Awaited<ReturnType<Awaited<ReturnType<typeof c.api.runs.$get>>["json"]>>;
type ExpectedRuns = z.infer<(typeof runsListRoute)["success"]>;
// @ts-expect-error a 200 may carry a refusal, so the body is not a runs body until narrowed on `ok`
const _runsUnnarrowed: ExpectedRuns = null as unknown as Runs;
function narrowRuns(body: Runs): void {
  if (body.ok) {
    const _a: ExpectedRuns = body;
    const _b: typeof body = null as unknown as ExpectedRuns;
    // Fails to compile if inference collapsed to `any`.
    // @ts-expect-error a narrowed runs body is not a failure body
    const _notAny: { ok: false } = body;
  } else {
    const _failure: Failure = body;
  }
}

type Run = Awaited<ReturnType<Awaited<ReturnType<(typeof c.api.runs)[":repo"][":runId"]["$get"]>>["json"]>>;
type ExpectedRun = z.infer<(typeof runsGetRoute)["success"]>;
function narrowRun(body: Run): void {
  if (body.ok) {
    const _a: ExpectedRun = body;
    const _b: typeof body = null as unknown as ExpectedRun;
    // @ts-expect-error a narrowed run body is not a failure body
    const _notAny: { ok: false } = body;
  }
}

// sdm:reconnect's success already models its refusals, so the whole body is compared.
type Reconnect = Awaited<ReturnType<Awaited<ReturnType<typeof c.api.sdm.reconnect.$post>>["json"]>>;
type ExpectedReconnect = z.infer<(typeof sdmReconnectRoute)["success"]> | Failure;
const _reconnectA: ExpectedReconnect = null as unknown as Reconnect;
const _reconnectB: Reconnect = null as unknown as ExpectedReconnect;
// @ts-expect-error a reconnect body is not always connected
const _reconnectNotAny: { ok: true; address: string } = null as unknown as Reconnect;

// The shared non-200s are typed per status, by the same rule the document uses.
type DrainRes = Awaited<ReturnType<typeof c.api.notifications.$get>>;
type Drain401 = Awaited<ReturnType<Extract<DrainRes, { status: 401 }>["json"]>>;
type Unauthorized = z.infer<typeof UnauthorizedSchema>;
const _drain401A: Unauthorized = null as unknown as Drain401;
const _drain401B: Drain401 = null as unknown as Unauthorized;
// @ts-expect-error a 401 body is never a success body
const _drain401NotAny: { ok: true } = null as unknown as Drain401;
type RunsRes = Awaited<ReturnType<typeof c.api.runs.$get>>;
const _runsNo401: [Extract<RunsRes, { status: 401 }>] extends [never] ? true : false = true;
type RunRes = Awaited<ReturnType<(typeof c.api.runs)[":repo"][":runId"]["$get"]>>;
type Run400 = Awaited<ReturnType<Extract<RunRes, { status: 400 }>["json"]>>;
const _run400: z.infer<typeof MalformedPathSchema> = null as unknown as Run400;

void narrowRuns;
void narrowRun;

describe("createDaemonClient", () => {
  test("builds request urls from the route table", () => {
    expect(c.api.runs.$url().href).toBe("http://127.0.0.1:1/api/runs");
    expect(c.api.runs[":repo"][":runId"].$url({ param: { repo: "r", runId: "1" } }).href).toBe(
      "http://127.0.0.1:1/api/runs/r/1",
    );
  });

  test("each route declares the 200 plus the document's shared responses", () => {
    const doc = contractApp().getOpenAPI31Document({ openapi: "3.1.0", info: { title: "t", version: "0" } });
    const statuses = (path: string, method: string) =>
      Object.keys((doc.paths?.[path] as Record<string, { responses: object }>)[method]!.responses).sort();
    expect(statuses("/api/notifications", "get")).toEqual(["200", "401", "405", "500"]);
    expect(statuses("/api/runs/{repo}/{runId}", "get")).toEqual(["200", "400", "404", "500"]);
    expect(statuses("/api/events/emit", "post")).toEqual(["200", "401", "405", "413", "500"]);
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
