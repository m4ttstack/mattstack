/**
 * The CLI's side of board peering on the switchboard: which teammates have a
 * board registered, and removing one. Every call goes only to
 * `switchboardUrl()`, the one place a board or admin token may be sent.
 */

import { isOrgToken, switchboardUrl } from "../../packages/rt-client/src/switchboard.ts";
import { createRealAgeKeySeam } from "../home/age-key.ts";
import { createRealSecretsExecSeam, readSecret, type SecretsSeams } from "../secrets/store.ts";
import { createRealTeamSecretsSeams, readAdminSecret } from "../secrets/team-store.ts";
import type { Probes } from "../setup/probes.ts";
import { discoverOrgs } from "../setup/team-settings.ts";
import { warn as warnLine } from "../ui/warn.ts";
import { boardEnvValue, readBoardSwitchboardToken } from "./board-token.ts";

/** Reads one secret from the rt scope, or null when it is not set. */
export type ReadLocalSecret = (key: string) => Promise<string | null>;

export const realReadLocalSecret: ReadLocalSecret = (key) =>
  readSecret("rt", key, { ageKeySeam: createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() });

/** Reads one key of an org's admin-only `rt` secrets, or null when the file, the key or this Mac's access is missing. */
export type ReadAdminSecret = (org: string, key: string) => Promise<string | null>;

/** Where an org keeps its admin-only secrets, for a reader that should look there. */
export interface AdminSource {
  org: string;
  read: ReadAdminSecret;
}

/** A failure other than "this Mac cannot open it" goes to the log only: the token still has the local secret to come from. */
export const realReadAdminSecret: ReadAdminSecret = (org, key) => readAdminSecretOrNull(org, key, createRealTeamSecretsSeams(org));

export async function readAdminSecretOrNull(org: string, key: string, seams: SecretsSeams): Promise<string | null> {
  try {
    return await readAdminSecret(org, "rt", key, seams);
  } catch (err) {
    warnLine("team", `admin-only secrets for ${org} could not be read: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
};

/**
 * Neither an org token nor the relay operator's says which org it belongs
 * to, so the token is picked by where it came from: the named org's file
 * when it holds an org token; else, on a Mac with one org clone, the first
 * org token this Mac keeps itself; else the file's operator token. An
 * operator token kept on this Mac is never used, and on a Mac with two org
 * clones nothing kept on it is. A thrown `own` read reaches the caller.
 */
export async function pickAdminToken(file: string | null, own: Array<() => Promise<string | null>>, oneOrg: boolean): Promise<string | null> {
  if (isOrgToken(file)) return file;
  if (oneOrg) {
    for (const read of own) {
      const token = await read();
      if (isOrgToken(token)) return token;
    }
  }
  return file || null;
}

async function readAdminFile(admin: AdminSource | null): Promise<string | null> {
  return admin ? await admin.read(admin.org, "switchboardAdminToken").catch(() => null) : null;
}

/** The org's switchboard token rt keeps itself: the org's admin-only file and this Mac's local secret. A throwing local read is the caller's to handle. */
export async function readStoredAdminToken(readLocal: ReadLocalSecret, admin: AdminSource | null, oneOrg = true): Promise<string | null> {
  return pickAdminToken(await readAdminFile(admin), [() => readLocal("switchboardAdminToken")], oneOrg);
}

/** The org's switchboard token from wherever this Mac keeps it: the org's admin-only file, then this Mac's environment, the board's .env and rt's secret. */
export async function readAdminToken(p: Pick<Probes, "home" | "env" | "readFile" | "readDir" | "exists">, readSecret: ReadLocalSecret, admin: AdminSource | null): Promise<string | null> {
  return pickAdminToken(
    await readAdminFile(admin),
    [async () => p.env.SWITCHBOARD_ADMIN_TOKEN || null, async () => boardEnvValue(p, "SWITCHBOARD_ADMIN_TOKEN"), () => readSecret("switchboardAdminToken").catch(() => null)],
    discoverOrgs(p).length === 1,
  );
}

/** Usernames compare the way the relay compares them. */
export function canonicalHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

/**
 * The enrolled boards, as canonical usernames, or null when nothing on this
 * Mac can ask: the admin token lists every board, and a peered board's own
 * token lists its peers. A failed or malformed answer is also null, since a
 * wrong "not peered" would read as a removal that never happened.
 */
export async function readPeeredBoards(p: Probes, readSecret: ReadLocalSecret, adminSource: AdminSource | null): Promise<Set<string> | null> {
  const base = switchboardUrl(p.env);
  const ask = async (path: string, token: string, field: "boards" | "peers"): Promise<Set<string> | null> => {
    try {
      const res = await p.fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status < 200 || res.status >= 300) return null;
      const body = JSON.parse(res.body) as Record<string, unknown>;
      const list = body[field];
      if (!Array.isArray(list)) return null;
      const names = list.map((entry) => (field === "boards" ? (entry as { username?: unknown })?.username : entry));
      if (names.some((n) => typeof n !== "string")) return null;
      return new Set((names as string[]).map(canonicalHandle));
    } catch {
      return null;
    }
  };

  const admin = await readAdminToken(p, readSecret, adminSource);
  if (admin) return ask("/boards", admin, "boards");
  const board = await readBoardSwitchboardToken(p, () => readSecret("switchboardToken").catch(() => null));
  if (board) return ask("/peers", board, "peers");
  return null;
}

export type BoardRevoke =
  | { kind: "revoked" }
  | { kind: "not-peered" }
  | { kind: "no-admin-token" }
  | { kind: "failed"; detail: string };

/** Deletes `handle`'s board registration: its token stops working and anything queued for it is dropped. A 404 means there was nothing to remove. */
export async function revokeBoard(p: Probes, readSecret: ReadLocalSecret, handle: string, adminSource: AdminSource | null): Promise<BoardRevoke> {
  const admin = await readAdminToken(p, readSecret, adminSource);
  if (!admin) return { kind: "no-admin-token" };
  const res = await p.fetch(`${switchboardUrl(p.env)}/boards/${encodeURIComponent(canonicalHandle(handle))}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${admin}` },
  });
  if (res.status >= 200 && res.status < 300) return { kind: "revoked" };
  if (res.status === 404) return { kind: "not-peered" };
  return { kind: "failed", detail: res.status === 0 ? "rt could not reach the switchboard" : `the switchboard answered ${res.status}` };
}
