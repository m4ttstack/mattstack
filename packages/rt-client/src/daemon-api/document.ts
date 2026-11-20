import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { FailureEnvelopeSchema } from "./envelopes.ts";
import { API_VERSION, DAEMON_ROUTES, ROUTE_TAGS, WEBSOCKET_EVENTS, type DaemonRoute } from "./routes.ts";
import { SHARED_RESPONSES, sharedResponsesFor } from "./shared-responses.ts";

export type OpenAPI31Document = ReturnType<OpenAPIHono["getOpenAPI31Document"]>;

// Every 200 references this, so the generator emits it as a component; the
// generator ignores zod schemas handed to registerComponent, so the other
// shared schemas are registered as JSON Schema instead.
const FAILURE = FailureEnvelopeSchema.meta({ id: "Failure" });

function description(): string {
  const events = WEBSOCKET_EVENTS.map((e) => `- \`${e.type}\`: ${e.description}`).join("\n");
  return [
    "The rt daemon's local HTTP API.",
    "",
    "Live updates stream over the WebSocket at `/ws`, which this document does not describe. Each frame is `{ type, data, timestamp }`, with these types:",
    "",
    events,
    "",
    "A path no route serves answers 404 with the shared not-found body.",
  ].join("\n");
}

export function buildOpenApiDocument(): OpenAPI31Document {
  const app = new OpenAPIHono();
  const registry = app.openAPIRegistry;

  registry.registerComponent("securitySchemes", "rtToken", {
    type: "apiKey",
    in: "header",
    name: "X-RT-Token",
    description: "The token at `~/.mattstack/rt/api-token`.",
  });

  for (const [name, shared] of Object.entries(SHARED_RESPONSES)) {
    if (shared.schema !== FailureEnvelopeSchema) {
      const { $schema: _, ...schema } = z.toJSONSchema(shared.schema, { io: "input" });
      registry.registerComponent("schemas", name, schema as Record<string, unknown>);
    }
    registry.registerComponent("responses", name, {
      description: shared.description,
      content: { "application/json": { schema: { $ref: `#/components/schemas/${name}` } } },
    });
  }

  for (const route of DAEMON_ROUTES as readonly DaemonRoute[]) {
    const responses: Record<string, { $ref: string } | { description: string; content: object }> = {
      200: {
        description: "Answered. A handler that refuses or throws also answers 200, with the failure body.",
        content: { "application/json": { schema: z.union([route.success, FAILURE]) } },
      },
    };
    for (const name of sharedResponsesFor(route)) {
      responses[SHARED_RESPONSES[name].status] = { $ref: `#/components/responses/${name}` };
    }

    registry.registerPath({
      method: route.method,
      path: route.path,
      operationId: route.id,
      summary: route.summary,
      ...(route.tag ? { tags: [route.tag] } : {}),
      ...(route.description ? { description: route.description } : {}),
      ...(route.token ? { security: [{ rtToken: [] }] } : {}),
      request: {
        ...(route.request.query ? { query: route.request.query } : {}),
        ...(route.request.params ? { params: route.request.params } : {}),
        ...(route.request.body
          ? { body: { required: false, content: { "application/json": { schema: route.request.body } } } }
          : {}),
      },
      responses,
    });
  }

  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "rt daemon", version: API_VERSION, description: description() },
    servers: [{ url: "/" }],
    tags: ROUTE_TAGS.map((tag) => ({ ...tag })),
  });
}
