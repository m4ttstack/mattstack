import type { GateQuestion } from "./commands.ts";

export const GATE_FORM_OPTION_CAP = 4;

/** The ONE presentation rule (spec Phase 1): form iff an injectable pane
    exists, a nudge target exists, and every question fits the native form's
    per-question option cap. `kit` draws the gate itself, so it needs the
    pane and the nudge target but no cap. */
export function gatePresentation(args: {
  paneId?: string | undefined;
  sessionId?: string | undefined;
  questions: GateQuestion[];
  kit?: boolean | undefined;
}): "form" | "wait" | "kit" {
  if (!args.paneId || !args.sessionId) return "wait";
  if (args.kit) return "kit";
  return args.questions.every((q) => q.options.length <= GATE_FORM_OPTION_CAP)
    ? "form"
    : "wait";
}
