/**
 * access-group validators — network/auth reachability of the team's git
 * remotes and forge hosts, distinct from accounts.ts's
 * credential-presence rows: a row here can be "needs-you" even with a valid
 * token, when the token's OWNER hasn't been granted access to a specific
 * repo yet.
 */

import { row, type Action, type Row } from "../contract.ts";
import { isValidHostname } from "../host-validate.ts";
import type { SetupIntent } from "../intent.ts";
import type { Probes } from "../probes.ts";
import { forgeFromRemote, type TeamSnapshot, type UserIntegrationOverrides } from "../team-settings.ts";
import { ownedRoots } from "../../../packages/rt-client/src/settings/org-roles.ts";
import { roleFor } from "../../team/roles.ts";
import type { SecretPresence } from "./accounts.ts";
import { forgeTokenLookupFromPresence, withholdFromUntrustedHost } from "../../team/forge-token.ts";
import { probeTeamRepoAccess, forgeLabel, type RepoAccessVerdict } from "../../team/repo-access.ts";
import { integrationDef } from "../integrations.ts";
import { repoIdentitySlug } from "../../settings/identity.ts";

const RECHECK_ACTION: Action = { type: "run", label: "Re-check", verb: ["setup", "status"] };

function rowFromVerdict(v: RepoAccessVerdict, ctx: { grantedBy: string; provider: "github" | "gitlab" }): Pick<Row, "status" | "detail" | "action"> {
  const forge = forgeLabel(ctx.provider);
  switch (v.kind) {
    case "ok":
      return { status: "ready", detail: v.detail, action: null };
    case "no-clt":
      return { status: "missing", detail: "Needs Apple's Command Line Tools first. Install them, then Re-check", action: RECHECK_ACTION };
    case "no-account":
      return { status: "needs-you", detail: `Connect your ${forge} account so rt can prove access`, action: { type: "connect", label: "Connect", integration: ctx.provider, fields: integrationDef(ctx.provider).fields } };
    case "denied":
      return { status: "needs-you", detail: `Your ${forge} account cannot see this repo yet. Ask ${ctx.grantedBy} or your org admin for read access`, action: RECHECK_ACTION };
    default:
      return { status: "error", detail: v.detail, action: RECHECK_ACTION };
  }
}

/** The canonical out-of-band row: a different human grants access, or the network/VPN changes — no file rt watches ever reflects that, so this only ever updates on an explicit re-check. */
async function teamRepoRow(p: Probes, team: TeamSnapshot, intent: SetupIntent | null, overrides: UserIntegrationOverrides, secrets: SecretPresence | undefined): Promise<Row> {
  const pullOnly = ownedRoots(roleFor(p, team.slug)).length === 0;
  const why = pullOnly
    ? "rt needs read access to your team's home repo to sync settings and packs. Only the org's admins and your team's owners write it."
    : "rt needs read/write access to your team's home repo to sync settings and packs.";
  const base = { id: "access.team-repo", kind: "access" as const, title: "Team repo", why, required: true, recheck: "on-activate" as const };
  const remote = intent?.team?.remote ?? intent?.join?.pointer.remote ?? team.remote;
  // Screen 2 recomputes the whole plan in-band once a remote exists — nothing to re-check here yet.
  if (!remote) return row({ ...base, status: "missing", detail: "No team repo yet. Create or join a team first" });

  const provider = forgeFromRemote(remote)?.provider ?? "github";
  const lookup = withholdFromUntrustedHost(await forgeTokenLookupFromPresence(remote, secrets), remote, overrides.forgeHost);
  const verdict = await probeTeamRepoAccess(p, remote, lookup);
  const grantedBy = intent?.join?.pointer.owner ?? "the repo's owner";
  return row({ ...base, ...rowFromVerdict(verdict, { grantedBy, provider }) });
}

/** A joined team names its own forge host, but a team is not the user... probing (let alone authenticating against) that host is a network access rt takes on the user's behalf, so it waits for the same user-confirmed `rt.integrations` override ctxFor's credential validators require, rather than dialing an inviter-controlled host on its own. */
function connectHostSteps(id: "github" | "gitlab", declaredHost: string): Action {
  return { type: "steps", label: "Show steps…", steps: [`Run: rt setup ${id} connect --host ${declaredHost}`, "This confirms the host yourself before rt talks to it"] };
}

async function forgeRow(p: Probes, team: TeamSnapshot, intent: SetupIntent | null, overrides: UserIntegrationOverrides): Promise<Row> {
  const base = { id: "access.forge", kind: "access" as const, title: "Forge reachability", why: "Confirms your network can reach the team's forge host before rt tries to open PRs/MRs there.", required: true, recheck: "on-activate" as const };
  const declaredHost = team.integrations.forge?.host;
  // No forge configured yet is resolved by an earlier screen, same as team-repo's missing branch.
  if (!declaredHost) return row({ ...base, status: "missing", detail: "No forge chosen yet" });

  // A team the user is creating declares only the host of the remote they
  // pasted themselves — nothing an inviter chose, nothing left to confirm.
  const ownRemoteHost = intent?.mode === "create" && intent.team?.remote ? forgeFromRemote(intent.team.remote)?.host ?? null : null;
  // The provider's own public host needs no separate confirmation either: a
  // self-hosted forge is a genuine inviter choice this machine has never
  // talked to, but gitlab.com/github.com are hosts every team on that
  // provider already shares, and lib/setup/integrations.ts's gitlab
  // validator dials gitlab.com unconditionally the moment a credential is
  // connected, so refusing the same host here gains nothing.
  const publicHost = team.integrations.forge?.provider === "github" ? "github.com" : team.integrations.forge?.provider === "gitlab" ? "gitlab.com" : null;
  const confirmedHost =
    overrides.forgeHost && isValidHostname(overrides.forgeHost)
      ? overrides.forgeHost
      : ownRemoteHost === declaredHost
        ? declaredHost
        : publicHost === declaredHost
          ? declaredHost
          : null;
  if (!confirmedHost) {
    const verb = team.integrations.forge?.provider === "github" ? "github" : "gitlab";
    return row({ ...base, status: "needs-you", detail: `Your team uses ${declaredHost}. Confirm that address before rt connects to it`, action: connectHostSteps(verb, declaredHost) });
  }

  const res = await p.fetch(`https://${confirmedHost}/`, { method: "HEAD", timeoutMs: 5000 });
  if (res.status > 0) return row({ ...base, status: "ready", detail: `Reached ${confirmedHost} (HTTP ${res.status})` });
  return row({ ...base, status: "error", detail: `Could not reach ${confirmedHost}. Check your network or proxy`, action: RECHECK_ACTION });
}

async function repoRow(p: Probes, identity: string, overrides: UserIntegrationOverrides, secrets: SecretPresence | undefined): Promise<Row> {
  const base = {
    id: `access.repo.${repoIdentitySlug(identity)}`,
    kind: "access" as const,
    title: identity,
    why: "Lets the board show this repo's MRs/PRs.",
    required: false,
    optionalNote: "Works without this; the board won't show this repo",
  };
  const remote = `https://${identity}.git`;
  const provider = forgeFromRemote(remote)?.provider ?? "github";
  const lookup = withholdFromUntrustedHost(await forgeTokenLookupFromPresence(remote, secrets), remote, overrides.forgeHost);
  const withToken = await probeTeamRepoAccess(p, remote, lookup);
  // rt's token can be scoped narrower than git's own credential helper, so a
  // refusal is only final once the bare probe is refused too.
  const verdict = withToken.kind === "denied" && lookup.kind === "token" ? await probeTeamRepoAccess(p, remote, { kind: "absent" }).then((bare) => (bare.kind === "ok" ? bare : withToken)) : withToken;
  return row({ ...base, ...rowFromVerdict(verdict, { grantedBy: "that repo's admin", provider }) });
}

/** Every probe here is independent (different remote/host/URL each), so they run concurrently: worst-case latency is the slowest single probe, not their sum. team-repo/forge/each tracking identity all keep their own bounded timeout. */
export async function accessRows(p: Probes, team: TeamSnapshot, intent: SetupIntent | null, overrides: UserIntegrationOverrides = {}, secrets?: SecretPresence, solo = false): Promise<Row[]> {
  if (solo) return [];

  const [teamRepo, forge, ...repos] = await Promise.all([
    teamRepoRow(p, team, intent, overrides, secrets),
    forgeRow(p, team, intent, overrides),
    ...team.trackingIdentities.map((identity) => repoRow(p, identity, overrides, secrets)),
  ]);

  return [teamRepo!, forge!, ...repos];
}
