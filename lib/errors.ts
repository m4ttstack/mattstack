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

function noteDetail(err: UserActionableError): void {
  if (err.log) logCliEvent("warn", "errors", err.message, { code: err.code, detail: err.log });
}

/**
 * Prints the contract's exit-2 payload (--json, on stdout, through `print`
 * when the caller has one) or the failure block on stderr, then exits 2.
 * `verb` is kept for the callers; the block carries no prefix.
 */
export function exitUserError(err: UserActionableError, json: boolean, _verb: string, print?: (s: string) => void): never {
  noteDetail(err);
  if (json) {
    const payload = userErrorPayload(err);
    if (print) print(JSON.stringify(payload));
    else out.json(payload);
  } else {
    out.fail(failureFor(err));
  }
  process.exit(2);
}
