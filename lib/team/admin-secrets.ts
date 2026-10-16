/**
 * The org's admin-only secrets: sops files under `mattstack/org/admin-secrets/`,
 * locked by `.sops.yaml`'s admins rule to the age keys the roster records for
 * the org's owners and admins. The org store decides who that is; the rule
 * only follows it. Today the one secret kept here is the switchboard admin
 * token, which every reader looks for here before this Mac's own rt secret.
 */

import { rolesFrom, rosterFrom, sameUser } from "../../packages/rt-client/src/settings/active-team.ts";
import { isOrgAdmin, roleOf } from "../../packages/rt-client/src/settings/org-roles.ts";
import type { StoreFile } from "../../packages/rt-client/src/settings/stores.ts";
import { UserActionableError } from "../errors.ts";
import { readAgePublicKey } from "../home/age-key.ts";
import type { SecretsSeams } from "../secrets/store.ts";
import { listRuleFiles, readAdminSecret, readTeamRecipients, reencryptTeamSecrets, writeAdminSecret, writeTeamRecipients } from "../secrets/team-store.ts";
import type { Probes } from "../setup/probes.ts";
import { assertMayWrite } from "./roles.ts";

export const SWITCHBOARD_ADMIN_TOKEN = "switchboardAdminToken";
export const ADMIN_TOKEN_DOMAIN = "rt";

export interface AdminKeys {
  keys: string[];
  /** Owners and admins whose roster entry carries a key. */
  holders: string[];
  /** Owners and admins with no key on the roster, so no Mac of theirs can open the file yet. */
  withoutKey: string[];
}

function asStore(global: Record<string, unknown>): StoreFile {
  return { global, repos: {}, file: "", exists: true };
}

export function adminKeysIn(orgStore: Record<string, unknown>): AdminKeys {
  const store = asStore(orgStore);
  const roles = rolesFrom(store);
  const keys = new Set<string>();
  const holders: string[] = [];
  for (const entry of rosterFrom(store)) {
    const key = typeof entry.agePublicKey === "string" ? entry.agePublicKey.trim() : "";
    if (key === "" || !isOrgAdmin(roleOf(entry.username, roles))) continue;
    keys.add(key);
    holders.push(entry.username);
  }
  const named = [...roles.owners, ...roles.admins].filter((name, i, all) => all.findIndex((other) => sameUser(other, name)) === i);
  const withoutKey = named.filter((name) => !holders.some((holder) => sameUser(holder, name)));
  return { keys: [...keys].sort(), holders: holders.sort(), withoutKey: withoutKey.sort() };
}

export type TokenOutcome = "seeded" | "replaced" | "kept" | "differs" | "none";

export interface AdminSecretsResult {
  /** `unused`: the org keeps no admin-only secrets and this run had no token to add, so nothing was touched. */
  state: "unused" | "current" | "updated";
  holders: string[];
  withoutKey: string[];
  /** Keys the admins rule gained, and lost. */
  added: string[];
  removed: string[];
  reencrypted: string[];
  token: TokenOutcome;
}

export interface AdminSecretsOpts {
  /** This Mac's own switchboard admin token, put in when the file holds none. */
  token?: string | null;
  /** Put `token` in even when the file already holds a different one. */
  replaceToken?: boolean;
}

function noAdminKeys(slug: string): UserActionableError {
  return new UserActionableError("no-admin-keys", "No org owner or admin has an age key on the roster yet, so rt cannot lock the admin-only secrets to anyone", { team: slug }, {
    why: "A key lands on the roster when someone's invite is collected. Bring the roster up to date, then run this again.",
    next: "rt team members sync",
  });
}

function notReencrypted(slug: string, err: unknown): UserActionableError {
  return new UserActionableError("admin-secrets-not-reencrypted", "rt could not lock the admin-only secrets to the org's owners and admins", { team: slug }, {
    why: "This Mac's age key may not open them yet, so nothing changed. An owner or admin whose Mac already can runs this instead.",
    next: "rt team admin-secrets",
    log: err instanceof Error ? err.message : String(err),
  });
}

function notThisMac(slug: string): UserActionableError {
  return new UserActionableError("admin-secrets-not-this-mac", "This Mac's age key is not the one the roster holds for you, so it could not open the admin-only secrets after writing them", { team: slug }, {
    why: "The roster records one age key per person, and the token is locked to those keys. Share it from the Mac whose key the roster holds for you, by running this there.",
    next: "rt team admin-secrets",
  });
}

async function placeToken(p: Pick<Probes, "readFile" | "home">, slug: string, secrets: SecretsSeams, token: string | null, replace: boolean): Promise<TokenOutcome> {
  if (token === null) return "none";
  const stored = await readAdminSecret(slug, ADMIN_TOKEN_DOMAIN, SWITCHBOARD_ADMIN_TOKEN, secrets);
  if (stored === token) return "kept";
  if (stored !== null && !replace) return "differs";
  await writeAdminSecret(slug, ADMIN_TOKEN_DOMAIN, SWITCHBOARD_ADMIN_TOKEN, token, secrets, p);
  return stored === null ? "seeded" : "replaced";
}

/**
 * Brings the admins rule to the owners' and admins' roster keys, re-encrypts
 * the admin-only files when that set changed (putting the rule back if sops
 * fails), then puts `opts.token` in. Writes nothing at all when nothing changed.
 * A token is put in only from a Mac whose age key is a holder's roster key,
 * checked before anything is written; with no token, any owner's or admin's
 * Mac may bring the rule to the roles.
 */
export async function syncAdminSecrets(
  p: Pick<Probes, "readFile" | "home">,
  slug: string,
  orgStore: Record<string, unknown>,
  secrets: SecretsSeams,
  opts: AdminSecretsOpts = {},
): Promise<AdminSecretsResult> {
  assertMayWrite(p, slug, ".sops.yaml");
  const want = adminKeysIn(orgStore);
  const current = readTeamRecipients(slug, secrets, "admins");
  const token = opts.token ? opts.token : null;
  const base = { holders: want.holders, withoutKey: want.withoutKey };
  if (current.length === 0 && listRuleFiles(slug, secrets, "admins").length === 0 && token === null) {
    return { ...base, state: "unused", added: [], removed: [], reencrypted: [], token: "none" };
  }
  if (want.keys.length === 0) throw noAdminKeys(slug);
  if (token !== null) {
    const own = await readAgePublicKey(secrets.ageKeySeam);
    if (own === null || !want.keys.includes(own)) throw notThisMac(slug);
  }

  const added = want.keys.filter((key) => !current.includes(key));
  const removed = current.filter((key) => !want.keys.includes(key));
  let reencrypted: string[] = [];
  if (added.length > 0 || removed.length > 0) {
    writeTeamRecipients(slug, want.keys, secrets, "admins");
    try {
      reencrypted = await reencryptTeamSecrets(slug, secrets, p, "admins");
    } catch (err) {
      // Until every file is re-encrypted, the files' own recipients are the old ones; the rule must say so.
      writeTeamRecipients(slug, current, secrets, "admins");
      throw notReencrypted(slug, err);
    }
  }
  const outcome = await placeToken(p, slug, secrets, token, opts.replaceToken === true);
  const changed = added.length > 0 || removed.length > 0 || outcome === "seeded" || outcome === "replaced";
  return { ...base, state: changed ? "updated" : "current", added, removed, reencrypted, token: outcome };
}

/** For a verb whose own roster change already landed: the admin-only files follow it, and a failure is reported, never thrown. */
export async function followRosterChange(
  p: Pick<Probes, "readFile" | "home">,
  slug: string,
  orgStore: Record<string, unknown>,
  secrets: SecretsSeams,
): Promise<{ reencrypted: string[]; failure: string | null }> {
  try {
    return { reencrypted: (await syncAdminSecrets(p, slug, orgStore, secrets)).reencrypted, failure: null };
  } catch (err) {
    return { reencrypted: [], failure: err instanceof Error ? err.message : String(err) };
  }
}
