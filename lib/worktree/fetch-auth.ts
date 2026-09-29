/**
 * Credentials for the worktree pool's fetches. The pool never clones: the
 * golden and every member are `git worktree add`s of the registered checkout,
 * so they fetch from that checkout's origin with whatever credentials it has.
 * A checkout on an https origin with no credential helper (an rt-made clone,
 * or a user's own) has nothing to answer git with from the daemon, so rt's
 * forge token is offered through an appended helper: the checkout's own
 * helpers still answer first, and SSH or local origins are left untouched.
 */

import { createRealProbes } from "../setup/probes.ts";
import { readUserIntegrationOverrides } from "../setup/team-settings.ts";
import { forgeTokenKey, gitWithToken } from "../team/git-credential.ts";
import { forgeTokenLookupReal, mayOfferToken, tokenOrNull } from "../team/forge-token.ts";
import { runGit, type GitResult } from "./git-async.ts";

export interface FetchAuthSeams {
  confirmedHost: () => string | null;
  tokenFor: (remote: string) => Promise<string | null>;
}

export interface FetchAuth {
  args: string[];
  env: Record<string, string>;
}

/** A token read is a keychain unlock plus a sops decrypt; freshen fetches every pool tree each pass. */
const TOKEN_TTL_MS = 5 * 60_000;
const tokenCache = new Map<string, { value: string | null; at: number }>();

async function cachedTokenFor(remote: string): Promise<string | null> {
  const key = forgeTokenKey(remote);
  if (!key) return null;
  const hit = tokenCache.get(key);
  if (hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.value;
  const lookup = await forgeTokenLookupReal(createRealProbes(), remote);
  if (lookup.kind === "unreadable") return null;
  const value = tokenOrNull(lookup);
  tokenCache.set(key, { value, at: Date.now() });
  return value;
}

const REAL_SEAMS: FetchAuthSeams = {
  confirmedHost: () => readUserIntegrationOverrides().forgeHost ?? null,
  tokenFor: cachedTokenFor,
};

/** Null means fetch as the user would: no https origin, an unconfirmed host, or no token held. */
export async function originFetchAuth(cwd: string, seams: FetchAuthSeams = REAL_SEAMS): Promise<FetchAuth | null> {
  // get-url applies the user's insteadOf rewrites, so the decision follows the transport git will really use.
  const r = await runGit(cwd, ["remote", "get-url", "origin"]);
  const url = r.stdout.trim();
  if (r.exitCode !== 0 || !/^https:\/\//i.test(url)) return null;
  if (!mayOfferToken(url, seams.confirmedHost())) return null;
  let token: string | null;
  try {
    token = await seams.tokenFor(url);
  } catch {
    return null;
  }
  if (!token) return null;
  const git = gitWithToken([], token, { GIT_TERMINAL_PROMPT: "0" }, { keepUserHelpers: true });
  return { args: git.argv.slice(1), env: git.env };
}

/** `runGit` for a command that talks to origin (fetch, push), with rt's token offered when origin needs one. */
export async function runGitOrigin(
  cwd: string,
  args: string[],
  opts: { timeoutMs?: number; signal?: AbortSignal; auth?: FetchAuthSeams } = {},
): Promise<GitResult> {
  const auth = await originFetchAuth(cwd, opts.auth);
  if (!auth) return runGit(cwd, args, { timeoutMs: opts.timeoutMs, signal: opts.signal });
  return runGit(cwd, [...auth.args, ...args], { timeoutMs: opts.timeoutMs, signal: opts.signal, env: auth.env });
}
