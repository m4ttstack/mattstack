/**
 * Whether a joined member's Slack connect has to wait for the team owner.
 * Slack connect needs the team's Slack client secret, which a member can
 * decrypt only after the owner's `rt team members sync` adds this machine's
 * age key to the team secrets and the clone pulls that. Decrypting to find
 * out would read the age key from the keychain, so this reads only files:
 * the recipients sops records in plain text inside the encrypted file,
 * against this machine's own public key.
 */

import { join } from "path";
import { sopsYamlRecipient } from "../home/age-key.ts";
import { readTeamLocal } from "../team/team-local.ts";
import type { Probes } from "./probes.ts";

export const SLACK_AWAITING_OWNER = "Waiting for your team owner to accept you; Slack connects after that";

export type SlackSecretWait = { kind: "waiting"; detail: string } | { kind: "unreadable"; detail: string };

const SECRET_KEY = "slackClientSecret";

/** This machine's age recipient, preferring the personal recipients file Install writes over the copy recorded at join. */
function ownRecipient(p: Pick<Probes, "readFile" | "home">, slug: string): string | null {
  const personal = p.readFile(join(p.home, ".mattstack", "user", ".sops.yaml"));
  return (personal === null ? null : sopsYamlRecipient(personal)) ?? readTeamLocal(p, slug).agePublicKey ?? null;
}

function sopsRecipients(parsed: unknown): string[] | null {
  const age = (parsed as { sops?: { age?: unknown } } | null)?.sops?.age;
  if (!Array.isArray(age)) return null;
  return age.map((entry) => (entry as { recipient?: unknown })?.recipient).filter((r): r is string => typeof r === "string");
}

/**
 * Null when nothing stands in the way of Connect, including when this
 * machine did not join by invite or its key is not known locally: the
 * connect verb's own read then decides.
 */
export function slackSecretWait(p: Pick<Probes, "readFile" | "fileSize" | "home">, slug: string): SlackSecretWait | null {
  if (!readTeamLocal(p, slug).joinedByRt) return null;
  const mine = ownRecipient(p, slug);
  if (!mine) return null;

  const path = join(p.home, ".mattstack", "teams", slug, "mattstack", "secrets", "board.json");
  if (p.fileSize(path) === null) return { kind: "waiting", detail: SLACK_AWAITING_OWNER };
  const raw = p.readFile(path);
  if (raw === null) return { kind: "unreadable", detail: `could not read the team's Slack client secret file at ${path}` };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "unreadable", detail: `the team's secrets file at ${path} is not valid JSON` };
  }
  const recipients = sopsRecipients(parsed);
  if (recipients === null) return { kind: "unreadable", detail: `the team's secrets file at ${path} carries no sops age recipients` };

  const holdsSecret = typeof parsed === "object" && parsed !== null && Object.hasOwn(parsed, SECRET_KEY);
  if (!holdsSecret || !recipients.includes(mine)) return { kind: "waiting", detail: SLACK_AWAITING_OWNER };
  return null;
}
