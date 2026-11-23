import { mkdirSync, writeFileSync } from "fs";
import { expect, test } from "bun:test";
import type { Logger } from "pino";
import { DAEMON_PID_PATH, RT_DIR } from "../../daemon-config.ts";
import { STALE_DAEMON_GRACE_MS, evictStaleDaemon } from "../boot-reconcile.ts";
import { DRAIN_CAP_MS } from "../drain.ts";

mkdirSync(RT_DIR, { recursive: true });

const silentLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("evictStaleDaemon waits for the old pid to die, escalating to SIGKILL", async () => {
  const child = Bun.spawn({ cmd: ["bash", "-c", "trap '' TERM; sleep 30"] });
  // The trap must be installed before the SIGTERM lands, or bash just dies of it.
  await Bun.sleep(300);
  writeFileSync(DAEMON_PID_PATH, String(child.pid));
  const start = Date.now();
  await evictStaleDaemon(silentLog, 1_000);
  expect(isAlive(child.pid)).toBe(false);
  expect(Date.now() - start).toBeLessThan(5000);
  await child.exited;
  expect(child.signalCode).toBe("SIGKILL");
  expect(Date.now() - start).toBeGreaterThanOrEqual(1_000);
});

test("the eviction grace outlasts the old daemon's drain cap", () => {
  expect(STALE_DAEMON_GRACE_MS).toBeGreaterThanOrEqual(DRAIN_CAP_MS + 2_000);
});

test("a stale daemon that takes 3s to shut down after SIGTERM is left to finish, not SIGKILLed", async () => {
  const child = Bun.spawn({ cmd: ["bash", "-c", "trap 'sleep 3; exit 0' TERM; while :; do sleep 0.1; done"] });
  await Bun.sleep(300);
  writeFileSync(DAEMON_PID_PATH, String(child.pid));
  await evictStaleDaemon(silentLog);
  expect(isAlive(child.pid)).toBe(false);
  expect(await child.exited).toBe(0);
  expect(child.signalCode).toBeNull();
}, 15_000);

test("evictStaleDaemon does not throw when the pid exits between the liveness check and the SIGTERM send (ESRCH)", async () => {
  writeFileSync(DAEMON_PID_PATH, "999999");
  const originalKill = process.kill;
  let sigtermSent = false;
  (process as any).kill = (pid: number, signal?: string | number) => {
    if (pid !== 999999) return originalKill(pid, signal as any);
    if (signal === 0) return true; // liveness check still sees it alive
    if (signal === "SIGTERM") {
      sigtermSent = true;
      const err = Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
      throw err;
    }
    throw new Error(`unexpected signal in test: ${String(signal)}`);
  };
  try {
    await expect(evictStaleDaemon(silentLog)).resolves.toBeUndefined();
  } finally {
    process.kill = originalKill;
  }
  expect(sigtermSent).toBe(true);
});
