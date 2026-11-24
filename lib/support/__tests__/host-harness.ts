import { tmpdir } from "os";
import { join } from "path";
import type { Logger } from "pino";
import type { GateRow } from "../../../packages/rt-client/src/commands.ts";
import type { StartedAgent } from "../../slack/request.ts";
import { openStateDb } from "../../state/db.ts";
import { postMessage } from "../../state/chat-store.ts";
import { openConversation, type SlackConversation } from "../../state/slack-conversation-store.ts";
import { insertRequest, pendingStatuses, type SupportRequest } from "../../state/support-store.ts";
import type { SupportConfig } from "../config.ts";
import type { HostDeps } from "../host.ts";
import { createChain } from "../chain.ts";
import type { StatusBody } from "../sync.ts";

let n = 0;

export const REPO = "remote:git.example.com%2Facme%2Fapp";
export const DM_LINK = "slack://user?team=T1&id=U0HOST";
export const ORG = "acme/mattstack";

const PEOPLE: Record<string, string> = { U0ADA: "Ada Example", U0BO: "Bo Example", U0CY: "Cy Example" };

export const ADA = { peer: "ada", slackUserId: "U0ADA" };
export const BO = { peer: "bo", slackUserId: "U0BO" };
export const CY = { peer: "cy", slackUserId: "U0CY" };

export function supportHost() {
  const db = openStateDb(join(tmpdir(), `support-host-${process.pid}-${n++}-${Date.now()}.db`));
  const state = {
    now: Date.now(),
    config: {
      org: "acme",
      orgRemote: ORG,
      enabled: true,
      host: "alex",
      me: "alex",
      isHost: true,
      accepts: true,
      acceptHere: true,
      roster: [{ username: "alex" }, { username: "ada" }, { username: "bo" }, { username: "cy" }],
    } as SupportConfig | null,
    repo: REPO as string | null | Error,
    repoPath: "/work/app" as string | null,
    startError: null as string | null,
    beforeStartReturns: null as (() => void) | null,
    slackDown: false,
    connectError: null as string | null,
    gateError: null as string | null,
    people: { ...PEOPLE } as Record<string, string>,
  };
  const started: string[] = [];
  const stopped: StartedAgent[] = [];
  const desk: string[] = [];
  const notified: { id: string; room: string }[] = [];
  const posted: { room: string; id: number }[] = [];
  const gates: GateRow[] = [];
  const opens: unknown[] = [];

  const deps: HostDeps = {
    db,
    now: () => state.now,
    log: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} } as unknown as Logger,
    humanHandle: () => "alex",
    milestones: { isOnline: () => false, postDm: async () => {}, desk: async (body) => void desk.push(body) },
    findPerson: async (person) => {
      if (state.slackDown) return { ok: false, reason: "Slack did not answer (ratelimited)", error: new Error("ratelimited") };
      const name = state.people[person];
      return name ? { ok: true, person: { id: person, displayName: name } } : { ok: false, reason: `No one in this Slack workspace matches ${person}`, refused: true };
    },
    connect: async (userId) => {
      if (state.connectError) return { ok: false, reason: state.connectError };
      const displayName = state.people[userId]!;
      return {
        ok: true,
        target: { userId, displayName, firstName: displayName.split(" ")[0]!, channel: `D-${userId}`, operatorUserId: "U0HOST", operatorName: "Alex", newestTs: "1700000000.000100" },
      };
    },
    repoPath: () => state.repoPath,
    startAgent: async (_repo, tab) => {
      started.push(tab);
      if (state.startError) return { ok: false, error: state.startError };
      const i = started.length;
      state.beforeStartReturns?.();
      return { ok: true, agent: { id: `ag-${i}`, handle: `support-${i}`, sessionId: `sess-${i}`, paneId: `bg:w1:p${i}` }, reused: false };
    },
    stopAgent: async (agent) => void stopped.push(agent),
    agentAlive: async () => true,
    repoOf: () => REPO,
    closePane: async () => {},
    presencePane: () => null,
    gates: {
      open: async (input) => {
        opens.push(input);
        if (state.gateError) return { ok: false, error: state.gateError };
        for (const g of gates) if (g.status === "open" && g.subject === input.subject) Object.assign(g, { status: "closed", closedReason: "superseded" });
        gates.push({
          id: input.id, subject: input.subject, kind: input.kind, questions: input.questions, context: input.context,
          meta: input.meta as unknown as Record<string, unknown>, status: "open", answer: null, openedAt: state.now, parkedAt: null,
          closedAt: null, closedReason: null, supersededBy: null, agent: null, pane: null, nudge: null, delivery: null, released: false,
          consumedAt: null, owner: null, escalatedAt: null,
        } as unknown as GateRow);
        return { ok: true, id: input.id };
      },
      close: async (id) => {
        const g = gates.find((row) => row.id === id);
        if (g) Object.assign(g, { status: "closed", closedReason: "abandoned" });
      },
      listOpen: () => gates.filter((g) => g.status === "open" || g.status === "parked"),
      appendContext: () => {},
    },
    config: () => state.config,
    defaultRepo: () => {
      if (state.repo instanceof Error) throw state.repo;
      return state.repo;
    },
    notifyOpening: (r, room) => void notified.push({ id: r.id, room }),
    posted: (room, id) => void posted.push({ room, id }),
    dmLink: async () => DM_LINK,
    gate: (id) => gates.find((g) => g.id === id) ?? null,
    persona: () => "Maude",
    chain: createChain(),
  };

  let ids = 0;
  function request(over: Partial<SupportRequest> = {}): SupportRequest {
    const i = ids++;
    const row = {
      id: `r${i}`, direction: "in" as const, org: ORG, text: "the board will not load", parts: [], state: "received" as const,
      reason: null, persona: null, dmLink: null, conversationId: null, gateId: null, statusAt: 0, sentAt: state.now, receivedAt: state.now + i, ...ADA, ...over,
    };
    insertRequest(row, db);
    return { ...row, updatedAt: row.receivedAt };
  }

  function statuses(): (Omit<StatusBody, "at" | "persona"> & { to: string })[] {
    return pendingStatuses(db).map((s) => {
      const { at: _, persona: __, ...body } = JSON.parse(s.body) as StatusBody;
      return { ...body, to: s.to };
    });
  }

  function statusTimes(): number[] {
    return pendingStatuses(db).map((s) => (JSON.parse(s.body) as StatusBody).at);
  }

  function agentPosts(conv: SlackConversation): void {
    postMessage({ room: conv.room, handle: conv.agentHandle, body: "Hi, I am Maude" }, db);
  }

  /** A chat the operator started themselves. */
  function operatorChat(slackUserId: string): SlackConversation {
    return openConversation(
      {
        room: `room-${slackUserId}`, agentHandle: `pane-${slackUserId}`, slackHandle: `slack.${slackUserId.toLowerCase()}`, slackUserId, slackChannel: `D-${slackUserId}`,
        slackDisplayName: slackUserId, operatorUserId: "U0HOST", operatorName: "Alex", frameMarker: "m", lastReadTs: "1", openedAt: state.now,
      },
      db,
    );
  }

  function answer(gateId: string, decision: string): GateRow {
    const g = gates.find((row) => row.id === gateId)!;
    Object.assign(g, { status: "answered", answer: { answers: { decision }, by: "console", at: state.now } });
    return g;
  }

  return { db, deps, state, started, stopped, desk, notified, posted, gates, opens, request, statuses, agentPosts, operatorChat, answer, statusTimes };
}
