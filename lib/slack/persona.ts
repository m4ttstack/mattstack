import { getSetting } from "../settings/resolve.ts";
import { storedValue } from "../settings/presence.ts";
import type { Value } from "../settings/registry-schemas.ts";

export type SlackPersona = Value<"agent.persona">;

/** Read per message: the daemon is long-lived and a changed setting applies to the next line. */
export function slackPersona(): SlackPersona {
  return getSetting<SlackPersona>("agent.persona", { expand: false }).value;
}

/** Undefined when nobody set one, so the persona's name after an `@` stands in. */
export function slackTrigger(): string | undefined {
  return storedValue<string>("chat.slackSupport.trigger", { expand: false });
}

export function resumeTrigger(persona: SlackPersona, trigger?: string): string {
  const words = trigger?.trim();
  return words ? words : `@${persona.name}`;
}
