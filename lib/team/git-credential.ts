/**
 * rt keeps forge tokens in its own store (or the setup stage before Install),
 * not in git's credential helper — so a fresh machine's git has nothing to
 * offer a private remote. This hands a token to git through an inline
 * credential helper that reads the environment: never argv (visible in ps),
 * never the URL (echoed into stderr and .git/config).
 */

import { forgeFromRemote } from "../setup/team-settings.ts";

const HELPER = "!f() { echo username=$RT_GIT_USER; echo password=$RT_GIT_TOKEN; }; f";

export interface GitWithToken {
  argv: string[];
  env: Record<string, string>;
}

/**
 * `git <args>` with `token` offered for the remote; `env` merges over the
 * caller's own. By default rt's helper replaces every other one, so a global
 * helper cannot substitute a credential behind the operator's back. With
 * `keepUserHelpers` it is appended instead: the checkout's own helpers answer
 * first and rt's token only fills in when they have nothing, which is what a
 * checkout the user also drives by hand needs.
 */
export function gitWithToken(args: string[], token: string | null, env: Record<string, string> = {}, opts: { keepUserHelpers?: boolean } = {}): GitWithToken {
  if (!token) return { argv: ["git", ...args], env };
  const reset = opts.keepUserHelpers ? [] : ["-c", "credential.helper="];
  return {
    argv: ["git", ...reset, "-c", `credential.helper=${HELPER}`, ...args],
    env: { ...env, RT_GIT_USER: "x-access-token", RT_GIT_TOKEN: token },
  };
}

/**
 * The body of `rt git credential <op>`, the helper an rt-made clone's config
 * names. Only `get` over https is answered; `store` and `erase` are ignored
 * because the token lives in rt's store, not git's. `tokenForHost` owns the
 * confirmed-host gate.
 */
export async function credentialHelperReply(op: string, input: string, tokenForHost: (host: string) => Promise<string | null>): Promise<string> {
  if (op !== "get") return "";
  const fields = new Map<string, string>();
  for (const line of input.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) fields.set(line.slice(0, eq), line.slice(eq + 1));
  }
  const host = fields.get("host");
  if (fields.get("protocol") !== "https" || !host) return "";
  const token = await tokenForHost(host);
  return token ? `username=x-access-token\npassword=${token}\n` : "";
}

/** The secret key holding the forge token for a remote's host, or null for a remote rt has no token concept for. */
export function forgeTokenKey(remote: string): "githubToken" | "gitlabToken" | null {
  const forge = forgeFromRemote(remote);
  if (!forge) return null;
  return forge.provider === "github" ? "githubToken" : "gitlabToken";
}
