/**
 * herd:diagnose's verdict: why a worker is stuck, decided from its job row,
 * its pane's herdr state, its open gates and, for an idle pane only, Claude
 * Code's own limit and auth messages on its screen. The screen text is
 * classified here and never leaves this module.
 */
import type { Commands, HerdDiagnoseVerdict } from "../../packages/rt-client/src/commands.ts";
import type { HerdJobStatus } from "./herd-store.ts";
import { RULE_LINE } from "./herd-watchdog-adapters.ts";

/** Verbatim from Claude Code 2.1.301's limit message list. The warning-only
    prefixes ("You've used", "You're close to") are deliberately absent. */
export const LIMIT_PREFIXES: readonly string[] = [
  "You've hit your",
  "You've reached your",
  "You're out of usage credits",
  "Your org is out of usage",
  "Your seat type doesn't include",
  "Your usage allocation has been disabled",
  "Your group's usage limit is set to $0",
  "You're out of extra usage",
];

export const LIMIT_CREDITS_RE = /^(?:Fable|Haiku|Mythos|Opus|Sonnet)(?: [^·\n]{1,40})? requires usage credits\./;

export const LOGIN_RE = /^(?:API Error: 401|Login expired|OAuth token revoked|Not logged in|Please run \/login|Session expired|Failed to authenticate|Authentication required)/;

const GUTTER = /^\s*(?:⎿\s*)?/;

export type ScreenClass = "rate-limited" | "login-expired";

export function classifyScreen(text: string): ScreenClass | null {
  const lines = text.split("\n");
  let rule = -1;
  for (let i = 0; i < lines.length; i++) if (RULE_LINE.test(lines[i]!)) rule = i;
  if (rule < 0) return null;
  let limited = false;
  for (const raw of lines.slice(0, rule)) {
    const line = raw.replace(GUTTER, "");
    if (LOGIN_RE.test(line)) return "login-expired";
    if (LIMIT_PREFIXES.some((p) => line.startsWith(p)) || LIMIT_CREDITS_RE.test(line)) limited = true;
  }
  return limited ? "rate-limited" : null;
}

export type DiagnosePaneState = Commands["herd:diagnose"]["data"]["paneState"];

export function diagnoseVerdict(input: {
  hasPane: boolean;
  paneState: DiagnosePaneState;
  openGates: number;
  jobStatus: HerdJobStatus;
  screen: ScreenClass | null;
}): HerdDiagnoseVerdict {
  if (!input.hasPane) return "no-pane";
  if (input.paneState === "gone") return "gone";
  if (input.paneState === "dead") return "dead";
  if (input.openGates > 0) return "at-gate";
  if (input.jobStatus === "stuck-at-modal") return "parked-modal";
  if (input.paneState === "modal") return "needs-human";
  if (input.paneState === "working") return "working";
  return input.screen ?? "idle";
}
