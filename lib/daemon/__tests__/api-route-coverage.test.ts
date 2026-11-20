/**
 * Every route the Hono app registers is described, walked from the app
 * itself rather than from DAEMON_ROUTES, so a route added by hand to
 * api-app.ts cannot slip past /openapi.json and the index at GET /.
 */
import { describe, test, expect } from "bun:test";
import { createApiApp } from "../api-app.ts";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

// The docs routes describe the API rather than belong to it.
const NOT_IN_OPENAPI = new Set(["GET /openapi.json", "GET /docs", "GET /docs/scalar.js"]);
const NOT_IN_INDEX = new Set(["GET /docs/scalar.js"]);

function app() {
  return createApiApp({ handleCommand: async () => ({ ok: true }), log: noopLog, apiToken: "token", port: () => 9401 });
}

/** `METHOD honoPath` for every route handler, leaving out `app.use` middleware. */
function registered(): string[] {
  return app()
    .routes.filter((r) => r.method !== "ALL")
    .map((r) => `${r.method} ${r.path}`);
}

/** Wildcard routes cover parameterized paths; exact routes match only themselves. */
function covers(route: string, described: string): boolean {
  const [method, path] = route.split(" ") as [string, string];
  const [dMethod, dPath] = described.split(" ") as [string, string];
  if (method !== dMethod) return false;
  if (!path.endsWith("/*")) return path === dPath;
  const prefix = path.slice(0, -1);
  return dPath.startsWith(prefix) && dPath.length > prefix.length;
}

function uncovered(routes: string[], described: string[]): string[] {
  const exact = new Set(routes.filter((r) => !r.endsWith("/*")));
  return routes.filter((route) => {
    if (exact.has(route)) return !described.includes(route);
    return !described.some((d) => !exact.has(d) && covers(route, d));
  });
}

describe("API route coverage", () => {
  test("the walk sees the app's routes", () => {
    const routes = registered();
    expect(routes).toContain("GET /api/status");
    expect(routes).toContain("POST /api/hooks/*");
    expect(routes).toContain("GET /openapi.json");
  });

  test("every registered route is in /openapi.json", async () => {
    const doc = (await (await app().request("/openapi.json")).json()) as { paths: Record<string, Record<string, unknown>> };
    const described = Object.entries(doc.paths).flatMap(([path, ops]) =>
      Object.keys(ops).map((method) => `${method.toUpperCase()} ${path}`));
    const routes = registered().filter((r) => !NOT_IN_OPENAPI.has(r));
    expect(uncovered(routes, described)).toEqual([]);
  });

  test("every registered route is in the index at GET /", async () => {
    const index = (await (await app().request("/")).json()) as { endpoints: Array<{ method: string; path: string }> };
    const described = index.endpoints.map((e) => `${e.method} ${e.path}`);
    const routes = registered().filter((r) => !NOT_IN_INDEX.has(r));
    expect(uncovered(routes, described)).toEqual([]);
  });
});
