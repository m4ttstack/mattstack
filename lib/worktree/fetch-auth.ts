/**
 * Credentials for the worktree pool's fetches. The pool never clones: the
 * golden and every member are `git worktree add`s of the registered checkout,
 * so they fetch from that checkout's origin with whatever credentials it has.
 * A checkout on an https origin with no credential helper (an rt-made clone,
 * or a user's own) has nothing to answer git with from the daemon, so after
 * an auth failure the command is retried once through `rt git credential`,
 * rt's helper being the only one for that host so git's `store` never hands
 * the token to a keychain. The token reaches git only on the helper's stdout:
 * never argv, a URL, config or an env var.
 */

import { join } from "path";
import { shellQuote } from "../herdr-launch.ts";
import { rtSelfArgv } from "../rt-self.ts";
import { createRealProbes } from "../setup/probes.ts";
import { hostFromRemote, readUserIntegrationOverrides } from "../setup/team-settings.ts";
import { forgeTokenKey } from "../team/git-credential.ts";
import { forgeTokenLookupForGit, mayOfferGitLabToken, mayOfferToken, tokenOrNull } from "../team/forge-token.ts";
import { runGit, type GitResult } from "./git-async.ts";

export interface FetchAuthSeams {
  confirmedHost: () => string | null;
  tokenFor: (remote: string) => Promise<string | null>;
  forget: (remote: string) => void;
  /** The credential helper git runs; defaults to `poolCredentialHelper()`. */
  helper?: string;
}

export interface FetchAuth {
  env: Record<string, string>;
  remote: string;
  host: string;
}

type GitRunner = (cwd: string, args: string[], opts: { timeoutMs?: number; signal?: AbortSignal; env?: Record<string, string>; retry?: boolean }) => Promise<GitResult>;

/** The daemon's own entry is lib/daemon.ts from source, so Bun.main there is not the CLI. */
const CLI_ENTRY = join(import.meta.dir, "..", "..", "cli.ts");

export function rtSelfHelper(argv: string[] = rtSelfArgv()): string {
  return `!${argv.map(shellQuote).join(" ")} git credential`;
}

/** `rt git credential` from rt's CLI entry, which the daemon and the CLI both reach. */
export function poolCredentialHelper(): string {
  return rtSelfHelper(rtSelfArgv({ main: CLI_ENTRY }));
}

/**
 * git reads `GIT_CONFIG_PARAMETERS` (a `git -c` above rt, such as an alias or
 * hook) after the `GIT_CONFIG_COUNT` pairs, so a helper named there would come
 * after rt's and get its token on approve. Matching loosely fails closed.
 */
export function configParamsNameHelper(env: NodeJS.ProcessEnv): boolean {
  return /credential\..*helper/is.test(env.GIT_CONFIG_PARAMETERS ?? "");
}

/** The empty value first clears every helper before it for the host, so git's `store` cannot hand rt's token to a keychain. */
export function helperEnv(host: string, base: NodeJS.ProcessEnv, helper: string = rtSelfHelper()): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  const parsed = Number.parseInt(base.GIT_CONFIG_COUNT ?? "", 10);
  const start = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  const key = `credential.https://${host}.helper`;
  env[`GIT_CONFIG_KEY_${start}`] = key;
  env[`GIT_CONFIG_VALUE_${start}`] = "";
  env[`GIT_CONFIG_KEY_${start + 1}`] = key;
  env[`GIT_CONFIG_VALUE_${start + 1}`] = helper;
  env.GIT_CONFIG_COUNT = String(start + 2);
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_ASKPASS = "";
  return env;
}

function definedOnly(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined));
}

const AUTH_FAILURE_RE = /could not read (Username|Password)|terminal prompts disabled|Authentication failed|HTTP Basic: Access denied|Invalid username or password|returned error: 40[13]/i;

export const isAuthFailure = (text: string): boolean => AUTH_FAILURE_RE.test(text);

/** A token read is a keychain unlock plus a sops decrypt; freshen fetches every pool tree each pass. */
const TOKEN_TTL_MS = 5 * 60_000;
const tokenCache = new Map<string, { value: string; at: number }>();

async function cachedTokenFor(remote: string): Promise<string | null> {
  const key = forgeTokenKey(remote);
  if (!key) return null;
  const hit = tokenCache.get(key);
  if (hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.value;
  const value = tokenOrNull(await forgeTokenLookupForGit(createRealProbes(), remote));
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
  if (!seams || configParamsNameHelper(process.env)) return null;
  // get-url applies the user's insteadOf rewrites, so the decision follows the transport git will really use.
  const r = await runGit(cwd, ["remote", "get-url", ...(opts.push ? ["--push"] : []), "origin"]);
  const url = r.stdout.trim();
  if (r.exitCode !== 0 || !/^https:\/\//i.test(url)) return null;
  const host = hostFromRemote(url);
  const gate = forgeTokenKey(url) === "gitlabToken" ? mayOfferGitLabToken : mayOfferToken;
  if (!host || !gate(url, seams.confirmedHost())) return null;
  let token: string | null;
  try {
    token = await seams.tokenFor(url);
  } catch {
    return null;
  }
  if (!token) return null;
  return { env: definedOnly(helperEnv(host, process.env, seams.helper ?? poolCredentialHelper())), remote: url, host };
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
  const retry = await run(cwd, args, { ...base, env: auth.env, retry: true });
  if (retry.exitCode !== 0 && AUTH_FAILURE_RE.test(retry.stderr + retry.stdout)) seams.forget(auth.remote);
  return retry;
}
