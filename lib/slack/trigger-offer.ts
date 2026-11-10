/**
 * lib/slack/trigger-offer.ts: the `slack-open` gate a teammate's trigger DM
 * raises when no chat with them exists, and the later messages that add to it.
 */

import type { Logger } from "pino";
import { parseIdentity, serializeIdentity } from "../settings/identity.ts";
import { sendMilestone } from "./milestones.ts";
import { resumeTrigger, type SlackPersona } from "./persona.ts";
import { SLACK_OPEN_KIND, slackOpenMarker, type SlackOpenDeps, type SlackOpenMeta } from "./request.ts";

export type TriggerOfferDeps = Pick<SlackOpenDeps, "gates" | "milestones" | "findPerson" | "repoPath"> & {
  log: Pick<Logger, "warn" | "debug">;
  /** The wire identity of the repo the support agent runs in, null when none is set; throws when the setting cannot be read. */
  defaultRepo(): string | null;
};

/**
 * `recorded`: a gate opened or took the text. `refused`: the operator was told why no gate can open, and the message is settled.
 * `failed`: nothing was recorded, so the message is offered again. A failure to reach Slack at all is thrown.
 */
export type TriggerOffer = "recorded" | "refused" | "failed";

export type TriggerHit = { userId: string; text: string; ts: string };

/** The setting holds `host/path`; the repo index and the agent launcher key on the wire form. */
export function supportRepoFromSetting(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return parseIdentity(trimmed) ? trimmed : serializeIdentity({ kind: "remote", id: trimmed });
}

export async function offerTriggerChat(deps: TriggerOfferDeps, hit: TriggerHit, persona: SlackPersona, trigger?: string): Promise<TriggerOffer> {
  const subject = `slack:${hit.userId}`;
  const notify = async (person: string, reason: string): Promise<void> => {
    try {
      await sendMilestone(deps.milestones, { handle: null, session: null }, { kind: "open-failed", person, reason });
    } catch (err) {
      deps.log.warn({ err }, "slack: the notice for a refused trigger could not be sent");
    }
  };

  const waiting = deps.gates.listOpen().find((g) => g.subject === subject);
  if (waiting) {
    const meta = waiting.meta as { action?: string; triggerTs?: string | null; appendedTriggerTs?: string | null } | null;
    // triggerTs marks who asked (the console reads it as a teammate's request), so a pane's gate takes the ts under its own key.
    const needsTs = meta?.action === "open" && !meta.triggerTs && !meta.appendedTriggerTs;
    deps.gates.appendContext(waiting.id, `Then:\n${hit.text}`, ...(needsTs ? [{ appendedTriggerTs: hit.ts }] : []));
    return "recorded";
  }

  const found = await deps.findPerson(hit.userId);
  if (!found.ok) {
    if (found.error !== undefined) throw found.error;
    if (found.refused) {
      await notify(hit.userId, found.reason);
      return "refused";
    }
    deps.log.debug({ userId: hit.userId, reason: found.reason }, "slack: a teammate's trigger could not be matched to a person");
    return "failed";
  }
  const personName = found.person.displayName;

  let repo: string | null;
  try {
    repo = deps.defaultRepo();
  } catch (err) {
    await notify(personName, `the chat.slackSupport.defaultRepo setting could not be read: ${err instanceof Error ? err.message : String(err)}`);
    return "refused";
  }
  if (repo === null) {
    await notify(personName, "the chat.slackSupport.defaultRepo setting names no repo for the support agent");
    return "refused";
  }
  if (deps.repoPath(repo) === null) {
    await notify(personName, "the folder for the chat.slackSupport.defaultRepo repo is not known to rt");
    return "refused";
  }

  const gateId = crypto.randomUUID();
  // The teammate's words stay in the gate context: the brief is the agent's trusted instruction, and they wrote nothing in it.
  const brief = `${personName} asked for help over Slack with ${resumeTrigger(persona, trigger)}. Their message arrives first.`;
  const meta: SlackOpenMeta = {
    action: "open",
    person: hit.userId,
    personName,
    brief,
    requesterSession: null,
    requesterHandle: null,
    requesterPane: null,
    repo,
    triggerTs: hit.ts,
  };
  const opened = await deps.gates.open({
    id: gateId,
    subject,
    kind: SLACK_OPEN_KIND,
    questions: [{ id: "decision", label: `Open a Slack support chat with ${personName}? ${slackOpenMarker(gateId)}`, multi: false, options: ["approve", "decline"] }],
    context: `Person: ${personName}\n\nMessage:\n${hit.text}`,
    meta,
  });
  return opened.ok ? "recorded" : "failed";
}
