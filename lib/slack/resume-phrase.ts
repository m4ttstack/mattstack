import { resumeTrigger, type SlackPersona } from "./persona.ts";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function triggerPattern(persona: SlackPersona, trigger?: string): RegExp {
  return new RegExp(`^\\s*${escapeRegExp(resumeTrigger(persona, trigger))}(?=[\\s,:!?]|$)`, "i");
}

export function isResumePhrase(text: string, persona: SlackPersona, trigger?: string): boolean {
  return triggerPattern(persona, trigger).test(text);
}

/** What follows the trigger, without the punctuation that closed it. */
export function stripTrigger(text: string, persona: SlackPersona, trigger?: string): string {
  return text.replace(triggerPattern(persona, trigger), "").replace(/^[\s,:!?]+/, "").trim();
}
