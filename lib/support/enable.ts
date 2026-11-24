/** Turns an org's support on and off, for `rt team support` and for the daemon alike. */
import { readOrgRoster } from "../../packages/rt-client/src/settings/active-team.ts";
import { ORG_STORE_REL } from "../../packages/rt-client/src/settings/paths.ts";
import { UserActionableError } from "../errors.ts";
import { NoAgeKeyError } from "../secrets/store.ts";
import { NoTeamRecipientsError } from "../secrets/team-store.ts";
import type { Probes } from "../setup/probes.ts";
import { canonicalHandle } from "../team/board-peers.ts";
import type { MembersSeams } from "../team/members.ts";
import { assertMayWrite } from "../team/roles.ts";
import { assertCurrentOrg } from "../team/team-local.ts";

export interface EnableDeps {
  probes: Pick<Probes, "readFile" | "home">;
  seams: Pick<MembersSeams, "currentOrg" | "readTeamStore" | "writeSetting">;
  ensureKey(slug: string): Promise<void>;
}

/** A person's fix for a key rt could not make: anything else is unexpected and passes through. */
function keyFailure(err: unknown, slug: string): unknown {
  if (err instanceof NoTeamRecipientsError) {
    return new UserActionableError("no-recipients", `The ${slug} org's secrets are not locked to anyone yet`, {}, { next: "rt team members sync" });
  }
  if (err instanceof NoAgeKeyError) return new UserActionableError("no-age-key", "This Mac has no secrets key yet", {}, { next: "rt home init" });
  return err;
}

function assertMayChange(deps: EnableDeps, slug: string, verb: string): void {
  assertMayWrite(deps.probes, slug, ORG_STORE_REL);
  assertCurrentOrg(slug, deps.seams.currentOrg(), verb);
}

function savedHost(deps: EnableDeps, slug: string): string | null {
  const host = deps.seams.readTeamStore(slug)["support.host"];
  return typeof host === "string" ? host : null;
}

/** `host` left out means the saved one. The key comes first: support on with no key refuses every request. */
export async function enableSupport(deps: EnableDeps, slug: string, verb: string, host?: string): Promise<{ host: string }> {
  assertMayChange(deps, slug, verb);
  const named = host ?? savedHost(deps, slug);
  if (!named) throw new UserActionableError("no-host", "No one is set to answer support requests yet", {}, { why: "Set support.host to a person in the org first." });
  const entry = readOrgRoster(slug).find((e) => canonicalHandle(e.username) === canonicalHandle(named));
  if (!entry) {
    throw new UserActionableError("not-a-member", `${named} is not in this org yet`, {}, { next: `rt team invite --handle ${named} --teams <team>` });
  }
  try {
    await deps.ensureKey(slug);
  } catch (err) {
    throw keyFailure(err, slug);
  }
  deps.seams.writeSetting("support.host", entry.username, "org");
  deps.seams.writeSetting("support.enabled", true, "org");
  return { host: entry.username };
}

/** Open chats carry on, and the key and host stay for next time. */
export function disableSupport(deps: EnableDeps, slug: string, verb: string): { host: string | null } {
  assertMayChange(deps, slug, verb);
  const host = savedHost(deps, slug);
  deps.seams.writeSetting("support.enabled", false, "org");
  return { host };
}
