import { spyOn } from "bun:test";
import { cpSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
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

const SLOT_ENGINES = join(import.meta.dir, "fixtures", "slot-engines");

/**
 * Swaps the real stage-evidence, stage-watch-ci and work engines under a copied
 * `attachments` dir for their slot-engine SKILL.md, for cases that still bind
 * their v1 `domain`, `forge` and `tiering` slots. Scripts and tests beside them stay.
 */
export function useSlotEngines(attachments: string): void {
  for (const engine of readdirSync(SLOT_ENGINES)) {
    const dir = join(attachments, "pipeline", engine);
    const entries = (readdirSync(dir, { recursive: true }) as string[]).sort().reverse();
    for (const rel of entries) {
      const path = join(dir, rel);
      if (rel.endsWith(".block.md")) rmSync(path);
      else if (statSync(path).isDirectory() && readdirSync(path).length === 0) rmSync(path, { recursive: true });
    }
    cpSync(join(SLOT_ENGINES, engine, "SKILL.md"), join(dir, "SKILL.md"));
  }
}
