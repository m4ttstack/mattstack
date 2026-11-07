import { resumeTrigger, type SlackPersona } from "./persona.ts";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function triggerPattern(persona: SlackPersona): RegExp {
  return new RegExp(`^\\s*${escapeRegExp(resumeTrigger(persona))}(?=[\\s,:!?]|$)`, "i");
}

export function isResumePhrase(text: string, persona: SlackPersona): boolean {
  return triggerPattern(persona).test(text);
}

/** What follows the trigger, without the punctuation that closed it. */
export function stripTrigger(text: string, persona: SlackPersona): string {
  return text.replace(triggerPattern(persona), "").replace(/^[\s,:!?]+/, "").trim();
}
