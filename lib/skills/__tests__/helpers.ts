import { spyOn } from "bun:test";
import * as out from "../../ui/out.ts";
import { captureOut, type CapturedOut } from "../../ui/__tests__/capture-out.ts";

let active: CapturedOut | null = null;

/**
 * What a skills command printed, as plain text: console and stream writes
 * alike, with the human gate closed. One at a time; restore() closes it.
 */
export function captureSkills(): CapturedOut {
  const io = captureOut({ console: true });
  out.__test__.reset();
  out.__test__.setHuman(() => false);
  const capture: CapturedOut = {
    ...io,
    restore: () => {
      active = null;
      io.restore();
    },
  };
  active = capture;
  return capture;
}

/**
 * Expected errors print a failure and process.exit instead of throwing a
 * stack. process.exit is mocked to throw a sentinel so the test process
 * lives; `errors` is every stderr line the call wrote. A second console.error
 * spy here would unhook the open capture's own, so this reads that capture
 * when one is open.
 */
export async function runExpectingCleanExit(fn: () => Promise<void>): Promise<{ exitCode: number | undefined; errors: string[] }> {
  const own = active ? null : captureSkills();
  const io = active!;
  const before = io.errLines().length;
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  try {
    await fn();
    return { exitCode: undefined, errors: io.errLines().slice(before) };
  } catch {
    const exitCode = exitSpy.mock.calls.at(-1)?.[0] as number | undefined;
    return { exitCode, errors: io.errLines().slice(before) };
  } finally {
    exitSpy.mockRestore();
    own?.restore();
  }
}
