/**
 * Expected failures. A command that cannot continue throws one of these
 * with what happened in plain words; the dispatch seam in cli.ts, the
 * exitUserError helper and a --json envelope all read the same object, so
 * the words are written once.
 */
import { logCliEvent } from "./cli-logger.ts";
import { envelope } from "./setup/contract.ts";
import * as out from "./ui/out.ts";

export interface UserActionableErrorOptions {
  /** Why it happened, one plain sentence: the failure block's `why` callout. */
  why?: string;
  /** The command to run, as the person would type it: the `next` callout. */
  next?: string;
  /** Technical detail (raw child output, paths) for the rt log; never shown. */
  log?: string;
}

export class UserActionableError extends Error {
  readonly why?: string;
  readonly next?: string;
  readonly log?: string;

  constructor(
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {},
    options: UserActionableErrorOptions = {},
  ) {
    super(message);
    this.why = options.why;
    this.next = options.next;
    this.log = options.log;
  }
}

export function userErrorPayload(err: UserActionableError, now = new Date()) {
  return envelope({ error: { code: err.code, message: err.message, ...err.extra } }, now);
}

const LOG_DETAILS = "the full output is in the rt log";

export function failureFor(err: UserActionableError): out.FailureInput {
  return {
    title: err.message,
    ...(err.why ? { why: err.why } : {}),
    ...(err.next ? { next: out.cmd(err.next) } : {}),
    ...(err.log ? { details: LOG_DETAILS } : {}),
  };
}

/** A caller that prints a failure without exitUserError calls this, or the log its block points at never gets the detail. */
export function logFailureDetail(err: UserActionableError): void {
  if (err.log) logCliEvent("warn", "errors", err.message, { code: err.code, detail: err.log });
}

/**
 * Prints the contract's exit-2 payload (--json, on stdout, through `print`
 * when the caller has one) or the failure block on stderr, then exits 2.
 * `verb` is kept for the callers; the block carries no prefix.
 */
export function exitUserError(err: UserActionableError, json: boolean, _verb: string, print?: (s: string) => void): never {
  logFailureDetail(err);
  if (json) {
    const payload = userErrorPayload(err);
    if (print) print(JSON.stringify(payload));
    else out.json(payload);
  } else {
    out.fail(failureFor(err));
  }
  process.exit(2);
}

const UNEXPECTED_TITLE = "rt hit an unexpected error";
const LOG_VIEWER = "rt daemon logs";

/**
 * The top of the CLI: an expected failure takes exitUserError's route, so
 * the seam and a verb that handles its own --json write the same envelope;
 * anything else is one line for the person and a stack for the log.
 * ExecFailure is sorted out by the caller first, since its exit code is the
 * plugin's own.
 */
export function exitFromDispatch(err: unknown): never {
  if (err instanceof UserActionableError) return exitUserError(err, process.argv.includes("--json"), "");
  return exitUnexpected(err);
}

export function exitUnexpected(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? err.stack : String(err);
  logCliEvent("error", "cli", message, { stack });
  // The screen gets the stack only where a person is not reading it live, or
  // asked for it; the log always has it. Nothing here touches stdout, so an
  // agent that passed --json reads an empty stdout, never a half envelope.
  const showStack = !out.isHuman("stderr") || process.env.RT_LOG_LEVEL === "debug";
  out.fail(
    { title: UNEXPECTED_TITLE, hint: message.split("\n")[0] ?? message, next: out.cmd(LOG_VIEWER) },
    ...(showStack ? [out.verbatim(stack.split("\n"), "stack")] : []),
  );
  process.exit(1);
}
