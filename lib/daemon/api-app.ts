/**
 * The Hono app behind the daemon's REST surface on :9401. `startApiServer`
 * keeps `/ws` on `Bun.serve` and hands every other request to this app.
 */

import { Hono, type Context } from "hono";
import type { Logger } from "pino";
import { DAEMON_ROUTES } from "../../packages/rt-client/src/daemon-api/routes.ts";
import { needsToken, tokenOk, resolveOriginTrust, isTokenPreflight } from "./api-auth.ts";
import { deriveFailure } from "./failure.ts";
import { readCommandBody } from "./request-limits.ts";
import { parseIdentity } from "../settings/identity.ts";
import { apiIndex, docsHtml, openApiJson, scalarJs } from "./api-docs.ts";

export interface ApiAppDeps {
  handleCommand: (cmd: string, payload: any, signal?: AbortSignal) => Promise<any>;
  log: Logger;
  apiToken: string;
  port: number;
}

/**
 * CORS default-deny: a browser page on an untrusted Origin still gets
 * its request served (127.0.0.1 loopback + the per-route token gate are the
 * real defenses), but the response carries no Access-Control-Allow-Origin,
 * so the page's own JavaScript cannot read the body. A request with no
 * Origin at all (every non-browser consumer today) needs no CORS headers.
 */
export function buildCorsHeaders(origin: string | null, trusted: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-RT-Token, X-RT-Client",
  };
  if (origin && trusted) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return headers;
}

/**
 * Decodes one path segment between a fixed prefix (and optional suffix),
 * returning `undefined` (never throwing) on any shape mismatch or malformed
 * %-encoding. Before this, each parameterized route hand-rolled its
 * own decodeURIComponent inside the route's try block, so a malformed
 * segment fell through to the OUTER catch and came back as a logged 500;
 * every route using this helper instead gets a clean 400.
 */
export function pathParam(pathname: string, prefix: string, suffix = ""): string | undefined {
  const raw = rawPathParam(pathname, prefix, suffix);
  if (raw === undefined) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

/** `pathParam`'s shape checks and slicing, without the decode. */
function rawPathParam(pathname: string, prefix: string, suffix = ""): string | undefined {
  if (!pathname.startsWith(prefix)) return undefined;
  if (suffix && !pathname.endsWith(suffix)) return undefined;
  const end = suffix ? pathname.length - suffix.length : pathname.length;
  if (end <= prefix.length) return undefined;
  return pathname.slice(prefix.length, end);
}

/** `decodeURIComponent`, undefined on malformed %-encoding. */
function decodeOrUndefined(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

/**
 * A repo path segment. A serialized identity is ALREADY one slash-free
 * segment, which is what `serializeIdentity`'s percent-encoding buys, so the
 * raw segment IS the key, and decoding it turns its `%2F` back into route
 * separators. That silently destroyed the identity: `hooks:repair` refused the
 * non-canonical result and still answered ok, and `runs:get` split the repo in
 * half and never found the run.
 *
 * A client that re-encoded the wire anyway still resolves, because the two
 * spellings are disjoint: a canonical wire never decodes to another canonical
 * wire, since `parseIdentity` requires the id to re-encode to itself. A string
 * canonical under neither reading (a legacy plain name) decodes as before.
 */
export function repoPathParam(pathname: string, prefix: string, suffix = ""): string | undefined {
  const raw = rawPathParam(pathname, prefix, suffix);
  if (raw === undefined) return undefined;
  return parseIdentity(raw) ? raw : decodeOrUndefined(raw);
}

/**
 * The `repoIdentity` query value, accepted both double-encoded and appended
 * as the bare wire, by the same disjointness `repoPathParam` relies on.
 */
function repoIdentityQueryParam(url: URL): string | null {
  const decoded = url.searchParams.get("repoIdentity");
  if (decoded === null) return null;
  const raw = /(?:^\?|&)repoIdentity=([^&]*)/.exec(url.search)?.[1];
  return raw !== undefined && parseIdentity(raw) ? raw : decoded;
}

/**
 * `/api/<thing>/:repo/:rest`. The repo is split off the RAW path so a wire
 * identity survives whole; only `rest` is decoded. Splitting after a
 * whole-remainder decode (what this replaced) could not tell the wire's own
 * `%2F` from the route separator.
 *
 * `undefined` is a shape mismatch (the caller falls through to its 404);
 * `"malformed"` is bad %-encoding, which keeps the clean 400 every other
 * parameterized route answers.
 */
export function splitRepoAndRest(
  pathname: string,
  prefix: string,
): { repo: string; rest: string } | "malformed" | undefined {
  const raw = rawPathParam(pathname, prefix);
  if (raw === undefined) return undefined;
  const slash = raw.indexOf("/");
  if (slash <= 0 || slash >= raw.length - 1) return undefined;

  const rawRepo = raw.slice(0, slash);
  const repo = parseIdentity(rawRepo) ? rawRepo : decodeOrUndefined(rawRepo);
  const rest = decodeOrUndefined(raw.slice(slash + 1));
  return repo === undefined || rest === undefined ? "malformed" : { repo, rest };
}

const PLAIN_NUMBER_RE = /^-?\d+(\.\d+)?$/;

/**
 * REST query strings arrive as strings no matter what the client meant:
 * "?maxAgeMs=60000" and "?refresh=true" reached handlers that do a
 * strict `typeof x === "number"` or `x === true` check, so the documented
 * flag silently no-op'd over HTTP while working over the socket (where
 * payloads are real JSON). One coercion at the REST seam fixes every such
 * flag at once instead of a per-handler private parser.
 */
export function coerceQueryParams(params: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (value === "true") out[key] = true;
    else if (value === "false") out[key] = false;
    else if (value !== "" && PLAIN_NUMBER_RE.test(value)) out[key] = Number(value);
    else out[key] = value;
  }
  return out;
}


type ApiEnv = { Variables: { corsHeaders: Record<string, string> } };
type ApiContext = Context<ApiEnv>;
type Route = (typeof DAEMON_ROUTES)[number];
type SpecialRoute = Extract<Route, { kind: "special" }>;

function isWildcard(route: Route): boolean {
  return route.honoPath.endsWith("/*");
}

export function createApiApp(deps: ApiAppDeps): Hono<ApiEnv> {
  const { handleCommand, log, apiToken, port } = deps;
  // Hono's default getPath percent-decodes; the token gate and the routing
  // must both see the raw pathname, or `/api/n%6Ftifications` would pass the
  // gate as an unknown path and then reach the gated notifications handler.
  const app = new Hono<ApiEnv>({ getPath: (req) => new URL(req.url).pathname });

  const genericMethods = new Map<string, string>(
    DAEMON_ROUTES.filter((route) => route.kind === "generic").map((route) => [route.path, route.method.toUpperCase()]),
  );

  const reply = (c: ApiContext, body: unknown, status = 200): Response =>
    Response.json(body, { status, headers: c.get("corsHeaders") });

  const failed = (err: unknown, c: ApiContext): Response => {
    log.error({ err, url: c.req.raw.url }, "api request failed");
    return reply(c, { ok: false, error: String(err), failure: deriveFailure(err) }, 500);
  };

  const unrouted = (c: ApiContext): Response => {
    const pathname = new URL(c.req.raw.url).pathname;
    if (pathname === "/" || pathname === "") return reply(c, apiIndex(port));
    const method = genericMethods.get(pathname);
    if (method === undefined) {
      return reply(c, { ok: false, error: "not found", docs: `http://localhost:${port}/` }, 404);
    }
    return reply(c, { ok: false, error: `use ${method}` }, 405);
  };

  const malformed = (c: ApiContext) => reply(c, { ok: false, error: "malformed path parameter" }, 400);

  // Keyed by every special route id, so a special route without a handler
  // here fails to compile instead of falling through to the generic payload.
  const specials: { [Id in SpecialRoute["id"]]: (c: ApiContext, route: SpecialRoute) => Promise<Response> } = {
    "cache.get": async (c, route) => {
      const req = c.req.raw;
      const url = new URL(req.url);
      const branch = pathParam(url.pathname, "/api/cache/");
      if (branch === undefined) return malformed(c);
      const repoIdentity = repoIdentityQueryParam(url);
      if (repoIdentity === null) return reply(c, await handleCommand(route.cmd, { branches: [branch] }, req.signal));
      if (parseIdentity(repoIdentity) === null) return reply(c, { ok: true, data: {} });
      return reply(c, await handleCommand(route.cmd, { branches: [branch], repoIdentity }, req.signal));
    },
    "hooks.repair": async (c, route) => {
      const req = c.req.raw;
      const url = new URL(req.url);
      if (!url.pathname.endsWith("/repair")) return unrouted(c);
      const repo = repoPathParam(url.pathname, "/api/hooks/", "/repair");
      if (repo === undefined) return malformed(c);
      return reply(c, await handleCommand(route.cmd, { repo }, req.signal));
    },
    "runs.get": async (c, route) => {
      const req = c.req.raw;
      const split = splitRepoAndRest(new URL(req.url).pathname, "/api/runs/");
      if (split === "malformed") return malformed(c);
      if (split === undefined) return unrouted(c);
      return reply(c, await handleCommand(route.cmd, { repo: split.repo, runId: split.rest }, req.signal));
    },
    "secrets.read": async (c, route) => {
      const req = c.req.raw;
      // The secrets:read handler re-checks the token itself, since it also
      // serves the unix socket, so the verified header rides in the payload.
      return reply(c, await handleCommand(route.cmd, { token: req.headers.get("x-rt-token") ?? undefined }, req.signal));
    },
  };

  const dispatch = async (route: Route, c: ApiContext): Promise<Response> => {
    if (route.kind === "special") return specials[route.id](c, route);

    const req = c.req.raw;
    const url = new URL(req.url);

    if (route.id === "cache.list") {
      const repoIdentity = repoIdentityQueryParam(url);
      if (repoIdentity !== null) {
        if (parseIdentity(repoIdentity) === null) return reply(c, { ok: true, data: {} });
        return reply(c, await handleCommand(route.cmd, { repoIdentity }, req.signal));
      }
    }

    let payload: any;
    if (route.method === "post") {
      const body = await readCommandBody(req, route.cmd);
      if ("refused" in body) {
        return new Response(body.refused.body, { status: 413, headers: { ...c.get("corsHeaders"), "Content-Type": "application/json" } });
      }
      payload = body.payload;
    } else {
      payload = coerceQueryParams(url.searchParams);
    }

    const client = req.headers.get("x-rt-client");
    if (client) payload._client = client;
    return reply(c, await handleCommand(route.cmd, payload, req.signal));
  };

  // Hono answers HEAD by running the GET dispatch and rebuilding the reply
  // with a null body, so the body's length has to ride as a header.
  const forHead = async (res: Response): Promise<Response> => {
    res.headers.set("content-length", String((await res.clone().arrayBuffer()).byteLength));
    return res;
  };

  app.use("*", async (c, next) => {
    const req = c.req.raw;
    const origin = req.headers.get("origin");
    // resolveOriginTrust reads the allowlist (synchronous disk I/O) only
    // when an Origin is present.
    const trusted = resolveOriginTrust(origin, req.headers.get("x-rt-token"), apiToken)
      || isTokenPreflight(req.method, req.headers.get("access-control-request-headers"));
    const corsHeaders = buildCorsHeaders(origin, trusted);
    c.set("corsHeaders", corsHeaders);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // CORS default-deny only stops a page reading the reply, not firing the
    // request; the token is the defense against a page driving these routes.
    if (needsToken(req.method, new URL(req.url).pathname) && !tokenOk(req.headers.get("x-rt-token"), apiToken)) {
      const unauthorized = Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: corsHeaders });
      return req.method === "HEAD" ? forHead(unauthorized) : unauthorized;
    }

    // A HEAD request never reaches a route handler.
    if (req.method === "HEAD") return forHead(unrouted(c));

    await next();
  });

  const text = (c: ApiContext, body: string | Uint8Array, contentType: string, extra: Record<string, string> = {}): Response =>
    new Response(body, { headers: { ...c.get("corsHeaders"), "Content-Type": contentType, ...extra } });

  app.get("/openapi.json", async (c) => reply(c, await openApiJson()));
  app.get("/docs", (c) => text(c, docsHtml(), "text/html; charset=utf-8"));
  app.get("/docs/scalar.js", async (c) =>
    text(c, await scalarJs(), "text/javascript; charset=utf-8", { "Cache-Control": "max-age=86400" }));

  // Hono's `/x/*` also matches `/x`, and the first registered handler wins.
  const ordered = [...DAEMON_ROUTES.filter((r) => !isWildcard(r)), ...DAEMON_ROUTES.filter(isWildcard)];
  for (const route of ordered) {
    app.on(route.method.toUpperCase(), route.honoPath, async (c) => {
      // Hono's onError only sees Error instances; a thrown non-Error still
      // gets the 500 envelope here.
      try {
        return await dispatch(route, c);
      } catch (err) {
        return failed(err, c);
      }
    });
  }

  app.notFound(unrouted);
  app.onError(failed);

  return app;
}
