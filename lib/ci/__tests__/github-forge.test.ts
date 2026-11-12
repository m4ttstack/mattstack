import { describe, expect, test } from "bun:test";
import type { Pipeline, PipelineJob } from "@mattstack/glance";
import {
  GITHUB_INFRA_PATTERNS,
  buildHead,
  emptyFacts,
  requiredNames,
  restJobStatus,
  type GithubCommitFacts,
} from "../github-forge.ts";

function job(name: string, status: string, over: Partial<PipelineJob> = {}): PipelineJob {
  return {
    id: `github:check:${name.length * 11}`,
    name,
    stage: "checks",
    status,
    allowFailure: false,
    duration: null,
    webUrl: null,
    runId: "5",
    ...over,
  };
}

function pipeline(jobs: PipelineJob[], over: Partial<Pipeline> = {}): Pipeline {
  return {
    id: "github:run:5",
    status: "pending",
    sha: "abc",
    ref: "feature",
    createdAt: null,
    webUrl: "https://github.com/o/r/pull/1/checks",
    jobs,
    ...over,
  };
}

function facts(over: Partial<GithubCommitFacts> = {}): GithubCommitFacts {
  return { ...emptyFacts(), ...over };
}

describe("restJobStatus", () => {
  test.each([
    ["completed", "success", "success"],
    ["completed", "neutral", "success"],
    ["completed", "failure", "failed"],
    ["completed", "timed_out", "failed"],
    ["completed", "stale", "failed"],
    ["completed", "startup_failure", "failed"],
    ["completed", "cancelled", "canceled"],
    ["completed", "skipped", "skipped"],
    ["completed", "action_required", "manual"],
    ["in_progress", null, "running"],
    ["queued", null, "pending"],
  ])("%s / %s -> %s", (status, conclusion, want) => {
    expect(restJobStatus(status, conclusion)).toBe(want);
  });
});

describe("requiredNames", () => {
  test("joins rulesets and classic protection, deduped and sorted", () => {
    const rules = [
      { type: "required_status_checks", parameters: { required_status_checks: [{ context: "checks" }] } },
      { type: "pull_request" },
    ];
    const branch = { protection: { required_status_checks: { contexts: ["lint", "checks"] } } };
    expect(requiredNames(rules, branch)).toEqual(["checks", "lint"]);
  });

  test("an unprotected branch with no rules has none", () => {
    expect(requiredNames([], { protected: false })).toEqual([]);
  });

  test("non-object bodies have none", () => {
    expect(requiredNames(null, "x")).toEqual([]);
    expect(requiredNames({}, 7)).toEqual([]);
    expect(requiredNames(undefined, undefined)).toEqual([]);
  });
});

describe("buildHead blocking and status", () => {
  test("a required check that has not reported keeps the head pending and an optional red check does not block", () => {
    const head = buildHead(
      pipeline([job("lint", "failed", { allowFailure: true }), job("build", "success")]),
      facts({ required: ["checks"] }),
    );
    expect(head.status).toBe("pending");
    expect(head.jobs.find((j) => j.name === "lint")?.blocking).toBe(false);
    expect(head.allBlock).toBe(false);
  });

  test("a passing required check makes the head success despite a red optional check", () => {
    const head = buildHead(
      pipeline([job("checks", "success"), job("lint", "failed", { allowFailure: true })]),
      facts({ required: ["checks"] }),
    );
    expect(head.status).toBe("success");
    expect(head.jobs.find((j) => j.name === "lint")?.blocking).toBe(false);
  });

  test("manual required is pending, skipped required is success", () => {
    expect(buildHead(pipeline([job("checks", "manual")]), facts({ required: ["checks"] })).status).toBe("pending");
    expect(buildHead(pipeline([job("checks", "skipped")]), facts({ required: ["checks"] })).status).toBe("success");
  });

  test("order is failed, canceled, running, pending", () => {
    const required = ["a", "b", "c", "d"];
    const mk = (...s: string[]) =>
      buildHead(pipeline(required.slice(0, s.length).map((n, i) => job(n, s[i]!))), facts({ required })).status;
    expect(mk("failed", "canceled", "running", "pending")).toBe("failed");
    expect(mk("success", "canceled", "running", "pending")).toBe("canceled");
    expect(mk("success", "success", "running", "pending")).toBe("running");
    expect(mk("success", "success", "success", "pending")).toBe("pending");
  });

  test("an empty required list makes every job block and aggregates every job", () => {
    const head = buildHead(
      pipeline([job("lint", "failed", { allowFailure: true }), job("build", "success")]),
      facts({ required: [] }),
    );
    expect(head.allBlock).toBe(true);
    expect(head.jobs.every((j) => j.blocking)).toBe(true);
    expect(head.status).toBe("failed");
  });

  test("an unknown required list follows glance allowFailure", () => {
    const head = buildHead(
      pipeline([job("lint", "failed", { allowFailure: true }), job("build", "success")]),
      facts({ required: null }),
    );
    expect(head.jobs.map((j) => [j.name, j.blocking])).toEqual([
      ["lint", false],
      ["build", true],
    ]);
    expect(head.allBlock).toBe(false);
    expect(head.status).toBe("success");
  });

  test("an unknown required list with no required job makes every job block", () => {
    const head = buildHead(
      pipeline([job("lint", "failed", { allowFailure: true }), job("build", "success", { allowFailure: true })]),
      facts({ required: null }),
    );
    expect(head.allBlock).toBe(true);
    expect(head.jobs.every((j) => j.blocking)).toBe(true);
    expect(head.status).toBe("failed");
  });
});

describe("buildHead ids", () => {
  test("job id parsing: check ids are numeric, status contexts never are", () => {
    const head = buildHead(
      pipeline([
        job("a", "success", { id: "github:check:77", runId: "5" }),
        job("ci/build:12", "success", { id: "github:status:ci/build:12", runId: null }),
      ]),
      facts({ required: [] }),
    );
    expect(head.jobs[0]).toMatchObject({ jobId: 77, runId: 5 });
    expect(head.jobs[1]).toMatchObject({ jobId: null, runId: null });
  });

  test("an anchor with a run id fixes the pipeline id, number and createdAt", () => {
    const createdAt = Date.parse("2026-11-11T10:00:00Z");
    const head = buildHead(pipeline([job("a", "success")]), facts({ anchor: { runId: 900, createdAt } }));
    expect(head).toMatchObject({ id: "github:run:900", number: 900, createdAt: "2026-11-11T10:00:00.000Z" });
  });

  test("a first-seen fallback keeps glance's id and uses the anchor time", () => {
    const createdAt = Date.parse("2026-11-11T10:00:00Z");
    const head = buildHead(pipeline([job("a", "success")]), facts({ anchor: { runId: null, createdAt } }));
    expect(head).toMatchObject({ id: "github:run:5", number: 0, createdAt: "2026-11-11T10:00:00.000Z" });
  });

  test("no anchor keeps glance's id with no createdAt", () => {
    const head = buildHead(pipeline([job("a", "success")]), facts());
    expect(head).toMatchObject({ id: "github:run:5", number: 0, createdAt: null, sha: "abc", ref: "feature" });
  });
});

describe("buildHead success confirmation", () => {
  test("an open workflow holds an all-blocking success at running", () => {
    const head = buildHead(
      pipeline([job("a", "success")]),
      facts({ required: [], confirm: { at: 1, open: true } }),
    );
    expect(head.status).toBe("running");
  });

  test("a finished confirmation leaves success", () => {
    const head = buildHead(
      pipeline([job("a", "success")]),
      facts({ required: [], confirm: { at: 1, open: false } }),
    );
    expect(head.status).toBe("success");
  });

  test("confirmation is ignored while a required list exists", () => {
    const head = buildHead(
      pipeline([job("checks", "success")]),
      facts({ required: ["checks"], confirm: { at: 1, open: true } }),
    );
    expect(head.allBlock).toBe(false);
    expect(head.status).toBe("success");
  });
});

describe("GITHUB_INFRA_PATTERNS", () => {
  test("matches GitHub runner failures", () => {
    const hit = (s: string) => GITHUB_INFRA_PATTERNS.some((p) => new RegExp(p).test(s));
    expect(hit("The runner has received a shutdown signal")).toBe(true);
    expect(hit("lost communication with the server")).toBe(true);
    expect(hit("The hosted runner encountered an error")).toBe(true);
    expect(hit("exceeded the maximum execution time")).toBe(true);
    expect(hit("assertion failed")).toBe(false);
  });
});
