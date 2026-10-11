// src/edge/oauth.ts: who may sign in to an app at Cloudflare's edge, and
// nothing else. Publication and the password gate live in core/settings.ts and
// are enforced independently: core/gateway.ts reads passwordHash and never
// reads this file.
import { readFileSync, renameSync } from 'fs';
import { join } from 'path';

import { getSetting, setSetting } from '@mattstack/rt-client';
import { stateDir } from '../api/state.ts';
import {
  defaultExplain,
  heldEntries,
  type ExplainFn,
} from '../api/store-import.ts';

export type OAuth =
  | { mode: 'off' }
  | { mode: 'emails'; emails: string[] }
  | { mode: 'domains'; domains: string[] };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** The old file the one-time import reads. */
export function accessPath(): string {
  return process.env.LOCAL_ACCESS_PATH ?? join(stateDir(), 'access.json');
}

interface AccessFile {
  apps: Record<string, OAuth>;
}

function isOAuth(value: unknown): value is OAuth {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  if (r.mode === 'off') return true;
  if (r.mode === 'emails') {
    return (
      Array.isArray(r.emails) &&
      r.emails.length > 0 &&
      r.emails.every(e => typeof e === 'string' && EMAIL_RE.test(e))
    );
  }
  if (r.mode === 'domains') {
    return (
      Array.isArray(r.domains) &&
      r.domains.length > 0 &&
      r.domains.every(d => typeof d === 'string' && DOMAIN_RE.test(d))
    );
  }
  return false;
}

const STORE_KEY = 'deck.access';
type GetSettingFn = typeof getSetting;
type SetSettingFn = typeof setSetting;

/**
 * A deck that kept sign-in rules in access.json copies its valid rules into
 * deck.access before the first read, then renames the file
 * access.json.imported. The copy fills only the apps no store sets, and
 * leaves the file alone when a store holds a value the resolver refused.
 * When the copy cannot land, the returned rules overlay this boot and the
 * file is left for the next one.
 */
export function importAccessFile(
  explain: ExplainFn = defaultExplain,
  write: SetSettingFn = setSetting
): Record<string, OAuth> {
  const path = accessPath();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
  const apps = (parsed as AccessFile | null)?.apps;
  const rules: Record<string, OAuth> = {};
  if (typeof apps === 'object' && apps !== null)
    for (const [app, rule] of Object.entries(apps))
      if (isOAuth(rule)) rules[app] = rule;
  let missing: Record<string, OAuth> = rules;
  try {
    const stored = heldEntries(STORE_KEY, 'user', explain);
    if (stored.refused) {
      console.error(
        `deck: ${STORE_KEY} holds a value rt refused; using access.json until it is fixed`
      );
      return rules;
    }
    missing = Object.fromEntries(
      Object.entries(rules).filter(([app]) => !stored.held.has(app))
    );
    if (Object.keys(missing).length > 0)
      write(STORE_KEY, { ...stored.own, ...missing }, 'user');
    renameSync(path, `${path}.imported`);
    return {};
  } catch (err) {
    console.error(
      `deck: could not move sign-in rules into ${STORE_KEY}; using access.json until the next start`,
      err
    );
    return missing;
  }
}

function readStoredAccess(resolve: GetSettingFn): Record<string, unknown> {
  try {
    return resolve<Record<string, unknown>>(STORE_KEY).value as Record<
      string,
      unknown
    >;
  } catch (err) {
    console.warn(
      `deck: ${STORE_KEY} unavailable, apps read with no sign-in rule`,
      err
    );
    return {};
  }
}

/** The store is authoritative as written: an entry that is not a valid rule is skipped, never corrected. */
function load(
  resolve: GetSettingFn,
  pending: Record<string, OAuth> = {}
): AccessFile {
  const apps: Record<string, OAuth> = {};
  for (const [app, rule] of Object.entries({
    ...readStoredAccess(resolve),
    ...pending,
  }))
    if (isOAuth(rule)) apps[app] = rule;
  return { apps };
}

/** Rules a failed boot import kept from access.json; every store write carries them until one lands. */
let pendingRules: Record<string, OAuth> = importAccessFile();
let cache: AccessFile = load(getSetting, pendingRules);

/** `pending` is what a failed boot import returned, for a reload that stands in for boot. */
export function reloadOAuth(
  resolve: GetSettingFn = getSetting,
  pending: Record<string, OAuth> = {}
): void {
  pendingRules = pending;
  cache = load(resolve, pending);
}

export function getOAuth(app: string): OAuth {
  return cache.apps[app] ?? { mode: 'off' };
}

/**
 * Pending rules sit under a fresh read of the store, so an entry another
 * process wrote, or one load skipped as malformed, survives. A value the
 * resolver refused reads as empty, so a write over it would drop every rule
 * the user scope holds: refuse instead.
 */
function currentRawAccessStore(): Record<string, unknown> {
  if (heldEntries(STORE_KEY, 'user', defaultExplain).refused)
    throw new Error(
      `deck: ${STORE_KEY} holds a value rt refused; fix it before changing sign-in rules`
    );
  return {
    ...pendingRules,
    ...(getSetting<Record<string, unknown>>(STORE_KEY).value as Record<
      string,
      unknown
    >),
  };
}

export function setOAuth(app: string, rule: OAuth): void {
  const previous = structuredClone(cache);
  cache.apps[app] = rule;
  try {
    setSetting(STORE_KEY, { ...currentRawAccessStore(), [app]: rule }, 'user');
  } catch (err) {
    cache = previous;
    throw err;
  }
  pendingRules = {};
}

/**
 * Move an app's sign-in rule to a new name, verbatim: a rename that dropped
 * it would open the renamed app the moment its hostname goes live. A no-op
 * when the old name has no rule.
 */
export function renameOAuth(oldName: string, newName: string): void {
  const rule = cache.apps[oldName];
  if (!rule) return;
  const previous = structuredClone(cache);
  delete cache.apps[oldName];
  cache.apps[newName] = rule;
  try {
    const next = { ...currentRawAccessStore(), [newName]: rule };
    delete next[oldName];
    setSetting(STORE_KEY, next, 'user');
  } catch (err) {
    cache = previous;
    throw err;
  }
  pendingRules = {};
}

export function oauthRequiresCf(rule: OAuth): boolean {
  return rule.mode !== 'off';
}

export function parseOAuth(body: unknown): OAuth | { error: string } {
  if (typeof body !== 'object' || body === null)
    return { error: 'invalid body' };
  const b = body as Record<string, unknown>;
  if (b.mode === 'off') return { mode: 'off' };
  if (b.mode === 'emails') {
    const emails = b.emails;
    if (
      !Array.isArray(emails) ||
      emails.length === 0 ||
      !emails.every(e => typeof e === 'string' && EMAIL_RE.test(e))
    ) {
      return { error: 'emails must be a non-empty list of valid addresses' };
    }
    return { mode: 'emails', emails: emails as string[] };
  }
  if (b.mode === 'domains') {
    const domains = b.domains;
    if (
      !Array.isArray(domains) ||
      domains.length === 0 ||
      !domains.every(d => typeof d === 'string' && DOMAIN_RE.test(d))
    ) {
      return { error: 'domains must be a non-empty list of valid domains' };
    }
    return { mode: 'domains', domains: domains as string[] };
  }
  return { error: 'unknown mode' };
}
