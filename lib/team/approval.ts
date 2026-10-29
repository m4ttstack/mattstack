/**
 * Whether the team admin has approved this Mac's join. The admin's
 * `rt team members sync` adds the member's age key to the members rule of
 * the org clone's `.sops.yaml`, which every data-branch org has, so this
 * reads that plain-text file against this Mac's own public keys and never
 * touches the keychain or sops.
 */

import { join } from "path";
import { orgDirUnder } from "../rt-paths.ts";
import { parseSopsRules, TEAM_PATH_REGEX } from "../secrets/team-store.ts";
import type { Probes } from "../setup/probes.ts";
import { readTeamLocal } from "./team-local.ts";

export type ApprovalState = { kind: "not-joined" } | { kind: "waiting"; since: string | null } | { kind: "approved" } | { kind: "unreadable"; path: string; reason: string };

export const APPROVAL_WAIT_DETAIL = "Waiting for your team admin to approve your request to join the team";

export const APPROVAL_DEPENDENT_IDS = ["account.slack", "team.sync", "org.admin-secrets", "account.board-peering"] as const;

const AGE_RECIPIENT = /^age1[0-9a-z]+$/;

/**
 * The personal recipients file may name more than one key, and the key
 * recorded at join can differ from it after a key import, so any of them
 * being a team recipient counts.
 */
export function ownRecipients(p: Pick<Probes, "readFile" | "home">, slug: string): Set<string> {
  const personal = p.readFile(join(p.home, ".mattstack", "user", ".sops.yaml")) ?? "";
  const keys = new Set(personal.split(/[\s,]+/).filter((token) => AGE_RECIPIENT.test(token)));
  const joined = readTeamLocal(p, slug).agePublicKey;
  if (joined) keys.add(joined);
  return keys;
}

/** A Mac with no known key cannot tell, so it reads as not joined rather than waiting forever. */
export function approvalState(p: Pick<Probes, "readFile" | "home">, slug: string): ApprovalState {
  const record = readTeamLocal(p, slug);
  if (!record.joinedByRt) return { kind: "not-joined" };
  const mine = ownRecipients(p, slug);
  if (mine.size === 0) return { kind: "not-joined" };

  const path = join(orgDirUnder(p.home, slug), ".sops.yaml");
  const raw = p.readFile(path);
  if (raw === null) return { kind: "unreadable", path, reason: "is missing" };
  const rules = parseSopsRules(raw);
  if (rules === null) return { kind: "unreadable", path, reason: "has a rule rt did not write" };

  const members = rules.find((r) => r.pathRegex === TEAM_PATH_REGEX)?.recipients ?? [];
  return members.some((r) => mine.has(r)) ? { kind: "approved" } : { kind: "waiting", since: record.joinedAt ?? null };
}
