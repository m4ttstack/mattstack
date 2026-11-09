import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as linearModule from "../linear.ts";
import { refreshAllMRs } from "../enrich.ts";

let requests: { url: string; authorization: string | null }[];
let spies: { mockRestore(): void }[];

beforeEach(() => {
  requests = [];
  spies = [
    spyOn(linearModule, "loadSecrets").mockResolvedValue({ gitlabToken: "glpat-secret" } as never),
    spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      requests.push({ url: String(input instanceof Request ? input.url : input), authorization: headers.get("Authorization") });
      return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch),
  ];
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
});

test("background enrichment sends nothing to a gitlab-looking host nobody confirmed", async () => {
  await refreshAllMRs([{ path: "/nonexistent/tree", branch: "feature" }], "https://gitlab.evil.example/acme/widgets.git");
  expect(requests.filter((r) => r.url.includes("gitlab.evil.example"))).toEqual([]);
});

test("background enrichment still sends the token to gitlab.com", async () => {
  await refreshAllMRs([{ path: "/nonexistent/tree", branch: "feature" }], "git@gitlab.com:acme/widgets.git");
  expect(requests.some((r) => r.url.startsWith("https://gitlab.com/") && r.authorization === "Bearer glpat-secret")).toBe(true);
});
