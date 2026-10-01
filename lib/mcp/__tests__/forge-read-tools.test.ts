import { describe, expect, test } from "bun:test";
import { forgeReadToolDefs } from "../forge-read-tools.ts";

const ID = "remote:gitlab.com%2Facme%2Facme-dev";
type Call = { name: string; payload: Record<string, unknown> };
function fake(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  const command = (async (name: string, payload: Record<string, unknown>) => {
    calls.push({ name, payload });
    const a = answers[name];
    return a instanceof Error ? { ok: false, error: a.message } : { ok: true, data: a };
  }) as any;
  const tool = (name: string) => forgeReadToolDefs({ command }).find((t) => t.name === name)!;
  return { calls, tool };
}

describe("forge read tools", () => {
  test("project_labels passes search and returns labels", async () => {
    const { calls, tool } = fake({ "project:labels": { labels: [{ name: "preview-acme", description: null, color: null }] } });
    const res = await tool("project_labels").handler({ repoName: ID, search: "preview" }, {} as NodeJS.ProcessEnv);
    expect(res.body).toEqual({ labels: [{ name: "preview-acme", description: null, color: null }] });
    expect(calls[0]).toEqual({ name: "project:labels", payload: { repoName: ID, search: "preview" } });
  });

  test("pipeline_list needs no MR and passes ref, sha, iid and limit", async () => {
    const { calls, tool } = fake({ "pipeline:list": { pipelines: [] } });
    await tool("pipeline_list").handler({ repoName: ID, ref: "feat", limit: 5 }, {} as NodeJS.ProcessEnv);
    expect(calls[0]!.payload).toEqual({ repoName: ID, ref: "feat", limit: 5 });
    expect((await tool("pipeline_list").handler({ repoName: ID, iid: 0 }, {} as NodeJS.ProcessEnv)).error).toBe('"iid" must be a positive integer');
  });

  test("pipeline_list refuses iid with ref or sha before any daemon call, and says so in its description", async () => {
    const { calls, tool } = fake({ "pipeline:list": { pipelines: [] } });
    for (const extra of [{ ref: "feat" }, { sha: "abc" }]) {
      const res = await tool("pipeline_list").handler({ repoName: ID, iid: 3, ...extra }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("cannot be combined");
    }
    expect(calls).toEqual([]);
    expect(tool("pipeline_list").description).toContain("iid cannot be combined with ref or sha");
  });

  test("gitlab_get has no method input and passes path, query and paging", async () => {
    const { calls, tool } = fake({ "forge:get": { status: 200, body: [], truncated: false, nextPage: null, totalPages: 1 } });
    const def = tool("gitlab_get");
    expect(Object.keys((def.inputSchema as any).properties).sort()).toEqual(["mrUrl", "page", "path", "perPage", "query", "repoName"]);
    const res = await def.handler({ repoName: ID, path: "projects/:id/merge_requests/12/commits", query: { order: "asc" }, page: 2 }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(true);
    expect(calls[0]!.payload).toEqual({ repoName: ID, path: "projects/:id/merge_requests/12/commits", query: { order: "asc" }, page: 2 });
    expect((await def.handler({ repoName: ID }, {} as NodeJS.ProcessEnv)).error).toBe('"path" is required');
  });

  test("a daemon refusal is the tool's error", async () => {
    const { tool } = fake({ "forge:get": new Error('"path" names variables, which can return credentials; gitlab_get refuses it') });
    const res = await tool("gitlab_get").handler({ repoName: ID, path: "projects/:id/variables" }, {} as NodeJS.ProcessEnv);
    expect(res.error).toContain("gitlab_get refuses it");
  });
});
