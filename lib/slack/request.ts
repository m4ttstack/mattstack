/**
 * lib/slack/request.ts: a pane's request for a Slack support chat, the
 * `slack-open` gate it raises, and the approved open that starts the
 * background agent. Every outside effect comes in through SlackOpenDeps.
 */

import { randomBytes, randomUUID } from "crypto";
import type { Database } from "bun:sqlite";
import type { Logger } from "pino";
import { unwrapGateAnswerValue } from "../../packages/rt-client/src/gate-answers.ts";
import { normalizeGateOptions } from "../../packages/rt-client/src/gate-options.ts";
import type { GateQuestion, GateRow, SlackOpenForm } from "../../packages/rt-client/src/commands.ts";
export type { SlackOpenForm };
import { tsBefore, tsFromMs } from "../daemon/slack-bridge.ts";
import { addRoomMember } from "../state/chat-store.ts";
import { conversationById, endGrace, enqueueItem, paneInUse, ticketsForChain, type SlackConversation, type SupportTicket } from "../state/slack-conversation-store.ts";
import { SlackConversationBusy, conversationForSlackUser, dmRoomFor, ensureSlackIdentity, isValidChatName, openConversation } from "../state/index.ts";
import { sendMilestone, type MilestoneDeps, type SlackMilestone } from "./milestones.ts";

export const SLACK_OPEN_KIND = "slack-open";
export const SLACK_OPEN_TTL_MS = 30 * 60_000;
/** The only writers a `slack-open` answer is accepted from: the console's own route and the mod recording the pane's form. */
export const SLACK_OPEN_ANSWERERS: readonly string[] = ["console", "slack-mod"];
export const SLACK_OPEN_OPEN_REFUSAL = "only the daemon opens a slack-open gate, so ask for a chat with chat_slack_request";
export const SLACK_OPEN_REFUSAL = "a Slack chat is approved only by the operator, in the console or the pane's form";

const DECISION_ID = "decision";
const APPROVE = "approve";
const DECLINE = "decline";

export function slackOpenMarker(gateId: string): string {
  return `[slack-open ${gateId}]`;
}

export type SlackOpenMeta = {
  action: "open";
  /** The Slack user id. */
  person: string;
  personName: string;
  brief: string;
  requesterSession: string | null;
  requesterHandle: string | null;
  requesterPane: string | null;
  repo: string;
  /** The Slack ts of the teammate's message that raised the gate, so an approved open delivers it first; absent when a pane asked. */
  triggerTs?: string | null;
  /** The ts of a teammate's message that joined a pane's request while it waited, so an approved open delivers it first without reading as the teammate's request. */
  appendedTriggerTs?: string | null;
};

export type SlackResumeMeta = {
  action: "resume";
  /** The closed conversation's id. */
  conversation: number;
  person: string;
  personName: string;
  requesterSession: string | null;
  requesterHandle: string | null;
  /** The Slack ts of the message that raised the gate, so an approved resume can deliver it first; null when a person asked for the resume. */
  triggerTs: string | null;
};

export type StartedAgent = { id: string; handle: string; sessionId: string; paneId: string };

export type SlackCandidate = { name: string; person: string; title?: string };

export type SlackTarget = {
  userId: string;
  displayName: string;
  firstName: string;
  channel: string;
  operatorUserId: string;
  operatorName: string;
  newestTs: string | null | undefined;
};

export type SlackOpenDeps = {
  db: Database;
  now(): number;
  log: Logger;
  milestones: MilestoneDeps;
  humanHandle(): string;
  /** Resolves a name or id to one person, or says why it can't. `refused` marks an answer Slack gave about this person (it will not change); `error` carries a failure to reach Slack at all. */
  findPerson(person: string): Promise<{ ok: true; person: { id: string; displayName: string } } | { ok: false; reason: string; candidates?: SlackCandidate[]; refused?: true; error?: unknown }>;
  /** Everything Slack has to say before an open: the DM channel, the cursor, the operator. */
  connect(userId: string): Promise<{ ok: true; target: SlackTarget } | { ok: false; reason: string }>;
  repoPath(repo: string): string | null;
  startAgent(repo: string): Promise<{ ok: true; agent: StartedAgent; reused: boolean } | { ok: false; error: string }>;
  stopAgent(agent: StartedAgent): Promise<void>;
  /** Whether the conversation's agent still has its pane and is signed in to chat as the conversation's handle. */
  agentAlive(conversation: SlackConversation): Promise<boolean>;
  /** The repo the conversation's agent was started for, when rt still knows it. */
  repoOf(conversation: SlackConversation): string | null;
  /** Never throws: a pane that will not close must not block the bookkeeping beside it. */
  closePane(pane: string | null): Promise<void>;
  /** The chat presence pane of a session, when it has one. */
  presencePane(session: string): string | null;
  gates: {
    open(input: { id: string; subject: string; kind: string; questions: GateQuestion[]; context: string; meta: SlackOpenMeta | SlackResumeMeta; pane?: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
    close(id: string): Promise<void>;
    listOpen(): GateRow[];
    /** Adds text to the context of a gate that is still waiting, and merges `meta` into its meta when given. */
    appendContext(id: string, text: string, meta?: Record<string, unknown>): void;
  };
};


/** The gate store normalizes options on open (labels capitalized), so the form is built the same way to match the stored row. */
export function slackOpenForm(question: GateQuestion): SlackOpenForm {
  return { label: question.label, options: normalizeGateOptions(question.options).map(({ value, label }) => ({ value, label })) };
}

export type RequestInput = { person: string; brief: string; requesterSession: string; requesterHandle: string; repo: string };

export async function requestSlackOpen(
  deps: SlackOpenDeps,
  input: RequestInput,
): Promise<{ ok: true; gateId: string; question: SlackOpenForm } | { ok: true; candidates: SlackCandidate[] } | { ok: false; reason: string }> {
  const found = await deps.findPerson(input.person);
  if (!found.ok) return found.candidates ? { ok: true, candidates: found.candidates } : { ok: false, reason: found.reason };
  const { id: userId, displayName } = found.person;
  if (deps.gates.listOpen().some((g) => g.subject === `slack:${userId}`)) {
    return { ok: false, reason: `a request for ${displayName} is already waiting` };
  }
  const gateId = randomUUID();
  const requesterPane = deps.presencePane(input.requesterSession);
  const meta: SlackOpenMeta = {
    action: "open",
    person: userId,
    personName: displayName,
    brief: input.brief,
    requesterSession: input.requesterSession,
    requesterHandle: input.requesterHandle,
    requesterPane: null,
    repo: input.repo,
  };
  const question: GateQuestion = { id: DECISION_ID, label: `Open a Slack support chat with ${displayName}? ${slackOpenMarker(gateId)}`, multi: false, options: [APPROVE, DECLINE] };
  const opened = await deps.gates.open({
    id: gateId,
    subject: `slack:${userId}`,
    kind: SLACK_OPEN_KIND,
    questions: [question],
    context: `Person: ${displayName}\n\nBrief:\n${input.brief}`,
    meta,
    ...(requesterPane ? { pane: requesterPane } : {}),
  });
  return opened.ok ? { ok: true, gateId: opened.id, question: slackOpenForm(question) } : { ok: false, reason: opened.error };
}

async function tell(deps: SlackOpenDeps, meta: Pick<SlackOpenMeta, "requesterHandle" | "requesterSession">, m: SlackMilestone): Promise<void> {
  try {
    await sendMilestone(deps.milestones, { handle: meta.requesterHandle, session: meta.requesterSession }, m);
  } catch (err) {
    deps.log.warn({ err, kind: m.kind }, "slack: a milestone could not be sent");
  }
}

export async function approveSlackOpen(
  deps: SlackOpenDeps,
  meta: Omit<SlackOpenMeta, "action"> & { action?: "open" },
): Promise<{ ok: true; conversation: number } | { ok: false; reason: string }> {
  const fail = async (reason: string) => {
    await tell(deps, meta, { kind: "open-failed", person: meta.personName, reason });
    return { ok: false as const, reason };
  };
  const heldBy = (room: string) => `${meta.personName} already has a Slack chat open in ${room}`;

  const busy = conversationForSlackUser(meta.person, deps.db);
  if (busy) return fail(heldBy(busy.room));
  const humanHandle = deps.humanHandle();
  if (!isValidChatName(humanHandle)) return fail(`the chat.humanHandle setting is empty or invalid ("${humanHandle}")`);
  const connected = await deps.connect(meta.person);
  if (!connected.ok) return fail(connected.reason);
  if (deps.repoPath(meta.repo) === null) return fail("the folder for this repo is not known to rt");

  const started = await deps.startAgent(meta.repo);
  if (!started.ok) return fail(started.error);
  if (started.reused) return fail("an earlier support agent is still running in this repo");
  const { agent } = started;
  const { target } = connected;

  const openedAt = deps.now();
  const firstTs = meta.triggerTs ?? meta.appendedTriggerTs ?? null;
  const requesterPane = meta.requesterPane ?? (meta.requesterSession ? deps.presencePane(meta.requesterSession) : null);
  const open = deps.db.transaction(() => {
    const identity = ensureSlackIdentity(target.userId, target.firstName, deps.db);
    const { room } = dmRoomFor(agent.handle, identity.id, humanHandle, deps.db);
    return openConversation(
      {
        room,
        agentHandle: agent.handle,
        slackHandle: identity.id,
        slackUserId: target.userId,
        slackChannel: target.channel,
        slackDisplayName: target.displayName,
        operatorUserId: target.operatorUserId,
        operatorName: target.operatorName,
        frameMarker: randomBytes(8).toString("hex"),
        lastReadTs: firstTs ? tsBefore(firstTs) : (target.newestTs ?? tsFromMs(openedAt)),
        openedAt,
        requesterSession: meta.requesterSession,
        requesterHandle: meta.requesterHandle,
        requesterPane,
        brief: meta.brief,
        assignedAgent: agent.id,
        assignedSession: agent.sessionId,
        assignedPane: agent.paneId,
        repo: meta.repo,
      },
      deps.db,
    );
  });
  try {
    const conversation = open.immediate();
    await tell(deps, meta, { kind: "opened", person: meta.personName, room: conversation.room, agentPane: agent.paneId });
    return { ok: true, conversation: conversation.id };
  } catch (err) {
    await deps.stopAgent(agent).catch((stopErr) => deps.log.warn({ err: stopErr, agent: agent.id }, "slack: the agent for a failed open could not be stopped"));
    if (err instanceof SlackConversationBusy) {
      const holder = conversationForSlackUser(meta.person, deps.db);
      return fail(holder ? heldBy(holder.room) : `${meta.personName} already has a Slack chat open`);
    }
    deps.log.warn({ err }, "slack: the open could not be recorded");
    return fail("the chat could not be recorded");
  }
}

const RESUME_CUE = "This chat has been picked up again, and the teammate's new message follows. Reply with chat_dm within a minute so they know you are here.";

function resumeBrief(old: SlackConversation, tickets: SupportTicket[]): string {
  const parts = [old.brief ?? "", `This chat resumes ${old.slackDisplayName}'s earlier one, which closed. Read its history first with rt chat read ${old.room} --last 50.`];
  if (tickets.length > 0) parts.push(["Tickets already filed from it:", ...tickets.map((t) => `- ${t.id}: ${t.title}`)].join("\n"));
  return parts.filter(Boolean).join("\n\n");
}

const RESUME_WINDOW_PASSED = "the time to pick this chat back up has passed";

/** Thrown inside the open's transaction when the grace sweep ended the window while the agent was being found or started. */
class ResumeWindowPassed extends Error {}

/** The requester is the old chat's, or the asker's when the old chat had none. */
export type SlackResumeInput = { conversation: number; triggerTs?: string | null; exceptGateId?: string; requesterSession?: string | null; requesterHandle?: string | null };

/**
 * Reopens a closed chat in its own room with its old agent if that agent is alive, else a fresh one; grace ends only once the new row exists.
 * The grace window binds only a resume the teammate's message triggered (triggerTs set); an operator-started one may reopen any closed chat.
 */
export async function approveSlackResume(
  deps: SlackOpenDeps,
  input: SlackResumeInput,
): Promise<{ ok: true; conversation: number; agent: "same" | "fresh" } | { ok: false; reason: string }> {
  const old = conversationById(input.conversation, deps.db);
  if (!old) return { ok: false, reason: "that chat is not known to rt" };
  const requester = { requesterSession: old.requesterSession ?? input.requesterSession ?? null, requesterHandle: old.requesterHandle ?? input.requesterHandle ?? null };
  const fail = async (reason: string) => {
    await tell(deps, requester, { kind: "open-failed", person: old.slackDisplayName, reason });
    return { ok: false as const, reason };
  };

  const openedAt = deps.now();
  if (old.closedAt === null) return fail("that chat is still open");
  const fromTeammate = Boolean(input.triggerTs);
  if (fromTeammate && (old.graceUntil === null || old.graceUntil <= openedAt)) return fail(RESUME_WINDOW_PASSED);
  const busy = conversationForSlackUser(old.slackUserId, deps.db);
  if (busy) return fail(`${old.slackDisplayName} already has a Slack chat open in ${busy.room}`);

  let agent: StartedAgent;
  let started: StartedAgent | null = null;
  let repo = old.repo;
  const same = old.assignedAgent !== null && old.assignedSession !== null && old.assignedPane !== null && (await deps.agentAlive(old));
  if (same) {
    agent = { id: old.assignedAgent!, handle: old.agentHandle, sessionId: old.assignedSession!, paneId: old.assignedPane! };
  } else {
    repo = repo ?? deps.repoOf(old);
    if (repo === null) return fail("rt does not know which repo this chat ran in");
    if (deps.repoPath(repo) === null) return fail("the folder for this repo is not known to rt");
    const launched = await deps.startAgent(repo);
    if (!launched.ok) return fail(launched.error);
    if (launched.reused) return fail("an earlier support agent is still running in this repo");
    agent = started = launched.agent;
  }

  const open = deps.db.transaction(() => {
    const current = conversationById(old.id, deps.db);
    if (!current || current.closedAt === null) throw new ResumeWindowPassed();
    if (fromTeammate && (current.graceUntil === null || current.graceUntil <= deps.now())) throw new ResumeWindowPassed();
    const row = openConversation(
      {
        room: old.room,
        agentHandle: agent.handle,
        slackHandle: old.slackHandle,
        slackUserId: old.slackUserId,
        slackChannel: old.slackChannel,
        slackDisplayName: old.slackDisplayName,
        operatorUserId: old.operatorUserId,
        operatorName: old.operatorName,
        frameMarker: randomBytes(8).toString("hex"),
        lastReadTs: input.triggerTs ? tsBefore(input.triggerTs) : tsFromMs(openedAt),
        openedAt,
        ...requester,
        requesterPane: old.requesterPane,
        brief: same ? old.brief : resumeBrief(old, ticketsForChain(old.id, deps.db)),
        resumedFrom: old.id,
        assignedAgent: agent.id,
        assignedSession: agent.sessionId,
        assignedPane: agent.paneId,
        repo,
      },
      deps.db,
    );
    endGrace(old.id, deps.db);
    if (!same) addRoomMember(old.room, agent.handle, "all", deps.db);
    if (same) enqueueItem({ conversationId: row.id, kind: "resumed", fromHandle: null, text: RESUME_CUE, createdAt: openedAt }, deps.db);
    return row;
  });
  try {
    const conversation = open.immediate();
    await closeResumeGates(deps, old.id, input.exceptGateId);
    // A fresh agent replaces the old one, whose idle pane would otherwise stay open.
    if (!same && old.assignedPane !== null && !paneInUse(old.assignedPane, old.id, deps.db)) await deps.closePane(old.assignedPane);
    await tell(deps, requester, { kind: "resumed", person: old.slackDisplayName, agent: same ? "same" : "fresh" });
    return { ok: true, conversation: conversation.id, agent: same ? "same" : "fresh" };
  } catch (err) {
    if (started) await deps.stopAgent(started).catch((stopErr) => deps.log.warn({ err: stopErr, agent: started!.id }, "slack: the agent for a failed resume could not be stopped"));
    if (err instanceof ResumeWindowPassed) return fail(RESUME_WINDOW_PASSED);
    if (err instanceof SlackConversationBusy) {
      const holder = conversationForSlackUser(old.slackUserId, deps.db);
      return fail(holder ? `${old.slackDisplayName} already has a Slack chat open in ${holder.room}` : `${old.slackDisplayName} already has a Slack chat open`);
    }
    deps.log.warn({ err }, "slack: the resume could not be recorded");
    return fail("the chat could not be recorded");
  }
}

function slackOpenMeta(row: GateRow): SlackOpenMeta | null {
  const meta = row.meta as Partial<SlackOpenMeta> | null;
  return meta?.action === "open" ? (meta as SlackOpenMeta) : null;
}

export function slackResumeMeta(row: GateRow): SlackResumeMeta | null {
  const meta = row.meta as Partial<SlackResumeMeta> | null;
  return meta?.action === "resume" ? (meta as SlackResumeMeta) : null;
}

/** Closes the conversation's resume requests that are still waiting, so the operator never sees a stale offer. */
export async function closeResumeGates(deps: Pick<SlackOpenDeps, "gates" | "log">, conversationId: number, exceptGateId?: string): Promise<void> {
  for (const row of deps.gates.listOpen()) {
    if (row.id === exceptGateId || slackResumeMeta(row)?.conversation !== conversationId) continue;
    try {
      await deps.gates.close(row.id);
    } catch (err) {
      deps.log.warn({ err, gateId: row.id }, "slack: a resume request could not be closed");
    }
  }
}

/** Ends the grace window and takes the idle support agent's pane with it, unless a newer conversation uses the pane. */
async function declineSlackResume(deps: SlackOpenDeps, meta: SlackResumeMeta, gateId: string): Promise<void> {
  const conversation = conversationById(meta.conversation, deps.db);
  if (!conversation) return;
  endGrace(conversation.id, deps.db);
  await closeResumeGates(deps, conversation.id, gateId);
  if (conversation.assignedPane !== null && paneInUse(conversation.assignedPane, conversation.id, deps.db)) return;
  await deps.closePane(conversation.assignedPane);
}

/** Routes an answered `slack-open` gate by its `meta.action`; an action this build does not know is left as it is. */
export async function answerSlackOpen(deps: SlackOpenDeps, row: GateRow): Promise<void> {
  const decision = String(unwrapGateAnswerValue(row.answer?.answers?.[DECISION_ID])).toLowerCase();
  const resume = slackResumeMeta(row);
  if (resume) {
    if (decision === APPROVE) await approveSlackResume(deps, { conversation: resume.conversation, triggerTs: resume.triggerTs, exceptGateId: row.id, requesterSession: resume.requesterSession, requesterHandle: resume.requesterHandle });
    else await declineSlackResume(deps, resume, row.id);
    return;
  }
  const meta = slackOpenMeta(row);
  if (!meta) return;
  if (decision === APPROVE) {
    await approveSlackOpen(deps, meta);
    return;
  }
  await tell(deps, meta, { kind: "declined", person: meta.personName });
}

/** Closes each open `slack-open` request past its time and tells its requester. */
export async function expireSlackOpenGates(deps: SlackOpenDeps): Promise<number> {
  const cutoff = deps.now() - SLACK_OPEN_TTL_MS;
  let expired = 0;
  for (const row of deps.gates.listOpen()) {
    if (row.openedAt > cutoff) continue;
    const resume = slackResumeMeta(row);
    const meta = slackOpenMeta(row) ?? resume;
    if (!meta) continue;
    try {
      await deps.gates.close(row.id);
    } catch (err) {
      deps.log.warn({ err, gateId: row.id }, "slack: an expired request could not be closed");
      continue;
    }
    expired++;
    await tell(deps, meta, { kind: resume ? "resume-expired" : "expired", person: meta.personName });
  }
  return expired;
}
