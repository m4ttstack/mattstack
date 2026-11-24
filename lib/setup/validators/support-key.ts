/**
 * `org.support-key`: on an org admin's Mac, says when the org has support on
 * but no support key, which refuses every request. `rt settings set` and a
 * hand edit reach that state: only `rt team support on` and the console make
 * the key. Never required.
 */

import { join } from "path";
import { isOrgAdmin } from "../../../packages/rt-client/src/settings/org-roles.ts";
import { orgDirUnder } from "../../rt-paths.ts";
import { parseStoreText } from "../../settings/stores.ts";
import { canonicalHandle } from "../../team/board-peers.ts";
import { orgStoreFile } from "../../team/org-store.ts";
import { roleFor } from "../../team/roles.ts";
import { row, type Action, type Row } from "../contract.ts";
import type { Probes } from "../probes.ts";

export const SUPPORT_KEY_ROW_ID = "org.support-key";

const BASE = {
  id: SUPPORT_KEY_ROW_ID,
  kind: "access" as const,
  title: "Support key",
  why: "Proves a help request comes from someone in your org.",
  required: false,
  optionalNote: "Only the org's owners and admins see this.",
  recheck: "on-activate" as const,
};

const NAME_HOST: Action = { type: "steps", label: "Show steps…", steps: ["Run rt team support on --host <username>", "Re-check this row"] };

/** `rt team support on` with no host given takes the saved one, so it is a Fix only while that one would be taken. */
function hostHolds(store: Record<string, unknown>): boolean {
  const host = store["support.host"];
  const roster = store["mattstack.roster"];
  if (typeof host !== "string" || !Array.isArray(roster)) return false;
  return roster.some((m) => typeof m?.username === "string" && canonicalHandle(m.username) === canonicalHandle(host));
}

export function supportKeyRow(p: Probes, org: string): Row | null {
  let store: Record<string, unknown>;
  try {
    if (!isOrgAdmin(roleFor(p, org))) return null;
    const file = orgStoreFile(p.home, org);
    const raw = p.readFile(file);
    if (raw === null) return null;
    store = parseStoreText(file, raw).global;
  } catch {
    return null;
  }
  if (store["support.enabled"] !== true) return null;
  if (p.readFile(join(orgDirUnder(p.home, org), "mattstack", "org", "secrets", "support.json")) !== null) return null;
  const action: Action = hostHolds(store) ? { type: "run", label: "Fix", verb: ["team", "support", "on", "--team", org] } : NAME_HOST;
  return row({ ...BASE, status: "needs-you", detail: "Your org has support on but no key", action });
}
