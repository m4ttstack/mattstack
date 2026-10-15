/**
 * `org.admin-secrets`: on an org owner's or admin's Mac, says when the org's
 * admin-only secrets are not locked to exactly its current owners and admins,
 * or when this Mac holds the switchboard admin token the org does not share
 * yet. Never required: the token still works from this Mac's own secret.
 * A rule that is current reads as healthy even when the file holds no token,
 * because checking the file would spawn sops on every plan.
 */

import { join } from "path";
import { isOrgAdmin } from "../../../packages/rt-client/src/settings/org-roles.ts";
import { ADMIN_PATH_REGEX, parseSopsRules } from "../../secrets/team-store.ts";
import { parseStoreText } from "../../settings/stores.ts";
import { adminKeysIn } from "../../team/admin-secrets.ts";
import { boardEnvHas } from "../../team/board-token.ts";
import { orgStoreFile } from "../../team/org-store.ts";
import { roleFor } from "../../team/roles.ts";
import { orgDirUnder } from "../../rt-paths.ts";
import { row, type Action, type Row } from "../contract.ts";
import type { Probes } from "../probes.ts";
import type { SecretPresence } from "./accounts.ts";

export const ADMIN_SECRETS_ROW_ID = "org.admin-secrets";

const BASE = {
  id: ADMIN_SECRETS_ROW_ID,
  kind: "access" as const,
  title: "Admin-only secrets",
  why: "Lets every org owner and admin use the switchboard admin token, and keeps it from everyone else.",
  required: false,
  optionalNote: "Only the org's owners and admins see this.",
  recheck: "on-activate" as const,
};

const SYNC_STEPS: Action = { type: "steps", label: "Show steps…", steps: ["Run rt team admin-secrets", "Re-check this row"] };

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key) => b.includes(key));
}

export async function adminSecretsRow(p: Probes, org: string, secrets: SecretPresence): Promise<Row | null> {
  if (!isOrgAdmin(roleFor(p, org))) return null;
  const sops = p.readFile(join(orgDirUnder(p.home, org), ".sops.yaml"));
  const locked = (sops === null ? null : parseSopsRules(sops))?.find((r) => r.pathRegex === ADMIN_PATH_REGEX)?.recipients ?? null;

  if (locked === null) {
    const holds = Boolean(p.env.SWITCHBOARD_ADMIN_TOKEN) || boardEnvHas(p, "SWITCHBOARD_ADMIN_TOKEN") || (await secrets.has("rt", "switchboardAdminToken")) !== null;
    if (!holds) return null;
    return row({ ...BASE, status: "needs-you", detail: "This Mac holds the switchboard admin token, but the org's other owners and admins cannot use it yet", action: SYNC_STEPS });
  }

  const file = orgStoreFile(p.home, org);
  const raw = p.readFile(file);
  const want = adminKeysIn(raw === null ? {} : parseStoreText(file, raw).global).keys;
  if (sameKeys(want, locked)) return null;
  return row({ ...BASE, status: "needs-you", detail: "The org's owners and admins changed since its admin-only secrets were last locked to them", action: SYNC_STEPS });
}

export async function adminSecretsRowSafe(p: Probes, org: string, secrets: SecretPresence): Promise<Row | null> {
  try {
    return await adminSecretsRow(p, org, secrets);
  } catch (err) {
    return row({ ...BASE, status: "error", detail: err instanceof Error ? err.message : String(err), action: { type: "run", label: "Re-check", verb: ["setup", "status"] } });
  }
}
