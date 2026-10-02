/**
 * Step runner: one rt-ui spawn per step so nothing is alive between steps.
 * Off a TTY (agents, pipes, RT_BATCH) nothing is spawned and the step's
 * final line goes through out.print, so every non-interactive path keeps
 * its output and a payload verb keeps its stdout.
 */
import { logCliEvent } from "../cli-logger.ts";
import { interactive } from "./gate.ts";
import * as out from "./out.ts";
import { openStep, type StepHandle } from "./spawn.ts";

export { __test__ } from "./gate.ts";

export interface StepRunner {
  /** Run an async step with spinner then done/error transition. */
  run<T>(
    pending: string,
    task: (step: { sub(text: string): void }) => Promise<T>,
    opts?: { done?: string; doneHint?: string; error?: string; errorHint?: string },
  ): Promise<T>;
}

function stripEllipsis(s: string): string {
  return s.replace(/…$/, "");
}

function plain(status: "done" | "failed", title: string, hint?: string): void {
  out.print(out.line(status, title, hint));
}

// A dead helper must never cost the person the result line: the caller
// prints it through the layer, and this says once per step that the
// progress line was lost. The reason goes to the log, not the screen.
function helperFailed(why: string): void {
  logCliEvent("warn", "rt-ui", `rt-ui steps ${why}; printed plain text instead`);
  out.note(out.line("warn", "rt could not draw a progress line", "results still print"));
}

// The helper only narrates a step, so nothing about it may reach the caller as
// a failure: an unresolvable or unspawnable rt-ui leaves no handle, and the
// task then runs and reports itself on the plain path.
function tryOpenStep(pending: string): StepHandle | null {
  try {
    return openStep(pending);
  } catch (e) {
    helperFailed(`could not start: ${(e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").trim()}`);
    return null;
  }
}

export function createStepRunner(): StepRunner {
  return {
    async run<T>(
      pending: string,
      task: (step: { sub(text: string): void }) => Promise<T>,
      opts?: { done?: string; doneHint?: string; error?: string; errorHint?: string },
    ) {
      const step: StepHandle | null = interactive() ? tryOpenStep(pending) : null;
      try {
        const r = await task({ sub: (text) => step?.sub(text) });
        const title = opts?.done ?? stripEllipsis(pending);
        if (!step) {
          plain("done", title, opts?.doneHint);
        } else if (!(await step.done(title, opts?.doneHint))) {
          plain("done", title, opts?.doneHint);
          helperFailed("exited before the step finished");
        }
        return r;
      } catch (e) {
        const hint = opts?.errorHint ?? (e instanceof Error ? e.message : undefined);
        const title = opts?.error ?? `${stripEllipsis(pending)} failed`;
        if (!step) {
          plain("failed", title, hint);
        } else if (!(await step.fail(title, hint))) {
          plain("failed", title, hint);
          helperFailed("exited before the step finished");
        }
        throw e;
      }
    },
  };
}

/** Legacy wrapper; use createStepRunner() for new code. */
export async function withSpinner<T>(
  label: string,
  task: () => Promise<T>,
  opts?: { doneLabel?: string; failLabel?: string; errorHint?: string },
): Promise<T> {
  return createStepRunner().run(label, task, { done: opts?.doneLabel, error: opts?.failLabel, errorHint: opts?.errorHint });
}
