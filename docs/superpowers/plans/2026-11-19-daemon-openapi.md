# rt daemon OpenAPI and `/docs` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a generated OpenAPI 3.1 spec, a bundled Scalar page and a generated index from the rt daemon, with the REST routes on Hono and the REST commands' types derived from zod, without changing a byte on the `/api/*` wire.

**Architecture:** rt-client gains zod schemas for every REST-exposed command (types in `commands.ts` derive from them through type-only imports) and a `./daemon-api` subpath holding one route table. That table drives three things: the daemon's Hono routing (each route dispatches raw input to `handleCommand` exactly as today), the OpenAPI document (registered through the zod-to-openapi registry, so nothing validates at runtime), and `AppType` for a typed `hc` client (derived at the type level from a contract app that is never run). `/ws` stays on `Bun.serve`.

**Tech Stack:** Bun, Hono 4.13, zod 4, `@hono/zod-openapi` 1.6 (its `OpenAPIHono`, `createRoute`, registry and generator), `@scalar/api-reference` 1.82.0 standalone script, bun:test, tsc.

**Spec:** `docs/superpowers/specs/2026-11-19-daemon-openapi-design.md`

## Global Constraints

- No `/api/*` wire change: same status, headers (including `Content-Type` exactly as `Response.json` emits it today) and body for every request. `GET /` is exempt.
- The trust, CORS, token and body-limit logic keeps calling the existing functions (`resolveOriginTrust`, `buildCorsHeaders`, `isTokenPreflight`, `needsToken`, `tokenOk`, `readCommandBody`, `coerceQueryParams`, `pathParam`, `repoPathParam`, `splitRepoAndRest`). No `hono/cors`, no `hono/body-limit`.
- Request schemas never reject. No zod validator runs on any request; the raw query or body reaches `handleCommand` exactly as today.
- No runtime response validation in the daemon.
- `packages/rt-client/dist/index.js` must not import zod (`packages/rt-client/test/no-zod-in-dist.test.ts`): `commands.ts` imports schemas with `import type` only. zod, hono and `@hono/zod-openapi` load at runtime only through the `./daemon-api` subpath.
- rt-client cannot import daemon code (the RT-44 comment above `EventsBusEvent` in `commands.ts`).
- Versions: `hono` catalog (^4.13.3), `zod` catalog (^4.6.5), `@hono/zod-openapi` ^1.6.3 (peers zod ^4, hono >=4.10), `@scalar/api-reference` pinned exactly to `1.82.0` (the embed reads a file path inside its `dist/`, which its `exports` map does not expose). Add the two new ones to the root `catalog`.
- `/docs` makes no request outside `127.0.0.1`. Scalar config: `withDefaultFonts: false`, no `proxyUrl`, `hideClientButton: true`, and any telemetry or AI-agent option off.
- Run `bun test` from the repo root (the worktree root). Locally run only the targeted tests named in each task; CI runs the rest.
- After touching `packages/rt-client/src`, run `bun run build` in `packages/rt-client` (`dist-freshness.test.ts` guards it).
- Never start a real daemon or a compiled `rt` against the real HOME. Visual checks use a stub server (Task 4).
- Comments state only constraints the code cannot show.

## Review Focus

1. **Branch names with slashes and `%2F` repo identities** on `/api/cache/:branch`, `/api/hooks/:repo/repair`, `/api/runs/:repo/:runId` decode exactly as today, because dispatch reuses the existing helpers on the raw pathname rather than Hono's param decoding. Pinned in Task 3.
2. **Response headers stay byte-identical.** Dispatch returns `Response.json(body, { status, headers: cors })` objects untouched; Hono must not add or rewrite `Content-Type` or any header. Pinned in Task 3.
3. **Wrong method on a known path** answers `405 {ok:false,error:"use GET"}` (not Hono's 404), and `OPTIONS` on any path, known or not, answers 204 before routing. Pinned in Task 3.
4. **POST bodies are read once, by `readCommandBody`**, so the 413 refusal and its body are unchanged. Pinned in Task 3.
5. **`/docs` stays local**: the HTML and its config reference only daemon URLs, and a real page load makes no outside request. Pinned in Task 4 (test plus a browser check).

---

### Task 1: zod schemas for the REST commands, types derived from them

**Files:**
- Create: `packages/rt-client/src/command-schemas.ts`
- Modify: `packages/rt-client/src/commands.ts` (the interfaces listed below, and the `Commands` entries for the REST commands)
- Modify: `packages/rt-client/package.json` (move `zod` from devDependencies to dependencies, as `catalog:` if the root catalog has it)
- Test (temporary, deleted in Step 6): `packages/rt-client/test/command-schemas-parity.test.ts`

**Interfaces:**
- Produces, in `command-schemas.ts`, one exported zod schema per type, named `<TypeName>Schema`: `BranchEnrichmentSchema`, `EventsBusEventSchema`, `AttentionSchema`, `RunSummarySchema`, `RunOutcomeSchema`, `RunAgentSchema`, `RunStageRowSchema`, `RunFieldRowSchema`, `RunDecisionRowSchema`, `RunDetailSchema`, `UsageKindSchema`, `UsageTotalsSchema`, `UsageModelRowSchema`, `UsageSplitsSchema`, `UsageBillingSchema`, `UsageAccountSchema`, `UsageMrRowSchema`, `UsageMrsDataSchema`, `UsageOutsideSchema`, `UsageStageRowSchema`, `UsageMrEntrySchema`, `UsageMrDataSchema`, `UsageRunDataSchema`, `UsageWeekRowSchema`, `UsagePipelineRowSchema`, `UsageTrendsDataSchema`, `UsageStatusDataSchema`, `AgentSurfaceSchema`, `ExecutorStateSchema`, `ExecutorViewSchema`, `ReconcilerStatusSchema`, `HealthLevelSchema`, `HealthMetricsSchema`, `HealthEventLoopSchema`, `ReadyHeldRepoSchema`, `TrayStatusDataSchema`, `PortEntrySchema`, `PortsDataSchema`, `RtNotificationEventSchema`, `ReposDataSchema`, plus new `SystemProcessesDataSchema`, `SdmRecentsReplySchema`, `SdmReconnectReplySchema`, `ShutdownDataSchema`, `SecretsReadDataSchema`.
- Produces one payload schema per REST command, named `<camelCmd>PayloadSchema` (`tray:status` → `trayStatusPayloadSchema`, `cache:read` → `cacheReadPayloadSchema`, `runs:get` → `runsGetPayloadSchema`, and so on for: `tray:status`, `ports`, `cache:read`, `repos`, `notifications`, `cache:refresh`, `shutdown`, `system-processes`, `sdm:recents`, `sdm:reconnect`, `events:emit`, `events:list`, `runs:list`, `runs:get`, `usage:mrs`, `usage:mr`, `usage:run`, `usage:trends`, `usage:status`, `reconciler:status`, `reconciler:clear`, `hooks:repair`, `secrets:read`). An empty payload (`Record<string, never>` today) is `z.object({}).strict()`.
- Produces in `commands.ts`: every listed type keeps its exported name as `export type X = z.infer<typeof S.XSchema>` with `import type * as S from "./command-schemas.ts"` and `import type { z } from "zod"`. Each REST `Commands` entry's `payload` becomes `z.infer<typeof S.<cmd>PayloadSchema>`. A new `"shutdown"` entry is added (add it to `COMMAND_NAMES` too).

- [ ] **Step 1: Write the parity test**

Copy each listed interface verbatim from `commands.ts` into the test file as `Legacy<Name>`, then assert exact equality for each with a type-level helper and one runtime no-op so bun runs the file:

```ts
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const _runSummary: Equals<RunSummary, LegacyRunSummary> = true;
// ...one line per listed type, and one per REST Commands payload
test("parity file typechecks", () => expect(true).toBe(true));
```

For the four types that are `unknown` today (`system-processes`, `sdm:recents`, `sdm:reconnect` data) and the new `shutdown` entry there is no legacy shape; skip them here.

- [ ] **Step 2: Run tsc to verify it fails**

Run: `cd packages/rt-client && bun run check-types`
Expected: FAIL, `Cannot find module './command-schemas.ts'` or missing schema exports.

- [ ] **Step 3: Write `command-schemas.ts` and switch `commands.ts` to derived types**

Map shapes one to one: `?:` → `.optional()`, `T | null` → `.nullable()`, `interface A extends B` → `BSchema.extend({...})`, `Record<UsageBilling, X>` → `z.record(UsageBillingSchema, XSchema)` (zod 4 makes enum-keyed records exhaustive, matching today), `unknown` → `z.unknown()`. Use plain `z.object` (not `.strict()`) for data, so extra wire fields still parse. Move each interface's JSDoc onto its schema field with `.describe()` where the text helps an API reader, otherwise as a comment.

For the new data schemas read the handler, not the old type:
- `SystemProcessesDataSchema`: `{ processes: ProcessNode[], updatedAt: number, ready: boolean }` from `lib/daemon/handlers/system-processes.ts:92-128`, with the recursive `children` via `z.lazy`, and the constant `isRunaway: false`, `runawayDurationMs: null` fields kept (the tray decodes them).
- `SdmRecentsReplySchema` and `SdmReconnectReplySchema`: these handlers answer a flat envelope (`{ ok: true, health, recents }`; `sdm:reconnect`'s failures carry `outcome` and `resource` beside `error`), from `lib/daemon/handlers/sdm.ts:79-120`. Model the whole reply.
- `ShutdownDataSchema`: what `lib/daemon.ts` answers in its `case "shutdown":` branch.
- `SecretsReadDataSchema`: the three-way union now on the `secrets:read` entry.

The handlers that are deliberately loose (`Promise<any>` in `system-processes.ts`, `sdm.ts`) stay loose; do not tighten them in this task.

- [ ] **Step 4: Run tsc and the rt-client guards**

Run: `cd packages/rt-client && bun run check-types && bun run build`, then from the worktree root `bun test packages/rt-client/test/command-schemas-parity.test.ts packages/rt-client/test/no-zod-in-dist.test.ts packages/rt-client/test/dist-freshness.test.ts packages/rt-client/test/index-surface.test.ts`
Expected: all PASS. `no-zod-in-dist` proves the type-only import held.

- [ ] **Step 5: Typecheck every consumer**

Run from the worktree root: `bun run typecheck && bun run console:typecheck && bun run board:typecheck`
Expected: PASS. A failure here is a parity gap the test missed; fix the schema, not the consumer.

- [ ] **Step 6: Delete the parity test and commit**

The legacy copies would become a second definition that drifts. Delete the file, then:

```bash
git add packages/rt-client
git commit -m "rt-client: derive REST command types from zod schemas"
```

---

### Task 2: the `./daemon-api` route table, OpenAPI document and typed client

**Files:**
- Create: `packages/rt-client/src/daemon-api/envelopes.ts`, `routes.ts`, `document.ts`, `client.ts`, `index.ts`
- Modify: `packages/rt-client/package.json` (exports `./daemon-api`, a build step `bun build src/daemon-api/index.ts --outfile dist/daemon-api.js --target node --format esm --packages external`, dependencies `hono` and `@hono/zod-openapi`)
- Modify: root `package.json` (catalog entries for `@hono/zod-openapi` ^1.6.3 and `@scalar/api-reference` 1.82.0)
- Test: `packages/rt-client/test/daemon-api-document.test.ts`, `packages/rt-client/test/daemon-api-samples.test.ts`, `packages/rt-client/test/daemon-api-client.test.ts`

**Interfaces:**
- Consumes: Task 1's schemas.
- Produces in `envelopes.ts`:
  - `okData<T extends z.ZodType>(data: T)`: `z.object({ ok: z.literal(true), data })`
  - `okFlat<T extends z.ZodRawShape>(shape: T)`: `z.object({ ok: z.literal(true), ...shape })`
  - `FailureEnvelopeSchema`: `{ ok: false, error: string, failure?: { code: string, message: string } }`
  - `NotFoundSchema` (`{ ok:false, error:"not found", docs: string }`), `MethodNotAllowedSchema`, `UnauthorizedSchema`, `MalformedPathSchema`, `TooLargeSchema` (the `readCommandBody` 413 body; read `lib/daemon/request-limits.ts:26` for its exact shape)
- Produces in `routes.ts`:

```ts
export interface DaemonRoute {
  id: string;                       // stable, e.g. "runs.get"
  method: "get" | "post";
  path: string;                     // OpenAPI form, e.g. "/api/runs/{repo}/{runId}"
  honoPath: string;                 // Hono match pattern, e.g. "/api/runs/*"
  cmd: string;                      // daemon command, e.g. "runs:get"
  summary: string;                  // today's index description, verbatim
  token: boolean;                   // needs X-RT-Token
  request: { query?: z.ZodObject; params?: z.ZodObject; body?: z.ZodType };
  success: z.ZodType;               // the 200 envelope as the handler really answers it
}
export const runsListRoute = { id: "runs.list", /* ... */ } as const satisfies DaemonRoute; // one exported const per route, named <camelId>Route
export const DAEMON_ROUTES = [runsListRoute /* , ...every route */] as const;
export const WEBSOCKET_EVENTS: readonly { type: string; description: string }[]; // today's four, verbatim
```

  Each route is its own `as const satisfies DaemonRoute` export so `contractApp()` keeps every schema's precise type; a widened `DaemonRoute[]` would leave the typed client with `unknown` bodies.

  One entry per row of today's `buildApiIndex` plus `/api/usage/run` (summary: "One run's usage beside its MR's cost (?runId=)"). `honoPath` for the parameterized routes is a wildcard (`/api/cache/*`, `/api/hooks/*`, `/api/runs/*`), because dispatch slices the raw path itself. The success envelope per route follows the handler, not an assumed `{ok,data}`: `cache:refresh` is `okFlat({ message })`, `hooks:repair` is `okFlat({ repaired })`, `cache:read` adds `source` beside `data`, `sdm:*` use Task 1's flat reply schemas. Check every other route against its handler's actual `return`.
- Produces in `document.ts`: `buildOpenApiDocument(opts: { version: string; serverUrl: string }): OpenAPIObject`, which registers every `DAEMON_ROUTES` entry on an `OpenAPIRegistry` (`registerPath`), adds an `apiKey` security scheme `rtToken` in header `X-RT-Token` applied to `token: true` routes, and the shared 401/404/405/413/500 responses, then runs `OpenApiGeneratorV31`. `info.description` names `/ws` and lists `WEBSOCKET_EVENTS`.
- Produces in `client.ts`:
  - a function `contractApp()` that chains `new OpenAPIHono().openapi(createRoute(...), handler)` over every route with `handler` typed `never`-returning, never called at runtime
  - `export type DaemonAppType = ReturnType<typeof contractApp>`
  - `createDaemonClient(baseUrl: string, init?: { token?: string; client?: string })`: `hc<DaemonAppType>(baseUrl, { headers })`, setting `X-RT-Token` and `X-RT-Client` when given.

- [ ] **Step 1: Write the failing tests**

`daemon-api-document.test.ts`:
- `test("every route is in the document")`: for each `DAEMON_ROUTES` entry, `doc.paths[route.path][route.method]` exists.
- `test("document is valid OpenAPI 3.1")`: `validate(doc)` from `@scalar/openapi-parser` (add as a devDependency) returns `valid: true`.
- `test("token routes carry the rtToken security requirement")`: `needsToken` (`lib/daemon/api-auth.ts:81`) gates every POST plus `GET /api/secrets` and `GET /api/notifications`. Assert `security: [{ rtToken: [] }]` on exactly those routes and on no other; in the test, derive the expected set from the route table by that rule (rt-client cannot import `needsToken`). Task 3's wire tests separately prove the daemon gates the same set.
- `test("ids are unique")`.

`daemon-api-samples.test.ts`: one representative success body per route, hand-built from the handler's return statement (or copied from an existing handler test's fixture), each asserting `route.success.parse(sample)` does not throw; plus one per shared error schema.

`daemon-api-client.test.ts`: a type-level check that compiles only when inference works, run under tsc:

```ts
const c = createDaemonClient("http://127.0.0.1:1");
type Runs = Awaited<ReturnType<Awaited<ReturnType<typeof c.api.runs.$get>>["json"]>>;
const _x: Equals<Runs, z.infer<(typeof runsListRoute)["success"]>> = true;
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test packages/rt-client/test/daemon-api-*.test.ts`
Expected: FAIL, missing module `../src/daemon-api/index.ts`.

- [ ] **Step 3: Implement the five files and the package wiring**

- [ ] **Step 4: Run the tests, tsc, build and the guards**

Run: `cd packages/rt-client && bun run check-types && bun run build`, then from the root `bun test packages/rt-client/test/daemon-api-*.test.ts packages/rt-client/test/no-zod-in-dist.test.ts packages/rt-client/test/dist-freshness.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock packages/rt-client
git commit -m "rt-client: add daemon-api route table, OpenAPI document and typed client"
```

---

### Task 3: route the daemon's REST requests through Hono

**Files:**
- Create: `lib/daemon/api-app.ts`
- Modify: `lib/daemon/api-server.ts` (the `fetch` body from the CORS block on, `REST_ROUTES` removed; `buildApiIndex` untouched until Task 4)
- Test: `lib/daemon/__tests__/api-app-wire.test.ts`

**Interfaces:**
- Consumes: `DAEMON_ROUTES`, `DaemonRoute` from `@mattstack/rt-client/daemon-api`.
- Produces: `createApiApp(deps: { handleCommand: ApiServerDeps["handleCommand"]; log: Logger; apiToken: string; port: number }): Hono`. `startApiServer`'s `fetch` keeps the `/ws` branch first, then returns `app.fetch(req)`.

Behaviour, in today's order (read `lib/daemon/api-server.ts:430-563` side by side):
1. A `*` middleware computes `trusted` and `corsHeaders` exactly as today and stores them on the context; `OPTIONS` returns 204 with them for any path; then the `needsToken`/`tokenOk` gate returns the 401 body for any path.
2. One Hono handler per `DAEMON_ROUTES` entry on `route.method` + `route.honoPath`, all calling one `dispatch(route, c)` that reproduces today's per-route logic on `new URL(c.req.raw.url)`: the `/api/cache` repo filter, the three parameterized routes via `pathParam`/`repoPathParam`/`splitRepoAndRest` (a `/api/runs/x` shape mismatch falls to the 404), `/api/secrets` token forwarding, `readCommandBody(c.req.raw, route.cmd)` for POST, `coerceQueryParams` for GET, `x-rt-client` → `payload._client`. Every reply is `Response.json(body, { status, headers: corsHeaders })`.
3. `notFound`: if the path matches a route with another method, the 405 body `use <METHOD>`; otherwise the 404 body with `docs`. `GET /` keeps serving `buildApiIndex(port)` for now.
4. `onError`: `log.error({ err, url }, "api request failed")` and the 500 body with `failure: deriveFailure(err)`.

- [ ] **Step 1: Write the failing wire tests**

Start the server as `api-server.test.ts` does (free port, stub `handleCommand` recording calls). Each test asserts status, the full body and the exact `content-type`:
- `test("JSON replies keep today's content-type")`: `GET /api/status` → `content-type` equals what `Response.json({}).headers.get("content-type")` gives in the same process; no header beyond today's set (`content-type`, `content-length`, `date`, the CORS pair when trusted).
- `test("branch with slashes reaches cache:read whole")`: `GET /api/cache/feature/x%2Fy` → `handleCommand("cache:read", { branches: ["feature/x/y"] })`.
- `test("serialized identity survives hooks repair")`: an identity from `serializeIdentity` in the path → `hooks:repair` with that exact string.
- `test("malformed percent-encoding is a 400")`: `GET /api/cache/%E0%A4%A` → 400 `{ok:false,error:"malformed path parameter"}`.
- `test("wrong method on a known path is 405")`: `POST /api/status` → 405 `{ok:false,error:"use GET"}`.
- `test("OPTIONS on an unknown path is 204")`.
- `test("token gate fires before routing")`: `POST /api/shutdown` without the token → 401 `{ok:false,error:"unauthorized"}`, and `handleCommand` not called; `POST /api/nope` without the token is also 401 (gated before the 404); `GET /api/notifications` without the token is 401.
- `test("oversized POST body keeps the 413 body")`: a body over `bodyLimitFor("events:emit")` → 413 with today's body.
- `test("/api/runs/onlyonesegment is a 404")`.
- `test("handler throw is a 500 with failure")`.

- [ ] **Step 2: Run them against today's server to record the baseline**

Run: `bun test lib/daemon/__tests__/api-app-wire.test.ts`
Expected: PASS against the current `Bun.serve` code (these pin today's behaviour; any that fail are a wrong assertion, fix the test). Commit the test alone: `git commit -m "daemon: pin REST wire behaviour before the Hono swap"`.

- [ ] **Step 3: Implement `createApiApp` and swap `fetch` over**

- [ ] **Step 4: Run the wire tests and every existing API test**

Run: `bun test lib/daemon/__tests__/api-app-wire.test.ts lib/daemon/__tests__/api-auth.test.ts lib/daemon/__tests__/api-cache-branch-repo.test.ts lib/daemon/__tests__/api-server-bind.test.ts lib/daemon/__tests__/api-server-broadcast.test.ts lib/daemon/__tests__/api-server-cors-ws.test.ts lib/daemon/__tests__/api-server-park-retry.test.ts lib/daemon/__tests__/api-server-path-param.test.ts lib/daemon/__tests__/api-server-query-coerce.test.ts lib/daemon/__tests__/api-server.test.ts && bun run typecheck`
Expected: all PASS with no edits to the nine existing files.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/api-app.ts lib/daemon/api-server.ts
git commit -m "daemon: route REST requests through Hono"
```

---

### Task 4: `/openapi.json`, `/docs` and the generated index

**Files:**
- Create: `lib/daemon/api-docs.ts`
- Modify: `lib/daemon/api-app.ts` (mount the docs routes), `lib/daemon/api-server.ts` (`buildApiIndex` generated), `lib/daemon.ts` (header comment names `/docs` and `/openapi.json`)
- Test: `lib/daemon/__tests__/api-docs.test.ts`

**Interfaces:**
- Consumes: `buildOpenApiDocument`, `DAEMON_ROUTES`, `WEBSOCKET_EVENTS`.
- Produces in `api-docs.ts`: `docsHtml(): string`, `SCALAR_JS: string` (the embed), `apiIndex(port: number)` returning today's index shape with `endpoints` = every `DAEMON_ROUTES` entry (`method` upper-case, Hono-style `:param` path, `summary` as `description`) plus `GET /docs` and `GET /openapi.json`, `docs: "http://localhost:<port>/docs"`, `websocket_events: WEBSOCKET_EVENTS`, `auth` unchanged.
- Routes: `GET /openapi.json` (document with `serverUrl: http://127.0.0.1:<port>`), `GET /docs` (`text/html; charset=utf-8`), `GET /docs/scalar.js` (`text/javascript; charset=utf-8`, `Cache-Control: max-age=86400`), `GET /` (`apiIndex`). All carry the context's CORS headers.

The embed: `import scalarJs from "../../node_modules/@scalar/api-reference/dist/browser/standalone.js" with { type: "text" };` (verified: Bun refuses the bare specifier because the package's `exports` omit it, and the relative form compiles into a `--compile` binary, adding about 4.6 MB). tsc needs a declaration for the path; add the narrowest one that works and keep a one-line comment saying why the path is relative.

`docsHtml()` loads `/docs/scalar.js` and calls `Scalar.createApiReference` (check the 1.82.0 standalone API) with `url: "/openapi.json"` and the Global Constraints' config.

- [ ] **Step 1: Write the failing tests**

- `test("/openapi.json lists every route")`: fetch it, then every `DAEMON_ROUTES` path/method is present.
- `test("GET / lists every route plus the docs routes")`: the endpoint set equals `DAEMON_ROUTES` plus `/docs` and `/openapi.json`; it includes `/api/usage/run`.
- `test("/docs references only local URLs")`: the HTML contains no `http://` or `https://` at all, its script `src` is `/docs/scalar.js`, and the config contains `withDefaultFonts: false` and `hideClientButton: true` and no `proxyUrl`.
- `test("/docs/scalar.js serves the embedded script")`: 200, JavaScript content type, body length over 1 MB.
- `test("docs routes are not token-gated")`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/daemon/__tests__/api-docs.test.ts`
Expected: FAIL (404s).

- [ ] **Step 3: Implement `api-docs.ts` and mount the routes**

- [ ] **Step 4: Run the docs tests and the wire tests**

Run: `bun test lib/daemon/__tests__/api-docs.test.ts lib/daemon/__tests__/api-app-wire.test.ts lib/daemon/__tests__/api-server.test.ts && bun run typecheck`
Expected: all PASS.

- [ ] **Step 5: Look at it in a browser, both colour schemes**

Start a stub server in the scratchpad: a script that calls `startApiServer({ handleCommand: async () => ({ ok: true, data: {} }), log })` with `RT_API_PORT` set to a free port and `HOME` set to a temp folder. Through Fast Browser, open `http://127.0.0.1:<port>/docs`, screenshot light and dark, and read the network requests. Expected: every request goes to `127.0.0.1:<port>`; the page lists all routes grouped sensibly; try-it on `GET /api/status` returns the stub body. Say plainly anything that reads wrong. Stop the stub server.

- [ ] **Step 6: Commit**

```bash
git add lib/daemon/api-docs.ts lib/daemon/api-app.ts lib/daemon/api-server.ts lib/daemon.ts
git commit -m "daemon: serve /openapi.json, Scalar at /docs and a generated index"
```

---

### Task 5: make typecheck the drift guard on the REST handlers

**Files:**
- Modify: the REST handlers under `lib/daemon/handlers/` that defeat their `CommandResult<K>` type (found in Step 1)
- Test: `lib/daemon/handlers/__tests__/` existing handler tests for usage, runs and the others that have one

**Interfaces:**
- Consumes: Task 1's derived types, Task 2's `DAEMON_ROUTES`.

- [ ] **Step 1: Audit**

For each `DAEMON_ROUTES` command, find its handler and list any `as any`, `as unknown as`, `Promise<any>` return or untyped spread on the path to the returned body. The deliberate carve-outs in `system-processes.ts` and `sdm.ts` stay; note them in the PR description instead.

- [ ] **Step 2: Add real-output contract assertions to the existing handler tests**

In each handler test that already exercises a REST command (usage, runs, reconciler, events, others found in Step 1), add one assertion that the route's `success` schema parses the handler's real return value.

- [ ] **Step 3: Run them**

Run: `bun test <each touched handler test>`
Expected: PASS, or a FAIL that exposes a real schema/handler mismatch: fix the schema to match the wire (the wire is the contract), never the handler's output.

- [ ] **Step 4: Remove the casts found in Step 1, run tsc**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/handlers packages/rt-client
git commit -m "daemon: type REST handlers against the zod-derived results"
```
