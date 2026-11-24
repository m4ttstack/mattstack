/** The host stops a Slack support chat at once. */

import { closeSupportPane } from "../slack/support-pane.ts";
import { stoppedLine, slackPrefix } from "../slack/format.ts";
import { slackPersona } from "../slack/persona.ts";
import { recordInRoom, sendToSlack, slackLifecycleLog, tellClosed, tellOperator, type SlackLifecycleDeps } from "../daemon/slack-lifecycle.ts";
import { closeConversation, conversationById, enqueueItem, expireOtherGrace } from "../state/slack-conversation-store.ts";
import { recordStop } from "../state/support-store.ts";

/** The row closes before the pane, so a message the agent is still writing is refused. */
export async function stopSlackChat(conversationId: number, deps: SlackLifecycleDeps): Promise<{ ok: true; told: boolean } | { ok: false; reason: string }> {
  const { db } = deps;
  const conv = conversationById(conversationId, db);
  if (!conv) return { ok: false, reason: "that chat is not known to rt" };
  const at = deps.now();
  const closedHere = db.transaction(() => {
    if (!closeConversation(conversationId, "operator", at, db)) return false;
    expireOtherGrace(conv.slackUserId, conversationId, at, db);
    enqueueItem({ conversationId, kind: "closed", fromHandle: null, text: "This Slack chat is closed (reason: operator).", createdAt: at }, db);
    recordStop(conv.slackUserId, at, db);
    return true;
  })();
  if (!closedHere) return { ok: false, reason: "that chat is already closed" };

  const persona = (deps.persona ?? slackPersona)();
  const name = conv.slackDisplayName;
  // A chat with no assigned pane runs in a pane of the host's own.
  if (conv.assignedPane !== null && !(await closeSupportPane({ herdrRunnerFor: deps.herdrRunnerFor, log: slackLifecycleLog }, conv.assignedPane))) {
    tellOperator("Slack chat stopped", `${persona.name} may still be running in ${conv.assignedPane}, though it can no longer message ${name}`, deps);
  }

  const line = stoppedLine(conv.operatorName, persona);
  const told = await sendToSlack(conv, line, deps);
  if (told) recordInRoom(conv, line.slice(slackPrefix(persona).length), deps);
  else tellOperator("Slack chat stopped", `${name} was not told the chat is closed, so check the DM`, deps);
  await tellClosed(conv, "operator", null, deps);
  return { ok: true, told };
}
