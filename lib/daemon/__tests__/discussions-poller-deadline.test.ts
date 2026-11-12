import { describe, expect, test } from "bun:test";
import { createSweeper } from "../discussions-poller.ts";

type Target = { repoName: string; iid: number };

function recordingLog() {
  const warnings: Array<{ obj: unknown; msg: string }> = [];
  return {
    warnings,
    log: { warn: (obj: unknown, msg: string) => { warnings.push({ obj, msg }); } },
  };
}

const never = () => new Promise<never>(() => {});

describe("discussions poller refresh deadline", () => {
  test("a refresh that passes its deadline ends, is logged, and the sweep moves on", async () => {
    const targets: Target[] = [{ repoName: "r", iid: 1 }, { repoName: "r", iid: 2 }];
    const refreshed: number[] = [];
    const { warnings, log } = recordingLog();
    const sweeper = createSweeper({
      targets: () => targets,
      refresh: async (_repo, iid) => {
        refreshed.push(iid);
        if (iid === 1) return never();
      },
      deadlineMs: 20,
      log,
    });

    await sweeper.sweep();

    expect(refreshed).toEqual([1, 2]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.msg).toBe("r#1 refresh passed its 20ms deadline");
  });

  test("the next tick starts a fresh refresh of an MR whose last one hung", async () => {
    const calls: number[] = [];
    const { log } = recordingLog();
    const sweeper = createSweeper({
      targets: () => [{ repoName: "r", iid: 7 }],
      refresh: async (_repo, iid) => { calls.push(iid); return never(); },
      deadlineMs: 20,
      log,
    });

    await sweeper.sweep();
    await sweeper.sweep();

    expect(calls).toEqual([7, 7]);
  });

  test("a sweep still in flight makes an overlapping tick a no-op", async () => {
    let release!: () => void;
    let calls = 0;
    const { log } = recordingLog();
    const sweeper = createSweeper({
      targets: () => [{ repoName: "r", iid: 1 }],
      refresh: () => { calls++; return new Promise<void>((r) => { release = r; }); },
      deadlineMs: 10_000,
      log,
    });

    const first = sweeper.sweep();
    await sweeper.sweep();
    release();
    await first;

    expect(calls).toBe(1);
  });

  test("a refresh that throws is logged and the sweep continues", async () => {
    const refreshed: number[] = [];
    const { warnings, log } = recordingLog();
    const sweeper = createSweeper({
      targets: () => [{ repoName: "r", iid: 1 }, { repoName: "r", iid: 2 }],
      refresh: async (_repo, iid) => {
        refreshed.push(iid);
        if (iid === 1) throw new Error("boom");
      },
      deadlineMs: 10_000,
      log,
    });

    await sweeper.sweep();

    expect(refreshed).toEqual([1, 2]);
    expect(warnings.map((w) => w.msg)).toEqual(["r#1 refresh failed"]);
  });

  test("a refresh that fails after its deadline still logs why", async () => {
    let fail!: (err: Error) => void;
    const { warnings, log } = recordingLog();
    const sweeper = createSweeper({
      targets: () => [{ repoName: "r", iid: 3 }],
      refresh: () => new Promise<void>((_resolve, reject) => { fail = reject; }),
      deadlineMs: 10,
      log,
    });

    await sweeper.sweep();
    fail(new Error("late boom"));
    await new Promise((r) => setTimeout(r, 0));

    expect(warnings.map((w) => w.msg)).toEqual([
      "r#3 refresh passed its 10ms deadline",
      "r#3 refresh failed after its deadline",
    ]);
    expect((warnings[1]!.obj as { err: Error }).err.message).toBe("late boom");
  });
});
