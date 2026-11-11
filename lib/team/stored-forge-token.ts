/**
 * The forge token rt can offer for a remote's host: the personal store, else
 * a GitHub remote's gh session. A fresh machine's git, gh and glab have
 * nothing of their own to offer a private team repo; this is what rt hands
 * them instead.
 */

import { UserActionableError } from "../errors.ts";
import type { Probes } from "../setup/probes.ts";
import { hostFromRemote, probeUserSettingsReader, readUserIntegrationOverrides } from "../setup/team-settings.ts";
import { forgeTokenLookupForGit, storedTokenRefusal, tokenOrNull } from "./forge-token.ts";

/** The host the user confirmed, read through the probes' home so a fake home answers for itself. */
export function confirmedForgeHost(p: Probes): string | null {
  return readUserIntegrationOverrides({ read: probeUserSettingsReader(p) }).forgeHost ?? null;
}

export async function storedForgeToken(p: Probes, remote: string): Promise<string | null> {
  if (storedTokenRefusal(remote, confirmedForgeHost(p)) !== null) return null;
  return tokenOrNull(await forgeTokenLookupForGit(p, remote));
}

/** Stops a team command before it reads the token or calls the forge, when the remote's host is one the user never confirmed. */
export function refuseUnconfirmedForgeHost(remote: string, confirmedHost: string | null | undefined): void {
  const refusal = storedTokenRefusal(remote, confirmedHost);
  if (refusal === null) return;
  const host = hostFromRemote(remote) ?? remote;
  throw new UserActionableError("forge-host-unconfirmed", `rt will not send your GitLab token to ${host}`, {}, {
    why: refusal,
    next: `rt setup gitlab connect --host ${host}`,
  });
}
