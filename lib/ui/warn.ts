/**
 * The one way code under lib/ warns. The message always reaches a log; a
 * person sees a line only when the caller says what they should read.
 *
 * This module is loaded by the daemon too, which has its own log surface and
 * nobody watching its stderr. So the CLI entry sets the log; with none set a
 * warning is the plain stderr line it has always been, which the daemon's
 * stderr capture files where it belongs.
 */
import { callout, line, note, type CellInput } from "./out.ts";

export type WarningLog = (module: string, message: string, context: Record<string, unknown>) => void;

export interface ShownWarning {
  title: string;
  hint?: string;
  /** The command that looks into it. */
  next?: CellInput;
}

export interface WarnOptions {
  /** Structured detail for the log line: a path, a key, an error. */
  context?: Record<string, unknown>;
  /** What a person reads. Omit it and the warning is log only. */
  show?: ShownWarning;
}

let log: WarningLog | null = null;
let quiet = false;
const shown = new Set<string>();

/** quiet: logged, never shown. For a process whose stderr belongs to another program. */
export function setWarningLog(next: WarningLog | null, opts: { quiet?: boolean } = {}): void {
  log = next;
  quiet = opts.quiet ?? false;
}

export function warn(module: string, message: string, opts: WarnOptions = {}): void {
  if (!log) {
    process.stderr.write(`rt: ${message}\n`);
    return;
  }
  try {
    log(module, message, opts.context ?? {});
  } catch {
    /* a warning must never break the command that raised it */
  }
  if (!opts.show || quiet) return;
  // Code on a hot path warns on every call; a person needs it once.
  const key = `${opts.show.title}\n${opts.show.hint ?? ""}`;
  if (shown.has(key)) return;
  shown.add(key);
  note(line("warn", opts.show.title, opts.show.hint), ...(opts.show.next === undefined ? [] : [callout("next", opts.show.next)]));
}

export const __test__ = {
  reset(): void {
    log = null;
    quiet = false;
    shown.clear();
  },
};
