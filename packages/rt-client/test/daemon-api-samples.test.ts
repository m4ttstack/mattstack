/**
 * One representative 200 body per route, built from its handler's return
 * statement, and one body per shared error response.
 */
import { describe, expect, test } from "bun:test";
import {
  DAEMON_ROUTES,
  FailureEnvelopeSchema,
  MalformedPathSchema,
  MethodNotAllowedSchema,
  NotFoundSchema,
  TooLargeSchema,
  UnauthorizedSchema,
} from "../src/daemon-api/index.ts";

const totals = { input: 10, output: 20, cacheRead: 30, cacheWrite: 5, messages: 2, cost: 0.12, unpricedTokens: 0 };
const byBilling = { metered: totals, plan: totals, unknown: totals };
const costByKind = { work: 0.1, review: 0.02, respond: 0, doctor: 0, other: 0 };
const splits = { byModel: [{ model: "claude-opus", totals }], main: totals, subagent: totals };

const portEntry = {
  port: 5173,
  pid: 4242,
  command: "node",
  cwd: "/Users/dev/repo",
  repo: "repo",
  worktree: "main",
  branch: "main",
  relativeDir: ".",
  uptime: "1h",
};

const runSummary = {
  id: "run-1",
  repo: "github.com/acme/repo",
  work_type: "feature",
  pipeline: "work",
  status: "running",
  current_stage: "implement",
  spawned_by: null,
  started_at: 1_700_000_000_000,
  ended_at: null,
  pack_commits: null,
  pack_dirty: 0,
  attention: { needs: false, reason: null, evidence: "" },
  last_event_at: 1_700_000_100_000,
  ticket: "RT-1",
  branch: "rt-1-thing",
};

const processLeaf = {
  pid: 2,
  ppid: 1,
  command: "vite",
  fullCommand: "node vite",
  cpuPercent: 1.5,
  rssKb: 2048,
  uptime: "5m",
  cwd: "/Users/dev/repo",
  repo: "repo",
  worktree: null,
  branch: null,
  relativeDir: ".",
  port: 5173,
  linearTicket: null,
  packageScript: "bun run dev",
  firstSeen: 1_700_000_000_000,
  isRunaway: false,
  runawayDurationMs: null,
  children: [],
};

const SAMPLES: Record<string, unknown> = {
  "status.get": {
    ok: true,
    data: {
      pid: 100,
      uptime: 60_000,
      memoryUsage: 50_000_000,
      watchedRepos: 2,
      cacheEntries: 4,
      portsCached: 1,
      portCacheAge: null,
      lastRefresh: null,
      portsByRepo: { repo: 1 },
      pendingNotifications: 0,
      worktreeReadyHeld: [],
      health: { level: "ok", reasons: [] },
      metrics: { rss: 1, heapUsed: 1, external: 1, uptimeMs: 60_000, wsClients: 0, watchers: 3 },
      eventLoop: { maxLagMs: 4, lastStallAt: null, lastStallCmd: null, stalls: 0 },
    },
  },
  "ports.list": {
    ok: true,
    data: { ports: [portEntry], grouped: { repo: { main: [portEntry] } }, updatedAt: 1_700_000_000_000, age: 1200 },
  },
  "cache.list": {
    ok: true,
    data: {
      "rt-1-thing": {
        ticket: { identifier: "RT-1", title: "Thing", url: "https://linear.app/acme/issue/RT-1" },
        mr: { iid: 7, webUrl: "https://github.com/acme/repo/pull/7", state: "opened", pipeline: { status: "success" } },
        fetchedAt: 1_700_000_000_000,
      },
    },
  },
  "cache.get": { ok: true, data: {} },
  "repos.list": {
    ok: true,
    data: {
      repos: { repo: { path: "/Users/dev/repo", worktrees: [{ path: "/Users/dev/repo", branch: "main" }] } },
      watched: ["repo"],
    },
  },
  "processes.list": {
    ok: true,
    data: {
      processes: [{ ...processLeaf, pid: 1, ppid: 0, totalCpuPercent: 1.5, totalRssKb: 2048, children: [processLeaf] }],
      updatedAt: 1_700_000_000_000,
      ready: true,
    },
  },
  "notifications.drain": {
    ok: true,
    data: [{ id: "n1", title: "Pipeline passed", message: "!7 is green", category: "pipeline", timestamp: 1_700_000_000_000 }],
  },
  "cache.refresh": { ok: true, message: "refresh started" },
  "hooks.repair": { ok: true, repaired: true },
  "daemon.shutdown": { ok: true, message: "shutting down" },
  "sdm.recents": {
    ok: true,
    health: { status: "ok", message: null },
    recents: [
      {
        key: "staging-db",
        label: "Staging DB",
        sdmResource: "db-staging",
        lastConnectedAt: "2026-11-19T10:00:00Z",
        connected: true,
        address: "127.0.0.1:5432",
      },
    ],
  },
  "sdm.reconnect": { ok: false, outcome: "needs-access-request", resource: "db-staging" },
  "events.emit": { ok: true, data: { id: 12 } },
  "events.list": {
    ok: true,
    data: { events: [{ id: 12, topic: "run-updated", payload: { runId: "run-1" }, emittedAt: 1_700_000_000_000 }], cursor: 12 },
  },
  "secrets.read": { ok: true, data: { linearApiKey: "<linear key>" } },
  "runs.list": { ok: true, data: { runs: [runSummary] } },
  "runs.get": {
    ok: true,
    data: {
      run: runSummary,
      stages: [
        { name: "implement", status: "running", attempt: 1, started_at: 1_700_000_000_000, ended_at: null, reason: null, detail_path: null },
      ],
      fields: [{ key: "ticket", value: "RT-1", produced_by: "intake", at: 1_700_000_000_000 }],
      decisions: [],
      schemaAhead: false,
    },
  },
  "usage.mrs": {
    ok: true,
    data: {
      mrs: [
        {
          mrKey: "github.com/acme/repo!7",
          url: null,
          ticket: "RT-1",
          branch: "rt-1-thing",
          firstActivity: 1,
          lastActivity: 2,
          totals,
          byBilling,
          costByKind,
          runCount: 1,
          roundCount: 0,
        },
      ],
      summary: { mrCount: 1, totals, byBilling, medianCost: 0.12 },
    },
  },
  "usage.mr": {
    ok: true,
    data: {
      ...splits,
      mrKey: "github.com/acme/repo!7",
      url: null,
      ticket: null,
      branch: null,
      firstActivity: 1,
      lastActivity: 2,
      totals,
      byBilling,
      costByKind,
      outsideRuns: totals,
      runs: [
        {
          ...splits,
          runId: "run-1",
          sessionId: "s-1",
          kind: "work",
          round: null,
          pipeline: "work",
          status: "done",
          startedAt: 1,
          endedAt: 2,
          firstActivity: 1,
          lastActivity: 2,
          totals,
          byBilling,
          accounts: [{ account: "a@example.com", label: null, billing: "plan" }],
          stages: [
            {
              name: "implement",
              attempt: 1,
              outside: null,
              status: "done",
              startedAt: 1,
              endedAt: 2,
              firstActivity: 1,
              lastActivity: 2,
              subagentCost: 0,
              totals,
            },
          ],
        },
      ],
    },
  },
  "usage.run": { ok: true, data: { runId: "run-1", mrKey: null, totals, mrCost: null } },
  "usage.trends": {
    ok: true,
    data: {
      weeks: [{ weekStart: 1_700_000_000_000, totals, byKind: { work: totals, review: totals, respond: totals, doctor: totals, other: totals } }],
      totals,
      byBilling,
      byPipeline: [{ pipeline: "work", totals }],
      byModel: [{ model: null, totals }],
    },
  },
  "usage.status": {
    ok: true,
    data: {
      lastSweepAt: null,
      lastSweepMs: null,
      messages: 0,
      runs: 0,
      skippedLines: 0,
      conflicts: 0,
      skippedRate: 0,
      unpricedModels: [],
      sessionsMissingTranscript: 0,
    },
  },
  "reconciler.status": {
    ok: true,
    data: {
      sweptAt: 1_700_000_000_000,
      herdrReachable: true,
      executors: [
        {
          agentId: "agent-1",
          repo: null,
          subject: null,
          surface: "herdr",
          sessionId: "s-1",
          paneRef: "w1:p2",
          state: "live",
          since: 1_700_000_000_000,
          openGateIds: [],
        },
      ],
    },
  },
  "reconciler.clear": { ok: true, data: { cleared: true } },
};

describe("route success samples", () => {
  test("every route has a sample", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(DAEMON_ROUTES.map((r) => r.id).sort());
  });

  for (const route of DAEMON_ROUTES) {
    test(`${route.id} parses its sample`, () => {
      expect(() => route.success.parse(SAMPLES[route.id])).not.toThrow();
    });
  }
});

describe("shared error samples", () => {
  test("500 failure", () => {
    expect(() =>
      FailureEnvelopeSchema.parse({ ok: false, error: "Error: boom", failure: { code: "internal", message: "boom" } }),
    ).not.toThrow();
    expect(() => FailureEnvelopeSchema.parse({ ok: false, error: "missing runId" })).not.toThrow();
  });
  test("401 unauthorized", () => {
    expect(() => UnauthorizedSchema.parse({ ok: false, error: "unauthorized" })).not.toThrow();
  });
  test("404 not found", () => {
    expect(() => NotFoundSchema.parse({ ok: false, error: "not found", docs: "http://localhost:9401/" })).not.toThrow();
  });
  test("405 method not allowed", () => {
    expect(() => MethodNotAllowedSchema.parse({ ok: false, error: "use POST" })).not.toThrow();
  });
  test("400 malformed path", () => {
    expect(() => MalformedPathSchema.parse({ ok: false, error: "malformed path parameter" })).not.toThrow();
  });
  test("413 too large", () => {
    expect(() =>
      TooLargeSchema.parse({ ok: false, error: "request body over the 1 MiB limit for events:emit" }),
    ).not.toThrow();
  });
});
