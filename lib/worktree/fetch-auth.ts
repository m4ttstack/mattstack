/**
 * Credentials for the worktree pool's fetches. The pool never clones: the
 * golden and every member are `git worktree add`s of the registered checkout,
 * so they fetch from that checkout's origin with whatever credentials it has.
 * A checkout on an https origin with no credential helper (an rt-made clone,
 * or a user's own) has nothing to answer git with from the daemon, so after
 * an auth failure the command is retried once with rt's forge token, rt's
 * helper being the only one for that host so git's `store` never hands the
 * token to a keychain.
 */

import { createRealProbes } from "../setup/probes.ts";
import { hostFromRemote, readUserIntegrationOverrides } from "../setup/team-settings.ts";
import { forgeTokenKey, gitWithToken } from "../team/git-credential.ts";
import { forgeTokenLookupReal, mayOfferToken, tokenOrNull } from "../team/forge-token.ts";
import { runGit, type GitResult } from "./git-async.ts";

export interface FetchAuthSeams {
  confirmedHost: () => string | null;
  tokenFor: (remote: string) => Promise<string | null>;
  forget: (remote: string) => void;
}

export interface FetchAuth {
  args: string[];
  env: Record<string, string>;
  remote: string;
}

type GitRunner = (cwd: string, args: string[], opts: { timeoutMs?: number; signal?: AbortSignal; env?: Record<string, string> }) => Promise<GitResult>;

const AUTH_FAILURE_RE = /could not read (Username|Password)|terminal prompts disabled|Authentication failed|HTTP Basic: Access denied|Invalid username or password|returned error: 40[13]/i;

/** A token read is a keychain unlock plus a sops decrypt; freshen fetches every pool tree each pass. */
const TOKEN_TTL_MS = 5 * 60_000;
const tokenCache = new Map<string, { value: string; at: number }>();

async function cachedTokenFor(remote: string): Promise<string | null> {
  const key = forgeTokenKey(remote);
  if (!key) return null;
  const hit = tokenCache.get(key);
  if (hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.value;
  const value = tokenOrNull(await forgeTokenLookupReal(createRealProbes(), remote));
  if (value) tokenCache.set(key, { value, at: Date.now() });
  return value;
}

const REAL_SEAMS: FetchAuthSeams = {
  confirmedHost: () => readUserIntegrationOverrides().forgeHost ?? null,
  tokenFor: cachedTokenFor,
  forget: (remote) => {
    const key = forgeTokenKey(remote);
    if (key) tokenCache.delete(key);
  },
};

/** test-setup.ts sets this so no suite with an https origin reaches the real settings, sops or keychain. */
function defaultSeams(): FetchAuthSeams | null {
  return process.env.RT_POOL_FORGE_TOKEN === "off" ? null : REAL_SEAMS;
}

/** Null means rt has nothing to add: no https origin, an unconfirmed host, or no token held. */
export async function originFetchAuth(
  cwd: string,
  seams: FetchAuthSeams | null = defaultSeams(),
  opts: { push?: boolean } = {},
): Promise<FetchAuth | null> {
  if (!seams) return null;
  // get-url applies the user's insteadOf rewrites, so the decision follows the transport git will really use.
  const r = await runGit(cwd, ["remote", "get-url", ...(opts.push ? ["--push"] : []), "origin"]);
  const url = r.stdout.trim();
  if (r.exitCode !== 0 || !/^https:\/\//i.test(url)) return null;
  const host = hostFromRemote(url);
  if (!host || !mayOfferToken(url, seams.confirmedHost())) return null;
  let token: string | null;
  try {
    token = await seams.tokenFor(url);
  } catch {
    return null;
  }
  if (!token) return null;
  const git = gitWithToken([], token, { GIT_TERMINAL_PROMPT: "0" }, { host });
  return { args: git.argv.slice(1), env: git.env, remote: url };
}

/**
 * `runGit` for a command that talks to origin (fetch, push). The user's own
 * setup goes first, unprompted; rt's token is read and offered only when that
 * fails on authentication.
 */
export async function runGitOrigin(
  cwd: string,
  args: string[],
  opts: { timeoutMs?: number; signal?: AbortSignal; push?: boolean; auth?: FetchAuthSeams; run?: GitRunner } = {},
): Promise<GitResult> {
  const run = opts.run ?? runGit;
  const base = { timeoutMs: opts.timeoutMs, signal: opts.signal };
  const first = await run(cwd, args, { ...base, env: { GIT_TERMINAL_PROMPT: "0" } });
  if (first.exitCode === 0 || !AUTH_FAILURE_RE.test(first.stderr + first.stdout)) return first;

  const seams = opts.auth ?? defaultSeams();
  const auth = await originFetchAuth(cwd, seams, { push: opts.push });
  if (!auth || !seams) return first;
  const retry = await run(cwd, [...auth.args, ...args], { ...base, env: auth.env });
  if (retry.exitCode !== 0 && AUTH_FAILURE_RE.test(retry.stderr + retry.stdout)) seams.forget(auth.remote);
  return retry;
}
