/**
 * rt keeps forge tokens in its own store (or the setup stage before Install),
 * not in git's credential helper — so a fresh machine's git has nothing to
 * offer a private remote. This hands a token to git through an inline
 * credential helper that reads the environment: never argv (visible in ps),
 * never the URL (echoed into stderr and .git/config).
 */

import { forgeFromRemote, hostFromRemote } from "../setup/team-settings.ts";


export interface GitWithToken {
  argv: string[];
  env: Record<string, string>;
}

/**
 * Answers only `get` for https on `$RT_GIT_HOST`, so a submodule, a redirect
 * or a push URL on another host never receives the token, and git's `store`
 * after a successful auth is a no-op.
 */
const HOST_HELPER =
  '!f() { test "$1" = get || return 0; p=; h=; while IFS= read -r l && test -n "$l"; do case "$l" in protocol=*) p=${l#protocol=};; host=*) h=${l#host=};; esac; done; test "$p" = https && test "$h" = "$RT_GIT_HOST" || return 0; echo username=$RT_GIT_USER; echo password=$RT_GIT_TOKEN; }; f';

/**
 * `git <args>` with `token` offered to `remote`'s https host only; `env`
 * merges over the caller's own. rt's helper is the only one for that host, so
 * no other helper can substitute a credential or be handed rt's token by
 * git's `store` (Apple git's system osxkeychain would keep it), and every
 * other host keeps the user's own helpers. A remote with no https host (ssh,
 * a local path, cleartext http) gets no token at all.
 */
export function gitWithToken(args: string[], token: string | null, env: Record<string, string>, opts: { remote: string | null }): GitWithToken {
  const host = opts.remote && /^https:\/\//i.test(opts.remote) ? hostFromRemote(opts.remote) : null;
  if (!token || !host) return { argv: ["git", ...args], env };
  const key = `credential.https://${host}.helper`;
  return {
    argv: ["git", "-c", `${key}=`, "-c", `${key}=${HOST_HELPER}`, ...args],
    env: { ...env, RT_GIT_USER: "x-access-token", RT_GIT_TOKEN: token, RT_GIT_HOST: host },
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
