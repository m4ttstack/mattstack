/**
 * The forge token rt can offer for a remote's host: the personal store, else
 * a GitHub remote's gh session. A fresh machine's git, gh and glab have
 * nothing of their own to offer a private team repo; this is what rt hands
 * them instead.
 */

import type { Probes } from "../setup/probes.ts";
import { forgeTokenLookupForGit, tokenOrNull } from "./forge-token.ts";

export async function storedForgeToken(p: Probes, remote: string): Promise<string | null> {
  return tokenOrNull(await forgeTokenLookupForGit(p, remote));
}
