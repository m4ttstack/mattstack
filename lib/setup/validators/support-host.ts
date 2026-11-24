/**
 * `org.support-host`: on the Mac of the person the org names as its support
 * host, says when something support requests need has stopped working. Never
 * required. The daemon holds the answer, so no other Mac asks it.
 */

import type { Commands } from "../../../packages/rt-client/src/commands.ts";
import { parseStoreText } from "../../settings/stores.ts";
import { canonicalHandle } from "../../team/board-peers.ts";
import { orgStoreFile } from "../../team/org-store.ts";
import { readTeamLocal } from "../../team/team-local.ts";
import { row, type Row } from "../contract.ts";
import type { Probes } from "../probes.ts";

export const SUPPORT_HOST_ROW_ID = "org.support-host";
const DAEMON_TIMEOUT_MS = 20_000;

const BASE = {
  id: SUPPORT_HOST_ROW_ID,
  kind: "access" as const,
  title: "Support requests",
  why: "Lets your org's teammates ask your agent for help from mattstack.",
  required: false,
  optionalNote: "Only your org's support host sees this.",
  recheck: "on-activate" as const,
};

function isHost(p: Probes, org: string): boolean {
  const file = orgStoreFile(p.home, org);
  const raw = p.readFile(file);
  const me = readTeamLocal(p, org).forgeUsername;
  if (raw === null || !me) return false;
  try {
    const host = parseStoreText(file, raw).global["support.host"];
    return typeof host === "string" && canonicalHandle(host) === canonicalHandle(me);
  } catch {
    return false;
  }
}

export async function supportHostRow(p: Probes, org: string): Promise<Row | null> {
  if (!isHost(p, org)) return null;
  const res = await p.daemon("support:host", {}, DAEMON_TIMEOUT_MS).catch(() => null);
  const state = res?.ok ? (res.data as Commands["support:host"]["data"] | undefined) : undefined;
  if (!state?.isHost) return row({ ...BASE, status: "skipped", detail: "Could not check" });
  if (!state.accepting) return row({ ...BASE, status: "skipped", detail: "Off" });
  const [first] = state.missing;
  return first === undefined ? row({ ...BASE, status: "ready", detail: "Answering support requests" }) : row({ ...BASE, status: "needs-you", detail: first });
}
