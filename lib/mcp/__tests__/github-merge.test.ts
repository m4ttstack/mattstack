import { describe, expect, test } from "bun:test";
import { ReadBackFailedError } from "@mattstack/glance";
import { daemonMergeProvider, mergeOnGitHub, resolveGithubTarget, type GithubMergeProvider } from "../github-merge.ts";

const TARGET = { projectPath: "acme/app", iid: 12, identity: "remote:github.com%2Facme%2Fapp" };

type Status = { enabled: boolean; inQueue: boolean; merged?: boolean; lastRemoval?: { at: string; reason: string } | null };
const full = (s: Status) => ({ merged: false, lastRemoval: null, ...s });

function github(queue: Status, over: Partial<GithubMergeProvider> = {}) {
  const calls: string[] = [];
  const provider = {
    fetchMergeQueueStatus: async () => full(queue),
    enqueuePullRequest: async () => {
      calls.push("enqueue");
      return { position: 2, state: "QUEUED" };
    },
    mergePullRequest: async (_p: string, _i: number, input: unknown) => {
      calls.push(`merge ${JSON.stringify(input)}`);
      return { state: "merged" };
    },
    setAutoMerge: async () => {
      calls.push("autoMerge");
    },
    ...over,
  } as unknown as GithubMergeProvider;
  return { provider: async () => provider, calls };
}

describe("mergeOnGitHub", () => {
  test("a queued repo enqueues and reports the position", async () => {
    const { provider, calls } = github({ enabled: true, inQueue: false });
    expect((await mergeOnGitHub(TARGET, {}, { provider })).body).toEqual({ queued: true, position: 2, state: "QUEUED" });
    expect(calls).toEqual(["enqueue"]);
  });

  test("a PR already in the queue is left there", async () => {
    const { provider, calls } = github({ enabled: true, inQueue: true });
    expect((await mergeOnGitHub(TARGET, {}, { provider })).body).toEqual({ queued: true, alreadyQueued: true });
    expect(calls).toEqual([]);
  });

  test("a queued repo refuses options the queue cannot honour, without touching the PR", async () => {
    for (const options of [{ squash: true }, { removeSourceBranch: false }, { whenPipelineSucceeds: true }]) {
      const { provider, calls } = github({ enabled: true, inQueue: false });
      const res = await mergeOnGitHub(TARGET, options, { provider });
      expect(res.ok).toBe(false);
      expect(res.error).toContain("merge queue");
      expect(calls).toEqual([]);
    }
  });

  test("a repo with no queue merges directly with the caller's options", async () => {
    const { provider, calls } = github({ enabled: false, inQueue: false });
    expect((await mergeOnGitHub(TARGET, { squash: true, removeSourceBranch: true }, { provider })).body).toEqual({ merged: true });
    expect(calls).toEqual(['merge {"squash":true,"shouldRemoveSourceBranch":true}']);
  });

  test("a repo with no queue arms auto-merge for whenPipelineSucceeds", async () => {
    const { provider, calls } = github({ enabled: false, inQueue: false });
    expect((await mergeOnGitHub(TARGET, { whenPipelineSucceeds: true }, { provider })).body).toEqual({ autoMerge: true });
    expect(calls).toEqual(["autoMerge"]);
  });

  test("only an observed merge reads as merged", async () => {
    const mergePullRequest = (async () => ({ state: "opened" })) as unknown as GithubMergeProvider["mergePullRequest"];
    const { provider } = github({ enabled: false, inQueue: false }, { mergePullRequest });
    expect((await mergeOnGitHub(TARGET, {}, { provider })).body).toEqual({ requested: "merge", verified: false, state: "opened" });
  });

  test("a merge that left its source branch behind says why", async () => {
    const sourceBranchNotDeleted = "The source branch was not deleted: GitHub refused the delete with 422.";
    const mergePullRequest = (async () => ({ state: "merged", sourceBranchNotDeleted })) as unknown as GithubMergeProvider["mergePullRequest"];
    const { provider } = github({ enabled: false, inQueue: false }, { mergePullRequest });
    expect((await mergeOnGitHub(TARGET, { removeSourceBranch: true }, { provider })).body).toEqual({ merged: true, sourceBranchNotDeleted });
  });

  test("a merge whose read-back failed is unverified, not failed", async () => {
    const mergePullRequest = (async () => {
      throw Object.assign(Object.create(ReadBackFailedError.prototype), { writeApplied: true });
    }) as unknown as GithubMergeProvider["mergePullRequest"];
    const { provider } = github({ enabled: false, inQueue: false }, { mergePullRequest });
    expect((await mergeOnGitHub(TARGET, {}, { provider })).body).toEqual({ requested: "merge", verified: false });
  });

  test("a failed queue lookup stops before any write", async () => {
    const fetchMergeQueueStatus = async () => {
      throw new Error("fetchMergeQueueStatus failed: 502");
    };
    const { provider, calls } = github({ enabled: true, inQueue: false }, { fetchMergeQueueStatus });
    const res = await mergeOnGitHub(TARGET, {}, { provider });
    expect(res.error).toBe("fetchMergeQueueStatus failed: 502");
    expect(calls).toEqual([]);
  });

  test("no token is refused", async () => {
    const res = await mergeOnGitHub(TARGET, {}, { provider: async () => null });
    expect(res.error).toContain("gh auth login");
  });
});

describe("mergeOnGitHub with wait", () => {
  /** Each poll reads the next status; the last one repeats. */
  function polling(first: Status, later: Array<Status | Error>) {
    const reads = [first, ...later];
    let i = 0;
    const fetchMergeQueueStatus = async () => {
      const next = reads[Math.min(i++, reads.length - 1)]!;
      if (next instanceof Error) throw next;
      return full(next);
    };
    const made = github(first, { fetchMergeQueueStatus: fetchMergeQueueStatus as GithubMergeProvider["fetchMergeQueueStatus"] });
    let now = 0;
    const seams = { provider: made.provider, now: () => now, sleep: async (ms: number) => { now += ms; } };
    return { ...made, seams };
  }
  const OLD = { at: "2026-01-01T00:00:00Z", reason: "failed_checks" };
  const NEW = { at: "2026-01-02T00:00:00Z", reason: "merge_conflict" };

  test("queues, then reports the merge", async () => {
    const { seams, calls } = polling({ enabled: true, inQueue: false }, [{ enabled: true, inQueue: true }, { enabled: true, inQueue: false, merged: true }]);
    expect((await mergeOnGitHub(TARGET, { wait: true }, seams)).body).toEqual({ merged: true });
    expect(calls).toEqual(["enqueue"]);
  });

  test("joins a PR already queued without enqueuing it again", async () => {
    const { seams, calls } = polling({ enabled: true, inQueue: true }, [{ enabled: true, inQueue: false, merged: true }]);
    expect((await mergeOnGitHub(TARGET, { wait: true }, seams)).body).toEqual({ merged: true });
    expect(calls).toEqual([]);
  });

  test("reports a drop with GitHub's reason", async () => {
    const { seams } = polling({ enabled: true, inQueue: true }, [{ enabled: true, inQueue: false, lastRemoval: NEW }]);
    expect((await mergeOnGitHub(TARGET, { wait: true }, seams)).body).toEqual({ dropped: true, reason: "merge_conflict", at: NEW.at });
  });

  test("a removal from before the wait does not read as a drop", async () => {
    const { seams } = polling({ enabled: true, inQueue: false, lastRemoval: OLD }, [
      { enabled: true, inQueue: false, lastRemoval: OLD },
      { enabled: true, inQueue: true, lastRemoval: OLD },
      { enabled: true, inQueue: false, merged: true, lastRemoval: OLD },
    ]);
    expect((await mergeOnGitHub(TARGET, { wait: true, requeue: true }, seams)).body).toEqual({ merged: true });
  });

  test("never re-queues a dropped PR unless asked, with or without wait", async () => {
    for (const options of [{}, { wait: true }]) {
      const { seams, calls } = polling({ enabled: true, inQueue: false, lastRemoval: OLD }, []);
      expect((await mergeOnGitHub(TARGET, options, seams)).body).toEqual({ dropped: true, reason: "failed_checks", at: OLD.at });
      expect(calls).toEqual([]);
    }
  });

  test("requeue enters the queue again without wait", async () => {
    const { seams, calls } = polling({ enabled: true, inQueue: false, lastRemoval: OLD }, []);
    expect((await mergeOnGitHub(TARGET, { requeue: true }, seams)).body).toEqual({ queued: true, position: 2, state: "QUEUED" });
    expect(calls).toEqual(["enqueue"]);
  });

  test("a removal for a merge reads as merged before GitHub marks the PR merged", async () => {
    for (const options of [{}, { wait: true }, { requeue: true }]) {
      const { seams, calls } = polling({ enabled: true, inQueue: false, lastRemoval: { at: OLD.at, reason: "merged" } }, []);
      expect((await mergeOnGitHub(TARGET, options, seams)).body).toEqual({ merged: true });
      expect(calls).toEqual([]);
    }
  });

  test("times out still queued, and the next call can pick it up", async () => {
    const { seams } = polling({ enabled: true, inQueue: true }, []);
    expect((await mergeOnGitHub(TARGET, { wait: true, maxWaitSeconds: 60 }, seams)).body).toEqual({ queued: true, timedOut: true });
  });

  test("sleeps no longer than the time left", async () => {
    const { seams } = polling({ enabled: true, inQueue: true }, []);
    const naps: number[] = [];
    const sleep = async (ms: number) => {
      naps.push(ms);
      await seams.sleep(ms);
    };
    await mergeOnGitHub(TARGET, { wait: true, maxWaitSeconds: 30 }, { ...seams, sleep });
    expect(naps).toEqual([20_000, 10_000]);
  });

  test("stops polling once cancelled", async () => {
    const controller = new AbortController();
    let reads = 0;
    const fetchMergeQueueStatus = (async () => {
      reads++;
      return full({ enabled: true, inQueue: true });
    }) as GithubMergeProvider["fetchMergeQueueStatus"];
    const { provider } = github({ enabled: true, inQueue: true }, { fetchMergeQueueStatus });
    const sleep = async () => controller.abort();
    const res = await mergeOnGitHub(TARGET, { wait: true }, { provider, sleep, signal: controller.signal });
    expect(res.body).toEqual({ queued: true, timedOut: true });
    expect(reads).toBe(1);
  });

  test("rides out a failed poll", async () => {
    const { seams } = polling({ enabled: true, inQueue: true }, [new Error("502"), { enabled: true, inQueue: false, merged: true }]);
    expect((await mergeOnGitHub(TARGET, { wait: true }, seams)).body).toEqual({ merged: true });
  });

  test("names the last error when polling never recovers", async () => {
    const { seams } = polling({ enabled: true, inQueue: true }, [new Error("502")]);
    expect((await mergeOnGitHub(TARGET, { wait: true, maxWaitSeconds: 60 }, seams)).body).toEqual({ queued: true, timedOut: true, lastError: "502" });
  });

  test("an already merged PR returns merged, with or without wait", async () => {
    for (const options of [{}, { wait: true }]) {
      const { seams, calls } = polling({ enabled: true, inQueue: false, merged: true }, []);
      expect((await mergeOnGitHub(TARGET, options, seams)).body).toEqual({ merged: true });
      expect(calls).toEqual([]);
    }
  });

  test("a repo with no queue merges directly and has nothing to wait for", async () => {
    const { seams, calls } = polling({ enabled: false, inQueue: false }, []);
    expect((await mergeOnGitHub(TARGET, { wait: true }, seams)).body).toEqual({ merged: true });
    expect(calls).toEqual(["merge {}"]);
  });
});

describe("daemonMergeProvider", () => {
  type Reply = { ok: boolean; data?: unknown; error?: string; sourceBranchNotDeleted?: string };
  const MERGED_PR = { iid: 12, state: "merged", webUrl: "https://github.com/acme/app/pull/12" };

  /** Each daemon verb answers from its own queue of replies; the last one repeats. */
  function daemon(replies: Record<string, Reply[]>) {
    const sent: Array<{ cmd: string; payload: Record<string, unknown> }> = [];
    const used: Record<string, number> = {};
    const command = async (cmd: string, payload: Record<string, unknown>) => {
      sent.push({ cmd, payload });
      const queue = replies[cmd] ?? [{ ok: false, error: `unexpected ${cmd}` }];
      const i = used[cmd] = (used[cmd] ?? -1) + 1;
      return queue[Math.min(i, queue.length - 1)]!;
    };
    const provider = daemonMergeProvider(TARGET.identity, command as Parameters<typeof daemonMergeProvider>[1]);
    return { provider, sent, seams: { provider: async () => provider } };
  }

  test("fetchMergeQueueStatus asks mr:merge-queue-status", async () => {
    const status = { enabled: true, inQueue: false, merged: false, lastRemoval: null };
    const { provider, sent } = daemon({ "mr:merge-queue-status": [{ ok: true, data: status }] });
    expect(await provider.fetchMergeQueueStatus(TARGET.projectPath, 12)).toEqual(status);
    expect(sent).toEqual([{ cmd: "mr:merge-queue-status", payload: { repoName: TARGET.identity, iid: 12 } }]);
  });

  test("enqueuePullRequest asks mr:enqueue, with the expected head when given", async () => {
    const { provider, sent } = daemon({ "mr:enqueue": [{ ok: true, data: { position: 2, state: "QUEUED" } }] });
    expect(await provider.enqueuePullRequest(TARGET.projectPath, 12)).toEqual({ position: 2, state: "QUEUED" });
    await provider.enqueuePullRequest(TARGET.projectPath, 12, { expectedHeadSha: "abc123" });
    expect(sent).toEqual([
      { cmd: "mr:enqueue", payload: { repoName: TARGET.identity, iid: 12 } },
      { cmd: "mr:enqueue", payload: { repoName: TARGET.identity, iid: 12, expectedHeadSha: "abc123" } },
    ]);
  });

  test("setAutoMerge sends the setAutoMerge action", async () => {
    const { provider, sent } = daemon({ "mr:action": [{ ok: true }] });
    await provider.setAutoMerge(TARGET.projectPath, 12);
    expect(sent).toEqual([{ cmd: "mr:action", payload: { repoName: TARGET.identity, iid: 12, action: "setAutoMerge", args: [] } }]);
  });

  test("mergePullRequest sends the merge options, then reads the PR back fresh", async () => {
    const { provider, sent } = daemon({ "mr:action": [{ ok: true }], "mr:get": [{ ok: true, data: { mr: MERGED_PR, fetchedAt: 1 } }] });
    expect(await provider.mergePullRequest(TARGET.projectPath, 12, { squash: true })).toEqual(MERGED_PR as never);
    expect(sent).toEqual([
      { cmd: "mr:action", payload: { repoName: TARGET.identity, iid: 12, action: "merge", args: [{ squash: true }] } },
      { cmd: "mr:get", payload: { repoName: TARGET.identity, iid: 12, refresh: true } },
    ]);
  });

  test("a refused mr:action rejects with the daemon's error text", async () => {
    const error = "Error: mergePullRequest failed: 405 Pull Request is not mergeable";
    const { provider, sent } = daemon({ "mr:action": [{ ok: false, error }] });
    await expect(provider.mergePullRequest(TARGET.projectPath, 12)).rejects.toThrow(error);
    await expect(provider.setAutoMerge(TARGET.projectPath, 12)).rejects.toThrow(error);
    expect(sent.map((s) => s.cmd)).toEqual(["mr:action", "mr:action"]);
  });

  test("a refused queue read rejects with the daemon's error text", async () => {
    const { provider } = daemon({ "mr:merge-queue-status": [{ ok: false, error: "unsupported: this forge has no merge queue" }] });
    await expect(provider.fetchMergeQueueStatus(TARGET.projectPath, 12)).rejects.toThrow("unsupported: this forge has no merge queue");
  });

  test("mergeOnGitHub reports a merge through the daemon", async () => {
    const { seams } = daemon({
      "mr:merge-queue-status": [{ ok: true, data: { enabled: false, inQueue: false, merged: false, lastRemoval: null } }],
      "mr:action": [{ ok: true }],
      "mr:get": [{ ok: true, data: { mr: MERGED_PR, fetchedAt: 1 } }],
    });
    expect((await mergeOnGitHub(TARGET, {}, seams)).body).toEqual({ merged: true });
  });

  test("a merge that left its source branch behind says why, through the daemon", async () => {
    const sourceBranchNotDeleted = "The source branch was not deleted: GitHub refused the delete with 422.";
    const { seams } = daemon({
      "mr:merge-queue-status": [{ ok: true, data: { enabled: false, inQueue: false, merged: false, lastRemoval: null } }],
      "mr:action": [{ ok: true, sourceBranchNotDeleted }],
      "mr:get": [{ ok: true, data: { mr: MERGED_PR, fetchedAt: 1 } }],
    });
    expect((await mergeOnGitHub(TARGET, { removeSourceBranch: true }, seams)).body).toEqual({ merged: true, sourceBranchNotDeleted });
  });

  test("a merge that landed but could not be read back is unverified, not failed", async () => {
    for (const get of [{ ok: false, error: "rt daemon unreachable" }, { ok: true }]) {
      const { provider, seams } = daemon({
        "mr:merge-queue-status": [{ ok: true, data: { enabled: false, inQueue: false, merged: false, lastRemoval: null } }],
        "mr:action": [{ ok: true }],
        "mr:get": [get],
      });
      expect((await mergeOnGitHub(TARGET, {}, seams)).body).toEqual({ requested: "merge", verified: false });
      const thrown = await provider.mergePullRequest(TARGET.projectPath, 12).catch((e: unknown) => e);
      expect(thrown).toBeInstanceOf(ReadBackFailedError);
      expect((thrown as ReadBackFailedError).writeApplied).toBe(true);
    }
  });
});

describe("resolveGithubTarget", () => {
  const registered = { identityForUrl: async () => ({ identity: "remote:github.com%2Facme%2Fapp" }) };

  test("reads a pull request URL, with or without a trailing path", async () => {
    expect(await resolveGithubTarget({ mrUrl: "https://github.com/acme/app/pull/12" }, registered)).toEqual(TARGET);
    expect(await resolveGithubTarget({ mrUrl: "https://github.com/acme/app/pull/12/files?x=1" }, registered)).toEqual(TARGET);
  });

  test("refuses a repo rt has not registered, before any provider exists", async () => {
    const res = await resolveGithubTarget({ mrUrl: "https://github.com/someone/else/pull/12" });
    expect(res).toEqual({ error: expect.stringContaining("not registered with rt") });
  });

  test("refuses an iid that disagrees with the URL", async () => {
    expect(await resolveGithubTarget({ mrUrl: "https://github.com/acme/app/pull/12", iid: 13 }, registered))
      .toEqual({ error: "iid 13 does not match mrUrl's pull request 12" });
  });

  test("refuses a raw identity for a repo rt has not registered", async () => {
    const res = await resolveGithubTarget({ repoName: "remote:github.com%2Fsomeone%2Felse", iid: 12 }, { isRegistered: () => false });
    expect(res).toEqual({ error: expect.stringContaining("not registered with rt") });
  });

  test("leaves a GitLab URL to the GitLab path", async () => {
    expect(await resolveGithubTarget({ mrUrl: "https://gitlab.example.com/acme/app/-/merge_requests/4" })).toBeNull();
  });
});
