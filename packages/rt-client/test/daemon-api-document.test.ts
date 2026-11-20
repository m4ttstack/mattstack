import { describe, expect, test } from "bun:test";
import { validate } from "@scalar/openapi-parser";
import { DAEMON_ROUTES, buildOpenApiDocument } from "../src/daemon-api/index.ts";

const doc = buildOpenApiDocument();

function operation(route: (typeof DAEMON_ROUTES)[number]): Record<string, unknown> | undefined {
  const item = doc.paths?.[route.path] as Record<string, Record<string, unknown>> | undefined;
  return item?.[route.method];
}

// The rule lib/daemon/api-auth.ts's needsToken applies; rt-client cannot import it.
function gatedByToken(route: (typeof DAEMON_ROUTES)[number]): boolean {
  return route.method === "post" || route.path === "/api/secrets" || route.path === "/api/notifications";
}

describe("buildOpenApiDocument", () => {
  test("every route is in the document", () => {
    for (const route of DAEMON_ROUTES) {
      expect(operation(route), `${route.method.toUpperCase()} ${route.path}`).toBeDefined();
    }
  });

  test("document is valid OpenAPI 3.1", async () => {
    expect(doc.openapi).toBe("3.1.0");
    const result = await validate(structuredClone(doc) as unknown as Record<string, unknown>);
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);

    // The recursive process tree is a named component referencing itself.
    const processNode = doc.components?.schemas?.ProcessNode as { properties?: Record<string, unknown> } | undefined;
    expect(processNode).toBeDefined();
    expect(processNode?.properties?.children).toEqual({ type: "array", items: { $ref: "#/components/schemas/ProcessNode" } });
    expect(JSON.stringify(doc.paths?.["/api/processes/system"])).toContain('"$ref":"#/components/schemas/ProcessNode"');
  });

  test("token routes carry the rtToken security requirement", () => {
    expect(doc.components?.securitySchemes?.rtToken).toMatchObject({ type: "apiKey", in: "header", name: "X-RT-Token" });
    const gated = DAEMON_ROUTES.filter(gatedByToken).map((r) => r.id);
    expect(gated).toContain("secrets.read");
    expect(gated).toContain("notifications.drain");
    for (const route of DAEMON_ROUTES) {
      expect(route.token, route.id).toBe(gatedByToken(route));
      const security = operation(route)?.security;
      if (gatedByToken(route)) expect(security, route.id).toEqual([{ rtToken: [] }]);
      else expect(security, route.id).toBeUndefined();
    }
  });

  test("ids are unique", () => {
    const ids = DAEMON_ROUTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
