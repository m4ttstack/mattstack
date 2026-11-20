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

/** `METHOD honoPath` for every route handler, leaving out the one `app.use("*")` middleware. */
function registered(): string[] {
  return app()
    .routes.filter((r) => !(r.method === "ALL" && (r.path === "*" || r.path === "/*")))
    .map((r) => `${r.method} ${r.path}`);
}

const isWildcard = (route: string) => route.endsWith("/*");
const methodOf = (key: string) => key.slice(0, key.indexOf(" "));
const pathOf = (key: string) => key.slice(key.indexOf(" ") + 1);

/**
 * An exact route needs its own entry. A wildcard needs at least one
 * documented path that it is the longest-prefix wildcard for, so a broad
 * hand-added `/api/*` cannot borrow the paths `/api/runs/*` already covers.
 */
function uncovered(routes: string[], described: string[]): string[] {
  const exact = new Set(routes.filter((r) => !isWildcard(r)));
  const wildcards = routes.filter(isWildcard);
  const owner = (d: string): string | undefined =>
    wildcards
      .filter((w) => {
        const prefix = pathOf(w).slice(0, -1);
        return methodOf(w) === methodOf(d) && pathOf(d).startsWith(prefix) && pathOf(d).length > prefix.length;
      })
      .sort((a, b) => b.length - a.length)[0];
  const owned = new Set(described.filter((d) => !exact.has(d)).map(owner));
  return routes.filter((route) => (isWildcard(route) ? !owned.has(route) : !described.includes(route)));
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
