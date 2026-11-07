import { resumeTrigger, type SlackPersona } from "./persona.ts";

const LEGACY_PREFIXES = ["[Claude 🤖]: ", "[Claude :robot_face:]: "];

export function slackPrefix(persona: SlackPersona): string {
  return `[${persona.name} ${persona.emoji}]: `;
}

function knownPrefixes(persona: SlackPersona): string[] {
  const own = slackPrefix(persona);
  const shortcode = persona.emoji === "🤖" ? [`[${persona.name} :robot_face:]: `] : [];
  return [own, ...shortcode, ...LEGACY_PREFIXES];
}

const PICTOGRAPH = String.raw`\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?`;
const EMOJI = String.raw`(?:${PICTOGRAPH}(?:\u200D${PICTOGRAPH})*|\p{Regional_Indicator}{2})`;

/** conversations.history returns an emoji as its shortcode, and an earlier name is still ours. */
const GENERIC_PREFIX = new RegExp(String.raw`^\[[^\]]{1,40} (?:${EMOJI}|:[a-z0-9_+-]+:)\]: `, "u");

function prefixLength(text: string, persona: SlackPersona): number {
  const known = knownPrefixes(persona).find((prefix) => text.startsWith(prefix));
  return known?.length ?? GENERIC_PREFIX.exec(text)?.[0].length ?? 0;
}

export function hasPrefix(text: string, persona: SlackPersona): boolean {
  return prefixLength(text, persona) > 0;
}

export function withPrefix(body: string, persona: SlackPersona): string {
  let rest = body.trimStart();
  for (let n = prefixLength(rest, persona); n > 0; n = prefixLength(rest, persona)) rest = rest.slice(n).trimStart();
  return slackPrefix(persona) + rest;
}

const SLACK_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">" };

/** Slack reads these three as markup, so a `<@U...>` the pane wrote stays text and pings nobody. */
export function escapeSlackText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** One pass, so a literal `&amp;lt;` comes back as `&lt;` and not `<`. */
export function decodeSlackText(text: string): string {
  return text.replace(/&(amp|lt|gt);/g, (_, name: string) => SLACK_ENTITIES[name]!);
}

export const SLACK_OPEN_REFUSAL = "only a person can open a Slack chat";

/** Blank space ahead of the command must not slip it past the refusal. */
export function opensSlackChat(text: string | undefined): boolean {
  return text?.trimStart().startsWith("/slack-support") ?? false;
}

/** For a verb that types caller text into a session; none of them has a reason to carry this command. */
export function slackOpenRefused(): { ok: false; error: string; failure: { code: string; message: string } } {
  return { ok: false, error: `chat: ${SLACK_OPEN_REFUSAL}`, failure: { code: "slack-chat", message: SLACK_OPEN_REFUSAL } };
}

export function holdingLine(operatorName: string, persona: SlackPersona): string {
  return `${slackPrefix(persona)}${persona.name} is tied up for a moment. Your message is safe, and ${operatorName} has been told.`;
}

export function closingLine(operatorName: string, paneGone: boolean, persona: SlackPersona): string {
  const base = `${slackPrefix(persona)}This chat with ${persona.name} is closed. Anything you send now goes to ${operatorName}.`;
  const resume = `To add something for ${persona.name} in the next hour, start your message with ${resumeTrigger(persona)}`;
  return paneGone ? `${base} ${operatorName} will follow up. ${resume}` : `${base} ${resume}`;
}

const REDACTION = "[redacted]";

const SECRET_SHAPES: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /xox[abp]-[A-Za-z0-9-]+/g,
  /glpat-[A-Za-z0-9_-]+/g,
  /ghp_[A-Za-z0-9]+/g,
  /AKIA[0-9A-Z]{16}/g,
];

export function redactSecrets(text: string): { text: string; redacted: boolean } {
  let out = text;
  let redacted = false;
  for (const shape of SECRET_SHAPES) {
    out = out.replace(shape, () => {
      redacted = true;
      return REDACTION;
    });
  }
  return { text: out, redacted };
}

export const TICKET_ON_SLACK = "ticket ids stay off Slack, so the message was not sent; tell them you wrote it up";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether Slack-bound text names one of the chat's tickets, by id or url, or any Linear url. */
export function namesTicket(text: string, tickets: readonly { id: string; url: string }[]): boolean {
  if (/linear\.app\//i.test(text)) return true;
  return tickets.some((t) => (t.url !== "" && text.includes(t.url)) || new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(t.id)}([^A-Za-z0-9]|$)`, "i").test(text));
}
