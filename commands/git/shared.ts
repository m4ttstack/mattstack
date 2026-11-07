import { execFile } from "child_process";
import { flagValue } from "../../lib/cli-args.ts";
import { findAgentWithKey, looksLikeSshAuthFailure } from "../../lib/ssh-agent.ts";
import * as out from "../../lib/ui/out.ts";
import type { Block } from "../../lib/ui/protocol.ts";
import { usageFailure } from "../../lib/ui/usage.ts";
import { hasUrlCredentials, holdsCredentialToken } from "../../lib/team/redact.ts";
import { redactCredentials } from "../../packages/rt-client/src/redact.ts";

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

/** The two members a result object spreads in when it ends in a failure a person will read. */
export function asError(failure: out.FailureInput): { error: string; failure: out.FailureInput } {
  return { error: failure.title, failure };
}

/** A refusal a result carries: `refused` tells the caller to draw a note, never a failure. */
export function asRefusal(failure: out.FailureInput): { error: string; failure: out.FailureInput; refused: true } {
  return { error: failure.title, failure, refused: true };
}

/** A refusal carries no `details`: those are for what went wrong, and here nothing did. */
export function refusalNote(f: out.FailureInput): Block[] {
  return [
    out.line("refused", f.title, f.hint),
    ...(f.why ? [out.callout("why", f.why)] : []),
    ...(f.next !== undefined ? [out.callout("next", f.next)] : []),
  ];
}

export function drawFailure(f: out.FailureInput, refused?: boolean, after: Block[] = []): void {
  if (refused) out.note(...refusalNote(f), ...after);
  else out.fail(f, ...after);
}

export const NOT_ON_A_BRANCH: out.FailureInput = { title: "You are not on a branch", why: "This needs a branch, and HEAD is detached right now." };

export function uncommittedChanges(why: string): out.FailureInput {
  return { title: "You have uncommitted changes", why, next: ["Commit them, or set them aside with ", out.cmd("rt git stash push")] };
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const SCHEME_RE = /^([a-z][a-z0-9+.-]*:\/\/)(.*)$/is;
// A colon in the first segment after `://` with an `@` anywhere after it: a password, even one holding a raw `/` or `@`.
const PASSWORD_SHAPE_RE = /:\/\/[^/@\s]*:[^\s]*@/;

function holdsCredentials(value: string): boolean {
  return hasUrlCredentials(value) || PASSWORD_SHAPE_RE.test(value);
}

/**
 * The only way a remote name or URL reaches the screen. A clean remote prints as given so a printed command stays runnable. Credential userinfo is dropped up to the last `@` of the authority; anything that still looks credentialed afterwards, or a token shape anywhere, prints as `REMOTE`. The argv given to git stays the real value.
 */
export function printable(remote: string): string {
  let shown = remote.trim();
  if (holdsCredentials(shown)) {
    const m = SCHEME_RE.exec(shown);
    const authority = m ? m[2]!.split("/", 1)[0]! : "";
    const at = authority.lastIndexOf("@");
    if (!m || at < 0) return "REMOTE";
    shown = m[1] + m[2]!.slice(at + 1);
    if (holdsCredentials(shown) || shown.includes("@")) return "REMOTE";
  }
  return holdsCredentialToken(shown) || redactCredentials(shown) !== shown ? "REMOTE" : shown;
}

export interface FetchDeps {
  run(cwd: string, env: NodeJS.ProcessEnv): Promise<{ ok: true } | { ok: false; output: string }>;
  findAgent(preferred: string | undefined): Promise<{ socket: string; preferred: boolean } | undefined>;
  env: NodeJS.ProcessEnv;
}

const defaultFetchDeps = (): FetchDeps => ({
  run: (cwd, env) =>
    new Promise((resolve) => {
      execFile("git", ["fetch", "origin"], { cwd, env, encoding: "utf8" }, (err) => {
        resolve(err ? { ok: false, output: errText(err) } : { ok: true });
      });
    }),
  findAgent: (preferred) => findAgentWithKey(preferred),
  env: process.env,
});

/** What a failed `fetchOrigin` throws, its failure ready for `asError`. */
export class FetchFailed extends Error {
  constructor(readonly failure: out.FailureInput) {
    super(failure.details ?? failure.title);
  }
}

export function fetchFailureOf(err: unknown): out.FailureInput {
  return err instanceof FetchFailed ? err.failure : { title: "Could not fetch from origin", details: errText(err) };
}

/**
 * `git fetch origin`, retried once through an ssh-agent that holds a key when
 * this shell's holds none: a herdr pane's agent socket goes stale when the key
 * is loaded after herdr started.
 */
/** Resolves to the env the fetch succeeded under, so the caller's later remote calls (a push) reach the same agent. */
export async function fetchOrigin(cwd: string, deps: FetchDeps = defaultFetchDeps()): Promise<NodeJS.ProcessEnv> {
  const first = await deps.run(cwd, deps.env);
  if (first.ok) return deps.env;
  const plain = new FetchFailed({ title: "Could not fetch from origin", details: first.output });
  if (!looksLikeSshAuthFailure(first.output)) throw plain;
  const found = await deps.findAgent(deps.env.SSH_AUTH_SOCK);
  // An agent holds a key and origin still refused: ssh-add would change nothing.
  if (found?.preferred) throw plain;
  if (found) {
    const env = { ...deps.env, SSH_AUTH_SOCK: found.socket };
    if ((await deps.run(cwd, env)).ok) return env;
    throw plain;
  }
  throw new FetchFailed({
    title: "Could not fetch from origin: no SSH key is loaded",
    why: "git reached origin over SSH, but no ssh-agent on this Mac holds a key. Load yours, then run this again.",
    next: ["Load your key in any terminal with ", out.cmd("ssh-add")],
    details: first.output,
  });
}
