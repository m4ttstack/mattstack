import { describe, expect, test } from "bun:test";
import { runPrEnqueue, type PrEnqueueDeps } from "../pr.ts";

const SHA = "a".repeat(40);

function deps(over: Partial<PrEnqueueDeps> = {}) {
  const calls: unknown[][] = [];
  const d: PrEnqueueDeps = {
    originUrl: async () => "git@github.com:acme/app.git",
    forgeToken: async () => ({ forge: "github", token: "tok" }),
    enqueue: async (...a) => {
      calls.push(a);
      return { position: 3, state: "QUEUED" };
    },
    ...over,
  };
  return { d, calls };
}

describe("runPrEnqueue", () => {
  test("enqueues on the origin repo and reports the position", async () => {
    const { d, calls } = deps();
    expect(await runPrEnqueue(["12"], d)).toEqual({ ok: true, pr: 12, position: 3, state: "QUEUED" });
    expect(calls).toEqual([["https://github.com", "tok", "acme/app", 12, undefined]]);
  });

  test("passes --head, on either side of the number", async () => {
    for (const args of [["12", "--head", SHA], ["--head", SHA, "12"]]) {
      const { d, calls } = deps();
      await runPrEnqueue(args, d);
      expect(calls[0]).toEqual(["https://github.com", "tok", "acme/app", 12, SHA]);
    }
  });

  test("refuses a bad number and a --head with no sha, without calling the forge", async () => {
    for (const args of [[], ["abc"], ["0"], ["1.5"], ["0x10"], ["1e3"], ["12", "13"], ["12", "--force"], ["12", "-f"], ["12", "--head"], ["12", "--head", "--json"], ["12", "--head", "abc1234"], ["12", `--head=${SHA}`]]) {
      const { d, calls } = deps();
      expect((await runPrEnqueue(args, d)).ok).toBe(false);
      expect(calls).toEqual([]);
    }
  });

  test("refuses a GitLab remote, a missing token and a missing origin", async () => {
    expect(await runPrEnqueue(["1"], deps({ forgeToken: async () => ({ forge: "gitlab", token: "t" }) }).d))
      .toEqual({ ok: false, error: "rt pr enqueue only works on GitHub repos" });
    expect(await runPrEnqueue(["1"], deps({ forgeToken: async () => ({ forge: "github", token: null }) }).d))
      .toEqual({ ok: false, error: "No GitHub token found", next: "gh auth login" });
    expect(await runPrEnqueue(["1"], deps({ originUrl: async () => undefined }).d))
      .toEqual({ ok: false, error: "could not read this checkout's origin remote" });
  });

  test("reports a failure to load credentials", async () => {
    const forgeToken = async () => { throw new Error("secrets store is locked"); };
    expect(await runPrEnqueue(["1"], deps({ forgeToken }).d)).toEqual({ ok: false, error: "secrets store is locked" });
  });

  test("reports the forge's refusal", async () => {
    const enqueue = async () => { throw new Error("enqueuePullRequest failed: head moved"); };
    expect(await runPrEnqueue(["1"], deps({ enqueue }).d)).toEqual({ ok: false, error: "enqueuePullRequest failed: head moved" });
  });
});
