import { describe, expect, test } from "bun:test";
import { ReadBackFailedError } from "@mattstack/glance";
import { mergeOnGitHub, resolveGithubTarget, type GithubMergeProvider } from "../github-merge.ts";

const TARGET = { projectPath: "acme/app", iid: 12 };

function github(queue: { enabled: boolean; inQueue: boolean }, over: Partial<GithubMergeProvider> = {}) {
  const calls: string[] = [];
  const provider = {
    fetchMergeQueueStatus: async () => queue,
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
    expect((await mergeOnGitHub(TARGET, {}, provider)).body).toEqual({ queued: true, position: 2, state: "QUEUED" });
    expect(calls).toEqual(["enqueue"]);
  });

  test("a PR already in the queue is left there", async () => {
    const { provider, calls } = github({ enabled: true, inQueue: true });
    expect((await mergeOnGitHub(TARGET, {}, provider)).body).toEqual({ queued: true, alreadyQueued: true });
    expect(calls).toEqual([]);
  });

  test("a queued repo refuses options the queue cannot honour, without touching the PR", async () => {
    for (const options of [{ squash: true }, { removeSourceBranch: false }, { whenPipelineSucceeds: true }]) {
      const { provider, calls } = github({ enabled: true, inQueue: false });
      const res = await mergeOnGitHub(TARGET, options, provider);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("merge queue");
      expect(calls).toEqual([]);
    }
  });

  test("a repo with no queue merges directly with the caller's options", async () => {
    const { provider, calls } = github({ enabled: false, inQueue: false });
    expect((await mergeOnGitHub(TARGET, { squash: true, removeSourceBranch: true }, provider)).body).toEqual({ merged: true });
    expect(calls).toEqual(['merge {"squash":true,"shouldRemoveSourceBranch":true}']);
  });

  test("a repo with no queue arms auto-merge for whenPipelineSucceeds", async () => {
    const { provider, calls } = github({ enabled: false, inQueue: false });
    expect((await mergeOnGitHub(TARGET, { whenPipelineSucceeds: true }, provider)).body).toEqual({ autoMerge: true });
    expect(calls).toEqual(["autoMerge"]);
  });

  test("only an observed merge reads as merged", async () => {
    const mergePullRequest = (async () => ({ state: "opened" })) as unknown as GithubMergeProvider["mergePullRequest"];
    const { provider } = github({ enabled: false, inQueue: false }, { mergePullRequest });
    expect((await mergeOnGitHub(TARGET, {}, provider)).body).toEqual({ requested: "merge", verified: false, state: "opened" });
  });

  test("a merge whose read-back failed is unverified, not failed", async () => {
    const mergePullRequest = (async () => {
      throw Object.assign(Object.create(ReadBackFailedError.prototype), { writeApplied: true });
    }) as unknown as GithubMergeProvider["mergePullRequest"];
    const { provider } = github({ enabled: false, inQueue: false }, { mergePullRequest });
    expect((await mergeOnGitHub(TARGET, {}, provider)).body).toEqual({ requested: "merge", verified: false });
  });

  test("a failed queue lookup stops before any write", async () => {
    const fetchMergeQueueStatus = async () => {
      throw new Error("fetchMergeQueueStatus failed: 502");
    };
    const { provider, calls } = github({ enabled: true, inQueue: false }, { fetchMergeQueueStatus });
    const res = await mergeOnGitHub(TARGET, {}, provider);
    expect(res.error).toBe("fetchMergeQueueStatus failed: 502");
    expect(calls).toEqual([]);
  });

  test("no token is refused", async () => {
    const res = await mergeOnGitHub(TARGET, {}, async () => null);
    expect(res.error).toContain("gh auth login");
  });
});

describe("resolveGithubTarget", () => {
  test("reads a pull request URL, with or without a trailing path", async () => {
    expect(await resolveGithubTarget({ mrUrl: "https://github.com/acme/app/pull/12" })).toEqual(TARGET);
    expect(await resolveGithubTarget({ mrUrl: "https://github.com/acme/app/pull/12/files?x=1" })).toEqual(TARGET);
  });

  test("refuses an iid that disagrees with the URL", async () => {
    expect(await resolveGithubTarget({ mrUrl: "https://github.com/acme/app/pull/12", iid: 13 }))
      .toEqual({ error: "iid 13 does not match mrUrl's pull request 12" });
  });

  test("leaves a GitLab URL to the GitLab path", async () => {
    expect(await resolveGithubTarget({ mrUrl: "https://gitlab.example.com/acme/app/-/merge_requests/4" })).toBeNull();
  });
});
