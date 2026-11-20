/**
 * The daemon's self-description: the index at `/`, the OpenAPI document at
 * `/openapi.json` and the Scalar viewer at `/docs`, which loads its script
 * from the daemon so the page reaches nothing outside it.
 *
 * The document builder (with `@hono/zod-openapi`) and the Scalar bundle load
 * on first request, so a daemon nobody asks for docs never holds them.
 */

import { API_VERSION, DAEMON_ROUTES, WEBSOCKET_EVENTS } from "../../packages/rt-client/src/daemon-api/routes.ts";
import type { OpenAPI31Document } from "../../packages/rt-client/src/daemon-api/document.ts";

// Pinned to the installed package by api-docs.test.ts; reading its package.json
// here would make daemon boot load the Scalar package.
export const SCALAR_VERSION = "1.82.0";

let openApiDocument: Promise<OpenAPI31Document> | undefined;

export function openApiJson(): Promise<OpenAPI31Document> {
  openApiDocument ??= import("../../packages/rt-client/src/daemon-api/document.ts")
    .then((m) => m.buildOpenApiDocument())
    .catch((err) => {
      openApiDocument = undefined;
      throw err;
    });
  return openApiDocument;
}

let scalarBytes: Promise<Uint8Array> | undefined;

export function scalarJs(): Promise<Uint8Array> {
  scalarBytes ??= import("./api-docs-scalar.ts")
    .then((m) => new TextEncoder().encode(m.SCALAR_JS))
    .catch((err) => {
      scalarBytes = undefined;
      throw err;
    });
  return scalarBytes;
}

const DOCS_ROUTES = [
  { method: "GET", path: "/docs", description: "This API's reference, rendered by Scalar" },
  { method: "GET", path: "/openapi.json", description: "This API's OpenAPI 3.1 document" },
];

export function apiIndex(port: number) {
  return {
    name: "rt daemon",
    version: API_VERSION,
    docs: `http://localhost:${port}/docs`,
    websocket: `ws://localhost:${port}/ws`,
    endpoints: [
      ...DAEMON_ROUTES.map((route) => ({
        method: route.method.toUpperCase(),
        path: route.path.replace(/\{([^}]+)\}/g, ":$1"),
        description: route.summary,
      })),
      ...DOCS_ROUTES,
    ],
    websocket_events: WEBSOCKET_EVENTS,
    auth: {
      header: "X-RT-Token",
      description: "Required on mutating routes (shutdown, sdm reconnect, events emit) and /api/secrets. Token at ~/.mattstack/rt/api-token.",
    },
  };
}

// The page may be opened as localhost, where Scalar turns on its agent chat,
// MCP panel and developer tools unless told not to; each of those talks to
// scalar.com.
export function docsHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>rt daemon API</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="/docs/scalar.js?v=${SCALAR_VERSION}"></script>
    <script>
      Scalar.createApiReference("#app", {
        url: "/openapi.json",
        withDefaultFonts: false,
        hideClientButton: true,
        telemetry: false,
        showDeveloperTools: "never",
        agent: { disabled: true },
        mcp: { disabled: true },
      });
    </script>
  </body>
</html>
`;
}
