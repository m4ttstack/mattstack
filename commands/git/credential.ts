/**
 * rt git credential <op> -- the git credential helper an rt-made https clone
 * names in its own config (lib/setup/steps/repos.ts). It answers `get` with
 * the forge token rt holds, read from rt's store at call time, so no secret
 * is written to git's config or credential store.
 */

import { createRealProbes } from "../../lib/setup/probes.ts";
import { readUserIntegrationOverrides } from "../../lib/setup/team-settings.ts";
import { credentialHelperReply } from "../../lib/team/git-credential.ts";
import { forgeTokenLookupReal, mayOfferToken, tokenLookupRemoteForHost, tokenOrNull } from "../../lib/team/forge-token.ts";

export interface GitCredentialDeps {
  confirmedHost: () => string | null;
  lookupStored: (remote: string) => Promise<string | null>;
}

const REAL_DEPS: GitCredentialDeps = {
  confirmedHost: () => readUserIntegrationOverrides().forgeHost ?? null,
  lookupStored: async (remote) => tokenOrNull(await forgeTokenLookupReal(createRealProbes(), remote)),
};

export async function gitCredentialReply(op: string, input: string, deps: GitCredentialDeps = REAL_DEPS): Promise<string> {
  return credentialHelperReply(op, input, async (host) => {
    const remote = tokenLookupRemoteForHost(host);
    if (!mayOfferToken(remote, deps.confirmedHost())) return null;
    try {
      return await deps.lookupStored(remote);
    } catch {
      return null;
    }
  });
}

export async function gitCredentialCommand(args: string[], _ctx: unknown): Promise<void> {
  const op = args.find((a) => !a.startsWith("--")) ?? "";
  const input = await Bun.stdin.text();
  process.stdout.write(await gitCredentialReply(op, input));
}
