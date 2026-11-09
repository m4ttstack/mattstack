import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as linearModule from "../linear.ts";
import { refreshAllMRs } from "../enrich.ts";

let urls: string[];
let spies: { mockRestore(): void }[];

beforeEach(() => {
  urls = [];
  spies = [
    spyOn(linearModule, "loadSecrets").mockResolvedValue({ gitlabToken: "glpat-secret" } as never),
    spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
      urls.push(String(input instanceof Request ? input.url : input));
      return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch),
  ];
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
});

test("background enrichment sends nothing to a gitlab-looking host nobody confirmed", async () => {
  await refreshAllMRs([{ path: "/nonexistent/tree", branch: "feature" }], "https://gitlab.evil.example/acme/widgets.git");
  expect(urls.filter((u) => u.includes("gitlab.evil.example"))).toEqual([]);
});

test("background enrichment still asks gitlab.com", async () => {
  await refreshAllMRs([{ path: "/nonexistent/tree", branch: "feature" }], "git@gitlab.com:acme/widgets.git");
  expect(urls.some((u) => u.startsWith("https://gitlab.com/"))).toBe(true);
});
