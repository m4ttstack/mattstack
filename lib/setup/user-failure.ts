/**
 * The exit-2 path every setup verb shares. The envelope on stdout is the
 * app's contract and keeps the error's own message; the failure block a
 * person sees may carry plainer words from the call site.
 */
import { failureFor, UserActionableError, userErrorPayload } from "../errors.ts";
import * as out from "../ui/out.ts";
import type { FailureInput } from "../ui/out.ts";

export function userFailure(err: UserActionableError, human: Partial<FailureInput> = {}): FailureInput {
  const base = failureFor(err);
  const pick = <K extends keyof FailureInput>(k: K) => human[k] ?? base[k];
  return {
    title: pick("title") ?? err.message,
    ...(pick("hint") ? { hint: pick("hint") } : {}),
    ...(pick("why") ? { why: pick("why") } : {}),
    ...(pick("next") ? { next: pick("next") } : {}),
    ...(pick("details") ? { details: pick("details") } : {}),
  };
}

export interface UserErrorSink {
  json: (value: unknown) => void;
  exit: (code: number) => never;
  now: () => Date;
}

export function exitWithUserError(err: UserActionableError, json: boolean, sink: UserErrorSink, human?: Partial<FailureInput>): never {
  if (json) sink.json(userErrorPayload(err, sink.now()));
  else out.fail(userFailure(err, human));
  return sink.exit(2);
}
