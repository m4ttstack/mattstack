import { SUPPORT_ID } from "../state/identity-store";
import type { SlackCloseReason } from "../state/slack-conversation-store";

export type SlackMilestone =
  | { kind: "declined" | "expired"; person: string }
  | { kind: "opened"; person: string; room: string; agentPane: string }
  | { kind: "open-failed"; person: string; reason: string }
  | { kind: "ticket"; id: string; title: string; url: string }
  | { kind: "closed"; person: string; reason: SlackCloseReason; summary: string | null; tickets: string[] }
  | { kind: "resume-offered"; person: string; text: string; conversation: number }
  | { kind: "resume-expired"; person: string }
  | { kind: "resumed"; person: string; agent: "same" | "fresh" };

export type MilestoneDeps = {
  isOnline(handle: string): boolean;
  postDm(from: string, to: string, body: string): Promise<void>;
  desk(body: string): Promise<void>;
};

const CLOSE_WORDS: Record<SlackCloseReason, string> = {
  "closed-by-pane": "the pane ended it",
  idle: "it went quiet",
  operator: "you closed it",
  "pane-gone": "its pane went away",
};

export function renderMilestone(m: SlackMilestone): string {
  switch (m.kind) {
    case "declined":
      return `${m.person}'s chat request was declined`;
    case "expired":
      return `${m.person}'s chat request expired without a reply`;
    case "opened":
      return `${m.person} is connected in room ${m.room}, agent pane ${m.agentPane}`;
    case "open-failed":
      return `${m.person} could not be connected: ${m.reason}`;
    case "ticket":
      return `${m.id} filed: ${m.title} ${m.url}`;
    case "closed": {
      const parts = [`${m.person}'s chat closed: ${CLOSE_WORDS[m.reason]}`];
      if (m.summary) parts.push(m.summary);
      if (m.tickets.length > 0) parts.push(`Tickets: ${m.tickets.join(", ")}`);
      return parts.map((part) => (/[.!?…]$/.test(part) ? part : `${part}.`)).join(" ");
    }
    case "resume-offered":
      return `${m.person} wrote again after the chat closed: ${m.text} (chat ${m.conversation})`;
    case "resume-expired":
      return `${m.person}'s request to pick the chat back up expired without a reply`;
    case "resumed":
      return `${m.person}'s chat is back with ${m.agent === "same" ? "the same agent" : "a fresh agent"}`;
  }
}

export async function sendMilestone(
  deps: MilestoneDeps,
  to: { handle: string | null; session: string | null },
  m: SlackMilestone,
): Promise<"dm" | "desk"> {
  const body = renderMilestone(m);
  if (to.handle === null || !deps.isOnline(to.handle)) {
    await deps.desk(body);
    return "desk";
  }
  try {
    await deps.postDm(SUPPORT_ID, to.handle, body);
    return "dm";
  } catch {
    await deps.desk(body);
    return "desk";
  }
}
