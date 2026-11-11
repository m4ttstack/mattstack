/**
 * The merge queue verbs: status and enqueue pass the provider's answer
 * through, and a forge with no merge queue is refused before any call.
 */
import { describe, expect, test } from "bun:test";
import { RateLimitedError } from "@mattstack/glance";
import { createMRHandlers } from "../mr.ts";
import { fakeStore } from "../../__tests__/fake-cache-store.ts";

const REPO = "remote:github.com%2Fo%2Fr";
const STATUS = { enabled: true, inQueue: true, merged: false, lastRemoval: { at: "2026-11-01T00:00:00Z", reason: "failed_checks" } };

function harness(methods: Record<string, (...args: any[]) => any>, opts: { canEnqueue?: boolean; forge?: "gitlab" | "github" } = {}) {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const provider: Record<string, unknown> = { capabilities: { canEnqueue: opts.canEnqueue ?? true } };
  for (const name of ["fetchMergeQueueStatus", "enqueuePullRequest"]) {
    provider[name] = async (...args: unknown[]) => {
      calls.push({ name, args });
      return methods[name]?.(...args);
    };
  }
  const log = { warn() {}, info() {}, error() {}, debug() {} } as any;
  const handlers = createMRHandlers({ cache: fakeStore({}), repoIndex: () => ({ [REPO]: "/tmp/repo" }), log }, () => {}, {
    getContext: async () => ({ forge: opts.forge ?? "github", provider, projectPath: "o/r", projectId: null }),
  });
  return { handlers, calls };
}

describe("mr:merge-queue-status", () => {
  test("returns the provider's status", async () => {
    const h = harness({ fetchMergeQueueStatus: async () => STATUS });
    expect(await h.handlers["mr:merge-queue-status"]({ repoName: REPO, iid: 7 })).toEqual({ ok: true, data: STATUS });
    expect(h.calls).toEqual([{ name: "fetchMergeQueueStatus", args: ["o/r", 7] }]);
  });

  test("a forge with no merge queue is refused with no call", async () => {
    const h = harness({}, { canEnqueue: false, forge: "gitlab" });
    expect(await h.handlers["mr:merge-queue-status"]({ repoName: REPO, iid: 7 })).toEqual({ ok: false, error: "unsupported: this forge has no merge queue" });
    expect(h.calls).toEqual([]);
  });

  test("a rate limit names the limit and when to retry", async () => {
    const h = harness({
      fetchMergeQueueStatus: async () => {
        throw new RateLimitedError("GitHub secondary rate limit hit on POST /graphql", { kind: "secondary", resetAt: null, retryAfterMs: 60000, operation: "POST /graphql" });
      },
    });
    expect(await h.handlers["mr:merge-queue-status"]({ repoName: REPO, iid: 7 }))
      .toEqual({ ok: false, error: "GitHub secondary rate limit hit on POST /graphql (retry in 60s)" });
  });

  test("refuses a bad iid before reading the repo", async () => {
    const h = harness({});
    expect(await h.handlers["mr:merge-queue-status"]({ repoName: REPO, iid: 0 })).toEqual({ ok: false, error: '"iid" must be a positive integer' });
    expect(h.calls).toEqual([]);
  });
});

describe("mr:enqueue", () => {
  test("returns the queue position and state, passing the expected head on", async () => {
    const h = harness({ enqueuePullRequest: async () => ({ position: 3, state: "QUEUED" }) });
    expect(await h.handlers["mr:enqueue"]({ repoName: REPO, iid: 7, expectedHeadSha: "abc123" })).toEqual({ ok: true, data: { position: 3, state: "QUEUED" } });
    expect(h.calls).toEqual([{ name: "enqueuePullRequest", args: ["o/r", 7, { expectedHeadSha: "abc123" }] }]);
  });

  test("sends no expected head when none is given", async () => {
    const h = harness({ enqueuePullRequest: async () => ({ position: 1, state: "AWAITING_CHECKS" }) });
    expect(await h.handlers["mr:enqueue"]({ repoName: REPO, iid: 7 })).toEqual({ ok: true, data: { position: 1, state: "AWAITING_CHECKS" } });
    expect(h.calls).toEqual([{ name: "enqueuePullRequest", args: ["o/r", 7, {}] }]);
  });

  test("a forge with no merge queue is refused with no call", async () => {
    const h = harness({}, { canEnqueue: false, forge: "gitlab" });
    expect(await h.handlers["mr:enqueue"]({ repoName: REPO, iid: 7 })).toEqual({ ok: false, error: "unsupported: this forge has no merge queue" });
    expect(h.calls).toEqual([]);
  });

  test("refuses an expectedHeadSha that is not a string", async () => {
    const h = harness({});
    expect(await h.handlers["mr:enqueue"]({ repoName: REPO, iid: 7, expectedHeadSha: 5 })).toEqual({ ok: false, error: '"expectedHeadSha" must be a string' });
    expect(h.calls).toEqual([]);
  });
});
