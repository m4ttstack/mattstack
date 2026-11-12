import { beforeEach, describe, expect, test } from "bun:test";
import type { Pipeline, PipelineJob } from "@mattstack/glance";
import type { rtCommand } from "../../../packages/rt-client/src/index.ts";
import {
  CONFIRM_EVERY_MS,
  GITHUB_INFRA_PATTERNS,
  GithubHeadReader,
  __resetMemoryFacts,
  buildHead,
  emptyFacts,
  githubTriageForge,
  memoryFacts,
  requiredNames,
  restJobStatus,
  type FactsStore,
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

type Call = { name: string; payload: Record<string, unknown> };
type Reply = { ok: boolean; data?: unknown; error?: string };
type Responder = (name: string, payload: Record<string, unknown>) => Reply;

const SHA_FULL = "ABCDEF0123456789abcdef0123456789abcdef01";
const T0 = Date.parse("2026-11-11T12:00:00Z");

function forgeOk(body: unknown, status = 200): Reply {
  return { ok: true, data: { status, body, truncated: false, nextPage: null, totalPages: null } };
}

function runRow(id: number, createdAt: string | null, status = "success") {
  return { id, status, ref: "feature", sha: SHA_FULL, source: "pull_request", webUrl: null, createdAt };
}

const RULES_PATH = ":repo/rules/branches/feat%2Fx";
const BRANCH_PATH = ":repo/branches/feat%2Fx";

function defaultResponder(over: { rules?: Reply; branch?: Reply; list?: Reply } = {}): Responder {
  return (name, payload) => {
    if (name === "forge:get" && payload.path === RULES_PATH) {
      return over.rules ?? forgeOk([{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "checks" }] } }]);
    }
    if (name === "forge:get" && payload.path === BRANCH_PATH) return over.branch ?? forgeOk({ protected: false });
    if (name === "pipeline:list") {
      return over.list ?? { ok: true, data: { pipelines: [runRow(902, "2026-11-11T10:00:05Z"), runRow(900, "2026-11-11T10:00:00Z")] } };
    }
    return { ok: false, error: `unexpected ${name}` };
  };
}

function harness(responder: Responder, opts: { store?: FactsStore } = {}) {
  const calls: Call[] = [];
  let clock = T0;
  let respond = responder;
  const command = (async (name: string, payload: Record<string, unknown>) => {
    calls.push({ name, payload });
    return respond(name, payload);
  }) as unknown as typeof rtCommand;
  const store = opts.store ?? memoryFacts(`https://github.com/o/r/pull/1#${SHA_FULL.toLowerCase()}`);
  const reader = new GithubHeadReader(command, { identity: "github.com/o/r", iid: 1 }, store, () => clock);
  return {
    calls,
    store,
    reader,
    count: (name: string) => calls.filter((c) => c.name === name).length,
    reset: () => calls.splice(0),
    advance: (ms: number) => { clock += ms; },
    setResponder: (r: Responder) => { respond = r; },
  };
}

function mrOf(jobs: PipelineJob[], over: { sha?: string | null; pipeline?: Pipeline | null } = {}) {
  return {
    sha: over.sha === undefined ? SHA_FULL : over.sha,
    targetBranch: "feat/x",
    pipeline: over.pipeline === undefined ? pipeline(jobs, { sha: SHA_FULL }) : over.pipeline,
  };
}

describe("memoryFacts", () => {
  beforeEach(() => __resetMemoryFacts());

  test("starts empty and keeps what is set per key", () => {
    const a = memoryFacts("k1");
    expect(a.get()).toEqual(emptyFacts());
    a.set({ ...emptyFacts(), requiredTries: 2 });
    expect(memoryFacts("k1").get().requiredTries).toBe(2);
    expect(memoryFacts("k2").get()).toEqual(emptyFacts());
  });

  test("reset clears every key", () => {
    memoryFacts("k1").set({ ...emptyFacts(), requiredTries: 2 });
    __resetMemoryFacts();
    expect(memoryFacts("k1").get()).toEqual(emptyFacts());
  });
});

describe("GithubHeadReader per-commit reads", () => {
  beforeEach(() => __resetMemoryFacts());

  test("the first read makes each per-commit read once and the second makes none", async () => {
    const h = harness(defaultResponder());
    const head = await h.reader.read(mrOf([job("checks", "running")]), SHA_FULL);
    expect(h.calls.filter((c) => c.name === "forge:get").map((c) => c.payload.path)).toEqual([RULES_PATH, BRANCH_PATH]);
    const lists = h.calls.filter((c) => c.name === "pipeline:list");
    expect(lists.map((c) => c.payload)).toEqual([{ repoName: "github.com/o/r", ref: "feature", sha: SHA_FULL, limit: 100 }]);
    expect(head).toMatchObject({ id: "github:run:900", number: 900, status: "running", createdAt: "2026-11-11T10:00:00.000Z" });
    expect(h.store.get().required).toEqual(["checks"]);

    h.reset();
    await h.reader.read(mrOf([job("checks", "running")]), SHA_FULL);
    expect(h.count("forge:get")).toBe(0);
    expect(h.count("pipeline:list")).toBe(0);
  });

  test("a short watched sha matches the full head sha", async () => {
    const h = harness(defaultResponder());
    await h.reader.read(mrOf([job("checks", "running")]), "abcdef0");
    expect(h.count("forge:get")).toBe(2);
  });

  test.each([
    ["an ok answer with status 404", forgeOk({ message: "Not Found" }, 404)],
    ["an ok:false GitHub 404", { ok: false, error: "GitHub returned 404 Not Found: Not Found" }],
  ])("%s on rules is an answer, kept with no retry", async (_label, rules) => {
    const h = harness(defaultResponder({
      rules: rules as Reply,
      branch: forgeOk({ protection: { required_status_checks: { contexts: ["lint"] } } }),
    }));
    await h.reader.read(mrOf([job("lint", "running")]), SHA_FULL);
    expect(h.store.get().required).toEqual(["lint"]);
    h.reset();
    await h.reader.read(mrOf([job("lint", "running")]), SHA_FULL);
    expect(h.count("forge:get")).toBe(0);
  });

  test("a 404 on both reads is an empty required list", async () => {
    const h = harness(defaultResponder({
      rules: forgeOk(null, 404),
      branch: { ok: false, error: "GitHub returned 404 Not Found: Branch not found" },
    }));
    await h.reader.read(mrOf([job("checks", "running")]), SHA_FULL);
    expect(h.store.get().required).toEqual([]);
  });

  test.each([
    ["rules", { rules: forgeOk({ message: "Forbidden" }, 403) }],
    ["branch", { branch: { ok: false, error: "GitHub returned 403 Forbidden: Resource not accessible" } as Reply }],
    ["a guard refusal", { rules: { ok: false, error: "\"path\" must sit under this repo on GitHub" } as Reply }],
  ])("a failed %s read leaves the list unset, retries, and stops after 3 attempts", async (_label, over) => {
    const h = harness(defaultResponder(over));
    const jobs = [job("lint", "failed", { allowFailure: true }), job("build", "running")];
    const head = await h.reader.read(mrOf(jobs), SHA_FULL);
    expect(h.store.get().required).toBeNull();
    expect(head?.jobs.map((j) => [j.name, j.blocking])).toEqual([["lint", false], ["build", true]]);
    expect(head?.status).toBe("running");

    await h.reader.read(mrOf(jobs), SHA_FULL);
    await h.reader.read(mrOf(jobs), SHA_FULL);
    expect(h.store.get().requiredTries).toBe(3);
    h.reset();
    await h.reader.read(mrOf(jobs), SHA_FULL);
    expect(h.count("forge:get")).toBe(0);
    expect(h.store.get().required).toBeNull();
  });

  test("a failed read followed by a good one keeps the list", async () => {
    const h = harness(defaultResponder({ rules: forgeOk(null, 500) }));
    await h.reader.read(mrOf([job("checks", "running")]), SHA_FULL);
    expect(h.store.get().required).toBeNull();
    h.setResponder(defaultResponder());
    await h.reader.read(mrOf([job("checks", "running")]), SHA_FULL);
    expect(h.store.get().required).toEqual(["checks"]);
  });
});

describe("GithubHeadReader anchor", () => {
  beforeEach(() => __resetMemoryFacts());

  test("checks with no run id set the first-seen fallback and make no listing", async () => {
    const h = harness(defaultResponder());
    const head = await h.reader.read(mrOf([job("checks", "running", { runId: null })]), SHA_FULL);
    expect(h.count("pipeline:list")).toBe(0);
    expect(h.store.get().anchor).toEqual({ runId: null, createdAt: T0 });
    expect(head).toMatchObject({ number: 0, createdAt: new Date(T0).toISOString() });
  });

  test("the fallback upgrades once a check with a run id appears", async () => {
    const h = harness(defaultResponder());
    await h.reader.read(mrOf([job("checks", "running", { runId: null })]), SHA_FULL);
    h.advance(60_000);
    await h.reader.read(mrOf([job("checks", "running", { runId: null })]), SHA_FULL);
    expect(h.count("pipeline:list")).toBe(0);
    expect(h.store.get().anchor).toEqual({ runId: null, createdAt: T0 });

    const head = await h.reader.read(mrOf([job("checks", "running", { runId: null }), job("build", "running")]), SHA_FULL);
    expect(h.count("pipeline:list")).toBe(1);
    expect(h.store.get().anchor).toEqual({ runId: 900, createdAt: Date.parse("2026-11-11T10:00:00Z") });
    expect(head?.id).toBe("github:run:900");
  });

  test("an empty listing keeps the fallback and stops after 3 attempts", async () => {
    const h = harness(defaultResponder({ list: { ok: true, data: { pipelines: [] } } }));
    for (let i = 0; i < 4; i++) {
      await h.reader.read(mrOf([job("checks", "running")]), SHA_FULL);
      h.advance(60_000);
    }
    expect(h.count("pipeline:list")).toBe(3);
    expect(h.store.get().anchor).toEqual({ runId: null, createdAt: T0 });
    expect(h.store.get().anchorTries).toBe(3);
  });

  test("a failed listing keeps the fallback and a later listing replaces it", async () => {
    const h = harness(defaultResponder({ list: { ok: false, error: "GitHub returned 502 Bad Gateway" } }));
    await h.reader.read(mrOf([job("checks", "running")]), SHA_FULL);
    expect(h.store.get().anchor).toEqual({ runId: null, createdAt: T0 });
    h.setResponder(defaultResponder());
    h.advance(60_000);
    await h.reader.read(mrOf([job("checks", "running")]), SHA_FULL);
    expect(h.store.get().anchor?.runId).toBe(900);
  });

  test("rows whose createdAt does not parse are never the anchor", async () => {
    const h = harness(defaultResponder({
      list: { ok: true, data: { pipelines: [runRow(950, "2026-11-11T10:00:09Z"), runRow(800, "garbage"), runRow(700, null)] } },
    }));
    const head = await h.reader.read(mrOf([job("checks", "running")]), SHA_FULL);
    expect(h.store.get().anchor).toEqual({ runId: 950, createdAt: Date.parse("2026-11-11T10:00:09Z") });
    expect(head?.createdAt).toBe("2026-11-11T10:00:09.000Z");
  });

  test("a listing with no parseable row keeps the fallback", async () => {
    const h = harness(defaultResponder({ list: { ok: true, data: { pipelines: [runRow(800, "garbage")] } } }));
    await h.reader.read(mrOf([job("checks", "running")]), SHA_FULL);
    expect(h.store.get().anchor).toEqual({ runId: null, createdAt: T0 });
  });
});

describe("GithubHeadReader off the watched commit", () => {
  beforeEach(() => __resetMemoryFacts());

  test("a head sha that is not the watched sha makes no per-commit read", async () => {
    const h = harness(defaultResponder());
    const head = await h.reader.read(mrOf([job("checks", "running")]), "fffffff");
    expect(h.calls).toEqual([]);
    expect(head).toMatchObject({ id: "github:run:5", status: "running", createdAt: null });
  });

  test("a null watched sha makes no per-commit read", async () => {
    const h = harness(defaultResponder());
    await h.reader.read(mrOf([job("checks", "running")]), null);
    expect(h.calls).toEqual([]);
  });

  test("a null pipeline returns null with no read", async () => {
    const h = harness(defaultResponder());
    expect(await h.reader.read(mrOf([], { pipeline: null }), SHA_FULL)).toBeNull();
    expect(h.calls).toEqual([]);
  });
});

describe("GithubHeadReader success confirmation", () => {
  beforeEach(() => __resetMemoryFacts());

  const noRules = { rules: forgeOk([]), branch: forgeOk({ protected: false }) };

  test.each(["running", "pending"])("an unfinished %s run holds an all-blocking success at running", async (status) => {
    const h = harness(defaultResponder({
      ...noRules,
      list: { ok: true, data: { pipelines: [runRow(901, "2026-11-11T10:00:01Z", status), runRow(900, "2026-11-11T10:00:00Z")] } },
    }));
    const head = await h.reader.read(mrOf([job("build", "success")]), SHA_FULL);
    expect(head?.allBlock).toBe(true);
    expect(head?.status).toBe("running");
  });

  test("confirmation reads at most once every 5 minutes", async () => {
    const h = harness(defaultResponder({
      ...noRules,
      list: { ok: true, data: { pipelines: [runRow(900, "2026-11-11T10:00:00Z", "running")] } },
    }));
    await h.reader.read(mrOf([job("build", "success")]), SHA_FULL);
    h.reset();
    h.advance(CONFIRM_EVERY_MS - 1);
    const held = await h.reader.read(mrOf([job("build", "success")]), SHA_FULL);
    expect(h.count("pipeline:list")).toBe(0);
    expect(held?.status).toBe("running");

    h.setResponder(defaultResponder({
      ...noRules,
      list: { ok: true, data: { pipelines: [runRow(900, "2026-11-11T10:00:00Z", "success")] } },
    }));
    h.advance(1);
    const done = await h.reader.read(mrOf([job("build", "success")]), SHA_FULL);
    expect(h.count("pipeline:list")).toBe(1);
    expect(done?.status).toBe("success");
  });

  test.each(["success", "failed", "canceled", "skipped", "manual"])("a %s run counts as completed", async (status) => {
    const h = harness(defaultResponder({
      ...noRules,
      list: { ok: true, data: { pipelines: [runRow(900, "2026-11-11T10:00:00Z", status)] } },
    }));
    expect((await h.reader.read(mrOf([job("build", "success")]), SHA_FULL))?.status).toBe("success");
  });

  test("a null list with no glance-required check confirms too", async () => {
    const h = harness(defaultResponder({
      rules: forgeOk(null, 500),
      list: { ok: true, data: { pipelines: [runRow(900, "2026-11-11T10:00:00Z", "running")] } },
    }));
    const head = await h.reader.read(mrOf([job("build", "success", { allowFailure: true })]), SHA_FULL);
    expect(head?.allBlock).toBe(true);
    expect(head?.status).toBe("running");
  });

  test("a failed confirmation listing leaves the head success", async () => {
    const h = harness(defaultResponder({ ...noRules, list: { ok: false, error: "GitHub returned 502 Bad Gateway" } }));
    const head = await h.reader.read(mrOf([job("build", "success", { runId: null })]), SHA_FULL);
    expect(h.count("pipeline:list")).toBe(1);
    expect(head?.status).toBe("success");
  });

  test("a non-empty required list makes no confirmation listing", async () => {
    const h = harness(defaultResponder({
      list: { ok: true, data: { pipelines: [runRow(900, "2026-11-11T10:00:00Z", "running")] } },
    }));
    const head = await h.reader.read(mrOf([job("checks", "success", { runId: null })]), SHA_FULL);
    expect(h.count("pipeline:list")).toBe(0);
    expect(head?.status).toBe("success");
  });

  test("a head that is not success makes no confirmation listing", async () => {
    const h = harness(defaultResponder(noRules));
    await h.reader.read(mrOf([job("build", "running", { runId: null })]), SHA_FULL);
    expect(h.count("pipeline:list")).toBe(0);
  });
});

describe("GithubHeadReader listing reuse and stale confirmation", () => {
  beforeEach(() => __resetMemoryFacts());

  const noRules = { rules: forgeOk([]), branch: forgeOk({ protected: false }) };

  test("a failed anchor listing is not repeated for the confirmation in the same read", async () => {
    const h = harness(defaultResponder({ ...noRules, list: { ok: false, error: "GitHub returned 502 Bad Gateway" } }));
    const head = await h.reader.read(mrOf([job("build", "success")]), SHA_FULL);
    expect(h.count("pipeline:list")).toBe(1);
    expect(head?.status).toBe("success");
    expect(h.store.get().confirm).toEqual({ at: T0, open: false });
  });

  test("a head with no ref makes no anchor listing and spends no anchor attempt", async () => {
    const h = harness(defaultResponder());
    const head = await h.reader.read(
      mrOf([], { pipeline: pipeline([job("checks", "running")], { sha: SHA_FULL, ref: null }) }),
      SHA_FULL,
    );
    expect(h.count("pipeline:list")).toBe(0);
    expect(h.store.get()).toMatchObject({ anchor: { runId: null, createdAt: T0 }, anchorTries: 0 });
    expect(head?.number).toBe(0);
  });

  test("a head with no ref confirms by sha only", async () => {
    const h = harness(defaultResponder({
      ...noRules,
      list: { ok: true, data: { pipelines: [runRow(900, "2026-11-11T10:00:00Z", "running")] } },
    }));
    const head = await h.reader.read(
      mrOf([], { pipeline: pipeline([job("build", "success")], { sha: SHA_FULL, ref: null }) }),
      SHA_FULL,
    );
    expect(h.calls.filter((c) => c.name === "pipeline:list").map((c) => c.payload)).toEqual([
      { repoName: "github.com/o/r", sha: SHA_FULL, limit: 100 },
    ]);
    expect(head?.status).toBe("running");
  });

  test("a head that leaves success marks the last confirmation stale until the next due read", async () => {
    const h = harness(defaultResponder({
      ...noRules,
      list: { ok: true, data: { pipelines: [runRow(900, "2026-11-11T10:00:00Z", "success")] } },
    }));
    const green = [job("build", "success", { runId: null })];
    expect((await h.reader.read(mrOf(green), SHA_FULL))?.status).toBe("success");
    expect(h.store.get().confirm).toEqual({ at: T0, open: false });

    h.reset();
    h.advance(60_000);
    expect((await h.reader.read(mrOf([job("build", "running", { runId: null })]), SHA_FULL))?.status).toBe("running");
    h.advance(60_000);
    expect((await h.reader.read(mrOf(green), SHA_FULL))?.status).toBe("running");
    expect(h.count("pipeline:list")).toBe(0);

    h.advance(CONFIRM_EVERY_MS);
    expect((await h.reader.read(mrOf(green), SHA_FULL))?.status).toBe("success");
    expect(h.count("pipeline:list")).toBe(1);
  });
});

describe("githubTriageForge", () => {
  const TARGET = { identity: "github.com/o/r", iid: 1 };
  const head = buildHead(
    pipeline([
      job("unit", "failed", { id: "github:check:71", runId: "901" }),
      job("lint", "failed", { id: "github:check:7", runId: "902" }),
      job("ci/ext", "failed", { id: "github:status:ci/ext", runId: null }),
      job("app-check", "failed", { id: "github:check:55", runId: null }),
      job("build", "success", { id: "github:check:60", runId: "901" }),
      job("e2e", "canceled", { id: "github:check:61", runId: "901" }),
    ], { sha: SHA_FULL }),
    facts({ required: ["unit", "ci/ext", "build", "e2e"], anchor: { runId: 900, createdAt: T0 } }),
  );

  function failedRow(id: number, name: string, status: string, runId: number) {
    return { id: `github:check:${id}`, name, stage: "checks", status, allowFailure: false, duration: 1, webUrl: `https://github.com/o/r/actions/runs/${runId}/job/${id}`, runId: String(runId) };
  }
  function baseRow(id: number, sha: string, status: string, source = "push") {
    return { id, status, ref: "main", sha, source, webUrl: `https://github.com/o/r/actions/runs/${id}`, createdAt: null };
  }

  function forgeOf(responder: Responder) {
    const calls: Call[] = [];
    const command = (async (name: string, payload: Record<string, unknown>) => {
      calls.push({ name, payload });
      return responder(name, payload);
    }) as unknown as typeof rtCommand;
    return { forge: githubTriageForge(command, TARGET, head), calls };
  }

  const baseResponder: Responder = (name, payload) => {
    if (name === "pipeline:list") {
      return { ok: true, data: { pipelines: [
        baseRow(812, "aaa", "failed"),
        baseRow(811, "aaa", "success"),
        baseRow(810, "bbb", "failed", "schedule"),
        baseRow(805, "ccc", "failed"),
      ] } };
    }
    if (name === "mr:pipeline-failed-jobs" && payload.pipelineId === 812) {
      return { ok: true, data: [failedRow(301, "unit", "failed", 812), failedRow(302, "e2e", "canceled", 812)] };
    }
    return { ok: false, error: `unexpected ${name}` };
  };

  test("pipelinesForRef groups base runs by sha, newest first, drops schedule runs and keeps the newest run's id", async () => {
    const { forge, calls } = forgeOf(baseResponder);
    const groups = await forge.pipelinesForRef("main", 4);
    expect(calls.map((c) => c.payload)).toEqual([{ repoName: "github.com/o/r", ref: "main", limit: 100 }]);
    expect(groups).toEqual([
      { id: 812, status: "failed", webUrl: "https://github.com/o/r/actions/runs/812" },
      { id: 805, status: "failed", webUrl: "https://github.com/o/r/actions/runs/805" },
    ]);
  });

  test("pipelinesForRef drops pull_request runs, which a fork PR from a base-named branch lists under the base ref", async () => {
    const { forge, calls } = forgeOf((name) => name === "pipeline:list"
      ? { ok: true, data: { pipelines: [
        baseRow(830, "fff", "failed", "pull_request"),
        baseRow(829, "eee", "failed", "pull_request_target"),
        baseRow(812, "aaa", "failed"),
      ] } }
      : { ok: false, error: `unexpected ${name}` });
    expect((await forge.pipelinesForRef("main", 4))?.map((g) => g.id)).toEqual([812]);
    expect(calls).toHaveLength(1);
  });

  test("a base commit whose only run was cancelled makes no failed-jobs read and has no jobs", async () => {
    const { forge, calls } = forgeOf((name) => name === "pipeline:list"
      ? { ok: true, data: { pipelines: [baseRow(840, "ggg", "canceled")] } }
      : { ok: false, error: `unexpected ${name}` });
    await forge.pipelinesForRef("main", 4);
    calls.splice(0);
    expect(await forge.failedJobs(840)).toEqual({ jobs: [], crossProject: [] });
    expect(calls).toEqual([]);
  });

  test("pipelinesForRef returns at most limit commits", async () => {
    const { forge } = forgeOf(baseResponder);
    expect((await forge.pipelinesForRef("main", 1))?.map((g) => g.id)).toEqual([812]);
  });

  test("a base commit's failed jobs read only its failed runs and drop cancelled jobs", async () => {
    const { forge, calls } = forgeOf(baseResponder);
    await forge.pipelinesForRef("main", 4);
    calls.splice(0);
    const failed = await forge.failedJobs(812);
    expect(calls).toEqual([{ name: "mr:pipeline-failed-jobs", payload: { repoName: "github.com/o/r", iid: 1, pipelineId: 812 } }]);
    expect(failed).toEqual({
      jobs: [{ pipelineId: 812, jobId: 301, name: "unit", stage: "checks", status: "failed", allowFailure: false, attempt: 1, webUrl: "https://github.com/o/r/actions/runs/812/job/301" }],
      crossProject: [],
    });
  });

  test("the head's failed Actions checks are jobs and every other failed check is a crossProject row", async () => {
    const { forge, calls } = forgeOf(baseResponder);
    expect(await forge.failedJobs(900)).toEqual({
      jobs: [
        { pipelineId: 901, jobId: 71, name: "unit", stage: "checks", status: "failed", allowFailure: false, attempt: 1, webUrl: null },
        { pipelineId: 902, jobId: 7, name: "lint", stage: "checks", status: "failed", allowFailure: true, attempt: 1, webUrl: null },
      ],
      crossProject: [
        { name: "ci/ext", status: "failed", blocking: true, downstream: null },
        { name: "app-check", status: "failed", blocking: false, downstream: null },
      ],
    });
    expect(calls).toEqual([]);
  });

  test("pipelineInfo for the head makes no request", async () => {
    const { forge, calls } = forgeOf(baseResponder);
    expect(await forge.pipelineInfo(900)).toEqual({ id: 900, status: head.status, webUrl: "https://github.com/o/r/pull/1/checks", sha: SHA_FULL, ref: "feature" });
    expect(calls).toEqual([]);
  });

  test("pipelineInfo for a run reads it once", async () => {
    const { forge, calls } = forgeOf((name, payload) =>
      name === "forge:get" && payload.path === ":repo/actions/runs/555"
        ? forgeOk({ status: "completed", conclusion: "failure", html_url: "https://github.com/o/r/actions/runs/555", head_sha: "def", head_branch: "feat" })
        : { ok: false, error: `unexpected ${name}` });
    expect(await forge.pipelineInfo(555)).toEqual({ id: 555, status: "failed", webUrl: "https://github.com/o/r/actions/runs/555", sha: "def", ref: "feat" });
    expect(calls).toHaveLength(1);
  });

  test("pipelineInfo for a run GitHub does not know is null, either way the 404 arrives", async () => {
    expect(await forgeOf(() => ({ ok: false, error: "GitHub returned 404: Not Found" })).forge.pipelineInfo(555)).toBeNull();
    expect(await forgeOf(() => forgeOk({ message: "Not Found" }, 404)).forge.pipelineInfo(555)).toBeNull();
  });

  test("defaultBranch reads the repo and infraPatterns are GitHub's", async () => {
    const { forge, calls } = forgeOf((name, payload) =>
      name === "forge:get" && payload.path === ":repo" ? forgeOk({ default_branch: "trunk" }) : { ok: false, error: `unexpected ${name}` });
    expect(await forge.defaultBranch()).toBe("trunk");
    expect(calls).toHaveLength(1);
    expect(forge.infraPatterns()).toEqual([...GITHUB_INFRA_PATTERNS]);
  });

  test("a run that is neither the head nor a base commit takes the head's blocking flag by job id", async () => {
    const { forge, calls } = forgeOf((name, payload) =>
      name === "mr:pipeline-failed-jobs" && payload.pipelineId === 555
        ? { ok: true, data: [failedRow(7, "lint", "failed", 555), failedRow(8, "other", "failed", 555), failedRow(9, "gone", "canceled", 555)] }
        : { ok: false, error: `unexpected ${name}` });
    const failed = await forge.failedJobs(555);
    expect(calls.map((c) => c.payload)).toEqual([{ repoName: "github.com/o/r", iid: 1, pipelineId: 555 }]);
    expect(failed?.crossProject).toEqual([]);
    expect(failed?.jobs.map((j) => [j.jobId, j.pipelineId, j.allowFailure])).toEqual([[7, 555, true], [8, 555, false]]);
  });

  test("trace reads the job log", async () => {
    const { forge, calls } = forgeOf((name) => name === "mr:fetch-job-trace" ? { ok: true, data: "log" } : { ok: false, error: "no" });
    expect(await forge.trace(71)).toEqual({ ok: true, text: "log" });
    expect(calls[0]!.payload).toEqual({ repoName: "github.com/o/r", iid: 1, jobId: 71 });
  });
});
