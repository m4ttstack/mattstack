import { flagValue } from "../../lib/cli-args.ts";
import * as out from "../../lib/ui/out.ts";
import type { Block } from "../../lib/ui/protocol.ts";
import { usageFailure } from "../../lib/ui/usage.ts";

/**
 * The one exit for a git verb that cannot go on. Under --json the envelope
 * is `{ ok: false, error }` on stdout, and `error` is a string scripts match
 * on, so it is passed in separately from what a person reads. Exit 1 either
 * way.
 */
export function failWith(json: boolean, error: string, failure: out.FailureInput): never {
  if (json) out.json({ ok: false, error });
  else out.fail(failure);
  process.exit(1);
}

/** A failure whose detail is the tool's own message, git's as a rule. */
export function failPlain(json: boolean, title: string, message: string): never {
  return failWith(json, message, { title, details: message });
}

/** A missing or malformed argument. `usage` is the --json error string, its "usage:" prefix included. */
export function failUsage(json: boolean, title: string, usage: string, why?: string): never {
  return failWith(json, usage, usageFailure(title, usage, why));
}

/**
 * rt declining by policy, which is never a failure: a `refused` note on
 * stderr for a person, the unchanged `{ ok: false, error }` under --json.
 * Exit 1 either way.
 */
export function refuseWith(json: boolean, error: string, ...blocks: Block[]): never {
  if (json) out.json({ ok: false, error });
  else out.note(...blocks);
  process.exit(1);
}

/** `flagValue`'s own message stays the --json error: lib/cli-args.ts has other callers. */
export function readFlag(json: boolean, args: string[], flag: string, usage: string): string | undefined {
  try {
    return flagValue(args, flag);
  } catch (err) {
    return failWith(json, errText(err), usageFailure(`${flag} needs a value after it`, usage));
  }
}

/** A refusal carries no `details`: those are for what went wrong, and here nothing did. */
export function refusalNote(f: out.FailureInput): Block[] {
  return [
    out.line("refused", f.title, f.hint),
    ...(f.why ? [out.callout("why", f.why)] : []),
    ...(f.next !== undefined ? [out.callout("next", f.next)] : []),
  ];
}

export const NOT_ON_A_BRANCH: out.FailureInput = { title: "You are not on a branch", why: "This needs a branch, and HEAD is detached right now." };

export function uncommittedChanges(why: string): out.FailureInput {
  return { title: "You have uncommitted changes", why, next: ["Commit them, or set them aside with ", out.cmd("rt git stash push")] };
}

export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
