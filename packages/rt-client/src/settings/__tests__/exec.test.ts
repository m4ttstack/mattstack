import { describe, expect, spyOn, test } from "bun:test";
import { runCapture } from "../exec.ts";

describe("runCapture deadline reporting", () => {
  test("a child that dies of the deadline's own kill still reports the timeout", async () => {
    const realSpawn = Bun.spawn;
    // The stall lands after the deadline is armed, as a GC pause or a descheduled thread would.
    const spawn = spyOn(Bun, "spawn").mockImplementation(((...args: Parameters<typeof Bun.spawn>) => {
      const proc = realSpawn(...args);
      return new Proxy(proc, {
        get(target, key) {
          if (key === "stdout") Bun.sleepSync(100);
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }) as unknown as typeof Bun.spawn);
    try {
      const r = await runCapture(["/bin/sleep", "20"], { timeoutMs: 50 });
      expect(r.exitCode).toBe(-1);
      expect(r.timedOut).toBe(true);
    } finally {
      spawn.mockRestore();
    }
  });
});
