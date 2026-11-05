import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";
import { rtDir } from "../../rt-paths.ts";
import { rtSelfArgv } from "../../rt-self.ts";
import { spawnUsageSweep, usageSweepArgv, type SweepChild, type SweepSpawn } from "../usage-sweep.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");

interface Call { argv: string[]; opts: Parameters<SweepSpawn>[1] }

function recorder(exitCode: number | "hang", stderr = "") {
  const calls: Call[] = [];
  const killed: string[] = [];
  const spawn: SweepSpawn = (argv, opts) => {
    calls.push({ argv, opts });
    let finish!: (code: number) => void;
    const exited = new Promise<number>((resolve) => { finish = resolve; });
    if (exitCode !== "hang") finish(exitCode);
    const child: SweepChild = {
      exited,
      stderr: new Response(stderr).body!,
      kill: (signal) => { killed.push(String(signal)); finish(137); },
    };
    return child;
  };
  return { calls, spawn, killed };
}

describe("usageSweepArgv", () => {
  test("from source it runs cli.ts, never the daemon entry", () => {
    const argv = usageSweepArgv({ compiled: false, execPath: "/bin/bun" });
    expect(argv).toEqual(["/bin/bun", "--no-env-file", `--config=${join(ROOT, "bunfig.toml")}`, join(ROOT, "cli.ts"), "usage", "sweep"]);
    expect(existsSync(join(ROOT, "cli.ts"))).toBe(true);
    expect(existsSync(join(ROOT, "bunfig.toml"))).toBe(true);
  });

  test("compiled it is the binary alone", () => {
    expect(usageSweepArgv({ compiled: true, execPath: "/App/rt" })).toEqual(["/App/rt", "usage", "sweep"]);
  });

  test("the default is rtSelfArgv pointed at cli.ts", () => {
    expect(usageSweepArgv()).toEqual([...rtSelfArgv({ main: join(ROOT, "cli.ts") }), "usage", "sweep"]);
  });
});

describe("spawnUsageSweep", () => {
  test("spawns the argv from a stable cwd with childEnv", async () => {
    process.env.USAGE_SWEEP_PROBE = "1";
    try {
      const { calls, spawn } = recorder(0);
      await spawnUsageSweep({ argv: ["rt", "usage", "sweep"], spawn });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.argv).toEqual(["rt", "usage", "sweep"]);
      expect(calls[0]!.opts.cwd).toBe(rtDir());
      expect(calls[0]!.opts.env.USAGE_SWEEP_PROBE).toBe("1");
    } finally {
      delete process.env.USAGE_SWEEP_PROBE;
    }
  });

  test("a nonzero exit rejects with the tail of stderr", async () => {
    const { spawn } = recorder(1, `${"noise\n".repeat(1000)}boom at the end`);
    const err = await spawnUsageSweep({ argv: ["rt"], spawn }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("exited 1");
    expect((err as Error).message).toContain("boom at the end");
    expect((err as Error).message.length).toBeLessThan(3000);
  });

  test("a sweep still running at the deadline is killed and rejects", async () => {
    const { spawn, killed } = recorder("hang");
    const err = await spawnUsageSweep({ argv: ["rt"], spawn, timeoutMs: 20 }).catch((e: Error) => e);
    expect((err as Error).message).toContain("timed out");
    expect(killed).toEqual(["SIGKILL"]);
  });

  test("a normal exit clears the deadline, so nothing is killed late", async () => {
    const { spawn, killed } = recorder(0);
    await spawnUsageSweep({ argv: ["rt"], spawn, timeoutMs: 20 });
    await Bun.sleep(60);
    expect(killed).toEqual([]);
  });

  test("a second tick while one is running does not spawn", async () => {
    const first = recorder("hang");
    const running = spawnUsageSweep({ argv: ["rt"], spawn: first.spawn, timeoutMs: 50 });
    const second = recorder(0);
    await spawnUsageSweep({ argv: ["rt"], spawn: second.spawn });
    expect(second.calls).toHaveLength(0);
    await running.catch(() => {});
    await spawnUsageSweep({ argv: ["rt"], spawn: second.spawn });
    expect(second.calls).toHaveLength(1);
  });

  test("a failed run frees the next tick", async () => {
    await spawnUsageSweep({ argv: ["rt"], spawn: recorder(2).spawn }).catch(() => {});
    const next = recorder(0);
    await spawnUsageSweep({ argv: ["rt"], spawn: next.spawn });
    expect(next.calls).toHaveLength(1);
  });

  test("a spawn that throws rejects and frees the next tick", async () => {
    const boom: SweepSpawn = () => { throw new Error("ENOENT"); };
    await expect(spawnUsageSweep({ argv: ["rt"], spawn: boom })).rejects.toThrow("ENOENT");
    const next = recorder(0);
    await spawnUsageSweep({ argv: ["rt"], spawn: next.spawn });
    expect(next.calls).toHaveLength(1);
  });
});
