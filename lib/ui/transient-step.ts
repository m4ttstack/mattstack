/**
 * A spinner that leaves nothing behind. The Go step draws it and erases it
 * when the task settles, resolved or thrown; the caller prints the result.
 * Off a terminal, or when rt-ui cannot start, the task just runs.
 *
 * spawn.ts is loaded on first use, never imported at the top, type imports
 * included: files the daemon loads import this module, and the daemon graph
 * must not reach spawn.ts (lib/__tests__/no-eager-tui.test.ts).
 */
import { logCliEvent } from "../cli-logger.ts";
import { interactive } from "./gate.ts";

export async function withTransientStep<T>(label: string, task: () => Promise<T>): Promise<T> {
  if (!interactive()) return task();
  let step: { clear(opts?: { thrown?: boolean }): Promise<boolean> } | null = null;
  try {
    const { openStep } = await import("./spawn.ts");
    step = openStep(label);
  } catch (err) {
    logCliEvent("warn", "rt-ui", "rt-ui steps did not start; ran without a spinner", { error: err instanceof Error ? err.message : String(err) });
  }
  let thrown = false;
  try {
    return await task();
  } catch (err) {
    thrown = true;
    throw err;
  } finally {
    await step?.clear({ thrown });
  }
}
