import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import type { Server } from "bun";
import { startApiServer, type ApiServerDeps } from "../api-server.ts";
import { getApiToken } from "../api-auth.ts";
import { deriveFailure } from "../failure.ts";
import { bodyLimitFor } from "../request-limits.ts";
import { serializeIdentity } from "../../settings/identity.ts";
import { setSetting, unsetSetting } from "../../settings/write.ts";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

let server: Server<any> | undefined;
let port = 0;
let token = "";
let calls: Array<{ cmd: string; payload: any }> = [];
let reply: (cmd: string, payload: any) => Promise<any> = async () => ({ ok: true, data: "stub" });

const handleCommand: ApiServerDeps["handleCommand"] = async (cmd, payload) => {
  calls.push({ cmd, payload });
  return reply(cmd, payload);
};

beforeAll(async () => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  port = probe.port!;
  probe.stop(true);
  setSetting("rt.apiPort", port, "user");
  server = await startApiServer({ handleCommand, log: noopLog });
  token = getApiToken();
});

afterAll(() => {
  server?.stop(true);
  unsetSetting("rt.apiPort", "user");
});

beforeEach(() => {
  calls = [];
  reply = async () => ({ ok: true, data: "stub" });
});

function hit(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, init);
}

const withToken = (extra: Record<string, string> = {}) => ({ "X-RT-Token": token, ...extra });
const JSON_CONTENT_TYPE = Response.json({}).headers.get("content-type");
const notFoundBody = () => ({ ok: false, error: "not found", docs: `http://localhost:${port}/` });
const headerNames = (res: Response) => [...res.headers.keys()].sort();
const ALWAYS = ["access-control-allow-headers", "access-control-allow-methods", "content-length", "content-type", "date"];

describe("REST wire behaviour", () => {
  test("JSON replies keep today's content-type", async () => {
    const res = await hit("/api/status");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_CONTENT_TYPE);
    expect(headerNames(res)).toEqual(ALWAYS);
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe("Content-Type, X-RT-Token, X-RT-Client");
    expect(await res.json()).toEqual({ ok: true, data: "stub" });

    const trusted = await hit("/api/status", { headers: withToken({ Origin: "http://somewhere.example" }) });
    expect(trusted.headers.get("content-type")).toBe(JSON_CONTENT_TYPE);
    expect(headerNames(trusted)).toEqual([...ALWAYS, "access-control-allow-origin", "vary"].sort());
    expect(trusted.headers.get("access-control-allow-origin")).toBe("http://somewhere.example");
    expect(trusted.headers.get("vary")).toBe("Origin");

    const untrusted = await hit("/api/status", { headers: { Origin: "http://evil.example" } });
    expect(headerNames(untrusted)).toEqual(ALWAYS);
  });

  test("branch with slashes reaches cache:read whole", async () => {
    const res = await hit("/api/cache/feature/x%2Fy");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: "stub" });
    expect(calls).toEqual([{ cmd: "cache:read", payload: { branches: ["feature/x/y"] } }]);
  });

  test("serialized identity survives hooks repair", async () => {
    const identity = serializeIdentity({ kind: "remote", id: "github.com/acme/widgets" });
    const res = await hit(`/api/hooks/${identity}/repair`, { method: "POST", headers: withToken() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: "stub" });
    expect(calls).toEqual([{ cmd: "hooks:repair", payload: { repo: identity } }]);
  });

  test("malformed percent-encoding is a 400", async () => {
    const res = await hit("/api/cache/%E0%A4%A");
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toBe(JSON_CONTENT_TYPE);
    expect(await res.json()).toEqual({ ok: false, error: "malformed path parameter" });
    expect(calls).toEqual([]);
  });

  test("empty path parameters keep today's answers", async () => {
    const emptyBranch = await hit("/api/cache/");
    expect(emptyBranch.status).toBe(400);
    expect(await emptyBranch.json()).toEqual({ ok: false, error: "malformed path parameter" });

    const emptyRepo = await hit("/api/hooks/repair", { method: "POST", headers: withToken() });
    expect(emptyRepo.status).toBe(400);
    expect(await emptyRepo.json()).toEqual({ ok: false, error: "malformed path parameter" });

    const emptyRun = await hit("/api/runs/");
    expect(emptyRun.status).toBe(404);
    expect(await emptyRun.json()).toEqual(notFoundBody());

    const trailingSlash = await hit("/api/status/");
    expect(trailingSlash.status).toBe(404);
    expect(await trailingSlash.json()).toEqual(notFoundBody());
    expect(calls).toEqual([]);
  });

  test("wrong method on a known path is 405", async () => {
    const res = await hit("/api/status", { method: "POST", headers: withToken() });
    expect(res.status).toBe(405);
    expect(res.headers.get("content-type")).toBe(JSON_CONTENT_TYPE);
    expect(await res.json()).toEqual({ ok: false, error: "use GET" });
    expect(calls).toEqual([]);
  });

  test("wrong method on a special route is 404", async () => {
    const cases: Array<[string, RequestInit]> = [
      ["/api/secrets", { method: "POST", headers: withToken() }],
      ["/api/hooks/x/repair", {}],
      ["/api/cache/x", { method: "POST", headers: withToken() }],
      ["/api/runs/a/b", { method: "POST", headers: withToken() }],
    ];
    for (const [path, init] of cases) {
      const res = await hit(path, init);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(notFoundBody());
    }

    const generic = await hit("/api/cache", { method: "POST", headers: withToken() });
    expect(generic.status).toBe(405);
    expect(await generic.json()).toEqual({ ok: false, error: "use GET" });
    expect(calls).toEqual([]);
  });

  test("HEAD never reaches a handler", async () => {
    const HEAD_HEADERS = ["access-control-allow-headers", "access-control-allow-methods", "content-length", "content-type"];
    const byteLength = (body: unknown) => String(Buffer.byteLength(JSON.stringify(body)));

    const known = await hit("/api/status", { method: "HEAD" });
    expect(known.status).toBe(405);
    expect(known.headers.get("content-type")).toBe(JSON_CONTENT_TYPE);
    expect(headerNames(known)).toEqual(HEAD_HEADERS);
    expect(known.headers.get("content-length")).toBe(byteLength({ ok: false, error: "use GET" }));

    const special = await hit("/api/cache/x", { method: "HEAD" });
    expect(special.status).toBe(404);
    expect(headerNames(special)).toEqual(HEAD_HEADERS);
    expect(special.headers.get("content-length")).toBe(byteLength(notFoundBody()));

    const gated = await hit("/api/secrets", { method: "HEAD" });
    expect(gated.status).toBe(401);
    expect(headerNames(gated)).toEqual(HEAD_HEADERS);
    expect(gated.headers.get("content-length")).toBe(byteLength({ ok: false, error: "unauthorized" }));
    expect(calls).toEqual([]);
  });

  test("the root serves the index for any method", async () => {
    const res = await hit("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_CONTENT_TYPE);
    const body = (await res.json()) as { name: string; docs: string };
    expect(body.name).toBe("rt daemon");
    expect(body.docs).toBe(`http://localhost:${port}/`);

    const head = await hit("/", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(headerNames(head)).toEqual(["access-control-allow-headers", "access-control-allow-methods", "content-length", "content-type"]);
    expect(head.headers.get("content-length")).toBe(String(Buffer.byteLength(JSON.stringify(body))));

    const post = await hit("/", { method: "POST", headers: withToken() });
    expect(post.status).toBe(200);
    expect(((await post.json()) as { name: string }).name).toBe("rt daemon");
    expect(calls).toEqual([]);
  });

  test("exact routes win over wildcards", async () => {
    const runs = await hit("/api/runs");
    expect(runs.status).toBe(200);
    expect(calls).toEqual([{ cmd: "runs:list", payload: {} }]);

    const hooks = await hit("/api/hooks/x");
    expect(hooks.status).toBe(404);
    expect(await hooks.json()).toEqual(notFoundBody());
    expect(calls).toHaveLength(1);
  });

  test("secrets forwards exactly the header token", async () => {
    const res = await hit("/api/secrets?scope=deck", { headers: withToken({ "X-RT-Client": "tray" }) });
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ cmd: "secrets:read", payload: { token } }]);
  });

  test("X-RT-Client lands on generic routes only", async () => {
    const client = { "X-RT-Client": "tray" };
    await hit("/api/runs", { headers: client });
    await hit("/api/cache", { headers: client });
    await hit("/api/refresh", { method: "POST", headers: withToken(client) });
    expect(calls).toEqual([
      { cmd: "runs:list", payload: { _client: "tray" } },
      { cmd: "cache:read", payload: { _client: "tray" } },
      { cmd: "cache:refresh", payload: { _client: "tray" } },
    ]);

    calls = [];
    const identity = serializeIdentity({ kind: "remote", id: "github.com/acme/widgets" });
    await hit("/api/cache/main", { headers: client });
    await hit(`/api/cache?repoIdentity=${identity}`, { headers: client });
    await hit("/api/runs/a/b", { headers: client });
    await hit(`/api/hooks/${identity}/repair`, { method: "POST", headers: withToken(client) });
    expect(calls).toEqual([
      { cmd: "cache:read", payload: { branches: ["main"] } },
      { cmd: "cache:read", payload: { repoIdentity: identity } },
      { cmd: "runs:get", payload: { repo: "a", runId: "b" } },
      { cmd: "hooks:repair", payload: { repo: identity } },
    ]);
  });

  test("GET query strings are coerced; POST reads the JSON body", async () => {
    await hit("/api/runs?limit=5&all=true&repo=x");
    await hit("/api/refresh", { method: "POST", headers: withToken(), body: JSON.stringify({ force: true }) });
    expect(calls).toEqual([
      { cmd: "runs:list", payload: { limit: 5, all: true, repo: "x" } },
      { cmd: "cache:refresh", payload: { force: true } },
    ]);
  });

  test("OPTIONS on an unknown path is 204", async () => {
    const res = await hit("/api/nope", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(calls).toEqual([]);
  });

  test("token gate fires before routing", async () => {
    const shutdown = await hit("/api/shutdown", { method: "POST" });
    expect(shutdown.status).toBe(401);
    expect(shutdown.headers.get("content-type")).toBe(JSON_CONTENT_TYPE);
    expect(await shutdown.json()).toEqual({ ok: false, error: "unauthorized" });

    const unknown = await hit("/api/nope", { method: "POST" });
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual({ ok: false, error: "unauthorized" });

    const drain = await hit("/api/notifications");
    expect(drain.status).toBe(401);
    expect(await drain.json()).toEqual({ ok: false, error: "unauthorized" });

    const wrongToken = await hit("/api/shutdown", { method: "POST", headers: { "X-RT-Token": "nope" } });
    expect(wrongToken.status).toBe(401);
    expect(calls).toEqual([]);
  });

  test("a percent-encoded route path matches no route", async () => {
    const drain = await hit("/api/n%6Ftifications");
    expect(drain.status).toBe(404);
    expect(await drain.json()).toEqual(notFoundBody());

    const secrets = await hit("/api/s%65crets");
    expect(secrets.status).toBe(404);
    expect(await secrets.json()).toEqual(notFoundBody());
    expect(calls).toEqual([]);
  });

  test("oversized POST body keeps the 413 body", async () => {
    const limit = bodyLimitFor("events:emit");
    const res = await hit("/api/events/emit", {
      method: "POST",
      headers: withToken({ "Content-Type": "application/json" }),
      body: "x".repeat(limit + 1),
    });
    expect(res.status).toBe(413);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(headerNames(res)).toEqual(ALWAYS);
    expect(await res.json()).toEqual({ ok: false, error: "request body over the 1 MiB limit for events:emit" });
    expect(calls).toEqual([]);
  });

  test("/api/runs/onlyonesegment is a 404", async () => {
    const res = await hit("/api/runs/onlyonesegment");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(notFoundBody());
    expect(calls).toEqual([]);
  });

  test("handler throw is a 500 with failure", async () => {
    const err = Object.assign(new Error("boom"), { code: "E_BOOM" });
    reply = async () => { throw err; };
    const res = await hit("/api/repos");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe(JSON_CONTENT_TYPE);
    expect(headerNames(res)).toEqual(ALWAYS);
    expect(await res.json()).toEqual({ ok: false, error: String(err), failure: deriveFailure(err) });
  });
});
