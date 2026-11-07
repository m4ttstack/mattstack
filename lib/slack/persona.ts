import { getSetting } from "../settings/resolve.ts";
import type { Value } from "../settings/registry-schemas.ts";

export type SlackPersona = Value<"chat.slackSupport.persona">;

/** Read per message: the daemon is long-lived and a changed setting applies to the next line. */
export function slackPersona(): SlackPersona {
  return getSetting<SlackPersona>("chat.slackSupport.persona", { expand: false }).value;
}

export function resumeTrigger(persona: SlackPersona): string {
  const trigger = persona.trigger?.trim();
  return trigger ? trigger : `@${persona.name}`;
}
