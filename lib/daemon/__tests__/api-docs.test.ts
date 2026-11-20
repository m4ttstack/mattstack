import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Server } from "bun";
import { startApiServer } from "../api-server.ts";
import { DAEMON_ROUTES } from "../../../packages/rt-client/src/daemon-api/index.ts";
import { readFileSync } from "fs";
import { join } from "path";
import { SCALAR_VERSION } from "../api-docs.ts";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

let server: Server<any> | undefined;
let port = 0;
let previousPortEnv: string | undefined;
let calls: string[] = [];

beforeAll(async () => {
  previousPortEnv = process.env.RT_API_PORT;
  process.env.RT_API_PORT = "0";
  server = await startApiServer({
    handleCommand: async (cmd) => {
      calls.push(cmd);
      return { ok: true, data: {} };
    },
    log: noopLog,
  });
  port = server.port!;
});

afterAll(() => {
  server?.stop(true);
  if (previousPortEnv === undefined) delete process.env.RT_API_PORT;
  else process.env.RT_API_PORT = previousPortEnv;
});

function hit(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, init);
}

const honoStyle = (path: string) => path.replace(/\{([^}]+)\}/g, ":$1");

describe("daemon API docs", () => {
  test("SCALAR_VERSION matches the installed @scalar/api-reference", () => {
    const pkgPath = join(import.meta.dir, "..", "..", "..", "node_modules", "@scalar", "api-reference", "package.json");
    const installed = (JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }).version;
    expect(SCALAR_VERSION).toBe(installed);
  });

  test("/openapi.json lists every route", async () => {
    const res = await hit("/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: Record<string, Record<string, unknown>> };
    expect(doc.openapi).toStartWith("3.1");
    for (const route of DAEMON_ROUTES) {
      expect(doc.paths[route.path]?.[route.method]).toBeDefined();
    }
  });

  test("GET / lists every route plus the docs routes", async () => {
    const res = await hit("/");
    expect(res.status).toBe(200);
    const index = (await res.json()) as {
      docs: string;
      endpoints: Array<{ method: string; path: string; description: string }>;
      websocket_events: unknown[];
    };
    const got = new Set(index.endpoints.map((e) => `${e.method} ${e.path}`));
    const want = new Set([
      ...DAEMON_ROUTES.map((r) => `${r.method.toUpperCase()} ${honoStyle(r.path)}`),
      "GET /docs",
      "GET /openapi.json",
    ]);
    expect(got).toEqual(want);
    expect(got.has("GET /api/usage/run")).toBe(true);
    expect(index.endpoints).toHaveLength(want.size);
    expect(index.docs).toBe(`http://localhost:${port}/docs`);
    expect(index.websocket_events.length).toBeGreaterThan(0);
  });

  test("/docs references only local URLs", async () => {
    const res = await hit("/docs");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
    const srcs = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs).toEqual([`/docs/scalar.js?v=${SCALAR_VERSION}`]);
    expect(html).toContain("withDefaultFonts: false");
    expect(html).toContain("hideClientButton: true");
    expect(html).not.toContain("proxyUrl");
  });

  test("/docs/scalar.js serves the embedded script, with or without the version query", async () => {
    const bodies: string[] = [];
    for (const path of ["/docs/scalar.js", `/docs/scalar.js?v=${SCALAR_VERSION}`]) {
      const res = await hit(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe("max-age=86400");
      bodies.push(await res.text());
    }
    expect(bodies[0]!.length).toBeGreaterThan(1024 * 1024);
    expect(bodies[0]!).toContain("createApiReference");
    expect(bodies[1]).toBe(bodies[0]!);
  });

  test("HEAD on a docs route answers the GET's status and headers with no body", async () => {
    calls = [];
    for (const path of ["/openapi.json", "/docs", "/docs/scalar.js"]) {
      const get = await hit(path);
      const length = (await get.arrayBuffer()).byteLength;
      const head = await hit(path, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-type")).toBe(get.headers.get("content-type"));
      expect(head.headers.get("cache-control")).toBe(get.headers.get("cache-control"));
      expect(head.headers.get("content-length")).toBe(String(length));
      expect((await head.arrayBuffer()).byteLength).toBe(0);
    }
    expect(calls).toEqual([]);
  });

  test("the index names every token-gated GET", async () => {
    const index = (await (await hit("/")).json()) as { auth: { description: string } };
    expect(index.auth.description).toContain("GET /api/notifications");
    expect(index.auth.description).toContain("GET /api/secrets");
    expect(index.auth.description).toContain("mutating (POST)");
  });

  test("docs routes are not token-gated", async () => {
    calls = [];
    for (const path of ["/", "/docs", "/docs/scalar.js", "/openapi.json"]) {
      const res = await hit(path);
      expect(res.status).toBe(200);
      await res.arrayBuffer();
    }
    expect(calls).toEqual([]);
  });

  test("docs routes follow the same CORS rules as other GETs", async () => {
    const res = await hit("/openapi.json", { headers: { Origin: "http://off-allowlist.example" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    await res.arrayBuffer();
  });
});
