/**
 * lib/daemon/handlers/slack-open-seams.ts: how a Slack support request
 * reaches the daemon's own gates, agents and panes.
 */

import { randomBytes } from "crypto";
import type { Database } from "bun:sqlite";
import type { Logger } from "pino";
import { parsePaneRef } from "../../../packages/rt-client/src/index.ts";
import type { Commands, GateRow } from "../../../packages/rt-client/src/commands.ts";
import type { HerdrRunner } from "../../agent-herdr.ts";
import { getAgent } from "../../state/agents-store.ts";
import { presenceForHandle, presenceForSession } from "../../state/presence-store.ts";
import { SLACK_OPEN_KIND } from "../../slack/request.ts";
import { closeSupportPane } from "../../slack/support-pane.ts";
import { bgSocketPath } from "../bg-service.ts";
import type { CommandResult } from "./types.ts";
import type { SlackOpenSeams } from "./slack-chat.ts";

const AGENT_LABEL = "slack-support";

export function slackOpenSeams(deps: {
  db: Database;
  log: Logger;
  agentStart: (payload: Commands["agent:start"]["payload"]) => Promise<CommandResult<"agent:start">>;
  gateOpen: (payload: Commands["gate:open"]["payload"]) => Promise<CommandResult<"gate:open">>;
  gateClose: (payload: Commands["gate:close"]["payload"]) => Promise<CommandResult<"gate:close">>;
  gatesList: (kind: string) => GateRow[];
  gateAppendContext: (id: string, text: string, meta?: Record<string, unknown>) => void;
  herdrRunnerFor: (socket: string | null) => HerdrRunner;
  repoIndex: () => Record<string, string>;
}): SlackOpenSeams {
  const { db, log } = deps;

  /** Never throws: a pane that will not close must not block the open's own bookkeeping. */
  async function closePane(paneRef: string): Promise<void> {
    const { server, paneId } = parsePaneRef(paneRef);
    try {
      const r = await deps.herdrRunnerFor(server === "bg" ? bgSocketPath() : null)(["pane", "close", paneId]);
      if (r.exitCode !== 0) log.warn({ pane: paneRef, exitCode: r.exitCode }, "slack: the pane of a failed open could not be closed");
    } catch (err) {
      log.warn({ err, pane: paneRef }, "slack: closing the pane of a failed open threw");
    }
  }

  return {
    repoPath: (repo) => deps.repoIndex()[repo] ?? null,
    async startAgent(repo) {
      const cwd = deps.repoIndex()[repo];
      if (!cwd) return { ok: false, error: "the folder for this repo is not known to rt" };
      const started = await deps.agentStart({
        provider: "claude",
        repo,
        cwd,
        surface: "herdr",
        bg: true,
        label: AGENT_LABEL,
        // A tab per chat: the label alone would hand a second chat the first one's agent.
        tab: `${AGENT_LABEL}-${randomBytes(3).toString("hex")}`,
        caller: AGENT_LABEL,
      });
      if (!started.ok) return { ok: false, error: started.error };
      const { id, handle, sessionId, paneId, reused } = started.data;
      if (reused) return { ok: true, agent: { id, handle: handle ?? "", sessionId, paneId: paneId ?? "" }, reused: true };
      if (!handle || !paneId) {
        if (paneId) await closePane(paneId);
        return { ok: false, error: "the support agent started without a chat handle or a pane" };
      }
      return { ok: true, agent: { id, handle, sessionId, paneId }, reused: false };
    },
    stopAgent: (agent) => closePane(agent.paneId),
    async agentAlive(conversation) {
      const { assignedPane, assignedSession } = conversation;
      if (!assignedPane || !assignedSession) return false;
      const presence = presenceForHandle(conversation.agentHandle, db);
      if (!presence || presence.signedOutAt !== undefined || presence.sessionId !== assignedSession) return false;
      const { server, paneId } = parsePaneRef(assignedPane);
      try {
        return (await deps.herdrRunnerFor(server === "bg" ? bgSocketPath() : null)(["pane", "get", paneId])).exitCode === 0;
      } catch (err) {
        log.warn({ err, pane: assignedPane }, "slack: the support agent's pane could not be looked up");
        return false;
      }
    },
    repoOf: (conversation) => (conversation.assignedAgent ? (getAgent(conversation.assignedAgent, db)?.repo ?? null) : null),
    async closePane(pane) {
      await closeSupportPane({ herdrRunnerFor: deps.herdrRunnerFor, log }, pane);
    },
    presencePane(session) {
      const presence = presenceForSession(session, db);
      return presence && presence.signedOutAt === undefined ? (presence.pane ?? null) : null;
    },
    gates: {
      async open(input) {
        const opened = await deps.gateOpen({ ...input, meta: { ...input.meta } });
        return opened.ok ? { ok: true, id: opened.data.id } : { ok: false, error: opened.error };
      },
      async close(id) {
        const closed = await deps.gateClose({ id, reason: "abandoned" });
        if (!closed.ok) throw new Error(closed.error);
      },
      listOpen: () => deps.gatesList(SLACK_OPEN_KIND),
      appendContext: deps.gateAppendContext,
    },
  };
}
