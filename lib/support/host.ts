/**
 * The host's side of a support request: whether it opens by itself, waits for
 * the host, or is answered with why not. Nothing a model can call reaches it.
 */

import { SUPPORT_TTL_MS } from "../../packages/rt-client/src/support.ts";
import type { GateQuestion, GateRow } from "../../packages/rt-client/src/commands.ts";
import { sendMilestone } from "../slack/milestones.ts";
import { approveSlackOpen, SLACK_OPEN_KIND, slackOpenApproved, slackOpenMarker, slackSupportMeta, type SlackOpenDeps, type SlackOpenFailure } from "../slack/request.ts";
import { agentHasPosted, conversationById, conversationForSlackUser, listOpenConversations } from "../state/slack-conversation-store.ts";
import { getRequest, listRequests, moveRequest, queueStatus, stoppedSince, type SupportRequest, type SupportState } from "../state/support-store.ts";
import type { Chain } from "./chain.ts";
import { onRoster, type SupportConfig } from "./config.ts";
import type { StatusBody } from "./sync.ts";

export const SUPPORT_MAX_OPEN = 2;
export const SUPPORT_STOP_HOLD_MS = 24 * 60 * 60_000;
const OLD_REQUEST_MS = 24 * 60 * 60_000;
/** An opening request with no chat by now was cut off by a restart. */
const LOST_OPEN_MS = 3 * 60_000;
const REASON_MAX = 300;
const SLACK_ID = /^[UW][A-Z0-9]*[0-9][A-Z0-9]*$/;

const NO_ACCOUNT = "the host's Slack workspace has no active account for you";
const NEVER_REACHED = "the support agent never reached the chat";
const STOPPED = "the host closed the chat";
const NOT_SET_UP = "the host's Mac is not set up for support yet";
const NO_AGENT = "the support agent could not start";
/** A host's own errors can hold paths and settings, so the sender reads one of these instead. */
const FAILED: Record<Exclude<SlackOpenFailure, "cap" | "busy">, string> = {
  setup: NOT_SET_UP,
  slack: "the host's Mac could not reach Slack",
  agent: NO_AGENT,
};

export interface HostDeps extends SlackOpenDeps {
  config(): SupportConfig | null;
  /** The wire identity of the repo the support agent runs in, null when none is set; throws when the setting cannot be read. */
  defaultRepo(): string | null;
  notifyOpening(r: SupportRequest, room: string): void;
  /** The request was posted to the chat's room. */
  posted(room: string, messageId: number): void;
  /** A link a teammate opens their DM with the host by. */
  dmLink(): Promise<string | null>;
  gate(id: string): GateRow | null;
  persona(): string;
  chain: Chain;
}

export type SlackSupportMeta = {
  action: "support";
  requestId: string;
  peer: string;
  person: string;
  personName: string;
  why: "cap" | "stopped";
  expiresAt: number;
};

/** The text, then each part as "<label>: <value>". */
export function renderRequest(r: Pick<SupportRequest, "text" | "parts">): string {
  const parts = r.parts.map((p) => `${p.label}: ${p.value}`).join("\n");
  return parts ? `${r.text}\n\n${parts}` : r.text;
}

/** Moves the request and queues the status its sender reads (`report`, when it differs from the new state), as one write. False when the request had already moved on. */
function settle(
  deps: HostDeps,
  r: SupportRequest,
  from: SupportState[],
  state: SupportState,
  extra: { reason?: string; dmLink?: string | null; conversationId?: number | null; gateId?: string | null } = {},
  report: SupportState = state,
): boolean {
  const reason = extra.reason?.slice(0, REASON_MAX);
  const run = deps.db.transaction(() => {
    const at = Math.max(deps.now(), (getRequest(r.direction, r.peer, r.id, deps.db)?.statusAt ?? 0) + 1);
    const patch = { ...extra, state, statusAt: at, ...(reason !== undefined ? { reason } : {}) };
    if (!moveRequest(r, from, patch, deps.now(), deps.db)) return false;
    const body: StatusBody = { requestId: r.id, state: report, at, persona: deps.persona(), ...(reason !== undefined ? { reason } : {}), ...(extra.dmLink ? { dmLink: extra.dmLink } : {}) };
    queueStatus({ id: `${r.id}:${report}`, to: r.peer, body: JSON.stringify(body) }, deps.now(), deps.db);
    return true;
  });
  // A read that becomes a write skips the busy timeout, so the write lock is taken up front.
  return run.immediate();
}

async function tellHost(deps: HostDeps, person: string, reason: string): Promise<void> {
  try {
    await sendMilestone(deps.milestones, { handle: null, session: null }, { kind: "open-failed", person, reason });
  } catch (err) {
    deps.log.warn({ err }, "support: the host could not be told of a failed request");
  }
}

async function dmLink(deps: HostDeps): Promise<string | null> {
  try {
    return await deps.dmLink();
  } catch (err) {
    deps.log.warn({ err }, "support: the link to the DM could not be made");
    return null;
  }
}

async function settleAlreadyOpen(deps: HostDeps, r: SupportRequest, from: SupportState[]): Promise<void> {
  settle(deps, r, from, "already-open", { dmLink: await dmLink(deps), gateId: null });
}

async function closeGate(deps: HostDeps, gateId: string | null): Promise<void> {
  if (gateId === null) return;
  try {
    await deps.gates.close(gateId);
  } catch (err) {
    deps.log.warn({ err, gateId }, "support: a request's gate could not be closed");
  }
}

/** The gate's id, or null when it cannot open now. */
async function openGate(deps: HostDeps, r: SupportRequest, personName: string, why: SlackSupportMeta["why"]): Promise<string | null> {
  const gateId = crypto.randomUUID();
  const question: GateQuestion = { id: "decision", label: `Open a Slack support chat with ${personName}? ${slackOpenMarker(gateId)}`, multi: false, options: ["approve", "decline"] };
  const meta: SlackSupportMeta = { action: "support", requestId: r.id, peer: r.peer, person: r.slackUserId, personName, why, expiresAt: r.receivedAt + SUPPORT_TTL_MS };
  const opened = await deps.gates.open({
    id: gateId,
    subject: `support:${r.peer}:${r.id}`,
    kind: SLACK_OPEN_KIND,
    questions: [question],
    context: `Person: ${personName} (${r.peer})\n\nMessage:\n${renderRequest(r)}`,
    meta,
  });
  if (!opened.ok) {
    deps.log.warn({ error: opened.error, id: r.id }, "support: a request that needs the host's OK could not be put to them");
    return null;
  }
  return opened.id;
}

/** Leaves the request to be taken again on the next tick when its gate cannot open. */
async function raiseGate(deps: HostDeps, r: SupportRequest, personName: string, why: SlackSupportMeta["why"]): Promise<void> {
  const gateId = await openGate(deps, r, personName, why);
  if (gateId === null) moveRequest(r, ["opening"], { state: "received" }, deps.now(), deps.db);
  else if (!settle(deps, r, ["received", "opening"], "waiting", { gateId })) await closeGate(deps, gateId);
}

/** Opens the chat for a request in `from`; a lost race for the last place puts it to the host instead. */
async function openChat(deps: HostDeps, r: SupportRequest, personName: string, from: "received" | "waiting", maxOpen: number | null): Promise<void> {
  const { db } = deps;
  let repo: string | null;
  try {
    repo = deps.defaultRepo();
  } catch (err) {
    deps.log.warn({ err }, "support: the repo setting could not be read");
    repo = null;
  }
  if (repo === null || deps.repoPath(repo) === null) {
    const reason = repo === null ? "the chat.slackSupport.defaultRepo setting names no repo for the support agent" : "the folder for the chat.slackSupport.defaultRepo repo is not known to rt";
    if (settle(deps, r, [from], "failed", { reason: NOT_SET_UP })) await tellHost(deps, personName, reason);
    return;
  }
  if (!settle(deps, r, [from], "opening", { gateId: null }, "received")) return;

  const old = deps.now() - r.receivedAt > OLD_REQUEST_MS ? " It was sent over a day ago, so ask whether they still need help." : "";
  let room = "";
  let messageId = 0;
  const opened = await approveSlackOpen(
    deps,
    {
      person: r.slackUserId,
      personName,
      brief: `${personName} asked for help from mattstack at ${new Date(r.receivedAt).toISOString()}. Their message arrives first.${old}`,
      requesterSession: null,
      requesterHandle: null,
      requesterPane: null,
      repo,
    },
    {
      firstItem: renderRequest(r),
      maxOpen,
      record(conversation, message) {
        room = conversation.room;
        messageId = message;
        if (!moveRequest(r, ["opening"], { conversationId: conversation.id }, deps.now(), db)) throw new Error("the request moved on while its chat opened");
      },
    },
  ).catch(async (err: unknown) => {
    deps.log.warn({ err, id: r.id }, "support: opening a chat threw");
    await tellHost(deps, personName, "rt could not open the chat, and its log says why");
    return { ok: false as const, code: "agent" as const };
  });
  if (opened.ok) {
    for (const tell of [() => deps.posted(room, messageId), () => deps.notifyOpening(r, room)]) {
      try {
        tell();
      } catch (err) {
        deps.log.warn({ err, id: r.id }, "support: a notice of an opened chat threw");
      }
    }
    return;
  }
  if (opened.code === "cap") return raiseGate(deps, r, personName, "cap");
  if (opened.code === "busy") return settleAlreadyOpen(deps, r, ["opening"]);
  settle(deps, r, ["opening"], "failed", { reason: FAILED[opened.code] });
}

/** Whether a stored request may still be acted on: `unknown` is a settings store that cannot be read now. */
function standing(deps: HostDeps, r: SupportRequest): "ok" | "unknown" | "stranger" | "not-accepting" {
  const cfg = deps.config();
  // A store that cannot be read gives no roster, which would make a stranger of everyone.
  if (!cfg || cfg.roster.length === 0) return "unknown";
  if (cfg.orgPath !== r.org || !onRoster(cfg, r.peer)) return "stranger";
  return cfg.acceptHere ? "ok" : "not-accepting";
}

/** Someone the org no longer lists is never answered. */
function dropStranger(deps: HostDeps, r: SupportRequest): void {
  deps.log.warn({ id: r.id, peer: r.peer }, "support: a request was dropped, since its sender is not in the org");
  moveRequest(r, [r.state], { state: "failed", reason: "not in the org", gateId: null }, deps.now(), deps.db);
}

/** The proven person's requests name every Slack account they have claimed, and a limit on them covers all of those. */
function claimedAccounts(deps: HostDeps, r: SupportRequest): string[] {
  const mine = listRequests("in", undefined, deps.db).filter((o) => o.peer === r.peer);
  return [...new Set(mine.map((o) => o.slackUserId))];
}

async function takeNow(deps: HostDeps, stale: SupportRequest): Promise<void> {
  const { db } = deps;
  const r = getRequest("in", stale.peer, stale.id, db);
  if (r?.state !== "received") return;
  const from: SupportState[] = ["received"];
  const stands = standing(deps, r);
  if (stands === "stranger") return dropStranger(deps, r);
  if (deps.now() - r.receivedAt >= SUPPORT_TTL_MS) return void settle(deps, r, from, "expired");
  if (stands === "unknown") return;
  if (stands === "not-accepting") return void settle(deps, r, from, "not-accepting");

  const found = SLACK_ID.test(r.slackUserId) ? await deps.findPerson(r.slackUserId) : null;
  if (found && !found.ok && !found.refused) {
    if (found.error !== undefined) return;
    if (settle(deps, r, from, "failed", { reason: "the host's Mac cannot reach Slack" })) await tellHost(deps, r.peer, found.reason);
    return;
  }
  if (!found?.ok || found.person.id !== r.slackUserId) {
    if (settle(deps, r, from, "failed", { reason: NO_ACCOUNT })) await tellHost(deps, r.peer, "their Slack account is not an active person in your workspace");
    return;
  }
  const personName = found.person.displayName;

  const accounts = claimedAccounts(deps, r);
  if (accounts.some((id) => conversationForSlackUser(id, db))) return settleAlreadyOpen(deps, r, from);
  if (listRequests("in", ["waiting", "opening"], db).some((o) => o.peer === r.peer)) return void settle(deps, r, from, "already-waiting");
  if (accounts.some((id) => stoppedSince(id, deps.now() - SUPPORT_STOP_HOLD_MS, db))) return raiseGate(deps, r, personName, "stopped");
  if (listOpenConversations(db).length >= SUPPORT_MAX_OPEN) return raiseGate(deps, r, personName, "cap");
  await openChat(deps, r, personName, "received", SUPPORT_MAX_OPEN);
}

async function followOpening(deps: HostDeps, r: SupportRequest): Promise<void> {
  const { db } = deps;
  if (r.conversationId === null) {
    if (deps.now() - r.updatedAt < LOST_OPEN_MS) return;
    if (settle(deps, r, ["opening"], "failed", { reason: "the host's Mac stopped while opening the chat" })) await tellHost(deps, r.peer, "rt stopped while opening their chat");
    return;
  }
  const conversation = conversationById(r.conversationId, db);
  if (conversation && agentHasPosted(conversation, db)) settle(deps, r, ["opening"], "opened", { dmLink: await dmLink(deps) });
  else if (!conversation || conversation.closedAt !== null) settle(deps, r, ["opening"], "failed", { reason: conversation?.closeReason === "operator" ? STOPPED : NEVER_REACHED });
}

/** What a waiting request's gate, its time and the org's settings say now. */
async function followWaiting(deps: HostDeps, stale: SupportRequest): Promise<void> {
  const { db } = deps;
  const r = getRequest("in", stale.peer, stale.id, db);
  if (r?.state !== "waiting") return;
  const from: SupportState[] = ["waiting"];
  const end = async (state: SupportState, extra: { dmLink?: string | null } = {}) => {
    if (settle(deps, r, from, state, { ...extra, gateId: null })) await closeGate(deps, r.gateId);
  };
  const stands = standing(deps, r);
  if (stands === "stranger") {
    dropStranger(deps, r);
    return closeGate(deps, r.gateId);
  }
  if (deps.now() - r.receivedAt >= SUPPORT_TTL_MS) return end("expired");
  if (stands === "unknown") return;
  if (stands === "not-accepting") return end("not-accepting");
  if (claimedAccounts(deps, r).some((id) => conversationForSlackUser(id, db))) return end("already-open", { dmLink: await dmLink(deps) });

  const gate = r.gateId === null ? null : deps.gate(r.gateId);
  const meta = gate ? slackSupportMeta(gate) : null;
  // The console lists open gates only, so a parked one is as good as closed.
  if (gate?.status === "open") return;
  if (gate?.answer && meta) {
    if (slackOpenApproved(gate)) await openChat(deps, r, meta.personName, "waiting", null);
    else settle(deps, r, from, "declined", { gateId: null });
    return;
  }
  const gateId = await openGate(deps, r, meta?.personName ?? r.peer, meta?.why ?? "cap");
  if (gateId !== null) moveRequest(r, from, { gateId }, deps.now(), db);
}

/** The host answered a waiting request in the console. */
export function answerSupportGate(deps: HostDeps, row: GateRow): Promise<void> {
  const meta = slackSupportMeta(row);
  return deps.chain.run(async () => {
    if (!meta) return;
    const r = getRequest("in", meta.peer, meta.requestId, deps.db);
    if (r?.gateId === row.id) await followWaiting(deps, r);
  });
}

async function each(deps: HostDeps, states: SupportState[], f: (r: SupportRequest) => Promise<void>): Promise<void> {
  for (const r of listRequests("in", states, deps.db)) {
    try {
      await f(r);
    } catch (err) {
      deps.log.warn({ err, id: r.id, state: r.state }, "support: a request could not be moved on");
    }
  }
}

/** A gate left open with no request behind it would take an answer that does nothing. */
async function closeStrayGates(deps: HostDeps): Promise<void> {
  for (const gate of deps.gates.listOpen()) {
    const meta = slackSupportMeta(gate);
    if (!meta) continue;
    const r = getRequest("in", meta.peer, meta.requestId, deps.db);
    if (r?.state !== "waiting" || r.gateId !== gate.id) await closeGate(deps, gate.id);
  }
}

/** Serialized, so requests open in the order they arrived; the count inside the open's transaction is what holds the cap. */
export function takeRequests(deps: HostDeps): Promise<void> {
  return deps.chain.run(() => each(deps, ["received"], (r) => takeNow(deps, r)));
}

export function tickRequests(deps: HostDeps): Promise<void> {
  return deps.chain.run(async () => {
    await each(deps, ["opening"], (r) => followOpening(deps, r));
    await each(deps, ["waiting"], (r) => followWaiting(deps, r));
    await each(deps, ["received"], (r) => takeNow(deps, r));
    await closeStrayGates(deps);
  });
}
