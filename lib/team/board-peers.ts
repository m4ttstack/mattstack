/**
 * The CLI's side of board peering on the switchboard: which teammates have a
 * board registered, and removing one. Every call goes only to
 * `switchboardUrl()`, the one place a board or admin token may be sent.
 */

import { switchboardUrl } from "../../packages/rt-client/src/switchboard.ts";
import { createRealAgeKeySeam } from "../home/age-key.ts";
import { createRealSecretsExecSeam, readSecret } from "../secrets/store.ts";
import type { Probes } from "../setup/probes.ts";
import { boardEnvValue } from "./board-token.ts";

/** Reads one secret from the rt scope, or null when it is not set. */
export type ReadLocalSecret = (key: string) => Promise<string | null>;

export const realReadLocalSecret: ReadLocalSecret = (key) =>
  readSecret("rt", key, { ageKeySeam: createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() });

/** The switchboard admin token from wherever this Mac keeps it, in the order the setup row checks: the environment, the board's .env, then rt's secret. */
export async function readAdminToken(p: Pick<Probes, "home" | "env" | "readFile">, readSecret: ReadLocalSecret): Promise<string | null> {
  return p.env.SWITCHBOARD_ADMIN_TOKEN || boardEnvValue(p, "SWITCHBOARD_ADMIN_TOKEN") || (await readSecret("switchboardAdminToken").catch(() => null));
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
export async function readPeeredBoards(p: Probes, readSecret: ReadLocalSecret): Promise<Set<string> | null> {
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

  const admin = await readAdminToken(p, readSecret);
  if (admin) return ask("/boards", admin, "boards");
  const board = await readSecret("switchboardToken").catch(() => null);
  if (board) return ask("/peers", board, "peers");
  return null;
}

export type BoardRevoke =
  | { kind: "revoked" }
  | { kind: "not-peered" }
  | { kind: "no-admin-token" }
  | { kind: "failed"; detail: string };

/** Deletes `handle`'s board registration: its token stops working and anything queued for it is dropped. A 404 means there was nothing to remove. */
export async function revokeBoard(p: Probes, readSecret: ReadLocalSecret, handle: string): Promise<BoardRevoke> {
  const admin = await readAdminToken(p, readSecret);
  if (!admin) return { kind: "no-admin-token" };
  try {
    const res = await p.fetch(`${switchboardUrl(p.env)}/boards/${encodeURIComponent(handle)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${admin}` },
    });
    if (res.status >= 200 && res.status < 300) return { kind: "revoked" };
    if (res.status === 404) return { kind: "not-peered" };
    return { kind: "failed", detail: `the switchboard answered ${res.status}` };
  } catch (err) {
    return { kind: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
