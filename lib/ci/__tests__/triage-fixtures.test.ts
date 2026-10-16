import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runTriage, type JobVerdict, type TriageInput, type TriageReport } from "../triage.ts";
import { mergeConfig, type InlineConfig, type TriageConfig } from "../triage-config.ts";
import { fixtureForge, resolveRef } from "./fixture-forge.ts";

const FIXTURES = join(import.meta.dir, "../../../plugins/mattstack/attachments/pipeline/stage-watch-ci/tests/fixtures");
const SCEN = join(FIXTURES, "scenarios");
const VERDICTS = join(SCEN, "verdicts");
const OWNERSHIP = join(SCEN, "ownership");

const emptyConfig: TriageConfig = {
  realPatterns: [],
  infraPatterns: [],
  noisyJobs: [],
  baseDepth: 3,
  baseRef: null,
  skipBase: false,
};

function config(inline?: InlineConfig): TriageConfig {
  const out = mergeConfig(emptyConfig, inline);
  if ("error" in out) throw new Error(out.error);
  return out;
}

const ownershipConfig = config({ "noisy-jobs": ["flaky:screenshot"], "real-patterns": ["MY_TEAM_MARKER"], "base-depth": 2 });

interface Run {
  scenario: string;
  defaultBranch?: string | null;
  pipeline?: number;
  ref?: string;
  base?: string;
  noBase?: boolean;
  config?: TriageConfig;
  failWith?: string;
}

async function triageResult(run: Run): Promise<TriageReport | { error: string }> {
  const resolved = run.ref ? resolveRef(run.scenario, run.ref) : { pipelineId: null, targetBranch: null };
  const pipelineId = run.pipeline ?? resolved.pipelineId;
  if (pipelineId === null) throw new Error(`no pipeline for ref ${run.ref}`);
  const input: TriageInput = {
    pipelineId,
    targetBranch: resolved.targetBranch,
    config: run.config ?? emptyConfig,
    ...(run.base !== undefined ? { base: run.base } : {}),
    ...(run.noBase ? { noBase: true } : {}),
  };
  const forge = fixtureForge(run.scenario, {
    defaultBranch: run.defaultBranch === undefined ? "main" : run.defaultBranch,
    ...(run.failWith ? { failWith: run.failWith } : {}),
  });
  return runTriage(forge, input);
}

async function triage(run: Run): Promise<TriageReport> {
  const out = await triageResult(run);
  if ("error" in out) throw new Error(out.error);
  return out;
}

function all(r: TriageReport): JobVerdict[] {
  return [...r.blocking, ...r.nonBlocking];
}

function job(r: TriageReport, name: string): JobVerdict {
  const found = all(r).find((j) => j.name === name);
  if (!found) throw new Error(`no job ${name}`);
  return found;
}

describe("verdicts", () => {
  test("real-verdict", async () => {
    const r = await triage({ scenario: VERDICTS, pipeline: 21, noBase: true });
    expect(all(r).some((j) => j.verdict === "REAL")).toBe(true);
  });

  test("infra-verdict", async () => {
    const r = await triage({ scenario: VERDICTS, pipeline: 21, noBase: true });
    expect(all(r).some((j) => j.verdict === "INFRA")).toBe(true);
  });

  test("unclear-verdict", async () => {
    const r = await triage({ scenario: VERDICTS, pipeline: 21, noBase: true });
    expect(all(r).some((j) => j.verdict === "UNCLEAR")).toBe(true);
  });

  test("blocking-section", async () => {
    const r = await triage({ scenario: VERDICTS, pipeline: 21, noBase: true });
    expect(r.blocking.map((j) => j.name)).toEqual(["typecheck", "integration", "flaky"]);
    expect(r.blocking.every((j) => j.blocking)).toBe(true);
  });

  test("nonblocking-section", async () => {
    const r = await triage({ scenario: VERDICTS, pipeline: 21, noBase: true });
    expect(r.nonBlocking.map((j) => j.name)).toEqual(["lint"]);
    expect(r.nonBlocking[0]?.blocking).toBe(false);
  });

  test("real-beats-infra", async () => {
    const r = await triage({ scenario: VERDICTS, pipeline: 22, noBase: true });
    expect(all(r).some((j) => j.verdict === "REAL")).toBe(true);
  });

  test("exclusion-filter-lower", async () => {
    const r = await triage({ scenario: VERDICTS, pipeline: 23, noBase: true });
    expect(all(r).some((j) => j.verdict === "UNCLEAR")).toBe(true);
    expect(all(r).some((j) => j.verdict === "REAL")).toBe(false);
  });

  test("exclusion-filter-mixed", async () => {
    const r = await triage({ scenario: VERDICTS, pipeline: 24, noBase: true });
    expect(all(r).some((j) => j.verdict === "UNCLEAR")).toBe(true);
    expect(all(r).some((j) => j.verdict === "REAL")).toBe(false);
  });

  test("exclusion-keeps-mixed", async () => {
    const r = await triage({ scenario: VERDICTS, pipeline: 27, noBase: true });
    expect(all(r).some((j) => j.verdict === "REAL")).toBe(true);
  });

  test("exclusion-keeps-zero-errors", async () => {
    const r = await triage({ scenario: VERDICTS, pipeline: 28, noBase: true });
    expect(all(r).some((j) => j.verdict === "REAL")).toBe(true);
  });

  test("ansi-real", async () => {
    const r = await triage({ scenario: VERDICTS, pipeline: 25, noBase: true });
    expect(all(r).some((j) => j.verdict === "REAL")).toBe(true);
  });

  test("ansi-stripped", async () => {
    const r = await triage({ scenario: VERDICTS, pipeline: 25, noBase: true });
    const unit = job(r, "unit");
    expect(unit.traceTail.length).toBeGreaterThan(0);
    for (const text of [unit.traceTail, ...unit.realHits, ...unit.infraHits]) {
      expect(text.includes("\x1b")).toBe(false);
    }
  });

  test("infra-hits-alongside-real", async () => {
    const r = await triage({ scenario: VERDICTS, pipeline: 26, noBase: true });
    const mixed = job(r, "mixed-lines");
    expect(mixed.verdict).toBe("REAL");
    expect(mixed.realHits.some((l) => l.includes("error TS1234"))).toBe(true);
    expect(mixed.infraHits.some((l) => l.includes("ECONNRESET"))).toBe(true);
  });

  test("header-weburl", async () => {
    const r = await triage({ scenario: VERDICTS, pipeline: 21, noBase: true });
    expect(r.pipeline.webUrl).toBe("https://fake/pipelines/21");
  });
});

describe("errors", () => {
  test("bogus-pipeline-rc4", async () => {
    const out = await triageResult({ scenario: VERDICTS, pipeline: 404404 });
    expect(out).toEqual({ error: "pipeline 404404 not found" });
  });

  test("bogus-pipeline-stderr", async () => {
    const out = await triageResult({ scenario: VERDICTS, pipeline: 404404 });
    expect("error" in out && out.error.includes("404404")).toBe(true);
  });

  test("bogus-pipeline-quiet", async () => {
    const out = await triageResult({ scenario: VERDICTS, pipeline: 404404 });
    expect("blocking" in out).toBe(false);
  });

  test("adapter-fail-rc5", async () => {
    const out = await triageResult({ scenario: VERDICTS, pipeline: 21, failWith: "fake-forge: unauthenticated" });
    expect("error" in out).toBe(true);
    expect("blocking" in out).toBe(false);
  });

  test("adapter-fail-relayed", async () => {
    const out = await triageResult({ scenario: VERDICTS, pipeline: 21, failWith: "fake-forge: unauthenticated" });
    expect("error" in out && out.error.includes("unauthenticated")).toBe(true);
  });
});

describe("ownership and config", () => {
  test("inherited", async () => {
    const r = await triage({ scenario: OWNERSHIP, ref: "feat-y", config: ownershipConfig });
    expect(all(r).some((j) => j.ownership === "INHERITED")).toBe(true);
  });

  test("yours", async () => {
    const r = await triage({ scenario: OWNERSHIP, ref: "feat-y", config: ownershipConfig });
    expect(all(r).some((j) => j.ownership === "yours" && j.ownershipNote === "not failing on base")).toBe(true);
  });

  test("config-real-extends", async () => {
    const r = await triage({ scenario: OWNERSHIP, ref: "feat-y", config: ownershipConfig });
    expect(all(r).some((j) => j.realHits.some((l) => l.includes("MY_TEAM_MARKER")))).toBe(true);
  });

  test("noisy-flag", async () => {
    const r = await triage({ scenario: OWNERSHIP, ref: "feat-y", config: ownershipConfig });
    expect(all(r).some((j) => j.noisy)).toBe(true);
    expect(r.summary.noisy).toEqual(["flaky:screenshot"]);
  });

  test("schedule-excluded-from-window", async () => {
    const r = await triage({ scenario: OWNERSHIP, ref: "feat-y", config: ownershipConfig });
    const app = job(r, "test:app");
    expect(app.ownership).toBe("INHERITED");
    expect(app.ownershipNote).toBe("also failing on main");
  });

  test("no-base-flag", async () => {
    const r = await triage({ scenario: OWNERSHIP, ref: "feat-y", noBase: true });
    expect(all(r).filter((j) => j.ownershipNote === "base comparison off")).toHaveLength(3);
    expect(r.base.off).toBe(true);
  });

  test("no-base-flag-clean", async () => {
    const r = await triage({ scenario: OWNERSHIP, ref: "feat-y", noBase: true });
    expect(all(r).some((j) => j.ownership === "INHERITED")).toBe(false);
  });

  test("base-flag-overrides", async () => {
    const r = await triage({
      scenario: OWNERSHIP,
      defaultBranch: "other",
      ref: "feat-y",
      base: "other",
      config: config({ "base-ref": "wrongbase" }),
    });
    expect(all(r).some((j) => j.ownershipNote === "also failing on other")).toBe(true);
    expect(r.base.refs).toEqual(["other"]);
  });

  test("base-lookup-failed", async () => {
    const r = await triage({ scenario: OWNERSHIP, defaultBranch: "blind-base", ref: "feat-blind" });
    const blind = job(r, "test:blind");
    expect(blind.ownership).toBe("UNKNOWN");
    expect(blind.ownershipNote).toBe("no base pipelines scanned");
    expect(r.base.scanned).toBe(0);
  });

  test("self-excluded", async () => {
    const r = await triage({ scenario: OWNERSHIP, defaultBranch: "feat-self", ref: "feat-self" });
    const self = job(r, "test:self");
    expect(self.ownership).toBe("yours");
    expect(self.ownershipNote).toBe("not failing on base");
    expect(r.base.scanned).toBe(1);
  });

  test("unknown-when-no-base-pipelines", async () => {
    const r = await triage({ scenario: OWNERSHIP, defaultBranch: "orphan-base", ref: "feat-orphan" });
    const orphan = job(r, "test:orphan");
    expect(orphan.ownership).toBe("UNKNOWN");
    expect(orphan.ownershipNote).toBe("no base pipelines scanned");
  });

  test("infra-patterns-appended", async () => {
    const r = await triage({ scenario: OWNERSHIP, ref: "feat-infra", noBase: true });
    const svc = job(r, "svc:call");
    expect(svc.verdict).toBe("INFRA");
    expect(svc.infraHits.some((l) => l.includes("FAKE_REGISTRY_DOWN"))).toBe(true);
  });

  const exampleConfig = (): TriageConfig =>
    config(JSON.parse(readFileSync(join(FIXTURES, "example-domain-config.json"), "utf8")) as InlineConfig);

  test("example-fixture-noisy", async () => {
    const r = await triage({ scenario: OWNERSHIP, ref: "feat-fixture", config: exampleConfig(), noBase: true });
    const flagged = all(r).find((j) => j.jobId === 601);
    expect(flagged?.blocking).toBe(false);
    expect(flagged?.noisy).toBe(true);
  });

  test("example-fixture-infra", async () => {
    const r = await triage({ scenario: OWNERSHIP, ref: "feat-fixture", config: exampleConfig(), noBase: true });
    expect(all(r).some((j) => j.verdict === "INFRA")).toBe(true);
  });

  test("default-branch-fallback", async () => {
    const r = await triage({ scenario: OWNERSHIP, defaultBranch: null, ref: "feat-fallback" });
    expect(all(r).some((j) => j.inheritedOn.includes("master"))).toBe(true);
    expect(r.base.refs).toEqual(["master"]);
  });

  test("ownership-index-ere-metachar", async () => {
    const r = await triage({ scenario: OWNERSHIP, ref: "feat-plus" });
    const plus = job(r, "test+coverage");
    expect(plus.ownership).toBe("INHERITED");
    expect(plus.inheritedOn).toEqual(["main"]);
  });

  test("pipeline-and-ref-together", async () => {
    const r = await triage({ scenario: OWNERSHIP, pipeline: 31, ref: "feat-y" });
    const app = job(r, "test:app");
    expect(app.ownership).toBe("INHERITED");
    expect(app.ownershipNote).toBe("also failing on main");
  });
});

describe("fixtureForge", () => {
  test("resolveRef falls back to the unfiltered first row", () => {
    expect(resolveRef(VERDICTS, "sched")).toEqual({ pipelineId: 30, targetBranch: null });
  });

  test("resolveRef reads the target branch", () => {
    expect(resolveRef(OWNERSHIP, "feat-y")).toEqual({ pipelineId: 31, targetBranch: "main" });
  });

  test("pipelinesForRef drops schedule rows before the limit and is null for an unknown ref", async () => {
    const forge = fixtureForge(OWNERSHIP, { defaultBranch: "main" });
    expect((await forge.pipelinesForRef("main", 1))?.map((p) => p.id)).toEqual([29]);
    expect(await forge.pipelinesForRef("no-such-ref", 5)).toBeNull();
  });
});
