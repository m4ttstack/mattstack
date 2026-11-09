/**
 * The one stored-then-staged read of rt's forge token. `absent` and
 * `unreadable` are kept apart because only `absent` is evidence that the user
 * has connected no account: a store rt cannot read says nothing about them.
 * `withheld` is neither: rt has a token and refuses to hand it to this host.
 */

import { NoAgeKeyError, readSecret } from "../secrets/store.ts";
import { forgeTokenKey } from "./git-credential.ts";
import { hostFromRemote } from "../setup/team-settings.ts";
import type { SecretPresence } from "../setup/validators/accounts.ts";
import { createRealAgeKeySeam } from "../home/age-key.ts";
import { createRealSecretsExecSeam } from "../secrets/store.ts";
import type { Probes } from "../setup/probes.ts";
import { readStagedSecret } from "../setup/staging.ts";
import { bundledToolExec } from "../deps/resolve.ts";

export type ForgeTokenLookup =
  | { kind: "token"; token: string }
  | { kind: "absent" }
  | { kind: "unreadable"; reason: string }
  | { kind: "withheld"; host: string };

export interface ForgeTokenSeams {
  readStored: (domain: string, key: string) => Promise<string | null>;
  readStaged: (domain: string, key: string) => string | null;
  readGhSession?: () => Promise<string | null>;
}

const GH_TOKEN_TIMEOUT_MS = 5000;

export async function ghSessionToken(p: Probes): Promise<string | null> {
  // test-setup.ts sets this so no unit test can read the developer's real gh login.
  if (p.env.RT_GH_TOKEN_FALLBACK === "off") return null;
  // Named, because a bare `gh auth token` answers for gh's default host, and rt files the answer as github.com's.
  const res = await p.exec([...(bundledToolExec(p, "gh") ?? ["gh"]), "auth", "token", "--hostname", "github.com"], { timeoutMs: GH_TOKEN_TIMEOUT_MS });
  const token = res.stdout.trim();
  return res.code === 0 && token ? token : null;
}

export async function forgeTokenLookup(remote: string, seams: ForgeTokenSeams): Promise<ForgeTokenLookup> {
  const key = forgeTokenKey(remote);
  if (!key) return { kind: "absent" };
  try {
    const stored = await seams.readStored("rt", key);
    if (stored !== null) return { kind: "token", token: stored };
  } catch (err) {
    if (!(err instanceof NoAgeKeyError)) {
      return { kind: "unreadable", reason: err instanceof Error ? err.message : String(err) };
    }
  }
  const staged = seams.readStaged("rt", key);
  if (staged !== null) return { kind: "token", token: staged };
  const session = key === "githubToken" ? await seams.readGhSession?.() : null;
  return session ? { kind: "token", token: session } : { kind: "absent" };
}

export function tokenOrNull(lookup: ForgeTokenLookup): string | null {
  return lookup.kind === "token" ? lookup.token : null;
}

/** The plan's own presence read (`realSecretPresence`) already folds stored-then-staged into one answer, so a second staged read here would double-count, not fill a gap. */
export async function forgeTokenLookupFromPresence(remote: string, secrets: SecretPresence | undefined, p?: Probes): Promise<ForgeTokenLookup> {
  if (!secrets) return { kind: "absent" };
  return forgeTokenLookup(remote, { readStored: (d, k) => secrets.has(d, k), readStaged: () => null, ...(p ? { readGhSession: () => ghSessionToken(p) } : {}) });
}

/** The standalone read, for callers with no plan in hand: both stages are theirs to do. */
export async function forgeTokenLookupReal(p: Probes, remote: string): Promise<ForgeTokenLookup> {
  return forgeTokenLookup(remote, {
    readStored: (d, k) => readSecret(d, k, { ageKeySeam: createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() }),
    readStaged: (d, k) => readStagedSecret(p, d, k),
  });
}

/** What git can authenticate with: rt's own token, else the gh session, which git cannot reach by itself unless `gh auth setup-git` ran. */
export async function forgeTokenLookupForGit(p: Probes, remote: string): Promise<ForgeTokenLookup> {
  return forgeTokenLookup(remote, {
    readStored: (d, k) => readSecret(d, k, { ageKeySeam: createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() }),
    readStaged: (d, k) => readStagedSecret(p, d, k),
    readGhSession: () => ghSessionToken(p),
  });
}

/**
 * An invite pointer names a remote the inviter chose, so a host matching
 * `gitlab.` is not evidence that it IS the user's GitLab. rt offers its token
 * only to a forge whose identity cannot be spoofed, or to the one host the
 * user confirmed themselves through `rt setup <forge> connect --host`, which
 * is the same gate `access.forge` applies before rt talks to a declared host.
 */
const UNSPOOFABLE_FORGE_HOSTS = new Set(["github.com", "gitlab.com"]);

export function mayOfferTokenToHost(host: string | null, confirmedHost: string | null | undefined): boolean {
  if (host === null) return false;
  if (UNSPOOFABLE_FORGE_HOSTS.has(host)) return true;
  return confirmedHost !== null && confirmedHost !== undefined && host === confirmedHost;
}

export function mayOfferToken(remote: string, confirmedHost: string | null | undefined): boolean {
  // Cleartext http would transmit the credential in the open; no amount of
  // host standing rescues that, so the scheme is checked before the host.
  if (/^http:\/\//i.test(remote)) return false;
  return mayOfferTokenToHost(hostFromRemote(remote), confirmedHost);
}

/**
 * `mayOfferToken` is forge-blind: github.com passes it, and connecting GitHub
 * can record github.com as the confirmed host. A GitLab token must never go
 * there on either path.
 */
export function mayOfferGitLabToken(remote: string, confirmedHost: string | null | undefined): boolean {
  const host = hostFromRemote(remote);
  return host !== "github.com" && mayOfferTokenToHost(host, confirmedHost);
}

/**
 * A host as a token-lookup remote: `forgeTokenKey` derives the key from a
 * full remote URL, and a bare `https://host/` does not parse as one. The
 * path segment is inert; only the host decides which token rt holds.
 */
export function tokenLookupRemoteForHost(host: string): string {
  return `https://${host}/mattstack/identity`;
}

/**
 * Withholding is a decision about the HOST, and "no account connected" is a
 * claim about the USER, so the lookup runs first: an absent or unreadable
 * store has nothing to leak and keeps its own honest verdict. Only a real
 * token is withheld from a host the user has not confirmed.
 */
export function withholdFromUntrustedHost(lookup: ForgeTokenLookup, remote: string, confirmedHost: string | null | undefined): ForgeTokenLookup {
  if (lookup.kind !== "token") return lookup;
  if (mayOfferToken(remote, confirmedHost)) return lookup;
  return { kind: "withheld", host: hostFromRemote(remote) ?? remote };
}

/** The lookup to probe a pointer-supplied remote with. */
export async function forgeTokenLookupForRemote(
  p: Probes,
  remote: string,
  confirmedHost: string | null | undefined,
): Promise<ForgeTokenLookup> {
  return withholdFromUntrustedHost(await forgeTokenLookupForGit(p, remote), remote, confirmedHost);
}
