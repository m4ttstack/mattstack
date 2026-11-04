import { ANNOUNCEMENT_MESSAGE_MAX, ANNOUNCEMENT_TITLE_MAX, ANNOUNCEMENT_TYPE, parseAnnouncementPayload } from "../../packages/rt-client/src/announcement.ts";
import { isOrgAdmin } from "../../packages/rt-client/src/settings/org-roles.ts";
import { switchboardUrl } from "../../packages/rt-client/src/switchboard.ts";
import { UserActionableError } from "../errors.ts";
import type { Probes } from "../setup/probes.ts";
import { realReadLocalSecret, type ReadLocalSecret } from "./board-peers.ts";
import { readBoardSwitchboardToken } from "./board-token.ts";
import { roleFor } from "./roles.ts";

export interface AnnounceSeams {
  readLocalSecret: ReadLocalSecret;
}

const SEND_TIMEOUT_MS = 10_000;

function failure(code: string, message: string, why: string): UserActionableError {
  return new UserActionableError(code, message, {}, { why });
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

export async function sendAnnouncement(
  p: Probes,
  slug: string,
  input: { title: string; message: string },
  seams: AnnounceSeams = { readLocalSecret: realReadLocalSecret },
): Promise<{ delivered: number }> {
  if (!isOrgAdmin(roleFor(p, slug))) {
    throw failure("announce-not-admin", "Only org owners and admins can send announcements", "Your role in this org is member");
  }
  const payload = parseAnnouncementPayload(input);
  if (payload === null) {
    throw failure("announce-invalid", `An announcement needs a title up to ${ANNOUNCEMENT_TITLE_MAX} characters and a message up to ${ANNOUNCEMENT_MESSAGE_MAX}`, "Shorten the text and try again");
  }
  const token = await readBoardSwitchboardToken(p, () => seams.readLocalSecret("switchboardToken").catch(() => null));
  if (token === null) {
    throw failure("announce-no-board-token", "This Mac has no board connection to send from", "Connect your board first with rt team peer");
  }

  let reply: Awaited<ReturnType<Probes["fetch"]>>;
  try {
    reply = await p.fetch(`${switchboardUrl(p.env)}/envelopes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: crypto.randomUUID(), to: "*", type: ANNOUNCEMENT_TYPE, sentAt: Date.now(), payload }),
      timeoutMs: SEND_TIMEOUT_MS,
    });
  } catch {
    throw sendFailed("The switchboard did not answer");
  }
  if (reply.status === 401) {
    throw failure("announce-token-rejected", "The switchboard did not accept this Mac's board connection", "Reconnect your board with rt team peer");
  }
  if (reply.status < 200 || reply.status > 299) throw sendFailed(`The switchboard answered ${reply.status}`);
  const delivered = deliveredFrom(reply.body);
  if (delivered === null) throw sendFailed("The switchboard's answer was not readable");
  return { delivered };
}
