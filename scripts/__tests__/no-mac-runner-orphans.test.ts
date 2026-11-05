import { afterEach, describe, expect, test } from "bun:test";
import { join } from "path";

const HOOK = join(import.meta.dir, "..", "ci", "mac-runner", "job-completed.sh");
const ROOT = `/tmp/mac-runner-${process.pid}-${Math.random().toString(36).slice(2)}`;
const started: Array<ReturnType<typeof Bun.spawn>> = [];

/** A process whose arguments start with `path`, as a daemon left by a job's binary does. */
async function leftover(path: string): Promise<ReturnType<typeof Bun.spawn>> {
  const proc = Bun.spawn(["bash", "-c", `exec -a ${path} sleep 60`], { env: { PATH: process.env.PATH ?? "" }, stdout: "ignore", stderr: "ignore" });
  started.push(proc);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (Bun.spawnSync(["pgrep", "-f", `^${path}`], { env: { PATH: process.env.PATH ?? "" } }).exitCode === 0) return proc;
    await Bun.sleep(20);
  }
  throw new Error(`${path} never started`);
}

async function runHook(env: Record<string, string>): Promise<number> {
  // The runner runs a job hook with -e, so any failing command fails the job.
  const hook = Bun.spawn(["bash", "-e", HOOK], { env: { PATH: process.env.PATH ?? "", ...env }, stdout: "ignore", stderr: "ignore" });
  return hook.exited;
}

async function exited(proc: ReturnType<typeof Bun.spawn>): Promise<boolean> {
  return Promise.race([proc.exited.then(() => true), Bun.sleep(1_000).then(() => false)]);
}

afterEach(() => {
  for (const proc of started.splice(0)) proc.kill(9);
});

describe("the Mac runner's job-completed hook", () => {
  test("kills what the job left in this runner's _work and nothing else", async () => {
    const mine = await leftover(`${ROOT}/mac-1/_work/repo/repo/dist/rt`);
    const otherRunner = await leftover(`${ROOT}/mac-10/_work/repo/repo/dist/rt`);
    const runnerItself = await leftover(`${ROOT}/mac-1/bin/Runner.Worker`);

    expect(await runHook({ MAC_RUNNER_DIR: `${ROOT}/mac-1` })).toBe(0);

    expect(await exited(mine)).toBe(true);
    expect(await exited(otherRunner)).toBe(false);
    expect(await exited(runnerItself)).toBe(false);
  });

  test("never fails the job", async () => {
    expect(await runHook({ MAC_RUNNER_DIR: `${ROOT}/nothing-running` })).toBe(0);
    expect(await runHook({})).toBe(0);
  });
});
