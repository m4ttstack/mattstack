import { describe, expect, test } from "bun:test";
import { gitlabTriageForge, walkPipeline, type Command } from "../gitlab-forge.ts";

type Call = { cmd: string; payload: Record<string, unknown>; timeoutMs?: number };
type Reply = { ok: true; data: unknown } | { ok: false; error: string };
type Handler = (payload: Record<string, unknown>) => Reply;

const TARGET = { identity: "gitlab.example/group/app", iid: 7 };
const get = (body: unknown, extra: { truncated?: boolean; nextPage?: number | null } = {}): Reply => ({
  ok: true,
  data: { status: 200, body, truncated: extra.truncated ?? false, nextPage: extra.nextPage ?? null, totalPages: null },
});
const notFound: Reply = { ok: false, error: "GitLab returned 404 Not Found: {}" };

function fake(routes: Record<string, Handler>): { command: Command; calls: Call[] } {
  const calls: Call[] = [];
  const command = (async (cmd: string, payload: Record<string, unknown>, opts?: { timeoutMs?: number }) => {
    calls.push({ cmd, payload, timeoutMs: opts?.timeoutMs });
    const key = cmd === "forge:get" ? `forge:get ${payload.path as string}` : cmd;
    const handler = routes[key];
    if (!handler) return { ok: false, error: `unrouted ${key}` };
    return handler(payload);
  }) as unknown as Command;
  return { command, calls };
}

const job = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, stage: "test", status: "failed", allow_failure: false, retried: false, web_url: `https://gl/jobs/${id}`, ...extra,
});
const bridge = (name: string, downstream: { id: number; project_id: number; status?: string } | null, extra: Record<string, unknown> = {}) => ({
  name, status: "failed", allow_failure: false, pipeline: { project_id: 1 },
  downstream_pipeline: downstream && { status: "failed", web_url: `https://gl/pipelines/${downstream.id}`, ...downstream }, ...extra,
});
const pipelineInfo = (id: number) => get({ id, status: "failed", web_url: `https://gl/pipelines/${id}`, sha: "abc", ref: "feat", project_id: 1 });

const P = "/projects/:id/pipelines";

describe("walkPipeline", () => {
  test("returns null when the pipeline is a 404, throws for any other failure", async () => {
    const missing = fake({ [`forge:get ${P}/5`]: () => notFound });
    expect(await walkPipeline(missing.command, TARGET, 5)).toBeNull();
    const broken = fake({ [`forge:get ${P}/5`]: () => ({ ok: false, error: "GitLab returned 500 Internal Server Error" }) });
    await expect(walkPipeline(broken.command, TARGET, 5)).rejects.toThrow("GitLab 500 reading pipeline 5");
  });

  test("also reads a 404 reported as a forge:get status", async () => {
    const { command } = fake({ [`forge:get ${P}/5`]: () => ({ ok: true, data: { status: 404, body: {}, truncated: false, nextPage: null, totalPages: null } }) });
    expect(await walkPipeline(command, TARGET, 5)).toBeNull();
  });

  test("follows nextPage across two pages with the first page size and query", async () => {
    const { command, calls } = fake({
      [`forge:get ${P}/5`]: () => pipelineInfo(5),
      [`forge:get ${P}/5/jobs`]: (p) => (p.page === 1 ? get([job(1, "a")], { nextPage: 2 }) : get([job(2, "b")])),
      [`forge:get ${P}/5/bridges`]: () => get([]),
    });
    const walk = await walkPipeline(command, TARGET, 5, { scope: "failed" });
    expect(walk?.jobs.map((j) => j.jobId)).toEqual([1, 2]);
    const jobCalls = calls.filter((c) => c.payload.path === `${P}/5/jobs`);
    expect(jobCalls.map((c) => [c.payload.page, c.payload.perPage])).toEqual([[1, 50], [2, 50]]);
    expect(jobCalls[0]?.payload.query).toEqual({ include_retried: true });
    expect(jobCalls[0]?.payload.repoName).toBe(TARGET.identity);
  });

  test("re-reads a truncated page at half the size", async () => {
    const { command, calls } = fake({
      [`forge:get ${P}/5`]: () => pipelineInfo(5),
      [`forge:get ${P}/5/jobs`]: (p) => (p.perPage === 50 ? get("cut", { truncated: true }) : get([job(1, "a")])),
      [`forge:get ${P}/5/bridges`]: () => get([]),
    });
    const walk = await walkPipeline(command, TARGET, 5);
    expect(walk?.jobs).toHaveLength(1);
    const sizes = calls.filter((c) => c.payload.path === `${P}/5/jobs`).map((c) => c.payload.perPage);
    expect(sizes).toEqual([50, 25]);
  });

  test("throws when a page is still truncated at 5 per page", async () => {
    const { command, calls } = fake({
      [`forge:get ${P}/5`]: () => pipelineInfo(5),
      [`forge:get ${P}/5/jobs`]: () => get("cut", { truncated: true }),
    });
    await expect(walkPipeline(command, TARGET, 5)).rejects.toThrow("GitLab job page still over the 256 KiB read cap at 5 per page");
    const sizes = calls.filter((c) => c.payload.path === `${P}/5/jobs`).map((c) => c.payload.perPage);
    expect(sizes).toEqual([50, 25, 12, 6, 5]);
  });

  test("walks a same-project child once and keeps its pipelineId on every row", async () => {
    const { command, calls } = fake({
      [`forge:get ${P}/5`]: () => pipelineInfo(5),
      [`forge:get ${P}/5/jobs`]: () => get([job(1, "root-job")]),
      [`forge:get ${P}/5/bridges`]: () => get([bridge("child", { id: 6, project_id: 1 }), bridge("child-again", { id: 6, project_id: 1 })]),
      [`forge:get ${P}/6/jobs`]: () => get([job(2, "child-job")]),
      [`forge:get ${P}/6/bridges`]: () => get([]),
    });
    const walk = await walkPipeline(command, TARGET, 5);
    expect(walk?.jobs.map((j) => [j.jobId, j.pipelineId, j.allowFailure])).toEqual([[1, 5, false], [2, 6, false]]);
    expect(calls.filter((c) => c.payload.path === `${P}/6/jobs`)).toHaveLength(1);
    expect(walk?.bridges.map((b) => b.crossProject)).toEqual([false, false]);
  });

  test("does not walk a cross-project bridge and flags it", async () => {
    const { command, calls } = fake({
      [`forge:get ${P}/5`]: () => pipelineInfo(5),
      [`forge:get ${P}/5/jobs`]: () => get([]),
      [`forge:get ${P}/5/bridges`]: () => get([bridge("deploy", { id: 90, project_id: 2 })]),
    });
    const walk = await walkPipeline(command, TARGET, 5);
    expect(walk?.bridges[0]).toMatchObject({ crossProject: true, downstream: { projectId: 2, pipelineId: 90 } });
    expect(calls.some((c) => String(c.payload.path).includes("/90"))).toBe(false);
  });

  test("marks rows under an allow_failure or success bridge as allowFailure", async () => {
    const { command } = fake({
      [`forge:get ${P}/5`]: () => pipelineInfo(5),
      [`forge:get ${P}/5/jobs`]: () => get([]),
      [`forge:get ${P}/5/bridges`]: () =>
        get([bridge("optional", { id: 6, project_id: 1 }, { allow_failure: true }), bridge("done", { id: 7, project_id: 1 }, { status: "success" }), bridge("hard", { id: 8, project_id: 1 })]),
      [`forge:get ${P}/6/jobs`]: () => get([job(10, "j6")]),
      [`forge:get ${P}/6/bridges`]: () => get([bridge("grandchild", { id: 9, project_id: 1 })]),
      [`forge:get ${P}/7/jobs`]: () => get([job(11, "j7")]),
      [`forge:get ${P}/7/bridges`]: () => get([]),
      [`forge:get ${P}/8/jobs`]: () => get([job(12, "j8")]),
      [`forge:get ${P}/8/bridges`]: () => get([]),
      [`forge:get ${P}/9/jobs`]: () => get([job(13, "j9")]),
      [`forge:get ${P}/9/bridges`]: () => get([]),
    });
    const walk = await walkPipeline(command, TARGET, 5);
    const byName = Object.fromEntries((walk?.jobs ?? []).map((j) => [j.name, j.allowFailure]));
    expect(byName).toEqual({ j6: true, j7: true, j8: false, j9: true });
  });

  test("keeps the latest run of a retried job and counts the attempt", async () => {
    const { command } = fake({
      [`forge:get ${P}/5`]: () => pipelineInfo(5),
      [`forge:get ${P}/5/jobs`]: () => get([job(2, "lint"), job(1, "lint", { retried: true }), job(3, "unit")]),
      [`forge:get ${P}/5/bridges`]: () => get([]),
    });
    const walk = await walkPipeline(command, TARGET, 5);
    expect(walk?.jobs.map((j) => [j.name, j.jobId, j.attempt])).toEqual([["lint", 2, 2], ["unit", 3, 1]]);
  });

  test("under a scope, attempt still counts every earlier run and only scoped rows return", async () => {
    const { command } = fake({
      [`forge:get ${P}/5`]: () => pipelineInfo(5),
      [`forge:get ${P}/5/jobs`]: () =>
        get([job(2, "lint"), job(1, "lint", { status: "canceled", retried: true }), job(3, "unit", { status: "success" })]),
      [`forge:get ${P}/5/bridges`]: () => get([]),
    });
    const walk = await walkPipeline(command, TARGET, 5, { scope: "failed" });
    expect(walk?.jobs.map((j) => [j.name, j.jobId, j.attempt])).toEqual([["lint", 2, 2]]);
  });

  test("name filters by substring", async () => {
    const { command } = fake({
      [`forge:get ${P}/5`]: () => pipelineInfo(5),
      [`forge:get ${P}/5/jobs`]: () => get([job(1, "rspec-unit"), job(2, "lint"), job(3, "rspec-e2e")]),
      [`forge:get ${P}/5/bridges`]: () => get([]),
    });
    const walk = await walkPipeline(command, TARGET, 5, { name: "spec" });
    expect(walk?.jobs.map((j) => j.name)).toEqual(["rspec-unit", "rspec-e2e"]);
  });
});

describe("gitlabTriageForge", () => {
  test("failedJobs returns scope=failed jobs plus failed cross-project bridges as BridgeRow", async () => {
    const { command, calls } = fake({
      [`forge:get ${P}/5`]: () => pipelineInfo(5),
      [`forge:get ${P}/5/jobs`]: () => get([job(1, "unit")]),
      [`forge:get ${P}/5/bridges`]: () =>
        get([
          bridge("deploy", { id: 90, project_id: 2 }),
          bridge("optional-deploy", { id: 91, project_id: 2 }, { allow_failure: true }),
          bridge("passed-deploy", { id: 92, project_id: 2 }, { status: "success" }),
        ]),
    });
    const failed = await gitlabTriageForge(command, TARGET).failedJobs(5);
    expect(failed?.jobs.map((j) => j.jobId)).toEqual([1]);
    expect(failed?.crossProject).toEqual([
      { name: "deploy", status: "failed", blocking: true, downstream: { projectId: 2, pipelineId: 90, webUrl: "https://gl/pipelines/90" } },
      { name: "optional-deploy", status: "failed", blocking: false, downstream: { projectId: 2, pipelineId: 91, webUrl: "https://gl/pipelines/91" } },
    ]);
    expect(calls.find((c) => c.payload.path === `${P}/5/jobs`)?.payload.query).toEqual({ include_retried: true });
  });

  test("failedJobs keeps a failed bridge with no downstream pipeline, blocking unless allow_failure", async () => {
    const { command } = fake({
      [`forge:get ${P}/5`]: () => pipelineInfo(5),
      [`forge:get ${P}/5/jobs`]: () => get([]),
      [`forge:get ${P}/5/bridges`]: () =>
        get([bridge("trigger", null), bridge("optional-trigger", null, { allow_failure: true }), bridge("pending-trigger", null, { status: "running" })]),
    });
    const failed = await gitlabTriageForge(command, TARGET).failedJobs(5);
    expect(failed?.crossProject).toEqual([
      { name: "trigger", status: "failed", blocking: true, downstream: null },
      { name: "optional-trigger", status: "failed", blocking: false, downstream: null },
    ]);
  });

  test("failedJobs reports a failed same-project bridge whose child has no failed job", async () => {
    const { command } = fake({
      [`forge:get ${P}/5`]: () => pipelineInfo(5),
      [`forge:get ${P}/5/jobs`]: () => get([]),
      [`forge:get ${P}/5/bridges`]: () =>
        get([
          bridge("bad-config-child", { id: 60, project_id: 1 }),
          bridge("optional-child", { id: 61, project_id: 1 }, { allow_failure: true }),
          bridge("child-with-failure", { id: 62, project_id: 1 }),
        ]),
      [`forge:get ${P}/60/jobs`]: () => get([]),
      [`forge:get ${P}/60/bridges`]: () => get([]),
      [`forge:get ${P}/61/jobs`]: () => get([]),
      [`forge:get ${P}/61/bridges`]: () => get([]),
      [`forge:get ${P}/62/jobs`]: () => get([job(3, "unit")]),
      [`forge:get ${P}/62/bridges`]: () => get([]),
    });
    const failed = await gitlabTriageForge(command, TARGET).failedJobs(5);
    expect(failed?.jobs.map((j) => j.jobId)).toEqual([3]);
    expect(failed?.crossProject).toEqual([
      { name: "bad-config-child", status: "failed", blocking: true, downstream: { projectId: 1, pipelineId: 60, webUrl: "https://gl/pipelines/60" } },
    ]);
  });

  test("walk under a non-failed scope leaves a bridge whose child has a failed job out of emptyFailedBridges", async () => {
    const { command } = fake({
      [`forge:get ${P}/5`]: () => pipelineInfo(5),
      [`forge:get ${P}/5/jobs`]: () => get([]),
      [`forge:get ${P}/5/bridges`]: () => get([bridge("child-with-failure", { id: 62, project_id: 1 })]),
      [`forge:get ${P}/62/jobs`]: () => get([job(3, "unit"), job(4, "lint", { status: "success" })]),
      [`forge:get ${P}/62/bridges`]: () => get([]),
    });
    const walk = await walkPipeline(command, TARGET, 5, { scope: "success" });
    expect(walk?.jobs.map((j) => j.jobId)).toEqual([4]);
    expect(walk?.emptyFailedBridges).toEqual([]);
  });

  test("failedJobs marks an empty failed bridge under an allow_failure parent non-blocking", async () => {
    const { command } = fake({
      [`forge:get ${P}/5`]: () => pipelineInfo(5),
      [`forge:get ${P}/5/jobs`]: () => get([]),
      [`forge:get ${P}/5/bridges`]: () => get([bridge("optional-parent", { id: 70, project_id: 1 }, { allow_failure: true })]),
      [`forge:get ${P}/70/jobs`]: () => get([]),
      [`forge:get ${P}/70/bridges`]: () => get([bridge("bad-config-grandchild", { id: 71, project_id: 1 })]),
      [`forge:get ${P}/71/jobs`]: () => get([]),
      [`forge:get ${P}/71/bridges`]: () => get([]),
    });
    const failed = await gitlabTriageForge(command, TARGET).failedJobs(5);
    expect(failed?.crossProject).toEqual([
      { name: "bad-config-grandchild", status: "failed", blocking: false, downstream: { projectId: 1, pipelineId: 71, webUrl: "https://gl/pipelines/71" } },
    ]);
  });

  test("failedJobs is null for a missing pipeline", async () => {
    const { command } = fake({ [`forge:get ${P}/5`]: () => notFound });
    expect(await gitlabTriageForge(command, TARGET).failedJobs(5)).toBeNull();
  });

  test("pipelinesForRef drops schedule, external and parent_pipeline before cutting to the limit", async () => {
    const row = (id: number, source: string | null) => ({ id, status: "failed", ref: "main", sha: null, source, webUrl: `https://gl/pipelines/${id}`, createdAt: null });
    const { command, calls } = fake({
      "pipeline:list": () => ({ ok: true, data: { pipelines: [row(9, "schedule"), row(8, "external"), row(7, "parent_pipeline"), row(6, "push"), row(5, null), row(4, "web")] } }),
    });
    const rows = await gitlabTriageForge(command, TARGET).pipelinesForRef("main", 2);
    expect(rows).toEqual([
      { id: 6, status: "failed", webUrl: "https://gl/pipelines/6" },
      { id: 5, status: "failed", webUrl: "https://gl/pipelines/5" },
    ]);
    expect(calls[0]?.payload).toEqual({ repoName: TARGET.identity, ref: "main", limit: 20 });
  });

  test("pipelinesForRef is null on a 404 and throws on other failures", async () => {
    expect(await gitlabTriageForge(fake({ "pipeline:list": () => notFound }).command, TARGET).pipelinesForRef("main", 5)).toBeNull();
    const broken = fake({ "pipeline:list": () => ({ ok: false, error: "GitLab returned 503 Service Unavailable" }) });
    await expect(gitlabTriageForge(broken.command, TARGET).pipelinesForRef("main", 5)).rejects.toThrow("503");
  });

  test("pipelineInfo maps the pipeline, null on 404, throws on 500", async () => {
    const ok = fake({ [`forge:get ${P}/5`]: () => pipelineInfo(5) });
    expect(await gitlabTriageForge(ok.command, TARGET).pipelineInfo(5)).toEqual({ id: 5, status: "failed", webUrl: "https://gl/pipelines/5", sha: "abc", ref: "feat" });
    expect(await gitlabTriageForge(fake({ [`forge:get ${P}/5`]: () => notFound }).command, TARGET).pipelineInfo(5)).toBeNull();
    const broken = fake({ [`forge:get ${P}/5`]: () => ({ ok: false, error: "GitLab returned 500 Internal Server Error" }) });
    await expect(gitlabTriageForge(broken.command, TARGET).pipelineInfo(5)).rejects.toThrow("GitLab 500 reading pipeline 5");
  });

  test("trace returns the text, and maps a daemon failure to ok:false", async () => {
    const { command, calls } = fake({ "mr:fetch-job-trace": (p) => (p.jobId === 1 ? { ok: true, data: "log text" } : { ok: false, error: "job gone" }) });
    const forge = gitlabTriageForge(command, TARGET);
    expect(await forge.trace(1)).toEqual({ ok: true, text: "log text" });
    expect(await forge.trace(2)).toEqual({ ok: false, error: "job gone" });
    expect(calls[0]).toEqual({ cmd: "mr:fetch-job-trace", payload: { repoName: TARGET.identity, iid: 7, jobId: 1 }, timeoutMs: 60_000 });
  });

  test("defaultBranch reads the project, null when absent", async () => {
    expect(await gitlabTriageForge(fake({ "forge:get /projects/:id": () => get({ default_branch: "main" }) }).command, TARGET).defaultBranch()).toBe("main");
    expect(await gitlabTriageForge(fake({ "forge:get /projects/:id": () => get({}) }).command, TARGET).defaultBranch()).toBeNull();
  });

  test("infraPatterns is the registry pattern", () => {
    expect(gitlabTriageForge(fake({}).command, TARGET).infraPatterns()).toEqual(["registry.gitlab.com.*error"]);
  });
});
