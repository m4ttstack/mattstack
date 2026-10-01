import { cmd, type FailureInput } from "./out.ts";

/**
 * A failure for a missing or wrong argument. The title asks for what is
 * missing in plain words; the usage line is the command to run, never part
 * of the sentence. A leading "usage:" is dropped, so a caller may pass the
 * string its --json error already carries.
 */
export function usageFailure(title: string, usage: string, why?: string): FailureInput {
  return { title, ...(why ? { why } : {}), next: cmd(usage.replace(/^\s*usage:\s*/i, "")) };
}
