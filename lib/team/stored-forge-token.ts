/**
 * The forge token rt can offer for a remote's host: the personal store, else
 * a GitHub remote's gh session. A fresh machine's git, gh and glab have
 * nothing of their own to offer a private team repo; this is what rt hands
 * them instead.
 */

import { UserActionableError } from "../errors.ts";
import type { Probes } from "../setup/probes.ts";
import { isValidHostname } from "../setup/host-validate.ts";
import { hostFromRemote, probeUserSettingsReader, readUserIntegrationOverrides } from "../setup/team-settings.ts";
import { forgeTokenKey } from "./git-credential.ts";
import { forgeTokenLookupForGit, gitlabHostRefusal, mayOfferGitLabToken, mayOfferTokenToHost, storedTokenRefusal, tokenLookupRemoteForHost, tokenOrNull } from "./forge-token.ts";

export interface DeclaredForge {
  provider: "github" | "gitlab";
  host: string;
}

/** The host the user confirmed, read through the probes' home so a fake home answers for itself. This reader skips the resolver's schema check, so the value is checked here. */
export function confirmedForgeHost(p: Probes): string | null {
  const host: unknown = readUserIntegrationOverrides({ read: probeUserSettingsReader(p) }).forgeHost;
  return typeof host === "string" && isValidHostname(host) ? host : null;
}

export async function storedForgeToken(p: Probes, remote: string): Promise<string | null> {
  if (storedTokenRefusal(remote, confirmedForgeHost(p)) !== null) return null;
  return tokenOrNull(await forgeTokenLookupForGit(p, remote));
}

/** Stops a team command before it reads the token or calls the forge, when the remote's host is one the user never confirmed. */
export function refuseUnconfirmedForgeHost(remote: string, confirmedHost: string | null | undefined): void {
  const refusal = storedTokenRefusal(remote, confirmedHost);
  if (refusal !== null) throw unconfirmedHostError(hostFromRemote(remote) ?? remote, refusal);
}

/** The same stop for the forge a team declares, which nothing ties to its remote, so it is checked on its own. */
export function refuseUnconfirmedForge(forge: DeclaredForge, confirmedHost: string | null | undefined): void {
  if (forge.provider !== "gitlab") return;
  const refusal = gitlabHostRefusal(tokenLookupRemoteForHost(forge.host), confirmedHost);
  if (refusal !== null) throw unconfirmedHostError(forge.host, refusal);
}

/** The token for a call to the declared forge's host: only that provider's own token, and only for a host the user may send it to. */
export async function storedTokenForForge(
  p: Probes,
  forge: DeclaredForge,
  confirmedHost: string | null | undefined,
  read: (p: Probes, remote: string) => Promise<string | null> = storedForgeToken,
): Promise<string | null> {
  const lookup = tokenLookupRemoteForHost(forge.host);
  const allowed = forge.provider === "gitlab" ? mayOfferGitLabToken(lookup, confirmedHost) : mayOfferTokenToHost(forge.host, confirmedHost);
  if (!allowed || forgeTokenKey(lookup) !== `${forge.provider}Token`) return null;
  return read(p, lookup);
}

function unconfirmedHostError(host: string, refusal: string): UserActionableError {
  return new UserActionableError("forge-host-unconfirmed", `rt will not send your GitLab token to ${host}`, {}, {
    why: refusal,
    next: `rt setup gitlab connect --host ${host}`,
  });
}
