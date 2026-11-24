/** The org's support key, in the org's members secrets: every member's age key opens it, and no one else's does. */
import { randomBytes } from "crypto";
import { SUPPORT_TTL_MS } from "../../packages/rt-client/src/support.ts";
import type { SecretsSeams } from "../secrets/store.ts";
import { readTeamSecret, writeTeamSecret } from "../secrets/team-store.ts";

const DOMAIN = "support";
const KEY = "requestKey";

export interface SupportKeys {
  current: string;
  previous: string | null;
  rotatedAt: number | null;
}

function parseKeys(raw: string): SupportKeys | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const { current, previous, rotatedAt } = value as Record<string, unknown>;
  if (typeof current !== "string" || !current) return null;
  if (previous !== null && typeof previous !== "string") return null;
  if (rotatedAt !== null && typeof rotatedAt !== "number") return null;
  return { current, previous, rotatedAt };
}

function newKey(): string {
  return randomBytes(32).toString("base64");
}

function store(org: string, keys: SupportKeys, seams: SecretsSeams): Promise<void> {
  return writeTeamSecret(org, DOMAIN, KEY, JSON.stringify(keys), seams);
}

/** Null when the org has no key; throws when this Mac cannot open the org's secrets. */
export async function readSupportKeys(org: string, seams: SecretsSeams): Promise<SupportKeys | null> {
  const raw = await readTeamSecret(org, DOMAIN, KEY, seams);
  return raw === null ? null : parseKeys(raw);
}

export async function ensureSupportKey(org: string, seams: SecretsSeams): Promise<void> {
  if ((await readSupportKeys(org, seams)) !== null) return;
  await store(org, { current: newKey(), previous: null, rotatedAt: null }, seams);
}

/** False when the org has no key to change. */
export async function rotateSupportKey(org: string, seams: SecretsSeams, now: number): Promise<boolean> {
  const keys = await readSupportKeys(org, seams);
  if (keys === null) return false;
  await store(org, { current: newKey(), previous: keys.current, rotatedAt: now }, seams);
  return true;
}

/** The keys a message may be signed with, newest first. A queued request outlives a rotation by as long as the relay keeps it. */
export function usableKeys(keys: SupportKeys, now: number): string[] {
  const previousLives = keys.previous !== null && keys.rotatedAt !== null && now - keys.rotatedAt < SUPPORT_TTL_MS;
  return previousLives ? [keys.current, keys.previous!] : [keys.current];
}
