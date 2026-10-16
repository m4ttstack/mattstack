import { describe, expect, test } from "bun:test";
import { runTriage, type BridgeRow, type ForgeJob, type TriageForge, type TriageReport } from "../triage.ts";
import type { TriageConfig } from "../triage-config.ts";

const emptyConfig: TriageConfig = {
  realPatterns: [],
  infraPatterns: [],
  noisyJobs: [],
  baseDepth: 3,
  baseRef: null,
  skipBase: false,
};

function job(jobId: number, name: string, allowFailure = false): ForgeJob {
  return { pipelineId: 1, jobId, name, stage: "test", status: "failed", allowFailure, attempt: 1, webUrl: null };
}

const bridge: BridgeRow = {
  name: "deploy:downstream",
  status: "failed",
  blocking: true,
  downstream: { projectId: 7, pipelineId: 70, webUrl: null },
};

function memoryForge(opts: {
  jobs: ForgeJob[];
  traces: Record<number, string | null>;
  crossProject?: BridgeRow[];
}): TriageForge {
  return {
    pipelinesForRef: async () => null,
    pipelineInfo: async (id) => ({ id, status: "failed", webUrl: null, sha: null, ref: null }),
    failedJobs: async (id) => (id === 1 ? { jobs: opts.jobs, crossProject: opts.crossProject ?? [] } : null),
    trace: async (jobId) => {
      const text = opts.traces[jobId];
      return typeof text === "string" ? { ok: true, text } : { ok: false, error: `trace ${jobId} unreadable` };
    },
    defaultBranch: async () => "main",
    infraPatterns: () => [],
  };
}

async function run(forge: TriageForge, onProgress?: () => void): Promise<TriageReport> {
  const out = await runTriage(forge, { pipelineId: 1, targetBranch: null, noBase: true, config: emptyConfig }, { onProgress });
  if ("error" in out) throw new Error(out.error);
  return out;
}

describe("runTriage", () => {
  test("a trace that cannot be read is UNCLEAR and still counted as blocking", async () => {
    const r = await run(memoryForge({ jobs: [job(10, "unit")], traces: { 10: null } }));
    const [unit] = r.blocking;
    expect(unit?.verdict).toBe("UNCLEAR");
    expect(unit?.traceAvailable).toBe(false);
    expect(unit?.traceError).toBe("trace 10 unreadable");
    expect(unit?.traceTail).toBe("");
    expect(r.summary.blocking).toBe(1);
  });

  test("allInfraBlocking is true when every blocking job is INFRA", async () => {
    const r = await run(memoryForge({ jobs: [job(10, "a"), job(11, "b")], traces: { 10: "ECONNRESET", 11: "ETIMEDOUT" } }));
    expect(r.summary.allInfraBlocking).toBe(true);
  });

  test("allInfraBlocking is false when one blocking job is UNCLEAR", async () => {
    const r = await run(memoryForge({ jobs: [job(10, "a"), job(11, "b")], traces: { 10: "ECONNRESET", 11: "odd" } }));
    expect(r.summary.allInfraBlocking).toBe(false);
  });

  test("allInfraBlocking is false when a cross-project bridge is blocking", async () => {
    const r = await run(
      memoryForge({ jobs: [job(10, "a"), job(11, "b")], traces: { 10: "ECONNRESET", 11: "ETIMEDOUT" }, crossProject: [bridge] }),
    );
    expect(r.summary.allInfraBlocking).toBe(false);
  });

  test("a blocking bridge with no downstream pipeline reports in crossProject and blocks allInfraBlocking", async () => {
    const orphan: BridgeRow = { name: "trigger", status: "failed", blocking: true, downstream: null };
    const r = await run(memoryForge({ jobs: [job(10, "a")], traces: { 10: "ECONNRESET" }, crossProject: [orphan] }));
    expect(r.crossProject).toEqual([orphan]);
    expect(r.summary.allInfraBlocking).toBe(false);
  });

  test("allInfraBlocking is false with no blocking jobs", async () => {
    const r = await run(memoryForge({ jobs: [job(10, "a", true)], traces: { 10: "ECONNRESET" } }));
    expect(r.summary.blocking).toBe(0);
    expect(r.summary.allInfraBlocking).toBe(false);
  });

  test("cross-project rows pass through to the report", async () => {
    const r = await run(memoryForge({ jobs: [], traces: {}, crossProject: [bridge] }));
    expect(r.crossProject).toEqual([bridge]);
  });

  test("onProgress fires once per trace read", async () => {
    let calls = 0;
    await run(
      memoryForge({ jobs: [job(10, "a"), job(11, "b"), job(12, "c", true)], traces: { 10: "x", 11: null, 12: "y" } }),
      () => {
        calls += 1;
      },
    );
    expect(calls).toBe(3);
  });

  test("hits carry no escape bytes, while classification still reads them SGR-stripped", async () => {
    const text = "\x1b[0K\x1b[31msrc/a.ts error TS1234: bad\x1b[0m\x1b[0K\n\x1b[0Knpm ERR ECONNRESET\x1b[0K\n";
    const r = await run(memoryForge({ jobs: [job(10, "a")], traces: { 10: text } }));
    const [a] = r.blocking;
    expect(a?.verdict).toBe("REAL");
    expect(a?.realHits).toEqual(["src/a.ts error TS1234: bad"]);
    expect(a?.infraHits).toEqual(["npm ERR ECONNRESET"]);
  });

  test("the trace tail keeps the last 40 lines", async () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
    const r = await run(memoryForge({ jobs: [job(10, "a")], traces: { 10: text } }));
    const lines = r.blocking[0]?.traceTail.split("\n") ?? [];
    expect(lines[0]).toBe("line 11");
    expect(lines.at(-1)).toBe("line 50");
  });
});
