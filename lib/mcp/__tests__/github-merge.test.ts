import { describe, expect, test } from "bun:test";
import { ReadBackFailedError } from "@mattstack/glance";
import { mergeOnGitHub, resolveGithubTarget, type GithubMergeProvider } from "../github-merge.ts";

const TARGET = { projectPath: "acme/app", iid: 12 };

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
