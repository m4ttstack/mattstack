import { describe, expect, test } from "bun:test";
import { mrReadToolDefs, tailTrace, type MrReadDeps } from "../mr-read-tools.ts";

const pr = (iid: number, state: string, draft = false) => ({
  iid, state, draft, sourceBranch: `b${iid}`, targetBranch: "main", title: `t${iid}`, description: "long body",
  author: { id: "gitlab:1", username: "alice", name: "Alice", avatarUrl: null },
  webUrl: `https://gitlab.com/acme/acme-dev/-/merge_requests/${iid}`, detailedMergeStatus: "mergeable",
  pipeline: { status: "success", id: "gitlab:pipeline:9", jobs: [] },
});

type Call = { name: string; payload: Record<string, unknown> };

function fake(answers: Record<string, unknown> = {}): { deps: MrReadDeps; calls: Call[] } {
  const calls: Call[] = [];
  const deps: MrReadDeps = {
    command: (async (name: string, payload: Record<string, unknown>) => {
      calls.push({ name, payload });
      const a = answers[name];
      if (a instanceof Error) return { ok: false, error: a.message };
      return { ok: true, data: a };
    }) as any,
  };
  return { deps, calls };
}
const tool = (deps: MrReadDeps, name: string) => mrReadToolDefs(deps).find((t) => t.name === name)!;
// Targeting is exercised in mr-target.test.ts; here every call passes an identity so resolveMrTarget succeeds without a registry.
const ID = "remote:gitlab.com%2Facme%2Facme-dev";

describe("mr read tools ask GitLab, never the cache", () => {
  test("no tool sends project-mrs:read, mr:by-branch or discussions:read", async () => {
    const { deps, calls } = fake({
      "mr:get": { mr: pr(2, "merged"), fetchedAt: 5 },
      "mr:list-live": { mrs: [], truncated: false },
      "mr:live-by-branch": { byBranch: {} },
      "discussions:refresh": { discussions: [], fetchedAt: 5 },
    });
    await tool(deps, "mr_view").handler({ repoName: ID, iid: 2 }, {} as NodeJS.ProcessEnv);
    await tool(deps, "mr_list").handler({ repoName: ID }, {} as NodeJS.ProcessEnv);
    await tool(deps, "mr_for_branch").handler({ repoName: ID, branches: ["b"] }, {} as NodeJS.ProcessEnv);
    await tool(deps, "mr_threads").handler({ repoName: ID, iid: 2 }, {} as NodeJS.ProcessEnv);
    await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 2 }, {} as NodeJS.ProcessEnv);
    expect(calls.map((c) => c.name)).toEqual(["mr:get", "mr:list-live", "mr:live-by-branch", "discussions:refresh", "mr:get"]);
  });

  test("mr_view returns a merged MR by another author", async () => {
    const { deps, calls } = fake({ "mr:get": { mr: pr(2, "merged"), fetchedAt: 5 } });
    const res = await tool(deps, "mr_view").handler({ repoName: ID, iid: 2 }, {} as NodeJS.ProcessEnv);
    expect(res).toMatchObject({ ok: true, body: { mr: { iid: 2, state: "merged" }, fetchedAt: 5 } });
    expect(calls[0]!.payload).toEqual({ repoName: ID, iid: 2 });
  });

  test("mr_view passes GitLab's refusal through", async () => {
    const { deps } = fake({ "mr:get": new Error("GitLab returned 403 Forbidden: no access") });
    const res = await tool(deps, "mr_view").handler({ repoName: ID, iid: 9 }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("GitLab returned 403 Forbidden");
    expect(res.error).not.toContain("cache");
  });

  test("the old maxAgeMs and refresh arguments are accepted and not sent", async () => {
    const { deps, calls } = fake({ "mr:get": { mr: pr(1, "opened"), fetchedAt: 1 }, "mr:list-live": { mrs: [], truncated: false }, "discussions:refresh": { discussions: [], fetchedAt: 1 } });
    expect((await tool(deps, "mr_view").handler({ repoName: ID, iid: 1, maxAgeMs: 5000 }, {} as NodeJS.ProcessEnv)).ok).toBe(true);
    expect((await tool(deps, "mr_list").handler({ repoName: ID, maxAgeMs: 5000, state: "opened" }, {} as NodeJS.ProcessEnv)).ok).toBe(true);
    expect((await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 1, maxAgeMs: 5000 }, {} as NodeJS.ProcessEnv)).ok).toBe(true);
    expect((await tool(deps, "mr_threads").handler({ repoName: ID, iid: 1, refresh: true }, {} as NodeJS.ProcessEnv)).ok).toBe(true);
    for (const c of calls) expect(c.payload).not.toHaveProperty("maxAgeMs");
  });

  test("mr_list sends its filters and reports truncation", async () => {
    const { deps, calls } = fake({ "mr:list-live": { mrs: [{ iid: 1 }], truncated: true } });
    const res = await tool(deps, "mr_list").handler({ repoName: ID, author: "me", sourceBranch: "feat", state: "all", search: "refund", limit: 10 }, {} as NodeJS.ProcessEnv);
    expect(res.body).toEqual({ mrs: [{ iid: 1 }], truncated: true });
    expect(calls[0]!.payload).toEqual({ repoName: ID, author: "me", sourceBranch: "feat", state: "all", search: "refund", limit: 10 });
  });

  test("mr_list by targetBranch keeps full, true only when nothing was cut", async () => {
    const whole = fake({ "mr:list-live": { mrs: [], truncated: false } });
    expect((await tool(whole.deps, "mr_list").handler({ repoName: ID, targetBranch: "feat" }, {} as NodeJS.ProcessEnv)).body).toEqual({ mrs: [], truncated: false, targetBranch: "feat", full: true });
    const cut = fake({ "mr:list-live": { mrs: [], truncated: true } });
    expect((await tool(cut.deps, "mr_list").handler({ repoName: ID, targetBranch: "feat" }, {} as NodeJS.ProcessEnv)).body).toMatchObject({ full: false });
  });

  test("mr_list rejects a bad state and a non-string filter", async () => {
    const { deps } = fake();
    expect((await tool(deps, "mr_list").handler({ repoName: ID, state: "weird" }, {} as NodeJS.ProcessEnv)).error).toContain('"state" must be one of');
    expect((await tool(deps, "mr_list").handler({ repoName: ID, author: 3 }, {} as NodeJS.ProcessEnv)).error).toBe('"author" must be a string');
  });

  test("mr_list refuses a filter that is blank after trimming, before any daemon call", async () => {
    for (const field of ["targetBranch", "sourceBranch", "author", "search"]) {
      const { deps, calls } = fake({ "mr:list-live": { mrs: [], truncated: false } });
      const res = await tool(deps, "mr_list").handler({ repoName: ID, [field]: "  " }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain(`"${field}"`);
      expect(res.error).toContain("blank");
      expect(calls).toEqual([]);
    }
  });

  test("mr_for_branch keeps its entry shape and marks the source forge", async () => {
    const { deps } = fake({ "mr:live-by-branch": { byBranch: { feat: pr(9, "opened"), none: null } } });
    const res = await tool(deps, "mr_for_branch").handler({ repoName: ID, branches: ["feat", "none"] }, {} as NodeJS.ProcessEnv);
    expect(res.body).toMatchObject({ byBranch: { feat: { pr: { iid: 9 }, source: "forge" }, none: null } });
  });

  test("mr_threads always refreshes", async () => {
    const { deps, calls } = fake({ "discussions:refresh": { discussions: [{ id: "d1" }], fetchedAt: 7 } });
    const res = await tool(deps, "mr_threads").handler({ repoName: ID, iid: 2 }, {} as NodeJS.ProcessEnv);
    expect(res.body).toEqual({ discussions: [{ id: "d1" }], fetchedAt: 7, stale: false });
    expect(calls.map((c) => c.name)).toEqual(["discussions:refresh"]);
  });

  test("mr_pipeline returns the live MR's head pipeline", async () => {
    const { deps } = fake({ "mr:get": { mr: pr(2, "opened"), fetchedAt: 5 } });
    const res = await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 2 }, {} as NodeJS.ProcessEnv);
    expect(res.body).toEqual({ pipeline: { status: "success", id: "gitlab:pipeline:9", jobs: [] } });
  });

  test("an unfiltered mr_list carrying maxAgeMs is the legacy stack-check call: 200 rows, syncedAt, never a partial list", async () => {
    const whole = fake({ "mr:list-live": { mrs: [{ iid: 1 }], truncated: false } });
    const res = await tool(whole.deps, "mr_list").handler({ repoName: ID, maxAgeMs: 5000 }, {} as NodeJS.ProcessEnv);
    expect(whole.calls[0]!.payload).toEqual({ repoName: ID, limit: 200 });
    expect(res.body).toMatchObject({ mrs: [{ iid: 1 }], truncated: false });
    expect(typeof (res.body as any).syncedAt).toBe("number");
    const cut = fake({ "mr:list-live": { mrs: [], truncated: true } });
    const refused = await tool(cut.deps, "mr_list").handler({ repoName: ID, maxAgeMs: 5000 }, {} as NodeJS.ProcessEnv);
    expect(refused.error).toBe("more than 200 open MRs; pass sourceBranch or targetBranch to read the ones that matter");
  });

  test("maxAgeMs with a filter is an ordinary call", async () => {
    const { deps, calls } = fake({ "mr:list-live": { mrs: [], truncated: false } });
    const res = await tool(deps, "mr_list").handler({ repoName: ID, maxAgeMs: 5000, sourceBranch: "feat" }, {} as NodeJS.ProcessEnv);
    expect(calls[0]!.payload).toEqual({ repoName: ID, sourceBranch: "feat" });
    expect(res.body).toEqual({ mrs: [], truncated: false });
  });
});

const withPipeline = (pipeline: unknown) => ({ mr: { ...pr(1, "opened"), pipeline }, fetchedAt: 1 });

describe("mr_pipeline job detail", () => {
  test("replaces a trace job's log with a pointer to mr_job_trace", async () => {
    const { deps, calls } = fake({ "mr:get": withPipeline(pr(1, "opened").pipeline), "mr:fetch-job-detail": { type: "trace", content: "full log" } });
    const res = await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv);
    expect((res.body as any).pipeline.status).toBe("success");
    expect((res.body as any).job).toEqual({ type: "trace", traceVia: "mr_job_trace" });
    expect(JSON.stringify(res.body)).not.toContain("full log");
    expect(calls.map((c) => c.name)).toEqual(["mr:get", "mr:fetch-job-detail"]);
  });
  test("passes a bridge job's detail through unchanged", async () => {
    const bridge = { type: "bridge", downstreamPipeline: { id: "gitlab:pipeline:10", status: "failed", createdAt: null, webUrl: null, jobs: [] } };
    const { deps } = fake({ "mr:get": withPipeline(pr(1, "opened").pipeline), "mr:fetch-job-detail": bridge });
    const res = await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv);
    expect((res.body as any).job).toEqual(bridge);
  });
  test("passes sha, ref and mergeRequestEventType through unchanged", async () => {
    const { deps } = fake({ "mr:get": withPipeline({ ...pr(1, "opened").pipeline, sha: "abc", ref: "feat", mergeRequestEventType: null }) });
    const res = await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 1 }, {} as NodeJS.ProcessEnv);
    expect((res.body as any).pipeline).toMatchObject({ sha: "abc", ref: "feat", mergeRequestEventType: null });
  });
  test("sends the head pipeline's numeric id as pipelineId", async () => {
    const { deps, calls } = fake({ "mr:get": withPipeline(pr(1, "opened").pipeline), "mr:fetch-job-detail": { type: "trace", content: "" } });
    await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv);
    expect(calls[1]!.payload).toEqual({ repoName: ID, iid: 1, jobId: 7, pipelineId: 9 });
  });
  test("omits pipelineId when the MR has no pipeline or a non-numeric id", async () => {
    for (const pipeline of [null, { status: "success", id: "gitlab:pipeline:abc", jobs: [] }]) {
      const { deps, calls } = fake({ "mr:get": withPipeline(pipeline), "mr:fetch-job-detail": { type: "trace", content: "" } });
      await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv);
      expect(calls[1]!.payload).toEqual({ repoName: ID, iid: 1, jobId: 7 });
    }
  });
});

describe("mr job trace", () => {
  test("mr_job_trace says grep results are always truncated", () => {
    const { deps } = fake();
    expect(tool(deps, "mr_job_trace").description).toContain("always true for grep results");
  });

  test("mr_pipeline and mr_job_trace descriptions say jobId is not checked against the MR", () => {
    const { deps } = fake();
    for (const name of ["mr_pipeline", "mr_job_trace"]) {
      expect(tool(deps, name).description).toContain("may name any job in the MR's project");
    }
  });
  test("mr_job_trace returns the trace text with its line count", async () => {
    const { deps } = fake({ "mr:fetch-job-trace": "log text" });
    const res = await tool(deps, "mr_job_trace").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv);
    expect(res.body).toEqual({ trace: "log text", truncated: false, totalLines: 1 });
  });
  test("mr_job_trace keeps the last tailLines lines, default 200, and strips ANSI sequences", async () => {
    const raw = Array.from({ length: 250 }, (_, i) => `\x1b[32;1mline ${i}\x1b[0m`).join("\n") + "\n";
    const { deps } = fake({ "mr:fetch-job-trace": raw });
    const byDefault = (await tool(deps, "mr_job_trace").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv)).body as any;
    expect(byDefault.totalLines).toBe(250);
    expect(byDefault.truncated).toBe(true);
    expect(byDefault.trace.split("\n")).toHaveLength(200);
    expect(byDefault.trace.startsWith("line 50\n")).toBe(true);
    expect(byDefault.trace).not.toContain("\x1b");
    const three = (await tool(deps, "mr_job_trace").handler({ repoName: ID, iid: 1, jobId: 7, tailLines: 3 }, {} as NodeJS.ProcessEnv)).body as any;
    expect(three).toEqual({ trace: "line 247\nline 248\nline 249", truncated: true, totalLines: 250 });
  });
  test("mr_job_trace strips OSC sequences ended by BEL or ST", () => {
    const out = tailTrace("\x1b]0;title\x07a\n\x1b]8;;https://x\x1b\\b\x1b]8;;\x1b\\", 200);
    expect(out.trace).toBe("a\nb");
  });
  test("mr_job_trace caps the kept lines at 64 KiB from the end on a whole character", () => {
    const line = "é".repeat(1000);
    const out = tailTrace(Array.from({ length: 100 }, () => line).join("\n"), 200);
    expect(out.truncated).toBe(true);
    expect(out.totalLines).toBe(100);
    expect(Buffer.byteLength(out.trace, "utf8")).toBeLessThanOrEqual(64 * 1024);
    expect(out.trace).not.toContain("�");
    expect(out.trace.endsWith(line)).toBe(true);
  });
  test("mr_job_trace refuses a non-positive or fractional tailLines before any daemon call", async () => {
    const { deps, calls } = fake();
    for (const tailLines of [0, -5, 2.5, "10"]) {
      const res = await tool(deps, "mr_job_trace").handler({ repoName: ID, iid: 1, jobId: 7, tailLines }, {} as NodeJS.ProcessEnv);
      expect(res.error).toBe('"tailLines" must be a positive integer');
    }
    expect(calls).toEqual([]);
  });
  test("mr_job_trace refuses a non-positive jobId", async () => {
    const { deps, calls } = fake();
    const res = await tool(deps, "mr_job_trace").handler({ repoName: ID, iid: 1, jobId: 0 }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("mr_job_trace modes", () => {
  const text = Array.from({ length: 300 }, (_, i) => `l${i + 1}`).join("\n");
  const run = async (input: Record<string, unknown>) => {
    const { deps } = fake({ "mr:fetch-job-trace": text });
    return tool(deps, "mr_job_trace").handler({ repoName: ID, iid: 1, jobId: 5, ...input }, {} as NodeJS.ProcessEnv);
  };
  test("no mode is the 200-line tail", async () => {
    expect(((await run({})).body as any).trace.split("\n").length).toBe(200);
  });
  test("headLines reads the start", async () => {
    expect(((await run({ headLines: 2 })).body as any).trace).toBe("l1\nl2");
  });
  test("fromLine with lineCount reads a range", async () => {
    expect(((await run({ fromLine: 10, lineCount: 2 })).body as any).trace).toBe("l10\nl11");
  });
  test("grep returns numbered matches", async () => {
    expect(((await run({ grep: "l299", contextLines: 0 })).body as any).trace).toBe("299: l299");
  });
  test("two modes at once are refused", async () => {
    expect((await run({ headLines: 2, grep: "x" })).error).toBe("pass one of tailLines, headLines, fromLine or grep");
  });
  test("lineCount without fromLine is refused", async () => {
    expect((await run({ lineCount: 5 })).error).toBe('"lineCount" needs "fromLine"');
  });
});
