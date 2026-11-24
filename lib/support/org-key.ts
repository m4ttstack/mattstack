/** The org's support key, in the org's members secrets: every member's age key opens it, and no one else's does. */
import { randomBytes } from "crypto";
import { SUPPORT_TTL_MS } from "../../packages/rt-client/src/support.ts";
import type { SecretsSeams } from "../secrets/store.ts";
import { readTeamSecret, writeTeamSecret } from "../secrets/team-store.ts";

const DOMAIN = "support";
const KEY = "requestKey";

export interface SupportKeys {
  current: string;
  /** Newest first. */
  retired: { key: string; retiredAt: number }[];
}

const KEY_BYTES = 32;

/** An HMAC takes an empty key without complaint, so a value that is not a whole key must never reach one. */
function isKey(v: unknown): v is string {
  return typeof v === "string" && Buffer.from(v, "base64").length === KEY_BYTES;
}

function parseKeys(raw: string): SupportKeys | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const { current, retired } = value as Record<string, unknown>;
  if (!isKey(current) || !Array.isArray(retired)) return null;
  const parsed: SupportKeys["retired"] = [];
  for (const r of retired as unknown[]) {
    const { key, retiredAt } = (r ?? {}) as Record<string, unknown>;
    if (!isKey(key) || typeof retiredAt !== "number") return null;
    parsed.push({ key, retiredAt });
  }
  return { current, retired: parsed };
}

function newKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
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
  await store(org, { current: newKey(), retired: [] }, seams);
}

/** False when the org has no key to change. */
export async function rotateSupportKey(org: string, seams: SecretsSeams, now: number): Promise<boolean> {
  const keys = await readSupportKeys(org, seams);
  if (keys === null) return false;
  await store(org, { current: newKey(), retired: [{ key: keys.current, retiredAt: now }, ...liveRetired(keys, now)] }, seams);
  return true;
}

/** A queued request outlives a rotation by as long as the relay keeps it. */
function liveRetired(keys: SupportKeys, now: number): SupportKeys["retired"] {
  return keys.retired.filter((r) => now - r.retiredAt < SUPPORT_TTL_MS);
}

/** The keys a message may be signed with, newest first. */
export function usableKeys(keys: SupportKeys, now: number): string[] {
  return [keys.current, ...liveRetired(keys, now).map((r) => r.key)];
}
