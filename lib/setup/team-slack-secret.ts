/**
 * Whether a joined member's Slack connect has to wait on the team owner.
 * Slack connect needs the team's Slack client secret, which a member can
 * decrypt only after the owner's `rt team members sync` adds this machine's
 * age key to the team secrets and the clone pulls that. Decrypting to find
 * out would read the age key from the keychain, so this reads only files:
 * the recipients sops records in plain text inside the encrypted file,
 * against this machine's own public keys.
 */

import { join } from "path";
import { readTeamLocal } from "../team/team-local.ts";
import type { Probes } from "./probes.ts";

export type SlackSecretWait = { kind: "awaiting-acceptance" } | { kind: "not-shared" } | { kind: "unreadable"; path: string; reason: string };

const SECRET_KEY = "slackClientSecret";
const AGE_RECIPIENT = /^age1[0-9a-z]+$/;

/**
 * The personal recipients file may name more than one key, and the key
 * recorded at join can differ from it after a key import, so any of them
 * being a team recipient counts.
 */
function ownRecipients(p: Pick<Probes, "readFile" | "home">, slug: string): Set<string> {
  const personal = p.readFile(join(p.home, ".mattstack", "user", ".sops.yaml")) ?? "";
  const keys = new Set(personal.split(/[\s,]+/).filter((token) => AGE_RECIPIENT.test(token)));
  const joined = readTeamLocal(p, slug).agePublicKey;
  if (joined) keys.add(joined);
  return keys;
}

function sopsRecipients(parsed: unknown): string[] | null {
  const age = (parsed as { sops?: { age?: unknown } } | null)?.sops?.age;
  if (!Array.isArray(age)) return null;
  return age.map((entry) => (entry as { recipient?: unknown })?.recipient).filter((r): r is string => typeof r === "string");
}

/**
 * Null when nothing stands in the way of Connect, including when this
 * machine did not join by invite or holds no known key: the connect verb's
 * own read then decides.
 */
export function slackSecretWait(p: Pick<Probes, "readFile" | "fileSize" | "home">, slug: string): SlackSecretWait | null {
  if (!readTeamLocal(p, slug).joinedByRt) return null;
  const mine = ownRecipients(p, slug);
  if (mine.size === 0) return null;

  const path = join(p.home, ".mattstack", "teams", slug, "mattstack", "secrets", "board.json");
  if (p.fileSize(path) === null) return { kind: "not-shared" };
  const raw = p.readFile(path);
  if (raw === null) return { kind: "unreadable", path, reason: "could not be read" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "unreadable", path, reason: "is not valid JSON" };
  }
  const recipients = sopsRecipients(parsed);
  if (recipients === null) return { kind: "unreadable", path, reason: "carries no sops age recipients" };

  if (!recipients.some((r) => mine.has(r))) return { kind: "awaiting-acceptance" };
  const holdsSecret = typeof parsed === "object" && parsed !== null && Object.hasOwn(parsed, SECRET_KEY);
  return holdsSecret ? null : { kind: "not-shared" };
}

function unreadableText(wait: { path: string; reason: string }, slug: string): string {
  return `the team's secrets file at ${wait.path} ${wait.reason}: run \`rt team pull --team ${slug}\`, and if it stays this way ask your team owner or re-clone the team`;
}

export function slackWaitRowDetail(wait: SlackSecretWait, slug: string): string {
  if (wait.kind === "awaiting-acceptance") return "Waiting for your team owner to accept you. Slack connects a few minutes after they do; Re-check pulls now.";
  if (wait.kind === "not-shared") return "Your team owner hasn't shared the Slack app's secret yet: they connect Slack or run Install on their machine. Re-check pulls now.";
  return unreadableText(wait, slug);
}

export function slackWaitCliMessage(wait: SlackSecretWait, slug: string): string {
  if (wait.kind === "awaiting-acceptance") {
    return `waiting for your team owner to accept you: they run \`rt team members sync\`, then you run \`rt team pull --team ${slug}\` and connect again`;
  }
  if (wait.kind === "not-shared") {
    return `your team owner hasn't shared the Slack app's secret yet: they connect Slack or run Install on their machine, then you run \`rt team pull --team ${slug}\` and connect again`;
  }
  return unreadableText(wait, slug);
}
