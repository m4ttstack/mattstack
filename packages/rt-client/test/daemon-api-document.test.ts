import { describe, expect, test } from "bun:test";
import { validate } from "@scalar/openapi-parser";
import { DAEMON_ROUTES, buildOpenApiDocument } from "../src/daemon-api/index.ts";

const doc = buildOpenApiDocument();

function operation(route: (typeof DAEMON_ROUTES)[number]): Record<string, unknown> | undefined {
  const item = doc.paths?.[route.path] as Record<string, Record<string, unknown>> | undefined;
  return item?.[route.method];
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
    // lib/daemon/__tests__/api-route-token-gate.test.ts ties `route.token` to the daemon's real gate.
    for (const route of DAEMON_ROUTES) {
      const security = operation(route)?.security;
      if (route.token) expect(security, route.id).toEqual([{ rtToken: [] }]);
      else expect(security, route.id).toBeUndefined();
    }
  });

  type Parameter = { in: string; name: string; required?: boolean; description?: string };
  const parameters = (route: (typeof DAEMON_ROUTES)[number]) => (operation(route)?.parameters ?? []) as Parameter[];

  test("generic routes document the optional X-RT-Client header; special routes read none", () => {
    for (const route of DAEMON_ROUTES) {
      const header = parameters(route).find((p) => p.in === "header" && p.name === "X-RT-Client");
      if (route.kind === "generic") {
        expect(header, route.id).toBeDefined();
        expect(header!.required ?? false, route.id).toBe(false);
        expect(header!.description, route.id).toContain("_client");
      } else {
        expect(header, route.id).toBeUndefined();
      }
    }
  });

  test("every path parameter tells the caller to percent-encode it", () => {
    let seen = 0;
    for (const route of DAEMON_ROUTES) {
      for (const p of parameters(route).filter((p) => p.in === "path")) {
        seen++;
        expect(p.description, `${route.id} ${p.name}`).toContain("encodeURIComponent");
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  test("runs.get and hooks.repair document the 404 a wrong-shaped path answers", () => {
    const with404 = DAEMON_ROUTES.filter((route) => {
      const responses = operation(route)?.responses as Record<string, unknown>;
      return responses["404"] !== undefined;
    }).map((route) => route.id);
    expect(with404.sort()).toEqual(["hooks.repair", "runs.get"]);
    for (const id of with404) {
      const route = DAEMON_ROUTES.find((r) => r.id === id)!;
      expect((operation(route)?.responses as Record<string, unknown>)["404"]).toEqual({ $ref: "#/components/responses/NotFound" });
      expect(operation(route)?.description as string, id).toContain("404");
    }
  });

  test("ids are unique", () => {
    const ids = DAEMON_ROUTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every operation has exactly one tag, listed at the top level", () => {
    const listed = (doc.tags ?? []).map((t) => t.name);
    expect(new Set(listed).size).toBe(listed.length);
    for (const tag of doc.tags ?? []) expect(tag.description, tag.name).toBeTruthy();
    const used = new Set<string>();
    for (const route of DAEMON_ROUTES) {
      const tags = operation(route)?.tags as string[] | undefined;
      expect(tags, route.id).toHaveLength(1);
      expect(listed, route.id).toContain(tags![0]!);
      used.add(tags![0]!);
    }
    expect([...used].sort()).toEqual([...listed].sort());
  });
});
