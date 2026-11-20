# rt daemon OpenAPI and `/docs`

## Intent

The rt daemon's HTTP API on `127.0.0.1:9401` has no machine-readable contract.
`GET /` returns a hand-maintained endpoint list (`buildApiIndex` in
`lib/daemon/api-server.ts`) with no request or response shapes, and it has
already drifted: `/api/usage/run` is routed but not listed.

The contract has three readers, all of them first-class:

- **Matt browsing** the API: a docs page with try-it requests.
- **Agents** reading a spec: `/openapi.json` they can fetch and reason over.
- **Typed clients**: console and other TypeScript callers get end-to-end
  types; the Swift tray and Go UI read the spec as their contract.

So response shapes must be real, not placeholders.

## Goals

- The daemon's REST routes run on Hono with `@hono/zod-openapi`.
- `GET /openapi.json` serves an OpenAPI 3.1 document generated from the route
  definitions.
- `GET /docs` serves Scalar, bundled into the rt binary (no CDN fetch).
- `GET /` is built from the same route definitions, so the index cannot drift.
- Every REST route has a real request schema and a real response schema.
- The REST-exposed commands' payload and data types in
  `packages/rt-client/src/commands.ts` become zod schemas, and the TypeScript
  types derive from them (`z.infer`). One source of truth.
- A typed Hono client (`hc<AppType>`) is exported for TypeScript callers.

## Non-goals

- `/ws` stays on `Bun.serve` exactly as it is. OpenAPI does not cover its
  frames; the four broadcast event types stay described in the index (and the
  spec's `info.description`).
- No Swift or Go codegen for the tray or UI helper.
- Commands not exposed over REST keep their plain TypeScript types.
- Not moving the daemon onto `@mattstack/app-server`'s `createApp`: its
  `/api/health`, color-scheme routes and `{ error }` envelope differ from the
  daemon's contract.
- Migrating console's daemon calls to `hc` is follow-up work, not this build.

## Anti-goals (failure even if it works)

- **Any wire change.** Every existing caller (tray, console, boxscore, deck,
  the event bridge, rt-client relay) must see byte-identical status codes,
  headers and bodies for every request it makes today.
- **Weakening the control surface.** The origin trust check, default-deny
  CORS, `X-RT-Token` gate on mutating routes and `/api/secrets`, loopback-only
  bind, and the request body limit must behave exactly as today. `/docs` and
  `/openapi.json` must not become a way around them.
- **Runtime response validation in production.** A shape mismatch must never
  turn a working call into a 500.
- **An outside network fetch** from `/docs`.

## Constraints

- rt is compiled with `bun build --compile`; assets embed via
  `import … with { type: "text" }` (precedent: `lib/plugin-api.ts`).
- `hono` (4.13) and `zod` (4.x) are already catalog/dev dependencies; rt does
  not import either at runtime today. `@hono/zod-openapi` must be a version
  that supports zod 4.
- rt-client's `dist/` goes stale after source edits (see
  `.claude/rules/workspace-packages.md`); rebuild it and keep
  `packages/rt-client/test/dist-freshness.test.ts` green.
- **The wire envelope is not uniform.** Most routes answer `{ ok, data }`, but
  some do not: `cache:refresh` answers `{ ok, message }`, `hooks:repair`
  answers `{ ok, repaired }` with no `data`, `cache:read` carries `source`
  beside `data`. Response schemas describe the actual envelope per route, as
  documented on each `Commands` entry, not an assumed `{ ok, data }`.
- Failure bodies are `{ ok: false, error }` plus `failure` on a 500, `401
  { ok:false, error:"unauthorized" }`, `404 { ok:false, error:"not found",
  docs }`, `405 { ok:false, error:"use <METHOD>" }`, and the `readCommandBody`
  413 body. These go in the spec as shared responses.
- Run `bun test` from the repo root; touch only targeted tests locally.

## Approaches considered

| Approach | Trade-off | Outcome |
|---|---|---|
| Hand-written `openapi.json` | Cheapest; drifts like today's index | Rejected |
| Hono + `@hono/zod-openapi` | Same stack as the apps (`packages/server`, console, chat, boxscore); typed `hc` client; incremental | **Picked** |
| Elysia | Bun-only, TypeBox-first, second framework in the repo; Eden's typed client is matched by `hc` | Rejected |

Viewer: **Scalar**, bundled, picked over Swagger UI, Redoc, Stoplight Elements
and RapiDoc.

Where schemas live:

| Option | Trade-off | Outcome |
|---|---|---|
| A. zod beside the TS types, plus a type-equality test | Two definitions, drift fails the build | Rejected |
| **B. Convert the REST commands' types to zod, derive TS via `z.infer`** | One source of truth; a larger rt-client change | **Picked by Matt** |
| C. Generate JSON Schema from the TS types | Build step; requests still need zod | Rejected |

## Design

### Schemas (rt-client)

- A new module in rt-client (for example `src/command-schemas.ts`) defines zod
  schemas for the payload and data of each REST-exposed command, and every
  type they reach (`TrayStatusData`, `PortsData`, `BranchEnrichment`,
  `ReposData`, `RtNotificationEvent`, `EventsBusEvent`, `RunSummary`,
  `RunDetail` and its row types, the `Usage*` types, `ReconcilerStatus`, and
  so on).
- `commands.ts` replaces those interfaces with
  `export type X = z.infer<typeof XSchema>`, keeping the exported names, so
  every importer keeps compiling. JSDoc on the old interfaces moves onto the
  schemas (`.describe()` where it helps the spec reader).
- Commands typed `unknown` today (`system-processes`, `sdm:recents`,
  `sdm:reconnect`) get real schemas, read off their handlers. `shutdown`,
  which has no `Commands` entry, gets one.
- `/api/secrets` is documented with its token requirement; its schema names
  the fields, never example values.

### Router (rt)

- A Hono `OpenAPIHono` app owns every non-`/ws` route. `Bun.serve`'s `fetch`
  keeps the `/ws` upgrade first, then hands everything else to `app.fetch`.
- Middleware, in today's order, calling the existing functions rather than
  Hono's built-ins: origin trust and CORS headers (`resolveOriginTrust`,
  `buildCorsHeaders`, `isTokenPreflight`), OPTIONS 204, the token gate
  (`needsToken`, `tokenOk`). No `hono/cors`.
- Each route is a `createRoute` definition: method, path, request schema
  (query/params/body), response schemas per status, and whether it needs the
  token (an OpenAPI security requirement on `X-RT-Token`). Handlers still call
  `handleCommand(cmd, payload, signal)`.
- Query coercion keeps today's `coerceQueryParams` semantics; the schemas
  must accept exactly what it produces.
- `x-rt-client` still lands on the payload as `_client`; the special cases
  (`/api/cache` repo filter, `/api/cache/:branch`, `/api/hooks/:repo/repair`,
  `/api/runs/:repo/:runId`, `/api/secrets` token forwarding) keep their
  behaviour.
- Request validation failures must produce the same status and body each
  route returns today for that input, not zod's default error shape.
- Responses are not validated at runtime. Contract tests (below) check them.

### Docs surface

- `GET /openapi.json`: the generated document, with the `X-RT-Token` security
  scheme and the shared error responses.
- `GET /docs`: an HTML page that loads Scalar's standalone script from a
  daemon route (embedded with `with { type: "text" }`), pointed at
  `/openapi.json`.
- `GET /`: the existing index shape (`name`, `version`, `docs`, `websocket`,
  `endpoints`, `websocket_events`, `auth`), with `endpoints` generated from
  the route definitions. `docs` points at `/docs`.
- These three routes are reads with no secrets and follow the same CORS rules
  as other GET routes.

### Typed client

- Export `AppType` from the daemon routes and a small `hc<AppType>` factory
  from rt-client, so TypeScript callers can opt in. No caller is migrated in
  this build.

### Tests

- The existing `lib/daemon/__tests__/api-*.ts` files pass unchanged. They are
  the no-wire-change gate.
- A test that every route in the Hono app appears in `/openapi.json` and in
  `GET /`, and that `/openapi.json` is a valid OpenAPI 3.1 document.
- Contract tests: for each route, real handler output from the existing
  fixtures parses against its response schema.
- A test that `/docs` makes no outside request: the page references only
  daemon-local URLs.
- rt-client's existing type tests and `dist-freshness` stay green.

## Left to the builder

- Exact file layout for route definitions and schemas.
- The Scalar package and version, and how its script is embedded.
- Which `@hono/zod-openapi` version, as long as it supports zod 4.
- Ordering the work so each commit is green (likely: schemas in rt-client
  first, then the router swap, then the docs surface).
