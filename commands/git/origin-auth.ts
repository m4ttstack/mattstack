/**
 * The one place that decides whether rt's forge token may be offered to git
 * for origin. It hands git `rt git credential` as the helper for one host and
 * never the token itself: no verdict, env or error here carries it.
 */

import { parseRemoteUrl, resolveSshAlias } from "../../lib/enrich.ts";
import { shellQuote } from "../../lib/herdr-launch.ts";
import { rtSelfArgv } from "../../lib/rt-self.ts";
import { createRealProbes } from "../../lib/setup/probes.ts";
import { forgeFromHost, forgeFromRemote, hostFromRemote, readUserIntegrationOverrides } from "../../lib/setup/team-settings.ts";
import { forgeTokenLookupForGit, mayOfferGitLabToken, mayOfferToken, type ForgeTokenLookup } from "../../lib/team/forge-token.ts";
import { forgeTokenKey } from "../../lib/team/git-credential.ts";
import { runGit } from "../../lib/worktree/git-async.ts";

export type Forge = "gitlab" | "github";

export interface OriginAuthSeams {
  confirmedHost(): string | null;
  lookup(remote: string): Promise<ForgeTokenLookup>;
}

export type SkipReason = "no-origin" | "http" | "ssh" | "not-https" | "not-forge" | "unconfirmed" | "no-token" | "unreadable";

export type OriginAuthVerdict =
  | { ok: true; url: string; host: string; forge: Forge }
  | { ok: false; reason: SkipReason; url: string | null; host: string | null; forge: Forge | null };

export interface OriginAuth {
  /** One read per forge per run; a thrown lookup reads as `unreadable`. */
  tokenFor(remote: string): Promise<ForgeTokenLookup>;
  confirmedHost(): string | null;
  /** The section 1 checks, in order, on a URL git would use. Never returns the token. */
  verdict(url: string | null): Promise<OriginAuthVerdict>;
  /** `git remote get-url [--push] origin` (applies insteadOf), then `verdict`. */
  forOrigin(cwd: string, push: boolean): Promise<OriginAuthVerdict>;
  /** Decides once for the fetch URL and, when `push`, the push URL; either passing sets the prompt guard. Returns its undo. */
  guardPrompts(cwd: string, opts: { push: boolean }): Promise<() => void>;
}

const SSH_SCHEME = /^(?:git\+)?ssh:\/\//i;
const SCP_LIKE = /^(?:[^@/:\s]+@)?[^/:\s]+:(?!\/\/)/;

function isSshUrl(url: string): boolean {
  return SSH_SCHEME.test(url) || SCP_LIKE.test(url);
}

export function defaultOriginAuthSeams(): OriginAuthSeams | null {
  // test-setup.ts sets this so no suite reaches the real token store.
  if (process.env.RT_POOL_FORGE_TOKEN === "off") return null;
  return {
    confirmedHost: () => readUserIntegrationOverrides().forgeHost ?? null,
    lookup: (remote) => forgeTokenLookupForGit(createRealProbes(), remote),
  };
}

export function createOriginAuth(seams: OriginAuthSeams | null = defaultOriginAuthSeams()): OriginAuth {
  const memo = new Map<string, Promise<ForgeTokenLookup>>();

  const tokenFor = (remote: string): Promise<ForgeTokenLookup> => {
    const key = forgeTokenKey(remote);
    if (!seams || !key) return Promise.resolve({ kind: "absent" });
    let lookup = memo.get(key);
    if (!lookup) {
      // A thrown error's message is not ours to repeat: a CLI may echo the secret into it.
      lookup = seams.lookup(remote).catch((): ForgeTokenLookup => ({ kind: "unreadable", reason: "rt could not read its token store" }));
      memo.set(key, lookup);
    }
    return lookup;
  };

  const confirmedHost = (): string | null => seams?.confirmedHost() ?? null;

  const verdict = async (url: string | null): Promise<OriginAuthVerdict> => {
    if (url === null) return { ok: false, reason: "no-origin", url: null, host: null, forge: null };
    const found = forgeFromRemote(url);
    const host = found?.host ?? hostFromRemote(url);
    const forge: Forge | null = found?.provider ?? null;
    const skip = (reason: SkipReason): OriginAuthVerdict => ({ ok: false, reason, url, host, forge });
    if (/^http:\/\//i.test(url)) return skip("http");
    if (isSshUrl(url)) return skip("ssh");
    if (!/^https:\/\//i.test(url)) return skip("not-https");
    if (!found) return skip("not-forge");
    const gate = forgeTokenKey(url) === "gitlabToken" ? mayOfferGitLabToken : mayOfferToken;
    if (!gate(url, confirmedHost())) return skip("unconfirmed");
    const lookup = await tokenFor(url);
    if (lookup.kind === "absent") return skip("no-token");
    if (lookup.kind !== "token") return skip("unreadable");
    return { ok: true, url, host: found.host, forge: found.provider };
  };

  const forOrigin = async (cwd: string, push: boolean): Promise<OriginAuthVerdict> => {
    const res = await runGit(cwd, ["remote", "get-url", ...(push ? ["--push"] : []), "origin"]);
    const url = res.exitCode === 0 ? res.stdout.trim() : "";
    return verdict(url === "" ? null : url);
  };

  const guardPrompts = async (cwd: string, opts: { push: boolean }): Promise<() => void> => {
    const fetchOk = (await forOrigin(cwd, false)).ok;
    const passes = fetchOk || (opts.push && (await forOrigin(cwd, true)).ok);
    if (!passes) return () => {};
    const prior = PROMPT_GUARD.map((name) => ({ name, had: name in process.env, value: process.env[name] }));
    process.env.GIT_TERMINAL_PROMPT = "0";
    process.env.GIT_ASKPASS = "";
    return () => {
      for (const { name, had, value } of prior) {
        if (had) process.env[name] = value;
        else delete process.env[name];
      }
    };
  };

  return { tokenFor, confirmedHost, verdict, forOrigin, guardPrompts };
}

const PROMPT_GUARD = ["GIT_TERMINAL_PROMPT", "GIT_ASKPASS"] as const;

export function rtSelfHelper(argv: string[] = rtSelfArgv()): string {
  return `!${argv.map(shellQuote).join(" ")} git credential`;
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

/** An SSH origin's HTTPS URL, its host resolved through ssh config; null for a non-SSH URL or a host that is not a forge. */
export async function sshToHttps(url: string): Promise<string | null> {
  if (!isSshUrl(url)) return null;
  await resolveSshAlias(url);
  const parsed = parseRemoteUrl(url);
  const host = hostFromRemote(url);
  if (!parsed || host === null || forgeFromHost(host) === null) return null;
  return `https://${host}/${parsed.projectPath}.git`;
}

export function forgeName(forge: Forge): "GitLab" | "GitHub" {
  return forge === "gitlab" ? "GitLab" : "GitHub";
}
