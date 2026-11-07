/**
 * lib/slack/resume.ts: the `slack-open` gate a teammate's trigger raises
 * after a chat has closed, and the later messages that add to it.
 */

import type { Logger } from "pino";
import type { SlackConversation } from "../state/slack-conversation-store.ts";
import { sendMilestone } from "./milestones.ts";
import type { GateQuestion } from "../../packages/rt-client/src/commands.ts";
import { SLACK_OPEN_KIND, slackOpenForm, slackOpenMarker, slackResumeMeta, type SlackOpenDeps, type SlackOpenForm, type SlackResumeMeta } from "./request.ts";
export type ResumeOfferDeps = Pick<SlackOpenDeps, "gates" | "milestones"> & { log: Pick<Logger, "warn"> };

/**
 * `recorded`: on a new gate or one already waiting. `held`: another request for this person holds the subject.
 * `failed`: the gate would not open. The caller leaves the message to be offered again in both.
 */
export type ResumeOffer = "recorded" | "held" | "failed";

async function openResumeGate(
  deps: Pick<ResumeOfferDeps, "gates">,
  conv: SlackConversation,
  input: { context: string; triggerTs: string | null; requester: { session: string | null; handle: string | null }; pane?: string },
): Promise<{ gateId: string; question: GateQuestion } | null> {
  const gateId = crypto.randomUUID();
  const meta: SlackResumeMeta = {
    action: "resume",
    conversation: conv.id,
    person: conv.slackUserId,
    personName: conv.slackDisplayName,
    requesterSession: conv.requesterSession ?? input.requester.session,
    requesterHandle: conv.requesterHandle ?? input.requester.handle,
    triggerTs: input.triggerTs,
  };
  const question: GateQuestion = { id: "decision", label: `Resume the Slack support chat with ${conv.slackDisplayName}? ${slackOpenMarker(gateId)}`, multi: false, options: ["approve", "decline"] };
  const opened = await deps.gates.open({
    id: gateId,
    subject: `slack:${conv.slackUserId}`,
    kind: SLACK_OPEN_KIND,
    questions: [question],
    context: input.context,
    meta,
    ...(input.pane ? { pane: input.pane } : {}),
  });
  return opened.ok ? { gateId, question } : null;
}

/** A pane's own ask to resume a closed chat: the operator still decides, in a gate that shows in the asking pane. */
export async function requestResume(
  deps: Pick<ResumeOfferDeps, "gates"> & Pick<SlackOpenDeps, "presencePane">,
  conv: SlackConversation,
  by: { session: string; handle: string },
): Promise<{ ok: true; gateId: string; question: SlackOpenForm } | { ok: false; reason: string }> {
  const waiting = deps.gates.listOpen().filter((g) => g.subject === `slack:${conv.slackUserId}`);
  const mine = waiting.find((g) => slackResumeMeta(g)?.conversation === conv.id);
  const asked = mine?.questions[0];
  if (mine && asked) return { ok: true, gateId: mine.id, question: slackOpenForm(asked) };
  if (waiting.length > 0) return { ok: false, reason: `a request for ${conv.slackDisplayName} is already waiting` };
  const pane = deps.presencePane(by.session);
  const opened = await openResumeGate(deps, conv, {
    context: `Person: ${conv.slackDisplayName}\n\nAn agent asked to pick this chat back up.`,
    triggerTs: null,
    requester: { session: by.session, handle: by.handle },
    ...(pane ? { pane } : {}),
  });
  return opened === null ? { ok: false, reason: "the request could not be raised" } : { ok: true, gateId: opened.gateId, question: slackOpenForm(opened.question) };
}

export async function offerResume(deps: ResumeOfferDeps, conv: SlackConversation, text: string, triggerTs: string): Promise<ResumeOffer> {
  const subject = `slack:${conv.slackUserId}`;
  const waiting = deps.gates.listOpen().filter((g) => g.subject === subject);
  const mine = waiting.find((g) => slackResumeMeta(g)?.conversation === conv.id);
  if (mine) {
    deps.gates.appendContext(mine.id, `Then:\n${text}`);
    return "recorded";
  }
  if (waiting.length > 0) return "held";

  const opened = await openResumeGate(deps, conv, { context: `Person: ${conv.slackDisplayName}\n\nMessage:\n${text}`, triggerTs, requester: { session: conv.requesterSession, handle: conv.requesterHandle } });
  if (opened === null) return "failed";
  try {
    await sendMilestone(deps.milestones, { handle: conv.requesterHandle, session: conv.requesterSession }, { kind: "resume-offered", person: conv.slackDisplayName, text, conversation: conv.id });
  } catch (err) {
    deps.log.warn({ err, conversationId: conv.id }, "slack: the resume-offered milestone could not be sent");
  }
  return "recorded";
}
