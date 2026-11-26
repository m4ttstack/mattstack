/**
 * `org.admin-secrets`: on an org owner's or admin's Mac, says when the org's
 * admin-only secrets are not locked to exactly its current owners and admins,
 * when the org or this Mac keeps the relay operator's token, or when this Mac
 * holds the org's switchboard token the org does not share yet. Never
 * required: an org token kept on this Mac still works from there.
 * A current rule is also checked against the file through `hasAdmin`, which
 * readers consult before this Mac's own copy; without `hasAdmin` it cannot
 * tell and reads healthy. A Mac whose age key is not an owner's or admin's
 * roster key can neither read nor share the file, so instead of asking for
 * a verb that would refuse it, the row points at the Mac the roster holds.
 */

import { join } from "path";
import { isOrgAdmin } from "../../../packages/rt-client/src/settings/org-roles.ts";
import { isOrgToken } from "../../../packages/rt-client/src/switchboard.ts";
import { ADMIN_PATH_REGEX, parseSopsRules } from "../../secrets/team-store.ts";
import { parseStoreText } from "../../settings/stores.ts";
import { adminKeysIn } from "../../team/admin-secrets.ts";
import { boardEnvValue } from "../../team/board-token.ts";
import { orgStoreFile } from "../../team/org-store.ts";
import { roleFor } from "../../team/roles.ts";
import { orgDirUnder } from "../../rt-paths.ts";
import { row, type Action, type Row } from "../contract.ts";
import type { Probes } from "../probes.ts";
import { discoverOrgs } from "../team-settings.ts";
import type { SecretPresence } from "./accounts.ts";

export const ADMIN_SECRETS_ROW_ID = "org.admin-secrets";

const BASE = {
  id: ADMIN_SECRETS_ROW_ID,
  kind: "access" as const,
  title: "Admin-only secrets",
  why: "Lets every org owner and admin use the org's switchboard token, and keeps it from everyone else.",
  required: false,
  optionalNote: "Only the org's owners and admins see this.",
  recheck: "on-activate" as const,
};

export const ADMIN_SECRETS_SYNC_STEPS: Action = { type: "steps", label: "Show steps…", steps: ["Run rt team admin-secrets", "Re-check this row"] };

const NOT_THIS_MAC = "This Mac's age key is not the one the roster holds for you, so it cannot read or share the org's admin-only secrets. Check this row on the Mac whose key the roster holds";

interface OwnToken {
  value: string;
  /** The key and its place, for the remedy that removes this copy so the org's is used. */
  where: string;
  /** The place alone, for the row that names every copy of the relay operator's token. */
  place: string;
  /** How to remove the relay operator's token from this place. */
  remove: string;
}

const OPERATOR_KEEPS_IT = "the relay operator keeps it outside rt";

const SHARES_OPERATOR_STEPS: Action = {
  type: "steps",
  label: "Show steps…",
  steps: ["Ask the relay operator for your org's switchboard token", "Run rt team admin-secrets --token-stdin --replace-token and paste it", "Re-check this row"],
};

function listed(places: string[]): string {
  return places.length < 2 ? places.join("") : `${places.slice(0, -1).join(", ")} and ${places.at(-1)}`;
}

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key) => b.includes(key));
}

export async function adminSecretsRow(p: Probes, org: string, secrets: SecretPresence): Promise<Row | null> {
  if (!isOrgAdmin(roleFor(p, org))) return null;
  const file = orgStoreFile(p.home, org);
  const raw = p.readFile(file);
  const want = adminKeysIn(raw === null ? {} : parseStoreText(file, raw).global).keys;
  const verdict = await lockVerdict(p, org, secrets, want);
  if (verdict?.status !== "needs-you") return verdict;
  const key = await secrets.ownAgeKey?.().catch(() => null);
  if (key != null && !want.includes(key)) return row({ ...BASE, status: "skipped", detail: NOT_THIS_MAC });
  return verdict;
}

/** Every place on this Mac that holds a token, in the order readers try them. */
async function ownTokens(p: Probes, secrets: SecretPresence): Promise<OwnToken[]> {
  const found: OwnToken[] = [];
  if (p.env.SWITCHBOARD_ADMIN_TOKEN) found.push({ value: p.env.SWITCHBOARD_ADMIN_TOKEN, where: "SWITCHBOARD_ADMIN_TOKEN from the environment rt runs in", place: "the environment rt runs in", remove: `Remove it from the environment rt runs in; ${OPERATOR_KEEPS_IT}` });
  const env = boardEnvValue(p, "SWITCHBOARD_ADMIN_TOKEN");
  if (env) found.push({ value: env, where: "SWITCHBOARD_ADMIN_TOKEN from the board's .env", place: "the board's .env", remove: `Remove it from the board's .env; ${OPERATOR_KEEPS_IT}` });
  const stored = await secrets.has("rt", "switchboardAdminToken");
  if (stored) found.push({ value: stored, where: "switchboardAdminToken from rt's secrets", place: "rt's secrets", remove: `Remove it from rt's secrets by hand, as step 3 of docs/switchboard-org-tokens.md shows; ${OPERATOR_KEEPS_IT}` });
  return found;
}

async function lockVerdict(p: Probes, org: string, secrets: SecretPresence, want: string[]): Promise<Row | null> {
  const sops = p.readFile(join(orgDirUnder(p.home, org), ".sops.yaml"));
  const locked = (sops === null ? null : parseSopsRules(sops))?.find((r) => r.pathRegex === ADMIN_PATH_REGEX)?.recipients ?? null;
  if (locked !== null && !sameKeys(want, locked)) {
    return row({ ...BASE, status: "needs-you", detail: "The org's owners and admins changed since its admin-only secrets were last locked to them", action: ADMIN_SECRETS_SYNC_STEPS });
  }

  // This Mac's copies come before the shared file: the move clears them while the file still holds the master.
  const own = await ownTokens(p, secrets);
  const operator = own.filter((t) => !isOrgToken(t.value));
  if (operator.length > 0) {
    return row({
      ...BASE,
      status: "needs-you",
      detail: `This Mac keeps the relay operator's switchboard token in ${listed(operator.map((t) => t.place))}`,
      action: { type: "steps", label: "Show steps…", steps: [...operator.map((t) => t.remove), "Re-check this row"] },
    });
  }

  const shared = locked !== null && secrets.hasAdmin ? await secrets.hasAdmin(org, "switchboardAdminToken") : null;
  if (shared != null && !isOrgToken(shared)) {
    return row({ ...BASE, status: "needs-you", detail: "The org shares the relay operator's token, not its own", action: SHARES_OPERATOR_STEPS });
  }

  // On a Mac with two org clones a token kept here could be either org's.
  const mine = discoverOrgs(p).length === 1 ? own.find((t) => isOrgToken(t.value)) : undefined;
  if (mine === undefined) return null;
  const unshared = row({ ...BASE, status: "needs-you", detail: "This Mac holds the org's switchboard token, but the org's other owners and admins cannot use it yet", action: ADMIN_SECRETS_SYNC_STEPS });
  if (locked === null) return unshared;
  if (!secrets.hasAdmin) return null;
  if (shared == null) return unshared;
  if (shared === mine.value) return null;
  return row({
    ...BASE,
    status: "needs-you",
    detail: "The org shares a different switchboard token from this Mac's",
    action: {
      type: "steps",
      label: "Show steps…",
      steps: [
        "If this Mac's token is the newer one, run rt team admin-secrets --replace-token",
        `If the org's token is the right one, remove ${mine.where} so the org's is used`,
        "Re-check this row",
      ],
    },
  });
}

export async function adminSecretsRowSafe(p: Probes, org: string, secrets: SecretPresence): Promise<Row | null> {
  try {
    return await adminSecretsRow(p, org, secrets);
  } catch (err) {
    return row({ ...BASE, status: "error", detail: err instanceof Error ? err.message : String(err), action: { type: "run", label: "Re-check", verb: ["setup", "status"] } });
  }
}
