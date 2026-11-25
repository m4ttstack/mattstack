import {
  ANNOUNCEMENT_MESSAGE_MAX,
  ANNOUNCEMENT_PLACEHOLDER,
  ANNOUNCEMENT_TITLE_MAX,
  ANNOUNCEMENT_TYPE,
  announcementBinding,
  parseAnnouncementPayload,
} from "../../packages/rt-client/src/announcement.ts";
import { rosterFrom } from "../../packages/rt-client/src/settings/active-team.ts";
import { isOrgAdmin, type OrgRole } from "../../packages/rt-client/src/settings/org-roles.ts";
import { switchboardUrl } from "../../packages/rt-client/src/switchboard.ts";
import { UserActionableError } from "../errors.ts";
import { parseStoreText } from "../settings/stores.ts";
import type { Probes } from "../setup/probes.ts";
import { canonicalHandle, realReadLocalSecret, type ReadLocalSecret } from "./board-peers.ts";
import { readBoardSwitchboardToken } from "./board-token.ts";
import { orgStoreFile } from "./org-store.ts";
import { roleFor } from "./roles.ts";
import { realSealedText, type SealedText } from "./sealed-text.ts";
import { readTeamLocal } from "./team-local.ts";

export interface AnnounceSeams {
  readLocalSecret: ReadLocalSecret;
  sealedText: SealedText;
}

const SEND_TIMEOUT_MS = 10_000;

function failure(code: string, message: string, why: string, next?: string): UserActionableError {
  return new UserActionableError(code, message, {}, { why, next });
}

function notAdminWhy(role: OrgRole): string {
  if (role.kind === "unknown") return "rt does not know this Mac's username for the org";
  if (role.kind === "owner") return "You own a team here, but only the org's owners and admins can announce";
  return "Your role in this org is member";
}

function sendFailed(why: string): UserActionableError {
  return failure("announce-send-failed", "rt could not send the announcement", why);
}

function deliveredFrom(body: string): number | null {
  try {
    const parsed: unknown = JSON.parse(body);
    const delivered = parsed !== null && typeof parsed === "object" ? (parsed as { delivered?: unknown }).delivered : undefined;
    return typeof delivered === "number" ? delivered : null;
  } catch {
    return null;
  }
}

function notSealed(why: string, next?: string): UserActionableError {
  return failure("announce-not-sealed", "This Mac could not lock the announcement, so nothing was sent", why, next);
}

function rosterHandles(p: Probes, slug: string): string[] {
  const file = orgStoreFile(p.home, slug);
  const raw = p.readFile(file);
  return raw === null ? [] : rosterFrom(parseStoreText(file, raw)).map((e) => canonicalHandle(e.username));
}

/** The org's people are the recipients, so a board the relay lists but the roster does not cannot read it. */
async function seal(p: Probes, slug: string, id: string, text: { title: string; message: string }, sealedText: SealedText): Promise<{ sealed: string; unreadable: number }> {
  const from = readTeamLocal(p, slug).forgeUsername;
  if (from === undefined) throw notSealed("rt does not know this Mac's username for the org");
  const people = new Set([...rosterHandles(p, slug), canonicalHandle(from)]);
  const result = await sealedText.seal([...people], announcementBinding(id, from), { title: text.title, message: text.message });
  if (!result.ok) {
    throw result.reason === "no-recipients"
      ? notSealed("Nobody on the org's roster has a key yet", "rt team members sync")
      : notSealed("rt's encryption tool did not run");
  }
  return { sealed: result.sealed, unreadable: result.unreachable.length };
}

export async function sendAnnouncement(
  p: Probes,
  slug: string,
  input: { title: string; message: string },
  seams: AnnounceSeams = { readLocalSecret: realReadLocalSecret, sealedText: realSealedText(slug) },
): Promise<{ delivered: number; unreadable: number }> {
  const role = roleFor(p, slug);
  if (!isOrgAdmin(role)) {
    throw failure("announce-not-admin", "Only org owners and admins can send announcements", notAdminWhy(role));
  }
  const payload = parseAnnouncementPayload(input);
  if (payload === null) {
    throw failure("announce-invalid", `An announcement needs a title up to ${ANNOUNCEMENT_TITLE_MAX} characters and a message up to ${ANNOUNCEMENT_MESSAGE_MAX}`, "The title or the message is empty or too long");
  }
  const token = await readBoardSwitchboardToken(p, () => seams.readLocalSecret("switchboardToken").catch(() => null));
  if (token === null) {
    throw failure("announce-no-board-token", "This Mac has no board connection to send from", "No board token is stored on this Mac", "rt team peer");
  }

  const id = crypto.randomUUID();
  const { sealed, unreadable } = await seal(p, slug, id, payload, seams.sealedText);

  let reply: Awaited<ReturnType<Probes["fetch"]>>;
  try {
    reply = await p.fetch(`${switchboardUrl(p.env)}/envelopes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id, to: "*", type: ANNOUNCEMENT_TYPE, sentAt: Date.now(), payload: { ...ANNOUNCEMENT_PLACEHOLDER, sealed } }),
      timeoutMs: SEND_TIMEOUT_MS,
    });
  } catch {
    throw sendFailed("The switchboard did not answer");
  }
  if (reply.status === 401) {
    throw failure("announce-token-rejected", "The switchboard did not accept this Mac's board connection", "The stored board token is no longer valid", "rt team peer --rotate");
  }
  if (reply.status === 0) throw sendFailed("rt could not reach the switchboard");
  if (reply.status < 200 || reply.status > 299) throw sendFailed(`The switchboard answered ${reply.status}`);
  const delivered = deliveredFrom(reply.body);
  if (delivered === null) throw sendFailed("The switchboard's answer was not readable");
  return { delivered, unreadable };
}
