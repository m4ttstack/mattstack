import { describe, expect, test } from "bun:test";
import type { ExecResult } from "../../setup/probes.ts";
import type { DevSeams } from "../seams.ts";
import { registerApps } from "../setup.ts";

const DIR = "/clone";
const ok: ExecResult = { code: 0, stdout: "", stderr: "" };
const reset: ExecResult = { code: 1, stdout: "", stderr: "Error: read ECONNRESET" };

/** Answers `deck list` at once and each `deck register` from `registerAnswers` in turn, the last answer repeating. */
function seamsWith(registerAnswers: ExecResult[]) {
  const registers: string[][] = [];
  const sleeps: number[] = [];
  const seams = {
    probes: {
      exec: async (argv: string[]) => {
        if (argv[1] !== "register") return ok;
        registers.push(argv);
        return registerAnswers[Math.min(registers.length, registerAnswers.length) - 1]!;
      },
    },
    swap: { sleep: async (ms: number) => void sleeps.push(ms) },
  } as unknown as DevSeams;
  return { seams, registers, sleeps };
}

const io = { sub() {} };

describe("registerApps retries a dropped connection", () => {
  test("a register that hits ECONNRESET once and then succeeds passes", async () => {
    const { seams, registers, sleeps } = seamsWith([reset, ok]);
    await registerApps(seams, DIR, io);
    expect(registers.filter((r) => r.at(-1) === `${DIR}/apps/board`)).toHaveLength(2);
    expect(sleeps.length).toBeGreaterThan(0);
  });

  test("a register that keeps dropping the connection fails after the retry budget with the last output", async () => {
    const { seams, registers } = seamsWith([reset]);
    await expect(registerApps(seams, DIR, io)).rejects.toMatchObject({ code: "dev-register-failed", log: expect.stringContaining("ECONNRESET") });
    expect(registers.length).toBeGreaterThan(1);
    expect(registers.length).toBeLessThanOrEqual(5);
  });

  test("a register that fails for another reason fails on the first try", async () => {
    const { seams, registers } = seamsWith([{ code: 1, stdout: "", stderr: "no such directory" }]);
    await expect(registerApps(seams, DIR, io)).rejects.toMatchObject({ code: "dev-register-failed", log: "no such directory" });
    expect(registers).toHaveLength(1);
  });
});
