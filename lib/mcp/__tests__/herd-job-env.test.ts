import { describe, expect, test } from "bun:test";
import { withHerdJob, type HerdJobLookups } from "../shared.ts";

type StatusJob = { name: string; agentSession: string | null; status: string };

function lookups(herds: Record<string, StatusJob[]>, calls: string[] = []): HerdJobLookups {
  return {
    list: async () => ({ ok: true, data: { herds: Object.keys(herds).map((id) => ({ id })) } }) as never,
    status: async (herd) => {
      calls.push(herd);
      return { ok: true, data: { jobs: herds[herd] ?? [] } } as never;
    },
  };
}

describe("withHerdJob", () => {
  test("a restored worker with no herd env gets its herd and job from its recorded session", async () => {
    const env = await withHerdJob(
      { CLAUDE_CODE_SESSION_ID: "sess-b" },
      lookups({ "h-1": [{ name: "job-a", agentSession: "sess-a", status: "active" }], "h-2": [{ name: "job-b", agentSession: "sess-b", status: "at-gate" }] }),
    );
    expect(env.HERD_ID).toBe("h-2");
    expect(env.HERD_JOB).toBe("job-b");
  });

  test("an env that already names the job is used as it is, with no daemon call", async () => {
    const calls: string[] = [];
    const env = await withHerdJob({ HERD_ID: "h-1", HERD_JOB: "job-a", CLAUDE_CODE_SESSION_ID: "sess-b" }, lookups({}, calls));
    expect(env.HERD_JOB).toBe("job-a");
    expect(calls).toEqual([]);
  });

  test("a closed job's old session does not claim the herd", async () => {
    const env = await withHerdJob({ CLAUDE_CODE_SESSION_ID: "sess-a" }, lookups({ "h-1": [{ name: "job-a", agentSession: "sess-a", status: "closed" }] }));
    expect(env.HERD_ID).toBeUndefined();
  });

  test("a session no job records stays without a herd, so the tool still refuses", async () => {
    const env = await withHerdJob({ CLAUDE_CODE_SESSION_ID: "sess-x" }, lookups({ "h-1": [{ name: "job-a", agentSession: "sess-a", status: "active" }] }));
    expect(env.HERD_ID).toBeUndefined();
    expect(env.HERD_JOB).toBeUndefined();
  });

  test("an unreachable daemon leaves the env as it was", async () => {
    const env = await withHerdJob(
      { CLAUDE_CODE_SESSION_ID: "sess-a" },
      { list: async () => ({ ok: false, error: "rt daemon unreachable" }) as never, status: async () => { throw new Error("not called"); } },
    );
    expect(env.HERD_ID).toBeUndefined();
  });
});
